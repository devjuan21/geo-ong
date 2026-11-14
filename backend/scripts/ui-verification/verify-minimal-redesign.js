process.chdir(require('path').join(__dirname, '../../../frontend'));
const fs = require('fs');

console.log('================================================================');
console.log(' GeoSafe Minimal Text Redesign Verification Suite');
console.log(' Testing: Evacuation Routes & Report / Rescue');
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

console.log('\n================================================================');
if (failed === 0) {
  console.log(` ALL ${passed} MINIMAL REDESIGN CHECKS PASSED WITH 0 FAILURES!`);
} else {
  console.error(` COMPLETED WITH ${failed} FAILURE(S).`);
}
console.log('================================================================\n');

process.exit(failed > 0 ? 1 : 0);
