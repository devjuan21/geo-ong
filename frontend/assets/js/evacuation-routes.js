/**
 * GeoSafe - Resident Evacuation Routes Page Logic
 * ============================================================================
 * Features:
 * - Interactive Leaflet Map automatically fitted to Barangay Bayanan evacuation centers
 * - Collapsible compact floating route selection panel with asymmetric map padding
 * - Browser GPS current-location acquisition & reverse geocoding
 * - Real evacuation centers directory with clean card bindings
 * - Pedestrian route calculation via Project-OSRM (foot profile)
 * ============================================================================
 */

let evacMap = null;
let centersMarkersGroup = null;
let userMarker = null;
let activeRouteCasing = null;
let activeRoutePolyline = null;
let activeRouteData = null;

let availableCenters = [];
let selectedCenterId = null;
let gpsPosition = null;
let manualPosition = null;
let isRoutePanelCollapsed = false;
let isPickingManualStart = false;

let isNavigating = false;
let isFollowMode = false;
let navWatchId = null;
let lastUserHeading = null;
let lastRerouteAt = 0;
let hasArrived = false;

let currentUserPosition = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPanelReservedTopPadding() {
  const navBanner = document.getElementById('nav-maneuver-banner');
  if (navBanner && !navBanner.classList.contains('hidden')) {
    return Math.max(56, (navBanner.offsetHeight || 0) + 12);
  }
  const panelEl = document.getElementById('route-floating-panel');
  if (!panelEl) return 64;
  const h = panelEl.offsetHeight || 0;
  return Math.max(48, h + 12);
}

function fitMapToBoundsWithPadding(bounds, options = {}) {
  if (!evacMap || !bounds || !bounds.isValid()) return;
  const topPad = getPanelReservedTopPadding();
  const bottomPad = options.reserveBottomCard ? 120 : 20;
  evacMap.fitBounds(bounds, {
    paddingTopLeft: [18, topPad],
    paddingBottomRight: [18, bottomPad],
    maxZoom: options.maxZoom || 16
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeUI.init('evacuation-routes', 'Evacuation Routes');
  initEvacuationMap();
  await GeoSafeMapping.loadBayananBoundary();
  await loadEvacuationCenters();

  const params = new URLSearchParams(window.location.search);
  const queryCenterId = params.get('centerId');
  if (queryCenterId && availableCenters.some(c => String(c.id) === String(queryCenterId))) {
    window.selectDestination(queryCenterId);
  } else {
    window.acquireUserGpsLocation({ isInitialLoad: true });
  }

  window.addEventListener('geosafe:realtime-update', () => {
    loadEvacuationCenters();
  });

  window.addEventListener('pagehide', () => stopLiveNavigation({ silent: true }));
  window.addEventListener('beforeunload', () => stopLiveNavigation({ silent: true }));
});

/**
 * Initialize Leaflet map with bottom-right zoom controls so top floating controls never overlap
 */
function initEvacuationMap() {
  try {
    evacMap = GeoSafeMapping.createMap('evacuation-map', {
      zoomControl: false,
      scrollWheelZoom: false,
      fitBayananBounds: false
    });

    if (typeof L !== 'undefined' && L.control && L.control.zoom) {
      L.control.zoom({ position: 'bottomright' }).addTo(evacMap);
    }

    evacMap.on('dragstart', () => {
      if (isNavigating && isFollowMode) {
        isFollowMode = false;
        const recenterBtn = document.getElementById('btn-recenter-nav');
        if (recenterBtn) recenterBtn.classList.remove('hidden');
      }
    });

    evacMap.on('click', (e) => {
      if (!isPickingManualStart || !e || !e.latlng) return;
      setManualStartingLocation(e.latlng.lat, e.latlng.lng);
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

/**
 * Collapse or expand the floating route selection panel
 */
window.toggleRoutePanel = function (collapse) {
  isRoutePanelCollapsed = typeof collapse === 'boolean' ? collapse : !isRoutePanelCollapsed;
  const expandedEl = document.getElementById('route-panel-expanded');
  const collapsedEl = document.getElementById('route-panel-collapsed');

  if (isRoutePanelCollapsed) {
    window.updateCollapsedSummary();
    if (expandedEl) expandedEl.classList.add('hidden');
    if (collapsedEl) collapsedEl.classList.remove('hidden');
  } else {
    if (collapsedEl) collapsedEl.classList.add('hidden');
    if (expandedEl) expandedEl.classList.remove('hidden');
  }
};

/**
 * Update compact summary text shown when route panel is collapsed
 */
window.updateCollapsedSummary = function () {
  const summaryEl = document.getElementById('route-collapsed-summary');
  if (!summaryEl) return;

  const fromLabel = currentUserPosition
    ? (currentUserPosition.isGps ? 'My GPS' : 'Manual Start')
    : 'No Start Set';
  const dest = selectedCenterId
    ? availableCenters.find(c => String(c.id) === String(selectedCenterId))
    : null;
  const selectEl = document.getElementById('route-destination-select');
  const selectedVal = selectEl && selectEl.value ? selectEl.value : selectedCenterId;
  const activeDest = dest || (selectedVal ? availableCenters.find(c => String(c.id) === String(selectedVal)) : null);

  if (activeDest && activeDest.name) {
    summaryEl.textContent = `${fromLabel} to ${activeDest.name}`;
  } else {
    summaryEl.textContent = `${fromLabel} — Select destination`;
  }
};

function createNavigationUserIcon() {
  if (currentUserPosition && currentUserPosition.isManual && !currentUserPosition.isGps) {
    return L.divIcon({
      className: 'geosafe-manual-start-marker',
      html: `
        <div class="w-7 h-7 rounded-full bg-[#202020] border-2 border-[#F5B900] shadow-md flex items-center justify-center">
          <div class="w-2.5 h-2.5 rounded-full bg-[#F5B900]"></div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14]
    });
  }
  if (!isNavigating) {
    return GeoSafeMapping.createCustomIcon('user');
  }
  const hasHeading = Number.isFinite(lastUserHeading);
  const rotationStyle = hasHeading ? `transform: rotate(${Math.round(lastUserHeading)}deg);` : '';
  return L.divIcon({
    className: 'geosafe-nav-marker',
    html: `
      <div class="w-8 h-8 rounded-full bg-[#202020] border-2 border-[#F5B900] shadow-lg flex items-center justify-center" style="${rotationStyle}">
        <svg class="w-4 h-4 text-[#F5B900]" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"></path>
        </svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
  });
}

/**
 * Render or update resident starting location marker (only when real GPS or manual pick exists)
 */
function renderUserLocationMarker() {
  if (!evacMap) return;
  if (!currentUserPosition || !Number.isFinite(currentUserPosition.lat) || !Number.isFinite(currentUserPosition.lng)) {
    if (userMarker) {
      evacMap.removeLayer(userMarker);
      userMarker = null;
    }
    return;
  }

  const latLng = [currentUserPosition.lat, currentUserPosition.lng];
  const userIcon = createNavigationUserIcon();
  const safeLabel = escapeHtml(currentUserPosition.label);
  const title = currentUserPosition.isGps
    ? (isNavigating ? 'Your Live GPS Location' : 'Current GPS Location')
    : 'Manually Selected Starting Location';

  if (!userMarker) {
    userMarker = L.marker(latLng, { icon: userIcon, zIndexOffset: 600 }).addTo(evacMap);
    userMarker.bindPopup(`<strong>${title}</strong><br><span class="text-xs text-slate-600">${safeLabel}</span>`);
  } else {
    userMarker.setLatLng(latLng);
    userMarker.setIcon(userIcon);
    userMarker.setPopupContent(`<strong>${title}</strong><br><span class="text-xs text-slate-600">${safeLabel}</span>`);
  }
}

/**
 * Update the starting location dropdown options
 */
function syncStartLocationSelector() {
  const startSelect = document.getElementById('route-start-select');
  if (!startSelect) return;

  const options = [];
  if (gpsPosition) {
    const gpsLabel = gpsPosition.label ? `From: My GPS (${gpsPosition.label})` : 'From: My GPS Location';
    options.push(`<option value="gps">${escapeHtml(gpsLabel)}</option>`);
  }
  if (manualPosition) {
    options.push(`<option value="manual">${escapeHtml(`From: Manual Start (${manualPosition.lat.toFixed(5)}, ${manualPosition.lng.toFixed(5)})`)}</option>`);
  }
  if (options.length === 0) {
    options.push('<option value="" disabled selected>From: GPS needed (or pick on map)</option>');
  }

  startSelect.innerHTML = options.join('');
  if (currentUserPosition && currentUserPosition.isGps && gpsPosition) {
    startSelect.value = 'gps';
  } else if (currentUserPosition && currentUserPosition.isManual && manualPosition) {
    startSelect.value = 'manual';
  }
  window.updateCollapsedSummary();
}

/**
 * Handle starting location selector change
 */
window.handleStartLocationChange = function () {
  const startSelect = document.getElementById('route-start-select');
  const choice = startSelect ? startSelect.value : '';

  if (choice === 'gps' && gpsPosition) {
    currentUserPosition = { ...gpsPosition, isGps: true, isManual: false };
  } else if (choice === 'manual' && manualPosition) {
    currentUserPosition = { ...manualPosition, isGps: false, isManual: true };
  } else {
    return;
  }

  window.updateCollapsedSummary();
  renderUserLocationMarker();
  if (selectedCenterId) {
    handleCalculateRoute();
  } else if (evacMap) {
    evacMap.setView([currentUserPosition.lat, currentUserPosition.lng], 16, { animate: true });
  }
};

function setGpsStatusBanner(visible, message = '', showActions = true) {
  const banner = document.getElementById('gps-status-banner');
  const textEl = document.getElementById('gps-status-text');
  const actionsEl = document.getElementById('gps-status-actions');
  if (!banner) return;
  if (!visible) {
    banner.classList.add('hidden');
    return;
  }
  if (textEl) textEl.textContent = message;
  if (actionsEl) actionsEl.classList.toggle('hidden', !showActions);
  banner.classList.remove('hidden');
}

function formatGpsErrorMessage(err) {
  if (!err) return 'Unable to retrieve your device location.';
  if (err.code === 'INSECURE_CONTEXT_LAN') {
    return 'Browser GPS requires HTTPS (or localhost). Tap "Pick on Map" to set your starting location manually.';
  }
  if (err.code === 1) {
    return 'Location permission denied. Enable location access in your browser, or tap "Pick on Map" to set a manual starting point.';
  }
  if (err.code === 2) {
    return 'Device location is currently unavailable. Check GPS signal or tap "Pick on Map".';
  }
  if (err.code === 3) {
    return 'GPS request timed out. Tap "Retry GPS" or "Pick on Map" to set a manual starting point.';
  }
  return err.message || 'Unable to retrieve device location. Tap "Retry GPS" or "Pick on Map".';
}

window.enableManualStartPicker = function () {
  isPickingManualStart = true;
  if (evacMap && evacMap.getContainer) {
    evacMap.getContainer().style.cursor = 'crosshair';
  }
  setGpsStatusBanner(true, 'Tap anywhere on the map to set your manually selected starting location.', false);
  GeoSafeUI.showToast('Tap on the map to place your starting location.', 'info');
};

function setManualStartingLocation(lat, lng) {
  isPickingManualStart = false;
  if (evacMap && evacMap.getContainer) {
    evacMap.getContainer().style.cursor = '';
  }

  manualPosition = {
    lat: Number(lat),
    lng: Number(lng),
    label: `Manually Selected Starting Location (${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)})`,
    isGps: false,
    isManual: true
  };
  currentUserPosition = { ...manualPosition };

  setGpsStatusBanner(false);
  syncStartLocationSelector();
  renderUserLocationMarker();

  if (selectedCenterId) {
    handleCalculateRoute();
  } else if (evacMap) {
    evacMap.setView([currentUserPosition.lat, currentUserPosition.lng], 16, { animate: true });
    if (userMarker) userMarker.openPopup();
  }
  GeoSafeUI.showToast('Manual starting location set.', 'info');
}

/**
 * Acquire resident's actual device GPS location
 */
window.acquireUserGpsLocation = async function (options = {}) {
  const btn = document.getElementById('btn-gps-header');
  isPickingManualStart = false;
  if (evacMap && evacMap.getContainer) {
    evacMap.getContainer().style.cursor = '';
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="animate-spin w-3.5 h-3.5 text-[#202020]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span>Locating...</span>`;
  }
  setGpsStatusBanner(true, 'Acquiring your actual device GPS location...', false);

  try {
    const pos = await GeoSafeMapping.getCurrentLocation();
    let addressName = '';
    try {
      addressName = await GeoSafeMapping.reverseGeocode(pos.lat, pos.lng);
    } catch {
      addressName = '';
    }

    gpsPosition = {
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      label: addressName || `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`,
      isGps: true,
      isManual: false
    };
    currentUserPosition = { ...gpsPosition };

    setGpsStatusBanner(false);
    syncStartLocationSelector();
    renderUserLocationMarker();

    if (selectedCenterId && !options.skipAutoRoute) {
      await handleCalculateRoute();
    } else if (evacMap) {
      evacMap.setView([gpsPosition.lat, gpsPosition.lng], 16, { animate: true });
      if (userMarker) userMarker.openPopup();
    }

    if (!options.isInitialLoad) {
      GeoSafeUI.showToast('Actual GPS location acquired.', 'success');
    }
    return gpsPosition;
  } catch (err) {
    console.warn('GPS acquisition error:', err);
    const msg = formatGpsErrorMessage(err);
    setGpsStatusBanner(true, msg, true);
    if (!options.isInitialLoad) {
      GeoSafeUI.showToast(msg, 'warning');
    }
    return null;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg class="w-3.5 h-3.5 text-[#202020] flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>
        <span>Use My GPS</span>
      `;
    }
  }
};

function getCenterCoords(center) {
  if (!center) return null;
  const lat = center.coordinates && Number.isFinite(Number(center.coordinates.lat))
    ? Number(center.coordinates.lat)
    : Number(center.latitude);
  const lng = center.coordinates && Number.isFinite(Number(center.coordinates.lng))
    ? Number(center.coordinates.lng)
    : Number(center.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function isActiveDestinationCenter(center) {
  const status = String((center && center.status) || '').trim().toLowerCase();
  return status === 'open - accommodating' || status === 'active' || status === 'open';
}

function isBayananCenter(center) {
  if (!center) return false;
  if (String(center.barangay || '').toLowerCase().includes('bayanan')) return true;
  const coords = getCenterCoords(center);
  return Boolean(coords && GeoSafeMapping.isPointInsideBayanan(coords.lat, coords.lng) !== false);
}

/**
 * Calculate and fit map bounds to available evacuation centers within Barangay Bayanan
 */
function fitMapToBayananCenters(options = {}) {
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

  if ((options.includeUser || (currentUserPosition && currentUserPosition.isGps)) && currentUserPosition) {
    const userInside = GeoSafeMapping.isPointInsideBayanan(currentUserPosition.lat, currentUserPosition.lng);
    if (userInside !== false) {
      bounds.extend([currentUserPosition.lat, currentUserPosition.lng]);
    }
  } else if (targetCoords.length === 1 && currentUserPosition) {
    // Include resident starting position when only 1 shelter exists
    bounds.extend([currentUserPosition.lat, currentUserPosition.lng]);
  }

  if (bounds.isValid()) {
    fitMapToBoundsWithPadding(bounds, { maxZoom: 16 });
    return;
  }

  const bayananBounds = GeoSafeMapping.getBayananBounds();
  if (bayananBounds && bayananBounds.isValid()) {
    fitMapToBoundsWithPadding(bayananBounds, { maxZoom: 16 });
  } else {
    evacMap.setView([currentUserPosition.lat, currentUserPosition.lng], 15);
  }
}

/**
 * Load designated evacuation centers from store
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
        selectEl.innerHTML = '<option value="" disabled selected>To: No centers</option>';
        selectEl.disabled = true;
      }
      if (centersMarkersGroup) centersMarkersGroup.clearLayers();
      fitMapToBayananCenters();
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    if (listEl) listEl.classList.remove('hidden');

    if (selectEl) {
      selectEl.disabled = false;
      selectEl.innerHTML = `
        <option value="" disabled ${selectedCenterId ? '' : 'selected'}>To: Select center...</option>
        ${availableCenters.map(c => {
          const safeName = escapeHtml(c.name || 'Evacuation Center');
          const isSel = selectedCenterId !== null && String(c.id) === String(selectedCenterId);
          return `<option value="${escapeHtml(c.id)}" ${isSel ? 'selected' : ''}>${safeName}</option>`;
        }).join('')}
      `;
    }

    renderCentersList(availableCenters);
    plotCentersOnMap(availableCenters);
    if (!activeRoutePolyline) {
      fitMapToBayananCenters();
    }
    window.updateCollapsedSummary();
  } catch (err) {
    console.error('Error loading evacuation centers:', err);
    if (badgeEl) badgeEl.textContent = '0 centers';
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (listEl) listEl.classList.add('hidden');
  }
}

/**
 * Render evacuation centers cards list
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
      ? 'h-full min-w-0 p-2 bg-[#FFFDF4] rounded-xl border-2 border-[#F5B900] ring-1 ring-[#FFE872]/60 shadow-subtle transition-all flex flex-col justify-between gap-1'
      : 'h-full min-w-0 p-2 bg-white rounded-xl border border-[#EEEEEE] shadow-subtle hover:border-[#F5B900] transition-all flex flex-col justify-between gap-1';

    return `
      <div class="${cardClass}" data-center-id="${escapeHtml(c.id)}">
        <div class="min-w-0 space-y-1">
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 min-w-0">
            <span class="self-start sm:order-2 text-[10px] font-semibold px-2 py-0.5 leading-none rounded-full border flex-shrink-0 ${statusBadgeClass}">
              ${status}
            </span>
            <h3 class="sm:order-1 font-bold text-[#202020] text-[11px] sm:text-sm leading-tight break-words min-w-0">${name}</h3>
          </div>
          <p class="text-[10px] sm:text-[11px] text-[#6B7280] leading-snug line-clamp-2 break-words">${address}</p>
        </div>

        <div class="flex justify-end pt-1">
          <button
            type="button"
            onclick="selectDestination('${escapeHtml(c.id)}')"
            class="w-full sm:w-auto px-2 h-7 rounded-lg ${isSelected ? 'bg-[#202020] text-white' : 'bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020]'} font-bold text-[11px] leading-none transition-colors shadow-subtle inline-flex items-center justify-center gap-1 flex-shrink-0"
          >
            <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            <span>${isSelected ? 'Selected' : 'Route Here'}</span>
          </button>
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
    const shelterIcon = GeoSafeMapping.createCustomIcon('evacuation');
    const marker = L.marker(latLng, {
      icon: shelterIcon,
      opacity: hasSelection && !isSelected ? 0.65 : 1,
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
      <div class="p-2 text-xs font-sans max-w-xs">
        <div class="text-[10px] font-bold text-[#278653] uppercase tracking-wider mb-0.5">Evacuation Center</div>
        <h4 class="font-bold text-[#202020] text-xs sm:text-sm">${safeName}</h4>
        <p class="text-[11px] text-[#6B7280] mb-2">${safeAddr}</p>
        <button type="button" onclick="selectDestination('${escapeHtml(c.id)}')" class="w-full py-1.5 px-2 bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] rounded-xl text-xs font-bold transition-colors shadow-subtle flex items-center justify-center gap-1.5">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
          <span>Route Here</span>
        </button>
      </div>
    `;

    marker.bindPopup(popupHtml);
    centersMarkersGroup.addLayer(marker);
  });
}

function formatManeuverText(step) {
  if (!step) return 'Follow highlighted route';
  const type = String(step.type || '').toLowerCase();
  const modifier = String(step.modifier || '').replace(/-/g, ' ').trim();
  const street = step.name ? ` onto ${step.name}` : '';
  if (type === 'arrive') return 'Arrive at destination';
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
  if (step && String(step.type || '').toLowerCase() === 'arrive') {
    return '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>';
  }
  return '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18"></path></svg>';
}

function formatArrivalClock(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return '';
  const etaDate = new Date(Date.now() + durationSeconds * 1000);
  return `ETA ${etaDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function minDistanceToRouteMeters(pos, coords) {
  if (!pos || !Array.isArray(coords) || coords.length === 0) return Infinity;
  let minDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const pt = { lat: coords[i][0], lng: coords[i][1] };
    const d = GeoSafeMapping.computeDistanceMeters(pos, pt);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function updateNavigationHud(route, destination, livePos) {
  const maneuverBanner = document.getElementById('nav-maneuver-banner');
  const floatingPanel = document.getElementById('route-floating-panel');
  const maneuverDistEl = document.getElementById('nav-maneuver-distance');
  const maneuverTextEl = document.getElementById('nav-maneuver-text');
  const maneuverIconEl = document.getElementById('nav-maneuver-icon');
  const destNameEl = document.getElementById('route-dest-name');
  const statusBadgeEl = document.getElementById('route-status-badge');
  const distVal = document.getElementById('route-distance-val');
  const durVal = document.getElementById('route-duration-val');
  const etaVal = document.getElementById('route-eta-val');

  if (maneuverBanner) maneuverBanner.classList.remove('hidden');
  if (floatingPanel) floatingPanel.classList.add('hidden');
  if (destNameEl && destination) destNameEl.textContent = destination.name || 'Evacuation Center';

  const destCoords = getCenterCoords(destination);
  let remainingMeters = route ? route.distanceMeters : 0;
  let remainingSeconds = route ? route.durationSeconds : 0;

  if (livePos && destCoords && route && route.distanceMeters > 0) {
    const directToDest = GeoSafeMapping.computeDistanceMeters(livePos, destCoords);
    if (isNavigating) {
      const ratio = Math.min(1, directToDest / Math.max(1, route.distanceMeters));
      remainingMeters = Math.round(Math.max(directToDest, route.distanceMeters * ratio));
      remainingSeconds = Math.round(route.durationSeconds * (remainingMeters / Math.max(1, route.distanceMeters)));
    }
  }

  if (distVal) distVal.textContent = GeoSafeMapping.formatDistance(remainingMeters);
  if (durVal) durVal.textContent = GeoSafeMapping.formatDuration(remainingSeconds);
  if (etaVal) etaVal.textContent = formatArrivalClock(remainingSeconds);

  const steps = route && Array.isArray(route.steps) ? route.steps : [];
  if (steps.length > 0) {
    let nextStep = steps[0];
    if (livePos) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < steps.length; i++) {
        if (!steps[i].location) continue;
        const d = GeoSafeMapping.computeDistanceMeters(livePos, { lat: steps[i].location[0], lng: steps[i].location[1] });
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      nextStep = steps[Math.min(bestIdx + 1, steps.length - 1)] || steps[bestIdx];
    }
    const stepDist = nextStep.location && livePos
      ? Math.round(GeoSafeMapping.computeDistanceMeters(livePos, { lat: nextStep.location[0], lng: nextStep.location[1] }))
      : nextStep.distanceMeters;
    if (maneuverDistEl) maneuverDistEl.textContent = GeoSafeMapping.formatDistance(stepDist);
    if (maneuverTextEl) maneuverTextEl.textContent = formatManeuverText(nextStep);
    if (maneuverIconEl) maneuverIconEl.innerHTML = getManeuverIconSvg(nextStep);
  } else {
    if (maneuverDistEl) maneuverDistEl.textContent = GeoSafeMapping.formatDistance(remainingMeters);
    if (maneuverTextEl) maneuverTextEl.textContent = route && route.isOfflineFallback
      ? 'Follow highlighted route (turn-by-turn unavailable offline)'
      : 'Follow highlighted route';
    if (maneuverIconEl) maneuverIconEl.innerHTML = getManeuverIconSvg(null);
  }

  if (statusBadgeEl) {
    if (hasArrived) {
      statusBadgeEl.textContent = 'Arrived';
      statusBadgeEl.className = 'text-[10px] font-bold text-[#278653] bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex-shrink-0';
    } else if (isNavigating) {
      statusBadgeEl.textContent = 'Live GPS';
      statusBadgeEl.className = 'text-[10px] font-bold text-[#8A6800] bg-[#FFF9E8] px-2 py-0.5 rounded-full border border-[#FFE872] flex-shrink-0';
    } else if (route && route.isOfflineFallback) {
      statusBadgeEl.textContent = 'Offline Fallback';
      statusBadgeEl.className = 'text-[10px] font-bold text-[#8A6800] bg-[#FFF9E8] px-2 py-0.5 rounded-full border border-[#FFE872] flex-shrink-0';
    } else {
      statusBadgeEl.textContent = 'Pedestrian Route';
      statusBadgeEl.className = 'text-[10px] font-bold text-[#278653] bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex-shrink-0';
    }
  }
}

/**
 * Select destination center, scroll to map, acquire GPS if possible, and calculate route
 */
window.selectDestination = async function (centerId) {
  stopLiveNavigation({ silent: true });
  hasArrived = false;
  const arrivalBanner = document.getElementById('nav-arrival-banner');
  if (arrivalBanner) arrivalBanner.classList.add('hidden');

  selectedCenterId = centerId;
  const selectEl = document.getElementById('route-destination-select');
  if (selectEl) {
    selectEl.value = String(centerId);
  }

  const mapSection = document.getElementById('evacuation-map-section');
  if (mapSection && mapSection.scrollIntoView) {
    mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.updateCollapsedSummary();
  renderCentersList(availableCenters);
  plotCentersOnMap(availableCenters);

  if (!currentUserPosition) {
    const overlay = document.getElementById('route-calculating-overlay');
    const loadingText = document.getElementById('route-loading-text');
    if (loadingText) loadingText.textContent = 'Acquiring your GPS location...';
    if (overlay) overlay.classList.remove('hidden');

    const acquired = await window.acquireUserGpsLocation({ skipAutoRoute: true });

    if (overlay) overlay.classList.add('hidden');
    if (loadingText) loadingText.textContent = 'Calculating route...';

    if (!acquired && !currentUserPosition) {
      GeoSafeUI.showToast('Enable GPS or tap "Pick on Map" to set your starting location.', 'warning');
      return;
    }
  }

  await handleCalculateRoute();
};

/**
 * Calculate pedestrian route via Project-OSRM Foot Endpoint
 */
window.handleCalculateRoute = async function () {
  const selectEl = document.getElementById('route-destination-select');
  const chosenId = selectEl && selectEl.value ? selectEl.value : selectedCenterId;

  if (!chosenId) {
    GeoSafeUI.showToast('Please select an evacuation center destination.', 'warning');
    return;
  }

  if (!currentUserPosition || !Number.isFinite(currentUserPosition.lat) || !Number.isFinite(currentUserPosition.lng)) {
    const acquired = await window.acquireUserGpsLocation({ skipAutoRoute: true });
    if (!acquired && !currentUserPosition) {
      GeoSafeUI.showToast('A valid GPS or manually picked starting location is required.', 'warning');
      return;
    }
  }

  selectedCenterId = chosenId;
  const destination = availableCenters.find(c => String(c.id) === String(chosenId));
  const destCoords = getCenterCoords(destination);

  if (!destination || !destCoords) {
    GeoSafeUI.showToast('Selected evacuation center coordinates are unavailable.', 'error');
    return;
  }

  window.updateCollapsedSummary();
  renderCentersList(availableCenters);
  plotCentersOnMap(availableCenters);

  const calcBtn = document.getElementById('btn-calc-route');
  const overlay = document.getElementById('route-calculating-overlay');
  const resultCard = document.getElementById('route-result-card');
  const errorBox = document.getElementById('route-error-box');
  const errorMsg = document.getElementById('route-error-msg');
  const osmBtn = document.getElementById('btn-external-osm');

  if (calcBtn) calcBtn.disabled = true;
  if (overlay) overlay.classList.remove('hidden');
  if (errorBox) errorBox.classList.add('hidden');

  try {
    const route = await GeoSafeMapping.calculatePedestrianRoute(
      { lat: currentUserPosition.lat, lng: currentUserPosition.lng },
      destCoords
    );
    activeRouteData = route;

    if (activeRouteCasing && evacMap) {
      evacMap.removeLayer(activeRouteCasing);
    }
    if (activeRoutePolyline && evacMap) {
      evacMap.removeLayer(activeRoutePolyline);
    }

    activeRouteCasing = L.polyline(route.coordinates, {
      color: '#FFFFFF',
      weight: 9,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(evacMap);

    activeRoutePolyline = L.polyline(route.coordinates, {
      color: '#1D4ED8',
      weight: 5,
      opacity: 0.95,
      dashArray: route.isOfflineFallback ? '6, 8' : null,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(evacMap);

    updateNavigationHud(route, destination, isNavigating ? currentUserPosition : null);

    if (!isNavigating || !isFollowMode) {
      const routeBounds = activeRoutePolyline.getBounds();
      routeBounds.extend([currentUserPosition.lat, currentUserPosition.lng]);
      routeBounds.extend([destCoords.lat, destCoords.lng]);
      fitMapToBoundsWithPadding(routeBounds, { reserveBottomCard: true, maxZoom: 17 });
    }

    if (osmBtn) {
      osmBtn.href = GeoSafeMapping.buildExternalDirectionsUrl(currentUserPosition, destCoords);
    }

    if (resultCard) resultCard.classList.remove('hidden');
    if (!isNavigating) {
      GeoSafeUI.showToast('Evacuation route calculated.', 'success');
    }
  } catch (err) {
    console.error('Route calculation failed:', err);
    if (errorBox) {
      errorBox.classList.remove('hidden');
      if (errorMsg) {
        errorMsg.textContent = err.message || 'Unable to calculate route. Please verify your connection and retry.';
      }
    }
    GeoSafeUI.showToast('Failed to calculate evacuation route.', 'error');
  } finally {
    if (calcBtn) calcBtn.disabled = false;
    if (overlay) overlay.classList.add('hidden');
  }
};

window.startLiveNavigation = function () {
  if (!selectedCenterId || !activeRouteData) {
    GeoSafeUI.showToast('Select an evacuation center route first.', 'warning');
    return;
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    GeoSafeUI.showToast('Live GPS tracking is not supported by this browser.', 'error');
    return;
  }

  stopLiveNavigation({ silent: true });
  isNavigating = true;
  isFollowMode = true;
  hasArrived = false;

  const startBtn = document.getElementById('btn-start-nav');
  const stopBtn = document.getElementById('btn-stop-nav');
  const recenterBtn = document.getElementById('btn-recenter-nav');
  const arrivalBanner = document.getElementById('nav-arrival-banner');
  if (startBtn) startBtn.classList.add('hidden');
  if (stopBtn) stopBtn.classList.remove('hidden');
  if (recenterBtn) recenterBtn.classList.add('hidden');
  if (arrivalBanner) arrivalBanner.classList.add('hidden');

  renderUserLocationMarker();
  const destination = availableCenters.find(c => String(c.id) === String(selectedCenterId));
  updateNavigationHud(activeRouteData, destination, currentUserPosition);

  if (evacMap) {
    evacMap.setView([currentUserPosition.lat, currentUserPosition.lng], Math.max(evacMap.getZoom(), 17), { animate: true });
  }

  navWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (Number.isFinite(pos.coords.heading) && (!Number.isFinite(pos.coords.speed) || pos.coords.speed > 0.3)) {
        lastUserHeading = pos.coords.heading;
      }

      gpsPosition = { lat, lng, label: 'Current GPS Location', isGps: true };
      currentUserPosition = { ...gpsPosition };
      syncStartLocationSelector();
      renderUserLocationMarker();

      if (isFollowMode && evacMap) {
        evacMap.panTo([lat, lng], { animate: true });
      }

      const activeDest = availableCenters.find(c => String(c.id) === String(selectedCenterId));
      const destCoords = getCenterCoords(activeDest);

      // Arrival detection using actual GPS coordinates (<= 30 meters)
      if (destCoords) {
        const distToDest = GeoSafeMapping.computeDistanceMeters(currentUserPosition, destCoords);
        if (distToDest <= 30) {
          hasArrived = true;
          const arrivalEl = document.getElementById('nav-arrival-banner');
          const arrivalTextEl = document.getElementById('nav-arrival-text');
          if (arrivalTextEl) arrivalTextEl.textContent = `You have arrived at ${activeDest.name || 'the evacuation center'}.`;
          if (arrivalEl) arrivalEl.classList.remove('hidden');
          GeoSafeUI.showToast(`Arrived at ${activeDest.name || 'evacuation center'}.`, 'success');
          stopLiveNavigation({ silent: true, keepArrival: true });
          updateNavigationHud(activeRouteData, activeDest, currentUserPosition);
          return;
        }
      }

      // Off-route detection (> 45 meters from route coordinates, 12s cooldown)
      if (activeRouteData && Array.isArray(activeRouteData.coordinates)) {
        const deviation = minDistanceToRouteMeters(currentUserPosition, activeRouteData.coordinates);
        const now = Date.now();
        if (deviation > 45 && now - lastRerouteAt > 12000) {
          lastRerouteAt = now;
          GeoSafeUI.showToast('Recalculating route...', 'info');
          await handleCalculateRoute();
          return;
        }
      }

      updateNavigationHud(activeRouteData, activeDest, currentUserPosition);
    },
    (err) => {
      console.warn('Live navigation watchPosition error:', err);
      const msg = formatGpsErrorMessage(err);
      setGpsStatusBanner(true, msg, true);
      if (err && err.code === 1) {
        GeoSafeUI.showToast(msg, 'warning');
        stopLiveNavigation({ silent: true });
      } else {
        GeoSafeUI.showToast('GPS signal temporarily lost. Holding last known position.', 'warning');
      }
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );

  GeoSafeUI.showToast('Live navigation started.', 'success');
};

window.stopLiveNavigation = function (options = {}) {
  if (navWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(navWatchId);
    navWatchId = null;
  }
  isNavigating = false;
  isFollowMode = false;
  lastUserHeading = null;

  const startBtn = document.getElementById('btn-start-nav');
  const stopBtn = document.getElementById('btn-stop-nav');
  const recenterBtn = document.getElementById('btn-recenter-nav');
  if (startBtn) startBtn.classList.remove('hidden');
  if (stopBtn) stopBtn.classList.add('hidden');
  if (recenterBtn) recenterBtn.classList.add('hidden');

  if (!options.keepArrival) {
    hasArrived = false;
    const arrivalBanner = document.getElementById('nav-arrival-banner');
    if (arrivalBanner) arrivalBanner.classList.add('hidden');
  }

  renderUserLocationMarker();
  if (activeRouteData && selectedCenterId) {
    const dest = availableCenters.find(c => String(c.id) === String(selectedCenterId));
    updateNavigationHud(activeRouteData, dest, null);
  }
  if (!options.silent) {
    GeoSafeUI.showToast('Navigation stopped.', 'info');
  }
};

window.recenterNavigationMap = function () {
  if (!evacMap) return;
  isFollowMode = true;
  const recenterBtn = document.getElementById('btn-recenter-nav');
  if (recenterBtn) recenterBtn.classList.add('hidden');
  evacMap.setView([currentUserPosition.lat, currentUserPosition.lng], Math.max(evacMap.getZoom(), 17), { animate: true });
};

window.showRouteSelectorPanel = function () {
  const maneuverBanner = document.getElementById('nav-maneuver-banner');
  const floatingPanel = document.getElementById('route-floating-panel');
  if (maneuverBanner) maneuverBanner.classList.add('hidden');
  if (floatingPanel) floatingPanel.classList.remove('hidden');
  window.toggleRoutePanel(false);
};

window.returnToEvacuationCenters = function () {
  const centersSection = document.getElementById('evacuation-centers-section');
  if (centersSection && centersSection.scrollIntoView) {
    centersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

/**
 * Clear currently displayed route
 */
window.clearCurrentRoute = function () {
  stopLiveNavigation({ silent: true });
  selectedCenterId = null;
  activeRouteData = null;

  const selectEl = document.getElementById('route-destination-select');
  if (selectEl && availableCenters.length > 0) {
    selectEl.selectedIndex = 0;
  }

  if (activeRouteCasing && evacMap) {
    evacMap.removeLayer(activeRouteCasing);
    activeRouteCasing = null;
  }
  if (activeRoutePolyline && evacMap) {
    evacMap.removeLayer(activeRoutePolyline);
    activeRoutePolyline = null;
  }

  const maneuverBanner = document.getElementById('nav-maneuver-banner');
  const floatingPanel = document.getElementById('route-floating-panel');
  const resultCard = document.getElementById('route-result-card');
  const errorBox = document.getElementById('route-error-box');
  if (maneuverBanner) maneuverBanner.classList.add('hidden');
  if (floatingPanel) floatingPanel.classList.remove('hidden');
  if (resultCard) resultCard.classList.add('hidden');
  if (errorBox) errorBox.classList.add('hidden');

  window.updateCollapsedSummary();
  renderCentersList(availableCenters);
  plotCentersOnMap(availableCenters);
  fitMapToBayananCenters();
};

/**
 * Reset map view to Barangay Bayanan evacuation centers
 */
window.resetMapView = function () {
  if (!evacMap) return;
  if (activeRoutePolyline) {
    const routeBounds = activeRoutePolyline.getBounds();
    fitMapToBoundsWithPadding(routeBounds, { reserveBottomCard: true, maxZoom: 17 });
  } else {
    fitMapToBayananCenters();
  }
};
