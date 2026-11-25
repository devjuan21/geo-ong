const pool = require('../models/db');
const { isPointInsideBayanan } = require('../utils/bayananBoundary');

const CANONICAL_DISASTER_CATEGORIES = [
  { name: 'Flooding / Rising Water', color: '#2563EB' },
  { name: 'Fallen Tree / Road Obstruction', color: '#D97706' },
  { name: 'Downed Electrical Power Cable', color: '#8B5CF6' },
  { name: 'Structural / Wall Collapse', color: '#EA580C' },
  { name: 'Fire Outbreak', color: '#DC2626' },
  { name: 'Severe Drainage Overflow', color: '#0D9488' },
  { name: 'Other Disaster Hazard', color: '#475569' },
];

function getManilaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    ymd: `${map.year}-${map.month}-${map.day}`,
  };
}

function addDaysYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function diffDaysYmd(startYmd, endYmd) {
  const [y1, m1, d1] = startYmd.split('-').map(Number);
  const [y2, m2, d2] = endYmd.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86400000);
}

function buildDateFilterClause(period, from, to, dateColumn = 'created_at') {
  const p = String(period || 'all').toLowerCase();
  const manilaToday = getManilaDateParts(new Date());

  const makeRange = (startYmd, endYmd) => {
    const s = startYmd <= endYmd ? startYmd : endYmd;
    const e = startYmd <= endYmd ? endYmd : startYmd;
    const span = diffDaysYmd(s, e) + 1;
    const prevEndYmd = addDaysYmd(s, -1);
    const prevStartYmd = addDaysYmd(prevEndYmd, -(span - 1));
    return {
      clause: `${dateColumn} >= ? AND ${dateColumn} <= ?`,
      params: [`${s}T00:00:00+08:00`, `${e}T23:59:59.999+08:00`],
      startYmd: s,
      endYmd: e,
      prevClause: `${dateColumn} >= ? AND ${dateColumn} <= ?`,
      prevParams: [`${prevStartYmd}T00:00:00+08:00`, `${prevEndYmd}T23:59:59.999+08:00`],
      prevStartYmd,
      prevEndYmd,
    };
  };

  if (p === 'today') return makeRange(manilaToday.ymd, manilaToday.ymd);
  if (p === 'yesterday') {
    const y = addDaysYmd(manilaToday.ymd, -1);
    return makeRange(y, y);
  }
  if (p === '7d') return makeRange(addDaysYmd(manilaToday.ymd, -6), manilaToday.ymd);
  if (p === '30d') return makeRange(addDaysYmd(manilaToday.ymd, -29), manilaToday.ymd);
  if (p === 'this_month') {
    const startYmd = `${manilaToday.year}-${String(manilaToday.month).padStart(2, '0')}-01`;
    return makeRange(startYmd, manilaToday.ymd);
  }
  if (p === 'last_month') {
    const prevMonthDate = new Date(Date.UTC(manilaToday.year, manilaToday.month - 2, 1));
    const lastDayPrevMonth = new Date(Date.UTC(manilaToday.year, manilaToday.month - 1, 0));
    const startYmd = `${prevMonthDate.getUTCFullYear()}-${String(prevMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const endYmd = `${lastDayPrevMonth.getUTCFullYear()}-${String(lastDayPrevMonth.getUTCMonth() + 1).padStart(2, '0')}-${String(lastDayPrevMonth.getUTCDate()).padStart(2, '0')}`;
    return makeRange(startYmd, endYmd);
  }
  if (p === 'this_year') return makeRange(`${manilaToday.year}-01-01`, manilaToday.ymd);
  if (p === 'last_year') return makeRange(`${manilaToday.year - 1}-01-01`, `${manilaToday.year - 1}-12-31`);
  if (p === 'custom' && from && to) {
    const safeFrom = String(from).slice(0, 10);
    const safeTo = String(to).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(safeFrom) && /^\d{4}-\d{2}-\d{2}$/.test(safeTo)) {
      return makeRange(safeFrom, safeTo);
    }
  }
  return {
    clause: '1=1',
    params: [],
    startYmd: null,
    endYmd: null,
    prevClause: null,
    prevParams: [],
    prevStartYmd: null,
    prevEndYmd: null,
  };
}

function normalizeCanonicalDisasterCategory(rawName) {
  const raw = String(rawName || '').trim();
  if (!raw) return 'Other Disaster Hazard';
  const low = raw.toLowerCase();
  if (low.includes('flood') || low.includes('rising water')) return 'Flooding / Rising Water';
  if (low.includes('fallen tree') || low.includes('road obstruction') || low.includes('blocked road')) return 'Fallen Tree / Road Obstruction';
  if (low.includes('electrical') || low.includes('power cable') || low.includes('power line')) return 'Downed Electrical Power Cable';
  if (low.includes('structural') || low.includes('wall collapse') || low.includes('collapse')) return 'Structural / Wall Collapse';
  if (low.includes('fire')) return 'Fire Outbreak';
  if (low.includes('drainage')) return 'Severe Drainage Overflow';
  return 'Other Disaster Hazard';
}

const CANONICAL_CATEGORY_SQL_EXPR = `CASE
  WHEN LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%flood%'
    OR LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%rising water%' THEN 'Flooding / Rising Water'
  WHEN LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%fallen tree%'
    OR LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%road obstruction%'
    OR LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%blocked road%' THEN 'Fallen Tree / Road Obstruction'
  WHEN LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%electrical%'
    OR LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%power cable%'
    OR LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%power line%' THEN 'Downed Electrical Power Cable'
  WHEN LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%structural%'
    OR LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%collapse%' THEN 'Structural / Wall Collapse'
  WHEN LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%fire%' THEN 'Fire Outbreak'
  WHEN LOWER(COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, '')) LIKE '%drainage%' THEN 'Severe Drainage Overflow'
  ELSE 'Other Disaster Hazard'
END`;

function parseFilters(query = {}) {
  const period = String(query.period || 'this_month').trim().toLowerCase();
  const from = query.from ? String(query.from).trim().slice(0, 10) : '';
  const to = query.to ? String(query.to).trim().slice(0, 10) : '';
  const category = query.category ? String(query.category).trim() : '';
  const rescueType = query.rescueType ? String(query.rescueType).trim() : '';
  const status = query.status ? String(query.status).trim().toLowerCase() : '';
  const location = query.location ? String(query.location).trim() : '';
  const responderId = query.responderId ? Number(query.responderId) : null;
  const organization = query.organization ? String(query.organization).trim() : '';
  return {
    period,
    from,
    to,
    category,
    rescueType,
    status,
    location,
    responderId: Number.isInteger(responderId) && responderId > 0 ? responderId : null,
    organization,
  };
}

function buildIncidentFilterSql(filters, dateClauseOverride = null, dateParamsOverride = null) {
  const dateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'r.created_at');
  const clauses = [dateClauseOverride || dateFilter.clause];
  const params = [...(dateParamsOverride || dateFilter.params)];

  if (filters.category && filters.category.toLowerCase() !== 'all') {
    clauses.push(`LOWER(${CANONICAL_CATEGORY_SQL_EXPR}) = LOWER(?)`);
    params.push(filters.category);
  }
  if (filters.status && filters.status !== 'all') {
    clauses.push(`LOWER(r.status) = ?`);
    params.push(filters.status);
  }
  if (filters.location) {
    clauses.push(`LOWER(COALESCE(NULLIF(TRIM(r.address), ''), 'Barangay Bayanan')) LIKE ?`);
    params.push(`%${filters.location.toLowerCase()}%`);
  }
  if (filters.responderId) {
    clauses.push(
      `(r.assigned_to = ? OR EXISTS (SELECT 1 FROM incident_assignments ia WHERE ia.report_id = r.id AND ia.responder_user_id = ?))`
    );
    params.push(filters.responderId, filters.responderId);
  }
  if (filters.organization && filters.organization.toLowerCase() !== 'all') {
    clauses.push(
      `EXISTS (
         SELECT 1 FROM incident_assignments ia
         JOIN responder_profiles rp ON rp.user_id = ia.responder_user_id
         WHERE ia.report_id = r.id
           AND LOWER(COALESCE(NULLIF(TRIM(rp.custom_organization), ''), NULLIF(TRIM(rp.organization), ''), 'Unassigned')) = LOWER(?)
       )`
    );
    params.push(filters.organization);
  }

  return {
    clause: clauses.join(' AND '),
    params,
    dateFilter,
  };
}

function buildRescueFilterSql(filters, dateClauseOverride = null, dateParamsOverride = null) {
  const dateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'rq.created_at');
  const clauses = [dateClauseOverride || dateFilter.clause];
  const params = [...(dateParamsOverride || dateFilter.params)];

  if (filters.rescueType && filters.rescueType.toLowerCase() !== 'all') {
    clauses.push(`LOWER(COALESCE(NULLIF(TRIM(rq.emergency_type), ''), 'Unspecified')) = LOWER(?)`);
    params.push(filters.rescueType);
  }
  if (filters.status && filters.status !== 'all') {
    clauses.push(`LOWER(rq.status) = ?`);
    params.push(filters.status);
  }
  if (filters.location) {
    clauses.push(`LOWER(COALESCE(NULLIF(TRIM(rq.address), ''), 'Barangay Bayanan')) LIKE ?`);
    params.push(`%${filters.location.toLowerCase()}%`);
  }
  if (filters.responderId) {
    clauses.push(
      `EXISTS (SELECT 1 FROM rescue_assignments ra WHERE ra.rescue_id = rq.id AND ra.responder_user_id = ?)`
    );
    params.push(filters.responderId);
  }
  if (filters.organization && filters.organization.toLowerCase() !== 'all') {
    clauses.push(
      `EXISTS (
         SELECT 1 FROM rescue_assignments ra
         JOIN responder_profiles rp ON rp.user_id = ra.responder_user_id
         WHERE ra.rescue_id = rq.id
           AND LOWER(COALESCE(NULLIF(TRIM(rp.custom_organization), ''), NULLIF(TRIM(rp.organization), ''), 'Unassigned')) = LOWER(?)
       )`
    );
    params.push(filters.organization);
  }

  return {
    clause: clauses.join(' AND '),
    params,
    dateFilter,
  };
}

function buildCategoryDistributionFromRows(rows) {
  const countMap = new Map(CANONICAL_DISASTER_CATEGORIES.map((c) => [c.name, 0]));
  const extraCategories = [];
  let totalReports = 0;

  rows.forEach((row) => {
    const count = Number(row.count || 0);
    if (count <= 0) return;
    const normalized = normalizeCanonicalDisasterCategory(row.raw_category);
    totalReports += count;
    if (countMap.has(normalized)) {
      countMap.set(normalized, countMap.get(normalized) + count);
    } else {
      const existing = extraCategories.find((e) => e.name === normalized);
      if (existing) existing.count += count;
      else extraCategories.push({ name: normalized, color: '#64748B', count });
    }
  });

  const allCategories = [
    ...CANONICAL_DISASTER_CATEGORIES.map((c) => {
      const count = countMap.get(c.name) || 0;
      const percentage = totalReports > 0 ? Number(((count / totalReports) * 100).toFixed(1)) : 0;
      return { name: c.name, color: c.color, count, percentage };
    }),
    ...extraCategories.map((c) => ({
      ...c,
      percentage: totalReports > 0 ? Number(((c.count / totalReports) * 100).toFixed(1)) : 0,
    })),
  ];

  const categories = [...allCategories].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { totalReports, categories, allCategories };
}

function fillDailySeries(rows, startYmd, endYmd) {
  const countMap = new Map(rows.map((r) => [String(r.date_key), Number(r.count || 0)]));
  if (rows.length === 0 && (!startYmd || !endYmd)) return [];
  const s = startYmd || String(rows[0].date_key);
  const e = endYmd || getManilaDateParts(new Date()).ymd;
  const out = [];
  let cursor = s;
  let guard = 0;
  while (cursor <= e && guard < 366) {
    out.push({ date: cursor, count: countMap.get(cursor) || 0 });
    cursor = addDaysYmd(cursor, 1);
    guard++;
  }
  return out;
}

function computeStatsFromMinutes(values) {
  if (!values.length) {
    return { avgMinutes: null, minMinutes: null, maxMinutes: null, sampleSize: 0 };
  }
  let sum = 0;
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    avgMinutes: Number((sum / values.length).toFixed(1)),
    minMinutes: Number(min.toFixed(1)),
    maxMinutes: Number(max.toFixed(1)),
    sampleSize: values.length,
  };
}

function validDurationMinutes(startTs, endTs) {
  if (!startTs || !endTs) return null;
  const t1 = new Date(startTs).getTime();
  const t2 = new Date(endTs).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  const diffMin = (t2 - t1) / 60000;
  // Exclude negative/corrupted timestamps and multi-week anomalies (> 7 days)
  if (diffMin < 0 || diffMin > 10080) return null;
  return diffMin;
}

async function getComprehensiveAnalytics(query = {}) {
  const filters = parseFilters(query);
  const incSql = buildIncidentFilterSql(filters);
  const resqSql = buildRescueFilterSql(filters);

  // 1. Filter dropdown options (from genuine PostgreSQL tables)
  const [catOptRows] = await pool.query(
    `SELECT DISTINCT COALESCE(NULLIF(TRIM(ic.name), ''), NULLIF(TRIM(r.incident_type), '')) AS val
     FROM incident_categories ic
     FULL OUTER JOIN reports r ON r.category_id = ic.id
     WHERE COALESCE(NULLIF(TRIM(ic.name), ''), NULLIF(TRIM(r.incident_type), '')) IS NOT NULL
     ORDER BY val ASC`
  );
  const [rescueTypeOptRows] = await pool.query(
    `SELECT DISTINCT COALESCE(NULLIF(TRIM(emergency_type), ''), 'Unspecified') AS val
     FROM rescue_requests
     ORDER BY val ASC`
  );
  const [responderOptRows] = await pool.query(
    `SELECT u.id, u.name, rp.badge_number,
            COALESCE(NULLIF(TRIM(rp.custom_organization), ''), NULLIF(TRIM(rp.organization), ''), 'Unassigned') AS org
     FROM users u
     LEFT JOIN responder_profiles rp ON rp.user_id = u.id
     WHERE u.role_id = 2 OR LOWER(COALESCE(u.role, '')) = 'responder'
     ORDER BY u.name ASC`
  );
  const orgSet = new Set();
  responderOptRows.forEach((r) => {
    if (r.org) orgSet.add(r.org);
  });

  // 2. Incident Category & Status & Counts (zero double counting)
  const [incCatRows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, 'Other Hazard') AS raw_category,
            COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${incSql.clause}
     GROUP BY COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, 'Other Hazard')`,
    incSql.params
  );
  const categoryDistribution = buildCategoryDistributionFromRows(incCatRows);
  const totalIncidents = categoryDistribution.totalReports;

  const [[incSummaryRow]] = await pool.query(
    `SELECT COUNT(DISTINCT r.id)::int AS total_incidents,
            COUNT(DISTINCT CASE WHEN r.source_rescue_id IS NOT NULL THEN r.id END)::int AS linked_rescue_incidents,
            COUNT(DISTINCT CASE WHEN LOWER(r.status) = 'pending' THEN r.id END)::int AS pending_reports,
            COUNT(DISTINCT CASE WHEN r.source_rescue_id IS NULL AND LOWER(r.status) IN ('resolved', 'completed', 'closed') THEN r.id END)::int AS completed_incidents
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${incSql.clause}`,
    incSql.params
  );

  const [incStatusRows] = await pool.query(
    `SELECT LOWER(COALESCE(NULLIF(TRIM(r.status), ''), 'pending')) AS status,
            COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${incSql.clause}
     GROUP BY LOWER(COALESCE(NULLIF(TRIM(r.status), ''), 'pending'))
     ORDER BY count DESC`,
    incSql.params
  );

  const statuses = incStatusRows.map((s) => ({
    status: s.status,
    count: Number(s.count || 0),
    percentage: totalIncidents > 0 ? Number(((Number(s.count || 0) / totalIncidents) * 100).toFixed(1)) : 0,
    group: ['resolved', 'completed', 'closed', 'false_alarm', 'dismissed'].includes(s.status) ? 'resolved' : 'active',
  }));

  // 3. Rescue Request Counts & Statuses & Types
  const [[resqSummaryRow]] = await pool.query(
    `SELECT COUNT(DISTINCT rq.id)::int AS total_rescues,
            COUNT(DISTINCT CASE WHEN LOWER(rq.status) IN ('resolved', 'completed') THEN rq.id END)::int AS completed_rescues,
            COUNT(DISTINCT CASE WHEN LOWER(rq.status) IN ('cancelled', 'canceled', 'false_alarm', 'dismissed') THEN rq.id END)::int AS cancelled_rescues,
            COUNT(DISTINCT CASE WHEN LOWER(rq.status) IN ('pending', 'pending dispatch', 'unclaimed', 'open')
              AND NOT EXISTS (
                SELECT 1 FROM rescue_assignments ra
                WHERE ra.rescue_id = rq.id
                  AND ra.assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene', 'Completed')
              ) THEN rq.id END)::int AS unclaimed_requests,
            COUNT(DISTINCT CASE WHEN LOWER(rq.status) IN ('accepted', 'en_route', 'en route', 'on_scene', 'on scene', 'dispatched', 'assigned') THEN rq.id END)::int AS accepted_on_scene
     FROM rescue_requests rq
     WHERE ${resqSql.clause}`,
    resqSql.params
  );
  const totalRescues = Number((resqSummaryRow && resqSummaryRow.total_rescues) || 0);

  const [resqStatusRows] = await pool.query(
    `SELECT LOWER(COALESCE(NULLIF(TRIM(rq.status), ''), 'pending')) AS status,
            COUNT(DISTINCT rq.id)::int AS count
     FROM rescue_requests rq
     WHERE ${resqSql.clause}
     GROUP BY LOWER(COALESCE(NULLIF(TRIM(rq.status), ''), 'pending'))
     ORDER BY count DESC`,
    resqSql.params
  );
  const rescueStatuses = resqStatusRows.map((s) => ({
    status: s.status,
    count: Number(s.count || 0),
    percentage: totalRescues > 0 ? Number(((Number(s.count || 0) / totalRescues) * 100).toFixed(1)) : 0,
  }));

  const [resqTypeRows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(rq.emergency_type), ''), 'Unspecified') AS emergency_type,
            COUNT(DISTINCT rq.id)::int AS count
     FROM rescue_requests rq
     WHERE ${resqSql.clause}
     GROUP BY COALESCE(NULLIF(TRIM(rq.emergency_type), ''), 'Unspecified')
     ORDER BY count DESC`,
    resqSql.params
  );
  const rescueTypes = resqTypeRows.map((t) => ({
    type: t.emergency_type,
    count: Number(t.count || 0),
    percentage: totalRescues > 0 ? Number(((Number(t.count || 0) / totalRescues) * 100).toFixed(1)) : 0,
  }));

  const [[rescuedPeopleRow]] = await pool.query(
    `SELECT COALESCE(SUM(ro.total_rescued), 0)::int AS total_rescued,
            COUNT(DISTINCT ro.rescue_id)::int AS outcome_sample_size
     FROM rescue_outcomes ro
     JOIN rescue_requests rq ON rq.id = ro.rescue_id
     WHERE ${resqSql.clause}
       AND ro.total_rescued IS NOT NULL
       AND ro.total_rescued >= 0`,
    resqSql.params
  );

  // 4. Active Dispatches (deduplicated per report/rescue)
  const [[incActiveDispatchRow]] = await pool.query(
    `SELECT COUNT(DISTINCT ia.report_id)::int AS active_count
     FROM incident_assignments ia
     JOIN reports r ON r.id = ia.report_id
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${incSql.clause}
       AND ia.assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene')`,
    incSql.params
  );
  const [[resqActiveDispatchRow]] = await pool.query(
    `SELECT COUNT(DISTINCT ra.rescue_id)::int AS active_count
     FROM rescue_assignments ra
     JOIN rescue_requests rq ON rq.id = ra.rescue_id
     WHERE ${resqSql.clause}
       AND ra.assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene')`,
    resqSql.params
  );
  const activeDispatches =
    Number((incActiveDispatchRow && incActiveDispatchRow.active_count) || 0) +
    Number((resqActiveDispatchRow && resqActiveDispatchRow.active_count) || 0);

  // 5. Daily, Weekly, Monthly Trends + Previous Period Comparison
  const [incDailyRows] = await pool.query(
    `SELECT TO_CHAR(r.created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date_key,
            COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${incSql.clause}
     GROUP BY date_key
     ORDER BY date_key ASC`,
    incSql.params
  );
  const dailyTrends = fillDailySeries(incDailyRows, incSql.dateFilter.startYmd, incSql.dateFilter.endYmd);

  const [resqDailyRows] = await pool.query(
    `SELECT TO_CHAR(rq.created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date_key,
            COUNT(DISTINCT rq.id)::int AS count
     FROM rescue_requests rq
     WHERE ${resqSql.clause}
     GROUP BY date_key
     ORDER BY date_key ASC`,
    resqSql.params
  );
  const rescueDailyTrends = fillDailySeries(resqDailyRows, resqSql.dateFilter.startYmd, resqSql.dateFilter.endYmd);

  const [incWeeklyRows] = await pool.query(
    `SELECT TO_CHAR(DATE_TRUNC('week', r.created_at AT TIME ZONE 'Asia/Manila'), 'YYYY-MM-DD') AS week_start,
            COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${incSql.clause}
     GROUP BY week_start
     ORDER BY week_start ASC`,
    incSql.params
  );

  const [incMonthlyRows] = await pool.query(
    `SELECT TO_CHAR(r.created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS month_label,
            COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${incSql.clause}
     GROUP BY month_label
     ORDER BY month_label ASC`,
    incSql.params
  );

  const [resqMonthlyRows] = await pool.query(
    `SELECT TO_CHAR(rq.created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS month_label,
            COUNT(DISTINCT rq.id)::int AS count
     FROM rescue_requests rq
     WHERE ${resqSql.clause}
     GROUP BY month_label
     ORDER BY month_label ASC`,
    resqSql.params
  );

  let previousPeriodComparison = null;
  if (incSql.dateFilter.prevClause) {
    const prevIncSql = buildIncidentFilterSql(filters, incSql.dateFilter.prevClause, incSql.dateFilter.prevParams);
    const prevResqSql = buildRescueFilterSql(filters, resqSql.dateFilter.prevClause, resqSql.dateFilter.prevParams);
    const [[prevIncRow]] = await pool.query(
      `SELECT COUNT(DISTINCT r.id)::int AS count
       FROM reports r
       LEFT JOIN incident_categories ic ON ic.id = r.category_id
       WHERE ${prevIncSql.clause}`,
      prevIncSql.params
    );
    const [[prevResqRow]] = await pool.query(
      `SELECT COUNT(DISTINCT rq.id)::int AS count
       FROM rescue_requests rq
       WHERE ${prevResqSql.clause}`,
      prevResqSql.params
    );
    previousPeriodComparison = {
      startYmd: incSql.dateFilter.prevStartYmd,
      endYmd: incSql.dateFilter.prevEndYmd,
      incidents: Number((prevIncRow && prevIncRow.count) || 0),
      rescues: Number((prevResqRow && prevResqRow.count) || 0),
    };
  }

  // 6. Top Incident Locations & Rescue Locations & Combined Geographic Areas
  const [incLocRows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(r.address), ''), 'Barangay Bayanan') AS location_name,
            COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${incSql.clause}
     GROUP BY location_name
     ORDER BY count DESC, location_name ASC
     LIMIT 10`,
    incSql.params
  );
  const locations = incLocRows.map((l) => ({
    location_name: l.location_name,
    count: Number(l.count || 0),
    percentage: totalIncidents > 0 ? Number(((Number(l.count || 0) / totalIncidents) * 100).toFixed(1)) : 0,
  }));

  const [resqLocRows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(rq.address), ''), 'Barangay Bayanan') AS location_name,
            COUNT(DISTINCT rq.id)::int AS count
     FROM rescue_requests rq
     WHERE ${resqSql.clause}
     GROUP BY location_name
     ORDER BY count DESC, location_name ASC
     LIMIT 10`,
    resqSql.params
  );
  const rescueLocations = resqLocRows.map((l) => ({
    location_name: l.location_name,
    count: Number(l.count || 0),
    percentage: totalRescues > 0 ? Number(((Number(l.count || 0) / totalRescues) * 100).toFixed(1)) : 0,
  }));

  // 7. Response Performance & Responder Performance (deduplicated latest assignment per operation)
  const [incPerfRows] = await pool.query(
    `SELECT DISTINCT ON (r.id)
            r.id AS op_id,
            'incident' AS op_type,
            r.created_at,
            r.status AS op_status,
            ia.responder_user_id,
            ia.assignment_status,
            ia.assigned_at,
            ia.accepted_at,
            ia.on_scene_at,
            ia.completed_at,
            u.name AS responder_name,
            rp.badge_number,
            COALESCE(NULLIF(TRIM(rp.custom_organization), ''), NULLIF(TRIM(rp.organization), ''), 'Unassigned') AS organization
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     JOIN incident_assignments ia ON ia.report_id = r.id
     LEFT JOIN users u ON u.id = ia.responder_user_id
     LEFT JOIN responder_profiles rp ON rp.user_id = ia.responder_user_id
     WHERE ${incSql.clause}
     ORDER BY r.id, COALESCE(ia.completed_at, ia.on_scene_at, ia.accepted_at, ia.assigned_at) DESC NULLS LAST, ia.id DESC`,
    incSql.params
  );

  const [resqPerfRows] = await pool.query(
    `SELECT DISTINCT ON (rq.id)
            rq.id AS op_id,
            'rescue' AS op_type,
            rq.created_at,
            rq.status AS op_status,
            ra.responder_user_id,
            ra.assignment_status,
            ra.assigned_at,
            ra.accepted_at,
            ra.on_scene_at,
            ra.completed_at,
            u.name AS responder_name,
            rp.badge_number,
            COALESCE(NULLIF(TRIM(rp.custom_organization), ''), NULLIF(TRIM(rp.organization), ''), 'Unassigned') AS organization
     FROM rescue_requests rq
     JOIN rescue_assignments ra ON ra.rescue_id = rq.id
     LEFT JOIN users u ON u.id = ra.responder_user_id
     LEFT JOIN responder_profiles rp ON rp.user_id = ra.responder_user_id
     WHERE ${resqSql.clause}
     ORDER BY rq.id, COALESCE(ra.completed_at, ra.on_scene_at, ra.accepted_at, ra.assigned_at) DESC NULLS LAST, ra.id DESC`,
    resqSql.params
  );

  const allPerfOps = [...incPerfRows, ...resqPerfRows];
  const acceptanceVals = [];
  const travelVals = [];
  const responseVals = [];
  const durationVals = [];
  let perfCompletedCount = 0;
  let perfInProgressCount = 0;

  const responderMap = new Map();
  const orgMap = new Map();

  for (const row of allPerfOps) {
    const aStatus = String(row.assignment_status || '');
    if (aStatus === 'Completed') perfCompletedCount++;
    else if (['Assigned', 'Accepted', 'En Route', 'On Scene'].includes(aStatus)) perfInProgressCount++;

    const accMin = validDurationMinutes(row.created_at, row.accepted_at);
    const trvMin = validDurationMinutes(row.accepted_at, row.on_scene_at);
    const rspMin = validDurationMinutes(row.created_at, row.on_scene_at);
    const durMin = validDurationMinutes(row.accepted_at, row.completed_at);

    if (accMin !== null) acceptanceVals.push(accMin);
    if (trvMin !== null) travelVals.push(trvMin);
    if (rspMin !== null) responseVals.push(rspMin);
    if (durMin !== null) durationVals.push(durMin);

    if (row.responder_user_id) {
      const rKey = Number(row.responder_user_id);
      if (!responderMap.has(rKey)) {
        responderMap.set(rKey, {
          responderId: rKey,
          name: row.responder_name || `Responder #${rKey}`,
          badgeNumber: row.badge_number || null,
          organization: row.organization || 'Unassigned',
          acceptedCount: 0,
          completedCount: 0,
          activeAssignments: 0,
          acceptanceSamples: [],
          arrivalSamples: [],
        });
      }
      const rEntry = responderMap.get(rKey);
      if (row.accepted_at || ['Accepted', 'En Route', 'On Scene', 'Completed'].includes(aStatus)) {
        rEntry.acceptedCount++;
      }
      if (aStatus === 'Completed') rEntry.completedCount++;
      if (['Assigned', 'Accepted', 'En Route', 'On Scene'].includes(aStatus)) rEntry.activeAssignments++;
      if (accMin !== null) rEntry.acceptanceSamples.push(accMin);
      if (trvMin !== null) rEntry.arrivalSamples.push(trvMin);

      const oKey = row.organization || 'Unassigned';
      if (!orgMap.has(oKey)) {
        orgMap.set(oKey, {
          organization: oKey,
          responderIds: new Set(),
          acceptedCount: 0,
          completedCount: 0,
          activeAssignments: 0,
          responseSamples: [],
        });
      }
      const oEntry = orgMap.get(oKey);
      oEntry.responderIds.add(rKey);
      if (row.accepted_at || ['Accepted', 'En Route', 'On Scene', 'Completed'].includes(aStatus)) oEntry.acceptedCount++;
      if (aStatus === 'Completed') oEntry.completedCount++;
      if (['Assigned', 'Accepted', 'En Route', 'On Scene'].includes(aStatus)) oEntry.activeAssignments++;
      if (rspMin !== null) oEntry.responseSamples.push(rspMin);
    }
  }

  const accStats = computeStatsFromMinutes(acceptanceVals);
  const trvStats = computeStatsFromMinutes(travelVals);
  const rspStats = computeStatsFromMinutes(responseVals);
  const durStats = computeStatsFromMinutes(durationVals);

  const responderPerformance = Array.from(responderMap.values())
    .map((r) => {
      const acc = computeStatsFromMinutes(r.acceptanceSamples);
      const arr = computeStatsFromMinutes(r.arrivalSamples);
      return {
        responderId: r.responderId,
        name: r.name,
        badgeNumber: r.badgeNumber,
        organization: r.organization,
        acceptedCount: r.acceptedCount,
        completedCount: r.completedCount,
        activeAssignments: r.activeAssignments,
        avgAcceptanceMinutes: acc.avgMinutes,
        acceptanceSampleSize: acc.sampleSize,
        avgArrivalMinutes: arr.avgMinutes,
        arrivalSampleSize: arr.sampleSize,
      };
    })
    .sort((a, b) => b.completedCount - a.completedCount || b.acceptedCount - a.acceptedCount || a.name.localeCompare(b.name));

  const organizationPerformance = Array.from(orgMap.values())
    .map((o) => {
      const rsp = computeStatsFromMinutes(o.responseSamples);
      return {
        organization: o.organization,
        responderCount: o.responderIds.size,
        acceptedCount: o.acceptedCount,
        completedCount: o.completedCount,
        activeAssignments: o.activeAssignments,
        avgResponseMinutes: rsp.avgMinutes,
        responseSampleSize: rsp.sampleSize,
      };
    })
    .sort((a, b) => b.completedCount - a.completedCount || b.acceptedCount - a.acceptedCount);

  // 8. Geographic Analytics (genuine coordinates only, no Resident PII on rescue points)
  const [incGeoRows] = await pool.query(
    `SELECT r.id, r.reference_number,
            COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, 'Other Hazard') AS category,
            r.status, COALESCE(NULLIF(TRIM(r.address), ''), 'Barangay Bayanan') AS address,
            r.latitude, r.longitude, r.created_at
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${incSql.clause}
       AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL
     ORDER BY r.created_at DESC
     LIMIT 500`,
    incSql.params
  );
  const incidentPoints = incGeoRows
    .map((p) => ({
      id: p.id,
      referenceNumber: p.reference_number,
      category: normalizeCanonicalDisasterCategory(p.category),
      status: p.status,
      address: p.address,
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      insideBoundary: isPointInsideBayanan(Number(p.latitude), Number(p.longitude)),
      createdAt: p.created_at,
    }))
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

  const [resqGeoRows] = await pool.query(
    `SELECT rq.id, rq.reference_number,
            COALESCE(NULLIF(TRIM(rq.emergency_type), ''), 'Unspecified') AS emergency_type,
            rq.status, COALESCE(NULLIF(TRIM(rq.address), ''), 'Barangay Bayanan') AS address,
            rq.latitude, rq.longitude, rq.created_at
     FROM rescue_requests rq
     WHERE ${resqSql.clause}
       AND rq.latitude IS NOT NULL AND rq.longitude IS NOT NULL
     ORDER BY rq.created_at DESC
     LIMIT 500`,
    resqSql.params
  );
  const rescuePoints = resqGeoRows
    .map((p) => ({
      id: p.id,
      referenceNumber: p.reference_number,
      emergencyType: p.emergency_type,
      status: p.status,
      address: p.address,
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      insideBoundary: isPointInsideBayanan(Number(p.latitude), Number(p.longitude)),
      createdAt: p.created_at,
    }))
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

  const areaMap = new Map();
  const [incAreaCatRows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(r.address), ''), 'Barangay Bayanan') AS area_name,
            COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, 'Other Hazard') AS raw_cat,
            COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${incSql.clause}
     GROUP BY area_name, raw_cat`,
    incSql.params
  );
  for (const row of incAreaCatRows) {
    const area = row.area_name;
    const cat = normalizeCanonicalDisasterCategory(row.raw_cat);
    const cnt = Number(row.count || 0);
    if (!areaMap.has(area)) {
      areaMap.set(area, { locationName: area, incidentCount: 0, rescueCount: 0, catCounts: new Map() });
    }
    const entry = areaMap.get(area);
    entry.incidentCount += cnt;
    entry.catCounts.set(cat, (entry.catCounts.get(cat) || 0) + cnt);
  }
  for (const row of resqLocRows) {
    const area = row.location_name;
    const cnt = Number(row.count || 0);
    if (!areaMap.has(area)) {
      areaMap.set(area, { locationName: area, incidentCount: 0, rescueCount: 0, catCounts: new Map() });
    }
    areaMap.get(area).rescueCount += cnt;
  }
  const topAreas = Array.from(areaMap.values())
    .map((a) => {
      let topCategory = '—';
      let topCatCount = 0;
      for (const [cName, cVal] of a.catCounts.entries()) {
        if (cVal > topCatCount) {
          topCatCount = cVal;
          topCategory = cName;
        }
      }
      const totalCount = a.incidentCount + a.rescueCount;
      return {
        locationName: a.locationName,
        incidentCount: a.incidentCount,
        rescueCount: a.rescueCount,
        totalCount,
        topCategory,
        isRepeated: totalCount >= 2,
      };
    })
    .sort((a, b) => b.totalCount - a.totalCount || a.locationName.localeCompare(b.locationName))
    .slice(0, 12);

  // 9. Emergency Communication Analytics (Broadcasts & Notification Read Tracking)
  const bcastDateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'eb.broadcasted_at');
  let communicationAnalytics = {
    totalBroadcasts: 0,
    activeBroadcasts: 0,
    expiredBroadcasts: 0,
    totalDeliveries: 0,
    trackedNotifications: 0,
    readCount: 0,
    unreadCount: 0,
    byCategory: [],
    byUrgency: [],
    byTargetAudience: [],
  };
  try {
    const [[bcastSummary]] = await pool.query(
      `SELECT COUNT(*)::int AS total_broadcasts,
              COUNT(CASE WHEN eb.is_active = TRUE AND LOWER(COALESCE(eb.status, 'active')) = 'active' AND (eb.expires_at IS NULL OR eb.expires_at > NOW()) THEN 1 END)::int AS active_broadcasts,
              COUNT(CASE WHEN eb.is_active = FALSE OR LOWER(COALESCE(eb.status, '')) IN ('expired', 'cancelled') OR (eb.expires_at IS NOT NULL AND eb.expires_at <= NOW()) THEN 1 END)::int AS expired_broadcasts,
              COALESCE(SUM(COALESCE(eb.recipients_count, 0)), 0)::int AS total_deliveries
       FROM emergency_broadcast_logs eb
       WHERE ${bcastDateFilter.clause}`,
      bcastDateFilter.params
    );
    const [bCatRows] = await pool.query(
      `SELECT COALESCE(bc.name, eb.advisory_type, 'General Advisory') AS label, COUNT(*)::int AS count
       FROM emergency_broadcast_logs eb
       LEFT JOIN broadcast_categories bc ON bc.id = eb.category_id
       WHERE ${bcastDateFilter.clause}
       GROUP BY label
       ORDER BY count DESC`,
      bcastDateFilter.params
    );
    const [bUrgRows] = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(eb.urgency_level), ''), NULLIF(TRIM(eb.severity), ''), 'Standard') AS label, COUNT(*)::int AS count
       FROM emergency_broadcast_logs eb
       WHERE ${bcastDateFilter.clause}
       GROUP BY label
       ORDER BY count DESC`,
      bcastDateFilter.params
    );
    const [bScopeRows] = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(eb.target_scope), ''), 'All Residents') AS label, COUNT(*)::int AS count
       FROM emergency_broadcast_logs eb
       WHERE ${bcastDateFilter.clause}
       GROUP BY label
       ORDER BY count DESC`,
      bcastDateFilter.params
    );

    const notifDateFilter = buildDateFilterClause(filters.period, filters.from, filters.to, 'n.created_at');
    const [[nrRow]] = await pool.query(
      `SELECT COUNT(nr.id)::int AS tracked_recipients,
              COUNT(CASE WHEN nr.is_read = TRUE THEN 1 END)::int AS read_count,
              COUNT(CASE WHEN nr.is_read = FALSE OR nr.is_read IS NULL THEN 1 END)::int AS unread_count
       FROM notification_recipients nr
       JOIN notifications n ON n.id = nr.notification_id
       WHERE ${notifDateFilter.clause}`,
      notifDateFilter.params
    );

    communicationAnalytics = {
      totalBroadcasts: Number((bcastSummary && bcastSummary.total_broadcasts) || 0),
      activeBroadcasts: Number((bcastSummary && bcastSummary.active_broadcasts) || 0),
      expiredBroadcasts: Number((bcastSummary && bcastSummary.expired_broadcasts) || 0),
      totalDeliveries: Number((bcastSummary && bcastSummary.total_deliveries) || 0),
      trackedNotifications: Number((nrRow && nrRow.tracked_recipients) || 0),
      readCount: Number((nrRow && nrRow.read_count) || 0),
      unreadCount: Number((nrRow && nrRow.unread_count) || 0),
      byCategory: bCatRows.map((r) => ({ label: r.label, count: Number(r.count || 0) })),
      byUrgency: bUrgRows.map((r) => ({ label: r.label, count: Number(r.count || 0) })),
      byTargetAudience: bScopeRows.map((r) => ({ label: r.label, count: Number(r.count || 0) })),
    };
  } catch (commErr) {
    console.warn('[Analytics] Communication analytics partial fallback:', commErr.message);
  }

  // 10. Activity Heatmap (Asia/Manila day of week 0..6 x hour 0..23)
  const [incHeatRows] = await pool.query(
    `SELECT EXTRACT(DOW FROM r.created_at AT TIME ZONE 'Asia/Manila')::int AS dow,
            EXTRACT(HOUR FROM r.created_at AT TIME ZONE 'Asia/Manila')::int AS hour,
            COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE ${incSql.clause}
     GROUP BY dow, hour`,
    incSql.params
  );
  const [resqHeatRows] = await pool.query(
    `SELECT EXTRACT(DOW FROM rq.created_at AT TIME ZONE 'Asia/Manila')::int AS dow,
            EXTRACT(HOUR FROM rq.created_at AT TIME ZONE 'Asia/Manila')::int AS hour,
            COUNT(DISTINCT rq.id)::int AS count
     FROM rescue_requests rq
     WHERE ${resqSql.clause}
     GROUP BY dow, hour`,
    resqSql.params
  );

  const linkedCount = Number((incSummaryRow && incSummaryRow.linked_rescue_incidents) || 0);
  const totalOperations = Math.max(0, totalIncidents + totalRescues - linkedCount);
  const completedOperations =
    Number((incSummaryRow && incSummaryRow.completed_incidents) || 0) +
    Number((resqSummaryRow && resqSummaryRow.completed_rescues) || 0);
  const pendingReports = Number((incSummaryRow && incSummaryRow.pending_reports) || 0);
  const unclaimedRequests = Number((resqSummaryRow && resqSummaryRow.unclaimed_requests) || 0);

  return {
    period: filters.period,
    timezone: 'Asia/Manila',
    appliedRange: {
      period: filters.period,
      startYmd: incSql.dateFilter.startYmd,
      endYmd: incSql.dateFilter.endYmd,
    },
    filterOptions: {
      categories: CANONICAL_DISASTER_CATEGORIES.map((c) => c.name),
      rescueTypes: rescueTypeOptRows.map((r) => r.val).filter(Boolean),
      responders: responderOptRows.map((r) => ({
        id: r.id,
        name: r.name,
        badgeNumber: r.badge_number || null,
        organization: r.org || 'Unassigned',
      })),
      organizations: Array.from(orgSet).sort(),
    },
    summary: {
      totalReports: totalIncidents,
      totalIncidents,
      totalRescues,
      totalEvents: totalOperations,
      totalOperations,
      activeAssignments: activeDispatches,
      activeDispatches,
      completedOperations,
      pendingReports,
      unclaimedRequests,
      avgResponseTimeMinutes: rspStats.avgMinutes,
      avgResponseSampleSize: rspStats.sampleSize,
    },
    categories: categoryDistribution.categories,
    categoryDistribution,
    statuses,
    locations,
    dailyTrends,
    weeklyTrends: incWeeklyRows.map((w) => ({ weekStart: w.week_start, count: Number(w.count || 0) })),
    monthlyTrends: incMonthlyRows.map((m) => ({ month_label: m.month_label, count: Number(m.count || 0) })),
    previousPeriodComparison,
    rescueAnalytics: {
      totalRescues,
      byDay: rescueDailyTrends,
      byMonth: resqMonthlyRows.map((m) => ({ monthLabel: m.month_label, count: Number(m.count || 0) })),
      statusDistribution: rescueStatuses,
      byLocation: rescueLocations,
      byType: rescueTypes,
      completedVsCancelled: {
        completed: Number((resqSummaryRow && resqSummaryRow.completed_rescues) || 0),
        cancelled: Number((resqSummaryRow && resqSummaryRow.cancelled_rescues) || 0),
        pendingUnclaimed: unclaimedRequests,
        acceptedOnScene: Number((resqSummaryRow && resqSummaryRow.accepted_on_scene) || 0),
      },
      totalPeopleRescued: Number((rescuedPeopleRow && rescuedPeopleRow.total_rescued) || 0),
      peopleRescuedSampleSize: Number((rescuedPeopleRow && rescuedPeopleRow.outcome_sample_size) || 0),
    },
    responsePerformance: {
      avgAcceptanceMinutes: accStats.avgMinutes,
      acceptanceSampleSize: accStats.sampleSize,
      avgTravelMinutes: trvStats.avgMinutes,
      travelSampleSize: trvStats.sampleSize,
      avgResponseMinutes: rspStats.avgMinutes,
      responseSampleSize: rspStats.sampleSize,
      avgDurationMinutes: durStats.avgMinutes,
      durationSampleSize: durStats.sampleSize,
      fastestResponseMinutes: rspStats.minMinutes,
      longestResponseMinutes: rspStats.maxMinutes,
      completedOperations: perfCompletedCount,
      inProgressOperations: perfInProgressCount,
    },
    responderPerformance,
    organizationPerformance,
    geographicAnalytics: {
      incidentPoints,
      rescuePoints,
      topAreas,
    },
    communicationAnalytics,
    activityHeatmap: {
      incidentHeatmap: incHeatRows.map((h) => ({ dow: Number(h.dow), hour: Number(h.hour), count: Number(h.count || 0) })),
      rescueHeatmap: resqHeatRows.map((h) => ({ dow: Number(h.dow), hour: Number(h.hour), count: Number(h.count || 0) })),
    },
  };
}

async function getMonthlyIncidentsByCategoryWithComparison(query = {}) {
  const manilaNow = getManilaDateParts(new Date());
  const requestedYear = Number(query.year);
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100
    ? requestedYear
    : manilaNow.year;

  const [yearRows] = await pool.query(
    `SELECT DISTINCT EXTRACT(YEAR FROM created_at AT TIME ZONE 'Asia/Manila')::int AS yr
     FROM reports
     ORDER BY yr DESC`
  );
  const availableYearsSet = new Set(yearRows.map((r) => Number(r.yr)).filter(Number.isFinite));
  availableYearsSet.add(manilaNow.year);
  availableYearsSet.add(year);
  const availableYears = Array.from(availableYearsSet).sort((a, b) => b - a);

  const categoryOrder = CANONICAL_DISASTER_CATEGORIES.map((c) => c.name);
  const seenCats = new Set(categoryOrder);

  const [monthlyRows] = await pool.query(
    `SELECT EXTRACT(MONTH FROM r.created_at AT TIME ZONE 'Asia/Manila')::int AS month_num,
            COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, 'Other Hazard') AS raw_category,
            COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     LEFT JOIN incident_categories ic ON ic.id = r.category_id
     WHERE EXTRACT(YEAR FROM r.created_at AT TIME ZONE 'Asia/Manila')::int = ?
     GROUP BY month_num, COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, 'Other Hazard')
     ORDER BY month_num ASC`,
    [year]
  );

  const [prevMonthlyRows] = await pool.query(
    `SELECT EXTRACT(MONTH FROM r.created_at AT TIME ZONE 'Asia/Manila')::int AS month_num,
            COUNT(DISTINCT r.id)::int AS count
     FROM reports r
     WHERE EXTRACT(YEAR FROM r.created_at AT TIME ZONE 'Asia/Manila')::int = ?
     GROUP BY month_num
     ORDER BY month_num ASC`,
    [year - 1]
  );
  const prevMonthTotals = Array(12).fill(0);
  let previousYearTotal = 0;
  prevMonthlyRows.forEach((r) => {
    const idx = Number(r.month_num) - 1;
    const cnt = Number(r.count || 0);
    if (idx >= 0 && idx < 12) {
      prevMonthTotals[idx] = cnt;
      previousYearTotal += cnt;
    }
  });

  const monthMaps = Array.from({ length: 12 }, () => new Map());
  monthlyRows.forEach((row) => {
    const mIdx = Number(row.month_num) - 1;
    const count = Number(row.count || 0);
    if (mIdx < 0 || mIdx >= 12 || count <= 0) return;
    const cat = normalizeCanonicalDisasterCategory(row.raw_category) || String(row.raw_category || 'Other Hazard').trim();
    if (!seenCats.has(cat)) {
      seenCats.add(cat);
      categoryOrder.push(cat);
    }
    monthMaps[mIdx].set(cat, (monthMaps[mIdx].get(cat) || 0) + count);
  });

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let totalYearReports = 0;
  const months = MONTH_NAMES.map((fullName, idx) => {
    const map = monthMaps[idx];
    let total = 0;
    const segments = categoryOrder.map((cat) => {
      const count = map.get(cat) || 0;
      total += count;
      return { category: cat, count };
    });
    totalYearReports += total;
    return {
      monthIndex: idx + 1,
      monthLabel: MONTH_SHORT[idx],
      monthFullName: fullName,
      total,
      previousYearTotal: prevMonthTotals[idx],
      segments,
    };
  });

  return {
    year,
    previousYear: year - 1,
    previousYearTotal,
    availableYears,
    categories: categoryOrder,
    months,
    totalYearReports,
  };
}

async function getAnalyticsDrilldown(query = {}) {
  const filters = parseFilters(query);
  const recordType = String(query.recordType || 'all').toLowerCase();
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(5, parseInt(query.limit, 10) || 15));
  const dow = query.dow !== undefined && query.dow !== '' ? Number(query.dow) : null;
  const hour = query.hour !== undefined && query.hour !== '' ? Number(query.hour) : null;
  const extraFilter = String(query.extraFilter || '').trim().toLowerCase();

  const records = [];

  if (recordType === 'all' || recordType === 'incident') {
    const incSql = buildIncidentFilterSql(filters);
    const clauses = [incSql.clause];
    const params = [...incSql.params];
    if (Number.isInteger(dow) && dow >= 0 && dow <= 6) {
      clauses.push(`EXTRACT(DOW FROM r.created_at AT TIME ZONE 'Asia/Manila')::int = ?`);
      params.push(dow);
    }
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      clauses.push(`EXTRACT(HOUR FROM r.created_at AT TIME ZONE 'Asia/Manila')::int = ?`);
      params.push(hour);
    }
    if (extraFilter === 'active_dispatch') {
      clauses.push(`EXISTS (SELECT 1 FROM incident_assignments ia WHERE ia.report_id = r.id AND ia.assignment_status IN ('Assigned','Accepted','En Route','On Scene'))`);
    } else if (extraFilter === 'completed') {
      clauses.push(`LOWER(r.status) IN ('resolved', 'completed', 'closed')`);
    }

    const [incRows] = await pool.query(
      `SELECT DISTINCT ON (r.id)
              r.id, r.reference_number, 'incident' AS record_type,
              COALESCE(NULLIF(TRIM(r.incident_type), ''), ic.name, 'Other Hazard') AS category,
              r.status, COALESCE(NULLIF(TRIM(r.address), ''), 'Barangay Bayanan') AS location,
              r.created_at,
              u.name AS responder_name
       FROM reports r
       LEFT JOIN incident_categories ic ON ic.id = r.category_id
       LEFT JOIN incident_assignments ia ON ia.report_id = r.id
       LEFT JOIN users u ON u.id = ia.responder_user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY r.id, r.created_at DESC`,
      params
    );
    incRows.forEach((r) => {
      records.push({
        id: r.id,
        referenceNumber: r.reference_number || `INC-${r.id}`,
        recordType: 'incident',
        category: normalizeCanonicalDisasterCategory(r.category),
        status: r.status,
        location: r.location,
        responderName: r.responder_name || 'Unassigned',
        createdAt: r.created_at,
      });
    });
  }

  if (recordType === 'all' || recordType === 'rescue') {
    const resqSql = buildRescueFilterSql(filters);
    const clauses = [resqSql.clause];
    const params = [...resqSql.params];
    if (Number.isInteger(dow) && dow >= 0 && dow <= 6) {
      clauses.push(`EXTRACT(DOW FROM rq.created_at AT TIME ZONE 'Asia/Manila')::int = ?`);
      params.push(dow);
    }
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      clauses.push(`EXTRACT(HOUR FROM rq.created_at AT TIME ZONE 'Asia/Manila')::int = ?`);
      params.push(hour);
    }
    if (extraFilter === 'active_dispatch') {
      clauses.push(`EXISTS (SELECT 1 FROM rescue_assignments ra WHERE ra.rescue_id = rq.id AND ra.assignment_status IN ('Assigned','Accepted','En Route','On Scene'))`);
    } else if (extraFilter === 'completed') {
      clauses.push(`LOWER(rq.status) IN ('resolved', 'completed')`);
    } else if (extraFilter === 'unclaimed') {
      clauses.push(`LOWER(rq.status) IN ('pending', 'pending dispatch', 'unclaimed', 'open') AND NOT EXISTS (SELECT 1 FROM rescue_assignments ra WHERE ra.rescue_id = rq.id AND ra.assignment_status IN ('Assigned','Accepted','En Route','On Scene','Completed'))`);
    }

    const [resqRows] = await pool.query(
      `SELECT DISTINCT ON (rq.id)
              rq.id, rq.reference_number, 'rescue' AS record_type,
              COALESCE(NULLIF(TRIM(rq.emergency_type), ''), 'Rescue Request') AS category,
              rq.status, COALESCE(NULLIF(TRIM(rq.address), ''), 'Barangay Bayanan') AS location,
              rq.created_at,
              u.name AS responder_name
       FROM rescue_requests rq
       LEFT JOIN rescue_assignments ra ON ra.rescue_id = rq.id
       LEFT JOIN users u ON u.id = ra.responder_user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY rq.id, rq.created_at DESC`,
      params
    );
    resqRows.forEach((r) => {
      records.push({
        id: r.id,
        referenceNumber: r.reference_number || `RSC-${r.id}`,
        recordType: 'rescue',
        category: r.category,
        status: r.status,
        location: r.location,
        responderName: r.responder_name || 'Unassigned',
        createdAt: r.created_at,
      });
    });
  }

  records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const total = records.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * limit;

  return {
    total,
    page: safePage,
    limit,
    totalPages,
    records: records.slice(startIdx, startIdx + limit),
  };
}

module.exports = {
  getManilaDateParts,
  addDaysYmd,
  buildDateFilterClause,
  normalizeCanonicalDisasterCategory,
  getComprehensiveAnalytics,
  getMonthlyIncidentsByCategoryWithComparison,
  getAnalyticsDrilldown,
};
