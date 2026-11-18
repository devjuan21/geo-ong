const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { ROLE_IDS } = require('../config/roles');
const { emitAlertBroadcast } = require('../services/socketService');

async function createAlert(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { title, message, targetScope } = req.body;
  const alertTitle = String(title || 'Emergency Alert').trim().slice(0, 150);
  const scope = String(targetScope || '').trim();
  const validScopes = ['Residents', 'Residents Only', 'Responders', 'Responders Only', 'Everyone', 'All Barangay Bayanan'];
  if (!validScopes.includes(scope)) {
    return res.status(400).json({ error: 'Valid targetScope is required (Residents, Responders, or Everyone).' });
  }

  const targetRoles =
    scope === 'Residents' || scope === 'Residents Only'
      ? [ROLE_IDS.RESIDENT]
      : scope === 'Responders' || scope === 'Responders Only'
        ? [ROLE_IDS.RESPONDER]
        : [ROLE_IDS.RESIDENT, ROLE_IDS.RESPONDER];

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      'INSERT INTO alerts (message, created_by) VALUES (?, ?)',
      [message, req.user.id]
    );

    const rolePlaceholders = targetRoles.map(() => '?').join(', ');
    const [activeUsers] = await connection.query(
      `SELECT id FROM users WHERE role_id IN (${rolePlaceholders}) AND status = 'active' AND LOWER(account_status) = 'active' AND id <> ?`,
      [...targetRoles, req.user.id]
    );

    // Record emergency broadcast audit trail
    await connection.query(
      `INSERT INTO emergency_broadcast_logs
         (title, message, target_scope, recipients_count, authorized_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        alertTitle,
        message,
        scope,
        activeUsers.length,
        req.user.id,
      ]
    );

    // Save notification for targeted active recipients only
    try {
      const [notifRes] = await connection.query(
        `INSERT INTO notifications (title, message, category, created_by)
         VALUES (?, ?, 'Alert', ?)`,
        [alertTitle, message, req.user.id]
      );
      if (notifRes.insertId && activeUsers.length > 0) {
        const placeholders = activeUsers.map(() => '(?, ?, ?)').join(', ');
        const params = activeUsers.flatMap((u) => [notifRes.insertId, u.id, false]);
        await connection.query(
          `INSERT IGNORE INTO notification_recipients (notification_id, user_id, is_read) VALUES ${placeholders}`,
          params
        );
      }
    } catch (notifErr) {
      console.warn('[Alerts API] Notification fan-out warning:', notifErr.message);
    }

    const [rows] = await connection.query(
      `SELECT a.id, a.message, a.created_by, a.created_at, u.name AS created_by_name
       FROM alerts a JOIN users u ON a.created_by = u.id WHERE a.id = ?`,
      [result.insertId]
    );

    await connection.commit();
    const alert = {
      ...rows[0],
      title: alertTitle,
      targetScope: scope,
      actorUserId: req.user.id,
    };
    emitAlertBroadcast(alert);
    return res.status(201).json({ message: 'Alert broadcast', alert });
  } catch (err) {
    await connection.rollback();
    console.error('[Alerts API] createAlert failed:', err.message);
    return res.status(503).json({ error: 'Failed to broadcast emergency alert' });
  } finally {
    connection.release();
  }
}

async function getAlerts(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.message, a.created_by, a.created_at, u.name AS created_by_name
       FROM alerts a JOIN users u ON a.created_by = u.id
       ORDER BY a.created_at DESC LIMIT 50`
    );
    return res.json({ alerts: rows });
  } catch (err) {
    console.error('[Alerts API] getAlerts failed:', err.message);
    return res.status(503).json({ error: 'Emergency alerts are temporarily unavailable' });
  }
}

module.exports = { createAlert, getAlerts };
