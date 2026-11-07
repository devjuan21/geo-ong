/**
 * GeoSafe - My Profile Page Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeUI.init('profile', 'My Profile');
  setupProfileForm();
  await loadProfileData();
});

async function loadProfileData() {
  const loadingEl = document.getElementById('profile-loading');
  const errorEl = document.getElementById('profile-error');
  const container = document.getElementById('profile-container');

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  if (container) container.classList.add('hidden');

  try {
    const profile = await window.geoSafeStore.getProfile();
    if (loadingEl) loadingEl.classList.add('hidden');
    if (container) container.classList.remove('hidden');

    populateProfileForm(profile);
  } catch (err) {
    console.error(err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) {
      errorEl.classList.remove('hidden');
      const msg = document.getElementById('profile-error-text');
      if (msg) {
        msg.textContent = err.isOffline
          ? 'Network offline. An active connection is required to retrieve profile data.'
          : 'Failed to load profile.';
      }
    }
  }
}

function populateProfileForm(profile) {
  profile = profile || {};
  document.getElementById('profile-fname').value = profile.firstName || '';
  document.getElementById('profile-lname').value = profile.lastName || '';
  document.getElementById('profile-email').value = profile.email || '';
  document.getElementById('profile-phone').value = profile.phone || '';
  
  if (profile.address) {
    document.getElementById('profile-street').value = profile.address.street || '';
    document.getElementById('profile-barangay').value = profile.address.barangay || 'Barangay Bayanan';
    document.getElementById('profile-city').value = profile.address.city || 'Muntinlupa City';
  }

  const nameEl = document.getElementById('profile-page-name');
  if (nameEl) {
    nameEl.textContent = (profile.firstName && profile.lastName)
      ? `${profile.firstName} ${profile.lastName}`
      : (profile.firstName || 'Resident Profile');
  }

  const avatarEl = document.getElementById('profile-page-avatar');
  if (avatarEl) {
    if (profile.firstName && profile.lastName) {
      avatarEl.textContent = `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase();
    } else {
      avatarEl.innerHTML = `<svg class="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>`;
    }
  }

  const idEl = document.getElementById('profile-resident-id');
  if (idEl) idEl.textContent = profile.barangayIdNumber || 'Pending Setup';

  const badgeEl = document.getElementById('profile-status-badge');
  if (badgeEl) {
    const isVerified = profile.verificationStatus && profile.verificationStatus.toLowerCase().includes('verified') && !profile.verificationStatus.toLowerCase().includes('unverified');
    badgeEl.textContent = profile.verificationStatus || 'Unverified Resident';
    badgeEl.className = `px-2 py-0.5 rounded-full text-xs font-semibold ${isVerified ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`;
  }

  if (profile.emergencyContact) {
    document.getElementById('profile-em-name').value = profile.emergencyContact.name || '';
    document.getElementById('profile-em-rel').value = profile.emergencyContact.relationship || '';
    document.getElementById('profile-em-phone').value = profile.emergencyContact.phone || '';
  }

  document.getElementById('profile-medical').value = profile.medicalNotes || '';
}

function setupProfileForm() {
  const form = document.getElementById('resident-profile-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!window.geoSafeStore.isOnline()) {
      GeoSafeUI.showToast('No internet connection. Profile updates require network connectivity.', 'error');
      return;
    }

    const updates = {
      firstName: document.getElementById('profile-fname').value.trim(),
      lastName: document.getElementById('profile-lname').value.trim(),
      email: document.getElementById('profile-email').value.trim(),
      phone: document.getElementById('profile-phone').value.trim(),
      address: {
        street: document.getElementById('profile-street').value.trim(),
        barangay: document.getElementById('profile-barangay').value,
        city: document.getElementById('profile-city').value,
        province: 'Metro Manila',
        postalCode: '1772'
      },
      emergencyContact: {
        name: document.getElementById('profile-em-name').value.trim(),
        relationship: document.getElementById('profile-em-rel').value.trim(),
        phone: document.getElementById('profile-em-phone').value.trim()
      },
      medicalNotes: document.getElementById('profile-medical').value.trim()
    };

    const submitBtn = document.getElementById('btn-save-profile');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<svg class="animate-spin w-3.5 h-3.5 mr-1 inline-block text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Saving Changes...`;
    }

    try {
      const saved = await window.geoSafeStore.updateProfile(updates);
      populateProfileForm(saved);
      if (window.GeoSafeUI && window.GeoSafeUI.updateUserHeader) {
        window.GeoSafeUI.updateUserHeader(saved);
      }
      GeoSafeUI.showToast('Resident profile details saved successfully.', 'success');
    } catch (err) {
      GeoSafeUI.showToast('Failed to update profile.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `Save Changes`;
      }
    }
  });
}

window.loadProfileData = loadProfileData;

