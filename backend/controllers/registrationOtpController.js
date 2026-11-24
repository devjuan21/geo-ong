const crypto = require('crypto');
const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { sendRegistrationOtpEmail } = require('../services/emailService');

const regOtpRateStore = new Map();
const regOtpCooldownStore = new Map();

const REG_RATE_WINDOW_MS = 15 * 60 * 1000;
const REG_RATE_MAX_REQUESTS = 5;
const REG_OTP_EXPIRY_MINUTES = 5;
const REG_OTP_RESEND_COOLDOWN_SECONDS = 60;
const REG_OTP_MAX_ATTEMPTS = 5;
const REG_TOKEN_EXPIRY_MINUTES = 30;

function checkRegRateLimit(key, maxRequests = REG_RATE_MAX_REQUESTS, windowMs = REG_RATE_WINDOW_MS) {
  const now = Date.now();
  const bucket = regOtpRateStore.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    regOtpRateStore.set(key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  if (bucket.count >= maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  bucket.count += 1;
  return { allowed: true, remaining: Math.max(0, maxRequests - bucket.count) };
}

function getRegOtpSecret() {
  const secret = String(process.env.REG_OTP_HASH_SECRET || process.env.OTP_HASH_SECRET || '').trim();
  if (!secret) {
    const err = new Error('Registration OTP secret is not configured');
    err.code = 'REG_OTP_SECRET_MISSING';
    throw err;
  }
  return secret;
}

function hmacRegValue(domainPrefix, value) {
  return crypto
    .createHmac('sha256', getRegOtpSecret())
    .update(`${domainPrefix}:${String(value || '')}`)
    .digest('hex');
}

function timingSafeHexEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function resolveFrontendOrigin(req) {
  const configured = String(process.env.FRONTEND_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return '';
  return `${String(proto).split(',')[0].trim()}://${String(host).split(',')[0].trim()}`;
}

/**
 * POST /api/register/request-otp (and /api/auth/register/request-otp)
 * Dedicated registration email OTP request. Strictly isolated from Forgot Password.
 */
async function requestRegistrationOtp(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const displayName = String(
    (req.body && (req.body.name || `${req.body.first_name || ''} ${req.body.last_name || ''}`)) || 'Applicant'
  ).trim() || 'Applicant';
  const clientIp = (req && (req.ip || (req.connection && req.connection.remoteAddress))) || '0.0.0.0';

  const nowMs = Date.now();
  const lastSentMs = regOtpCooldownStore.get(email) || 0;
  const cooldownElapsedSec = Math.floor((nowMs - lastSentMs) / 1000);
  if (lastSentMs > 0 && cooldownElapsedSec < REG_OTP_RESEND_COOLDOWN_SECONDS) {
    const waitSec = REG_OTP_RESEND_COOLDOWN_SECONDS - cooldownElapsedSec;
    res.setHeader('Retry-After', String(waitSec));
    return res.status(429).json({
      error: `Please wait ${waitSec} seconds before requesting another verification code.`,
      retryAfterSec: waitSec,
    });
  }

  const ipLimit = checkRegRateLimit(`reg-ip:${clientIp}`);
  const emailLimit = checkRegRateLimit(`reg-email:${email}`);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    const retrySec = Math.max(ipLimit.retryAfterSec || 0, emailLimit.retryAfterSec || 0, 60);
    res.setHeader('Retry-After', String(retrySec));
    return res.status(429).json({
      error: 'Too many verification code requests. Please wait a few minutes before trying again.',
      retryAfterSec: retrySec,
    });
  }

  const genericResponse = {
    message: 'If this email is eligible for registration, a 6-digit verification code has been sent.',
    resendCooldownSeconds: REG_OTP_RESEND_COOLDOWN_SECONDS,
    expiresInSeconds: REG_OTP_EXPIRY_MINUTES * 60,
  };

  try {
    getRegOtpSecret();

    // Anti-enumeration: do not reveal whether the email is already registered
    const [existingUsers] = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
      [email]
    );
    regOtpCooldownStore.set(email, nowMs);

    if (existingUsers.length > 0) {
      return res.json(genericResponse);
    }

    const conn = await pool.getConnection();
    let otpId = null;
    const rawOtp = String(crypto.randomInt(100000, 1000000));
    const otpHash = hmacRegValue('reg_otp', rawOtp);

    try {
      await conn.beginTransaction();

      const [activeRows] = await conn.query(
        `SELECT id, resend_available_at
         FROM registration_email_otps
         WHERE LOWER(email) = LOWER(?) AND consumed_at IS NULL AND resend_available_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [email]
      );
      if (activeRows.length > 0 && activeRows[0].resend_available_at) {
        const waitSec = Math.max(1, Math.ceil((new Date(activeRows[0].resend_available_at).getTime() - Date.now()) / 1000));
        await conn.rollback();
        res.setHeader('Retry-After', String(waitSec));
        return res.status(429).json({
          error: `Please wait ${waitSec} seconds before requesting another verification code.`,
          retryAfterSec: waitSec,
        });
      }

      // Supersede any prior unconsumed registration OTPs for this email (never touches password_reset_otps)
      await conn.query(
        `UPDATE registration_email_otps
         SET consumed_at = NOW()
         WHERE LOWER(email) = LOWER(?) AND consumed_at IS NULL`,
        [email]
      );

      const [insRows] = await conn.query(
        `INSERT INTO registration_email_otps
           (email, otp_hash, expires_at, attempts, max_attempts, last_sent_at, resend_available_at, request_ip)
         VALUES (?, ?, NOW() + INTERVAL '5 minutes', 0, ?, NOW(), NOW() + INTERVAL '60 seconds', ?)
         RETURNING id`,
        [email, otpHash, REG_OTP_MAX_ATTEMPTS, String(clientIp).slice(0, 45)]
      );
      otpId = (insRows && insRows[0] && insRows[0].id) || insRows.insertId || null;

      await conn.commit();
    } catch (txErr) {
      await conn.rollback().catch(() => {});
      throw txErr;
    } finally {
      conn.release();
    }

    const frontendUrl = resolveFrontendOrigin(req);
    try {
      await sendRegistrationOtpEmail({
        to: email,
        name: displayName,
        otp: rawOtp,
        expiresMinutes: REG_OTP_EXPIRY_MINUTES,
        frontendUrl,
      });
    } catch (emailErr) {
      if (otpId) {
        await pool.query('UPDATE registration_email_otps SET consumed_at = NOW() WHERE id = ?', [otpId]).catch(() => {});
      }
      regOtpCooldownStore.delete(email);
      console.error('[RegOTP] Registration OTP email delivery failed:', emailErr.message);
      return res.status(503).json({
        error: 'Unable to send registration verification email right now. Please try again later.',
      });
    }

    return res.json(genericResponse);
  } catch (err) {
    console.error('[RegOTP] requestRegistrationOtp failed:', err.message);
    return res.status(500).json({ error: 'Unable to process registration verification right now.' });
  }
}

/**
 * POST /api/register/verify-otp (and /api/auth/register/verify-otp)
 * Verifies the 6-digit registration OTP and returns a short-lived single-use emailVerificationToken.
 */
async function verifyRegistrationOtp(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const rawOtp = String((req.body && req.body.otp) || '').trim();
  const clientIp = (req && (req.ip || (req.connection && req.connection.remoteAddress))) || '0.0.0.0';

  const ipLimit = checkRegRateLimit(`reg-verify-ip:${clientIp}`, 15, REG_RATE_WINDOW_MS);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfterSec || 60));
    return res.status(429).json({
      error: 'Too many verification attempts. Please wait a few minutes and try again.',
    });
  }

  if (!/^\d{6}$/.test(rawOtp)) {
    return res.status(400).json({ error: 'Please enter a valid 6-digit verification code.' });
  }

  const conn = await pool.getConnection();
  try {
    getRegOtpSecret();
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, email, otp_hash, expires_at, attempts, max_attempts, verified_at, consumed_at
       FROM registration_email_otps
       WHERE LOWER(email) = LOWER(?)
         AND consumed_at IS NULL
         AND verified_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [email]
    );

    const record = rows[0];
    if (!record) {
      await conn.rollback();
      return res.status(400).json({ error: 'Verification code is invalid or has expired. Please request a new code.' });
    }

    if (new Date(record.expires_at).getTime() <= Date.now()) {
      await conn.query('UPDATE registration_email_otps SET consumed_at = NOW() WHERE id = ?', [record.id]);
      await conn.commit();
      return res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
    }

    const maxAttempts = Number(record.max_attempts || REG_OTP_MAX_ATTEMPTS);
    if (Number(record.attempts || 0) >= maxAttempts) {
      await conn.query('UPDATE registration_email_otps SET consumed_at = NOW() WHERE id = ?', [record.id]);
      await conn.commit();
      return res.status(429).json({
        error: 'Maximum verification attempts exceeded. Please request a new verification code.',
      });
    }

    const expectedHash = hmacRegValue('reg_otp', rawOtp);
    if (!timingSafeHexEqual(expectedHash, record.otp_hash)) {
      const nextAttempts = Number(record.attempts || 0) + 1;
      const lockedOut = nextAttempts >= maxAttempts;
      await conn.query(
        `UPDATE registration_email_otps
         SET attempts = ?,
             consumed_at = CASE WHEN ? THEN NOW() ELSE consumed_at END
         WHERE id = ?`,
        [nextAttempts, lockedOut, record.id]
      );
      await conn.commit();

      if (lockedOut) {
        return res.status(429).json({
          error: 'Maximum verification attempts (5) exceeded. Please request a new verification code.',
        });
      }
      const remaining = maxAttempts - nextAttempts;
      return res.status(400).json({
        error: `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      });
    }

    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hmacRegValue('reg_token', emailVerificationToken);

    await conn.query(
      `UPDATE registration_email_otps
       SET verified_at = NOW(),
           verification_token_hash = ?,
           verification_token_expires_at = NOW() + INTERVAL '30 minutes'
       WHERE id = ?`,
      [tokenHash, record.id]
    );
    await conn.commit();

    return res.json({
      verified: true,
      emailVerificationToken,
      expiresInSeconds: REG_TOKEN_EXPIRY_MINUTES * 60,
      message: 'Email verified. Please capture your identity photos and submit your registration application.',
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[RegOTP] verifyRegistrationOtp failed:', err.message);
    return res.status(500).json({ error: 'Unable to verify registration code right now. Please try again.' });
  } finally {
    conn.release();
  }
}

/**
 * Atomically verifies and consumes the single-use registration emailVerificationToken
 * inside the Resident registration DB transaction.
 */
async function consumeRegistrationEmailToken(conn, { email, emailVerificationToken }) {
  const rawToken = String(emailVerificationToken || '').trim();
  if (!rawToken || rawToken.length < 32) {
    const err = new Error('Please verify your email address with a 6-digit code before submitting registration.');
    err.statusCode = 400;
    throw err;
  }

  const tokenHash = hmacRegValue('reg_token', rawToken);
  const [rows] = await conn.query(
    `SELECT id, verified_at
     FROM registration_email_otps
     WHERE LOWER(email) = LOWER(?)
       AND verification_token_hash = ?
       AND verified_at IS NOT NULL
       AND consumed_at IS NULL
       AND verification_token_expires_at > NOW()
     LIMIT 1
     FOR UPDATE`,
    [String(email || '').trim().toLowerCase(), tokenHash]
  );

  if (!rows.length) {
    const err = new Error('Email verification has expired or is invalid. Please verify your email address again.');
    err.statusCode = 400;
    throw err;
  }

  await conn.query(
    `UPDATE registration_email_otps
     SET consumed_at = NOW()
     WHERE id = ?`,
    [rows[0].id]
  );

  return { verifiedAt: rows[0].verified_at };
}

module.exports = {
  requestRegistrationOtp,
  verifyRegistrationOtp,
  consumeRegistrationEmailToken,
  regOtpRateStore,
  regOtpCooldownStore,
};
