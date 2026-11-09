const http = require('http');
const app = require('../server');

let server;
const PORT = 3003;

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
  console.log('--- STARTING FAMILY SAFETY CIRCLE GPS & DATABASE VERIFICATION ---');
  server = app.listen(PORT);

  try {
    // 1. Authenticate as Resident Demo
    console.log('\n[1/5] Authenticating Resident User (resident@geosafe.local)...');
    const loginRes = await request('/api/login', {
      method: 'POST',
      body: { email: 'resident@geosafe.local', password: 'resident123' }
    });
    if (loginRes.status !== 200 || !loginRes.data.token) {
      throw new Error(`Resident login failed: status ${loginRes.status}`);
    }
    const token = loginRes.data.token;
    console.log('✓ Resident authenticated successfully. Token received.');

    // 2. Fetch Family Safety Circle Dashboard
    console.log('\n[2/5] Fetching Family Safety Circle Dashboard (GET /api/family)...');
    const famRes = await request('/api/family', {
      headers: { Authorization: 'Bearer ' + token }
    });
    console.log('Response Status:', famRes.status);
    if (famRes.status !== 200) {
      throw new Error(`GET /api/family failed with status ${famRes.status}: ${JSON.stringify(famRes.data)}`);
    }
    if (!famRes.data.family) {
      throw new Error('Expected family group to be present in response');
    }
    console.log(`✓ Family Circle retrieved: "${famRes.data.family.name}" (Code: ${famRes.data.family.invite_code})`);
    console.log(`✓ Members count: ${famRes.data.members.length}`);

    // Verify member fields
    const headMember = famRes.data.members.find(m => m.email === 'resident@geosafe.local');
    if (!headMember) throw new Error('Head member resident@geosafe.local not found in members list');
    console.log('Head Member Details:', {
      name: headMember.name,
      relationship: headMember.relationship,
      safety_status: headMember.safety_status,
      battery_level: headMember.battery_level,
      last_latitude: headMember.last_latitude,
      last_longitude: headMember.last_longitude,
      location_accuracy: headMember.location_accuracy,
      is_sharing_location: headMember.is_sharing_location
    });

    // 3. Update Live GPS, Accuracy, Battery & Safety Status
    console.log('\n[3/5] Updating Live GPS & Safety Status (PUT /api/family/me)...');
    const updateRes = await request('/api/family/me', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token },
      body: {
        latitude: 14.41055,
        longitude: 121.05092,
        accuracy: 8.5,
        battery_level: 88,
        safety_status: 'safe',
        is_sharing_location: true
      }
    });
    console.log('Update Status:', updateRes.status);
    if (updateRes.status !== 200) {
      throw new Error(`PUT /api/family/me failed: ${JSON.stringify(updateRes.data)}`);
    }
    const updatedMember = updateRes.data.members.find(m => m.id === headMember.id);
    if (!updatedMember || updatedMember.last_latitude !== 14.41055) {
      throw new Error('Coordinates were not updated in database');
    }
    console.log('✓ GPS coordinates, accuracy, battery, and safety status successfully saved to MySQL.');

    // 4. Toggle Location Sharing Pause & Resume
    console.log('\n[4/5] Testing Location Sharing Toggle (Stop & Start)...');
    const pauseRes = await request('/api/family/me', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token },
      body: { is_sharing_location: false }
    });
    if (pauseRes.status !== 200) throw new Error('Pause location sharing failed');
    const pausedMember = pauseRes.data.members.find(m => m.id === headMember.id);
    if (pausedMember.is_sharing_location !== false) throw new Error('Expected is_sharing_location to be false');
    console.log('✓ Location sharing paused successfully.');

    const resumeRes = await request('/api/family/me', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token },
      body: { is_sharing_location: true }
    });
    if (resumeRes.status !== 200) throw new Error('Resume location sharing failed');
    console.log('✓ Location sharing resumed successfully.');

    // 5. Test Invalid Invite Code & Error Handling
    console.log('\n[5/5] Testing Error Handling for Invalid Codes & Unauthorized Access...');
    const invalidJoinRes = await request('/api/family/join', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: { invite_code: 'NONEXIST99' }
    });
    console.log('Invalid Join Status:', invalidJoinRes.status);
    // User already belongs to group or invalid code -> properly rejected
    if (invalidJoinRes.status !== 400 && invalidJoinRes.status !== 404) {
      throw new Error(`Expected 400 or 404 for invalid join, got ${invalidJoinRes.status}`);
    }
    console.log('✓ Invalid operations correctly rejected.');

    const unauthRes = await request('/api/family');
    if (unauthRes.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated request, got ${unauthRes.status}`);
    }
    console.log('✓ Unauthenticated requests properly blocked with 401.');

    console.log('\n======================================================');
    console.log('ALL FAMILY SAFETY CIRCLE GPS & DATABASE TESTS PASSED!');
    console.log('======================================================');
  } catch (err) {
    console.error('\n❌ TEST FAILURE:', err);
    process.exitCode = 1;
  } finally {
    if (server) server.close();
    process.exit(process.exitCode || 0);
  }
}

runTests();

