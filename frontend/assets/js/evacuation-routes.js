/**
 * GeoSafe - Evacuation Routes & Shelters Page Logic (Section 4)
 * ============================================================================
 * Features:
 * - Interactive Leaflet Map with OpenStreetMap base layer
 * - Browser GPS current-location acquisition & reverse geocoding
 * - Real evacuation centers directory with capacity indicators
 * - Pedestrian route calculation via Project-OSRM (foot profile)
 * - Safe evacuation disclaimers and external OSM directions integration
 * - Error handling & retry mechanisms (Section 4.C)
 * - Empty state: "No evacuation centers are currently available."
 * ============================================================================
 */

let evacMap = null;
let centersMarkersGroup = null;
let userMarker = null;
let activeRoutePolyline = null;

let availableCenters = [];
let currentUserPosition = {
  lat: GeoSafeMapping.config.center.lat,
  lng: GeoSafeMapping.config.center.lng,
  label: 'Barangay Bayanan Center',
  isGps: false
};

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize common shell navigation
  GeoSafeUI.init('evacuation-routes', 'Evacuation Routes');

  // Initialize Leaflet Map
  initEvacuationMap();

  // Load evacuation centers
  await loadEvacuationCenters();
});

/**
 * Initialize Leaflet map
 */
function initEvacuationMap() {
  try {
    evacMap = GeoSafeMapping.createMap('evacuation-map', {
      center: [currentUserPosition.lat, currentUserPosition.lng],
      zoom: 15,
      scrollWheelZoom: false
    });

    centersMarkersGroup = L.layerGroup().addTo(evacMap);

    // Initial user position marker
    renderUserLocationMarker();
  } catch (err) {
    console.error('Failed to initialize evacuation map:', err);
  }
}

/**
 * Render or update user location marker
 */
function renderUserLocationMarker() {
  if (!evacMap) return;

  const latLng = [currentUserPosition.lat, currentUserPosition.lng];
  const userIcon = GeoSafeMapping.createCustomIcon('user');

  if (!userMarker) {
    userMarker = L.marker(latLng, { icon: userIcon }).addTo(evacMap);
    userMarker.bindPopup(`<strong>Your Starting Point</strong><br><span class="text-xs text-slate-500">${currentUserPosition.label}</span>`);
  } else {
    userMarker.setLatLng(latLng);
    userMarker.setPopupContent(`<strong>Your Starting Point</strong><br><span class="text-xs text-slate-500">${currentUserPosition.label}</span>`);
  }
}

/**
 * Acquire resident's current GPS location
 */
window.acquireUserGpsLocation = async function () {
  const btn = document.getElementById('btn-gps-header');
  const labelEl = document.getElementById('route-start-label');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="animate-spin w-3.5 h-3.5 mr-1 inline-block text-[#F5B900]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Acquiring GPS...`;
  }

  try {
    const pos = await GeoSafeMapping.getCurrentLocation();
    currentUserPosition.lat = pos.lat;
    currentUserPosition.lng = pos.lng;
    currentUserPosition.isGps = true;

    // Reverse geocode to readable address
    let addressName = await GeoSafeMapping.reverseGeocode(pos.lat, pos.lng);
    currentUserPosition.label = addressName;

    if (labelEl) labelEl.value = addressName;

    renderUserLocationMarker();
    evacMap.setView([pos.lat, pos.lng], 16);
    userMarker.openPopup();

    GeoSafeUI.showToast('GPS coordinates acquired successfully.', 'success');
  } catch (err) {
    console.warn('GPS acquisition error:', err);
    GeoSafeUI.showToast(err.message || 'Unable to access current GPS position.', 'warning');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"></circle><line x1="22" y1="12" x2="18" y2="12" stroke-width="2" stroke-linecap="round"></line><line x1="6" y1="12" x2="2" y2="12" stroke-width="2" stroke-linecap="round"></line><line x1="12" y1="6" x2="12" y2="2" stroke-width="2" stroke-linecap="round"></line><line x1="12" y1="22" x2="12" y2="18" stroke-width="2" stroke-linecap="round"></line></svg>
        <span>Set My GPS Location</span>
      `;
    }
  }
};

/**
 * Load designated evacuation centers from store
 */
async function loadEvacuationCenters() {
  const emptyEl = document.getElementById('evacuation-centers-empty');
  const listEl = document.getElementById('evacuation-centers-list');
  const selectEl = document.getElementById('route-destination-select');
  const badgeEl = document.getElementById('shelters-count-badge');

  try {
    availableCenters = await window.geoSafeStore.getEvacuationCenters();
    const count = availableCenters.length;

    if (badgeEl) badgeEl.textContent = `${count} ${count === 1 ? 'shelter' : 'shelters'}`;

    if (count === 0) {
      // Empty state (Section 4.C: "No evacuation centers are currently available.")
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (listEl) listEl.classList.add('hidden');
      if (selectEl) {
        selectEl.innerHTML = '<option value="" disabled selected>No evacuation centers available</option>';
      }
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    if (listEl) listEl.classList.remove('hidden');

    // Populate destination dropdown
    if (selectEl) {
      selectEl.innerHTML = `
        <option value="" disabled selected>Select an evacuation shelter...</option>
        ${availableCenters.map(c => `
          <option value="${c.id}">${c.name} (${c.address || 'Bayanan'})</option>
        `).join('')}
      `;
    }

    // Render cards list
    renderCentersList(availableCenters);

    // Plot markers on map
    plotCentersOnMap(availableCenters);
  } catch (err) {
    console.error('Error loading evacuation centers:', err);
  }
}

/**
 * Render evacuation centers list
 */
function renderCentersList(centers) {
  const container = document.getElementById('evacuation-centers-list');
  if (!container) return;

  container.innerHTML = centers.map(c => `
    <div class="p-3.5 bg-white rounded-2xl border border-[#EEEEEE] shadow-card hover:border-[#F5B900] transition-all flex flex-col justify-between gap-2.5">
      <div>
        <div class="flex items-start justify-between gap-2">
          <h4 class="font-bold text-[#202020] text-xs sm:text-sm truncate">${c.name}</h4>
          <span class="text-[9px] font-bold text-[#278653] bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex-shrink-0">
            ${c.status || 'Active'}
          </span>
        </div>
        <p class="text-[11px] text-[#777777] mt-0.5 truncate">${c.address}</p>
        ${c.capacity ? `
          <div class="mt-2 text-[10px] text-[#777777] flex items-center justify-between">
            <span>Capacity: <strong class="text-[#202020]">${c.currentOccupancy || 0} / ${c.capacity}</strong></span>
            <span class="text-[#278653] font-bold">Space Available</span>
          </div>
        ` : ''}
      </div>

      <div class="pt-2 border-t border-[#EEEEEE] flex items-center justify-end">
        <button onclick="selectDestination('${c.id}')" class="px-3 py-1 rounded-xl bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] font-bold text-xs transition-colors shadow-subtle flex items-center gap-1">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
          <span>Route</span>
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * Plot shelter markers on Leaflet map
 */
function plotCentersOnMap(centers) {
  if (!evacMap || !centersMarkersGroup) return;

  centersMarkersGroup.clearLayers();
  const boundsCoords = [[currentUserPosition.lat, currentUserPosition.lng]];

  centers.forEach(c => {
    if (c.coordinates && typeof c.coordinates.lat === 'number' && typeof c.coordinates.lng === 'number') {
      const latLng = [c.coordinates.lat, c.coordinates.lng];
      boundsCoords.push(latLng);

      const shelterIcon = GeoSafeMapping.createCustomIcon('evacuation');
      const marker = L.marker(latLng, { icon: shelterIcon });

      const popupHtml = `
        <div class="p-2.5 text-xs font-sans max-w-xs">
          <div class="flex items-center gap-1.5 mb-1 text-[#278653] font-bold">
            <span>Official Shelter</span>
          </div>
          <h4 class="font-bold text-[#202020] text-xs sm:text-sm">${c.name}</h4>
          <p class="text-[11px] text-[#777777] mb-2">${c.address}</p>
          <button onclick="selectDestination('${c.id}')" class="w-full py-1.5 px-2 bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] rounded-xl text-xs font-bold transition-colors shadow-subtle flex items-center justify-center gap-1.5">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            <span>Route Here</span>
          </button>
        </div>
      `;

      marker.bindPopup(popupHtml);
      centersMarkersGroup.addLayer(marker);
    }
  });

  if (boundsCoords.length > 1) {
    evacMap.fitBounds(L.latLngBounds(boundsCoords), { padding: [50, 50] });
  }
}

/**
 * Select destination center and calculate route
 */
window.selectDestination = function (centerId) {
  const selectEl = document.getElementById('route-destination-select');
  if (selectEl) {
    selectEl.value = centerId;
  }
  handleCalculateRoute();
};

/**
 * Calculate pedestrian route via Project-OSRM Foot Endpoint (Section 4.C)
 */
window.handleCalculateRoute = async function () {
  const selectEl = document.getElementById('route-destination-select');
  const selectedCenterId = selectEl?.value;

  if (!selectedCenterId) {
    GeoSafeUI.showToast('Please select an evacuation center destination.', 'warning');
    return;
  }

  const destination = availableCenters.find(c => c.id === selectedCenterId);
  if (!destination || !destination.coordinates) {
    GeoSafeUI.showToast('Selected evacuation center coordinates are unavailable.', 'error');
    return;
  }

  const overlay = document.getElementById('route-calculating-overlay');
  const resultCard = document.getElementById('route-result-card');
  const errorBox = document.getElementById('route-error-box');
  const errorMsg = document.getElementById('route-error-msg');
  const distVal = document.getElementById('route-distance-val');
  const durVal = document.getElementById('route-duration-val');
  const osmBtn = document.getElementById('btn-external-osm');

  if (overlay) overlay.classList.remove('hidden');
  if (resultCard) resultCard.classList.add('hidden');
  if (errorBox) errorBox.classList.add('hidden');

  try {
    const route = await GeoSafeMapping.calculatePedestrianRoute(
      { lat: currentUserPosition.lat, lng: currentUserPosition.lng },
      { lat: destination.coordinates.lat, lng: destination.coordinates.lng }
    );

    // Draw route polyline on Leaflet map
    if (activeRoutePolyline) {
      evacMap.removeLayer(activeRoutePolyline);
    }

    activeRoutePolyline = L.polyline(route.coordinates, {
      color: '#2563eb', // vivid blue
      weight: 6,
      opacity: 0.85,
      dashArray: '1, 8',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(evacMap);

    // Fit map bounds to show route
    evacMap.fitBounds(activeRoutePolyline.getBounds(), { padding: [60, 60] });

    // Populate route results
    if (distVal) distVal.textContent = GeoSafeMapping.formatDistance(route.distanceMeters);
    if (durVal) durVal.textContent = GeoSafeMapping.formatDuration(route.durationSeconds);
    if (osmBtn) {
      osmBtn.href = GeoSafeMapping.buildExternalDirectionsUrl(
        currentUserPosition,
        destination.coordinates
      );
    }

    if (resultCard) resultCard.classList.remove('hidden');
    GeoSafeUI.showToast('Pedestrian evacuation route calculated.', 'success');
  } catch (err) {
    console.error('Route calculation failed:', err);
    if (errorBox) {
      errorBox.classList.remove('hidden');
      if (errorMsg) {
        errorMsg.textContent = err.message || 'Routing server is currently unavailable. Please verify connection and retry.';
      }
    }
    GeoSafeUI.showToast('Failed to calculate pedestrian route.', 'error');
  } finally {
    if (overlay) overlay.classList.add('hidden');
  }
};

/**
 * Clear currently displayed route
 */
window.clearCurrentRoute = function () {
  if (activeRoutePolyline && evacMap) {
    evacMap.removeLayer(activeRoutePolyline);
    activeRoutePolyline = null;
  }
  const resultCard = document.getElementById('route-result-card');
  if (resultCard) resultCard.classList.add('hidden');
  resetMapView();
};

/**
 * Reset map view
 */
window.resetMapView = function () {
  if (evacMap) {
    evacMap.setView([currentUserPosition.lat, currentUserPosition.lng], 15);
  }
};

