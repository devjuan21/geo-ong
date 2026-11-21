const ExcelJS = require('exceljs');
const { ZipArchive } = require('archiver');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const {
  buildDateFilterClause,
  getReportCategoryDistribution,
  getManilaDateParts,
  addDaysYmd,
} = require('./adminController');

const VALID_CATEGORIES = new Set([
  'incidents',
  'rescues',
  'operations',
  'dispatches',
  'analytics',
]);

const VALID_FORMATS = new Set(['xlsx', 'csv', 'pdf']);
const VALID_PERIODS = new Set([
  'today',
  '7d',
  '30d',
  'this_month',
  'last_month',
  'this_year',
  'all',
  'custom',
]);
const VALID_OPERATION_TYPES = new Set(['all', 'incident', 'rescue']);

const CATEGORY_LABELS = {
  incidents: 'Incident Reports',
  rescues: 'Rescue Requests',
  operations: 'Operations',
  dispatches: 'Dispatches',
  analytics: 'Analytics Summary',
};

function isValidYmd(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(str || '').trim());
}

function formatManilaTimestamp(val) {
  if (!val) return '';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' PHT';
}

function formatLocation(address, landmark, lat, lng) {
  const parts = [];
  if (address && String(address).trim()) parts.push(String(address).trim());
  if (landmark && String(landmark).trim()) parts.push(`(${String(landmark).trim()})`);
  if (parts.length > 0) return parts.join(' ');
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (Number.isFinite(numLat) && Number.isFinite(numLng)) {
    return `${numLat.toFixed(5)}, ${numLng.toFixed(5)}`;
  }
  return 'Barangay Bayanan';
}

function describeDateRange(period, from, to) {
  const labels = {
    today: 'Today',
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days',
    this_month: 'This Month',
    last_month: 'Last Month',
    this_year: 'This Year',
    all: 'All Available Records',
  };
  if (period === 'custom' && isValidYmd(from) && isValidYmd(to)) {
    const start = from <= to ? from : to;
    const end = from <= to ? to : from;
    return `Custom (${start} to ${end})`;
  }
  return labels[period] || 'All Available Records';
}

function parseAndValidateExportParams(rawInput = {}) {
  let categories = rawInput.categories;
  if (typeof categories === 'string') {
    categories = categories.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    return { error: 'Select at least one report category to export.' };
  }
  const uniqueCategories = Array.from(new Set(categories.map((c) => String(c).trim().toLowerCase())));
  for (const cat of uniqueCategories) {
    if (!VALID_CATEGORIES.has(cat)) {
      return { error: `Invalid export category: ${cat}` };
    }
  }

  const format = String(rawInput.format || 'xlsx').trim().toLowerCase();
  if (!VALID_FORMATS.has(format)) {
    return { error: `Invalid export format: ${format}. Allowed formats: xlsx, csv, pdf.` };
  }

  const period = String(rawInput.period || 'this_month').trim().toLowerCase();
  if (!VALID_PERIODS.has(period)) {
    return { error: `Invalid reporting period: ${period}` };
  }

  let from = rawInput.from ? String(rawInput.from).trim().slice(0, 10) : '';
  let to = rawInput.to ? String(rawInput.to).trim().slice(0, 10) : '';
  if (period === 'custom') {
    if (!isValidYmd(from) || !isValidYmd(to)) {
      return { error: 'Start date and End date (YYYY-MM-DD) are required for a custom date range.' };
    }
    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }
  }

  const status = rawInput.status ? String(rawInput.status).trim() : '';
  if (status.length > 60) {
    return { error: 'Invalid status filter.' };
  }

  const category = rawInput.category ? String(rawInput.category).trim() : '';
  if (category.length > 100) {
    return { error: 'Invalid incident category filter.' };
  }

  const operationType = String(rawInput.operationType || 'all').trim().toLowerCase();
  if (!VALID_OPERATION_TYPES.has(operationType)) {
    return { error: `Invalid operation type filter: ${operationType}` };
  }

  return {
    params: {
      categories: uniqueCategories,
      format,
      period,
      from,
      to,
      status,
      category,
      operationType,
      dateRangeLabel: describeDateRange(period, from, to),
    },
  };
}

async function queryIncidentReports(filters) {
  const dateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'r.created_at');
  const clauses = [dateFilter.clause];
  const params = [...dateFilter.params];

  if (filters.status) {
    clauses.push('LOWER(r.status) = LOWER(?)');
    params.push(filters.status);
  }
  if (filters.category) {
    clauses.push('(LOWER(r.incident_type) = LOWER(?) OR LOWER(COALESCE(ic.name, \'\')) = LOWER(?))');
    params.push(filters.category, filters.category);
  }

  const [rows] = await pool.query(
    `SELECT DISTINCT ON (r.id)
       r.id,
       COALESCE(NULLIF(r.reference_number, ''), CONCAT('INC-', r.id)) AS reference_number,
       COALESCE(NULLIF(ic.name, ''), NULLIF(r.incident_type, ''), 'Other') AS incident_category,
       r.address,
       r.latitude,
       r.longitude,
       r.created_at,
       r.status,
       r.verified_at,
       r.resolved_at,
       r.confirmed_resolved_at
     FROM reports r
     LEFT JOIN incident_categories ic ON r.category_id = ic.id
     WHERE ${clauses.join(' AND ')}
     ORDER BY r.id, r.created_at DESC`,
    params
  );

  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return rows.map((r) => {
    const stLower = String(r.status || '').toLowerCase();
    const verificationStatus = r.verified_at
      ? 'Verified'
      : stLower === 'rejected'
        ? 'Rejected'
        : stLower === 'pending verification'
          ? 'Pending Verification'
          : 'Verified';
    const completionTs = r.confirmed_resolved_at || r.resolved_at || null;
    return {
      incidentId: r.reference_number,
      incidentCategory: r.incident_category,
      reportedLocation: formatLocation(r.address, null, r.latitude, r.longitude),
      reportedAt: r.created_at,
      verificationStatus,
      resolutionStatus: r.status || 'Pending Verification',
      verifiedAt: r.verified_at || null,
      completedAt: completionTs,
    };
  });
}

async function queryRescueRequests(filters) {
  const dateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'rq.created_at');
  const clauses = [dateFilter.clause];
  const params = [...dateFilter.params];

  if (filters.status) {
    clauses.push('LOWER(rq.status) = LOWER(?)');
    params.push(filters.status);
  }

  const [rows] = await pool.query(
    `SELECT DISTINCT ON (rq.id)
       rq.id,
       COALESCE(NULLIF(rq.reference_number, ''), CONCAT('RSC-', rq.id)) AS reference_number,
       COALESCE(NULLIF(rq.emergency_type, ''), 'Rescue') AS rescue_type,
       rq.address,
       rq.landmark,
       rq.latitude,
       rq.longitude,
       rq.created_at,
       rq.status,
       rq.resolved_at,
       rq.confirmed_resolved_at,
       ra.assignment_status,
       ra.accepted_at,
       ra.completed_at AS assignment_completed_at,
       NULLIF(TRIM(CONCAT_WS(' ', rp.first_name, rp.last_name)), '') AS responder_name
     FROM rescue_requests rq
     LEFT JOIN rescue_assignments ra ON ra.rescue_id = rq.id
     LEFT JOIN user_profiles rp ON rp.user_id = ra.responder_user_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY rq.id, ra.assigned_at DESC NULLS LAST, rq.created_at DESC`,
    params
  );

  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return rows.map((r) => {
    const acceptanceStatus = r.accepted_at
      ? 'Accepted'
      : r.assignment_status || (String(r.status || '').toLowerCase() === 'rejected' ? 'Rejected' : 'Pending Acceptance');
    const completionTs = r.confirmed_resolved_at || r.resolved_at || r.assignment_completed_at || null;
    return {
      rescueId: r.reference_number,
      rescueType: r.rescue_type,
      reportedLocation: formatLocation(r.address, r.landmark, r.latitude, r.longitude),
      requestedAt: r.created_at,
      acceptanceStatus,
      assignedResponder: r.responder_name || 'Unassigned',
      operationStatus: r.status || 'Pending',
      completedAt: completionTs,
    };
  });
}

async function queryOperations(filters) {
  const records = [];
  const seenKeys = new Set();

  if (filters.operationType === 'all' || filters.operationType === 'incident') {
    const dateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'r.created_at');
    const clauses = [dateFilter.clause];
    const params = [...dateFilter.params];
    if (filters.status) {
      clauses.push('LOWER(r.status) = LOWER(?)');
      params.push(filters.status);
    }
    if (filters.category) {
      clauses.push('(LOWER(r.incident_type) = LOWER(?) OR LOWER(COALESCE(ic.name, \'\')) = LOWER(?))');
      params.push(filters.category, filters.category);
    }

    const [incRows] = await pool.query(
      `SELECT DISTINCT ON (r.id)
         r.id,
         COALESCE(NULLIF(r.reference_number, ''), CONCAT('INC-', r.id)) AS reference_id,
         r.address,
         r.latitude,
         r.longitude,
         r.status,
         r.created_at,
         r.resolved_at,
         r.confirmed_resolved_at,
         ia.assigned_at,
         ia.completed_at AS assignment_completed_at,
         NULLIF(TRIM(CONCAT_WS(' ', rp.first_name, rp.last_name)), '') AS responder_name
       FROM reports r
       LEFT JOIN incident_categories ic ON r.category_id = ic.id
       LEFT JOIN incident_assignments ia ON ia.report_id = r.id
       LEFT JOIN user_profiles rp ON rp.user_id = ia.responder_user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY r.id, ia.assigned_at DESC NULLS LAST, r.created_at DESC`,
      params
    );

    incRows.forEach((r) => {
      const key = `Incident:${r.id}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      records.push({
        operationType: 'Incident',
        referenceId: r.reference_id,
        location: formatLocation(r.address, null, r.latitude, r.longitude),
        responsibleResponder: r.responder_name || 'Unassigned',
        operationStatus: r.status || 'Pending Verification',
        startedAt: r.assigned_at || r.created_at,
        completedAt: r.assignment_completed_at || r.confirmed_resolved_at || r.resolved_at || null,
      });
    });
  }

  if (filters.operationType === 'all' || filters.operationType === 'rescue') {
    const dateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'rq.created_at');
    const clauses = [dateFilter.clause];
    const params = [...dateFilter.params];
    if (filters.status) {
      clauses.push('LOWER(rq.status) = LOWER(?)');
      params.push(filters.status);
    }

    const [resRows] = await pool.query(
      `SELECT DISTINCT ON (rq.id)
         rq.id,
         COALESCE(NULLIF(rq.reference_number, ''), CONCAT('RSC-', rq.id)) AS reference_id,
         rq.address,
         rq.landmark,
         rq.latitude,
         rq.longitude,
         rq.status,
         rq.created_at,
         rq.resolved_at,
         rq.confirmed_resolved_at,
         ra.assigned_at,
         ra.completed_at AS assignment_completed_at,
         NULLIF(TRIM(CONCAT_WS(' ', rp.first_name, rp.last_name)), '') AS responder_name
       FROM rescue_requests rq
       LEFT JOIN rescue_assignments ra ON ra.rescue_id = rq.id
       LEFT JOIN user_profiles rp ON rp.user_id = ra.responder_user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY rq.id, ra.assigned_at DESC NULLS LAST, rq.created_at DESC`,
      params
    );

    resRows.forEach((r) => {
      const key = `Rescue:${r.id}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      records.push({
        operationType: 'Rescue',
        referenceId: r.reference_id,
        location: formatLocation(r.address, r.landmark, r.latitude, r.longitude),
        responsibleResponder: r.responder_name || 'Unassigned',
        operationStatus: r.status || 'Pending',
        startedAt: r.assigned_at || r.created_at,
        completedAt: r.assignment_completed_at || r.confirmed_resolved_at || r.resolved_at || null,
      });
    });
  }

  records.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return records;
}

async function queryDispatches(filters) {
  const rows = [];

  if (filters.operationType === 'all' || filters.operationType === 'incident') {
    const dateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'ia.assigned_at');
    const clauses = [dateFilter.clause];
    const params = [...dateFilter.params];
    if (filters.status) {
      clauses.push('LOWER(ia.assignment_status) = LOWER(?)');
      params.push(filters.status);
    }

    const [incDispatches] = await pool.query(
      `SELECT
         ia.id,
         COALESCE(NULLIF(r.reference_number, ''), CONCAT('INC-', r.id)) AS related_ref,
         COALESCE(NULLIF(r.incident_type, ''), 'Incident') AS category_label,
         NULLIF(TRIM(CONCAT_WS(' ', rp.first_name, rp.last_name)), '') AS responder_name,
         ia.assigned_at,
         ia.accepted_at,
         ia.assignment_status,
         ia.completed_at
       FROM incident_assignments ia
       INNER JOIN reports r ON r.id = ia.report_id
       LEFT JOIN user_profiles rp ON rp.user_id = ia.responder_user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY ia.assigned_at DESC`,
      params
    );

    incDispatches.forEach((d) => {
      rows.push({
        dispatchId: `INC-DSP-${d.id}`,
        relatedRequest: `${d.related_ref} (${d.category_label})`,
        assignedResponder: d.responder_name || 'Unassigned',
        createdAt: d.assigned_at,
        acceptedAt: d.accepted_at || null,
        dispatchStatus: d.assignment_status || 'Assigned',
        completedAt: d.completed_at || null,
      });
    });
  }

  if (filters.operationType === 'all' || filters.operationType === 'rescue') {
    const dateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'ra.assigned_at');
    const clauses = [dateFilter.clause];
    const params = [...dateFilter.params];
    if (filters.status) {
      clauses.push('LOWER(ra.assignment_status) = LOWER(?)');
      params.push(filters.status);
    }

    const [resDispatches] = await pool.query(
      `SELECT
         ra.id,
         COALESCE(NULLIF(rq.reference_number, ''), CONCAT('RSC-', rq.id)) AS related_ref,
         COALESCE(NULLIF(rq.emergency_type, ''), 'Rescue') AS category_label,
         NULLIF(TRIM(CONCAT_WS(' ', rp.first_name, rp.last_name)), '') AS responder_name,
         ra.assigned_at,
         ra.accepted_at,
         ra.assignment_status,
         ra.completed_at
       FROM rescue_assignments ra
       INNER JOIN rescue_requests rq ON rq.id = ra.rescue_id
       LEFT JOIN user_profiles rp ON rp.user_id = ra.responder_user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY ra.assigned_at DESC`,
      params
    );

    resDispatches.forEach((d) => {
      rows.push({
        dispatchId: `RSC-DSP-${d.id}`,
        relatedRequest: `${d.related_ref} (${d.category_label})`,
        assignedResponder: d.responder_name || 'Unassigned',
        createdAt: d.assigned_at,
        acceptedAt: d.accepted_at || null,
        dispatchStatus: d.assignment_status || 'Assigned',
        completedAt: d.completed_at || null,
      });
    });
  }

  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return rows;
}

async function queryAnalyticsSummary(filters) {
  const repDateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'r.created_at');
  const resqDateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'created_at');

  const categoryDistribution = await getReportCategoryDistribution(repDateFilter);
  const totalIncidents = categoryDistribution.totalReports;

  const [[resqCountRow]] = await pool.query(
    `SELECT COUNT(*) AS count FROM rescue_requests WHERE ${resqDateFilter.clause}`,
    resqDateFilter.params
  );
  const totalRescues = Number((resqCountRow && resqCountRow.count) || 0);

  const [rescueStatusRows] = await pool.query(
    `SELECT COALESCE(NULLIF(status, ''), 'Pending') AS status, COUNT(*)::int AS count
     FROM rescue_requests
     WHERE ${resqDateFilter.clause}
     GROUP BY status
     ORDER BY count DESC`,
    resqDateFilter.params
  );

  const [dailyRows] = await pool.query(
    `SELECT TO_CHAR(r.created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date_key,
            COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     WHERE ${repDateFilter.clause}
     GROUP BY date_key
     ORDER BY date_key ASC`,
    repDateFilter.params
  );

  const dailyCountMap = new Map(dailyRows.map((row) => [String(row.date_key), Number(row.count || 0)]));
  const dailyTrends = [];
  if (dailyRows.length > 0) {
    const rangeStart = repDateFilter.startYmd || String(dailyRows[0].date_key);
    const rangeEnd = repDateFilter.endYmd || getManilaDateParts(new Date()).ymd;
    let cursor = rangeStart;
    let guard = 0;
    while (cursor <= rangeEnd && guard < 366) {
      dailyTrends.push({ date: cursor, count: dailyCountMap.get(cursor) || 0 });
      cursor = addDaysYmd(cursor, 1);
      guard++;
    }
  }

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

  const activeDispatches =
    Number((incAssignRow && incAssignRow.active_assignments) || 0) +
    Number((resAssignRow && resAssignRow.active_assignments) || 0);
  const completedDispatches =
    Number((incAssignRow && incAssignRow.completed_assignments) || 0) +
    Number((resAssignRow && resAssignRow.completed_assignments) || 0);
  const totalDispatches =
    Number((incAssignRow && incAssignRow.total_assignments) || 0) +
    Number((resAssignRow && resAssignRow.total_assignments) || 0);

  return {
    summary: {
      totalIncidents,
      totalRescues,
      totalOperations: totalIncidents + totalRescues,
      activeDispatches,
      completedDispatches,
      totalDispatches,
    },
    incidentsByCategory: categoryDistribution.categories || [],
    incidentsByDay: dailyTrends,
    rescuesByStatus: rescueStatusRows.map((r) => ({ status: r.status, count: Number(r.count || 0) })),
  };
}

async function previewAdminExport(req, res) {
  try {
    const validation = parseAndValidateExportParams(req.body || {});
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }
    const filters = validation.params;

    const counts = {};
    const emptyCategories = [];
    let totalRecords = 0;

    for (const cat of filters.categories) {
      if (cat === 'incidents') {
        const rows = await queryIncidentReports(filters);
        counts.incidents = rows.length;
        totalRecords += rows.length;
        if (rows.length === 0) emptyCategories.push('Incident Reports');
      } else if (cat === 'rescues') {
        const rows = await queryRescueRequests(filters);
        counts.rescues = rows.length;
        totalRecords += rows.length;
        if (rows.length === 0) emptyCategories.push('Rescue Requests');
      } else if (cat === 'operations') {
        const rows = await queryOperations(filters);
        counts.operations = rows.length;
        totalRecords += rows.length;
        if (rows.length === 0) emptyCategories.push('Operations');
      } else if (cat === 'dispatches') {
        const rows = await queryDispatches(filters);
        counts.dispatches = rows.length;
        totalRecords += rows.length;
        if (rows.length === 0) emptyCategories.push('Dispatches');
      } else if (cat === 'analytics') {
        const analyticsData = await queryAnalyticsSummary(filters);
        counts.analytics = 1;
        totalRecords += 1;
        if (analyticsData.summary.totalOperations === 0) {
          emptyCategories.push('Analytics Summary (0 events in period)');
        }
      }
    }

    return res.json({
      categories: filters.categories,
      categoryLabels: filters.categories.map((c) => CATEGORY_LABELS[c]),
      format: filters.format,
      period: filters.period,
      dateRangeLabel: filters.dateRangeLabel,
      counts,
      totalRecords,
      emptyCategories,
    });
  } catch (err) {
    console.error('[Admin Export] previewAdminExport failed:', err.message);
    return res.status(500).json({ error: 'Unable to calculate export preview counts from database.' });
  }
}

function buildCsvString(headers, rows) {
  const esc = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };
  const lines = [headers.map(esc).join(',')];
  rows.forEach((row) => {
    lines.push(row.map(esc).join(','));
  });
  return '\uFEFF' + lines.join('\r\n');
}

function buildCategoryTable(catKey, data) {
  if (catKey === 'incidents') {
    return {
      sheetName: 'Incident Reports',
      fileName: 'incident_reports.csv',
      headers: [
        'Incident ID',
        'Incident Category',
        'Reported Location',
        'Date & Time Reported',
        'Verification Status',
        'Resolution Status',
        'Verification Timestamp',
        'Completion Timestamp',
      ],
      rows: data.map((r) => [
        r.incidentId,
        r.incidentCategory,
        r.reportedLocation,
        formatManilaTimestamp(r.reportedAt),
        r.verificationStatus,
        r.resolutionStatus,
        formatManilaTimestamp(r.verifiedAt),
        formatManilaTimestamp(r.completedAt),
      ]),
    };
  }
  if (catKey === 'rescues') {
    return {
      sheetName: 'Rescue Requests',
      fileName: 'rescue_requests.csv',
      headers: [
        'Rescue Request ID',
        'Rescue Type',
        'Reported Location',
        'Date & Time Requested',
        'Acceptance Status',
        'Assigned Responder',
        'Operation Status',
        'Completion Timestamp',
      ],
      rows: data.map((r) => [
        r.rescueId,
        r.rescueType,
        r.reportedLocation,
        formatManilaTimestamp(r.requestedAt),
        r.acceptanceStatus,
        r.assignedResponder,
        r.operationStatus,
        formatManilaTimestamp(r.completedAt),
      ]),
    };
  }
  if (catKey === 'operations') {
    return {
      sheetName: 'Operations',
      fileName: 'operations.csv',
      headers: [
        'Operation Type',
        'Reference ID',
        'Location',
        'Responsible Responder',
        'Operation Status',
        'Start Timestamp',
        'Completion Timestamp',
      ],
      rows: data.map((r) => [
        r.operationType,
        r.referenceId,
        r.location,
        r.responsibleResponder,
        r.operationStatus,
        formatManilaTimestamp(r.startedAt),
        formatManilaTimestamp(r.completedAt),
      ]),
    };
  }
  return {
    sheetName: 'Dispatches',
    fileName: 'dispatches.csv',
    headers: [
      'Dispatch ID',
      'Related Request',
      'Assigned Responder',
      'Dispatch Creation Time',
      'Acceptance Time',
      'Dispatch Status',
      'Completion Time',
    ],
    rows: data.map((r) => [
      r.dispatchId,
      r.relatedRequest,
      r.assignedResponder,
      formatManilaTimestamp(r.createdAt),
      formatManilaTimestamp(r.acceptedAt),
      r.dispatchStatus,
      formatManilaTimestamp(r.completedAt),
    ]),
  };
}

function buildExportFilename(filters, ext) {
  const dateStr = getManilaDateParts(new Date()).ymd;
  if (filters.categories.length === 1) {
    const slug = CATEGORY_LABELS[filters.categories[0]].replace(/\s+/g, '_');
    return `GeoSafe_${slug}_${dateStr}.${ext}`;
  }
  return `GeoSafe_Analytics_Export_${dateStr}.${ext}`;
}

async function generateExcelResponse(res, filters, datasets) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GeoSafe Emergency Operations Center';
  workbook.created = new Date();

  if (datasets.analytics) {
    const a = datasets.analytics;
    const ws = workbook.addWorksheet('Analytics Summary');
    ws.columns = [
      { header: 'Metric / Breakdown', key: 'label', width: 34 },
      { header: 'Value / Count', key: 'value', width: 20 },
      { header: 'Notes / Share', key: 'notes', width: 26 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };

    ws.addRow(['GeoSafe Reporting Period', filters.dateRangeLabel, `Generated ${formatManilaTimestamp(new Date())}`]);
    ws.addRow(['Total Incidents', a.summary.totalIncidents, '']);
    ws.addRow(['Total Rescues', a.summary.totalRescues, '']);
    ws.addRow(['Total Operations', a.summary.totalOperations, 'Incidents + Rescues']);
    ws.addRow(['Active Dispatches', a.summary.activeDispatches, 'Assigned / Accepted / En Route / On Scene']);
    ws.addRow(['Completed Dispatches', a.summary.completedDispatches, '']);
    ws.addRow(['', '', '']);

    const catHdr = ws.addRow(['Incident Counts by Category', 'Count', 'Percentage']);
    catHdr.font = { bold: true };
    a.incidentsByCategory.forEach((c) => {
      ws.addRow([c.category, Number(c.count || 0), `${Number(c.percentage || 0)}%`]);
    });
    ws.addRow(['', '', '']);

    const resHdr = ws.addRow(['Rescue Counts by Status', 'Count', '']);
    resHdr.font = { bold: true };
    a.rescuesByStatus.forEach((r) => {
      ws.addRow([r.status, Number(r.count || 0), '']);
    });
    ws.addRow(['', '', '']);

    const dayHdr = ws.addRow(['Incident Counts by Day (PHT)', 'Count', '']);
    dayHdr.font = { bold: true };
    a.incidentsByDay.forEach((d) => {
      ws.addRow([d.date, Number(d.count || 0), '']);
    });
  }

  for (const key of ['incidents', 'rescues', 'operations', 'dispatches']) {
    if (!datasets[key]) continue;
    const table = buildCategoryTable(key, datasets[key]);
    const ws = workbook.addWorksheet(table.sheetName);
    ws.addRow(table.headers);
    const hdrRow = ws.getRow(1);
    hdrRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hdrRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };

    if (table.rows.length === 0) {
      ws.addRow(['No matching records found for the selected filters.']);
    } else {
      table.rows.forEach((r) => ws.addRow(r));
    }

    ws.columns.forEach((col, idx) => {
      let maxLen = String(table.headers[idx] || '').length;
      table.rows.forEach((r) => {
        const len = String(r[idx] || '').length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(48, Math.max(16, maxLen + 4));
    });
  }

  const filename = buildExportFilename(filters, 'xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  return res.end();
}

async function generateCsvResponse(res, filters, datasets) {
  const files = [];

  if (datasets.analytics) {
    const a = datasets.analytics;
    const rows = [
      ['Reporting Period', filters.dateRangeLabel, ''],
      ['Total Incidents', a.summary.totalIncidents, ''],
      ['Total Rescues', a.summary.totalRescues, ''],
      ['Total Operations', a.summary.totalOperations, ''],
      ['Active Dispatches', a.summary.activeDispatches, ''],
      ['Completed Dispatches', a.summary.completedDispatches, ''],
      ...a.incidentsByCategory.map((c) => [`Category: ${c.category}`, c.count, `${c.percentage}%`]),
      ...a.rescuesByStatus.map((r) => [`Rescue Status: ${r.status}`, r.count, '']),
      ...a.incidentsByDay.map((d) => [`Daily Incidents: ${d.date}`, d.count, '']),
    ];
    files.push({
      fileName: 'analytics_summary.csv',
      content: buildCsvString(['Metric', 'Value', 'Detail'], rows),
    });
  }

  for (const key of ['incidents', 'rescues', 'operations', 'dispatches']) {
    if (!datasets[key]) continue;
    const table = buildCategoryTable(key, datasets[key]);
    files.push({
      fileName: table.fileName,
      content: buildCsvString(table.headers, table.rows),
    });
  }

  if (files.length === 1) {
    const filename = buildExportFilename(filters, 'csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(files[0].content);
  }

  const zipFilename = buildExportFilename(filters, 'zip');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('[Admin Export] ZIP archive error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Unable to package CSV archive.' });
  });
  archive.pipe(res);
  files.forEach((f) => archive.append(Buffer.from(f.content, 'utf8'), { name: f.fileName }));
  await archive.finalize();
  return undefined;
}

function generatePdfResponse(res, filters, datasets) {
  const filename = buildExportFilename(filters, 'pdf');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  doc.pipe(res);

  const pageWidth = doc.page.width - 80;
  const drawHeader = () => {
    doc.rect(40, 32, pageWidth, 44).fill('#0F172A');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14)
      .text('GeoSafe — Barangay Bayanan EOC Export Report', 54, 42);
    doc.font('Helvetica').fontSize(9).fillColor('#CBD5E1')
      .text(`Period: ${filters.dateRangeLabel}  |  Generated: ${formatManilaTimestamp(new Date())}  |  Categories: ${filters.categories.map((c) => CATEGORY_LABELS[c]).join(', ')}`, 54, 60);
    doc.y = 92;
  };

  drawHeader();

  if (datasets.analytics) {
    const a = datasets.analytics;
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(12).text('Analytics Summary');
    doc.moveDown(0.4);

    const kpis = [
      ['Total Incidents', String(a.summary.totalIncidents)],
      ['Total Rescues', String(a.summary.totalRescues)],
      ['Total Operations', String(a.summary.totalOperations)],
      ['Active Dispatches', String(a.summary.activeDispatches)],
    ];
    const boxW = (pageWidth - 24) / 4;
    const boxY = doc.y;
    kpis.forEach(([label, val], idx) => {
      const bx = 40 + idx * (boxW + 8);
      doc.rect(bx, boxY, boxW, 42).fillAndStroke('#F8FAFC', '#CBD5E1');
      doc.fillColor('#475569').font('Helvetica').fontSize(8).text(label.toUpperCase(), bx + 10, boxY + 8);
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(15).text(val, bx + 10, boxY + 20);
    });
    doc.y = boxY + 54;

    if (a.incidentsByCategory.length > 0) {
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10).text('Incidents by Category');
      doc.moveDown(0.25);
      const maxCount = Math.max(1, ...a.incidentsByCategory.map((c) => Number(c.count || 0)));
      a.incidentsByCategory.forEach((c) => {
        const y = doc.y;
        const barW = Math.round((Number(c.count || 0) / maxCount) * 260);
        doc.fillColor('#334155').font('Helvetica').fontSize(8.5).text(c.category, 40, y, { width: 200 });
        doc.rect(250, y + 2, Math.max(2, barW), 8).fill('#0A58CA');
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5).text(`${c.count} (${c.percentage}%)`, 520, y);
        doc.y = y + 14;
      });
      doc.moveDown(0.6);
    }

    if (a.rescuesByStatus.length > 0) {
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10).text('Rescue Counts by Status');
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(8.5).fillColor('#334155')
        .text(a.rescuesByStatus.map((r) => `${r.status}: ${r.count}`).join('   |   '));
      doc.moveDown(0.8);
    }
  }

  for (const key of ['incidents', 'rescues', 'operations', 'dispatches']) {
    if (!datasets[key]) continue;
    const table = buildCategoryTable(key, datasets[key]);
    if (doc.y > doc.page.height - 120) {
      doc.addPage();
      drawHeader();
    }

    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(11).text(`${table.sheetName} (${table.rows.length} records)`);
    doc.moveDown(0.35);

    const colCount = table.headers.length;
    const colW = pageWidth / colCount;

    const drawTableHeader = () => {
      const y = doc.y;
      doc.rect(40, y, pageWidth, 20).fill('#0F172A');
      table.headers.forEach((h, i) => {
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5)
          .text(h, 44 + i * colW, y + 6, { width: colW - 8, ellipsis: true, lineBreak: false });
      });
      doc.y = y + 22;
    };

    drawTableHeader();

    if (table.rows.length === 0) {
      doc.fillColor('#64748B').font('Helvetica-Oblique').fontSize(8.5)
        .text('No matching records found for the selected filters.', 44, doc.y + 4);
      doc.moveDown(1.2);
      continue;
    }

    table.rows.forEach((row, rIdx) => {
      if (doc.y > doc.page.height - 56) {
        doc.addPage();
        drawHeader();
        drawTableHeader();
      }
      const y = doc.y;
      if (rIdx % 2 === 1) {
        doc.rect(40, y, pageWidth, 18).fill('#F8FAFC');
      }
      row.forEach((cell, i) => {
        doc.fillColor('#1E293B').font('Helvetica').fontSize(7.5)
          .text(String(cell ?? ''), 44 + i * colW, y + 5, { width: colW - 8, ellipsis: true, lineBreak: false });
      });
      doc.y = y + 18;
    });

    doc.moveDown(0.9);
  }

  doc.end();
}

async function generateAdminExport(req, res) {
  try {
    const rawInput = req.method === 'GET'
      ? {
          categories: req.query.categories || 'incidents,rescues',
          format: req.query.format || 'csv',
          period: req.query.period || 'all',
          from: req.query.from || '',
          to: req.query.to || '',
          status: req.query.status || '',
          category: req.query.category || '',
          operationType: req.query.operationType || 'all',
        }
      : (req.body || {});

    const validation = parseAndValidateExportParams(rawInput);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }
    const filters = validation.params;

    const datasets = {};
    if (filters.categories.includes('incidents')) datasets.incidents = await queryIncidentReports(filters);
    if (filters.categories.includes('rescues')) datasets.rescues = await queryRescueRequests(filters);
    if (filters.categories.includes('operations')) datasets.operations = await queryOperations(filters);
    if (filters.categories.includes('dispatches')) datasets.dispatches = await queryDispatches(filters);
    if (filters.categories.includes('analytics')) datasets.analytics = await queryAnalyticsSummary(filters);

    if (filters.format === 'xlsx') {
      return await generateExcelResponse(res, filters, datasets);
    }
    if (filters.format === 'csv') {
      return await generateCsvResponse(res, filters, datasets);
    }
    return generatePdfResponse(res, filters, datasets);
  } catch (err) {
    console.error('[Admin Export] generateAdminExport failed:', err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Unable to generate export file from database.' });
    }
    return undefined;
  }
}

module.exports = {
  previewAdminExport,
  generateAdminExport,
};
