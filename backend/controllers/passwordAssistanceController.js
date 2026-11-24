const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { disconnectUserSockets, emitAdminPasswordAssistanceEvent } = require('../services/socketService');

const paRateStore = new Map();
const PA_RATE_WINDOW_MS = 15 * 60 * 1000;
const PA_RATE_MAX_IP = 8;
const PA_RATE_MAX_EMAIL = 4;

function checkTicketRateLimit(key, maxRequests = PA_RATE_MAX_IP, windowMs = PA_RATE_WINDOW_MS) {
  const now = Date.now();
  const bucket = paRateStore.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    paRateStore.set(key, { windowStart: now, count: 1 });
    return { allowed: true };
  }
  if (bucket.count >= maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  bucket.count += 1;
  return { allowed: true };
}

/**
 * Generates a cryptographically secure random temporary password (14 chars).
 * Guaranteed to include uppercase, lowercase, numeric, and symbol characters.
 */
function generateSecureTemporaryPassword(length = 14) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_';
  const all = upper + lower + digits + symbols;

  const chars = [
    upper[crypto.randomInt(0, upper.length)],
    lower[crypto.randomInt(0, lower.length)],
    digits[crypto.randomInt(0, digits.length)],
    symbols[crypto.randomInt(0, symbols.length)],
  ];
  while (chars.length < length) {
    chars.push(all[crypto.randomInt(0, all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * POST /api/auth/password-assistance (public)
 * Submits a Password Assistance Request ticket for Administrator review.
 * Never reveals whether an email corresponds to an existing account.
 */
async function submitPasswordAssistanceTicket(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const fullName = String(req.body?.fullName || req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const accountRole = String(req.body?.accountRole || req.body?.role || '').trim().toLowerCase();
  const description = String(req.body?.description || '').trim();
  const clientIp = String(req.ip || req.connection?.remoteAddress || '0.0.0.0').slice(0, 45);

  if (fullName.length < 2 || fullName.length > 120) {
    return res.status(400).json({ error: 'Full name is required (2 to 120 characters).' });
  }
  if (!['resident', 'responder'].includes(accountRole)) {
    return res.status(400).json({ error: 'Account role must be Resident or Responder.' });
  }
  if (description.length < 10 || description.length > 1000) {
    return res.status(400).json({ error: 'Please describe your issue (10 to 1000 characters).' });
  }

  const ipLimit = checkTicketRateLimit(`pa-ip:${clientIp}`, PA_RATE_MAX_IP);
  const emailLimit = checkTicketRateLimit(`pa-email:${email}`, PA_RATE_MAX_EMAIL);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    const retrySec = Math.max(ipLimit.retryAfterSec || 0, emailLimit.retryAfterSec || 0, 60);
    res.setHeader('Retry-After', String(retrySec));
    return res.status(429).json({
      error: 'Too many password assistance requests. Please wait a few minutes before trying again.',
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Internally link user_id if an account exists (never exposed in public response)
    const [matchedUsers] = await conn.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
      [email]
    );
    const matchedUserId = matchedUsers.length ? matchedUsers[0].id : null;

    const [seqRows] = await conn.query("SELECT nextval('password_assistance_ticket_seq') AS seq_val");
    const seqVal = Number(seqRows[0]?.seq_val || Date.now());
    const year = new Date().getFullYear();
    const ticketReference = `PAT-${year}-${String(seqVal).padStart(6, '0')}`;

    const [insRows] = await conn.query(
      `INSERT INTO password_assistance_tickets
         (ticket_reference, user_id, submitted_name, submitted_email, account_role, description, status, request_ip)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
       RETURNING id, created_at`,
      [ticketReference, matchedUserId, fullName, email, accountRole, description, clientIp]
    );
    const ticketId = (insRows && insRows[0] && insRows[0].id) || insRows.insertId || null;

    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
       VALUES (?, 'PASSWORD_ASSISTANCE_REQUESTED', 'PASSWORD_ASSISTANCE', ?, ?, ?, ?)`,
      [
        matchedUserId,
        String(ticketId || ticketReference),
        JSON.stringify({
          ticket_reference: ticketReference,
          account_role: accountRole,
          status: 'pending',
        }),
        clientIp,
        req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null,
      ]
    );

    await conn.commit();

    emitAdminPasswordAssistanceEvent('password-assistance-submitted', {
      ticketId,
      ticketReference,
      status: 'pending',
    });

    return res.status(201).json({
      ticketReference,
      status: 'pending',
      message: 'Password assistance request submitted. An Administrator will review your identity and request.',
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[PasswordAssistance] submit failed:', err.message);
    return res.status(500).json({ error: 'Unable to submit password assistance request right now.' });
  } finally {
    conn.release();
  }
}

/**
 * GET /api/admin/password-assistance
 * Admin-only list of password assistance tickets + matched account metadata (no passwords).
 */
async function getPasswordAssistanceTickets(req, res) {
  try {
    const rawStatus = String(req.query.status || 'pending').trim().toLowerCase();
    const search = String(req.query.search || '').trim();
    const allowedStatuses = new Set(['pending', 'in_review', 'approved', 'rejected', 'resolved', 'all']);
    if (!allowedStatuses.has(rawStatus)) {
      return res.status(400).json({ error: 'Invalid ticket status filter.' });
    }

    const params = [];
    const whereClauses = [];
    if (rawStatus !== 'all') {
      whereClauses.push('t.status = ?');
      params.push(rawStatus);
    }
    if (search) {
      const likeTerm = `%${search}%`;
      whereClauses.push('(t.ticket_reference ILIKE ? OR t.submitted_name ILIKE ? OR t.submitted_email ILIKE ?)');
      params.push(likeTerm, likeTerm, likeTerm);
    }
    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT t.id, t.ticket_reference, t.user_id, t.submitted_name, t.submitted_email,
              t.account_role, t.description, t.status, t.reviewed_by, t.reviewed_at,
              t.decision_reason, t.password_reset_at, t.created_at, t.updated_at,
              reviewer.name AS reviewed_by_name,
              u.id AS matched_user_id, u.user_code AS matched_user_code, u.name AS matched_user_name,
              u.email AS matched_user_email, u.role AS matched_user_role, u.account_status AS matched_account_status
         FROM password_assistance_tickets t
         LEFT JOIN users reviewer ON reviewer.id = t.reviewed_by
         LEFT JOIN users u ON u.id = COALESCE(t.user_id, (SELECT u2.id FROM users u2 WHERE LOWER(u2.email) = LOWER(t.submitted_email) LIMIT 1))
         ${whereSql}
         ORDER BY CASE
                    WHEN t.status = 'pending' THEN 0
                    WHEN t.status = 'in_review' THEN 1
                    WHEN t.status = 'approved' THEN 2
                    ELSE 3
                  END,
                  t.created_at DESC, t.id DESC
         LIMIT 200`,
      params
    );

    const [countRows] = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
         COUNT(*) FILTER (WHERE status = 'in_review') AS in_review_count,
         COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
         COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count,
         COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
         COUNT(*) AS total_count
       FROM password_assistance_tickets`
    );

    const c = countRows[0] || {};
    return res.json({
      tickets: rows.map((r) => ({
        id: r.id,
        ticketReference: r.ticket_reference,
        submittedName: r.submitted_name,
        submittedEmail: r.submitted_email,
        accountRole: r.account_role,
        description: r.description,
        status: r.status,
        reviewedByName: r.reviewed_by_name || null,
        reviewedAt: r.reviewed_at || null,
        decisionReason: r.decision_reason || null,
        passwordResetAt: r.password_reset_at || null,
        createdAt: r.created_at,
        matchedAccount: r.matched_user_id
          ? {
              id: r.matched_user_id,
              userCode: r.matched_user_code,
              name: r.matched_user_name,
              email: r.matched_user_email,
              role: r.matched_user_role,
              accountStatus: r.matched_account_status,
            }
          : null,
      })),
      counts: {
        pending: Number(c.pending_count || 0),
        in_review: Number(c.in_review_count || 0),
        approved: Number(c.approved_count || 0),
        rejected: Number(c.rejected_count || 0),
        resolved: Number(c.resolved_count || 0),
        total: Number(c.total_count || 0),
      },
    });
  } catch (err) {
    console.error('[Admin] getPasswordAssistanceTickets error:', err);
    return res.status(500).json({ error: 'Failed to load password assistance tickets.' });
  }
}

/**
 * POST /api/admin/password-assistance/:id/review
 * Marks a pending ticket as 'in_review'.
 */
async function markTicketInReview(req, res) {
  const ticketId = Number(req.params.id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: 'Invalid ticket ID.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT id, ticket_reference, status FROM password_assistance_tickets WHERE id = ? FOR UPDATE',
      [ticketId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Password assistance ticket not found.' });
    }
    if (rows[0].status !== 'pending') {
      await conn.rollback();
      return res.status(409).json({ error: `Ticket is already ${rows[0].status}.` });
    }

    await conn.query(
      `UPDATE password_assistance_tickets
          SET status = 'in_review', reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [req.user.id, ticketId]
    );

    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
       VALUES (?, 'PASSWORD_ASSISTANCE_IN_REVIEW', 'PASSWORD_ASSISTANCE', ?, ?, ?, ?)`,
      [
        req.user.id,
        String(ticketId),
        JSON.stringify({ ticket_reference: rows[0].ticket_reference, status: 'in_review' }),
        String(req.ip || '0.0.0.0').slice(0, 45),
        req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null,
      ]
    );

    await conn.commit();
    emitAdminPasswordAssistanceEvent('password-assistance-updated', { ticketId, status: 'in_review' });
    return res.json({ message: 'Ticket marked as In Review.', ticketId, status: 'in_review' });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Admin] markTicketInReview error:', err.message);
    return res.status(500).json({ error: 'Failed to update ticket status.' });
  } finally {
    conn.release();
  }
}

/**
 * POST /api/admin/password-assistance/:id/approve
 * Approves a pending/in_review ticket after explicit identity verification confirmation,
 * generates a CSPRNG temporary password, hashes with bcrypt, sets must_change_password=TRUE,
 * invalidates active sockets, resolves the ticket, and returns the temporary password ONCE.
 */
async function approvePasswordAssistanceTicket(req, res) {
  const ticketId = Number(req.params.id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: 'Invalid ticket ID.' });
  }

  if (req.body?.identityVerified !== true) {
    return res.status(400).json({ error: 'Explicit confirmation of identity verification is required before approving.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [ticketRows] = await conn.query(
      'SELECT * FROM password_assistance_tickets WHERE id = ? FOR UPDATE',
      [ticketId]
    );
    if (!ticketRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Password assistance ticket not found.' });
    }

    const ticket = ticketRows[0];
    if (!['pending', 'in_review', 'approved'].includes(ticket.status)) {
      await conn.rollback();
      return res.status(409).json({ error: `This ticket has already been finalized (${ticket.status}).` });
    }

    const [userRows] = await conn.query(
      `SELECT id, user_code, name, email, role_id, role, status, account_status
         FROM users
        WHERE id = ? OR LOWER(email) = LOWER(?)
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
        LIMIT 1
        FOR UPDATE`,
      [ticket.user_id || -1, ticket.submitted_email, ticket.user_id || -1]
    );
    if (!userRows.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'No matching GeoSafe account was found for the submitted email.' });
    }

    const targetUser = userRows[0];
    if (targetUser.status !== 'active' || (targetUser.account_status && targetUser.account_status !== 'active')) {
      await conn.rollback();
      return res.status(400).json({
        error: `Matched account (${targetUser.user_code}) is ${targetUser.account_status || targetUser.status} and cannot receive a password reset.`,
      });
    }

    const temporaryPassword = generateSecureTemporaryPassword(14);
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    await conn.query(
      `UPDATE users
          SET password_hash = ?,
              must_change_password = TRUE,
              reset_token_hash = NULL,
              reset_token_expires = NULL,
              password_changed_at = NOW(),
              updated_at = NOW()
        WHERE id = ?`,
      [passwordHash, targetUser.id]
    );

    await conn.query(
      `UPDATE password_assistance_tickets
          SET user_id = ?,
              status = 'resolved',
              reviewed_by = ?,
              reviewed_at = NOW(),
              decision_reason = 'Identity verified; temporary password issued by Administrator',
              password_reset_at = NOW(),
              updated_at = NOW()
        WHERE id = ?`,
      [targetUser.id, req.user.id, ticketId]
    );

    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
       VALUES (?, 'PASSWORD_ASSISTANCE_RESET_ISSUED', 'PASSWORD_ASSISTANCE', ?, ?, ?, ?)`,
      [
        req.user.id,
        String(ticketId),
        JSON.stringify({
          ticket_reference: ticket.ticket_reference,
          target_user_id: targetUser.id,
          target_user_code: targetUser.user_code,
          must_change_password: true,
          sessions_invalidated: true,
        }),
        String(req.ip || '0.0.0.0').slice(0, 45),
        req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null,
      ]
    );

    await conn.commit();

    await disconnectUserSockets(targetUser.id).catch(() => {});
    emitAdminPasswordAssistanceEvent('password-assistance-updated', {
      ticketId,
      ticketReference: ticket.ticket_reference,
      status: 'resolved',
    });

    // Returned ONCE in this authenticated Admin response; never stored or logged in plaintext
    return res.json({
      message: 'Identity confirmed and temporary password generated. Communicate this temporary password through a verified offline or in-person channel.',
      ticketId,
      ticketReference: ticket.ticket_reference,
      status: 'resolved',
      targetUserCode: targetUser.user_code,
      targetEmail: targetUser.email,
      temporaryPassword,
      mustChangePassword: true,
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Admin] approvePasswordAssistanceTicket error:', err.message);
    return res.status(500).json({ error: 'Failed to approve password assistance request.' });
  } finally {
    conn.release();
  }
}

/**
 * POST /api/admin/password-assistance/:id/reject
 * Rejects a pending or in_review ticket with a required reason.
 */
async function rejectPasswordAssistanceTicket(req, res) {
  const ticketId = Number(req.params.id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: 'Invalid ticket ID.' });
  }

  const rawReason = String(req.body?.reason || '').trim();
  if (!rawReason || rawReason.length < 5) {
    return res.status(400).json({ error: 'A rejection reason of at least 5 characters is required.' });
  }
  const cleanReason = rawReason.slice(0, 500);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT id, ticket_reference, status FROM password_assistance_tickets WHERE id = ? FOR UPDATE',
      [ticketId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Password assistance ticket not found.' });
    }
    if (!['pending', 'in_review'].includes(rows[0].status)) {
      await conn.rollback();
      return res.status(409).json({ error: `This ticket has already been finalized (${rows[0].status}).` });
    }

    await conn.query(
      `UPDATE password_assistance_tickets
          SET status = 'rejected',
              reviewed_by = ?,
              reviewed_at = NOW(),
              decision_reason = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [req.user.id, cleanReason, ticketId]
    );

    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
       VALUES (?, 'PASSWORD_ASSISTANCE_REJECTED', 'PASSWORD_ASSISTANCE', ?, ?, ?, ?)`,
      [
        req.user.id,
        String(ticketId),
        JSON.stringify({
          ticket_reference: rows[0].ticket_reference,
          status: 'rejected',
          reason: cleanReason,
        }),
        String(req.ip || '0.0.0.0').slice(0, 45),
        req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null,
      ]
    );

    await conn.commit();
    emitAdminPasswordAssistanceEvent('password-assistance-updated', {
      ticketId,
      ticketReference: rows[0].ticket_reference,
      status: 'rejected',
    });

    return res.json({
      message: 'Password assistance ticket rejected.',
      ticketId,
      ticketReference: rows[0].ticket_reference,
      status: 'rejected',
      decisionReason: cleanReason,
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Admin] rejectPasswordAssistanceTicket error:', err.message);
    return res.status(500).json({ error: 'Failed to reject password assistance ticket.' });
  } finally {
    conn.release();
  }
}

module.exports = {
  submitPasswordAssistanceTicket,
  getPasswordAssistanceTickets,
  markTicketInReview,
  approvePasswordAssistanceTicket,
  rejectPasswordAssistanceTicket,
};
