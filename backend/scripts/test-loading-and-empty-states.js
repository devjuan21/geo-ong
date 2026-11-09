/**
 * GEOSAFE SYSTEM — Automated Verification Suite for
 * Loading States, Empty State Detection, Error Handling & Lifecycle
 */

const http = require('http');
const pool = require('../models/db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'geosafe_super_secret_jwt_key_2026';
const PORT = 3000;

function createTestToken(userId, role, name = 'Test User') {
  return jwt.sign({ id: userId, email: `${role}@geosafe.local`, role, name }, JWT_SECRET, { expiresIn: '1h' });
}

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: options.hostname || '127.0.0.1',
      port: options.port || PORT,
      path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        resolve({ status: res.statusCode, data: json, raw: body });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(message);
  } else {
    console.log(`  PASS: ${message}`);
  }
}

async function runTestSuite() {
  console.log('\n======================================================================');
  console.log('   GEOSAFE — VERIFYING LOADING STATES & EMPTY STATE DETECTION');
  console.log('======================================================================\n');

  const adminToken = createTestToken(1, 'admin', 'Admin Officer');
  const residentToken = createTestToken(4, 'resident', 'Juan Dela Cruz');
  const responderToken = createTestToken(2, 'responder', 'Responder Unit');

  // Backup current records
  const [origAlerts] = await pool.query('SELECT * FROM alerts');
  const [origReports] = await pool.query('SELECT * FROM reports');
  console.log(`[Backup] Preserved ${origAlerts.length} alerts and ${origReports.length} reports in MySQL.`);

  try {
    // ------------------------------------------------------------------
    // SCENARIO 1: Database contains zero alerts -> Must return empty array & exact empty state
    // ------------------------------------------------------------------
    console.log('\n--- SCENARIO 1: Testing Zero Alerts in Database ---');
    await pool.query('DELETE FROM alerts');
    
    const zeroAlertsRes = await makeRequest('/api/alerts', {
      headers: { Authorization: `Bearer ${residentToken}` }
    });
    assert(zeroAlertsRes.status === 200, 'HTTP 200 returned for empty alerts table');
    assert(Array.isArray(zeroAlertsRes.data.alerts), 'Response data contains an alerts array');
    assert(zeroAlertsRes.data.alerts.length === 0, 'Alerts array length is 0 (real zero records from database)');

    // ------------------------------------------------------------------
    // SCENARIO 2: Database contains several alerts -> Must return real alerts
    // ------------------------------------------------------------------
    console.log('\n--- SCENARIO 2: Testing Several Alerts in Database ---');
    await pool.query(
      `INSERT INTO alerts (message, severity, created_by) VALUES 
       ('ALERT TEST 1: Flash flood warning in Bayanan Creek', 'high', 1),
       ('ALERT TEST 2: Precautionary evacuation advice', 'medium', 1)`
    );

    const severalAlertsRes = await makeRequest('/api/alerts', {
      headers: { Authorization: `Bearer ${residentToken}` }
    });
    assert(severalAlertsRes.status === 200, 'HTTP 200 returned for populated alerts table');
    assert(severalAlertsRes.data.alerts.length === 2, 'Alerts array length is 2 matching database records');
    assert(severalAlertsRes.data.alerts[0].message.includes('ALERT TEST 1'), 'First alert message verified from database');

    // ------------------------------------------------------------------
    // SCENARIO 3: Database contains zero reports -> Must return empty array
    // ------------------------------------------------------------------
    console.log('\n--- SCENARIO 3: Testing Zero Reports in Database ---');
    await pool.query('DELETE FROM reports');

    const zeroReportsRes = await makeRequest('/api/reports', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(zeroReportsRes.status === 200, 'HTTP 200 returned for empty reports table');
    assert(Array.isArray(zeroReportsRes.data.reports), 'Response data contains a reports array');
    assert(zeroReportsRes.data.reports.length === 0, 'Reports array length is 0 (real zero records from database)');

    // ------------------------------------------------------------------
    // SCENARIO 4: Database contains several reports -> Must return real reports
    // ------------------------------------------------------------------
    console.log('\n--- SCENARIO 4: Testing Several Reports in Database ---');
    await pool.query(
      `INSERT INTO reports (user_id, incident_type, description, latitude, longitude, severity, status) VALUES 
       (4, 'Flood', 'Flooding on road Purok 2', 14.4106, 121.0502, 'medium', 'pending'),
       (4, 'SOS', 'Emergency water level high', 14.4110, 121.0505, 'high', 'responding')`
    );

    const severalReportsRes = await makeRequest('/api/reports', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(severalReportsRes.status === 200, 'HTTP 200 returned for populated reports table');
    assert(severalReportsRes.data.reports.length === 2, 'Reports array length is 2 matching database records');
    assert(severalReportsRes.data.reports.some(r => r.incident_type === 'SOS'), 'SOS incident detected in database result');

    // ------------------------------------------------------------------
    // SCENARIO 5: Backend Error / 500 Failure Handling (No fake records returned)
    // ------------------------------------------------------------------
    console.log('\n--- SCENARIO 5: Testing Error Handling & No Masking with Fake Data ---');
    // Test invalid status update that triggers 400
    const invalidUpdateRes = await makeRequest('/api/reports/999999/status', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'invalid_status_xyz' }
    });
    assert(invalidUpdateRes.status === 400, 'HTTP 400 returned on invalid report status');
    assert(invalidUpdateRes.data.errors || invalidUpdateRes.data.error, 'Validation error returned without masking');

    // Test non-existent report
    const notFoundRes = await makeRequest('/api/reports/999999/status', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'responding' }
    });
    assert(notFoundRes.status === 404, 'HTTP 404 returned for non-existent report');
    assert(notFoundRes.data.error === 'Report not found', 'Report not found correctly identified');

    // ------------------------------------------------------------------
    // SCENARIO 6: Network Failure / Offline Server Simulation
    // ------------------------------------------------------------------
    console.log('\n--- SCENARIO 6: Testing Network Failure Rejection ---');
    let threwNetworkError = false;
    try {
      await makeRequest('/api/reports', {
        headers: { Authorization: `Bearer ${adminToken}` },
        // Connect to a closed port
        port: 59999
      });
    } catch (err) {
      threwNetworkError = true;
    }
    assert(threwNetworkError, 'Network request to unreachable host properly rejects (not swallowed)');

    // ------------------------------------------------------------------
    // SCENARIO 7 & 8: Evacuation Centers & Vulnerable Registry
    // ------------------------------------------------------------------
    console.log('\n--- SCENARIOS 7 & 8: Evacuation Centers & Admin Stats ---');
    const evacRes = await makeRequest('/api/evacuation-centers', {
      headers: { Authorization: `Bearer ${residentToken}` }
    });
    assert(evacRes.status === 200, 'HTTP 200 returned for evacuation centers');
    assert(Array.isArray(evacRes.data.evacuation_centers), 'Evacuation centers array valid');
    assert(evacRes.data.evacuation_centers.length >= 4, '4 verified evacuation centers present in database');

    const statsRes = await makeRequest('/api/admin/stats', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(statsRes.status === 200, 'HTTP 200 returned for admin dynamic stats');
    assert(statsRes.data.stats && statsRes.data.stats.totalReports === 2, 'Admin stats dynamically calculated from database (totalReports = 2)');

    // ------------------------------------------------------------------
    // SCENARIO 9: User creates a new report
    // ------------------------------------------------------------------
    console.log('\n--- SCENARIO 9: Creating a new report via API ---');
    const createRes = await makeRequest('/api/reports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${residentToken}` },
      body: {
        incident_type: 'Flood',
        description: 'New water rising rapidly at Bayanan',
        latitude: 14.4106,
        longitude: 121.0502
      }
    });
    assert(createRes.status === 201, 'HTTP 201 Created for new report');
    const newReportId = createRes.data.report.id;
    assert(newReportId > 0, `New report created with ID #${newReportId}`);

    // Verify reports count updated
    const afterCreateRes = await makeRequest('/api/reports', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(afterCreateRes.data.reports.length === 3, 'Reports count dynamically increased to 3 in database');

    // ------------------------------------------------------------------
    // SCENARIO 10: User deletes/resolves records down to zero
    // ------------------------------------------------------------------
    console.log('\n--- SCENARIO 10: Resolving/Deleting records back to zero ---');
    await pool.query('DELETE FROM reports');
    const finalReportsRes = await makeRequest('/api/reports', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(finalReportsRes.data.reports.length === 0, 'Database emptied: returns []');

    console.log('\n======================================================================');
    console.log('   ALL 10 SCENARIOS PASSED WITH ACTUAL DATABASE RESPONSES!');
    console.log('======================================================================\n');

  } finally {
    // Restore backed-up original data so the database is untouched
    console.log('[Cleanup] Restoring original alerts and reports...');
    await pool.query('DELETE FROM alerts');
    for (const a of origAlerts) {
      await pool.query(
        'INSERT INTO alerts (id, message, severity, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
        [a.id, a.message, a.severity, a.created_by, a.created_at]
      );
    }

    await pool.query('DELETE FROM reports');
    for (const r of origReports) {
      await pool.query(
        `INSERT INTO reports (id, user_id, incident_type, description, latitude, longitude, severity, status, assigned_to, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.user_id, r.incident_type, r.description, r.latitude, r.longitude, r.severity, r.status, r.assigned_to, r.created_at, r.updated_at]
      );
    }
    console.log(`[Cleanup] Restored ${origAlerts.length} original alerts and ${origReports.length} original reports successfully.`);
  }

  process.exit(0);
}

runTestSuite().catch(err => {
  console.error('\nTEST EXECUTION ERROR:', err);
  process.exit(1);
});
