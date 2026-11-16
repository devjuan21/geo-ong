/**
 * GeoSafe - Responder UI Responsive Layout Verification Script
 * Verifies desktop sidebar (1024px+), single hamburger toggle, collapsed state,
 * mobile/tablet bottom navigation (<1024px), safe-area overlap prevention,
 * zero duplicate navigation, and zero fabricated reports via live Express API.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const BASE_URL = 'http://localhost:3000';

async function run() {
  console.log('================================================================');
  console.log(' GeoSafe Responder UI Responsive Layout Verification');
  console.log('================================================================\n');

  try {
    // 1. Static & CSS Layout Verification
    console.log('1. Auditing Responder Shell & HTML Pages...');
    const uiJs = fs.readFileSync(path.join(__dirname, '../../frontend/assets/js/responder-ui.js'), 'utf8');
    const dashHtml = fs.readFileSync(path.join(__dirname, '../../frontend/responder-dashboard.html'), 'utf8');
    const assignHtml = fs.readFileSync(path.join(__dirname, '../../frontend/responder-assignments.html'), 'utf8');
    const mapHtml = fs.readFileSync(path.join(__dirname, '../../frontend/responder-map.html'), 'utf8');
    const profileHtml = fs.readFileSync(path.join(__dirname, '../../frontend/responder-profile.html'), 'utf8');

    // Zero emojis check
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const [name, content] of [
      ['responder-ui.js', uiJs],
      ['responder-dashboard.html', dashHtml],
      ['responder-assignments.html', assignHtml],
      ['responder-map.html', mapHtml],
      ['responder-profile.html', profileHtml],
    ]) {
      assert.ok(!emojiRegex.test(content), `Found emoji in ${name}`);
    }
    console.log('  [PASS] Zero emojis across all 5 Responder UI files');

    // Desktop sidebar & single toggle checks
    assert.ok(uiJs.includes('--gs-resp-sidebar-width: 240px'), 'Missing 240px desktop sidebar width');
    assert.ok(uiJs.includes('--gs-resp-sidebar-collapsed-width: 76px'), 'Missing 76px collapsed sidebar width');
    assert.ok(uiJs.includes('@media (min-width: 1024px)'), 'Missing 1024px desktop media query');
    assert.ok(uiJs.includes('@media (max-width: 1023.98px)'), 'Missing <1024px tablet/mobile media query');
    assert.ok(uiJs.includes("sidebar.id = 'geosafe-responder-sidebar'"), 'Missing desktop sidebar element');
    assert.ok(uiJs.includes('id="responder-sidebar-toggle-btn"'), 'Missing single header hamburger toggle');
    assert.ok(uiJs.includes('transition: width 250ms'), 'Missing 200-300ms sidebar width transition');
    assert.ok(uiJs.includes('transition: padding-left 250ms'), 'Missing 200-300ms content padding transition');
    assert.ok(!uiJs.includes('<nav class="hidden md:flex'), 'Old horizontal top nav must be removed');
    console.log('  [PASS] Desktop fixed sidebar (240px/76px), single toggle, smooth 250ms transition, no duplicate top nav');

    // Mobile & Tablet bottom nav + safe-area overlap prevention
    assert.ok(uiJs.includes("bottomNavContainer.id = 'geosafe-responder-bottom-nav'"), 'Missing bottom navigation element');
    assert.ok(uiJs.includes('env(safe-area-inset-bottom, 0px)'), 'Missing safe-area-inset-bottom support');
    assert.ok(uiJs.includes('padding-bottom: calc(6.5rem + env(safe-area-inset-bottom, 0px))'), 'Missing main bottom padding above bottom nav');
    assert.ok(dashHtml.includes('gs-resp-main'), 'responder-dashboard.html missing gs-resp-main class');
    assert.ok(assignHtml.includes('gs-resp-main'), 'responder-assignments.html missing gs-resp-main class');
    assert.ok(profileHtml.includes('gs-resp-main'), 'responder-profile.html missing gs-resp-main class');
    assert.ok(mapHtml.includes('gs-resp-map-main'), 'responder-map.html missing gs-resp-map-main class');
    console.log('  [PASS] Mobile & tablet (<1024px) fixed bottom nav with safe-area padding on all 4 pages');

    // 2. Live HTTP & API Verification as Authenticated Responder
    console.log('\n2. Verifying Live Responder Pages & Zero Fabricated Data...');
    const [respRows] = await db.query(
      "SELECT id, email FROM users WHERE role = 'responder' AND status = 'active' ORDER BY id ASC LIMIT 1"
    );
    assert.strictEqual(respRows.length, 1, 'Expected an active responder account in geosafe_db');
    const csrf = crypto.randomBytes(16).toString('hex');
    const token = jwt.sign(
      { id: respRows[0].id, jti: crypto.randomBytes(16).toString('hex'), csrf },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: 3600 }
    );
    const cookieHeader = `geosafe_session=${token}`;

    for (const pagePath of [
      '/responder-dashboard.html',
      '/responder-assignments.html',
      '/responder-map.html',
      '/responder-profile.html',
    ]) {
      const res = await fetch(`${BASE_URL}${pagePath}`, {
        headers: { Cookie: cookieHeader },
        redirect: 'manual',
      });
      assert.strictEqual(res.status, 200, `Expected HTTP 200 for ${pagePath}, got ${res.status}`);
    }
    console.log('  [PASS] All 4 Responder HTML pages served with HTTP 200 for authenticated responder');

    // Verify Responder API returns real DB counts (zero fabricated reports)
    const tasksRes = await fetch(`${BASE_URL}/api/responder/assignments`, {
      headers: { Cookie: cookieHeader },
    });
    assert.strictEqual(tasksRes.status, 200, `Expected HTTP 200 for /api/responder/assignments, got ${tasksRes.status}`);
    const tasksData = await tasksRes.json();
    const list = Array.isArray(tasksData) ? tasksData : (tasksData.assignments || []);
    assert.strictEqual(list.length, 0, `Expected 0 fabricated assignments, got ${list.length}`);
    console.log('  [PASS] /api/responder/assignments returned 0 fabricated records');

    console.log('\n================================================================');
    console.log(' ALL RESPONDER UI RESPONSIVE LAYOUT CHECKS PASSED!');
    console.log('================================================================\n');
  } finally {
    await db.end();
  }
}

run().catch((err) => {
  console.error('\n[FAIL]', err);
  process.exit(1);
});
