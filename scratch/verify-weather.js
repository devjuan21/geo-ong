/**
 * Verification Script for Weather & Tropical Cyclone Monitoring Integration
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
console.log(' GeoSafe Weather & Tropical Cyclone Monitoring Verification');
console.log('================================================================\n');

// 1. Verify HTML Structure in index.html
console.log('1. Checking Daily Weather & Cyclone Elements in index.html:');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

// Weather Container elements
assert(indexHtml.includes('id="weather-container"'), 'Weather container #weather-container exists');
assert(indexHtml.includes('id="wx-temp"'), 'Current temperature element #wx-temp exists');
assert(indexHtml.includes('id="wx-min-temp"'), 'Daily Min element #wx-min-temp exists');
assert(indexHtml.includes('id="wx-max-temp"'), 'Daily Max element #wx-max-temp exists');
assert(indexHtml.includes('id="wx-condition"'), 'Weather condition element #wx-condition exists');
assert(indexHtml.includes('id="wx-rain"'), 'Rainfall element #wx-rain exists');
assert(indexHtml.includes('id="wx-wind"'), 'Wind speed and direction element #wx-wind exists');
assert(indexHtml.includes('id="wx-humidity"'), 'Humidity element #wx-humidity exists');
assert(indexHtml.includes('id="wx-timestamp"'), 'Forecast update timestamp #wx-timestamp exists');
assert(indexHtml.includes('id="weather-unavailable"'), 'Unavailable fallback container #weather-unavailable exists');

// Cyclone elements
assert(indexHtml.includes('id="btn-toggle-cyclone"'), 'Cyclone layer toggle button #btn-toggle-cyclone exists');
assert(indexHtml.includes('id="cyclone-toggle-status"'), 'Cyclone toggle status #cyclone-toggle-status exists');
assert(indexHtml.includes('id="cyclone-bulletin-banner"'), 'Cyclone bulletin banner #cyclone-bulletin-banner exists');
assert(indexHtml.includes('id="cyclone-name-label"'), 'Cyclone name label #cyclone-name-label exists');
assert(indexHtml.includes('id="cyclone-category-badge"'), 'Cyclone category badge #cyclone-category-badge exists');
assert(indexHtml.includes('id="legend-cyclone-eye"'), 'Map legend item #legend-cyclone-eye exists');
assert(indexHtml.includes('id="legend-cyclone-track"'), 'Map legend item #legend-cyclone-track exists');

// Script imports
assert(indexHtml.includes('src="./assets/js/weather-service.js"'), 'weather-service.js is imported in index.html');

// 2. Verify Map is Uncovered (Critical User Requirement)
console.log('\n2. Verifying Map is completely uncovered:');
// Map container should not have backdrop-blur or overlay cards covering it
const mapContainerRegex = /<div class="relative w-full h-(?:72|80)[^>]*>[\s\S]*?<div id="incident-map"[^>]*><\/div>\s*<\/div>/;
assert(mapContainerRegex.test(indexHtml), 'incident-map container contains ONLY the map without any blocking overlay inside');
assert(!indexHtml.includes('bg-slate-900/40 backdrop-blur'), 'No dark backdrop overlays exist on index.html');

// 3. Verify weather-service.js logic
console.log('\n3. Verifying weather-service.js module:');
global.window = {};
const weatherServiceContent = fs.readFileSync(path.join(rootDir, 'assets/js/weather-service.js'), 'utf8');
eval(weatherServiceContent);

const wx = global.window.GeoSafeWeather;
assert(wx !== undefined, 'GeoSafeWeather is exposed on window');
assert(wx.config.location.latitude === 14.4075 && wx.config.location.longitude === 121.0475, 'Barangay Bayanan coordinates correctly set');
assert(wx.config.meteorology.attribution.includes('DOST-PAGASA'), 'PAGASA reference documented');
assert(wx.config.pagasa.requiresAuth === true, 'PAGASA API formal authorization documented');

// Test wind direction conversion
assert(wx.degreesToCompass(0) === 'N', 'Wind 0 deg is N');
assert(wx.degreesToCompass(90) === 'E', 'Wind 90 deg is E');
assert(wx.degreesToCompass(180) === 'S', 'Wind 180 deg is S');
assert(wx.degreesToCompass(270) === 'W', 'Wind 270 deg is W');

// 4. Verify Fresh System Tropical Cyclone Status (Zero Fake Typhoons)
console.log('\n4. Verifying Fresh System & Dynamic Cyclone Bulletin:');
const mockDataContent = fs.readFileSync(path.join(rootDir, 'assets/js/mock-data.js'), 'utf8');
eval(mockDataContent);

global.sessionStorage = {
  _data: {},
  getItem(key) { return this._data[key] || null; },
  setItem(key, val) { this._data[key] = String(val); },
  removeItem(key) { delete this._data[key]; },
  clear() { this._data = {}; }
};
global.navigator = { onLine: true };
global.window.addEventListener = () => {};
global.window.dispatchEvent = () => {};
global.CustomEvent = class CustomEvent { constructor(type, detail) { this.type = type; this.detail = detail; } };
const storeContent = fs.readFileSync(path.join(rootDir, 'assets/js/store.js'), 'utf8');
eval(storeContent);

// Fresh state
wx.getTropicalCycloneBulletin().then(async (freshBulletin) => {
  assert(freshBulletin.active === false, 'Fresh system has NO active cyclone (active: false, zero fake data)');
  assert(freshBulletin.message.includes('No active tropical cyclone'), 'Status reports clear PAR');

  // Test publishing a verified official cyclone bulletin
  const published = await global.window.geoSafeStore.publishTropicalCycloneBulletin({
    name: 'BAGYO AURING',
    internationalName: 'Dujuan',
    category: 'Severe Tropical Storm',
    maxWindsKmH: 95,
    gustinessKmH: 115,
    movement: 'West Northwest at 15 km/h',
    bulletinNumber: 4,
    issuedAt: new Date().toISOString(),
    currentPosition: { lat: 13.5, lng: 124.8, label: 'Current Position' },
    historicalTrack: [
      { lat: 11.2, lng: 128.5, label: 'Past 24h' },
      { lat: 12.4, lng: 126.7, label: 'Past 12h' }
    ],
    forecastTrack: [
      { lat: 14.2, lng: 123.1, label: '+12h Forecast' },
      { lat: 14.8, lng: 121.5, label: '+24h Forecast' }
    ],
    warningRadiusKm: 250
  });

  assert(published.name === 'BAGYO AURING', 'Cyclone bulletin successfully published');

  const retrieved = await wx.getTropicalCycloneBulletin();
  assert(retrieved.active === true && retrieved.name === 'BAGYO AURING', 'Retrieved published bulletin has active: true');
  assert(retrieved.forecastTrack.length === 2, 'Retrieved forecast track has 2 points');

  console.log('\n================================================================');
  if (failedTests === 0) {
    console.log(' ALL 28 WEATHER & CYCLONE CHECKS PASSED PERFECTLY (0 FAILURES)!');
  } else {
    console.error(` COMPLETED WITH ${failedTests} FAILURES!`);
    process.exit(1);
  }
  console.log('================================================================');
});
