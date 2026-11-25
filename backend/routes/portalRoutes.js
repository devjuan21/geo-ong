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
  emitResponderLocationUpdate,
  emitResponderLocationOffline,
  emitRescueOutcomeUpdated,
  emitRescueTransportUpdated,
  emitReportVerificationResult,
  emitPublicVerifiedReport,
} = require('../services/socketService');
const { getArrivalConfig, computeHaversineMeters } = require('../config/arrivalConfig');
const { dispatchIncidentResolvedCommunityBroadcast } = require('../services/incidentResolutionService');
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

function formatPeopleCountDisplay(peopleCount, category) {
  const cat = String(category || '').toLowerCase();
  if (cat === 'unknown') return 'Unknown';
  if (cat === 'more_than_10') return 'More than 10';
  if (peopleCount === null || peopleCount === undefined) return 'Unknown';
  const n = Number(peopleCount);
  if (!Number.isFinite(n) || n < 1) return 'Unknown';
  return `${n} ${n === 1 ? 'Person' : 'People'}`;
}

function formatRescueForPortal(r, updates = [], photos = [], meta = {}) {
  const category = r.people_count_category || (r.people_count === null ? 'unknown' : 'exact');
  const countVal = category === 'exact' && r.people_count !== null ? Number(r.people_count) : null;
  const assignedUnit = meta.assignedUnit || null;
  const assignedResponderName = meta.assignedResponderName || null;
  const assignmentStatus = meta.assignmentStatus || null;
  const responderContact = assignedResponderName
    ? `Responder: ${assignedResponderName}${assignmentStatus ? ` (${assignmentStatus})` : ''}`
    : null;

  return {
    id: r.reference_number || `RES-${r.id}`,
    dbId: r.id,
    referenceNumber: r.reference_number || `RES-${r.id}`,
    emergencyType: r.emergency_type,
    description: r.description,
    peopleCount: countVal,
    peopleCountCategory: category,
    peopleCountDisplay: formatPeopleCountDisplay(countVal, category),
    assignedResponderId: meta.assignedResponderId || null,
    assignedResponderName,
    assignedUnit,
    assignmentStatus,
    responderContact,
    conversationId: meta.conversationId || null,
    conversationStatus: meta.conversationStatus || null,
    conversationArchived: Boolean(meta.conversationArchived),
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
      "SELECT id, reference_number, incident_type, title, description, latitude, longitude, address, status, created_at FROM reports WHERE is_public = TRUE AND status IN ('verified', 'dispatched', 'responding', 'on_site', 'in_progress') ORDER BY created_at DESC LIMIT 50"
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
        barangay: p.barangay || 'Barangay Bayanan',
        city: p.city || 'Muntinlupa City',
        province: p.province || 'Metro Manila',
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
         postal_code = VALUES(postal_code),
         emergency_contact_name = COALESCE(VALUES(emergency_contact_name), user_profiles.emergency_contact_name),
         emergency_contact_relationship = COALESCE(VALUES(emergency_contact_relationship), user_profiles.emergency_contact_relationship),
         emergency_contact_phone = COALESCE(VALUES(emergency_contact_phone), user_profiles.emergency_contact_phone),
         medical_notes = COALESCE(VALUES(medical_notes), user_profiles.medical_notes)`,
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
        medicalNotes !== undefined ? (medicalNotes ? String(medicalNotes).trim() : null) : null,
      ]
    );

    const [updatedRows] = await conn.query('SELECT * FROM user_profiles WHERE user_id = ? LIMIT 1', [req.user.id]);
    const up = updatedRows[0] || {};

    await conn.commit();
    return res.json({
      id: req.user.id,
      userId: req.user.user_code || req.user.userCode || `RSDNT-${String(req.user.id).padStart(4, '0')}`,
      userCode: req.user.user_code || req.user.userCode || `RSDNT-${String(req.user.id).padStart(4, '0')}`,
      firstName: fName,
      lastName: lName,
      email: req.user.email,
      phone: phone || '',
      verificationStatus: up.verification_status || 'Unverified Resident',
      address: {
        street: street || '',
        barangay: up.barangay || 'Barangay Bayanan',
        city: up.city || 'Muntinlupa City',
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
    await conn.rollback().catch(() => { });
    console.error('[Portal API] PUT /profile failed:', err.message);
    return res.status(503).json({ error: 'Unable to update profile' });
  } finally {
    conn.release();
  }
});

// ----------------------------------------------------------------------------
// 3. RESCUE REQUESTS
// ----------------------------------------------------------------------------
async function loadRescuePortalEnrichment(rescueIds, userId, isResidentUser) {
  const photosByRescue = new Map();
  const updatesByRescue = new Map();
  const metaByRescue = new Map();
  const inClause = buildInClause(rescueIds);
  if (!inClause) {
    return { photosByRescue, updatesByRescue, metaByRescue };
  }

  try {
    const [assignRows] = await pool.query(
      `SELECT DISTINCT ON (ra.rescue_id)
              ra.rescue_id, ra.responder_user_id, ra.assignment_status,
              u.name AS responder_name,
              rp.assigned_unit, rp.department
       FROM rescue_assignments ra
       JOIN users u ON u.id = ra.responder_user_id
       LEFT JOIN responder_profiles rp ON rp.user_id = ra.responder_user_id
       WHERE ra.rescue_id IN (${inClause.placeholders})
         AND ra.assignment_status <> 'Reassigned'
       ORDER BY ra.rescue_id, ra.assigned_at DESC, ra.id DESC`,
      inClause.params
    );
    for (const a of assignRows) {
      metaByRescue.set(a.rescue_id, {
        assignedResponderId: Number(a.responder_user_id),
        assignedResponderName: a.responder_name || 'Responder',
        assignedUnit: a.assigned_unit || a.department || 'Barangay Bayanan Response Unit',
        assignmentStatus: a.assignment_status || 'Assigned',
        conversationId: null,
        conversationStatus: null,
        conversationArchived: false,
      });
    }

    const [convRows] = await pool.query(
      `SELECT DISTINCT ON (c.rescue_id)
              c.id AS conversation_id, c.rescue_id, c.status AS conversation_status,
              COALESCE(cp.is_archived, FALSE) AS is_archived
       FROM conversations c
       LEFT JOIN conversation_participants cp
         ON cp.conversation_id = c.id AND cp.user_id = ?
       WHERE c.rescue_id IN (${inClause.placeholders})
       ORDER BY c.rescue_id, c.id DESC`,
      [userId, ...inClause.params]
    );
    for (const c of convRows) {
      const cur = metaByRescue.get(c.rescue_id) || {};
      metaByRescue.set(c.rescue_id, {
        ...cur,
        conversationId: Number(c.conversation_id),
        conversationStatus: c.conversation_status || 'Active',
        conversationArchived: Boolean(c.is_archived),
      });
    }
  } catch {
    // Ignore if optional metadata lookup fails
  }

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
    const privacyClause = isResidentUser ? 'AND COALESCE(h.is_internal_only, FALSE) = FALSE' : '';
    const [histRows] = await pool.query(
      `SELECT h.id, h.rescue_id, h.new_status AS status, h.work_notes AS note, h.created_at AS timestamp, u.name AS author
       FROM rescue_status_history h
       LEFT JOIN users u ON h.changed_by = u.id
       WHERE h.rescue_id IN (${inClause.placeholders})
         ${privacyClause}
       ORDER BY h.created_at ASC, h.id ASC`,
      inClause.params
    );
    for (const h of histRows) {
      if (!updatesByRescue.has(h.rescue_id)) updatesByRescue.set(h.rescue_id, []);
      updatesByRescue.get(h.rescue_id).push({
        id: h.id,
        status: h.status || 'Update',
        note: h.note || '',
        author: h.author || 'Command Center',
        timestamp: h.timestamp,
      });
    }
  } catch {
    // Ignore
  }

  return { photosByRescue, updatesByRescue, metaByRescue };
}

router.get('/rescue-requests', async (req, res) => {
  try {
    let query = 'SELECT * FROM rescue_requests';
    const params = [];
    const isResidentUser = req.user.role === 'resident';
    if (isResidentUser) {
      query += ' WHERE user_id = ?';
      params.push(req.user.id);
    }
    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(query, params);

    const { photosByRescue, updatesByRescue, metaByRescue } = await loadRescuePortalEnrichment(
      rows.map((r) => r.id),
      req.user.id,
      isResidentUser
    );

    return res.json(
      rows.map((r) =>
        formatRescueForPortal(r, updatesByRescue.get(r.id) || [], photosByRescue.get(r.id) || [], metaByRescue.get(r.id) || {})
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
    const isResidentUser = req.user.role === 'resident';
    if (isResidentUser && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { photosByRescue, updatesByRescue, metaByRescue } = await loadRescuePortalEnrichment(
      [row.id],
      req.user.id,
      isResidentUser
    );

    return res.json(
      formatRescueForPortal(
        row,
        updatesByRescue.get(row.id) || [],
        photosByRescue.get(row.id) || [],
        metaByRescue.get(row.id) || {}
      )
    );
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

  const rawCategoryInput = String(req.body && req.body.peopleCountCategory || '').trim().toLowerCase();
  const rawAnyCount = [peopleCount, peopleTrapped, patientCount, assistanceCount].find((v) => v !== undefined && v !== null && String(v).trim() !== '');
  const rawAnyLower = String(rawAnyCount ?? '').trim().toLowerCase();

  let peopleCountCategory = 'exact';
  if (rawCategoryInput === 'unknown' || rawAnyLower === 'unknown' || Boolean(req.body && req.body.peopleCountUnknown)) {
    peopleCountCategory = 'unknown';
  } else if (rawCategoryInput === 'more_than_10' || rawAnyLower === 'more_than_10') {
    peopleCountCategory = 'more_than_10';
  }

  if (isMedical) {
    if (peopleCountCategory === 'unknown' || peopleCountCategory === 'more_than_10') {
      validatedCount = null;
      const label = peopleCountCategory === 'more_than_10' ? 'More than 10' : 'Unknown';
      const prefix = `Patients Needing Evacuation: ${label}`;
      storedVulnerableDetails = storedVulnerableDetails ? `${prefix} | ${storedVulnerableDetails}` : prefix;
    } else {
      const rawPatient = patientCount !== undefined ? patientCount : peopleCount;
      validatedCount = parsePositiveWhole(rawPatient);
      if (validatedCount === undefined || Number.isNaN(validatedCount)) {
        return res.status(400).json({ error: 'Number of patients needing evacuation must be a positive whole number (1-50), More than 10, or Unknown.' });
      }
      const prefix = `Patients Needing Evacuation: ${validatedCount}`;
      storedVulnerableDetails = storedVulnerableDetails ? `${prefix} | ${storedVulnerableDetails}` : prefix;
    }
  } else if (isVulnerability) {
    if (peopleCountCategory === 'unknown' || peopleCountCategory === 'more_than_10') {
      validatedCount = null;
      const label = peopleCountCategory === 'more_than_10' ? 'More than 10' : 'Unknown';
      const prefix = `Individuals Needing Assistance: ${label}`;
      storedVulnerableDetails = storedVulnerableDetails ? `${prefix} | ${storedVulnerableDetails}` : prefix;
    } else {
      const rawAssist = assistanceCount !== undefined ? assistanceCount : peopleCount;
      validatedCount = parsePositiveWhole(rawAssist);
      if (validatedCount === undefined || Number.isNaN(validatedCount)) {
        return res.status(400).json({ error: 'Number of individuals needing assistance must be a positive whole number (1-50), More than 10, or Unknown.' });
      }
      const prefix = `Individuals Needing Assistance: ${validatedCount}`;
      storedVulnerableDetails = storedVulnerableDetails ? `${prefix} | ${storedVulnerableDetails}` : prefix;
    }
  } else {
    if (peopleCountCategory === 'unknown' || peopleCountCategory === 'more_than_10') {
      validatedCount = null;
      const label = peopleCountCategory === 'more_than_10' ? 'More than 10' : 'Unknown';
      const prefix = `People Trapped: ${label}`;
      storedVulnerableDetails = storedVulnerableDetails ? `${prefix} | ${storedVulnerableDetails}` : prefix;
    } else {
      const rawTrapped = peopleTrapped !== undefined ? peopleTrapped : peopleCount;
      validatedCount = parsePositiveWhole(rawTrapped);
      if (validatedCount === undefined || Number.isNaN(validatedCount)) {
        return res.status(400).json({ error: 'Number of people trapped must be a positive whole number (1-50), More than 10, or Unknown.' });
      }
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
         (reference_number, user_id, emergency_type, description, people_count, people_count_category, vulnerable_details,
          latitude, longitude, address, landmark, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Dispatch')`,
      [
        tempRef,
        req.user.id,
        emergencyLabel,
        descText,
        validatedCount,
        peopleCountCategory,
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

    // Notify all active Administrators and Responders
    try {
      const [opUsers] = await conn.query(
        `SELECT u.id
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.status = 'active'
           AND LOWER(r.name) IN ('admin', 'administrator', 'responder')`
      );
      const opUserIds = [...new Set(opUsers.map((u) => Number(u.id)).filter(Boolean))];
      const countText = formatPeopleCountDisplay(validatedCount, peopleCountCategory);
      const [notifRes] = await conn.query(
        `INSERT INTO notifications (title, message, category, related_entity_type, related_entity_id, action_url, created_by)
         VALUES (?, ?, 'Alert', 'rescue_request', ?, ?, ?)`,
        [
          `New Rescue Request: ${refNum}`,
          `${emergencyLabel} at ${addrText} (${countText}) • Status: Pending Dispatch`,
          result.insertId,
          `/responder-assignments.html?id=${encodeURIComponent(refNum)}`,
          req.user.id,
        ]
      );
      for (const uid of opUserIds) {
        await conn.query(
          `INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?)`,
          [notifRes.insertId, uid]
        );
      }
    } catch (notifErr) {
      console.warn('[Portal API] Operational notification warning on rescue request:', notifErr.message);
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
    await conn.rollback().catch(() => { });
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
      `SELECT n.id, n.title, n.message AS description, n.category, n.advisory_type,
              n.action_url, n.related_entity_type, n.related_entity_id,
              n.created_at AS timestamp, nr.is_read
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
      actionUrl: r.action_url || null,
      relatedEntityType: r.related_entity_type || null,
      relatedEntityId: r.related_entity_id || null,
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

router.get('/incident-categories', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, description, default_severity, sort_order
       FROM incident_categories
       WHERE is_active = TRUE
       ORDER BY sort_order ASC, id ASC`
    );
    return res.json({ categories: rows });
  } catch (err) {
    console.error('[Portal API] GET /incident-categories failed:', err.message);
    return res.status(503).json({ error: 'Unable to load incident categories' });
  }
});

router.get('/rescue-categories', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, display_label, description, sort_order
       FROM rescue_categories
       WHERE is_active = TRUE
       ORDER BY sort_order ASC, id ASC`
    );
    return res.json({ categories: rows });
  } catch (err) {
    console.error('[Portal API] GET /rescue-categories failed:', err.message);
    return res.status(503).json({ error: 'Unable to load rescue categories' });
  }
});

router.get('/hazard-alerts', async (req, res) => {
  try {
    const { defaultColorForName } = require('../config/advisoryCategories');
    const { expireDueBroadcasts } = require('../services/broadcastExpirationService');
    await expireDueBroadcasts();

    const userRoleLower = String(req.user && req.user.role || '').toLowerCase();
    const isResident = userRoleLower === 'resident';
    const isResponder = userRoleLower === 'responder';
    const includeInactive = String(req.query.includeArchived || '').toLowerCase() === 'true';
    const [broadcastRows] = await pool.query(
      `SELECT ebl.id, ebl.title, ebl.message, ebl.category_id, ebl.advisory_type, ebl.urgency_level,
              ebl.target_scope, ebl.target_zones, ebl.broadcasted_at, ebl.expires_at,
              ebl.is_active, ebl.status, ebl.expired_at, ebl.cancelled_at,
              ebl.location_coverage, ebl.latitude, ebl.longitude, ebl.location_address,
              bc.name AS category_name, bc.badge_color AS category_color, bc.priority AS category_priority,
              u.name AS author_name, u.email AS author_email,
              up.first_name AS author_first_name, up.last_name AS author_last_name
       FROM emergency_broadcast_logs ebl
       LEFT JOIN broadcast_categories bc ON ebl.category_id = bc.id
       LEFT JOIN users u ON ebl.authorized_by = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE 1=1
         ${includeInactive ? '' : "AND ebl.is_active = TRUE AND ebl.status = 'Active' AND (ebl.expires_at IS NULL OR ebl.expires_at > NOW())"}
         ${isResident ? "AND ebl.target_scope IN ('Residents', 'Residents Only', 'Everyone', 'All Barangay Bayanan', 'Lakeshore Zone', 'Specific Purok')" : ''}
         ${isResponder ? "AND ebl.target_scope IN ('Responders', 'Responders Only', 'Everyone', 'All Barangay Bayanan')" : ''}
       ORDER BY ebl.broadcasted_at DESC
       LIMIT 100`
    );
    const alertRows = [];
    if (!isResident && !isResponder) {
      const [legacyRows] = await pool.query(
        `SELECT a.*, u.name AS author_name, u.email AS author_email
         FROM alerts a
         LEFT JOIN users u ON a.created_by = u.id
         WHERE NOT EXISTS (
           SELECT 1 FROM emergency_broadcast_logs ebl
           WHERE (ebl.title || ': ' || ebl.message) = a.message
         )
         ORDER BY a.created_at DESC LIMIT 50`
      );
      alertRows.push(...legacyRows);
    }

    const mappedBroadcasts = broadcastRows.map((b) => {
      const categoryName = b.category_name || b.advisory_type || 'Other';
      const badgeColor = b.category_color || defaultColorForName(categoryName);
      const priority = Number(b.category_priority || 5);
      const zoneList = b.target_zones
        ? String(b.target_zones).split(/[,;/]+/).map((z) => z.trim()).filter(Boolean)
        : [];
      const locationCoverage = b.location_coverage || 'Entire Barangay Bayanan';
      const latVal = b.latitude !== null && b.latitude !== undefined ? Number(b.latitude) : null;
      const lngVal = b.longitude !== null && b.longitude !== undefined ? Number(b.longitude) : null;
      const locationAddress = (b.location_address || b.target_zones || '').trim() || null;
      const affectedLocation = locationAddress;
      const author = [b.author_first_name, b.author_last_name].filter(Boolean).join(' ')
        || b.author_name
        || b.author_email
        || 'BDRRMC Barangay Bayanan';
      const isExpiredByTime = Boolean(b.expires_at && new Date(b.expires_at).getTime() <= Date.now());
      let status = b.status || (b.is_active ? 'Active' : 'Cancelled');
      if (status === 'Active' && (isExpiredByTime || !b.is_active)) {
        status = isExpiredByTime ? 'Expired' : 'Cancelled';
      }
      return {
        id: `BRD-${String(b.id).padStart(4, '0')}`,
        title: b.title,
        description: b.message,
        categoryId: b.category_id || null,
        categoryName,
        advisoryType: categoryName,
        category: categoryName,
        urgencyLevel: b.urgency_level || 'Advisory',
        badgeColor,
        priority,
        isEmergency: b.urgency_level === 'Critical' || b.urgency_level === 'Warning' || priority <= 2,
        publishedAt: b.broadcasted_at,
        expiresAt: b.expires_at || null,
        expiredAt: b.expired_at || null,
        cancelledAt: b.cancelled_at || null,
        targetScope: b.target_scope || 'All Barangay Bayanan',
        targetZones: b.target_zones || '',
        affectedAreas: zoneList.length > 0 ? zoneList : [b.target_scope || 'Barangay Bayanan'],
        affectedLocation,
        locationCoverage,
        latitude: Number.isFinite(latVal) ? latVal : null,
        longitude: Number.isFinite(lngVal) ? lngVal : null,
        locationAddress,
        issuingAuthority: author,
        status,
      };
    });

    const mappedAlerts = alertRows.map((a) => ({
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
    const [evacRows] = await pool.query(
      'SELECT id, name, address, barangay, latitude, longitude, status, contact_person, contact_phone, contact_number FROM evacuation_centers ORDER BY name ASC'
    );

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
          is_operational: ['Full', 'Full / Closed', 'Temporarily Closed', 'Inactive'].includes(e.status) ? 0 : 1,
          isOperational: !['Full', 'Full / Closed', 'Temporarily Closed', 'Inactive'].includes(e.status),
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
      `SELECT rp.*, up.phone_number, up.verification_status
       FROM responder_profiles rp
       LEFT JOIN user_profiles up ON rp.user_id = up.user_id
       WHERE rp.user_id = ? LIMIT 1`,
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
      email: req.user.email || '',
      phone: r.phone_number || '',
      role: req.user.role === 'admin' ? 'Administrator' : 'Responder',
      badgeNumber: r.badge_number || `RESP-${req.user.id}`,
      callsign: r.callsign || `BAYANAN-${req.user.id}`,
      assignedUnit: r.assigned_unit || '',
      department: r.department || 'Barangay Bayanan EOC',
      baseStation: r.department || 'Barangay Bayanan EOC',
      specialization: r.specialization || '',
      verificationStatus: r.verification_status || '',
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
  const validStatuses = ['On Duty', 'Off Duty', 'On Break'];
  const normalizedStatus = status === 'Unavailable' ? 'On Break' : status;
  if (!validStatuses.includes(normalizedStatus)) {
    return res.status(400).json({ error: 'Invalid availability status' });
  }
  try {
    await pool.query(
      `INSERT INTO responder_profiles (user_id, badge_number, assigned_unit, department, availability_status)
       VALUES (?, ?, 'Barangay Bayanan Field Unit', 'Barangay Bayanan Emergency Operations', ?)
       ON DUPLICATE KEY UPDATE availability_status = VALUES(availability_status)`,
      [req.user.id, `RESP-${req.user.id}`, normalizedStatus]
    );
    return res.json({ status: normalizedStatus, updated: true });
  } catch (err) {
    console.error('[Portal API] PATCH /responder/availability failed:', err.message);
    return res.status(503).json({ error: 'Unable to update responder availability' });
  }
});

function normalizeAssignmentTimelineStatus(rawStatus, note = '') {
  const s = String(rawStatus || '').trim();
  const low = s.toLowerCase();
  if (low === 'dispatched') {
    if (/accepted/i.test(note)) return 'Accepted';
    return 'Assigned';
  }
  if (low === 'responding' || low === 'en route' || low === 'en_route') return 'En Route';
  if (low === 'on_site' || low === 'on scene' || low === 'on_scene') return 'On Scene';
  if (low === 'in_progress' || low === 'in progress') return 'In Progress';
  if (low === 'resolved' || low === 'completed') return 'Completed';
  if (low === 'verified') return 'Verified';
  if (low === 'pending' || low === 'pending dispatch') return 'Pending';
  return s || 'Update';
}

function isCompletionPhotoRequired(_targetKind, _recordRow) {
  return true;
}

function mapUnifiedIncidentStatus(reportStatus, assignmentStatus) {
  const rs = String(reportStatus || '').toLowerCase();
  const as = String(assignmentStatus || '').toLowerCase();
  if (rs === 'resolved' || as === 'completed') return 'Completed';
  if (rs === 'in_progress') return 'In Progress';
  if (rs === 'on_site' || as === 'on scene') return 'On Scene';
  if (rs === 'responding' || as === 'en route') return 'En Route';
  if (as === 'accepted') return 'Accepted';
  if (rs === 'dispatched' || as === 'assigned') return 'Assigned';
  return 'Pending';
}

async function loadResponderAssignmentsForUser(userId, isAdmin = false) {
  const [reportRows] = await pool.query(
    isAdmin
      ? `SELECT r.*, ia.id AS assignment_id, ia.responder_user_id, ia.assignment_status,
                ia.dispatch_instructions, ia.assigned_at, ia.accepted_at, ia.en_route_at,
                ia.on_scene_at, ia.completed_at,
                u.name AS reporter_name, up.phone_number AS reporter_phone
         FROM reports r
         LEFT JOIN LATERAL (
           SELECT id, responder_user_id, assignment_status, dispatch_instructions,
                  assigned_at, accepted_at, en_route_at, on_scene_at, completed_at
           FROM incident_assignments
           WHERE report_id = r.id
           ORDER BY assigned_at DESC, id DESC
           LIMIT 1
         ) ia ON TRUE
         LEFT JOIN users u ON r.user_id = u.id
         LEFT JOIN user_profiles up ON r.user_id = up.user_id
         WHERE LOWER(r.status) NOT IN ('false_alarm', 'dismissed', 'rejected')
           AND r.source_rescue_id IS NULL
           AND (
             ia.responder_user_id IS NOT NULL
             OR r.assigned_to IS NOT NULL
             OR (r.assigned_to IS NULL AND ia.id IS NULL AND LOWER(r.status) IN ('pending', 'verified', 'under_review', 'dispatched'))
           )
         ORDER BY COALESCE(ia.assigned_at, r.created_at) DESC`
      : `SELECT r.*, ia.id AS assignment_id, ia.responder_user_id, ia.assignment_status,
                ia.dispatch_instructions, ia.assigned_at, ia.accepted_at, ia.en_route_at,
                ia.on_scene_at, ia.completed_at,
                u.name AS reporter_name, up.phone_number AS reporter_phone
         FROM reports r
         LEFT JOIN LATERAL (
           SELECT id, responder_user_id, assignment_status, dispatch_instructions,
                  assigned_at, accepted_at, en_route_at, on_scene_at, completed_at
           FROM incident_assignments
           WHERE report_id = r.id
           ORDER BY assigned_at DESC, id DESC
           LIMIT 1
         ) ia ON TRUE
         LEFT JOIN users u ON r.user_id = u.id
         LEFT JOIN user_profiles up ON r.user_id = up.user_id
         WHERE LOWER(r.status) NOT IN ('false_alarm', 'dismissed', 'rejected')
           AND r.source_rescue_id IS NULL
           AND (
             COALESCE(ia.responder_user_id, r.assigned_to) = ?
             OR (r.assigned_to IS NULL AND ia.id IS NULL AND LOWER(r.status) IN ('pending', 'verified', 'under_review', 'dispatched'))
           )
         ORDER BY COALESCE(ia.assigned_at, r.created_at) DESC`,
    isAdmin ? [] : [userId]
  );

  const [rescueRows] = await pool.query(
    isAdmin
      ? `SELECT rr.*, ra.id AS assignment_id, ra.responder_user_id, ra.assignment_status, ra.dispatch_instructions,
                ra.assigned_at, ra.accepted_at, ra.en_route_at, ra.on_scene_at, ra.completed_at,
                u.name AS resident_name, up.phone_number AS resident_phone
         FROM rescue_requests rr
         LEFT JOIN LATERAL (
           SELECT id, responder_user_id, assignment_status, dispatch_instructions,
                  assigned_at, accepted_at, en_route_at, on_scene_at, completed_at
           FROM rescue_assignments
           WHERE rescue_id = rr.id
           ORDER BY assigned_at DESC, id DESC
           LIMIT 1
         ) ra ON TRUE
         LEFT JOIN users u ON rr.user_id = u.id
         LEFT JOIN user_profiles up ON rr.user_id = up.user_id
         WHERE rr.status <> 'Cancelled'
           AND (
             ra.responder_user_id IS NOT NULL
             OR (ra.id IS NULL AND rr.status <> 'Completed')
           )
         ORDER BY COALESCE(ra.assigned_at, rr.created_at) DESC`
      : `SELECT rr.*, ra.id AS assignment_id, ra.responder_user_id, ra.assignment_status, ra.dispatch_instructions,
                ra.assigned_at, ra.accepted_at, ra.en_route_at, ra.on_scene_at, ra.completed_at,
                u.name AS resident_name, up.phone_number AS resident_phone
         FROM rescue_requests rr
         LEFT JOIN LATERAL (
           SELECT id, responder_user_id, assignment_status, dispatch_instructions,
                  assigned_at, accepted_at, en_route_at, on_scene_at, completed_at
           FROM rescue_assignments
           WHERE rescue_id = rr.id
           ORDER BY assigned_at DESC, id DESC
           LIMIT 1
         ) ra ON TRUE
         LEFT JOIN users u ON rr.user_id = u.id
         LEFT JOIN user_profiles up ON rr.user_id = up.user_id
         WHERE rr.status <> 'Cancelled'
           AND (
             ra.responder_user_id = ?
             OR (ra.id IS NULL AND rr.status <> 'Completed')
           )
         ORDER BY COALESCE(ra.assigned_at, rr.created_at) DESC`,
    isAdmin ? [] : [userId]
  );

  const rescuePhotosMap = new Map();
  const rescueResidentEvidenceMap = new Map();
  const rescueCompletionEvidenceMap = new Map();
  const rescueTimelineMap = new Map();
  if (rescueRows.length > 0) {
    const rescueIn = buildInClause([...new Set(rescueRows.map((r) => r.id))]);
    if (rescueIn) {
      try {
        const [attRows] = await pool.query(
          `SELECT ra.rescue_id, ra.file_url, ra.file_name, ra.file_type, ra.evidence_type, ra.assignment_id, ra.created_at,
                  u.name AS uploaded_by_name, u.role_id AS uploader_role_id
           FROM rescue_attachments ra
           LEFT JOIN users u ON u.id = ra.uploaded_by
           WHERE ra.rescue_id IN (${rescueIn.placeholders})
           ORDER BY ra.created_at ASC`,
          rescueIn.params
        );
        for (const a of attRows) {
          if (!rescuePhotosMap.has(a.rescue_id)) rescuePhotosMap.set(a.rescue_id, []);
          rescuePhotosMap.get(a.rescue_id).push(a.file_url);

          const evType = a.evidence_type || (Number(a.uploader_role_id) === 2 ? 'responder_completion' : 'resident_report');
          const evItem = {
            fileUrl: a.file_url,
            fileName: a.file_name || 'Photo Evidence',
            fileType: a.file_type || 'image/jpeg',
            evidenceType: evType,
            assignmentId: a.assignment_id || null,
            uploadedByName: a.uploaded_by_name || (evType === 'resident_report' ? 'Resident' : 'Responder'),
            createdAt: a.created_at,
          };
          if (evType === 'responder_completion') {
            if (!rescueCompletionEvidenceMap.has(a.rescue_id)) rescueCompletionEvidenceMap.set(a.rescue_id, []);
            rescueCompletionEvidenceMap.get(a.rescue_id).push(evItem);
          } else if (evType === 'resident_report') {
            if (!rescueResidentEvidenceMap.has(a.rescue_id)) rescueResidentEvidenceMap.set(a.rescue_id, []);
            rescueResidentEvidenceMap.get(a.rescue_id).push(evItem);
          }
        }
      } catch {
        // ignore
      }

      try {
        const [histRows] = await pool.query(
          `SELECT h.id, h.rescue_id, h.new_status AS status, h.work_notes AS note, h.photo_url AS photo, h.created_at AS timestamp, u.name AS author
           FROM rescue_status_history h
           LEFT JOIN users u ON h.changed_by = u.id
           WHERE h.rescue_id IN (${rescueIn.placeholders})
           ORDER BY h.created_at DESC, h.id DESC`,
          rescueIn.params
        );
        for (const h of histRows) {
          if (!rescueTimelineMap.has(h.rescue_id)) rescueTimelineMap.set(h.rescue_id, []);
          rescueTimelineMap.get(h.rescue_id).push({
            id: h.id,
            status: normalizeAssignmentTimelineStatus(h.status, h.note || ''),
            note: h.note || '',
            photo: h.photo || null,
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
  const reportResidentEvidenceMap = new Map();
  const reportCompletionEvidenceMap = new Map();
  const reportTimelineMap = new Map();
  if (reportRows.length > 0) {
    const reportIn = buildInClause([...new Set(reportRows.map((r) => r.id))]);
    if (reportIn) {
      try {
        const [attRows] = await pool.query(
          `SELECT ia.incident_id, ia.file_url, ia.file_name, ia.file_type, ia.evidence_type, ia.assignment_id, ia.created_at,
                  u.name AS uploaded_by_name, u.role_id AS uploader_role_id
           FROM incident_attachments ia
           LEFT JOIN users u ON u.id = ia.uploaded_by
           WHERE ia.incident_id IN (${reportIn.placeholders})
           ORDER BY ia.created_at ASC`,
          reportIn.params
        );
        for (const a of attRows) {
          if (!reportPhotosMap.has(a.incident_id)) reportPhotosMap.set(a.incident_id, []);
          reportPhotosMap.get(a.incident_id).push(a.file_url);

          const evType = a.evidence_type || (Number(a.uploader_role_id) === 2 ? 'responder_completion' : 'resident_report');
          const evItem = {
            fileUrl: a.file_url,
            fileName: a.file_name || 'Photo Evidence',
            fileType: a.file_type || 'image/jpeg',
            evidenceType: evType,
            assignmentId: a.assignment_id || null,
            uploadedByName: a.uploaded_by_name || (evType === 'resident_report' ? 'Resident' : 'Responder'),
            createdAt: a.created_at,
          };
          if (evType === 'responder_completion') {
            if (!reportCompletionEvidenceMap.has(a.incident_id)) reportCompletionEvidenceMap.set(a.incident_id, []);
            reportCompletionEvidenceMap.get(a.incident_id).push(evItem);
          } else if (evType === 'resident_report') {
            if (!reportResidentEvidenceMap.has(a.incident_id)) reportResidentEvidenceMap.set(a.incident_id, []);
            reportResidentEvidenceMap.get(a.incident_id).push(evItem);
          }
        }
      } catch {
        // ignore
      }

      try {
        const [histRows] = await pool.query(
          `SELECT h.id, h.incident_id, h.new_status AS status, h.remarks AS note, h.created_at AS timestamp, u.name AS author
           FROM incident_status_history h
           LEFT JOIN users u ON h.changed_by = u.id
           WHERE h.incident_id IN (${reportIn.placeholders})
           ORDER BY h.created_at DESC, h.id DESC`,
          reportIn.params
        );
        for (const h of histRows) {
          if (!reportTimelineMap.has(h.incident_id)) reportTimelineMap.set(h.incident_id, []);
          reportTimelineMap.get(h.incident_id).push({
            id: h.id,
            status: normalizeAssignmentTimelineStatus(h.status, h.note || ''),
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

  const rescueOutcomeMap = new Map();
  const rescueTransportsMap = new Map();
  const rescueIds = [...new Set(rescueRows.map((r) => r.id))];
  if (rescueIds.length > 0) {
    const resIn = buildInClause(rescueIds);
    try {
      const [outRows] = await pool.query(
        `SELECT * FROM rescue_outcomes WHERE rescue_id IN (${resIn.placeholders})`,
        resIn.params
      );
      for (const o of outRows) {
        rescueOutcomeMap.set(o.rescue_id, {
          primaryOutcome: o.primary_outcome,
          totalRescued: Number(o.total_rescued || 0),
          firstAidCount: Number(o.first_aid_count || 0),
          hospitalTransportCount: Number(o.hospital_transport_count || 0),
          medicalFacilityCount: Number(o.medical_facility_count || 0),
          evacuationCenterCount: Number(o.evacuation_center_count || 0),
          stillAssistingCount: Number(o.still_assisting_count || 0),
          firstAidActions: o.first_aid_actions || '',
          furtherMedicalRecommended: Boolean(o.further_medical_recommended),
          transportRequired: Boolean(o.transport_required),
          otherDescription: o.other_description || '',
          adminCoordinationRequired: Boolean(o.admin_coordination_required),
          operationalNotes: o.operational_notes || '',
          recordedAt: o.recorded_at,
          updatedAt: o.updated_at,
        });
      }

      const [trRows] = await pool.query(
        `SELECT * FROM rescue_transports WHERE rescue_id IN (${resIn.placeholders}) ORDER BY created_at ASC, id ASC`,
        resIn.params
      );
      for (const t of trRows) {
        if (!rescueTransportsMap.has(t.rescue_id)) rescueTransportsMap.set(t.rescue_id, []);
        rescueTransportsMap.get(t.rescue_id).push({
          id: t.id,
          destinationCategory: t.destination_category,
          hospitalId: t.hospital_id,
          evacuationCenterId: t.evacuation_center_id,
          destinationName: t.destination_name,
          destinationFacilityType: t.destination_facility_type,
          latitude: t.destination_latitude !== null ? Number(t.destination_latitude) : null,
          longitude: t.destination_longitude !== null ? Number(t.destination_longitude) : null,
          peopleCount: Number(t.people_count || 1),
          routeDistanceMeters: t.route_distance_meters !== null ? Number(t.route_distance_meters) : null,
          routeDurationSeconds: t.route_duration_seconds !== null ? Number(t.route_duration_seconds) : null,
          transportStatus: t.transport_status,
          startedAt: t.started_at,
          arrivedAt: t.arrived_at,
          handedOverAt: t.handed_over_at,
          handoverConfirmed: Boolean(t.handover_confirmed),
          handoverNotes: t.handover_notes || '',
        });
      }
    } catch (_) {
      // ignore if tables unavailable
    }
  }

  const combined = [
    ...rescueRows.map((r) => ({
      id: r.reference_number || `RES-${r.id}`,
      dbId: r.id,
      rescueId: r.id,
      assignmentId: r.assignment_id || null,
      assignmentType: 'rescue',
      referenceNumber: r.reference_number || `RES-${r.id}`,
      title: r.emergency_type || 'Rescue Request',
      category: r.emergency_type,
      description: r.description,
      location: r.address || 'Barangay Bayanan, Muntinlupa City',
      landmark: r.landmark || '',
      coordinates: { lat: Number(r.latitude), lng: Number(r.longitude) },
      completionPhotoRequired: true,
      verifiedAt: r.verified_at || null,
      verifiedBy: r.verified_by || null,
      isPublic: Boolean(r.is_public),
      verificationStatus: String(r.status || '') === 'Cancelled'
        ? 'Rejected'
        : (r.verified_at || r.is_public)
          ? 'Verified'
          : 'Pending Verification',
      isUnassignedIncoming: !r.assignment_id,
      canClaim: !r.assignment_id && !['Completed', 'Cancelled'].includes(String(r.status || '')),
      status: !r.assignment_id
        ? (r.status === 'Completed' ? 'Completed' : 'Pending')
        : (r.status === 'Completed' || r.assignment_status === 'Completed'
            ? 'Completed'
            : r.status === 'In Progress'
              ? 'In Progress'
              : r.assignment_status || r.status || 'Assigned'),
      peopleCount: (r.people_count_category || 'exact') === 'exact' && r.people_count !== null ? Number(r.people_count) : null,
      peopleCountCategory: r.people_count_category || (r.people_count === null ? 'unknown' : 'exact'),
      peopleCountDisplay: formatPeopleCountDisplay(r.people_count, r.people_count_category || (r.people_count === null ? 'unknown' : 'exact')),
      vulnerableDetails: r.vulnerable_details || 'None specified',
      residentName: r.resident_name || 'Resident',
      residentPhone: r.resident_phone || '',
      assignedAt: r.assigned_at || r.created_at,
      submittedAt: r.created_at,
      acceptedAt: r.accepted_at || null,
      enRouteAt: r.en_route_at || null,
      onSceneAt: r.on_scene_at || null,
      completedAt: r.completed_at || null,
      timeline: rescueTimelineMap.get(r.id) || [],
      photos: rescuePhotosMap.get(r.id) || [],
      residentEvidence: rescueResidentEvidenceMap.get(r.id) || [],
      responderCompletionEvidence: rescueCompletionEvidenceMap.get(r.id) || [],
      dispatchInstructions: r.dispatch_instructions || (!r.assignment_id
        ? 'Incoming rescue request. Review details and click Accept & Respond to claim.'
        : 'Proceed to assigned scene and report status to EOC.'),
      outcome: rescueOutcomeMap.get(r.id) || null,
      transports: rescueTransportsMap.get(r.id) || [],
    })),
    ...reportRows.map((r) => ({
      id: r.reference_number || `REP-${r.id}`,
      dbId: r.id,
      reportId: r.id,
      assignmentId: r.assignment_id || null,
      assignmentType: 'incident',
      referenceNumber: r.reference_number || `REP-${r.id}`,
      title: r.title || `${r.incident_type} Incident`,
      category: r.incident_type,
      description: r.description,
      location: r.address || 'Barangay Bayanan, Muntinlupa City',
      coordinates: { lat: Number(r.latitude), lng: Number(r.longitude) },
      completionPhotoRequired: isCompletionPhotoRequired('incident', r),
      status: mapUnifiedIncidentStatus(r.status, r.assignment_status),
      rawStatus: r.status,
      verifiedAt: r.verified_at || null,
      verifiedBy: r.verified_by || null,
      isPublic: Boolean(r.is_public),
      verificationStatus: ['false_alarm', 'dismissed'].includes(String(r.status || '').toLowerCase())
        ? 'Rejected'
        : (r.verified_at || r.is_public || String(r.status || '').toLowerCase() === 'verified')
          ? 'Verified'
          : 'Pending Verification',
      isUnassignedIncoming: !r.assignment_id && !r.assigned_to,
      canClaim: !r.assignment_id && !r.assigned_to && !['resolved', 'false_alarm', 'dismissed'].includes(String(r.status || '').toLowerCase()),
      residentName: r.reporter_name || 'Resident',
      residentPhone: r.reporter_phone || '',
      assignedAt: r.assigned_at || r.created_at,
      submittedAt: r.created_at,
      acceptedAt: r.accepted_at || null,
      enRouteAt: r.en_route_at || null,
      onSceneAt: r.on_scene_at || null,
      completedAt: r.completed_at || null,
      timeline: reportTimelineMap.get(r.id) || [],
      photos: reportPhotosMap.get(r.id) || [],
      residentEvidence: reportResidentEvidenceMap.get(r.id) || [],
      responderCompletionEvidence: reportCompletionEvidenceMap.get(r.id) || [],
      dispatchInstructions: r.dispatch_instructions || ((!r.assignment_id && !r.assigned_to)
        ? 'Incoming incident report. Review details and click Accept & Respond to claim.'
        : 'Proceed to assigned scene and report status to Barangay Bayanan EOC.'),
    })),
  ];

  const recordTimestamp = (item) => {
    const raw = item && item.submittedAt ? item.submittedAt : null;
    const ms = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
  };
  return combined.sort((a, b) => {
    const timeDiff = recordTimestamp(b) - recordTimestamp(a);
    if (timeDiff !== 0) return timeDiff;
    const idDiff = (Number(b.dbId) || 0) - (Number(a.dbId) || 0);
    if (idDiff !== 0) return idDiff;
    return String(a.assignmentType || '').localeCompare(String(b.assignmentType || ''));
  });
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
    const assignments = await loadResponderAssignmentsForUser(req.user.id, req.user.role === 'admin');
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
    isInternalOnly,
    is_internal_only,
  } = req.body || {};

  const internalOnlyFlag = Boolean(isInternalOnly || is_internal_only);

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
        let authorizedIncident = Number(reportRow.assigned_to) === Number(req.user.id);
        if (!authorizedIncident) {
          const [latestIncRows] = await conn.query(
            `SELECT responder_user_id
             FROM incident_assignments
             WHERE report_id = ?
             ORDER BY assigned_at DESC, id DESC
             LIMIT 1`,
            [reportRow.id]
          );
          authorizedIncident = Boolean(
            latestIncRows.length && Number(latestIncRows[0].responder_user_id) === Number(req.user.id)
          );
        }
        if (!authorizedIncident) {
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

    // Enforce mandatory completion summary, photo evidence, and single-completion guard
    const isCompleting = statusLower === 'completed' || statusLower === 'resolved';
    if (isCompleting) {
      let latestAssignmentStatus = '';
      if (targetKind === 'rescue') {
        const [latestAssignRows] = await conn.query(
          `SELECT assignment_status
           FROM rescue_assignments
           WHERE rescue_id = ?
           ORDER BY assigned_at DESC, id DESC
           LIMIT 1`,
          [rescueRow.id]
        );
        latestAssignmentStatus = String(latestAssignRows[0]?.assignment_status || '');
      } else {
        const [latestIncAssignRows] = await conn.query(
          `SELECT assignment_status
           FROM incident_assignments
           WHERE report_id = ?
           ORDER BY assigned_at DESC, id DESC
           LIMIT 1`,
          [reportRow.id]
        );
        latestAssignmentStatus = String(latestIncAssignRows[0]?.assignment_status || '');
      }

      const alreadyCompleted =
        targetKind === 'rescue'
          ? String(rescueRow.status || '') === 'Completed' || latestAssignmentStatus === 'Completed'
          : String(reportRow.status || '').toLowerCase() === 'resolved' || latestAssignmentStatus === 'Completed';
      if (alreadyCompleted) {
        await conn.rollback();
        return res.status(409).json({ error: 'This assignment has already been completed.' });
      }
      if (targetKind !== 'rescue' && (!workNotes || !String(workNotes).trim())) {
        await conn.rollback();
        return res.status(400).json({ error: 'Please enter a completion summary.' });
      }

      if (targetKind === 'rescue') {
        const [trRows] = await conn.query(
          `SELECT id, destination_name, transport_status, arrived_at, handover_confirmed
           FROM rescue_transports
           WHERE rescue_id = ? AND transport_status <> 'Cancelled'`,
          [rescueRow.id]
        );
        const requiresTransport = trRows.length > 0;
        if (requiresTransport) {
          const incomplete = trRows.filter(
            (t) => t.transport_status !== 'Handed Over' || !t.handover_confirmed || !t.arrived_at
          );
          if (incomplete.length > 0) {
            await conn.rollback();
            return res.status(400).json({
              error: `Arrival and handover confirmation required for ${incomplete.map((i) => i.destination_name).join(', ')} before completing.`,
            });
          }
        }
      }
    }

    const requiresCompletionPhoto =
      isCompleting && isCompletionPhotoRequired(targetKind, targetKind === 'incident' ? reportRow : rescueRow);

    if (requiresCompletionPhoto && rawPhotoList.filter(Boolean).length === 0) {
      await conn.rollback();
      return res.status(400).json({
        error: 'Please capture at least one completion photo.',
      });
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

    if (requiresCompletionPhoto && savedPhotos.length === 0) {
      await conn.rollback();
      return res.status(400).json({
        error: 'A valid completion photo is required for this incident category.',
      });
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
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rescueRow.id, req.user.id, nextUpdateStatus, noteToSave, primaryPhotoUrl, internalOnlyFlag]
      );

      await conn.query(
        `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes, photo_url)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rescueRow.id, oldStatus, nextRescueStatus, req.user.id, noteToSave, primaryPhotoUrl]
      );

      const [latestResAssign] = await conn.query(
        `SELECT id FROM rescue_assignments WHERE rescue_id = ? ORDER BY assigned_at DESC, id DESC LIMIT 1`,
        [rescueRow.id]
      );
      const resAssignId = latestResAssign[0] ? latestResAssign[0].id : null;
      const resEvidenceType = nextRescueStatus === 'Completed' ? 'responder_completion' : 'responder_progress';

      for (const sp of savedPhotos) {
        await conn.query(
          `INSERT INTO rescue_attachments (rescue_id, file_url, file_name, file_type, file_size, uploaded_by, evidence_type, assignment_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [rescueRow.id, sp.publicUrl, sp.fileName, sp.mimeType, sp.byteLength, req.user.id, resEvidenceType, resAssignId]
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
      try {
        const { syncConversationsForRescueRequests } = require('../services/messageService');
        const { emitConversationAccessUpdated } = require('../services/socketService');
        await syncConversationsForRescueRequests();
        emitConversationAccessUpdated({
          rescueId: rescueRow.id,
          residentUserId: rescueRow.user_id,
          responderUserId: req.user.id,
          status: nextRescueStatus === 'Completed' ? 'Closed' : 'Active',
          reason: nextRescueStatus === 'Completed' ? 'Assignment Completed' : null,
        });
      } catch (_) {}
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

    const [latestIncAssign] = await conn.query(
      `SELECT id FROM incident_assignments
       WHERE report_id = ?
       ORDER BY assigned_at DESC, id DESC
       LIMIT 1`,
      [reportRow.id]
    );

    if (latestIncAssign.length > 0) {
      await conn.query(
        `UPDATE incident_assignments
         SET assignment_status = ?,
             accepted_at = CASE WHEN ? = 'Accepted' AND accepted_at IS NULL THEN CURRENT_TIMESTAMP ELSE accepted_at END,
             en_route_at = CASE WHEN ? = 'En Route' AND en_route_at IS NULL THEN CURRENT_TIMESTAMP ELSE en_route_at END,
             on_scene_at = CASE WHEN ? = 'On Scene' AND on_scene_at IS NULL THEN CURRENT_TIMESTAMP ELSE on_scene_at END,
             completed_at = CASE WHEN ? = 'Completed' AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END
         WHERE id = ?`,
        [
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
          latestIncAssign[0].id,
        ]
      );
    } else {
      await conn.query(
        `INSERT INTO incident_assignments (
           report_id, responder_user_id, assigned_by, assignment_status, dispatch_instructions,
           assigned_at, accepted_at, en_route_at, on_scene_at, completed_at
         )
         VALUES (
           ?, ?, ?, ?, 'Proceed to assigned scene and report status to Barangay Bayanan EOC.',
           CURRENT_TIMESTAMP,
           CASE WHEN ? = 'Accepted' THEN CURRENT_TIMESTAMP ELSE NULL END,
           CASE WHEN ? = 'En Route' THEN CURRENT_TIMESTAMP ELSE NULL END,
           CASE WHEN ? = 'On Scene' THEN CURRENT_TIMESTAMP ELSE NULL END,
           CASE WHEN ? = 'Completed' THEN CURRENT_TIMESTAMP ELSE NULL END
         )`,
        [
          reportRow.id,
          reportRow.assigned_to || req.user.id,
          req.user.id,
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
          nextAssignmentStatus,
        ]
      );
    }

    const noteToSave = fieldNotes || `Responder updated incident status to ${displayStatus}`;
    await conn.query(
      `INSERT INTO incident_updates (report_id, responder_user_id, status_update, work_notes, photo_url, is_internal_only)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [reportRow.id, req.user.id, nextIncidentUpdateStatus, noteToSave, primaryPhotoUrl, internalOnlyFlag]
    );

    await conn.query(
      `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, remarks)
       VALUES (?, ?, ?, ?, ?)`,
      [reportRow.id, oldStatus, nextReportStatus, req.user.id, noteToSave]
    );

    const incAssignId = latestIncAssign[0] ? latestIncAssign[0].id : null;
    const incEvidenceType = nextReportStatus === 'resolved' ? 'responder_completion' : 'responder_progress';

    for (const sp of savedPhotos) {
      await conn.query(
        `INSERT INTO incident_attachments (incident_id, file_url, file_name, file_type, file_size, uploaded_by, evidence_type, assignment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportRow.id, sp.publicUrl, sp.fileName, sp.mimeType, sp.byteLength, req.user.id, incEvidenceType, incAssignId]
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
    if (nextReportStatus === 'resolved' && oldStatus !== 'resolved') {
      emitIncidentResolved({
        id: reportRow.id,
        referenceNumber: refNumber,
        recordType: 'incident',
        status: 'resolved',
        residentId: reportRow.user_id,
        assignedTo: req.user.id,
      });
      dispatchIncidentResolvedCommunityBroadcast({
        incidentId: reportRow.id,
        referenceNumber: refNumber,
        incidentCategory: reportRow.incident_type,
        verifiedLocation: reportRow.address || reportRow.location,
        actorUserId: req.user.id,
      });
    }

    return res.json({
      message: 'Incident assignment status updated',
      assignment: updatePayload,
    });
  } catch (err) {
    await conn.rollback().catch(() => { });
    if (typeof savedPhotos !== 'undefined' && Array.isArray(savedPhotos)) {
      for (const sp of savedPhotos) {
        try {
          if (sp && sp.publicUrl) {
            const fp = path.join(__dirname, '../../frontend', sp.publicUrl);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
          }
        } catch (_) { }
      }
    }
    console.error('[Portal API] Responder assignment status update failed:', err.message);
    return res.status(503).json({ error: 'Unable to update assignment status' });
  } finally {
    conn.release();
  }
}

router.patch('/responder/assignments/:id/status', requireRole('responder', 'admin'), handleResponderAssignmentUpdate);
router.put('/responder/assignments/:id/status', requireRole('responder', 'admin'), handleResponderAssignmentUpdate);
router.post('/responder/assignments/:id/updates', requireRole('responder', 'admin'), handleResponderAssignmentUpdate);

router.post('/responder/assignments/:id/claim', requireRole('responder', 'admin'), async (req, res) => {
  const paramId = String(req.params.id || '').trim();
  const numericId = /^\d+$/.test(paramId) ? parseInt(paramId, 10) : -1;
  const requestedType = String((req.body && req.body.assignmentType) || '').trim().toLowerCase();
  const isRescueTarget = requestedType === 'rescue' || paramId.toUpperCase().startsWith('RES-');
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    if (req.user.role !== 'admin') {
      const [profRows] = await conn.query(
        `SELECT availability_status FROM responder_profiles WHERE user_id = ? LIMIT 1`,
        [req.user.id]
      );
      if (profRows.length && ['Off Duty', 'Off-Duty'].includes(String(profRows[0].availability_status || ''))) {
        await conn.rollback();
        return res.status(403).json({ error: 'Off-Duty responders cannot claim assignments.' });
      }
    }

    if (isRescueTarget) {
      const [rescueRows] = await conn.query(
        `SELECT *
         FROM rescue_requests
         WHERE reference_number = ? OR id = ?
         LIMIT 1
         FOR UPDATE`,
        [paramId, numericId]
      );

      if (!rescueRows.length) {
        await conn.rollback();
        return res.status(404).json({ error: 'Rescue request not found.' });
      }

      const rescueRow = rescueRows[0];
      if (['Completed', 'Cancelled'].includes(String(rescueRow.status || ''))) {
        await conn.rollback();
        return res.status(409).json({ error: 'Completed or cancelled rescue requests cannot be claimed.' });
      }

      const [activeAssignRows] = await conn.query(
        `SELECT id, responder_user_id, assignment_status
         FROM rescue_assignments
         WHERE rescue_id = ?
           AND assignment_status <> 'Completed'
         ORDER BY assigned_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`,
        [rescueRow.id]
      );

      if (activeAssignRows.length > 0) {
        await conn.rollback();
        return res.status(409).json({ error: 'This rescue request has already been claimed by another responder.' });
      }

      const [assignResult] = await conn.query(
        `INSERT INTO rescue_assignments (
           rescue_id, responder_user_id, assigned_by, assignment_status, dispatch_instructions,
           assigned_at, accepted_at, en_route_at
         )
         VALUES (?, ?, ?, 'En Route', 'Direct responder response initiated. Live GPS navigation active.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [rescueRow.id, req.user.id, req.user.id]
      );

      await conn.query(
        `UPDATE rescue_requests
         SET status = 'En Route',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [rescueRow.id]
      );

      await conn.query(
        `INSERT INTO rescue_updates (rescue_id, responder_user_id, status_update, work_notes, is_internal_only)
         VALUES (?, ?, 'Accepted', ?, FALSE)`,
        [rescueRow.id, req.user.id, `${req.user.name || 'Responder'} accepted and is responding directly to the rescue request.`]
      );

      await conn.query(
        `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes)
         VALUES (?, ?, 'Accepted', ?, ?)`,
        [rescueRow.id, rescueRow.status, req.user.id, 'Direct responder claim (Accept & Respond)']
      );

      const refCode = rescueRow.reference_number || `RES-${rescueRow.id}`;
      const [notifRes] = await conn.query(
        `INSERT INTO notifications (title, message, category, created_by)
         VALUES (?, ?, 'Alert', ?)`,
        [
          `Responder Responding: ${refCode}`,
          `${req.user.name || 'A responder'} accepted rescue request ${refCode} and is preparing to navigate to your location.`,
          req.user.id,
        ]
      );

      const [adminUsers] = await conn.query(
        `SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE LOWER(r.name) IN ('admin', 'administrator') AND u.status = 'active'`
      );
      const recipientIds = new Set(adminUsers.map((u) => Number(u.id)));
      if (rescueRow.user_id) recipientIds.add(Number(rescueRow.user_id));

      for (const recipientId of recipientIds) {
        await conn.query(
          `INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?)`,
          [notifRes.insertId, recipientId]
        );
      }

      await conn.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
         VALUES (?, 'RESPONDER_CLAIM_RESCUE', 'rescue_requests', ?, ?, ?, ?)`,
        [
          req.user.id,
          rescueRow.id,
          JSON.stringify({ assignment_id: assignResult.insertId, responder_user_id: req.user.id, status: 'Accepted' }),
          req.ip || null,
          req.headers['user-agent'] || null,
        ]
      );

      await conn.commit();

      emitAssignmentUpdate({
        assignmentId: assignResult.insertId,
        rescueId: rescueRow.id,
        assignmentType: 'rescue',
        referenceNumber: refCode,
        responderId: req.user.id,
        responderName: req.user.name || 'Responder',
        assignmentStatus: 'Accepted',
        status: 'Accepted',
        userId: rescueRow.user_id,
      });

      emitStatusUpdate({
        rescueId: rescueRow.id,
        assignmentType: 'rescue',
        referenceNumber: refCode,
        userId: rescueRow.user_id,
        status: 'Accepted',
        assignmentStatus: 'Accepted',
        updatedBy: req.user.name || 'Responder',
      });

      const assignments = await loadResponderAssignmentsForUser(req.user.id, req.user.role === 'admin');
      const updatedAssignment = assignments.find((a) => Number(a.dbId) === Number(rescueRow.id) && a.assignmentType === 'rescue');

      return res.json({
        message: 'Rescue request claimed successfully. Ready to start navigation.',
        assignmentId: assignResult.insertId,
        rescueId: rescueRow.id,
        assignment: updatedAssignment || {
          id: refCode,
          dbId: rescueRow.id,
          rescueId: rescueRow.id,
          assignmentId: assignResult.insertId,
          assignmentType: 'rescue',
          status: 'Accepted',
        },
      });
    }

    const [reportRows] = await conn.query(
      `SELECT *
       FROM reports
       WHERE reference_number = ? OR id = ?
       LIMIT 1
       FOR UPDATE`,
      [paramId, numericId]
    );

    if (!reportRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Incident report not found.' });
    }

    const reportRow = reportRows[0];
    if (reportRow.source_rescue_id) {
      await conn.rollback();
      return res.status(409).json({ error: 'Public awareness incidents generated from verified rescue requests cannot be claimed as separate assignments.' });
    }
    const currentStatus = String(reportRow.status || '').toLowerCase();
    if (['resolved', 'false_alarm', 'dismissed'].includes(currentStatus)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Closed or rejected incident reports cannot be claimed.' });
    }

    const [activeAssignRows] = await conn.query(
      `SELECT id, responder_user_id, assignment_status
       FROM incident_assignments
       WHERE report_id = ?
         AND assignment_status NOT IN ('Completed', 'Cancelled')
       ORDER BY assigned_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [reportRow.id]
    );

    if (reportRow.assigned_to || activeAssignRows.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'This incident report has already been claimed by another responder.' });
    }

    if (req.user.role !== 'admin') {
      const [profRows] = await conn.query(
        `SELECT availability_status FROM responder_profiles WHERE user_id = ? LIMIT 1`,
        [req.user.id]
      );
      if (profRows.length && ['Off Duty', 'Off-Duty'].includes(String(profRows[0].availability_status || ''))) {
        await conn.rollback();
        return res.status(403).json({ error: 'Off-Duty responders cannot claim incident reports.' });
      }
    }

    const [assignResult] = await conn.query(
      `INSERT INTO incident_assignments (
         report_id, responder_user_id, assigned_by, assignment_status, dispatch_instructions,
         assigned_at, accepted_at, en_route_at
       )
       VALUES (?, ?, ?, 'En Route', 'Direct responder response initiated. Live GPS navigation active.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [reportRow.id, req.user.id, req.user.id]
    );

    const nextReportStatus = ['pending', 'verified'].includes(currentStatus) ? 'responding' : reportRow.status;

    await conn.query(
      `UPDATE reports
       SET assigned_to = ?,
           status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.user.id, nextReportStatus, reportRow.id]
    );

    await conn.query(
      `INSERT INTO incident_updates (report_id, responder_user_id, status_update, work_notes, is_internal_only)
       VALUES (?, ?, 'Accepted', ?, FALSE)`,
      [reportRow.id, req.user.id, `${req.user.name || 'Responder'} accepted and is responding directly to the incident.`]
    );

    await conn.query(
      `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, remarks)
       VALUES (?, ?, ?, ?, ?)`,
      [reportRow.id, reportRow.status, nextReportStatus, req.user.id, 'Direct responder claim (Accept & Respond)']
    );

    const refCode = reportRow.reference_number || `REP-${reportRow.id}`;
    const [notifRes] = await conn.query(
      `INSERT INTO notifications (title, message, category, created_by)
       VALUES (?, ?, 'Alert', ?)`,
      [
        `Responder Responding: ${refCode}`,
        `${req.user.name || 'A responder'} accepted ${refCode} and is preparing to navigate to the scene.`,
        req.user.id,
      ]
    );

    const [adminUsers] = await conn.query(
      `SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE LOWER(r.name) IN ('admin', 'administrator') AND u.status = 'active'`
    );
    const recipientIds = new Set(adminUsers.map((u) => Number(u.id)));
    if (reportRow.user_id) recipientIds.add(Number(reportRow.user_id));

    for (const recipientId of recipientIds) {
      await conn.query(
        `INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?)`,
        [notifRes.insertId, recipientId]
      );
    }

    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
       VALUES (?, 'RESPONDER_CLAIM_INCIDENT', 'reports', ?, ?, ?, ?)`,
      [
        req.user.id,
        reportRow.id,
        JSON.stringify({ assignment_id: assignResult.insertId, responder_user_id: req.user.id, status: nextReportStatus }),
        req.ip || null,
        req.headers['user-agent'] || null,
      ]
    );

    await conn.commit();

    emitAssignmentUpdate({
      assignmentId: assignResult.insertId,
      reportId: reportRow.id,
      referenceNumber: refCode,
      responderId: req.user.id,
      responderName: req.user.name || 'Responder',
      assignmentStatus: 'Accepted',
      status: 'Accepted',
      userId: reportRow.user_id,
    });

    emitStatusUpdate({
      reportId: reportRow.id,
      referenceNumber: refCode,
      userId: reportRow.user_id,
      status: nextReportStatus,
      assignmentStatus: 'Accepted',
      updatedBy: req.user.name || 'Responder',
    });

    const assignments = await loadResponderAssignmentsForUser(req.user.id, req.user.role === 'admin');
    const updatedAssignment = assignments.find((a) => Number(a.dbId) === Number(reportRow.id) && a.assignmentType === 'incident');

    return res.json({
      message: 'Incident claimed successfully. Ready to start navigation.',
      assignmentId: assignResult.insertId,
      reportId: reportRow.id,
      assignment: updatedAssignment || {
        id: refCode,
        dbId: reportRow.id,
        reportId: reportRow.id,
        assignmentId: assignResult.insertId,
        assignmentType: 'incident',
        status: 'Accepted',
        rawStatus: nextReportStatus,
        isPublic: Boolean(reportRow.is_public),
        verifiedAt: reportRow.verified_at || null,
      },
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_e) {}
    console.error('[Portal API] POST /responder/assignments/:id/claim failed:', err.message);
    return res.status(503).json({ error: 'Unable to claim incident report' });
  } finally {
    conn.release();
  }
});

router.patch('/responder/assignments/:id/verify', requireRole('responder', 'admin'), async (req, res) => {
  const paramId = String(req.params.id || '').trim();
  const numericId = /^\d+$/.test(paramId) ? parseInt(paramId, 10) : -1;
  const requestedType = String((req.body && req.body.assignmentType) || '').trim().toLowerCase();
  const isRescueTarget = requestedType === 'rescue' || paramId.toUpperCase().startsWith('RES-');
  const action = String((req.body && req.body.action) || '').trim().toLowerCase();
  const reason = String((req.body && (req.body.reason || req.body.notes)) || '').trim();

  if (!['verify', 'reject'].includes(action)) {
    return res.status(400).json({ error: "Invalid verification action. Expected 'verify' or 'reject'." });
  }
  if (action === 'reject' && !reason) {
    return res.status(400).json({ error: 'A rejection reason is required when rejecting.' });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    if (isRescueTarget) {
      const [rescueRows] = await conn.query(
        `SELECT rr.*
         FROM rescue_requests rr
         WHERE rr.reference_number = ?
            OR rr.id = ?
            OR rr.id IN (SELECT rescue_id FROM rescue_assignments WHERE id = ?)
         LIMIT 1
         FOR UPDATE`,
        [paramId, numericId, numericId]
      );

      if (!rescueRows.length) {
        await conn.rollback();
        return res.status(404).json({ error: 'Rescue request not found.' });
      }

      const rescueRow = rescueRows[0];
      const [latestAssignRows] = await conn.query(
        `SELECT id, responder_user_id, assignment_status, on_scene_at
         FROM rescue_assignments
         WHERE rescue_id = ?
         ORDER BY assigned_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`,
        [rescueRow.id]
      );

      const assignedResponderId = latestAssignRows[0] ? latestAssignRows[0].responder_user_id : null;
      if (req.user.role !== 'admin' && Number(assignedResponderId) !== Number(req.user.id)) {
        await conn.rollback();
        return res.status(403).json({ error: 'Only the assigned responder or an administrator can verify this rescue request.' });
      }

      const isOnScene = Boolean(
        (latestAssignRows[0] && latestAssignRows[0].on_scene_at) ||
        ['on scene', 'on_site', 'completed'].includes(String(rescueRow.status || '').toLowerCase()) ||
        ['on scene', 'completed'].includes(String((latestAssignRows[0] && latestAssignRows[0].assignment_status) || '').toLowerCase())
      );
      if (action === 'verify' && req.user.role !== 'admin' && !isOnScene) {
        await conn.rollback();
        return res.status(409).json({ error: 'Please arrive On Scene before verifying and publishing a public hazard awareness incident.' });
      }

      if (String(rescueRow.status || '') === 'Cancelled') {
        await conn.rollback();
        return res.status(409).json({ error: 'This rescue request has already been rejected.' });
      }
      if (rescueRow.verified_at || rescueRow.is_public) {
        await conn.rollback();
        return res.status(409).json({ error: 'This rescue request has already been verified.' });
      }

      const refCode = rescueRow.reference_number || `RES-${rescueRow.id}`;
      let nextRescueStatus = rescueRow.status;
      const nextIsPublic = false;
      let linkedPublicReport = null;

      if (action === 'verify') {
        const rawHazard = String((req.body && req.body.hazardType) || '').trim().toLowerCase();
        const emLower = String(rescueRow.emergency_type || '').toLowerCase();
        let resolvedHazard = '';
        if (rawHazard === 'fire' || rawHazard === 'fire incident') resolvedHazard = 'Fire';
        else if (rawHazard === 'flood' || rawHazard === 'flood incident') resolvedHazard = 'Flood';
        else if (emLower.includes('fire')) resolvedHazard = 'Fire';
        else if (emLower.includes('flood')) resolvedHazard = 'Flood';

        if (!resolvedHazard) {
          await conn.rollback();
          return res.status(400).json({ error: 'Please select the verified hazard type (Fire or Flood).' });
        }

        const publicIncidentType = resolvedHazard === 'Fire' ? 'Fire Incident' : 'Flood Incident';
        const safeAddress = rescueRow.address || 'Barangay Bayanan, Muntinlupa City';
        const publicTitle = `${publicIncidentType} — ${safeAddress}`;
        const publicDescription = `Verified ${resolvedHazard.toLowerCase()} hazard reported in ${safeAddress}. Emergency responders on scene.`;

        await conn.query(
          `UPDATE rescue_requests
           SET verified_by = ?,
               verified_at = CURRENT_TIMESTAMP,
               is_public = FALSE,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [req.user.id, rescueRow.id]
        );

        const verifyNote = reason || `${req.user.name || 'Responder'} verified the ${resolvedHazard.toLowerCase()} rescue situation on scene.`;
        await conn.query(
          `INSERT INTO rescue_updates (rescue_id, responder_user_id, status_update, work_notes, is_internal_only)
           VALUES (?, ?, 'On Scene', ?, FALSE)`,
          [rescueRow.id, req.user.id, verifyNote]
        );
        await conn.query(
          `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes)
           VALUES (?, ?, ?, ?, ?)`,
          [rescueRow.id, rescueRow.status, rescueRow.status, req.user.id, verifyNote]
        );

        const [existingLinked] = await conn.query(
          `SELECT * FROM reports WHERE source_rescue_id = ? LIMIT 1 FOR UPDATE`,
          [rescueRow.id]
        );

        if (existingLinked.length > 0) {
          await conn.query(
            `UPDATE reports
             SET incident_type = ?,
                 title = ?,
                 description = ?,
                 latitude = ?,
                 longitude = ?,
                 address = ?,
                 status = CASE WHEN status = 'pending' THEN 'verified' ELSE status END,
                 is_public = TRUE,
                 verified_by = ?,
                 verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
              publicIncidentType,
              publicTitle,
              publicDescription,
              rescueRow.latitude,
              rescueRow.longitude,
              safeAddress,
              req.user.id,
              existingLinked[0].id,
            ]
          );
          const [refreshedLinked] = await conn.query(`SELECT * FROM reports WHERE id = ? LIMIT 1`, [existingLinked[0].id]);
          linkedPublicReport = refreshedLinked[0];
        } else {
          const year = new Date().getFullYear();
          const tempIncRef = `INC-TMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const [incIns] = await conn.query(
            `INSERT INTO reports (
               reference_number, user_id, incident_type, title, description,
               latitude, longitude, address, status, is_public, assigned_to,
               verified_by, verified_at, source_rescue_id
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', TRUE, NULL, ?, CURRENT_TIMESTAMP, ?)`,
            [
              tempIncRef,
              rescueRow.user_id,
              publicIncidentType,
              publicTitle,
              publicDescription,
              rescueRow.latitude,
              rescueRow.longitude,
              safeAddress,
              req.user.id,
              rescueRow.id,
            ]
          );
          const finalIncRef = `INC-${year}-${String(incIns.insertId).padStart(6, '0')}`;
          await conn.query(`UPDATE reports SET reference_number = ? WHERE id = ?`, [finalIncRef, incIns.insertId]);

          await conn.query(
            `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, remarks)
             VALUES (?, NULL, 'verified', ?, ?)`,
            [incIns.insertId, req.user.id, `Linked public ${publicIncidentType} published from verified rescue ${refCode}`]
          );

          await conn.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
             VALUES (?, 'LINKED_PUBLIC_HAZARD_PUBLISHED', 'reports', ?, ?, ?, ?)`,
            [
              req.user.id,
              incIns.insertId,
              JSON.stringify({ source_rescue_id: rescueRow.id, incident_type: publicIncidentType, is_public: true }),
              req.ip || null,
              req.headers['user-agent'] || null,
            ]
          );

          const [createdLinked] = await conn.query(`SELECT * FROM reports WHERE id = ? LIMIT 1`, [incIns.insertId]);
          linkedPublicReport = createdLinked[0];
        }
      } else {
        nextRescueStatus = 'Cancelled';
        await conn.query(
          `UPDATE rescue_requests
           SET status = 'Cancelled',
               verified_by = ?,
               verified_at = CURRENT_TIMESTAMP,
               is_public = FALSE,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [req.user.id, rescueRow.id]
        );
        await conn.query(
          `UPDATE rescue_assignments
           SET assignment_status = 'Completed',
               completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
           WHERE rescue_id = ?
             AND assignment_status <> 'Completed'`,
          [rescueRow.id]
        );
        await conn.query(
          `INSERT INTO rescue_updates (rescue_id, responder_user_id, status_update, work_notes, is_internal_only)
           VALUES (?, ?, 'Completed', ?, FALSE)`,
          [rescueRow.id, req.user.id, `Rescue request rejected: ${reason}`]
        );
        await conn.query(
          `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes)
           VALUES (?, ?, 'Cancelled', ?, ?)`,
          [rescueRow.id, rescueRow.status, req.user.id, `Rejected by responder: ${reason}`]
        );
      }

      const [notifRes] = await conn.query(
        `INSERT INTO notifications (title, message, category, created_by)
         VALUES (?, ?, 'Alert', ?)`,
        [
          action === 'verify' ? `Rescue Verified: ${refCode}` : `Rescue Request Rejected: ${refCode}`,
          action === 'verify'
            ? `Rescue request ${refCode} has been verified by ${req.user.name || 'the responder'}.`
            : `Rescue request ${refCode} was rejected as unverified. Reason: ${reason}`,
          req.user.id,
        ]
      );

      const [adminUsers] = await conn.query(
        `SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE LOWER(r.name) IN ('admin', 'administrator') AND u.status = 'active'`
      );
      const recipientIds = new Set(adminUsers.map((u) => Number(u.id)));
      if (rescueRow.user_id) recipientIds.add(Number(rescueRow.user_id));

      for (const recipientId of recipientIds) {
        await conn.query(
          `INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?)`,
          [notifRes.insertId, recipientId]
        );
      }

      await conn.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
         VALUES (?, ?, 'rescue_requests', ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          action === 'verify' ? 'RESPONDER_VERIFY_RESCUE' : 'RESPONDER_REJECT_RESCUE',
          rescueRow.id,
          JSON.stringify({ status: rescueRow.status, is_public: Boolean(rescueRow.is_public) }),
          JSON.stringify({ status: nextRescueStatus, is_public: nextIsPublic, reason: reason || null }),
          req.ip || null,
          req.headers['user-agent'] || null,
        ]
      );

      await conn.commit();

      emitReportVerificationResult({
        rescueId: rescueRow.id,
        assignmentType: 'rescue',
        referenceNumber: refCode,
        userId: rescueRow.user_id,
        status: nextRescueStatus,
        verifiedBy: req.user.name || 'Responder',
        isPublic: nextIsPublic,
        reason: action === 'reject' ? reason : undefined,
      });

      emitStatusUpdate({
        rescueId: rescueRow.id,
        assignmentType: 'rescue',
        referenceNumber: refCode,
        userId: rescueRow.user_id,
        status: nextRescueStatus,
        assignmentStatus: action === 'reject' ? 'Completed' : undefined,
        updatedBy: req.user.name || 'Responder',
      });

      if (linkedPublicReport) {
        emitPublicVerifiedReport(linkedPublicReport);
      }

      return res.json({
        message: action === 'verify'
          ? 'Rescue situation verified and linked public hazard incident published.'
          : 'Rescue request rejected and kept private.',
        linkedPublicIncident: linkedPublicReport ? {
          id: linkedPublicReport.id,
          referenceNumber: linkedPublicReport.reference_number,
          incidentType: linkedPublicReport.incident_type,
          isPublic: true,
        } : null,
        rescue: {
          id: rescueRow.id,
          referenceNumber: refCode,
          status: nextRescueStatus,
          isPublic: false,
          verifiedAt: new Date().toISOString(),
        },
      });
    }

    const [reportRows] = await conn.query(
      `SELECT r.*
       FROM reports r
       WHERE r.reference_number = ?
          OR r.id = ?
          OR r.id IN (SELECT report_id FROM incident_assignments WHERE id = ?)
       LIMIT 1
       FOR UPDATE`,
      [paramId, numericId, numericId]
    );

    if (!reportRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Incident report not found.' });
    }

    const reportRow = reportRows[0];
    const [latestAssignRows] = await conn.query(
      `SELECT id, responder_user_id, assignment_status
       FROM incident_assignments
       WHERE report_id = ?
       ORDER BY assigned_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [reportRow.id]
    );

    const assignedResponderId = latestAssignRows[0] ? latestAssignRows[0].responder_user_id : reportRow.assigned_to;
    if (req.user.role !== 'admin' && Number(assignedResponderId) !== Number(req.user.id)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Only the assigned responder or an administrator can verify this incident report.' });
    }

    const currentStatus = String(reportRow.status || '').toLowerCase();
    if (['false_alarm', 'dismissed'].includes(currentStatus)) {
      await conn.rollback();
      return res.status(409).json({ error: 'This incident report has already been rejected.' });
    }
    if (reportRow.verified_at || reportRow.is_public) {
      await conn.rollback();
      return res.status(409).json({ error: 'This incident report has already been verified.' });
    }

    const refCode = reportRow.reference_number || `REP-${reportRow.id}`;
    let nextReportStatus = reportRow.status;
    let nextIsPublic = false;

    if (action === 'verify') {
      nextReportStatus = ['pending', 'verified'].includes(currentStatus) ? 'verified' : reportRow.status;
      nextIsPublic = true;

      await conn.query(
        `UPDATE reports
         SET status = ?,
             verified_by = ?,
             verified_at = CURRENT_TIMESTAMP,
             is_public = TRUE,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextReportStatus, req.user.id, reportRow.id]
      );

      const verifyNote = reason || `${req.user.name || 'Responder'} verified the incident on scene.`;
      await conn.query(
        `INSERT INTO incident_updates (report_id, responder_user_id, status_update, work_notes, is_internal_only)
         VALUES (?, ?, 'In Progress', ?, FALSE)`,
        [reportRow.id, req.user.id, verifyNote]
      );

      await conn.query(
        `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, remarks)
         VALUES (?, ?, ?, ?, ?)`,
        [reportRow.id, reportRow.status, nextReportStatus, req.user.id, verifyNote]
      );
    } else {
      nextReportStatus = 'false_alarm';
      nextIsPublic = false;

      await conn.query(
        `UPDATE reports
         SET status = 'false_alarm',
             verified_by = ?,
             verified_at = CURRENT_TIMESTAMP,
             is_public = FALSE,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [req.user.id, reportRow.id]
      );

      await conn.query(
        `UPDATE incident_assignments
         SET assignment_status = 'Completed',
             completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
         WHERE report_id = ?
           AND assignment_status <> 'Completed'`,
        [reportRow.id]
      );

      await conn.query(
        `INSERT INTO incident_updates (report_id, responder_user_id, status_update, work_notes, is_internal_only)
         VALUES (?, ?, 'Completed', ?, FALSE)`,
        [reportRow.id, req.user.id, `Report rejected: ${reason}`]
      );

      await conn.query(
        `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, remarks)
         VALUES (?, ?, 'false_alarm', ?, ?)`,
        [reportRow.id, reportRow.status, req.user.id, `Rejected by responder: ${reason}`]
      );
    }

    const [notifRes] = await conn.query(
      `INSERT INTO notifications (title, message, category, created_by)
       VALUES (?, ?, 'Alert', ?)`,
      [
        action === 'verify' ? `Incident Verified: ${refCode}` : `Incident Report Rejected: ${refCode}`,
        action === 'verify'
          ? `Report ${refCode} has been verified by ${req.user.name || 'the responder'} and published to the community safety map.`
          : `Report ${refCode} was rejected as unverified/false alarm. Reason: ${reason}`,
        req.user.id,
      ]
    );

    const [adminUsers] = await conn.query(
      `SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE LOWER(r.name) IN ('admin', 'administrator') AND u.status = 'active'`
    );
    const recipientIds = new Set(adminUsers.map((u) => Number(u.id)));
    if (reportRow.user_id) recipientIds.add(Number(reportRow.user_id));

    for (const recipientId of recipientIds) {
      await conn.query(
        `INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?)`,
        [notifRes.insertId, recipientId]
      );
    }

    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES (?, ?, 'reports', ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        action === 'verify' ? 'RESPONDER_VERIFY_REPORT' : 'RESPONDER_REJECT_REPORT',
        reportRow.id,
        JSON.stringify({ status: reportRow.status, is_public: Boolean(reportRow.is_public) }),
        JSON.stringify({ status: nextReportStatus, is_public: nextIsPublic, reason: reason || null }),
        req.ip || null,
        req.headers['user-agent'] || null,
      ]
    );

    await conn.commit();

    const [updatedRows] = await pool.query('SELECT * FROM reports WHERE id = ? LIMIT 1', [reportRow.id]);
    const updatedReport = updatedRows[0] || { ...reportRow, status: nextReportStatus, is_public: nextIsPublic };

    emitReportVerificationResult({
      reportId: reportRow.id,
      referenceNumber: refCode,
      userId: reportRow.user_id,
      status: nextReportStatus,
      verifiedBy: req.user.name || 'Responder',
      isPublic: nextIsPublic,
      reason: action === 'reject' ? reason : undefined,
    });

    if (action === 'verify') {
      emitPublicVerifiedReport(updatedReport);
    } else {
      emitStatusUpdate({
        reportId: reportRow.id,
        referenceNumber: refCode,
        userId: reportRow.user_id,
        status: nextReportStatus,
        assignmentStatus: 'Completed',
        updatedBy: req.user.name || 'Responder',
      });
    }

    return res.json({
      message: action === 'verify' ? 'Incident report verified and published.' : 'Incident report rejected and kept private.',
      report: {
        id: reportRow.id,
        referenceNumber: refCode,
        status: nextReportStatus,
        isPublic: nextIsPublic,
        verifiedAt: updatedReport.verified_at || new Date().toISOString(),
      },
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_e) {}
    console.error('[Portal API] PATCH /responder/assignments/:id/verify failed:', err.message);
    return res.status(503).json({ error: 'Unable to update incident verification' });
  } finally {
    conn.release();
  }
});

async function resolveOwnedRescueForResponder(conn, paramId, user) {
  const numericId = /^\d+$/.test(paramId) ? parseInt(paramId, 10) : -1;
  const [rRows] = await conn.query(
    `SELECT rr.*
     FROM rescue_requests rr
     LEFT JOIN rescue_assignments ra ON ra.rescue_id = rr.id
     WHERE rr.reference_number = ? OR rr.id = ? OR ra.id = ?
     LIMIT 1`,
    [paramId, numericId, numericId]
  );
  if (!rRows.length) return { errorStatus: 404, error: 'Rescue assignment not found.' };
  const rescueRow = rRows[0];

  if (user.role !== 'admin') {
    const [latestRows] = await conn.query(
      `SELECT responder_user_id FROM rescue_assignments WHERE rescue_id = ? ORDER BY assigned_at DESC, id DESC LIMIT 1`,
      [rescueRow.id]
    );
    if (!latestRows.length || Number(latestRows[0].responder_user_id) !== Number(user.id)) {
      return { errorStatus: 403, error: 'You are not authorized to update this rescue assignment.' };
    }
  }
  return { rescueRow };
}

router.post('/responder/assignments/:id/outcome', requireRole('responder', 'admin'), async (req, res) => {
  const paramId = String(req.params.id || '').trim();
  const {
    primaryOutcome,
    totalRescued = 0,
    firstAidCount = 0,
    hospitalTransportCount = 0,
    medicalFacilityCount = 0,
    evacuationCenterCount = 0,
    stillAssistingCount = 0,
    firstAidActions = '',
    furtherMedicalRecommended = false,
    transportRequired,
    otherDescription = '',
    adminCoordinationRequired = false,
    operationalNotes = '',
    transports = [],
  } = req.body || {};

  const validOutcomes = ['first_aid', 'hospital', 'medical_facility', 'evacuation_center', 'other'];
  if (!validOutcomes.includes(primaryOutcome)) {
    return res.status(400).json({ error: 'Invalid rescue outcome option.' });
  }

  const parsedTotal = Math.max(0, parseInt(totalRescued, 10) || 0);
  const parsedFirstAid = Math.max(0, parseInt(firstAidCount, 10) || 0);
  const parsedHospital = Math.max(0, parseInt(hospitalTransportCount, 10) || 0);
  const parsedMedFac = Math.max(0, parseInt(medicalFacilityCount, 10) || 0);
  const parsedEvac = Math.max(0, parseInt(evacuationCenterCount, 10) || 0);
  const parsedStill = Math.max(0, parseInt(stillAssistingCount, 10) || 0);

  if (primaryOutcome === 'first_aid' && !String(firstAidActions || '').trim() && !String(operationalNotes || '').trim()) {
    return res.status(400).json({ error: 'Please record the first-aid actions performed.' });
  }
  if (primaryOutcome === 'other' && !String(otherDescription || '').trim()) {
    return res.status(400).json({ error: 'Please provide a description for Other / Special Assistance.' });
  }

  const transportList = Array.isArray(transports) ? transports : [];
  const outcomeRequiresTransport = ['hospital', 'medical_facility', 'evacuation_center'].includes(primaryOutcome);
  const needsTransport = outcomeRequiresTransport;

  if (!outcomeRequiresTransport && transportList.length > 0) {
    return res.status(400).json({
      error: 'Transport destinations are not allowed for First Aid / On-Site Assistance or Other / Special Assistance.',
    });
  }

  if (needsTransport && transportList.length === 0) {
    return res.status(400).json({ error: 'Please select a transport destination when transportation is required.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resolved = await resolveOwnedRescueForResponder(conn, paramId, req.user);
    if (resolved.error) {
      await conn.rollback();
      return res.status(resolved.errorStatus).json({ error: resolved.error });
    }
    const rescueRow = resolved.rescueRow;

    if (rescueRow.status === 'Completed' || rescueRow.status === 'Cancelled') {
      await conn.rollback();
      return res.status(409).json({ error: 'Cannot modify outcome of a completed or cancelled rescue operation.' });
    }

    // Validate every requested transport destination against Primary Rescue Outcome & PostgreSQL records
    const validatedTransports = [];
    for (const t of transportList) {
      const cat = String(t.destinationCategory || '').toLowerCase();
      if (!['hospital', 'medical_facility', 'evacuation_center'].includes(cat)) {
        await conn.rollback();
        return res.status(400).json({ error: 'Invalid transport destination category.' });
      }
      if (cat !== primaryOutcome) {
        await conn.rollback();
        return res.status(400).json({
          error: `Destination category "${cat}" does not match Primary Rescue Outcome "${primaryOutcome}".`,
        });
      }
      const pCount = Math.max(1, parseInt(t.peopleCount, 10) || 1);
      const distMeters = Number.isFinite(Number(t.routeDistanceMeters)) ? Math.round(Number(t.routeDistanceMeters)) : null;
      const durSeconds = Number.isFinite(Number(t.routeDurationSeconds)) ? Math.round(Number(t.routeDurationSeconds)) : null;

      if (cat === 'evacuation_center') {
        const ecId = parseInt(t.evacuationCenterId || t.facilityId, 10);
        if (!Number.isFinite(ecId) || ecId <= 0) {
          await conn.rollback();
          return res.status(400).json({ error: 'Invalid evacuation center ID.' });
        }
        const [ecRows] = await conn.query('SELECT * FROM evacuation_centers WHERE id = ? LIMIT 1', [ecId]);
        if (!ecRows.length) {
          await conn.rollback();
          return res.status(404).json({ error: 'Selected evacuation center does not exist.' });
        }
        const ec = ecRows[0];
        if (['Full', 'Full / Closed', 'Temporarily Closed', 'Inactive'].includes(ec.status)) {
          await conn.rollback();
          return res.status(400).json({ error: `${ec.name} is currently ${ec.status} and cannot accept new evacuation assignments.` });
        }
        validatedTransports.push({
          destinationCategory: cat,
          hospitalId: null,
          evacuationCenterId: ec.id,
          destinationName: ec.name,
          destinationFacilityType: 'Evacuation Center',
          latitude: Number(ec.latitude),
          longitude: Number(ec.longitude),
          peopleCount: pCount,
          routeDistanceMeters: distMeters,
          routeDurationSeconds: durSeconds,
        });
      } else {
        const hId = parseInt(t.hospitalId || t.facilityId, 10);
        if (!Number.isFinite(hId) || hId <= 0) {
          await conn.rollback();
          return res.status(400).json({ error: 'Invalid healthcare facility ID.' });
        }
        const [hRows] = await conn.query('SELECT * FROM hospitals WHERE id = ? LIMIT 1', [hId]);
        if (!hRows.length) {
          await conn.rollback();
          return res.status(404).json({ error: 'Selected healthcare facility does not exist.' });
        }
        const fac = hRows[0];
        if (fac.status === 'Closed') {
          await conn.rollback();
          return res.status(400).json({ error: `${fac.name} is currently Closed / Inactive.` });
        }
        if (fac.verification_status !== 'Verified') {
          await conn.rollback();
          return res.status(400).json({
            error: `${fac.name} is marked "${fac.verification_status}" and cannot be selected as a confirmed navigation destination.`,
          });
        }
        if (cat === 'hospital' && fac.facility_type !== 'Hospital') {
          await conn.rollback();
          return res.status(400).json({
            error: `${fac.name} is classified as ${fac.facility_type}, not a Hospital.`,
          });
        }
        if (cat === 'medical_facility' && fac.facility_type !== 'Health Center') {
          await conn.rollback();
          return res.status(400).json({
            error: `${fac.name} is classified as ${fac.facility_type}, not a Health Center.`,
          });
        }
        validatedTransports.push({
          destinationCategory: cat,
          hospitalId: fac.id,
          evacuationCenterId: null,
          destinationName: fac.name,
          destinationFacilityType: fac.facility_type || 'Hospital',
          latitude: Number(fac.latitude),
          longitude: Number(fac.longitude),
          peopleCount: pCount,
          routeDistanceMeters: distMeters,
          routeDurationSeconds: durSeconds,
        });
      }
    }

    // Upsert rescue_outcomes
    const [existingOut] = await conn.query('SELECT id FROM rescue_outcomes WHERE rescue_id = ? LIMIT 1', [rescueRow.id]);
    if (existingOut.length) {
      await conn.query(
        `UPDATE rescue_outcomes
         SET responder_user_id = ?, primary_outcome = ?, total_rescued = ?, first_aid_count = ?,
             hospital_transport_count = ?, medical_facility_count = ?, evacuation_center_count = ?,
             still_assisting_count = ?, first_aid_actions = ?, further_medical_recommended = ?,
             transport_required = ?, other_description = ?, admin_coordination_required = ?,
             operational_notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE rescue_id = ?`,
        [
          req.user.id,
          primaryOutcome,
          parsedTotal,
          parsedFirstAid,
          parsedHospital,
          parsedMedFac,
          parsedEvac,
          parsedStill,
          String(firstAidActions || '').trim() || null,
          Boolean(furtherMedicalRecommended),
          Boolean(needsTransport),
          String(otherDescription || '').trim() || null,
          Boolean(adminCoordinationRequired),
          String(operationalNotes || '').trim() || null,
          rescueRow.id,
        ]
      );
    } else {
      await conn.query(
        `INSERT INTO rescue_outcomes (
           rescue_id, responder_user_id, primary_outcome, total_rescued, first_aid_count,
           hospital_transport_count, medical_facility_count, evacuation_center_count,
           still_assisting_count, first_aid_actions, further_medical_recommended,
           transport_required, other_description, admin_coordination_required, operational_notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rescueRow.id,
          req.user.id,
          primaryOutcome,
          parsedTotal,
          parsedFirstAid,
          parsedHospital,
          parsedMedFac,
          parsedEvac,
          parsedStill,
          String(firstAidActions || '').trim() || null,
          Boolean(furtherMedicalRecommended),
          Boolean(needsTransport),
          String(otherDescription || '').trim() || null,
          Boolean(adminCoordinationRequired),
          String(operationalNotes || '').trim() || null,
        ]
      );
    }

    // Replace only Pending transport legs (preserve active In Transit / Arrived / Handed Over legs)
    await conn.query(
      `DELETE FROM rescue_transports WHERE rescue_id = ? AND transport_status = 'Pending'`,
      [rescueRow.id]
    );
    for (const vt of validatedTransports) {
      await conn.query(
        `INSERT INTO rescue_transports (
           rescue_id, responder_user_id, destination_category, hospital_id, evacuation_center_id,
           destination_name, destination_facility_type, destination_latitude, destination_longitude,
           people_count, route_distance_meters, route_duration_seconds, transport_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
        [
          rescueRow.id,
          req.user.id,
          vt.destinationCategory,
          vt.hospitalId,
          vt.evacuationCenterId,
          vt.destinationName,
          vt.destinationFacilityType,
          vt.latitude,
          vt.longitude,
          vt.peopleCount,
          vt.routeDistanceMeters,
          vt.routeDurationSeconds,
        ]
      );
    }

    const outcomeLabelMap = {
      first_aid: 'First Aid / On-Site Assistance',
      hospital: 'Transport to Hospital',
      medical_facility: 'Transport to Medical Facility',
      evacuation_center: 'Transport to Evacuation Center',
      other: 'Other / Special Assistance',
    };
    const summaryText = `Outcome recorded: ${outcomeLabelMap[primaryOutcome]} (Rescued: ${parsedTotal}, First Aid: ${parsedFirstAid}${needsTransport ? `, Transport legs: ${validatedTransports.length}` : ', No transport required'})`;

    await conn.query(
      `INSERT INTO rescue_updates (rescue_id, responder_user_id, status_update, work_notes, is_internal_only)
       VALUES (?, ?, 'In Progress', ?, FALSE)`,
      [rescueRow.id, req.user.id, summaryText]
    );
    await conn.query(
      `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes)
       VALUES (?, ?, ?, ?, ?)`,
      [rescueRow.id, rescueRow.status, rescueRow.status, req.user.id, summaryText]
    );

    const refNumber = rescueRow.reference_number || `RES-${rescueRow.id}`;
    try {
      const adminIds = await getActiveAdminIds(conn);
      if (adminIds.length) {
        await createNotificationForUsers(conn, {
          title: `Rescue Outcome (${refNumber}): ${outcomeLabelMap[primaryOutcome]}`,
          message: summaryText,
          category: 'Dispatch',
          createdBy: req.user.id,
          userIds: adminIds,
        });
      }
      if (rescueRow.user_id) {
        const residentMsg =
          primaryOutcome === 'first_aid'
            ? 'First aid and on-site assistance have been provided by the responder.'
            : needsTransport
              ? `Responder has arranged transportation (${outcomeLabelMap[primaryOutcome]}).`
              : 'Rescue assistance is in progress.';
        await createNotificationForUsers(conn, {
          title: `Rescue Update (${refNumber})`,
          message: residentMsg,
          category: 'Dispatch',
          createdBy: req.user.id,
          userIds: [rescueRow.user_id],
        });
      }
    } catch (_) {}

    const [savedOutRows] = await conn.query('SELECT * FROM rescue_outcomes WHERE rescue_id = ? LIMIT 1', [rescueRow.id]);
    const [savedTrRows] = await conn.query(
      'SELECT * FROM rescue_transports WHERE rescue_id = ? ORDER BY created_at ASC, id ASC',
      [rescueRow.id]
    );
    await conn.commit();

    const o = savedOutRows[0];
    const outcomePayload = {
      primaryOutcome: o.primary_outcome,
      totalRescued: Number(o.total_rescued || 0),
      firstAidCount: Number(o.first_aid_count || 0),
      hospitalTransportCount: Number(o.hospital_transport_count || 0),
      medicalFacilityCount: Number(o.medical_facility_count || 0),
      evacuationCenterCount: Number(o.evacuation_center_count || 0),
      stillAssistingCount: Number(o.still_assisting_count || 0),
      firstAidActions: o.first_aid_actions || '',
      furtherMedicalRecommended: Boolean(o.further_medical_recommended),
      transportRequired: Boolean(o.transport_required),
      otherDescription: o.other_description || '',
      adminCoordinationRequired: Boolean(o.admin_coordination_required),
      operationalNotes: o.operational_notes || '',
      recordedAt: o.recorded_at,
      updatedAt: o.updated_at,
    };

    emitRescueOutcomeUpdated({
      id: refNumber,
      dbId: rescueRow.id,
      referenceNumber: refNumber,
      responderId: req.user.id,
      residentId: rescueRow.user_id,
      ...outcomePayload,
      transportsCount: savedTrRows.length,
    });

    return res.json({
      success: true,
      outcome: outcomePayload,
      transports: savedTrRows.map((tr) => ({
        id: tr.id,
        destinationCategory: tr.destination_category,
        hospitalId: tr.hospital_id,
        evacuationCenterId: tr.evacuation_center_id,
        destinationName: tr.destination_name,
        destinationFacilityType: tr.destination_facility_type,
        latitude: tr.destination_latitude !== null ? Number(tr.destination_latitude) : null,
        longitude: tr.destination_longitude !== null ? Number(tr.destination_longitude) : null,
        peopleCount: Number(tr.people_count || 1),
        routeDistanceMeters: tr.route_distance_meters !== null ? Number(tr.route_distance_meters) : null,
        routeDurationSeconds: tr.route_duration_seconds !== null ? Number(tr.route_duration_seconds) : null,
        transportStatus: tr.transport_status,
        startedAt: tr.started_at,
        arrivedAt: tr.arrived_at,
        handedOverAt: tr.handed_over_at,
        handoverConfirmed: Boolean(tr.handover_confirmed),
        handoverNotes: tr.handover_notes || '',
      })),
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Portal API] POST /responder/assignments/:id/outcome failed:', err.message);
    return res.status(500).json({ error: 'Unable to record rescue outcome.' });
  } finally {
    conn.release();
  }
});

router.post('/responder/assignments/:id/transports', requireRole('responder', 'admin'), async (req, res) => {
  const paramId = String(req.params.id || '').trim();
  const { destinationCategory, hospitalId, evacuationCenterId, facilityId, peopleCount, routeDistanceMeters, routeDurationSeconds } = req.body || {};
  const cat = String(destinationCategory || '').toLowerCase();

  if (!['hospital', 'medical_facility', 'evacuation_center'].includes(cat)) {
    return res.status(400).json({ error: 'Invalid transport destination category.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resolved = await resolveOwnedRescueForResponder(conn, paramId, req.user);
    if (resolved.error) {
      await conn.rollback();
      return res.status(resolved.errorStatus).json({ error: resolved.error });
    }
    const rescueRow = resolved.rescueRow;

    if (rescueRow.status === 'Completed' || rescueRow.status === 'Cancelled') {
      await conn.rollback();
      return res.status(409).json({ error: 'Cannot add transport to a completed or cancelled rescue operation.' });
    }

    const pCount = Math.max(1, parseInt(peopleCount, 10) || 1);
    const distMeters = Number.isFinite(Number(routeDistanceMeters)) ? Math.round(Number(routeDistanceMeters)) : null;
    const durSeconds = Number.isFinite(Number(routeDurationSeconds)) ? Math.round(Number(routeDurationSeconds)) : null;

    let destData = null;
    if (cat === 'evacuation_center') {
      const ecId = parseInt(evacuationCenterId || facilityId, 10);
      if (!Number.isFinite(ecId) || ecId <= 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Invalid evacuation center ID.' });
      }
      const [ecRows] = await conn.query('SELECT * FROM evacuation_centers WHERE id = ? LIMIT 1', [ecId]);
      if (!ecRows.length) {
        await conn.rollback();
        return res.status(404).json({ error: 'Selected evacuation center does not exist.' });
      }
      const ec = ecRows[0];
      if (['Full', 'Full / Closed', 'Temporarily Closed', 'Inactive'].includes(ec.status)) {
        await conn.rollback();
        return res.status(400).json({ error: `${ec.name} is currently ${ec.status} and cannot accept new evacuation assignments.` });
      }
      destData = {
        hospitalId: null,
        evacuationCenterId: ec.id,
        destinationName: ec.name,
        destinationFacilityType: 'Evacuation Center',
        latitude: Number(ec.latitude),
        longitude: Number(ec.longitude),
      };
    } else {
      const hId = parseInt(hospitalId || facilityId, 10);
      if (!Number.isFinite(hId) || hId <= 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Invalid healthcare facility ID.' });
      }
      const [hRows] = await conn.query('SELECT * FROM hospitals WHERE id = ? LIMIT 1', [hId]);
      if (!hRows.length) {
        await conn.rollback();
        return res.status(404).json({ error: 'Selected healthcare facility does not exist.' });
      }
      const fac = hRows[0];
      if (fac.status === 'Closed') {
        await conn.rollback();
        return res.status(400).json({ error: `${fac.name} is currently Closed / Inactive.` });
      }
      if (fac.verification_status !== 'Verified') {
        await conn.rollback();
        return res.status(400).json({ error: `${fac.name} is marked "${fac.verification_status}" and cannot be selected.` });
      }
      if (cat === 'hospital' && fac.facility_type !== 'Hospital') {
        await conn.rollback();
        return res.status(400).json({ error: `${fac.name} is classified as ${fac.facility_type}, not a Hospital.` });
      }
      if (cat === 'medical_facility' && fac.facility_type !== 'Health Center') {
        await conn.rollback();
        return res.status(400).json({ error: `${fac.name} is classified as ${fac.facility_type}, not a Health Center.` });
      }
      destData = {
        hospitalId: fac.id,
        evacuationCenterId: null,
        destinationName: fac.name,
        destinationFacilityType: fac.facility_type || 'Hospital',
        latitude: Number(fac.latitude),
        longitude: Number(fac.longitude),
      };
    }

    // Prevent duplicate active transport leg for the same rescue & destination
    const [existingLeg] = await conn.query(
      cat === 'evacuation_center'
        ? `SELECT id FROM rescue_transports
           WHERE rescue_id = ? AND destination_category = 'evacuation_center' AND evacuation_center_id = ?
             AND transport_status IN ('Pending', 'In Transit', 'Arrived')
           LIMIT 1`
        : `SELECT id FROM rescue_transports
           WHERE rescue_id = ? AND destination_category = ? AND hospital_id = ?
             AND transport_status IN ('Pending', 'In Transit', 'Arrived')
           LIMIT 1`,
      cat === 'evacuation_center'
        ? [rescueRow.id, destData.evacuationCenterId]
        : [rescueRow.id, cat, destData.hospitalId]
    );

    if (!existingLeg.length) {
      await conn.query(
        `INSERT INTO rescue_transports (
           rescue_id, responder_user_id, destination_category, hospital_id, evacuation_center_id,
           destination_name, destination_facility_type, destination_latitude, destination_longitude,
           people_count, route_distance_meters, route_duration_seconds, transport_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
        [
          rescueRow.id,
          req.user.id,
          cat,
          destData.hospitalId,
          destData.evacuationCenterId,
          destData.destinationName,
          destData.destinationFacilityType,
          destData.latitude,
          destData.longitude,
          pCount,
          distMeters,
          durSeconds,
        ]
      );
    }

    await conn.commit();
    const [savedTrRows] = await pool.query(
      `SELECT * FROM rescue_transports WHERE rescue_id = ? AND transport_status <> 'Cancelled' ORDER BY id ASC`,
      [rescueRow.id]
    );
    return res.json({
      success: true,
      transports: savedTrRows.map((tr) => ({
        id: tr.id,
        destinationCategory: tr.destination_category,
        hospitalId: tr.hospital_id,
        evacuationCenterId: tr.evacuation_center_id,
        destinationName: tr.destination_name,
        destinationFacilityType: tr.destination_facility_type,
        latitude: tr.destination_latitude !== null ? Number(tr.destination_latitude) : null,
        longitude: tr.destination_longitude !== null ? Number(tr.destination_longitude) : null,
        peopleCount: Number(tr.people_count || 1),
        routeDistanceMeters: tr.route_distance_meters !== null ? Number(tr.route_distance_meters) : null,
        routeDurationSeconds: tr.route_duration_seconds !== null ? Number(tr.route_duration_seconds) : null,
        transportStatus: tr.transport_status,
        startedAt: tr.started_at,
        arrivedAt: tr.arrived_at,
        handedOverAt: tr.handed_over_at,
        handoverConfirmed: Boolean(tr.handover_confirmed),
        handoverNotes: tr.handover_notes || '',
      })),
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Portal API] POST /responder/assignments/:id/transports failed:', err.message);
    return res.status(500).json({ error: 'Unable to add transport destination.' });
  } finally {
    conn.release();
  }
});

router.patch('/responder/assignments/:id/transports/:transportId', requireRole('responder', 'admin'), async (req, res) => {
  const paramId = String(req.params.id || '').trim();
  const transportId = parseInt(req.params.transportId, 10);
  const { action, handoverConfirmed, handoverNotes } = req.body || {};

  if (!Number.isInteger(transportId) || transportId <= 0) {
    return res.status(400).json({ error: 'Invalid transport leg ID.' });
  }
  if (!['start', 'arrive', 'handover', 'cancel'].includes(action)) {
    return res.status(400).json({ error: 'Invalid transport action. Expected start, arrive, handover, or cancel.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resolved = await resolveOwnedRescueForResponder(conn, paramId, req.user);
    if (resolved.error) {
      await conn.rollback();
      return res.status(resolved.errorStatus).json({ error: resolved.error });
    }
    const rescueRow = resolved.rescueRow;

    const [trRows] = await conn.query(
      'SELECT * FROM rescue_transports WHERE id = ? AND rescue_id = ? LIMIT 1',
      [transportId, rescueRow.id]
    );
    if (!trRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Transport record not found.' });
    }
    const tr = trRows[0];

    let nextStatus = tr.transport_status;
    let noteMsg = '';
    if (action === 'start') {
      nextStatus = 'In Transit';
      noteMsg = `Transportation started to ${tr.destination_name} (${tr.destination_facility_type}) for ${tr.people_count} person(s).`;
      await conn.query(
        `UPDATE rescue_transports
         SET transport_status = 'In Transit', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [tr.id]
      );
    } else if (action === 'arrive') {
      nextStatus = 'Arrived';
      noteMsg = `Arrived at ${tr.destination_name}.`;
      await conn.query(
        `UPDATE rescue_transports
         SET transport_status = 'Arrived',
             started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
             arrived_at = COALESCE(arrived_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [tr.id]
      );
    } else if (action === 'handover') {
      if (!handoverConfirmed) {
        await conn.rollback();
        return res.status(400).json({ error: 'Handover confirmation is required.' });
      }
      if (!tr.arrived_at && tr.transport_status !== 'Arrived') {
        await conn.rollback();
        return res.status(400).json({ error: 'Arrival at destination must be recorded before confirming handover.' });
      }
      nextStatus = 'Handed Over';
      const cleanNotes = String(handoverNotes || '').trim();
      noteMsg = `Patient/evacuee handover confirmed at ${tr.destination_name}${cleanNotes ? `: ${cleanNotes}` : '.'}`;
      await conn.query(
        `UPDATE rescue_transports
         SET transport_status = 'Handed Over',
             handed_over_at = COALESCE(handed_over_at, CURRENT_TIMESTAMP),
             handover_confirmed = TRUE,
             handover_notes = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [cleanNotes || null, tr.id]
      );
    } else if (action === 'cancel') {
      nextStatus = 'Cancelled';
      noteMsg = `Transportation leg to ${tr.destination_name} cancelled.`;
      await conn.query(
        `UPDATE rescue_transports SET transport_status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [tr.id]
      );
    }

    await conn.query(
      `INSERT INTO rescue_updates (rescue_id, responder_user_id, status_update, work_notes, is_internal_only)
       VALUES (?, ?, 'In Progress', ?, FALSE)`,
      [rescueRow.id, req.user.id, noteMsg]
    );
    await conn.query(
      `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes)
       VALUES (?, ?, ?, ?, ?)`,
      [rescueRow.id, rescueRow.status, rescueRow.status, req.user.id, noteMsg]
    );

    const refNumber = rescueRow.reference_number || `RES-${rescueRow.id}`;
    try {
      const adminIds = await getActiveAdminIds(conn);
      const recipients = [...adminIds];
      if (rescueRow.user_id) recipients.push(rescueRow.user_id);
      if (recipients.length) {
        await createNotificationForUsers(conn, {
          title: `Transport Update (${refNumber}): ${nextStatus}`,
          message: noteMsg,
          category: 'Dispatch',
          createdBy: req.user.id,
          userIds: recipients,
        });
      }
    } catch (_) {}

    const [updatedRows] = await conn.query('SELECT * FROM rescue_transports WHERE id = ? LIMIT 1', [tr.id]);
    await conn.commit();
    const u = updatedRows[0];

    emitRescueTransportUpdated({
      id: refNumber,
      dbId: rescueRow.id,
      referenceNumber: refNumber,
      transportId: u.id,
      destinationName: u.destination_name,
      destinationFacilityType: u.destination_facility_type,
      transportStatus: u.transport_status,
      responderId: req.user.id,
      residentId: rescueRow.user_id,
      updatedAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      transport: {
        id: u.id,
        destinationCategory: u.destination_category,
        hospitalId: u.hospital_id,
        evacuationCenterId: u.evacuation_center_id,
        destinationName: u.destination_name,
        destinationFacilityType: u.destination_facility_type,
        latitude: u.destination_latitude !== null ? Number(u.destination_latitude) : null,
        longitude: u.destination_longitude !== null ? Number(u.destination_longitude) : null,
        peopleCount: Number(u.people_count || 1),
        routeDistanceMeters: u.route_distance_meters !== null ? Number(u.route_distance_meters) : null,
        routeDurationSeconds: u.route_duration_seconds !== null ? Number(u.route_duration_seconds) : null,
        transportStatus: u.transport_status,
        startedAt: u.started_at,
        arrivedAt: u.arrived_at,
        handedOverAt: u.handed_over_at,
        handoverConfirmed: Boolean(u.handover_confirmed),
        handoverNotes: u.handover_notes || '',
      },
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Portal API] PATCH /responder/assignments/:id/transports/:transportId failed:', err.message);
    return res.status(500).json({ error: 'Unable to update transportation status.' });
  } finally {
    conn.release();
  }
});

router.get('/responder/dashboard/summary', requireRole('responder', 'admin'), async (req, res) => {
  try {
    const assignments = await loadResponderAssignmentsForUser(req.user.id, req.user.role === 'admin');

    const activeAssignments = assignments.filter(
      (a) => !['completed', 'resolved'].includes(String(a.status || '').toLowerCase())
    );
    const active = activeAssignments.length;
    const pending = assignments.filter((a) => ['Pending', 'Assigned', 'Accepted'].includes(a.status)).length;
    const inProgress = assignments.filter((a) => ['En Route', 'On Scene', 'In Progress'].includes(a.status)).length;
    const completed = assignments.filter((a) => ['completed', 'resolved'].includes(String(a.status || '').toLowerCase())).length;

    const [rRows] = await pool.query(
      'SELECT * FROM responder_profiles WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    const r = rRows[0] || {};
    const parts = String(req.user.name || '').trim().split(/\s+/);

    return res.json({
      stats: { active, pending, inProgress, completed },
      recentAssignments: activeAssignments.slice(0, 10),
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
    const [evacRows] = await pool.query(
      'SELECT id, name, address, barangay, latitude, longitude, status, contact_person, contact_phone, contact_number FROM evacuation_centers ORDER BY name ASC'
    );
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
       WHERE source_rescue_id IS NULL
         AND status IN ('pending', 'verified', 'dispatched', 'responding', 'on_site', 'in_progress')
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
      barangayFacilities: hospitalRows
        .filter((h) => h.verification_status === 'Verified' && h.status !== 'Closed')
        .map((h) => ({
          ...h,
          type: h.facility_type || h.hospital_type || 'Hospital',
          verificationStatus: h.verification_status,
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

// ============================================================================
// POST /api/portal/responder/location — Authorized 10s Live Responder GPS Sync
// ============================================================================
router.post('/responder/location', authenticate, requireRole('responder', 'admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const sharingEnabled = body.sharingEnabled !== false;

    if (!sharingEnabled) {
      emitResponderLocationOffline(req.user.id);
      return res.json({ ok: true, sharingEnabled: false });
    }

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const accuracy = body.accuracy !== undefined && body.accuracy !== null ? Number(body.accuracy) : null;

    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Valid GPS coordinates (lat, lng) are required.' });
    }
    if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 50000)) {
      return res.status(400).json({ error: 'Invalid GPS accuracy value.' });
    }

    const [profRows] = await pool.query(
      `SELECT rp.user_id AS has_profile, rp.assigned_unit, rp.callsign, rp.badge_number, rp.availability_status,
              rp.organization, rp.custom_organization, rp.department,
              rp.current_latitude, rp.current_longitude, rp.last_location_updated_at,
              u.name, u.user_code
       FROM users u
       LEFT JOIN responder_profiles rp ON rp.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`,
      [req.user.id]
    );
    const prof = profRows[0];

    // Do not track or broadcast Off Duty responders
    if (prof && String(prof.availability_status || '') === 'Off Duty') {
      emitResponderLocationOffline(req.user.id);
      return res.json({ ok: true, sharingEnabled: false, reason: 'off_duty' });
    }

    const effectiveOrg = prof
      ? ((prof.organization === 'Other' && prof.custom_organization)
          ? prof.custom_organization
          : (prof.organization || prof.department || 'Emergency Operations'))
      : 'Emergency Operations';

    const updatedAtIso = new Date().toISOString();
    const liveEntry = emitResponderLocationUpdate({
      userId: req.user.id,
      responderId: (prof && (prof.user_code || prof.badge_number)) || `RSP-${req.user.id}`,
      name: (prof && prof.name) || req.user.name || 'Responder',
      assignedUnit: (prof && prof.assigned_unit) || 'Response Unit',
      organization: effectiveOrg,
      callsign: (prof && prof.callsign) || null,
      badgeNumber: (prof && prof.badge_number) || null,
      availabilityStatus: (prof && prof.availability_status) || 'On Duty',
      lat,
      lng,
      accuracy,
      updatedAt: updatedAtIso,
    });

    // Minimize PostgreSQL writes: persist only when moved >= 10m or >= 30s elapsed
    if (prof) {
      const prevLat = prof.current_latitude !== null ? Number(prof.current_latitude) : null;
      const prevLng = prof.current_longitude !== null ? Number(prof.current_longitude) : null;
      const lastDbMs = prof.last_location_updated_at ? new Date(prof.last_location_updated_at).getTime() : 0;
      const elapsedMs = Date.now() - lastDbMs;
      const movedMeters = (prevLat !== null && prevLng !== null)
        ? computeHaversineMeters(prevLat, prevLng, lat, lng)
        : Infinity;

      if (!prof.has_profile || movedMeters >= 10 || elapsedMs >= 30000) {
        if (prof.has_profile) {
          await pool.query(
            `UPDATE responder_profiles
             SET current_latitude = ?, current_longitude = ?, last_location_updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ?`,
            [lat, lng, req.user.id]
          );
        } else {
          await pool.query(
            `INSERT INTO responder_profiles (user_id, availability_status, current_latitude, current_longitude, last_location_updated_at)
             VALUES (?, 'On Duty', ?, ?, CURRENT_TIMESTAMP)`,
            [req.user.id, lat, lng]
          );
        }
        await pool.query(
          `UPDATE users SET last_location_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [req.user.id]
        ).catch(() => {});
        if (process.env.NODE_ENV !== 'production') {
          console.debug(`[GeoSafe GPS][DB] Persisted responder #${req.user.id} location (moved=${Math.round(movedMeters)}m)`);
        }
      }
    }

    return res.json({
      ok: true,
      sharingEnabled: true,
      location: liveEntry,
    });
  } catch (err) {
    console.error('[Portal API] POST /responder/location failed:', err.message);
    return res.status(503).json({ error: 'Unable to synchronize responder location.' });
  }
});

module.exports = router;
