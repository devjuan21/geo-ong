process.chdir(require('path').join(__dirname, '../../../frontend'));
const fs = require('fs');

console.log('================================================================');
console.log(' GeoSafe Report / Rescue Button Text Overflow Fix Verification');
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

const html = fs.readFileSync('report-rescue.html', 'utf8');
const js = fs.readFileSync('assets/js/report-rescue.js', 'utf8');

// 1. Complete Titles Check
console.log('1. Checking Complete Titles & No Truncation:');
assert(html.includes('Incident Report</span>'), 'Title "Incident Report" is fully spelled out');
assert(html.includes('Rescue Request</span>'), 'Title "Rescue Request" is fully spelled out');

// Verify neither title has the "truncate" class
const card1Title = html.match(/<span[^>]*>Incident Report<\/span>/);
const card2Title = html.match(/<span[^>]*>Rescue Request<\/span>/);
assert(card1Title && !card1Title[0].includes('truncate'), 'Incident Report title does not have truncate class');
assert(card2Title && !card2Title[0].includes('truncate'), 'Rescue Request title does not have truncate class');
assert(card1Title && card1Title[0].includes('whitespace-normal'), 'Incident Report title allows natural wrapping');
assert(card2Title && card2Title[0].includes('whitespace-normal'), 'Rescue Request title allows natural wrapping');

// 2. Responsive Card Layout Check
console.log('\n2. Checking Responsive Card Grid Layout:');
assert(html.includes('grid grid-cols-1 sm:grid-cols-2 gap-3'), 'Cards stack full-width on mobile (grid-cols-1) and side-by-side on sm+ (sm:grid-cols-2)');

// 3. Internal Alignment & Badge Separation
console.log('\n3. Checking Internal Alignment & Urgent Badge:');
assert(html.includes('w-11 h-11') && html.includes('flex-shrink-0'), 'Icons have fixed container dimensions with flex-shrink-0');
assert(html.includes('min-w-0'), 'Text containers use min-w-0 to prevent flexbox clipping');
assert(html.includes('justify-between'), 'Cards use justify-between to cleanly position text and badges');
assert(html.includes('uppercase flex-shrink-0">Urgent</span>'), 'Urgent badge is positioned with flex-shrink-0 to never compress the title');

// 4. Tab Switching Persistence
console.log('\n4. Checking Tab Switching in JavaScript:');
assert(js.includes('grid-cols-1') || js.includes('justify-between'), 'JavaScript switchActionTab uses matching flexible card classes');
assert(js.includes('w-full p-3.5 sm:p-4 rounded-3xl'), 'switchActionTab maintains responsive card sizing when toggled');

console.log('\n================================================================');
if (failed === 0) {
  console.log(` ALL ${passed} BUTTON OVERFLOW CHECKS PASSED WITH 0 FAILURES!`);
} else {
  console.error(` COMPLETED WITH ${failed} FAILURE(S).`);
}
console.log('================================================================\n');

process.exit(failed > 0 ? 1 : 0);

