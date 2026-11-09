const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { ROLE_IDS, isValidRoleId, roleLabel } = require('../config/roles');
const { extractToken, markJtiRevoked } = require('../middleware/auth');

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return process.env.JWT_SECRET;
}

function portalForRoleId(roleId) {
  if (roleId === ROLE_IDS.ADMINISTRATOR) return '/admin.html';
  if (roleId === ROLE_IDS.RESPONDER) return '/responder-dashboard.html';
  return '/index.html';
}

function roleDisplayName(roleId) {
  if (roleId === ROLE_IDS.ADMINISTRATOR) return 'Administrator';
  if (roleId === ROLE_IDS.RESPONDER) return 'Responder';
  return 'Resident';
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role_id: row.role_id,
    role: roleLabel(row.role_id),
    role_name: row.role_name || roleDisplayName(row.role_id),
    portal: portalForRoleId(row.role_id),
  };
}

function buildCookieString(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function setSessionCookies(req, res, token, csrfToken, maxAgeSeconds) {
  const isSecure = process.env.NODE_ENV === 'production' || Boolean(req.secure);
  const sessionCookie = buildCookieString('geosafe_session', token, {
    path: '/',
    maxAge: maxAgeSeconds,
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecure,
  });
  const csrfCookie = buildCookieString('geosafe_csrf', csrfToken, {
    path: '/',
    maxAge: maxAgeSeconds,
    httpOnly: false,
    sameSite: 'Lax',
    secure: isSecure,
  });
  res.setHeader('Set-Cookie', [sessionCookie, csrfCookie]);
}

function clearSessionCookies(req, res) {
  const isSecure = process.env.NODE_ENV === 'production' || Boolean(req.secure);
  const expiredSession = buildCookieString('geosafe_session', '', {
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecure,
  });
  const expiredCsrf = buildCookieString('geosafe_csrf', '', {
    path: '/',
    maxAge: 0,
    httpOnly: false,
    sameSite: 'Lax',
    secure: isSecure,
  });
  res.setHeader('Set-Cookie', [expiredSession, expiredCsrf]);
}

async function logSecurityEvent(connOrPool, { userId = null, email = null, eventType, attemptedRole = null, req, details = null }) {
  try {
    const ip = (req && (req.ip || (req.connection && req.connection.remoteAddress))) || '0.0.0.0';
    const ua = req && req.headers && req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null;
    await connOrPool.query(
      `INSERT INTO auth_security_logs (user_id, attempted_email, event_type, attempted_role, ip_address, user_agent, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, email, eventType, attemptedRole, String(ip).slice(0, 45), ua, details ? String(details).slice(0, 255) : null]
    );
  } catch (err) {
    console.warn('[Auth] Could not write auth_security_logs:', err.message);
  }
}

/**
 * Public self-registration. ALWAYS creates a Resident (role_id = 3).
 * Any attempt to request another role is rejected explicitly (HTTP 403) and logged.
 */
async function register(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
  }

  const {
    name,
    first_name,
    last_name,
    email,
    password,
    phone_number,
    phone,
    street_address,
    street,
    role,
    role_id,
  } = req.body;

  // Explicitly reject any attempt to self-register as Responder or Administrator
  if (role_id !== undefined && role_id !== null && role_id !== '') {
    if (!isValidRoleId(role_id)) {
      return res.status(400).json({ error: 'Invalid role_id.' });
    }
    if (parseInt(role_id, 10) !== ROLE_IDS.RESIDENT) {
      await logSecurityEvent(pool, {
        email,
        eventType: 'unauthorized_role_attempt',
        attemptedRole: String(role_id),
        req,
        details: 'Attempted privileged role_id during public registration',
      });
      return res.status(403).json({ error: 'Only Resident accounts can self-register.' });
    }
  }
  if (role !== undefined && role !== null && role !== '') {
    if (String(role).trim().toLowerCase() !== 'resident') {
      await logSecurityEvent(pool, {
        email,
        eventType: 'unauthorized_role_attempt',
        attemptedRole: String(role),
        req,
        details: 'Attempted privileged role during public registration',
      });
      return res.status(403).json({ error: 'Only Resident accounts can self-register.' });
    }
  }

  // Derive full name and first/last name
  const firstNameTrimmed = first_name ? String(first_name).trim() : '';
  const lastNameTrimmed = last_name ? String(last_name).trim() : '';
  const fullName = name
    ? String(name).trim()
    : `${firstNameTrimmed} ${lastNameTrimmed}`.trim();

  if (!fullName || fullName.length < 2 || fullName.length > 120) {
    return res.status(400).json({ error: 'Full name is required (2 to 120 characters).' });
  }

  const derivedFirstName = firstNameTrimmed || fullName.split(/\s+/)[0] || 'Resident';
  const derivedLastName = lastNameTrimmed || fullName.split(/\s+/).slice(1).join(' ') || 'Resident';
  const cleanPhone = (phone_number || phone || '').trim().slice(0, 30) || null;
  const cleanStreet = (street_address || street || '').trim().slice(0, 255) || null;

  const conn = await pool.getConnection().catch((err) => {
    console.error('[Auth] DB connection error on register:', err.message);
    return null;
  });
  if (!conn) {
    return res.status(503).json({ error: 'Registration is temporarily unavailable. Please try again.' });
  }

  try {
    await conn.beginTransaction();

    const [existing] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await conn.query(
      `INSERT INTO users (name, email, password_hash, role_id, role, status, account_status)
       VALUES (?, ?, ?, ?, 'resident', 'active', 'active')`,
      [fullName, email, password_hash, ROLE_IDS.RESIDENT]
    );

    const newUserId = result.insertId;

    await conn.query(
      `INSERT INTO user_profiles
         (user_id, first_name, last_name, phone_number, street_address, barangay, city, province, verification_status)
       VALUES (?, ?, ?, ?, ?, 'Barangay Bayanan', 'Muntinlupa City', 'Metro Manila', 'Unverified Resident')`,
      [newUserId, derivedFirstName.slice(0, 80), derivedLastName.slice(0, 80), cleanPhone, cleanStreet]
    );

    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
       VALUES (?, 'USER_REGISTERED', 'USER_MANAGEMENT', ?, ?, ?, ?)`,
      [
        newUserId,
        String(newUserId),
        JSON.stringify({
          name: fullName,
          email,
          role: 'Resident',
          role_id: ROLE_IDS.RESIDENT,
          barangay: 'Barangay Bayanan',
          status: 'SUCCESS',
        }),
        String(req.ip || '0.0.0.0').slice(0, 45),
        req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null,
      ]
    );

    await logSecurityEvent(conn, {
      userId: newUserId,
      email,
      eventType: 'user_registered',
      attemptedRole: 'Resident',
      req,
      details: `Self-registered Resident account (${fullName})`,
    });

    await conn.commit();

    const row = { id: newUserId, name: fullName, email, role_id: ROLE_IDS.RESIDENT, role_name: 'Resident' };
    return res.status(201).json({
      message: 'Registration successful. Please sign in with your new Resident account.',
      user: publicUser(row),
      redirectTo: '/login.html',
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('[Auth] register failed:', err.message);
    return res.status(503).json({ error: 'Registration is temporarily unavailable. Please try again.' });
  } finally {
    conn.release();
  }
}

async function login(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
  }

  const { email, password, rememberMe } = req.body;

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.role_id, r.name AS role_name, u.status, u.account_status
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.email = ?
       LIMIT 1`,
      [email]
    );

    const user = rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!valid) {
      await logSecurityEvent(pool, {
        userId: user ? user.id : null,
        email,
        eventType: 'login_failed',
        req,
        details: user ? 'Invalid password' : 'Unknown email',
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status !== 'active' || (user.account_status && user.account_status !== 'active')) {
      await logSecurityEvent(pool, {
        userId: user.id,
        email: user.email,
        eventType: 'login_failed',
        req,
        details: `Account status is ${user.status}`,
      });
      return res.status(403).json({ error: 'Account is disabled or suspended. Please contact the Barangay Bayanan EOC.' });
    }

    if (!isValidRoleId(user.role_id)) {
      return res.status(403).json({ error: 'Account has no valid role assignment.' });
    }

    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    const jti = crypto.randomBytes(16).toString('hex');
    const csrf = crypto.randomBytes(24).toString('hex');
    const maxAgeSeconds = rememberMe ? 24 * 60 * 60 : 8 * 60 * 60;

    const token = jwt.sign(
      { id: user.id, jti, csrf },
      getJwtSecret(),
      { algorithm: 'HS256', expiresIn: maxAgeSeconds }
    );

    await logSecurityEvent(pool, {
      userId: user.id,
      email: user.email,
      eventType: 'login_success',
      attemptedRole: user.role_name,
      req,
      details: jti,
    });

    setSessionCookies(req, res, token, csrf, maxAgeSeconds);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    return res.json({
      message: 'Login successful',
      user: publicUser(user),
      csrfToken: csrf,
    });
  } catch (err) {
    console.error('[Auth] login failed:', err.message);
    return res.status(503).json({ error: 'Authentication service is temporarily unavailable' });
  }
}

async function getSession(req, res) {
  try {
    const user = req.user;
    let profile = null;

    if (user.role_id === ROLE_IDS.RESIDENT) {
      const [pRows] = await pool.query(
        `SELECT first_name, last_name, phone_number, street_address, barangay, city, province, postal_code,
                verification_status, barangay_id_number, emergency_contact_name, emergency_contact_relationship,
                emergency_contact_phone, medical_notes
         FROM user_profiles WHERE user_id = ? LIMIT 1`,
        [user.id]
      );
      if (pRows[0]) {
        const p = pRows[0];
        profile = {
          firstName: p.first_name,
          lastName: p.last_name,
          email: user.email,
          phone: p.phone_number || '',
          address: {
            street: p.street_address || '',
            barangay: p.barangay || 'Barangay Bayanan',
            city: p.city || 'Muntinlupa City',
            province: p.province || 'Metro Manila',
            postalCode: p.postal_code || '1772',
          },
          verificationStatus: p.verification_status || 'Unverified Resident',
          barangayIdNumber: p.barangay_id_number || null,
          emergencyContact: {
            name: p.emergency_contact_name || '',
            relationship: p.emergency_contact_relationship || '',
            phone: p.emergency_contact_phone || '',
          },
          medicalNotes: p.medical_notes || '',
        };
      }
    } else if (user.role_id === ROLE_IDS.RESPONDER) {
      const [rRows] = await pool.query(
        `SELECT badge_number, callsign, assigned_unit, department, specialization, availability_status,
                current_latitude, current_longitude
         FROM responder_profiles WHERE user_id = ? LIMIT 1`,
        [user.id]
      );
      const r = rRows[0] || {};
      const parts = String(user.name || '').trim().split(/\s+/);
      profile = {
        id: user.id,
        firstName: parts[0] || 'Responder',
        lastName: parts.slice(1).join(' ') || '',
        email: user.email,
        role: 'Responder',
        badgeNumber: r.badge_number || `RESP-${user.id}`,
        callsign: r.callsign || `BAYANAN-${user.id}`,
        assignedUnit: r.assigned_unit || 'Barangay Bayanan Field Unit',
        department: r.department || 'Barangay Bayanan Emergency Operations',
        specialization: r.specialization || '',
        availability: r.availability_status || 'Off Duty',
      };
    }

    return res.json({
      authenticated: true,
      user: publicUser(user),
      profile,
      csrfToken: req.csrfToken,
    });
  } catch (err) {
    console.error('[Auth] getSession failed:', err.message);
    return res.status(503).json({ error: 'Session verification temporarily unavailable' });
  }
}

async function logout(req, res) {
  const { token } = extractToken(req);

  if (token && process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], ignoreExpiration: true });
      if (decoded && decoded.jti) {
        markJtiRevoked(decoded.jti);
        await logSecurityEvent(pool, {
          userId: decoded.id || null,
          eventType: 'token_revoked',
          req,
          details: decoded.jti,
        });
        await logSecurityEvent(pool, {
          userId: decoded.id || null,
          eventType: 'logout',
          req,
          details: decoded.jti,
        });
      }
    } catch {
      // Ignore malformed token on logout
    }
  }

  clearSessionCookies(req, res);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.json({ message: 'Logged out successfully' });
}

module.exports = {
  register,
  login,
  getSession,
  logout,
  portalForRoleId,
  roleDisplayName,
};
