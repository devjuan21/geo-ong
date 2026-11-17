/**
 * GeoSafe - Resident Homepage & Community Monitoring
 * ============================================================================
 * Features:
 * - Real-time Community Map with active public incident markers
 * - Recent Reports, Hazard Alerts, Evacuation Shelters, and My Submitted Reports cards
 * ============================================================================
 */

let incidentMap = null;
let incidentMarkersGroup = null;
const homeGpsMarkerState = { marker: null, accuracyCircle: null };
let homeGpsTracker = null;
let hasCenteredHomeGps = false;

let currentLoadedReports = [];
let currentLoadedAlerts = [];
let currentLoadedCenters = [];
let currentUserLocation = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize common shell navigation & compact header
  GeoSafeUI.init('home', 'Home');

  // Initialize interactive Leaflet map
  initIncidentMap();

  // Start automatic 10-second live GPS tracking without blocking genuine operational data loading
  startHomeLiveGps();

  // Load all live homepage records
  await loadHomepageData();

  // Listen for real-time Socket.IO events to automatically refresh homepage data
  window.addEventListener('geosafe:realtime-update', () => {
    loadCommunityReports();
    loadHazardAlerts();
    loadEvacuationSummary();
    loadMyReportsSummary();
  });
});

/**
 * Initialize Community Incident Leaflet Map
 */
let incidentMapResizeObserver = null;

function initIncidentMap() {
  try {
    incidentMap = GeoSafeMapping.createMap('incident-map', {
      scrollWheelZoom: false
    });

    incidentMarkersGroup = L.layerGroup().addTo(incidentMap);

    const refreshMapSize = () => {
      if (incidentMap) {
        try { incidentMap.invalidateSize({ animate: false }); } catch (_) {}
      }
    };
    requestAnimationFrame(refreshMapSize);
    setTimeout(refreshMapSize, 150);
    setTimeout(refreshMapSize, 350);

    const mapEl = document.getElementById('incident-map');
    if (mapEl && typeof ResizeObserver !== 'undefined') {
      if (incidentMapResizeObserver) incidentMapResizeObserver.disconnect();
      incidentMapResizeObserver = new ResizeObserver(() => refreshMapSize());
      incidentMapResizeObserver.observe(mapEl);
    }
    window.addEventListener('resize', refreshMapSize);
  } catch (err) {
    console.error('Failed to initialize incident map:', err);
  }
}

/**
 * Fetch and render all live homepage data
 */
async function loadHomepageData() {
  await Promise.all([
    loadCommunityReports(),
    loadHazardAlerts(),
    loadEvacuationSummary()
  ]);
}

/**
 * Load verified community reports and plot on map (Sections 2.C & 2.D)
 */
let communityReportsFetchSeq = 0;

async function loadCommunityReports() {
  const reqSeq = ++communityReportsFetchSeq;
  const mapEmptyOverlay = document.getElementById('incident-map-empty');
  const reportsEmptyEl = document.getElementById('community-reports-empty');
  const reportsListEl = document.getElementById('community-reports-list');
  const activeCountEl = document.getElementById('active-incidents-count');
  const headerCountEl = document.getElementById('reports-header-count');

  try {
    const reports = await window.geoSafeStore.getPublicIncidentReports();
    if (reqSeq !== communityReportsFetchSeq) return;
    currentLoadedReports = (reports || []).filter(
      (r) => !['resolved', 'false_alarm', 'dismissed'].includes(String(r.status || '').toLowerCase())
    );

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

  if (validCoordinates.length > 0) {
    const bounds = L.latLngBounds(validCoordinates);
    const bayananBounds = GeoSafeMapping.getBayananBounds();
    if (bayananBounds && bayananBounds.isValid()) {
      bounds.extend(bayananBounds);
    }
    incidentMap.fitBounds(bounds, { padding: [24, 24] });
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
 * Load Hazard Alerts (displays up to 2 genuine active alerts)
 */
function escapeHtmlSafe(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadHazardAlerts() {
  const countEl = document.getElementById('stat-alerts-count');
  const listEl = document.getElementById('alerts-widget-list');

  try {
    const alerts = await window.geoSafeStore.getHazardAlerts();
    currentLoadedAlerts = Array.isArray(alerts) ? alerts : [];
    const count = currentLoadedAlerts.length;

    if (countEl) countEl.textContent = `${count} Active`;
    if (!listEl) return;

    if (count === 0) {
      listEl.innerHTML = `
        <div class="p-2.5 bg-[#FFFDF7] rounded-xl border border-[#EEEEEE] text-xs text-[#777777] font-medium">
          No active hazard alerts.
        </div>
      `;
      return;
    }

    const sortedAlerts = window.GeoSafeAdvisories
      ? [...currentLoadedAlerts].sort(window.GeoSafeAdvisories.comparePriorityThenNewest)
      : currentLoadedAlerts;

    listEl.innerHTML = sortedAlerts.slice(0, 2).map((alert) => {
      const advisoryType = alert.categoryName || alert.advisoryType || alert.category || 'Other';
      const badgeHtml = window.GeoSafeAdvisories
        ? window.GeoSafeAdvisories.renderBadge(advisoryType, { badgeColor: alert.badgeColor })
        : '';
      const title = escapeHtmlSafe(alert.headline || alert.title || 'Hazard Alert');
      const desc = escapeHtmlSafe(alert.description || '');
      const timeStr = alert.publishedAt ? GeoSafeUI.formatRelative(alert.publishedAt) : '';
      return `
        <div class="p-3 bg-[#FFFDF7] rounded-2xl border border-[#EEEEEE] space-y-1.5 min-w-0">
          <div class="flex items-center justify-between gap-2 min-w-0">
            <span class="text-xs font-bold text-[#202020] truncate min-w-0 flex-1">${title}</span>
            ${timeStr ? `<span class="text-[11px] text-[#777777] whitespace-nowrap flex-shrink-0">${escapeHtmlSafe(timeStr)}</span>` : ''}
          </div>
          ${desc ? `<p class="text-xs text-[#555555] truncate leading-snug">${desc}</p>` : ''}
          ${badgeHtml ? `<div class="pt-0.5">${badgeHtml}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading hazard alerts:', err);
  }
}

/**
 * Load & Render Nearest Evacuation Center based on actual user GPS
 */
function renderNearestEvacuationCenter() {
  const nameEl = document.getElementById('nearest-center-name');
  const metaEl = document.getElementById('nearest-center-meta');
  if (!nameEl || !metaEl) return;

  const centers = Array.isArray(currentLoadedCenters) ? currentLoadedCenters : [];
  if (centers.length === 0) {
    nameEl.textContent = 'No evacuation centers available';
    metaEl.textContent = 'No active centers found in database.';
    return;
  }

  if (!currentUserLocation || !Number.isFinite(currentUserLocation.lat) || !Number.isFinite(currentUserLocation.lng)) {
    nameEl.textContent = 'Location access needed';
    metaEl.textContent = 'Enable browser location access to calculate the nearest evacuation center.';
    return;
  }

  const available = centers.filter((c) => {
    const st = String(c.status || '').toLowerCase();
    return !st.includes('closed') && !st.includes('full');
  });
  const pool = available.length > 0 ? available : centers;

  let nearest = null;
  let minMeters = Infinity;

  pool.forEach((c) => {
    const lat = Number(c.coordinates ? c.coordinates.lat : c.latitude);
    const lng = Number(c.coordinates ? c.coordinates.lng : c.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const dist = GeoSafeMapping.computeDistanceMeters(currentUserLocation, { lat, lng });
    if (dist < minMeters) {
      minMeters = dist;
      nearest = c;
    }
  });

  if (!nearest || !Number.isFinite(minMeters)) {
    nameEl.textContent = 'Location unavailable';
    metaEl.textContent = 'Could not match coordinates to an evacuation center.';
    return;
  }

  const distText = minMeters >= 1000
    ? `${(minMeters / 1000).toFixed(2)} km away`
    : `${Math.round(minMeters)} m away`;
  const statusText = nearest.status ? ` • ${nearest.status}` : '';

  nameEl.textContent = nearest.name || 'Evacuation Center';
  metaEl.textContent = `${distText}${statusText}`;
}

async function loadEvacuationSummary() {
  try {
    const centers = await window.geoSafeStore.getEvacuationCenters();
    currentLoadedCenters = Array.isArray(centers) ? centers : [];
    renderNearestEvacuationCenter();
  } catch (err) {
    console.error('Error loading evacuation centers summary:', err);
  }
}

/**
 * Load My Submitted Reports & Rescues Summary
 */
async function loadMyReportsSummary() {
  const countEl = document.getElementById('stat-my-reports-count');
  const summaryEl = document.getElementById('my-reports-summary-text');

  try {
    const [reports, rescues] = await Promise.all([
      window.geoSafeStore.getReports({ mine: true }).catch(() => []),
      window.geoSafeStore.getRescueRequests({ mine: true }).catch(() => [])
    ]);
    const reportList = Array.isArray(reports) ? reports : [];
    const rescueList = Array.isArray(rescues) ? rescues : [];
    const totalCount = reportList.length + rescueList.length;

    if (countEl) {
      countEl.textContent = `${totalCount} ${totalCount === 1 ? 'Submission' : 'Submissions'}`;
    }

    if (totalCount === 0) {
      if (summaryEl) summaryEl.textContent = 'No incident reports or rescue requests submitted yet.';
      return;
    }

    if (summaryEl) {
      summaryEl.textContent = `${reportList.length} incident report(s), ${rescueList.length} rescue request(s)`;
    }
  } catch (err) {
    console.error('Error loading submitted reports summary:', err);
  }
}

/**
 * Update GPS status pill below the Community Map
 */
function updateGpsStatusIndicator(tone, text) {
  const el = document.getElementById('resident-gps-status');
  if (!el) return;

  const toneClasses = {
    loading: 'bg-[#FFF9E8] text-[#8A6800] border-[#FFE872]',
    success: 'bg-emerald-50 text-[#278653] border-emerald-200',
    warning: 'bg-[#FFF1F1] text-[#D93636] border-[#FFC2C2]',
    neutral: 'bg-slate-100 text-[#555555] border-[#EEEEEE]'
  };

  el.className = `inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${toneClasses[tone] || toneClasses.neutral}`;
  el.textContent = text;
}

/**
 * Start automatic 10-second Live GPS Tracking for the Community Map
 */
function startHomeLiveGps() {
  if (!incidentMap || homeGpsTracker || !GeoSafeMapping || typeof GeoSafeMapping.createLiveGpsTracker !== 'function') {
    return;
  }

  homeGpsTracker = GeoSafeMapping.createLiveGpsTracker({
    syncIntervalMs: 10000,
    onLocation: (reading) => {
      currentUserLocation = { lat: reading.lat, lng: reading.lng };
      renderNearestEvacuationCenter();
      GeoSafeMapping.renderLiveGpsMarker(incidentMap, homeGpsMarkerState, reading, {
        title: 'Your Current GPS Location'
      });

      if (!hasCenteredHomeGps) {
        hasCenteredHomeGps = true;
        incidentMap.setView([reading.lat, reading.lng], 16);
      }

      const accText = Number.isFinite(Number(reading.accuracy)) && reading.accuracy > 0
        ? ` (±${Math.round(reading.accuracy)} m)`
        : '';
      const timeText = new Date(reading.updatedAt || Date.now()).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      if (reading.isStale) {
        updateGpsStatusIndicator('warning', `GPS stale${accText} • ${timeText}`);
      } else {
        updateGpsStatusIndicator('success', `Live GPS${accText} • ${timeText}`);
      }
    },
    onStatusChange: ({ status }) => {
      if (status === 'acquiring') {
        updateGpsStatusIndicator('loading', 'Detecting GPS location...');
      } else if (status === 'denied') {
        currentUserLocation = null;
        renderNearestEvacuationCenter();
        updateGpsStatusIndicator(
          'warning',
          'Location access disabled. Enable permission in browser site settings or use map controls.'
        );
      } else if (status === 'unavailable' && !homeGpsTracker.getLastReading()) {
        currentUserLocation = null;
        renderNearestEvacuationCenter();
        updateGpsStatusIndicator('neutral', 'Location unavailable. Tap Location to retry.');
      }
    }
  });

  homeGpsTracker.start();
}

/**
 * Manual Location / Recenter trigger for Community Map
 */
window.locateUserOnMap = async function () {
  if (!incidentMap) return;
  if (!homeGpsTracker) startHomeLiveGps();

  const btn = document.getElementById('btn-locate-me');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="animate-spin w-3.5 h-3.5 mr-1 inline-block text-[#F5B900]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Locating...`;
  }

  try {
    const reading = homeGpsTracker ? await homeGpsTracker.refreshNow(true) : null;
    if (reading) {
      incidentMap.setView([reading.lat, reading.lng], 16);
      if (homeGpsMarkerState.marker) homeGpsMarkerState.marker.openPopup();
      const acc = Number.isFinite(Number(reading.accuracy)) && reading.accuracy > 0
        ? ` (±${Math.round(reading.accuracy)} m)`
        : '';
      GeoSafeUI.showToast(`GPS location updated${acc}.`, 'info');
    } else if (homeGpsTracker && homeGpsTracker.getStatus() === 'denied') {
      GeoSafeUI.showToast('Location permission is denied. Enable it in your browser site settings.', 'warning');
    } else {
      GeoSafeUI.showToast('Unable to access current GPS position.', 'warning');
    }
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
window.openAlertsModal = function (focusAlertId = null) {
  const modal = document.getElementById('hazard-alerts-modal');
  const content = document.getElementById('alerts-modal-content');
  if (!modal || !content) return;

  if (currentLoadedAlerts.length === 0) {
    content.innerHTML = `
      <div class="py-8 text-center text-xs text-slate-400">
        <p class="font-bold text-slate-700 text-sm">No active hazard alerts.</p>
        <p class="text-[11px] mt-0.5 text-slate-400">Barangay Bayanan BDRRMC has not issued active hazard or evacuation advisories.</p>
      </div>
    `;
  } else {
    const ordered = focusAlertId
      ? [
          ...currentLoadedAlerts.filter((a) => String(a.id) === String(focusAlertId)),
          ...currentLoadedAlerts.filter((a) => String(a.id) !== String(focusAlertId)),
        ]
      : currentLoadedAlerts;
    content.innerHTML = ordered.map(a => `
      <div class="p-3 bg-amber-50 rounded-xl border ${focusAlertId && String(a.id) === String(focusAlertId) ? 'border-[#F5B900] ring-1 ring-[#F5B900]' : 'border-amber-200'} text-xs space-y-1">
        <div class="flex items-center justify-between">
          <span class="font-bold text-amber-950">${escapeHtmlSafe(a.headline || a.title)}</span>
        </div>
        <p class="text-[11px] text-slate-700 leading-relaxed">${escapeHtmlSafe(a.description)}</p>
        <span class="text-[10px] text-slate-400 block">Issued: ${GeoSafeUI.formatRelative(a.publishedAt)}</span>
      </div>
    `).join('');
  }

  modal.classList.remove('hidden');
};

window.closeAlertsModal = function () {
  document.getElementById('hazard-alerts-modal')?.classList.add('hidden');
};
