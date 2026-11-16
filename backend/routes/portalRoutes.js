const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const {
  emitNewRescueRequest,
  emitStatusUpdate,
  emitAssignmentUpdate,
  emitIncidentResolved,
} = require('../services/socketService');
const { getArrivalConfig, computeHaversineMeters } = require('../config/arrivalConfig');
const { getEocLocation } = require('../config/eocConfig');

const router = express.Router();

const ALLOWED_IMAGE_MIME_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB

function parseAndSaveBase64Photo(rawPhoto, subDir, prefix) {
  if (!rawPhoto) return null;
  const dataUrl = typeof rawPhoto === 'string' ? rawPhoto.trim() : String(rawPhoto.dataUrl || rawPhoto.url || '').trim();
  if (!dataUrl) return null;

  if (dataUrl.startsWith('/assets/uploads/')) {
    return {
      fileName: path.basename(dataUrl),
      publicUrl: dataUrl,
      mimeType: 'image/jpeg',
      byteLength: 0,
    };
  }

  const match = dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    const err = new Error('Invalid photo format. Expected a Base64 data URL (image/jpeg, image/png, or image/webp).');
    err.statusCode = 400;
    throw err;
  }

  const mimeType = match[1].toLowerCase().trim();
  const ext = ALLOWED_IMAGE_MIME_TYPES[mimeType];
  if (!ext) {
    const err = new Error(`Unsupported photo MIME type "${mimeType}". Allowed: image/jpeg, image/png, image/webp.`);
    err.statusCode = 400;
    throw err;
  }

  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) {
    const err = new Error('Photo size must be between 1 byte and 10MB.');
    err.statusCode = 400;
    throw err;
  }

  const uploadDir = path.join(__dirname, '..', '..', 'frontend', 'assets', 'uploads', subDir);
  fs.mkdirSync(uploadDir, { recursive: true });
  const fileName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const fullPath = path.join(uploadDir, fileName);
  fs.writeFileSync(fullPath, buffer);

  return {
    fileName,
    publicUrl: `/assets/uploads/${subDir}/${fileName}`,
    mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
    byteLength: buffer.length,
  };
}

/**
 * Builds SQL IN (?, ?, ...) placeholders and flat parameters for non-empty ID lists.
 * Returns null when no valid IDs exist so callers skip the query instead of emitting IN ().
 */
function buildInClause(ids) {
  const validIds = Array.isArray(ids)
    ? ids.filter((id) => id !== null && id !== undefined)
    : [];
  if (validIds.length === 0) return null;
  return {
    placeholders: validIds.map(() => '?').join(', '),
    params: validIds,
  };
}

async function createNotificationForUsers(conn, { title, message, category = 'Alert', createdBy = null, userIds = [] }) {
  const uniqueIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniqueIds.length) return null;

  const validCat = ['Alert', 'Dispatch', 'General'].includes(category) ? category : 'Alert';

  const [notifRes] = await conn.query(
    `INSERT INTO notifications (title, message, category, created_by)
     VALUES (?, ?, ?, ?)`,
    [String(title).slice(0, 150), String(message), validCat, createdBy]
  );

  if (notifRes.insertId && uniqueIds.length > 0) {
    const placeholders = uniqueIds.map(() => '(?, ?, ?)').join(', ');
    const params = uniqueIds.flatMap((uid) => [notifRes.insertId, uid, false]);
    await conn.query(
      `INSERT IGNORE INTO notification_recipients (notification_id, user_id, is_read) VALUES ${placeholders}`,
      params
    );
  }
  return notifRes.insertId;
}

async function getActiveAdminIds(conn) {
  const [rows] = await conn.query(
    `SELECT u.id
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE (u.role = 'admin' OR r.name = 'Administrator')
       AND LOWER(u.account_status) = 'active'`
  );
  return rows.map((r) => r.id);
}

// Every portal route requires authentication
router.use(authenticate);

function formatReportForPortal(r, photos = [], timeline = []) {
  const statusMap = {
    pending: 'Pending Verification',
    verified: 'Verified',
    dispatched: 'Assigned',
    responding: 'Responding',
    on_site: 'On Scene',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    false_alarm: 'Rejected',
    dismissed: 'Rejected',
  };
  return {
    id: r.reference_number || `REP-${r.id}`,
    dbId: r.id,
    referenceNumber: r.reference_number || `REP-${r.id}`,
    incidentType: r.incident_type,
    title: r.title || `${r.incident_type} Report`,
    description: r.description,
    location: r.address || 'Barangay Bayanan, Muntinlupa City',
    coordinates: {
      lat: Number(r.latitude),
      lng: Number(r.longitude),
    },
    submittedAt: r.created_at,
    status: statusMap[r.status] || 'Pending Verification',
    photos,
    timeline,
  };
}

function formatRescueForPortal(r, updates = [], photos = []) {
  return {
    id: r.reference_number || `RES-${r.id}`,
    dbId: r.id,
    referenceNumber: r.reference_number || `RES-${r.id}`,
    emergencyType: r.emergency_type,
    description: r.description,
    peopleCount: r.people_count || 1,
    vulnerableDetails: r.vulnerable_details || 'None specified',
    location: r.address || 'Barangay Bayanan, Muntinlupa City',
    landmark: r.landmark || '',
    coordinates: {
      lat: Number(r.latitude),
      lng: Number(r.longitude),
    },
    status: r.status || 'Pending Dispatch',
    requestDate: r.created_at,
    submittedAt: r.created_at,
    photos,
    updates,
  };
}

// ----------------------------------------------------------------------------
// 1. RESIDENT DASHBOARD SUMMARY & PUBLIC REPORTS
// ----------------------------------------------------------------------------
router.get('/dashboard/summary', requireRole('resident', 'admin'), async (req, res) => {
  try {
    const [reportRows] = await pool.query(
      'SELECT * FROM reports WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    const reports = reportRows.map((r) => formatReportForPortal(r));

    const counts = {
      total: reports.length,
      pending: reports.filter((r) => r.status === 'Pending Verification').length,
      verified: reports.filter((r) => ['Verified', 'Assigned', 'Responding', 'On Scene', 'In Progress'].includes(r.status)).length,
      resolved: reports.filter((r) => r.status === 'Resolved').length,
    };

    const [alertRows] = await pool.query(
      'SELECT * FROM alerts ORDER BY created_at DESC LIMIT 3'
    );
    const latestAlerts = alertRows.map((a) => ({
      id: `ALT-${a.id}`,
      title: a.title || 'Emergency Advisory',
      description: a.message,
      publishedAt: a.created_at,
      affectedAreas: ['Barangay Bayanan'],
    }));

    const [rescueRows] = await pool.query(
      `SELECT * FROM rescue_requests
       WHERE user_id = ? AND status NOT IN ('Completed', 'Cancelled')
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    const activeRescue = rescueRows[0] ? formatRescueForPortal(rescueRows[0]) : null;

    const [profRows] = await pool.query(
      'SELECT * FROM user_profiles WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    const p = profRows[0] || {};
    const nameParts = String(req.user.name || '').trim().split(/\s+/);
    const resident = {
      id: req.user.id,
      firstName: p.first_name || nameParts[0] || 'Resident',
      lastName: p.last_name || nameParts.slice(1).join(' ') || '',
      email: req.user.email,
      phone: p.phone_number || '',
      address: {
        street: p.street_address || '',
        barangay: 'Barangay Bayanan',
        city: 'Muntinlupa City',
      },
      verificationStatus: p.verification_status || 'Unverified Resident',
    };

    let contactRows = [];
    try {
      const [rows] = await pool.query(
        'SELECT * FROM emergency_contacts WHERE is_active = 1 ORDER BY display_order ASC, agency_name ASC'
      );
      contactRows = rows;
    } catch {
      contactRows = [];
    }

    return res.json({
      counts,
      recentReports: reports.slice(0, 3),
      latestAlerts,
      activeRescue,
      resident,
      emergencyContacts: contactRows,
    });
  } catch (err) {
    console.error('[Portal API] /dashboard/summary failed:', err.message);
    return res.status(503).json({ error: 'Unable to load dashboard summary' });
  }
});

router.get('/reports/public', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, reference_number, incident_type, title, description, latitude, longitude, address, status, created_at FROM reports WHERE is_public = 1 AND status IN ('verified', 'dispatched', 'responding', 'on_site', 'in_progress') ORDER BY created_at DESC LIMIT 50"
    );
    return res.json(rows.map((r) => formatReportForPortal(r)));
  } catch (err) {
    console.error('[Portal API] /reports/public failed:', err.message);
    return res.status(503).json({ error: 'Unable to load public incident reports' });
  }
});

// ----------------------------------------------------------------------------
// 2. RESIDENT PROFILE & SETTINGS
// ----------------------------------------------------------------------------
router.get('/profile', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM user_profiles WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    const p = rows[0] || {};
    const nameParts = String(req.user.name || '').trim().split(/\s+/);

    return res.json({
      id: req.user.id,
      userId: req.user.user_code || req.user.userCode || `RSDNT-${String(req.user.id).padStart(4, '0')}`,
      userCode: req.user.user_code || req.user.userCode || `RSDNT-${String(req.user.id).padStart(4, '0')}`,
      role: req.user.role === 'admin' ? 'Administrator' : req.user.role === 'responder' ? 'Responder' : 'Resident',
      firstName: p.first_name || nameParts[0] || '',
      lastName: p.last_name || nameParts.slice(1).join(' ') || '',
      email: req.user.email,
      phone: p.phone_number || '',
      address: {
        street: p.street_address || '',
        barangay: 'Barangay Bayanan',
        city: 'Muntinlupa City',
        province: 'Metro Manila',
        postalCode: p.postal_code || '1772',
      },
      verificationStatus: p.verification_status || 'Unverified Resident',
      barangayIdNumber: p.barangay_id_number || 'Pending Setup',
      emergencyContact: {
        name: p.emergency_contact_name || '',
        relationship: p.emergency_contact_relationship || '',
        phone: p.emergency_contact_phone || '',
      },
      medicalNotes: p.medical_notes || '',
    });
  } catch (err) {
    console.error('[Portal API] GET /profile failed:', err.message);
    return res.status(503).json({ error: 'Unable to load profile' });
  }
});

router.put('/profile', async (req, res) => {
  const {
    firstName,
    lastName,
    phone,
    address,
    emergencyContact,
    medicalNotes,
  } = req.body || {};

  const fName = String(firstName || '').trim().slice(0, 80) || 'Resident';
  const lName = String(lastName || '').trim().slice(0, 80) || '';
  const fullName = `${fName} ${lName}`.trim();
  const street = address && address.street ? String(address.street).trim().slice(0, 255) : null;
  const postalCode = address && address.postalCode ? String(address.postalCode).trim().slice(0, 20) : '1772';
  const emName = emergencyContact && emergencyContact.name ? String(emergencyContact.name).trim().slice(0, 120) : null;
  const emRel = emergencyContact && emergencyContact.relationship ? String(emergencyContact.relationship).trim().slice(0, 60) : null;
  const emPhone = emergencyContact && emergencyContact.phone ? String(emergencyContact.phone).trim().slice(0, 30) : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query('UPDATE users SET name = ? WHERE id = ?', [fullName, req.user.id]);

    await conn.query(
      `INSERT INTO user_profiles
         (user_id, first_name, last_name, phone_number, street_address, barangay, city, province, postal_code,
          emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, medical_notes)
       VALUES (?, ?, ?, ?, ?, 'Barangay Bayanan', 'Muntinlupa City', 'Metro Manila', ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         first_name = VALUES(first_name),
         last_name = VALUES(last_name),
         phone_number = VALUES(phone_number),
         street_address = VALUES(street_address),
         barangay = 'Barangay Bayanan',
         city = 'Muntinlupa City',
         province = 'Metro Manila',
         postal_code = VALUES(postal_code),
         emergency_contact_name = VALUES(emergency_contact_name),
         emergency_contact_relationship = VALUES(emergency_contact_relationship),
         emergency_contact_phone = VALUES(emergency_contact_phone),
         medical_notes = VALUES(medical_notes)`,
      [
        req.user.id,
        fName,
        lName,
        phone ? String(phone).trim().slice(0, 30) : null,
        street,
        postalCode,
        emName,
        emRel,
        emPhone,
        medicalNotes ? String(medicalNotes).trim() : null,
      ]
    );

    await conn.commit();
    return res.json({
      id: req.user.id,
      firstName: fName,
      lastName: lName,
      email: req.user.email,
      phone: phone || '',
      address: {
        street: street || '',
        barangay: 'Barangay Bayanan',
        city: 'Muntinlupa City',
        province: 'Metro Manila',
        postalCode,
      },
      emergencyContact: {
        name: emName || '',
        relationship: emRel || '',
        phone: emPhone || '',
      },
      medicalNotes: medicalNotes || '',
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Portal API] PUT /profile failed:', err.message);
    return res.status(503).json({ error: 'Unable to update profile' });
  } finally {
    conn.release();
  }
});

// ----------------------------------------------------------------------------
// 3. RESCUE REQUESTS
// ----------------------------------------------------------------------------
router.get('/rescue-requests', async (req, res) => {
  try {
    let query = 'SELECT * FROM rescue_requests';
    const params = [];
    if (req.user.role === 'resident') {
      query += ' WHERE user_id = ?';
      params.push(req.user.id);
    }
    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(query, params);

    const photosByRescue = new Map();
    const updatesByRescue = new Map();
    if (rows.length > 0) {
      const inClause = buildInClause(rows.map((r) => r.id));
      if (inClause) {
        try {
          const [attRows] = await pool.query(
            `SELECT rescue_id, file_url FROM rescue_attachments WHERE rescue_id IN (${inClause.placeholders}) ORDER BY created_at ASC`,
            inClause.params
          );
          for (const a of attRows) {
            if (!photosByRescue.has(a.rescue_id)) photosByRescue.set(a.rescue_id, []);
            photosByRescue.get(a.rescue_id).push(a.file_url);
          }
        } catch {
          // Ignore if table empty
        }

        try {
          const [histRows] = await pool.query(
            `SELECT h.rescue_id, h.new_status AS status, h.work_notes AS note, h.created_at AS timestamp, u.name AS author
             FROM rescue_status_history h
             LEFT JOIN users u ON h.changed_by = u.id
             WHERE h.rescue_id IN (${inClause.placeholders})
             ORDER BY h.created_at ASC`,
            inClause.params
          );
          for (const h of histRows) {
            if (!updatesByRescue.has(h.rescue_id)) updatesByRescue.set(h.rescue_id, []);
            updatesByRescue.get(h.rescue_id).push({
              status: h.status,
              note: h.note || '',
              author: h.author || 'Command Center',
              timestamp: h.timestamp,
            });
          }
        } catch {
          // Ignore
        }
      }
    }

    return res.json(
      rows.map((r) =>
        formatRescueForPortal(r, updatesByRescue.get(r.id) || [], photosByRescue.get(r.id) || [])
      )
    );
  } catch (err) {
    console.error('[Portal API] GET /rescue-requests failed:', err.message);
    return res.status(503).json({ error: 'Unable to load rescue requests' });
  }
});

router.get('/rescue-requests/:id', async (req, res) => {
  try {
    const paramId = req.params.id;
    const [rows] = await pool.query(
      'SELECT * FROM rescue_requests WHERE reference_number = ? OR id = ? LIMIT 1',
      [paramId, /^\d+$/.test(paramId) ? parseInt(paramId, 10) : -1]
    );
    if (!rows.length) return res.status(404).json({ error: 'Rescue request not found' });
    const row = rows[0];
    if (req.user.role === 'resident' && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let photos = [];
    let updates = [];
    try {
      const [attRows] = await pool.query(
        'SELECT file_url FROM rescue_attachments WHERE rescue_id = ? ORDER BY created_at ASC',
        [row.id]
      );
      photos = attRows.map((a) => a.file_url);
    } catch {
      photos = [];
    }

    try {
      const [histRows] = await pool.query(
        `SELECT h.new_status AS status, h.work_notes AS note, h.created_at AS timestamp, u.name AS author
         FROM rescue_status_history h
         LEFT JOIN users u ON h.changed_by = u.id
         WHERE h.rescue_id = ?
         ORDER BY h.created_at ASC`,
        [row.id]
      );
      updates = histRows.map((h) => ({
        status: h.status,
        note: h.note || '',
        author: h.author || 'Command Center',
        timestamp: h.timestamp,
      }));
    } catch {
      updates = [];
    }

    return res.json(formatRescueForPortal(row, updates, photos));
  } catch (err) {
    console.error('[Portal API] GET /rescue-requests/:id failed:', err.message);
    return res.status(503).json({ error: 'Unable to load rescue request' });
  }
});

router.post('/rescue-requests', requireRole('resident', 'admin'), async (req, res) => {
  const {
    emergencyType,
    description,
    peopleCount,
    peopleTrapped,
    patientCount,
    assistanceCount,
    vulnerableDetails,
    location,
    landmark,
    coordinates,
    priority,
    photo,
    photos,
  } = req.body || {};

  const emergencyLabel = String(emergencyType || '').trim().slice(0, 100);
  if (!emergencyLabel) {
    return res.status(400).json({ error: 'Emergency condition is required.' });
  }

  const parsePositiveWhole = (val) => {
    if (val === undefined || val === null || val === '') return undefined;
    const num = Number(val);
    if (!Number.isInteger(num) || num < 1 || num > 50) return NaN;
    return num;
  };

  const lowerType = emergencyLabel.toLowerCase();
  const isMedical = lowerType.includes('medical');
  const isVulnerability = lowerType.includes('vulnerability') || lowerType.includes('bedridden') || lowerType.includes('senior') || lowerType.includes('infant');

  let validatedCount;
  let storedVulnerableDetails = vulnerableDetails ? String(vulnerableDetails).trim() : '';

  if (isMedical) {
    const rawPatient = patientCount !== undefined ? patientCount : peopleCount;
    validatedCount = parsePositiveWhole(rawPatient);
    if (validatedCount === undefined || Number.isNaN(validatedCount)) {
      return res.status(400).json({ error: 'Number of patients needing evacuation must be a positive whole number (1-50).' });
    }
    const prefix = `Patients Needing Evacuation: ${validatedCount}`;
    storedVulnerableDetails = storedVulnerableDetails ? `${prefix} | ${storedVulnerableDetails}` : prefix;
  } else if (isVulnerability) {
    const rawAssist = assistanceCount !== undefined ? assistanceCount : peopleCount;
    validatedCount = parsePositiveWhole(rawAssist);
    if (validatedCount === undefined || Number.isNaN(validatedCount)) {
      return res.status(400).json({ error: 'Number of individuals needing assistance must be a positive whole number (1-50).' });
    }
    const prefix = `Individuals Needing Assistance: ${validatedCount}`;
    storedVulnerableDetails = storedVulnerableDetails ? `${prefix} | ${storedVulnerableDetails}` : prefix;
  } else {
    const rawTrapped = peopleTrapped !== undefined ? peopleTrapped : peopleCount;
    validatedCount = parsePositiveWhole(rawTrapped);
    if (validatedCount === undefined || Number.isNaN(validatedCount)) {
      return res.status(400).json({ error: 'Number of people trapped must be a positive whole number (1-50).' });
    }
  }

  const rawLat =
    coordinates && coordinates.lat !== undefined && coordinates.lat !== null && coordinates.lat !== ''
      ? coordinates.lat
      : req.body && req.body.latitude !== undefined && req.body.latitude !== null && req.body.latitude !== ''
      ? req.body.latitude
      : null;
  const rawLng =
    coordinates && coordinates.lng !== undefined && coordinates.lng !== null && coordinates.lng !== ''
      ? coordinates.lng
      : req.body && req.body.longitude !== undefined && req.body.longitude !== null && req.body.longitude !== ''
      ? req.body.longitude
      : null;

  if (rawLat === null || rawLng === null) {
    return res.status(400).json({ error: 'Valid latitude and longitude coordinates are required.' });
  }

  const lat = Number(rawLat);
  const lng = Number(rawLng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Valid numeric latitude and longitude coordinates are required.' });
  }
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    return res.status(400).json({ error: 'Invalid or swapped latitude/longitude coordinates.' });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) {
    return res.status(400).json({ error: 'Valid latitude and longitude coordinates are required.' });
  }

  const rawAccuracy = req.body && req.body.gpsAccuracy !== undefined && req.body.gpsAccuracy !== null
    ? Number(req.body.gpsAccuracy)
    : null;
  const gpsAccuracy = Number.isFinite(rawAccuracy) && rawAccuracy >= 0 ? Math.round(rawAccuracy) : null;
  const locationSource = req.body && req.body.locationSource === 'gps' ? 'gps' : 'manual';
  const rawCapturedAt = req.body && req.body.locationCapturedAt ? new Date(req.body.locationCapturedAt) : null;
  const locationCapturedAt =
    rawCapturedAt && !Number.isNaN(rawCapturedAt.getTime()) ? rawCapturedAt.toISOString() : null;

  const { isPointInsideBayanan } = require('../utils/bayananBoundary');
  if (!isPointInsideBayanan(lat, lng)) {
    return res.status(400).json({
      error: 'Rescue location is outside the official administrative boundary of Barangay Bayanan, Muntinlupa City.'
    });
  }

  const prio = 'Medium';

  // Validate and parse any Base64 evidence photos upfront before starting DB transaction
  const rawPhotoList = [];
  if (Array.isArray(photos)) {
    rawPhotoList.push(...photos);
  }
  if (photo && !rawPhotoList.includes(photo)) {
    rawPhotoList.push(photo);
  }

  const savedPhotos = [];
  try {
    for (let i = 0; i < Math.min(rawPhotoList.length, 5); i++) {
      const parsed = parseAndSaveBase64Photo(rawPhotoList[i], 'rescues', `RES-${req.user.id}-${i}`);
      if (parsed) savedPhotos.push(parsed);
    }
  } catch (photoErr) {
    return res.status(photoErr.statusCode || 400).json({ error: photoErr.message });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Strict duplicate-submission protection: prevent rapid identical rescue requests (within 15 seconds)
    const [recentDups] = await conn.query(
      `SELECT id, reference_number FROM rescue_requests
       WHERE user_id = ? AND emergency_type = ? AND description = ?
         AND created_at >= (NOW() - INTERVAL 15 SECOND)
       ORDER BY id DESC LIMIT 1`,
      [req.user.id, String(emergencyType || 'Flood Evacuation').slice(0, 100), String(description || 'Immediate rescue requested')]
    );
    if (recentDups.length > 0) {
      await conn.rollback();
      const existing = recentDups[0];
      return res.status(200).json({
        message: 'Rescue request has already been received.',
        id: existing.reference_number || `RES-${existing.id}`,
        referenceNumber: existing.reference_number || `RES-${existing.id}`,
        duplicatePrevented: true,
      });
    }

    const tempRef = `RES-TMP-${Date.now()}`;
    const descText = String(description || 'Immediate rescue requested');
    const addrText = String(location || 'Barangay Bayanan, Muntinlupa City').slice(0, 255);

    const [result] = await conn.query(
      `INSERT INTO rescue_requests
         (reference_number, user_id, emergency_type, description, people_count, vulnerable_details,
          latitude, longitude, address, landmark, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Dispatch')`,
      [
        tempRef,
        req.user.id,
        emergencyLabel,
        descText,
        validatedCount,
        storedVulnerableDetails ? storedVulnerableDetails.slice(0, 255) : null,
        lat,
        lng,
        addrText,
        landmark ? String(landmark).slice(0, 180) : null,
        prio,
      ]
    );

    const refNum = `RES-${new Date().getFullYear()}-${String(result.insertId).padStart(6, '0')}`;
    await conn.query('UPDATE rescue_requests SET reference_number = ? WHERE id = ?', [refNum, result.insertId]);

    const provenanceParts = [`source:${locationSource}`];
    if (gpsAccuracy !== null) provenanceParts.push(`accuracy:${gpsAccuracy}m`);
    if (locationCapturedAt) provenanceParts.push(`captured:${locationCapturedAt}`);
    const initialHistoryNote = `Emergency rescue request submitted by resident [${provenanceParts.join(' | ')}]`;

    await conn.query(
      `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes)
       VALUES (?, NULL, 'Pending Dispatch', ?, ?)`,
      [result.insertId, req.user.id, initialHistoryNote]
    );

    for (const sp of savedPhotos) {
      await conn.query(
        `INSERT INTO rescue_attachments
           (rescue_id, file_url, file_name, file_type, file_size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [result.insertId, sp.publicUrl, sp.fileName, sp.mimeType, sp.byteLength, req.user.id]
      );
    }

    // Notify all active Administrators
    try {
      const adminIds = await getActiveAdminIds(conn);
      await createNotificationForUsers(conn, {
        title: `Emergency Rescue Request: ${refNum}`,
        message: `${emergencyLabel} rescue requested at ${addrText} (${Math.max(1, parseInt(peopleCount, 10) || 1)} person/s).`,
        category: 'Alert',
        createdBy: req.user.id,
        userIds: adminIds,
      });
    } catch (notifErr) {
      console.warn('[Portal API] Admin notification warning on rescue request:', notifErr.message);
    }

    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM rescue_requests WHERE id = ?', [result.insertId]);
    const formatted = formatRescueForPortal(
      rows[0],
      [
        {
          status: 'Pending Dispatch',
          note: initialHistoryNote,
          author: req.user.name || 'Resident',
          timestamp: rows[0].created_at,
        },
      ],
      savedPhotos.map((sp) => sp.publicUrl)
    );
    formatted.gpsAccuracy = gpsAccuracy;
    formatted.locationSource = locationSource;
    formatted.locationCapturedAt = locationCapturedAt;

    emitNewRescueRequest({
      ...formatted,
      latitude: Number(rows[0].latitude),
      longitude: Number(rows[0].longitude),
      residentId: req.user.id,
      residentName: req.user.name || 'Resident',
    });

    return res.status(201).json(formatted);
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Portal API] POST /rescue-requests failed:', err.message);
    return res.status(503).json({ error: 'Unable to submit rescue request' });
  } finally {
    conn.release();
  }
});

// ----------------------------------------------------------------------------
// 4. NOTIFICATIONS, HAZARD ALERTS, ROUTES & FACILITIES
// ----------------------------------------------------------------------------
router.get('/notifications', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT n.id, n.title, n.message AS description, n.category, n.advisory_type, n.created_at AS timestamp,
              nr.is_read
       FROM notification_recipients nr
       JOIN notifications n ON n.id = nr.notification_id
       WHERE nr.user_id = ?
       ORDER BY n.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    const list = rows.map((r) => ({
      id: String(r.id),
      title: r.title,
      description: r.description,
      category: String(r.category || 'alert').toLowerCase(),
      advisoryType: r.advisory_type || null,
      timestamp: r.timestamp,
      read: Boolean(r.is_read),
    }));
    if (req.query.filter === 'Unread') {
      return res.json(list.filter((n) => !n.read));
    }
    return res.json(list);
  } catch (err) {
    console.error('[Portal API] GET /notifications failed:', err.message);
    return res.status(503).json({ error: 'Unable to load notifications' });
  }
});

router.patch('/notifications/:id/read', async (req, res) => {
  try {
    await pool.query(
      'UPDATE notification_recipients SET is_read = TRUE, read_at = CURRENT_TIMESTAMP WHERE notification_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(503).json({ error: 'Unable to update notification' });
  }
});

router.post('/notifications/mark-all-read', async (req, res) => {
  try {
    await pool.query(
      'UPDATE notification_recipients SET is_read = TRUE, read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(503).json({ error: 'Unable to mark notifications read' });
  }
});

router.get('/broadcast-categories', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, slug, badge_color, priority, description
       FROM broadcast_categories
       WHERE is_active = TRUE
       ORDER BY priority ASC, name ASC`
    );
    return res.json({ categories: rows });
  } catch (err) {
    console.error('[Portal API] GET /broadcast-categories failed:', err.message);
    return res.status(503).json({ error: 'Unable to load broadcast categories' });
  }
});

router.get('/hazard-alerts', async (req, res) => {
  try {
    const { defaultColorForName } = require('../config/advisoryCategories');
    const isResident = String(req.user && req.user.role || '').toLowerCase() === 'resident';
    const includeInactive = String(req.query.includeArchived || '').toLowerCase() === 'true';
    const [broadcastRows] = await pool.query(
      `SELECT ebl.id, ebl.title, ebl.message, ebl.category_id, ebl.advisory_type, ebl.severity,
              ebl.target_scope, ebl.target_zones, ebl.broadcasted_at, ebl.expires_at, ebl.is_active,
              bc.name AS category_name, bc.badge_color AS category_color, bc.priority AS category_priority,
              u.name AS author_name, u.email AS author_email,
              up.first_name AS author_first_name, up.last_name AS author_last_name
       FROM emergency_broadcast_logs ebl
       LEFT JOIN broadcast_categories bc ON ebl.category_id = bc.id
       LEFT JOIN users u ON ebl.authorized_by = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE 1=1
         ${includeInactive ? '' : 'AND ebl.is_active = TRUE'}
         ${isResident ? "AND ebl.target_scope <> 'Responders Only'" : ''}
       ORDER BY ebl.broadcasted_at DESC
       LIMIT 100`
    );
    const [alertRows] = await pool.query(
      `SELECT a.*, u.name AS author_name, u.email AS author_email
       FROM alerts a
       LEFT JOIN users u ON a.created_by = u.id
       ORDER BY a.created_at DESC LIMIT 50`
    );

    const broadcastCombinedMessages = new Set(
      broadcastRows.map((b) => `${b.title}: ${b.message}`)
    );

    const mappedBroadcasts = broadcastRows.map((b) => {
      const categoryName = b.category_name || b.advisory_type || 'Other';
      const badgeColor = b.category_color || defaultColorForName(categoryName);
      const priority = Number(b.category_priority || 5);
      const zoneList = b.target_zones
        ? String(b.target_zones).split(/[,;/]+/).map((z) => z.trim()).filter(Boolean)
        : [];
      const affectedLocation = zoneList.length > 0
        ? `${b.target_scope} (${zoneList.join(', ')})`
        : (b.target_scope || 'Barangay Bayanan');
      const author = [b.author_first_name, b.author_last_name].filter(Boolean).join(' ')
        || b.author_name
        || b.author_email
        || 'BDRRMC Barangay Bayanan';
      const isExpired = Boolean(b.expires_at && new Date(b.expires_at).getTime() < Date.now());
      const status = !b.is_active ? 'Archived' : (isExpired ? 'Expired' : 'Active');
      return {
        id: `BRD-${String(b.id).padStart(4, '0')}`,
        title: b.title,
        description: b.message,
        categoryId: b.category_id || null,
        categoryName,
        advisoryType: categoryName,
        category: categoryName,
        badgeColor,
        priority,
        isEmergency: priority <= 2,
        severity: b.severity || 'medium',
        publishedAt: b.broadcasted_at,
        expiresAt: b.expires_at || null,
        targetScope: b.target_scope || 'All Barangay Bayanan',
        targetZones: b.target_zones || '',
        affectedAreas: zoneList.length > 0 ? zoneList : [b.target_scope || 'Barangay Bayanan'],
        affectedLocation,
        issuingAuthority: author,
        status,
      };
    });

    const mappedAlerts = alertRows
      .filter((a) => !broadcastCombinedMessages.has(String(a.message || '')))
      .map((a) => ({
        id: `ALT-${a.id}`,
        title: a.title || 'Barangay Bayanan Advisory',
        description: a.message,
        categoryId: null,
        categoryName: 'Other',
        advisoryType: 'Other',
        category: 'Other',
        badgeColor: 'gray',
        priority: 5,
        isEmergency: false,
        severity: a.severity || 'low',
        publishedAt: a.created_at,
        expiresAt: null,
        targetScope: 'All Barangay Bayanan',
        targetZones: '',
        affectedAreas: ['Barangay Bayanan'],
        affectedLocation: 'Barangay Bayanan',
        issuingAuthority: a.author_name || a.author_email || 'BDRRMC Barangay Bayanan',
        status: 'Active',
      }));

    const combined = [...mappedBroadcasts, ...mappedAlerts].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
    return res.json(combined.slice(0, 100));
  } catch (err) {
    console.error('[Portal API] GET /hazard-alerts failed:', err.message);
    return res.status(503).json({ error: 'Unable to load hazard alerts' });
  }
});

router.get('/evacuation-routes', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM evacuation_routes ORDER BY is_official_approved DESC, route_name ASC'
    );
    const normalized = rows.map((r) => {
      let pathCoordinates = [];
      const rawGeo = r.path_coordinates || r.encoded_geometry;
      if (Array.isArray(rawGeo)) {
        pathCoordinates = rawGeo;
      } else if (typeof rawGeo === 'string' && rawGeo.trim()) {
        try {
          pathCoordinates = JSON.parse(rawGeo);
        } catch {
          pathCoordinates = [];
        }
      }
      if (!Array.isArray(pathCoordinates) || pathCoordinates.length === 0) {
        if (r.origin_latitude && r.origin_longitude) {
          pathCoordinates = [[Number(r.origin_latitude), Number(r.origin_longitude)]];
        }
      }

      const distanceKm =
        r.estimated_distance_km !== undefined && r.estimated_distance_km !== null
          ? Number(r.estimated_distance_km)
          : r.distance_meters !== undefined && r.distance_meters !== null
          ? Number((Number(r.distance_meters) / 1000).toFixed(2))
          : 0;

      const estimatedMinutes =
        r.estimated_walk_minutes !== undefined && r.estimated_walk_minutes !== null
          ? Number(r.estimated_walk_minutes)
          : r.estimated_duration_seconds !== undefined && r.estimated_duration_seconds !== null
          ? Math.max(1, Math.round(Number(r.estimated_duration_seconds) / 60))
          : 10;

      return {
        ...r,
        id: r.id,
        name: r.route_name || r.name || 'Evacuation Route',
        description: r.route_description || r.description || '',
        distanceKm,
        estimatedMinutes,
        pathCoordinates,
        isPrimary: Boolean(r.is_official_approved),
      };
    });
    return res.json(normalized);
  } catch (err) {
    console.error('[Portal API] GET /evacuation-routes failed:', err.message);
    return res.status(503).json({ error: 'Unable to load evacuation routes' });
  }
});

router.get('/emergency-facilities', async (req, res) => {
  try {
    const [hospitalRows] = await pool.query('SELECT * FROM hospitals ORDER BY name ASC');
    const [evacRows] = await pool.query('SELECT * FROM evacuation_centers ORDER BY name ASC');

    const { isPointInsideBayanan, isExcludedEvacuationCenter } = require('../utils/bayananBoundary');
    const facilities = [
      ...hospitalRows.map((h) => ({
        ...h,
        id: `HOSP-${h.id}`,
        dbId: h.id,
        name: h.name,
        type: h.facility_type || h.hospital_type || 'Hospital',
        category: 'Hospital',
        address: h.address || 'Muntinlupa City',
        phone: h.contact_phone || h.emergency_hotline || h.contact_number || '',
        latitude: Number(h.latitude),
        longitude: Number(h.longitude),
        coordinates: {
          lat: Number(h.latitude),
          lng: Number(h.longitude),
        },
        is_operational: 1,
        isOperational: true,
      })),
      ...evacRows
        .filter((e) => !isExcludedEvacuationCenter(e) && (String(e.barangay || '').toLowerCase().includes('bayanan') || isPointInsideBayanan(e.latitude, e.longitude)))
        .map((e) => ({
        ...e,
        id: `EVAC-${e.id}`,
        dbId: e.id,
        name: e.name,
        type: 'Evacuation Center',
        category: 'Evacuation Center',
        address: e.address || 'Barangay Bayanan, Muntinlupa City',
        phone: e.contact_phone || e.contact_number || '',
        latitude: Number(e.latitude),
        longitude: Number(e.longitude),
        coordinates: {
          lat: Number(e.latitude),
          lng: Number(e.longitude),
        },
        is_operational: e.status === 'Full / Closed' ? 0 : 1,
        isOperational: e.status !== 'Full / Closed',
      })),
    ];

    return res.json(facilities);
  } catch (err) {
    console.error('[Portal API] GET /emergency-facilities failed:', err.message);
    return res.status(503).json({ error: 'Unable to load emergency facilities' });
  }
});

router.get('/emergency-contacts', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM emergency_contacts WHERE is_active = 1 ORDER BY display_order ASC');
    return res.json(rows);
  } catch (err) {
    return res.json([]);
  }
});

// ----------------------------------------------------------------------------
// 5. RESPONDER PORTAL ENDPOINTS (STRICT RBAC: responder or admin ONLY)
// ----------------------------------------------------------------------------
router.get('/responder/profile', requireRole('responder', 'admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM responder_profiles WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    const r = rows[0] || {};
    const parts = String(req.user.name || '').trim().split(/\s+/);
    return res.json({
      id: req.user.id,
      userId: req.user.user_code || req.user.userCode || `RSPDR-${String(req.user.id).padStart(4, '0')}`,
      userCode: req.user.user_code || req.user.userCode || `RSPDR-${String(req.user.id).padStart(4, '0')}`,
      firstName: parts[0] || 'Responder',
      lastName: parts.slice(1).join(' ') || '',
      email: req.user.email,
      role: req.user.role === 'admin' ? 'Administrator' : 'Responder',
      badgeNumber: r.badge_number || `RESP-${req.user.id}`,
      callsign: r.callsign || `BAYANAN-${req.user.id}`,
      assignedUnit: r.assigned_unit || 'Barangay Bayanan Field Unit',
      department: r.department || 'Barangay Bayanan Emergency Operations',
      specialization: r.specialization || '',
      availability: r.availability_status || 'Off Duty',
      skills: r.specialization ? [r.specialization] : [],
      currentLocation:
        r.current_latitude && r.current_longitude
          ? { lat: Number(r.current_latitude), lng: Number(r.current_longitude) }
          : null,
    });
  } catch (err) {
    console.error('[Portal API] GET /responder/profile failed:', err.message);
    return res.status(503).json({ error: 'Unable to load responder profile' });
  }
});

router.patch('/responder/availability', requireRole('responder', 'admin'), async (req, res) => {
  const { status } = req.body || {};
  const validStatuses = ['On Duty', 'Off Duty', 'Unavailable'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid availability status' });
  }
  try {
    await pool.query(
      `INSERT INTO responder_profiles (user_id, badge_number, assigned_unit, department, availability_status)
       VALUES (?, ?, 'Barangay Bayanan Field Unit', 'Barangay Bayanan Emergency Operations', ?)
       ON DUPLICATE KEY UPDATE availability_status = VALUES(availability_status)`,
      [req.user.id, `RESP-${req.user.id}`, status]
    );
    return res.json({ status, updated: true });
  } catch (err) {
    console.error('[Portal API] PATCH /responder/availability failed:', err.message);
    return res.status(503).json({ error: 'Unable to update responder availability' });
  }
});

async function loadResponderAssignmentsForUser(userId, isAdmin = false) {
  const [reportRows] = await pool.query(
    isAdmin
      ? `SELECT r.*, u.name AS reporter_name, up.phone_number AS reporter_phone
         FROM reports r
         LEFT JOIN users u ON r.user_id = u.id
         LEFT JOIN user_profiles up ON r.user_id = up.user_id
         WHERE r.status NOT IN ('resolved', 'false_alarm', 'dismissed') AND (r.assigned_to = ? OR r.assigned_to IS NOT NULL)
         ORDER BY r.created_at DESC`
      : `SELECT r.*, u.name AS reporter_name, up.phone_number AS reporter_phone
         FROM reports r
         LEFT JOIN users u ON r.user_id = u.id
         LEFT JOIN user_profiles up ON r.user_id = up.user_id
         WHERE r.status NOT IN ('resolved', 'false_alarm', 'dismissed') AND r.assigned_to = ?
         ORDER BY r.created_at DESC`,
    [userId]
  );

  const [rescueRows] = await pool.query(
    isAdmin
      ? `SELECT * FROM (
           SELECT DISTINCT ON (ra.rescue_id)
                  rr.*, ra.id AS assignment_id, ra.responder_user_id, ra.assignment_status, ra.dispatch_instructions, ra.assigned_at,
                  u.name AS resident_name, up.phone_number AS resident_phone
           FROM rescue_assignments ra
           JOIN rescue_requests rr ON rr.id = ra.rescue_id
           LEFT JOIN users u ON rr.user_id = u.id
           LEFT JOIN user_profiles up ON rr.user_id = up.user_id
           ORDER BY ra.rescue_id, ra.assigned_at DESC, ra.id DESC
         ) latest
         ORDER BY latest.assigned_at DESC`
      : `SELECT * FROM (
           SELECT DISTINCT ON (ra.rescue_id)
                  rr.*, ra.id AS assignment_id, ra.responder_user_id, ra.assignment_status, ra.dispatch_instructions, ra.assigned_at,
                  u.name AS resident_name, up.phone_number AS resident_phone
           FROM rescue_assignments ra
           JOIN rescue_requests rr ON rr.id = ra.rescue_id
           LEFT JOIN users u ON rr.user_id = u.id
           LEFT JOIN user_profiles up ON rr.user_id = up.user_id
           ORDER BY ra.rescue_id, ra.assigned_at DESC, ra.id DESC
         ) latest
         WHERE latest.responder_user_id = ?
         ORDER BY latest.assigned_at DESC`,
    isAdmin ? [] : [userId]
  );

  const rescuePhotosMap = new Map();
  const rescueTimelineMap = new Map();
  if (rescueRows.length > 0) {
    const rescueIn = buildInClause([...new Set(rescueRows.map((r) => r.id))]);
    if (rescueIn) {
      try {
        const [attRows] = await pool.query(
          `SELECT rescue_id, file_url FROM rescue_attachments WHERE rescue_id IN (${rescueIn.placeholders}) ORDER BY created_at ASC`,
          rescueIn.params
        );
        for (const a of attRows) {
          if (!rescuePhotosMap.has(a.rescue_id)) rescuePhotosMap.set(a.rescue_id, []);
          rescuePhotosMap.get(a.rescue_id).push(a.file_url);
        }
      } catch {
        // ignore
      }

      try {
        const [histRows] = await pool.query(
          `SELECT h.rescue_id, h.new_status AS status, h.work_notes AS note, h.created_at AS timestamp, u.name AS author
           FROM rescue_status_history h
           LEFT JOIN users u ON h.changed_by = u.id
           WHERE h.rescue_id IN (${rescueIn.placeholders})
           ORDER BY h.created_at ASC`,
          rescueIn.params
        );
        for (const h of histRows) {
          if (!rescueTimelineMap.has(h.rescue_id)) rescueTimelineMap.set(h.rescue_id, []);
          rescueTimelineMap.get(h.rescue_id).push({
            status: h.status,
            note: h.note || '',
            author: h.author || 'Responder',
            timestamp: h.timestamp,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  const reportPhotosMap = new Map();
  const reportTimelineMap = new Map();
  if (reportRows.length > 0) {
    const reportIn = buildInClause([...new Set(reportRows.map((r) => r.id))]);
    if (reportIn) {
      try {
        const [attRows] = await pool.query(
          `SELECT incident_id, file_url FROM incident_attachments WHERE incident_id IN (${reportIn.placeholders}) ORDER BY created_at ASC`,
          reportIn.params
        );
        for (const a of attRows) {
          if (!reportPhotosMap.has(a.incident_id)) reportPhotosMap.set(a.incident_id, []);
          reportPhotosMap.get(a.incident_id).push(a.file_url);
        }
      } catch {
        // ignore
      }

      try {
        const [histRows] = await pool.query(
          `SELECT h.incident_id, h.new_status AS status, h.remarks AS note, h.created_at AS timestamp, u.name AS author
           FROM incident_status_history h
           LEFT JOIN users u ON h.changed_by = u.id
           WHERE h.incident_id IN (${reportIn.placeholders})
           ORDER BY h.created_at ASC`,
          reportIn.params
        );
        for (const h of histRows) {
          if (!reportTimelineMap.has(h.incident_id)) reportTimelineMap.set(h.incident_id, []);
          reportTimelineMap.get(h.incident_id).push({
            status: h.status,
            note: h.note || '',
            author: h.author || 'Responder',
            timestamp: h.timestamp,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  return [
    ...rescueRows.map((r) => ({
      id: r.reference_number || `RES-${r.id}`,
      dbId: r.id,
      assignmentId: r.assignment_id,
      assignmentType: 'rescue',
      referenceNumber: r.reference_number || `RES-${r.id}`,
      title: r.emergency_type || 'Rescue Request',
      category: r.emergency_type,
      description: r.description,
      location: r.address || 'Barangay Bayanan, Muntinlupa City',
      landmark: r.landmark || '',
      coordinates: { lat: Number(r.latitude), lng: Number(r.longitude) },
      status:
        r.status === 'Completed' || r.assignment_status === 'Completed'
          ? 'Completed'
          : r.status === 'In Progress'
          ? 'In Progress'
          : r.assignment_status || r.status || 'Assigned',
      peopleCount: r.people_count || 1,
      vulnerableDetails: r.vulnerable_details || 'None specified',
      residentName: r.resident_name || 'Resident',
      residentPhone: r.resident_phone || '',
      assignedAt: r.assigned_at || r.created_at,
      timeline: rescueTimelineMap.get(r.id) || [],
      photos: rescuePhotosMap.get(r.id) || [],
      dispatchInstructions: r.dispatch_instructions || 'Proceed to assigned scene and report status to EOC.',
    })),
    ...reportRows.map((r) => ({
      id: r.reference_number || `REP-${r.id}`,
      dbId: r.id,
      assignmentType: 'incident',
      referenceNumber: r.reference_number || `REP-${r.id}`,
      title: r.title || `${r.incident_type} Incident`,
      category: r.incident_type,
      description: r.description,
      location: r.address || 'Barangay Bayanan, Muntinlupa City',
      coordinates: { lat: Number(r.latitude), lng: Number(r.longitude) },
      status:
        r.status === 'resolved'
          ? 'Completed'
          : r.status === 'in_progress'
          ? 'In Progress'
          : r.status === 'on_site'
          ? 'On Scene'
          : r.status === 'responding'
          ? 'En Route'
          : r.status === 'dispatched'
          ? 'Assigned'
          : 'Pending',
      residentName: r.reporter_name || 'Resident',
      residentPhone: r.reporter_phone || '',
      assignedAt: r.created_at,
      timeline: reportTimelineMap.get(r.id) || [],
      photos: reportPhotosMap.get(r.id) || [],
      dispatchInstructions: 'Assess hazard scope and report status to Barangay Bayanan EOC.',
    })),
  ];
}

router.get('/responder/assignments', requireRole('responder', 'admin'), async (req, res) => {
  try {
    const assignments = await loadResponderAssignmentsForUser(req.user.id, req.user.role === 'admin');
    return res.json(assignments);
  } catch (err) {
    console.error('[Portal API] GET /responder/assignments failed:', err.message);
    return res.status(503).json({ error: 'Unable to load responder assignments' });
  }
});

router.get('/responder/assignments/:id', requireRole('responder', 'admin'), async (req, res) => {
  try {
    const assignments = await loadResponderAssignmentsForUser(req.user.id, true);
    const paramId = String(req.params.id || '').trim();
    const match = assignments.find(
      (a) =>
        a.id === paramId ||
        a.referenceNumber === paramId ||
        String(a.dbId) === paramId ||
        String(a.assignmentId) === paramId
    );
    if (!match) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    return res.json(match);
  } catch (err) {
    console.error('[Portal API] GET /responder/assignments/:id failed:', err.message);
    return res.status(503).json({ error: 'Unable to load assignment detail' });
  }
});

router.get('/responder/arrival-config', requireRole('responder', 'admin'), async (_req, res) => {
  try {
    const arrivalConfig = await getArrivalConfig(pool);
    return res.json({ arrivalConfig });
  } catch (err) {
    console.error('[Portal API] GET /responder/arrival-config failed:', err.message);
    return res.status(503).json({ error: 'Unable to load arrival detection configuration' });
  }
});

async function handleResponderAssignmentUpdate(req, res) {
  const paramId = String(req.params.id || '').trim();
  const {
    status,
    note,
    notes,
    work_notes,
    workNotes,
    photo,
    photos,
    assignmentType,
    type,
    autoArrival,
    arrivalGps,
  } = req.body || {};

  const fieldNotes = String(
    note !== undefined
      ? note
      : notes !== undefined
      ? notes
      : workNotes !== undefined
      ? workNotes
      : work_notes !== undefined
      ? work_notes
      : ''
  ).trim();

  const rawStatus = String(status || 'In Progress').trim();
  const statusLower = rawStatus.toLowerCase().replace(/_/g, ' ');

  const validStatusKeywords = [
    'accepted',
    'en route',
    'responding',
    'on scene',
    'on site',
    'in progress',
    'completed',
    'resolved',
    'assigned',
    'dispatched',
    'pending',
    'escalated',
  ];
  if (status && !validStatusKeywords.includes(statusLower)) {
    return res.status(400).json({
      error: `Invalid assignment status "${rawStatus}". Allowed: Accepted, En Route, On Scene, In Progress, Completed / Resolved.`,
    });
  }

  // Parse optional Base64 evidence photo(s)
  const rawPhotoList = [];
  if (Array.isArray(photos)) rawPhotoList.push(...photos);
  if (photo && !rawPhotoList.includes(photo)) rawPhotoList.push(photo);

  const hintType = String(assignmentType || type || '').toLowerCase();
  const isRescuePrefix = paramId.toUpperCase().startsWith('RES-');
  const isIncidentPrefix = paramId.toUpperCase().startsWith('REP-') || paramId.toUpperCase().startsWith('INC-');
  const numericId = /^\d+$/.test(paramId) ? parseInt(paramId, 10) : -1;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let targetKind = null; // 'rescue' | 'incident'
    let rescueRow = null;
    let reportRow = null;

    if (isRescuePrefix || hintType === 'rescue') {
      const [rRows] = await conn.query(
        'SELECT * FROM rescue_requests WHERE reference_number = ? OR id = ? LIMIT 1',
        [paramId, numericId]
      );
      if (rRows.length) {
        targetKind = 'rescue';
        rescueRow = rRows[0];
      }
    } else if (isIncidentPrefix || hintType === 'incident' || hintType === 'report') {
      const [repRows] = await conn.query(
        'SELECT * FROM reports WHERE reference_number = ? OR id = ? LIMIT 1',
        [paramId, numericId]
      );
      if (repRows.length) {
        targetKind = 'incident';
        reportRow = repRows[0];
      }
    }

    if (!targetKind) {
      // Check rescue_requests by reference or ID or rescue_assignments.id
      const [rRows] = await conn.query(
        `SELECT rr.*
         FROM rescue_requests rr
         LEFT JOIN rescue_assignments ra ON ra.rescue_id = rr.id
         WHERE rr.reference_number = ? OR rr.id = ? OR ra.id = ?
         LIMIT 1`,
        [paramId, numericId, numericId]
      );
      if (rRows.length) {
        targetKind = 'rescue';
        rescueRow = rRows[0];
      } else {
        const [repRows] = await conn.query(
          'SELECT * FROM reports WHERE reference_number = ? OR id = ? LIMIT 1',
          [paramId, numericId]
        );
        if (repRows.length) {
          targetKind = 'incident';
          reportRow = repRows[0];
        }
      }
    }

    if (!targetKind) {
      await conn.rollback();
      return res.status(404).json({ error: 'Assigned rescue request or incident report not found' });
    }

    // Verify assignment ownership for Responders
    const isAdminActor = req.user.role === 'admin';
    if (!isAdminActor) {
      if (targetKind === 'rescue') {
        const [latestRows] = await conn.query(
          `SELECT responder_user_id, assignment_status
           FROM rescue_assignments
           WHERE rescue_id = ?
           ORDER BY assigned_at DESC, id DESC
           LIMIT 1`,
          [rescueRow.id]
        );
        if (!latestRows.length || Number(latestRows[0].responder_user_id) !== Number(req.user.id)) {
          await conn.rollback();
          return res.status(403).json({ error: 'You are not authorized to update this rescue assignment.' });
        }
      } else if (targetKind === 'incident') {
        if (Number(reportRow.assigned_to) !== Number(req.user.id)) {
          await conn.rollback();
          return res.status(403).json({ error: 'You are not authorized to update this incident assignment.' });
        }
      }
    }

    // Validate automatic GPS-based arrival transitions (On Scene)
    if (autoArrival === true) {
      if (statusLower !== 'on scene' && statusLower !== 'on site') {
        await conn.rollback();
        return res.status(400).json({ error: 'Automatic arrival detection only supports On Scene transitions.' });
      }

      const currentStatusLower = String(
        targetKind === 'rescue' ? rescueRow.status : reportRow.status
      ).toLowerCase();

      if (currentStatusLower === 'on scene' || currentStatusLower === 'on_site') {
        await conn.rollback();
        return res.json({
          alreadyOnScene: true,
          message: 'Assignment is already On Scene.',
        });
      }

      const ineligibleStatuses = ['completed', 'resolved', 'false_alarm', 'dismissed', 'cancelled'];
      if (ineligibleStatuses.includes(currentStatusLower)) {
        await conn.rollback();
        return res.status(409).json({ error: 'Assignment is no longer eligible for On Scene transition.' });
      }

      const gpsLat = Number(arrivalGps && arrivalGps.lat);
      const gpsLng = Number(arrivalGps && arrivalGps.lng);
      const gpsAcc = Number(arrivalGps && arrivalGps.accuracy);
      if (
        !Number.isFinite(gpsLat) ||
        !Number.isFinite(gpsLng) ||
        Math.abs(gpsLat) > 90 ||
        Math.abs(gpsLng) > 180 ||
        !Number.isFinite(gpsAcc) ||
        gpsAcc <= 0
      ) {
        await conn.rollback();
        return res.status(400).json({ error: 'Valid GPS coordinates and accuracy are required for arrival confirmation.' });
      }

      const destLat = Number(targetKind === 'rescue' ? rescueRow.latitude : reportRow.latitude);
      const destLng = Number(targetKind === 'rescue' ? rescueRow.longitude : reportRow.longitude);
      if (!Number.isFinite(destLat) || !Number.isFinite(destLng) || (destLat === 0 && destLng === 0)) {
        await conn.rollback();
        return res.status(400).json({ error: 'Destination coordinates are missing or invalid for this assignment.' });
      }

      const arrivalConfig = await getArrivalConfig(conn);
      if (gpsAcc > arrivalConfig.maxGpsAccuracyMeters) {
        await conn.rollback();
        return res.status(400).json({
          error: `GPS accuracy (±${Math.round(gpsAcc)}m) is insufficient for automatic arrival confirmation.`,
        });
      }

      const distMeters = computeHaversineMeters(gpsLat, gpsLng, destLat, destLng);
      if (distMeters > arrivalConfig.geofenceRadiusMeters) {
        await conn.rollback();
        return res.status(400).json({
          error: `Responder GPS is outside the arrival boundary (${Math.round(distMeters)}m away).`,
        });
      }
    }

    // Save uploaded photos to appropriate folder
    const subDir = targetKind === 'rescue' ? 'rescues' : 'incidents';
    const prefix = targetKind === 'rescue' ? `RES-UPD-${req.user.id}` : `INC-UPD-${req.user.id}`;
    const savedPhotos = [];
    try {
      for (let i = 0; i < Math.min(rawPhotoList.length, 5); i++) {
        const parsed = parseAndSaveBase64Photo(rawPhotoList[i], subDir, `${prefix}-${i}`);
        if (parsed) savedPhotos.push(parsed);
      }
    } catch (photoErr) {
      await conn.rollback();
      return res.status(photoErr.statusCode || 400).json({ error: photoErr.message });
    }
    const primaryPhotoUrl = savedPhotos[0] ? savedPhotos[0].publicUrl : null;

    if (targetKind === 'rescue') {
      let nextRescueStatus = 'On Scene';
      let nextAssignmentStatus = 'On Scene';
      let nextUpdateStatus = 'In Progress';
      let displayRescueStatus = 'In Progress';

      if (statusLower === 'accepted' || statusLower === 'assigned' || statusLower === 'dispatched') {
        nextRescueStatus = 'Accepted';
        nextAssignmentStatus = 'Accepted';
        nextUpdateStatus = 'Accepted';
        displayRescueStatus = 'Accepted';
      } else if (statusLower === 'en route' || statusLower === 'responding') {
        nextRescueStatus = 'En Route';
        nextAssignmentStatus = 'En Route';
        nextUpdateStatus = 'En Route';
        displayRescueStatus = 'En Route';
      } else if (statusLower === 'on scene' || statusLower === 'on site') {
        nextRescueStatus = 'On Scene';
        nextAssignmentStatus = 'On Scene';
        nextUpdateStatus = 'On Scene';
        displayRescueStatus = 'On Scene';
      } else if (statusLower === 'in progress') {
        nextRescueStatus = 'On Scene';
        nextAssignmentStatus = 'On Scene';
        nextUpdateStatus = 'In Progress';
        displayRescueStatus = 'In Progress';
      } else if (statusLower === 'completed' || statusLower === 'resolved') {
        nextRescueStatus = 'Completed';
        nextAssignmentStatus = 'Completed';
        nextUpdateStatus = 'Completed';
        displayRescueStatus = 'Completed';
      }

      const oldStatus = rescueRow.status;
      await conn.query(
        `UPDATE rescue_requests
         SET status = ?,
             resolved_at = CASE WHEN ? = 'Completed' THEN CURRENT_TIMESTAMP ELSE resolved_at END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextRescueStatus, nextRescueStatus, rescueRow.id]
      );

      await conn.query(
        `UPDATE rescue_assignments
         SET assignment_status = ?,
             accepted_at = CASE WHEN ? = 'Accepted' AND accepted_at IS NULL THEN CURRENT_TIMESTAMP ELSE accepted_at END,
             en_route_at = CASE WHEN ? = 'En Route' AND en_route_at IS NULL THEN CURRENT_TIMESTAMP ELSE en_route_at END,
             on_scene_at = CASE WHEN ? = 'On Scene' AND on_scene_at IS NULL THEN CURRENT_TIMESTAMP ELSE on_scene_at END,
             completed_at = CASE WHEN ? = 'Completed' AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END
         WHERE rescue_id = ?`,
        [
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
          rescueRow.id,
        ]
      );

      const noteToSave = fieldNotes || `Responder updated status to ${displayRescueStatus}`;
      await conn.query(
        `INSERT INTO rescue_updates (rescue_id, responder_user_id, status_update, work_notes, photo_url, is_internal_only)
         VALUES (?, ?, ?, ?, ?, FALSE)`,
        [rescueRow.id, req.user.id, nextUpdateStatus, noteToSave, primaryPhotoUrl]
      );

      await conn.query(
        `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes, photo_url)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rescueRow.id, oldStatus, nextRescueStatus, req.user.id, noteToSave, primaryPhotoUrl]
      );

      for (const sp of savedPhotos) {
        await conn.query(
          `INSERT INTO rescue_attachments (rescue_id, file_url, file_name, file_type, file_size, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [rescueRow.id, sp.publicUrl, sp.fileName, sp.mimeType, sp.byteLength, req.user.id]
        );
      }

      const refNumber = rescueRow.reference_number || `RES-${rescueRow.id}`;
      try {
        const adminIds = await getActiveAdminIds(conn);
        const recipientIds = [...adminIds];
        if (rescueRow.user_id) recipientIds.push(rescueRow.user_id);

        await createNotificationForUsers(conn, {
          title: `Rescue Status Update (${refNumber}): ${displayRescueStatus}`,
          message: noteToSave,
          category: 'Dispatch',
          createdBy: req.user.id,
          userIds: recipientIds,
        });
      } catch (notifErr) {
        console.warn('[Portal API] Notification warning on rescue status update:', notifErr.message);
      }

      await conn.commit();

      const updatePayload = {
        id: refNumber,
        dbId: rescueRow.id,
        referenceNumber: refNumber,
        entityType: 'rescue',
        status: displayRescueStatus,
        rawStatus: nextRescueStatus,
        oldStatus,
        note: noteToSave,
        photoUrl: primaryPhotoUrl,
        residentId: rescueRow.user_id,
        responderId: req.user.id,
        actorUserId: req.user.id,
        responderName: req.user.name || 'Responder',
        updatedAt: new Date().toISOString(),
      };

      emitStatusUpdate(updatePayload);
      if (nextRescueStatus === 'Completed' && oldStatus !== 'Completed') {
        emitIncidentResolved({
          id: rescueRow.id,
          referenceNumber: refNumber,
          recordType: 'rescue',
          status: 'Completed',
          residentId: rescueRow.user_id,
          assignedTo: req.user.id,
        });
      }

      return res.json({
        message: 'Rescue assignment status updated',
        assignment: updatePayload,
      });
    }

    // Incident report update path
    let nextReportStatus = 'in_progress';
    let nextAssignmentStatus = 'On Scene';
    let nextIncidentUpdateStatus = 'In Progress';
    let displayStatus = 'In Progress';

    if (statusLower === 'accepted' || statusLower === 'assigned' || statusLower === 'dispatched') {
      nextReportStatus = 'dispatched';
      nextAssignmentStatus = 'Accepted';
      nextIncidentUpdateStatus = 'Accepted';
      displayStatus = 'Accepted';
    } else if (statusLower === 'en route' || statusLower === 'responding') {
      nextReportStatus = 'responding';
      nextAssignmentStatus = 'En Route';
      nextIncidentUpdateStatus = 'En Route';
      displayStatus = 'En Route';
    } else if (statusLower === 'on scene' || statusLower === 'on site') {
      nextReportStatus = 'on_site';
      nextAssignmentStatus = 'On Scene';
      nextIncidentUpdateStatus = 'On Scene';
      displayStatus = 'On Scene';
    } else if (statusLower === 'in progress') {
      nextReportStatus = 'in_progress';
      nextAssignmentStatus = 'On Scene';
      nextIncidentUpdateStatus = 'In Progress';
      displayStatus = 'In Progress';
    } else if (statusLower === 'completed' || statusLower === 'resolved') {
      nextReportStatus = 'resolved';
      nextAssignmentStatus = 'Completed';
      nextIncidentUpdateStatus = 'Resolved';
      displayStatus = 'Completed';
    }

    const oldStatus = reportRow.status;
    await conn.query(
      `UPDATE reports
       SET status = ?,
           resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextReportStatus, nextReportStatus, reportRow.id]
    );

    await conn
      .query(
        `UPDATE incident_assignments
         SET assignment_status = ?,
             accepted_at = CASE WHEN ? = 'Accepted' AND accepted_at IS NULL THEN CURRENT_TIMESTAMP ELSE accepted_at END,
             en_route_at = CASE WHEN ? = 'En Route' AND en_route_at IS NULL THEN CURRENT_TIMESTAMP ELSE en_route_at END,
             on_scene_at = CASE WHEN ? = 'On Scene' AND on_scene_at IS NULL THEN CURRENT_TIMESTAMP ELSE on_scene_at END,
             completed_at = CASE WHEN ? = 'Completed' AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END
         WHERE report_id = ?`,
        [
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
          reportRow.id,
        ]
      )
      .catch(() => {});

    const noteToSave = fieldNotes || `Responder updated incident status to ${displayStatus}`;
    await conn.query(
      `INSERT INTO incident_updates (report_id, responder_user_id, status_update, work_notes, photo_url, is_internal_only)
       VALUES (?, ?, ?, ?, ?, FALSE)`,
      [reportRow.id, req.user.id, nextIncidentUpdateStatus, noteToSave, primaryPhotoUrl]
    );

    await conn.query(
      `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, remarks)
       VALUES (?, ?, ?, ?, ?)`,
      [reportRow.id, oldStatus, nextReportStatus, req.user.id, noteToSave]
    );

    for (const sp of savedPhotos) {
      await conn.query(
        `INSERT INTO incident_attachments (incident_id, file_url, file_name, file_type, file_size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [reportRow.id, sp.publicUrl, sp.fileName, sp.mimeType, sp.byteLength, req.user.id]
      );
    }

    const refNumber = reportRow.reference_number || `REP-${reportRow.id}`;
    try {
      const adminIds = await getActiveAdminIds(conn);
      const recipientIds = [...adminIds];
      if (reportRow.user_id) recipientIds.push(reportRow.user_id);

      await createNotificationForUsers(conn, {
        title: `Incident Status Update (${refNumber}): ${displayStatus}`,
        message: noteToSave,
        category: 'Dispatch',
        createdBy: req.user.id,
        userIds: recipientIds,
      });
    } catch (notifErr) {
      console.warn('[Portal API] Notification warning on incident status update:', notifErr.message);
    }

    await conn.commit();

    const updatePayload = {
      id: refNumber,
      dbId: reportRow.id,
      referenceNumber: refNumber,
      entityType: 'incident',
      status: displayStatus,
      rawStatus: nextReportStatus,
      oldStatus,
      note: noteToSave,
      photoUrl: primaryPhotoUrl,
      residentId: reportRow.user_id,
      responderId: req.user.id,
      actorUserId: req.user.id,
      responderName: req.user.name || 'Responder',
      updatedAt: new Date().toISOString(),
    };

    emitStatusUpdate(updatePayload);

    return res.json({
      message: 'Incident assignment status updated',
      assignment: updatePayload,
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Portal API] Responder assignment status update failed:', err.message);
    return res.status(503).json({ error: 'Unable to update assignment status' });
  } finally {
    conn.release();
  }
}

router.patch('/responder/assignments/:id/status', requireRole('responder', 'admin'), handleResponderAssignmentUpdate);
router.put('/responder/assignments/:id/status', requireRole('responder', 'admin'), handleResponderAssignmentUpdate);
router.post('/responder/assignments/:id/updates', requireRole('responder', 'admin'), handleResponderAssignmentUpdate);

router.get('/responder/dashboard/summary', requireRole('responder', 'admin'), async (req, res) => {
  try {
    const assignments = await loadResponderAssignmentsForUser(req.user.id, req.user.role === 'admin');

    const active = assignments.filter((a) => a.status !== 'Completed').length;
    const pending = assignments.filter((a) => ['Pending', 'Assigned', 'Accepted'].includes(a.status)).length;
    const inProgress = assignments.filter((a) => ['En Route', 'On Scene', 'In Progress'].includes(a.status)).length;
    const completed = assignments.filter((a) => a.status === 'Completed').length;

    const [rRows] = await pool.query(
      'SELECT * FROM responder_profiles WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    const r = rRows[0] || {};
    const parts = String(req.user.name || '').trim().split(/\s+/);

    return res.json({
      stats: { active, pending, inProgress, completed },
      recentAssignments: assignments.slice(0, 5),
      responder: {
        id: req.user.id,
        firstName: parts[0] || 'Responder',
        lastName: parts.slice(1).join(' ') || '',
        email: req.user.email,
        role: 'Responder',
        assignedUnit: r.assigned_unit || 'Barangay Bayanan Field Unit',
        department: r.department || 'Barangay Bayanan Emergency Operations',
        availability: r.availability_status || 'Off Duty',
      },
    });
  } catch (err) {
    console.error('[Portal API] GET /responder/dashboard/summary failed:', err.message);
    return res.status(503).json({ error: 'Unable to load responder dashboard summary' });
  }
});

router.get('/eoc-location', async (req, res) => {
  try {
    const eoc = await getEocLocation(pool);
    return res.json(eoc);
  } catch (err) {
    console.error('[Portal API] GET /eoc-location failed:', err.message);
    return res.status(503).json({ error: 'Unable to load EOC location' });
  }
});

router.get('/responder/map-data', requireRole('responder', 'admin'), async (req, res) => {
  try {
    const [evacRows] = await pool.query('SELECT * FROM evacuation_centers ORDER BY name ASC');
    const [hospitalRows] = await pool.query('SELECT * FROM hospitals ORDER BY name ASC');
    const [profRows] = await pool.query(
      'SELECT current_latitude, current_longitude FROM responder_profiles WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    const assignments = await loadResponderAssignmentsForUser(req.user.id, req.user.role === 'admin');
    const activeAssignments = assignments.filter(
      (a) => !['completed', 'resolved', 'cancelled', 'false_alarm', 'dismissed'].includes(String(a.status || '').toLowerCase())
    );
    const assignedIncidentDbIds = new Set(
      activeAssignments
        .filter((a) => a.assignmentType === 'incident')
        .map((a) => Number(a.dbId))
    );
    const [incidentRows] = await pool.query(
      `SELECT id, reference_number, incident_type, title, description, latitude, longitude, address, status, created_at
       FROM reports
       WHERE status IN ('verified', 'dispatched', 'responding', 'on_site', 'in_progress')
       ORDER BY created_at DESC
       LIMIT 50`
    );
    const activeIncidents = incidentRows
      .filter((r) => !assignedIncidentDbIds.has(Number(r.id)))
      .map((r) => {
        const formatted = formatReportForPortal(r);
        return {
          ...formatted,
          assignmentType: 'incident',
          isAssignedToMe: false,
          isPublicIncident: true,
          category: formatted.incidentType,
        };
      });
    const prof = profRows[0];

    const { isPointInsideBayanan, isExcludedEvacuationCenter } = require('../utils/bayananBoundary');
    const eocLocation = await getEocLocation(pool);
    return res.json({
      assignments: activeAssignments,
      incidents: activeIncidents,
      eocLocation,
      evacuationCenters: evacRows
        .filter((e) => !isExcludedEvacuationCenter(e) && (String(e.barangay || '').toLowerCase().includes('bayanan') || isPointInsideBayanan(e.latitude, e.longitude)))
        .map((e) => ({
          ...e,
          coordinates: { lat: Number(e.latitude), lng: Number(e.longitude) },
        })),
      barangayFacilities: hospitalRows.map((h) => ({
        ...h,
        type: h.facility_type || h.hospital_type || 'Hospital',
        coordinates: { lat: Number(h.latitude), lng: Number(h.longitude) },
      })),
      responderLocation:
        prof && prof.current_latitude && prof.current_longitude
          ? { lat: Number(prof.current_latitude), lng: Number(prof.current_longitude) }
          : null,
    });
  } catch (err) {
    console.error('[Portal API] GET /responder/map-data failed:', err.message);
    return res.status(503).json({ error: 'Unable to load responder map data' });
  }
});

module.exports = router;
