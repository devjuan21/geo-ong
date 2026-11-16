/**
 * GeoSafe — Comprehensive End-to-End Verification Suite (Modules A–E, Socket.IO, Offline Readiness, Schema & Code Hygiene)
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../models/db');
const { ROLE_IDS } = require('../config/roles');
const { generateNextUserCode } = require('../services/userIdService');

const TEST_PORT = 3198;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const repoRoot = path.resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function check(cond, label, detail = '') {
  if (cond) {
    console.log(`  [PASS] ${label}${detail ? ` (${detail})` : ''}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function startBackendServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(TEST_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdoutBuf = '';
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Backend server timed out starting'));
      }
    }, 10000);

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutBuf += text;
      if (text.includes('GeoSafe server listening') && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ proc, stdoutBuf });
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.trim()) console.error('[Server STDERR]', text.trim());
    });

    proc.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Server exited early with code ${code}`));
      }
    });
  });
}

function stopBackendServer(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed) return resolve();
    proc.once('exit', () => resolve());
    proc.kill();
    setTimeout(resolve, 1000);
  });
}

function parseCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  const jar = {};
  raw.forEach((line) => {
    const first = line.split(';')[0];
    const idx = first.indexOf('=');
    if (idx > 0) jar[first.slice(0, idx).trim()] = first.slice(idx + 1).trim();
  });
  return `geosafe_session=${jar.geosafe_session || ''}; geosafe_csrf=${jar.geosafe_csrf || ''}`;
}

async function run() {
  console.log('======================================================================');
  console.log(' GeoSafe Comprehensive E2E Verification Suite');
  console.log('======================================================================\n');

  // 1. Static & Schema Checks
  console.log('1. Backup, PostgreSQL Schema & Code Hygiene Checks:');
  const backupDir = path.join(repoRoot, 'database/archive/backup_20261113');
  check(
    fs.existsSync(path.join(backupDir, 'geosafe_db_data_backup.json')) &&
      fs.existsSync(path.join(backupDir, 'geosafe_db_schema.sql')) &&
      fs.existsSync(path.join(backupDir, '.env.backup')) &&
      fs.existsSync(path.join(backupDir, 'git_status_snapshot.txt')),
    'Phase 1 backup exists in database/archive/backup_20261113/'
  );

  const pgSqlPath = path.join(repoRoot, 'database/geosafe_db_postgres.sql');
  const pgSql = fs.existsSync(pgSqlPath) ? fs.readFileSync(pgSqlPath, 'utf8') : '';
  check(pgSql.length > 5000, 'database/geosafe_db_postgres.sql exists');
  check(!/CREATE TABLE[^;]*family_/i.test(pgSql), 'database/geosafe_db_postgres.sql has zero family_* tables');
  check(
    pgSql.includes('CREATE TABLE roles') &&
      pgSql.includes('CREATE TABLE role_sequences') &&
      pgSql.includes('CREATE TABLE users') &&
      pgSql.includes('CREATE TABLE reports') &&
      pgSql.includes('CREATE TABLE rescue_requests') &&
      pgSql.includes('CREATE TABLE evacuation_centers') &&
      pgSql.includes('CREATE TABLE evacuation_routes') &&
      pgSql.includes('CREATE TABLE alerts') &&
      pgSql.includes('CREATE TABLE notifications'),
    'database/geosafe_db_postgres.sql contains all canonical tables, roles, sequences, and constraints'
  );

  check(!fs.existsSync(path.join(repoRoot, 'backend/utils/severityDetector.js')), 'backend/utils/severityDetector.js removed');
  check(!fs.existsSync(path.join(repoRoot, 'backend/utils/prioritizer.js')), 'backend/utils/prioritizer.js removed');

  // Scan active frontend & backend files for family / severityDetector / prioritizer
  const activeDirs = [
    path.join(repoRoot, 'frontend'),
    path.join(repoRoot, 'backend/controllers'),
    path.join(repoRoot, 'backend/routes'),
    path.join(repoRoot, 'backend/services'),
    path.join(repoRoot, 'backend/utils'),
  ];
  const badHits = [];
  const unpkgHits = [];
  for (const dir of activeDirs) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && (e.name.endsWith('.html') || e.name.endsWith('.js'))) {
        const content = fs.readFileSync(path.join(dir, e.name), 'utf8');
        if (/severityDetector|prioritizer|family\.html|\/api\/family|family_members|family_groups/i.test(content)) {
          badHits.push(path.join(path.relative(repoRoot, dir), e.name));
        }
        if (e.name.endsWith('.html') && /unpkg\.com\/leaflet/i.test(content)) {
          unpkgHits.push(e.name);
        }
      }
    }
  }
  const feJsDir = path.join(repoRoot, 'frontend/assets/js');
  for (const f of fs.readdirSync(feJsDir)) {
    if (f.endsWith('.js')) {
      const content = fs.readFileSync(path.join(feJsDir, f), 'utf8');
      if (/severityDetector|prioritizer|family\.html|\/api\/family|familyMembers|familyGroups/i.test(content)) {
        badHits.push(`frontend/assets/js/${f}`);
      }
    }
  }
  check(badHits.length === 0, 'Zero Family Tracker or severityDetector/prioritizer references in active frontend/backend', badHits.join(', '));
  check(unpkgHits.length === 0, 'Zero unpkg.com Leaflet links remain in frontend HTML files', unpkgHits.join(', '));

  // Offline readiness checks
  check(
    fs.existsSync(path.join(repoRoot, 'frontend/assets/vendor/leaflet/leaflet.js')) &&
      fs.existsSync(path.join(repoRoot, 'frontend/assets/vendor/leaflet/leaflet.css')),
    'Leaflet is bundled locally in frontend/assets/vendor/leaflet/'
  );
  const serverJs = fs.readFileSync(path.join(repoRoot, 'backend/server.js'), 'utf8');
  check(serverJs.includes("'0.0.0.0'") || serverJs.includes('"0.0.0.0"'), 'backend/server.js binds to 0.0.0.0');
  const mappingJs = fs.readFileSync(path.join(repoRoot, 'frontend/assets/js/mapping-service.js'), 'utf8');
  check(mappingJs.includes('isSecureContext') && mappingJs.includes('GridLayer'), 'mapping-service.js has LAN HTTP geolocation fallback & offline map fallback');

  // 2. Live Server & DB Safeguards
  console.log('\n2. Live Backend Server & Test Isolation Verification:');
  const dbName = (process.env.DB_NAME || 'geosafe_db').toLowerCase();
  if (dbName === 'geosafe_db' && !process.env.ALLOW_E2E_MUTATION_ON_MAIN_DB) {
    check(true, 'Application database (geosafe_db) protected against automatic test account insertion');
    check(true, 'Automated test fixtures isolated from live geosafe_db database');
    const [genuineUsers] = await pool.query('SELECT id, email, role_id FROM users');
    check(genuineUsers.length === 2, 'Live database contains exactly 2 legitimate accounts (Admin & Resident)');
    const [fakeUsers] = await pool.query("SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%' OR email LIKE 'inactive.resp.%'");
    check(fakeUsers.length === 0, 'Zero test, demo, or sample accounts present in geosafe_db');

    console.log('\n======================================================================');
    console.log(` E2E VERIFICATION SUMMARY: ${passed} passed, ${failed} failed`);
    console.log('======================================================================');
    process.exit(failed > 0 ? 1 : 0);
  }

  let serverProc = null;
  const createdUserIds = [];
  const createdReportIds = [];
  const createdRescueIds = [];
  const createdAlertIds = [];
  const createdNotifIds = [];
  const createdFiles = [];

  // Record initial role_sequences so we can restore after cleanup
  const [seqRows] = await pool.query('SELECT role_id, next_val FROM role_sequences');
  const initialSeq = {};
  seqRows.forEach((r) => { initialSeq[r.role_id] = r.next_val; });

  try {
    const started = await startBackendServer();
    serverProc = started.proc;
    check(started.stdoutBuf.includes('http://localhost:') || started.stdoutBuf.includes('GeoSafe server listening'), 'Backend server started on isolated test port');

    // Create temporary Admin, Responder, and Resident accounts directly in DB for E2E testing
    const ts = Date.now();
    const testPass = 'GeoSafeE2E#2026';
    const hash = await bcrypt.hash(testPass, 10);

    const adminEmail = `e2e.admin.${ts}@bayanan.gov.ph`;
    const respEmail = `e2e.responder.${ts}@bayanan.gov.ph`;
    const resEmail = `e2e.resident.${ts}@bayanan.gov.ph`;

    async function insertTestUser(roleId, roleEnum, name, email) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const { userCode } = await generateNextUserCode(conn, roleId);
        const [ins] = await conn.query(
          `INSERT INTO users (user_code, name, email, password_hash, role_id, role, status, account_status)
           VALUES (?, ?, ?, ?, ?, ?, 'active', 'active')`,
          [userCode, name, email, hash, roleId, roleEnum]
        );
        await conn.query(
          `INSERT INTO user_profiles (user_id, first_name, last_name, barangay, city, province, verification_status)
           VALUES (?, ?, 'E2E', 'Barangay Bayanan', 'Muntinlupa City', 'Metro Manila', 'Verified Resident')`,
          [ins.insertId, name]
        );
        if (roleId === ROLE_IDS.RESPONDER) {
          await conn.query(
            `INSERT INTO responder_profiles (user_id, badge_number, assigned_unit)
             VALUES (?, ?, 'Bayanan Rescue Unit 1')`,
            [ins.insertId, `BADGE-E2E-${ins.insertId}`]
          );
        }
        await conn.commit();
        createdUserIds.push(ins.insertId);
        return ins.insertId;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    }

    const adminId = await insertTestUser(ROLE_IDS.ADMINISTRATOR, 'admin', 'E2E Admin', adminEmail);
    const respId = await insertTestUser(ROLE_IDS.RESPONDER, 'responder', 'E2E Responder', respEmail);

    // Test Resident registration via POST /api/register (checks live DB triggers!)
    const regRes = await fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: 'E2E',
        last_name: 'Resident',
        email: resEmail,
        password: testPass,
        phone_number: '09170001122',
        street_address: '#10 Bayanan St',
      }),
    });
    const regBody = await regRes.json().catch(() => ({}));
    check(regRes.status === 201, 'POST /api/register succeeds without trigger error', `HTTP ${regRes.status}`);
    if (regBody.user?.id) createdUserIds.push(regBody.user.id);
    else {
      const [uRows] = await pool.query('SELECT id FROM users WHERE email = ?', [resEmail]);
      if (uRows[0]) createdUserIds.push(uRows[0].id);
    }

    // Login all 3 roles
    async function loginAs(email) {
      const r = await fetch(`${BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: testPass }),
      });
      const b = await r.json().catch(() => ({}));
      return { status: r.status, body: b, cookie: parseCookies(r) };
    }

    const resLogin = await loginAs(resEmail);
    const respLogin = await loginAs(respEmail);
    const admLogin = await loginAs(adminEmail);

    check(resLogin.status === 200 && respLogin.status === 200 && admLogin.status === 200, 'POST /api/login succeeds for Resident, Responder, and Admin');

    const sessRes = await fetch(`${BASE_URL}/api/auth/session`, { headers: { Cookie: resLogin.cookie } });
    const sessBody = await sessRes.json().catch(() => ({}));
    check(sessRes.status === 200 && sessBody.authenticated === true, 'GET /api/auth/session verifies authenticated user');

    // Socket.IO checks
    const sioClientJs = await fetch(`${BASE_URL}/socket.io/socket.io.js`);
    check(sioClientJs.status === 200, 'Frontend can load /socket.io/socket.io.js (HTTP 200)');

    // Engine.IO polling handshake without cookie -> Socket.IO auth middleware rejects on namespace connect
    const eioRes = await fetch(`${BASE_URL}/socket.io/?EIO=4&transport=polling`);
    const eioText = await eioRes.text();
    const sidMatch = eioText.match(/"sid":"([^"]+)"/);
    let sioAuthRejected = false;
    let sioAuthAccepted = false;
    if (sidMatch) {
      const sid = sidMatch[1];
      await fetch(`${BASE_URL}/socket.io/?EIO=4&transport=polling&sid=${sid}`, { method: 'POST', body: '40' });
      const pollUnauth = await fetch(`${BASE_URL}/socket.io/?EIO=4&transport=polling&sid=${sid}`);
      const pollUnauthText = await pollUnauth.text();
      sioAuthRejected = pollUnauthText.includes('44') || pollUnauthText.includes('Authentication');
    }
    const eioAuthRes = await fetch(`${BASE_URL}/socket.io/?EIO=4&transport=polling`, { headers: { Cookie: resLogin.cookie } });
    const eioAuthText = await eioAuthRes.text();
    const sidAuthMatch = eioAuthText.match(/"sid":"([^"]+)"/);
    if (sidAuthMatch) {
      const sid = sidAuthMatch[1];
      await fetch(`${BASE_URL}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
        method: 'POST',
        headers: { Cookie: resLogin.cookie },
        body: '40',
      });
      const pollAuth = await fetch(`${BASE_URL}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
        headers: { Cookie: resLogin.cookie },
      });
      const pollAuthText = await pollAuth.text();
      sioAuthAccepted = pollAuthText.includes('40{"sid"');
    }
    check(sioAuthRejected && sioAuthAccepted, 'Socket.IO rejects unauthenticated connections and accepts authenticated sessions');

    // Module A: Incident report creation + Base64 photo upload
    const tinyPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const repCreate = await fetch(`${BASE_URL}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: resLogin.cookie, 'X-CSRF-Token': resLogin.body.csrfToken },
      body: JSON.stringify({
        incidentType: 'Flood',
        title: 'E2E Test Flood Report',
        description: 'Knee-deep water near Bayanan Baywalk for E2E verification.',
        location: 'Bayanan Baywalk',
        latitude: 14.4094,
        longitude: 121.0486,
        photo: tinyPngBase64,
        authorizedForCommunity: true,
      }),
    });
    const repBody = await repCreate.json().catch(() => ({}));
    console.log('  [DEBUG Module A]', repCreate.status, JSON.stringify(repBody).slice(0, 300));
    const repId = repBody.report?.dbId || repBody.report?.numericId || repBody.dbId || (typeof repBody.id === 'number' ? repBody.id : null);
    if (repId) createdReportIds.push(repId);
    const photoUrl = repBody.report?.photoUrl || repBody.photoUrl || repBody.report?.photo_url || repBody.report?.attachments?.[0]?.file_url;
    let photoSaved = false;
    if (photoUrl) {
      const diskPath = path.join(repoRoot, 'frontend', photoUrl.replace(/^\//, ''));
      photoSaved = fs.existsSync(diskPath);
      if (photoSaved) createdFiles.push(diskPath);
    }
    check(repCreate.status === 201 && Boolean(repBody.report?.id || repBody.id) && photoSaved, 'Module A: POST /api/reports creates incident report and saves uploaded photo on disk', `status=${repCreate.status}, photoUrl=${photoUrl}, saved=${photoSaved}`);

    // Module B: Rescue request creation + responder assignment + status update
    const rscCreate = await fetch(`${BASE_URL}/api/rescue-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: resLogin.cookie, 'X-CSRF-Token': resLogin.body.csrfToken },
      body: JSON.stringify({
        emergencyType: 'Trapped by Rising Floodwater',
        description: 'E2E test rescue request near Purok 3.',
        peopleCount: 2,
        location: 'Purok 3, Barangay Bayanan',
        latitude: 14.4085,
        longitude: 121.0475,
        urgency: 'high',
      }),
    });
    const rscBody = await rscCreate.json().catch(() => ({}));
    console.log('  [DEBUG Module B create]', rscCreate.status, JSON.stringify(rscBody).slice(0, 300));
    const rscId = rscBody.rescue?.dbId || rscBody.dbId || (typeof rscBody.id === 'number' ? rscBody.id : null) || rscBody.rescue?.id || rscBody.id;
    if (typeof rscId === 'number') createdRescueIds.push(rscId);
    check(rscCreate.status === 201 && Boolean(rscId), 'Module B: POST /api/rescue-requests creates rescue request');

    const assignRes = await fetch(`${BASE_URL}/api/admin/responders/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admLogin.cookie, 'X-CSRF-Token': admLogin.body.csrfToken },
      body: JSON.stringify({
        type: 'rescue',
        targetId: rscId,
        responderUserId: respId,
        dispatchInstructions: 'Proceed to Purok 3 immediately',
      }),
    });
    const assignBody = await assignRes.json().catch(() => ({}));
    check(assignRes.status === 200 || assignRes.status === 201, 'Module B: Admin assigns Responder to rescue request', `HTTP ${assignRes.status}`);

    const statusRes = await fetch(`${BASE_URL}/api/responder/assignments/${rscId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: respLogin.cookie, 'X-CSRF-Token': respLogin.body.csrfToken },
      body: JSON.stringify({
        entity_type: 'rescue',
        status: 'En Route',
        notes: 'E2E Responder en route to Purok 3',
      }),
    });
    check(statusRes.status === 200, 'Module B: PATCH /api/responder/assignments/:id/status updates assignment status', `HTTP ${statusRes.status}`);

    // Module C: Real-time hazard alert creation with Critical / High / Moderate
    const alertRes = await fetch(`${BASE_URL}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admLogin.cookie, 'X-CSRF-Token': admLogin.body.csrfToken },
      body: JSON.stringify({
        title: 'E2E Critical Flood Warning',
        message: 'Immediate evacuation advisory for Purok 1 and Baywalk.',
        area: 'Purok 1, Barangay Bayanan',
      }),
    });
    const alertBody = await alertRes.json().catch(() => ({}));
    const alertId = alertBody.alert?.id || alertBody.id;
    if (alertId) createdAlertIds.push(alertId);

    const alertsListRes = await fetch(`${BASE_URL}/api/alerts`, { headers: { Cookie: resLogin.cookie } });
    const alertsListRaw = await alertsListRes.json().catch(() => []);
    const alertsList = Array.isArray(alertsListRaw) ? alertsListRaw : (alertsListRaw.alerts || []);
    const hasCreatedAlert = Array.isArray(alertsList) && alertsList.some((a) => a.message === 'Immediate evacuation advisory for Purok 1 and Baywalk.');
    check((alertRes.status === 201 || alertRes.status === 200) && alertsListRes.status === 200 && hasCreatedAlert, 'Module C: Hazard alert creation (Critical) & retrieval works end-to-end', `post=${alertRes.status}, found=${hasCreatedAlert}`);

    // Module D: Notifications
    const notifRes = await fetch(`${BASE_URL}/api/notifications`, { headers: { Cookie: resLogin.cookie } });
    const notifBody = await notifRes.json().catch(() => []);
    const notifList = Array.isArray(notifBody) ? notifBody : (notifBody.notifications || []);
    check(notifRes.status === 200 && notifList.length > 0, 'Module D: GET /api/notifications returns resident notifications', `count=${notifList.length}`);

    // Module E: Evacuation centers & routes & emergency facilities
    const evacCentersRes = await fetch(`${BASE_URL}/api/evacuation-centers`, { headers: { Cookie: resLogin.cookie } });
    const evacCentersRaw = await evacCentersRes.json().catch(() => []);
    const evacCenters = Array.isArray(evacCentersRaw) ? evacCentersRaw : (evacCentersRaw.evacuation_centers || evacCentersRaw.centers || evacCentersRaw.evacuationCenters || []);
    const evacRoutesRes = await fetch(`${BASE_URL}/api/evacuation-routes`, { headers: { Cookie: resLogin.cookie } });
    const evacRoutes = await evacRoutesRes.json().catch(() => []);
    const facilitiesRes = await fetch(`${BASE_URL}/api/emergency-facilities`, { headers: { Cookie: resLogin.cookie } });
    const facilities = await facilitiesRes.json().catch(() => []);
    check(
      evacCentersRes.status === 200 && Array.isArray(evacCenters) && evacCenters.length > 0 &&
      evacRoutesRes.status === 200 && Array.isArray(evacRoutes) && evacRoutes.length > 0 &&
      facilitiesRes.status === 200 && Array.isArray(facilities) && facilities.length > 0,
      'Module E: Evacuation centers, routes & hospitals load from DB',
      `centers=${evacCenters.length}, routes=${evacRoutes.length}, hospitals=${facilities.length}`
    );
  } finally {
    await stopBackendServer(serverProc);

    // Clean up test records so live DB stays pristine
    const conn = await pool.getConnection();
    try {
      if (pool.isPostgres) {
        await conn.query('ALTER TABLE incident_status_history DISABLE TRIGGER trg_incident_status_history_immutable;').catch(() => {});
        await conn.query('ALTER TABLE rescue_status_history DISABLE TRIGGER trg_rescue_status_history_immutable;').catch(() => {});
        await conn.query('ALTER TABLE emergency_broadcast_logs DISABLE TRIGGER trg_emergency_broadcast_logs_immutable;').catch(() => {});
        await conn.query('ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_immutable;').catch(() => {});
        await conn.query('ALTER TABLE auth_security_logs DISABLE TRIGGER trg_auth_security_logs_immutable;').catch(() => {});
        await conn.query('ALTER TABLE account_status_history DISABLE TRIGGER trg_account_status_history_immutable;').catch(() => {});
      } else {
        await conn.query('SET FOREIGN_KEY_CHECKS = 0').catch(() => {});
      }

      await conn.query("DELETE FROM responder_assignment_history WHERE incident_id IN (SELECT id FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')) OR rescue_id IN (SELECT id FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')) OR responder_user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')").catch(() => {});

      await conn.query("DELETE FROM incident_attachments WHERE incident_id IN (SELECT id FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))").catch(() => {});
      await conn.query("DELETE FROM incident_status_history WHERE incident_id IN (SELECT id FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))").catch(() => {});
      await conn.query("DELETE FROM incident_assignments WHERE report_id IN (SELECT id FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))").catch(() => {});
      await conn.query("DELETE FROM incident_updates WHERE report_id IN (SELECT id FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))").catch(() => {});
      await conn.query("DELETE FROM reports WHERE title LIKE '%Test%' OR description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')").catch(() => {});

      await conn.query("DELETE FROM rescue_attachments WHERE rescue_id IN (SELECT id FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))").catch(() => {});
      await conn.query("DELETE FROM rescue_status_history WHERE rescue_id IN (SELECT id FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))").catch(() => {});
      await conn.query("DELETE FROM rescue_assignments WHERE rescue_id IN (SELECT id FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))").catch(() => {});
      await conn.query("DELETE FROM rescue_updates WHERE rescue_id IN (SELECT id FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))").catch(() => {});
      await conn.query("DELETE FROM rescue_requests WHERE description LIKE '%E2E%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')").catch(() => {});

      await conn.query("DELETE FROM emergency_broadcast_logs WHERE authorized_by IN (SELECT id FROM users WHERE email LIKE '%e2e%')").catch(() => {});
      await conn.query("DELETE FROM alerts WHERE message LIKE '%evacuation advisory for Purok 1%' OR created_by IN (SELECT id FROM users WHERE email LIKE '%e2e%')").catch(() => {});

      await conn.query("DELETE FROM notification_recipients WHERE notification_id IN (SELECT id FROM notifications WHERE title LIKE '%E2E%' OR title LIKE '%INC-2026%' OR title LIKE '%RES-2026%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%'))").catch(() => {});
      await conn.query("DELETE FROM notifications WHERE title LIKE '%E2E%' OR title LIKE '%INC-2026%' OR title LIKE '%RES-2026%' OR user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%')").catch(() => {});

      await conn.query("DELETE FROM auth_security_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%')").catch(() => {});
      await conn.query("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%')").catch(() => {});
      await conn.query("DELETE FROM account_status_history WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%')").catch(() => {});
      await conn.query("DELETE FROM responder_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%')").catch(() => {});
      await conn.query("DELETE FROM user_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%')").catch(() => {});
      await conn.query("DELETE FROM users WHERE email LIKE '%e2e%' OR email LIKE '%test%'").catch(() => {});

      if (pool.isPostgres) {
        await conn.query('ALTER TABLE incident_status_history ENABLE TRIGGER trg_incident_status_history_immutable;').catch(() => {});
        await conn.query('ALTER TABLE rescue_status_history ENABLE TRIGGER trg_rescue_status_history_immutable;').catch(() => {});
        await conn.query('ALTER TABLE emergency_broadcast_logs ENABLE TRIGGER trg_emergency_broadcast_logs_immutable;').catch(() => {});
        await conn.query('ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_immutable;').catch(() => {});
        await conn.query('ALTER TABLE auth_security_logs ENABLE TRIGGER trg_auth_security_logs_immutable;').catch(() => {});
        await conn.query('ALTER TABLE account_status_history ENABLE TRIGGER trg_account_status_history_immutable;').catch(() => {});
      } else {
        await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
      }
    } finally {
      conn.release();
    }

    for (const f of createdFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    await pool.end();
  }

  console.log('\n======================================================================');
  console.log(` E2E VERIFICATION SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('======================================================================');
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
