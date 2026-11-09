process.chdir(require('path').join(__dirname, '../../../frontend'));
const fs = require('fs');

console.log('================================================================');
console.log(' GeoSafe Toast / Notification Alignment & Positioning Verification');
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

function setupToastEnv() {
  const elements = {};
  const doc = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => {
      const el = {
        tagName: tag,
        id: '',
        className: '',
        attributes: {},
        classList: {
          add: (...classes) => {
            el.className = (el.className + ' ' + classes.join(' ')).trim();
          },
          remove: (...classes) => {
            classes.forEach(c => {
              el.className = el.className.split(' ').filter(x => x !== c).join(' ');
            });
          }
        },
        setAttribute: (k, v) => { el.attributes[k] = v; },
        appendChild: (child) => {
          if (!el.children) el.children = [];
          el.children.push(child);
        },
        children: []
      };
      return el;
    },
    body: {
      appendChild: (el) => {
        elements[el.id] = el;
      }
    }
  };

  const win = {
    requestAnimationFrame: (cb) => cb(),
    setTimeout: (cb) => {}
  };

  const fn = new Function('window', 'document', componentsCode + '; return GeoSafeUI;');
  const GeoSafeUI = fn(win, doc);

  return { GeoSafeUI, elements };
}

// 1. Viewport-level Fixed & Centered Container Check
console.log('1. Checking Viewport-Level Container Positioning:');
{
  const { GeoSafeUI, elements } = setupToastEnv();
  const container = GeoSafeUI.setupToastContainer();

  assert(container.id === 'geosafe-toast-container', 'Container has id #geosafe-toast-container');
  assert(container.className.includes('fixed'), 'Container uses position: fixed');
  assert(container.className.includes('left-1/2') && container.className.includes('-translate-x-1/2'), 'Container uses left: 50% with transform: translateX(-50%) for viewport centering');
  assert(container.className.includes('bottom-20'), 'Container positioned above mobile bottom nav (bottom-20)');
  assert(container.className.includes('md:bottom-8'), 'Container adapts vertically on desktop (md:bottom-8)');
  assert(container.className.includes('z-[70]'), 'Container uses high z-index (z-[70]) above modals and maps');
  assert(container.className.includes('max-w-md'), 'Container limits maximum width on desktop (max-w-md)');
  assert(container.className.includes('w-[calc(100%-2rem)]'), 'Container is responsive with viewport edge clearance');
}

// 2. Toast Element Alignment & Styling Checks
console.log('\n2. Checking Toast Structure & Alignment:');
{
  const { GeoSafeUI, elements } = setupToastEnv();
  GeoSafeUI.showToast('Emergency rescue location set from current GPS.', 'success');
  const container = elements['geosafe-toast-container'];
  assert(container && container.children.length === 1, 'Toast appended to container');

  const toast = container.children[0];
  assert(toast.className.includes('rounded-2xl'), 'Toast has rounded corners (rounded-2xl)');
  assert(toast.className.includes('flex items-center gap-3'), 'Toast content is flex aligned with centered items and gap-3');
  assert(toast.className.includes('bg-emerald-900'), 'Toast uses green success background');
  assert(toast.className.includes('text-white'), 'Toast text is white');
  assert(toast.innerHTML.includes('Emergency rescue location set from current GPS.'), 'Toast contains exact message');
  assert(toast.innerHTML.includes('flex items-center justify-center flex-shrink-0'), 'Checkmark icon is housed in a centered, non-shrinking container');
  assert(toast.innerHTML.includes('break-words'), 'Toast text allows natural line wrapping (break-words)');
}

// 3. Consistency across notification types
console.log('\n3. Checking Consistency Across Notification Types:');
{
  const types = ['success', 'error', 'warning', 'info'];
  types.forEach(type => {
    const { GeoSafeUI, elements } = setupToastEnv();
    GeoSafeUI.showToast(`Test ${type} message`, type);
    const container = elements['geosafe-toast-container'];
    const toast = container.children[0];
    assert(toast.className.includes('flex items-center gap-3'), `[${type}] Uses identical flex centering & gap`);
    assert(toast.className.includes('rounded-2xl'), `[${type}] Uses rounded-2xl styling`);
    assert(toast.innerHTML.includes('flex-shrink-0'), `[${type}] Icon does not shrink`);
  });
}

console.log('\n================================================================');
if (failed === 0) {
  console.log(` ALL ${passed} TOAST ALIGNMENT CHECKS PASSED WITH 0 FAILURES!`);
} else {
  console.error(` COMPLETED WITH ${failed} FAILURE(S).`);
}
console.log('================================================================\n');

process.exit(failed > 0 ? 1 : 0);

