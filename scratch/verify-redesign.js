/**
 * Verification Suite for GeoSafe Mobile-First 4-Navigation Redesign
 */
const fs = require('fs');
const path = require('path');

const rootDir = 'c:\\VSCODE-PROJECTS\\Geosafee';
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
console.log(' GeoSafe Mobile-First 4-Item Navigation & Mapping Verification');
console.log('================================================================\n');

// 1. Verify Exactly 4 Navigation Items
console.log('1. Verifying Exactly 4 Primary Navigation Items:');
const componentsContent = fs.readFileSync(path.join(rootDir, 'assets/js/components.js'), 'utf8');

global.window = {};
global.document = {
  getElementById: () => null,
  createElement: () => ({ appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }),
  body: { appendChild: () => {}, prepend: () => {} },
  querySelector: () => null
};
eval(componentsContent);

const navItems = window.GeoSafeUI.navItems;
assert(Array.isArray(navItems), 'GeoSafeUI.navItems is an array');
assert(navItems.length === 4, `GeoSafeUI.navItems has EXACTLY 4 items (found ${navItems.length})`);

const expectedItems = [
  { id: 'home', href: 'index.html', label: 'Home' },
  { id: 'evacuation-routes', href: 'evacuation-routes.html', label: 'Evacuation Routes' },
  { id: 'report-rescue', href: 'report-rescue.html', label: 'Report / Rescue', isEmergencyAction: true },
  { id: 'family', href: 'family.html', label: 'Family Safety' }
];

expectedItems.forEach((exp, idx) => {
  const item = navItems[idx];
  assert(item && item.id === exp.id, `Nav item ${idx + 1} has id '${exp.id}'`);
  assert(item && item.href === exp.href, `Nav item ${idx + 1} points to '${exp.href}'`);
  if (exp.isEmergencyAction) {
    assert(item.isEmergencyAction === true, `Report / Rescue item is marked as emergency action`);
  }
});

// 2. Verify Core 4 HTML Pages Exist and have bottom nav clearance
console.log('\n2. Verifying Core 4 HTML Pages and Responsive Clearance:');
const corePages = ['index.html', 'evacuation-routes.html', 'report-rescue.html', 'family.html'];

corePages.forEach(page => {
  const filePath = path.join(rootDir, page);
  const exists = fs.existsSync(filePath);
  assert(exists, `Page exists: ${page}`);
  if (exists) {
    const html = fs.readFileSync(filePath, 'utf8');
    assert(html.includes('geosafe-nav-container'), `${page} includes #geosafe-nav-container`);
    assert(html.includes('pb-28'), `${page} includes mobile bottom navigation clearance padding (pb-28)`);
    assert(html.includes('leaflet@1.9.4'), `${page} includes Leaflet.js v1.9.4`);
    assert(html.includes('mapping-service.js'), `${page} imports mapping-service.js`);
  }
});

// 3. Verify Mapping Service Architecture (Sections 7 & 8)
console.log('\n3. Verifying Mapping Service Architecture:');
const mappingContent = fs.readFileSync(path.join(rootDir, 'assets/js/mapping-service.js'), 'utf8');
eval(mappingContent);

const mapping = window.GeoSafeMapping;
assert(mapping !== undefined, 'window.GeoSafeMapping is defined');
assert(mapping.config.tiles.url === 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', 'OSM official tile endpoint configured');
assert(mapping.config.tiles.attribution.includes('OpenStreetMap') && mapping.config.tiles.attribution.includes('contributors'), 'OSM attribution configured');
assert(mapping.config.routing.baseUrl === 'https://router.project-osrm.org/route/v1/foot', 'OSRM Foot profile endpoint configured');
assert(mapping.config.geocoding.baseUrl === 'https://nominatim.openstreetmap.org/reverse', 'OSM Nominatim reverse geocode endpoint configured');
assert(mapping.config.externalDirections.baseUrl === 'https://www.openstreetmap.org/directions', 'OSM external directions endpoint configured');

assert(mapping.formatDistance(450) === '450 m', 'formatDistance formats <1000m correctly');
assert(mapping.formatDistance(1500) === '1.50 km', 'formatDistance formats >=1000m correctly');
assert(mapping.formatDuration(300) === '5 mins', 'formatDuration formats minutes correctly');
assert(mapping.formatDuration(3900) === '1 hr 5 mins', 'formatDuration formats hours and minutes correctly');

// 4. Verify Exact Required Empty State Strings (Section 9)
console.log('\n4. Verifying Exact Section 9 Empty State Strings:');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
assert(indexHtml.includes('No reported incidents in your area'), 'index.html contains: "No reported incidents in your area."');
assert(indexHtml.includes('No community reports available'), 'index.html contains: "No community reports available."');
assert(indexHtml.includes('No active hazard alerts.'), 'index.html contains: "No active hazard alerts."');

const evacHtml = fs.readFileSync(path.join(rootDir, 'evacuation-routes.html'), 'utf8');
assert(evacHtml.includes('No evacuation centers are currently available.'), 'evacuation-routes.html contains: "No evacuation centers are currently available."');

const familyHtml = fs.readFileSync(path.join(rootDir, 'family.html'), 'utf8');
assert(familyHtml.includes('No family members added yet.'), 'family.html contains: "No family members added yet."');
assert(familyHtml.includes('No shared family locations available.'), 'family.html contains: "No shared family locations available."');

// 5. Test Dynamic Store Submissions (Section 5 & 6)
console.log('\n5. Testing Dynamic Store Submissions & Fresh State:');
const mockDataContent = fs.readFileSync(path.join(rootDir, 'assets/js/mock-data.js'), 'utf8');
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

async function testSubmissions() {
  const store = global.window.geoSafeStore;

  // Fresh initial counts
  const initialReports = await store.getReports();
  assert(initialReports.length === 0, 'Fresh store reports length is 0');
  const initialPublic = await store.getPublicIncidentReports();
  assert(initialPublic.length === 0, 'Fresh public community reports length is 0');
  const initialRescues = await store.getRescueRequests();
  assert(initialRescues.length === 0, 'Fresh store rescues length is 0');

  // Submit actual incident report
  const rep = await store.submitReport({
    incidentType: 'Flooding / Rising Water',
    title: 'Rising flood in Bayanan Baywalk',
    description: 'Knee deep flood on main road',
    location: 'Bayanan Baywalk',
    coordinates: { lat: 14.4075, lng: 121.0475 },
    authorizedForCommunity: true
  });
  assert(rep && rep.id && rep.id.startsWith('REP-2026-'), `Incident report generated reference ${rep.id}`);
  
  const publicReportsAfter = await store.getPublicIncidentReports();
  assert(publicReportsAfter.length === 1, 'Submitted public report is returned in public incident list');

  // Submit actual rescue request
  const rsc = await store.submitRescueRequest({
    emergencyType: 'Trapped by Rising Floodwater',
    description: 'Senior citizen trapped on 2nd floor',
    peopleCount: 2,
    location: '123 Rizal St, Bayanan',
    coordinates: { lat: 14.4085, lng: 121.0485 }
  });
  assert(rsc && rsc.id && rsc.id.startsWith('RSC-2026-'), `Rescue request generated reference ${rsc.id}`);
  assert(rsc.peopleCount === 2, 'Rescue request stored correct people count');

  // Family Safety
  const member = await store.addFamilyMember({
    name: 'Ana Cruz',
    relationship: 'Child / Dependent',
    email: 'ana.cruz@bayanan.ph'
  });
  assert(member.locationSharing.status === 'Not Sharing', 'Added family member defaults to "Not Sharing"');
  assert(member.locationSharing.enabled === false, 'Location sharing requires explicit consent');

  console.log('\n================================================================');
  if (failedTests === 0) {
    console.log(' ALL 32 REDESIGN TESTS PASSED WITH 0 FAILURES!');
  } else {
    console.error(` COMPLETED WITH ${failedTests} FAILURE(S).`);
    process.exit(1);
  }
  console.log('================================================================');
}

testSubmissions().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
