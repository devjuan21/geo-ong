const fs = require('fs');
const path = require('path');
const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { ROLE_IDS } = require('../config/roles');
const { emitNewReport, emitPublicVerifiedReport, emitReportVerificationResult, emitStatusUpdate, emitIncidentResolved } = require('../services/socketService');
const { dispatchIncidentResolvedCommunityBroadcast } = require('../services/incidentResolutionService');
const { isPointInsideBayanan } = require('../utils/bayananBoundary');

// Canonical incident storage: `reports` is the ONLY incident table written by the application.
// Allowed values mirror the reports.status ENUM exactly.
const VALID_STATUSES = ['pending', 'verified', 'dispatched', 'responding', 'on_site', 'in_progress', 'resolved', 'false_alarm', 'dismissed'];
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const REPORT_SELECT = `
  SELECT r.*, u.name AS reporter_name, resp.name AS responder_name,
    COALESCE((SELECT h.remarks FROM incident_status_history h WHERE h.incident_id = r.id ORDER BY h.created_at DESC, h.id DESC LIMIT 1), '') AS latest_remarks
  FROM reports r
  JOIN users u ON r.user_id = u.id
  LEFT JOIN users resp ON r.assigned_to = resp.id`;

function dbUnavailable(res, err, action) {
  console.error(`[Reports API] ${action} failed:`, err.message);
  return res.status(503).json({ error: 'Incident database is unavailable. Please try again.' });
}

function parseBase64Image(dataUri) {
  if (typeof dataUri !== 'string' || !dataUri.startsWith('data:image/')) {
    return null;
  }
  const match = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { error: `Unsupported image MIME type: ${mimeType}. Allowed: image/jpeg, image/png, image/webp.` };
  }
  const extMap = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const ext = extMap[mimeType] || 'jpg';
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer || buffer.length === 0) {
    return null;
  }
  return {
    mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
    ext,
    buffer,
  };
}

async function createReport(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMsg = errors.array().map((e) => e.msg).join('; ');
    return res.status(400).json({ error: errorMsg, errors: errors.array() });
  }

  let incident_type = (req.body.incident_type || req.body.incidentType || '').trim();
  if (!incident_type) {
    return res.status(400).json({ error: 'Incident category is required.' });
  }
  let categoryId = null;
  try {
    const [catRows] = await pool.query(
      `SELECT id, name, is_active
       FROM incident_categories
       WHERE LOWER(name) = LOWER(?)
       ORDER BY is_active DESC, id ASC
       LIMIT 1`,
      [incident_type]
    );
    if (!catRows.length || !catRows[0].is_active) {
      return res.status(400).json({ error: 'Selected incident category is invalid or currently inactive.' });
    }
    categoryId = catRows[0].id;
    incident_type = catRows[0].name;
  } catch (catErr) {
    return dbUnavailable(res, catErr, 'validateIncidentCategory');
  }
  const title = (req.body.title || `${incident_type} Incident`).trim().substring(0, 180);
  const description = (req.body.description || '').trim();
  const address = (req.body.address || req.body.location || 'Barangay Bayanan, Muntinlupa City').trim().substring(0, 255);
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  // Newly submitted resident reports are never publicly visible until verified by an Administrator
  const is_public = 0;

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Valid geographic coordinates (latitude and longitude) are required.' });
  }

  if (!isPointInsideBayanan(latitude, longitude)) {
    return res.status(400).json({
      error: 'Submitted incident location is outside the official administrative boundary of Barangay Bayanan, Muntinlupa City.'
    });
  }

  // Validate Base64 photos before starting DB transaction
  const rawPhotos = Array.isArray(req.body.photos)
    ? req.body.photos
    : req.body.photo
    ? [req.body.photo]
    : [];
  const parsedPhotos = [];
  for (const item of rawPhotos) {
    if (!item) continue;
    const parsed = parseBase64Image(item);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid Base64 image format.' });
    }
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    parsedPhotos.push(parsed);
  }

  if (parsedPhotos.length === 0) {
    return res.status(400).json({
      error: 'Photo evidence is required. Please take a photo of the incident before submitting your report.',
    });
  }

  const conn = await pool.getConnection().catch((err) => { dbUnavailable(res, err, 'createReport'); return null; });
  if (!conn) return;

  const writtenFilePaths = [];
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
      `INSERT INTO reports (user_id, category_id, incident_type, title, description, latitude, longitude, address, status, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [req.user.id, categoryId, incident_type, title, description, latitude, longitude, address, is_public]
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
    if (parsedPhotos.length > 0) {
      const uploadDir = path.join(__dirname, '../../frontend/assets/uploads/incidents');
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
      } catch (e) {}

      for (let idx = 0; idx < parsedPhotos.length; idx++) {
        const { mimeType, ext, buffer } = parsedPhotos[idx];
        const fileName = `inc-${result.insertId}-${idx + 1}-${Date.now()}.${ext}`;
        const filePath = path.join(uploadDir, fileName);
        fs.writeFileSync(filePath, buffer);
        writtenFilePaths.push(filePath);

        const fileUrl = `/assets/uploads/incidents/${fileName}`;
        const fileSize = buffer.length;

        await conn.query(
          `INSERT INTO incident_attachments (incident_id, file_url, file_name, file_type, file_size, uploaded_by, evidence_type)
           VALUES (?, ?, ?, ?, ?, ?, 'resident_report')`,
          [result.insertId, fileUrl, fileName, mimeType, fileSize, req.user.id]
        );
      }
    }

    // Create notification for Administrators
    try {
      const [notifRes] = await conn.query(
        `INSERT INTO notifications (title, message, category, related_entity_type, related_entity_id, action_url, created_by)
         VALUES (?, ?, 'Alert', 'report', ?, ?, ?)`,
        [
          `New Incident Report: ${referenceNumber}`,
          `${incident_type} reported at ${address} • Status: Pending`,
          result.insertId,
          `/responder-assignments.html?id=${encodeURIComponent(referenceNumber)}`,
          req.user.id,
        ]
      );
      const [recipients] = await conn.query(
        "SELECT id FROM users WHERE role_id IN (?, ?) AND status = 'active'",
        [ROLE_IDS.ADMINISTRATOR, ROLE_IDS.RESPONDER]
      );
      for (const recipient of recipients) {
        await conn.query(
          'INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?)',
          [notifRes.insertId, recipient.id]
        );
      }
    } catch (notifErr) {
      console.warn('[Reports API] Could not persist admin notification:', notifErr.message);
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

    const report = {
      ...rows[0],
      referenceNumber,
      incidentType: incident_type,
      location: address,
      databaseId: result.insertId,
      rawId: result.insertId,
      id: referenceNumber, // Normalised string ID for UI compatibility
      attachments,
      photos: attachments.map((a) => a.file_url),
    };

    emitNewReport(report);

    return res.status(201).json({
      message: 'Report submitted successfully',
      id: referenceNumber,
      referenceNumber,
      report,
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    for (const fp of writtenFilePaths) {
      try {
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch (_) {}
    }
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
      query += ' WHERE r.user_id = ? AND r.source_rescue_id IS NULL';
      params.push(req.user.id);
    } else if (req.user.role === 'responder') {
      query += " WHERE r.source_rescue_id IS NULL AND r.status NOT IN ('resolved', 'false_alarm', 'dismissed') AND (r.assigned_to = ? OR (r.assigned_to IS NULL AND r.status IN ('pending', 'verified')))";
      params.push(req.user.id);
    }

    query += ' ORDER BY r.created_at DESC';

    const [rows] = await pool.query(query, params);
    return res.json({ reports: rows });
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
    const [attachments] = await pool.query(
      `SELECT ia.id, ia.file_url, ia.file_name, ia.file_type, ia.file_size, ia.evidence_type, ia.assignment_id, ia.uploaded_by, ia.created_at,
              u.name AS uploaded_by_name
       FROM incident_attachments ia
       LEFT JOIN users u ON u.id = ia.uploaded_by
       WHERE ia.incident_id = ?
       ORDER BY ia.created_at ASC`,
      [row.id]
    );
    const residentEvidence = attachments.filter((a) => !a.evidence_type || a.evidence_type === 'resident_report');
    const responderCompletionEvidence = attachments.filter((a) => a.evidence_type === 'responder_completion');
    return res.json({
      report: {
        ...row,
        attachments,
        residentEvidence,
        responderCompletionEvidence,
        photos: residentEvidence.map((a) => a.file_url),
      },
    });
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
  const { assigned_to } = req.body;
  const trimmedReason = typeof (req.body.reason ?? req.body.remarks) === 'string'
    ? String(req.body.reason ?? req.body.remarks).trim()
    : '';
  const reportId = parseInt(req.params.id, 10);

  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  // Only Administrators may verify, reject, or reset reports to pending
  if (status && ['pending', 'verified', 'false_alarm', 'dismissed'].includes(status) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only Administrators can verify or reject incident reports.' });
  }

  if (status === 'false_alarm' && !trimmedReason) {
    return res.status(400).json({ error: 'A rejection reason is required when rejecting a report.' });
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
        updates.push('is_public = 1', 'verified_by = ?', 'verified_at = NOW()');
        params.push(req.user.id);
      } else if (['pending', 'false_alarm', 'dismissed'].includes(status)) {
        updates.push('is_public = 0');
      }
      if (status === 'resolved') {
        updates.push('resolved_at = NOW()');
      }
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
          `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, remarks)
           VALUES (?, ?, ?, ?, ?)`,
          [reportId, current.status, status, req.user.id, trimmedReason || null]
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
    const updated = {
      ...rows[0],
      recordType: 'incident',
      residentId: rows[0].user_id,
    };
    if (updates.length) {
      if (status === 'resolved' && current.status !== 'resolved') {
        emitIncidentResolved({
          id: reportId,
          referenceNumber: updated.reference_number || `INC-${reportId}`,
          residentId: rows[0].user_id,
          assignedTo: rows[0].assigned_to || null,
          reason: trimmedReason,
        });
        dispatchIncidentResolvedCommunityBroadcast({
          incidentId: reportId,
          referenceNumber: updated.reference_number || `INC-${reportId}`,
          incidentCategory: rows[0].incident_type,
          verifiedLocation: rows[0].address || rows[0].location,
          resolvedAt: rows[0].resolved_at,
          actorUserId: req.user.id,
        });
      } else if (status === 'verified' || status === 'false_alarm') {
        emitReportVerificationResult({
          id: reportId,
          referenceNumber: updated.reference_number || `INC-${reportId}`,
          status,
          decision: status === 'false_alarm' ? 'rejected' : 'verified',
          reason: trimmedReason,
          residentId: rows[0].user_id,
        });
      } else {
        emitStatusUpdate(updated);
      }
      if (status === 'verified' && current.status !== 'verified') {
        emitPublicVerifiedReport(updated);
      }
    }
    return res.json({ message: updates.length ? 'Report updated' : 'No changes', report: updated });
  } catch (err) {
    await conn.rollback().catch(() => {});
    return dbUnavailable(res, err, 'updateReportStatus');
  } finally {
    conn.release();
  }
}

module.exports = { createReport, getReports, getReportById, updateReportStatus };
