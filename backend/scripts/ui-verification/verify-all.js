/**
 * Complete Verification Script for GeoSafe Sections 19, 20 & 21
 */
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '../../../frontend');

console.log('================================================================');
console.log(' GeoSafe Verification Suite: Sections 19, 20, and 21 Compliance');
console.log('================================================================\n');

let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName}`);
    failedTests++;
  }
}

// 1. Check all 10 HTML pages exist and contain responsive padding
console.log('1. Checking HTML Pages and Responsive Mobile Nav Padding:');
const requiredPages = [
  'index.html',
  'report-incident.html',
  'my-reports.html',
  'rescue-requests.html',
  'hazard-alerts.html',
  'evacuation-centers.html',
  'family-safety.html',
  'notifications.html',
  'profile.html',
  'settings.html'
];

requiredPages.forEach(page => {
  const filePath = path.join(rootDir, page);
  const exists = fs.existsSync(filePath);
  assert(exists, `Page exists: ${page}`);
  if (exists) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert(content.includes('pb-28 md:pb-8') || content.includes('pb-28'), `${page} includes bottom nav clearance padding (pb-28)`);
    assert((content.includes('geosafe-sidebar-container') && content.includes('geosafe-header-container')) || content.includes('geosafe-nav-container'), `${page} has navigation shell containers`);
  }
});

// 2. Check Mock Data is strictly FRESH SYSTEM (Section 20)
console.log('\n2. Verifying Section 20 Fresh System Initial State:');
const mockDataContent = fs.readFileSync(path.join(rootDir, 'assets/js/mock-data.js'), 'utf8');

// Evaluate mock-data.js in mock environment
global.window = {};
eval(mockDataContent);

const state = window.FRESH_SYSTEM_INITIAL_STATE;
assert(state !== undefined, 'FRESH_SYSTEM_INITIAL_STATE is defined');
assert(Array.isArray(state.reports) && state.reports.length === 0, 'Initial reports array is EMPTY (length 0)');
assert(Array.isArray(state.rescueRequests) && state.rescueRequests.length === 0, 'Initial rescueRequests array is EMPTY (length 0)');
assert(Array.isArray(state.hazardAlerts) && state.hazardAlerts.length === 0, 'Initial hazardAlerts array is EMPTY (length 0)');
assert(Array.isArray(state.evacuationCenters) && state.evacuationCenters.length === 0, 'Initial evacuationCenters array is EMPTY (length 0)');
assert(Array.isArray(state.familyMembers) && state.familyMembers.length === 0, 'Initial familyMembers array is EMPTY (length 0)');
assert(Array.isArray(state.notifications) && state.notifications.length === 0, 'Initial notifications array is EMPTY (length 0)');
assert(window.GEOSAFE_CONFIG && window.GEOSAFE_CONFIG.USE_MOCK_DATA === false, 'USE_MOCK_DATA is FALSE (Prepared for real REST API / DB)');

// 3. Test Store methods and dynamic data calculations
console.log('\n3. Testing Store Methods with In-Memory Storage:');
global.navigator = { onLine: true };
global.sessionStorage = {
  _data: {},
  getItem(key) { return this._data[key] || null; },
  setItem(key, val) { this._data[key] = String(val); },
  removeItem(key) { delete this._data[key]; },
  clear() { this._data = {}; }
};
global.CustomEvent = class CustomEvent { constructor(type, detail) { this.type = type; this.detail = detail; } };
global.window.addEventListener = () => {};
global.window.dispatchEvent = () => {};

const storeContent = fs.readFileSync(path.join(rootDir, 'assets/js/store.js'), 'utf8');
(0, eval)(storeContent);

async function testStore() {
  const store = global.window.geoSafeStore;
  
  // Test Initial Empty States
  const reports = await store.getReports();
  assert(reports.length === 0, 'store.getReports() returns 0 items');

  const rescues = await store.getRescueRequests();
  assert(rescues.length === 0, 'store.getRescueRequests() returns 0 items');

  const alerts = await store.getHazardAlerts();
  assert(alerts.length === 0, 'store.getHazardAlerts() returns 0 items');

  const centers = await store.getEvacuationCenters();
  assert(centers.length === 0, 'store.getEvacuationCenters() returns 0 items');

  const members = await store.getFamilyMembers();
  assert(members.length === 0, 'store.getFamilyMembers() returns 0 items');

  const notifs = await store.getNotifications();
  assert(notifs.length === 0, 'store.getNotifications() returns 0 items');

  const summary = await store.getDashboardSummary();
  assert(summary.counts.total === 0, 'summary.counts.total is 0');
  assert(summary.counts.pending === 0, 'summary.counts.pending is 0');
  assert(summary.counts.verified === 0, 'summary.counts.verified is 0');
  assert(summary.counts.resolved === 0, 'summary.counts.resolved is 0');
  assert(summary.activeRescue === null, 'summary.activeRescue is null (0 active rescues)');

  // Test Adding Family Member Invitation (Section 21.C)
  console.log('\n4. Testing Section 21 Family Safety Tracker Dynamics:');
  const addedMember = await store.addFamilyMember({
    name: 'Juan Dela Cruz',
    relationship: 'Spouse',
    email: 'juan.delacruz@example.com'
  });
  assert(addedMember.name === 'Juan Dela Cruz', 'Member added with correct name');
  assert(addedMember.relationship === 'Spouse', 'Member added with correct relationship');
  assert(addedMember.locationSharing.status === 'Not Sharing', 'Member locationSharing.status defaults to "Not Sharing"');
  assert(addedMember.locationSharing.enabled === false, 'Location sharing consent is disabled by default');
  assert(Array.isArray(addedMember.locationHistory) && addedMember.locationHistory.length === 0, 'Location history starts empty (no fake history)');

  // Test Toggling Consent to Sharing (Section 21.E)
  const updatedMember = await store.toggleFamilyLocationSharing(addedMember.id, true);
  assert(updatedMember.locationSharing.enabled === true, 'Location sharing enabled after explicit consent');
  assert(updatedMember.locationSharing.status === 'Sharing Location', 'Status updated to "Sharing Location"');
  assert(updatedMember.locationSharing.coordinates !== null, 'Coordinates present when sharing is enabled');

  // Test Revoking Consent
  const revokedMember = await store.toggleFamilyLocationSharing(addedMember.id, false);
  assert(revokedMember.locationSharing.enabled === false, 'Location sharing revoked');
  assert(revokedMember.locationSharing.status === 'Not Sharing', 'Status updated back to "Not Sharing"');

  // 5. Check exact string matches for Section 20 required empty states
  console.log('\n5. Checking Exact Section 20 & 21 Empty State Strings:');
  const myReportsHtml = fs.readFileSync(path.join(rootDir, 'my-reports.html'), 'utf8');
  assert(myReportsHtml.includes('No reports submitted yet.'), 'my-reports.html contains: "No reports submitted yet."');

  const rescueRequestsHtml = fs.readFileSync(path.join(rootDir, 'rescue-requests.html'), 'utf8');
  assert(rescueRequestsHtml.includes('No active rescue requests.'), 'rescue-requests.html contains: "No active rescue requests."');

  const hazardAlertsHtml = fs.readFileSync(path.join(rootDir, 'hazard-alerts.html'), 'utf8');
  assert(hazardAlertsHtml.includes('No alerts at the moment.'), 'hazard-alerts.html contains: "No alerts at the moment."');

  const familySafetyHtml = fs.readFileSync(path.join(rootDir, 'family-safety.html'), 'utf8');
  assert(familySafetyHtml.includes('No family members added yet.'), 'family-safety.html contains: "No family members added yet."');
  assert(familySafetyHtml.includes('No shared family locations available.'), 'family-safety.html contains: "No shared family locations available."');

  const notificationsHtml = fs.readFileSync(path.join(rootDir, 'notifications.html'), 'utf8');
  assert(notificationsHtml.includes('No notifications available.'), 'notifications.html contains: "No notifications available."');

  console.log('\n================================================================');
  if (failedTests === 0) {
    console.log(' ALL VERIFICATION CHECKS PASSED PERFECTLY (0 FAILURES)!');
  } else {
    console.error(` COMPLETED WITH ${failedTests} FAILURE(S).`);
    process.exit(1);
  }
  console.log('================================================================');
}

testStore().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
