/**
 * GeoSafe - Responder Profile Logic (Sections 7, 8 & 10)
 * ============================================================================
 * Features:
 * - Real authenticated responder profile data
 * - Availability toggle: On Duty, Off Duty, Unavailable
 * - Contact info & Unit Equipment details
 * - Strict Role-Based Access Control and limitation notices
 * - Portal switcher & session logout
 * ============================================================================
 */

let currentProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize UI Shell
  GeoSafeResponderUI.init('profile', 'Responder Profile');

  // Load Profile Data
  await loadResponderProfile();

  // Listen for external availability updates
  window.addEventListener('geosafe:responder-availability', (e) => {
    updateAvailabilityUi(e.detail.status);
  });
});

async function loadResponderProfile() {
  const loadingEl = document.getElementById('profile-loading');
  const contentEl = document.getElementById('profile-content');

  // Verify responder authentication and role
  const auth = await GeoSafeResponderUI.verifyResponderSession();
  if (!auth.authorized) {
    if (loadingEl) loadingEl.classList.add('hidden');
    const mainEl = document.querySelector('main');
    GeoSafeResponderUI.renderUnauthorizedScreen(mainEl);
    return;
  }

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (contentEl) contentEl.classList.add('hidden');

  try {
    currentProfile = await window.geoSafeStore.getResponderProfile();

    populateProfileFields(currentProfile);

    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
  } catch (err) {
    console.error('[ResponderProfile] Error loading profile:', err);
    GeoSafeResponderUI.showToast('Could not load responder profile data.', 'error');
  }
}

function populateProfileFields(p) {
  p = p || {};

  const nameEl = document.getElementById('prof-full-name');
  const badgeEl = document.getElementById('prof-badge-number');
  const unitEl = document.getElementById('prof-unit-name');
  const callsignEl = document.getElementById('prof-callsign');
  const phoneEl = document.getElementById('prof-phone');
  const emailEl = document.getElementById('prof-email');
  const vehicleEl = document.getElementById('prof-vehicle');
  const avatarEl = document.getElementById('prof-avatar-text');

  const fullName = `${p.firstName || ''} ${p.lastName || ''}`.trim();
  if (nameEl) nameEl.textContent = fullName || 'Responder Profile (Incomplete)';
  if (badgeEl) badgeEl.textContent = p.badgeNumber || p.id || 'Not Assigned';
  if (unitEl) unitEl.textContent = p.department || p.assignedUnit || 'No Unit Assigned';
  if (callsignEl) callsignEl.textContent = p.callsign || 'None';
  if (phoneEl) phoneEl.textContent = p.phone || 'None provided';
  if (emailEl) emailEl.textContent = p.email || 'None provided';
  if (vehicleEl) vehicleEl.textContent = p.unitVehicle || 'None assigned';

  if (avatarEl) {
    let initials = '';
    if (p.firstName) initials += p.firstName.trim()[0];
    if (p.lastName) initials += p.lastName.trim()[0];
    avatarEl.textContent = (initials || '—').toUpperCase();
  }

  // Populate skills
  const skillsList = document.getElementById('prof-skills-list');
  if (skillsList) {
    const skills = p.skills || [];
    if (skills.length === 0) {
      skillsList.innerHTML = `<span class="text-xs text-[#777777] italic">No specialized certifications recorded.</span>`;
    } else {
      skillsList.innerHTML = skills.map(s => `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-[#FFF9E8] text-[#8A6800] border border-[#FFE872]">
          <svg class="w-3 h-3 text-[#F5B900]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          <span>${s}</span>
        </span>
      `).join('');
    }
  }

  updateAvailabilityUi(p.availability || 'Not Set');
}

function updateAvailabilityUi(status) {
  const badge = document.getElementById('prof-duty-badge');
  const optOnDuty = document.getElementById('opt-duty-on');
  const optUnavailable = document.getElementById('opt-duty-unavail');
  const optOffDuty = document.getElementById('opt-duty-off');

  if (badge) {
    badge.textContent = status || 'Not Set';
    if (status === 'On Duty') {
      badge.className = 'px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-[#278653] border border-emerald-300';
    } else if (status === 'Off Duty') {
      badge.className = 'px-3 py-1 rounded-full text-xs font-black bg-slate-200 text-slate-700 border border-slate-300';
    } else if (status === 'Unavailable') {
      badge.className = 'px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-[#E99524] border border-amber-300';
    } else {
      badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200';
    }
  }

  // Update selection button styles
  const allOpts = [
    { el: optOnDuty, val: 'On Duty', activeCls: 'border-emerald-500 bg-emerald-50 font-bold text-emerald-900 ring-2 ring-emerald-200' },
    { el: optUnavailable, val: 'Unavailable', activeCls: 'border-amber-500 bg-amber-50 font-bold text-amber-900 ring-2 ring-amber-200' },
    { el: optOffDuty, val: 'Off Duty', activeCls: 'border-slate-400 bg-slate-100 font-bold text-slate-800 ring-2 ring-slate-200' }
  ];

  allOpts.forEach(o => {
    if (o.el) {
      if (o.val === status) {
        o.el.className = `p-3 rounded-2xl border-2 text-left transition-all flex items-center justify-between ${o.activeCls}`;
      } else {
        o.el.className = 'p-3 rounded-2xl border border-[#EEEEEE] bg-white text-left transition-all hover:bg-[#FFF9E8] flex items-center justify-between';
      }
    }
  });
}

window.selectAvailability = async function (status) {
  try {
    if (window.geoSafeStore) {
      await window.geoSafeStore.updateResponderAvailability(status);
      updateAvailabilityUi(status);
      GeoSafeResponderUI.showToast(`Duty availability updated to "${status}".`, 'success');
    }
  } catch (err) {
    GeoSafeResponderUI.showToast(err.message || 'Failed to update availability.', 'error');
  }
};

window.handleResponderLogout = async function () {
  if (window.geoSafeStore) {
    await window.geoSafeStore.logoutResponder();
  }
  GeoSafeResponderUI.showToast('Ending responder session. Redirecting...', 'info');
  setTimeout(() => {
    window.location.href = 'index.html';
  }, 600);
};

