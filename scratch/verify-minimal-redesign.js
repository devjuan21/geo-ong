const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log(' GeoSafe Minimal Text Redesign Verification Suite');
console.log(' Testing: Evacuation Routes, Report / Rescue, Family Safety');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

// 1. Evacuation Routes Checks
console.log('1. Checking Evacuation Routes (evacuation-routes.html):');
const evacHtml = fs.readFileSync('evacuation-routes.html', 'utf8');
assert(evacHtml.includes('id="evacuation-map"'), 'Interactive map element #evacuation-map exists');
assert(evacHtml.includes('id="route-destination-select"'), 'Compact destination selector exists');
assert(evacHtml.includes('id="btn-calc-route"'), 'Compact Route button exists');
assert(evacHtml.includes('id="route-result-card"'), 'Route result card element exists');
assert(evacHtml.includes('id="route-start-label"'), 'Starting point indicator exists');
assert(evacHtml.includes('id="shelters-count-badge"'), 'Shelters count badge exists');
assert(evacHtml.includes('id="evacuation-centers-empty"'), 'Shelters empty state exists');
assert(evacHtml.includes('No evacuation centers are currently available.'), 'Exact empty state string preserved');
assert(evacHtml.includes('pb-28'), 'Mobile bottom clearance pb-28 preserved');
assert(!evacHtml.match(/[\u{1F300}-\u{1F9FF}]/u), 'No emojis found in evacuation-routes.html');

// 2. Report / Rescue Checks
console.log('\n2. Checking Report / Rescue (report-rescue.html):');
const reportRescueHtml = fs.readFileSync('report-rescue.html', 'utf8');
assert(reportRescueHtml.includes('id="tab-btn-report"'), 'Incident Report selection card exists');
assert(reportRescueHtml.includes('id="tab-btn-rescue"'), 'Rescue Request selection card exists');
assert(reportRescueHtml.includes('id="section-report"'), 'Incident Report form container exists');
assert(reportRescueHtml.includes('id="section-rescue"'), 'Rescue Request form container exists');
assert(reportRescueHtml.includes('id="report-map-picker"'), 'Incident map picker exists');
assert(reportRescueHtml.includes('id="rescue-map-picker"'), 'Rescue map picker exists');
assert(reportRescueHtml.includes('id="rep-type"'), 'Report category dropdown exists');
assert(reportRescueHtml.includes('id="rep-title"'), 'Report title field exists');
assert(reportRescueHtml.includes('id="rep-desc"'), 'Report description field exists');
assert(reportRescueHtml.includes('id="rep-loc"'), 'Report location field exists');
assert(reportRescueHtml.includes('id="res-type"'), 'Rescue condition dropdown exists');
assert(reportRescueHtml.includes('id="res-count"'), 'Rescue people count field exists');
assert(reportRescueHtml.includes('id="res-desc"'), 'Rescue details field exists');
assert(reportRescueHtml.includes('id="res-loc"'), 'Rescue location field exists');
assert(reportRescueHtml.includes('id="confirm-report-modal"'), 'Incident confirm modal exists');
assert(reportRescueHtml.includes('id="confirm-rescue-modal"'), 'Rescue confirm modal exists');
assert(reportRescueHtml.includes('id="submission-success-modal"'), 'Submission success modal exists');
assert(reportRescueHtml.includes('id="success-reference-num"'), 'Success reference number display exists');
assert(reportRescueHtml.includes('pb-28'), 'Mobile bottom clearance pb-28 preserved');
assert(!reportRescueHtml.match(/[\u{1F300}-\u{1F9FF}]/u), 'No emojis found in report-rescue.html');

// 3. Family Safety Tracker Checks
console.log('\n3. Checking Family Safety Tracker (family.html):');
const familyHtml = fs.readFileSync('family.html', 'utf8');
assert(familyHtml.includes('id="family-map"'), 'Interactive family map element #family-map exists');
assert(familyHtml.includes('id="family-map-empty"'), 'Map empty status pill #family-map-empty exists');
assert(familyHtml.includes('No shared family locations available.'), 'Exact map empty string preserved');
assert(familyHtml.includes('id="stat-total-members"'), 'Total members metric exists');
assert(familyHtml.includes('id="stat-sharing-location"'), 'Sharing location metric exists');
assert(familyHtml.includes('id="stat-not-sharing"'), 'Not sharing metric exists');
assert(familyHtml.includes('id="stat-last-update"'), 'Last update metric exists');
assert(familyHtml.includes('id="family-empty"'), 'Empty state #family-empty exists');
assert(familyHtml.includes('No family members added yet.'), 'Exact member empty state string preserved');
assert(familyHtml.includes('id="family-cards-list"'), 'Family cards list container exists');
assert(familyHtml.includes('id="add-member-modal"'), 'Add member modal exists');
assert(familyHtml.includes('id="member-detail-modal"'), 'Member detail modal exists');
assert(familyHtml.includes('id="family-consent-modal"'), 'Consent modal exists');
assert(familyHtml.includes('pb-28'), 'Mobile bottom clearance pb-28 preserved');
assert(!familyHtml.match(/[\u{1F300}-\u{1F9FF}]/u), 'No emojis found in family.html');

console.log('\n================================================================');
if (failed === 0) {
  console.log(` ALL ${passed} MINIMAL REDESIGN CHECKS PASSED WITH 0 FAILURES!`);
} else {
  console.error(` COMPLETED WITH ${failed} FAILURE(S).`);
}
console.log('================================================================\n');

process.exit(failed > 0 ? 1 : 0);

