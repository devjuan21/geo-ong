/**
 * GeoSafe - Responder Dashboard Logic (Section 3)
 * ============================================================================
 * Features:
 * - Dynamic statistics computed strictly from real records (Active, Pending, In Progress, Completed)
 * - Emergency Priority breakdown (Critical, High, Medium, Low)
 * - Active Assignment cards with priority indicators & View Details action
 * - Exact empty state string: "No active assignments."
 * - Mini operational map preview linking to full responder map
 * ============================================================================
 */

let miniPreviewMap = null;
let miniMapLayerGroup = null;
let miniEocMarker = null;
let currentAssignments = [];
let cachedAuthProfile = null;
let dashboardLoadInFlight = false;
let dashboardReloadQueued = false;

const DASHBOARD_REALTIME_EVENTS = new Set([
  'new-rescue-request',
  'rescue-assignment-updated',
  'rescue-status-updated',
  'assignment-updated',
  'status-update',
  'incident-resolved',
  'new-incident-report',
  'new-report',
  'public-report-verified',
  'report-verification-result',
  'reconnect-sync',
]);

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Responder UI Shell
  GeoSafeResponderUI.init('dashboard', 'Responder Dashboard');

  // Load Dashboard Data
  await loadDashboardData({ background: false });

  // Initialize Mini Map Preview
  initMiniMapPreview();

  window.addEventListener('geosafe:realtime-update', (ev) => {
    const evt = ev && ev.detail ? ev.detail.event : '';
    if (!DASHBOARD_REALTIME_EVENTS.has(evt)) return;
    loadDashboardData({ background: true });
  });
});

async function loadDashboardData({ background = false } = {}) {
  if (dashboardLoadInFlight) {
    dashboardReloadQueued = true;
    return;
  }
  dashboardLoadInFlight = true;

  const loadingEl = document.getElementById('dash-loading');
  const contentEl = document.getElementById('dash-content');

  try {
    // Verify responder authentication and role (skip redundant check on background sync if already verified)
    let auth = cachedAuthProfile ? { authorized: true, profile: cachedAuthProfile } : null;
    if (!auth) {
      auth = await GeoSafeResponderUI.verifyResponderSession();
      if (!auth.authorized) {
        if (loadingEl) loadingEl.classList.add('hidden');
        const mainEl = document.querySelector('main');
        GeoSafeResponderUI.renderUnauthorizedScreen(mainEl);
        return;
      }
      cachedAuthProfile = auth.profile || null;
    }

    if (!background) {
      if (loadingEl) loadingEl.classList.remove('hidden');
      if (contentEl) contentEl.classList.add('hidden');
    }

    const [summary, mapData] = await Promise.all([
      window.geoSafeStore.getResponderDashboardSummary(),
      window.geoSafeStore.getResponderMapData().catch(() => null),
    ]);
    currentAssignments = summary.recentAssignments || [];

    // Dynamically update unit text
    const unitBadgeEl = document.getElementById('dash-unit-badge');
    const mapUnitEl = document.getElementById('dash-map-unit');
    const mapBaseEl = document.getElementById('dash-map-base');

    if (unitBadgeEl && auth.profile) {
      unitBadgeEl.textContent = auth.profile.assignedUnit || auth.profile.department || 'Barangay Bayanan Field Unit';
    }
    if (mapUnitEl && auth.profile) {
      mapUnitEl.textContent = auth.profile.assignedUnit || 'Field Unit';
    }
    if (mapBaseEl && auth.profile) {
      mapBaseEl.textContent = auth.profile.department || 'Barangay Bayanan EOC';
    }

    // Render Stats
    renderStatistics(summary.stats);

    // Render Active Assignments List
    renderActiveAssignments(currentAssignments);

    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');

    // Update mini map markers if initialized
    if (mapData && mapData.eocLocation) {
      updateMiniEocMarker(mapData.eocLocation);
    }
    const assignedKeys = new Set(currentAssignments.map((a) => String(a.referenceNumber || a.id || '')));
    const extraIncidents = ((mapData && mapData.incidents) || []).filter(
      (inc) => !assignedKeys.has(String(inc.referenceNumber || inc.id || ''))
    );
    updateMiniMapMarkers([...currentAssignments, ...extraIncidents]);
  } catch (err) {
    console.error('[ResponderDashboard] Error loading dashboard:', err);
    if (!background && loadingEl) {
      loadingEl.innerHTML = `
        <div class="p-6 text-center text-xs text-[#D93636]">
          <p class="font-bold">Failed to load operational dashboard records.</p>
          <button onclick="loadDashboardData({ background: false })" class="mt-2 px-3 py-1 rounded-md bg-slate-100 text-[#202020] font-bold hover:bg-slate-200">Retry</button>
        </div>
      `;
    }
  } finally {
    dashboardLoadInFlight = false;
    if (dashboardReloadQueued) {
      dashboardReloadQueued = false;
      loadDashboardData({ background: true });
    }
  }
}

function renderStatistics(stats) {
  stats = stats || { active: 0, pending: 0, inProgress: 0, completed: 0 };

  const activeEl = document.getElementById('stat-active');
  const pendingEl = document.getElementById('stat-pending');
  const progressEl = document.getElementById('stat-progress');
  const completedEl = document.getElementById('stat-completed');

  if (activeEl) activeEl.textContent = stats.active || 0;
  if (pendingEl) pendingEl.textContent = stats.pending || 0;
  if (progressEl) progressEl.textContent = stats.inProgress || 0;
  if (completedEl) completedEl.textContent = stats.completed || 0;
}

function renderActiveAssignments(assignments) {
  const container = document.getElementById('assignments-container');
  const emptyEl = document.getElementById('assignments-empty');
  if (!container) return;

  // Filter only active assignments (not completed/resolved)
  const activeList = (assignments || []).filter(a => !['completed', 'resolved'].includes((a.status || '').toLowerCase()));

  if (activeList.length === 0) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');

  container.innerHTML = activeList.map(a => {
    const isRescue = a.assignmentType === 'rescue';

    // Operational status badge styling
    let statusBadge = 'bg-slate-100 text-slate-700 border-slate-200';
    const s = (a.status || '').toLowerCase();
    if (s === 'en route' || s === 'responding') statusBadge = 'bg-blue-50 text-blue-700 border-blue-200';
    else if (s === 'on scene' || s === 'in progress') statusBadge = 'bg-amber-50 text-amber-800 border-amber-200';
    else if (s === 'accepted') statusBadge = 'bg-slate-100 text-slate-800 border-slate-300';
    else if (s === 'completed' || s === 'resolved') statusBadge = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    else if (s === 'pending' || s === 'assigned' || s === 'dispatched') statusBadge = 'bg-red-50 text-red-700 border-red-200';

    return `
      <div class="bg-white rounded-lg p-3.5 sm:p-4 border border-slate-200 shadow-subtle transition-colors hover:border-slate-300 space-y-2.5">
        
        <!-- Header: Ref #, Type, Status -->
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="font-mono gs-tabular text-xs font-bold text-slate-900">${a.referenceNumber || a.id}</span>
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded border uppercase tracking-wide ${isRescue ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-800 border-amber-200'}">
              ${isRescue ? 'Rescue' : 'Incident'}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-[11px] font-semibold px-2 py-0.5 rounded border ${statusBadge}">
              ${a.status || 'Pending'}
            </span>
          </div>
        </div>

        <!-- Body: Category & Location -->
        <div class="space-y-1.5">
          <h4 class="font-semibold text-sm text-slate-900 leading-snug">${a.title || a.category}</h4>
          <p class="text-xs text-slate-600 flex items-center gap-1.5">
            <i data-lucide="map-pin" class="w-3.5 h-3.5 text-slate-400 flex-shrink-0"></i>
            <span class="truncate">${a.location || 'Barangay Bayanan'}</span>
          </p>
          ${isRescue && a.peopleCount ? `
            <div class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200">
              <i data-lucide="users" class="w-3.5 h-3.5 text-red-600"></i>
              <span>${a.peopleCount} ${a.peopleCount > 1 ? 'People Trapped' : 'Person Trapped'}</span>
            </div>
          ` : ''}
          ${a.dispatchInstructions ? `
            <div class="mt-1.5 px-2.5 py-2 bg-slate-50 rounded-md border border-slate-200 text-xs text-slate-600 flex items-start gap-2">
              <i data-lucide="info" class="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5"></i>
              <span class="line-clamp-2 leading-relaxed"><strong class="text-slate-900 font-semibold">Dispatch Note:</strong> ${a.dispatchInstructions}</span>
            </div>
          ` : ''}
        </div>

        <!-- Footer: Assigned Time & Action -->
        <div class="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
          <span class="text-[11px] text-slate-500 gs-tabular">Assigned ${GeoSafeResponderUI.formatRelativeTime(a.assignedAt)}</span>
          <a href="responder-assignments.html?id=${encodeURIComponent(a.id)}" class="gs-btn-primary py-1.5 px-3">
            <span>Manage & Respond</span>
            <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-amber-400"></i>
          </a>
        </div>

      </div>
    `;
  }).join('');

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

const miniGpsMarkerState = { marker: null, accuracyCircle: null };
let miniGpsTracker = null;
let lastMiniRespSyncAt = 0;

function startMiniMapLiveGps() {
  if (!miniPreviewMap || miniGpsTracker || !window.GeoSafeMapping || typeof window.GeoSafeMapping.createLiveGpsTracker !== 'function') {
    return;
  }
  miniGpsTracker = window.GeoSafeMapping.createLiveGpsTracker({
    syncIntervalMs: 10000,
    onLocation: (reading) => {
      window.GeoSafeMapping.renderLiveGpsMarker(miniPreviewMap, miniGpsMarkerState, reading, {
        title: 'Responder Position',
        zIndexOffset: 900
      });
      if (!reading.isStale && window.geoSafeStore && typeof window.geoSafeStore.syncResponderLocation === 'function') {
        const now = Date.now();
        if (now - lastMiniRespSyncAt >= 9000) {
          lastMiniRespSyncAt = now;
          let sharingEnabled = true;
          try { sharingEnabled = localStorage.getItem('geosafe_responder_location_sharing') !== 'false'; } catch (_) {}
          window.geoSafeStore.syncResponderLocation({
            lat: reading.lat,
            lng: reading.lng,
            accuracy: reading.accuracy,
            sharingEnabled
          }).catch(() => {});
        }
      }
    }
  });
  miniGpsTracker.start();
}

function initMiniMapPreview() {
  const container = document.getElementById('dash-map-preview');
  if (!container || typeof L === 'undefined') return;

  try {
    const eoc = GeoSafeMapping.getEocLocation();
    miniPreviewMap = GeoSafeMapping.createMap('dash-map-preview', {
      center: [eoc.latitude, eoc.longitude],
      zoom: 15,
      scrollWheelZoom: false,
      zoomControl: false
    });
    miniMapLayerGroup = L.layerGroup().addTo(miniPreviewMap);
    updateMiniEocMarker(eoc);
    startMiniMapLiveGps();
  } catch (err) {
    console.warn('[ResponderDashboard] Could not initialize mini map preview:', err);
  }
}

function updateMiniEocMarker(eoc) {
  if (!miniPreviewMap || !eoc) return;
  const lat = Number(eoc.latitude);
  const lng = Number(eoc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  if (typeof GeoSafeMapping.setEocLocation === 'function') {
    GeoSafeMapping.setEocLocation(eoc);
  }
  const popupHtml = `
    <div class="text-xs p-1">
      <strong class="block text-[#202020]">${eoc.name || 'GeoSafe Emergency Operations Center (EOC)'}</strong>
      <span class="text-[10px] text-[#555555] block">${eoc.address || 'Bayanan Baywalk Ilaya, Muntinlupa, Metro Manila, Philippines'}</span>
      <span class="text-[10px] font-mono text-[#777777]">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
    </div>
  `;
  if (!miniEocMarker) {
    const eocIcon = GeoSafeMapping.createCustomIcon('eoc', 'EOC');
    miniEocMarker = L.marker([lat, lng], { icon: eocIcon }).addTo(miniPreviewMap).bindPopup(popupHtml);
    miniPreviewMap.setView([lat, lng], 15);
  } else {
    miniEocMarker.setLatLng([lat, lng]).setPopupContent(popupHtml);
  }
}

function updateMiniMapMarkers(assignments) {
  if (!miniPreviewMap) return;
  if (miniMapLayerGroup) {
    miniMapLayerGroup.clearLayers();
  }

  assignments.forEach(a => {
    const st = String(a.status || '').toLowerCase();
    if (['completed', 'resolved', 'cancelled', 'false_alarm', 'dismissed'].includes(st)) return;
    if (a.coordinates && typeof a.coordinates.lat === 'number') {
      const isRescue = a.assignmentType === 'rescue' || String(a.referenceNumber || a.id || '').startsWith('RES-');
      const taskIcon = GeoSafeMapping.createCustomIcon(isRescue ? 'rescue' : 'incident', { compact: true });

      const marker = L.marker([a.coordinates.lat, a.coordinates.lng], { icon: taskIcon }).addTo(miniMapLayerGroup || miniPreviewMap);

      marker.bindPopup(`
        <div class="text-xs p-1">
          <strong class="${isRescue ? 'text-red-700' : 'text-amber-800'}">${a.referenceNumber || a.id}</strong><br>
          <span>${a.title || a.category}</span>
        </div>
      `);
    }
  });
}

