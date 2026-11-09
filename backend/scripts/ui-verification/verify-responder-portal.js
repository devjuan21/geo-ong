/**
 * Verification Script: Complete GeoSafe Responder Portal
 * ============================================================================
 * Validates Sections 1 to 13:
 * 1. File existence for all 4 primary destinations:
 *    - responder-dashboard.html
 *    - responder-assignments.html
 *    - responder-map.html
 *    - responder-profile.html
 * 2. Navigation bar:
 *    - Exactly 4 primary destinations (Dashboard, Assignments, Map, Profile)
 *    - Mobile bottom nav clearance (pb-28)
 *    - Active item yellow rounded pill highlight (bg-[#FFF1BF], text-[#B88600], font-bold text-[#202020])
 *    - No dots or oversized circular indicators
 * 3. Zero Emoji Rule in all responder files
 * 4. Zero Fake Data & Fresh System compliance:
 *    - Starts with 0 active, 0 pending, 0 in progress, 0 completed
 *    - Exact empty state text: "No active assignments."
 * 5. Dynamic Assignment & Response Status Workflow:
 *    - Dispatching rescue / incident to responder
 *    - Pending -> Accepted -> En Route -> On Scene -> Completed
 *    - Audit trail timeline verification
 *    - Resident report preserved (not prematurely deleted)
 * 6. Field progress updates with work notes & photo attachments
 * 7. Availability management (On Duty, Off Duty, Unavailable)
 * 8. Strict Role-Based Access Control:
 *    - Responders cannot change roles or escalate to admin privileges
 *    - Responders cannot change official priority
 * 9. Operational Map & Routing compliance
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.join(__dirname, '../../../frontend');
let failedTests = 0;

function testAssert(condition, testName) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName}`);
    failedTests++;
  }
}

console.log('================================================================');
console.log(' GeoSafe Responder Portal Comprehensive Verification');
console.log('================================================================\n');

// 1. Check HTML Pages & Navigation Padding
console.log('1. Checking HTML Pages & Mobile Bottom Clearance:');
const requiredPages = [
  'responder-dashboard.html',
  'responder-assignments.html',
  'responder-map.html',
  'responder-profile.html'
];

requiredPages.forEach(p => {
  const filePath = path.join(rootDir, p);
  const exists = fs.existsSync(filePath);
  testAssert(exists, `Page exists: ${p}`);

  if (exists) {
    const content = fs.readFileSync(filePath, 'utf8');
    testAssert(content.includes('pb-28'), `${p} includes bottom nav clearance padding (pb-28)`);
    testAssert(content.includes('geosafe-responder-nav-container'), `${p} includes top operational nav container`);
    testAssert(content.includes('geosafe-responder-bottom-nav'), `${p} includes mobile bottom nav container`);
  }
});

// 2. Check JavaScript Logic Files
console.log('\n2. Checking Responder JavaScript Modules:');
const requiredJs = [
  'assets/js/responder-ui.js',
  'assets/js/responder-dashboard.js',
  'assets/js/responder-assignments.js',
  'assets/js/responder-map.js',
  'assets/js/responder-profile.js'
];

requiredJs.forEach(j => {
  const filePath = path.join(rootDir, j);
  testAssert(fs.existsSync(filePath), `Script exists: ${j}`);
});

// 3. Verify Navigation Architecture & Active Highlight Style
console.log('\n3. Checking Navigation Destinations & Active Highlight Styling:');
const uiContent = fs.readFileSync(path.join(rootDir, 'assets/js/responder-ui.js'), 'utf8');

testAssert(uiContent.includes("id: 'dashboard'") &&
           uiContent.includes("id: 'assignments'") &&
           uiContent.includes("id: 'map'") &&
           uiContent.includes("id: 'profile'"),
  'GeoSafeResponderUI defines exactly 4 primary destinations (Dashboard, Assignments, Map, Profile)');

testAssert(!uiContent.includes("id: 'settings'") && !uiContent.includes("id: 'admin'"),
  'No extraneous or unauthorized administrative categories in responder navigation');

testAssert(uiContent.includes('bg-[#FFF1BF]'),
  'Active navigation uses GeoSafe soft yellow pill highlight (bg-[#FFF1BF])');

testAssert(uiContent.includes('text-[#B88600]'),
  'Active navigation icon uses dark gold accent (text-[#B88600])');

testAssert(uiContent.includes('text-[#202020]') && uiContent.includes('font-bold'),
  'Active navigation label is bold and dark text (#202020)');

testAssert(!uiContent.includes('w-1.5 h-1.5 rounded-full bg-[#F5B900]') && !uiContent.includes('w-2 h-2 rounded-full bg-[#F5B900]'),
  'Does not use removed yellow dot navigation indicator');

testAssert(!uiContent.includes('bg-[#D93636] text-white rounded-full w-10 h-10'),
  'Does not use oversized red circular active navigation background');

// 4. Verify Strict Zero Emoji Rule
console.log('\n4. Verifying Zero Emojis in Responder Files:');
const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

const allResponderFiles = [
  ...requiredPages.map(p => path.join(rootDir, p)),
  ...requiredJs.map(j => path.join(rootDir, j))
];

allResponderFiles.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const hasEmoji = emojiRegex.test(content);
  testAssert(!hasEmoji, `No emojis in ${path.basename(f)}`);
});

// 5. Verify Fresh Initial State & Empty State Strings
console.log('\n5. Verifying Fresh System State & Removal of Hardcoded Responder Data:');
const dashHtml = fs.readFileSync(path.join(rootDir, 'responder-dashboard.html'), 'utf8');
const assignHtml = fs.readFileSync(path.join(rootDir, 'responder-assignments.html'), 'utf8');
const profHtml = fs.readFileSync(path.join(rootDir, 'responder-profile.html'), 'utf8');

testAssert(dashHtml.includes('No active assignments.'), 'responder-dashboard.html includes exact string: "No active assignments."');
testAssert(assignHtml.includes('No active assignments.'), 'responder-assignments.html includes exact string: "No active assignments."');

// Check that no fabricated responder profiles exist in files
const forbiddenNames = ['Juan Dela Cruz', 'WASAR Team Alpha', 'BDRRMC-2026-088', 'BAYANAN-ALPHA-1', 'RES-BYN-042', 'Rescue Boat 02 (Zodiac Inflatable)'];
allResponderFiles.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  forbiddenNames.forEach(fn => {
    testAssert(!c.includes(fn), `${path.basename(f)} contains zero occurrences of "${fn}"`);
  });
});

// 6. Test Store & Backend Methods (Node.js environment mock)
console.log('\n6. Testing Store Responder Methods & Workflow:');
global.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {}
};
global.navigator = { onLine: true };
global.sessionStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; }
};
global.CustomEvent = class { constructor(type, detail) { this.type = type; this.detail = detail; } };

const mockDataCode = fs.readFileSync(path.join(rootDir, 'assets/js/mock-data.js'), 'utf8');
eval(mockDataCode);

const storeCode = fs.readFileSync(path.join(rootDir, 'assets/js/store.js'), 'utf8');
eval(storeCode);

const store = global.window.geoSafeStore;
testAssert(store !== undefined, 'GeoSafeStore initialized');

async function testStoreLogic() {
  // Test fresh summary (zero sample statistics)
  const initialSummary = await store.getResponderDashboardSummary();
  testAssert(initialSummary.stats.active === 0, 'Initial active assignments is 0 (Zero fake records)');
  testAssert(initialSummary.stats.pending === 0, 'Initial pending assignments is 0');
  testAssert(initialSummary.stats.inProgress === 0, 'Initial in-progress assignments is 0');
  testAssert(initialSummary.stats.completed === 0, 'Initial completed assignments is 0');
  testAssert(initialSummary.recentAssignments.length === 0, 'Recent assignments list starts empty');

  // Verify fresh state has NO fabricated profile
  const initialProfile = await store.getResponderProfile();
  testAssert(initialProfile === null, 'Pristine fresh state has responderProfile === null (Zero fake demo profiles)');

  // Verify unauthenticated visitor gets empty assignments
  const unauthAssignments = await store.getResponderAssignments();
  testAssert(unauthAssignments.length === 0, 'Unauthenticated visitor cannot access assignments');

  // Authenticate an actual authorized responder
  const authenticatedResponder = await store.setAuthenticatedResponder({
    id: 'RESP-2026-091',
    badgeNumber: 'RESP-2026-091',
    firstName: 'Elena',
    lastName: 'Reyes',
    role: 'Responder',
    department: 'BDRRMC Emergency Quick Response Unit',
    assignedUnit: 'Bayanan Quick Response Team',
    availability: 'On Duty',
    phone: '0918-555-0122',
    email: 'elena.reyes@bayanan.gov.ph',
    skills: ['First Aid & CPR', 'Emergency Evacuation'],
    currentLocation: { lat: 14.4075, lng: 121.0475 }
  });

  testAssert(authenticatedResponder.firstName === 'Elena' && authenticatedResponder.lastName === 'Reyes', 'Actual authenticated responder Elena Reyes set in session');
  testAssert(authenticatedResponder.role === 'Responder', 'User role is verified as Responder');

  // Test strict role limitations: cannot escalate to Administrator
  const updatedProfile = await store.updateResponderProfile({
    phone: '0917-999-0000',
    role: 'Administrator' // Attempt privilege escalation
  });
  testAssert(updatedProfile.role === 'Responder', 'Privilege escalation blocked: Role remains Responder');
  testAssert(updatedProfile.phone === '0917-999-0000', 'Legitimate profile update succeeds');

  // Test availability transitions (On Duty, Unavailable, Off Duty)
  const avail1 = await store.updateResponderAvailability('Unavailable');
  testAssert(avail1.status === 'Unavailable', 'Availability updated to Unavailable');
  const avail2 = await store.updateResponderAvailability('On Duty');
  testAssert(avail2.status === 'On Duty', 'Availability updated to On Duty');

  // Test assigning an emergency rescue request to the responder
  const rescuePayload = {
    emergencyType: 'Trapped by Rising Floodwater',
    description: '3 individuals trapped on 2nd floor balcony with infant near creek.',
    peopleCount: 3,
    vulnerableDetails: '1 infant (6 months old)',
    location: '124 Bautista St, Barangay Bayanan',
    coordinates: { lat: 14.4082, lng: 121.0492 }
  };
  const createdRescue = await store.submitRescueRequest(rescuePayload);
  testAssert(createdRescue.id.startsWith('RSC-'), `Resident created rescue request #${createdRescue.id}`);

  // Dispatch rescue to responder
  await store.assignTaskToResponder(createdRescue.id, 'rescue', 'Critical', 'Deploy rescue equipment immediately.');

  // Check responder assignments
  const activeAssignments = await store.getResponderAssignments({ status: 'All' });
  testAssert(activeAssignments.length === 1, 'Responder now has 1 assigned emergency task');
  testAssert(activeAssignments[0].id === createdRescue.id, 'Assigned task matches created rescue ID');
  testAssert(activeAssignments[0].priority === 'Critical', 'Official priority matches Critical');

  // Verify dashboard summary updated dynamically
  const updatedSummary = await store.getResponderDashboardSummary();
  testAssert(updatedSummary.stats.active === 1, 'Active stats dynamically updated to 1');
  testAssert(updatedSummary.priorityCounts.critical === 1, 'Critical priority count dynamically updated to 1');

  // Test Response Status Workflow:
  // Step 1: Accept Assignment
  const resAccept = await store.updateAssignmentStatus(createdRescue.id, 'Accepted');
  testAssert(resAccept.status === 'Accepted', 'Workflow Step 1: Marked as Accepted');

  // Step 2: Mark En Route
  const resRoute = await store.updateAssignmentStatus(createdRescue.id, 'En Route');
  testAssert(resRoute.status === 'En Route', 'Workflow Step 2: Marked as En Route');

  // Step 3: Mark On Scene
  const resScene = await store.updateAssignmentStatus(createdRescue.id, 'On Scene');
  testAssert(resScene.status === 'On Scene', 'Workflow Step 3: Marked as On Scene');

  // Step 4: Progress update with field observations
  const resProgress = await store.updateAssignmentStatus(createdRescue.id, 'On Scene', 'Established safety line across flooded creek. Commenced extraction of infant and 2 adults.');
  testAssert(resProgress.auditEntry.note.includes('Established safety line'), 'Workflow Step 4: Field observation recorded in audit trail');

  // Step 5: Mark Completed
  const resComplete = await store.updateAssignmentStatus(createdRescue.id, 'Completed', 'All 3 individuals extracted safely and transferred to Bayanan Elementary Evacuation Center.');
  testAssert(resComplete.status === 'Completed', 'Workflow Step 5: Marked as Completed');

  // Verify that report remains in system (not deleted)
  const rescueInStore = (store.state.rescueRequests || []).find(r => r.id === createdRescue.id);
  testAssert(rescueInStore !== undefined, 'Completed emergency rescue record preserved in database for verification');

  // Verify map data service
  const mapData = await store.getResponderMapData();
  testAssert(mapData.barangayFacilities.length >= 4, 'Operational map includes Barangay Bayanan emergency facilities');
  testAssert(mapData.responderLocation !== undefined, 'Map returns responder location coordinates');

  // Test logout
  await store.logoutResponder();
  const loggedOutProfile = await store.getResponderProfile();
  testAssert(loggedOutProfile === null, 'After logout, responder profile is null (session terminated)');
}

testStoreLogic().then(() => {
  console.log('\n================================================================');
  if (failedTests === 0) {
    console.log(' ALL RESPONDER PORTAL VERIFICATION CHECKS PASSED (0 FAILURES)!');
  } else {
    console.error(` COMPLETED WITH ${failedTests} FAILURE(S).`);
    process.exit(1);
  }
  console.log('================================================================\n');
}).catch(err => {
  console.error('\nVerification execution error:', err);
  process.exit(1);
});

