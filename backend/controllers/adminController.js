const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { ROLE_IDS, roleLabel, roleDisplayName } = require('../config/roles');
const { emitStatusUpdate } = require('../socket');
const { detectSeverity } = require('../utils/severityDetector');
const { calculateReportPriority } = require('../utils/prioritizer');

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

function normalizeSeverityDisplay(val) {
  const s = String(val || '').toLowerCase();
  if (s === 'critical') return 'Critical';
  if (s === 'high') return 'High';
  if (s === 'medium' || s === 'moderate') return 'Medium';
  if (s === 'low') return 'Low';
  return 'Medium';
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

// ============================================================================
// 1. DASHBOARD OVERVIEW & MAP DATA (GET /api/admin/overview & /api/admin/stats)
// ============================================================================
async function getAdminOverview(req, res) {
  try {
    const [[incTotalRow]] = await pool.query('SELECT COUNT(*) AS count FROM reports');
    const [[resTotalRow]] = await pool.query('SELECT COUNT(*) AS count FROM rescue_requests');

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
      `SELECT id, reference_number, incident_type, title, latitude, longitude, address, severity, status, created_at
       FROM reports
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 300`
    );

    const [rescueMarkers] = await pool.query(
      `SELECT id, reference_number, emergency_type, latitude, longitude, address, landmark, priority, people_count, status, created_at
       FROM rescue_requests
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 300`
    );

    const mapItems = [
      ...incidentMarkers
        .filter((r) => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)))
        .map((r) => ({
          uid: `incident-${r.id}`,
          id: r.id,
          recordType: 'incident',
          reportTypeLabel: 'Incident Report',
          referenceNumber: r.reference_number || `INC-${r.id}`,
          category: r.incident_type || 'General Incident',
          title: r.title || `${r.incident_type || 'Incident'} Report`,
          severity: normalizeSeverityDisplay(r.severity),
          rawSeverity: r.severity,
          status: r.status,
          statusLabel: normalizeIncidentStatusLabel(r.status),
          filterBucket: mapUnifiedFilterBucket('incident', r.status),
          location: r.address || 'Barangay Bayanan, Muntinlupa City',
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          submittedAt: r.created_at,
        })),
      ...rescueMarkers
        .filter((r) => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)))
        .map((r) => ({
          uid: `rescue-${r.id}`,
          id: r.id,
          recordType: 'rescue',
          reportTypeLabel: 'Rescue Request',
          referenceNumber: r.reference_number || `RES-${r.id}`,
          category: r.emergency_type || 'Emergency Rescue',
          title: `${r.emergency_type || 'Rescue'} (${r.people_count || 1} person${(r.people_count || 1) > 1 ? 's' : ''})`,
          severity: normalizeSeverityDisplay(r.priority),
          rawSeverity: String(r.priority || 'High').toLowerCase(),
          status: r.status,
          statusLabel: normalizeRescueStatusLabel(r.status),
          filterBucket: mapUnifiedFilterBucket('rescue', r.status),
          location: r.address || 'Barangay Bayanan, Muntinlupa City',
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          submittedAt: r.created_at,
        })),
    ].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    // Fetch live evacuation centers for map display if present
    const [evacCenterRows] = await pool.query(
      `SELECT id, name, address, latitude, longitude, capacity, available_slots, status
       FROM evacuation_centers
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY name ASC`
    );

    const evacuationCenters = evacCenterRows.map((e) => ({
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
      recentActivities,
    });
  } catch (err) {
    console.error('[Admin API] getAdminOverview failed:', err.message);
    return res.status(503).json({ error: 'Unable to load dashboard overview from MySQL.' });
  }
}

async function getAdminStats(req, res) {
  try {
    const [sosRows] = await pool.query(
      "SELECT COUNT(*) AS count FROM reports WHERE status != 'resolved' AND (severity IN ('high', 'critical') OR incident_type = 'SOS')"
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
        u.id, u.name, u.email,
        up.phone_number AS contact_number,
        up.street_address AS address,
        u.safety_status, u.last_latitude, u.last_longitude, u.battery_level,
        fg.family_name AS family_group_name,
        fm.id AS family_member_id,
        fm.relationship AS family_relationship,
        (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id AND r.status != 'resolved' AND (r.severity IN ('high', 'critical') OR r.incident_type = 'SOS')) AS active_critical_reports,
        (SELECT r.description FROM reports r WHERE r.user_id = u.id AND r.status != 'resolved' ORDER BY r.created_at DESC LIMIT 1) AS latest_incident_description
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id = u.id
      LEFT JOIN family_members fm ON fm.user_id = u.id AND fm.membership_status = 'active'
      LEFT JOIN family_groups fg ON fg.id = fm.family_id AND fg.status = 'active'
      WHERE u.role_id = ?
        AND (
          u.safety_status IN ('need_help', 'injured', 'no_response')
          OR (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id AND r.status != 'resolved' AND (r.severity IN ('high', 'critical') OR r.incident_type = 'SOS')) > 0
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
    const severityFilter = String(req.query.severity || 'all').toLowerCase();
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
        severity: normalizeSeverityDisplay(r.severity),
        rawSeverity: r.severity,
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
        severity: normalizeSeverityDisplay(r.priority),
        rawSeverity: String(r.priority || 'High').toLowerCase(),
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
      all: unified.length,
      pending: unified.filter((i) => i.filterBucket === 'pending').length,
      under_review: unified.filter((i) => i.filterBucket === 'under_review').length,
      verified: unified.filter((i) => i.filterBucket === 'verified').length,
      rejected: unified.filter((i) => i.filterBucket === 'rejected').length,
      resolved: unified.filter((i) => i.filterBucket === 'resolved').length,
    };

    const filtered = unified.filter((item) => {
      if (recordTypeFilter !== 'all' && item.recordType !== recordTypeFilter) return false;
      if (filter !== 'all' && item.filterBucket !== filter) return false;
      if (severityFilter !== 'all' && item.severity.toLowerCase() !== severityFilter) return false;
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
    return res.status(503).json({ error: 'Unable to load reports from MySQL.' });
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

      const detection = detectSeverity(r.incident_type || 'General Incident', r.description || '');
      const priorityInfo = calculateReportPriority({
        incident_type: r.incident_type,
        description: r.description,
        created_at: r.created_at,
        latitude: r.latitude,
        longitude: r.longitude,
      });

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
        severity: normalizeSeverityDisplay(r.severity),
        rawSeverity: r.severity,
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
          userId: `USR-${String(r.user_id).padStart(5, '0')}`,
          name: r.reporter_name || 'Resident',
          email: r.reporter_email || 'Not provided',
          phone: r.reporter_phone || 'Not provided',
          address: r.reporter_street
            ? `${r.reporter_street}, ${r.reporter_barangay || 'Barangay Bayanan'}`
            : (r.reporter_barangay ? `Barangay ${r.reporter_barangay}, Muntinlupa City` : 'Barangay Bayanan, Muntinlupa City'),
          verificationStatus: r.reporter_verification_status || 'Unverified Resident',
          accountStatus: r.reporter_account_status || 'active',
        },
        severityDetection: {
          detectedSeverity: detection.severity,
          urgencyScore: detection.score,
          matchedKeywords: detection.matchedKeywords || [],
          recommendation: detection.recommendation || '',
        },
        priorityDetails: {
          tier: priorityInfo.priorityTier || 'Standard',
          score: priorityInfo.priorityScore || 50,
          breakdown: priorityInfo.breakdown || {},
        },
        attachments: mappedAttachments,
        history: mappedHistory,
        statusHistory: mappedHistory,
        allowedStatuses: INCIDENT_VALID_STATUSES,
        validStatuses: INCIDENT_VALID_STATUSES,
        allowedSeverities: INCIDENT_VALID_SEVERITIES,
        validSeverities: INCIDENT_VALID_SEVERITIES,
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

    const detection = detectSeverity(r.emergency_type || 'Emergency Rescue', r.description || '');
    const priorityInfo = calculateReportPriority({
      incident_type: r.emergency_type || 'SOS',
      description: r.description,
      created_at: r.created_at,
      latitude: r.latitude,
      longitude: r.longitude,
    });

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
      location: r.address || 'Barangay Bayanan, Muntinlupa City',
      address: r.address || 'Barangay Bayanan, Muntinlupa City',
      latitude: r.latitude !== null ? Number(r.latitude) : null,
      longitude: r.longitude !== null ? Number(r.longitude) : null,
      severity: normalizeSeverityDisplay(r.priority),
      rawSeverity: String(r.priority || 'High').toLowerCase(),
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
        userId: `USR-${String(r.user_id).padStart(5, '0')}`,
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
      severityDetection: {
        detectedSeverity: detection.severity,
        urgencyScore: detection.score,
        matchedKeywords: detection.matchedKeywords || [],
        recommendation: detection.recommendation || '',
      },
      priorityDetails: {
        tier: priorityInfo.priorityTier || 'High',
        score: priorityInfo.priorityScore || 80,
        breakdown: priorityInfo.breakdown || {},
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
    return res.status(503).json({ error: 'Unable to load report details from MySQL.' });
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

  const { action, status, severity, assignedTo, reason } = req.body || {};
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';

  // Rejecting / dismissing or requesting clarification or resolving requires a reason
  const isRejection =
    action === 'reject' ||
    (recordType === 'incident' && status === 'false_alarm') ||
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

      let targetStatus = status || current.status;
      if (action === 'verify') targetStatus = 'verified';
      else if (action === 'reject') targetStatus = 'false_alarm';
      else if (action === 'resolve') targetStatus = 'resolved';

      if (!INCIDENT_VALID_STATUSES.includes(targetStatus)) {
        await conn.rollback();
        return res.status(400).json({ error: `Unsupported incident status: ${targetStatus}` });
      }

      const targetSeverity =
        severity && INCIDENT_VALID_SEVERITIES.includes(String(severity).toLowerCase())
          ? String(severity).toLowerCase()
          : current.severity;

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

      const updates = ['status = ?', 'severity = ?', 'assigned_to = ?'];
      const params = [targetStatus, targetSeverity, targetAssignee];

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

      if (isClarification) {
        const [notifRes] = await conn.query(
          `INSERT INTO notifications (title, message, severity, category, related_entity_type, related_entity_id, created_by)
           VALUES (?, ?, 'Warning', 'Incident', 'incident_report', ?, ?)`,
          [
            `Clarification Requested: ${current.reference_number || 'INC-' + current.id}`,
            trimmedReason,
            recordId,
            req.user.id,
          ]
        );
        await conn.query(
          `INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?)`,
          [notifRes.insertId, current.user_id]
        );
      }

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
        entityId: current.reference_number || String(recordId),
        oldValues: { status: current.status, severity: current.severity, assigned_to: current.assigned_to },
        newValues: { status: targetStatus, severity: targetSeverity, assigned_to: targetAssignee, reason: historyRemark },
        req,
      });

      await conn.commit();
      emitStatusUpdate({ id: recordId, status: targetStatus, severity: targetSeverity });
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

    let targetStatus = status || current.status;
    if (action === 'verify') targetStatus = current.status === 'Pending Dispatch' ? 'Assigned' : current.status;
    else if (action === 'reject') targetStatus = 'Cancelled';
    else if (action === 'resolve') targetStatus = 'Completed';

    if (!RESCUE_VALID_STATUSES.includes(targetStatus)) {
      await conn.rollback();
      return res.status(400).json({ error: `Unsupported rescue request status: ${targetStatus}` });
    }

    let targetPriority = current.priority;
    if (severity) {
      const normalizedPrio =
        String(severity).charAt(0).toUpperCase() + String(severity).slice(1).toLowerCase();
      if (RESCUE_VALID_PRIORITIES.includes(normalizedPrio)) {
        targetPriority = normalizedPrio;
      }
    }

    const updates = ['status = ?', 'priority = ?'];
    const params = [targetStatus, targetPriority];
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

    if (assignedTo) {
      const responderId = parseInt(assignedTo, 10);
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

    if (isClarification) {
      const [notifRes] = await conn.query(
        `INSERT INTO notifications (title, message, severity, category, related_entity_type, related_entity_id, created_by)
         VALUES (?, ?, 'Warning', 'Rescue', 'rescue_request', ?, ?)`,
        [
          `Clarification Requested: ${current.reference_number || 'RES-' + current.id}`,
          trimmedReason,
          recordId,
          req.user.id,
        ]
      );
      await conn.query(
        `INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?)`,
        [notifRes.insertId, current.user_id]
      );
    }

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
      entityId: current.reference_number || String(recordId),
      oldValues: { status: current.status, priority: current.priority },
      newValues: { status: targetStatus, priority: targetPriority, reason: historyRemark },
      req,
    });

    await conn.commit();
    return res.json({ message: 'Rescue request review saved.', status: targetStatus });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Admin API] reviewAdminReport failed:', err.message);
    return res.status(503).json({ error: 'Unable to save report review in MySQL.' });
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
      `SELECT u.id, u.name, u.email, u.role_id, u.role AS user_role, r.name AS role_name,
              u.status, u.account_status, u.safety_status, u.last_login_at, u.created_at,
              up.first_name, up.last_name, up.phone_number, up.street_address, up.barangay, up.city,
              up.verification_status,
              rp.badge_number, rp.callsign, rp.assigned_unit, rp.department, rp.specialization, rp.availability_status
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN responder_profiles rp ON rp.user_id = u.id
       WHERE (u.role_id = ? OR (u.role_id IS NULL AND LOWER(u.role) = ?))
       GROUP BY u.id
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
      if (search) {
        const rawId = String(u.id);
        const userCode = `usr-${String(u.id).padStart(5, '0')}`;
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
      const userCode = `USR-${String(u.id).padStart(5, '0')}`;
      return {
        id: u.id,
        userId: userCode,
        userCode: userCode,
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
        badgeNumber: u.badge_number || null,
        callsign: u.callsign || null,
        assignedUnit: u.assigned_unit || null,
        department: u.department || null,
        specialization: u.specialization || null,
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
    return res.status(503).json({ error: 'Unable to load user directory from MySQL.' });
  }
}

async function createResponderAccount(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
  }

  const {
    first_name,
    last_name,
    firstName: bodyFirstName,
    lastName: bodyLastName,
    surname,
    email,
    password,
    phone_number,
    phone,
    badge_number,
    badgeNumber,
    callsign,
    assigned_unit,
    assignedUnit,
    department,
    specialization,
  } = req.body || {};

  const firstName = String(first_name || bodyFirstName || '').trim().slice(0, 80);
  const lastName = String(last_name || bodyLastName || surname || '').trim().slice(0, 80);
  const fullName = `${firstName} ${lastName}`.trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const badge = String(badge_number || badgeNumber || '').trim().slice(0, 50);
  const unit = String(assigned_unit || assignedUnit || '').trim().slice(0, 120);
  const userPhone = String(phone_number || phone || '').trim().slice(0, 30);
  const dept = String(department || 'Barangay Bayanan Emergency Operations').trim().slice(0, 120);

  if (!firstName || !lastName || !badge || !unit) {
    return res.status(400).json({
      error: 'First name, surname, badge number, and assigned unit are required for Responder accounts.',
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

    const [dupBadge] = await conn.query(
      'SELECT id FROM responder_profiles WHERE badge_number = ? LIMIT 1 FOR UPDATE',
      [badge]
    );
    if (dupBadge.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'Badge number is already assigned to another Responder.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const [insertRes] = await conn.query(
      `INSERT INTO users (name, email, password_hash, role_id, role, status, account_status)
       VALUES (?, ?, ?, ?, 'responder', 'active', 'active')`,
      [fullName, normalizedEmail, passwordHash, ROLE_IDS.RESPONDER]
    );
    const newResponderId = insertRes.insertId;

    await conn.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, phone_number, barangay, city, province, verification_status)
       VALUES (?, ?, ?, ?, 'Barangay Bayanan', 'Muntinlupa City', 'Metro Manila', 'Verified Resident')`,
      [newResponderId, firstName, lastName, userPhone || null]
    );

    await conn.query(
      `INSERT INTO responder_profiles (user_id, badge_number, callsign, assigned_unit, department, specialization, availability_status)
       VALUES (?, ?, ?, ?, ?, ?, 'Off Duty')`,
      [
        newResponderId,
        badge,
        callsign ? String(callsign).trim().slice(0, 50) : null,
        unit,
        dept,
        specialization ? String(specialization).trim().slice(0, 100) : null,
      ]
    );

    await writeAuditLog(conn, {
      userId: req.user.id,
      action: 'RESPONDER_ACCOUNT_CREATED',
      entityType: 'users',
      entityId: String(newResponderId),
      newValues: {
        id: newResponderId,
        name: fullName,
        email: normalizedEmail,
        role_id: ROLE_IDS.RESPONDER,
        badge_number: badge,
        assigned_unit: unit,
      },
      req,
    });

    await conn.commit();
    return res.status(201).json({
      message: 'Responder account created.',
      user: {
        id: newResponderId,
        name: fullName,
        email: normalizedEmail,
        roleId: ROLE_IDS.RESPONDER,
        roleName: 'Responder',
        badgeNumber: badge,
        assignedUnit: unit,
        status: 'active',
      },
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
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
    await conn.rollback().catch(() => {});
    console.error('[Admin API] updateAdminUserStatus failed:', err.message);
    return res.status(503).json({ error: 'Unable to update account status.' });
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
  if (ent.includes('family') || act.includes('family')) return 'Family Safety';
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
          } catch (_) {}
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
    return res.status(503).json({ error: 'Unable to load audit logs from MySQL.' });
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
         u.email,
         u.status AS account_status,
         u.created_at AS registered_at,
         up.first_name,
         up.last_name,
         up.phone_number,
         rp.badge_number,
         rp.callsign,
         rp.assigned_unit,
         rp.department,
         rp.specialization,
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
      return {
        id: r.user_id,
        badgeNumber: r.badge_number,
        callsign: r.callsign || '',
        assignedUnit: r.assigned_unit,
        department: r.department,
        specialization: r.specialization || 'Emergency Operations',
        fullName: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.badge_number,
        firstName: r.first_name || '',
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
    return res.status(503).json({ error: 'Unable to load responders roster from MySQL.' });
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
      const [[report]] = await conn.query('SELECT id, reference_number, status, assigned_to FROM reports WHERE id = ?', [idToAssign]);
      if (!report) {
        await conn.rollback();
        return res.status(404).json({ error: 'Incident report not found.' });
      }

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
        emitStatusUpdate(idToAssign, 'incident', newReportStatus, {
          assignedTo: respUserId,
          responderName,
          badgeNumber: responderUser.badge_number,
        });
      } catch (e) {}

      return res.json({
        message: `Assigned responder ${responderName} to incident ${report.reference_number || `INC-${idToAssign}`}.`,
        assignmentId: assignRes.insertId,
        newStatus: newReportStatus,
      });
    } else {
      const [[rescue]] = await conn.query('SELECT id, reference_number, status FROM rescue_requests WHERE id = ?', [idToAssign]);
      if (!rescue) {
        await conn.rollback();
        return res.status(404).json({ error: 'Rescue request not found.' });
      }

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
        emitStatusUpdate(idToAssign, 'rescue', 'Assigned', {
          assignedTo: respUserId,
          responderName,
          badgeNumber: responderUser.badge_number,
        });
      } catch (e) {}

      return res.json({
        message: `Assigned responder ${responderName} to rescue ${rescue.reference_number || `RES-${idToAssign}`}.`,
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

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const fullName = `${first_name.trim()} ${last_name.trim()}`.trim();

    const [userRes] = await conn.query(
      `INSERT INTO users (name, role_id, role, email, password_hash, status, account_status, created_at)
       VALUES (?, ?, 'resident', ?, ?, 'active', 'active', NOW())`,
      [fullName, ROLE_IDS.RESIDENT, email, passwordHash]
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
      newValues: { id: newUserId, name: fullName, email, first_name, last_name, role: 'Resident', result: 'SUCCESS' },
      req,
    });

    await conn.commit();

    return res.status(201).json({
      message: 'Resident account created successfully.',
      user: {
        id: newUserId,
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

async function getEmergencyBroadcasts(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT 
         ebl.id,
         ebl.title,
         ebl.message,
         ebl.severity,
         ebl.target_scope,
         ebl.target_zones,
         ebl.recipients_count,
         ebl.authorized_by,
         ebl.broadcasted_at,
         ebl.expires_at,
         ebl.is_active,
         u.email AS author_email,
         up.first_name AS author_first_name,
         up.last_name AS author_last_name
       FROM emergency_broadcast_logs ebl
       LEFT JOIN users u ON ebl.authorized_by = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       ORDER BY ebl.broadcasted_at DESC
       LIMIT 100`
    );

    const broadcasts = rows.map((b) => ({
      id: b.id,
      referenceNumber: `BRD-${String(b.id).padStart(4, '0')}`,
      title: b.title,
      message: b.message,
      severity: b.severity,
      targetScope: b.target_scope,
      targetZones: b.target_zones || '',
      recipientsCount: Number(b.recipients_count || 0),
      authorizedBy: [b.author_first_name, b.author_last_name].filter(Boolean).join(' ') || b.author_email || 'Administrator',
      broadcastedAt: b.broadcasted_at,
      expiresAt: b.expires_at,
      isActive: Boolean(b.is_active),
    }));

    return res.json({ broadcasts, total: broadcasts.length });
  } catch (err) {
    console.error('[Admin API] getEmergencyBroadcasts failed:', err.message);
    return res.status(503).json({ error: 'Unable to load broadcast logs from MySQL.' });
  }
}

async function createEmergencyBroadcast(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { title, message, severity, target_scope, targetScope, target_zones, targetZones } = req.body;
  const broadcastTitle = String(title || '').trim();
  const broadcastMsg = String(message || '').trim();
  const broadcastSeverity = severity || 'Advisory';
  const scope = target_scope || targetScope || 'All Barangay Bayanan';
  const zones = target_zones || targetZones || null;

  const validSeverities = ['Advisory', 'Watch', 'Warning', 'Critical Evacuation'];
  if (!validSeverities.includes(broadcastSeverity)) {
    return res.status(400).json({ error: `Invalid severity. Must be one of: ${validSeverities.join(', ')}` });
  }

  const validScopes = ['All Barangay Bayanan', 'Lakeshore Zone', 'Specific Purok', 'Responders Only'];
  if (!validScopes.includes(scope)) {
    return res.status(400).json({ error: `Invalid target scope. Must be one of: ${validScopes.join(', ')}` });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let recipientCount = 0;
    if (scope === 'Responders Only') {
      const [[cntRow]] = await conn.query(
        "SELECT COUNT(*) AS count FROM users WHERE role_id = ? AND status = 'active'",
        [ROLE_IDS.RESPONDER]
      );
      recipientCount = Number((cntRow && cntRow.count) || 0);
    } else {
      const [[cntRow]] = await conn.query("SELECT COUNT(*) AS count FROM users WHERE status = 'active'");
      recipientCount = Number((cntRow && cntRow.count) || 0);
    }

    const [bRes] = await conn.query(
      `INSERT INTO emergency_broadcast_logs 
         (title, message, severity, target_scope, target_zones, recipients_count, authorized_by, broadcasted_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 1)`,
      [broadcastTitle, broadcastMsg, broadcastSeverity, scope, zones, recipientCount, req.user.id]
    );
    const broadcastId = bRes.insertId;

    const alertSeverityMap = {
      Advisory: 'low',
      Watch: 'medium',
      Warning: 'high',
      'Critical Evacuation': 'critical',
    };
    const mappedAlertSeverity = alertSeverityMap[broadcastSeverity] || 'medium';

    await conn.query(
      `INSERT INTO alerts (message, severity, created_by, created_at)
       VALUES (?, ?, ?, NOW())`,
      [`[${broadcastSeverity.toUpperCase()}] ${broadcastTitle}: ${broadcastMsg}`, mappedAlertSeverity, req.user.id]
    );

    await writeAuditLog(conn, {
      userId: req.user.id,
      action: 'CREATE_EMERGENCY_BROADCAST',
      entityType: 'emergency_broadcast_logs',
      entityId: broadcastId,
      newValues: { title: broadcastTitle, severity: broadcastSeverity, target_scope: scope, recipients_count: recipientCount },
      req,
    });

    await conn.commit();

    return res.status(201).json({
      message: 'Emergency broadcast transmitted successfully.',
      broadcast: {
        id: broadcastId,
        referenceNumber: `BRD-${String(broadcastId).padStart(4, '0')}`,
        title: broadcastTitle,
        message: broadcastMsg,
        severity: broadcastSeverity,
        targetScope: scope,
        recipientsCount: recipientCount,
        broadcastedAt: new Date(),
      },
    });
  } catch (err) {
    await conn.rollback();
    console.error('[Admin API] createEmergencyBroadcast failed:', err.message);
    return res.status(500).json({ error: 'Unable to save emergency broadcast.' });
  } finally {
    conn.release();
  }
}

// ============================================================================
// 8. REPORTS & ANALYTICS (GET /api/admin/analytics & /api/admin/analytics/export)
// ============================================================================

function buildDateFilterClause(period, from, to, dateColumn = 'created_at') {
  if (period === 'today') {
    return { clause: `DATE(${dateColumn}) = CURDATE()`, params: [] };
  }
  if (period === '7d') {
    return { clause: `${dateColumn} >= DATE_SUB(NOW(), INTERVAL 7 DAY)`, params: [] };
  }
  if (period === '30d') {
    return { clause: `${dateColumn} >= DATE_SUB(NOW(), INTERVAL 30 DAY)`, params: [] };
  }
  if (period === 'this_month') {
    return { clause: `${dateColumn} >= DATE_FORMAT(NOW(), '%Y-%m-01')`, params: [] };
  }
  if (period === 'last_month') {
    return {
      clause: `${dateColumn} >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-01') AND ${dateColumn} < DATE_FORMAT(NOW(), '%Y-%m-01')`,
      params: [],
    };
  }
  if (period === 'this_year') {
    return { clause: `${dateColumn} >= DATE_FORMAT(NOW(), '%Y-01-01')`, params: [] };
  }
  if (period === 'custom' && from && to) {
    return {
      clause: `${dateColumn} >= ? AND ${dateColumn} <= ?`,
      params: [`${from} 00:00:00`, `${to} 23:59:59`],
    };
  }
  return { clause: '1=1', params: [] };
}

async function getAdminAnalytics(req, res) {
  try {
    const period = String(req.query.period || 'all').toLowerCase();
    const { from, to } = req.query;

    const repDateFilter = buildDateFilterClause(period, from, to, 'created_at');
    const resqDateFilter = buildDateFilterClause(period, from, to, 'created_at');

    const [[repCountRow]] = await pool.query(
      `SELECT COUNT(*) AS count FROM reports WHERE ${repDateFilter.clause}`,
      repDateFilter.params
    );
    const [[resqCountRow]] = await pool.query(
      `SELECT COUNT(*) AS count FROM rescue_requests WHERE ${resqDateFilter.clause}`,
      resqDateFilter.params
    );
    const totalReports = Number((repCountRow && repCountRow.count) || 0);
    const totalRescues = Number((resqCountRow && resqCountRow.count) || 0);

    const [categories] = await pool.query(
      `SELECT COALESCE(NULLIF(incident_type, ''), 'General Incident') AS name, COUNT(*) AS count
       FROM reports
       WHERE ${repDateFilter.clause}
       GROUP BY name
       ORDER BY count DESC`,
      repDateFilter.params
    );

    const [severities] = await pool.query(
      `SELECT severity, COUNT(*) AS count
       FROM reports
       WHERE ${repDateFilter.clause}
       GROUP BY severity`,
      repDateFilter.params
    );

    const [statuses] = await pool.query(
      `SELECT status, COUNT(*) AS count
       FROM reports
       WHERE ${repDateFilter.clause}
       GROUP BY status`,
      repDateFilter.params
    );

    const [rescuePriorities] = await pool.query(
      `SELECT priority, status, COUNT(*) AS count
       FROM rescue_requests
       WHERE ${resqDateFilter.clause}
       GROUP BY priority, status`,
      resqDateFilter.params
    );

    const [monthlyTrends] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month_label, COUNT(*) AS count
       FROM reports
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY month_label
       ORDER BY month_label ASC`
    );

    const [locations] = await pool.query(
      `SELECT COALESCE(NULLIF(address, ''), 'Barangay Bayanan') AS location_name, COUNT(*) AS count
       FROM reports
       WHERE ${repDateFilter.clause}
       GROUP BY location_name
       ORDER BY count DESC
       LIMIT 8`,
      repDateFilter.params
    );

    const [[assignStatsRow]] = await pool.query(
      `SELECT 
         COUNT(*) AS total_assignments,
         SUM(CASE WHEN assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene') THEN 1 ELSE 0 END) AS active_assignments,
         SUM(CASE WHEN assignment_status = 'Completed' THEN 1 ELSE 0 END) AS completed_assignments
       FROM incident_assignments`
    );

    return res.json({
      period,
      summary: {
        totalReports,
        totalRescues,
        totalEvents: totalReports + totalRescues,
        totalAssignments: Number((assignStatsRow && assignStatsRow.total_assignments) || 0),
        activeAssignments: Number((assignStatsRow && assignStatsRow.active_assignments) || 0),
        completedAssignments: Number((assignStatsRow && assignStatsRow.completed_assignments) || 0),
      },
      categories,
      severities,
      statuses,
      rescuePriorities,
      monthlyTrends,
      locations,
    });
  } catch (err) {
    console.error('[Admin API] getAdminAnalytics failed:', err.message);
    return res.status(503).json({ error: 'Unable to aggregate analytics from MySQL.' });
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
         r.severity,
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
         rq.priority AS severity,
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
      'Severity',
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
        escapeCsv(row.severity),
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

    const [[failedLoginsRow]] = await pool.query(
      "SELECT COUNT(*) AS count FROM auth_security_logs WHERE event_type = 'login_failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)"
    );
    const [[successLoginsRow]] = await pool.query(
      "SELECT COUNT(*) AS count FROM auth_security_logs WHERE event_type = 'login_success' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)"
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
    return res.status(503).json({ error: 'Unable to load system settings from MySQL.' });
  }
}

async function updateAdminSystemSetting(req, res) {
  const { settingKey, setting_key, settingValue, setting_value } = req.body;
  const key = String(settingKey || setting_key || req.params.key || '').trim();
  const value = String(settingValue !== undefined ? settingValue : setting_value || '');

  if (!key) {
    return res.status(400).json({ error: 'Setting key is required.' });
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
  getAdminAuditLogs,
  getAdminRespondersList,
  assignResponder,
  getEmergencyBroadcasts,
  createEmergencyBroadcast,
  getAdminAnalytics,
  exportAdminAnalyticsCsv,
  getAdminSystemSettings,
  updateAdminSystemSetting,
};
