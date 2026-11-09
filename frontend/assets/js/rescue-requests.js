/**
 * GeoSafe - Rescue Requests Dedicated Emergency Page Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeUI.init('rescue-requests', 'Rescue Requests');
  setupRescueForm();
  await loadRescueRequests();
});

async function loadRescueRequests() {
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
    if (loadingEl) loadingEl.classList.add('hidden');

    if (!list || list.length === 0) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (container) {
      container.classList.remove('hidden');
      renderRescueCards(list);
    }
  } catch (err) {
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
    <div class="bg-white rounded-2xl border border-slate-200 shadow-card p-5 sm:p-6 transition-all hover:shadow-card-hover">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-emergency-100 text-emergency-600 flex items-center justify-center flex-shrink-0">
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
        <div class="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-slate-200/60">
          <div>
            <span class="text-slate-500 font-medium">Persons Needing Assistance:</span>
            <span class="font-bold text-slate-900 ml-1">${r.peopleCount} individuals</span>
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
      <div class="p-3.5 bg-brand-50/70 border border-brand-100 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs mb-4">
        <div>
          <span class="text-[10px] font-bold text-brand-700 uppercase tracking-wider block">Assigned Rescue Unit</span>
          <span class="text-xs font-bold text-slate-900">${r.assignedUnit || 'Dispatching Unit...'}</span>
          <p class="text-[11px] text-slate-500">${r.responderContact || 'Pending dispatcher contact'}</p>
        </div>
        <div class="text-[11px] text-slate-500">
          <span class="italic text-[10px] text-slate-400 block sm:text-right">*Official priority assigned by Barangay Bayanan EOC</span>
        </div>
      </div>

      <!-- Live Operations Updates -->
      <div>
        <h5 class="text-xs font-bold text-slate-800 mb-2">Live Dispatch Updates</h5>
        <div class="space-y-2">
          ${(r.updates || []).map(up => `
            <div class="flex items-start gap-2.5 text-xs">
              <span class="w-1.5 h-1.5 rounded-full bg-emergency-500 flex-shrink-0 mt-1.5"></span>
              <div>
                <span class="text-slate-700 font-medium">${up.text}</span>
                <span class="text-[10px] text-slate-400 block">${GeoSafeUI.formatRelative(up.time)}</span>
              </div>
            </div>
          `).join('')}
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
      const payload = {
        emergencyType,
        description,
        peopleCount: parseInt(peopleCount, 10),
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

