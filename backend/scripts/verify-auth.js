/**
 * End-to-End Verification Script for GeoSafe Authentication & Portal Access (12 Required Tests)
 * Runs against the real Express backend + MySQL `geosafe_db` database.
 */
const path = require('path');
const { spawn } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TEST_PORT = 3199;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const pool = require('../models/db');

function startBackendServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(TEST_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Backend server timed out starting'));
      }
    }, 8000);

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('GeoSafe server listening') && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.trim()) {
        console.error('[Server STDERR]', text.trim());
      }
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

function parseSetCookieHeaders(res) {
  const raw = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : res.headers.get('set-cookie')
    ? [res.headers.get('set-cookie')]
    : [];
  const jar = {};
  raw.forEach((line) => {
    const firstPart = line.split(';')[0];
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const name = firstPart.slice(0, eqIdx).trim();
      const val = firstPart.slice(eqIdx + 1).trim();
      jar[name] = { value: val, raw: line };
    }
  });
  return { raw, jar };
}

async function runTests() {
  const [[{ cnt: initialUserCount }]] = await pool.query('SELECT COUNT(*) AS cnt FROM users');
  const [[{ cnt: initialLogCount }]] = await pool.query('SELECT COUNT(*) AS cnt FROM auth_security_logs');
  const [[{ cnt: initialAuditCount }]] = await pool.query('SELECT COUNT(*) AS cnt FROM audit_logs');
  console.log(`[Setup] Connected to MySQL geosafe_db (initial users=${initialUserCount})`);

  let serverProc = await startBackendServer();
  const results = [];

  function record(num, name, passed, details) {
    results.push({ num, name, passed, details });
    console.log(`${passed ? 'PASS' : 'FAIL'} [Test #${num}] ${name} -> ${details}`);
  }

  try {
    // 1. Open application without logging in -> Resident UI must NOT open
    const res1 = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
    const loc1 = res1.headers.get('location');
    record(
      1,
      'Open application root (/) without logging in',
      res1.status === 302 && loc1 === '/login.html',
      `HTTP ${res1.status} Location: ${loc1}`
    );

    // 2. Manually enter Resident dashboard URL without logging in -> redirected to login
    const res2a = await fetch(`${BASE_URL}/index.html`, { redirect: 'manual' });
    const res2b = await fetch(`${BASE_URL}/family.html`, { redirect: 'manual' });
    const res2c = await fetch(`${BASE_URL}/report-rescue.html`, { redirect: 'manual' });
    record(
      2,
      'Manually enter Resident dashboard URLs (/index.html, /family.html, /report-rescue.html) unauthenticated',
      res2a.status === 302 && res2a.headers.get('location') === '/login.html' &&
      res2b.status === 302 && res2b.headers.get('location') === '/login.html' &&
      res2c.status === 302 && res2c.headers.get('location') === '/login.html',
      `/index.html->${res2a.status} (${res2a.headers.get('location')}), /family.html->${res2b.status}, /report-rescue.html->${res2c.status}`
    );

    // 3. Call a Resident API endpoint without logging in -> returns HTTP 401
    const res3a = await fetch(`${BASE_URL}/api/reports`);
    const res3b = await fetch(`${BASE_URL}/api/dashboard/summary`);
    const res3c = await fetch(`${BASE_URL}/api/profile`);
    const res3d = await fetch(`${BASE_URL}/api/family`);
    record(
      3,
      'Call Resident API endpoints without logging in',
      res3a.status === 401 && res3b.status === 401 && res3c.status === 401 && res3d.status === 401,
      `/api/reports->${res3a.status}, /api/dashboard/summary->${res3b.status}, /api/profile->${res3c.status}, /api/family->${res3d.status}`
    );

    // 4. Register a new Resident account -> saved in MySQL with Resident role
    const testEmail = `resident.verify.${Date.now()}@bayanan.gov.ph`;
    const testPassword = 'SafeResident#2026';

    const privAttempt = await fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Privilege Escalator',
        email: `escalate.${Date.now()}@bayanan.gov.ph`,
        password: testPassword,
        role_id: 1,
      }),
    });

    const res4 = await fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: 'Maria',
        last_name: 'Santos',
        email: testEmail,
        password: testPassword,
        phone_number: '09171234567',
        street_address: '#18 Baywalk Street',
      }),
    });
    const body4 = await res4.json();

    const [dbUserRows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.role_id, r.name AS role_name, up.barangay, up.city
       FROM users u
       JOIN roles r ON r.id = u.role_id
       JOIN user_profiles up ON up.user_id = u.id
       WHERE u.email = ?`,
      [testEmail]
    );
    const dbUser = dbUserRows[0];
    const isBcryptHash = dbUser && dbUser.password_hash.startsWith('$2b$');

    record(
      4,
      'Register a new Resident account in MySQL (and block privileged role_id=1 attempt)',
      privAttempt.status === 403 &&
      res4.status === 201 &&
      dbUser &&
      dbUser.role_id === 3 &&
      dbUser.role_name === 'Resident' &&
      isBcryptHash &&
      body4.redirectTo === '/login.html',
      `Admin Reg Attempt->${privAttempt.status}, Resident Reg->${res4.status}, MySQL role_id=${dbUser?.role_id} (${dbUser?.role_name}), bcrypt=${isBcryptHash}, redirectTo=${body4.redirectTo}`
    );

    // 6. Log in with an incorrect password -> rejected
    const res6 = await fetch(`${BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'WrongPassword123!' }),
    });
    record(
      6,
      'Log in with an incorrect password -> rejected with HTTP 401',
      res6.status === 401,
      `HTTP ${res6.status}`
    );

    // 5. Log in with the newly registered Resident account -> redirected to Resident UI
    const res5 = await fetch(`${BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const body5 = await res5.json();
    const cookies5 = parseSetCookieHeaders(res5);
    const sessionCookie = cookies5.jar.geosafe_session;
    const csrfCookie = cookies5.jar.geosafe_csrf;
    const isHttpOnly = sessionCookie && /httponly/i.test(sessionCookie.raw);
    const isSameSiteLax = sessionCookie && /samesite=lax/i.test(sessionCookie.raw);
    const cookieHeader = `geosafe_session=${sessionCookie?.value}; geosafe_csrf=${csrfCookie?.value}`;

    const res5Page = await fetch(`${BASE_URL}/index.html`, {
      headers: { Cookie: cookieHeader },
      redirect: 'manual',
    });

    record(
      5,
      'Log in with newly registered Resident account -> sets HttpOnly cookie & opens Resident UI (/index.html)',
      res5.status === 200 &&
      body5.user?.role_id === 3 &&
      body5.user?.portal === '/index.html' &&
      Boolean(isHttpOnly) &&
      Boolean(isSameSiteLax) &&
      res5Page.status === 200,
      `Login->${res5.status}, portal=${body5.user?.portal}, HttpOnly=${isHttpOnly}, SameSite=Lax=${isSameSiteLax}, GET /index.html->${res5Page.status}`
    );

    // 8. Resident attempts to open Responder route -> blocked
    const res8Html = await fetch(`${BASE_URL}/responder-dashboard.html`, {
      headers: { Cookie: cookieHeader },
      redirect: 'manual',
    });
    const res8Api = await fetch(`${BASE_URL}/api/responder/profile`, {
      headers: { Cookie: cookieHeader },
    });
    record(
      8,
      'Resident attempts to open Responder route (/responder-dashboard.html & /api/responder/profile) -> blocked',
      res8Html.status === 403 && res8Api.status === 403,
      `GET /responder-dashboard.html->${res8Html.status}, GET /api/responder/profile->${res8Api.status}`
    );

    // 9. Resident attempts to open Admin route -> blocked
    const res9Html = await fetch(`${BASE_URL}/admin.html`, {
      headers: { Cookie: cookieHeader },
      redirect: 'manual',
    });
    const res9Api1 = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { Cookie: cookieHeader },
    });
    const res9Api2 = await fetch(`${BASE_URL}/api/users`, {
      headers: { Cookie: cookieHeader },
    });
    record(
      9,
      'Resident attempts to open Admin route (/admin.html, /api/admin/stats, /api/users) -> blocked',
      res9Html.status === 403 && res9Api1.status === 403 && res9Api2.status === 403,
      `GET /admin.html->${res9Html.status}, GET /api/admin/stats->${res9Api1.status}, GET /api/users->${res9Api2.status}`
    );

    // 10. Attempt to change role in localStorage, URL, or headers -> still blocked
    const res10TamperUrl = await fetch(`${BASE_URL}/admin.html?role=admin&role_id=1`, {
      headers: {
        Cookie: `${cookieHeader}; role=admin; geosafe_user=${encodeURIComponent(JSON.stringify({ role: 'admin', role_id: 1 }))}`,
        'X-Forwarded-Role': 'admin',
      },
      redirect: 'manual',
    });
    const res10CsrfMissing = await fetch(`${BASE_URL}/api/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        incident_type: 'Flood',
        description: 'Testing CSRF protection without token header',
        latitude: 14.4075,
        longitude: 121.0475,
      }),
    });
    record(
      10,
      'Attempt to spoof role via URL/cookies/headers & verify CSRF protection on state-changing POST',
      res10TamperUrl.status === 403 && res10CsrfMissing.status === 403,
      `Spoofed /admin.html?role=admin->${res10TamperUrl.status}, POST /api/reports without CSRF token->${res10CsrfMissing.status}`
    );

    // 11. Refresh page while logged in -> session remains valid
    const res11Session = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { Cookie: cookieHeader },
    });
    const body11 = await res11Session.json();
    const res11Dashboard = await fetch(`${BASE_URL}/api/dashboard/summary`, {
      headers: { Cookie: cookieHeader },
    });
    record(
      11,
      'Refresh page while logged in -> session remains valid via HttpOnly cookie & MySQL lookup',
      res11Session.status === 200 &&
      body11.authenticated === true &&
      body11.user?.email === testEmail &&
      res11Dashboard.status === 200,
      `GET /api/auth/session->${res11Session.status} (authenticated=${body11.authenticated}, role=${body11.user?.role_name}), GET /api/dashboard/summary->${res11Dashboard.status}`
    );

    // 7. Log out -> session invalidated and protected pages become inaccessible
    const res7Logout = await fetch(`${BASE_URL}/api/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        'X-CSRF-Token': body5.csrfToken,
      },
    });
    const res7ReplayApi = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { Cookie: cookieHeader },
    });
    const res7ReplayHtml = await fetch(`${BASE_URL}/index.html`, {
      headers: { Cookie: cookieHeader },
      redirect: 'manual',
    });
    record(
      7,
      'Log out -> session invalidated on server and replaying old cookie is blocked',
      res7Logout.status === 200 && res7ReplayApi.status === 401 && res7ReplayHtml.status === 302,
      `POST /api/logout->${res7Logout.status}, Replay GET /api/auth/session->${res7ReplayApi.status}, Replay GET /index.html->${res7ReplayHtml.status}`
    );

    // 12. Restart backend / re-open browser -> verify session & DB persistence
    const res12Login = await fetch(`${BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword, rememberMe: true }),
    });
    const cookies12 = parseSetCookieHeaders(res12Login);
    const activeCookie12 = `geosafe_session=${cookies12.jar.geosafe_session?.value}; geosafe_csrf=${cookies12.jar.geosafe_csrf?.value}`;

    await stopBackendServer(serverProc);
    serverProc = await startBackendServer();

    const res12Active = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { Cookie: activeCookie12 },
    });
    const res12RevokedStillBlocked = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { Cookie: cookieHeader },
    });

    record(
      12,
      'Restart backend server -> MySQL user persists, active session remains valid, and logged-out token stays revoked',
      res12Active.status === 200 && res12RevokedStillBlocked.status === 401,
      `After restart: Active session->${res12Active.status}, Previously logged-out session->${res12RevokedStillBlocked.status}`
    );
  } finally {
    await stopBackendServer(serverProc);

    if (initialUserCount === 0 && initialLogCount === 0 && initialAuditCount === 0) {
      const conn = await pool.getConnection();
      try {
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        await conn.query('TRUNCATE TABLE auth_security_logs');
        await conn.query('TRUNCATE TABLE audit_logs');
        await conn.query('TRUNCATE TABLE user_profiles');
        await conn.query('TRUNCATE TABLE users');
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log('[Cleanup] Restored geosafe_db to pristine 0-user fresh installation state.');
      } finally {
        conn.release();
      }
    }
    await pool.end();
  }

  results.sort((a, b) => a.num - b.num);
  console.log('\n================ FINAL 12-TEST REPORT ================');
  results.forEach((r) => {
    console.log(`#${String(r.num).padStart(2, '0')} [${r.passed ? 'PASS' : 'FAIL'}] ${r.name} — ${r.details}`);
  });
  const failed = results.filter((r) => !r.passed);
  console.log(`======================================================`);
  console.log(`TOTAL: ${results.length - failed.length}/${results.length} PASSED`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err.message);
  process.exit(1);
});

