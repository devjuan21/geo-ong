const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { isValidRoleId, roleLabel } = require('../config/roles');
const { generateNextUserCode } = require('../services/userIdService');

async function getUsers(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.user_code, u.name, u.email, u.role_id, r.name AS role_name, u.status, u.created_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.role_id, u.name`
    );
    return res.json({
      users: rows.map((u) => ({
        ...u,
        userCode: u.user_code,
        role: roleLabel(u.role_id),
      })),
    });
  } catch (err) {
    console.error('[Users API] getUsers failed:', err.message);
    return res.status(503).json({ error: 'User directory is temporarily unavailable' });
  }
}

/**
 * Administrator-only account creation (POST /api/users).
 * role_id is REQUIRED and must be one of the three authorized roles; a missing or
 * invalid value is rejected - there is no default role, so no account can receive a
 * privileged (or any) role by accident.
 */
async function createUser(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, email, password, role_id } = req.body;
  if (!isValidRoleId(role_id)) {
    return res.status(400).json({ error: 'role_id must be 1 (Administrator), 2 (Responder) or 3 (Resident).' });
  }
  const roleId = parseInt(role_id, 10);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query('SELECT id FROM users WHERE email = ? FOR UPDATE', [email]);
    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'Email already registered' });
    }

    const { userCode } = await generateNextUserCode(connection, roleId);
    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await connection.query(
      `INSERT INTO users (user_code, name, email, password_hash, role_id, role, status, account_status)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 'active')`,
      [userCode, name, email, password_hash, roleId, roleLabel(roleId)]
    );

    await connection.commit();

    return res.status(201).json({
      message: 'Account created',
      user: {
        id: result.insertId,
        user_code: userCode,
        userCode,
        name,
        email,
        role_id: roleId,
        role: roleLabel(roleId),
      },
    });
  } catch (err) {
    await connection.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('[Users API] createUser failed:', err.message);
    return res.status(503).json({ error: 'Account creation is temporarily unavailable' });
  } finally {
    connection.release();
  }
}

/**
 * Administrator-only account status transition (PATCH/PUT /api/users/:id/status).
 * Uses soft deactivation/suspension ('active' | 'inactive' | 'suspended') instead of
 * physical account deletion so historical emergency, incident, family, and audit records
 * remain intact and attributable.
 */
async function updateUserStatus(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const targetUserId = parseInt(req.params.id, 10);
  const adminUserId = req.user.id;
  const rawStatus = req.body.status;
  const newStatus = rawStatus === 'inactive' ? 'deactivated' : rawStatus;
  const reason = typeof req.body.reason === 'string' && req.body.reason.trim()
    ? req.body.reason.trim().slice(0, 255)
    : 'Administrative status update';

  if (!['active', 'deactivated', 'suspended'].includes(newStatus)) {
    return res.status(400).json({ error: 'status must be active, deactivated, or suspended.' });
  }

  if (targetUserId === adminUserId && newStatus !== 'active') {
    return res.status(400).json({ error: 'Administrators cannot deactivate or suspend their own active account.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      'SELECT id, name, email, role_id, status FROM users WHERE id = ? FOR UPDATE',
      [targetUserId]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'User account not found.' });
    }

    const targetUser = rows[0];
    const previousStatus = targetUser.status;

    if (previousStatus !== newStatus) {
      await connection.query(
        'UPDATE users SET status = ?, account_status = ? WHERE id = ?',
        [newStatus, newStatus, targetUserId]
      );

      // Record immutable account status history
      await connection.query(
        `INSERT INTO account_status_history (user_id, previous_status, new_status, changed_by, reason)
         VALUES (?, ?, ?, ?, ?)`,
        [targetUserId, previousStatus, newStatus, adminUserId, reason]
      );

      // Record security event log
      const secEvent = newStatus === 'active' ? 'account_reactivated' : 'account_suspended';
      await connection.query(
        `INSERT INTO auth_security_logs (user_id, attempted_email, event_type, ip_address, user_agent, details)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          targetUserId,
          targetUser.email,
          secEvent,
          req.ip || '0.0.0.0',
          (req.headers['user-agent'] || '').slice(0, 255) || null,
          JSON.stringify({ previous_status: previousStatus, new_status: newStatus, changed_by: adminUserId, reason }).slice(0, 255),
        ]
      );

      // If deactivated or suspended, revoke any active location sharing consent
      if (newStatus !== 'active') {
        await connection.query(
          `UPDATE family_location_sharing_consents flc
           JOIN family_members fm ON fm.id = flc.family_member_id
           SET flc.sharing_enabled = 0, flc.revoked_at = COALESCE(flc.revoked_at, NOW())
           WHERE fm.user_id = ? AND flc.sharing_enabled = 1`,
          [targetUserId]
        );
      }
    }

    await connection.commit();
    return res.json({
      message: `Account status updated to ${newStatus}. Historical records are preserved.`,
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        role_id: targetUser.role_id,
        role: roleLabel(targetUser.role_id),
        previous_status: previousStatus,
        status: newStatus,
      },
    });
  } catch (err) {
    await connection.rollback();
    console.error('[Users API] updateUserStatus failed:', err.message);
    return res.status(503).json({ error: 'Unable to update account status.' });
  } finally {
    connection.release();
  }
}

/**
 * Safe handler for DELETE /api/users/:id.
 * Physical deletion of user accounts is prohibited to protect emergency, incident,
 * responder assignment, family membership, and security audit history.
 * Deactivates the account (status = 'inactive') instead of deleting the row.
 */
async function deactivateUserAccount(req, res) {
  req.body = {
    ...req.body,
    status: 'inactive',
    reason: (req.body && req.body.reason) || 'Account deactivated via administrative delete action (physical deletion prohibited)',
  };
  return updateUserStatus(req, res);
}

module.exports = { getUsers, createUser, updateUserStatus, deactivateUserAccount };
