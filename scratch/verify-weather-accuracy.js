/**
 * Weather Accuracy and Integration Test Suite
 * Validates Section 1 to Section 8 requirements of GeoSafe Weather Integration
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
console.log(' GeoSafe Weather Accuracy & Integration Validation Suite');
console.log('================================================================\n');

// Set up node environment
global.window = {};
const weatherServiceContent = fs.readFileSync(path.join(rootDir, 'assets/js/weather-service.js'), 'utf8');
eval(weatherServiceContent);
const GeoSafeWeather = global.window.GeoSafeWeather;

// 1. Verify WMO Code Mapping (Section 3 Requirement)
console.log('1. Verifying Weather Condition Code Mapping:');
const wmo = GeoSafeWeather.wmoCodes;
assert(wmo[0].condition === 'Clear', 'Code 0 maps to "Clear"');
assert(wmo[1].condition === 'Mostly Clear', 'Code 1 maps to "Mostly Clear"');
assert(wmo[2].condition === 'Partly Cloudy', 'Code 2 maps to "Partly Cloudy"');
assert(wmo[3].condition === 'Cloudy', 'Code 3 maps to "Cloudy"');
assert(wmo[45].condition === 'Fog', 'Code 45 maps to "Fog"');
assert(wmo[48].condition === 'Fog', 'Code 48 maps to "Fog"');
assert(wmo[51].condition === 'Drizzle', 'Code 51 maps to "Drizzle" (NO misleading Light Drizzle when code is drizzle)');
assert(wmo[53].condition === 'Drizzle', 'Code 53 maps to "Drizzle"');
assert(wmo[55].condition === 'Drizzle', 'Code 55 maps to "Drizzle"');
assert(wmo[61].condition === 'Light Rain', 'Code 61 maps to "Light Rain"');
assert(wmo[63].condition === 'Rain', 'Code 63 maps to "Rain"');
assert(wmo[65].condition === 'Heavy Rain', 'Code 65 maps to "Heavy Rain"');
assert(wmo[95].condition === 'Thunderstorm', 'Code 95 maps to "Thunderstorm"');

// 2. Verify No Hardcoded Fallback Numbers exist in weather-service.js (Section 8)
console.log('\n2. Verifying Removal of Fabricated Fallback Numbers:');
assert(!weatherServiceContent.includes('current.temperature_2m || 29'), 'No hardcoded 29 fallback for temperature');
assert(!weatherServiceContent.includes('current.temperature_2m || 31'), 'No hardcoded 31 fallback for feels-like');
assert(!weatherServiceContent.includes(': 24'), 'No hardcoded 24 fallback for min temp');
assert(!weatherServiceContent.includes(': 32'), 'No hardcoded 32 fallback for max temp');

// 3. Test Incomplete/Corrupt API Response Handling (Section 8)
console.log('\n3. Testing Incomplete/Corrupt API Response Handling:');
async function testIncompleteResponse() {
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ current: {}, daily: {} }) // Missing required temperature_2m and weather_code
  });

  try {
    await GeoSafeWeather.getDailyWeather({ lat: 14.4075, lng: 121.0475 });
    assert(false, 'Should throw error when current observation data is incomplete');
  } catch (err) {
    assert(err.message.includes('Incomplete current observation'), 'Incomplete API response throws error instead of fabricating data');
  } finally {
    global.fetch = origFetch;
  }
}

// 4. Test Coordinate Flexibility (Section 2: Location Accuracy)
console.log('\n4. Testing Location Accuracy & Dynamic GPS Coordinates:');
async function testCoordinates() {
  const origFetch = global.fetch;
  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({
        current: {
          time: '2026-11-07T12:00',
          temperature_2m: 30.5,
          relative_humidity_2m: 60,
          apparent_temperature: 33.2,
          precipitation: 0.2,
          weather_code: 51,
          wind_speed_10m: 15,
          wind_direction_10m: 90
        },
        daily: {
          temperature_2m_max: [31.5],
          temperature_2m_min: [25.0],
          precipitation_sum: [1.2]
        }
      })
    };
  };

  try {
    // A. Configured Bayanan fallback
    const defaultWx = await GeoSafeWeather.getDailyWeather();
    assert(requestedUrl.includes('latitude=14.4075&longitude=121.0475'), 'Default coordinates correspond to Barangay Bayanan');
    assert(defaultWx.condition === 'Drizzle', 'Code 51 maps accurately to "Drizzle"');
    assert(defaultWx.currentRainfallMm === 0.2, 'Current rainfall accurately reflects observation');
    assert(defaultWx.forecastRainfallMm === 1.2, 'Forecast rainfall is separated from current observation');

    // B. Custom resident GPS coordinates
    const customGps = { lat: 14.4120, lng: 121.0500, isGps: true, locationName: 'Resident GPS Sector' };
    const gpsWx = await GeoSafeWeather.getDailyWeather(customGps);
    assert(requestedUrl.includes('latitude=14.4120&longitude=121.0500'), 'Dynamic GPS coordinates are passed to the API provider');
    assert(gpsWx.location === 'Resident GPS Sector', 'Weather location reflects resident GPS');
    assert(gpsWx.isGps === true, 'isGps flag is preserved');
  } finally {
    global.fetch = origFetch;
  }
}

// 5. Test Live Open-Meteo Provider Consistency
console.log('\n5. Testing Live Open-Meteo Provider Endpoint:');
async function testLiveApi() {
  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=14.4075&longitude=121.0475&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%2FManila');
    if (!res.ok) {
      console.log('  [SKIP] Outgoing network offline in test runner environment');
      return;
    }
    const data = await res.json();
    assert(data.current !== undefined, 'Live API returns current observations');
    assert(data.current.weather_code !== undefined, `Live API returned weather_code: ${data.current.weather_code}`);
    const mapped = wmo[data.current.weather_code];
    assert(mapped !== undefined, `Live weather code ${data.current.weather_code} is defined in WMO mapping (${mapped?.condition})`);
  } catch (e) {
    console.log('  [INFO] Network call skipped in sandboxed environment');
  }
}

// 6. Test Asia/Manila Timezone Formatting (Section 5)
console.log('\n6. Testing Asia/Manila Timezone Formatting:');
const sampleDate = '2026-11-07T05:00:00.000Z'; // 1:00 PM Manila time (UTC+8)
const formatted = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
}).format(new Date(sampleDate));
assert(formatted.includes('1:00') && formatted.includes('PM'), 'Timestamp formats accurately in Asia/Manila timezone (PHT)');

async function runAll() {
  await testIncompleteResponse();
  await testCoordinates();
  await testLiveApi();

  console.log('\n================================================================');
  if (failedTests === 0) {
    console.log(' ALL WEATHER ACCURACY INTEGRATION CHECKS PASSED (0 FAILURES)!');
  } else {
    console.error(` COMPLETED WITH ${failedTests} FAILURE(S)!`);
    process.exit(1);
  }
  console.log('================================================================');
}

runAll().catch(err => {
  console.error(err);
  process.exit(1);
});

