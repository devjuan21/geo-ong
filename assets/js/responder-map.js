/**
 * GeoSafe - Responder Operational Map Logic (Section 5)
 * ============================================================================
 * Features:
 * - Leaflet Operational Map with custom styled markers
 * - Responder GPS positioning with live accuracy indicator
 * - Real assigned incident and rescue markers
 * - Verified evacuation centers and emergency facilities
 * - Field Pedestrian / Vehicle Routing via Project-OSRM through GeoSafeMapping
 * - Distance and estimated travel time computation
 * - Clear distinction between field routing vs approved resident evacuation routes
 * - Responsive selected assignment bottom sheet / details card
 * ============================================================================
 */

let respMap = null;
let currentGpsLocation = null;
let userGpsMarker = null;
let userAccuracyCircle = null;
let routePolyline = null;
let markerLayerGroup = null;

let allMapData = {
  assignments: [],
  evacuationCenters: [],
  barangayFacilities: []
};

let activeFilter = 'All'; // 'All' | 'Rescue' | 'Incident' | 'Shelter'
let selectedTask = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize UI Shell
  GeoSafeResponderUI.init('map', 'Operations Map');

  // Verify responder authentication and role
  const auth = await GeoSafeResponderUI.verifyResponderSession();
  if (!auth.authorized) {
    const mainEl = document.querySelector('main');
    GeoSafeResponderUI.renderUnauthorizedScreen(mainEl);
    return;
  }

  // Initialize Map
  initResponderMap();

  // Load Map Data from Store
  await loadMapData();

  // Try acquiring responder GPS
  await acquireResponderGps(true);
});

function initResponderMap() {
  const container = document.getElementById('responder-operational-map');
  if (!container || typeof L === 'undefined') return;

  try {
    respMap = GeoSafeMapping.createMap('responder-operational-map', {
      center: [GeoSafeMapping.config.center.lat, GeoSafeMapping.config.center.lng],
      zoom: 15,
      zoomControl: true
    });

    markerLayerGroup = L.layerGroup().addTo(respMap);
  } catch (err) {
    console.error('[ResponderMap] Map init failed:', err);
    GeoSafeResponderUI.showToast('Could not initialize operational map.', 'error');
  }
}

async function loadMapData() {
  try {
    const data = await window.geoSafeStore.getResponderMapData();
    allMapData = data;
    renderMapMarkers();
  } catch (err) {
    console.error('[ResponderMap] Error loading map data:', err);
    GeoSafeResponderUI.showToast('Failed to load operational map records.', 'error');
  }
}

window.filterMapMarkers = function (filterType) {
  activeFilter = filterType;

  // Update button styles
  const buttons = ['All', 'Rescue', 'Incident', 'Shelter'];
  buttons.forEach(b => {
    const btn = document.getElementById(`map-filter-${b.toLowerCase()}`);
    if (btn) {
      if (b.toLowerCase() === filterType.toLowerCase()) {
        btn.className = 'px-3 py-1.5 rounded-xl text-xs font-bold transition-all bg-[#F5B900] text-[#202020] shadow-subtle flex-shrink-0';
      } else {
        btn.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold transition-all bg-white/90 backdrop-blur-sm border border-[#EEEEEE] text-[#777777] hover:text-[#202020] flex-shrink-0';
      }
    }
  });

  renderMapMarkers();
};

function renderMapMarkers() {
  if (!markerLayerGroup || !respMap) return;

  markerLayerGroup.clearLayers();

  // 1. Render Assigned Tasks (Rescue Requests & Incident Reports)
  (allMapData.assignments || []).forEach(task => {
    const isRescue = task.assignmentType === 'rescue';
    const isCompleted = ['completed', 'resolved'].includes((task.status || '').toLowerCase());

    if (activeFilter === 'Rescue' && !isRescue) return;
    if (activeFilter === 'Incident' && isRescue) return;
    if (activeFilter === 'Shelter') return; // only shelters

    if (!task.coordinates || typeof task.coordinates.lat !== 'number') return;

    // Custom Div Icon
    const markerHtml = `
      <div class="relative flex items-center justify-center cursor-pointer">
        <div class="w-8 h-8 rounded-full flex items-center justify-center text-white border-2 border-white shadow-xl ${
          isRescue ? 'bg-[#D93636] ring-4 ring-[#FFC2C2]' : 'bg-[#F5B900] text-[#202020] ring-4 ring-[#FFE872]'
        } ${isCompleted ? 'opacity-60 saturate-50' : ''}">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            ${isRescue
              ? '<circle cx="12" cy="12" r="10" stroke-width="2"></circle><circle cx="12" cy="12" r="4" stroke-width="2"></circle>'
              : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>'}
          </svg>
        </div>
      </div>
    `;

    const icon = L.divIcon({
      className: 'geosafe-task-marker',
      html: markerHtml,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker([task.coordinates.lat, task.coordinates.lng], { icon });
    marker.on('click', () => selectTaskForNavigation(task));
    markerLayerGroup.addLayer(marker);
  });

  // 2. Render Evacuation Centers (Green Shelter Pins)
  if (activeFilter === 'All' || activeFilter === 'Shelter') {
    (allMapData.evacuationCenters || []).forEach(center => {
      if (!center.coordinates || typeof center.coordinates.lat !== 'number') return;

      const shelterIcon = L.divIcon({
        className: 'geosafe-shelter-marker',
        html: `
          <div class="w-7 h-7 rounded-full bg-[#278653] text-white flex items-center justify-center border-2 border-white shadow-lg ring-2 ring-emerald-200">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const m = L.marker([center.coordinates.lat, center.coordinates.lng], { icon: shelterIcon });
      m.bindPopup(`
        <div class="text-xs p-1">
          <strong class="text-emerald-800 block">${center.name}</strong>
          <span class="text-[10px] text-[#777777]">${center.address || 'Barangay Bayanan'}</span><br>
          <span class="text-[10px] font-bold text-emerald-600">Capacity: ${center.currentEvacuees || 0} / ${center.capacity || 200}</span>
        </div>
      `);
      markerLayerGroup.addLayer(m);
    });
  }

  // 3. Render Emergency Facilities (EOC, Boat Dock, Fire, Hospital)
  if (activeFilter === 'All') {
    (allMapData.barangayFacilities || []).forEach(fac => {
      const facIcon = L.divIcon({
        className: 'geosafe-fac-marker',
        html: `
          <div class="w-6 h-6 rounded-lg bg-[#202020] text-[#F5B900] flex items-center justify-center border border-white shadow-md">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const m = L.marker([fac.coordinates.lat, fac.coordinates.lng], { icon: facIcon });
      m.bindPopup(`
        <div class="text-xs p-1">
          <strong class="text-[#202020] block">${fac.name}</strong>
          <span class="text-[10px] text-[#8A6800] font-bold">${fac.category}</span><br>
          <span class="text-[10px] text-[#777777]">${fac.contact}</span>
        </div>
      `);
      markerLayerGroup.addLayer(m);
    });
  }
}

/**
 * Acquire GPS location for responder
 */
window.acquireResponderGps = async function (silent = false) {
  const btn = document.getElementById('btn-gps-locate');
  const gpsStatusEl = document.getElementById('gps-status-indicator');

  if (btn) btn.classList.add('animate-pulse');

  try {
    const pos = await GeoSafeMapping.getUserLocation();
    currentGpsLocation = { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy };

    if (!silent) {
      GeoSafeResponderUI.showToast(`Responder GPS acquired (Accuracy: ±${Math.round(pos.accuracy || 15)}m).`, 'success');
    }

    if (gpsStatusEl) {
      gpsStatusEl.textContent = `GPS: Active (±${Math.round(pos.accuracy || 15)}m)`;
      gpsStatusEl.className = 'text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200';
    }

    renderResponderGpsMarker(pos.lat, pos.lng, pos.accuracy);

    // Pan map to responder
    if (respMap && !selectedTask) {
      respMap.setView([pos.lat, pos.lng], 16);
    }
  } catch (err) {
    console.warn('[ResponderMap] GPS acquisition failed:', err.message);
    if (!silent) {
      GeoSafeResponderUI.showToast('GPS unavailable. Using Barangay Bayanan base coordinates.', 'warning');
    }
    if (gpsStatusEl) {
      gpsStatusEl.textContent = 'GPS: Base Location';
      gpsStatusEl.className = 'text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200';
    }
    currentGpsLocation = { lat: GeoSafeMapping.config.center.lat, lng: GeoSafeMapping.config.center.lng, accuracy: 50 };
    renderResponderGpsMarker(currentGpsLocation.lat, currentGpsLocation.lng, 50);
  } finally {
    if (btn) btn.classList.remove('animate-pulse');
  }
};

function renderResponderGpsMarker(lat, lng, accuracy) {
  if (!respMap) return;

  const responderGpsIcon = L.divIcon({
    className: 'geosafe-gps-pulse',
    html: `
      <div class="relative flex items-center justify-center">
        <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-blue-400 opacity-75"></span>
        <div class="w-6 h-6 rounded-full bg-[#3478C7] border-2 border-white shadow-xl text-white flex items-center justify-center font-bold text-[9px]">
          ME
        </div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  if (!userGpsMarker) {
    userGpsMarker = L.marker([lat, lng], { icon: responderGpsIcon, zIndexOffset: 1000 }).addTo(respMap);
    userGpsMarker.bindPopup(`
      <div class="text-xs p-1">
        <strong class="text-blue-900 block">Responder Position</strong>
        <span class="text-[10px] text-slate-500">Your current operational field coordinates</span>
      </div>
    `);
  } else {
    userGpsMarker.setLatLng([lat, lng]);
  }

  if (accuracy && accuracy > 0) {
    if (!userAccuracyCircle) {
      userAccuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: '#3478C7',
        weight: 1,
        fillColor: '#3478C7',
        fillOpacity: 0.1
      }).addTo(respMap);
    } else {
      userAccuracyCircle.setLatLng([lat, lng]);
      userAccuracyCircle.setRadius(accuracy);
    }
  }
}

/**
 * Select task and open bottom sheet
 */
window.selectTaskForNavigation = function (task) {
  selectedTask = task;

  const sheet = document.getElementById('task-bottom-sheet');
  if (!sheet) return;

  const isRescue = task.assignmentType === 'rescue';

  document.getElementById('sheet-ref').textContent = task.referenceNumber || task.id;
  document.getElementById('sheet-type-badge').textContent = isRescue ? 'Rescue Request' : 'Incident Report';
  document.getElementById('sheet-type-badge').className = `text-[9px] font-black px-2 py-0.5 rounded-full uppercase border ${isRescue ? 'bg-[#FFF1F1] text-[#D93636] border-[#FFC2C2]' : 'bg-[#FFF9E8] text-[#8A6800] border-[#FFE872]'}`;
  document.getElementById('sheet-prio-badge').textContent = task.priority || 'Normal';
  document.getElementById('sheet-title').textContent = task.title || task.category;
  document.getElementById('sheet-location').textContent = task.location || 'Barangay Bayanan';

  // Clear previous route metrics
  document.getElementById('sheet-route-metrics').classList.add('hidden');
  document.getElementById('sheet-btn-route').classList.remove('hidden');

  sheet.classList.remove('hidden');

  if (task.coordinates && typeof task.coordinates.lat === 'number') {
    respMap.setView([task.coordinates.lat, task.coordinates.lng], 16);
  }
};

window.closeTaskBottomSheet = function () {
  document.getElementById('task-bottom-sheet')?.classList.add('hidden');
  selectedTask = null;
  clearCalculatedRoute();
};

/**
 * Field Navigation: Calculate pedestrian / vehicle route to assignment (Section 5)
 */
window.calculateRouteToTask = async function () {
  if (!selectedTask || !selectedTask.coordinates) return;

  const start = currentGpsLocation || { lat: GeoSafeMapping.config.center.lat, lng: GeoSafeMapping.config.center.lng };
  const dest = { lat: selectedTask.coordinates.lat, lng: selectedTask.coordinates.lng };

  const btn = document.getElementById('sheet-btn-route');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin inline-block mr-1">...</span> Computing field route...`;
  }

  try {
    const route = await GeoSafeMapping.calculatePedestrianRoute(start, dest);

    // Render polyline on Leaflet
    renderRoutePolyline(route.coordinates);

    // Display valid routing metrics
    const metricsEl = document.getElementById('sheet-route-metrics');
    const distEl = document.getElementById('sheet-dist-value');
    const timeEl = document.getElementById('sheet-time-value');

    const distKm = (route.distanceMeters / 1000).toFixed(1);
    const durationMin = Math.ceil(route.durationSeconds / 60);

    distEl.textContent = `${route.distanceMeters > 1000 ? distKm + ' km' : Math.round(route.distanceMeters) + ' m'}`;
    timeEl.textContent = `${durationMin} min`;

    metricsEl.classList.remove('hidden');
    if (btn) btn.classList.add('hidden');

    GeoSafeResponderUI.showToast(`Route calculated: ~${durationMin} min (${distKm} km).`, 'info');
  } catch (err) {
    console.warn('[ResponderMap] Route calculation failed:', err);
    GeoSafeResponderUI.showToast('Routing service currently unreachable. Use straight-line or open GPS navigation.', 'warning');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>Retry Calculate Route</span>`;
    }
  }
};

function renderRoutePolyline(coords) {
  if (!respMap) return;

  clearCalculatedRoute();

  routePolyline = L.polyline(coords, {
    color: '#3478C7',
    weight: 4.5,
    opacity: 0.85,
    dashArray: '2, 6'
  }).addTo(respMap);

  respMap.fitBounds(routePolyline.getBounds(), { padding: [50, 50] });
}

function clearCalculatedRoute() {
  if (routePolyline && respMap) {
    respMap.removeLayer(routePolyline);
    routePolyline = null;
  }
}

/**
 * Open external navigation in OpenStreetMap / Google Maps
 */
window.openExternalGps = function () {
  if (!selectedTask || !selectedTask.coordinates) return;

  const start = currentGpsLocation || { lat: 14.4075, lng: 121.0475 };
  const dest = selectedTask.coordinates;
  const url = `https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lng}&destination=${dest.lat},${dest.lng}&travelmode=walking`;

  window.open(url, '_blank', 'noopener,noreferrer');
};

