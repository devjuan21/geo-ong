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

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize UI Shell
  GeoSafeResponderUI.init('assignments', 'Assignments');

  // Load and render assignments
  await loadAssignments();

  // Check URL query parameters for direct assignment opening (e.g. ?id=REP-2026-104)
  const urlParams = new URLSearchParams(window.location.search);
  const targetId = urlParams.get('id');
  if (targetId) {
    setTimeout(() => openAssignmentDetails(targetId), 250);
  }
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
    const isCritical = (a.priority || '').toLowerCase() === 'critical';
    const isHigh = (a.priority || '').toLowerCase() === 'high';

    let prioBadge = 'bg-slate-100 text-slate-700 border-slate-200';
    if (isCritical) prioBadge = 'bg-[#FFF1F1] text-[#D93636] border-[#FFC2C2] font-black';
    else if (isHigh) prioBadge = 'bg-[#FFF8E1] text-[#E99524] border-[#FFE082] font-bold';
    else if ((a.priority || '').toLowerCase() === 'medium') prioBadge = 'bg-sky-50 text-sky-700 border-sky-200';

    let statusBadge = 'bg-slate-100 text-slate-700 border-slate-200';
    const s = (a.status || '').toLowerCase();
    if (s === 'en route' || s === 'responding') statusBadge = 'bg-blue-50 text-[#3478C7] border-blue-200 font-bold';
    else if (s === 'on scene') statusBadge = 'bg-amber-50 text-[#E99524] border-amber-200 font-bold';
    else if (s === 'accepted') statusBadge = 'bg-purple-50 text-purple-700 border-purple-200';
    else if (s === 'completed' || s === 'resolved') statusBadge = 'bg-emerald-50 text-[#278653] border-emerald-200';

    return `
      <div onclick="openAssignmentDetails('${a.id}')" class="bg-white rounded-3xl p-4 sm:p-5 border ${isCritical ? 'border-[#FFC2C2] shadow-emergency-glow ring-1 ring-[#FFC2C2]' : 'border-[#EEEEEE] shadow-card'} transition-all hover:border-[#F5B900] cursor-pointer space-y-3">
        
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs sm:text-sm font-black text-[#202020]">${a.referenceNumber || a.id}</span>
            <span class="text-[9px] font-black px-2 py-0.5 rounded-full uppercase border ${isRescue ? 'bg-[#FFF1F1] text-[#D93636] border-[#FFC2C2]' : 'bg-[#FFF9E8] text-[#8A6800] border-[#FFE872]'}">
              ${isRescue ? 'Rescue Request' : 'Incident Report'}
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <span class="text-[10px] uppercase px-2 py-0.5 rounded-full border ${prioBadge}">
              ${a.priority || 'Normal'}
            </span>
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
    document.getElementById('dtl-prio-badge').textContent = assignment.priority || 'Normal';
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

    // Initialize or re-center detail Leaflet Map
    setTimeout(() => {
      initDetailMap(assignment.coordinates);
    }, 150);

  } catch (err) {
    GeoSafeResponderUI.showToast(err.message || 'Could not open assignment details.', 'error');
  }
};

window.closeAssignmentDetails = function () {
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
      <button type="button" onclick="confirmStatusChange('En Route')" class="flex-1 py-2.5 px-4 rounded-2xl bg-[#3478C7] hover:bg-[#2764AB] text-white font-black text-xs shadow-subtle transition-all flex items-center justify-center gap-1.5">
        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1" stroke-width="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 8" stroke-width="2"></polygon><circle cx="5.5" cy="18.5" r="2.5" stroke-width="2"></circle><circle cx="18.5" cy="18.5" r="2.5" stroke-width="2"></circle></svg>
        <span>Mark as En Route</span>
      </button>
    `;
  } else if (s === 'en route' || s === 'responding') {
    buttonsHtml = `
      <button type="button" onclick="confirmStatusChange('On Scene')" class="flex-1 py-2.5 px-4 rounded-2xl bg-[#E99524] hover:bg-[#CE7E16] text-white font-black text-xs shadow-subtle transition-all flex items-center justify-center gap-1.5">
        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path></svg>
        <span>Mark as On Scene</span>
      </button>
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

function initDetailMap(coords) {
  const container = document.getElementById('dtl-map');
  if (!container || typeof L === 'undefined') return;

  const targetCoords = coords && coords.lat ? [coords.lat, coords.lng] : [14.4075, 121.0475];

  if (!detailMap) {
    try {
      detailMap = GeoSafeMapping.createMap('dtl-map', {
        center: targetCoords,
        zoom: 16,
        scrollWheelZoom: false
      });
      const icon = GeoSafeMapping.createCustomIcon('incident');
      detailMarker = L.marker(targetCoords, { icon }).addTo(detailMap);
    } catch (e) {
      console.warn('Map initialization failed:', e);
    }
  } else {
    detailMap.invalidateSize();
    detailMap.setView(targetCoords, 16);
    if (detailMarker) detailMarker.setLatLng(targetCoords);
  }
}

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
    GeoSafeResponderUI.showToast(`Assignment status updated to "${targetStatus}".`, 'success');
    
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

