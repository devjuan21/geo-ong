const jwt = require('jsonwebtoken');
const pool = require('../models/db');
const { roleLabel } = require('../config/roles');

// In-memory fast cache of revoked session JTIs (backed by persistent auth_security_logs in MySQL)
const revokedJtis = new Set();

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers && req.headers.cookie;
  if (!cookieHeader) return list;

  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    if (!key) return;
    const value = parts.join('=').trim();
    try {
      list[key] = decodeURIComponent(value);
    } catch {
      list[key] = value;
    }
  });
  return list;
}

function extractToken(req) {
  const cookies = parseCookies(req);
  if (cookies.geosafe_session) {
    return { token: cookies.geosafe_session, source: 'cookie', cookies };
  }
  const header = req.headers && req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return { token: header.split(' ')[1], source: 'bearer', cookies };
  }
  return { token: null, source: null, cookies };
}

async function isJtiRevoked(userId, jti) {
  if (!jti) return false;
  if (revokedJtis.has(jti)) return true;

  try {
    const [rows] = await pool.query(
      `SELECT id FROM auth_security_logs
       WHERE user_id = ? AND event_type = 'token_revoked' AND details = ?
       LIMIT 1`,
      [userId, jti]
    );
    if (rows.length > 0) {
      revokedJtis.add(jti);
      return true;
    }
  } catch (err) {
    console.error('[Auth] Revocation check failed:', err.message);
  }
  return false;
}

function markJtiRevoked(jti) {
  if (jti) {
    revokedJtis.add(jti);
  }
}

/**
 * Verifies the user session from the HttpOnly cookie (or Bearer token) and loads
 * live account status and role_id from MySQL.
 * Returns { ok: true, user, decoded, source } or { ok: false, status, error }.
 */
async function verifyRequestSession(req) {
  const { token, source, cookies } = extractToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  if (!process.env.JWT_SECRET) {
    console.error('[Auth] JWT_SECRET is not configured; refusing all authenticated requests.');
    return { ok: false, status: 503, error: 'Authentication service is not configured' };
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return { ok: false, status: 401, error: 'Invalid or expired session' };
  }

  if (decoded.jti && (await isJtiRevoked(decoded.id, decoded.jti))) {
    return { ok: false, status: 401, error: 'Session has been logged out or revoked' };
  }

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.user_code, u.name, u.email, u.role_id, r.name AS role_name, u.status, u.account_status
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?
       LIMIT 1`,
      [decoded.id]
    );

    if (!rows.length) {
      return { ok: false, status: 401, error: 'Account no longer exists' };
    }

    const user = rows[0];
    if (user.status !== 'active' || (user.account_status && user.account_status !== 'active')) {
      return { ok: false, status: 403, error: 'Account is disabled or suspended. Please contact the Barangay Bayanan EOC.' };
    }

    const label = roleLabel(user.role_id);
    if (!label) {
      console.error(`[Auth] User ${user.id} has unauthorized role_id ${user.role_id}; access denied.`);
      return { ok: false, status: 403, error: 'Account has no valid role assignment' };
    }

    return {
      ok: true,
      user: {
        id: user.id,
        user_code: user.user_code,
        userCode: user.user_code,
        name: user.name,
        email: user.email,
        role_id: user.role_id,
        role: label,
        role_name: user.role_name,
      },
      decoded,
      source,
      cookies,
    };
  } catch (err) {
    console.error('[Auth] Account lookup failed:', err.message);
    return { ok: false, status: 503, error: 'Authentication service is temporarily unavailable' };
  }
}

/**
 * Authenticates every protected API request.
 *
 * - Reads the HttpOnly `geosafe_session` cookie (or Bearer token).
 * - Enforces CSRF token verification on state-changing requests (POST/PUT/PATCH/DELETE)
 *   when using cookie authentication.
 * - Queries MySQL on every request for the user's current role_id and account status.
 */
async function authenticate(req, res, next) {
  const result = await verifyRequestSession(req);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  // Enforce CSRF protection on state-changing requests authenticated via cookie
  const method = (req.method || 'GET').toUpperCase();
  if (result.source === 'cookie' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const headerCsrf = req.headers['x-csrf-token'];
    const expectedCsrf = result.decoded.csrf;
    if (!expectedCsrf || !headerCsrf || headerCsrf !== expectedCsrf) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token' });
    }
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  req.user = result.user;
  req.sessionJti = result.decoded.jti || null;
  req.csrfToken = result.decoded.csrf || null;
  req.authSource = result.source;
  return next();
}

module.exports = {
  authenticate,
  verifyRequestSession,
  parseCookies,
  extractToken,
  markJtiRevoked,
};
