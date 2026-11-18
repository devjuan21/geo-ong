/**
 * GeoSafe - Rescue Requests Dedicated Emergency Page Logic
 */

let rescueRequestsLoadSeq = 0;

function escapeRescueHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeDispatchUpdate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = String(raw.status || raw.title || '').trim();
  const note = String(raw.note || raw.message || raw.text || '').trim();
  const timestamp = raw.timestamp || raw.createdAt || raw.time || null;
  const author = String(raw.author || '').trim();

  if (!status && !note) {
    console.warn('[RescueRequests] Skipping incomplete dispatch update record:', raw);
    return null;
  }

  return {
    id: raw.id || null,
    status: status || 'Dispatch Update',
    note,
    timestamp,
    author,
  };
}

function formatDispatchTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeUI.init('rescue-requests', 'Rescue Requests');
  setupRescueForm();
  await loadRescueRequests();

  const rescueRealtimeEvents = new Set([
    'new-rescue-request',
    'rescue-assignment-updated',
    'rescue-status-updated',
    'status-update',
    'assignment:outcome',
    'rescue:transport-updated',
    'reconnect-sync',
  ]);
  window.addEventListener('geosafe:realtime-update', (ev) => {
    const evtName = ev && ev.detail ? ev.detail.event : '';
    if (!evtName || rescueRealtimeEvents.has(evtName)) {
      loadRescueRequests();
    }
  });
});

async function loadRescueRequests() {
  const reqSeq = ++rescueRequestsLoadSeq;
  const loadingEl = document.getElementById('rescue-loading');
  const errorEl = document.getElementById('rescue-error');
  const emptyEl = document.getElementById('rescue-empty');
  const container = document.getElementById('rescue-list-container');

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');
  if (container) container.classList.add('hidden');

  try {
    const list = await window.geoSafeStore.getRescueRequests();
    if (reqSeq !== rescueRequestsLoadSeq) return;
    if (loadingEl) loadingEl.classList.add('hidden');

    if (!Array.isArray(list) || list.length === 0) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (container) {
      container.classList.remove('hidden');
      renderRescueCards(list);
    }
  } catch (err) {
    if (reqSeq !== rescueRequestsLoadSeq) return;
    console.error('Failed to load rescue requests:', err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) {
      errorEl.classList.remove('hidden');
      const errText = document.getElementById('rescue-error-text');
      if (errText) {
        errText.textContent = err.isOffline
          ? 'Network offline. An active internet connection is required to check rescue status.'
          : 'Failed to retrieve rescue requests. Please retry.';
      }
    }
  }
}

function renderRescueCards(requests) {
  const listEl = document.getElementById('rescue-cards-list');
  if (!listEl) return;

  listEl.innerHTML = requests.map(r => `
    <div class="bg-white rounded-lg border border-slate-200 shadow-subtle p-5 sm:p-6 transition-all hover:hover:border-slate-300">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-md bg-emergency-100 text-emergency-600 flex items-center justify-center flex-shrink-0">
            ${GeoSafeUI.getIcon('life-buoy', 'w-6 h-6 text-emergency-600')}
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-mono text-sm font-bold text-slate-900">${r.id}</span>
              ${GeoSafeUI.renderPriorityBadge(r.priority)}
            </div>
            <p class="text-xs text-slate-400 mt-0.5">Requested: ${GeoSafeUI.formatDate(r.requestDate)}</p>
          </div>
        </div>

        <div>
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${r.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-emergency-50 text-emergency-700 border border-emergency-200 animate-pulse'}">
            <span class="w-1.5 h-1.5 rounded-full ${r.status === 'Completed' ? 'bg-emerald-500' : 'bg-red-500'}"></span>
            <span>${r.status}</span>
          </span>
        </div>
      </div>

      <!-- Core Details -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 my-4 text-xs">
        <div>
          <span class="text-slate-400 font-medium block">Emergency Type:</span>
          <span class="text-slate-900 font-bold text-sm mt-0.5 block">${r.emergencyType}</span>
          <p class="text-slate-600 mt-1 leading-relaxed">${r.description}</p>
        </div>
        <div class="space-y-2 bg-slate-50 p-3.5 rounded-md border border-slate-200/60">
          <div>
            <span class="text-slate-500 font-medium">Persons Needing Assistance:</span>
            <span class="font-bold text-slate-900 ml-1">${r.peopleCountDisplay || (r.peopleCountCategory === 'more_than_10' ? 'More than 10' : r.peopleCountCategory === 'unknown' || !r.peopleCount ? 'Unknown' : `${r.peopleCount} individuals`)}</span>
          </div>
          ${r.vulnerableDetails ? `
            <div>
              <span class="text-slate-500 font-medium">Vulnerable Details:</span>
              <span class="font-semibold text-emergency-700 ml-1">${r.vulnerableDetails}</span>
            </div>
          ` : ''}
          <div>
            <span class="text-slate-500 font-medium">Location:</span>
            <span class="font-medium text-slate-800 ml-1">${r.location}</span>
          </div>
          ${r.landmark ? `
            <div>
              <span class="text-slate-500 font-medium">Landmark:</span>
              <span class="font-medium text-slate-800 ml-1">${r.landmark}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Assigned Unit & Contact -->
      <div class="p-3.5 bg-brand-50/70 border border-brand-100 rounded-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs mb-4">
        <div>
          <span class="text-[10px] font-bold text-brand-700 uppercase tracking-wider block">Assigned Rescue Unit</span>
          ${(r.assignedUnit || r.assignedResponderName) ? `
            <span class="text-xs font-bold text-slate-900">${escapeRescueHtml(r.assignedUnit || 'Barangay Bayanan Response Unit')}</span>
            <p class="text-[11px] text-slate-600">${escapeRescueHtml(r.responderContact || `Responder: ${r.assignedResponderName}`)}</p>
          ` : (r.status === 'Completed' || r.status === 'Cancelled') ? `
            <span class="text-xs font-bold text-slate-900">Operation ${escapeRescueHtml(r.status)}</span>
            <p class="text-[11px] text-slate-500">No active unit assignment</p>
          ` : `
            <span class="text-xs font-bold text-slate-900">Pending Dispatch</span>
            <p class="text-[11px] text-slate-500">Awaiting responder assignment from Barangay Bayanan EOC</p>
          `}
        </div>
        <div class="text-[11px] text-slate-500">
          <span class="italic text-[10px] text-slate-400 block sm:text-right">*Official priority assigned by Barangay Bayanan EOC</span>
        </div>
      </div>

      <!-- Live Operations Updates -->
      <div>
        <h5 class="text-xs font-bold text-slate-800 mb-2">Live Dispatch Updates</h5>
        <div class="space-y-2.5">
          ${(() => {
            const normalizedUpdates = (Array.isArray(r.updates) ? r.updates : [])
              .map(normalizeDispatchUpdate)
              .filter(Boolean);
            if (normalizedUpdates.length === 0) {
              return '<p class="text-xs text-slate-500 italic">No dispatch updates yet.</p>';
            }
            return normalizedUpdates.map((up) => {
              const formattedTime = formatDispatchTimestamp(up.timestamp);
              const metaParts = [formattedTime, up.author].filter(Boolean);
              return `
                <div class="flex items-start gap-2.5 text-xs">
                  <span class="w-1.5 h-1.5 rounded-full bg-emergency-500 flex-shrink-0 mt-1.5"></span>
                  <div class="min-w-0">
                    <span class="text-slate-900 font-bold block">${escapeRescueHtml(up.status)}</span>
                    ${up.note ? `<p class="text-slate-700 leading-snug mt-0.5">${escapeRescueHtml(up.note)}</p>` : ''}
                    ${metaParts.length > 0 ? `<span class="text-[11px] text-slate-500 block mt-0.5">${escapeRescueHtml(metaParts.join(' · '))}</span>` : ''}
                  </div>
                </div>
              `;
            }).join('');
          })()}
        </div>
      </div>
    </div>
  `).join('');
}

function setupRescueForm() {
  const form = document.getElementById('rescue-request-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const emergencyType = document.getElementById('rescue-type').value;
    const description = document.getElementById('rescue-desc').value.trim();
    const peopleCount = document.getElementById('rescue-people').value;
    const vulnerable = document.getElementById('rescue-vulnerable').value.trim();
    const location = document.getElementById('rescue-location').value.trim();
    const landmark = document.getElementById('rescue-landmark').value.trim();

    if (!emergencyType || !description || !peopleCount || !location) {
      GeoSafeUI.showToast('Please provide all essential rescue details.', 'error');
      return;
    }

    if (!window.geoSafeStore.isOnline()) {
      GeoSafeUI.showToast('No internet connection. Cannot transmit rescue request.', 'error');
      return;
    }

    const submitBtn = document.getElementById('btn-submit-rescue');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<svg class="animate-spin w-4 h-4 mr-2 inline-block text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Transmitting Emergency Request...`;
    }

    try {
      const rawPeople = String(peopleCount || '').trim().toLowerCase();
      const peopleCountCategory =
        rawPeople === 'unknown'
          ? 'unknown'
          : rawPeople === 'more_than_10'
            ? 'more_than_10'
            : 'exact';
      const payload = {
        emergencyType,
        description,
        peopleCount: peopleCountCategory === 'exact' ? parseInt(rawPeople, 10) : peopleCountCategory,
        peopleCountCategory,
        vulnerableDetails: vulnerable,
        location,
        landmark,
        coordinates: { lat: 14.4085, lng: 121.0521 }
      };

      const result = await window.geoSafeStore.submitRescueRequest(payload);
      closeRescueModal();
      form.reset();

      GeoSafeUI.showToast(`Emergency Rescue Request #${result.id} transmitted to EOC.`, 'success');
      await loadRescueRequests();
    } catch (err) {
      console.error(err);
      GeoSafeUI.showToast('Failed to transmit request. Check internet connection.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `Confirm & Transmit Rescue Request`;
      }
    }
  });
}

window.openRescueModal = function () {
  const modal = document.getElementById('rescue-request-modal');
  if (modal) modal.classList.remove('hidden');
};

window.closeRescueModal = function () {
  const modal = document.getElementById('rescue-request-modal');
  if (modal) modal.classList.add('hidden');
};

window.autofillRescueGps = function () {
  const locInput = document.getElementById('rescue-location');
  const btn = document.getElementById('btn-rescue-gps');

  if (!navigator.geolocation) {
    GeoSafeUI.showToast('Geolocation not available in browser.', 'warning');
    return;
  }

  if (btn) btn.textContent = 'Locating...';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      if (locInput) {
        locInput.value = `GPS (${latitude.toFixed(5)}, ${longitude.toFixed(5)}), Barangay Bayanan`;
      }
      if (btn) {
        btn.innerHTML = `<svg class="w-3.5 h-3.5 mr-1 inline-block text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg> GPS Acquired`;
      }
      GeoSafeUI.showToast('Current GPS coordinates attached.', 'success');
    },
    () => {
      if (btn) btn.textContent = 'Get GPS';
      GeoSafeUI.showToast('Could not acquire GPS. Please type the address manually.', 'warning');
    },
    { enableHighAccuracy: true, timeout: 6000 }
  );
};

window.loadRescueRequests = loadRescueRequests;

