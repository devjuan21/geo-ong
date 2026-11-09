/**
 * Verification Script for Resident Homepage UI Refinement
 */
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '../../../frontend');
let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName}`);
    failedTests++;
  }
}

console.log('================================================================');
console.log(' GeoSafe Resident Homepage Refinement Verification Suite');
console.log('================================================================\n');

// 1. Verify HTML Structure & Content
console.log('1. Checking index.html Layout & Information Cards:');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

assert(indexHtml.includes('geosafe-nav-container'), 'index.html contains #geosafe-nav-container for compact header');
assert(indexHtml.includes('report-rescue.html'), 'Report / Rescue action points to report-rescue.html');
assert(indexHtml.includes('Report / Rescue'), 'Single unified Report / Rescue action button is present on homepage');
assert(indexHtml.includes('Community Map'), 'Community Map heading is present');
assert(indexHtml.includes('active-incidents-count'), 'active-incidents-count element is present');
assert(indexHtml.includes('No reported incidents in your area.'), 'Exact empty state: "No reported incidents in your area."');
assert(indexHtml.includes('Recent Reports'), 'Recent Reports heading is present');
assert(indexHtml.includes('No community reports available.'), 'Exact empty state: "No community reports available."');
assert(indexHtml.includes('Hazard Alerts'), 'Hazard Alerts card is present');
assert(indexHtml.includes('No active hazard alerts.'), 'Exact empty state: "No active hazard alerts."');
assert(indexHtml.includes('Evacuation Centers'), 'Evacuation Centers card is present');
assert(indexHtml.includes('No evacuation centers available.'), 'Exact empty state: "No evacuation centers available."');
assert(indexHtml.includes('Family Safety'), 'Compact Family Safety card is present');
assert(indexHtml.includes('No family members added.'), 'Exact empty state: "No family members added."');

// 2. Verify Compact Header in components.js
console.log('\n2. Checking Compact Header in components.js:');
const componentsContent = fs.readFileSync(path.join(rootDir, 'assets/js/components.js'), 'utf8');
assert(componentsContent.includes('header-greeting-label'), 'Dynamic greeting element exists in header');
assert(componentsContent.includes('header-resident-name'), 'Dynamic resident name element exists in header');
assert(componentsContent.includes('header-notif-btn'), 'Notification bell button exists in header');
assert(componentsContent.includes('header-notif-badge'), 'Notification unread indicator badge exists in header');
assert(componentsContent.includes('header-profile-avatar'), 'Resident profile avatar exists in header');
assert(componentsContent.includes('openNotificationsModal'), 'Notification modal trigger exists');

// 3. Verify Fresh System State with Dynamic Data
console.log('\n3. Verifying Fresh System Dynamic Retrieval on Homepage:');
const mockDataContent = fs.readFileSync(path.join(rootDir, 'assets/js/mock-data.js'), 'utf8');
global.window = {};
eval(mockDataContent);

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

async function testHomepageData() {
  const store = global.window.geoSafeStore;

  const publicReports = await store.getPublicIncidentReports();
  assert(publicReports.length === 0, 'Initial public community reports count is 0');

  const alerts = await store.getHazardAlerts();
  assert(alerts.length === 0, 'Initial hazard alerts count is 0');

  const centers = await store.getEvacuationCenters();
  assert(centers.length === 0, 'Initial evacuation centers count is 0');

  const members = await store.getFamilyMembers();
  assert(members.length === 0, 'Initial family members count is 0');

  const profile = await store.getResidentProfile();
  assert(profile !== undefined, 'Resident profile is accessible');

  console.log('\n================================================================');
  if (failedTests === 0) {
    console.log(' ALL 25 HOMEPAGE REFINEMENT CHECKS PASSED PERFECTLY (0 FAILURES)!');
  } else {
    console.error(` COMPLETED WITH ${failedTests} FAILURE(S).`);
    process.exit(1);
  }
  console.log('================================================================');
}

testHomepageData().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

