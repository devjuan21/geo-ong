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
  incidents: [],
  evacuationCenters: [],
  barangayFacilities: [],
  eocLocation: null
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

  // Start automatic 10-second live GPS tracking & authorized backend location sync
  startResponderLiveGps();

  const MAP_REALTIME_EVENTS = new Set([
    'new-rescue-request',
    'rescue-assignment-updated',
    'rescue-status-updated',
    'status-update',
    'incident-resolved',
    'new-incident-report',
    'new-report',
    'public-report-verified',
    'report-verification-result',
    'reconnect-sync',
  ]);

  window.addEventListener('geosafe:realtime-update', (ev) => {
    const detail = (ev && ev.detail) || {};
    if (!MAP_REALTIME_EVENTS.has(detail.event)) return;
    const payload = detail.data || detail.payload || {};
    const st = String(payload.status || '').toLowerCase();
    const isTerminal = ['completed', 'resolved', 'cancelled', 'false_alarm', 'dismissed'].includes(st) ||
      detail.event === 'incident-resolved';
    if (isTerminal) {
      const targetRef = String(payload.referenceNumber || payload.id || '');
      if (targetRef) {
        const keepActive = (t) => String(t.referenceNumber || t.id || '') !== targetRef && String(t.dbId || '') !== String(payload.dbId || '');
        allMapData.assignments = (allMapData.assignments || []).filter(keepActive);
        allMapData.incidents = (allMapData.incidents || []).filter(keepActive);
        if (selectedTask && (String(selectedTask.referenceNumber || selectedTask.id || '') === targetRef || String(selectedTask.dbId || '') === String(payload.dbId || ''))) {
          closeTaskBottomSheet();
        }
        renderMapMarkers();
      }
    }
    loadMapData();
  });
});

let respMapResizeObserver = null;
let respBodyClassObserver = null;

function initResponderMap() {
  const container = document.getElementById('responder-operational-map');
  if (!container || typeof L === 'undefined') return;

  try {
    respMap = GeoSafeMapping.createMap('responder-operational-map', {
      center: [GeoSafeMapping.config.center.lat, GeoSafeMapping.config.center.lng],
      zoom: 15,
      zoomControl: false
    });

    markerLayerGroup = L.layerGroup().addTo(respMap);

    const refreshSize = () => {
      if (respMap) {
        try { respMap.invalidateSize({ animate: false }); } catch (_) { }
      }
    };
    requestAnimationFrame(refreshSize);
    setTimeout(refreshSize, 150);
    setTimeout(refreshSize, 350);

    if (typeof ResizeObserver !== 'undefined') {
      if (respMapResizeObserver) respMapResizeObserver.disconnect();
      respMapResizeObserver = new ResizeObserver(() => refreshSize());
      respMapResizeObserver.observe(container);
    }
    if (typeof MutationObserver !== 'undefined' && document.body) {
      if (respBodyClassObserver) respBodyClassObserver.disconnect();
      respBodyClassObserver = new MutationObserver(() => setTimeout(refreshSize, 220));
      respBodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('resize', refreshSize);
  } catch (err) {
    console.error('[ResponderMap] Map init failed:', err);
    GeoSafeResponderUI.showToast('Could not initialize operational map.', 'error');
  }
}

window.zoomResponderMap = function (delta) {
  if (!respMap) return;
  if (delta > 0) respMap.zoomIn();
  else respMap.zoomOut();
};

let mapDataFetchSeq = 0;

window.loadMapData = async function loadMapData() {
  const reqSeq = ++mapDataFetchSeq;
  const errBanner = document.getElementById('map-data-error-banner');
  const errText = document.getElementById('map-data-error-text');
  if (errBanner) errBanner.classList.add('hidden');

  try {
    const data = await window.geoSafeStore.getResponderMapData();
    if (reqSeq !== mapDataFetchSeq) return;
    const isNotTerminal = (t) =>
      !['completed', 'resolved', 'cancelled', 'false_alarm', 'dismissed'].includes(String(t.status || '').toLowerCase());
    allMapData = {
      assignments: Array.isArray(data && data.assignments) ? data.assignments.filter(isNotTerminal) : [],
      incidents: Array.isArray(data && data.incidents) ? data.incidents.filter(isNotTerminal) : [],
      evacuationCenters: Array.isArray(data && data.evacuationCenters) ? data.evacuationCenters : [],
      barangayFacilities: Array.isArray(data && data.barangayFacilities) ? data.barangayFacilities : [],
      eocLocation: (data && data.eocLocation) || (typeof GeoSafeMapping.getEocLocation === 'function' ? GeoSafeMapping.getEocLocation() : null)
    };
    if (allMapData.eocLocation && typeof GeoSafeMapping.setEocLocation === 'function') {
      GeoSafeMapping.setEocLocation(allMapData.eocLocation);
    }
    renderMapMarkers();
  } catch (err) {
    if (reqSeq !== mapDataFetchSeq) return;
    console.error('[ResponderMap] Error loading map data:', err);
    if (errBanner) {
      if (errText) errText.textContent = err.message || 'Database or API request failed.';
      errBanner.classList.remove('hidden');
    }
    GeoSafeResponderUI.showToast('Failed to load operational map records.', 'error');
  }
};

window.filterMapMarkers = function (filterType) {
  activeFilter = filterType;

  // Update button styles
  const buttons = ['All', 'Rescue', 'Incident', 'Shelter'];
  buttons.forEach(b => {
    const btn = document.getElementById(`map-filter-${b.toLowerCase()}`);
    if (btn) {
      if (b.toLowerCase() === filterType.toLowerCase()) {
        btn.className = 'px-3 py-1.5 rounded-md text-xs font-bold transition-all bg-[#F5B900] text-[#202020] shadow-subtle flex-shrink-0';
      } else {
        btn.className = 'px-3 py-1.5 rounded-md text-xs font-semibold transition-all bg-white/90 backdrop-blur-sm border border-slate-200 text-[#777777] hover:text-[#202020] flex-shrink-0';
      }
    }
  });

  renderMapMarkers();
};

function renderMapMarkers() {
  if (!markerLayerGroup || !respMap) return;

  markerLayerGroup.clearLayers();
  let visibleTargetCount = 0;

  // 1. Render Assigned Tasks (Rescue Requests & Incident Reports) & Active Verified Incidents
  const assignmentKeys = new Set();
  const operationalTargets = [];
  (allMapData.assignments || []).forEach(task => {
    const key = String(task.referenceNumber || task.id || '');
    if (key) assignmentKeys.add(key);
    operationalTargets.push(task);
  });
  (allMapData.incidents || []).forEach(inc => {
    const key = String(inc.referenceNumber || inc.id || '');
    if (key && assignmentKeys.has(key)) return;
    operationalTargets.push(inc);
  });

  operationalTargets.forEach(task => {
    const isRescue = task.assignmentType === 'rescue';
    const isCompleted = ['completed', 'resolved', 'cancelled', 'false_alarm', 'dismissed'].includes((task.status || '').toLowerCase());
    if (isCompleted) return;

    if (activeFilter === 'Rescue' && !isRescue) return;
    if (activeFilter === 'Incident' && isRescue) return;
    if (activeFilter === 'Shelter') return; // only shelters

    if (!task.coordinates || typeof task.coordinates.lat !== 'number') return;

    const isSelected = Boolean(selectedTask && String(selectedTask.id) === String(task.id));
    const icon = GeoSafeMapping.createCustomIcon(isRescue ? 'rescue' : 'incident', {
      selected: isSelected,
      muted: isCompleted
    });

    const marker = L.marker([task.coordinates.lat, task.coordinates.lng], { icon });
    marker.on('click', () => selectTaskForNavigation(task));
    markerLayerGroup.addLayer(marker);
    visibleTargetCount += 1;
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
      const statusLabel = center.status || 'Operational';
      const statusLow = String(statusLabel).toLowerCase();
      const statusColorClass = (statusLow === 'open for accommodation' || statusLow === 'open - accommodating' || statusLow === 'open-accommodating')
        ? 'text-emerald-600'
        : statusLow === 'operational'
          ? 'text-sky-600'
          : statusLow === 'full'
            ? 'text-amber-600'
            : statusLow === 'temporarily closed'
              ? 'text-rose-600'
              : 'text-slate-500';
      m.bindPopup(`
        <div class="text-xs p-1">
          <strong class="text-emerald-800 block">${center.name}</strong>
          <span class="text-[10px] text-[#777777] block">${center.address || 'Barangay Bayanan'}</span>
          <span class="text-[10px] font-bold ${statusColorClass}">${statusLabel}</span>
        </div>
      `);
      markerLayerGroup.addLayer(m);
      if (activeFilter === 'Shelter') visibleTargetCount += 1;
    });
  }

  // 3. Render Medical Facilities (Hospitals & Health Centers from PostgreSQL) and EOC
  if (activeFilter === 'All') {
    (allMapData.barangayFacilities || []).forEach(fac => {
      const fLat = Number(fac.coordinates ? fac.coordinates.lat : fac.latitude);
      const fLng = Number(fac.coordinates ? fac.coordinates.lng : fac.longitude);
      if (!Number.isFinite(fLat) || !Number.isFinite(fLng)) return;

      const facType = fac.type || fac.facility_type || 'Hospital';
      const isHospital = String(facType).toLowerCase() === 'hospital';
      const facIcon = GeoSafeMapping.createMedicalFacilityIcon(facType);
      const typeColor = isHospital ? '#DC2626' : '#2563EB';

      const m = L.marker([fLat, fLng], { icon: facIcon, zIndexOffset: isHospital ? 245 : 235 });
      m.bindTooltip(`${facType}: ${fac.name}`, { direction: 'top' });
      m.bindPopup(`
        <div class="text-xs p-1 space-y-1 max-w-[240px]">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-bold uppercase tracking-wider" style="color:${typeColor};">${facType}</span>
            <span class="text-[9px] font-bold text-[#278653] bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">${fac.verificationStatus || fac.verification_status || 'Verified'}</span>
          </div>
          <strong class="text-[#0f172a] block">${fac.name}</strong>
          ${fac.address ? `<span class="text-[10px] text-[#475569] block">${fac.address}</span>` : ''}
          ${fac.operating_hours ? `<span class="text-[10px] text-[#334155] block"><strong>Hours:</strong> ${fac.operating_hours}</span>` : ''}
          ${fac.emergency_contact ? `<span class="text-[10px] text-[#334155] block"><strong>Contact:</strong> ${fac.emergency_contact}</span>` : ''}
          <span class="text-[10px] font-mono text-[#64748b] block">${fLat.toFixed(6)}, ${fLng.toFixed(6)}</span>
        </div>
      `);
      markerLayerGroup.addLayer(m);
    });

    // Render Official GeoSafe EOC Marker
    const eoc = allMapData.eocLocation || (typeof GeoSafeMapping.getEocLocation === 'function' ? GeoSafeMapping.getEocLocation() : null);
    if (eoc && Number.isFinite(Number(eoc.latitude)) && Number.isFinite(Number(eoc.longitude))) {
      const eocLat = Number(eoc.latitude);
      const eocLng = Number(eoc.longitude);
      const eocIcon = GeoSafeMapping.createCustomIcon('eoc', 'EOC');
      const eocMarker = L.marker([eocLat, eocLng], { icon: eocIcon, zIndexOffset: 250 });
      eocMarker.bindPopup(`
        <div class="text-xs p-1">
          <span class="text-[10px] font-bold text-[#4338CA] uppercase block">Official Command Center</span>
          <strong class="text-[#202020] block">${eoc.name || 'GeoSafe Emergency Operations Center (EOC)'}</strong>
          <span class="text-[10px] text-[#555555] block">${eoc.address || 'Bayanan Baywalk Ilaya, Muntinlupa, Metro Manila, Philippines'}</span>
          <span class="text-[10px] font-mono text-[#777777]">${eocLat.toFixed(5)}, ${eocLng.toFixed(5)}</span>
        </div>
      `);
      markerLayerGroup.addLayer(eocMarker);
    }
  }

  const emptyPill = document.getElementById('map-empty-state-pill');
  const emptyText = document.getElementById('map-empty-state-text');
  if (emptyPill && emptyText) {
    if (visibleTargetCount === 0) {
      if (activeFilter === 'Rescue') emptyText.textContent = 'No active rescue requests.';
      else if (activeFilter === 'Incident') emptyText.textContent = 'No active incident reports.';
      else if (activeFilter === 'Shelter') emptyText.textContent = 'No evacuation shelters available.';
      else emptyText.textContent = 'No active operational targets.';
      emptyPill.classList.remove('hidden');
    } else {
      emptyPill.classList.add('hidden');
    }
  }
}

let responderLiveGpsTracker = null;
let hasCenteredResponderGps = false;
let lastResponderSyncSentAt = 0;

function isResponderLocationSharingEnabled() {
  try {
    return localStorage.getItem('geosafe_responder_location_sharing') !== 'false';
  } catch (_) {
    return true;
  }
}

async function syncResponderPositionToBackend(reading) {
  if (!reading || !window.geoSafeStore || typeof window.geoSafeStore.syncResponderLocation !== 'function') return;
  const now = Date.now();
  if (now - lastResponderSyncSentAt < 9000) return; // Prevent duplicate 10s sync bursts
  lastResponderSyncSentAt = now;
  try {
    await window.geoSafeStore.syncResponderLocation({
      lat: reading.lat,
      lng: reading.lng,
      accuracy: reading.accuracy,
      sharingEnabled: isResponderLocationSharingEnabled()
    });
  } catch (err) {
    console.warn('[ResponderMap] Live location sync warning:', err.message);
  }
}

function startResponderLiveGps() {
  if (!respMap || responderLiveGpsTracker || !window.GeoSafeMapping || typeof window.GeoSafeMapping.createLiveGpsTracker !== 'function') {
    return;
  }
  const gpsStatusEl = document.getElementById('gps-status-indicator');

  responderLiveGpsTracker = window.GeoSafeMapping.createLiveGpsTracker({
    syncIntervalMs: 10000,
    onLocation: (reading) => {
      currentGpsLocation = {
        lat: reading.lat,
        lng: reading.lng,
        accuracy: reading.accuracy,
        heading: reading.heading,
        speed: reading.speed,
        isStale: Boolean(reading.isStale),
      };
      renderResponderGpsMarker(reading.lat, reading.lng, reading.accuracy, reading.isStale, reading.updatedAt, reading.heading, reading.speed);

      if (!hasCenteredResponderGps && respMap && !selectedTask) {
        hasCenteredResponderGps = true;
        respMap.setView([reading.lat, reading.lng], 16);
      }

      if (gpsStatusEl) {
        const accPart = Number.isFinite(Number(reading.accuracy)) ? ` (±${Math.round(reading.accuracy)}m)` : '';
        const timePart = new Date(reading.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (reading.isStale) {
          gpsStatusEl.textContent = `GPS: Stale${accPart} • ${timePart}`;
          gpsStatusEl.className = 'inline-flex items-center gap-1.5 text-[11px] font-bold text-[#8A6800] bg-slate-50 px-2.5 py-1 rounded-full border border-[#FFE872] truncate';
        } else {
          gpsStatusEl.textContent = `GPS: Live${accPart} • ${timePart}`;
          gpsStatusEl.className = 'inline-flex items-center gap-1.5 text-[11px] font-bold text-[#278653] bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 truncate';
        }
      }

      if (!reading.isStale) {
        syncResponderPositionToBackend(reading);
      }
    },
    onStatusChange: ({ status }) => {
      if (!gpsStatusEl) return;
      if (status === 'acquiring') {
        gpsStatusEl.textContent = 'GPS: Acquiring...';
        gpsStatusEl.className = 'inline-flex items-center gap-1.5 text-[11px] font-bold text-[#8A6800] bg-slate-50 px-2.5 py-1 rounded-full border border-[#FFE872] truncate';
      } else if (status === 'denied') {
        currentGpsLocation = null;
        gpsStatusEl.textContent = 'GPS: Denied';
        gpsStatusEl.className = 'inline-flex items-center gap-1.5 text-[11px] font-bold text-[#D93636] bg-[#FFF1F1] px-2.5 py-1 rounded-full border border-[#FFC2C2] truncate';
      } else if (status === 'unavailable' && !responderLiveGpsTracker.getLastReading()) {
        currentGpsLocation = null;
        gpsStatusEl.textContent = 'GPS: Unavailable';
        gpsStatusEl.className = 'inline-flex items-center gap-1.5 text-[11px] font-bold text-[#D93636] bg-[#FFF1F1] px-2.5 py-1 rounded-full border border-[#FFC2C2] truncate';
      }
    }
  });

  responderLiveGpsTracker.start();
}

/**
 * Manual GPS refresh / recenter for responder
 */
window.acquireResponderGps = async function (silent = false) {
  if (!responderLiveGpsTracker) {
    startResponderLiveGps();
  }
  const btn = document.getElementById('btn-gps-locate');
  if (btn) btn.classList.add('animate-pulse');

  try {
    const reading = responderLiveGpsTracker ? await responderLiveGpsTracker.refreshNow(true) : null;
    if (reading) {
      if (respMap && !selectedTask) {
        respMap.setView([reading.lat, reading.lng], 16);
      }
      if (!silent) {
        GeoSafeResponderUI.showToast(
          Number.isFinite(Number(reading.accuracy))
            ? `Responder GPS updated (±${Math.round(reading.accuracy)}m).`
            : 'Responder GPS updated.',
          'success'
        );
      }
    } else if (!silent) {
      const isDenied = responderLiveGpsTracker && responderLiveGpsTracker.getStatus() === 'denied';
      GeoSafeResponderUI.showToast(
        isDenied
          ? 'Location access denied. Enable GPS in browser settings to view your live position.'
          : 'Unable to retrieve your current GPS location.',
        'warning'
      );
    }
  } finally {
    if (btn) btn.classList.remove('animate-pulse');
  }
};

const responderGpsMarkerState = { marker: null, accuracyCircle: null };

function renderResponderGpsMarker(lat, lng, accuracy, isStale = false, updatedAt = null, heading = null, speed = null) {
  if (!respMap || !window.GeoSafeMapping || typeof window.GeoSafeMapping.renderLiveGpsMarker !== 'function') return;
  responderGpsMarkerState.marker = userGpsMarker;
  window.GeoSafeMapping.renderLiveGpsMarker(
    respMap,
    responderGpsMarkerState,
    { lat, lng, accuracy, heading, speed, updatedAt, isStale },
    { title: 'Responder Position', zIndexOffset: 1000 }
  );
  userGpsMarker = responderGpsMarkerState.marker;
  userAccuracyCircle = responderGpsMarkerState.accuracyCircle;
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
  document.getElementById('sheet-type-badge').className = `text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border ${isRescue ? 'bg-[#FFF1F1] text-[#D93636] border-[#FFC2C2]' : 'bg-slate-50 text-[#8A6800] border-[#FFE872]'}`;
  const prioEl = document.getElementById('sheet-prio-badge');
  if (prioEl) {
    prioEl.textContent = task.status || (task.isPublicIncident ? 'Verified' : 'Assigned');
  }
  const viewBtn = document.getElementById('sheet-btn-view');
  if (viewBtn) {
    viewBtn.classList.remove('hidden');
    viewBtn.href = `responder-assignments.html?id=${encodeURIComponent(task.referenceNumber || task.id)}`;
    if (task.isUnassignedIncoming || task.isPublicIncident) {
      viewBtn.textContent = 'Open & Respond';
    } else {
      viewBtn.textContent = 'View Assignment';
    }
  }
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

  const eoc = allMapData.eocLocation || (typeof GeoSafeMapping.getEocLocation === 'function' ? GeoSafeMapping.getEocLocation() : { latitude: 14.41141, longitude: 121.05130 });
  const start = currentGpsLocation || { lat: Number(eoc.latitude ?? eoc.lat ?? 14.41141), lng: Number(eoc.longitude ?? eoc.lng ?? 121.05130) };
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

  const eoc = allMapData.eocLocation || (typeof GeoSafeMapping.getEocLocation === 'function' ? GeoSafeMapping.getEocLocation() : { lat: 14.41141, lng: 121.05130 });
  const start = currentGpsLocation || { lat: Number(eoc.latitude ?? eoc.lat ?? 14.41141), lng: Number(eoc.longitude ?? eoc.lng ?? 121.05130) };
  const dest = selectedTask.coordinates;
  const url = `https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lng}&destination=${dest.lat},${dest.lng}&travelmode=walking`;

  window.open(url, '_blank', 'noopener,noreferrer');
};

