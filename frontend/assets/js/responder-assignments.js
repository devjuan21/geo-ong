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
let progressCameraStream = null;
let completionPhotoBase64 = null;
let completionCameraStream = null;
let statusUpdateInFlight = false;
let progressUpdateInFlight = false;

function formatAssignmentDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTimelineTimestamp(value) {
  if (!value) return 'Timestamp unavailable';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Timestamp unavailable';
  const timeStr = d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  const relStr = window.GeoSafeResponderUI && typeof GeoSafeResponderUI.formatRelativeTime === 'function'
    ? GeoSafeResponderUI.formatRelativeTime(d.toISOString())
    : '';
  return relStr ? `${timeStr} • ${relStr}` : timeStr;
}

const navState = {
  sessionId: 0,
  navStatus: 'Idle',
  active: false,
  arrived: false,
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
  activeTransportLeg: null,
};

const arrivalConfig = {
  geofenceRadiusMeters: 15,
  maxGpsAccuracyMeters: 150,
  consecutiveReadingsRequired: 2,
  confirmationWindowMs: 1500,
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
    stopCompletionCameraStream();
    stopProgressCameraStream();
  });
  window.addEventListener('pagehide', () => {
    stopCompletionCameraStream();
    stopProgressCameraStream();
  });

  // Check URL query parameters for direct assignment opening (e.g. ?id=REP-2026-104)
  const urlParams = new URLSearchParams(window.location.search);
  const targetId = urlParams.get('id');
  if (targetId) {
    setTimeout(() => openAssignmentDetails(targetId), 250);
  }

  const ASSIGNMENTS_REALTIME_EVENTS = new Set([
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

  window.addEventListener('geosafe:realtime-update', async (ev) => {
    const evt = ev && ev.detail ? ev.detail.event : '';
    if (!ASSIGNMENTS_REALTIME_EVENTS.has(evt)) return;
    if (statusUpdateInFlight || progressUpdateInFlight) return;
    await loadAssignments({ background: true });
    const detailsModal = document.getElementById('assign-details-modal');
    const confirmModal = document.getElementById('status-confirm-modal');
    const progressModal = document.getElementById('progress-update-modal');
    const isEditingSubModal =
      (confirmModal && !confirmModal.classList.contains('hidden')) ||
      (progressModal && !progressModal.classList.contains('hidden'));
    if (activeAssignmentDetail && detailsModal && !detailsModal.classList.contains('hidden') && !isEditingSubModal) {
      const updated = (allAssignments || []).find(
        (a) => String(a.id) === String(activeAssignmentDetail.id) || String(a.referenceNumber) === String(activeAssignmentDetail.referenceNumber)
      );
      if (updated && updated.status !== activeAssignmentDetail.status) {
        openAssignmentDetails(activeAssignmentDetail.id);
      }
    }
    if (navState.active && evt === 'reconnect-sync') {
      runTenSecondNavigationSync();
    }
  });
});

let cachedAssignmentsAuth = null;
let assignmentsLoadInFlight = false;
let assignmentsReloadQueued = false;

async function loadAssignments({ background = false } = {}) {
  if (assignmentsLoadInFlight) {
    assignmentsReloadQueued = true;
    return;
  }
  assignmentsLoadInFlight = true;

  const loadingEl = document.getElementById('assign-loading');
  const container = document.getElementById('assign-list-container');
  const emptyEl = document.getElementById('assign-empty-state');

  try {
    // Verify responder authentication and role (skip redundant check on background sync)
    if (!cachedAssignmentsAuth) {
      const auth = await GeoSafeResponderUI.verifyResponderSession();
      if (!auth.authorized) {
        if (loadingEl) loadingEl.classList.add('hidden');
        const mainEl = document.querySelector('main');
        GeoSafeResponderUI.renderUnauthorizedScreen(mainEl);
        return;
      }
      cachedAssignmentsAuth = auth;
    }

    if (!background) {
      if (loadingEl) loadingEl.classList.remove('hidden');
      if (container) container.classList.add('hidden');
      if (emptyEl) emptyEl.classList.add('hidden');
    }

    allAssignments = await window.geoSafeStore.getResponderAssignments({ status: 'All' });
    if (loadingEl) loadingEl.classList.add('hidden');
    renderFilteredAssignments();
  } catch (err) {
    console.error('[ResponderAssignments] Error loading assignments:', err);
    if (!background && loadingEl) {
      loadingEl.innerHTML = `
        <div class="p-6 text-center text-xs text-[#D93636]">
          <p class="font-bold">Failed to load responder assignments.</p>
          <button onclick="loadAssignments({ background: false })" class="mt-2 px-3 py-1 rounded-md bg-slate-100 text-[#202020] font-bold">Retry</button>
        </div>
      `;
    }
  } finally {
    assignmentsLoadInFlight = false;
    if (assignmentsReloadQueued) {
      assignmentsReloadQueued = false;
      loadAssignments({ background: true });
    }
  }
}

window.filterAssignments = function (status) {
  currentFilter = status;

  // Update tab buttons styling
  const tabs = ['All', 'Pending', 'Completed'];
  tabs.forEach(tab => {
    const btn = document.getElementById(`tab-assign-${tab.toLowerCase().replace(/\s+/g, '-')}`);
    if (btn) {
      if (tab.toLowerCase() === status.toLowerCase()) {
        btn.className = 'px-3.5 py-1.5 rounded-md text-xs font-bold transition-all bg-[#F5B900] text-[#202020] shadow-subtle flex-shrink-0 whitespace-nowrap';
      } else {
        btn.className = 'px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all bg-white border border-slate-200 text-[#777777] hover:text-[#202020] hover:bg-slate-100 flex-shrink-0 whitespace-nowrap';
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
      if (targetStatus === 'completed') {
        return ['completed', 'resolved'].includes(s);
      }
      if (targetStatus === 'pending') {
        return !['completed', 'resolved', 'cancelled', 'false_alarm', 'dismissed'].includes(s);
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
    else if (s === 'on scene' || s === 'in progress') statusBadge = 'bg-amber-50 text-[#E99524] border-amber-200 font-bold';
    else if (s === 'accepted') statusBadge = 'bg-purple-50 text-purple-700 border-purple-200';
    else if (s === 'completed' || s === 'resolved') statusBadge = 'bg-emerald-50 text-[#278653] border-emerald-200';

    return `
      <div onclick="openAssignmentDetails('${a.id}')" class="bg-white rounded-lg p-4 sm:p-5 border border-slate-200 shadow-subtle transition-all hover:border-[#F5B900] cursor-pointer space-y-3">
        
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs sm:text-sm font-bold text-[#202020]">${a.referenceNumber || a.id}</span>
            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border ${isRescue ? 'bg-[#FFF1F1] text-[#D93636] border-[#FFC2C2]' : 'bg-slate-50 text-[#8A6800] border-[#FFE872]'}">
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
          ${isRescue && (a.peopleCountDisplay || a.peopleCount || a.peopleCountCategory) ? `
            <div class="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-[#D93636] bg-[#FFF1F1] px-2 py-0.5 rounded-lg border border-[#FFC2C2]">
              <svg class="w-3 h-3 text-[#D93636]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
              <span>${a.peopleCountDisplay || (a.peopleCountCategory === 'more_than_10' ? 'More than 10' : a.peopleCountCategory === 'unknown' || !a.peopleCount ? 'Unknown' : `${a.peopleCount} ${a.peopleCount > 1 ? 'People Trapped' : 'Person Trapped'}`)}</span>
            </div>
          ` : ''}
          ${a.dispatchInstructions ? `
            <div class="mt-2.5 p-2.5 bg-slate-50 rounded-md border border-slate-200 text-[11px] text-[#777777] flex items-start gap-2">
              <svg class="w-3.5 h-3.5 text-[#F5B900] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              <span class="line-clamp-2 leading-relaxed"><strong class="text-[#202020] font-semibold">Dispatch Note:</strong> ${a.dispatchInstructions}</span>
            </div>
          ` : ''}
        </div>

        <div class="pt-2.5 border-t border-slate-200 flex items-center justify-between text-xs text-[#777777]">
          <span class="text-[10px]">Date: ${formatAssignmentDateTime(a.assignedAt)}</span>
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

    // Rescue vs Incident Specific Fields
    const rescueFields = document.getElementById('dtl-rescue-fields');
    const incidentFields = document.getElementById('dtl-incident-fields');
    if (assignment.assignmentType === 'rescue') {
      if (rescueFields) {
        rescueFields.classList.remove('hidden');
        document.getElementById('dtl-people-count').textContent =
          assignment.peopleCountDisplay ||
          (assignment.peopleCountCategory === 'more_than_10'
            ? 'More than 10'
            : assignment.peopleCountCategory === 'unknown' || !assignment.peopleCount
              ? 'Unknown'
              : `${assignment.peopleCount} Person(s)`);
        document.getElementById('dtl-vulnerable').textContent = assignment.vulnerableDetails || 'None specified';
      }
      if (incidentFields) incidentFields.classList.add('hidden');
    } else {
      if (rescueFields) rescueFields.classList.add('hidden');
      if (incidentFields) {
        incidentFields.classList.remove('hidden');
        const catEl = document.getElementById('dtl-incident-category');
        const repEl = document.getElementById('dtl-incident-reporter');
        if (catEl) catEl.textContent = assignment.category || assignment.title || 'Incident';
        if (repEl) repEl.textContent = assignment.residentName || 'Resident';
      }
    }

    // Separated Evidence Sections: Resident Report Evidence & Responder Completion Evidence
    const renderEvidenceSection = (listElId, countElId, items, emptyMsg, showUploader) => {
      const listEl = document.getElementById(listElId);
      const countEl = document.getElementById(countElId);
      if (countEl) {
        const len = items.length;
        countEl.textContent = `${len} ${len === 1 ? 'file' : 'files'}`;
      }
      if (!listEl) return;
      if (items.length === 0) {
        listEl.className = 'block';
        listEl.innerHTML = `<div class="rounded-md border border-dashed border-slate-200 bg-[#FBFBFA] p-3 text-center text-[11px] text-[#777777]">${emptyMsg}</div>`;
        return;
      }
      listEl.className = 'grid grid-cols-2 sm:grid-cols-3 gap-2.5';
      listEl.innerHTML = items.map((ev) => {
        const url = ev.fileUrl || ev.file_url || '';
        const name = ev.fileName || ev.file_name || 'Photo Evidence';
        const timeStr = formatAssignmentDateTime(ev.createdAt || ev.created_at);
        const uploaderStr = showUploader && ev.uploadedByName ? `${ev.uploadedByName} • ` : '';
        return `
          <div class="group rounded-md border border-slate-200 bg-white overflow-hidden shadow-subtle cursor-pointer hover:border-[#F5B900] transition-colors" onclick="window.open('${url}', '_blank')">
            <div class="h-24 w-full bg-[#F7F7F7] flex items-center justify-center overflow-hidden">
              <img src="${url}" alt="${name}" class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform">
            </div>
            <div class="px-2 py-1.5 border-t border-slate-200">
              <p class="text-[10px] font-semibold text-[#202020] truncate">${uploaderStr}${timeStr}</p>
            </div>
          </div>
        `;
      }).join('');
    };

    const residentItems = Array.isArray(assignment.residentEvidence) ? assignment.residentEvidence : [];
    const completionItems = Array.isArray(assignment.responderCompletionEvidence) ? assignment.responderCompletionEvidence : [];
    renderEvidenceSection('dtl-resident-evidence-list', 'dtl-resident-evidence-count', residentItems, 'No resident report photos submitted.', false);
    renderEvidenceSection('dtl-completion-evidence-list', 'dtl-completion-evidence-count', completionItems, 'No responder completion photos uploaded yet.', true);

    // Timeline / Audit History (Descending chronological order: newest first)
    const timelineList = document.getElementById('dtl-timeline-list');
    if (timelineList) {
      const history = [...(assignment.timeline || [])].sort((a, b) => {
        const aRaw = a.timestamp || a.time || a.createdAt || 0;
        const bRaw = b.timestamp || b.time || b.createdAt || 0;
        const aTs = new Date(aRaw).getTime();
        const bTs = new Date(bRaw).getTime();
        const validA = Number.isFinite(aTs);
        const validB = Number.isFinite(bTs);
        if (validA && validB && bTs !== aTs) return bTs - aTs;
        if (validB !== validA) return validB ? 1 : -1;
        return Number(b.id || 0) - Number(a.id || 0);
      });
      if (history.length === 0) {
        timelineList.innerHTML = `<li class="text-[11px] text-[#777777] italic">No updates logged yet.</li>`;
      } else {
        timelineList.innerHTML = history.map(item => `
          <li class="relative pl-5 pb-3 border-l border-[#FFE872] last:border-none last:pb-0">
            <span class="absolute -left-1.5 top-0.5 w-3 h-3 rounded-full bg-[#F5B900] ring-4 ring-white"></span>
            <div class="text-[10px] text-[#777777]">${formatTimelineTimestamp(item.timestamp || item.time || item.createdAt)}</div>
            <div class="text-xs font-bold text-[#202020] mt-0.5">${item.status || item.text || 'Update'}</div>
            ${item.note ? `<p class="text-[11px] text-[#555555] mt-0.5">${item.note}</p>` : ''}
            ${item.photo ? `<img src="${item.photo}" class="w-16 h-16 rounded-lg object-cover border border-slate-200 mt-1">` : ''}
          </li>
        `).join('');
      }
    }

    // Rescue Outcome & Optional Transportation Panel
    renderRescueOutcomePanel(assignment);

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
      <button type="button" onclick="confirmStatusChange('Accepted')" class="flex-1 py-2.5 px-4 rounded-lg bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] font-bold text-xs shadow-subtle transition-all flex items-center justify-center gap-1.5">
        <svg class="w-4 h-4 text-[#202020]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
        <span>Accept Assignment</span>
      </button>
    `;
  } else if (s === 'accepted') {
    buttonsHtml = `
      <div class="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <button type="button" onclick="confirmStatusChange('En Route')" class="flex-1 py-2.5 px-4 rounded-lg bg-[#3478C7] hover:bg-[#2764AB] text-white font-bold text-xs shadow-subtle transition-all flex items-center justify-center gap-1.5">
          <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1" stroke-width="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 8" stroke-width="2"></polygon><circle cx="5.5" cy="18.5" r="2.5" stroke-width="2"></circle><circle cx="18.5" cy="18.5" r="2.5" stroke-width="2"></circle></svg>
          <span>Mark as En Route</span>
        </button>
        <span class="px-3 py-2 rounded-lg bg-slate-50 border border-[#FFE872] text-[11px] font-bold text-[#8A6800] text-center">
          Auto On Scene on GPS Arrival
        </span>
      </div>
    `;
  } else if (s === 'en route' || s === 'responding') {
    buttonsHtml = `
      <div class="w-full py-2.5 px-4 rounded-lg bg-blue-50 border border-blue-200 text-[#3478C7] text-center text-xs font-bold">
        Automatic Arrival Detection Active — Status updates to On Scene upon arrival at the location
      </div>
    `;
  } else if (s === 'on scene' || s === 'on site' || s === 'in progress') {
    const isRescue = activeAssignmentDetail && activeAssignmentDetail.assignmentType === 'rescue';
    const transports = Array.isArray(activeAssignmentDetail?.transports) ? activeAssignmentDetail.transports : [];
    const activeLegs = transports.filter((t) => t.transportStatus !== 'Cancelled');
    const needsHandover = Boolean(
      isRescue &&
      activeLegs.length > 0 &&
      activeLegs.some((t) => t.transportStatus !== 'Handed Over' || !t.handoverConfirmed || !t.arrivedAt)
    );
    buttonsHtml = `
      <button type="button" onclick="openProgressUpdateModal()" class="py-2.5 px-3 rounded-lg bg-slate-50 border border-[#FFE872] text-[#8A6800] hover:bg-[#FFF3D0] font-bold text-xs transition-all">
        Update Progress
      </button>
      <button type="button" ${needsHandover ? 'disabled title="Confirm arrival and handover for all transport legs before completing"' : ''} onclick="confirmStatusChange('Completed')"
        class="flex-1 py-2.5 px-4 rounded-lg ${needsHandover ? 'bg-slate-300 text-slate-600 cursor-not-allowed' : 'bg-[#278653] hover:bg-[#1E6E43] text-white shadow-subtle'} font-bold text-xs transition-all flex items-center justify-center gap-1.5">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        <span>${needsHandover ? 'Handover Required to Complete' : 'Complete Task'}</span>
      </button>
    `;
  } else if (s === 'completed' || s === 'resolved') {
    buttonsHtml = `
      <div class="w-full py-2 px-3 rounded-md bg-emerald-50 border border-emerald-200 text-[#278653] text-center text-xs font-bold">
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

function isNavigableStatus(status, assignment) {
  if (navState.activeTransportLeg || (assignment && assignment._isTransportNavigation)) {
    return true;
  }
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

  const isTransportNav = Boolean(assignment && assignment._isTransportNavigation && assignment._transportLeg);
  navState.activeTransportLeg = isTransportNav ? assignment._transportLeg : null;

  const destCoords = parseValidCoords(assignment && assignment.coordinates);
  const statusStr = assignment ? assignment.status : '';
  const shouldNavigate = isNavigableStatus(statusStr, assignment);

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
  if (isTransportNav) {
    const locEl = document.getElementById('dtl-location');
    if (locEl) locEl.textContent = `${destLabel} (${assignment._transportLeg.destinationFacilityType || 'Transport Destination'})`;
  }

  const isRescueTarget =
    (assignment && (assignment.assignmentType === 'rescue' || assignment.recordType === 'rescue')) ||
    String((assignment && (assignment.referenceNumber || assignment.id)) || '').startsWith('RES-');
  const targetIcon = isTransportNav
    ? (assignment._transportLeg.destinationCategory === 'evacuation_center'
        ? GeoSafeMapping.createCustomIcon('evacuation')
        : GeoSafeMapping.createMedicalFacilityIcon(assignment._transportLeg.destinationFacilityType || 'Hospital'))
    : GeoSafeMapping.createCustomIcon(isRescueTarget ? 'rescue' : 'incident');

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

  startAmbientAssignmentGps();

  const arrivedBanner = document.getElementById('dtl-nav-arrived-banner');
  const toggleBtn = document.getElementById('dtl-nav-toggle-btn');
  const statusLower = String(statusStr || '').toLowerCase();
  const isArrived = !isTransportNav && (statusLower === 'on scene' || statusLower === 'on site');

  if (shouldNavigate) {
    navState.arrived = false;
    arrivedBanner?.classList.add('hidden');
    toggleBtn?.classList.remove('hidden');
    if (controlsEl) controlsEl.classList.remove('hidden');
    if (navPanel) navPanel.classList.remove('hidden');
    const destLabelEl = document.getElementById('dtl-nav-dest-label');
    if (destLabelEl) destLabelEl.textContent = destLabel;
    startAssignmentNavigation(assignment);
  } else if (isArrived) {
    renderResponderArrivedState(destLabel);
  } else {
    navState.arrived = false;
    navState.navStatus = 'Idle';
    arrivedBanner?.classList.add('hidden');
    if (controlsEl) controlsEl.classList.add('hidden');
    if (navPanel) navPanel.classList.add('hidden');
  }
}

function renderResponderArrivedState(destLabel) {
  stopAssignmentNavigation({ clearRoute: true, userPaused: false, preserveArrived: true });
  navState.arrived = true;
  navState.navStatus = 'Arrived';
  navState.active = false;

  const controlsEl = document.getElementById('dtl-map-controls');
  const navPanel = document.getElementById('dtl-nav-panel');
  const arrivedBanner = document.getElementById('dtl-nav-arrived-banner');
  const arrivedDest = document.getElementById('dtl-nav-arrived-dest');
  const toggleBtn = document.getElementById('dtl-nav-toggle-btn');

  if (controlsEl) controlsEl.classList.add('hidden');
  if (navPanel) navPanel.classList.remove('hidden');
  if (toggleBtn) toggleBtn.classList.add('hidden');
  hideNavigationError();
  clearRouteDisplay();

  const resolvedLabel =
    destLabel ||
    (activeAssignmentDetail && (activeAssignmentDetail.location || activeAssignmentDetail.title || activeAssignmentDetail.referenceNumber)) ||
    'Assigned Scene';
  if (arrivedDest) arrivedDest.textContent = resolvedLabel;
  if (arrivedBanner) arrivedBanner.classList.remove('hidden');
  updateNavStatusUI('Arrived', false);
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
  if (navState.arrived && pillText !== 'Arrived') return;
  navState.navStatus = pillText;
  const pill = document.getElementById('dtl-nav-status-pill');
  const toggleBtn = document.getElementById('dtl-nav-toggle-btn');
  if (pill) {
    pill.textContent = pillText;
    if (pillText === 'Arrived') {
      pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-[#278653] border border-emerald-200';
    } else if (isPaused || pillText === 'Navigation Stopped' || pillText === 'Idle') {
      pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#F7F7F7] text-[#555555] border border-slate-200';
    } else {
      pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-50 text-[#3478C7] border border-blue-200';
    }
  }
  if (toggleBtn) {
    toggleBtn.textContent = isPaused ? 'Start Navigation' : 'Stop Navigation';
  }
}

function clearRouteDisplay() {
  if (detailMap && navState.routePolyline) {
    try {
      detailMap.removeLayer(navState.routePolyline);
    } catch (_) { }
  }
  navState.routePolyline = null;
  navState.routeCoords = [];

  const distEl = document.getElementById('dtl-nav-distance');
  const etaEl = document.getElementById('dtl-nav-eta');
  const nextInstEl = document.getElementById('dtl-nav-next-instruction');
  const nextDistEl = document.getElementById('dtl-nav-next-dist');
  const stepsList = document.getElementById('dtl-nav-steps-list');
  const stepsCount = document.getElementById('dtl-nav-steps-count');

  if (distEl) distEl.textContent = '';
  if (etaEl) etaEl.textContent = '';
  if (nextInstEl) nextInstEl.textContent = '';
  if (nextDistEl) nextDistEl.textContent = '';
  if (stepsList) stepsList.innerHTML = '';
  if (stepsCount) stepsCount.textContent = '';

  document.getElementById('dtl-nav-metrics')?.classList.add('hidden');
  document.getElementById('dtl-nav-next-step')?.classList.add('hidden');
  document.getElementById('dtl-nav-steps-wrap')?.classList.add('hidden');
}

function clearResponderMarker() {
  if (detailMap && navState.responderMarker) {
    try {
      detailMap.removeLayer(navState.responderMarker);
    } catch (_) { }
  }
  if (detailMap && navState.responderAccuracyCircle) {
    try {
      detailMap.removeLayer(navState.responderAccuracyCircle);
    } catch (_) { }
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

function stopAssignmentNavigation({ clearRoute = true, userPaused = false, preserveArrived = false } = {}) {
  clearStaleGpsWatchdog();
  if (navState.syncIntervalId !== null) {
    clearInterval(navState.syncIntervalId);
    navState.syncIntervalId = null;
  }
  if (navState.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      navigator.geolocation.clearWatch(navState.watchId);
    } catch (_) { }
  }
  navState.watchId = null;
  navState.active = false;
  navState.pausedByUser = Boolean(userPaused);
  navState.isRouting = false;
  navState.gpsRequestInFlight = false;
  navState.routeRequestSeq += 1;
  navState.sessionId += 1;
  navState.hasFittedInitialBounds = false;
  navState.lastRouteOrigin = null;
  navState.lastGpsAt = 0;
  resetArrivalState();

  if (!preserveArrived) {
    navState.arrived = false;
  }

  if (clearRoute) {
    navState.activeTransportLeg = null;
    clearRouteDisplay();
    clearResponderMarker();
    navState.currentGps = null;
    hideNavigationError();
    const accEl = document.getElementById('dtl-nav-gps-accuracy');
    if (accEl) accEl.textContent = '';
  }

  if (!preserveArrived && userPaused) {
    updateNavStatusUI('Navigation Stopped', true);
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
  if (navState.arrived || !detailMap || !route || !Array.isArray(route.coordinates) || route.coordinates.length < 2) return;

  if (navState.routePolyline) {
    try {
      detailMap.removeLayer(navState.routePolyline);
    } catch (_) { }
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

  const allSteps = Array.isArray(route.steps) ? route.steps : [];
  const steps = allSteps.filter((s) => String(s.type || '').toLowerCase() !== 'arrive');
  const nextStepBanner = document.getElementById('dtl-nav-next-step');
  const nextInstEl = document.getElementById('dtl-nav-next-instruction');
  const nextDistEl = document.getElementById('dtl-nav-next-dist');
  const stepsWrap = document.getElementById('dtl-nav-steps-wrap');
  const stepsList = document.getElementById('dtl-nav-steps-list');
  const stepsCount = document.getElementById('dtl-nav-steps-count');

  if (steps.length > 0) {
    // Pick the first actionable non-arrive step
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
            <li class="flex items-start justify-between gap-2 bg-white rounded-lg border border-slate-200 px-2.5 py-1.5">
              <span class="font-medium text-[#202020]"><span class="font-bold text-[#8A6800] mr-1">${idx + 1}.</span>${escapeHtmlNav(st.instruction)}</span>
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
  if (!navState.active || navState.arrived || !navState.destCoords || !originGps || navState.isRouting) return;

  const sessionAtStart = navState.sessionId;
  const hadValidRoute = Array.isArray(navState.routeCoords) && navState.routeCoords.length >= 2;
  const reqSeq = ++navState.routeRequestSeq;
  navState.isRouting = true;
  navState.lastRouteAttemptAt = Date.now();
  navState.lastRouteOrigin = { lat: originGps.lat, lng: originGps.lng };
  updateNavStatusUI('Recalculating Route', false);

  try {
    const route = await GeoSafeMapping.calculateDrivingRoute(originGps, navState.destCoords);
    if (!navState.active || navState.arrived || sessionAtStart !== navState.sessionId || reqSeq !== navState.routeRequestSeq) return;
    hideNavigationError();
    renderCalculatedRoute(route);
    updateNavStatusUI('Navigating', false);
  } catch (err) {
    if (!navState.active || navState.arrived || sessionAtStart !== navState.sessionId || reqSeq !== navState.routeRequestSeq) return;
    if (hadValidRoute) {
      // Preserve last valid route during temporary routing hiccups
      updateNavStatusUI('Navigating', false);
      showNavigationError('Temporary routing delay — retaining last valid road route.', true);
    } else {
      clearRouteDisplay();
      updateNavStatusUI('Recalculating Route', false);
      showNavigationError(err.message || 'Unable to calculate a road route right now.', true);
    }
  } finally {
    if (reqSeq === navState.routeRequestSeq && sessionAtStart === navState.sessionId) {
      navState.isRouting = false;
    }
  }
}

function handleGpsSuccess(position, isCycleSync = false, sessionId = navState.sessionId) {
  if (!navState.active || navState.arrived || sessionId !== navState.sessionId || !position || !position.coords) return;

  const lat = Number(position.coords.latitude);
  const lng = Number(position.coords.longitude);
  const accuracy = Number(position.coords.accuracy);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    updateNavStatusUI('GPS Unavailable', false);
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
    updateNavStatusUI('GPS Unavailable', false);
    showNavigationError(`GPS accuracy is currently insufficient (±${Math.round(accuracy)}m). Move to an open area and retry.`, true);
    return;
  }

  hideNavigationError();
  const gps = { lat, lng, accuracy };
  navState.currentGps = gps;
  updateResponderGpsMarker(gps);
  if (isCycleSync) {
    syncResponderAssignmentGps(gps);
  }

  // Evaluate automatic GPS-based arrival detection first (never triggered by route completion alone)
  evaluateArrivalProximity(gps);
  if (
    !navState.active ||
    navState.arrived ||
    arrivalState.triggered ||
    arrivalState.inFlight ||
    arrivalState.consecutiveCount > 0
  ) {
    return;
  }

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
    updateNavStatusUI('Navigating', false);
  }
}

function scheduleArrivalRecheck() {
  clearArrivalRecheckTimer();
  if (!navState.active || navState.arrived || arrivalState.triggered || arrivalState.inFlight) return;
  if (typeof navigator === 'undefined' || !navigator.geolocation) return;

  const sessionAtSchedule = navState.sessionId;
  const intervalMs = Math.max(
    800,
    Math.ceil(arrivalConfig.confirmationWindowMs / Math.max(1, arrivalConfig.consecutiveReadingsRequired))
  );

  arrivalState.recheckTimer = setTimeout(() => {
    arrivalState.recheckTimer = null;
    if (!navState.active || navState.arrived || sessionAtSchedule !== navState.sessionId || arrivalState.triggered || arrivalState.inFlight) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => handleGpsSuccess(pos, false, sessionAtSchedule),
      (err) => handleGpsError(err, sessionAtSchedule),
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0,
      }
    );
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
      if (navState.activeTransportLeg) {
        triggerAutomaticTransportArrival(gps, distMeters);
      } else {
        triggerAutomaticArrivalOnScene(gps, distMeters);
      }
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

async function triggerAutomaticTransportArrival(gps, distMeters) {
  const leg = navState.activeTransportLeg;
  if (!activeAssignmentDetail || !leg || arrivalState.inFlight || arrivalState.triggered) return;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    arrivalState.pendingRetry = true;
    showNavigationError('Network disconnected while confirming transport arrival. Will retry automatically when online.', true);
    return;
  }

  arrivalState.inFlight = true;
  arrivalState.lastAttemptAt = Date.now();
  arrivalState.lastGps = gps;
  arrivalState.lastDistMeters = distMeters;
  const assignmentId = activeAssignmentDetail.id;

  try {
    if (window.geoSafeStore && !window.geoSafeStore.getCsrfToken() && typeof window.geoSafeStore.checkSession === 'function') {
      await window.geoSafeStore.checkSession();
    }
    const data = await window.geoSafeStore.request(
      `/responder/assignments/${encodeURIComponent(assignmentId)}/transports/${leg.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ action: 'arrive' }),
      }
    );
    if (!data || !data.transport) throw new Error((data && data.error) || 'Failed to mark transport arrived');

    arrivalState.triggered = true;
    arrivalState.pendingRetry = false;
    const destLabel = leg.destinationName || 'Transport Destination';
    navState.activeTransportLeg = null;
    renderResponderArrivedState(destLabel);

    GeoSafeResponderUI.showToast(
      `Arrived at ${destLabel}. Please confirm patient/evacuee handover.`,
      'success'
    );

    await loadAssignments();
    if (activeAssignmentDetail && activeAssignmentDetail.id === assignmentId) {
      await openAssignmentDetails(assignmentId);
    }
  } catch (err) {
    arrivalState.pendingRetry = true;
    arrivalState.triggered = false;
    showNavigationError(
      err.message || 'Failed to confirm transport arrival with server. Will retry safely.',
      true
    );
  } finally {
    arrivalState.inFlight = false;
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

    // Stop active navigation GPS tracking, clear route/guidance display, and lock Arrived state
    const destLabel =
      (activeAssignmentDetail && (activeAssignmentDetail.location || activeAssignmentDetail.title || activeAssignmentDetail.referenceNumber)) ||
      'Assigned Scene';
    renderResponderArrivedState(destLabel);

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

function handleGpsError(err, sessionId = navState.sessionId) {
  if (!navState.active || navState.arrived || sessionId !== navState.sessionId) return;
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
  if (!navState.active || navState.arrived || !activeAssignmentDetail || !isNavigableStatus(activeAssignmentDetail.status)) return;
  if (typeof navigator === 'undefined' || !navigator.geolocation) return;
  if (navState.gpsRequestInFlight) return;

  const sessionAtSync = navState.sessionId;
  navState.gpsRequestInFlight = true;
  if (arrivalState.consecutiveCount === 0 && (!navState.routeCoords || navState.routeCoords.length < 2)) {
    updateNavStatusUI('Requesting Location', false);
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      navState.gpsRequestInFlight = false;
      if (!navState.active || navState.arrived || sessionAtSync !== navState.sessionId) return;
      handleGpsSuccess(position, true, sessionAtSync);
    },
    (err) => {
      navState.gpsRequestInFlight = false;
      if (!navState.active || navState.arrived || sessionAtSync !== navState.sessionId) return;
      updateNavStatusUI('GPS Unavailable', false);
      handleGpsError(err, sessionAtSync);
    },
    {
      enableHighAccuracy: true,
      timeout: 9000,
      maximumAge: 0,
    }
  );
}

function startAssignmentNavigation(assignment) {
  if (!assignment || !isNavigableStatus(assignment.status, assignment) || !navState.destCoords) return;

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    updateNavStatusUI('GPS Unavailable', false);
    showNavigationError('Your browser does not support geolocation.', false);
    return;
  }

  if (window.isSecureContext === false) {
    updateNavStatusUI('GPS Unavailable', false);
    showNavigationError('Browser blocked geolocation because this page is not running in a secure HTTPS context (or localhost).', false);
    return;
  }

  stopAssignmentNavigation({ clearRoute: false, userPaused: false, preserveArrived: false });
  navState.sessionId += 1;
  const currentSessionId = navState.sessionId;
  navState.active = true;
  navState.arrived = false;
  navState.pausedByUser = false;
  navState.hasFittedInitialBounds = false;
  navState.lastRouteAttemptAt = 0;
  navState.lastGpsAt = 0;
  hideNavigationError();
  updateNavStatusUI('Requesting Location', false);
  resetStaleGpsWatchdog();

  navState.watchId = navigator.geolocation.watchPosition(
    (pos) => handleGpsSuccess(pos, false, currentSessionId),
    (err) => handleGpsError(err, currentSessionId),
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

const ambientAssignGpsState = { marker: null, accuracyCircle: null };
let ambientAssignGpsTracker = null;
let lastAssignRespSyncAt = 0;

function syncResponderAssignmentGps(reading) {
  if (!reading || reading.isStale || !window.geoSafeStore || typeof window.geoSafeStore.syncResponderLocation !== 'function') return;
  const now = Date.now();
  if (now - lastAssignRespSyncAt < 9000) return;
  lastAssignRespSyncAt = now;
  let sharingEnabled = true;
  try { sharingEnabled = localStorage.getItem('geosafe_responder_location_sharing') !== 'false'; } catch (_) { }
  window.geoSafeStore.syncResponderLocation({
    lat: reading.lat,
    lng: reading.lng,
    accuracy: reading.accuracy,
    sharingEnabled
  }).catch(() => { });
}

function startAmbientAssignmentGps() {
  if (!detailMap || ambientAssignGpsTracker || !window.GeoSafeMapping || typeof window.GeoSafeMapping.createLiveGpsTracker !== 'function') {
    return;
  }
  ambientAssignGpsTracker = window.GeoSafeMapping.createLiveGpsTracker({
    syncIntervalMs: 10000,
    onLocation: (reading) => {
      syncResponderAssignmentGps(reading);
      if (navState && navState.active) return;
      window.GeoSafeMapping.renderLiveGpsMarker(detailMap, ambientAssignGpsState, reading, {
        title: 'Responder Position',
        zIndexOffset: 950
      });
    }
  });
  ambientAssignGpsTracker.start();
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

function isCompletionPhotoRequiredForAssignment(_assignment) {
  return true;
}

function isValidCompletionPhoto(dataUrl) {
  return typeof dataUrl === 'string' && /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl);
}

function stopCompletionCameraStream() {
  if (completionCameraStream) {
    completionCameraStream.getTracks().forEach((t) => t.stop());
    completionCameraStream = null;
  }
  const videoEl = document.getElementById('completion-camera-video');
  if (videoEl) {
    videoEl.srcObject = null;
  }
}

function updateCompletionConfirmButtonState() {
  const targetStatus = document.getElementById('confirm-target-status')?.value;
  const confirmBtn = document.getElementById('btn-confirm-status-change');
  if (!confirmBtn) return;

  if (targetStatus !== 'Completed') {
    confirmBtn.disabled = statusUpdateInFlight;
    return;
  }

  const hasPhoto = isValidCompletionPhoto(completionPhotoBase64);
  const badge = document.getElementById('completion-photo-badge');
  if (badge) badge.classList.toggle('hidden', !hasPhoto);

  if (hasPhoto) {
    window.GeoSafeToast?.clearInvalidField?.(document.getElementById('confirm-completion-photo-section'));
  }

  confirmBtn.disabled = statusUpdateInFlight;
}

window.openCompletionCamera = async function () {
  const boxEl = document.getElementById('completion-camera-box');
  const videoEl = document.getElementById('completion-camera-video');
  const errEl = document.getElementById('completion-camera-error');
  const snapBtn = document.getElementById('btn-snap-completion-photo');

  stopCompletionCameraStream();
  if (errEl) {
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }

  if (window.isSecureContext === false) {
    if (errEl) {
      errEl.textContent = 'Camera access requires a secure HTTPS (or localhost) connection.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    if (errEl) {
      errEl.textContent = 'Camera is not supported by this browser or device.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  if (boxEl) boxEl.classList.remove('hidden');
  if (snapBtn) snapBtn.disabled = true;

  try {
    try {
      completionCameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (constraintErr) {
      if (constraintErr && (constraintErr.name === 'OverconstrainedError' || constraintErr.name === 'NotFoundError')) {
        completionCameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else {
        throw constraintErr;
      }
    }

    if (videoEl) {
      videoEl.srcObject = completionCameraStream;
      await videoEl.play();
    }
    if (snapBtn) snapBtn.disabled = false;
  } catch (err) {
    stopCompletionCameraStream();
    if (boxEl) boxEl.classList.add('hidden');
    let msg = 'Unable to access the device camera. Please try again.';
    if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
      msg = 'Camera permission was denied. Allow camera access to capture completion evidence.';
    } else if (err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
      msg = 'No camera was detected on this device.';
    } else if (err && err.name === 'NotReadableError') {
      msg = 'Camera is currently in use by another application.';
    }
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
  }
};

window.closeCompletionCamera = function () {
  stopCompletionCameraStream();
  document.getElementById('completion-camera-box')?.classList.add('hidden');
};

window.captureCompletionPhoto = function () {
  const videoEl = document.getElementById('completion-camera-video');
  const canvasEl = document.getElementById('completion-camera-canvas');
  if (!videoEl || !canvasEl || !videoEl.videoWidth || !videoEl.videoHeight) {
    GeoSafeResponderUI.showToast('Camera preview is not ready yet.', 'warning');
    return;
  }

  const maxDim = 1280;
  let w = videoEl.videoWidth;
  let h = videoEl.videoHeight;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  canvasEl.width = w;
  canvasEl.height = h;
  const ctx = canvasEl.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, w, h);

  completionPhotoBase64 = canvasEl.toDataURL('image/jpeg', 0.85);
  const previewImg = document.getElementById('completion-photo-preview');
  const previewWrap = document.getElementById('completion-photo-preview-wrap');
  if (previewImg && previewWrap) {
    previewImg.src = completionPhotoBase64;
    previewWrap.classList.remove('hidden');
  }

  window.closeCompletionCamera();
  updateCompletionConfirmButtonState();
  GeoSafeResponderUI.showToast('Completion photo captured.', 'success');
};

window.removeCompletionPhoto = function () {
  completionPhotoBase64 = null;
  const previewImg = document.getElementById('completion-photo-preview');
  const previewWrap = document.getElementById('completion-photo-preview-wrap');
  if (previewImg) previewImg.src = '';
  if (previewWrap) previewWrap.classList.add('hidden');
  updateCompletionConfirmButtonState();
};

/**
 * Status Confirmation Dialog (Section 4)
 */
window.confirmStatusChange = function (newStatus) {
  if (!activeAssignmentDetail) return;

  const modal = document.getElementById('status-confirm-modal');
  const titleEl = document.getElementById('confirm-status-title');
  const msgEl = document.getElementById('confirm-status-message');
  const targetEl = document.getElementById('confirm-target-status');
  const compSection = document.getElementById('confirm-completion-section');
  const photoSection = document.getElementById('confirm-completion-photo-section');
  const summaryInput = document.getElementById('confirm-completion-summary');
  const camErr = document.getElementById('completion-camera-error');

  if (!modal) return;

  stopCompletionCameraStream();
  completionPhotoBase64 = null;
  document.getElementById('completion-camera-box')?.classList.add('hidden');
  document.getElementById('completion-photo-preview-wrap')?.classList.add('hidden');
  if (camErr) {
    camErr.textContent = '';
    camErr.classList.add('hidden');
  }

  targetEl.value = newStatus;
  if (newStatus === 'Completed') {
    if (titleEl) titleEl.textContent = 'Complete Assignment';
    msgEl.textContent = `Provide a completion summary for ${activeAssignmentDetail.referenceNumber || activeAssignmentDetail.id}.`;
    if (compSection) compSection.classList.remove('hidden');
    if (summaryInput) {
      summaryInput.value = '';
      summaryInput.oninput = updateCompletionConfirmButtonState;
    }
    const needsPhoto = isCompletionPhotoRequiredForAssignment(activeAssignmentDetail);
    if (photoSection) photoSection.classList.toggle('hidden', !needsPhoto);
  } else {
    if (titleEl) titleEl.textContent = 'Confirm Status Transition';
    msgEl.textContent = `Are you sure you want to change status of ${activeAssignmentDetail.referenceNumber || activeAssignmentDetail.id} to "${newStatus}"?`;
    if (compSection) compSection.classList.add('hidden');
    if (photoSection) photoSection.classList.add('hidden');
  }

  updateCompletionConfirmButtonState();
  modal.classList.remove('hidden');
};

window.closeStatusConfirmModal = function () {
  stopCompletionCameraStream();
  document.getElementById('completion-camera-box')?.classList.add('hidden');
  document.getElementById('status-confirm-modal')?.classList.add('hidden');
};

window.executeStatusChange = async function () {
  const targetStatus = document.getElementById('confirm-target-status')?.value;
  if (!activeAssignmentDetail || !targetStatus || statusUpdateInFlight) return;

  let workNotes = `Status officially updated to ${targetStatus} by responder.`;
  let photoToSend = null;

  if (targetStatus === 'Completed') {
    const summaryEl = document.getElementById('confirm-completion-summary');
    const photoSectionEl = document.getElementById('confirm-completion-photo-section');
    const summary = summaryEl?.value?.trim() || '';
    if (!summary) {
      if (window.GeoSafeToast?.flagInvalidField) {
        window.GeoSafeToast.flagInvalidField(summaryEl, 'Please enter a completion summary.');
      } else {
        GeoSafeResponderUI.showToast('Please enter a completion summary.', 'warning');
      }
      updateCompletionConfirmButtonState();
      return;
    }
    if (isCompletionPhotoRequiredForAssignment(activeAssignmentDetail) && !isValidCompletionPhoto(completionPhotoBase64)) {
      if (window.GeoSafeToast?.flagInvalidField) {
        window.GeoSafeToast.flagInvalidField(photoSectionEl, 'Please capture at least one completion photo.');
      } else {
        GeoSafeResponderUI.showToast('Please capture at least one completion photo.', 'warning');
      }
      updateCompletionConfirmButtonState();
      return;
    }
    workNotes = summary;
    photoToSend = isValidCompletionPhoto(completionPhotoBase64) ? completionPhotoBase64 : null;
  }

  statusUpdateInFlight = true;
  const confirmBtn = document.getElementById('btn-confirm-status-change');
  const prevConfirmText = confirmBtn ? confirmBtn.textContent : 'Confirm';
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = targetStatus === 'Completed' ? 'Completing...' : 'Updating...';
  }

  try {
    await window.geoSafeStore.updateAssignmentStatus(activeAssignmentDetail.id, targetStatus, workNotes, photoToSend);
    closeStatusConfirmModal();
    completionPhotoBase64 = null;
    activeAssignmentDetail.status = targetStatus;
    const badgeEl = document.getElementById('dtl-status-badge');
    if (badgeEl) badgeEl.textContent = targetStatus;
    renderActionButtons(targetStatus);
    if (targetStatus === 'Completed') {
      stopAssignmentNavigation({ clearRoute: true });
    }

    const typeLabel = activeAssignmentDetail.assignmentType === 'rescue' ? 'Rescue' : 'Incident';
    const successMsg =
      targetStatus === 'Accepted'
        ? `${typeLabel} assignment accepted successfully.`
        : `Assignment status updated to "${targetStatus}".`;
    GeoSafeResponderUI.showToast(successMsg, 'success');

    // Refresh modal and assignments list
    await loadAssignments();
    await openAssignmentDetails(activeAssignmentDetail.id);
  } catch (err) {
    GeoSafeResponderUI.showToast(err.message || 'Status transition failed.', 'error');
  } finally {
    statusUpdateInFlight = false;
    const confirmBtn = document.getElementById('btn-confirm-status-change');
    if (confirmBtn) confirmBtn.textContent = prevConfirmText;
    updateCompletionConfirmButtonState();
  }
};

/**
 * Field Progress Update Modal (Section 6)
 */
function stopProgressCameraStream() {
  if (progressCameraStream) {
    progressCameraStream.getTracks().forEach((t) => t.stop());
    progressCameraStream = null;
  }
  const videoEl = document.getElementById('progress-camera-video');
  if (videoEl) {
    videoEl.srcObject = null;
  }
}

window.openProgressUpdateModal = function () {
  const errEl = document.getElementById('progress-camera-error');
  if (errEl) {
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }
  document.getElementById('progress-camera-box')?.classList.add('hidden');
  document.getElementById('progress-update-modal')?.classList.remove('hidden');
};

window.closeProgressUpdateModal = function () {
  stopProgressCameraStream();
  document.getElementById('progress-camera-box')?.classList.add('hidden');
  document.getElementById('progress-update-modal')?.classList.add('hidden');
  const notesEl = document.getElementById('progress-notes');
  if (notesEl) notesEl.value = '';
  const nameEl = document.getElementById('progress-photo-filename');
  if (nameEl) nameEl.textContent = 'Field photo attached';
  const previewImg = document.getElementById('progress-photo-preview');
  if (previewImg) previewImg.src = '';
  document.getElementById('progress-photo-preview-container')?.classList.add('hidden');
  fieldPhotoBase64 = null;
};

window.openProgressCamera = async function () {
  const boxEl = document.getElementById('progress-camera-box');
  const videoEl = document.getElementById('progress-camera-video');
  const errEl = document.getElementById('progress-camera-error');
  const snapBtn = document.getElementById('btn-snap-progress-photo');

  stopProgressCameraStream();
  if (errEl) {
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }

  if (window.isSecureContext === false) {
    if (errEl) {
      errEl.textContent = 'Camera access requires a secure HTTPS (or localhost) connection.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    if (errEl) {
      errEl.textContent = 'Camera is not supported by this browser or device.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  if (boxEl) boxEl.classList.remove('hidden');
  if (snapBtn) snapBtn.disabled = true;

  try {
    try {
      progressCameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (constraintErr) {
      if (constraintErr && (constraintErr.name === 'OverconstrainedError' || constraintErr.name === 'NotFoundError')) {
        progressCameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else {
        throw constraintErr;
      }
    }

    if (videoEl) {
      videoEl.srcObject = progressCameraStream;
      await videoEl.play();
    }
    if (snapBtn) snapBtn.disabled = false;
  } catch (err) {
    stopProgressCameraStream();
    if (boxEl) boxEl.classList.add('hidden');
    let msg = 'Unable to access the device camera. Please try again or attach a photo file.';
    if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
      msg = 'Camera permission was denied. Allow camera access or attach a photo file.';
    } else if (err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
      msg = 'No camera was detected on this device. You can still attach a photo file.';
    } else if (err && err.name === 'NotReadableError') {
      msg = 'Camera is currently in use by another application.';
    }
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
  }
};

window.closeProgressCamera = function () {
  stopProgressCameraStream();
  document.getElementById('progress-camera-box')?.classList.add('hidden');
};

window.captureProgressCameraPhoto = function () {
  const videoEl = document.getElementById('progress-camera-video');
  const canvasEl = document.getElementById('progress-camera-canvas');
  if (!videoEl || !canvasEl || !videoEl.videoWidth || !videoEl.videoHeight) {
    GeoSafeResponderUI.showToast('Camera preview is not ready yet.', 'warning');
    return;
  }

  const maxDim = 1280;
  let w = videoEl.videoWidth;
  let h = videoEl.videoHeight;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  canvasEl.width = w;
  canvasEl.height = h;
  const ctx = canvasEl.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, w, h);

  fieldPhotoBase64 = canvasEl.toDataURL('image/jpeg', 0.85);
  const nameEl = document.getElementById('progress-photo-filename');
  if (nameEl) nameEl.textContent = 'Camera capture';
  const preview = document.getElementById('progress-photo-preview');
  const container = document.getElementById('progress-photo-preview-container');
  if (preview && container) {
    preview.src = fieldPhotoBase64;
    container.classList.remove('hidden');
  }

  window.closeProgressCamera();
};

window.removeFieldPhoto = function () {
  fieldPhotoBase64 = null;
  const preview = document.getElementById('progress-photo-preview');
  if (preview) preview.src = '';
  document.getElementById('progress-photo-preview-container')?.classList.add('hidden');
};

window.submitProgressUpdate = async function () {
  if (!activeAssignmentDetail || progressUpdateInFlight) return;

  const notesEl = document.getElementById('progress-notes');
  const notes = notesEl?.value?.trim();
  if (!notes) {
    if (window.GeoSafeToast?.flagInvalidField) {
      window.GeoSafeToast.flagInvalidField(notesEl, 'Please enter your field observations before submitting.');
    } else {
      GeoSafeResponderUI.showToast('Please enter your field observations before submitting.', 'warning');
    }
    return;
  }

  const submitBtn = document.getElementById('btn-submit-progress-update');
  progressUpdateInFlight = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
  }

  try {
    await window.geoSafeStore.updateAssignmentStatus(
      activeAssignmentDetail.id,
      'In Progress',
      notes,
      fieldPhotoBase64,
      false
    );

    GeoSafeResponderUI.showToast('Progress update submitted successfully.', 'success');
    closeProgressUpdateModal();

    await loadAssignments();
    await openAssignmentDetails(activeAssignmentDetail.id);
  } catch (err) {
    GeoSafeResponderUI.showToast(err.message || 'Failed to submit progress update.', 'error');
  } finally {
    progressUpdateInFlight = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Update';
    }
  }
};

// ============================================================================
// OPTIONAL PATIENT / EVACUEE TRANSPORT & HANDOVER WORKFLOW
// ============================================================================
let loadedRecommendedFacilities = [];

function escapeOutcomeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRouteDist(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m <= 0) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function formatRouteEta(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return '—';
  const mins = Math.max(1, Math.round(s / 60));
  return `${mins} min`;
}

function renderRescueOutcomePanel(assignment) {
  const section = document.getElementById('dtl-rescue-outcome-section');
  const form = document.getElementById('dtl-outcome-form');
  const legsContainer = document.getElementById('dtl-transport-legs-container');
  if (!section) return;

  const isRescue = assignment && assignment.assignmentType === 'rescue';
  const s = String(assignment?.status || '').toLowerCase();
  const canEdit = isRescue && ['on scene', 'on site', 'in progress'].includes(s);
  const transports = Array.isArray(assignment?.transports) ? assignment.transports : [];

  if (!isRescue || (!canEdit && transports.length === 0)) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  if (legsContainer) {
    if (transports.length > 0) {
      legsContainer.classList.remove('hidden');
      legsContainer.innerHTML = `
        <div class="text-[11px] font-bold text-[#0f172a] uppercase tracking-wider">Transport &amp; Handover Tracking</div>
        ${transports.map((tr) => {
          const statusColor =
            tr.transportStatus === 'Handed Over'
              ? 'bg-emerald-50 text-[#278653] border-emerald-200'
              : tr.transportStatus === 'Arrived'
                ? 'bg-blue-50 text-[#0A58CA] border-blue-200'
                : tr.transportStatus === 'In Transit'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200';
          return `
            <div class="p-2.5 rounded-md border border-slate-200 bg-white space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong class="text-xs text-[#0f172a]">${escapeOutcomeHtml(tr.destinationName)}</strong>
                  <span class="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">${escapeOutcomeHtml(tr.destinationFacilityType)}</span>
                  <span class="ml-1.5 text-[10px] text-[#64748b]">${tr.peopleCount} person(s)</span>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${statusColor}">${escapeOutcomeHtml(tr.transportStatus)}</span>
              </div>
              <div class="text-[10px] text-[#64748b] flex flex-wrap gap-3">
                ${tr.routeDistanceMeters ? `<span>Route: ${formatRouteDist(tr.routeDistanceMeters)} (${formatRouteEta(tr.routeDurationSeconds)})</span>` : ''}
                ${tr.startedAt ? `<span>Started: ${new Date(tr.startedAt).toLocaleTimeString()}</span>` : ''}
                ${tr.arrivedAt ? `<span>Arrived: ${new Date(tr.arrivedAt).toLocaleTimeString()}</span>` : ''}
                ${tr.handedOverAt ? `<span>Handed Over: ${new Date(tr.handedOverAt).toLocaleTimeString()}</span>` : ''}
              </div>
              ${canEdit && tr.transportStatus !== 'Handed Over' && tr.transportStatus !== 'Cancelled' ? `
                <div class="flex flex-wrap items-center gap-1.5 pt-1">
                  ${tr.transportStatus === 'Pending' || tr.transportStatus === 'In Transit' ? `
                    <button type="button" onclick="triggerTransportAction(${tr.id}, 'start')"
                      class="h-7 px-2.5 rounded bg-[#0A58CA] hover:bg-[#084298] text-white text-[11px] font-semibold">
                      ${tr.transportStatus === 'In Transit' ? 'Navigate to Destination' : 'Start Transport &amp; Navigate'}
                    </button>
                  ` : ''}
                  ${tr.transportStatus === 'In Transit' || tr.transportStatus === 'Pending' ? `
                    <button type="button" onclick="triggerTransportAction(${tr.id}, 'arrive')"
                      class="h-7 px-2.5 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 text-[#0A58CA] text-[11px] font-semibold">
                      Mark Arrived
                    </button>
                  ` : ''}
                  ${tr.transportStatus === 'Arrived' ? `
                    <button type="button" onclick="triggerTransportAction(${tr.id}, 'handover')"
                      class="h-7 px-2.5 rounded bg-[#278653] hover:bg-[#1E6E43] text-white text-[11px] font-semibold">
                      Confirm Patient Handover
                    </button>
                  ` : ''}
                  ${tr.transportStatus === 'Pending' ? `
                    <button type="button" onclick="triggerTransportAction(${tr.id}, 'cancel')"
                      class="h-7 px-2.5 rounded border border-red-200 bg-red-50 hover:bg-red-100 text-[#D93636] text-[11px] font-semibold">
                      Remove
                    </button>
                  ` : ''}
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      `;
    } else {
      legsContainer.classList.add('hidden');
      legsContainer.innerHTML = '';
    }
  }

  if (form) {
    form.classList.toggle('hidden', !canEdit);
    if (canEdit) {
      const neededCheck = document.getElementById('out-transport-needed');
      const picker = document.getElementById('out-destination-picker');
      const typeSelect = document.getElementById('out-transport-type');
      const destSelect = document.getElementById('out-rec-destination');
      const statusEl = document.getElementById('out-rec-status');
      loadedRecommendedFacilities = [];
      if (neededCheck) neededCheck.checked = false;
      if (picker) picker.classList.add('hidden');
      if (typeSelect) typeSelect.value = '';
      if (destSelect) {
        destSelect.disabled = true;
        destSelect.innerHTML = '<option value="">Select destination type first...</option>';
      }
      if (statusEl) statusEl.classList.add('hidden');
    }
  }
}

window.toggleOptionalTransportPicker = function () {
  const needed = Boolean(document.getElementById('out-transport-needed')?.checked);
  const picker = document.getElementById('out-destination-picker');
  const typeSelect = document.getElementById('out-transport-type');
  const destSelect = document.getElementById('out-rec-destination');
  const statusEl = document.getElementById('out-rec-status');
  if (picker) picker.classList.toggle('hidden', !needed);
  if (!needed) {
    loadedRecommendedFacilities = [];
    if (typeSelect) typeSelect.value = '';
    if (destSelect) {
      destSelect.disabled = true;
      destSelect.innerHTML = '<option value="">Select destination type first...</option>';
    }
    if (statusEl) statusEl.classList.add('hidden');
  }
};

window.handleTransportTypeChange = function () {
  const recCat = document.getElementById('out-transport-type')?.value || '';
  const destSelect = document.getElementById('out-rec-destination');
  const statusEl = document.getElementById('out-rec-status');
  loadedRecommendedFacilities = [];
  if (!recCat) {
    if (destSelect) {
      destSelect.disabled = true;
      destSelect.innerHTML = '<option value="">Select destination type first...</option>';
    }
    if (statusEl) statusEl.classList.add('hidden');
    return;
  }
  loadOutcomeFacilityRecommendations(recCat);
};

window.loadOutcomeFacilityRecommendations = async function (explicitCategory) {
  const destSelect = document.getElementById('out-rec-destination');
  const statusEl = document.getElementById('out-rec-status');
  const recCat = explicitCategory || document.getElementById('out-transport-type')?.value || '';
  if (!destSelect || !recCat || !activeAssignmentDetail) return;

  const coords = parseValidCoords(activeAssignmentDetail.coordinates);
  if (!coords) {
    loadedRecommendedFacilities = [];
    destSelect.innerHTML = '<option value="">Coordinates unavailable</option>';
    destSelect.disabled = true;
    if (statusEl) {
      statusEl.textContent = 'Incident/rescue coordinates are missing; cannot compute route recommendations.';
      statusEl.className = 'text-[11px] text-[#D93636]';
      statusEl.classList.remove('hidden');
    }
    return;
  }

  destSelect.disabled = true;
  destSelect.innerHTML = '<option value="">Loading eligible destinations...</option>';
  if (statusEl) {
    statusEl.textContent = 'Calculating route distances from PostgreSQL facility directory...';
    statusEl.className = 'text-[11px] text-[#64748b]';
    statusEl.classList.remove('hidden');
  }

  try {
    const res = await fetch(
      `/api/hospitals/recommendations?lat=${encodeURIComponent(coords.lat)}&lng=${encodeURIComponent(coords.lng)}&category=${encodeURIComponent(recCat)}&includeUnverified=true`,
      { credentials: 'include' }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load recommendations');

    const recs = Array.isArray(data.recommendations) ? data.recommendations : [];
    const flagged = Array.isArray(data.flaggedFacilities) ? data.flaggedFacilities : [];
    loadedRecommendedFacilities = recs;

    const eligibleRecs = recs.filter((fac) => fac.isVerified);
    if (recs.length === 0 || eligibleRecs.length === 0) {
      destSelect.innerHTML = '<option value="">No eligible destinations available</option>';
      destSelect.disabled = true;
      if (statusEl) {
        statusEl.textContent = flagged.length
          ? `No verified destinations available (${flagged.length} flagged/unavailable).`
          : 'No eligible destinations registered for this category.';
        statusEl.className = 'text-[11px] text-amber-700';
        statusEl.classList.remove('hidden');
      }
      return;
    }

    destSelect.disabled = false;
    destSelect.innerHTML = [
      '<option value="">Select recommended destination...</option>',
      ...recs.map((fac, idx) => {
        const distPart = fac.routeDistanceMeters
          ? ` — ${formatRouteDist(fac.routeDistanceMeters)}${fac.routeDurationSeconds ? ` (~${formatRouteEta(fac.routeDurationSeconds)})` : ''}`
          : '';
        const unverifiedPart = fac.isVerified ? '' : ' (Unverified)';
        return `<option value="${idx}" ${fac.isVerified ? '' : 'disabled'}>${escapeOutcomeHtml(fac.name)}${escapeOutcomeHtml(distPart)}${unverifiedPart}</option>`;
      }),
    ].join('');

    if (statusEl) {
      if (flagged.length > 0) {
        statusEl.textContent = `${flagged.length} facility record(s) flagged/unavailable and excluded from selection.`;
        statusEl.className = 'text-[10px] text-amber-700';
        statusEl.classList.remove('hidden');
      } else {
        statusEl.classList.add('hidden');
      }
    }
  } catch (err) {
    loadedRecommendedFacilities = [];
    destSelect.innerHTML = '<option value="">Unable to load destinations</option>';
    destSelect.disabled = true;
    if (statusEl) {
      statusEl.textContent = err.message || 'Unable to load destinations.';
      statusEl.className = 'text-[11px] text-[#D93636]';
      statusEl.classList.remove('hidden');
    }
  }
};

let isAddingTransportLeg = false;

window.addOptionalTransportLeg = async function () {
  if (!activeAssignmentDetail || isAddingTransportLeg) return;
  const recCat = document.getElementById('out-transport-type')?.value || '';
  const rawIdx = document.getElementById('out-rec-destination')?.value || '';
  if (!recCat) {
    GeoSafeResponderUI.showToast('Please select a Destination Type.', 'warning');
    return;
  }
  if (rawIdx === '') {
    GeoSafeResponderUI.showToast('Please select a Recommended Transport Destination.', 'warning');
    return;
  }
  const fac = loadedRecommendedFacilities[Number(rawIdx)];
  if (!fac || !fac.isVerified) {
    GeoSafeResponderUI.showToast('Selected destination is not verified.', 'warning');
    return;
  }

  const addBtn = document.getElementById('out-add-transport-btn');
  isAddingTransportLeg = true;
  if (addBtn) addBtn.disabled = true;
  try {
    if (window.geoSafeStore && !window.geoSafeStore.getCsrfToken() && typeof window.geoSafeStore.checkSession === 'function') {
      await window.geoSafeStore.checkSession();
    }
    const data = await window.geoSafeStore.request(
      `/responder/assignments/${encodeURIComponent(activeAssignmentDetail.id)}/transports`,
      {
        method: 'POST',
        body: JSON.stringify({
          destinationCategory: recCat,
          hospitalId: recCat === 'evacuation_center' ? null : fac.id,
          evacuationCenterId: recCat === 'evacuation_center' ? fac.id : null,
          peopleCount: Number(activeAssignmentDetail.peopleCount) || 1,
          routeDistanceMeters: fac.routeDistanceMeters || null,
          routeDurationSeconds: fac.routeDurationSeconds || null,
        }),
      }
    );
    if (!data || !data.success) throw new Error((data && data.error) || 'Failed to add transport destination');

    GeoSafeResponderUI.showToast(`Transport destination added: ${fac.name}`, 'success');
    await loadAssignments();
    await openAssignmentDetails(activeAssignmentDetail.id);
  } catch (err) {
    GeoSafeResponderUI.showToast(err.message || 'Could not add transport destination.', 'error');
  } finally {
    isAddingTransportLeg = false;
    if (addBtn) addBtn.disabled = false;
  }
};

window.triggerTransportAction = async function (transportId, action) {
  if (!activeAssignmentDetail) return;
  let handoverNotes = '';
  let handoverConfirmed = false;
  if (action === 'handover') {
    handoverConfirmed = window.confirm('Confirm that rescued individual(s) have been safely handed over at the destination?');
    if (!handoverConfirmed) return;
    handoverNotes = window.prompt('Optional handover notes (receiving unit / remarks):', '') || '';
  }

  try {
    if (window.geoSafeStore && !window.geoSafeStore.getCsrfToken() && typeof window.geoSafeStore.checkSession === 'function') {
      await window.geoSafeStore.checkSession();
    }
    const data = await window.geoSafeStore.request(
      `/responder/assignments/${encodeURIComponent(activeAssignmentDetail.id)}/transports/${transportId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ action, handoverConfirmed, handoverNotes }),
      }
    );
    if (!data || !data.transport) throw new Error((data && data.error) || 'Failed to update transport leg');

    GeoSafeResponderUI.showToast(`Transport updated: ${data.transport.transportStatus}`, 'success');

    if (action === 'start' && data.transport && Number.isFinite(data.transport.latitude) && Number.isFinite(data.transport.longitude)) {
      if (Array.isArray(activeAssignmentDetail.transports)) {
        activeAssignmentDetail.transports = activeAssignmentDetail.transports.map((t) =>
          Number(t.id) === Number(data.transport.id) ? data.transport : t
        );
      }
      renderRescueOutcomePanel(activeAssignmentDetail);
      renderActionButtons(activeAssignmentDetail.status);

      const destTarget = {
        ...activeAssignmentDetail,
        _isTransportNavigation: true,
        _transportLeg: data.transport,
        coordinates: { lat: data.transport.latitude, lng: data.transport.longitude },
        location: data.transport.destinationName,
      };
      initDetailMap(destTarget);
      document.getElementById('dtl-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      if (Array.isArray(activeAssignmentDetail.transports)) {
        activeAssignmentDetail.transports = activeAssignmentDetail.transports
          .map((t) => (Number(t.id) === Number(data.transport.id) ? data.transport : t))
          .filter((t) => t.transportStatus !== 'Cancelled');
      }
      renderRescueOutcomePanel(activeAssignmentDetail);
      renderActionButtons(activeAssignmentDetail.status);

      if (action === 'arrive' || action === 'handover' || action === 'cancel') {
        if (navState.activeTransportLeg && Number(navState.activeTransportLeg.id) === Number(transportId)) {
          stopAssignmentNavigation({ clearRoute: true });
        }
      }
      await loadAssignments();
      await openAssignmentDetails(activeAssignmentDetail.id);
    }
  } catch (err) {
    GeoSafeResponderUI.showToast(err.message || 'Transport update failed.', 'error');
  }
};

