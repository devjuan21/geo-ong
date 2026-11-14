process.chdir(require('path').join(__dirname, '../../../frontend'));
const fs = require('fs');

console.log('================================================================');
console.log(' GeoSafe Bottom Navigation Active State Verification');
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

const componentsCode = fs.readFileSync('assets/js/components.js', 'utf8');

function setupSimulatedEnv(pathname = '/') {
  const container = {
    id: 'geosafe-bottom-nav',
    innerHTML: '',
    className: ''
  };

  const doc = {
    getElementById: (id) => (id === 'geosafe-bottom-nav' ? container : null),
    createElement: () => container,
    body: { appendChild: () => {} }
  };

  const win = { location: { pathname } };

  const fn = new Function('window', 'document', componentsCode + '; return GeoSafeUI;');
  const GeoSafeUI = fn(win, doc);

  return { GeoSafeUI, container };
}

const navPageIds = ['home', 'evacuation-routes', 'report-rescue', 'hazard-alerts'];

console.log('1. Testing Navigation Items When Active:');

navPageIds.forEach(activeId => {
  const { GeoSafeUI, container } = setupSimulatedEnv('/' + activeId + '.html');
  GeoSafeUI.renderMobileBottomNav(activeId);
  const html = container.innerHTML;

  assert(!html.includes('w-10 h-10'), `[${activeId}] No oversized w-10 h-10 icon container`);
  assert(!html.includes('-mt-4'), `[${activeId}] No protruding -mt-4 circular element`);
  assert(!html.includes('bg-[#D93636]'), `[${activeId}] No red background behind active navigation icon`);

  const iconMatches = html.match(/w-5 h-5/g);
  assert(iconMatches && iconMatches.length >= 4, `[${activeId}] All 4 navigation icons have consistent w-5 h-5 size`);
});

console.log('\n2. Testing Dynamic Route Resolution:');
{
  const testRoutes = [
    { path: '/index.html', expected: 'home' },
    { path: '/', expected: 'home' },
    { path: '/evacuation-routes.html', expected: 'evacuation-routes' },
    { path: '/report-rescue.html', expected: 'report-rescue' },
    { path: '/hazard-alerts.html', expected: 'hazard-alerts' }
  ];

  testRoutes.forEach(tr => {
    const { GeoSafeUI } = setupSimulatedEnv(tr.path);
    const resolved = GeoSafeUI.resolveActivePageId();
    assert(resolved === tr.expected, `Path '${tr.path}' resolves to active item '${tr.expected}'`);
  });
}

console.log('\n================================================================');
if (failed === 0) {
  console.log(` ALL ${passed} BOTTOM NAV CHECKS PASSED WITH 0 FAILURES!`);
} else {
  console.error(` COMPLETED WITH ${failed} FAILURE(S).`);
}
console.log('================================================================\n');

process.exit(failed > 0 ? 1 : 0);
