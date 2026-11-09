const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { emitAlertBroadcast } = require('../socket');

async function createAlert(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { message, severity } = req.body;
  const normalizedSeverity = (severity || 'medium').toLowerCase();
  const broadcastSeverityMap = {
    low: 'Advisory',
    medium: 'Watch',
    high: 'Warning',
    critical: 'Critical Evacuation',
  };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      'INSERT INTO alerts (message, severity, created_by) VALUES (?, ?, ?)',
      [message, normalizedSeverity, req.user.id]
    );

    // Record immutable emergency broadcast audit trail
    await connection.query(
      `INSERT INTO emergency_broadcast_logs
         (title, message, severity, target_scope, authorized_by)
       VALUES (?, ?, ?, 'All Barangay Bayanan', ?)`,
      [
        `Emergency Alert (${broadcastSeverityMap[normalizedSeverity] || 'Watch'})`,
        message,
        broadcastSeverityMap[normalizedSeverity] || 'Watch',
        req.user.id,
      ]
    );

    const [rows] = await connection.query(
      `SELECT a.*, u.name AS created_by_name
       FROM alerts a JOIN users u ON a.created_by = u.id WHERE a.id = ?`,
      [result.insertId]
    );

    await connection.commit();
    const alert = rows[0];
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
      `SELECT a.*, u.name AS created_by_name
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
