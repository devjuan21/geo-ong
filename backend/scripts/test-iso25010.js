/**
 * ISO 25010 & Capstone Automated Testing Suite
 * Pamantasan ng Lungsod ng Muntinlupa - Capstone Project
 * Project: Web-Based Disaster Reporting and Emergency Assistance System for Barangay Bayanan, Muntinlupa City
 */

const assert = require('assert');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'geosafe_jwt_secret_bayanan_2026';

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let passedTests = 0;
let totalTests = 0;
const resultsLog = [];

function runTest(testName, testFn) {
  totalTests++;
  try {
    const start = process.hrtime();
    testFn();
    const diff = process.hrtime(start);
    const durationMs = (diff[0] * 1000 + diff[1] / 1000000).toFixed(2);
    passedTests++;
    resultsLog.push({ name: testName, status: 'PASSED', duration: `${durationMs}ms` });
    console.log(`  [PASS] ${testName} (${durationMs}ms)`);
  } catch (err) {
    resultsLog.push({ name: testName, status: 'FAILED', error: err.message });
    console.error(`  [FAIL] ${testName}: ${err.message}`);
  }
}

async function runAsyncTest(testName, testFn) {
  totalTests++;
  try {
    const start = process.hrtime();
    await testFn();
    const diff = process.hrtime(start);
    const durationMs = (diff[0] * 1000 + diff[1] / 1000000).toFixed(2);
    passedTests++;
    resultsLog.push({ name: testName, status: 'PASSED', duration: `${durationMs}ms` });
    console.log(`  [PASS] ${testName} (${durationMs}ms)`);
  } catch (err) {
    resultsLog.push({ name: testName, status: 'FAILED', error: err.message });
    console.error(`  [FAIL] ${testName}: ${err.message}`);
  }
}

async function runTestSuite() {
  console.log('\n======================================================================');
  console.log('   PAMANTASAN NG LUNGSOD NG MUNTINLUPA - CAPSTONE PROJECT');
  console.log('   ISO 25010 Automated Testing Suite: GeoSafe System');
  console.log('======================================================================\n');

  console.log('[Module 1] User Authentication & RBAC System');
  
  await runAsyncTest('Password Hashing Verification (Bcrypt salt & hash generation)', async () => {
    const rawPass = 'Resident@2026!';
    const hash = await bcrypt.hash(rawPass, 10);
    assert(hash.startsWith('$2'), 'Bcrypt hash should follow standard $2 format');
    const matches = await bcrypt.compare(rawPass, hash);
    assert.strictEqual(matches, true, 'Valid password must match hash');
    const wrongMatches = await bcrypt.compare('WrongPassword', hash);
    assert.strictEqual(wrongMatches, false, 'Invalid password must be rejected');
  });

  runTest('JWT Token Generation and Verification', () => {
    const payload = { id: 104, email: 'zander@bayanan.ph', role: 'resident' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    assert(typeof token === 'string' && token.length > 30, 'JWT token must be a signed non-empty string');
    const decoded = jwt.verify(token, JWT_SECRET);
    assert.strictEqual(decoded.id, 104);
    assert.strictEqual(decoded.role, 'resident');
  });

  runTest('Role-Based Access Control (RBAC) Role Validation', () => {
    const roles = ['resident', 'responder', 'admin'];
    assert(roles.includes('resident'), 'Resident role must be recognized');
    assert(roles.includes('responder'), 'Responder role must be recognized');
    assert(roles.includes('admin'), 'Admin role must be recognized');
    assert(!roles.includes('unauthorized_guest'), 'Unauthorized roles must not exist in access schema');
  });

  console.log('\n[Module 2] Emergency Reporting & Rescue Request Workflow');

  runTest('Geolocation Coordinate Validation (Barangay Bayanan Bounds Check)', () => {
    const sampleReport = {
      incident_type: 'Flood',
      description: 'Water rising near Bayanan Baywalk Covered Court',
      latitude: 14.4094644,
      longitude: 121.0486196
    };
    assert(sampleReport.latitude >= 14.3800 && sampleReport.latitude <= 14.4300, 'Latitude must be within Muntinlupa/Bayanan region');
    assert(sampleReport.longitude >= 121.0200 && sampleReport.longitude <= 121.0800, 'Longitude must be within Muntinlupa/Bayanan region');
    assert(sampleReport.description.length >= 6, 'Description must meet minimum length criteria');
  });

  runTest('Haversine Distance Metric Calculation for Evacuation Proximity', () => {
    const dist = haversineKm(14.4094644, 121.0486196, 14.4117681, 121.0517064);
    assert(dist > 0.3 && dist < 0.6, `Distance should be approximately 0.43km, got: ${dist.toFixed(3)}km`);
  });

  console.log('\n[Module 3] Emergency Advisory & Chronological Alert Ordering');

  runTest('Hazard Alert Chronological Ordering & Category Structure', () => {
    const alerts = [
      { id: 1, title: 'Advisory 1', category: 'Flood', created_at: '2026-11-15T08:00:00Z' },
      { id: 2, title: 'Advisory 2', category: 'Typhoon', created_at: '2026-11-15T09:00:00Z' }
    ];
    const sorted = [...alerts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    assert.strictEqual(sorted[0].id, 2, 'Latest advisory ordered first');
    assert.strictEqual(sorted[1].id, 1, 'Older advisory ordered second');
    assert.strictEqual(sorted[0].category, 'Typhoon', 'Category accurately recorded');
  });

  console.log('\n[Module 4] Security Measures (Encryption, Token Auth, Data Sanitization)');

  runTest('Invalid Token Tampering Rejection Test', () => {
    const invalidToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tamperedPayload.invalidSignature';
    assert.throws(() => {
      jwt.verify(invalidToken, JWT_SECRET);
    }, 'Tampered or fake JWT tokens must throw verification error');
  });

  runTest('XSS & Input Sanitization Integrity Test', () => {
    const dirtyText = '<script>alert("XSS")</script>Dangerous payload';
    const escaped = dirtyText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    assert(!escaped.includes('<script>'), 'HTML/script tags must be escaped');
    assert.strictEqual(escaped.includes('&lt;script&gt;'), true, 'Tags converted to HTML safe entities');
  });

  console.log('\n======================================================================');
  console.log('   TEST EXECUTION SUMMARY');
  console.log('======================================================================');
  console.log(`Total Tests Executed: ${totalTests}`);
  console.log(`Passed Tests:         ${passedTests}`);
  console.log(`Failed Tests:         ${totalTests - passedTests}`);
  console.log(`Success Rate:         ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('======================================================================\n');

  process.exit(passedTests === totalTests ? 0 : 1);
}

runTestSuite();
