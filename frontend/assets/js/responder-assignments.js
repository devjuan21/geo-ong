/**
 * GeoSafe - Responder Assignments Logic (Sections 4 & 6)
 * ============================================================================
 * Features:
 * - Filter tabs: All, Pending, Accepted, In Progress, Completed
 * - Search by Reference #, Location, or Emergency Category
 * - Assignment Details modal with mini Leaflet map, attachments preview & audit history
 * - Step-by-step Response Status Workflow with Confirmation Modal:
 *     1. Accept Assignment
 *     2. Mark as En Route
 *     3. Mark as On Scene
 *     4. Field Progress Update (work notes + optional photo)
 *     5. Mark as Resolved / Completed
 * ============================================================================
 */

let allAssignments = [];
let currentFilter = 'All';
let currentSearchQuery = '';
let activeAssignmentDetail = null;
let detailMap = null;
let detailMarker = null;
let fieldPhotoBase64 = null;

const navState = {
  active: false,
  pausedByUser: false,
  watchId: null,
  responderMarker: null,
  responderAccuracyCircle: null,
  routePolyline: null,
  routeCoords: [],
  currentGps: null,
  destCoords: null,
  lastRouteOrigin: null,
  lastRouteAttemptAt: 0,
  isRouting: false,
  routeRequestSeq: 0,
  hasFittedInitialBounds: false,
  lastGpsAt: 0,
  staleGpsTimer: null,
  syncIntervalId: null,
  gpsRequestInFlight: false,
};

const arrivalConfig = {
  geofenceRadiusMeters: 50,
  maxGpsAccuracyMeters: 65,
  consecutiveReadingsRequired: 3,
  confirmationWindowMs: 8000,
};

const arrivalState = {
  consecutiveCount: 0,
  firstInsideAt: null,
  inFlight: false,
  triggered: false,
  pendingRetry: false,
  lastAttemptAt: 0,
  lastGps: null,
  lastDistMeters: null,
  recheckTimer: null,
};

function clearArrivalRecheckTimer() {
  if (arrivalState.recheckTimer) {
    clearTimeout(arrivalState.recheckTimer);
    arrivalState.recheckTimer = null;
  }
}

function resetArrivalState() {
  clearArrivalRecheckTimer();
  arrivalState.consecutiveCount = 0;
  arrivalState.firstInsideAt = null;
  arrivalState.inFlight = false;
  arrivalState.triggered = false;
  arrivalState.pendingRetry = false;
  arrivalState.lastAttemptAt = 0;
  arrivalState.lastGps = null;
  arrivalState.lastDistMeters = null;
}

async function loadArrivalConfiguration() {
  try {
    if (window.geoSafeStore && typeof window.geoSafeStore.getArrivalConfig === 'function') {
      const remoteCfg = await window.geoSafeStore.getArrivalConfig();
      if (remoteCfg) {
        Object.assign(arrivalConfig, remoteCfg);
      }
    }
  } catch (_) {
    // Retain central defaults if offline
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize UI Shell
  GeoSafeResponderUI.init('assignments', 'Assignments');

  // Load configurable arrival detection settings and assignments
  await Promise.all([loadArrivalConfiguration(), loadAssignments()]);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Prevent stale background readings from accumulating toward arrival
      arrivalState.consecutiveCount = 0;
      arrivalState.firstInsideAt = null;
    } else if (navState.active) {
      // Returning to foreground: immediately fetch fresh GPS and sync route
      runTenSecondNavigationSync();
    }
  });

  window.addEventListener('online', () => {
    if (arrivalState.pendingRetry && !arrivalState.inFlight && !arrivalState.triggered && arrivalState.lastGps) {
      triggerAutomaticArrivalOnScene(arrivalState.lastGps, arrivalState.lastDistMeters);
    }
    if (navState.active) {
      runTenSecondNavigationSync();
    }
  });

  window.addEventListener('beforeunload', () => {
    stopAssignmentNavigation({ clearRoute: false, userPaused: false });
  });

  // Check URL query parameters for direct assignment opening (e.g. ?id=REP-2026-104)
  const urlParams = new URLSearchParams(window.location.search);
  const targetId = urlParams.get('id');
  if (targetId) {
    setTimeout(() => openAssignmentDetails(targetId), 250);
  }

  window.addEventListener('geosafe:realtime-update', (ev) => {
    loadAssignments();
    if (navState.active && ev && ev.detail && ev.detail.event === 'reconnect-sync') {
      runTenSecondNavigationSync();
    }
  });
});

async function loadAssignments() {
  const loadingEl = document.getElementById('assign-loading');
  const container = document.getElementById('assign-list-container');
  const emptyEl = document.getElementById('assign-empty-state');

  // Verify responder authentication and role
  const auth = await GeoSafeResponderUI.verifyResponderSession();
  if (!auth.authorized) {
    if (loadingEl) loadingEl.classList.add('hidden');
    const mainEl = document.querySelector('main');
    GeoSafeResponderUI.renderUnauthorizedScreen(mainEl);
    return;
  }

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (container) container.classList.add('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');

  try {
    allAssignments = await window.geoSafeStore.getResponderAssignments({ status: 'All' });
    if (loadingEl) loadingEl.classList.add('hidden');
    renderFilteredAssignments();
  } catch (err) {
    console.error('[ResponderAssignments] Error loading assignments:', err);
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="p-6 text-center text-xs text-[#D93636]">
          <p class="font-bold">Failed to load responder assignments.</p>
          <button onclick="loadAssignments()" class="mt-2 px-3 py-1 rounded-xl bg-slate-100 text-[#202020] font-bold">Retry</button>
        </div>
      `;
    }
  }
}

window.filterAssignments = function (status) {
  currentFilter = status;

  // Update tab buttons styling
  const tabs = ['All', 'Pending', 'Accepted', 'In Progress', 'Completed'];
  tabs.forEach(tab => {
    const btn = document.getElementById(`tab-assign-${tab.toLowerCase().replace(/\s+/g, '-')}`);
    if (btn) {
      if (tab.toLowerCase() === status.toLowerCase()) {
        btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-[#F5B900] text-[#202020] shadow-subtle';
      } else {
        btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all bg-white border border-[#EEEEEE] text-[#777777] hover:text-[#202020] hover:bg-[#FFF9E8]';
      }
    }
  });

  renderFilteredAssignments();
};

window.handleSearch = function (e) {
  currentSearchQuery = (e.target.value || '').toLowerCase().trim();
  renderFilteredAssignments();
};

function renderFilteredAssignments() {
  const container = document.getElementById('assign-list-container');
  const emptyEl = document.getElementById('assign-empty-state');
  const emptyText = document.getElementById('assign-empty-text');
  if (!container) return;

  let filtered = [...allAssignments];

  // Apply tab status filter
  if (currentFilter !== 'All') {
    const targetStatus = currentFilter.toLowerCase();
    filtered = filtered.filter(a => {
      const s = (a.status || '').toLowerCase();
      if (targetStatus === 'in progress') {
        return ['accepted', 'en route', 'on scene', 'responding'].includes(s);
      }
      if (targetStatus === 'completed') {
        return ['completed', 'resolved'].includes(s);
      }
      if (targetStatus === 'pending') {
        return ['pending', 'pending dispatch'].includes(s);
      }
      return s === targetStatus;
    });
  }

  // Apply search query
  if (currentSearchQuery) {
    filtered = filtered.filter(a =>
      (a.referenceNumber || a.id || '').toLowerCase().includes(currentSearchQuery) ||
      (a.title || '').toLowerCase().includes(currentSearchQuery) ||
      (a.category || '').toLowerCase().includes(currentSearchQuery) ||
      (a.location || '').toLowerCase().includes(currentSearchQuery)
    );
  }

  if (filtered.length === 0) {
    container.classList.add('hidden');
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (emptyText) {
      if (allAssignments.length === 0) {
        emptyText.textContent = 'No active assignments.';
      } else {
        emptyText.textContent = `No ${currentFilter} assignments found.`;
      }
    }
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  container.classList.remove('hidden');

  container.innerHTML = filtered.map(a => {
    const isRescue = a.assignmentType === 'rescue';

    let statusBadge = 'bg-slate-100 text-slate-700 border-slate-200';
    const s = (a.status || '').toLowerCase();
    if (s === 'en route' || s === 'responding') statusBadge = 'bg-blue-50 text-[#3478C7] border-blue-200 font-bold';
    else if (s === 'on scene') statusBadge = 'bg-amber-50 text-[#E99524] border-amber-200 font-bold';
    else if (s === 'accepted') statusBadge = 'bg-purple-50 text-purple-700 border-purple-200';
    else if (s === 'completed' || s === 'resolved') statusBadge = 'bg-emerald-50 text-[#278653] border-emerald-200';

    return `
      <div onclick="openAssignmentDetails('${a.id}')" class="bg-white rounded-3xl p-4 sm:p-5 border border-[#EEEEEE] shadow-card transition-all hover:border-[#F5B900] cursor-pointer space-y-3">
        
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs sm:text-sm font-black text-[#202020]">${a.referenceNumber || a.id}</span>
            <span class="text-[9px] font-black px-2 py-0.5 rounded-full uppercase border ${isRescue ? 'bg-[#FFF1F1] text-[#D93636] border-[#FFC2C2]' : 'bg-[#FFF9E8] text-[#8A6800] border-[#FFE872]'}">
              ${isRescue ? 'Rescue Request' : 'Incident Report'}
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <span class="text-[10px] px-2 py-0.5 rounded-full border ${statusBadge}">
              ${a.status || 'Pending'}
            </span>
          </div>
        </div>

        <div>
          <h4 class="font-bold text-sm sm:text-base text-[#202020]">${a.title || a.category}</h4>
          <p class="text-xs text-[#777777] mt-1 flex items-center gap-1">
            <svg class="w-3.5 h-3.5 text-[#F5B900] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path></svg>
            <span class="truncate">${a.location || 'Barangay Bayanan'}</span>
          </p>
          ${isRescue && a.peopleCount ? `
            <div class="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-[#D93636] bg-[#FFF1F1] px-2 py-0.5 rounded-lg border border-[#FFC2C2]">
              <svg class="w-3 h-3 text-[#D93636]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
              <span>${a.peopleCount} ${a.peopleCount > 1 ? 'People Trapped' : 'Person Trapped'}</span>
            </div>
          ` : ''}
          ${a.dispatchInstructions ? `
            <div class="mt-2.5 p-2.5 bg-[#FFFDF7] rounded-xl border border-[#EEEEEE] text-[11px] text-[#777777] flex items-start gap-2">
              <svg class="w-3.5 h-3.5 text-[#F5B900] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              <span class="line-clamp-2 leading-relaxed"><strong class="text-[#202020] font-semibold">Dispatch Note:</strong> ${a.dispatchInstructions}</span>
            </div>
          ` : ''}
        </div>

        <div class="pt-2.5 border-t border-[#EEEEEE] flex items-center justify-between text-xs text-[#777777]">
          <span class="text-[10px]">Date: ${new Date(a.assignedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span class="font-bold text-[#8A6800] text-xs flex items-center gap-1">
            <span>Manage Assignment</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
          </span>
        </div>

      </div>
    `;
  }).join('');
}

/**
 * Open Assignment Details Modal (Section 4)
 */
window.openAssignmentDetails = async function (id) {
  try {
    const assignment = await window.geoSafeStore.getResponderAssignmentById(id);
    activeAssignmentDetail = assignment;

    const modal = document.getElementById('assign-details-modal');
    if (!modal) return;

    // Populate Fields
    document.getElementById('dtl-ref').textContent = assignment.referenceNumber || assignment.id;
    document.getElementById('dtl-type-badge').textContent = assignment.assignmentType === 'rescue' ? 'Rescue Request' : 'Incident Report';
    if (document.getElementById('dtl-prio-badge')) document.getElementById('dtl-prio-badge').textContent = '';
    document.getElementById('dtl-status-badge').textContent = assignment.status || 'Pending';
    document.getElementById('dtl-title').textContent = assignment.title || assignment.category;
    document.getElementById('dtl-desc').textContent = assignment.description || 'No detailed description submitted.';
    document.getElementById('dtl-location').textContent = assignment.location || 'Barangay Bayanan';
    document.getElementById('dtl-instructions').textContent = assignment.dispatchInstructions || 'Proceed to coordinates with caution.';

    // Rescue Specific Fields
    const rescueFields = document.getElementById('dtl-rescue-fields');
    if (rescueFields) {
      if (assignment.assignmentType === 'rescue') {
        rescueFields.classList.remove('hidden');
        document.getElementById('dtl-people-count').textContent = `${assignment.peopleCount || 1} Person(s)`;
        document.getElementById('dtl-vulnerable').textContent = assignment.vulnerableDetails || 'None specified';
      } else {
        rescueFields.classList.add('hidden');
      }
    }

    // Photos Preview
    const photoContainer = document.getElementById('dtl-photos-container');
    const photoList = document.getElementById('dtl-photos-list');
    if (photoContainer && photoList) {
      if (assignment.photos && assignment.photos.length > 0) {
        photoContainer.classList.remove('hidden');
        photoList.innerHTML = assignment.photos.map(p => `
          <img src="${p}" alt="Attachment" class="w-20 h-20 rounded-xl object-cover border border-[#EEEEEE] shadow-subtle cursor-pointer hover:opacity-90" onclick="window.open('${p}', '_blank')">
        `).join('');
      } else {
        photoContainer.classList.add('hidden');
        photoList.innerHTML = '';
      }
    }

    // Timeline / Audit History
    const timelineList = document.getElementById('dtl-timeline-list');
    if (timelineList) {
      const history = assignment.timeline || [];
      if (history.length === 0) {
        timelineList.innerHTML = `<li class="text-[11px] text-[#777777] italic">No updates logged yet.</li>`;
      } else {
        timelineList.innerHTML = history.map(item => `
          <li class="relative pl-5 pb-3 border-l border-[#FFE872] last:border-none last:pb-0">
            <span class="absolute -left-1.5 top-0.5 w-3 h-3 rounded-full bg-[#F5B900] ring-4 ring-white"></span>
            <div class="text-[10px] text-[#777777]">${new Date(item.time).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })} • ${GeoSafeResponderUI.formatRelativeTime(item.time)}</div>
            <div class="text-xs font-bold text-[#202020] mt-0.5">${item.status || item.text || 'Update'}</div>
            ${item.note ? `<p class="text-[11px] text-[#555555] mt-0.5">${item.note}</p>` : ''}
            ${item.photo ? `<img src="${item.photo}" class="w-16 h-16 rounded-lg object-cover border border-slate-200 mt-1">` : ''}
          </li>
        `).join('');
      }
    }

    // Dynamic Action Buttons
    renderActionButtons(assignment.status);

    modal.classList.remove('hidden');

    // Initialize or re-center detail Leaflet Map & automatic navigation for Accepted / En Route
    setTimeout(() => {
      initDetailMap(assignment);
    }, 150);

  } catch (err) {
    GeoSafeResponderUI.showToast(err.message || 'Could not open assignment details.', 'error');
  }
};

window.closeAssignmentDetails = function () {
  stopAssignmentNavigation({ clearRoute: true });
  document.getElementById('assign-details-modal')?.classList.add('hidden');
  activeAssignmentDetail = null;
};

function renderActionButtons(currentStatus) {
  const container = document.getElementById('dtl-actions-container');
  if (!container) return;

  const s = (currentStatus || '').toLowerCase();

  let buttonsHtml = '';

  if (s === 'pending' || s === 'pending dispatch' || s === 'assigned') {
    buttonsHtml = `
      <button type="button" onclick="confirmStatusChange('Accepted')" class="flex-1 py-2.5 px-4 rounded-2xl bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] font-black text-xs shadow-subtle transition-all flex items-center justify-center gap-1.5">
        <svg class="w-4 h-4 text-[#202020]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
        <span>Accept Assignment</span>
      </button>
    `;
  } else if (s === 'accepted') {
    buttonsHtml = `
      <div class="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <button type="button" onclick="confirmStatusChange('En Route')" class="flex-1 py-2.5 px-4 rounded-2xl bg-[#3478C7] hover:bg-[#2764AB] text-white font-black text-xs shadow-subtle transition-all flex items-center justify-center gap-1.5">
          <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1" stroke-width="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 8" stroke-width="2"></polygon><circle cx="5.5" cy="18.5" r="2.5" stroke-width="2"></circle><circle cx="18.5" cy="18.5" r="2.5" stroke-width="2"></circle></svg>
          <span>Mark as En Route</span>
        </button>
        <span class="px-3 py-2 rounded-2xl bg-[#FFF9E8] border border-[#FFE872] text-[11px] font-bold text-[#8A6800] text-center">
          Auto On Scene on GPS Arrival
        </span>
      </div>
    `;
  } else if (s === 'en route' || s === 'responding') {
    buttonsHtml = `
      <div class="w-full py-2.5 px-4 rounded-2xl bg-blue-50 border border-blue-200 text-[#3478C7] text-center text-xs font-bold">
        Automatic Arrival Detection Active — Status updates to On Scene upon arrival at the location
      </div>
    `;
  } else if (s === 'on scene') {
    buttonsHtml = `
      <button type="button" onclick="openProgressUpdateModal()" class="py-2.5 px-3 rounded-2xl bg-[#FFF9E8] border border-[#FFE872] text-[#8A6800] hover:bg-[#FFF3D0] font-bold text-xs transition-all">
        Update Progress
      </button>
      <button type="button" onclick="confirmStatusChange('Completed')" class="flex-1 py-2.5 px-4 rounded-2xl bg-[#278653] hover:bg-[#1E6E43] text-white font-black text-xs shadow-subtle transition-all flex items-center justify-center gap-1.5">
        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        <span>Mark Operation Completed</span>
      </button>
    `;
  } else if (s === 'completed' || s === 'resolved') {
    buttonsHtml = `
      <div class="w-full py-2 px-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#278653] text-center text-xs font-bold">
        Operation Marked Completed (Preserved for EOC & Resident Verification)
      </div>
    `;
  }

  container.innerHTML = buttonsHtml;
}

function parseValidCoords(coords) {
  if (!coords) return null;
  const lat = Number(coords.lat);
  const lng = Number(coords.lng);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return null;
  }
  return { lat, lng };
}

function isNavigableStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'accepted' || s === 'en route' || s === 'responding';
}

function initDetailMap(assignment) {
  const container = document.getElementById('dtl-map');
  const missingOverlay = document.getElementById('dtl-map-missing');
  const controlsEl = document.getElementById('dtl-map-controls');
  const navPanel = document.getElementById('dtl-nav-panel');
  if (!container || typeof L === 'undefined') return;

  stopAssignmentNavigation({ clearRoute: true });

  const destCoords = parseValidCoords(assignment && assignment.coordinates);
  const statusStr = assignment ? assignment.status : '';
  const shouldNavigate = isNavigableStatus(statusStr);

  if (!destCoords) {
    if (missingOverlay) missingOverlay.classList.remove('hidden');
    if (controlsEl) controlsEl.classList.add('hidden');
    if (shouldNavigate && navPanel) {
      navPanel.classList.remove('hidden');
      showNavigationError('Destination coordinates are missing or invalid for this assignment. Navigation cannot be started.', false);
    } else if (navPanel) {
      navPanel.classList.add('hidden');
    }
    return;
  }

  if (missingOverlay) missingOverlay.classList.add('hidden');
  navState.destCoords = destCoords;

  const targetCoords = [destCoords.lat, destCoords.lng];
  const destLabel = (assignment && (assignment.location || assignment.referenceNumber)) || 'Assigned Location';

  const isRescueTarget =
    (assignment && (assignment.assignmentType === 'rescue' || assignment.recordType === 'rescue')) ||
    String((assignment && (assignment.referenceNumber || assignment.id)) || '').startsWith('RES-');
  const targetIcon = GeoSafeMapping.createCustomIcon(isRescueTarget ? 'rescue' : 'incident');

  if (!detailMap) {
    try {
      detailMap = GeoSafeMapping.createMap('dtl-map', {
        center: targetCoords,
        zoom: 16,
        scrollWheelZoom: true,
        zoomControl: true,
      });
      detailMarker = L.marker(targetCoords, { icon: targetIcon }).addTo(detailMap);
    } catch (e) {
      console.warn('Map initialization failed:', e);
      return;
    }
  } else {
    detailMap.invalidateSize();
    detailMap.setView(targetCoords, 16);
    if (detailMarker) {
      detailMarker.setLatLng(targetCoords);
      detailMarker.setIcon(targetIcon);
    } else {
      detailMarker = L.marker(targetCoords, { icon: targetIcon }).addTo(detailMap);
    }
  }

  if (detailMarker) {
    detailMarker.bindPopup(`<strong>Assigned Destination</strong><br><span style="font-size:11px;">${escapeHtmlNav(destLabel)}</span>`);
  }

  const arrivedBanner = document.getElementById('dtl-nav-arrived-banner');
  const toggleBtn = document.getElementById('dtl-nav-toggle-btn');
  const statusLower = String(statusStr || '').toLowerCase();
  const isArrived = statusLower === 'on scene' || statusLower === 'on site';

  if (shouldNavigate) {
    arrivedBanner?.classList.add('hidden');
    toggleBtn?.classList.remove('hidden');
    if (controlsEl) controlsEl.classList.remove('hidden');
    if (navPanel) navPanel.classList.remove('hidden');
    const destLabelEl = document.getElementById('dtl-nav-dest-label');
    if (destLabelEl) destLabelEl.textContent = destLabel;
    startAssignmentNavigation(assignment);
  } else if (isArrived) {
    if (controlsEl) controlsEl.classList.add('hidden');
    if (navPanel) navPanel.classList.remove('hidden');
    arrivedBanner?.classList.remove('hidden');
    toggleBtn?.classList.add('hidden');
    updateNavStatusUI('Arrived at Scene', false);
  } else {
    arrivedBanner?.classList.add('hidden');
    if (controlsEl) controlsEl.classList.add('hidden');
    if (navPanel) navPanel.classList.add('hidden');
  }
}

function escapeHtmlNav(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showNavigationError(message, allowRetry = true) {
  const errEl = document.getElementById('dtl-nav-error');
  const errText = document.getElementById('dtl-nav-error-text');
  const retryBtn = document.getElementById('dtl-nav-retry-btn');
  if (errText) errText.textContent = message;
  if (retryBtn) retryBtn.classList.toggle('hidden', !allowRetry);
  if (errEl) errEl.classList.remove('hidden');
}

function hideNavigationError() {
  document.getElementById('dtl-nav-error')?.classList.add('hidden');
}

function updateNavStatusUI(pillText, isPaused = false) {
  const pill = document.getElementById('dtl-nav-status-pill');
  const toggleBtn = document.getElementById('dtl-nav-toggle-btn');
  if (pill) {
    pill.textContent = pillText;
    pill.className = isPaused
      ? 'px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-[#F7F7F7] text-[#555555] border border-[#EEEEEE]'
      : 'px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-50 text-[#3478C7] border border-blue-200';
  }
  if (toggleBtn) {
    toggleBtn.textContent = isPaused ? 'Start Navigation' : 'Stop Navigation';
  }
}

function clearRouteDisplay() {
  if (detailMap && navState.routePolyline) {
    try {
      detailMap.removeLayer(navState.routePolyline);
    } catch (_) {}
  }
  navState.routePolyline = null;
  navState.routeCoords = [];
  document.getElementById('dtl-nav-metrics')?.classList.add('hidden');
  document.getElementById('dtl-nav-next-step')?.classList.add('hidden');
  document.getElementById('dtl-nav-steps-wrap')?.classList.add('hidden');
}

function clearResponderMarker() {
  if (detailMap && navState.responderMarker) {
    try {
      detailMap.removeLayer(navState.responderMarker);
    } catch (_) {}
  }
  if (detailMap && navState.responderAccuracyCircle) {
    try {
      detailMap.removeLayer(navState.responderAccuracyCircle);
    } catch (_) {}
  }
  navState.responderMarker = null;
  navState.responderAccuracyCircle = null;
}

function clearStaleGpsWatchdog() {
  if (navState.staleGpsTimer) {
    clearTimeout(navState.staleGpsTimer);
    navState.staleGpsTimer = null;
  }
}

function resetStaleGpsWatchdog() {
  clearStaleGpsWatchdog();
  if (!navState.active) return;

  navState.staleGpsTimer = setTimeout(() => {
    if (!navState.active) return;
    const lastTime = navState.lastGpsAt
      ? new Date(navState.lastGpsAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : 'never';
    const accEl = document.getElementById('dtl-nav-gps-accuracy');
    if (accEl) {
      accEl.textContent = navState.lastGpsAt ? `GPS signal lost (last update ${lastTime})` : 'Waiting for GPS signal...';
    }
    updateNavStatusUI('GPS Signal Lost', false);
    showNavigationError(
      navState.lastGpsAt
        ? `GPS signal lost — last update at ${lastTime}. Waiting for live coordinates...`
        : 'Waiting for initial GPS signal from device...',
      true
    );
  }, 25000);
}

function stopAssignmentNavigation({ clearRoute = true, userPaused = false } = {}) {
  clearStaleGpsWatchdog();
  if (navState.syncIntervalId !== null) {
    clearInterval(navState.syncIntervalId);
    navState.syncIntervalId = null;
  }
  if (navState.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      navigator.geolocation.clearWatch(navState.watchId);
    } catch (_) {}
  }
  navState.watchId = null;
  navState.active = false;
  navState.pausedByUser = Boolean(userPaused);
  navState.isRouting = false;
  navState.gpsRequestInFlight = false;
  navState.routeRequestSeq += 1;
  navState.hasFittedInitialBounds = false;
  navState.lastRouteOrigin = null;
  navState.lastGpsAt = 0;
  resetArrivalState();

  if (clearRoute) {
    clearRouteDisplay();
    clearResponderMarker();
    navState.currentGps = null;
    hideNavigationError();
    const accEl = document.getElementById('dtl-nav-gps-accuracy');
    if (accEl) accEl.textContent = '';
  }

  if (userPaused) {
    updateNavStatusUI('Navigation Paused', true);
  }
}

function updateResponderGpsMarker(gps) {
  if (!detailMap || typeof L === 'undefined') return;
  const latLng = [gps.lat, gps.lng];

  const hasLayer = typeof detailMap.hasLayer === 'function';
  if (!navState.responderMarker || (hasLayer && !detailMap.hasLayer(navState.responderMarker))) {
    const userIcon = GeoSafeMapping.createCustomIcon('user');
    navState.responderMarker = L.marker(latLng, { icon: userIcon, zIndexOffset: 500 })
      .addTo(detailMap)
      .bindPopup('<strong>Your Current Location</strong>');
  } else {
    navState.responderMarker.setLatLng(latLng);
  }

  if (Number.isFinite(gps.accuracy) && gps.accuracy > 0) {
    if (!navState.responderAccuracyCircle || (hasLayer && !detailMap.hasLayer(navState.responderAccuracyCircle))) {
      navState.responderAccuracyCircle = L.circle(latLng, {
        radius: Math.min(gps.accuracy, 500),
        color: '#3478C7',
        weight: 1,
        fillColor: '#3478C7',
        fillOpacity: 0.12,
      }).addTo(detailMap);
    } else {
      navState.responderAccuracyCircle.setLatLng(latLng);
      navState.responderAccuracyCircle.setRadius(Math.min(gps.accuracy, 500));
    }
  }
}

function formatRouteDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '-';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function formatRouteEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  const mins = Math.max(1, Math.ceil(seconds / 60));
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs} hr ${rem} min` : `${hrs} hr`;
  }
  return `${mins} min`;
}

function renderCalculatedRoute(route) {
  if (!detailMap || !route || !Array.isArray(route.coordinates) || route.coordinates.length < 2) return;

  if (navState.routePolyline) {
    try {
      detailMap.removeLayer(navState.routePolyline);
    } catch (_) {}
  }

  navState.routeCoords = route.coordinates;
  navState.routePolyline = L.polyline(route.coordinates, {
    color: '#2563EB',
    weight: 5,
    opacity: 0.9,
    lineJoin: 'round',
    lineCap: 'round',
  }).addTo(detailMap);

  if (!navState.hasFittedInitialBounds) {
    const bounds = navState.routePolyline.getBounds();
    if (navState.currentGps) bounds.extend([navState.currentGps.lat, navState.currentGps.lng]);
    if (navState.destCoords) bounds.extend([navState.destCoords.lat, navState.destCoords.lng]);
    detailMap.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
    navState.hasFittedInitialBounds = true;
  }

  const distEl = document.getElementById('dtl-nav-distance');
  const etaEl = document.getElementById('dtl-nav-eta');
  if (distEl) distEl.textContent = formatRouteDistance(route.distanceMeters);
  if (etaEl) etaEl.textContent = formatRouteEta(route.durationSeconds);
  document.getElementById('dtl-nav-metrics')?.classList.remove('hidden');

  const steps = Array.isArray(route.steps) ? route.steps : [];
  const nextStepBanner = document.getElementById('dtl-nav-next-step');
  const nextInstEl = document.getElementById('dtl-nav-next-instruction');
  const nextDistEl = document.getElementById('dtl-nav-next-dist');
  const stepsWrap = document.getElementById('dtl-nav-steps-wrap');
  const stepsList = document.getElementById('dtl-nav-steps-list');
  const stepsCount = document.getElementById('dtl-nav-steps-count');

  if (steps.length > 0) {
    // Pick the first actionable step (or step 1 if step 0 is depart and step 1 exists)
    const nextStep = steps.length > 1 && steps[0].distanceMeters < 15 ? steps[1] : steps[0];
    if (nextStepBanner && nextInstEl && nextDistEl) {
      nextInstEl.textContent = nextStep.instruction || 'Proceed along route';
      nextDistEl.textContent = formatRouteDistance(nextStep.distanceMeters);
      nextStepBanner.classList.remove('hidden');
    }

    if (stepsWrap && stepsList) {
      if (stepsCount) stepsCount.textContent = `${steps.length} steps`;
      stepsList.innerHTML = steps
        .map(
          (st, idx) => `
            <li class="flex items-start justify-between gap-2 bg-white rounded-lg border border-[#EEEEEE] px-2.5 py-1.5">
              <span class="font-medium text-[#202020]"><span class="font-black text-[#8A6800] mr-1">${idx + 1}.</span>${escapeHtmlNav(st.instruction)}</span>
              <span class="text-[10px] font-bold text-[#777777] shrink-0">${formatRouteDistance(st.distanceMeters)}</span>
            </li>
          `
        )
        .join('');
      stepsWrap.classList.remove('hidden');
    }
  } else {
    nextStepBanner?.classList.add('hidden');
    stepsWrap?.classList.add('hidden');
  }
}

async function calculateAndDisplayRoute(originGps) {
  if (!navState.active || !navState.destCoords || !originGps || navState.isRouting) return;

  const hadValidRoute = Array.isArray(navState.routeCoords) && navState.routeCoords.length >= 2;
  const reqSeq = ++navState.routeRequestSeq;
  navState.isRouting = true;
  navState.lastRouteAttemptAt = Date.now();
  navState.lastRouteOrigin = { lat: originGps.lat, lng: originGps.lng };
  updateNavStatusUI(hadValidRoute ? 'Updating Route...' : 'Calculating Route...', false);

  try {
    const route = await GeoSafeMapping.calculateDrivingRoute(originGps, navState.destCoords);
    if (!navState.active || reqSeq !== navState.routeRequestSeq) return;
    hideNavigationError();
    renderCalculatedRoute(route);
    updateNavStatusUI('Navigation Active', false);
  } catch (err) {
    if (!navState.active || reqSeq !== navState.routeRequestSeq) return;
    if (hadValidRoute) {
      // Preserve last valid route during temporary routing hiccups
      updateNavStatusUI('Route Update Delayed', false);
      showNavigationError('Temporary routing delay — retaining last valid road route.', true);
    } else {
      clearRouteDisplay();
      updateNavStatusUI('Route Unavailable', false);
      showNavigationError(err.message || 'Unable to calculate a road route right now.', true);
    }
  } finally {
    if (reqSeq === navState.routeRequestSeq) {
      navState.isRouting = false;
    }
  }
}

function handleGpsSuccess(position, isCycleSync = false) {
  if (!navState.active || !position || !position.coords) return;

  const lat = Number(position.coords.latitude);
  const lng = Number(position.coords.longitude);
  const accuracy = Number(position.coords.accuracy);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    showNavigationError('Received invalid GPS coordinates from device.', true);
    return;
  }

  const now = Date.now();
  navState.lastGpsAt = now;
  resetStaleGpsWatchdog();

  const accEl = document.getElementById('dtl-nav-gps-accuracy');
  if (accEl && Number.isFinite(accuracy)) {
    const timeStr = new Date(now).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    accEl.textContent = `GPS accuracy: ±${Math.round(accuracy)}m • Updated ${timeStr}`;
  }

  // Reject severely inaccurate fixes (> 1000m) to avoid misleading routing
  if (Number.isFinite(accuracy) && accuracy > 1000) {
    showNavigationError(`GPS accuracy is currently insufficient (±${Math.round(accuracy)}m). Move to an open area and retry.`, true);
    return;
  }

  hideNavigationError();
  const gps = { lat, lng, accuracy };
  navState.currentGps = gps;
  updateResponderGpsMarker(gps);

  const hasRoute = navState.routeCoords && navState.routeCoords.length >= 2;
  const offRouteMeters = hasRoute ? GeoSafeMapping.pointToRouteDistanceMeters(gps, navState.routeCoords) : Infinity;
  const movedFromLastOrigin = navState.lastRouteOrigin
    ? GeoSafeMapping.computeDistanceMeters(gps, navState.lastRouteOrigin)
    : Infinity;

  // Ignore poor-accuracy fluctuations for automatic rerouting; synchronize every 10s cycle when moved >= 5m or off-route
  const accuracyOkForRoute = !Number.isFinite(accuracy) || accuracy <= Math.max(arrivalConfig.maxGpsAccuracyMeters, 100);
  const cooldownElapsed = now - navState.lastRouteAttemptAt >= 9500;
  if (!hasRoute && (navState.lastRouteAttemptAt === 0 || cooldownElapsed)) {
    calculateAndDisplayRoute(gps);
  } else if (isCycleSync && hasRoute && accuracyOkForRoute && (movedFromLastOrigin >= 5 || offRouteMeters > 45)) {
    calculateAndDisplayRoute(gps);
  } else if (hasRoute && accuracyOkForRoute && (offRouteMeters > 45 || movedFromLastOrigin > 35) && cooldownElapsed) {
    calculateAndDisplayRoute(gps);
  } else if (isCycleSync && hasRoute && arrivalState.consecutiveCount === 0) {
    updateNavStatusUI('Navigation Active', false);
  }

  // Evaluate automatic GPS-based arrival detection (never triggered by route completion alone)
  evaluateArrivalProximity(gps);
}

function scheduleArrivalRecheck() {
  clearArrivalRecheckTimer();
  if (!navState.active || arrivalState.triggered || arrivalState.inFlight) return;
  if (typeof navigator === 'undefined' || !navigator.geolocation) return;

  const intervalMs = Math.max(
    2000,
    Math.ceil(arrivalConfig.confirmationWindowMs / Math.max(1, arrivalConfig.consecutiveReadingsRequired))
  );

  arrivalState.recheckTimer = setTimeout(() => {
    arrivalState.recheckTimer = null;
    if (!navState.active || arrivalState.triggered || arrivalState.inFlight) return;
    navigator.geolocation.getCurrentPosition(handleGpsSuccess, handleGpsError, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 0,
    });
  }, intervalMs);
}

function evaluateArrivalProximity(gps) {
  if (
    !navState.active ||
    !navState.destCoords ||
    !activeAssignmentDetail ||
    !isNavigableStatus(activeAssignmentDetail.status) ||
    arrivalState.triggered ||
    arrivalState.inFlight
  ) {
    return;
  }

  if (typeof document !== 'undefined' && document.hidden) {
    clearArrivalRecheckTimer();
    arrivalState.consecutiveCount = 0;
    arrivalState.firstInsideAt = null;
    return;
  }

  // Do not evaluate arrival when GPS accuracy is insufficient
  if (!Number.isFinite(gps.accuracy) || gps.accuracy <= 0 || gps.accuracy > arrivalConfig.maxGpsAccuracyMeters) {
    clearArrivalRecheckTimer();
    arrivalState.consecutiveCount = 0;
    arrivalState.firstInsideAt = null;
    return;
  }

  const distMeters = GeoSafeMapping.computeDistanceMeters(gps, navState.destCoords);
  if (!Number.isFinite(distMeters)) {
    clearArrivalRecheckTimer();
    arrivalState.consecutiveCount = 0;
    arrivalState.firstInsideAt = null;
    return;
  }

  if (distMeters <= arrivalConfig.geofenceRadiusMeters) {
    const now = Date.now();
    arrivalState.consecutiveCount += 1;
    if (!arrivalState.firstInsideAt) {
      arrivalState.firstInsideAt = now;
    }
    arrivalState.lastGps = gps;
    arrivalState.lastDistMeters = distMeters;

    const elapsedMs = now - arrivalState.firstInsideAt;
    updateNavStatusUI(
      `Confirming Arrival (${Math.round(distMeters)}m • ${arrivalState.consecutiveCount}/${arrivalConfig.consecutiveReadingsRequired})`,
      false
    );

    const retryCooldownOk = now - arrivalState.lastAttemptAt >= 5000;
    if (
      arrivalState.consecutiveCount >= arrivalConfig.consecutiveReadingsRequired &&
      elapsedMs >= arrivalConfig.confirmationWindowMs &&
      retryCooldownOk
    ) {
      clearArrivalRecheckTimer();
      triggerAutomaticArrivalOnScene(gps, distMeters);
    } else {
      // Schedule fresh GPS check so stationary responders already at the scene confirm without moving
      scheduleArrivalRecheck();
    }
  } else {
    // Responder left the arrival boundary before confirmation: reset consecutive readings
    clearArrivalRecheckTimer();
    if (arrivalState.consecutiveCount > 0) {
      arrivalState.consecutiveCount = 0;
      arrivalState.firstInsideAt = null;
      updateNavStatusUI('Navigation Active', false);
    }
  }
}

async function triggerAutomaticArrivalOnScene(gps, distMeters) {
  if (!activeAssignmentDetail || arrivalState.inFlight || arrivalState.triggered) return;
  if (!isNavigableStatus(activeAssignmentDetail.status)) return;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    arrivalState.pendingRetry = true;
    showNavigationError('Network disconnected while confirming arrival. Will retry automatically when online.', true);
    return;
  }

  arrivalState.inFlight = true;
  arrivalState.lastAttemptAt = Date.now();
  arrivalState.lastGps = gps;
  arrivalState.lastDistMeters = distMeters;
  const assignmentId = activeAssignmentDetail.id;

  try {
    const note = `Responder arrived at scene via GPS proximity (${Math.round(distMeters || 0)}m from destination, ±${Math.round(gps.accuracy || 0)}m accuracy).`;
    const resp = await window.geoSafeStore.updateAssignmentStatus(
      assignmentId,
      'On Scene',
      note,
      null,
      false,
      {
        autoArrival: true,
        arrivalGps: {
          lat: gps.lat,
          lng: gps.lng,
          accuracy: gps.accuracy,
        },
      }
    );

    arrivalState.triggered = true;
    arrivalState.pendingRetry = false;

    // Stop active navigation GPS tracking and clear active route/distance display once arrival is confirmed
    stopAssignmentNavigation({ clearRoute: true, userPaused: false });
    document.getElementById('dtl-nav-arrived-banner')?.classList.remove('hidden');
    document.getElementById('dtl-nav-toggle-btn')?.classList.add('hidden');
    updateNavStatusUI('Arrived at Scene', false);

    if (!resp || !resp.alreadyOnScene) {
      GeoSafeResponderUI.showToast(
        'You have arrived at the assigned location. Status updated to On Scene.',
        'success'
      );
    }

    await loadAssignments();
    if (activeAssignmentDetail && activeAssignmentDetail.id === assignmentId) {
      await openAssignmentDetails(assignmentId);
    }
  } catch (err) {
    arrivalState.pendingRetry = true;
    arrivalState.triggered = false;
    showNavigationError(
      err.message || 'Failed to confirm arrival with server. Retaining current status; will retry safely.',
      true
    );
  } finally {
    arrivalState.inFlight = false;
  }
}

function handleGpsError(err) {
  if (!navState.active) return;
  let msg = 'Unable to retrieve your current GPS location.';
  if (err) {
    if (err.code === 1) {
      msg = window.isSecureContext === false
        ? 'Browser blocked GPS because this page is not running in a secure HTTPS context.'
        : 'GPS location permission was denied. Please enable location access in your browser and retry.';
    } else if (err.code === 2) {
      msg = 'GPS position is currently unavailable. Check device location services and retry.';
    } else if (err.code === 3) {
      msg = 'GPS location request timed out. Please retry.';
    }
  }
  updateNavStatusUI('GPS Unavailable', false);
  showNavigationError(msg, true);
}

function runTenSecondNavigationSync() {
  if (!navState.active || !activeAssignmentDetail || !isNavigableStatus(activeAssignmentDetail.status)) return;
  if (typeof navigator === 'undefined' || !navigator.geolocation) return;
  if (navState.gpsRequestInFlight) return;

  navState.gpsRequestInFlight = true;
  if (arrivalState.consecutiveCount === 0) {
    updateNavStatusUI('Updating Location...', false);
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      navState.gpsRequestInFlight = false;
      if (!navState.active) return;
      handleGpsSuccess(position, true);
    },
    (err) => {
      navState.gpsRequestInFlight = false;
      if (!navState.active) return;
      updateNavStatusUI('Location Update Failed', false);
      handleGpsError(err);
    },
    {
      enableHighAccuracy: true,
      timeout: 9000,
      maximumAge: 0,
    }
  );
}

function startAssignmentNavigation(assignment) {
  if (!assignment || !isNavigableStatus(assignment.status) || !navState.destCoords) return;

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    updateNavStatusUI('GPS Unsupported', false);
    showNavigationError('Your browser does not support geolocation.', false);
    return;
  }

  if (window.isSecureContext === false) {
    updateNavStatusUI('HTTPS Required', false);
    showNavigationError('Browser blocked geolocation because this page is not running in a secure HTTPS context (or localhost).', false);
    return;
  }

  stopAssignmentNavigation({ clearRoute: false, userPaused: false });
  navState.active = true;
  navState.pausedByUser = false;
  navState.hasFittedInitialBounds = false;
  navState.lastRouteAttemptAt = 0;
  navState.lastGpsAt = 0;
  hideNavigationError();
  updateNavStatusUI('Acquiring GPS...', false);
  resetStaleGpsWatchdog();

  navState.watchId = navigator.geolocation.watchPosition(
    (pos) => handleGpsSuccess(pos, false),
    handleGpsError,
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    }
  );

  // Immediate initial sync + mandatory automatic 10-second live synchronization cycle
  runTenSecondNavigationSync();
  navState.syncIntervalId = setInterval(runTenSecondNavigationSync, 10000);
}

window.recenterAssignmentMap = function () {
  if (!detailMap) return;
  if (navState.currentGps) {
    detailMap.setView([navState.currentGps.lat, navState.currentGps.lng], 16, { animate: true });
  } else if (navState.routePolyline) {
    detailMap.fitBounds(navState.routePolyline.getBounds(), { padding: [36, 36] });
  } else if (navState.destCoords) {
    detailMap.setView([navState.destCoords.lat, navState.destCoords.lng], 16, { animate: true });
  }
};

window.toggleAssignmentNavigation = function () {
  if (!activeAssignmentDetail) return;
  if (navState.active) {
    stopAssignmentNavigation({ clearRoute: false, userPaused: true });
  } else {
    startAssignmentNavigation(activeAssignmentDetail);
  }
};

window.retryAssignmentNavigation = function () {
  if (!activeAssignmentDetail) return;
  if (navState.currentGps && navState.destCoords) {
    navState.active = true;
    navState.lastRouteAttemptAt = 0;
    hideNavigationError();
    calculateAndDisplayRoute(navState.currentGps);
  } else {
    startAssignmentNavigation(activeAssignmentDetail);
  }
};

/**
 * Status Confirmation Dialog (Section 4)
 */
window.confirmStatusChange = function (newStatus) {
  if (!activeAssignmentDetail) return;

  const modal = document.getElementById('status-confirm-modal');
  const msgEl = document.getElementById('confirm-status-message');
  const targetEl = document.getElementById('confirm-target-status');

  if (!modal) return;

  targetEl.value = newStatus;
  msgEl.textContent = `Are you sure you want to change status of ${activeAssignmentDetail.referenceNumber || activeAssignmentDetail.id} to "${newStatus}"?`;

  modal.classList.remove('hidden');
};

window.closeStatusConfirmModal = function () {
  document.getElementById('status-confirm-modal')?.classList.add('hidden');
};

window.executeStatusChange = async function () {
  const targetStatus = document.getElementById('confirm-target-status')?.value;
  if (!activeAssignmentDetail || !targetStatus) return;

  closeStatusConfirmModal();

  try {
    await window.geoSafeStore.updateAssignmentStatus(activeAssignmentDetail.id, targetStatus, `Status officially updated to ${targetStatus} by responder.`);
    const successMsg =
      targetStatus === 'Accepted'
        ? 'Rescue assignment accepted successfully.'
        : `Assignment status updated to "${targetStatus}".`;
    GeoSafeResponderUI.showToast(successMsg, 'success');
    
    // Refresh modal and assignments list
    await loadAssignments();
    await openAssignmentDetails(activeAssignmentDetail.id);
  } catch (err) {
    GeoSafeResponderUI.showToast(err.message || 'Status transition failed.', 'error');
  }
};

/**
 * Field Progress Update Modal (Section 6)
 */
window.openProgressUpdateModal = function () {
  document.getElementById('progress-update-modal')?.classList.remove('hidden');
};

window.closeProgressUpdateModal = function () {
  document.getElementById('progress-update-modal')?.classList.add('hidden');
  document.getElementById('progress-notes').value = '';
  document.getElementById('progress-photo-filename').textContent = 'No file chosen';
  fieldPhotoBase64 = null;
};

window.handleFieldPhotoUpload = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  document.getElementById('progress-photo-filename').textContent = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    fieldPhotoBase64 = e.target.result;
    const preview = document.getElementById('progress-photo-preview');
    const container = document.getElementById('progress-photo-preview-container');
    if (preview && container) {
      preview.src = fieldPhotoBase64;
      container.classList.remove('hidden');
    }
  };
  reader.readAsDataURL(file);
};

window.submitProgressUpdate = async function () {
  if (!activeAssignmentDetail) return;

  const notes = document.getElementById('progress-notes')?.value?.trim();
  const isInternal = document.getElementById('progress-internal-only')?.checked;

  if (!notes) {
    GeoSafeResponderUI.showToast('Please enter field response notes or observations.', 'warning');
    return;
  }

  try {
    await window.geoSafeStore.updateAssignmentStatus(
      activeAssignmentDetail.id,
      activeAssignmentDetail.status || 'On Scene',
      notes,
      fieldPhotoBase64,
      isInternal
    );

    GeoSafeResponderUI.showToast('Field response progress submitted successfully.', 'success');
    closeProgressUpdateModal();

    await loadAssignments();
    await openAssignmentDetails(activeAssignmentDetail.id);
  } catch (err) {
    GeoSafeResponderUI.showToast(err.message || 'Failed to submit progress update.', 'error');
  }
};

