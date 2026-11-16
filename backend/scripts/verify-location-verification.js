/**
 * GeoSafe - GPS-Based Resident Location Verification Comprehensive Test Suite
 * Tests all 12 required scenarios against the live Express API & PostgreSQL,
 * and cleans up temporary test records on completion.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const BASE_URL = 'http://localhost:3000';

// Helper to make HTTP requests with cookie tracking
class HttpSession {
  constructor() {
    this.cookies = {};
    this.csrfToken = null;
  }

  getCookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  storeCookies(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.slice(0, eqIdx).trim();
        const val = pair.slice(eqIdx + 1).trim();
        if (val === '' || raw.toLowerCase().includes('max-age=0')) {
          delete this.cookies[key];
        } else {
          this.cookies[key] = val;
        }
      }
    }
  }

  async request(method, urlPath, body = null) {
    const headers = { 'Accept': 'application/json' };
    const cookieStr = this.getCookieHeader();
    if (cookieStr) headers['Cookie'] = cookieStr;
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    if (body !== null) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
    });
    this.storeCookies(res);
    const data = await res.json().catch(() => ({}));
    if (data && data.csrfToken) {
      this.csrfToken = data.csrfToken;
    }
    return { status: res.status, data };
  }
}

async function runTests() {
  console.log('================================================================');
  console.log(' GeoSafe GPS Resident Location Verification (12 Scenarios)');
  console.log('================================================================\n');

  const createdUserIds = [];
  const createdReportIds = [];
  const createdRescueIds = [];

  try {
    const publicClient = new HttpSession();

    // Scenario 1: GPS location reliably inside Barangay Bayanan
    console.log('1. Testing GPS location reliably inside Barangay Bayanan...');
    const s1 = await publicClient.request('POST', '/api/auth/verify-location', {
      latitude: 14.408869,
      longitude: 121.046293,
      accuracy: 15,
    });
    assert.strictEqual(s1.status, 200);
    assert.strictEqual(s1.data.status, 'verified');
    assert.ok(s1.data.verificationToken, 'Expected verificationToken');
    console.log(`  [PASS] Status: ${s1.data.status} | Message: "${s1.data.message}" | Dist: ${s1.data.boundaryDistanceMeters}m`);

    // Scenario 2: GPS location reliably outside Barangay Bayanan
    console.log('\n2. Testing GPS location reliably outside Barangay Bayanan...');
    const s2 = await publicClient.request('POST', '/api/auth/verify-location', {
      latitude: 14.425,
      longitude: 121.046293,
      accuracy: 15,
    });
    assert.strictEqual(s2.status, 200);
    assert.strictEqual(s2.data.status, 'outside_boundary');
    assert.ok(s2.data.verificationToken);
    console.log(`  [PASS] Status: ${s2.data.status} | Message: "${s2.data.message}" | Dist: ${s2.data.boundaryDistanceMeters}m`);

    // Scenario 3: GPS location near the boundary (accuracy overlaps boundary -> pending_review)
    console.log('\n3. Testing GPS location near the boundary (accuracy overlaps boundary)...');
    const s3 = await publicClient.request('POST', '/api/auth/verify-location', {
      latitude: 14.4050,
      longitude: 121.046293,
      accuracy: 35,
    });
    assert.strictEqual(s3.status, 200);
    assert.strictEqual(s3.data.status, 'pending_review');
    console.log(`  [PASS] Status: ${s3.data.status} | Message: "${s3.data.message}" | Dist: ${s3.data.boundaryDistanceMeters}m, Acc: ${s3.data.accuracy}m`);

    // Scenario 4: GPS permission denied
    console.log('\n4. Testing GPS permission denied...');
    const s4 = await publicClient.request('POST', '/api/auth/verify-location', {
      gpsErrorStatus: 'gps_denied',
    });
    assert.strictEqual(s4.status, 200);
    assert.strictEqual(s4.data.status, 'gps_denied');
    console.log(`  [PASS] Status: ${s4.data.status} | Message: "${s4.data.message}"`);

    // Scenario 5: GPS unavailable
    console.log('\n5. Testing GPS unavailable...');
    const s5 = await publicClient.request('POST', '/api/auth/verify-location', {
      gpsErrorStatus: 'gps_unavailable',
    });
    assert.strictEqual(s5.status, 200);
    assert.strictEqual(s5.data.status, 'gps_unavailable');
    console.log(`  [PASS] Status: ${s5.data.status} | Message: "${s5.data.message}"`);

    // Scenario 6: GPS accuracy insufficient (> 100m threshold)
    console.log('\n6. Testing GPS accuracy insufficient (250m > 100m threshold)...');
    const s6 = await publicClient.request('POST', '/api/auth/verify-location', {
      latitude: 14.408869,
      longitude: 121.046293,
      accuracy: 250,
    });
    assert.strictEqual(s6.status, 200);
    assert.strictEqual(s6.data.status, 'retry_required');
    console.log(`  [PASS] Status: ${s6.data.status} | Message: "${s6.data.message}" | Threshold: ${s6.data.accuracyThresholdMeters}m`);

    // Scenario 7: Resident retries location verification (retry_required -> verified -> register)
    console.log('\n7. Testing Resident retries location verification and registers...');
    const retryRes = await publicClient.request('POST', '/api/auth/verify-location', {
      latitude: 14.408869,
      longitude: 121.046293,
      accuracy: 12,
    });
    assert.strictEqual(retryRes.data.status, 'verified');
    const verifiedEmail = `loc.verified.${Date.now()}@example.com`;
    const regVerified = await publicClient.request('POST', '/api/register', {
      first_name: 'Verified',
      last_name: 'Resident',
      email: verifiedEmail,
      password: 'Password123!',
      locationVerificationToken: retryRes.data.verificationToken,
    });
    assert.strictEqual(regVerified.status, 201);
    createdUserIds.push(regVerified.data.user.id);
    assert.strictEqual(regVerified.data.user.locationVerificationStatus, 'verified');
    assert.strictEqual(regVerified.data.user.verificationStatus, 'Verified Resident');
    console.log(`  [PASS] Retried GPS verification succeeded; registered user ID ${regVerified.data.user.id} with status: ${regVerified.data.user.locationVerificationStatus}`);

    // Scenario 12: Frontend cannot manipulate verification status to bypass backend validation
    console.log('\n12. Testing backend rejection of frontend verification status manipulation...');
    const tamperNoToken = await publicClient.request('POST', '/api/register', {
      first_name: 'Tamper',
      last_name: 'Test',
      email: `tamper.${Date.now()}@example.com`,
      password: 'Password123!',
      locationStatus: 'verified',
    });
    assert.strictEqual(tamperNoToken.status, 403);

    const tamperBadToken = await publicClient.request('POST', '/api/register', {
      first_name: 'Tamper',
      last_name: 'Token',
      email: `tamper2.${Date.now()}@example.com`,
      password: 'Password123!',
      locationVerificationToken: retryRes.data.verificationToken.slice(0, -5) + 'XXXXX',
    });
    assert.strictEqual(tamperBadToken.status, 400);
    console.log('  [PASS] Direct verified status claim (HTTP 403) and tampered token (HTTP 400) rejected by backend');

    // Register an unverified (pending_review) resident for Scenarios 8, 9, 10, 11
    const pendingEmail = `loc.pending.${Date.now()}@example.com`;
    const pendingPassword = 'Password123!';
    const regPending = await publicClient.request('POST', '/api/register', {
      first_name: 'Pending',
      last_name: 'Resident',
      email: pendingEmail,
      password: pendingPassword,
      locationVerificationToken: s3.data.verificationToken,
    });
    assert.strictEqual(regPending.status, 201);
    const pendingUserId = regPending.data.user.id;
    createdUserIds.push(pendingUserId);
    assert.strictEqual(regPending.data.user.locationVerificationStatus, 'pending_review');
    assert.strictEqual(regPending.data.user.verificationStatus, 'Unverified Resident');

    // Login as the pending resident
    const residentClient = new HttpSession();
    const resLogin = await residentClient.request('POST', '/api/login', {
      email: pendingEmail,
      password: pendingPassword,
    });
    assert.strictEqual(resLogin.status, 200);
    assert.strictEqual(resLogin.data.user.locationVerificationStatus, 'pending_review');

    // Scenario 9: Resident with pending verification submits an incident report (must NOT be blocked)
    console.log('\n9. Testing pending-verification Resident submits an incident report...');
    const repRes = await residentClient.request('POST', '/api/reports', {
      incident_type: 'Flooding',
      title: 'Temporary Verification Test Report',
      description: 'Testing emergency access for unverified resident',
      location: 'Barangay Bayanan, Muntinlupa City',
      latitude: 14.408869,
      longitude: 121.046293,
    });
    assert.strictEqual(repRes.status, 201, `Expected 201 for report submission, got ${repRes.status}: ${JSON.stringify(repRes.data)}`);
    if (repRes.data.report && repRes.data.report.id) createdReportIds.push(repRes.data.report.id);
    else if (repRes.data.id) createdReportIds.push(repRes.data.id);
    console.log('  [PASS] Pending-verification Resident successfully submitted incident report (HTTP 201)');

    // Scenario 10: Resident with pending verification submits a rescue request (must NOT be blocked)
    console.log('\n10. Testing pending-verification Resident submits a rescue request...');
    const rescueRes = await residentClient.request('POST', '/api/rescue-requests', {
      emergencyType: 'Flood Rescue',
      description: 'Temporary Verification Test Rescue Request',
      location: 'Barangay Bayanan, Muntinlupa City',
      coordinates: { lat: 14.408869, lng: 121.046293 },
      peopleCount: 1,
    });
    assert.strictEqual(rescueRes.status, 201, `Expected 201 for rescue submission, got ${rescueRes.status}: ${JSON.stringify(rescueRes.data)}`);
    if (rescueRes.data.rescueRequest && rescueRes.data.rescueRequest.id) createdRescueIds.push(rescueRes.data.rescueRequest.id);
    else if (rescueRes.data.id) createdRescueIds.push(rescueRes.data.id);
    console.log('  [PASS] Pending-verification Resident successfully submitted rescue request (HTTP 201)');

    // Scenario 8: Administrator manually reviews an unverified Resident
    console.log('\n8. Testing Administrator manual review of unverified Resident...');
    const adminClient = new HttpSession();
    const [adminRows] = await db.query(
      "SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id ASC LIMIT 1"
    );
    assert.strictEqual(adminRows.length, 1, 'Expected an active admin user in database');
    const adminCsrf = crypto.randomBytes(16).toString('hex');
    const adminJwt = jwt.sign(
      { id: adminRows[0].id, jti: crypto.randomBytes(16).toString('hex'), csrf: adminCsrf },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: 3600 }
    );
    adminClient.cookies.geosafe_session = adminJwt;
    adminClient.csrfToken = adminCsrf;

    const adminReviewApprove = await adminClient.request('POST', `/api/admin/users/${pendingUserId}/location-verification`, {
      decision: 'approve',
      reason: 'Barangay Bayanan ID verified at EOC desk',
    });
    assert.strictEqual(adminReviewApprove.status, 200);
    assert.strictEqual(adminReviewApprove.data.resident.locationVerificationStatus, 'verified');
    assert.strictEqual(adminReviewApprove.data.resident.locationVerificationMethod, 'manual_admin');

    // Verify audit log recorded the manual decision
    const [auditRows] = await db.query(
      "SELECT action, entity_id, new_values FROM audit_logs WHERE entity_id = ? AND action = 'RESIDENT_LOCATION_VERIFICATION_APPROVED' ORDER BY id DESC LIMIT 1",
      [String(pendingUserId)]
    );
    assert.strictEqual(auditRows.length, 1, 'Expected audit log for manual verification approval');
    console.log('  [PASS] Administrator approved verification; method=manual_admin and audit log recorded');

    // Scenario 11: Verification status persists correctly after logout and login
    console.log('\n11. Testing verification status persistence across logout and login...');
    await residentClient.request('POST', '/api/logout');
    const reLogin = await residentClient.request('POST', '/api/login', {
      email: pendingEmail,
      password: pendingPassword,
    });
    assert.strictEqual(reLogin.status, 200);
    assert.strictEqual(reLogin.data.user.locationVerificationStatus, 'verified');
    assert.strictEqual(reLogin.data.user.verificationStatus, 'Verified Resident');

    const sessionRes = await residentClient.request('GET', '/api/auth/session');
    assert.strictEqual(sessionRes.status, 200);
    assert.strictEqual(sessionRes.data.profile.locationVerificationStatus, 'verified');
    assert.strictEqual(sessionRes.data.profile.locationVerificationMethod, 'manual_admin');
    console.log('  [PASS] Verified status persisted across logout, login, and /api/auth/session');

    // UI & Zero-Emoji static audit
    console.log('\n13. Auditing Frontend UI Elements & Zero Emojis:');
    const loginHtml = fs.readFileSync(path.join(__dirname, '../../frontend/login.html'), 'utf8');
    const loginJs = fs.readFileSync(path.join(__dirname, '../../frontend/assets/js/login.js'), 'utf8');
    const adminHtml = fs.readFileSync(path.join(__dirname, '../../frontend/admin.html'), 'utf8');
    const adminJs = fs.readFileSync(path.join(__dirname, '../../frontend/assets/js/admin.js'), 'utf8');

    assert.ok(loginHtml.includes('btn-verify-location'), 'login.html missing Verify My Location button');
    assert.ok(loginJs.includes('window.isSecureContext'), 'login.js missing secure context check');
    assert.ok(adminHtml.includes('admin-location-review-modal'), 'admin.html missing location review modal');
    assert.ok(adminJs.includes('submitLocationVerificationDecision'), 'admin.js missing decision handler');
    console.log('  [PASS] Frontend UI integration verified');

    console.log('\n================================================================');
    console.log(' ALL 12 LOCATION VERIFICATION SCENARIOS PASSED!');
    console.log('================================================================\n');
  } finally {
    // Cleanup temporary test records so database stays clean
    const cleanupConn = await db.getConnection().catch(() => null);
    if (cleanupConn) {
      try {
        await cleanupConn.query('ALTER TABLE audit_logs DISABLE TRIGGER ALL').catch(() => {});
        await cleanupConn.query('ALTER TABLE auth_security_logs DISABLE TRIGGER ALL').catch(() => {});
        await cleanupConn.query('ALTER TABLE incident_status_history DISABLE TRIGGER ALL').catch(() => {});
        await cleanupConn.query('ALTER TABLE rescue_status_history DISABLE TRIGGER ALL').catch(() => {});

        for (const rId of createdReportIds) {
          await cleanupConn.query('DELETE FROM incident_status_history WHERE incident_id = ?', [rId]).catch(() => {});
          await cleanupConn.query('DELETE FROM reports WHERE id = ?', [rId]).catch(() => {});
        }
        for (const rqId of createdRescueIds) {
          await cleanupConn.query('DELETE FROM rescue_status_history WHERE rescue_id = ?', [rqId]).catch(() => {});
          await cleanupConn.query('DELETE FROM rescue_requests WHERE id = ?', [rqId]).catch(() => {});
        }
        for (const uId of createdUserIds) {
          await cleanupConn.query('DELETE FROM notification_recipients WHERE user_id = ? OR notification_id IN (SELECT id FROM notifications WHERE created_by = ?)', [uId, uId]).catch(() => {});
          await cleanupConn.query('DELETE FROM notifications WHERE created_by = ?', [uId]).catch(() => {});
          await cleanupConn.query('DELETE FROM audit_logs WHERE entity_id = ? OR user_id = ?', [String(uId), uId]).catch(() => {});
          await cleanupConn.query('DELETE FROM auth_security_logs WHERE user_id = ?', [uId]).catch(() => {});
          await cleanupConn.query('DELETE FROM user_profiles WHERE user_id = ?', [uId]).catch(() => {});
          await cleanupConn.query('DELETE FROM users WHERE id = ?', [uId]).catch(() => {});
        }
      } finally {
        await cleanupConn.query('ALTER TABLE audit_logs ENABLE TRIGGER ALL').catch(() => {});
        await cleanupConn.query('ALTER TABLE auth_security_logs ENABLE TRIGGER ALL').catch(() => {});
        await cleanupConn.query('ALTER TABLE incident_status_history ENABLE TRIGGER ALL').catch(() => {});
        await cleanupConn.query('ALTER TABLE rescue_status_history ENABLE TRIGGER ALL').catch(() => {});
        cleanupConn.release();
      }
    }
    await db.end();
  }
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
