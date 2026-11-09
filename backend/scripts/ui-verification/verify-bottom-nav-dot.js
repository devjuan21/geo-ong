process.chdir(require('path').join(__dirname, '../../../frontend'));
const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log(' GeoSafe Bottom Navigation Active Yellow Dot Verification');
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

// Load components.js in simulated DOM environment
const componentsCode = fs.readFileSync('assets/js/components.js', 'utf8');

function setupSimulatedEnv(pathname = '/') {
  const container = {
    id: 'geosafe-bottom-nav',
    innerHTML: '',
    className: ''
  };

  const doc = {
    getElementById: (id) => {
      if (id === 'geosafe-bottom-nav') return container;
      return null;
    },
    createElement: (tag) => {
      return container;
    },
    body: {
      appendChild: () => {}
    }
  };

  const win = {
    location: {
      pathname: pathname
    }
  };

  const ctx = {
    window: win,
    document: doc,
    console: console
  };

  // Run script in context
  const fn = new Function('window', 'document', componentsCode + '; return GeoSafeUI;');
  const GeoSafeUI = fn(win, doc);

  return { GeoSafeUI, container };
}

// 1. Test each navigation item when active
const navPageIds = ['home', 'evacuation-routes', 'report-rescue', 'family'];

console.log('1. Testing Yellow Active Dot for Each Navigation Item:');

navPageIds.forEach(activeId => {
  const { GeoSafeUI, container } = setupSimulatedEnv('/' + activeId + '.html');
  GeoSafeUI.renderMobileBottomNav(activeId);
  const html = container.innerHTML;

  // Active yellow dot check
  const dotMatches = html.match(/bg-\[#F5B900\]/g);
  assert(dotMatches && dotMatches.length === 1, `[${activeId}] Exactly ONE yellow dot displayed`);

  // Ensure dot is centered beneath the icon
  assert(html.includes('left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#F5B900]'), `[${activeId}] Dot has centered rounded-full positioning`);

  // Ensure no oversized red circular background in bottom nav
  assert(!html.includes('w-10 h-10'), `[${activeId}] No oversized w-10 h-10 icon container`);
  assert(!html.includes('-mt-4'), `[${activeId}] No protruding -mt-4 circular element`);
  assert(!html.includes('bg-[#D93636]'), `[${activeId}] No red background behind active navigation icon`);
  assert(!html.includes('ring-4'), `[${activeId}] No oversized ring-4 styling`);

  // Ensure all 4 icons have w-5 h-5 size
  const iconMatches = html.match(/class="w-5 h-5"/g) || html.match(/w-5 h-5/g);
  assert(iconMatches && iconMatches.length >= 4, `[${activeId}] All 4 navigation icons have consistent w-5 h-5 size`);
});

// 2. Test Inactive vs Active Appearance
console.log('\n2. Testing Active and Inactive Styling:');
{
  const { GeoSafeUI, container } = setupSimulatedEnv('/index.html');
  GeoSafeUI.renderMobileBottomNav('home');
  const html = container.innerHTML;

  // Active Home item should have dark text #202020
  assert(html.includes('data-nav-id="home" class="flex-1 flex flex-col items-center justify-center py-2 px-0.5 relative transition-colors focus:outline-none text-[#202020]"') ||
         html.includes('data-nav-id="home"') && html.includes('text-[#202020]'), 'Active Home item uses dark #202020 styling');

  // Inactive items should have neutral gray #777777
  assert(html.includes('data-nav-id="evacuation-routes"') && html.includes('text-[#777777]'), 'Inactive Evacuation item uses neutral gray #777777');
  assert(html.includes('data-nav-id="report-rescue"') && html.includes('text-[#777777]'), 'Inactive Report / Rescue item uses neutral gray #777777');
  assert(html.includes('data-nav-id="family"') && html.includes('text-[#777777]'), 'Inactive Family item uses neutral gray #777777');
}

// 3. Test Report / Rescue Active State
console.log('\n3. Testing Report / Rescue Active State:');
{
  const { GeoSafeUI, container } = setupSimulatedEnv('/report-rescue.html');
  GeoSafeUI.renderMobileBottomNav('report-rescue');
  const html = container.innerHTML;

  assert(html.includes('data-nav-id="report-rescue"'), 'Report / Rescue item exists');
  assert(!html.includes('bg-[#D93636]'), 'Report / Rescue active state does NOT use red background');
  assert(html.includes('left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#F5B900]'), 'Report / Rescue displays the yellow active dot');
}

// 4. Test Route Auto-Detection on Navigation & Refresh
console.log('\n4. Testing Dynamic Route Resolution:');
{
  const testRoutes = [
    { path: '/index.html', expected: 'home' },
    { path: '/', expected: 'home' },
    { path: '/evacuation-routes.html', expected: 'evacuation-routes' },
    { path: '/report-rescue.html', expected: 'report-rescue' },
    { path: '/family.html', expected: 'family' }
  ];

  testRoutes.forEach(tr => {
    const { GeoSafeUI } = setupSimulatedEnv(tr.path);
    const resolved = GeoSafeUI.resolveActivePageId();
    assert(resolved === tr.expected, `Path '${tr.path}' resolves to active item '${tr.expected}'`);
  });
}

console.log('\n================================================================');
if (failed === 0) {
  console.log(` ALL ${passed} BOTTOM NAV YELLOW DOT CHECKS PASSED WITH 0 FAILURES!`);
} else {
  console.error(` COMPLETED WITH ${failed} FAILURE(S).`);
}
console.log('================================================================\n');

process.exit(failed > 0 ? 1 : 0);
