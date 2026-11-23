const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { ROLE_IDS, isValidRoleId, roleLabel } = require('../config/roles');
const { extractToken, markJtiRevoked } = require('../middleware/auth');
const { generateNextUserCode } = require('../services/userIdService');
const { disconnectUserSockets } = require('../services/socketService');
const { sendPasswordResetOtpEmail } = require('../services/emailService');
const {
  DEFAULT_GPS_ACCURACY_THRESHOLD_METERS,
  LOCATION_VERIFICATION_STATUSES,
  evaluateResidentLocation,
} = require('../utils/bayananBoundary');

const ALLOWED_UNVERIFIED_FALLBACK_STATUSES = new Set([
  LOCATION_VERIFICATION_STATUSES.OUTSIDE_BOUNDARY,
  LOCATION_VERIFICATION_STATUSES.PENDING_REVIEW,
  LOCATION_VERIFICATION_STATUSES.GPS_DENIED,
  LOCATION_VERIFICATION_STATUSES.GPS_UNAVAILABLE,
  LOCATION_VERIFICATION_STATUSES.RETRY_REQUIRED,
]);

async function getConfiguredAccuracyThresholdMeters(dbConn = pool) {
  try {
    const [rows] = await dbConn.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'gps_accuracy_threshold_meters' LIMIT 1"
    );
    if (rows && rows[0]) {
      const val = Number(rows[0].setting_value);
      if (Number.isFinite(val) && val > 0) return val;
    }
  } catch (err) {
    // Fallback to configured default
  }
  return DEFAULT_GPS_ACCURACY_THRESHOLD_METERS;
}

function signLocationVerificationToken(payload) {
  return jwt.sign(
    {
      purpose: 'resident_location_verification',
      ...payload,
    },
    getJwtSecret(),
    { expiresIn: '30m' }
  );
}

function verifyLocationVerificationToken(token) {
  const decoded = jwt.verify(token, getJwtSecret());
  if (!decoded || decoded.purpose !== 'resident_location_verification') {
    throw new Error('Invalid location verification token purpose');
  }
  return decoded;
}

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
    user_code: row.user_code || null,
    userCode: row.user_code || null,
    name: row.name,
    email: row.email,
    role_id: row.role_id,
    role: roleLabel(row.role_id),
    role_name: row.role_name || roleDisplayName(row.role_id),
    portal: portalForRoleId(row.role_id),
    mustChangePassword: Boolean(row.must_change_password ?? row.mustChangePassword),
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
 * Public pre-registration GPS location verification endpoint.
 * Evaluates coordinates & accuracy against the official Barangay Bayanan polygon
 * and returns a backend-signed verification token.
 */
async function verifyRegistrationLocation(req, res) {
  try {
    const { latitude, longitude, accuracy, gpsErrorStatus } = req.body || {};
    const accuracyThresholdMeters = await getConfiguredAccuracyThresholdMeters(pool);

    const evaluation = evaluateResidentLocation({
      latitude,
      longitude,
      accuracy,
      gpsErrorStatus,
      accuracyThresholdMeters,
    });

    const tokenPayload = {
      status: evaluation.status,
      latitude: evaluation.status === LOCATION_VERIFICATION_STATUSES.VERIFIED || evaluation.status === LOCATION_VERIFICATION_STATUSES.PENDING_REVIEW || evaluation.status === LOCATION_VERIFICATION_STATUSES.OUTSIDE_BOUNDARY
        ? Number(latitude)
        : null,
      longitude: evaluation.status === LOCATION_VERIFICATION_STATUSES.VERIFIED || evaluation.status === LOCATION_VERIFICATION_STATUSES.PENDING_REVIEW || evaluation.status === LOCATION_VERIFICATION_STATUSES.OUTSIDE_BOUNDARY
        ? Number(longitude)
        : null,
      accuracy: evaluation.accuracy,
      boundaryDistanceMeters: evaluation.boundaryDistanceMeters,
      gpsErrorStatus: gpsErrorStatus || null,
    };

    const verificationToken = signLocationVerificationToken(tokenPayload);

    return res.json({
      status: evaluation.status,
      message: evaluation.message,
      accuracy: evaluation.accuracy,
      accuracyThresholdMeters: evaluation.accuracyThresholdMeters,
      boundaryDistanceMeters: evaluation.boundaryDistanceMeters,
      canProceed: evaluation.canProceed,
      verificationToken,
    });
  } catch (err) {
    console.error('[Auth] verifyRegistrationLocation failed:', err.message);
    return res.status(503).json({
      error: 'Unable to verify location right now. Please try again.',
    });
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
    locationVerificationToken,
    locationStatus,
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

  // Backend-enforced location verification evaluation (never trust frontend status string alone)
  let resolvedLocationStatus = LOCATION_VERIFICATION_STATUSES.PENDING_REVIEW;
  let resolvedLocationMethod = 'none';
  let resolvedAccuracy = null;
  let resolvedBoundaryDistance = null;
  let resolvedLat = null;
  let resolvedLng = null;
  let resolvedVerifiedAt = null;
  let resolvedVerificationStatus = 'Unverified Resident';

  if (locationVerificationToken) {
    let decoded;
    try {
      decoded = verifyLocationVerificationToken(locationVerificationToken);
    } catch (tokenErr) {
      return res.status(400).json({
        error: 'Location verification session expired or invalid. Please click Verify My Location again.',
      });
    }

    const accuracyThresholdMeters = await getConfiguredAccuracyThresholdMeters(pool);
    const reEvaluated = evaluateResidentLocation({
      latitude: decoded.latitude,
      longitude: decoded.longitude,
      accuracy: decoded.accuracy,
      gpsErrorStatus: decoded.gpsErrorStatus || null,
      accuracyThresholdMeters,
    });

    resolvedLocationStatus = reEvaluated.status;
    resolvedAccuracy = reEvaluated.accuracy;
    resolvedBoundaryDistance = reEvaluated.boundaryDistanceMeters;

    if (
      resolvedLocationStatus === LOCATION_VERIFICATION_STATUSES.VERIFIED ||
      resolvedLocationStatus === LOCATION_VERIFICATION_STATUSES.PENDING_REVIEW ||
      resolvedLocationStatus === LOCATION_VERIFICATION_STATUSES.OUTSIDE_BOUNDARY
    ) {
      resolvedLat = Number.isFinite(Number(decoded.latitude)) ? Number(decoded.latitude) : null;
      resolvedLng = Number.isFinite(Number(decoded.longitude)) ? Number(decoded.longitude) : null;
    }

    if (resolvedLocationStatus === LOCATION_VERIFICATION_STATUSES.VERIFIED) {
      resolvedLocationMethod = 'gps';
      resolvedVerifiedAt = new Date();
      resolvedVerificationStatus = 'Verified Resident';
    }
  } else if (locationStatus !== undefined && locationStatus !== null && locationStatus !== '') {
    const requested = String(locationStatus).trim().toLowerCase();
    if (requested === LOCATION_VERIFICATION_STATUSES.VERIFIED) {
      await logSecurityEvent(pool, {
        email,
        eventType: 'location_verification_bypass_attempt',
        attemptedRole: 'resident',
        req,
        details: 'Attempted to submit verified location status without backend-signed GPS token',
      });
      return res.status(403).json({
        error: 'Cannot claim verified location without backend GPS verification.',
      });
    }
    if (ALLOWED_UNVERIFIED_FALLBACK_STATUSES.has(requested)) {
      resolvedLocationStatus = requested;
    }
  }

  const conn = await pool.getConnection().catch((err) => {
    console.error('[Auth] DB connection error on register:', err.message);
    return null;
  });
  if (!conn) {
    return res.status(503).json({ error: 'Registration is temporarily unavailable. Please try again.' });
  }

  try {
    await conn.beginTransaction();

    const [roleRows] = await conn.query(
      "SELECT id, name FROM roles WHERE LOWER(name) = 'resident' LIMIT 1"
    );
    if (!roleRows.length) {
      await conn.rollback();
      return res.status(503).json({ error: 'Resident role is not configured.' });
    }
    const residentRole = roleRows[0];

    const [existing] = await conn.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
    if (existing.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Email already registered' });
    }

    const { userCode } = await generateNextUserCode(conn, residentRole.id);

    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await conn.query(
      `INSERT INTO users (user_code, name, email, password_hash, role_id, role, status, account_status)
       VALUES (?, ?, ?, ?, ?, 'resident', 'active', 'active')`,
      [userCode, fullName, email, password_hash, residentRole.id]
    );

    const newUserId = result.insertId;

    await conn.query(
      `INSERT INTO user_profiles
         (user_id, first_name, last_name, phone_number, street_address, barangay, city, province,
          verification_status, location_verification_status, location_verification_method,
          location_accuracy_meters, location_boundary_distance_meters, location_verified_lat,
          location_verified_lng, location_verified_at)
       VALUES (?, ?, ?, ?, ?, 'Barangay Bayanan', 'Muntinlupa City', 'Metro Manila', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newUserId,
        derivedFirstName.slice(0, 80),
        derivedLastName.slice(0, 80),
        cleanPhone,
        cleanStreet,
        resolvedVerificationStatus,
        resolvedLocationStatus,
        resolvedLocationMethod,
        resolvedAccuracy,
        resolvedBoundaryDistance,
        resolvedLat,
        resolvedLng,
        resolvedVerifiedAt,
      ]
    );

    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
       VALUES (?, 'USER_REGISTERED', 'USER_MANAGEMENT', ?, ?, ?, ?)`,
      [
        newUserId,
        String(newUserId),
        JSON.stringify({
          user_code: userCode,
          name: fullName,
          email,
          role: residentRole.name,
          role_id: residentRole.id,
          barangay: 'Barangay Bayanan',
          verification_status: resolvedVerificationStatus,
          location_verification_status: resolvedLocationStatus,
          location_verification_method: resolvedLocationMethod,
          location_accuracy_meters: resolvedAccuracy,
          status: 'SUCCESS',
        }),
        String(req.ip || '0.0.0.0').slice(0, 45),
        req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null,
      ]
    );

    await conn.commit();

    const row = {
      id: newUserId,
      user_code: userCode,
      name: fullName,
      email,
      role_id: residentRole.id,
      role_name: residentRole.name,
      verificationStatus: resolvedVerificationStatus,
      locationVerificationStatus: resolvedLocationStatus,
      locationVerificationMethod: resolvedLocationMethod,
    };
    return res.status(201).json({
      message: 'Registration successful. Please sign in with your new Resident account.',
      user: {
        ...publicUser(row),
        verificationStatus: resolvedVerificationStatus,
        locationVerificationStatus: resolvedLocationStatus,
        locationVerificationMethod: resolvedLocationMethod,
      },
      redirectTo: '/login.html',
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY' || err.code === '23505') {
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
      `SELECT u.id, u.user_code, u.name, u.email, u.password_hash, u.role_id, r.name AS role_name, u.status, u.account_status, u.must_change_password
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

    const userPayload = publicUser(user);
    if (user.role_id === ROLE_IDS.RESIDENT) {
      try {
        const [pRows] = await pool.query(
          `SELECT verification_status, location_verification_status, location_verification_method,
                  location_verified_at, location_review_reason
           FROM user_profiles WHERE user_id = ? LIMIT 1`,
          [user.id]
        );
        if (pRows[0]) {
          userPayload.verificationStatus = pRows[0].verification_status || 'Unverified Resident';
          userPayload.locationVerificationStatus = pRows[0].location_verification_status || 'pending_review';
          userPayload.locationVerificationMethod = pRows[0].location_verification_method || 'none';
          userPayload.locationVerifiedAt = pRows[0].location_verified_at || null;
          userPayload.locationReviewReason = pRows[0].location_review_reason || null;
        }
      } catch (e) {
        // Non-fatal
      }
    }

    return res.json({
      message: 'Login successful',
      user: userPayload,
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
                verification_status, location_verification_status, location_verification_method,
                location_accuracy_meters, location_verified_at, location_review_reason,
                barangay_id_number, emergency_contact_name, emergency_contact_relationship,
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
          locationVerificationStatus: p.location_verification_status || 'pending_review',
          locationVerificationMethod: p.location_verification_method || 'none',
          locationAccuracyMeters: p.location_accuracy_meters !== null ? Number(p.location_accuracy_meters) : null,
          locationVerifiedAt: p.location_verified_at || null,
          locationReviewReason: p.location_review_reason || null,
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
      if (decoded && decoded.id) {
        await disconnectUserSockets(decoded.id);
      }
    } catch {
      // Ignore malformed token on logout
    }
  }

  clearSessionCookies(req, res);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.json({ message: 'Logged out successfully' });
}

async function changePassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirmation do not match.' });
  }

  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password cannot be the same as the temporary password.' });
  }

  try {
    const [[user]] = await pool.query(
      `SELECT u.id, u.user_code, u.name, u.email, u.password_hash, u.role_id, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?
       LIMIT 1`,
      [req.user.id]
    );
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Incorrect current password.' });
    }

    const sameAsStored = await bcrypt.compare(newPassword, user.password_hash);
    if (sameAsStored) {
      return res.status(400).json({ error: 'New password cannot be the same as the temporary password.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = ?, must_change_password = FALSE, updated_at = NOW() WHERE id = ?',
      [newHash, req.user.id]
    );

    // Revoke previous session token and issue a fresh rotated session
    if (req.sessionJti) {
      markJtiRevoked(req.sessionJti);
      await logSecurityEvent(pool, {
        userId: req.user.id,
        email: user.email,
        eventType: 'token_revoked',
        attemptedRole: user.role_name,
        req,
        details: req.sessionJti,
      });
    }

    const newJti = crypto.randomBytes(16).toString('hex');
    const newCsrf = crypto.randomBytes(24).toString('hex');
    const maxAgeSeconds = 8 * 60 * 60;
    const rotatedToken = jwt.sign(
      { id: user.id, jti: newJti, csrf: newCsrf },
      getJwtSecret(),
      { algorithm: 'HS256', expiresIn: maxAgeSeconds }
    );
    setSessionCookies(req, res, rotatedToken, newCsrf, maxAgeSeconds);

    await logSecurityEvent(pool, {
      userId: req.user.id,
      email: user.email,
      eventType: 'password_changed',
      attemptedRole: user.role_name,
      req,
      details: 'Password successfully updated on first login',
    });

    try {
      const ip = (req && (req.ip || (req.connection && req.connection.remoteAddress))) || '0.0.0.0';
      const ua = req && req.headers && req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null;
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
         VALUES (?, 'PASSWORD_CHANGED', 'users', ?, ?, ?, ?)`,
        [
          req.user.id,
          String(req.user.id),
          JSON.stringify({ must_change_password: false, rotated_session: true }),
          String(ip).slice(0, 45),
          ua,
        ]
      );
    } catch (auditErr) {
      console.warn('[Auth] Could not write audit_logs for password change:', auditErr.message);
    }

    const updatedUser = publicUser({ ...user, must_change_password: false });
    return res.json({
      message: 'Password successfully updated. Redirecting to your portal...',
      mustChangePassword: false,
      csrfToken: newCsrf,
      redirectTo: portalForRoleId(user.role_id),
      user: updatedUser,
    });
  } catch (err) {
    console.error('[Auth] changePassword failed:', err.message);
    return res.status(500).json({ error: 'Failed to update password. Please try again.' });
  }
}

const passwordResetRateStore = new Map();
const RESET_RATE_WINDOW_MS = 15 * 60 * 1000;
const RESET_RATE_MAX_REQUESTS = 5;
const OTP_EXPIRY_MINUTES = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

function checkPasswordResetRateLimit(key, maxRequests = RESET_RATE_MAX_REQUESTS, windowMs = RESET_RATE_WINDOW_MS) {
  const now = Date.now();
  const bucket = passwordResetRateStore.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    passwordResetRateStore.set(key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  if (bucket.count >= maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  bucket.count += 1;
  return { allowed: true, remaining: Math.max(0, maxRequests - bucket.count) };
}

function getOtpHmacSecret() {
  const configured = String(process.env.OTP_HASH_SECRET || '').trim();
  if (configured) return configured;
  return crypto.createHmac('sha256', getJwtSecret()).update('geosafe-otp-hmac-v1').digest('hex');
}

function hmacHashOtp(otp) {
  return crypto.createHmac('sha256', getOtpHmacSecret()).update(`otp:${String(otp || '')}`).digest('hex');
}

function hmacHashResetAuth(rawToken) {
  return crypto.createHmac('sha256', getOtpHmacSecret()).update(`auth:${String(rawToken || '')}`).digest('hex');
}

function timingSafeHexEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'hex');
  const bufB = Buffer.from(String(b || ''), 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function forgotPassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const clientIp = (req && (req.ip || (req.connection && req.connection.remoteAddress))) || '0.0.0.0';

  const ipLimit = checkPasswordResetRateLimit(`ip:${clientIp}`);
  const emailLimit = checkPasswordResetRateLimit(`email:${email}`);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    const retrySec = Math.max(ipLimit.retryAfterSec || 0, emailLimit.retryAfterSec || 0, 60);
    res.setHeader('Retry-After', String(retrySec));
    return res.status(429).json({
      error: 'Too many password reset requests. Please wait a few minutes before trying again.',
    });
  }

  const genericResponse = {
    message: 'If an account exists for this email address, a 6-digit verification code will be sent.',
    cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.status, u.account_status, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE LOWER(u.email) = LOWER(?)
       LIMIT 1`,
      [email]
    );

    const user = rows[0];
    if (!user || user.status !== 'active' || (user.account_status && user.account_status !== 'active')) {
      return res.json(genericResponse);
    }

    const rawOtp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const otpHash = hmacHashOtp(rawOtp);

    const conn = await pool.getConnection();
    let otpId = null;
    try {
      await conn.beginTransaction();

      // Check 60-second resend cooldown for this account
      const [recentRows] = await conn.query(
        `SELECT id, EXTRACT(EPOCH FROM (NOW() - last_sent_at)) AS elapsed_sec
         FROM password_reset_otps
         WHERE user_id = ?
           AND consumed_at IS NULL
           AND last_sent_at > NOW() - INTERVAL '60 seconds'
         ORDER BY last_sent_at DESC
         LIMIT 1
         FOR UPDATE`,
        [user.id]
      );

      if (recentRows.length > 0) {
        const elapsed = Number(recentRows[0].elapsed_sec || 0);
        const waitSec = Math.max(1, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed));
        await conn.rollback();
        res.setHeader('Retry-After', String(waitSec));
        return res.status(429).json({
          error: `Please wait ${waitSec} seconds before requesting another verification code.`,
          retryAfterSeconds: waitSec,
        });
      }

      // Invalidate any prior unconsumed OTPs for this user
      await conn.query(
        'UPDATE password_reset_otps SET consumed_at = NOW() WHERE user_id = ? AND consumed_at IS NULL',
        [user.id]
      );

      const [insRes] = await conn.query(
        `INSERT INTO password_reset_otps (
           user_id, otp_hash, expires_at, attempts, max_attempts, last_sent_at, request_ip
         )
         VALUES (?, ?, NOW() + INTERVAL '5 minutes', 0, ?, NOW(), ?)`,
        [user.id, otpHash, OTP_MAX_ATTEMPTS, String(clientIp).slice(0, 45)]
      );
      otpId = insRes.insertId;
      await conn.commit();
    } catch (txErr) {
      await conn.rollback().catch(() => {});
      throw txErr;
    } finally {
      conn.release();
    }

    try {
      await sendPasswordResetOtpEmail({
        to: user.email,
        name: user.name,
        otp: rawOtp,
        expiresMinutes: OTP_EXPIRY_MINUTES,
      });
    } catch (emailErr) {
      if (otpId) {
        await pool.query('UPDATE password_reset_otps SET consumed_at = NOW() WHERE id = ?', [otpId]).catch(() => {});
      }
      console.error('[Auth] Password reset OTP email delivery failed:', emailErr.message);
      await logSecurityEvent(pool, {
        userId: user.id,
        email: user.email,
        eventType: 'password_reset_email_failed',
        attemptedRole: user.role_name,
        req,
        details: String(emailErr.code || emailErr.message || 'Email delivery failed').slice(0, 200),
      });

      return res.status(503).json({
        error: 'Unable to send verification email right now. Please try again later or contact the Barangay Bayanan EOC administrator.',
      });
    }

    await logSecurityEvent(pool, {
      userId: user.id,
      email: user.email,
      eventType: 'password_reset_requested',
      attemptedRole: user.role_name,
      req,
      details: '6-digit OTP emailed via Resend (5m expiry)',
    });

    return res.json(genericResponse);
  } catch (err) {
    console.error('[Auth] forgotPassword failed:', err.message);
    return res.status(500).json({ error: 'Unable to process password reset request right now.' });
  }
}

async function verifyResetOtp(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const rawOtp = String((req.body && req.body.otp) || '').trim();
  const clientIp = (req && (req.ip || (req.connection && req.connection.remoteAddress))) || '0.0.0.0';

  const ipLimit = checkPasswordResetRateLimit(`verify-ip:${clientIp}`, 15, RESET_RATE_WINDOW_MS);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec || 60));
    return res.status(429).json({
      error: 'Too many verification attempts. Please wait a few minutes before trying again.',
    });
  }

  if (!/^\d{6}$/.test(rawOtp)) {
    return res.status(400).json({ error: 'Please enter a valid 6-digit verification code.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT o.id, o.user_id, o.otp_hash, o.expires_at, o.attempts, o.max_attempts,
              u.email, r.name AS role_name
       FROM password_reset_otps o
       JOIN users u ON u.id = o.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE LOWER(u.email) = LOWER(?)
         AND u.status = 'active'
         AND u.account_status = 'active'
         AND o.consumed_at IS NULL
         AND o.verified_at IS NULL
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT 1
       FOR UPDATE OF o`,
      [email]
    );

    const otpRow = rows[0];
    if (!otpRow) {
      await conn.rollback();
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    if (new Date(otpRow.expires_at).getTime() <= Date.now()) {
      await conn.query('UPDATE password_reset_otps SET consumed_at = NOW() WHERE id = ?', [otpRow.id]);
      await conn.commit();
      return res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
    }

    if (Number(otpRow.attempts) >= Number(otpRow.max_attempts || OTP_MAX_ATTEMPTS)) {
      await conn.query('UPDATE password_reset_otps SET consumed_at = NOW() WHERE id = ?', [otpRow.id]);
      await conn.commit();
      return res.status(400).json({
        error: 'Maximum verification attempts exceeded. Please request a new verification code.',
        remainingAttempts: 0,
      });
    }

    const candidateHash = hmacHashOtp(rawOtp);
    if (!timingSafeHexEqual(candidateHash, otpRow.otp_hash)) {
      const nextAttempts = Number(otpRow.attempts) + 1;
      const maxAtt = Number(otpRow.max_attempts || OTP_MAX_ATTEMPTS);
      const exhausted = nextAttempts >= maxAtt;
      await conn.query(
        `UPDATE password_reset_otps
         SET attempts = ?,
             consumed_at = CASE WHEN ? THEN NOW() ELSE consumed_at END
         WHERE id = ?`,
        [nextAttempts, exhausted, otpRow.id]
      );
      await conn.commit();

      const remainingAttempts = Math.max(0, maxAtt - nextAttempts);
      return res.status(400).json({
        error: exhausted
          ? 'Maximum verification attempts exceeded. Please request a new verification code.'
          : `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`,
        remainingAttempts,
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetAuthHash = hmacHashResetAuth(resetToken);

    await conn.query(
      `UPDATE password_reset_otps
       SET verified_at = NOW(),
           reset_auth_hash = ?,
           reset_auth_expires_at = NOW() + INTERVAL '10 minutes'
       WHERE id = ?`,
      [resetAuthHash, otpRow.id]
    );

    await conn.commit();
    return res.json({
      verified: true,
      resetToken,
      message: 'Verification code confirmed. You may now set a new password.',
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Auth] verifyResetOtp failed:', err.message);
    return res.status(500).json({ error: 'Unable to verify code right now.' });
  } finally {
    conn.release();
  }
}

async function resetPassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const clientIp = (req && (req.ip || (req.connection && req.connection.remoteAddress))) || '0.0.0.0';
  const ipLimit = checkPasswordResetRateLimit(`reset-ip:${clientIp}`, 10, RESET_RATE_WINDOW_MS);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec || 60));
    return res.status(429).json({
      error: 'Too many password reset attempts. Please wait a few minutes and try again.',
    });
  }

  const { resetToken, token, newPassword, confirmPassword } = req.body || {};
  const rawToken = String(resetToken || token || '').trim();
  if (!rawToken || rawToken.length < 32) {
    return res.status(400).json({ error: 'Your password reset session is invalid or has expired.' });
  }
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }
  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirmation do not match.' });
  }

  const authHash = hmacHashResetAuth(rawToken);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT o.id AS otp_id, u.id, u.email, u.password_hash, u.role_id, r.name AS role_name
       FROM password_reset_otps o
       JOIN users u ON u.id = o.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE o.reset_auth_hash = ?
         AND o.verified_at IS NOT NULL
         AND o.consumed_at IS NULL
         AND o.reset_auth_expires_at > NOW()
         AND u.status = 'active'
         AND u.account_status = 'active'
       LIMIT 1
       FOR UPDATE OF o, u`,
      [authHash]
    );

    const row = rows[0];
    if (!row) {
      await conn.rollback();
      await logSecurityEvent(pool, {
        userId: null,
        email: null,
        eventType: 'password_reset_failed',
        req,
        details: 'Invalid, expired, or already-used OTP reset authorization',
      });
      return res.status(400).json({ error: 'Your password reset authorization is invalid, expired, or has already been used.' });
    }

    // Consume reset authorization atomically so it cannot be replayed
    const [consumedRes] = await conn.query(
      'UPDATE password_reset_otps SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL RETURNING id',
      [row.otp_id]
    );
    const consumedCount = Array.isArray(consumedRes)
      ? consumedRes.length
      : Number((consumedRes && (consumedRes.affectedRows || consumedRes.rowCount || (consumedRes.rows && consumedRes.rows.length))) || 0);
    if (consumedCount === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'This password reset authorization has already been used.' });
    }

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await conn.query(
      `UPDATE users
       SET password_hash = ?,
           reset_token_hash = NULL,
           reset_token_expires = NULL,
           must_change_password = FALSE,
           password_changed_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [newHash, row.id]
    );

    await conn.commit();

    await disconnectUserSockets(row.id).catch(() => {});

    await logSecurityEvent(pool, {
      userId: row.id,
      email: row.email,
      eventType: 'password_reset_completed',
      attemptedRole: row.role_name,
      req,
      details: 'Password reset completed via single-use Email OTP',
    });

    try {
      const ua = req && req.headers && req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null;
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
         VALUES (?, 'PASSWORD_RESET_COMPLETED', 'users', ?, ?, ?, ?)`,
        [
          row.id,
          String(row.id),
          JSON.stringify({ method: 'email_otp', sessions_invalidated: true }),
          String(clientIp).slice(0, 45),
          ua,
        ]
      );
    } catch (auditErr) {
      console.warn('[Auth] Could not write audit_logs for password reset:', auditErr.message);
    }

    return res.json({
      message: 'Your password has been reset successfully. You may now sign in with your new password.',
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Auth] resetPassword failed:', err.message);
    return res.status(500).json({ error: 'Unable to reset password right now. Please try again.' });
  } finally {
    conn.release();
  }
}

module.exports = {
  verifyRegistrationLocation,
  getConfiguredAccuracyThresholdMeters,
  register,
  login,
  getSession,
  logout,
  changePassword,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  checkPasswordResetRateLimit,
  passwordResetRateStore,
  portalForRoleId,
  roleDisplayName,
};
