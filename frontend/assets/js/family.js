/**
 * GeoSafe - Family Safety Tracker & Address Manager (Revised UI)
 * ============================================================================
 * Layout Hierarchy:
 * 1. Family Header (Family name, member count, Generate QR action)
 * 2. Family Address (Saved address display / compact address form, Edit action)
 * 3. Family Members (Compact cards: name, relationship, role, sharing status)
 * 4. Pending Requests (Manager review approval/rejection)
 * 
 * ZERO map visualization on this page.
 * ZERO emojis.
 * ============================================================================
 */

let currentFamilyData = null;
let validatedInviteData = null;
let isAddressEditMode = false;

// Fixed location coverage constants (Barangay Bayanan, Muntinlupa City)
const FIXED_LOCATION = {
  barangay: 'Bayanan',
  city: 'Muntinlupa City',
  province: 'Metro Manila',
  region: 'National Capital Region',
  country: 'Philippines',
  formattedAdmin: 'Barangay Bayanan, Muntinlupa City, Metro Manila, Philippines'
};

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize shell navigation
  if (typeof GeoSafeComponents !== 'undefined' && GeoSafeComponents.init) {
    GeoSafeComponents.init('family', 'Family Safety Tracker');
  } else if (typeof GeoSafeUI !== 'undefined' && GeoSafeUI.init) {
    GeoSafeUI.init('family', 'Family Safety Tracker');
  }

  // 2. Load family data
  await loadFamilySafetyTracker();

  // 3. Check for incoming invitation in URL query param (?invite=<token>)
  checkUrlInvitation();
});

/**
 * Toast Notification (Fixed Viewport Center)
 */
function showToast(message, type = 'success', duration = 4000) {
  if (typeof window !== 'undefined' && window.GeoSafeToast) {
    return window.GeoSafeToast.show({ message, type, duration });
  }
  const container = document.getElementById('toast-container');
  if (!container) return;

  const isSuccess = type === 'success';
  const toast = document.createElement('div');
  toast.className = `pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-2xl shadow-modal text-xs font-bold transition-all duration-300 transform -translate-y-2 opacity-0 ${
    isSuccess
      ? 'bg-[#278653] text-white border border-emerald-600'
      : 'bg-[#D93636] text-white border border-red-600'
  }`;

  const iconSvg = isSuccess
    ? `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`
    : `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"></circle><line x1="12" y1="8" x2="12" y2="12" stroke-width="2" stroke-linecap="round"></line><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2" stroke-linecap="round"></line></svg>`;

  toast.innerHTML = `${iconSvg}<span>${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('-translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('-translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * Load Family Safety Tracker Data
 */
async function loadFamilySafetyTracker() {
  const loadingEl = document.getElementById('family-loading-state');
  const noFamilyEl = document.getElementById('no-family-state');
  const activeFamilyEl = document.getElementById('active-family-container');

  if (loadingEl) loadingEl.classList.remove('hidden');

  try {
    const data = await window.geoSafeStore.getMyFamily();
    currentFamilyData = data;

    if (loadingEl) loadingEl.classList.add('hidden');

    if (!data || !data.family) {
      if (noFamilyEl) noFamilyEl.classList.remove('hidden');
      if (activeFamilyEl) activeFamilyEl.classList.add('hidden');
      return;
    }

    if (noFamilyEl) noFamilyEl.classList.add('hidden');
    if (activeFamilyEl) activeFamilyEl.classList.remove('hidden');

    const isManager = !!data.family.is_manager;

    // 1. Render Family Header
    renderFamilyHeader(data, isManager);

    // 2. Render Family Address
    renderFamilyAddress(data.family.address, isManager);

    // 3. Render Family Members Directory
    renderMembersDirectory(data.members || [], isManager);

    // 4. Render Pending Join Requests
    renderPendingRequests(data.pendingRequests || [], isManager);

  } catch (err) {
    console.error('Failed to load family data:', err);
    if (loadingEl) loadingEl.classList.add('hidden');
    showToast(err.message || 'Failed to load family tracker data.', 'error');
  }
}

/**
 * 1. Render Family Header (Family name, member count, QR action)
 */
function renderFamilyHeader(data, isManager) {
  const nameEl = document.getElementById('header-family-name');
  const countBadge = document.getElementById('header-member-count-badge');
  const roleBadge = document.getElementById('header-role-badge');
  const actionContainer = document.getElementById('header-action-buttons');

  const members = data.members || [];

  if (nameEl) nameEl.textContent = data.family.family_name || 'Family Circle';
  if (countBadge) countBadge.textContent = `${members.length} member${members.length === 1 ? '' : 's'}`;
  if (roleBadge) {
    roleBadge.textContent = isManager ? 'Household Manager' : 'Household Member';
  }

  if (actionContainer) {
    let managerAction = '';
    if (isManager) {
      managerAction = `
        <button onclick="openGenerateQRModal()" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] font-black text-xs shadow-subtle transition-all active:scale-95">
          <svg class="w-3.5 h-3.5 text-[#202020]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"></path></svg>
          <span>Generate QR</span>
        </button>
      `;
    }

    actionContainer.innerHTML = `
      ${managerAction}
      <button onclick="handleLeaveFamily()" class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-[#FFC2C2] text-[#D93636] hover:bg-[#FFF1F1] font-bold text-xs transition-colors" title="Leave family group">
        <span>Leave</span>
      </button>
    `;
  }
}

/**
 * 2. Render Family Address
 */
function renderFamilyAddress(address, isManager) {
  const displayView = document.getElementById('address-display-view');
  const editForm = document.getElementById('address-edit-form');
  const line1El = document.getElementById('addr-display-line1');
  const line2El = document.getElementById('addr-display-line2');
  const statusBadge = document.getElementById('addr-status-badge');
  const actionsContainer = document.getElementById('address-header-actions');

  const hasAddress = !!(address && address.street && address.house_number);

  if (actionsContainer) {
    if (!isManager) {
      actionsContainer.innerHTML = '';
    } else if (isAddressEditMode) {
      actionsContainer.innerHTML = `
        <button onclick="cancelAddressEdit()" class="text-xs font-bold text-[#777777] hover:text-[#202020] transition-colors">
          Cancel
        </button>
      `;
    } else {
      actionsContainer.innerHTML = `
        <button onclick="openAddressEdit()" class="text-xs font-bold text-[#8A6800] hover:text-[#5C4500] inline-flex items-center gap-1 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
          <span>${hasAddress ? 'Edit Address' : 'Register Address'}</span>
        </button>
      `;
    }
  }

  if (isAddressEditMode || (!hasAddress && isManager)) {
    // If no address registered yet and is manager, show form directly
    if (!hasAddress && !isAddressEditMode) {
      isAddressEditMode = true;
    }
  }

  if (isAddressEditMode && isManager) {
    if (displayView) displayView.classList.add('hidden');
    if (editForm) editForm.classList.remove('hidden');
    populateAddressForm(address);
  } else {
    if (displayView) displayView.classList.remove('hidden');
    if (editForm) editForm.classList.add('hidden');

    if (hasAddress) {
      const houseAndStreet = `${address.house_number} ${address.street}`;
      const fixedCoverage = FIXED_LOCATION.formattedAdmin;

      if (line1El) line1El.textContent = houseAndStreet;
      if (line2El) line2El.textContent = fixedCoverage;
      if (statusBadge) {
        statusBadge.textContent = 'Registered';
        statusBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E8F5E9] text-[#278653] border border-emerald-200 flex-shrink-0';
      }
    } else {
      if (line1El) line1El.textContent = 'No family address registered yet.';
      if (line2El) line2El.textContent = 'Add your house/building number and street in Barangay Bayanan, Muntinlupa City to help responders locate your family.';
      if (statusBadge) {
        statusBadge.textContent = 'Not Set';
        statusBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 flex-shrink-0';
      }
    }
  }
}

/**
 * Populate address edit form with existing values
 */
function populateAddressForm(address) {
  const houseInput = document.getElementById('addr-house-number');
  const streetInput = document.getElementById('addr-street');

  if (houseInput) houseInput.value = (address && address.house_number) || '';
  if (streetInput) streetInput.value = (address && address.street) || '';
}

function openAddressEdit() {
  isAddressEditMode = true;
  if (currentFamilyData && currentFamilyData.family) {
    renderFamilyAddress(currentFamilyData.family.address, currentFamilyData.family.is_manager);
  }
}

function cancelAddressEdit() {
  isAddressEditMode = false;
  if (currentFamilyData && currentFamilyData.family) {
    renderFamilyAddress(currentFamilyData.family.address, currentFamilyData.family.is_manager);
  }
}

/**
 * Handle Save Address
 */
async function handleSaveAddress(e) {
  e.preventDefault();

  const houseNumber = document.getElementById('addr-house-number')?.value?.trim();
  const street = document.getElementById('addr-street')?.value?.trim();

  if (!houseNumber || !street) {
    showToast('Please provide both House / Building Number and Street Name.', 'error');
    return;
  }

  const btn = document.getElementById('btn-save-address');
  if (btn) btn.disabled = true;

  try {
    const res = await window.geoSafeStore.updateFamilyAddress({
      house_number: houseNumber,
      street: street
    });

    if (currentFamilyData && currentFamilyData.family) {
      currentFamilyData.family.address = res.address;
    }

    isAddressEditMode = false;
    showToast('Family address saved successfully.', 'success');
    renderFamilyAddress(res.address, currentFamilyData?.family?.is_manager);
  } catch (err) {
    console.error('Save address error:', err);
    showToast(err.message || 'Failed to save family address.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * 3. Render Family Members Directory
 */
function renderMembersDirectory(members, isManager) {
  const container = document.getElementById('family-cards-list');
  const countBadge = document.getElementById('members-count-badge');
  const singleMemberState = document.getElementById('family-single-member-state');

  if (countBadge) countBadge.textContent = `${members.length} member${members.length === 1 ? '' : 's'}`;

  if (members.length <= 1) {
    if (singleMemberState) singleMemberState.classList.remove('hidden');
  } else {
    if (singleMemberState) singleMemberState.classList.add('hidden');
  }

  if (!container) return;

  container.innerHTML = members.map(m => {
    const isSelf = !!m.is_self;
    const isMemberManager = m.membership_role === 'manager';
    const isSharing = m.locationSharing && m.locationSharing.enabled;

    let sharingBadge = '';
    if (isSharing) {
      sharingBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E8F5E9] text-[#278653] border border-emerald-200">
          <span class="w-1.5 h-1.5 rounded-full bg-[#278653] animate-pulse"></span>
          <span>Sharing Location</span>
        </span>
      `;
    } else {
      sharingBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
          <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
          <span>Location sharing off</span>
        </span>
      `;
    }

    let removeBtn = '';
    if (isManager && !isSelf) {
      removeBtn = `
        <button onclick="handleRemoveMember('${m.id}', '${m.name.replace(/'/g, "\\'")}')" class="p-1 rounded-lg text-[#777777] hover:text-[#D93636] hover:bg-[#FFF1F1] transition-colors" title="Remove member">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        </button>
      `;
    }

    const initials = m.name ? m.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() : 'FM';

    return `
      <div class="bg-white rounded-3xl p-3.5 sm:p-4 border border-[#EEEEEE] shadow-card hover:shadow-card-hover transition-all space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-2xl ${isSelf ? 'bg-[#202020] text-[#F5B900]' : 'bg-[#FFF9E8] text-[#8A6800]'} border border-[#FFE872] font-black flex items-center justify-center text-xs shadow-subtle flex-shrink-0">
              ${initials}
            </div>
            <div>
              <div class="flex items-center gap-1.5">
                <h4 class="font-bold text-xs sm:text-sm text-[#202020] tracking-tight">${m.name}</h4>
                ${isSelf ? '<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">You</span>' : ''}
              </div>
              <p class="text-[11px] text-[#777777] font-medium">${m.relationship || 'Member'}</p>
            </div>
          </div>
          ${removeBtn}
        </div>

        <div class="pt-2 border-t border-[#EEEEEE] flex items-center justify-between text-[11px]">
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${
            isMemberManager ? 'bg-[#FFF9E8] text-[#8A6800] border border-[#FFE872]' : 'bg-slate-50 text-slate-600 border border-slate-200'
          }">
            ${isMemberManager ? 'Manager' : 'Member'}
          </span>
          ${sharingBadge}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 4. Render Pending Join Requests
 */
function renderPendingRequests(requests, isManager) {
  const sectionEl = document.getElementById('section-pending-requests');
  const countBadge = document.getElementById('pending-requests-count-badge');
  const container = document.getElementById('pending-requests-list');

  if (!isManager || requests.length === 0) {
    if (sectionEl) sectionEl.classList.add('hidden');
    return;
  }

  if (sectionEl) sectionEl.classList.remove('hidden');
  if (countBadge) countBadge.textContent = `${requests.length} pending`;

  if (!container) return;

  container.innerHTML = requests.map(req => {
    const formattedDate = new Date(req.requested_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    return `
      <div class="bg-white rounded-2xl p-3 border border-[#FFE872] shadow-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-xl bg-[#FFF9E8] border border-[#FFE872] text-[#8A6800] font-black flex items-center justify-center text-xs flex-shrink-0">
            QR
          </div>
          <div>
            <h4 class="font-bold text-xs text-[#202020]">${req.applicant_name}</h4>
            <p class="text-[10px] text-[#777777]">${req.applicant_email || 'Verified Resident'} &bull; ${formattedDate}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 self-start sm:self-auto">
          <button onclick="handleReviewJoinRequest('${req.id}', 'reject')" class="px-2.5 py-1 rounded-xl border border-[#FFC2C2] text-[#D93636] hover:bg-[#FFF1F1] font-bold text-xs transition-colors">
            Reject
          </button>
          <button onclick="handleReviewJoinRequest('${req.id}', 'approve')" class="px-3 py-1 rounded-xl bg-[#278653] hover:bg-[#207044] text-white font-black text-xs shadow-subtle transition-all active:scale-95">
            Approve
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Handle URL Invitation Token (e.g. /family.html?invite=xxx)
 */
async function checkUrlInvitation() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('invite');
  if (!token) return;

  const currentUser = window.geoSafeStore.getCurrentUser();
  if (!currentUser) {
    try {
      sessionStorage.setItem('geosafe_pending_invite', token);
    } catch (e) {}
    showToast('Please log in to your GeoSafe resident account to join this family circle.', 'error');
    setTimeout(() => {
      window.location.href = `login.html?returnTo=family.html`;
    }, 1500);
    return;
  }

  await validateAndShowConfirmation(token);
}

/**
 * Validate Token & Show Confirmation Screen
 */
async function validateAndShowConfirmation(token) {
  try {
    const statusEl = document.getElementById('scanner-validation-status');
    if (statusEl) {
      statusEl.className = 'p-2.5 rounded-xl text-xs bg-slate-50 text-[#777777] block';
      statusEl.textContent = 'Validating invitation with server...';
      statusEl.classList.remove('hidden');
    }

    const validation = await window.geoSafeStore.validateFamilyInvitation(token);
    if (!validation || !validation.valid) {
      throw new Error(validation?.error || 'Invitation is invalid, expired, or revoked.');
    }

    validatedInviteData = {
      token: token,
      ...validation
    };

    closeJoinScannerModal();
    openJoinConfirmModal(validation);

  } catch (err) {
    console.error('Validation error:', err);
    const statusEl = document.getElementById('scanner-validation-status');
    if (statusEl) {
      statusEl.className = 'p-2.5 rounded-xl text-xs bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2] block';
      statusEl.textContent = err.message || 'Invitation is invalid, expired, or revoked.';
      statusEl.classList.remove('hidden');
    }
    showToast(err.message || 'Invitation is invalid or has expired.', 'error');
  }
}

/**
 * Handle Validate & Join button in Scanner Modal
 */
async function handleValidateAndJoin() {
  const inputEl = document.getElementById('scanner-token-input');
  if (!inputEl || !inputEl.value.trim()) {
    showToast('Please paste a valid invitation token or link.', 'error');
    return;
  }

  let raw = inputEl.value.trim();
  if (raw.includes('invite=')) {
    try {
      const parsed = new URL(raw);
      raw = parsed.searchParams.get('invite') || raw;
    } catch (e) {
      const match = raw.match(/invite=([a-zA-Z0-9]+)/);
      if (match) raw = match[1];
    }
  }

  await validateAndShowConfirmation(raw);
}

/**
 * Submit Confirmed Join Request
 */
async function submitConfirmedJoinRequest() {
  if (!validatedInviteData || !validatedInviteData.token) {
    showToast('Missing verified invitation data.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-confirmed-join');
  if (btn) btn.disabled = true;

  try {
    const relInput = document.getElementById('scanner-rel-input');
    const relationship = relInput ? relInput.value : 'Member';

    await window.geoSafeStore.submitFamilyJoinRequest(validatedInviteData.token, relationship);

    closeJoinConfirmModal();
    showToast('Join request submitted! Awaiting family manager approval.', 'success');

    if (window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      window.history.replaceState({}, document.title, url.toString());
    }

    await loadFamilySafetyTracker();
  } catch (err) {
    console.error('Submit join request error:', err);
    showToast(err.message || 'Failed to submit join request.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Handle Manager Review of Join Request
 */
async function handleReviewJoinRequest(requestId, action) {
  try {
    const res = await window.geoSafeStore.reviewFamilyJoinRequest(requestId, action);
    showToast(res.message || `Request ${action}d successfully.`, 'success');
    await loadFamilySafetyTracker();
  } catch (err) {
    console.error('Review join request error:', err);
    showToast(err.message || 'Failed to review join request.', 'error');
  }
}

/**
 * Handle Remove Member
 */
async function handleRemoveMember(memberId, memberName) {
  if (!confirm(`Are you sure you want to remove ${memberName} from this family group?`)) {
    return;
  }

  try {
    await window.geoSafeStore.removeFamilyMember(memberId);
    showToast(`${memberName} removed from family.`, 'success');
    await loadFamilySafetyTracker();
  } catch (err) {
    console.error('Remove member error:', err);
    showToast(err.message || 'Failed to remove member.', 'error');
  }
}

/**
 * Handle Leave Family
 */
async function handleLeaveFamily() {
  if (!confirm('Are you sure you want to leave this family group? Your location sharing will be terminated.')) {
    return;
  }

  try {
    await window.geoSafeStore.leaveFamilyGroup();
    showToast('You have left the family group.', 'success');
    await loadFamilySafetyTracker();
  } catch (err) {
    console.error('Leave family error:', err);
    showToast(err.message || 'Failed to leave family group.', 'error');
  }
}

/**
 * Handle Create Family Form Submission
 */
async function handleCreateFamily(e) {
  e.preventDefault();
  const nameInput = document.getElementById('create-family-name');
  const roleInput = document.getElementById('create-family-role');
  const houseInput = document.getElementById('create-house-number');
  const streetInput = document.getElementById('create-street');

  const familyName = nameInput ? nameInput.value.trim() : '';
  const houseNumber = houseInput ? houseInput.value.trim() : '';
  const street = streetInput ? streetInput.value.trim() : '';

  if (!familyName) {
    showToast('Please enter a family name.', 'error');
    return;
  }

  if (!houseNumber || !street) {
    showToast('Please provide both House / Building Number and Street Name.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-create-family');
  if (btn) btn.disabled = true;

  try {
    await window.geoSafeStore.createFamilyGroup({
      family_name: familyName,
      relationship: roleInput ? roleInput.value : 'Head of Household',
      house_number: houseNumber,
      street: street
    });

    closeCreateFamilyModal();
    showToast('Family circle and household address registered successfully!', 'success');
    await loadFamilySafetyTracker();
  } catch (err) {
    console.error('Create family error:', err);
    showToast(err.message || 'Failed to create family group.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Open Generate / View QR Modal
 */
async function openGenerateQRModal() {
  const modal = document.getElementById('qr-display-modal');
  const canvasContainer = document.getElementById('qr-modal-canvas-container');
  const famNameEl = document.getElementById('qr-modal-family-name');
  const linkInput = document.getElementById('qr-modal-link-input');
  const expiresEl = document.getElementById('qr-modal-expires-text');

  if (modal) modal.classList.remove('hidden');

  if (famNameEl && currentFamilyData && currentFamilyData.family) {
    famNameEl.textContent = currentFamilyData.family.family_name;
  }

  try {
    let inv = currentFamilyData ? currentFamilyData.activeInvitation : null;

    if (!inv || !inv.token) {
      const res = await window.geoSafeStore.generateFamilyInvitation(72);
      inv = res.invitation;
      if (currentFamilyData) currentFamilyData.activeInvitation = inv;
    }

    const inviteUrl = `${window.location.origin}/family.html?invite=${inv.token}`;
    if (linkInput) linkInput.value = inviteUrl;

    if (expiresEl) {
      expiresEl.textContent = new Date(inv.expires_at).toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    }

    if (canvasContainer) {
      if (typeof QRCode !== 'undefined' && QRCode.toSVG) {
        canvasContainer.innerHTML = QRCode.toSVG(inviteUrl, { size: 176, margin: 2 });
      } else {
        canvasContainer.innerHTML = `<p class="text-xs text-[#777777]">${inviteUrl}</p>`;
      }
    }

  } catch (err) {
    console.error('Failed to generate invitation:', err);
    showToast(err.message || 'Failed to generate QR code.', 'error');
  }
}

function closeGenerateQRModal() {
  const modal = document.getElementById('qr-display-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Regenerate Invitation
 */
async function regenerateActiveInvitation() {
  try {
    const res = await window.geoSafeStore.generateFamilyInvitation(72);
    if (currentFamilyData) currentFamilyData.activeInvitation = res.invitation;
    showToast('New QR invitation generated. Previous QR is revoked.', 'success');
    await openGenerateQRModal();
    await loadFamilySafetyTracker();
  } catch (err) {
    console.error('Regenerate error:', err);
    showToast(err.message || 'Failed to regenerate invitation.', 'error');
  }
}

/**
 * Revoke Invitation
 */
async function revokeActiveInvitation() {
  if (!confirm('Are you sure you want to revoke this QR invitation?')) {
    return;
  }

  try {
    const invId = currentFamilyData?.activeInvitation?.id;
    if (!invId) return;

    await window.geoSafeStore.revokeFamilyInvitation(invId);
    showToast('Invitation QR code revoked.', 'success');
    closeGenerateQRModal();
    await loadFamilySafetyTracker();
  } catch (err) {
    console.error('Revoke error:', err);
    showToast(err.message || 'Failed to revoke invitation.', 'error');
  }
}

/**
 * Copy Invitation Link
 */
function copyInvitationLink() {
  const inputEl = document.getElementById('qr-modal-link-input');
  if (!inputEl || !inputEl.value) return;
  copyRawLink(inputEl.value);
}

function copyRawLink(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Invitation link copied to clipboard!', 'success');
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const tempInput = document.createElement('input');
  tempInput.value = text;
  document.body.appendChild(tempInput);
  tempInput.select();
  document.execCommand('copy');
  document.body.removeChild(tempInput);
  showToast('Invitation link copied to clipboard!', 'success');
}

/**
 * Modal Open / Close Helpers
 */
function openCreateFamilyModal() {
  const modal = document.getElementById('create-family-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeCreateFamilyModal() {
  const modal = document.getElementById('create-family-modal');
  if (modal) modal.classList.add('hidden');
}

function openJoinScannerModal() {
  const modal = document.getElementById('qr-scanner-modal');
  const statusEl = document.getElementById('scanner-validation-status');
  if (statusEl) statusEl.classList.add('hidden');
  if (modal) modal.classList.remove('hidden');
}

function closeJoinScannerModal() {
  const modal = document.getElementById('qr-scanner-modal');
  if (modal) modal.classList.add('hidden');
}

function openJoinConfirmModal(validation) {
  const modal = document.getElementById('join-confirmation-modal');
  const famNameEl = document.getElementById('confirm-family-name');
  const inviterNameEl = document.getElementById('confirm-inviter-name');
  const myNameEl = document.getElementById('confirm-my-name');

  const currentUser = window.geoSafeStore.getCurrentUser();

  if (famNameEl) famNameEl.textContent = validation.family_name || 'Family Circle';
  if (inviterNameEl) inviterNameEl.textContent = validation.inviter_name || 'Family Manager';
  if (myNameEl) myNameEl.textContent = currentUser ? (currentUser.name || currentUser.email) : 'Your Account';

  if (modal) modal.classList.remove('hidden');
}

function closeJoinConfirmModal() {
  const modal = document.getElementById('join-confirmation-modal');
  if (modal) modal.classList.add('hidden');
}

// Global window exposure for HTML event handlers
window.openCreateFamilyModal = openCreateFamilyModal;
window.closeCreateFamilyModal = closeCreateFamilyModal;
window.openJoinScannerModal = openJoinScannerModal;
window.closeJoinScannerModal = closeJoinScannerModal;
window.openJoinConfirmModal = openJoinConfirmModal;
window.closeJoinConfirmModal = closeJoinConfirmModal;
window.openGenerateQRModal = openGenerateQRModal;
window.closeGenerateQRModal = closeGenerateQRModal;
window.handleCreateFamily = handleCreateFamily;
window.handleValidateAndJoin = handleValidateAndJoin;
window.submitConfirmedJoinRequest = submitConfirmedJoinRequest;
window.handleReviewJoinRequest = handleReviewJoinRequest;
window.handleRemoveMember = handleRemoveMember;
window.handleLeaveFamily = handleLeaveFamily;
window.regenerateActiveInvitation = regenerateActiveInvitation;
window.revokeActiveInvitation = revokeActiveInvitation;
window.copyInvitationLink = copyInvitationLink;
window.copyRawLink = copyRawLink;
window.openAddressEdit = openAddressEdit;
window.cancelAddressEdit = cancelAddressEdit;
window.handleSaveAddress = handleSaveAddress;
