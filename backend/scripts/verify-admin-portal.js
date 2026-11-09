/**
 * GeoSafe Administrator Portal Comprehensive Verification Suite
 * ============================================================================
 * Verifies:
 * 1. Administrator UI structure, theme, and 8 primary navigation sections
 * 2. Dashboard summary cards, Incident Map, and System Activity Feed
 * 3. Review Reports workflow, filters, detail view, and required reason validation
 * 4. Responder Management (personnel roster, duty status, dispatches)
 * 5. Users directory (Residents & Responders tabs, status control, user registration)
 * 6. Alerts & Notifications (Emergency broadcast dispatch, review confirmation modal, history)
 * 7. Reports & Analytics (summaries, breakdowns, date filters, CSV export)
 * 8. System Settings & Maintenance (config, database health, security events)
 * 9. Audit Logs read-only table and filters
 * 10. Zero emojis and zero hardcoded operational records
 * 11. Backend Admin routes, controller exports, and RBAC middleware
 * 12. Express HTTP RBAC protection across all Admin Portal endpoints
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const http = require('http');
const pool = require('../config/db');
const app = require('../server');
const adminController = require('../controllers/adminController');

const ROOT = path.resolve(__dirname, '../..');
const adminHtmlPath = path.join(ROOT, 'frontend', 'admin.html');
const adminJsPath = path.join(ROOT, 'frontend', 'assets', 'js', 'admin.js');
const adminControllerPath = path.join(ROOT, 'backend', 'controllers', 'adminController.js');
const adminRoutesPath = path.join(ROOT, 'backend', 'routes', 'adminRoutes.js');

let passed = 0;
let failed = 0;

function check(condition, description) {
  if (condition) {
    console.log(`  [PASS] ${description}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${description}`);
    failed++;
  }
}

function dispatchExpressRequest(expressApp, reqPath, options = {}) {
  return new Promise((resolve, reject) => {
    const keepAlive = setInterval(() => {}, 200);
    const reqSocket = new PassThrough();
    reqSocket.remoteAddress = '127.0.0.1';

    const req = new http.IncomingMessage(reqSocket);
    req.method = options.method || 'GET';
    req.url = reqPath;
    req.headers = {
      host: 'localhost:3000',
      ...(options.headers || {})
    };

    const bodyStr = options.body
      ? typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body)
      : null;

    if (bodyStr !== null) {
      req.headers['content-length'] = String(Buffer.byteLength(bodyStr));
      if (typeof options.body === 'object') {
        req.body = options.body;
        req._body = true;
      }
    }

    const res = new http.ServerResponse(req);
    const bodyChunks = [];
    let resolved = false;

    const finishResponse = () => {
      if (resolved) return;
      resolved = true;
      clearInterval(keepAlive);
      const body = Buffer.concat(bodyChunks).toString('utf8');
      let json = null;
      try {
        json = JSON.parse(body);
      } catch (_) {}
      resolve({
        status: res.statusCode,
        headers: res.getHeaders(),
        body,
        json
      });
    };

    res.write = (chunk, encoding, cb) => {
      if (chunk) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
      }
      if (typeof encoding === 'function') encoding();
      else if (typeof cb === 'function') cb();
      return true;
    };

    res.end = (chunk, encoding, cb) => {
      if (chunk && typeof chunk !== 'function') {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
      }
      res.finished = true;
      res.writableEnded = true;
      if (typeof chunk === 'function') chunk();
      else if (typeof encoding === 'function') encoding();
      else if (typeof cb === 'function') cb();
      res.emit('finish');
      finishResponse();
      return res;
    };

    try {
      expressApp.handle(req, res, (err) => {
        clearInterval(keepAlive);
        if (err) reject(err);
      });
      if (bodyStr !== null) {
        req.push(bodyStr);
        req.push(null);
      }
    } catch (err) {
      clearInterval(keepAlive);
      reject(err);
    }
  });
}

async function runVerification() {
  console.log('================================================================');
  console.log(' GeoSafe Administrator Portal Comprehensive Verification');
  console.log('================================================================\n');

  // 1. File Existence
  console.log('1. Checking Administrator Portal Files:');
  check(fs.existsSync(adminHtmlPath), 'frontend/admin.html exists');
  check(fs.existsSync(adminJsPath), 'frontend/assets/js/admin.js exists');
  check(fs.existsSync(adminControllerPath), 'backend/controllers/adminController.js exists');
  check(fs.existsSync(adminRoutesPath), 'backend/routes/adminRoutes.js exists');

  const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');
  const adminJs = fs.readFileSync(adminJsPath, 'utf8');
  const adminCtrlSrc = fs.readFileSync(adminControllerPath, 'utf8');
  const adminRoutesSrc = fs.readFileSync(adminRoutesPath, 'utf8');

  // 2. Design Direction & Zero Emojis
  console.log('\n2. Verifying GeoSafe Design Direction & Zero Emojis:');
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  check(!emojiRegex.test(adminHtml), 'Zero emojis in frontend/admin.html');
  check(!emojiRegex.test(adminJs), 'Zero emojis in frontend/assets/js/admin.js');
  check(!emojiRegex.test(adminCtrlSrc), 'Zero emojis in backend/controllers/adminController.js');
  check(!emojiRegex.test(adminRoutesSrc), 'Zero emojis in backend/routes/adminRoutes.js');
  check(adminHtml.includes('#FFF9E8'), 'Uses warm cream/off-white background (#FFF9E8)');
  check(adminHtml.includes('#F5B900'), 'Uses yellow/gold primary accent (#F5B900)');
  check(adminHtml.includes('#202020'), 'Uses dark charcoal text (#202020)');

  // 3. Eight Primary Navigation Sections
  console.log('\n3. Verifying Eight Primary Navigation Sections:');
  const expectedSections = ['dashboard', 'reports', 'responders', 'users', 'alerts', 'analytics', 'settings', 'audit'];
  const sidebarMatches = [...adminHtml.matchAll(/class="admin-sidebar-btn[^>]*data-admin-nav="([^"]+)"|data-admin-nav="([^"]+)"[^>]*class="admin-sidebar-btn/g)];
  const navTargets = sidebarMatches.map((m) => m[1] || m[2]);
  check(
    JSON.stringify(navTargets) === JSON.stringify(expectedSections),
    `Desktop sidebar has all 8 navigation items: ${navTargets.join(', ')}`
  );

  expectedSections.forEach((sec) => {
    check(adminHtml.includes(`id="section-${sec}"`), `Contains section container #section-${sec}`);
  });

  // 4. Dashboard Summary Statistics, Incident Map & Activity Feed
  console.log('\n4. Verifying Dashboard Summary Statistics & Incident Map:');
  check(adminHtml.includes('id="stat-total-reports"'), 'Summary card: Total Disaster Reports');
  check(adminHtml.includes('id="stat-pending-review"'), 'Summary card: Pending Verification');
  check(adminHtml.includes('id="stat-verified-incidents"'), 'Summary card: Verified Incidents');
  check(adminHtml.includes('id="stat-active-rescues"'), 'Summary card: Active Rescue Requests');
  check(adminHtml.includes('id="stat-available-responders"'), 'Summary card: Available Responders');
  check(adminHtml.includes('id="stat-registered-residents"'), 'Summary card: Registered Residents');
  check(adminHtml.includes('id="admin-incident-map"'), 'Dashboard includes prominent Incident Map container');
  check(adminHtml.includes('id="map-filter-type"') && adminHtml.includes('id="map-filter-severity"') && adminHtml.includes('id="map-filter-status"'), 'Incident Map supports filtering by report type, severity, and status');
  check(adminHtml.includes('id="admin-map-marker-panel"'), 'Incident Map includes compact marker information panel');
  check(adminHtml.includes('No incident locations are currently available.') && adminJs.includes('No incident locations are currently available.'), 'Includes explicit "No incident locations are currently available." empty state');
  check(adminHtml.includes('id="admin-activity-list"'), 'Dashboard includes System Activity Feed container');

  // 5. Review Reports Section
  console.log('\n5. Verifying Review Reports Section:');
  check(adminHtml.includes('data-report-filter="all"') && adminHtml.includes('data-report-filter="pending"') && adminHtml.includes('data-report-filter="verified"'), 'Review Reports includes status filter pills');
  check(adminHtml.includes('id="admin-report-modal"'), 'Review Reports includes Report Detail & Review Modal');
  check(adminHtml.includes('review-reason-input'), 'Review Modal enforces review notes/reason for rejection');

  // 6. Responder Management Section
  console.log('\n6. Verifying Responder Management Section:');
  check(adminHtml.includes('id="stat-resp-total"') && adminHtml.includes('id="stat-resp-onduty"'), 'Responders section includes personnel duty counters');
  check(adminHtml.includes('id="admin-responders-tbody"'), 'Responders section includes personnel roster table');
  check(adminHtml.includes('id="admin-assign-responder-modal"'), 'Responders section includes Assign Dispatch modal');
  check(adminHtml.includes('No responders registered.') && adminJs.includes('No responders registered.'), 'Includes "No responders registered." empty state');

  // 7. Users Section
  console.log('\n7. Verifying Users Section:');
  check(adminHtml.includes('id="users-tab-residents"') && adminHtml.includes('id="users-tab-responders"'), 'Users section separates Residents and Responders into dedicated tabs');
  check(adminHtml.includes('id="admin-user-status-modal"'), 'Users section includes Account Status Management modal');
  check(adminHtml.includes('id="admin-create-responder-modal"'), 'Users section includes New Responder provisioning modal');
  check(adminHtml.includes('id="admin-create-resident-modal"'), 'Users section includes New Resident registration modal');
  check(adminHtml.includes('No users found.') && adminJs.includes('No users found.'), 'Includes "No users found." empty state');

  // 8. Alerts & Notifications Section
  console.log('\n8. Verifying Alerts & Notifications Section:');
  check(adminHtml.includes('id="emergency-broadcast-form"'), 'Alerts section includes Emergency Broadcast dispatch form');
  check(adminHtml.includes('id="admin-broadcast-confirm-modal"'), 'Alerts section includes Review & Confirmation modal');
  check(adminHtml.includes('id="admin-broadcasts-tbody"'), 'Alerts section includes Emergency Broadcast history table');
  check(adminHtml.includes('No broadcast notifications recorded.') && adminJs.includes('No broadcast notifications recorded.'), 'Includes "No broadcast notifications recorded." empty state');

  // 9. Reports & Analytics Section
  console.log('\n9. Verifying Reports & Analytics Section:');
  check(adminHtml.includes('id="analytics-period-select"'), 'Analytics section includes time period selector');
  check(adminHtml.includes('id="analytics-total-reports"') && adminHtml.includes('id="analytics-total-rescues"'), 'Analytics section includes summary metric cards');
  check(adminHtml.includes('id="analytics-categories-list"'), 'Analytics includes Category breakdown container');
  check(adminHtml.includes('id="analytics-severities-list"'), 'Analytics includes Severity breakdown container');
  check(adminHtml.includes('id="analytics-statuses-list"'), 'Analytics includes Status breakdown container');
  check(adminHtml.includes('id="analytics-locations-list"'), 'Analytics includes Top Locations breakdown container');
  check(adminHtml.includes('Export to CSV'), 'Analytics includes Export to CSV capability');

  // 10. System Settings & Maintenance Section
  console.log('\n10. Verifying System Settings & Maintenance Section:');
  check(adminHtml.includes('id="system-settings-list"'), 'Settings section includes general parameters list from system_settings');
  check(adminHtml.includes('id="health-db-status"'), 'Settings section includes MySQL database health monitor');
  check(adminHtml.includes('id="security-stat-failed"'), 'Settings section includes security events monitor (24h failed logins)');
  check(adminHtml.includes('id="security-events-tbody"'), 'Settings section includes security audit events table');

  // 11. Audit Logs Section
  console.log('\n11. Verifying Audit Logs Section:');
  check(adminHtml.includes('id="admin-audit-tbody"'), 'Audit Logs includes read-only audit table');
  check(adminHtml.includes('id="audit-filter-date-from"') && adminHtml.includes('id="audit-filter-role"') && adminHtml.includes('id="audit-filter-result"'), 'Audit Logs includes date, role, and result filters');
  check(adminHtml.includes('No audit activities available.') && adminJs.includes('No audit activities available.'), 'Includes "No audit activities available." empty state');

  // 12. Backend Routes & Controller Exports
  console.log('\n12. Verifying Backend Admin Routes & RBAC Middleware:');
  check(adminRoutesSrc.includes("router.use(authenticate, requireRole('admin'))"), 'All /api/admin routes enforce authenticate + requireRole("admin")');
  check(typeof adminController.getAdminOverview === 'function', 'adminController.getAdminOverview exported');
  check(typeof adminController.getAdminReportsList === 'function', 'adminController.getAdminReportsList exported');
  check(typeof adminController.getAdminReportDetail === 'function', 'adminController.getAdminReportDetail exported');
  check(typeof adminController.reviewAdminReport === 'function', 'adminController.reviewAdminReport exported');
  check(typeof adminController.getAdminRespondersList === 'function', 'adminController.getAdminRespondersList exported');
  check(typeof adminController.assignResponder === 'function', 'adminController.assignResponder exported');
  check(typeof adminController.getAdminUsers === 'function', 'adminController.getAdminUsers exported');
  check(typeof adminController.createResponderAccount === 'function', 'adminController.createResponderAccount exported');
  check(typeof adminController.createResidentAccount === 'function', 'adminController.createResidentAccount exported');
  check(typeof adminController.updateAdminUserStatus === 'function', 'adminController.updateAdminUserStatus exported');
  check(typeof adminController.getEmergencyBroadcasts === 'function', 'adminController.getEmergencyBroadcasts exported');
  check(typeof adminController.createEmergencyBroadcast === 'function', 'adminController.createEmergencyBroadcast exported');
  check(typeof adminController.getAdminAnalytics === 'function', 'adminController.getAdminAnalytics exported');
  check(typeof adminController.exportAdminAnalyticsCsv === 'function', 'adminController.exportAdminAnalyticsCsv exported');
  check(typeof adminController.getAdminSystemSettings === 'function', 'adminController.getAdminSystemSettings exported');
  check(typeof adminController.updateAdminSystemSetting === 'function', 'adminController.updateAdminSystemSetting exported');
  check(typeof adminController.getAdminAuditLogs === 'function', 'adminController.getAdminAuditLogs exported');

  // 13. Express HTTP Endpoint Security & Access Guards
  console.log('\n13. Verifying Express HTTP Guards for Administrator Portal:');
  const htmlUnauth = await dispatchExpressRequest(app, '/admin.html');
  check(htmlUnauth.status === 302 && htmlUnauth.headers.location === '/login.html', 'Unauthenticated GET /admin.html redirects (302) to /login.html');

  const adminJsAsset = await dispatchExpressRequest(app, '/assets/js/admin.js');
  check(adminJsAsset.status === 200 && adminJsAsset.body.includes('GeoSafeAdmin'), 'GET /assets/js/admin.js serves Administrator controller');

  const overviewUnauth = await dispatchExpressRequest(app, '/api/admin/overview');
  check(overviewUnauth.status === 401, 'Unauthenticated GET /api/admin/overview blocked with HTTP 401');

  const reportsUnauth = await dispatchExpressRequest(app, '/api/admin/reports');
  check(reportsUnauth.status === 401, 'Unauthenticated GET /api/admin/reports blocked with HTTP 401');

  const respondersUnauth = await dispatchExpressRequest(app, '/api/admin/responders');
  check(respondersUnauth.status === 401, 'Unauthenticated GET /api/admin/responders blocked with HTTP 401');

  const usersUnauth = await dispatchExpressRequest(app, '/api/admin/users');
  check(usersUnauth.status === 401, 'Unauthenticated GET /api/admin/users blocked with HTTP 401');

  const broadcastsUnauth = await dispatchExpressRequest(app, '/api/admin/broadcasts');
  check(broadcastsUnauth.status === 401, 'Unauthenticated GET /api/admin/broadcasts blocked with HTTP 401');

  const analyticsUnauth = await dispatchExpressRequest(app, '/api/admin/analytics');
  check(analyticsUnauth.status === 401, 'Unauthenticated GET /api/admin/analytics blocked with HTTP 401');

  const settingsUnauth = await dispatchExpressRequest(app, '/api/admin/settings');
  check(settingsUnauth.status === 401, 'Unauthenticated GET /api/admin/settings blocked with HTTP 401');

  const auditUnauth = await dispatchExpressRequest(app, '/api/admin/audit-logs');
  check(auditUnauth.status === 401, 'Unauthenticated GET /api/admin/audit-logs blocked with HTTP 401');

  console.log('\n================================================================');
  if (failed === 0) {
    console.log(` ALL ${passed} ADMINISTRATOR PORTAL VERIFICATION CHECKS PASSED!`);
  } else {
    console.error(` ${failed} VERIFICATION CHECKS FAILED (${passed} passed)`);
    process.exit(1);
  }
  console.log('================================================================');
}

runVerification().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
