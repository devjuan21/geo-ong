process.chdir(require('path').join(__dirname, '../../../frontend'));
const fs = require('fs');

console.log('================================================================');
console.log(' GeoSafe Leaflet Map Attribution Clean-Up Verification');
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

// 1. Check mapping-service.js code
console.log('1. Checking Mapping Service Configuration:');
const mappingJs = fs.readFileSync('assets/js/mapping-service.js', 'utf8');

assert(mappingJs.includes('map.attributionControl.setPrefix(false)'), 'map.attributionControl.setPrefix(false) is called to remove Leaflet branding prefix');
assert(mappingJs.includes('https://tile.openstreetmap.org/{z}/{x}/{y}.png'), 'Tile endpoint is official OpenStreetMap');
assert(mappingJs.includes('https://www.openstreetmap.org/copyright'), 'Attribution links to official OpenStreetMap copyright');
assert(mappingJs.includes('OpenStreetMap') && mappingJs.includes('contributors'), 'Required OpenStreetMap contributors credit is strictly preserved');

// 2. Simulated Leaflet Environment Verification
console.log('\n2. Testing Leaflet Map Creation Attribution Behavior:');
{
  let prefixSetTo = 'Leaflet';
  const mockAttributionControl = {
    setPrefix: (val) => {
      prefixSetTo = val;
    },
    getPrefix: () => prefixSetTo
  };

  const mockMap = {
    attributionControl: mockAttributionControl
  };

  const mockL = {
    map: () => mockMap,
    tileLayer: () => ({ addTo: () => {} })
  };

  const win = { L: mockL };
  const doc = { getElementById: () => ({}) };

  const fn = new Function('window', 'document', 'L', mappingJs + '; return window.GeoSafeMapping;');
  const GeoSafeMapping = fn(win, doc, mockL);

  const mapInstance = GeoSafeMapping.createMap('test-map');
  assert(prefixSetTo === false, 'Leaflet attribution prefix is disabled (set to false)');
}

// 3. Check CSS Styling for Clean Attribution
console.log('\n3. Checking Compiled CSS Attribution Rules:');
const css = fs.readFileSync('assets/css/style.css', 'utf8');

assert(css.includes('.leaflet-control-attribution'), 'Custom .leaflet-control-attribution rules compiled in style.css');
assert(css.includes('font-size:10px') || css.includes('font-size: 10px'), 'Attribution uses compact font-size: 10px');
assert(css.includes('rgba(255,255,255') || css.includes('rgba(255, 255, 255') || css.includes('hsla(0,0%,100%'), 'Attribution uses subtle translucent background');
assert(css.includes('border-top-left-radius'), 'Attribution has smooth rounded border corner');

console.log('\n================================================================');
if (failed === 0) {
  console.log(` ALL ${passed} MAP ATTRIBUTION CHECKS PASSED WITH 0 FAILURES!`);
} else {
  console.error(` COMPLETED WITH ${failed} FAILURE(S).`);
}
console.log('================================================================\n');

process.exit(failed > 0 ? 1 : 0);
