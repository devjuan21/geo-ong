/**
 * GeoSafe - Family Safety Tracker Page Logic (Section 6)
 * ============================================================================
 * Features:
 * - Family Overview metrics: Total, Sharing, Not Sharing, Last Update
 * - Interactive Leaflet Map showing actual shared locations of authorized members
 * - Empty states:
 *   - "No family members added yet."
 *   - "No shared family locations available."
 * - Strict Privacy & Consent enforcement (never activate automatically)
 * - Add Family Member invitation workflow
 * - Member Details modal & explicit consent toggle
 * ============================================================================
 */

let familyMap = null;
let familyMarkersGroup = null;
let detailMap = null;
let detailMarker = null;

let currentDetailMemberId = null;
let pendingConsentMemberId = null;
let pendingConsentEnable = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize common shell navigation
  GeoSafeUI.init('family', 'Family Safety');

  // Initialize interactive Leaflet map
  initFamilyMap();

  // Setup form listener
  setupAddMemberForm();

  // Load family members
  await loadFamilySafety();
});

/**
 * Initialize Family Leaflet Map
 */
function initFamilyMap() {
  try {
    familyMap = GeoSafeMapping.createMap('family-map', {
      center: [GeoSafeMapping.config.center.lat, GeoSafeMapping.config.center.lng],
      zoom: 15,
      scrollWheelZoom: false
    });

    familyMarkersGroup = L.layerGroup().addTo(familyMap);
  } catch (err) {
    console.error('Failed to initialize family map:', err);
  }
}

/**
 * Load and render all family safety information
 */
async function loadFamilySafety() {
  try {
    const members = await window.geoSafeStore.getFamilyMembers();
    const list = members || [];

    updateFamilyOverview(list);
    renderFamilyMap(list);
    renderFamilyMembersList(list);
  } catch (err) {
    console.error('Error loading family safety:', err);
    GeoSafeUI.showToast('Unable to load family safety records.', 'error');
  }
}

/**
 * Update Family Overview summary cards (Section 6.A)
 */
function updateFamilyOverview(members) {
  const totalCount = members.length;
  const sharingCount = members.filter(m => {
    const status = m.locationSharing?.status || (m.locationSharing?.enabled ? 'Sharing Location' : 'Not Sharing');
    return status === 'Sharing Location';
  }).length;

  const notSharingCount = totalCount - sharingCount;

  let latestUpdate = null;
  members.forEach(m => {
    if (m.locationSharing?.status === 'Sharing Location' && m.locationSharing?.lastUpdated) {
      const ts = new Date(m.locationSharing.lastUpdated).getTime();
      if (!latestUpdate || ts > latestUpdate) {
        latestUpdate = ts;
      }
    }
  });

  const totalEl = document.getElementById('stat-total-members');
  const sharingEl = document.getElementById('stat-sharing-location');
  const notSharingEl = document.getElementById('stat-not-sharing');
  const updatedEl = document.getElementById('stat-last-update');
  const badgeEl = document.getElementById('members-count-badge');

  if (totalEl) totalEl.textContent = totalCount;
  if (sharingEl) sharingEl.textContent = sharingCount;
  if (notSharingEl) notSharingEl.textContent = notSharingCount;

  if (updatedEl) {
    updatedEl.textContent = latestUpdate ? GeoSafeUI.formatRelative(new Date(latestUpdate).toISOString()) : '—';
  }

  if (badgeEl) {
    badgeEl.textContent = `${totalCount} ${totalCount === 1 ? 'member' : 'members'}`;
  }
}

/**
 * Render Leaflet map markers for consenting family members (Section 6.C)
 */
function renderFamilyMap(members) {
  const mapEmptyOverlay = document.getElementById('family-map-empty');
  if (!familyMap || !familyMarkersGroup) return;

  familyMarkersGroup.clearLayers();

  // Filter only members actively sharing location with valid coordinates
  const sharingMembers = members.filter(m => {
    const status = m.locationSharing?.status || (m.locationSharing?.enabled ? 'Sharing Location' : 'Not Sharing');
    const coords = m.locationSharing?.coordinates;
    return status === 'Sharing Location' && coords && typeof coords.lat === 'number' && typeof coords.lng === 'number';
  });

  if (sharingMembers.length === 0) {
    // Show required empty state (Section 6.C: "No shared family locations available.")
    if (mapEmptyOverlay) mapEmptyOverlay.classList.remove('hidden');
    familyMap.setView([GeoSafeMapping.config.center.lat, GeoSafeMapping.config.center.lng], 15);
    return;
  }

  if (mapEmptyOverlay) mapEmptyOverlay.classList.add('hidden');

  const latLngs = [];

  sharingMembers.forEach(m => {
    const coords = m.locationSharing.coordinates;
    const latLng = [coords.lat, coords.lng];
    latLngs.push(latLng);

    const initials = m.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const avatarIcon = GeoSafeMapping.createCustomIcon('family', initials);

    const marker = L.marker(latLng, { icon: avatarIcon });

    const popupContent = `
      <div class="p-2.5 text-xs font-sans">
        <h4 class="font-bold text-[#202020] text-xs">${m.name}</h4>
        <p class="text-[10px] text-[#777777] mb-1">${m.relationship}</p>
        <div class="bg-[#FFFDF7] p-2 rounded-xl border border-[#EEEEEE] text-[10px] space-y-0.5 mb-2">
          <div><strong class="text-[#202020]">Location:</strong> ${m.locationSharing.approximateLocation || 'Barangay Bayanan'}</div>
          <div><strong class="text-[#202020]">Updated:</strong> ${GeoSafeUI.formatRelative(m.locationSharing.lastUpdated)}</div>
        </div>
        <button onclick="openMemberDetailModal('${m.id}')" class="w-full py-1.5 px-2 bg-[#F5B900] text-[#202020] rounded-xl text-[11px] font-bold hover:bg-[#E5AC00] transition-colors shadow-subtle">
          View Details
        </button>
      </div>
    `;

    marker.bindPopup(popupContent);
    familyMarkersGroup.addLayer(marker);
  });

  if (latLngs.length === 1) {
    familyMap.setView(latLngs[0], 16);
  } else if (latLngs.length > 1) {
    familyMap.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
  }
}

/**
 * Render Family Members List Cards (Section 6.B)
 */
function renderFamilyMembersList(members) {
  const emptyEl = document.getElementById('family-empty');
  const cardsListEl = document.getElementById('family-cards-list');

  if (members.length === 0) {
    // Show required empty state (Section 6.B: "No family members added yet.")
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (cardsListEl) cardsListEl.classList.add('hidden');
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (!cardsListEl) return;

  cardsListEl.classList.remove('hidden');

  cardsListEl.innerHTML = members.map(m => {
    const status = m.locationSharing?.status || (m.locationSharing?.enabled ? 'Sharing Location' : 'Not Sharing');
    const isSharing = status === 'Sharing Location';
    const initials = m.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const lastUpdate = m.locationSharing?.lastUpdated ? GeoSafeUI.formatRelative(m.locationSharing.lastUpdated) : 'Never';
    const approxLoc = isSharing && m.locationSharing?.approximateLocation ? m.locationSharing.approximateLocation : 'Not Available';

    let badge = '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FFFDF7] text-[#777777] border border-[#EEEEEE]"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>Not Sharing</span>';
    if (status === 'Sharing Location') {
      badge = '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-[#278653] border border-emerald-200"><span class="w-1.5 h-1.5 rounded-full bg-[#278653]"></span>Sharing Location</span>';
    } else if (status === 'Location Unavailable') {
      badge = '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF9E8] text-[#8A6800] border border-[#FFE872]"><span class="w-1.5 h-1.5 rounded-full bg-[#F5B900]"></span>Location Unavailable</span>';
    } else if (status === 'Permission Denied') {
      badge = '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2]"><span class="w-1.5 h-1.5 rounded-full bg-[#D93636]"></span>Permission Denied</span>';
    }

    return `
      <div class="bg-white rounded-3xl border border-[#EEEEEE] shadow-card p-3.5 sm:p-4 transition-all hover:border-[#F5B900] flex flex-col justify-between gap-3">
        <div>
          <div class="flex items-start justify-between gap-2 mb-2.5">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-9 h-9 rounded-xl bg-[#FFF9E8] border border-[#FFE872] text-[#8A6800] font-black flex items-center justify-center text-xs shadow-subtle flex-shrink-0">
                ${initials}
              </div>
              <div class="min-w-0">
                <h4 class="text-xs sm:text-sm font-bold text-[#202020] truncate">${m.name}</h4>
                <p class="text-[11px] text-[#777777] truncate">${m.relationship}${m.email ? ` • ${m.email}` : ''}</p>
              </div>
            </div>
            <div class="flex-shrink-0">
              ${badge}
            </div>
          </div>

          <div class="p-2.5 bg-[#FFFDF7] rounded-xl border border-[#EEEEEE] text-xs space-y-1">
            <div class="flex items-center justify-between text-[#777777] text-[10px]">
              <span class="font-bold">LOCATION</span>
              <span>Updated: ${lastUpdate}</span>
            </div>
            <div class="flex items-center gap-1.5 font-bold text-[#202020] text-xs truncate">
              <svg class="w-3.5 h-3.5 ${isSharing ? 'text-[#278653]' : 'text-slate-400'} flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path></svg>
              <span class="truncate">${approxLoc}</span>
            </div>
          </div>
        </div>

        <div class="pt-2 border-t border-[#EEEEEE] flex items-center justify-between gap-2">
          <button onclick="openMemberDetailModal('${m.id}')" class="px-3 py-1 rounded-xl bg-[#FFF9E8] hover:bg-[#FFF3D0] text-[#202020] border border-[#FFE872] font-bold text-xs transition-colors shadow-subtle">
            Details
          </button>
          <button onclick="promptToggleSharing('${m.id}', ${!isSharing})" class="text-xs font-bold px-2.5 py-1 rounded-xl transition-colors ${
            isSharing ? 'text-[#D93636] hover:bg-[#FFF1F1]' : 'text-[#8A6800] hover:bg-[#FFF9E8]'
          }">
            ${isSharing ? 'Stop Sharing' : 'Share Location'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Setup Add Member Form (Section 6.B)
 */
function setupAddMemberForm() {
  const form = document.getElementById('add-family-member-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('new-member-name')?.value.trim();
    const relationship = document.getElementById('new-member-rel')?.value;
    const email = document.getElementById('new-member-email')?.value.trim();

    if (!name || !relationship || !email) {
      GeoSafeUI.showToast('Please fill all required member fields.', 'error');
      return;
    }

    try {
      await window.geoSafeStore.addFamilyMember({
        name,
        relationship,
        email,
        status: 'Not Sharing',
        enableLocationSharing: false
      });

      closeAddMemberModal();
      form.reset();
      GeoSafeUI.showToast(`Invitation sent to ${email}. Location sharing requires member authorization.`, 'success');
      await loadFamilySafety();
    } catch (err) {
      GeoSafeUI.showToast('Failed to add family member.', 'error');
    }
  });
}

/**
 * Open Member Details Modal
 */
window.openMemberDetailModal = async function (memberId) {
  try {
    const members = await window.geoSafeStore.getFamilyMembers();
    const member = members.find(m => m.id === memberId);
    if (!member) return;

    currentDetailMemberId = memberId;
    const modal = document.getElementById('member-detail-modal');
    if (!modal) return;

    const initials = member.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    document.getElementById('modal-member-avatar').textContent = initials;
    document.getElementById('modal-member-name').textContent = member.name;
    document.getElementById('modal-member-rel').textContent = `${member.relationship}${member.email ? ` | ${member.email}` : ''}`;

    const status = member.locationSharing?.status || (member.locationSharing?.enabled ? 'Sharing Location' : 'Not Sharing');
    const isSharing = status === 'Sharing Location';
    document.getElementById('modal-member-status-badge').textContent = status;
    document.getElementById('modal-member-location').textContent = isSharing && member.locationSharing?.approximateLocation ? member.locationSharing.approximateLocation : 'Not Available';
    document.getElementById('modal-member-updated').textContent = member.locationSharing?.lastUpdated ? GeoSafeUI.formatRelative(member.locationSharing.lastUpdated) : 'Never';

    // Mini map
    const mapSection = document.getElementById('modal-member-map-section');
    const coords = member.locationSharing?.coordinates;
    if (isSharing && coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
      if (mapSection) mapSection.classList.remove('hidden');
      setTimeout(() => initDetailMap(coords, member.name), 100);
    } else {
      if (mapSection) mapSection.classList.add('hidden');
    }

    // Toggle button
    const toggleBtn = document.getElementById('modal-toggle-sharing-btn');
    if (toggleBtn) {
      toggleBtn.textContent = isSharing ? 'Revoke Location Sharing' : 'Enable Location Sharing';
      toggleBtn.className = isSharing
        ? 'px-3.5 py-2 rounded-xl text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors'
        : 'px-3.5 py-2 rounded-xl text-xs font-bold text-brand-900 bg-brand-50 hover:bg-brand-100 transition-colors';
      toggleBtn.onclick = () => {
        closeMemberDetailModal();
        promptToggleSharing(member.id, !isSharing);
      };
    }

    modal.classList.remove('hidden');
  } catch (err) {
    console.error('Error opening member modal:', err);
  }
};

window.closeMemberDetailModal = function () {
  document.getElementById('member-detail-modal')?.classList.add('hidden');
};

/**
 * Mini Leaflet map inside member details
 */
function initDetailMap(coords, name) {
  const container = document.getElementById('member-detail-map');
  if (!container || typeof L === 'undefined') return;

  const latLng = [coords.lat, coords.lng];

  if (!detailMap) {
    detailMap = L.map('member-detail-map', {
      center: latLng,
      zoom: 16,
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: false
    });

    L.tileLayer(GeoSafeMapping.config.tiles.url, {
      maxZoom: GeoSafeMapping.config.tiles.maxZoom
    }).addTo(detailMap);

    detailMarker = L.marker(latLng).addTo(detailMap);
  } else {
    detailMap.invalidateSize();
    detailMap.setView(latLng, 16);
    if (detailMarker) detailMarker.setLatLng(latLng);
  }

  detailMarker.bindPopup(`<strong class="text-xs">${name}</strong>`).openPopup();
}

/**
 * Consent Modal Logic (Section 6.D)
 */
window.promptToggleSharing = function (memberId, enable) {
  pendingConsentMemberId = memberId;
  pendingConsentEnable = enable;

  const modal = document.getElementById('family-consent-modal');
  const title = document.getElementById('consent-modal-title');
  const desc = document.getElementById('consent-modal-desc');

  if (enable) {
    if (title) title.textContent = 'Enable Location Sharing';
    if (desc) {
      desc.textContent = 'By enabling location sharing, this family member explicitly authorizes sharing their approximate GPS coordinates with verified members of your household emergency circle during disaster operations. Consent can be revoked at any time.';
    }
  } else {
    if (title) title.textContent = 'Stop Location Sharing';
    if (desc) {
      desc.textContent = 'Location sharing will be immediately deactivated for this member. Their current GPS coordinates will no longer be visible on the Family Safety Map.';
    }
  }

  modal?.classList.remove('hidden');
};

window.confirmToggleSharing = async function () {
  if (!pendingConsentMemberId) return;

  try {
    await window.geoSafeStore.toggleFamilyLocationSharing(pendingConsentMemberId, pendingConsentEnable);
    closeConsentModal();
    GeoSafeUI.showToast(pendingConsentEnable ? 'Location sharing enabled with consent.' : 'Location sharing stopped.', 'info');
    await loadFamilySafety();
  } catch (err) {
    GeoSafeUI.showToast('Unable to modify location sharing settings.', 'error');
  }
};

window.closeConsentModal = function () {
  document.getElementById('family-consent-modal')?.classList.add('hidden');
  pendingConsentMemberId = null;
};

window.openAddMemberModal = function () {
  document.getElementById('add-member-modal')?.classList.remove('hidden');
};

window.closeAddMemberModal = function () {
  document.getElementById('add-member-modal')?.classList.add('hidden');
};

