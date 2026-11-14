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
let userLocationMarker = null;

let currentLoadedReports = [];
let currentLoadedAlerts = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize common shell navigation & compact header
  GeoSafeUI.init('home', 'Home');

  // Initialize interactive Leaflet map
  initIncidentMap();

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
function initIncidentMap() {
  try {
    incidentMap = GeoSafeMapping.createMap('incident-map', {
      scrollWheelZoom: false
    });

    incidentMarkersGroup = L.layerGroup().addTo(incidentMap);
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
    loadEvacuationSummary(),
    loadMyReportsSummary()
  ]);
}

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
        <p class="text-[11px] mt-0.5 text-slate-400">Barangay Bayanan BDRRMC has not issued active hazard or evacuation advisories.</p>
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
