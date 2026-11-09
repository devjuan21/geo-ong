const express = require('express');
const pool = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

// Every portal route requires authentication
router.use(authenticate);

function formatReportForPortal(r) {
  const statusMap = {
    pending: 'Pending Verification',
    verified: 'Verified',
    dispatched: 'Assigned',
    responding: 'Responding',
    on_site: 'On Scene',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    false_alarm: 'Dismissed',
  };
  const sevMap = {
    low: 'Low',
    medium: 'Moderate',
    high: 'High',
    critical: 'Critical',
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
    severity: sevMap[r.severity] || 'Moderate',
    status: statusMap[r.status] || 'Pending Verification',
    photos: [],
    timeline: [],
  };
}

function formatRescueForPortal(r) {
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
    priority: r.priority || 'High',
    status: r.status || 'Pending Dispatch',
    requestDate: r.created_at,
    submittedAt: r.created_at,
    updates: [],
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
    const reports = reportRows.map(formatReportForPortal);

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
      title: `Emergency Advisory (${String(a.severity || 'medium').toUpperCase()})`,
      description: a.message,
      severity: a.severity === 'critical' ? 'Critical' : a.severity === 'high' ? 'Warning' : 'Advisory',
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

    const [contactRows] = await pool.query(
      'SELECT * FROM emergency_contacts WHERE is_active = 1 ORDER BY display_order ASC, agency_name ASC'
    );

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
      'SELECT id, reference_number, incident_type, title, description, latitude, longitude, address, severity, status, created_at FROM reports WHERE is_public = 1 ORDER BY created_at DESC LIMIT 50'
    );
    return res.json(rows.map(formatReportForPortal));
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
    return res.json(rows.map(formatRescueForPortal));
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
    return res.json(formatRescueForPortal(row));
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
    vulnerableDetails,
    location,
    landmark,
    coordinates,
    priority,
  } = req.body || {};

  const lat = coordinates && coordinates.lat !== undefined ? Number(coordinates.lat) : 14.4075;
  const lng = coordinates && coordinates.lng !== undefined ? Number(coordinates.lng) : 121.0475;
  const validPriorities = ['Critical', 'High', 'Medium', 'Low'];
  const prio = validPriorities.includes(priority) ? priority : 'High';

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
    const [result] = await conn.query(
      `INSERT INTO rescue_requests
         (reference_number, user_id, emergency_type, description, people_count, vulnerable_details,
          latitude, longitude, address, landmark, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Dispatch')`,
      [
        tempRef,
        req.user.id,
        String(emergencyType || 'Flood Evacuation').slice(0, 100),
        String(description || 'Immediate rescue requested'),
        Math.max(1, parseInt(peopleCount, 10) || 1),
        vulnerableDetails ? String(vulnerableDetails).slice(0, 255) : null,
        lat,
        lng,
        String(location || 'Barangay Bayanan, Muntinlupa City').slice(0, 255),
        landmark ? String(landmark).slice(0, 180) : null,
        prio,
      ]
    );

    const refNum = `RES-${new Date().getFullYear()}-${String(result.insertId).padStart(6, '0')}`;
    await conn.query('UPDATE rescue_requests SET reference_number = ? WHERE id = ?', [refNum, result.insertId]);

    await conn.query(
      `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes)
       VALUES (?, NULL, 'Pending Dispatch', ?, 'Emergency rescue request submitted by resident')`,
      [result.insertId, req.user.id]
    );

    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM rescue_requests WHERE id = ?', [result.insertId]);
    return res.status(201).json(formatRescueForPortal(rows[0]));
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
      `SELECT n.id, n.title, n.message AS description, n.severity, n.category, n.created_at AS timestamp,
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
      'UPDATE notification_recipients SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE notification_id = ? AND user_id = ?',
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
      'UPDATE notification_recipients SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(503).json({ error: 'Unable to mark notifications read' });
  }
});

router.get('/hazard-alerts', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 50');
    return res.json(
      rows.map((a) => ({
        id: `ALT-${a.id}`,
        title: `Barangay Bayanan Advisory (${String(a.severity || 'medium').toUpperCase()})`,
        description: a.message,
        severity: a.severity === 'critical' ? 'Critical' : a.severity === 'high' ? 'Warning' : 'Advisory',
        publishedAt: a.created_at,
        affectedAreas: ['Barangay Bayanan'],
      }))
    );
  } catch (err) {
    return res.status(503).json({ error: 'Unable to load hazard alerts' });
  }
});

router.get('/tropical-cyclone', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM tropical_cyclone_bulletins WHERE is_active = 1 ORDER BY bulletin_issued_at DESC LIMIT 1'
    );
    return res.json(rows[0] || null);
  } catch (err) {
    return res.status(503).json({ error: 'Unable to load tropical cyclone bulletin' });
  }
});

router.get('/evacuation-routes', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM evacuation_routes ORDER BY is_primary DESC, name ASC');
    return res.json(rows);
  } catch (err) {
    return res.status(503).json({ error: 'Unable to load evacuation routes' });
  }
});

router.get('/emergency-facilities', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM emergency_facilities WHERE is_operational = 1 ORDER BY name ASC');
    return res.json(rows);
  } catch (err) {
    return res.status(503).json({ error: 'Unable to load emergency facilities' });
  }
});

router.get('/emergency-contacts', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM emergency_contacts WHERE is_active = 1 ORDER BY display_order ASC');
    return res.json(rows);
  } catch (err) {
    return res.status(503).json({ error: 'Unable to load emergency contacts' });
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

router.get('/responder/assignments', requireRole('responder', 'admin'), async (req, res) => {
  try {
    const [reportRows] = await pool.query(
      'SELECT * FROM reports WHERE assigned_to = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    const [rescueRows] = await pool.query(
      `SELECT rr.*, ra.assignment_status, ra.dispatch_instructions, ra.assigned_at
       FROM rescue_assignments ra
       JOIN rescue_requests rr ON rr.id = ra.rescue_id
       WHERE ra.responder_user_id = ?
       ORDER BY ra.assigned_at DESC`,
      [req.user.id]
    );

    const assignments = [
      ...rescueRows.map((r) => ({
        id: r.reference_number || `RES-${r.id}`,
        assignmentType: 'rescue',
        referenceNumber: r.reference_number || `RES-${r.id}`,
        title: r.emergency_type || 'Rescue Request',
        category: r.emergency_type,
        description: r.description,
        location: r.address,
        landmark: r.landmark || '',
        coordinates: { lat: Number(r.latitude), lng: Number(r.longitude) },
        priority: r.priority || 'High',
        status: r.assignment_status || r.status || 'Pending',
        peopleCount: r.people_count || 1,
        vulnerableDetails: r.vulnerable_details || 'None specified',
        assignedAt: r.assigned_at || r.created_at,
        timeline: [],
        photos: [],
        dispatchInstructions: r.dispatch_instructions || 'Proceed to assigned scene and report status to EOC.',
      })),
      ...reportRows.map((r) => ({
        id: r.reference_number || `REP-${r.id}`,
        assignmentType: 'incident',
        referenceNumber: r.reference_number || `REP-${r.id}`,
        title: r.title || `${r.incident_type} Incident`,
        category: r.incident_type,
        description: r.description,
        location: r.address || 'Barangay Bayanan',
        coordinates: { lat: Number(r.latitude), lng: Number(r.longitude) },
        priority:
          r.severity === 'critical'
            ? 'Critical'
            : r.severity === 'high'
            ? 'High'
            : r.severity === 'medium'
            ? 'Medium'
            : 'Low',
        status:
          r.status === 'resolved'
            ? 'Completed'
            : r.status === 'responding'
            ? 'En Route'
            : r.status === 'on_site'
            ? 'On Scene'
            : 'Pending',
        assignedAt: r.created_at,
        timeline: [],
        photos: [],
        dispatchInstructions: 'Assess hazard scope and report status to Barangay Bayanan EOC.',
      })),
    ];

    return res.json(assignments);
  } catch (err) {
    console.error('[Portal API] GET /responder/assignments failed:', err.message);
    return res.status(503).json({ error: 'Unable to load responder assignments' });
  }
});

router.get('/responder/dashboard/summary', requireRole('responder', 'admin'), async (req, res) => {
  try {
    const [reportRows] = await pool.query(
      'SELECT * FROM reports WHERE assigned_to = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    const active = reportRows.filter((r) => r.status !== 'resolved').length;
    const pending = reportRows.filter((r) => ['pending', 'verified', 'dispatched'].includes(r.status)).length;
    const inProgress = reportRows.filter((r) => ['responding', 'on_site', 'in_progress'].includes(r.status)).length;
    const completed = reportRows.filter((r) => r.status === 'resolved').length;

    const priorityCounts = {
      critical: reportRows.filter((r) => r.severity === 'critical').length,
      high: reportRows.filter((r) => r.severity === 'high').length,
      medium: reportRows.filter((r) => r.severity === 'medium').length,
      low: reportRows.filter((r) => r.severity === 'low').length,
    };

    const [rRows] = await pool.query(
      'SELECT * FROM responder_profiles WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    const r = rRows[0] || {};
    const parts = String(req.user.name || '').trim().split(/\s+/);

    return res.json({
      stats: { active, pending, inProgress, completed },
      priorityCounts,
      recentAssignments: reportRows.slice(0, 5).map(formatReportForPortal),
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

router.get('/responder/map-data', requireRole('responder', 'admin'), async (req, res) => {
  try {
    const [evacRows] = await pool.query('SELECT * FROM evacuation_centers ORDER BY name ASC');
    const [facRows] = await pool.query('SELECT * FROM emergency_facilities WHERE is_operational = 1 ORDER BY name ASC');
    return res.json({
      assignments: [],
      evacuationCenters: evacRows,
      barangayFacilities: facRows,
      responderLocation: null,
    });
  } catch (err) {
    return res.status(503).json({ error: 'Unable to load responder map data' });
  }
});

module.exports = router;

