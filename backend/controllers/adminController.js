const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { ROLE_IDS, roleLabel, roleDisplayName } = require('../config/roles');
const { isExcludedEvacuationCenter } = require('../utils/bayananBoundary');
const { generateNextUserCode } = require('../services/userIdService');
const {
  emitStatusUpdate,
  emitAssignmentUpdate,
  emitAlertBroadcast,
  emitAdminAnnouncement,
  emitPublicVerifiedReport,
  emitReportVerificationResult,
  emitIncidentResolved,
} = require('../services/socketService');
const {
  alertSeverityForCategory,
  broadcastSeverityForCategory,
  defaultColorForName,
} = require('../config/advisoryCategories');
const { getEocLocation } = require('../config/eocConfig');

const BCRYPT_ROUNDS = 12;

const INCIDENT_VALID_STATUSES = [
  'pending',
  'verified',
  'dispatched',
  'responding',
  'on_site',
  'in_progress',
  'resolved',
  'false_alarm',
];

const RESCUE_VALID_STATUSES = [
  'Pending Dispatch',
  'Assigned',
  'Accepted',
  'En Route',
  'On Scene',
  'Completed',
  'Cancelled',
];

const INCIDENT_VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const RESCUE_VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

function isValidLatLng(lat, lng) {
  if (lat === null || lng === null || lat === undefined || lng === undefined || lat === '' || lng === '') {
    return false;
  }
  const nLat = Number(lat);
  const nLng = Number(lng);
  return (
    Number.isFinite(nLat) &&
    Number.isFinite(nLng) &&
    nLat >= -90 &&
    nLat <= 90 &&
    nLng >= -180 &&
    nLng <= 180 &&
    !(nLat === 0 && nLng === 0)
  );
}

function parseLocationProvenance(notesInput) {
  const notesArray = Array.isArray(notesInput) ? notesInput : [notesInput];
  for (const rawNote of notesArray) {
    const text = String(rawNote || '');
    const match = text.match(/\[([^\]]*source:[^\]]+)\]/i);
    if (!match) continue;
    const parts = match[1].split('|').map((p) => p.trim());
    let locationSource = null;
    let gpsAccuracy = null;
    let locationCapturedAt = null;
    for (const part of parts) {
      if (part.startsWith('source:')) {
        const val = part.slice('source:'.length).trim().toLowerCase();
        if (val === 'gps' || val === 'manual') locationSource = val;
      } else if (part.startsWith('accuracy:')) {
        const num = Number(part.slice('accuracy:'.length).replace(/m$/i, '').trim());
        if (Number.isFinite(num) && num >= 0) gpsAccuracy = Math.round(num);
      } else if (part.startsWith('captured:')) {
        const ts = part.slice('captured:'.length).trim();
        if (ts) locationCapturedAt = ts;
      }
    }
    return { locationSource, gpsAccuracy, locationCapturedAt };
  }
  return { locationSource: null, gpsAccuracy: null, locationCapturedAt: null };
}

function normalizeIncidentStatusLabel(status) {
  const map = {
    pending: 'Pending',
    verified: 'Verified',
    dispatched: 'Under Review (Dispatched)',
    responding: 'Under Review (Responding)',
    on_site: 'Under Review (On Site)',
    in_progress: 'Under Review (In Progress)',
    resolved: 'Resolved',
    false_alarm: 'Rejected (False Alarm)',
  };
  return map[status] || status || 'Pending';
}

function normalizeRescueStatusLabel(status) {
  const map = {
    'Pending Dispatch': 'Pending',
    Assigned: 'Under Review (Assigned)',
    Accepted: 'Under Review (Accepted)',
    'En Route': 'Under Review (En Route)',
    'On Scene': 'Under Review (On Scene)',
    Completed: 'Resolved',
    Cancelled: 'Rejected (Cancelled)',
  };
  return map[status] || status || 'Pending';
}

function mapUnifiedFilterBucket(recordType, rawStatus) {
  if (recordType === 'incident') {
    if (rawStatus === 'pending') return 'pending';
    if (rawStatus === 'verified') return 'verified';
    if (['dispatched', 'responding', 'on_site', 'in_progress'].includes(rawStatus)) return 'under_review';
    if (rawStatus === 'false_alarm') return 'rejected';
    if (rawStatus === 'resolved') return 'resolved';
    return 'pending';
  }
  // rescue
  if (rawStatus === 'Pending Dispatch') return 'pending';
  if (['Assigned', 'Accepted', 'En Route', 'On Scene'].includes(rawStatus)) return 'under_review';
  if (rawStatus === 'Cancelled') return 'rejected';
  if (rawStatus === 'Completed') return 'resolved';
  return 'pending';
}

async function writeAuditLog(connOrPool, { userId, action, entityType, entityId, oldValues = null, newValues = null, req }) {
  try {
    const ip = (req && (req.ip || (req.connection && req.connection.remoteAddress))) || '0.0.0.0';
    const ua = req && req.headers && req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null;
    await connOrPool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        String(action).slice(0, 100),
        String(entityType).slice(0, 60),
        entityId !== undefined && entityId !== null ? String(entityId).slice(0, 60) : null,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        String(ip).slice(0, 45),
        ua,
      ]
    );
  } catch (err) {
    console.warn('[Admin Audit] Could not write audit_logs:', err.message);
  }
}

async function insertNotificationForUsers(connOrPool, { title, message, category = 'Alert', advisoryType = null, createdBy = null, userIds = [] }) {
  const uniqueIds = Array.from(new Set(userIds.filter((id) => Number.isInteger(Number(id)) && Number(id) > 0).map(Number)));
  if (!uniqueIds.length) return null;
  const safeCategory = 'Alert';
  const [notifRes] = await connOrPool.query(
    `INSERT INTO notifications (title, message, category, advisory_type, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [String(title).slice(0, 150), String(message), safeCategory, advisoryType, createdBy]
  );
  for (const uid of uniqueIds) {
    await connOrPool.query(
      'INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      [notifRes.insertId, uid]
    );
  }
  return notifRes.insertId;
}

// ============================================================================
// 1. DASHBOARD OVERVIEW & MAP DATA (GET /api/admin/overview & /api/admin/stats)
// ============================================================================
async function getAdminOverview(req, res) {
  try {
    const [[incTotalRow]] = await pool.query("SELECT COUNT(*) AS count FROM reports WHERE status NOT IN ('resolved', 'false_alarm', 'dismissed')");
    const [[resTotalRow]] = await pool.query("SELECT COUNT(*) AS count FROM rescue_requests WHERE status NOT IN ('Completed', 'Cancelled')");

    const [[incPendingRow]] = await pool.query("SELECT COUNT(*) AS count FROM reports WHERE status = 'pending'");
    const [[resPendingRow]] = await pool.query(
      "SELECT COUNT(*) AS count FROM rescue_requests WHERE status = 'Pending Dispatch'"
    );

    const [[activeRescueRow]] = await pool.query(
      "SELECT COUNT(*) AS count FROM rescue_requests WHERE status NOT IN ('Completed', 'Cancelled')"
    );

    const [[incVerifiedRow]] = await pool.query("SELECT COUNT(*) AS count FROM reports WHERE status = 'verified'");
    const [[availableRespRow]] = await pool.query(
      "SELECT COUNT(*) AS count FROM responder_profiles WHERE availability_status = 'On Duty'"
    );

    const [[usersTotalRow]] = await pool.query('SELECT COUNT(*) AS count FROM users');
    const [[residentsCountRow]] = await pool.query('SELECT COUNT(*) AS count FROM users WHERE role_id = ?', [
      ROLE_IDS.RESIDENT,
    ]);
    const [[respondersCountRow]] = await pool.query('SELECT COUNT(*) AS count FROM users WHERE role_id = ?', [
      ROLE_IDS.RESPONDER,
    ]);

    const incidentReportsCount = Number((incTotalRow && incTotalRow.count) || 0);
    const rescueRequestsCount = Number((resTotalRow && resTotalRow.count) || 0);
    const totalReports = incidentReportsCount + rescueRequestsCount;
    const pendingReview = Number((incPendingRow && incPendingRow.count) || 0) + Number((resPendingRow && resPendingRow.count) || 0);
    const verifiedIncidents = Number((incVerifiedRow && incVerifiedRow.count) || 0);
    const activeRescues = Number((activeRescueRow && activeRescueRow.count) || 0);
    const availableResponders = Number((availableRespRow && availableRespRow.count) || 0);
    const registeredUsers = Number((usersTotalRow && usersTotalRow.count) || 0);
    const registeredResidents = Number((residentsCountRow && residentsCountRow.count) || 0);

    // Fetch actual incident reports and rescue requests with valid coordinates for the Incident Map
    // Do NOT expose private reporter PII in map marker payloads
    const [incidentMarkers] = await pool.query(
      `SELECT id, reference_number, incident_type, title, latitude, longitude, address, status, created_at
       FROM reports
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
         AND status NOT IN ('resolved', 'false_alarm', 'dismissed')
       ORDER BY created_at DESC
       LIMIT 300`
    );

    const [rescueMarkers] = await pool.query(
      `SELECT r.id, r.reference_number, r.emergency_type, r.latitude, r.longitude,
              r.address, r.landmark, r.people_count, r.status, r.created_at,
              (SELECT h.work_notes
               FROM rescue_status_history h
               WHERE h.rescue_id = r.id
               ORDER BY h.created_at ASC, h.id ASC
               LIMIT 1) AS initial_work_notes
       FROM rescue_requests r
       WHERE r.latitude IS NOT NULL AND r.longitude IS NOT NULL
         AND r.status NOT IN ('Completed', 'Cancelled')
       ORDER BY r.created_at DESC
       LIMIT 300`
    );

    const mapItems = [
      ...incidentMarkers
        .filter((r) => isValidLatLng(r.latitude, r.longitude))
        .map((r) => ({
          uid: `incident-${r.id}`,
          id: r.id,
          recordType: 'incident',
          reportTypeLabel: 'Incident Report',
          referenceNumber: r.reference_number || `INC-${r.id}`,
          category: r.incident_type || 'General Incident',
          title: r.title || `${r.incident_type || 'Incident'} Report`,
          status: r.status,
          statusLabel: normalizeIncidentStatusLabel(r.status),
          filterBucket: mapUnifiedFilterBucket('incident', r.status),
          location: r.address || 'Location not specified',
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          submittedAt: r.created_at,
        })),
      ...rescueMarkers
        .filter((r) => isValidLatLng(r.latitude, r.longitude))
        .map((r) => {
          const locMeta = parseLocationProvenance(r.initial_work_notes);
          return {
            uid: `rescue-${r.id}`,
            id: r.id,
            recordType: 'rescue',
            reportTypeLabel: 'Rescue Request',
            referenceNumber: r.reference_number || `RES-${r.id}`,
            category: r.emergency_type || 'Emergency Rescue',
            title: `${r.emergency_type || 'Rescue'} (${r.people_count || 1} person${(r.people_count || 1) > 1 ? 's' : ''})`,
            status: r.status,
            statusLabel: normalizeRescueStatusLabel(r.status),
            filterBucket: mapUnifiedFilterBucket('rescue', r.status),
            location: r.address || 'Location not specified',
            latitude: Number(r.latitude),
            longitude: Number(r.longitude),
            locationSource: locMeta.locationSource,
            gpsAccuracy: locMeta.gpsAccuracy,
            locationCapturedAt: locMeta.locationCapturedAt,
            submittedAt: r.created_at,
          };
        }),
    ].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    // Fetch live evacuation centers for map display if present
    const [evacCenterRows] = await pool.query(
      `SELECT id, name, address, latitude, longitude, capacity, available_slots, status
       FROM evacuation_centers
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY name ASC`
    );

    const evacuationCenters = evacCenterRows
      .filter((e) => !isExcludedEvacuationCenter(e))
      .map((e) => ({
        id: e.id,
        name: e.name,
        address: e.address,
        latitude: Number(e.latitude),
        longitude: Number(e.longitude),
        capacity: Number(e.capacity || 0),
        availableSlots: Number(e.available_slots || 0),
        status: e.status || 'Standby',
      }));

    // Fetch recent operational activity events from audit_logs
    const [activityRows] = await pool.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at,
              u.name, u.email, up.first_name, up.last_name, r.name AS role_name
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       LEFT JOIN roles r ON u.role_id = r.id
       ORDER BY a.created_at DESC
       LIMIT 15`
    );

    const recentActivities = activityRows.map((act) => {
      const actorName = [act.first_name, act.last_name].filter(Boolean).join(' ') || act.name || act.email || 'System';
      let actionLabel = act.action.replace(/_/g, ' ').toLowerCase();
      actionLabel = actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1);
      return {
        id: act.id,
        action: act.action,
        actionLabel,
        entityType: act.entity_type,
        entityId: act.entity_id,
        actorName,
        role: act.role_name || 'System',
        timestamp: act.created_at,
      };
    });

    const categoryDistribution = await getReportCategoryDistribution({ clause: '1=1', params: [] });
    const eocLocation = await getEocLocation(pool);

    return res.json({
      summary: {
        totalReports,
        incidentReportsCount,
        rescueRequestsCount,
        pendingReview,
        verifiedIncidents,
        activeRescues,
        availableResponders,
        registeredUsers,
        registeredResidents,
        residentsCount: Number((residentsCountRow && residentsCountRow.count) || 0),
        respondersCount: Number((respondersCountRow && respondersCountRow.count) || 0),
      },
      mapItems,
      evacuationCenters,
      eocLocation,
      recentActivities,
      categoryDistribution,
    });
  } catch (err) {
    console.error('[Admin API] getAdminOverview failed:', err.message);
    return res.status(503).json({ error: 'Unable to load dashboard overview from database.' });
  }
}

async function getAdminStats(req, res) {
  try {
    const [sosRows] = await pool.query(
      "SELECT COUNT(*) AS count FROM reports WHERE status != 'resolved' AND incident_type = 'SOS'"
    );
    const [activeRows] = await pool.query("SELECT COUNT(*) AS count FROM reports WHERE status != 'resolved'");
    const [totalRows] = await pool.query('SELECT COUNT(*) AS count FROM reports');
    const [resolvedRows] = await pool.query("SELECT COUNT(*) AS count FROM reports WHERE status = 'resolved'");
    const [responderRows] = await pool.query(
      "SELECT COUNT(*) AS count FROM users WHERE role_id = ? AND status = 'active'",
      [ROLE_IDS.RESPONDER]
    );
    const [evacRows] = await pool.query(
      'SELECT SUM(capacity) AS total_capacity, SUM(available_slots) AS total_available FROM evacuation_centers'
    );
    const totalCapacity = Number(evacRows[0].total_capacity) || 0;
    const totalAvailable = Number(evacRows[0].total_available) || 0;
    const occupied = Math.max(0, totalCapacity - totalAvailable);
    const evacOccupancyPercent = totalCapacity > 0 ? Math.round((occupied / totalCapacity) * 100) : 0;

    const [residentRows] = await pool.query(
      'SELECT safety_status, COUNT(*) AS count FROM users WHERE role_id = ? GROUP BY safety_status',
      [ROLE_IDS.RESIDENT]
    );
    let totalResidents = 0;
    let safeCount = 0;
    let needHelpCount = 0;
    let injuredCount = 0;
    residentRows.forEach((row) => {
      const cnt = Number(row.count);
      totalResidents += cnt;
      if (row.safety_status === 'safe') safeCount += cnt;
      if (row.safety_status === 'need_help') needHelpCount += cnt;
      if (row.safety_status === 'injured') injuredCount += cnt;
    });
    const safePercent = totalResidents > 0 ? Math.round((safeCount / totalResidents) * 100) : 100;

    const [typeRows] = await pool.query('SELECT incident_type, COUNT(*) AS count FROM reports GROUP BY incident_type');
    const [statusRows] = await pool.query('SELECT status, COUNT(*) AS count FROM reports GROUP BY status');

    return res.json({
      stats: {
        sosCount: sosRows[0].count,
        activeCount: activeRows[0].count,
        totalReports: totalRows[0].count,
        resolvedCount: resolvedRows[0].count,
        respondersCount: responderRows[0].count,
        evac: {
          totalCapacity,
          totalAvailable,
          occupied,
          percentage: evacOccupancyPercent,
        },
        safety: {
          totalResidents,
          safeCount,
          needHelpCount,
          injuredCount,
          safePercent,
        },
        breakdownByType: typeRows,
        breakdownByStatus: statusRows,
      },
    });
  } catch (err) {
    console.error('[Admin API] getAdminStats failed:', err.message);
    return res.status(500).json({ error: 'Database error calculating stats' });
  }
}

async function getVulnerableResidents(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT 
        u.id, u.user_code, u.name, u.email,
        up.phone_number AS contact_number,
        up.street_address AS address,
        up.barangay,
        up.medical_notes,
        u.safety_status, u.last_latitude, u.last_longitude, u.battery_level,
        (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id AND r.status != 'resolved' AND r.incident_type = 'SOS') AS active_critical_reports,
        (SELECT r.description FROM reports r WHERE r.user_id = u.id AND r.status != 'resolved' ORDER BY r.created_at DESC LIMIT 1) AS latest_incident_description
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE u.role_id = ?
        AND (
          u.safety_status IN ('need_help', 'injured', 'no_response')
          OR (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id AND r.status != 'resolved' AND r.incident_type = 'SOS') > 0
        )
      ORDER BY
        CASE
          WHEN u.safety_status = 'injured' THEN 1
          WHEN u.safety_status = 'need_help' THEN 2
          ELSE 3
        END,
        u.id ASC`,
      [ROLE_IDS.RESIDENT]
    );
    return res.json({ vulnerable_residents: rows });
  } catch (err) {
    console.error('[Admin API] getVulnerableResidents failed:', err.message);
    return res.status(500).json({ error: 'Database error fetching vulnerable residents' });
  }
}

// ============================================================================
// 2. REVIEW REPORTS (INCIDENT REPORTS & RESCUE REQUESTS)
// ============================================================================
async function getAdminReportsList(req, res) {
  try {
    const filter = String(req.query.filter || 'all').toLowerCase();
    const recordTypeFilter = String(req.query.type || 'all').toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const [incidentRows] = await pool.query(
      `SELECT r.*,
              u.name AS reporter_name,
              u.email AS reporter_email,
              up.phone_number AS reporter_phone,
              resp.name AS assigned_responder_name,
              ver.name AS verified_by_name,
              (SELECT COUNT(*) FROM incident_attachments ia WHERE ia.incident_id = r.id) AS attachment_count
       FROM reports r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN user_profiles up ON up.user_id = r.user_id
       LEFT JOIN users resp ON resp.id = r.assigned_to
       LEFT JOIN users ver ON ver.id = r.verified_by
       ORDER BY r.created_at DESC`
    );

    const [rescueRows] = await pool.query(
      `SELECT rr.*,
              u.name AS reporter_name,
              u.email AS reporter_email,
              up.phone_number AS reporter_phone,
              (SELECT COUNT(*) FROM rescue_attachments ra WHERE ra.rescue_id = rr.id) AS attachment_count,
              (SELECT u2.name FROM rescue_assignments ras JOIN users u2 ON u2.id = ras.responder_user_id WHERE ras.rescue_id = rr.id ORDER BY ras.assigned_at DESC LIMIT 1) AS assigned_responder_name,
              (SELECT ras.responder_user_id FROM rescue_assignments ras WHERE ras.rescue_id = rr.id ORDER BY ras.assigned_at DESC LIMIT 1) AS assigned_to
       FROM rescue_requests rr
       JOIN users u ON u.id = rr.user_id
       LEFT JOIN user_profiles up ON up.user_id = rr.user_id
       ORDER BY rr.created_at DESC`
    );

    const unified = [
      ...incidentRows.map((r) => ({
        uid: `incident-${r.id}`,
        id: r.id,
        recordType: 'incident',
        reportType: 'Incident Report',
        referenceNumber: r.reference_number || `INC-${r.id}`,
        category: r.incident_type || 'General Incident',
        title: r.title || `${r.incident_type || 'Incident'} Report`,
        description: r.description,
        reporterName: r.reporter_name || 'Resident',
        reporterEmail: r.reporter_email || '',
        reporterPhone: r.reporter_phone || '',
        location: r.address || 'Barangay Bayanan, Muntinlupa City',
        latitude: r.latitude !== null ? Number(r.latitude) : null,
        longitude: r.longitude !== null ? Number(r.longitude) : null,
        status: r.status,
        statusLabel: normalizeIncidentStatusLabel(r.status),
        filterBucket: mapUnifiedFilterBucket('incident', r.status),
        assignedTo: r.assigned_to || null,
        assignedResponderName: r.assigned_responder_name || null,
        attachmentCount: Number(r.attachment_count) || 0,
        submittedAt: r.created_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        typeLabel: 'Incident Report',
      })),
      ...rescueRows.map((r) => ({
        uid: `rescue-${r.id}`,
        id: r.id,
        recordType: 'rescue',
        reportType: 'Rescue Request',
        referenceNumber: r.reference_number || `RES-${r.id}`,
        category: r.emergency_type || 'Emergency Rescue',
        title: `${r.emergency_type || 'Rescue Request'}`,
        description: r.description,
        peopleCount: r.people_count || 1,
        vulnerableDetails: r.vulnerable_details || null,
        landmark: r.landmark || null,
        reporterName: r.reporter_name || 'Resident',
        reporterEmail: r.reporter_email || '',
        reporterPhone: r.reporter_phone || '',
        location: r.address || 'Barangay Bayanan, Muntinlupa City',
        latitude: r.latitude !== null ? Number(r.latitude) : null,
        longitude: r.longitude !== null ? Number(r.longitude) : null,
        status: r.status,
        statusLabel: normalizeRescueStatusLabel(r.status),
        filterBucket: mapUnifiedFilterBucket('rescue', r.status),
        assignedTo: r.assigned_to || null,
        assignedResponderName: r.assigned_responder_name || null,
        attachmentCount: Number(r.attachment_count) || 0,
        submittedAt: r.created_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        typeLabel: 'Rescue Request',
      })),
    ].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    const counts = {
      all: unified.filter((i) => !(i.recordType === 'incident' && i.filterBucket === 'resolved')).length,
      pending: unified.filter((i) => i.filterBucket === 'pending').length,
      under_review: unified.filter((i) => i.filterBucket === 'under_review').length,
      verified: unified.filter((i) => i.filterBucket === 'verified').length,
      rejected: unified.filter((i) => i.filterBucket === 'rejected').length,
      resolved: unified.filter((i) => i.filterBucket === 'resolved').length,
    };

    const filtered = unified.filter((item) => {
      if (recordTypeFilter !== 'all' && item.recordType !== recordTypeFilter) return false;
      if (filter === 'all' && item.recordType === 'incident' && item.filterBucket === 'resolved') return false;
      if (filter !== 'all' && item.filterBucket !== filter) return false;
      if (search) {
        const hay = `${item.referenceNumber} ${item.reportType} ${item.category} ${item.reporterName} ${item.location} ${item.description} ${item.statusLabel}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    return res.json({
      counts,
      reports: filtered,
      items: filtered,
      supportedStatuses: {
        incident: INCIDENT_VALID_STATUSES,
        rescue: RESCUE_VALID_STATUSES,
      },
    });
  } catch (err) {
    console.error('[Admin API] getAdminReportsList failed:', err.message);
    return res.status(503).json({ error: 'Unable to load reports from database.' });
  }
}

async function getAdminReportDetail(req, res) {
  const recordType = String(req.params.type || '').toLowerCase();
  const rawParamId = String(req.params.id || '').trim();

  if (!['incident', 'rescue'].includes(recordType) || !rawParamId) {
    return res.status(400).json({ error: 'Invalid report type or ID.' });
  }

  const parsedInt = parseInt(rawParamId, 10);
  const isNumeric = Number.isInteger(parsedInt) && String(parsedInt) === rawParamId && parsedInt > 0;
  const lookupNumeric = isNumeric ? parsedInt : -1;

  try {
    const [activeResponders] = await pool.query(
      `SELECT u.id, u.name, u.email, rp.badge_number, rp.assigned_unit, rp.availability_status
       FROM users u
       LEFT JOIN responder_profiles rp ON rp.user_id = u.id
       WHERE u.role_id = ? AND u.status = 'active'
       ORDER BY u.name ASC`,
      [ROLE_IDS.RESPONDER]
    );

    if (recordType === 'incident') {
      const [rows] = await pool.query(
        `SELECT r.*,
                u.name AS reporter_name,
                u.email AS reporter_email,
                u.user_code AS reporter_user_code,
                u.status AS reporter_account_status,
                up.phone_number AS reporter_phone,
                up.street_address AS reporter_street,
                up.barangay AS reporter_barangay,
                up.verification_status AS reporter_verification_status,
                resp.name AS assigned_responder_name,
                ver.name AS verified_by_name
         FROM reports r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN user_profiles up ON up.user_id = r.user_id
         LEFT JOIN users resp ON resp.id = r.assigned_to
         LEFT JOIN users ver ON ver.id = r.verified_by
         WHERE r.id = ? OR r.reference_number = ?
         LIMIT 1`,
        [lookupNumeric, rawParamId]
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'Incident report not found.' });
      }
      const r = rows[0];
      const recordId = r.id;

      const [attachments] = await pool.query(
        `SELECT id, file_url, file_name, file_type, file_size, created_at
         FROM incident_attachments
         WHERE incident_id = ?
         ORDER BY created_at ASC`,
        [recordId]
      );

      const [history] = await pool.query(
        `SELECT ish.id, ish.old_status, ish.new_status, ish.remarks, ish.is_internal_note, ish.created_at,
                u.name AS changed_by_name, ro.name AS changed_by_role
         FROM incident_status_history ish
         LEFT JOIN users u ON u.id = ish.changed_by
         LEFT JOIN roles ro ON ro.id = u.role_id
         WHERE ish.incident_id = ?
         ORDER BY ish.created_at DESC, ish.id DESC`,
        [recordId]
      );

      const mappedAttachments = attachments.map((att) => ({
        id: att.id,
        fileUrl: att.file_url,
        file_url: att.file_url,
        fileName: att.file_name,
        file_name: att.file_name,
        fileType: att.file_type || 'image/jpeg',
        file_type: att.file_type || 'image/jpeg',
        fileSize: att.file_size,
        file_size: att.file_size,
        createdAt: att.created_at,
        created_at: att.created_at,
      }));

      const mappedHistory = history.map((h) => ({
        id: h.id,
        oldStatus: h.old_status,
        newStatus: h.new_status,
        status: h.new_status,
        remarks: h.remarks || '',
        notes: h.remarks || '',
        isInternalNote: Boolean(h.is_internal_note),
        changedByName: h.changed_by_name || 'System',
        actorName: h.changed_by_name || 'System',
        changedByRole: h.changed_by_role || 'User',
        createdAt: h.created_at,
      }));

      const detail = {
        uid: `incident-${r.id}`,
        id: r.id,
        recordType: 'incident',
        reportType: 'Incident Report',
        typeLabel: 'Incident Report',
        referenceNumber: r.reference_number || `INC-${r.id}`,
        category: r.incident_type || 'General Incident',
        incidentType: r.incident_type || 'General Incident',
        title: r.title || `${r.incident_type || 'Incident'} Report`,
        description: r.description || 'No description provided.',
        location: r.address || 'Barangay Bayanan, Muntinlupa City',
        address: r.address || 'Barangay Bayanan, Muntinlupa City',
        latitude: r.latitude !== null ? Number(r.latitude) : null,
        longitude: r.longitude !== null ? Number(r.longitude) : null,
        status: r.status,
        rawStatus: r.status,
        statusLabel: normalizeIncidentStatusLabel(r.status),
        filterBucket: mapUnifiedFilterBucket('incident', r.status),
        assignedTo: r.assigned_to || null,
        assignedResponderName: r.assigned_responder_name || null,
        verifiedByName: r.verified_by_name || null,
        verifiedAt: r.verified_at || null,
        resolvedAt: r.resolved_at || null,
        submittedAt: r.created_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        reporter: {
          id: r.user_id,
          userId: r.reporter_user_code || `RSDNT-${String(r.user_id).padStart(4, '0')}`,
          userCode: r.reporter_user_code || `RSDNT-${String(r.user_id).padStart(4, '0')}`,
          name: r.reporter_name || 'Resident',
          email: r.reporter_email || 'Not provided',
          phone: r.reporter_phone || 'Not provided',
          address: r.reporter_street
            ? `${r.reporter_street}, ${r.reporter_barangay || 'Barangay Bayanan'}`
            : (r.reporter_barangay ? `Barangay ${r.reporter_barangay}, Muntinlupa City` : 'Barangay Bayanan, Muntinlupa City'),
          verificationStatus: r.reporter_verification_status || 'Unverified Resident',
          accountStatus: r.reporter_account_status || 'active',
        },
        attachments: mappedAttachments,
        history: mappedHistory,
        statusHistory: mappedHistory,
        allowedStatuses: INCIDENT_VALID_STATUSES,
        validStatuses: INCIDENT_VALID_STATUSES,
        availableResponders: activeResponders,
        activeResponders,
      };

      return res.json({
        ...detail,
        detail,
      });
    }

    // rescue_requests detail
    const [rows] = await pool.query(
      `SELECT rr.*,
              u.name AS reporter_name,
              u.email AS reporter_email,
              u.user_code AS reporter_user_code,
              u.status AS reporter_account_status,
              up.phone_number AS reporter_phone,
              up.street_address AS reporter_street,
              up.barangay AS reporter_barangay,
              up.verification_status AS reporter_verification_status
       FROM rescue_requests rr
       JOIN users u ON u.id = rr.user_id
       LEFT JOIN user_profiles up ON up.user_id = rr.user_id
       WHERE rr.id = ? OR rr.reference_number = ?
       LIMIT 1`,
      [lookupNumeric, rawParamId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Rescue request not found.' });
    }
    const r = rows[0];
    const recordId = r.id;

    const [attachments] = await pool.query(
      `SELECT id, file_url, file_name, file_type, file_size, created_at
       FROM rescue_attachments
       WHERE rescue_id = ?
       ORDER BY created_at ASC`,
      [recordId]
    );

    const [assignments] = await pool.query(
      `SELECT ra.*, u.name AS responder_name
       FROM rescue_assignments ra
       JOIN users u ON u.id = ra.responder_user_id
       WHERE ra.rescue_id = ?
       ORDER BY ra.assigned_at DESC LIMIT 1`,
      [recordId]
    );
    const latestAssign = assignments[0] || null;

    const [history] = await pool.query(
      `SELECT rsh.id, rsh.old_status, rsh.new_status, rsh.work_notes AS remarks, rsh.is_internal_only, rsh.created_at,
              u.name AS changed_by_name, ro.name AS changed_by_role
       FROM rescue_status_history rsh
       LEFT JOIN users u ON u.id = rsh.changed_by
       LEFT JOIN roles ro ON ro.id = u.role_id
       WHERE rsh.rescue_id = ?
       ORDER BY rsh.created_at DESC, rsh.id DESC`,
      [recordId]
    );

    const mappedAttachments = attachments.map((att) => ({
      id: att.id,
      fileUrl: att.file_url,
      file_url: att.file_url,
      fileName: att.file_name,
      file_name: att.file_name,
      fileType: att.file_type || 'image/jpeg',
      file_type: att.file_type || 'image/jpeg',
      fileSize: att.file_size,
      file_size: att.file_size,
      createdAt: att.created_at,
      created_at: att.created_at,
    }));

    const mappedHistory = history.map((h) => ({
      id: h.id,
      oldStatus: h.old_status,
      newStatus: h.new_status,
      status: h.new_status,
      remarks: h.remarks || '',
      notes: h.remarks || '',
      isInternalNote: Boolean(h.is_internal_only),
      changedByName: h.changed_by_name || 'System',
      actorName: h.changed_by_name || 'System',
      changedByRole: h.changed_by_role || 'User',
      createdAt: h.created_at,
    }));

    const rescueLocMeta = parseLocationProvenance(history.map((h) => h.remarks));
    const hasValidRescueCoords = isValidLatLng(r.latitude, r.longitude);

    const detail = {
      uid: `rescue-${r.id}`,
      id: r.id,
      recordType: 'rescue',
      reportType: 'Rescue Request',
      typeLabel: 'Rescue Request',
      referenceNumber: r.reference_number || `RES-${r.id}`,
      category: r.emergency_type || 'Emergency Rescue',
      incidentType: r.emergency_type || 'Emergency Rescue',
      title: `${r.emergency_type || 'Rescue Request'}`,
      description: r.description || 'No description provided.',
      peopleCount: r.people_count || 1,
      vulnerableDetails: r.vulnerable_details || 'None specified',
      landmark: r.landmark || 'None specified',
      location: r.address || 'Location not specified',
      address: r.address || 'Location not specified',
      latitude: hasValidRescueCoords ? Number(r.latitude) : null,
      longitude: hasValidRescueCoords ? Number(r.longitude) : null,
      locationSource: rescueLocMeta.locationSource,
      gpsAccuracy: rescueLocMeta.gpsAccuracy,
      locationCapturedAt: rescueLocMeta.locationCapturedAt,
      status: r.status,
      rawStatus: r.status,
      statusLabel: normalizeRescueStatusLabel(r.status),
      filterBucket: mapUnifiedFilterBucket('rescue', r.status),
      assignedTo: latestAssign ? latestAssign.responder_user_id : null,
      assignedResponderName: latestAssign ? latestAssign.responder_name : null,
      resolvedAt: r.resolved_at || null,
      submittedAt: r.created_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      reporter: {
        id: r.user_id,
        userId: r.reporter_user_code || `RSDNT-${String(r.user_id).padStart(4, '0')}`,
        userCode: r.reporter_user_code || `RSDNT-${String(r.user_id).padStart(4, '0')}`,
        name: r.reporter_name || 'Resident',
        email: r.reporter_email || 'Not provided',
        phone: r.reporter_phone || 'Not provided',
        address: r.reporter_street
          ? `${r.reporter_street}, ${r.reporter_barangay || 'Barangay Bayanan'}`
          : (r.reporter_barangay ? `Barangay ${r.reporter_barangay}, Muntinlupa City` : 'Barangay Bayanan, Muntinlupa City'),
        verificationStatus: r.reporter_verification_status || 'Unverified Resident',
        accountStatus: r.reporter_account_status || 'active',
      },
      categoryDetails: {
        peopleCount: r.people_count || 1,
        vulnerableDetails: r.vulnerable_details || 'None specified',
        landmark: r.landmark || 'None specified',
      },
      attachments: mappedAttachments,
      history: mappedHistory,
      statusHistory: mappedHistory,
      allowedStatuses: RESCUE_VALID_STATUSES,
      validStatuses: RESCUE_VALID_STATUSES,
      allowedSeverities: RESCUE_VALID_PRIORITIES,
      validSeverities: RESCUE_VALID_PRIORITIES,
      availableResponders: activeResponders,
      activeResponders,
    };

    return res.json({
      ...detail,
      detail,
    });
  } catch (err) {
    console.error('[Admin API] getAdminReportDetail failed:', err.message);
    return res.status(503).json({ error: 'Unable to load report details from database.' });
  }
}

async function reviewAdminReport(req, res) {
  const recordType = String(req.params.type || '').toLowerCase();
  const rawParamId = String(req.params.id || '').trim();

  if (!['incident', 'rescue'].includes(recordType) || !rawParamId) {
    return res.status(400).json({ error: 'Invalid report type or ID.' });
  }

  const parsedInt = parseInt(rawParamId, 10);
  const isNumeric = Number.isInteger(parsedInt) && String(parsedInt) === rawParamId && parsedInt > 0;
  const lookupNumeric = isNumeric ? parsedInt : -1;

  const { action, status, assignedTo, reason } = req.body || {};
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';

  // Rejecting / dismissing or requesting clarification or resolving requires a reason
  const isRejection =
    action === 'reject' ||
    (recordType === 'incident' && ['false_alarm', 'dismissed'].includes(status)) ||
    (recordType === 'rescue' && status === 'Cancelled');
  const isClarification = action === 'clarify';
  const isResolution =
    action === 'resolve' ||
    (recordType === 'incident' && status === 'resolved') ||
    (recordType === 'rescue' && status === 'Completed');

  if ((isRejection || isClarification || isResolution) && !trimmedReason) {
    return res.status(400).json({
      error: isRejection
        ? 'A reason is required when rejecting or dismissing a report.'
        : isClarification
          ? 'Please specify what clarification is needed from the reporter.'
          : 'Please provide resolution remarks before marking this record resolved.',
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (recordType === 'incident') {
      const [rows] = await conn.query('SELECT * FROM reports WHERE id = ? OR reference_number = ? FOR UPDATE', [lookupNumeric, rawParamId]);
      if (!rows.length) {
        await conn.rollback();
        return res.status(404).json({ error: 'Incident report not found.' });
      }
      const current = rows[0];
      const recordId = current.id;
      const refNum = current.reference_number || `INC-${recordId}`;

      let targetStatus = status || current.status;
      if (action === 'verify') targetStatus = 'verified';
      else if (action === 'reject') targetStatus = 'false_alarm';
      else if (action === 'resolve') targetStatus = 'resolved';

      if (!INCIDENT_VALID_STATUSES.includes(targetStatus)) {
        await conn.rollback();
        return res.status(400).json({ error: `Unsupported incident status: ${targetStatus}` });
      }

      let targetAssignee = current.assigned_to;
      if (assignedTo !== undefined) {
        targetAssignee = assignedTo ? parseInt(assignedTo, 10) : null;
        if (targetAssignee) {
          const [respCheck] = await conn.query(
            "SELECT id FROM users WHERE id = ? AND role_id = ? AND status = 'active'",
            [targetAssignee, ROLE_IDS.RESPONDER]
          );
          if (!respCheck.length) {
            await conn.rollback();
            return res.status(400).json({ error: 'Selected responder is not an active Responder account.' });
          }
        }
      }

      const updates = ['status = ?', 'assigned_to = ?'];
      const params = [targetStatus, targetAssignee];

      if (['verified', 'dispatched', 'responding', 'on_site', 'in_progress', 'resolved'].includes(targetStatus)) {
        updates.push('is_public = 1');
      } else if (['pending', 'under_review', 'false_alarm', 'dismissed'].includes(targetStatus)) {
        updates.push('is_public = 0');
      }

      if (targetStatus === 'verified' && current.status !== 'verified') {
        updates.push('verified_by = ?', 'verified_at = NOW()');
        params.push(req.user.id);
      }
      if (targetStatus === 'resolved' && current.status !== 'resolved') {
        updates.push('resolved_at = NOW()');
      }

      await conn.query(`UPDATE reports SET ${updates.join(', ')} WHERE id = ?`, [...params, recordId]);

      const historyRemark =
        trimmedReason ||
        (action === 'verify'
          ? 'Verified by Administrator'
          : `Administrative update (${current.status} -> ${targetStatus})`);

      await conn.query(
        `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, remarks)
         VALUES (?, ?, ?, ?, ?)`,
        [recordId, current.status, targetStatus, req.user.id, historyRemark]
      );

      if (targetAssignee && targetAssignee !== current.assigned_to) {
        await conn.query(
          `INSERT INTO incident_assignments (report_id, responder_user_id, assigned_by, assignment_status, dispatch_instructions)
           VALUES (?, ?, ?, 'Assigned', ?)`,
          [recordId, targetAssignee, req.user.id, trimmedReason || 'Assigned by EOC Administrator']
        );
      }

      const notifTitle = isClarification
        ? `Clarification Requested: ${refNum}`
        : `Report Update (${refNum}): ${normalizeIncidentStatusLabel(targetStatus)}`;
      const notifMsg = isClarification
        ? trimmedReason
        : `Your incident report ${refNum} is now marked "${normalizeIncidentStatusLabel(targetStatus)}". ${historyRemark}`;

      const notifRecipients = [current.user_id];
      if (targetAssignee && targetAssignee !== current.assigned_to) {
        notifRecipients.push(targetAssignee);
      }

      await insertNotificationForUsers(conn, {
        title: notifTitle,
        message: notifMsg,
        category: 'Alert',
        createdBy: req.user.id,
        userIds: notifRecipients,
      });

      await writeAuditLog(conn, {
        userId: req.user.id,
        action: isRejection
          ? 'INCIDENT_REPORT_REJECTED'
          : isClarification
            ? 'INCIDENT_CLARIFICATION_REQUESTED'
            : targetStatus === 'verified'
              ? 'INCIDENT_REPORT_VERIFIED'
              : 'INCIDENT_REPORT_REVIEWED',
        entityType: 'reports',
        entityId: refNum,
        oldValues: { status: current.status, assigned_to: current.assigned_to },
        newValues: { status: targetStatus, assigned_to: targetAssignee, reason: historyRemark },
        req,
      });

      await conn.commit();

      if (targetAssignee && targetAssignee !== current.assigned_to) {
        emitAssignmentUpdate({
          id: recordId,
          referenceNumber: refNum,
          assignmentType: 'incident',
          status: targetStatus,
          assignedTo: targetAssignee,
          residentId: current.user_id,
        });
      }
      if (targetStatus === 'resolved' && current.status !== 'resolved') {
        emitIncidentResolved({
          id: recordId,
          referenceNumber: refNum,
          residentId: current.user_id,
          assignedTo: targetAssignee,
          reason: historyRemark,
        });
      } else if (targetStatus === 'verified' || isRejection || isClarification) {
        emitReportVerificationResult({
          id: recordId,
          referenceNumber: refNum,
          status: targetStatus,
          decision: isRejection ? 'rejected' : isClarification ? 'clarification' : 'verified',
          reason: historyRemark,
          message: notifMsg,
          residentId: current.user_id,
        });
      } else {
        emitStatusUpdate({
          id: recordId,
          referenceNumber: refNum,
          recordType: 'incident',
          status: targetStatus,
          assignedTo: targetAssignee,
          residentId: current.user_id,
          reason: historyRemark,
        });
      }
      if (targetStatus === 'verified' && current.status !== 'verified') {
        emitPublicVerifiedReport({
          ...current,
          id: refNum,
          referenceNumber: refNum,
          status: 'verified',
          rawStatus: 'verified',
        });
      }
      return res.json({ message: 'Incident report review saved.', status: targetStatus });
    }

    // Rescue request review
    const [rows] = await conn.query('SELECT * FROM rescue_requests WHERE id = ? OR reference_number = ? FOR UPDATE', [lookupNumeric, rawParamId]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Rescue request not found.' });
    }
    const current = rows[0];
    const recordId = current.id;
    const refNum = current.reference_number || `RES-${recordId}`;

    let targetStatus = status || current.status;
    if (action === 'verify') targetStatus = current.status === 'Pending Dispatch' ? 'Assigned' : current.status;
    else if (action === 'reject') targetStatus = 'Cancelled';
    else if (action === 'resolve') targetStatus = 'Completed';

    if (!RESCUE_VALID_STATUSES.includes(targetStatus)) {
      await conn.rollback();
      return res.status(400).json({ error: `Unsupported rescue request status: ${targetStatus}` });
    }

    const updates = ['status = ?'];
    const params = [targetStatus];
    if (targetStatus === 'Completed' && current.status !== 'Completed') {
      updates.push('resolved_at = NOW()', 'confirmed_by = ?', 'confirmed_resolved_at = NOW()');
      params.push(req.user.id);
    }

    await conn.query(`UPDATE rescue_requests SET ${updates.join(', ')} WHERE id = ?`, [...params, recordId]);

    const historyRemark =
      trimmedReason ||
      (action === 'verify'
        ? 'Verified and queued for dispatch by Administrator'
        : `Administrative update (${current.status} -> ${targetStatus})`);

    await conn.query(
      `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes)
       VALUES (?, ?, ?, ?, ?)`,
      [recordId, current.status, targetStatus, req.user.id, historyRemark]
    );

    let responderId = null;
    if (assignedTo) {
      responderId = parseInt(assignedTo, 10);
      const [respCheck] = await conn.query(
        "SELECT id FROM users WHERE id = ? AND role_id = ? AND status = 'active'",
        [responderId, ROLE_IDS.RESPONDER]
      );
      if (!respCheck.length) {
        await conn.rollback();
        return res.status(400).json({ error: 'Selected responder is not an active Responder account.' });
      }
      await conn.query(
        `INSERT INTO rescue_assignments (rescue_id, responder_user_id, assigned_by, assignment_status, dispatch_instructions)
         VALUES (?, ?, ?, 'Assigned', ?)`,
        [recordId, responderId, req.user.id, trimmedReason || 'Dispatched by EOC Administrator']
      );
    }

    const notifTitle = isClarification
      ? `Clarification Requested: ${refNum}`
      : `Rescue Update (${refNum}): ${targetStatus}`;
    const notifMsg = isClarification
      ? trimmedReason
      : `Your emergency rescue request ${refNum} is now marked "${targetStatus}". ${historyRemark}`;

    const notifRecipients = [current.user_id];
    if (responderId) notifRecipients.push(responderId);

    await insertNotificationForUsers(conn, {
      title: notifTitle,
      message: notifMsg,
      category: 'Alert',
      createdBy: req.user.id,
      userIds: notifRecipients,
    });

    await writeAuditLog(conn, {
      userId: req.user.id,
      action: isRejection
        ? 'RESCUE_REQUEST_REJECTED'
        : isClarification
          ? 'RESCUE_CLARIFICATION_REQUESTED'
          : action === 'verify'
            ? 'RESCUE_REQUEST_VERIFIED'
            : 'RESCUE_REQUEST_REVIEWED',
      entityType: 'rescue_requests',
      entityId: refNum,
      oldValues: { status: current.status },
      newValues: { status: targetStatus, reason: historyRemark },
      req,
    });

    await conn.commit();

    if (responderId) {
      emitAssignmentUpdate({
        id: recordId,
        referenceNumber: refNum,
        assignmentType: 'rescue',
        status: targetStatus,
        assignedTo: responderId,
        residentId: current.user_id,
      });
    }
    if (targetStatus === 'Completed' && current.status !== 'Completed') {
      emitIncidentResolved({
        id: recordId,
        referenceNumber: refNum,
        recordType: 'rescue',
        status: 'Completed',
        residentId: current.user_id,
        assignedTo: responderId,
      });
    }
    emitStatusUpdate({
      id: recordId,
      referenceNumber: refNum,
      recordType: 'rescue',
      status: targetStatus,
      assignedTo: responderId,
      residentId: current.user_id,
    });
    return res.json({ message: 'Rescue request review saved.', status: targetStatus });
  } catch (err) {
    await conn.rollback().catch(() => { });
    console.error('[Admin API] reviewAdminReport failed:', err.message);
    return res.status(503).json({ error: 'Unable to save report review in database.' });
  } finally {
    conn.release();
  }
}

// ============================================================================
// 3. USERS MANAGEMENT (RESIDENTS & RESPONDERS)
// ============================================================================
async function getAdminUsers(req, res) {
  try {
    const roleTab = String(req.query.role || 'resident').toLowerCase();
    const statusFilter = String(req.query.status || 'all').toLowerCase();
    const locationFilter = String(req.query.locationStatus || 'all').toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 10));

    const targetRoleId = roleTab === 'responder' || roleTab === 'responders' ? ROLE_IDS.RESPONDER : ROLE_IDS.RESIDENT;
    const targetRoleName = targetRoleId === ROLE_IDS.RESPONDER ? 'responder' : 'resident';

    const [[resCountRow]] = await pool.query(
      'SELECT COUNT(DISTINCT id) AS count FROM users WHERE role_id = ? OR LOWER(role) = ?',
      [ROLE_IDS.RESIDENT, 'resident']
    );
    const [[respCountRow]] = await pool.query(
      'SELECT COUNT(DISTINCT id) AS count FROM users WHERE role_id = ? OR LOWER(role) = ?',
      [ROLE_IDS.RESPONDER, 'responder']
    );

    const [rows] = await pool.query(
      `SELECT u.id, u.user_code, u.name, u.email, u.role_id, u.role AS user_role, r.name AS role_name,
              u.status, u.account_status, u.safety_status, u.last_login_at, u.created_at,
              up.first_name, up.last_name, up.phone_number, up.street_address, up.barangay, up.city,
              up.verification_status, up.location_verification_status, up.location_verification_method,
              up.location_accuracy_meters, up.location_boundary_distance_meters,
              up.location_verified_at, up.location_verified_by, up.location_review_reason,
              verifier.name AS location_verified_by_name,
              rp.badge_number, rp.callsign, rp.assigned_unit, rp.department, rp.specialization, rp.availability_status,
              rp.organization, rp.designation, rp.service_id
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN users verifier ON verifier.id = up.location_verified_by
       LEFT JOIN responder_profiles rp ON rp.user_id = u.id
       WHERE (u.role_id = ? OR (u.role_id IS NULL AND LOWER(u.role) = ?))
       ORDER BY u.created_at DESC, u.id DESC`,
      [targetRoleId, targetRoleName]
    );

    // Guaranteed deduplication across potential SQL joins
    const seenUserIds = new Set();
    const uniqueUsersList = [];
    for (const r of rows) {
      if (!seenUserIds.has(r.id)) {
        seenUserIds.add(r.id);
        uniqueUsersList.push(r);
      }
    }

    const filtered = uniqueUsersList.filter((u) => {
      const acctStatus = String(u.account_status || u.status || 'active').toLowerCase();
      if (statusFilter !== 'all' && acctStatus !== statusFilter) return false;
      if (locationFilter !== 'all' && targetRoleId === ROLE_IDS.RESIDENT) {
        const locStatus = String(u.location_verification_status || 'pending_review').toLowerCase();
        if (locStatus !== locationFilter) return false;
      }
      if (search) {
        const rawId = String(u.id);
        const userCode = String(u.user_code || '').toLowerCase();
        const hay = `${rawId} ${userCode} ${u.name} ${u.email} ${u.phone_number || ''} ${u.street_address || ''} ${u.badge_number || ''} ${u.assigned_unit || ''} ${u.department || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * limit;
    const paginated = filtered.slice(startIdx, startIdx + limit).map((u) => {
      const displayRole = u.role_name || roleDisplayName(u.role_id) || (targetRoleId === ROLE_IDS.RESPONDER ? 'Responder' : 'Resident');
      const userCode = u.user_code || (u.role_id === ROLE_IDS.RESPONDER ? `RSPDR-${String(u.id).padStart(4, '0')}` : `RSDNT-${String(u.id).padStart(4, '0')}`);
      return {
        id: u.id,
        userId: userCode,
        userCode: userCode,
        user_code: userCode,
        name: u.name,
        firstName: u.first_name || '',
        lastName: u.last_name || '',
        email: u.email,
        roleId: u.role_id,
        role: displayRole,
        roleName: displayRole,
        status: u.account_status || u.status || 'active',
        phone: u.phone_number || 'Not provided',
        address: u.street_address
          ? `${u.street_address}, ${u.barangay || 'Barangay Bayanan'}`
          : 'Barangay Bayanan, Muntinlupa City',
        verificationStatus: u.verification_status || 'Unverified Resident',
        locationVerificationStatus: u.location_verification_status || 'pending_review',
        locationVerificationMethod: u.location_verification_method || 'none',
        locationAccuracyMeters: u.location_accuracy_meters !== null && u.location_accuracy_meters !== undefined ? Number(u.location_accuracy_meters) : null,
        locationBoundaryDistanceMeters: u.location_boundary_distance_meters !== null && u.location_boundary_distance_meters !== undefined ? Number(u.location_boundary_distance_meters) : null,
        locationVerifiedAt: u.location_verified_at || null,
        locationVerifiedBy: u.location_verified_by || null,
        locationVerifiedByName: u.location_verified_by_name || null,
        locationReviewReason: u.location_review_reason || null,
        badgeNumber: u.badge_number || null,
        callsign: u.callsign || null,
        assignedUnit: u.assigned_unit || null,
        department: u.department || null,
        specialization: u.specialization || null,
        organization: u.organization || u.department || 'Barangay Bayanan Emergency Response Team',
        responderUnit: u.organization || u.assigned_unit || 'Barangay Bayanan Emergency Response Team',
        designation: u.designation || u.specialization || null,
        serviceId: u.service_id || u.badge_number || null,
        availabilityStatus: u.availability_status || null,
        lastLoginAt: u.last_login_at,
        registeredAt: u.created_at,
      };
    });

    return res.json({
      counts: {
        residents: Number((resCountRow && resCountRow.count) || 0),
        responders: Number((respCountRow && respCountRow.count) || 0),
      },
      pagination: {
        page: safePage,
        limit,
        total,
        totalPages,
      },
      users: paginated,
    });
  } catch (err) {
    console.error('[Admin API] getAdminUsers failed:', err.message);
    return res.status(503).json({ error: 'Unable to load user directory from database.' });
  }
}

async function createResponderAccount(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
  }

  const {
    first_name,
    firstName: bodyFirstName,
    middle_name,
    middleName: bodyMiddleName,
    last_name,
    lastName: bodyLastName,
    surname,
    email,
    password,
    contact_number,
    phone_number,
    phone,
    organization,
    custom_organization,
    organization_name,
    organizationName,
    designation,
    custom_designation,
    customDesignation,
    service_id,
    serviceId,
    organization_id,
    organizationId,
    badge_number,
    badgeNumber,
    callsign,
    account_status,
    status,
  } = req.body || {};

  const FIXED_ORGANIZATION = 'Barangay Bayanan Emergency Response Team';
  const firstName = String(first_name || bodyFirstName || '').trim().slice(0, 80);
  const middleName = String(middle_name || bodyMiddleName || '').trim().slice(0, 80) || null;
  const lastName = String(last_name || bodyLastName || surname || '').trim().slice(0, 80);
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const contactNo = String(contact_number || phone_number || phone || '').trim().slice(0, 30);

  // Single fixed responder organization for Barangay Bayanan
  const effectiveOrg = FIXED_ORGANIZATION;

  // Resolve designation / position
  const rawDesig = String(designation || '').trim().slice(0, 120);
  const customDesig = String(custom_designation || customDesignation || '').trim().slice(0, 120);
  const effectiveDesignation = (rawDesig === 'Other' && customDesig)
    ? customDesig
    : (rawDesig !== 'Other' && rawDesig ? rawDesig : customDesig);

  const serviceIdVal = String(service_id || serviceId || organization_id || organizationId || badge_number || badgeNumber || '').trim().slice(0, 50) || null;
  const rawStatus = String(account_status || status || 'active').trim().toLowerCase();
  const isInactive = rawStatus === 'inactive' || rawStatus === 'deactivated';
  const finalStatus = isInactive ? 'deactivated' : 'active';

  if (!firstName || !lastName || !normalizedEmail || !contactNo || !effectiveDesignation) {
    return res.status(400).json({
      error: 'First name, last name, email, contact number, and designation are required for Responder accounts.',
    });
  }

  if (rawDesig === 'Other' && !customDesig) {
    return res.status(400).json({
      error: 'Please specify the custom designation / position when "Other" is selected.',
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dupEmail] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE', [normalizedEmail]);
    if (dupEmail.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'Email address is already registered.' });
    }

    if (serviceIdVal) {
      const [dupServiceId] = await conn.query(
        'SELECT id FROM responder_profiles WHERE service_id = ? OR badge_number = ? LIMIT 1 FOR UPDATE',
        [serviceIdVal, serviceIdVal]
      );
      if (dupServiceId.length > 0) {
        await conn.rollback();
        return res.status(409).json({ error: 'Organization ID / Service ID is already assigned to another Responder.' });
      }
    }

    // Automatically generate unique Responder ID via the centralized ID-generation system (e.g. RSPDR-0001)
    const { userCode } = await generateNextUserCode(conn, ROLE_IDS.RESPONDER);

    // Always generate secure temporary credentials on the server (never allow admin to set permanent password)
    const temporaryPassword = `GS@${crypto.randomBytes(4).toString('hex')}#${crypto.randomInt(100, 1000)}`;

    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);
    const badge = serviceIdVal || userCode;

    const [insertRes] = await conn.query(
      `INSERT INTO users (user_code, name, email, password_hash, role_id, role, status, account_status, must_change_password)
       VALUES (?, ?, ?, ?, ?, 'responder', ?, ?, TRUE)`,
      [userCode, fullName, normalizedEmail, passwordHash, ROLE_IDS.RESPONDER, finalStatus, finalStatus]
    );
    const newResponderId = insertRes.insertId;

    await conn.query(
      `INSERT INTO user_profiles (user_id, first_name, middle_name, last_name, phone_number, barangay, city, province, verification_status)
       VALUES (?, ?, ?, ?, ?, 'Barangay Bayanan', 'Muntinlupa City', 'Metro Manila', 'Verified Resident')`,
      [newResponderId, firstName, middleName, lastName, contactNo || null]
    );

    await conn.query(
      `INSERT INTO responder_profiles (user_id, badge_number, callsign, assigned_unit, department, specialization, organization, custom_organization, designation, service_id, availability_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        newResponderId,
        badge,
        callsign ? String(callsign).trim().slice(0, 50) : userCode,
        FIXED_ORGANIZATION,
        FIXED_ORGANIZATION,
        effectiveDesignation,
        FIXED_ORGANIZATION,
        effectiveDesignation,
        serviceIdVal,
        finalStatus === 'active' ? 'Off Duty' : 'Unavailable',
      ]
    );

    await writeAuditLog(conn, {
      userId: req.user.id,
      action: 'RESPONDER_ACCOUNT_CREATED',
      entityType: 'users',
      entityId: String(newResponderId),
      newValues: {
        id: newResponderId,
        user_code: userCode,
        name: fullName,
        email: normalizedEmail,
        role_id: ROLE_IDS.RESPONDER,
        organization: effectiveOrg,
        designation: effectiveDesignation,
        service_id: serviceIdVal,
        badge_number: badge,
        status: finalStatus,
      },
      req,
    });

    await conn.commit();

    const responderData = {
      id: newResponderId,
      responderId: userCode,
      user_code: userCode,
      userCode: userCode,
      userId: userCode,
      firstName,
      middleName,
      lastName,
      name: fullName,
      email: normalizedEmail,
      contactNumber: contactNo,
      phone: contactNo,
      organization: effectiveOrg,
      responderUnit: effectiveOrg,
      assignedUnit: effectiveOrg,
      designation: effectiveDesignation,
      specialization: effectiveDesignation,
      serviceId: serviceIdVal,
      roleId: ROLE_IDS.RESPONDER,
      roleName: 'Responder',
      badgeNumber: badge,
      status: finalStatus,
      account_status: finalStatus,
      mustChangePassword: true,
      temporaryPassword,
    };

    return res.status(201).json({
      message: 'Responder account created successfully.',
      responder: responderData,
      user: responderData,
    });
  } catch (err) {
    await conn.rollback().catch(() => { });
    console.error('[Admin API] createResponderAccount failed:', err.message);
    return res.status(503).json({ error: 'Unable to create Responder account.' });
  } finally {
    conn.release();
  }
}

async function updateAdminUserStatus(req, res) {
  const targetUserId = parseInt(req.params.id, 10);
  const rawStatus = String((req.body && req.body.status) || '').toLowerCase();
  const newStatus = rawStatus === 'inactive' ? 'deactivated' : rawStatus;
  const reason = typeof (req.body && req.body.reason) === 'string' ? req.body.reason.trim() : '';

  if (!Number.isInteger(targetUserId) || targetUserId < 1) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }
  if (!['active', 'suspended', 'deactivated'].includes(newStatus)) {
    return res.status(400).json({ error: 'Status must be active, suspended, or deactivated.' });
  }
  if (targetUserId === req.user.id && newStatus !== 'active') {
    return res.status(400).json({ error: 'Administrators cannot suspend or deactivate their own account.' });
  }
  if (newStatus !== 'active' && !reason) {
    return res.status(400).json({ error: 'A reason is required when suspending or deactivating an account.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT id, name, email, role_id, status, account_status FROM users WHERE id = ? FOR UPDATE',
      [targetUserId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'User account not found.' });
    }

    const target = rows[0];
    const prevStatus = target.account_status || target.status || 'active';

    if (prevStatus !== newStatus) {
      await conn.query('UPDATE users SET status = ?, account_status = ? WHERE id = ?', [
        newStatus,
        newStatus,
        targetUserId,
      ]);

      await conn.query(
        `INSERT INTO account_status_history (user_id, previous_status, new_status, changed_by, reason)
         VALUES (?, ?, ?, ?, ?)`,
        [targetUserId, prevStatus, newStatus, req.user.id, reason || 'Reactivated by Administrator']
      );

      const secEvent = newStatus === 'active' ? 'account_reactivated' : 'account_suspended';
      await conn.query(
        `INSERT INTO auth_security_logs (user_id, attempted_email, event_type, ip_address, user_agent, details)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          targetUserId,
          target.email,
          secEvent,
          String(req.ip || '0.0.0.0').slice(0, 45),
          req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null,
          JSON.stringify({ previous_status: prevStatus, new_status: newStatus, reason: reason || 'Reactivated' }).slice(0, 255),
        ]
      );

      await writeAuditLog(conn, {
        userId: req.user.id,
        action: newStatus === 'active' ? 'USER_ACCOUNT_REACTIVATED' : `USER_ACCOUNT_${newStatus.toUpperCase()}`,
        entityType: 'users',
        entityId: String(targetUserId),
        oldValues: { status: prevStatus },
        newValues: { status: newStatus, reason: reason || 'Reactivated by Administrator' },
        req,
      });
    }

    await conn.commit();
    return res.json({
      message: `Account status updated to ${newStatus}.`,
      user: {
        id: target.id,
        name: target.name,
        email: target.email,
        status: newStatus,
      },
    });
  } catch (err) {
    await conn.rollback().catch(() => { });
    console.error('[Admin API] updateAdminUserStatus failed:', err.message);
    return res.status(503).json({ error: 'Unable to update account status.' });
  } finally {
    conn.release();
  }
}

async function reviewResidentLocationVerification(req, res) {
  const targetUserId = parseInt(req.params.id, 10);
  if (!Number.isFinite(targetUserId)) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  const decision = String((req.body && req.body.decision) || '').trim().toLowerCase();
  const reason = String((req.body && req.body.reason) || '').trim();

  if (!['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be either "approve" or "reject".' });
  }
  if (!reason || reason.length < 3) {
    return res.status(400).json({ error: 'A concise reason (minimum 3 characters) is required for manual verification decisions.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT u.id, u.name, u.email, u.role_id,
              up.verification_status, up.location_verification_status, up.location_verification_method,
              up.location_review_reason
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id = ? LIMIT 1`,
      [targetUserId]
    );

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Resident user not found.' });
    }

    const target = rows[0];
    if (Number(target.role_id) !== ROLE_IDS.RESIDENT) {
      await conn.rollback();
      return res.status(400).json({ error: 'Location verification review applies only to Resident accounts.' });
    }

    const newLocStatus = decision === 'approve' ? 'verified' : 'outside_boundary';
    const newVerifStatus = decision === 'approve' ? 'Verified Resident' : 'Unverified Resident';
    const cleanReason = reason.slice(0, 500);

    await conn.query(
      `UPDATE user_profiles
       SET location_verification_status = ?,
           verification_status = ?,
           location_verification_method = 'manual_admin',
           location_verified_by = ?,
           location_verified_at = CURRENT_TIMESTAMP,
           location_review_reason = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [newLocStatus, newVerifStatus, req.user.id, cleanReason, targetUserId]
    );

    const auditAction = decision === 'approve'
      ? 'RESIDENT_LOCATION_VERIFICATION_APPROVED'
      : 'RESIDENT_LOCATION_VERIFICATION_REJECTED';

    await writeAuditLog(conn, {
      userId: req.user.id,
      action: auditAction,
      entityType: 'USER_MANAGEMENT',
      entityId: String(targetUserId),
      oldValues: {
        verification_status: target.verification_status || 'Unverified Resident',
        location_verification_status: target.location_verification_status || 'pending_review',
        location_verification_method: target.location_verification_method || 'none',
        location_review_reason: target.location_review_reason || null,
      },
      newValues: {
        verification_status: newVerifStatus,
        location_verification_status: newLocStatus,
        location_verification_method: 'manual_admin',
        reviewed_by_admin_id: req.user.id,
        decision,
        reason: cleanReason,
      },
      req,
    });

    await conn.commit();
    return res.json({
      message: decision === 'approve'
        ? 'Resident location verification approved.'
        : 'Resident location verification rejected.',
      resident: {
        id: target.id,
        name: target.name,
        email: target.email,
        verificationStatus: newVerifStatus,
        locationVerificationStatus: newLocStatus,
        locationVerificationMethod: 'manual_admin',
        locationVerifiedBy: req.user.id,
        locationReviewReason: cleanReason,
      },
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Admin API] reviewResidentLocationVerification failed:', err.message);
    return res.status(503).json({ error: 'Unable to update resident location verification.' });
  } finally {
    conn.release();
  }
}

// ============================================================================
// 4. READ-ONLY AUDIT LOGS (GET /api/admin/audit-logs)
// ============================================================================
function classifyModuleFromEntity(entityType, action) {
  const ent = String(entityType || '').toLowerCase();
  const act = String(action || '').toLowerCase();
  if (ent === 'user_management' || act.includes('user_registered')) return 'USER_MANAGEMENT';
  if (ent.includes('report') || act.includes('incident')) return 'Incident Reports';
  if (ent.includes('rescue') || act.includes('rescue')) return 'Rescue Requests';
  if (ent.includes('alert') || ent.includes('broadcast')) return 'Emergency Broadcasts';
  if (ent.includes('auth') || act.includes('login') || act.includes('logout') || act.includes('token')) {
    return 'Authentication';
  }
  if (ent.includes('user') || act.includes('admin') || act.includes('responder') || act.includes('account') || act.includes('register')) {
    return 'USER_MANAGEMENT';
  }
  return 'System';
}

function deriveAuditResult(action) {
  const act = String(action || '').toLowerCase();
  if (act.includes('fail') || act.includes('unauthorized') || act.includes('denied') || act.includes('error')) {
    return 'FAILURE';
  }
  return 'SUCCESS';
}

async function getAdminAuditLogs(req, res) {
  try {
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();
    const userFilter = String(req.query.user || '').trim().toLowerCase();
    const roleFilter = String(req.query.role || 'all').trim().toLowerCase();
    const activityFilter = String(req.query.activity || 'all').trim().toLowerCase();
    const resultFilter = String(req.query.result || 'all').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 15));

    // Query existing audit_logs table joined with users and roles
    const [auditRows] = await pool.query(
      `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id,
              al.old_values, al.new_values, al.ip_address, al.user_agent, al.created_at,
              u.name AS user_name, u.email AS user_email, r.name AS role_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT 1000`
    );

    // Also include authentication & security events from auth_security_logs so failed/successful logins & RBAC blocks appear in the audit stream
    const [secRows] = await pool.query(
      `SELECT asl.id, asl.user_id, asl.attempted_email, asl.event_type, asl.attempted_role,
              asl.ip_address, asl.user_agent, asl.details, asl.created_at,
              u.name AS user_name, u.email AS user_email, r.name AS role_name
       FROM auth_security_logs asl
       LEFT JOIN users u ON u.id = asl.user_id
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY asl.created_at DESC, asl.id DESC
       LIMIT 1000`
    );

    const combined = [
      ...auditRows.map((row) => {
        let meta = null;
        if (row.new_values) {
          try {
            meta = typeof row.new_values === 'string' ? JSON.parse(row.new_values) : row.new_values;
          } catch (_) { }
        }
        const activityName = (row.action === 'RESIDENT_SELF_REGISTERED' || row.action === 'ADMIN_CREATE_RESIDENT')
          ? 'USER_REGISTERED'
          : row.action;
        const userName = row.user_name || (meta && meta.name) || (meta && meta.email) || 'System';
        const userEmail = row.user_email || (meta && meta.email) || '';
        const role = row.role_name || (meta && meta.role) || (activityName === 'USER_REGISTERED' ? 'Resident' : 'Administrator');
        const moduleName = classifyModuleFromEntity(row.entity_type, row.action);

        return {
          uid: `AUD-${row.id}`,
          id: row.id,
          source: 'audit_logs',
          timestamp: row.created_at,
          userId: row.user_id,
          userName,
          userEmail,
          role,
          activity: activityName,
          module: moduleName,
          entityType: row.entity_type,
          entityId: row.entity_id || '',
          result: deriveAuditResult(row.action),
          ipAddress: row.ip_address || '—',
        };
      }),
      ...secRows.map((row) => ({
        uid: `SEC-${row.id}`,
        id: row.id,
        source: 'auth_security_logs',
        timestamp: row.created_at,
        userId: row.user_id,
        userName: row.user_name || row.attempted_email || 'Unauthenticated Visitor',
        userEmail: row.user_email || row.attempted_email || '',
        role: row.role_name || (row.attempted_role ? `Attempted: ${row.attempted_role}` : 'Unauthenticated'),
        activity: String(row.event_type || '').toUpperCase(),
        module: 'Authentication',
        entityType: 'auth_security_logs',
        entityId: row.details || '',
        result: ['login_failed', 'unauthorized_role_attempt'].includes(row.event_type) ? 'FAILURE' : 'SUCCESS',
        ipAddress: row.ip_address || '—',
      })),
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const distinctActivities = Array.from(new Set(combined.map((c) => c.activity))).sort();

    const filtered = combined.filter((entry) => {
      if (dateFrom) {
        const fromTime = new Date(`${dateFrom}T00:00:00`).getTime();
        if (!Number.isNaN(fromTime) && new Date(entry.timestamp).getTime() < fromTime) return false;
      }
      if (dateTo) {
        const toTime = new Date(`${dateTo}T23:59:59.999`).getTime();
        if (!Number.isNaN(toTime) && new Date(entry.timestamp).getTime() > toTime) return false;
      }
      if (userFilter) {
        const uHay = `${entry.userName} ${entry.userEmail}`.toLowerCase();
        if (!uHay.includes(userFilter)) return false;
      }
      if (roleFilter !== 'all' && entry.role.toLowerCase() !== roleFilter) return false;
      if (activityFilter !== 'all') {
        const actLower = entry.activity.toLowerCase();
        const filtLower = activityFilter.toLowerCase();
        if (actLower !== filtLower && !(filtLower === 'user_registered' && actLower.includes('register'))) return false;
      }
      if (resultFilter !== 'all' && entry.result.toLowerCase() !== resultFilter.toLowerCase()) return false;
      if (search) {
        const hay = `${entry.userName} ${entry.userEmail} ${entry.role} ${entry.activity} ${entry.module} ${entry.result} ${entry.ipAddress} ${entry.entityId}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * limit;
    const logs = filtered.slice(startIdx, startIdx + limit);

    return res.json({
      pagination: {
        page: safePage,
        limit,
        total,
        totalPages,
      },
      activities: distinctActivities,
      logs,
    });
  } catch (err) {
    console.error('[Admin API] getAdminAuditLogs failed:', err.message);
    return res.status(503).json({ error: 'Unable to load audit logs from database.' });
  }
}

// ============================================================================
// 5. RESPONDERS MANAGEMENT & DISPATCH (GET /api/admin/responders & POST /api/admin/responders/assign)
// ============================================================================

async function getAdminRespondersList(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT 
         u.id AS user_id,
         u.user_code,
         u.email,
         u.status AS account_status,
         u.created_at AS registered_at,
         up.first_name,
         up.middle_name,
         up.last_name,
         up.phone_number,
         rp.badge_number,
         rp.callsign,
         rp.assigned_unit,
         rp.department,
         rp.specialization,
         rp.organization,
         rp.custom_organization,
         rp.designation,
         rp.service_id,
         rp.availability_status,
         rp.current_latitude,
         rp.current_longitude,
         rp.last_location_updated_at,
         (
           SELECT COUNT(*) 
           FROM incident_assignments ia 
           WHERE ia.responder_user_id = u.id 
             AND ia.assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene')
         ) AS active_incident_assignments,
         (
           SELECT COUNT(*) 
           FROM rescue_assignments ra 
           WHERE ra.responder_user_id = u.id 
             AND ra.assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene')
         ) AS active_rescue_assignments
       FROM users u
       JOIN responder_profiles rp ON u.id = rp.user_id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.role_id = ?
       ORDER BY rp.badge_number ASC`,
      [ROLE_IDS.RESPONDER]
    );

    const responders = rows.map((r) => {
      const activeInc = Number(r.active_incident_assignments || 0);
      const activeRes = Number(r.active_rescue_assignments || 0);
      const effectiveOrg = (r.organization === 'Other' && r.custom_organization) ? r.custom_organization : (r.organization || r.department || 'Emergency Operations');
      return {
        id: r.user_id,
        userCode: r.user_code || r.badge_number,
        responderId: r.user_code || r.badge_number,
        badgeNumber: r.badge_number,
        serviceId: r.service_id || '',
        callsign: r.callsign || '',
        assignedUnit: r.assigned_unit || r.designation || '',
        department: r.department,
        organization: effectiveOrg,
        rawOrganization: r.organization || '',
        designation: r.designation || r.assigned_unit || '',
        specialization: r.specialization || effectiveOrg,
        fullName: [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ') || r.badge_number,
        firstName: r.first_name || '',
        middleName: r.middle_name || '',
        lastName: r.last_name || '',
        email: r.email,
        phone: r.phone_number || '',
        availabilityStatus: r.availability_status,
        accountStatus: r.account_status,
        activeAssignmentsCount: activeInc + activeRes,
        activeIncidentsCount: activeInc,
        activeRescuesCount: activeRes,
        currentLatitude: r.current_latitude ? Number(r.current_latitude) : null,
        currentLongitude: r.current_longitude ? Number(r.current_longitude) : null,
        lastLocationUpdate: r.last_location_updated_at,
        registeredAt: r.registered_at,
      };
    });

    return res.json({ responders, total: responders.length });
  } catch (err) {
    console.error('[Admin API] getAdminRespondersList failed:', err.message);
    return res.status(503).json({ error: 'Unable to load responders roster from database.' });
  }
}

async function assignResponder(req, res) {
  const { type, targetId, target_id, responderUserId, responder_user_id, dispatchInstructions, dispatch_instructions } = req.body;
  const assignmentType = String(type || '').toLowerCase();
  const idToAssign = Number(targetId || target_id);
  const respUserId = Number(responderUserId || responder_user_id);
  const instructions = String(dispatchInstructions || dispatch_instructions || '').trim() || null;

  if (!['incident', 'rescue'].includes(assignmentType)) {
    return res.status(400).json({ error: 'Invalid assignment type. Must be "incident" or "rescue".' });
  }
  if (!Number.isInteger(idToAssign) || idToAssign <= 0) {
    return res.status(400).json({ error: 'Valid target ID is required.' });
  }
  if (!Number.isInteger(respUserId) || respUserId <= 0) {
    return res.status(400).json({ error: 'Valid responder ID is required.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[responderUser]] = await conn.query(
      `SELECT u.id, u.status, rp.badge_number, rp.assigned_unit, rp.availability_status, up.first_name, up.last_name
       FROM users u
       JOIN responder_profiles rp ON u.id = rp.user_id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id = ? AND u.role_id = ?`,
      [respUserId, ROLE_IDS.RESPONDER]
    );

    if (!responderUser) {
      await conn.rollback();
      return res.status(404).json({ error: 'Responder not found or user is not an active responder.' });
    }
    if (responderUser.status !== 'active') {
      await conn.rollback();
      return res.status(400).json({ error: `Responder account is currently ${responderUser.status}. Cannot assign.` });
    }

    const responderName = [responderUser.first_name, responderUser.last_name].filter(Boolean).join(' ') || responderUser.badge_number;

    if (assignmentType === 'incident') {
      const [[report]] = await conn.query('SELECT id, user_id, reference_number, status, assigned_to FROM reports WHERE id = ?', [idToAssign]);
      if (!report) {
        await conn.rollback();
        return res.status(404).json({ error: 'Incident report not found.' });
      }
      if (['resolved', 'false_alarm', 'dismissed'].includes(String(report.status || '').toLowerCase())) {
        await conn.rollback();
        return res.status(409).json({ error: 'Cannot dispatch a responder to a closed incident report.' });
      }
      const [[existingIncAssign]] = await conn.query(
        `SELECT id FROM incident_assignments
         WHERE report_id = ? AND assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene')
         LIMIT 1`,
        [idToAssign]
      );
      if (existingIncAssign || report.assigned_to) {
        await conn.rollback();
        return res.status(409).json({ error: 'This incident report already has an active responder assigned.' });
      }
      const refNum = report.reference_number || `INC-${idToAssign}`;

      const [assignRes] = await conn.query(
        `INSERT INTO incident_assignments (report_id, responder_user_id, assigned_by, assignment_status, dispatch_instructions, assigned_at)
         VALUES (?, ?, ?, 'Assigned', ?, NOW())`,
        [idToAssign, respUserId, req.user.id, instructions]
      );

      const newReportStatus = report.status === 'pending' || report.status === 'verified' ? 'dispatched' : report.status;
      await conn.query(
        'UPDATE reports SET assigned_to = ?, status = ?, updated_at = NOW() WHERE id = ?',
        [respUserId, newReportStatus, idToAssign]
      );

      await conn.query(
        `INSERT INTO responder_assignment_history (responder_user_id, assignment_type, incident_id, status, notes)
         VALUES (?, 'incident', ?, 'Assigned', ?)`,
        [respUserId, idToAssign, instructions]
      );

      await conn.query(
        `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, remarks)
         VALUES (?, ?, ?, ?, ?)`,
        [idToAssign, report.status, newReportStatus, req.user.id, `Assigned to responder ${responderName} (${responderUser.badge_number})`]
      );

      await insertNotificationForUsers(conn, {
        title: `Responder Dispatched: ${refNum}`,
        message: `Responder ${responderName} (${responderUser.badge_number}) has been assigned to incident ${refNum}.`,
        category: 'Alert',
        createdBy: req.user.id,
        userIds: [report.user_id, respUserId],
      });

      await writeAuditLog(conn, {
        userId: req.user.id,
        action: 'ASSIGN_RESPONDER_INCIDENT',
        entityType: 'reports',
        entityId: idToAssign,
        oldValues: { assigned_to: report.assigned_to, status: report.status },
        newValues: { assigned_to: respUserId, status: newReportStatus, assignment_id: assignRes.insertId, instructions },
        req,
      });

      await conn.commit();

      try {
        emitAssignmentUpdate({
          id: idToAssign,
          referenceNumber: refNum,
          assignmentId: assignRes.insertId,
          assignmentType: 'incident',
          status: newReportStatus,
          assignedTo: respUserId,
          responderId: respUserId,
          responderName,
          badgeNumber: responderUser.badge_number,
          residentId: report.user_id,
        });
        emitStatusUpdate(idToAssign, 'incident', newReportStatus, {
          referenceNumber: refNum,
          assignedTo: respUserId,
          responderName,
          badgeNumber: responderUser.badge_number,
          residentId: report.user_id,
        });
      } catch (e) { }

      return res.json({
        message: `Assigned responder ${responderName} to incident ${refNum}.`,
        assignmentId: assignRes.insertId,
        newStatus: newReportStatus,
      });
    } else {
      const [[rescue]] = await conn.query('SELECT id, user_id, reference_number, status FROM rescue_requests WHERE id = ?', [idToAssign]);
      if (!rescue) {
        await conn.rollback();
        return res.status(404).json({ error: 'Rescue request not found.' });
      }
      if (['Completed', 'Cancelled'].includes(rescue.status)) {
        await conn.rollback();
        return res.status(409).json({ error: 'Cannot dispatch a responder to a closed rescue request.' });
      }
      const [[existingResAssign]] = await conn.query(
        `SELECT id FROM rescue_assignments
         WHERE rescue_id = ? AND assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene')
         LIMIT 1`,
        [idToAssign]
      );
      if (existingResAssign) {
        await conn.rollback();
        return res.status(409).json({ error: 'This rescue request already has an active responder assigned.' });
      }
      const refNum = rescue.reference_number || `RES-${idToAssign}`;

      const [assignRes] = await conn.query(
        `INSERT INTO rescue_assignments (rescue_id, responder_user_id, assigned_by, assignment_status, dispatch_instructions, assigned_at)
         VALUES (?, ?, ?, 'Assigned', ?, NOW())`,
        [idToAssign, respUserId, req.user.id, instructions]
      );

      await conn.query(
        "UPDATE rescue_requests SET status = 'Assigned', updated_at = NOW() WHERE id = ?",
        [idToAssign]
      );

      await conn.query(
        `INSERT INTO responder_assignment_history (responder_user_id, assignment_type, rescue_id, status, notes)
         VALUES (?, 'rescue', ?, 'Assigned', ?)`,
        [respUserId, idToAssign, instructions]
      );

      await conn.query(
        `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes)
         VALUES (?, ?, 'Assigned', ?, ?)`,
        [idToAssign, rescue.status, req.user.id, `Dispatched responder ${responderName} (${responderUser.badge_number})`]
      );

      await insertNotificationForUsers(conn, {
        title: `Rescue Team Dispatched: ${refNum}`,
        message: `Responder ${responderName} (${responderUser.badge_number}) has been assigned to rescue request ${refNum}.`,
        category: 'Alert',
        createdBy: req.user.id,
        userIds: [rescue.user_id, respUserId],
      });

      await writeAuditLog(conn, {
        userId: req.user.id,
        action: 'ASSIGN_RESPONDER_RESCUE',
        entityType: 'rescue_requests',
        entityId: idToAssign,
        oldValues: { status: rescue.status },
        newValues: { status: 'Assigned', responder_user_id: respUserId, assignment_id: assignRes.insertId, instructions },
        req,
      });

      await conn.commit();

      try {
        emitAssignmentUpdate({
          id: idToAssign,
          referenceNumber: refNum,
          assignmentId: assignRes.insertId,
          assignmentType: 'rescue',
          status: 'Assigned',
          assignedTo: respUserId,
          responderId: respUserId,
          responderName,
          badgeNumber: responderUser.badge_number,
          residentId: rescue.user_id,
        });
        emitStatusUpdate(idToAssign, 'rescue', 'Assigned', {
          referenceNumber: refNum,
          assignedTo: respUserId,
          responderName,
          badgeNumber: responderUser.badge_number,
          residentId: rescue.user_id,
        });
      } catch (e) { }

      return res.json({
        message: `Assigned responder ${responderName} to rescue ${refNum}.`,
        assignmentId: assignRes.insertId,
        newStatus: 'Assigned',
      });
    }
  } catch (err) {
    await conn.rollback();
    console.error('[Admin API] assignResponder failed:', err.message);
    return res.status(500).json({ error: 'Unable to save responder assignment.' });
  } finally {
    conn.release();
  }
}

// ============================================================================
// 6. RESIDENT REGISTRATION (POST /api/admin/users/residents)
// ============================================================================

async function createResidentAccount(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { first_name, last_name, email, password, phone_number, address } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [[existing]] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      await conn.rollback();
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    const { userCode } = await generateNextUserCode(conn, ROLE_IDS.RESIDENT);
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const fullName = `${first_name.trim()} ${last_name.trim()}`.trim();

    const [userRes] = await conn.query(
      `INSERT INTO users (user_code, name, role_id, role, email, password_hash, status, account_status, created_at)
       VALUES (?, ?, ?, 'resident', ?, ?, 'active', 'active', NOW())`,
      [userCode, fullName, ROLE_IDS.RESIDENT, email, passwordHash]
    );
    const newUserId = userRes.insertId;

    await conn.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, phone_number, street_address, barangay, city, province, verification_status)
       VALUES (?, ?, ?, ?, ?, 'Barangay Bayanan', 'Muntinlupa City', 'Metro Manila', 'Verified Resident')`,
      [newUserId, first_name.trim(), last_name.trim(), phone_number ? phone_number.trim() : null, address ? address.trim() : null]
    );

    await writeAuditLog(conn, {
      userId: req.user.id,
      action: 'USER_REGISTERED',
      entityType: 'USER_MANAGEMENT',
      entityId: newUserId,
      newValues: { id: newUserId, user_code: userCode, name: fullName, email, first_name, last_name, role: 'Resident', result: 'SUCCESS' },
      req,
    });

    await conn.commit();

    return res.status(201).json({
      message: 'Resident account created successfully.',
      user: {
        id: newUserId,
        user_code: userCode,
        userCode: userCode,
        userId: userCode,
        email,
        firstName: first_name.trim(),
        lastName: last_name.trim(),
        role: 'Resident',
        status: 'active',
      },
    });
  } catch (err) {
    await conn.rollback();
    console.error('[Admin API] createResidentAccount failed:', err.message);
    return res.status(500).json({ error: 'Unable to create resident account.' });
  } finally {
    conn.release();
  }
}

// ============================================================================
// 7. EMERGENCY BROADCASTS (GET & POST /api/admin/broadcasts)
// ============================================================================

async function getBroadcastCategories(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, slug, badge_color, priority, description, is_active
       FROM broadcast_categories
       WHERE is_active = TRUE
       ORDER BY priority ASC, name ASC`
    );
    return res.json({ categories: rows });
  } catch (err) {
    console.error('[Admin API] getBroadcastCategories failed:', err.message);
    return res.status(503).json({ error: 'Unable to load broadcast categories.' });
  }
}

async function createBroadcastCategory(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  const name = String(req.body.name || '').trim();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `cat-${Date.now()}`;
  const badgeColor = String(req.body.badge_color || defaultColorForName(name)).trim().toLowerCase();
  const priority = Math.min(5, Math.max(1, parseInt(req.body.priority, 10) || 4));
  const description = req.body.description ? String(req.body.description).trim() : null;

  try {
    const [existing] = await pool.query('SELECT id FROM broadcast_categories WHERE LOWER(name) = LOWER(?) LIMIT 1', [name]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'A broadcast category with this name already exists.' });
    }
    const [ins] = await pool.query(
      `INSERT INTO broadcast_categories (name, slug, badge_color, priority, description, is_active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [name, slug, badgeColor, priority, description]
    );
    const [[created]] = await pool.query('SELECT * FROM broadcast_categories WHERE id = ?', [ins.insertId]);
    return res.status(201).json({ category: created });
  } catch (err) {
    console.error('[Admin API] createBroadcastCategory failed:', err.message);
    return res.status(500).json({ error: 'Unable to create broadcast category.' });
  }
}

async function getEmergencyBroadcasts(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT 
         ebl.id,
         ebl.title,
         ebl.message,
         ebl.category_id,
         ebl.advisory_type,
         ebl.severity,
         ebl.target_scope,
         ebl.target_zones,
         ebl.recipients_count,
         ebl.authorized_by,
         ebl.broadcasted_at,
         ebl.expires_at,
         ebl.is_active,
         bc.name AS category_name,
         bc.badge_color AS category_color,
         bc.priority AS category_priority,
         u.email AS author_email,
         up.first_name AS author_first_name,
         up.last_name AS author_last_name
       FROM emergency_broadcast_logs ebl
       LEFT JOIN broadcast_categories bc ON ebl.category_id = bc.id
       LEFT JOIN users u ON ebl.authorized_by = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       ORDER BY ebl.broadcasted_at DESC
       LIMIT 100`
    );

    const broadcasts = rows.map((b) => {
      const categoryName = b.category_name || b.advisory_type || 'Other';
      return {
        id: b.id,
        referenceNumber: `BRD-${String(b.id).padStart(4, '0')}`,
        title: b.title,
        message: b.message,
        categoryId: b.category_id || null,
        categoryName,
        advisoryType: categoryName,
        badgeColor: b.category_color || defaultColorForName(categoryName),
        priority: Number(b.category_priority || 5),
        severity: b.severity || 'medium',
        targetScope: b.target_scope,
        targetZones: b.target_zones || '',
        recipientsCount: Number(b.recipients_count || 0),
        authorizedBy: [b.author_first_name, b.author_last_name].filter(Boolean).join(' ') || b.author_email || 'Administrator',
        broadcastedAt: b.broadcasted_at,
        expiresAt: b.expires_at,
        isActive: Boolean(b.is_active),
      };
    });

    return res.json({ broadcasts, total: broadcasts.length });
  } catch (err) {
    console.error('[Admin API] getEmergencyBroadcasts failed:', err.message);
    return res.status(503).json({ error: 'Unable to load broadcast logs from database.' });
  }
}

async function createEmergencyBroadcast(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { title, message, category_id, advisory_type, advisoryType: bodyAdvisoryType, category, target_scope, targetScope, target_zones, targetZones } = req.body;
  const broadcastTitle = String(title || '').trim();
  const broadcastMsg = String(message || '').trim();
  const rawCategoryName = String(advisory_type || bodyAdvisoryType || category || '').trim();
  const scope = target_scope || targetScope || 'All Barangay Bayanan';
  const zones = target_zones || targetZones || null;

  let categoryRow = null;
  if (category_id !== undefined && category_id !== null && String(category_id).trim() !== '') {
    const parsedId = parseInt(category_id, 10);
    if (Number.isInteger(parsedId) && parsedId > 0) {
      const [catRows] = await pool.query('SELECT * FROM broadcast_categories WHERE id = ? AND is_active = TRUE LIMIT 1', [parsedId]);
      categoryRow = catRows[0] || null;
    }
  } else if (rawCategoryName) {
    const [catRows] = await pool.query('SELECT * FROM broadcast_categories WHERE LOWER(name) = LOWER(?) AND is_active = TRUE LIMIT 1', [rawCategoryName]);
    categoryRow = catRows[0] || null;
  }

  if (!categoryRow) {
    return res.status(400).json({ error: 'Invalid or inactive advisory category selected.' });
  }
  const advisoryType = categoryRow.name;
  const broadcastSeverity = broadcastSeverityForCategory(categoryRow);
  const alertSeverity = alertSeverityForCategory(categoryRow);

  const validScopes = ['All Barangay Bayanan', 'Lakeshore Zone', 'Specific Purok', 'Responders Only'];
  if (!validScopes.includes(scope)) {
    return res.status(400).json({ error: `Invalid target scope. Must be one of: ${validScopes.join(', ')}` });
  }
  if (!broadcastTitle || !broadcastMsg) {
    return res.status(400).json({ error: 'Both alert title and emergency message details are required.' });
  }
  if (scope === 'Specific Purok' && !String(zones || '').trim()) {
    return res.status(400).json({ error: 'Please specify the affected Purok or specific zones.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let recipientRows = [];
    if (scope === 'Responders Only') {
      const [rows] = await conn.query(
        "SELECT id FROM users WHERE role_id = ? AND status = 'active' AND LOWER(account_status) = 'active' AND id <> ?",
        [ROLE_IDS.RESPONDER, req.user.id]
      );
      recipientRows = rows;
    } else if ((scope === 'Lakeshore Zone' || scope === 'Specific Purok') && String(zones || '').trim()) {
      const zoneTokens = String(zones)
        .split(/[,;/]+/)
        .map((z) => z.trim())
        .filter(Boolean);
      let residentRows = [];
      if (zoneTokens.length > 0) {
        const likeClauses = zoneTokens.map(() => 'LOWER(COALESCE(up.street_address, \'\')) LIKE ?').join(' OR ');
        const likeParams = zoneTokens.map((z) => `%${z.toLowerCase()}%`);
        const [matchedRows] = await conn.query(
          `SELECT u.id
           FROM users u
           LEFT JOIN user_profiles up ON u.id = up.user_id
           WHERE u.role_id = ?
             AND u.status = 'active'
             AND LOWER(u.account_status) = 'active'
             AND u.id <> ?
             AND (${likeClauses})`,
          [ROLE_IDS.RESIDENT, req.user.id, ...likeParams]
        );
        residentRows = matchedRows;
      }
      if (residentRows.length === 0) {
        const [allResidents] = await conn.query(
          "SELECT id FROM users WHERE role_id = ? AND status = 'active' AND LOWER(account_status) = 'active' AND id <> ?",
          [ROLE_IDS.RESIDENT, req.user.id]
        );
        residentRows = allResidents;
      }
      const [responderRows] = await conn.query(
        "SELECT id FROM users WHERE role_id = ? AND status = 'active' AND LOWER(account_status) = 'active' AND id <> ?",
        [ROLE_IDS.RESPONDER, req.user.id]
      );
      recipientRows = [...residentRows, ...responderRows];
    } else {
      const [rows] = await conn.query(
        "SELECT id FROM users WHERE role_id IN (?, ?) AND status = 'active' AND LOWER(account_status) = 'active' AND id <> ?",
        [ROLE_IDS.RESIDENT, ROLE_IDS.RESPONDER, req.user.id]
      );
      recipientRows = rows;
    }
    const uniqueRecipientIds = Array.from(new Set(recipientRows.map((u) => Number(u.id)).filter((id) => id > 0)));
    const recipientCount = uniqueRecipientIds.length;

    const [bRes] = await conn.query(
      `INSERT INTO emergency_broadcast_logs 
         (title, message, category_id, advisory_type, severity, target_scope, target_zones, recipients_count, authorized_by, broadcasted_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), TRUE)`,
      [broadcastTitle, broadcastMsg, categoryRow.id, advisoryType, broadcastSeverity, scope, zones ? String(zones).trim() : null, recipientCount, req.user.id]
    );
    const broadcastId = bRes.insertId;

    const [alertRes] = await conn.query(
      `INSERT INTO alerts (message, severity, created_by, created_at)
       VALUES (?, ?, ?, NOW())`,
      [`${broadcastTitle}: ${broadcastMsg}`, alertSeverity, req.user.id]
    );

    await insertNotificationForUsers(conn, {
      title: broadcastTitle,
      message: broadcastMsg,
      category: 'Alert',
      advisoryType,
      createdBy: req.user.id,
      userIds: uniqueRecipientIds,
    });

    await writeAuditLog(conn, {
      userId: req.user.id,
      action: 'CREATE_EMERGENCY_BROADCAST',
      entityType: 'emergency_broadcast_logs',
      entityId: broadcastId,
      newValues: { title: broadcastTitle, category_id: categoryRow.id, advisory_type: advisoryType, target_scope: scope, recipients_count: recipientCount },
      req,
    });

    await conn.commit();

    const broadcastPayload = {
      id: broadcastId,
      alertId: alertRes.insertId,
      referenceNumber: `BRD-${String(broadcastId).padStart(4, '0')}`,
      title: broadcastTitle,
      message: broadcastMsg,
      description: broadcastMsg,
      categoryId: categoryRow.id,
      categoryName: advisoryType,
      advisoryType,
      badgeColor: categoryRow.badge_color,
      priority: Number(categoryRow.priority || 5),
      severity: broadcastSeverity,
      targetScope: scope,
      targetZones: zones ? String(zones).trim() : '',
      recipientsCount: recipientCount,
      actorUserId: req.user.id,
      authorizedById: req.user.id,
      broadcastedAt: new Date().toISOString(),
    };

    emitAlertBroadcast(broadcastPayload);
    emitAdminAnnouncement(broadcastPayload);

    return res.status(201).json({
      message: 'Emergency broadcast transmitted successfully.',
      broadcast: broadcastPayload,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[Admin API] createEmergencyBroadcast failed:', err.message);
    if (err.code === '23514' || err.code === '23502' || err.code === '22P02') {
      return res.status(400).json({ error: 'Invalid broadcast field value. Please verify category, target scope, and message fields.' });
    }
    return res.status(500).json({ error: 'Unable to save emergency broadcast.' });
  } finally {
    conn.release();
  }
}

// ============================================================================
// 8. REPORTS & ANALYTICS (GET /api/admin/analytics & /api/admin/analytics/export)
// ============================================================================

function buildDateFilterClause(period, from, to, dateColumn = 'created_at') {
  const now = new Date();
  if (period === 'today') {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return { clause: `${dateColumn} >= ?`, params: [startOfDay] };
  }
  if (period === '7d') {
    return { clause: `${dateColumn} >= ?`, params: [new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)] };
  }
  if (period === '30d') {
    return { clause: `${dateColumn} >= ?`, params: [new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)] };
  }
  if (period === 'this_month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { clause: `${dateColumn} >= ?`, params: [startOfMonth] };
  }
  if (period === 'last_month') {
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return {
      clause: `${dateColumn} >= ? AND ${dateColumn} < ?`,
      params: [startOfLastMonth, startOfThisMonth],
    };
  }
  if (period === 'this_year') {
    const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    return { clause: `${dateColumn} >= ?`, params: [startOfYear] };
  }
  if (period === 'custom' && from && to) {
    return {
      clause: `${dateColumn} >= ? AND ${dateColumn} <= ?`,
      params: [`${from} 00:00:00`, `${to} 23:59:59`],
    };
  }
  return { clause: '1=1', params: [] };
}

/**
 * Aggregate genuine incident reports grouped by disaster category via incident_categories join.
 * Prevents join-induced duplicates with COUNT(DISTINCT r.id) and computes exact percentages.
 */
async function getReportCategoryDistribution(dateFilter = { clause: '1=1', params: [] }) {
  const [groupedRows] = await pool.query(
    `SELECT
       COALESCE(ic.name, NULLIF(TRIM(r.incident_type), ''), 'Uncategorized') AS name,
       COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${dateFilter.clause}
     GROUP BY COALESCE(ic.name, NULLIF(TRIM(r.incident_type), ''), 'Uncategorized')
     ORDER BY count DESC, name ASC`,
    dateFilter.params
  );

  const [activeCatRows] = await pool.query(
    `SELECT name FROM incident_categories WHERE is_active = true ORDER BY id ASC`
  );

  const totalReports = groupedRows.reduce((sum, row) => sum + Number(row.count || 0), 0);

  const categories = groupedRows
    .map((row) => {
      const count = Number(row.count || 0);
      const percentage = totalReports > 0 ? Number(((count / totalReports) * 100).toFixed(1)) : 0;
      return { name: row.name, count, percentage };
    })
    .filter((row) => row.count > 0);

  const countMap = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const allCategories = [...categories];
  for (const cat of activeCatRows) {
    if (!countMap.has(String(cat.name || '').toLowerCase())) {
      allCategories.push({ name: cat.name, count: 0, percentage: 0 });
    }
  }

  return { totalReports, categories, allCategories };
}

async function getAdminAnalytics(req, res) {
  try {
    const period = String(req.query.period || 'all').toLowerCase();
    const { from, to } = req.query;

    const repDateFilter = buildDateFilterClause(period, from, to, 'r.created_at');
    const resqDateFilter = buildDateFilterClause(period, from, to, 'created_at');

    const categoryDistribution = await getReportCategoryDistribution(repDateFilter);
    const totalReports = categoryDistribution.totalReports;
    const categories = categoryDistribution.categories;

    const [[resqCountRow]] = await pool.query(
      `SELECT COUNT(*) AS count FROM rescue_requests WHERE ${resqDateFilter.clause}`,
      resqDateFilter.params
    );
    const totalRescues = Number((resqCountRow && resqCountRow.count) || 0);

    const [statuses] = await pool.query(
      `SELECT r.status, COUNT(DISTINCT r.id)::int AS count
       FROM reports r
       WHERE ${repDateFilter.clause}
       GROUP BY r.status`,
      repDateFilter.params
    );

    const monthExpr = pool.isPostgres
      ? "TO_CHAR(created_at, 'YYYY-MM')"
      : "DATE_FORMAT(created_at, '%Y-%m')";
    const since12Months = new Date();
    since12Months.setMonth(since12Months.getMonth() - 12);
    const [monthlyTrends] = await pool.query(
      `SELECT ${monthExpr} AS month_label, COUNT(*) AS count
       FROM reports
       WHERE created_at >= ?
       GROUP BY month_label
       ORDER BY month_label ASC`,
      [since12Months]
    );

    const [locations] = await pool.query(
      `SELECT COALESCE(NULLIF(r.address, ''), 'Barangay Bayanan') AS location_name, COUNT(DISTINCT r.id)::int AS count
       FROM reports r
       WHERE ${repDateFilter.clause}
       GROUP BY location_name
       ORDER BY count DESC
       LIMIT 8`,
      repDateFilter.params
    );

    const [[incAssignRow]] = await pool.query(
      `SELECT 
         COUNT(DISTINCT report_id) AS total_assignments,
         COUNT(DISTINCT CASE WHEN assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene') THEN report_id END) AS active_assignments,
         COUNT(DISTINCT CASE WHEN assignment_status = 'Completed' THEN report_id END) AS completed_assignments
       FROM incident_assignments`
    );

    const [[resAssignRow]] = await pool.query(
      `SELECT 
         COUNT(DISTINCT rescue_id) AS total_assignments,
         COUNT(DISTINCT CASE WHEN assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene') THEN rescue_id END) AS active_assignments,
         COUNT(DISTINCT CASE WHEN assignment_status = 'Completed' THEN rescue_id END) AS completed_assignments
       FROM rescue_assignments`
    );

    const totalAssignments =
      Number((incAssignRow && incAssignRow.total_assignments) || 0) +
      Number((resAssignRow && resAssignRow.total_assignments) || 0);
    const activeAssignments =
      Number((incAssignRow && incAssignRow.active_assignments) || 0) +
      Number((resAssignRow && resAssignRow.active_assignments) || 0);
    const completedAssignments =
      Number((incAssignRow && incAssignRow.completed_assignments) || 0) +
      Number((resAssignRow && resAssignRow.completed_assignments) || 0);

    return res.json({
      period,
      summary: {
        totalReports,
        totalRescues,
        totalEvents: totalReports + totalRescues,
        totalAssignments,
        activeAssignments,
        completedAssignments,
      },
      categories,
      categoryDistribution,
      severities: [],
      statuses,
      rescuePriorities: [],
      monthlyTrends,
      locations,
    });
  } catch (err) {
    console.error('[Admin API] getAdminAnalytics failed:', err.message);
    return res.status(503).json({ error: 'Unable to aggregate analytics from database.' });
  }
}

async function exportAdminAnalyticsCsv(req, res) {
  try {
    const period = String(req.query.period || 'all').toLowerCase();
    const { from, to } = req.query;

    const repDateFilter = buildDateFilterClause(period, from, to, 'r.created_at');
    const resqDateFilter = buildDateFilterClause(period, from, to, 'rq.created_at');

    const [incidents] = await pool.query(
      `SELECT 
         r.reference_number,
         'Incident' AS record_type,
         r.incident_type AS category,
         r.title,
         r.status,
         r.address,
         r.latitude,
         r.longitude,
         r.created_at,
         u.email AS submitter_email,
         up.first_name,
         up.last_name
       FROM reports r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE ${repDateFilter.clause}
       ORDER BY r.created_at DESC`,
      repDateFilter.params
    );

    const [rescues] = await pool.query(
      `SELECT 
         rq.reference_number,
         'Rescue' AS record_type,
         rq.emergency_type AS category,
         CONCAT('Rescue (', rq.people_count, ' persons)') AS title,
         rq.status,
         rq.address,
         rq.latitude,
         rq.longitude,
         rq.created_at,
         u.email AS submitter_email,
         up.first_name,
         up.last_name
       FROM rescue_requests rq
       LEFT JOIN users u ON rq.user_id = u.id
       LEFT JOIN user_profiles up ON rq.user_id = up.user_id
       WHERE ${resqDateFilter.clause}
       ORDER BY rq.created_at DESC`,
      resqDateFilter.params
    );

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const header = [
      'Reference Number',
      'Record Type',
      'Category',
      'Title / Description',
      'Status',
      'Location Address',
      'Latitude',
      'Longitude',
      'Submitter Name',
      'Submitter Email',
      'Date Submitted (UTC)',
    ].join(',');

    const combinedRows = [...incidents, ...rescues].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const csvLines = [header];
    combinedRows.forEach((row) => {
      const submitterName = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Resident';
      csvLines.push([
        escapeCsv(row.reference_number),
        escapeCsv(row.record_type),
        escapeCsv(row.category),
        escapeCsv(row.title),
        escapeCsv(row.status),
        escapeCsv(row.address),
        escapeCsv(row.latitude),
        escapeCsv(row.longitude),
        escapeCsv(submitterName),
        escapeCsv(row.submitter_email),
        escapeCsv(row.created_at ? new Date(row.created_at).toISOString() : ''),
      ].join(','));
    });

    const csvContent = csvLines.join('\r\n');
    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="geosafe-report-${period}-${timestamp}.csv"`);
    return res.send(csvContent);
  } catch (err) {
    console.error('[Admin API] exportAdminAnalyticsCsv failed:', err.message);
    return res.status(500).json({ error: 'Unable to generate CSV export.' });
  }
}

// ============================================================================
// 9. SYSTEM SETTINGS & MAINTENANCE (GET & PATCH /api/admin/settings)
// ============================================================================

async function getAdminSystemSettings(req, res) {
  try {
    const [settingsRows] = await pool.query(
      'SELECT id, setting_key, category, setting_value, description, is_protected, updated_at FROM system_settings ORDER BY category, setting_key'
    );

    const startPing = Date.now();
    await pool.query('SELECT 1');
    const dbLatencyMs = Date.now() - startPing;

    const since24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [[failedLoginsRow]] = await pool.query(
      "SELECT COUNT(*) AS count FROM auth_security_logs WHERE event_type = 'login_failed' AND created_at >= ?",
      [since24Hours]
    );
    const [[successLoginsRow]] = await pool.query(
      "SELECT COUNT(*) AS count FROM auth_security_logs WHERE event_type = 'login_success' AND created_at >= ?",
      [since24Hours]
    );

    const [recentSecurityEvents] = await pool.query(
      `SELECT id, event_type, attempted_email, attempted_role, ip_address, details, created_at
       FROM auth_security_logs
       ORDER BY created_at DESC
       LIMIT 10`
    );

    return res.json({
      settings: settingsRows,
      health: {
        databaseStatus: 'Operational',
        databaseLatencyMs: dbLatencyMs,
        serverUptimeSeconds: Math.floor(process.uptime()),
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
      },
      securityStats: {
        failedLogins24h: Number((failedLoginsRow && failedLoginsRow.count) || 0),
        successLogins24h: Number((successLoginsRow && successLoginsRow.count) || 0),
      },
      recentSecurityEvents,
    });
  } catch (err) {
    console.error('[Admin API] getAdminSystemSettings failed:', err.message);
    return res.status(503).json({ error: 'Unable to load system settings from database.' });
  }
}

async function updateAdminSystemSetting(req, res) {
  const { settingKey, setting_key, settingValue, setting_value } = req.body;
  const key = String(settingKey || setting_key || req.params.key || '').trim();
  const value = String(settingValue !== undefined ? settingValue : setting_value || '');

  if (!key) {
    return res.status(400).json({ error: 'Setting key is required.' });
  }
  if (key === 'eoc_latitude') {
    const num = Number(value);
    if (!Number.isFinite(num) || num < -90 || num > 90) {
      return res.status(400).json({ error: 'EOC latitude must be a valid number between -90 and 90.' });
    }
  }
  if (key === 'eoc_longitude') {
    const num = Number(value);
    if (!Number.isFinite(num) || num < -180 || num > 180) {
      return res.status(400).json({ error: 'EOC longitude must be a valid number between -180 and 180.' });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[existing]] = await conn.query('SELECT id, setting_key, setting_value, is_protected FROM system_settings WHERE setting_key = ?', [key]);
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ error: 'Setting key not found in system_settings.' });
    }

    await conn.query(
      'UPDATE system_settings SET setting_value = ?, updated_by = ?, updated_at = NOW() WHERE setting_key = ?',
      [value, req.user.id, key]
    );

    await writeAuditLog(conn, {
      userId: req.user.id,
      action: 'UPDATE_SYSTEM_SETTING',
      entityType: 'system_settings',
      entityId: existing.id,
      oldValues: { setting_key: key, setting_value: existing.setting_value },
      newValues: { setting_key: key, setting_value: value },
      req,
    });

    await conn.commit();

    return res.json({
      message: `Setting "${key}" updated successfully.`,
      setting: {
        key,
        value,
      },
    });
  } catch (err) {
    await conn.rollback();
    console.error('[Admin API] updateAdminSystemSetting failed:', err.message);
    return res.status(500).json({ error: 'Unable to update system setting.' });
  } finally {
    conn.release();
  }
}

module.exports = {
  getAdminOverview,
  getAdminStats,
  getVulnerableResidents,
  getAdminReportsList,
  getAdminReportDetail,
  reviewAdminReport,
  getAdminUsers,
  createResponderAccount,
  createResidentAccount,
  updateAdminUserStatus,
  reviewResidentLocationVerification,
  getAdminAuditLogs,
  getAdminRespondersList,
  assignResponder,
  getEmergencyBroadcasts,
  createEmergencyBroadcast,
  getBroadcastCategories,
  createBroadcastCategory,
  getAdminAnalytics,
  exportAdminAnalyticsCsv,
  getAdminSystemSettings,
  updateAdminSystemSetting,
};
