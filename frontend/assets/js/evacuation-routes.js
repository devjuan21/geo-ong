/**
 * GeoSafe - Resident Evacuation Routes & Live GPS Navigation Logic
 * ============================================================================
 * Features:
 * - Interactive Leaflet Map fitted to Barangay Bayanan evacuation centers from PostgreSQL
 * - Reuses GeoSafeMapping.createLiveNavigator (shared Responder Navigation engine):
 *     * Distinct states: Idle, Requesting Location, Navigating, Recalculating Route,
 *       Arrived, GPS Unavailable, Navigation Stopped
 *     * Live GPS acquisition via navigator.geolocation.getCurrentPosition & watchPosition
 *     * Automatic 10-second GPS synchronization while navigation is active
 *     * Reliable arrival detection using proximity threshold, GPS accuracy (<=50m),
 *       and consecutive valid GPS readings
 *     * Automatic navigation stop on arrival: clears 10s sync & watchPosition, removes
 *       route overlay, clears distance/ETA/turn-by-turn guidance, and locks Arrived state
 *       against delayed GPS or routing callbacks
 * ============================================================================
 */

let evacMap = null;
let centersMarkersGroup = null;
let userMarker = null;
let userAccuracyCircle = null;
let activeRouteCasing = null;
let activeRoutePolyline = null;
let activeRouteData = null;

let availableCenters = [];
let selectedCenterId = null;
let currentUserPosition = null;
let lastUserHeading = null;
let isFollowMode = false;
let hasArrived = false;
let liveNavigator = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getMapReservedTopPadding() {
  const navBanner = document.getElementById('nav-maneuver-banner');
  if (navBanner && !navBanner.classList.contains('hidden')) {
    return Math.max(56, (navBanner.offsetHeight || 0) + 14);
  }
  return 28;
}

function fitMapToBoundsWithPadding(bounds, options = {}) {
  if (!evacMap || !bounds || !bounds.isValid()) return;
  const topPad = getMapReservedTopPadding();
  evacMap.fitBounds(bounds, {
    paddingTopLeft: [24, topPad],
    paddingBottomRight: [24, 28],
    maxZoom: options.maxZoom || 16
  });
}

let evacAmbientGpsTracker = null;

function startAmbientEvacuationGps() {
  if (evacAmbientGpsTracker || !GeoSafeMapping || typeof GeoSafeMapping.createLiveGpsTracker !== 'function') {
    return;
  }
  evacAmbientGpsTracker = GeoSafeMapping.createLiveGpsTracker({
    syncIntervalMs: 10000,
    onLocation: (reading) => {
      // When live route navigation is actively running, let liveNavigator drive HUD/route updates
      if (typeof isNavigationActive === 'function' && isNavigationActive()) return;
      currentUserPosition = {
        lat: reading.lat,
        lng: reading.lng,
        accuracy: reading.accuracy,
        heading: reading.heading,
        speed: reading.speed,
        timestamp: reading.timestamp,
        updatedAt: reading.updatedAt,
        isGps: true,
        isStale: Boolean(reading.isStale),
        source: 'gps'
      };
      if (typeof renderUserLocationMarker === 'function') {
        renderUserLocationMarker();
      }
      if (typeof updateNavigationMeta === 'function') {
        updateNavigationMeta(currentUserPosition);
      }
      if (reading.isStale) {
        updateGpsStatusBanner('warning', 'GPS signal temporarily unavailable — showing last valid location (stale).');
      } else {
        updateGpsStatusBanner('hidden', '');
      }
    },
    onStatusChange: ({ status }) => {
      if (typeof isNavigationActive === 'function' && isNavigationActive()) return;
      if (status === 'denied') {
        updateGpsStatusBanner('error', 'Location permission denied. Enable GPS in browser settings to track your live position.');
      } else if (status === 'unavailable' && !evacAmbientGpsTracker.getLastReading()) {
        updateGpsStatusBanner('warning', 'Unable to detect your current GPS position.');
      }
    }
  });
  evacAmbientGpsTracker.start();
}

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeUI.init('evacuation-routes', 'Evacuation Routes');
  initEvacuationMap();
  initLiveNavigator();
  startAmbientEvacuationGps();
  await GeoSafeMapping.loadBayananBoundary();
  await loadEvacuationCenters();

  const params = new URLSearchParams(window.location.search);
  const queryCenterId = params.get('centerId');
  if (queryCenterId && availableCenters.some(c => String(c.id) === String(queryCenterId))) {
    window.selectDestination(queryCenterId, { autoStartNavigation: false });
  }

  window.addEventListener('geosafe:realtime-update', () => {
    loadEvacuationCenters();
  });

  window.addEventListener('pagehide', () => stopLiveNavigation({ silent: true }));
  window.addEventListener('beforeunload', () => stopLiveNavigation({ silent: true }));
});

/**
 * Initialize Leaflet map with bottom-right zoom controls
 */
function initEvacuationMap() {
  try {
    evacMap = GeoSafeMapping.createMap('evacuation-map', {
      zoomControl: false,
      scrollWheelZoom: true,
      fitBayananBounds: false
    });

    if (typeof L !== 'undefined' && L.control && L.control.zoom) {
      L.control.zoom({ position: 'bottomright' }).addTo(evacMap);
    }

    evacMap.on('dragstart', () => {
      if (isNavigationActive() && isFollowMode) {
        isFollowMode = false;
      }
    });

    centersMarkersGroup = L.layerGroup().addTo(evacMap);

    const bayananBounds = GeoSafeMapping.getBayananBounds();
    if (bayananBounds && bayananBounds.isValid()) {
      fitMapToBoundsWithPadding(bayananBounds, { maxZoom: 16 });
    }
  } catch (err) {
    console.error('Failed to initialize evacuation map:', err);
  }
}

function isNavigationActive() {
  return Boolean(liveNavigator && liveNavigator.getState().active && !hasArrived);
}

/**
 * Initialize reusable Live GPS Navigator (shared architecture with Responder Navigation)
 */
function initLiveNavigator() {
  if (!window.GeoSafeMapping || typeof GeoSafeMapping.createLiveNavigator !== 'function') return;

  liveNavigator = GeoSafeMapping.createLiveNavigator({
    syncIntervalMs: 10000,
    staleTimeoutMs: 25000,
    maxAccuracyMeters: 1000,
    routeAccuracyMaxMeters: 150,
    cycleMoveThresholdMeters: 5,
    watchMoveThresholdMeters: 35,
    offRouteThresholdMeters: 45,
    routeCooldownMs: 9000,
    arrivalRadiusMeters: 15,
    arrivalMaxAccuracyMeters: 150,
    consecutiveArrivalReadingsRequired: 2,
    arrivalRecheckIntervalMs: 800,
    routeFn: (originGps, destCoords) => GeoSafeMapping.calculatePedestrianRoute(originGps, destCoords),

    onStatusChange(statusText, meta = {}) {
      if (hasArrived && statusText !== 'Arrived') return;
      updateNavigationStatusBadge(statusText, meta);
      const overlay = document.getElementById('route-calculating-overlay');
      const loadingText = document.getElementById('route-loading-text');
      if (!hasArrived && (meta.isAcquiring || (meta.isRouting && !activeRouteData))) {
        if (loadingText) {
          loadingText.textContent = meta.isAcquiring
            ? 'Requesting your live GPS location...'
            : 'Calculating road route to evacuation center...';
        }
        if (overlay) overlay.classList.remove('hidden');
      } else if (overlay) {
        overlay.classList.add('hidden');
      }
    },

    onGpsUpdate(gps) {
      if (hasArrived) return;
      if (Number.isFinite(gps.heading) && (!Number.isFinite(gps.speed) || gps.speed > 0.3)) {
        lastUserHeading = gps.heading;
      }
      currentUserPosition = {
        lat: gps.lat,
        lng: gps.lng,
        accuracy: gps.accuracy,
        timestamp: gps.timestamp,
        label: `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`,
        isGps: true
      };

      setGpsStatusBanner(false);
      updateGpsAccuracyDisplay(gps);
      renderUserLocationMarker();

      if (isFollowMode && evacMap && activeRouteData && !hasArrived) {
        evacMap.panTo([gps.lat, gps.lng], { animate: true });
      }
    },

    onRouteCalculated(route, liveGps, isInitialRoute) {
      if (hasArrived || (liveNavigator && liveNavigator.getState().arrived)) return;

      activeRouteData = route;
      renderRoutePolylines(route.coordinates);

      const destination = getSelectedCenter();
      const destCoords = getCenterCoords(destination);
      updateNavigationHud(route, destination, liveGps);

      if (isInitialRoute && evacMap && activeRoutePolyline) {
        const routeBounds = activeRoutePolyline.getBounds();
        if (liveGps) routeBounds.extend([liveGps.lat, liveGps.lng]);
        if (destCoords) routeBounds.extend([destCoords.lat, destCoords.lng]);
        fitMapToBoundsWithPadding(routeBounds, { maxZoom: 17 });
      }

      if (isInitialRoute) {
        GeoSafeUI.showToast(
          `Live GPS navigation started to ${(destination && destination.name) || 'evacuation center'}.`,
          'success'
        );
      }
    },

    onRouteProgress(route, liveGps) {
      if (hasArrived || (liveNavigator && liveNavigator.getState().arrived)) return;
      const destination = getSelectedCenter();
      if (route && destination) {
        updateNavigationHud(route, destination, liveGps);
      }
    },

    onArrival(gps, distMeters) {
      if (hasArrived) return;
      hasArrived = true;
      isFollowMode = false;
      lastUserHeading = null;
      activeRouteData = null;

      // Immediately remove active route overlay and stop guidance UI
      clearRoutePolylines();
      const activeDest = getSelectedCenter();
      renderArrivalStateUI(activeDest, distMeters);
      syncNavigationControlButtons();
      renderUserLocationMarker();
      renderCentersList(availableCenters);

      GeoSafeUI.showToast(
        `You have arrived at ${(activeDest && activeDest.name) || 'the evacuation center'}.`,
        'success'
      );
    },

    onError(message, code, canRetry = true) {
      if (hasArrived) return;
      const overlay = document.getElementById('route-calculating-overlay');
      if (overlay) overlay.classList.add('hidden');

      showNavigationError(message, canRetry);
      if (
        code === 'PERMISSION_DENIED' ||
        code === 'HTTPS_REQUIRED' ||
        code === 'UNSUPPORTED' ||
        code === 'POSITION_UNAVAILABLE' ||
        code === 'TIMEOUT'
      ) {
        setGpsStatusBanner(true, message, canRetry);
      }
    },

    onClearError() {
      hideNavigationError();
      setGpsStatusBanner(false);
    },

    onStop({ clearRoute, userPaused, preserveArrived }) {
      const overlay = document.getElementById('route-calculating-overlay');
      if (overlay) overlay.classList.add('hidden');
      syncNavigationControlButtons();
      renderUserLocationMarker();
      if (clearRoute) {
        clearRoutePolylines();
      }
      if (!preserveArrived && !hasArrived && userPaused) {
        updateNavigationStatusBadge('Navigation Stopped', { isPaused: true });
      }
    }
  });
}

function getSelectedCenter() {
  if (!selectedCenterId) return null;
  return availableCenters.find(c => String(c.id) === String(selectedCenterId)) || null;
}

/**
 * Render clean Arrival UI and remove all active route guidance, turn-by-turn steps, distance, and ETA
 */
function renderArrivalStateUI(destination, distMeters) {
  const resultCard = document.getElementById('route-result-card');
  const arrivalBanner = document.getElementById('nav-arrival-banner');
  const arrivalDestName = document.getElementById('nav-arrival-dest-name');
  const arrivalText = document.getElementById('nav-arrival-text');
  const maneuverBanner = document.getElementById('nav-maneuver-banner');
  const maneuverDistEl = document.getElementById('nav-maneuver-distance');
  const maneuverTextEl = document.getElementById('nav-maneuver-text');
  const metricsEl = document.getElementById('evac-nav-metrics');
  const nextStepBox = document.getElementById('evac-nav-next-step');
  const nextInstEl = document.getElementById('evac-nav-next-instruction');
  const nextDistEl = document.getElementById('evac-nav-next-dist');
  const stepsWrap = document.getElementById('evac-nav-steps-wrap');
  const stepsList = document.getElementById('evac-nav-steps-list');
  const stepsCount = document.getElementById('evac-nav-steps-count');
  const distVal = document.getElementById('route-distance-val');
  const durVal = document.getElementById('route-duration-val');
  const etaVal = document.getElementById('route-eta-val');
  const activeNavActions = document.getElementById('evac-active-nav-actions');
  const overlay = document.getElementById('route-calculating-overlay');

  if (resultCard) resultCard.classList.remove('hidden');
  if (overlay) overlay.classList.add('hidden');
  hideNavigationError();
  setGpsStatusBanner(false);

  // Hide and clear all active turn-by-turn guidance and remaining distance/ETA
  if (maneuverBanner) maneuverBanner.classList.add('hidden');
  if (maneuverDistEl) maneuverDistEl.textContent = '';
  if (maneuverTextEl) maneuverTextEl.textContent = '';

  if (metricsEl) metricsEl.classList.add('hidden');
  if (distVal) distVal.textContent = '';
  if (durVal) durVal.textContent = '';
  if (etaVal) etaVal.textContent = '';

  if (nextStepBox) nextStepBox.classList.add('hidden');
  if (nextInstEl) nextInstEl.textContent = '';
  if (nextDistEl) nextDistEl.textContent = '';

  if (stepsWrap) stepsWrap.classList.add('hidden');
  if (stepsList) stepsList.innerHTML = '';
  if (stepsCount) stepsCount.textContent = '';

  if (activeNavActions) activeNavActions.classList.add('hidden');

  updateNavigationStatusBadge('Arrived', { isArrived: true, isSuccess: true });

  const destTitle = (destination && destination.name) || 'Selected Evacuation Center';
  if (arrivalDestName) arrivalDestName.textContent = destTitle;
  if (arrivalText) {
    const distNote = Number.isFinite(distMeters) ? ` (${Math.round(distMeters)}m from center)` : '';
    arrivalText.textContent = `You have arrived at ${destTitle}${distNote}. Active route guidance has ended.`;
  }
  if (arrivalBanner) arrivalBanner.classList.remove('hidden');
}

function updateGpsAccuracyDisplay(gps) {
  const accEl = document.getElementById('nav-gps-accuracy');
  if (!accEl) return;
  if (!gps || !Number.isFinite(gps.lat)) {
    accEl.textContent = '';
    return;
  }
  const timeStr = new Date(gps.timestamp || Date.now()).toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const accPart = Number.isFinite(gps.accuracy) ? `GPS accuracy: ±${Math.round(gps.accuracy)}m` : 'GPS active';
  accEl.textContent = `${accPart} • Updated ${timeStr}`;
}

function updateNavigationStatusBadge(statusText, meta = {}) {
  const badgeEl = document.getElementById('route-status-badge');
  if (!badgeEl) return;
  badgeEl.textContent = statusText;

  if (hasArrived || statusText === 'Arrived' || meta.isArrived || meta.isSuccess) {
    badgeEl.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-[#278653] border border-emerald-200';
  } else if (statusText === 'GPS Unavailable' || meta.isError) {
    badgeEl.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2]';
  } else if (
    statusText === 'Requesting Location' ||
    statusText === 'Recalculating Route' ||
    meta.isWarning ||
    meta.isAcquiring ||
    meta.isRouting ||
    meta.isSyncing
  ) {
    badgeEl.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-50 text-[#8A6800] border border-[#FFE872]';
  } else if (statusText === 'Idle' || statusText === 'Navigation Stopped' || meta.isPaused) {
    badgeEl.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#F7F7F7] text-[#555555] border border-slate-200';
  } else {
    badgeEl.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-50 text-[#3478C7] border border-blue-200';
  }
}

function syncNavigationControlButtons() {
  const active = isNavigationActive();
  const startBtn = document.getElementById('btn-start-nav');
  const stopBtn = document.getElementById('btn-stop-nav');
  const recenterBtn = document.getElementById('btn-recenter-nav');

  if (startBtn) {
    startBtn.classList.toggle('hidden', active);
    startBtn.disabled = !selectedCenterId && availableCenters.length === 0;
  }
  if (stopBtn) {
    stopBtn.classList.toggle('hidden', !active);
  }
  if (recenterBtn) {
    recenterBtn.classList.remove('hidden');
  }
}

function showNavigationError(message, allowRetry = true) {
  if (hasArrived) return;
  const resultCard = document.getElementById('route-result-card');
  const errorBox = document.getElementById('route-error-box');
  const errorMsg = document.getElementById('route-error-msg');
  const retryBtn = document.getElementById('route-error-retry-btn');

  if (resultCard) resultCard.classList.remove('hidden');
  if (errorMsg) errorMsg.textContent = message;
  if (retryBtn) retryBtn.classList.toggle('hidden', !allowRetry);
  if (errorBox) errorBox.classList.remove('hidden');
}

function hideNavigationError() {
  const errorBox = document.getElementById('route-error-box');
  if (errorBox) errorBox.classList.add('hidden');
}

function setGpsStatusBanner(visible, message = '', showActions = true) {
  const banner = document.getElementById('gps-status-banner');
  const textEl = document.getElementById('gps-status-text');
  const actionsEl = document.getElementById('gps-status-actions');
  if (!banner) return;
  if (!visible || hasArrived) {
    banner.classList.add('hidden');
    return;
  }
  if (textEl) textEl.textContent = message;
  if (actionsEl) actionsEl.classList.toggle('hidden', !showActions);
  banner.classList.remove('hidden');
}

function formatGpsErrorMessage(err) {
  if (!err) return 'Unable to retrieve your device GPS location.';
  if (err.code === 'INSECURE_CONTEXT_LAN') {
    return 'Browser GPS requires a secure HTTPS connection (or localhost).';
  }
  if (err.code === 1) {
    return 'GPS location permission was denied. Please enable location access in your browser settings and retry.';
  }
  if (err.code === 2) {
    return 'Device GPS location is currently unavailable. Check your device location services and retry.';
  }
  if (err.code === 3) {
    return 'GPS location request timed out. Please move to an area with clear sky view and retry.';
  }
  return err.message || 'Unable to retrieve device GPS location.';
}

function createNavigationUserIcon() {
  const compass = GeoSafeMapping && typeof GeoSafeMapping.getCompassStatus === 'function'
    ? GeoSafeMapping.getCompassStatus()
    : null;
  const heading = compass && Number.isFinite(compass.continuousHeading)
    ? compass.continuousHeading
    : (Number.isFinite(lastUserHeading) ? lastUserHeading : null);
  return GeoSafeMapping.createCustomIcon('user', { heading });
}

let evacCompassUnsub = null;
function ensureEvacCompassSubscription() {
  if (evacCompassUnsub || !GeoSafeMapping || typeof GeoSafeMapping.subscribeCompassHeading !== 'function') return;
  evacCompassUnsub = GeoSafeMapping.subscribeCompassHeading(({ heading, continuousHeading }) => {
    if (userMarker && evacMap && evacMap.hasLayer(userMarker)) {
      GeoSafeMapping.updateGpsMarkerHeading(userMarker, heading, continuousHeading);
    }
  });
  if (evacMap && typeof GeoSafeMapping.attachCompassDiagnosticsPanel === 'function') {
    GeoSafeMapping.attachCompassDiagnosticsPanel(evacMap);
  }
  if (evacMap && typeof evacMap.once === 'function') {
    evacMap.once('unload', () => {
      if (evacCompassUnsub) {
        evacCompassUnsub();
        evacCompassUnsub = null;
      }
    });
  }
}

const evacUserMarkerState = { marker: null, accuracyCircle: null, continuousHeading: null };

/**
 * Render or update Resident's actual GPS location marker and accuracy circle on the map
 */
function renderUserLocationMarker() {
  if (!evacMap) return;
  if (!currentUserPosition || !Number.isFinite(currentUserPosition.lat) || !Number.isFinite(currentUserPosition.lng)) {
    if (userMarker) {
      evacMap.removeLayer(userMarker);
      userMarker = null;
    }
    if (userAccuracyCircle) {
      evacMap.removeLayer(userAccuracyCircle);
      userAccuracyCircle = null;
    }
    evacUserMarkerState.marker = null;
    evacUserMarkerState.accuracyCircle = null;
    return;
  }

  const title = hasArrived
    ? 'Arrived at Evacuation Center'
    : isNavigationActive()
    ? 'Your Live GPS Location'
    : 'Your Current GPS Location';

  GeoSafeMapping.renderLiveGpsMarker(
    evacMap,
    evacUserMarkerState,
    {
      lat: currentUserPosition.lat,
      lng: currentUserPosition.lng,
      accuracy: currentUserPosition.accuracy,
      heading: Number.isFinite(lastUserHeading) ? lastUserHeading : null,
      speed: Number.isFinite(currentUserPosition.speed) ? currentUserPosition.speed : null,
      updatedAt: currentUserPosition.updatedAt || Date.now(),
      isStale: Boolean(currentUserPosition.isStale),
    },
    {
      title,
      zIndexOffset: 700,
    }
  );
  userMarker = evacUserMarkerState.marker;
  userAccuracyCircle = evacUserMarkerState.accuracyCircle;
}

function renderRoutePolylines(coordinates) {
  if (hasArrived || !evacMap || !Array.isArray(coordinates) || coordinates.length < 2) return;
  clearRoutePolylines();

  activeRouteCasing = L.polyline(coordinates, {
    color: '#FFFFFF',
    weight: 9,
    opacity: 0.95,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(evacMap);

  activeRoutePolyline = L.polyline(coordinates, {
    color: '#1D4ED8',
    weight: 5,
    opacity: 0.95,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(evacMap);
}

function clearRoutePolylines() {
  if (activeRouteCasing && evacMap) {
    try { evacMap.removeLayer(activeRouteCasing); } catch (_) {}
    activeRouteCasing = null;
  }
  if (activeRoutePolyline && evacMap) {
    try { evacMap.removeLayer(activeRoutePolyline); } catch (_) {}
    activeRoutePolyline = null;
  }
}

function getCenterCoords(center) {
  if (!center) return null;
  const lat = center.coordinates && Number.isFinite(Number(center.coordinates.lat))
    ? Number(center.coordinates.lat)
    : Number(center.latitude);
  const lng = center.coordinates && Number.isFinite(Number(center.coordinates.lng))
    ? Number(center.coordinates.lng)
    : Number(center.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

function isActiveDestinationCenter(center) {
  const status = String((center && center.status) || '').trim().toLowerCase();
  return status === 'open for accommodation' || status === 'open - accommodating' || status === 'open-accommodating';
}

function isBayananCenter(center) {
  if (!center) return false;
  if (String(center.barangay || '').toLowerCase().includes('bayanan')) return true;
  const coords = getCenterCoords(center);
  return Boolean(coords && GeoSafeMapping.isPointInsideBayanan(coords.lat, coords.lng) !== false);
}

/**
 * Fit map bounds to available evacuation centers within Barangay Bayanan
 */
function fitMapToBayananCenters() {
  if (!evacMap) return;

  const bayananCenterCoords = [];
  const allValidCenterCoords = [];

  availableCenters.forEach(c => {
    const coords = getCenterCoords(c);
    if (!coords) return;
    allValidCenterCoords.push([coords.lat, coords.lng]);
    if (isBayananCenter(c)) {
      bayananCenterCoords.push([coords.lat, coords.lng]);
    }
  });

  const targetCoords = bayananCenterCoords.length > 0 ? bayananCenterCoords : allValidCenterCoords;
  const bounds = L.latLngBounds([]);

  targetCoords.forEach(pt => bounds.extend(pt));

  if (currentUserPosition && currentUserPosition.isGps) {
    const userInside = GeoSafeMapping.isPointInsideBayanan(currentUserPosition.lat, currentUserPosition.lng);
    if (userInside !== false || targetCoords.length === 1) {
      bounds.extend([currentUserPosition.lat, currentUserPosition.lng]);
    }
  }

  if (bounds.isValid()) {
    fitMapToBoundsWithPadding(bounds, { maxZoom: 16 });
    return;
  }

  const bayananBounds = GeoSafeMapping.getBayananBounds();
  if (bayananBounds && bayananBounds.isValid()) {
    fitMapToBoundsWithPadding(bayananBounds, { maxZoom: 16 });
  }
}

/**
 * Load designated evacuation centers from PostgreSQL via store
 */
async function loadEvacuationCenters() {
  const emptyEl = document.getElementById('evacuation-centers-empty');
  const listEl = document.getElementById('evacuation-centers-list');
  const selectEl = document.getElementById('route-destination-select');
  const badgeEl = document.getElementById('shelters-count-badge');

  try {
    const result = await window.geoSafeStore.getEvacuationCenters();
    const rawCenters = Array.isArray(result) ? result : [];
    availableCenters = rawCenters.filter(c => isActiveDestinationCenter(c) && isBayananCenter(c));
    const count = availableCenters.length;

    if (badgeEl) {
      badgeEl.textContent = `${count} ${count === 1 ? 'center' : 'centers'}`;
    }

    if (count === 0) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (listEl) listEl.classList.add('hidden');
      if (selectEl) {
        selectEl.innerHTML = '<option value="" disabled selected>No active evacuation centers available</option>';
        selectEl.disabled = true;
      }
      if (centersMarkersGroup) centersMarkersGroup.clearLayers();
      fitMapToBayananCenters();
      syncNavigationControlButtons();
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    if (listEl) listEl.classList.remove('hidden');

    if (selectEl) {
      selectEl.disabled = false;
      selectEl.innerHTML = `
        <option value="" disabled ${selectedCenterId ? '' : 'selected'}>Select an evacuation center...</option>
        ${availableCenters.map(c => {
          const safeName = escapeHtml(c.name || 'Evacuation Center');
          const isSel = selectedCenterId !== null && String(c.id) === String(selectedCenterId);
          return `<option value="${escapeHtml(c.id)}" ${isSel ? 'selected' : ''}>${safeName}</option>`;
        }).join('')}
      `;
    }

    renderCentersList(availableCenters);
    plotCentersOnMap(availableCenters);
    if (!activeRoutePolyline && !isNavigationActive() && !hasArrived) {
      fitMapToBayananCenters();
    }
    syncNavigationControlButtons();
  } catch (err) {
    console.error('Error loading evacuation centers:', err);
    if (badgeEl) badgeEl.textContent = '0 centers';
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (listEl) listEl.classList.add('hidden');
  }
}

/**
 * Render evacuation center cards with a single destination selection action
 */
function renderCentersList(centers) {
  const container = document.getElementById('evacuation-centers-list');
  if (!container) return;

  container.innerHTML = centers.map(c => {
    const isSelected = selectedCenterId !== null && String(c.id) === String(selectedCenterId);
    const name = escapeHtml(c.name || 'Evacuation Center');
    const address = escapeHtml(c.address || 'Barangay Bayanan, Muntinlupa City');
    const status = escapeHtml(c.status || 'Active');
    const isFull = status.toLowerCase().includes('full') || status.toLowerCase().includes('closed');

    const statusBadgeClass = isFull
      ? 'text-[#D93636] bg-[#FFF1F1] border-[#FFC2C2]'
      : 'text-[#278653] bg-emerald-50 border-emerald-200';

    const cardClass = isSelected
      ? 'h-full min-w-0 p-3 bg-[#FFFDF4] rounded-lg border-2 border-[#F5B900] ring-1 ring-[#FFE872]/60 shadow-subtle transition-all flex flex-col justify-between gap-2 cursor-pointer'
      : 'h-full min-w-0 p-3 bg-white rounded-lg border border-slate-200 shadow-subtle hover:border-[#F5B900] transition-all flex flex-col justify-between gap-2 cursor-pointer';

    return `
      <div class="${cardClass}" data-center-id="${escapeHtml(c.id)}" onclick="selectDestination('${escapeHtml(c.id)}')">
        <div class="min-w-0 space-y-1">
          <div class="flex items-start justify-between gap-2 min-w-0">
            <h3 class="font-bold text-[#202020] text-xs sm:text-sm leading-tight break-words min-w-0">${name}</h3>
            <span class="text-[10px] font-semibold px-2 py-0.5 leading-none rounded-full border flex-shrink-0 ${statusBadgeClass}">
              ${status}
            </span>
          </div>
          <p class="text-[11px] text-[#6B7280] leading-snug line-clamp-2 break-words">${address}</p>
        </div>

        <div class="flex items-center justify-end pt-1">
          <span class="px-2.5 h-7 rounded-lg border ${
            isSelected
              ? 'border-[#202020] bg-[#202020] text-white'
              : 'border-slate-200 bg-slate-50 text-[#202020]'
          } font-bold text-[11px] leading-none transition-colors inline-flex items-center justify-center">
            ${isSelected ? 'Selected Destination' : 'Select Center'}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Plot evacuation center markers on Leaflet map
 */
function plotCentersOnMap(centers) {
  if (!evacMap || !centersMarkersGroup) return;

  centersMarkersGroup.clearLayers();

  centers.forEach(c => {
    if (!isActiveDestinationCenter(c) || !isBayananCenter(c)) return;
    const coords = getCenterCoords(c);
    if (!coords) return;

    const latLng = [coords.lat, coords.lng];
    const isSelected = selectedCenterId !== null && String(c.id) === String(selectedCenterId);
    const hasSelection = selectedCenterId !== null;
    const shelterIcon = GeoSafeMapping.createCustomIcon('evacuation', { selected: isSelected });
    const marker = L.marker(latLng, {
      icon: shelterIcon,
      opacity: hasSelection && !isSelected ? 0.72 : 1,
      zIndexOffset: isSelected ? 500 : 0
    });

    if (isSelected) {
      const highlightRing = L.circleMarker(latLng, {
        radius: 18,
        color: '#F5B900',
        weight: 3,
        fillColor: '#F5B900',
        fillOpacity: 0.2,
        interactive: false
      });
      centersMarkersGroup.addLayer(highlightRing);
    }

    const safeName = escapeHtml(c.name || 'Evacuation Center');
    const safeAddr = escapeHtml(c.address || 'Barangay Bayanan, Muntinlupa City');

    const popupHtml = `
      <div class="p-2 text-xs font-sans max-w-xs space-y-1.5">
        <div class="text-[10px] font-bold text-[#278653] uppercase tracking-wider">Evacuation Center</div>
        <h4 class="font-bold text-[#202020] text-xs sm:text-sm">${safeName}</h4>
        <p class="text-[11px] text-[#6B7280]">${safeAddr}</p>
        <button type="button" onclick="selectDestination('${escapeHtml(c.id)}')" class="w-full py-1.5 px-2.5 bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] rounded-md text-[11px] font-bold transition-colors shadow-subtle">
          ${isSelected ? 'Selected Destination' : 'Select Center'}
        </button>
      </div>
    `;

    marker.bindPopup(popupHtml);
    centersMarkersGroup.addLayer(marker);
  });
}

function formatManeuverText(step) {
  if (!step) return 'Follow highlighted road route';
  const type = String(step.type || '').toLowerCase();
  if (type === 'arrive') {
    return step.name ? `Proceed to destination on ${step.name}` : 'Proceed to destination';
  }
  if (step.instruction) return step.instruction;
  const modifier = String(step.modifier || '').replace(/-/g, ' ').trim();
  const street = step.name ? ` onto ${step.name}` : '';
  if (type === 'depart') return `Head ${modifier || 'forward'}${street}`;
  if (type === 'turn' || type === 'end of road' || type === 'fork') {
    return `${modifier ? `Turn ${modifier}` : 'Turn'}${street}`;
  }
  if (type === 'continue' || type === 'new name') {
    return `Continue${street}`;
  }
  return `${modifier ? `${modifier} ` : ''}${step.name || 'Continue on route'}`.trim();
}

function getManeuverIconSvg(step) {
  const mod = String((step && step.modifier) || '').toLowerCase();
  if (mod.includes('left')) {
    return '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 14l-4-4m0 0l4-4m-4 4h11a4 4 0 014 4v3"></path></svg>';
  }
  if (mod.includes('right')) {
    return '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 14l4-4m0 0l-4-4m4 4H8a4 4 0 00-4 4v3"></path></svg>';
  }
  return '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18"></path></svg>';
}

function formatArrivalClock(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return '';
  const etaDate = new Date(Date.now() + durationSeconds * 1000);
  return `(ETA ${etaDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`;
}

/**
 * Update Live Navigation HUD, Remaining Distance, ETA, and Turn-by-Turn Directions.
 * Never overwrites or displays guidance when state is Arrived.
 */
function updateNavigationHud(route, destination, livePos) {
  if (hasArrived || (liveNavigator && liveNavigator.getState().arrived)) {
    return;
  }

  const resultCard = document.getElementById('route-result-card');
  const arrivalBanner = document.getElementById('nav-arrival-banner');
  const metricsEl = document.getElementById('evac-nav-metrics');
  const activeNavActions = document.getElementById('evac-active-nav-actions');
  const maneuverBanner = document.getElementById('nav-maneuver-banner');
  const maneuverDistEl = document.getElementById('nav-maneuver-distance');
  const maneuverTextEl = document.getElementById('nav-maneuver-text');
  const maneuverIconEl = document.getElementById('nav-maneuver-icon');
  const destNameEl = document.getElementById('route-dest-name');
  const destAddrEl = document.getElementById('route-dest-address');
  const distVal = document.getElementById('route-distance-val');
  const durVal = document.getElementById('route-duration-val');
  const etaVal = document.getElementById('route-eta-val');
  const osmBtn = document.getElementById('btn-external-osm');

  const nextStepBox = document.getElementById('evac-nav-next-step');
  const nextInstEl = document.getElementById('evac-nav-next-instruction');
  const nextDistEl = document.getElementById('evac-nav-next-dist');
  const stepsWrap = document.getElementById('evac-nav-steps-wrap');
  const stepsList = document.getElementById('evac-nav-steps-list');
  const stepsCount = document.getElementById('evac-nav-steps-count');

  if (resultCard) resultCard.classList.remove('hidden');
  if (arrivalBanner) arrivalBanner.classList.add('hidden');
  if (metricsEl) metricsEl.classList.remove('hidden');
  if (activeNavActions) activeNavActions.classList.remove('hidden');

  if (destNameEl && destination) destNameEl.textContent = destination.name || 'Evacuation Center';
  if (destAddrEl && destination) destAddrEl.textContent = destination.address || 'Barangay Bayanan, Muntinlupa City';

  const destCoords = getCenterCoords(destination);
  if (osmBtn && destCoords && (livePos || currentUserPosition)) {
    osmBtn.href = GeoSafeMapping.buildExternalDirectionsUrl(livePos || currentUserPosition, destCoords);
  }

  if (!route) {
    if (maneuverBanner) maneuverBanner.classList.add('hidden');
    if (nextStepBox) nextStepBox.classList.add('hidden');
    if (stepsWrap) stepsWrap.classList.add('hidden');
    if (distVal) distVal.textContent = '—';
    if (durVal) durVal.textContent = '—';
    if (etaVal) etaVal.textContent = '';
    return;
  }

  if (maneuverBanner) maneuverBanner.classList.remove('hidden');

  const remainingMeters = Number(route.distanceMeters || 0);
  const remainingSeconds = Number(route.durationSeconds || 0);

  if (distVal) distVal.textContent = GeoSafeMapping.formatDistance(remainingMeters);
  if (durVal) durVal.textContent = GeoSafeMapping.formatDuration(remainingSeconds);
  if (etaVal) etaVal.textContent = formatArrivalClock(remainingSeconds);

  const allSteps = Array.isArray(route.steps) ? route.steps : [];
  // Filter out 0m terminal 'arrive' step for active turn-by-turn guidance so we never show contradictory 'Arrive' while still navigating
  const guidanceSteps = allSteps.filter(s => String(s.type || '').toLowerCase() !== 'arrive');

  if (guidanceSteps.length > 0) {
    let nextStep = guidanceSteps.length > 1 && guidanceSteps[0].distanceMeters < 15 ? guidanceSteps[1] : guidanceSteps[0];
    if (livePos) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < guidanceSteps.length; i++) {
        if (!guidanceSteps[i].location) continue;
        const d = GeoSafeMapping.computeDistanceMeters(livePos, {
          lat: guidanceSteps[i].location[0],
          lng: guidanceSteps[i].location[1]
        });
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      nextStep = guidanceSteps[Math.min(bestIdx + 1, guidanceSteps.length - 1)] || guidanceSteps[bestIdx];
    }

    const stepDist =
      nextStep.location && livePos
        ? Math.round(
            GeoSafeMapping.computeDistanceMeters(livePos, {
              lat: nextStep.location[0],
              lng: nextStep.location[1]
            })
          )
        : nextStep.distanceMeters || remainingMeters;

    const formattedInst = formatManeuverText(nextStep);
    const formattedDist = GeoSafeMapping.formatDistance(stepDist);

    if (maneuverDistEl) maneuverDistEl.textContent = formattedDist;
    if (maneuverTextEl) maneuverTextEl.textContent = formattedInst;
    if (maneuverIconEl) maneuverIconEl.innerHTML = getManeuverIconSvg(nextStep);

    if (nextStepBox && nextInstEl && nextDistEl) {
      nextInstEl.textContent = formattedInst;
      nextDistEl.textContent = formattedDist;
      nextStepBox.classList.remove('hidden');
    }

    if (stepsWrap && stepsList) {
      if (stepsCount) stepsCount.textContent = `${guidanceSteps.length} ${guidanceSteps.length === 1 ? 'step' : 'steps'}`;
      stepsList.innerHTML = guidanceSteps
        .map(
          (st, idx) => `
            <li class="flex items-start justify-between gap-2 bg-white rounded-lg border border-slate-200 px-2.5 py-1.5">
              <span class="font-medium text-[#202020]"><span class="font-bold text-[#8A6800] mr-1">${idx + 1}.</span>${escapeHtml(formatManeuverText(st))}</span>
              <span class="text-[10px] font-bold text-[#777777] shrink-0">${escapeHtml(GeoSafeMapping.formatDistance(st.distanceMeters))}</span>
            </li>
          `
        )
        .join('');
      stepsWrap.classList.remove('hidden');
    }
  } else {
    if (maneuverDistEl) maneuverDistEl.textContent = GeoSafeMapping.formatDistance(remainingMeters);
    if (maneuverTextEl) maneuverTextEl.textContent = 'Follow highlighted road route';
    if (maneuverIconEl) maneuverIconEl.innerHTML = getManeuverIconSvg(null);
    if (nextStepBox) nextStepBox.classList.add('hidden');
    if (stepsWrap) stepsWrap.classList.add('hidden');
  }
}

/**
 * Handle dropdown destination change
 */
window.handleDestinationSelectChange = function () {
  const selectEl = document.getElementById('route-destination-select');
  const chosenId = selectEl ? selectEl.value : '';
  if (!chosenId) return;
  window.selectDestination(chosenId, { autoStartNavigation: isNavigationActive() });
};

/**
 * Select destination evacuation center.
 * Keeps selected center as destination unless the Resident explicitly selects another center.
 */
window.selectDestination = async function (centerId, options = {}) {
  const destination = availableCenters.find(c => String(c.id) === String(centerId));
  const destCoords = getCenterCoords(destination);
  if (!destination || !destCoords) {
    GeoSafeUI.showToast('Selected evacuation center coordinates are unavailable.', 'error');
    return;
  }

  const changedCenter = String(selectedCenterId || '') !== String(centerId);
  selectedCenterId = String(centerId);

  const selectEl = document.getElementById('route-destination-select');
  if (selectEl) {
    selectEl.value = String(centerId);
  }

  if (options.autoStartNavigation) {
    const mapSection = document.getElementById('route-floating-panel');
    if (mapSection && mapSection.scrollIntoView) {
      mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    window.startLiveNavigation();
    return;
  }

  if (isNavigationActive()) {
    // User explicitly changed destination while navigating -> switch target and recalculate route
    hasArrived = false;
    isFollowMode = true;
    liveNavigator.setDestination(destCoords, { recalculate: true, destId: selectedCenterId });
    renderCentersList(availableCenters);
    plotCentersOnMap(availableCenters);
    return;
  }

  if (changedCenter) {
    hasArrived = false;
    activeRouteData = null;
    clearRoutePolylines();
    const arrivalBanner = document.getElementById('nav-arrival-banner');
    if (arrivalBanner) arrivalBanner.classList.add('hidden');
    updateNavigationHud(null, destination, currentUserPosition);
    updateNavigationStatusBadge('Idle', { isPaused: true });
  }

  renderCentersList(availableCenters);
  plotCentersOnMap(availableCenters);
  syncNavigationControlButtons();

  if (evacMap) {
    evacMap.panTo([destCoords.lat, destCoords.lng], { animate: true });
  }
};

/**
 * Start Live GPS Navigation to the selected evacuation center:
 * - Initializes a fresh navigation session
 * - Requests Resident's actual GPS location
 * - Starts 10-second automatic GPS synchronization + watchPosition movement detection
 * - Calculates and updates the real OSRM road route
 */
window.startLiveNavigation = function () {
  const selectEl = document.getElementById('route-destination-select');
  const chosenId = selectEl && selectEl.value ? selectEl.value : selectedCenterId;

  if (!chosenId) {
    GeoSafeUI.showToast('Please select an evacuation center destination first.', 'warning');
    return;
  }

  selectedCenterId = String(chosenId);
  const destination = getSelectedCenter();
  const destCoords = getCenterCoords(destination);

  if (!destination || !destCoords) {
    showNavigationError('Destination evacuation center coordinates are missing or invalid.', false);
    GeoSafeUI.showToast('Selected evacuation center coordinates are invalid.', 'error');
    return;
  }

  if (!liveNavigator) {
    initLiveNavigator();
  }

  // Reset arrival & previous route state for the new session
  hasArrived = false;
  isFollowMode = true;
  activeRouteData = null;
  clearRoutePolylines();

  const arrivalBanner = document.getElementById('nav-arrival-banner');
  if (arrivalBanner) arrivalBanner.classList.add('hidden');

  const resultCard = document.getElementById('route-result-card');
  if (resultCard) resultCard.classList.remove('hidden');
  updateNavigationHud(null, destination, null);

  const started = liveNavigator.start(destCoords, { id: selectedCenterId, name: destination.name });
  syncNavigationControlButtons();
  renderCentersList(availableCenters);
  plotCentersOnMap(availableCenters);

  if (!started) {
    syncNavigationControlButtons();
  }
};

/**
 * Retry live GPS acquisition and route calculation after an error
 */
window.retryLiveNavigation = function () {
  if (selectedCenterId) {
    if (liveNavigator && isNavigationActive()) {
      liveNavigator.retry();
    } else {
      window.startLiveNavigation();
    }
  } else {
    window.recenterNavigationMap();
  }
};

/**
 * Stop Live GPS Navigation:
 * - Stops 10s GPS synchronization and watchPosition
 * - Releases active timers and lifecycle listeners
 * - Preserves ability to select another evacuation center
 */
window.stopLiveNavigation = function (options = {}) {
  const keepArrival = Boolean(options.keepArrival);
  if (liveNavigator) {
    liveNavigator.stop({
      clearRoute: true,
      userPaused: !keepArrival,
      preserveArrived: keepArrival
    });
  }

  isFollowMode = false;
  lastUserHeading = null;
  activeRouteData = null;
  clearRoutePolylines();

  const maneuverBanner = document.getElementById('nav-maneuver-banner');
  if (maneuverBanner) maneuverBanner.classList.add('hidden');

  if (!keepArrival) {
    hasArrived = false;
    const arrivalBanner = document.getElementById('nav-arrival-banner');
    if (arrivalBanner) arrivalBanner.classList.add('hidden');
    const destination = getSelectedCenter();
    if (destination) {
      updateNavigationHud(null, destination, currentUserPosition);
    }
  }

  syncNavigationControlButtons();
  renderUserLocationMarker();
  renderCentersList(availableCenters);

  if (!options.silent) {
    GeoSafeUI.showToast('Live GPS navigation stopped.', 'info');
  }
};

/**
 * Recenter Location control:
 * Returns the map to the Resident's current GPS location (or requests GPS if not yet acquired).
 */
window.recenterNavigationMap = async function () {
  if (!evacMap) return;
  isFollowMode = true;

  if (currentUserPosition && Number.isFinite(currentUserPosition.lat) && Number.isFinite(currentUserPosition.lng)) {
    evacMap.setView(
      [currentUserPosition.lat, currentUserPosition.lng],
      Math.max(evacMap.getZoom(), 17),
      { animate: true }
    );
    if (isNavigationActive() && liveNavigator) {
      liveNavigator.syncNow();
    }
    return;
  }

  if (!hasArrived) {
    setGpsStatusBanner(true, 'Requesting your actual device GPS location...', false);
  }
  try {
    const pos = await GeoSafeMapping.getCurrentLocation();
    if (Number.isFinite(pos.accuracy) && pos.accuracy > 1000) {
      const accMsg = `GPS accuracy is currently insufficient (±${Math.round(pos.accuracy)}m). Move to an open area and retry.`;
      if (!hasArrived) setGpsStatusBanner(true, accMsg, true);
      GeoSafeUI.showToast(accMsg, 'warning');
      return;
    }

    currentUserPosition = {
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      timestamp: Date.now(),
      label: `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`,
      isGps: true
    };
    setGpsStatusBanner(false);
    updateGpsAccuracyDisplay(currentUserPosition);
    renderUserLocationMarker();
    evacMap.setView([pos.lat, pos.lng], Math.max(evacMap.getZoom(), 17), { animate: true });
    if (userMarker) userMarker.openPopup();
  } catch (err) {
    const msg = formatGpsErrorMessage(err);
    if (!hasArrived) setGpsStatusBanner(true, msg, true);
    GeoSafeUI.showToast(msg, 'warning');
  }
};

window.returnToEvacuationCenters = function () {
  const centersSection = document.getElementById('evacuation-centers-section');
  if (centersSection && centersSection.scrollIntoView) {
    centersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};
