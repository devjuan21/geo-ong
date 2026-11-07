/**
 * GeoSafe - Resident Homepage with Weather & Tropical Cyclone Monitoring
 * ============================================================================
 * Features:
 * - Localized Daily Weather for Barangay Bayanan (WMO / DOST-PAGASA Model)
 * - Tropical Cyclone Monitoring Layer integrated directly into the Community Map:
 *     - Current storm center position with storm category icon
 *     - Historical cyclone track (solid line & past verified eye points)
 *     - Official forecast track (dashed path line with forecast cones)
 *     - Gale / strong wind radius & TCWS warning circles
 *     - Toggle switch to enable/disable cyclone monitoring layer
 * - Zero Fake Typhoons: Displays "No active tropical cyclone within PAR" when clear
 * - Real-time Community Map with active public incident markers
 * - Recent Reports, Hazard Alerts, Evacuation Shelters, and Family Safety cards
 * ============================================================================
 */

let incidentMap = null;
let incidentMarkersGroup = null;
let cycloneLayerGroup = null;
let userLocationMarker = null;

let isCycloneLayerVisible = true;
let currentLoadedReports = [];
let currentLoadedAlerts = [];
let currentLoadedCyclone = null;

// Weather Timestamps & Live Auto-Updating Clock (Section 2)
let lastWeatherFetchDate = null;
let liveClockTimeout = null;
let liveClockInterval = null;
let weatherRefreshTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize common shell navigation & compact header
  GeoSafeUI.init('home', 'Home');

  // Start live clock immediately so current time is visible right away
  startLiveClock();

  // Initialize interactive Leaflet map
  initIncidentMap();

  // Load all live homepage records
  await loadHomepageData();

  // Start background periodic weather refresh (10 min cache/refresh interval)
  startWeatherAutoRefresh();
});

/**
 * Initialize Community Incident & Tropical Cyclone Leaflet Map
 */
function initIncidentMap() {
  try {
    incidentMap = GeoSafeMapping.createMap('incident-map', {
      center: [GeoSafeMapping.config.center.lat, GeoSafeMapping.config.center.lng],
      zoom: 15,
      scrollWheelZoom: false
    });

    incidentMarkersGroup = L.layerGroup().addTo(incidentMap);
    cycloneLayerGroup = L.layerGroup().addTo(incidentMap);
  } catch (err) {
    console.error('Failed to initialize incident map:', err);
  }
}

/**
 * Fetch and render all live homepage data
 */
async function loadHomepageData() {
  await Promise.all([
    loadDailyWeather(),
    loadTropicalCycloneData(),
    loadCommunityReports(),
    loadHazardAlerts(),
    loadEvacuationSummary(),
    loadFamilySummary()
  ]);
}

let residentGpsCoords = null;

/**
 * Check if resident has already granted browser geolocation permissions
 * Silent query without disruptive prompts; allows automatic live weather for resident's GPS
 */
async function checkResidentGpsPermission() {
  if (residentGpsCoords) return residentGpsCoords;
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;

  try {
    if (navigator.permissions && navigator.permissions.query) {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      if (status.state === 'granted') {
        const pos = await GeoSafeMapping.getCurrentLocation();
        residentGpsCoords = {
          lat: pos.lat,
          lng: pos.lng,
          isGps: true,
          locationName: 'My Location'
        };
        return residentGpsCoords;
      }
    }
  } catch (e) {
    // Permission query not supported or error; gracefully falls back to configured location
  }
  return null;
}

/**
 * Dynamic Weather Condition Lucide Line Icon Renderer
 * Accurately reflects provider weather condition codes & descriptions:
 * Clear, Mostly Clear, Partly Cloudy, Cloudy, Fog, Drizzle, Light Rain, Rain, Heavy Rain, Thunderstorm
 */
function renderWeatherConditionIcon(iconType, conditionText = '') {
  const cond = (conditionText || '').toLowerCase().trim();
  const type = (iconType || '').toLowerCase().trim();

  // 1. Drizzle (cloud with small raindrops, Lucide cloud-drizzle, blue accent)
  if (type === 'cloud-drizzle' || cond === 'drizzle' || cond.includes('drizzle')) {
    return `<svg class="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-label="Drizzle">
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
      <path d="M8 19v1"></path>
      <path d="M8 14v1"></path>
      <path d="M16 19v1"></path>
      <path d="M16 14v1"></path>
      <path d="M12 21v1"></path>
      <path d="M12 16v1"></path>
    </svg>`;
  }

  // 2. Light Rain (Lucide cloud-rain, light blue accent)
  if (cond === 'light rain') {
    return `<svg class="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-label="Light Rain">
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
      <path d="M16 14v4"></path>
      <path d="M8 14v4"></path>
      <path d="M12 16v4"></path>
    </svg>`;
  }

  // 3. Rain / Heavy Rain / Showers (Lucide cloud-rain, blue accent)
  if (type === 'cloud-rain' || cond.includes('rain') || cond.includes('shower')) {
    const isHeavy = cond.includes('heavy') || cond.includes('violent');
    return `<svg class="w-5 h-5 ${isHeavy ? 'text-blue-700' : 'text-blue-600'} flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-label="${conditionText || 'Rain'}">
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
      <path d="M16 14v6"></path>
      <path d="M8 14v6"></path>
      <path d="M12 16v6"></path>
    </svg>`;
  }

  // 4. Thunderstorm (Lucide cloud-lightning, purple accent)
  if (type === 'cloud-lightning' || cond.includes('thunder') || cond.includes('storm')) {
    return `<svg class="w-5 h-5 text-purple-600 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-label="Thunderstorm">
      <path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"></path>
      <path d="m13 12-3 5h4l-3 5"></path>
    </svg>`;
  }

  // 5. Fog / Haze (Lucide cloud-fog, slate accent)
  if (type === 'cloud-fog' || cond.includes('fog') || cond.includes('haze') || cond.includes('mist')) {
    return `<svg class="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-label="Fog">
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
      <path d="M4 17h16"></path>
      <path d="M6 21h12"></path>
    </svg>`;
  }

  // 6. Clear / Sunny (Lucide sun, golden yellow accent)
  if (type === 'sun' || cond === 'clear' || cond.includes('sunny')) {
    return `<svg class="w-5 h-5 text-[#F5B900] flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-label="Clear">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.07-7.07l-1.414 1.414M6.344 17.656l-1.414 1.414m14.14 0l-1.414-1.414M6.344 6.344L4.93 4.93"></path>
    </svg>`;
  }

  // 7. Mostly Clear (Lucide sun with soft warm glow)
  if (cond === 'mostly clear' || cond === 'mainly clear') {
    return `<svg class="w-5 h-5 text-[#F5B900] flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-label="Mostly Clear">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.07-7.07l-1.414 1.414M6.344 17.656l-1.414 1.414m14.14 0l-1.414-1.414M6.344 6.344L4.93 4.93"></path>
    </svg>`;
  }

  // 8. Cloudy / Overcast (Lucide cloud, slate accent)
  if (type === 'cloud' || cond === 'cloudy' || cond.includes('overcast')) {
    return `<svg class="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-label="Cloudy">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>
    </svg>`;
  }

  // 9. Partly Cloudy (Lucide cloud-sun / default, golden yellow accent)
  return `<svg class="w-5 h-5 text-[#F5B900] flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-label="Partly Cloudy">
    <path d="M12 2v2m4.93 1.07l-1.41 1.41M20 10h2M12 18v2m-6.36-3.64l-1.41 1.41M2 10h2M16 12a4 4 0 0 0-4-4"></path>
    <path d="M17.5 19H9a5 5 0 1 1 4.9-6.3A3.5 3.5 0 0 1 17.5 19z"></path>
  </svg>`;
}

/**
 * Format a Date object in Asia/Manila 12-hour format with AM/PM
 * Example: "2:30 PM"
 * @param {Date|string|number} dateInput
 * @returns {string}
 */
function formatManilaTime(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d);
}

/**
 * Update the last successful weather update timestamp display.
 * Distinguishes the actual API fetch time from the live advancing clock.
 */
function updateWeatherTimestampDisplay() {
  const timeEl = document.getElementById('wx-timestamp');
  if (!timeEl) return;

  if (lastWeatherFetchDate) {
    const formatted = formatManilaTime(lastWeatherFetchDate);
    timeEl.textContent = `Updated: ${formatted} (Asia/Manila)`;
    timeEl.setAttribute('data-last-updated', lastWeatherFetchDate.toISOString());
    timeEl.setAttribute('title', `Weather retrieved from provider at ${formatted} (Asia/Manila)`);
  }
}

/**
 * Update the live current clock in Asia/Manila.
 * Ticks every 60 seconds without affecting the last API fetch timestamp.
 */
function updateLiveClockDisplay() {
  const now = new Date();
  const manilaClock = formatManilaTime(now);

  const clockEl = document.getElementById('wx-live-clock');
  const timeOnlyEl = document.getElementById('wx-current-time');

  if (timeOnlyEl) {
    timeOnlyEl.textContent = `${manilaClock} (Asia/Manila)`;
  }
  if (clockEl && !timeOnlyEl) {
    clockEl.textContent = `Current: ${manilaClock} (Asia/Manila)`;
  }
}

/**
 * Start the live auto-updating clock.
 * Synchronizes with the top of the next minute, then ticks every 60 seconds.
 * Lifecycle-safe: clears any existing interval to prevent duplicates.
 */
function startLiveClock() {
  stopLiveClock();

  // Immediate display update
  updateLiveClockDisplay();

  // Calculate milliseconds remaining until the top of the next minute
  const now = new Date();
  const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

  liveClockTimeout = setTimeout(() => {
    updateLiveClockDisplay();
    // Subsequent ticks every 60 seconds (60,000ms)
    liveClockInterval = setInterval(updateLiveClockDisplay, 60000);
  }, Math.max(50, msUntilNextMinute));
}

/**
 * Stop and clean up the live clock timers.
 */
function stopLiveClock() {
  if (liveClockTimeout) {
    clearTimeout(liveClockTimeout);
    liveClockTimeout = null;
  }
  if (liveClockInterval) {
    clearInterval(liveClockInterval);
    liveClockInterval = null;
  }
}

/**
 * Periodic weather data refresh based on configured interval.
 * Completely separate from the 1-minute live clock.
 * Updates last fetch timestamp only upon successful API response.
 */
function startWeatherAutoRefresh() {
  stopWeatherAutoRefresh();
  const weatherSvc = window.GeoSafeWeather || (typeof GeoSafeWeather !== 'undefined' ? GeoSafeWeather : null);
  const refreshIntervalMs = (weatherSvc && weatherSvc.config && weatherSvc.config.meteorology && weatherSvc.config.meteorology.refreshIntervalMs)
    || (weatherSvc && weatherSvc.config && weatherSvc.config.meteorology && weatherSvc.config.meteorology.cacheExpiryMs)
    || 10 * 60 * 1000;

  weatherRefreshTimer = setInterval(async () => {
    try {
      await loadDailyWeather(residentGpsCoords, { silent: true });
    } catch (err) {
      console.warn('[Home] Periodic weather auto-refresh failed:', err);
    }
  }, refreshIntervalMs);
}

/**
 * Stop and clean up the periodic weather auto-refresh timer.
 */
function stopWeatherAutoRefresh() {
  if (weatherRefreshTimer) {
    clearInterval(weatherRefreshTimer);
    weatherRefreshTimer = null;
  }
}

// Clean up timers when page is unloaded
window.addEventListener('beforeunload', () => {
  stopLiveClock();
  stopWeatherAutoRefresh();
});

/**
 * Load Localized Daily Weather Information (Section A)
 * Strictly derives all condition text & values from live observation data.
 * @param {Object|null} optionalCoords GPS coordinates if granted
 * @param {Object} options Optional options { silent: boolean }
 */
async function loadDailyWeather(optionalCoords = null, options = {}) {
  const loadingEl = document.getElementById('weather-loading');
  const contentEl = document.getElementById('weather-content');
  const unavailEl = document.getElementById('weather-unavailable');

  if (!options.silent) {
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (contentEl) contentEl.classList.add('hidden');
    if (unavailEl) unavailEl.classList.add('hidden');
  }

  try {
    let coordsToUse = optionalCoords;
    if (!coordsToUse) {
      coordsToUse = await checkResidentGpsPermission();
    }

    const weatherSvc = window.GeoSafeWeather || (typeof GeoSafeWeather !== 'undefined' ? GeoSafeWeather : null);
    const wx = await weatherSvc.getDailyWeather(coordsToUse);

    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');

    // Populate weather elements
    const tempEl = document.getElementById('wx-temp');
    const condEl = document.getElementById('wx-condition');
    const locEl = document.getElementById('wx-location');
    const feelsEl = document.getElementById('wx-feels-like');
    const minEl = document.getElementById('wx-min-temp');
    const maxEl = document.getElementById('wx-max-temp');
    const rainEl = document.getElementById('wx-rain');
    const windEl = document.getElementById('wx-wind');
    const humEl = document.getElementById('wx-humidity');
    const srcEl = document.getElementById('wx-source');
    const iconBoxEl = document.getElementById('wx-icon-box');

    if (tempEl) tempEl.textContent = `${wx.currentTemp}°C`;
    if (condEl) condEl.textContent = wx.condition;
    if (locEl) locEl.textContent = wx.isGps ? (wx.location || 'GPS Position') : 'Barangay Bayanan';
    if (feelsEl) feelsEl.textContent = wx.feelsLike !== null ? wx.feelsLike : wx.currentTemp;
    if (minEl) minEl.textContent = wx.minTemp !== null ? wx.minTemp : '--';
    if (maxEl) maxEl.textContent = wx.maxTemp !== null ? wx.maxTemp : '--';
    if (rainEl) rainEl.textContent = `${wx.currentRainfallMm.toFixed(1)} mm`;
    if (windEl) windEl.textContent = `${wx.currentWindSpeedKmh} km/h`;
    if (humEl) humEl.textContent = `${wx.humidity}%`;
    if (srcEl) srcEl.textContent = 'DOST-PAGASA Ref / Open-Meteo';

    // Tooltips
    const rainPill = document.getElementById('wx-rain-pill');
    const windPill = document.getElementById('wx-wind-pill');
    const humPill = document.getElementById('wx-humidity-pill');
    if (rainPill) {
      const rainLabel = `Precipitation: ${wx.currentRainfallMm.toFixed(1)} mm (Forecast: ${wx.forecastRainfallMm} mm)`;
      rainPill.title = rainLabel;
      rainPill.setAttribute('aria-label', rainLabel);
    }
    if (windPill) {
      const windLabel = wx.windDirection ? `Wind Speed: ${wx.currentWindSpeedKmh} km/h (${wx.windDirection})` : `Wind Speed: ${wx.currentWindSpeedKmh} km/h`;
      windPill.title = windLabel;
      windPill.setAttribute('aria-label', windLabel);
    }
    if (humPill) {
      const humLabel = `Relative Humidity: ${wx.humidity}%`;
      humPill.title = humLabel;
      humPill.setAttribute('aria-label', humLabel);
    }

    if (iconBoxEl) {
      iconBoxEl.className = 'w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[#FFF9E8] border border-[#FFE872] flex items-center justify-center flex-shrink-0 shadow-subtle';
      iconBoxEl.innerHTML = renderWeatherConditionIcon(wx.iconType, wx.condition);
    }

    // Only update the last successful fetch timestamp upon successful API response
    lastWeatherFetchDate = wx.updatedAt ? new Date(wx.updatedAt) : new Date();
    updateWeatherTimestampDisplay();

    // Ensure live clock is active
    startLiveClock();
  } catch (err) {
    console.warn('[Home] Weather fetch failed:', err);
    // Do not update the timestamp when an API request fails
    if (!options.silent) {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (unavailEl) unavailEl.classList.remove('hidden');
    }
  }
}

/**
 * Load Tropical Cyclone Data & Render Map Layer (Section B)
 * ZERO FABRICATION: When no active cyclone inside PAR, shows clean clear status.
 */
async function loadTropicalCycloneData() {
  const bannerEl = document.getElementById('cyclone-bulletin-banner');
  const legendEyeEl = document.getElementById('legend-cyclone-eye');
  const legendTrackEl = document.getElementById('legend-cyclone-track');

  try {
    const weatherSvc = window.GeoSafeWeather || (typeof GeoSafeWeather !== 'undefined' ? GeoSafeWeather : null);
    const bulletin = await weatherSvc.getTropicalCycloneBulletin();
    currentLoadedCyclone = bulletin;

    if (!bulletin || !bulletin.active) {
      // Clean state: No active cyclone in PAR (Section D & G)
      if (bannerEl) bannerEl.classList.add('hidden');
      if (legendEyeEl) legendEyeEl.classList.add('hidden');
      if (legendTrackEl) legendTrackEl.classList.add('hidden');
      if (cycloneLayerGroup) cycloneLayerGroup.clearLayers();
      return;
    }

    // Active tropical cyclone bulletin officially verified
    if (bannerEl) {
      bannerEl.classList.remove('hidden');
      const nameEl = document.getElementById('cyclone-name-label');
      const catEl = document.getElementById('cyclone-category-badge');
      const windsEl = document.getElementById('cyclone-winds-label');
      const movEl = document.getElementById('cyclone-movement-label');
      const timeEl = document.getElementById('cyclone-bulletin-time');

      if (nameEl) nameEl.textContent = `${bulletin.name} (${bulletin.internationalName || 'PAGASA'})`;
      if (catEl) catEl.textContent = bulletin.category || 'Typhoon';
      if (windsEl) windsEl.textContent = `${bulletin.maxWindsKmh} km/h (Gusts: ${bulletin.gustsKmh} km/h)`;
      if (movEl) movEl.textContent = bulletin.movement || 'Moving Westward';
      if (timeEl) timeEl.textContent = `Bulletin #${bulletin.bulletinNumber || '1'} | ${GeoSafeUI.formatRelative(bulletin.issuedAt)}`;
    }

    if (legendEyeEl) legendEyeEl.classList.remove('hidden');
    if (legendTrackEl) legendTrackEl.classList.remove('hidden');

    renderTropicalCycloneLayer(bulletin);
  } catch (err) {
    console.warn('[Home] Cyclone bulletin fetch failed:', err);
  }
}

/**
 * Render Leaflet Tropical Cyclone Layer (Section B)
 */
function renderTropicalCycloneLayer(bulletin) {
  if (!cycloneLayerGroup || !bulletin || !bulletin.active) return;

  cycloneLayerGroup.clearLayers();

  const eyeCoords = [bulletin.coordinates.lat, bulletin.coordinates.lng];

  // 1. Gale / Warning Radius Circle (Section B: Warning areas)
  if (bulletin.galeRadiusKm) {
    const warningCircle = L.circle(eyeCoords, {
      radius: bulletin.galeRadiusKm * 1000,
      color: '#9333ea',
      weight: 1.5,
      fillColor: '#a855f7',
      fillOpacity: 0.12,
      dashArray: '3, 6'
    });
    cycloneLayerGroup.addLayer(warningCircle);
  }

  // 2. Historical Cyclone Track (Past verified points)
  if (bulletin.historicalTrack && bulletin.historicalTrack.length > 0) {
    const historyLatLngs = bulletin.historicalTrack.map(pt => [pt.lat, pt.lng]);
    historyLatLngs.push(eyeCoords);

    const historyLine = L.polyline(historyLatLngs, {
      color: '#7e22ce', // dark purple
      weight: 3.5,
      opacity: 0.8
    });
    cycloneLayerGroup.addLayer(historyLine);

    bulletin.historicalTrack.forEach(pt => {
      const pastDot = L.circleMarker([pt.lat, pt.lng], {
        radius: 4,
        fillColor: '#7e22ce',
        color: '#ffffff',
        weight: 1.5,
        fillOpacity: 0.9
      });
      pastDot.bindPopup(`<div class="text-[10px]"><strong>Past Eye Position:</strong><br>${pt.time || 'Previous observation'}</div>`);
      cycloneLayerGroup.addLayer(pastDot);
    });
  }

  // 3. Official Forecast Track (Future projections)
  if (bulletin.forecastTrack && bulletin.forecastTrack.length > 0) {
    const forecastLatLngs = [eyeCoords, ...bulletin.forecastTrack.map(pt => [pt.lat, pt.lng])];

    const forecastLine = L.polyline(forecastLatLngs, {
      color: '#c084fc', // light purple dashed
      weight: 3,
      opacity: 0.85,
      dashArray: '4, 8'
    });
    cycloneLayerGroup.addLayer(forecastLine);

    bulletin.forecastTrack.forEach(pt => {
      const forecastDot = L.circleMarker([pt.lat, pt.lng], {
        radius: 4.5,
        fillColor: '#ffffff',
        color: '#9333ea',
        weight: 2,
        fillOpacity: 1
      });
      forecastDot.bindPopup(`
        <div class="text-xs p-1">
          <strong class="text-purple-900 block">${pt.label || 'Projected Position'}</strong>
          <span class="text-[10px] text-slate-500">Max Winds: ${pt.winds || '--'} km/h</span>
        </div>
      `);
      cycloneLayerGroup.addLayer(forecastDot);
    });
  }

  // 4. Current Eye Position Marker
  const stormIcon = L.divIcon({
    className: 'geosafe-cyclone-marker',
    html: `
      <div class="relative flex items-center justify-center">
        <div class="w-9 h-9 rounded-full bg-purple-700 text-white flex items-center justify-center ring-4 ring-purple-300 shadow-xl border-2 border-white">
          <svg class="w-5 h-5 text-white animate-spin" style="animation-duration: 4s;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" stroke-width="2"></circle><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3a9 9 0 019 9c0 3.866-3.582 7-8 7s-8-3.134-8-7a8 8 0 018-8"></path></svg>
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20]
  });

  const eyeMarker = L.marker(eyeCoords, { icon: stormIcon });
  eyeMarker.bindPopup(`
    <div class="p-2 text-xs font-sans max-w-xs">
      <div class="flex items-center justify-between gap-2 mb-1">
        <span class="text-[10px] font-bold text-purple-800 bg-purple-100 px-1.5 py-0.2 rounded uppercase">${bulletin.category || 'Typhoon'}</span>
        <span class="text-[10px] text-slate-500 font-semibold">${bulletin.name}</span>
      </div>
      <h4 class="font-bold text-slate-900 text-xs mb-1">DOST-PAGASA Bulletin #${bulletin.bulletinNumber || '1'}</h4>
      <div class="bg-purple-50 p-1.5 rounded-lg border border-purple-200 text-[10px] text-purple-950 space-y-0.5 mb-2">
        <div><strong>Max Sustained Winds:</strong> ${bulletin.maxWindsKmh} km/h</div>
        <div><strong>Peak Gusts:</strong> ${bulletin.gustsKmh} km/h</div>
        <div><strong>Movement:</strong> ${bulletin.movement || 'Westward'}</div>
        <div><strong>Issued:</strong> ${GeoSafeUI.formatRelative(bulletin.issuedAt)}</div>
      </div>
      <p class="text-[10px] text-slate-500 italic">Always heed official warning signals from Barangay Bayanan BDRRMC.</p>
    </div>
  `);

  cycloneLayerGroup.addLayer(eyeMarker);
}

/**
 * Toggle Tropical Cyclone Monitoring Layer (Section B)
 */
window.toggleTropicalCycloneLayer = function () {
  if (!incidentMap || !cycloneLayerGroup) return;

  isCycloneLayerVisible = !isCycloneLayerVisible;
  const statusEl = document.getElementById('cyclone-toggle-status');
  const btn = document.getElementById('btn-toggle-cyclone');

  if (isCycloneLayerVisible) {
    if (!incidentMap.hasLayer(cycloneLayerGroup)) {
      incidentMap.addLayer(cycloneLayerGroup);
    }
    if (statusEl) statusEl.textContent = 'ON';
    if (btn) btn.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200 transition-colors';
    GeoSafeUI.showToast('Tropical cyclone tracking layer enabled.', 'info');
  } else {
    if (incidentMap.hasLayer(cycloneLayerGroup)) {
      incidentMap.removeLayer(cycloneLayerGroup);
    }
    if (statusEl) statusEl.textContent = 'OFF';
    if (btn) btn.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-500 hover:bg-slate-200 border border-slate-200 transition-colors';
    GeoSafeUI.showToast('Tropical cyclone tracking layer hidden.', 'info');
  }
};

/**
 * Load verified community reports and plot on map (Sections 2.C & 2.D)
 */
async function loadCommunityReports() {
  const mapEmptyOverlay = document.getElementById('incident-map-empty');
  const reportsEmptyEl = document.getElementById('community-reports-empty');
  const reportsListEl = document.getElementById('community-reports-list');
  const activeCountEl = document.getElementById('active-incidents-count');
  const headerCountEl = document.getElementById('reports-header-count');

  try {
    const reports = await window.geoSafeStore.getPublicIncidentReports();
    currentLoadedReports = reports || [];

    const totalCount = currentLoadedReports.length;

    // Update active count badge (Section 2.C)
    if (activeCountEl) activeCountEl.textContent = totalCount;
    if (headerCountEl) headerCountEl.textContent = `${totalCount} ${totalCount === 1 ? 'record' : 'records'}`;

    if (totalCount === 0) {
      if (mapEmptyOverlay) mapEmptyOverlay.classList.remove('hidden');
      if (reportsEmptyEl) reportsEmptyEl.classList.remove('hidden');
      if (reportsListEl) reportsListEl.classList.add('hidden');
      if (incidentMarkersGroup) incidentMarkersGroup.clearLayers();
      return;
    }

    if (mapEmptyOverlay) mapEmptyOverlay.classList.add('hidden');
    if (reportsEmptyEl) reportsEmptyEl.classList.add('hidden');
    if (reportsListEl) reportsListEl.classList.remove('hidden');

    // Plot incident markers on map
    renderMapMarkers(currentLoadedReports);

    // Render compact report cards
    renderCommunityReportsList(currentLoadedReports);
  } catch (err) {
    console.error('Error loading community reports:', err);
  }
}

/**
 * Render Leaflet markers for authorized reports (Section 2.C)
 */
function renderMapMarkers(reports) {
  if (!incidentMap || !incidentMarkersGroup) return;

  incidentMarkersGroup.clearLayers();
  const validCoordinates = [];

  reports.forEach((report) => {
    if (report.coordinates && typeof report.coordinates.lat === 'number' && typeof report.coordinates.lng === 'number') {
      const latLng = [report.coordinates.lat, report.coordinates.lng];
      validCoordinates.push(latLng);

      const markerIcon = GeoSafeMapping.createCustomIcon('incident');
      const marker = L.marker(latLng, { icon: markerIcon });

      const popupHtml = `
        <div class="p-2.5 text-xs font-sans max-w-xs">
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <span class="text-[10px] font-bold text-[#8A6800] bg-[#FFF9E8] px-2 py-0.5 rounded-full border border-[#FFE872] uppercase">${report.incidentType}</span>
            <span class="text-[10px] text-[#777777] font-semibold">${report.status || 'Verified'}</span>
          </div>
          <h4 class="font-bold text-[#202020] text-xs sm:text-sm mb-1">${report.title}</h4>
          <p class="text-[11px] text-[#777777] line-clamp-2 mb-2 leading-relaxed">${report.description}</p>
          <div class="bg-[#FFFDF7] p-2 rounded-xl border border-[#EEEEEE] text-[10px] text-[#777777] space-y-0.5 mb-2.5">
            <div><strong class="text-[#202020]">Location:</strong> ${report.location}</div>
            <div><strong class="text-[#202020]">Reported:</strong> ${GeoSafeUI.formatRelative(report.submittedAt)}</div>
          </div>
          <button onclick="openIncidentDetailsModal('${report.id}')" class="w-full py-1.5 px-2 bg-[#F5B900] text-[#202020] rounded-xl text-[11px] font-bold hover:bg-[#E5AC00] transition-colors shadow-subtle">
            View Details
          </button>
        </div>
      `;

      marker.bindPopup(popupHtml);
      incidentMarkersGroup.addLayer(marker);
    }
  });

  if (validCoordinates.length === 1 && (!currentLoadedCyclone || !currentLoadedCyclone.active)) {
    incidentMap.setView(validCoordinates[0], 16);
  } else if (validCoordinates.length > 1 && (!currentLoadedCyclone || !currentLoadedCyclone.active)) {
    const bounds = L.latLngBounds(validCoordinates);
    incidentMap.fitBounds(bounds, { padding: [40, 40] });
  }
}

/**
 * Render compact report cards (Section 2.D)
 */
function renderCommunityReportsList(reports) {
  const container = document.getElementById('community-reports-list');
  if (!container) return;

  container.innerHTML = reports.slice(0, 5).map((r) => {
    let statusClass = 'bg-[#FFF9E8] text-[#8A6800] border-[#FFE872]';
    if (r.status === 'Verified') {
      statusClass = 'bg-emerald-50 text-[#278653] border-emerald-200';
    } else if (r.status === 'Responding' || r.status === 'Assigned') {
      statusClass = 'bg-blue-50 text-blue-700 border-blue-200';
    } else if (r.status === 'Resolved') {
      statusClass = 'bg-[#FFFDF7] text-[#777777] border-[#EEEEEE]';
    }

    return `
      <div class="p-3.5 sm:p-4 bg-white rounded-2xl border border-[#EEEEEE] shadow-card hover:border-[#F5B900] transition-all flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-9 h-9 rounded-xl bg-[#FFF9E8] border border-[#FFE872] text-[#F5B900] flex items-center justify-center flex-shrink-0 shadow-subtle">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="font-bold text-xs sm:text-sm text-[#202020] truncate">${r.title}</h4>
              <span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold border ${statusClass} flex-shrink-0">
                ${r.status || 'Verified'}
              </span>
            </div>
            <p class="text-[11px] text-[#777777] truncate mt-0.5">${r.location} | ${GeoSafeUI.formatRelative(r.submittedAt)}</p>
          </div>
        </div>

        <button onclick="openIncidentDetailsModal('${r.id}')" class="px-3 py-1.5 rounded-xl bg-[#FFF9E8] hover:bg-[#FFF3D0] text-[#202020] font-bold text-xs flex-shrink-0 border border-[#FFE872] transition-colors">
          View
        </button>
      </div>
    `;
  }).join('');
}

/**
 * Load Hazard Alerts (Section 2.E)
 */
async function loadHazardAlerts() {
  const countEl = document.getElementById('stat-alerts-count');
  const summaryEl = document.getElementById('alerts-summary-text');
  const badgeEl = document.getElementById('alerts-severity-badge');

  try {
    const alerts = await window.geoSafeStore.getHazardAlerts();
    currentLoadedAlerts = alerts || [];
    const count = currentLoadedAlerts.length;

    if (countEl) countEl.textContent = `${count} Active`;

    if (count === 0) {
      if (summaryEl) summaryEl.textContent = 'No active hazard alerts.';
      if (badgeEl) badgeEl.classList.add('hidden');
      return;
    }

    const latest = currentLoadedAlerts[0];
    if (summaryEl) summaryEl.textContent = latest.headline || latest.title;

    if (badgeEl) {
      badgeEl.classList.remove('hidden');
      badgeEl.textContent = latest.severity || 'Moderate';
      badgeEl.className = 'text-[10px] font-bold px-1.5 py-0.2 rounded mt-1 inline-block bg-amber-100 text-amber-800 border border-amber-200';
    }
  } catch (err) {
    console.error('Error loading hazard alerts:', err);
  }
}

/**
 * Load Evacuation Centers Summary (Section 2.E)
 */
async function loadEvacuationSummary() {
  const countEl = document.getElementById('stat-centers-count');
  const summaryEl = document.getElementById('centers-summary-text');

  try {
    const centers = await window.geoSafeStore.getEvacuationCenters();
    const count = (centers || []).length;

    if (countEl) countEl.textContent = `${count} Centers`;

    if (count === 0) {
      if (summaryEl) summaryEl.textContent = 'No evacuation centers available.';
      return;
    }

    const firstCenter = centers[0];
    if (summaryEl) {
      summaryEl.textContent = `${firstCenter.name} (${firstCenter.status || 'Active'})`;
    }
  } catch (err) {
    console.error('Error loading evacuation centers summary:', err);
  }
}

/**
 * Load Family Safety Summary (Section 2.F)
 */
async function loadFamilySummary() {
  const countEl = document.getElementById('stat-family-count');
  const summaryEl = document.getElementById('family-summary-text');
  const detailEl = document.getElementById('family-sharing-detail');

  try {
    const members = await window.geoSafeStore.getFamilyMembers();
    const list = members || [];
    const totalCount = list.length;

    const sharingCount = list.filter(m => {
      const status = m.locationSharing?.status || (m.locationSharing?.enabled ? 'Sharing Location' : 'Not Sharing');
      return status === 'Sharing Location';
    }).length;

    if (countEl) countEl.textContent = `${totalCount} Members`;

    if (totalCount === 0) {
      if (summaryEl) summaryEl.textContent = 'No family members added.';
      if (detailEl) detailEl.classList.add('hidden');
      return;
    }

    if (summaryEl) {
      summaryEl.textContent = `${sharingCount} currently sharing location`;
    }

    if (detailEl) {
      detailEl.classList.remove('hidden');
      detailEl.textContent = `${totalCount - sharingCount} location sharing disabled`;
    }
  } catch (err) {
    console.error('Error loading family summary:', err);
  }
}

/**
 * GPS Locate Me on Community Map
 */
window.locateUserOnMap = async function () {
  const btn = document.getElementById('btn-locate-me');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="animate-spin w-3.5 h-3.5 mr-1 inline-block text-[#F5B900]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Locating...`;
  }

  try {
    const pos = await GeoSafeMapping.getCurrentLocation();
    const latLng = [pos.lat, pos.lng];

    if (!userLocationMarker) {
      const userIcon = GeoSafeMapping.createCustomIcon('user');
      userLocationMarker = L.marker(latLng, { icon: userIcon }).addTo(incidentMap);
      userLocationMarker.bindPopup('<strong class="text-xs">Your Current GPS Location</strong>');
    } else {
      userLocationMarker.setLatLng(latLng);
    }

    incidentMap.setView(latLng, 16);
    userLocationMarker.openPopup();
    GeoSafeUI.showToast('Acquired current GPS location.', 'info');

    // Automatically synchronize localized live weather with acquired GPS coordinates
    residentGpsCoords = {
      lat: pos.lat,
      lng: pos.lng,
      isGps: true,
      locationName: 'My Location'
    };
    loadDailyWeather(residentGpsCoords);
  } catch (err) {
    GeoSafeUI.showToast(err.message || 'Unable to access current GPS position.', 'warning');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg class="w-3.5 h-3.5 text-[#F5B900]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"></circle><line x1="22" y1="12" x2="18" y2="12" stroke-width="2" stroke-linecap="round"></line><line x1="6" y1="12" x2="2" y2="12" stroke-width="2" stroke-linecap="round"></line><line x1="12" y1="6" x2="12" y2="2" stroke-width="2" stroke-linecap="round"></line><line x1="12" y1="22" x2="12" y2="18" stroke-width="2" stroke-linecap="round"></line></svg>
        <span>Location</span>
      `;
    }
  }
};

window.refreshCommunityMap = async function () {
  await loadHomepageData();
  GeoSafeUI.showToast('Homepage records refreshed.', 'info');
};

/**
 * Incident Details Modal
 */
window.openIncidentDetailsModal = function (reportId) {
  const report = currentLoadedReports.find(r => r.id === reportId);
  if (!report) return;

  const modal = document.getElementById('incident-detail-modal');
  if (!modal) return;

  document.getElementById('modal-incident-type').textContent = report.incidentType;
  document.getElementById('modal-incident-title').textContent = report.title;
  document.getElementById('modal-incident-desc').textContent = report.description;
  document.getElementById('modal-incident-loc').textContent = report.location;
  document.getElementById('modal-incident-time').textContent = GeoSafeUI.formatRelative(report.submittedAt);
  document.getElementById('modal-incident-status').textContent = report.status || 'Verified';

  modal.classList.remove('hidden');
};

window.closeIncidentModal = function () {
  document.getElementById('incident-detail-modal')?.classList.add('hidden');
};

/**
 * Hazard Alerts Modal (Section 2.E)
 */
window.openAlertsModal = function () {
  const modal = document.getElementById('hazard-alerts-modal');
  const content = document.getElementById('alerts-modal-content');
  if (!modal || !content) return;

  if (currentLoadedAlerts.length === 0) {
    content.innerHTML = `
      <div class="py-8 text-center text-xs text-slate-400">
        <p class="font-bold text-slate-700 text-sm">No active hazard alerts.</p>
        <p class="text-[11px] mt-0.5 text-slate-400">Barangay Bayanan BDRRMC has not issued active severe weather or evacuation advisories.</p>
      </div>
    `;
  } else {
    content.innerHTML = currentLoadedAlerts.map(a => `
      <div class="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs space-y-1">
        <div class="flex items-center justify-between">
          <span class="font-bold text-amber-950">${a.headline || a.title}</span>
          <span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">${a.severity || 'Moderate'}</span>
        </div>
        <p class="text-[11px] text-slate-700 leading-relaxed">${a.description}</p>
        <span class="text-[10px] text-slate-400 block">Issued: ${GeoSafeUI.formatRelative(a.publishedAt)}</span>
      </div>
    `).join('');
  }

  modal.classList.remove('hidden');
};

window.closeAlertsModal = function () {
  document.getElementById('hazard-alerts-modal')?.classList.add('hidden');
};

window.loadDailyWeather = loadDailyWeather;
window.startLiveClock = startLiveClock;
window.stopLiveClock = stopLiveClock;
window.updateLiveClockDisplay = updateLiveClockDisplay;
window.formatManilaTime = formatManilaTime;
window.updateWeatherTimestampDisplay = updateWeatherTimestampDisplay;
window.startWeatherAutoRefresh = startWeatherAutoRefresh;
window.stopWeatherAutoRefresh = stopWeatherAutoRefresh;
window.getLastWeatherFetchDate = () => lastWeatherFetchDate;
