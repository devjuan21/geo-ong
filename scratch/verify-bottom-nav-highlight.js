const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log(' GeoSafe Bottom Navigation Highlighted Active State Verification');
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

const navPageIds = ['home', 'evacuation-routes', 'report-rescue', 'family'];

console.log('1. Testing Soft Yellow Highlight for Each Navigation Item:');

navPageIds.forEach(activeId => {
  const { GeoSafeUI, container } = setupSimulatedEnv('/' + activeId + '.html');
  GeoSafeUI.renderMobileBottomNav(activeId);
  const html = container.innerHTML;

  // 1. Soft yellow background #FFF1BF on active item
  const bgMatches = html.match(/bg-\[#FFF1BF\]/g);
  assert(bgMatches && bgMatches.length === 1, `[${activeId}] Exactly ONE highlighted active container with bg-[#FFF1BF]`);

  // 2. Icon color #B88600
  const iconColorMatches = html.match(/text-\[#B88600\]/g);
  assert(iconColorMatches && iconColorMatches.length === 1, `[${activeId}] Active icon has golden-yellow color text-[#B88600]`);

  // 3. Label color #202020 and font-bold
  assert(html.includes('font-bold text-[#202020]'), `[${activeId}] Active label has text-[#202020] and font-bold`);

  // 4. Highlighted background contains both icon and label inside rounded container
  assert(html.includes('rounded-2xl transition-all duration-200 bg-[#FFF1BF] shadow-sm'), `[${activeId}] Container is rounded pill with transition and shadow`);

  // 5. Completely removed yellow dot
  assert(!html.includes('bg-[#F5B900]'), `[${activeId}] Previous yellow dot indicator completely removed`);

  // 6. Completely removed red oversized circle
  assert(!html.includes('w-10 h-10'), `[${activeId}] No oversized w-10 h-10 circle`);
  assert(!html.includes('-mt-4'), `[${activeId}] No protruding -mt-4 circle`);
  assert(!html.includes('bg-[#D93636]'), `[${activeId}] No red active background`);

  // 7. Transparent background for inactive items
  const transparentMatches = html.match(/bg-transparent/g);
  assert(transparentMatches && transparentMatches.length === 3, `[${activeId}] Exactly 3 inactive items have bg-transparent`);

  // 8. Neutral gray for inactive icons and labels
  const grayMatches = html.match(/text-\[#777777\]/g);
  assert(grayMatches && grayMatches.length === 6, `[${activeId}] Inactive items use neutral gray text-[#777777] (3 icons + 3 labels)`);
});

console.log('\n2. Testing Dynamic Route Synchronization & Refresh:');
{
  const testRoutes = [
    { path: '/index.html', expected: 'home' },
    { path: '/', expected: 'home' },
    { path: '/evacuation-routes.html', expected: 'evacuation-routes' },
    { path: '/report-rescue.html', expected: 'report-rescue' },
    { path: '/family.html', expected: 'family' }
  ];

  testRoutes.forEach(tr => {
    const { GeoSafeUI, container } = setupSimulatedEnv(tr.path);
    const resolved = GeoSafeUI.resolveActivePageId();
    assert(resolved === tr.expected, `Path '${tr.path}' resolves to '${tr.expected}'`);

    GeoSafeUI.renderMobileBottomNav(resolved);
    const html = container.innerHTML;
    assert(html.includes(`data-nav-id="${tr.expected}"`), `Rendered item matches '${tr.expected}'`);
  });
}

console.log('\n================================================================');
if (failed === 0) {
  console.log(` ALL ${passed} BOTTOM NAV HIGHLIGHT CHECKS PASSED WITH 0 FAILURES!`);
} else {
  console.error(` COMPLETED WITH ${failed} FAILURE(S).`);
}
console.log('================================================================\n');

process.exit(failed > 0 ? 1 : 0);

