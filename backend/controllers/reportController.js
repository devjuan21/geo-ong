const fs = require('fs');
const path = require('path');
const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { emitNewReport, emitStatusUpdate } = require('../socket');
const { detectSeverity } = require('../utils/severityDetector');
const { calculateReportPriority, sortReportsByPriority } = require('../utils/prioritizer');

// Canonical incident storage: `reports` is the ONLY incident table written by the application.
// Allowed values mirror the reports.status / reports.severity ENUMs exactly.
const VALID_STATUSES = ['pending', 'verified', 'dispatched', 'responding', 'on_site', 'in_progress', 'resolved', 'false_alarm', 'dismissed'];
const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const ASSIGNMENT_PRIORITY = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

const REPORT_SELECT = `
  SELECT r.*, u.name AS reporter_name, resp.name AS responder_name
  FROM reports r
  JOIN users u ON r.user_id = u.id
  LEFT JOIN users resp ON r.assigned_to = resp.id`;

function dbUnavailable(res, err, action) {
  console.error(`[Reports API] ${action} failed:`, err.message);
  return res.status(503).json({ error: 'Incident database is unavailable. Please try again.' });
}

async function createReport(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMsg = errors.array().map((e) => e.msg).join('; ');
    return res.status(400).json({ error: errorMsg, errors: errors.array() });
  }

  const incident_type = (req.body.incident_type || req.body.incidentType || 'General Incident').trim();
  const title = (req.body.title || `${incident_type} Incident`).trim().substring(0, 180);
  const description = (req.body.description || '').trim();
  const address = (req.body.address || req.body.location || 'Barangay Bayanan, Muntinlupa City').trim().substring(0, 255);
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const is_public = req.body.authorizedForCommunity === false || req.body.is_public === 0 ? 0 : 1;

  const detection = detectSeverity(incident_type, description);
  let severity = 'medium';
  const requestedSeverity = String(req.body.severity || '').toLowerCase();
  if (VALID_SEVERITIES.includes(requestedSeverity)) {
    severity = requestedSeverity;
  } else if (requestedSeverity === 'moderate') {
    severity = 'medium';
  } else if (detection && detection.severity && VALID_SEVERITIES.includes(detection.severity)) {
    severity = detection.severity;
  }

  const conn = await pool.getConnection().catch((err) => { dbUnavailable(res, err, 'createReport'); return null; });
  if (!conn) return;

  try {
    await conn.beginTransaction();

    // Strict duplicate-submission protection: prevent rapid identical submissions (within 15 seconds)
    const [recentDuplicates] = await conn.query(
      `SELECT id, reference_number, incident_type, title, status, created_at
       FROM reports
       WHERE user_id = ? AND incident_type = ? AND title = ? AND description = ?
         AND created_at >= (NOW() - INTERVAL 15 SECOND)
       ORDER BY id DESC LIMIT 1`,
      [req.user.id, incident_type, title, description]
    );

    if (recentDuplicates.length > 0) {
      await conn.rollback();
      const existing = recentDuplicates[0];
      return res.status(200).json({
        message: 'Report has already been submitted.',
        id: existing.reference_number || `INC-${existing.id}`,
        referenceNumber: existing.reference_number || `INC-${existing.id}`,
        report: existing,
        duplicatePrevented: true,
      });
    }

    const [result] = await conn.query(
      `INSERT INTO reports (user_id, incident_type, title, description, latitude, longitude, address, severity, status, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [req.user.id, incident_type, title, description, latitude, longitude, address, severity, is_public]
    );

    // Ticket / reference number derived from the canonical primary key
    const referenceNumber = `INC-${new Date().getFullYear()}-${String(result.insertId).padStart(6, '0')}`;
    await conn.query('UPDATE reports SET reference_number = ? WHERE id = ?', [referenceNumber, result.insertId]);

    await conn.query(
      `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, remarks)
       VALUES (?, NULL, 'pending', ?, 'Incident submitted via Resident Portal')`,
      [result.insertId, req.user.id]
    );

    // Persist photo attachments if supplied
    const photos = Array.isArray(req.body.photos) ? req.body.photos : [];
    if (photos.length > 0) {
      const uploadDir = path.join(__dirname, '../../frontend/assets/uploads/incidents');
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
      } catch (e) {}

      for (let idx = 0; idx < photos.length; idx++) {
        const photo = photos[idx];
        if (typeof photo === 'string' && photo.startsWith('data:image/')) {
          const match = photo.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
          if (match) {
            const rawExt = match[1].toLowerCase();
            const ext = rawExt === 'jpeg' ? 'jpg' : (rawExt.includes('png') ? 'png' : 'jpg');
            const buffer = Buffer.from(match[2], 'base64');
            const fileName = `inc-${result.insertId}-${idx + 1}-${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, fileName);
            fs.writeFileSync(filePath, buffer);

            const fileUrl = `/assets/uploads/incidents/${fileName}`;
            const mimeType = `image/${rawExt}`;
            const fileSize = buffer.length;

            await conn.query(
              `INSERT INTO incident_attachments (incident_id, file_url, file_name, file_type, file_size, uploaded_by)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [result.insertId, fileUrl, fileName, mimeType, fileSize, req.user.id]
            );
          }
        }
      }
    }

    // Persist audit log entry for administrative oversight
    const ipAddress = (req.ip || (req.connection && req.connection.remoteAddress) || '127.0.0.1').substring(0, 45);
    const userAgent = (req.headers['user-agent'] || 'GeoSafe Resident Portal').substring(0, 255);
    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
       VALUES (?, 'INCIDENT_REPORT_SUBMITTED', 'report', ?, ?, ?, ?)`,
      [
        req.user.id,
        String(result.insertId),
        JSON.stringify({
          reference_number: referenceNumber,
          incident_type,
          title,
          severity,
          address,
          latitude,
          longitude,
        }),
        ipAddress,
        userAgent,
      ]
    );

    await conn.commit();

    const [rows] = await pool.query(`${REPORT_SELECT} WHERE r.id = ?`, [result.insertId]);
    const [attachments] = await pool.query(
      `SELECT id, file_url, file_name, file_type, file_size, created_at
       FROM incident_attachments
       WHERE incident_id = ?
       ORDER BY created_at ASC`,
      [result.insertId]
    );

    const report = calculateReportPriority(rows[0]);
    report.referenceNumber = referenceNumber;
    report.incidentType = incident_type;
    report.location = address;
    report.databaseId = result.insertId;
    report.rawId = result.insertId;
    report.id = referenceNumber; // Normalised string ID for UI compatibility
    report.attachments = attachments;

    emitNewReport(report);
    return res.status(201).json({
      message: 'Report submitted successfully',
      id: referenceNumber,
      referenceNumber,
      report,
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    return dbUnavailable(res, err, 'createReport');
  } finally {
    conn.release();
  }
}

async function getReports(req, res) {
  try {
    let query = REPORT_SELECT;
    const params = [];

    if (req.user.role === 'resident') {
      query += ' WHERE r.user_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'responder') {
      query += " WHERE (r.assigned_to = ? OR r.status NOT IN ('resolved', 'dismissed'))";
      params.push(req.user.id);
    }

    query += ' ORDER BY r.created_at DESC';

    const [rows] = await pool.query(query, params);
    return res.json({ reports: sortReportsByPriority(rows) });
  } catch (err) {
    return dbUnavailable(res, err, 'getReports');
  }
}

async function getReportById(req, res) {
  try {
    const [rows] = await pool.query(`${REPORT_SELECT} WHERE r.id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });

    const row = rows[0];
    if (req.user.role === 'resident' && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only view your own reports' });
    }
    return res.json({ report: calculateReportPriority(row) });
  } catch (err) {
    return dbUnavailable(res, err, 'getReportById');
  }
}

async function updateReportStatus(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const rawStatus = req.body.status;
  const status = rawStatus === 'dismissed' ? 'false_alarm' : rawStatus;
  const { severity, assigned_to } = req.body;
  const reportId = parseInt(req.params.id, 10);

  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (severity && !VALID_SEVERITIES.includes(severity)) {
    return res.status(400).json({ error: 'Invalid severity' });
  }

  const conn = await pool.getConnection().catch((err) => { dbUnavailable(res, err, 'updateReportStatus'); return null; });
  if (!conn) return;

  try {
    await conn.beginTransaction();

    const [existing] = await conn.query('SELECT * FROM reports WHERE id = ? FOR UPDATE', [reportId]);
    if (!existing.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Report not found' });
    }
    const current = existing[0];

    const updates = [];
    const params = [];

    if (status && status !== current.status) {
      updates.push('status = ?');
      params.push(status);
      if (status === 'verified') {
        updates.push('verified_by = ?', 'verified_at = NOW()');
        params.push(req.user.id);
      }
      if (status === 'resolved') {
        updates.push('resolved_at = NOW()');
      }
    }
    if (severity && req.user.role === 'admin' && severity !== current.severity) {
      updates.push('severity = ?');
      params.push(severity);
    }

    let newAssignee = null;
    if (assigned_to !== undefined && req.user.role === 'admin' && (assigned_to || null) !== current.assigned_to) {
      newAssignee = assigned_to || null;
      if (newAssignee) {
        const [responders] = await conn.query(
          'SELECT id FROM users WHERE id = ? AND role_id = 2', [newAssignee]
        );
        if (!responders.length) {
          await conn.rollback();
          return res.status(400).json({ error: 'assigned_to must be an existing Responder account' });
        }
      }
      updates.push('assigned_to = ?');
      params.push(newAssignee);
    }

    if (updates.length) {
      await conn.query(`UPDATE reports SET ${updates.join(', ')} WHERE id = ?`, [...params, reportId]);

      if (status && status !== current.status) {
        await conn.query(
          `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by)
           VALUES (?, ?, ?, ?)`,
          [reportId, current.status, status, req.user.id]
        );
      }

      if (newAssignee) {
        await conn.query(
          `INSERT INTO incident_assignments (report_id, responder_user_id, assigned_by, assignment_status)
           VALUES (?, ?, ?, 'Assigned')`,
          [reportId, newAssignee, req.user.id]
        );
      }
    }

    await conn.commit();

    const [rows] = await pool.query(`${REPORT_SELECT} WHERE r.id = ?`, [reportId]);
    const updated = calculateReportPriority(rows[0]);
    if (updates.length) emitStatusUpdate(updated);
    return res.json({ message: updates.length ? 'Report updated' : 'No changes', report: updated });
  } catch (err) {
    await conn.rollback().catch(() => {});
    return dbUnavailable(res, err, 'updateReportStatus');
  } finally {
    conn.release();
  }
}

module.exports = { createReport, getReports, getReportById, updateReportStatus };
