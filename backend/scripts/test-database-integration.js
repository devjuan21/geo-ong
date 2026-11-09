const http = require('http');
const app = require('../server');

let server;
const PORT = 3001;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data });
          }
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING GEOSAFE DATABASE INTEGRATION VERIFICATION ---');
  server = app.listen(PORT);

  try {
    // 1. Verify Test Accounts Logins
    console.log('\n[1/6] Testing Preserved Test Accounts & Authentication...');
    
    // Admin login
    const adminLogin = await request('/api/login', {
      method: 'POST',
      body: { email: 'admin@geosafe.local', password: 'admin123' }
    });
    console.log('  Admin login status:', adminLogin.status, 'User:', adminLogin.data?.user?.email, 'Role:', adminLogin.data?.user?.role);
    if (adminLogin.status !== 200 || !adminLogin.data.token) throw new Error('Admin login failed');
    const adminToken = adminLogin.data.token;

    // Responder login
    const respLogin = await request('/api/login', {
      method: 'POST',
      body: { email: 'responder@geosafe.local', password: 'responder123' }
    });
    console.log('  Responder login status:', respLogin.status, 'User:', respLogin.data?.user?.email, 'Role:', respLogin.data?.user?.role);
    if (respLogin.status !== 200 || !respLogin.data.token) throw new Error('Responder login failed');
    const respToken = respLogin.data.token;

    // Resident login
    const resLogin = await request('/api/login', {
      method: 'POST',
      body: { email: 'resident@geosafe.local', password: 'resident123' }
    });
    console.log('  Resident login status:', resLogin.status, 'User:', resLogin.data?.user?.email, 'Role:', resLogin.data?.user?.role);
    if (resLogin.status !== 200 || !resLogin.data.token) throw new Error('Resident login failed');
    const resToken = resLogin.data.token;

    // Preserved account: john vee perez
    console.log('  Verifying preserved account juan23@example.com exists in DB...');
    const pool = require('../models/db');
    const [juanRows] = await pool.query('SELECT id, name, email, role, contact_number, address FROM users WHERE email = ?', ['juan23@example.com']);
    console.log('  Preserved user verified:', juanRows[0]);
    if (!juanRows.length) throw new Error('Existing account juan23@example.com was lost!');

    // 2. Test Evacuation Centers API
    console.log('\n[2/6] Testing Evacuation Centers API (/api/evacuation-centers)...');
    const evacRes = await request('/api/evacuation-centers');
    console.log('  GET /api/evacuation-centers status:', evacRes.status);
    console.log('  Centers returned:', evacRes.data?.evacuation_centers?.length);
    evacRes.data?.evacuation_centers?.forEach(c => console.log(`   - ${c.name}: capacity ${c.capacity}, available ${c.available_slots}`));
    if (evacRes.status !== 200 || !evacRes.data?.evacuation_centers?.length) throw new Error('Evac centers failed');

    // 3. Test Hospitals API
    console.log('\n[3/6] Testing Hospitals API (/api/hospitals)...');
    const hospRes = await request('/api/hospitals');
    console.log('  GET /api/hospitals status:', hospRes.status);
    console.log('  Hospitals returned:', hospRes.data?.hospitals?.length);
    hospRes.data?.hospitals?.forEach(h => console.log(`   - ${h.name}: ${h.emergency_contact} (${h.status})`));
    if (hospRes.status !== 200 || !hospRes.data?.hospitals?.length) throw new Error('Hospitals API failed');

    // 4. Test Admin Stats and Vulnerable Residents
    console.log('\n[4/6] Testing Admin Dynamic Stats & Vulnerable Registry...');
    const statsRes = await request('/api/admin/stats', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('  GET /api/admin/stats status:', statsRes.status);
    console.log('  Live Stats from MySQL:', statsRes.data?.stats);
    if (statsRes.status !== 200 || !statsRes.data?.stats) throw new Error('Admin stats failed');

    const vulnRes = await request('/api/admin/vulnerable', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('  GET /api/admin/vulnerable status:', vulnRes.status);
    console.log('  Vulnerable residents found in DB:', vulnRes.data?.vulnerable_residents?.length);
    vulnRes.data?.vulnerable_residents?.forEach(v => console.log(`   - ${v.name}: ${v.safety_status} (Reports: ${v.active_critical_reports})`));

    // 5. Test Live Report Filing and Lifecycle in MySQL
    console.log('\n[5/6] Testing Report Creation and Lifecycle in MySQL...');
    const newReportRes = await request('/api/reports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resToken}` },
      body: {
        incident_type: 'Flood',
        description: 'Rising water level along Bayanan Shoreline Purok 1. Water currently at knee height.',
        latitude: 14.4102,
        longitude: 121.0508
      }
    });
    console.log('  POST /api/reports status:', newReportRes.status, 'Created ID:', newReportRes.data?.report?.id);
    if (newReportRes.status !== 201) throw new Error('Report creation failed');
    const createdReportId = newReportRes.data.report.id;

    // Verify persisted in MySQL reports table
    const [dbReport] = await pool.query('SELECT * FROM reports WHERE id = ?', [createdReportId]);
    console.log('  Direct MySQL verification of report #', createdReportId, ':', dbReport[0]?.incident_type, 'Status:', dbReport[0]?.status);
    if (!dbReport.length) throw new Error('Report was not persisted to MySQL!');

    // Update status to verified then responding then resolved
    console.log('  Updating status to "responding" via PUT /api/reports/:id/status...');
    const updateRes = await request(`/api/reports/${createdReportId}/status`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${respToken}` },
      body: { status: 'responding' }
    });
    console.log('  Status update response:', updateRes.status, 'New status:', updateRes.data?.report?.status);

    const resolveRes = await request(`/api/reports/${createdReportId}/status`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${respToken}` },
      body: { status: 'resolved' }
    });
    console.log('  Resolve report response:', resolveRes.status, 'Final status:', resolveRes.data?.report?.status);

    // 6. Test Alerts API
    console.log('\n[6/6] Testing Alerts Broadcast in MySQL...');
    const newAlertRes = await request('/api/alerts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        message: 'TEST MONITORED WARNING: High tide advisory over Muntinlupa lakeshore.',
        severity: 'high'
      }
    });
    console.log('  POST /api/alerts status:', newAlertRes.status, 'Alert ID:', newAlertRes.data?.alert?.id);
    
    const getAlertsRes = await request('/api/alerts', {
      headers: { Authorization: `Bearer ${resToken}` }
    });
    console.log('  GET /api/alerts status:', getAlertsRes.status, 'Alerts count:', getAlertsRes.data?.alerts?.length);

    console.log('\n--- ALL DATABASE INTEGRATION TESTS PASSED SUCCESSFULLY! ---');
  } catch (err) {
    console.error('\nTEST SUITE FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    server.close();
    process.exit(process.exitCode || 0);
  }
}

runTests();

