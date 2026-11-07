/**
 * GeoSafe - Family Safety Tracker (Section 21 & Mobile-First Section 19)
 * ============================================================================
 * Features:
 * - Family Overview metrics: Total, Sharing, Disabled, Last Updated
 * - Leaflet Interactive Map displaying real authorized shared locations
 * - Empty map state overlay: "No shared family locations available."
 * - Family member cards with 4 official statuses:
 *     - Sharing Location
 *     - Not Sharing
 *     - Location Unavailable
 *     - Permission Denied
 * - Add Family Member invitation form with privacy-first defaults
 * - Member details modal with location history log & mini-map preview
 * - Explicit consent confirmation modal before enabling/stopping location sharing
 * - STRICT FRESH SYSTEM: Starts with 0 members and clean empty states
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
  GeoSafeUI.init('family-safety', 'Family Safety');

  // Initialize interactive Leaflet map
  initFamilyMap();

  // Setup form & modal listeners
  setupAddMemberForm();

  // Load authorized family members from store / REST API
  await loadFamilySafety();
});

/**
 * Initialize main interactive Leaflet family location map
 */
function initFamilyMap() {
  const mapContainer = document.getElementById('family-map');
  if (!mapContainer || typeof L === 'undefined') return;

  try {
    // Center at Barangay Bayanan, Muntinlupa City (14.4075° N, 121.0475° E)
    familyMap = L.map('family-map', {
      zoomControl: true,
      scrollWheelZoom: false
    }).setView([14.4075, 121.0475], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(familyMap);

    familyMarkersGroup = L.layerGroup().addTo(familyMap);
  } catch (err) {
    console.warn('Leaflet map initialization skipped or failed:', err);
  }
}

/**
 * Fetch and render all family safety information
 */
async function loadFamilySafety() {
  const loadingEl = document.getElementById('family-loading');
  const errorEl = document.getElementById('family-error');
  const emptyEl = document.getElementById('family-empty');
  const cardsListEl = document.getElementById('family-cards-list');

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');
  if (cardsListEl) cardsListEl.innerHTML = '';

  try {
    const members = await window.geoSafeStore.getFamilyMembers();
    if (loadingEl) loadingEl.classList.add('hidden');

    updateFamilyOverview(members || []);
    renderFamilyMap(members || []);
    renderFamilyMembersList(members || []);
  } catch (err) {
    console.error('Error loading family safety:', err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) {
      errorEl.classList.remove('hidden');
      const msg = document.getElementById('family-error-text');
      if (msg) {
        msg.textContent = err.isOffline
          ? 'Network offline. An active internet connection is required to check family safety.'
          : 'Unable to load authorized family safety records.';
      }
    }
  }
}

/**
 * Update Family Overview summary cards (Section 21.A)
 */
function updateFamilyOverview(members) {
  const totalCount = members.length;

  const sharingCount = members.filter(m => {
    const s = m.locationSharing?.status || (m.locationSharing?.enabled ? 'Sharing Location' : 'Not Sharing');
    return s === 'Sharing Location';
  }).length;

  const disabledCount = totalCount - sharingCount;

  // Find latest location update timestamp among active sharers
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
  const disabledEl = document.getElementById('stat-sharing-disabled');
  const updatedEl = document.getElementById('stat-last-updated');
  const badgeEl = document.getElementById('members-count-badge');

  if (totalEl) totalEl.textContent = totalCount;
  if (sharingEl) sharingEl.textContent = sharingCount;
  if (disabledEl) disabledEl.textContent = disabledCount;

  if (updatedEl) {
    if (latestUpdate) {
      updatedEl.textContent = GeoSafeUI.formatRelative(new Date(latestUpdate).toISOString());
    } else {
      updatedEl.textContent = '—';
    }
  }

  if (badgeEl) {
    badgeEl.textContent = `${totalCount} ${totalCount === 1 ? 'member' : 'members'}`;
  }
}

/**
 * Update the Leaflet map with active, consenting family markers (Section 21.D)
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
    // Show empty map overlay (Section 21.D: "No shared family locations available.")
    if (mapEmptyOverlay) mapEmptyOverlay.classList.remove('hidden');
    familyMap.setView([14.4075, 121.0475], 15);
    return;
  }

  // Hide empty overlay
  if (mapEmptyOverlay) mapEmptyOverlay.classList.add('hidden');

  const latLngs = [];

  sharingMembers.forEach(m => {
    const coords = m.locationSharing.coordinates;
    const latLng = [coords.lat, coords.lng];
    latLngs.push(latLng);

    const initials = m.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    // Create custom avatar marker icon
    const avatarIcon = L.divIcon({
      className: 'custom-family-marker',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="w-9 h-9 rounded-full bg-brand-900 border-2 border-white shadow-lg text-white font-bold text-xs flex items-center justify-center ring-2 ring-emerald-500">
            ${initials}
          </div>
          <div class="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border border-white"></div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -20]
    });

    const marker = L.marker(latLng, { icon: avatarIcon });

    const popupContent = `
      <div class="p-2 text-xs font-sans">
        <div class="flex items-center gap-2 mb-1.5">
          <div class="w-6 h-6 rounded-full bg-brand-900 text-white text-[10px] font-bold flex items-center justify-center">
            ${initials}
          </div>
          <div>
            <h4 class="font-bold text-slate-900 text-xs">${m.name}</h4>
            <p class="text-[10px] text-slate-500">${m.relationship}</p>
          </div>
        </div>
        <div class="bg-slate-50 p-1.5 rounded-lg border border-slate-200 space-y-1 mb-2">
          <p class="text-[10px] text-slate-700"><strong>Location:</strong> ${m.locationSharing.approximateLocation || 'Barangay Bayanan'}</p>
          <p class="text-[10px] text-slate-500"><strong>Updated:</strong> ${GeoSafeUI.formatRelative(m.locationSharing.lastUpdated)}</p>
        </div>
        <button onclick="openMemberDetailModal('${m.id}')" class="w-full py-1 px-2 bg-brand-900 text-white rounded text-[11px] font-semibold hover:bg-brand-800 transition-colors">
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
    const bounds = L.latLngBounds(latLngs);
    familyMap.fitBounds(bounds, { padding: [40, 40] });
  }
}

/**
 * Render family member cards (Section 21.B)
 */
function renderFamilyMembersList(members) {
  const emptyEl = document.getElementById('family-empty');
  const cardsListEl = document.getElementById('family-cards-list');

  if (members.length === 0) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (cardsListEl) cardsListEl.innerHTML = '';
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (!cardsListEl) return;

  cardsListEl.innerHTML = members.map(m => {
    const status = m.locationSharing?.status || (m.locationSharing?.enabled ? 'Sharing Location' : 'Not Sharing');
    const isSharing = status === 'Sharing Location';
    const statusBadge = getStatusBadge(status);
    const initials = m.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    const lastUpdated = m.locationSharing?.lastUpdated
      ? GeoSafeUI.formatRelative(m.locationSharing.lastUpdated)
      : 'Never';

    const approximateLocation = isSharing && m.locationSharing?.approximateLocation
      ? m.locationSharing.approximateLocation
      : 'Not Available';

    return `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-card p-5 transition-all hover:shadow-card-hover flex flex-col justify-between">
        <div>
          <!-- Header: Avatar, Name, Relationship, Status Badge -->
          <div class="flex items-start justify-between gap-3 mb-3">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-full bg-brand-100 text-brand-900 font-bold flex items-center justify-center text-sm ring-2 ring-brand-200/60 flex-shrink-0">
                ${initials}
              </div>
              <div class="min-w-0">
                <h3 class="text-sm sm:text-base font-bold text-slate-900 truncate">${m.name}</h3>
                <p class="text-xs text-slate-500 truncate">${m.relationship}${m.email ? ` | ${m.email}` : (m.phone ? ` | ${m.phone}` : '')}</p>
              </div>
            </div>
            <div class="flex-shrink-0">
              ${statusBadge}
            </div>
          </div>

          <!-- Location Information Box -->
          <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200/70 text-xs space-y-2">
            <div class="flex items-center justify-between text-slate-500">
              <span class="font-medium text-[11px] uppercase tracking-wider">Last Known Location</span>
              <span class="text-[11px] text-slate-400 font-normal">Updated: ${lastUpdated}</span>
            </div>
            <div class="flex items-center gap-2 text-slate-800 font-semibold text-xs sm:text-sm">
              <svg class="w-4 h-4 ${isSharing ? 'text-emerald-600' : 'text-slate-400'} flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              <span class="truncate">${approximateLocation}</span>
            </div>
          </div>
        </div>

        <!-- Action Bar: View Details & Consent Toggle -->
        <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <button onclick="openMemberDetailModal('${m.id}')" class="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors">
            View Details
          </button>

          <button onclick="promptToggleSharing('${m.id}', ${!isSharing})" class="text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors ${
            isSharing
              ? 'text-rose-600 hover:bg-rose-50'
              : 'text-brand-700 hover:bg-brand-50'
          }">
            ${isSharing ? 'Stop Sharing' : 'Enable Sharing'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Return styled badge according to Section 21.B location statuses
 */
function getStatusBadge(status) {
  switch (status) {
    case 'Sharing Location':
      return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        Sharing Location
      </span>`;
    case 'Location Unavailable':
      return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
        Location Unavailable
      </span>`;
    case 'Permission Denied':
      return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
        Permission Denied
      </span>`;
    case 'Not Sharing':
    default:
      return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
        <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
        Not Sharing
      </span>`;
  }
}

/**
 * Handle Add Family Member Form (Section 21.C)
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
      GeoSafeUI.showToast('Please complete all required fields.', 'error');
      return;
    }

    const submitBtn = document.getElementById('btn-submit-invitation');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending Invitation...';
    }

    try {
      // Add member with explicit 'Not Sharing' status by default (Section 21.C)
      await window.geoSafeStore.addFamilyMember({
        name,
        relationship,
        email,
        status: 'Not Sharing',
        enableLocationSharing: false
      });

      closeAddMemberModal();
      form.reset();

      GeoSafeUI.showToast(`Invitation transmitted to ${email}. Member authorization required before sharing.`, 'success');
      await loadFamilySafety();
    } catch (err) {
      console.error('Failed to add family member:', err);
      GeoSafeUI.showToast('Failed to send family invitation. Please try again.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Invitation';
      }
    }
  });
}

/**
 * Open Family Member Details Modal (Section 21.F)
 */
window.openMemberDetailModal = async function (memberId) {
  try {
    const members = await window.geoSafeStore.getFamilyMembers();
    const member = members.find(m => m.id === memberId);
    if (!member) {
      GeoSafeUI.showToast('Family member record not found.', 'error');
      return;
    }

    currentDetailMemberId = memberId;

    const modal = document.getElementById('member-detail-modal');
    if (!modal) return;

    // Header info
    const initials = member.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const avatarEl = document.getElementById('modal-member-avatar');
    const nameEl = document.getElementById('modal-member-name');
    const relEl = document.getElementById('modal-member-rel');

    if (avatarEl) avatarEl.textContent = initials;
    if (nameEl) nameEl.textContent = member.name;
    if (relEl) relEl.textContent = `${member.relationship}${member.email ? ` | ${member.email}` : ''}`;

    // Status badge
    const status = member.locationSharing?.status || (member.locationSharing?.enabled ? 'Sharing Location' : 'Not Sharing');
    const isSharing = status === 'Sharing Location';
    const statusBadgeContainer = document.getElementById('modal-member-status-badge');
    if (statusBadgeContainer) statusBadgeContainer.innerHTML = getStatusBadge(status);

    // Location & update time
    const locEl = document.getElementById('modal-member-location');
    const updatedEl = document.getElementById('modal-member-updated');

    if (locEl) {
      locEl.textContent = isSharing && member.locationSharing?.approximateLocation
        ? member.locationSharing.approximateLocation
        : 'Not Available';
    }

    if (updatedEl) {
      updatedEl.textContent = member.locationSharing?.lastUpdated
        ? GeoSafeUI.formatRelative(member.locationSharing.lastUpdated)
        : 'Never';
    }

    // Mini map preview
    const mapSection = document.getElementById('modal-member-map-section');
    const coords = member.locationSharing?.coordinates;

    if (isSharing && coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
      if (mapSection) mapSection.classList.remove('hidden');
      setTimeout(() => initDetailMap(coords, member.name), 100);
    } else {
      if (mapSection) mapSection.classList.add('hidden');
    }

    // Location history log (Section 21.F: No fabricated history)
    const historyContainer = document.getElementById('modal-member-history-container');
    if (historyContainer) {
      if (member.locationHistory && member.locationHistory.length > 0) {
        historyContainer.innerHTML = member.locationHistory.map(h => `
          <div class="flex items-center justify-between py-1.5 border-b border-slate-200/60 last:border-none">
            <span class="font-medium text-slate-800">${h.location}</span>
            <span class="text-slate-400 text-[10px]">${GeoSafeUI.formatRelative(h.timestamp)}</span>
          </div>
        `).join('');
      } else {
        historyContainer.innerHTML = '<p class="text-slate-400 italic">No location history available.</p>';
      }
    }

    // Toggle button in modal
    const toggleBtn = document.getElementById('modal-toggle-sharing-btn');
    if (toggleBtn) {
      if (isSharing) {
        toggleBtn.textContent = 'Revoke Location Sharing';
        toggleBtn.className = 'px-3.5 py-2 rounded-xl text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors';
      } else {
        toggleBtn.textContent = 'Enable Location Sharing';
        toggleBtn.className = 'px-3.5 py-2 rounded-xl text-xs font-bold text-brand-900 bg-brand-50 hover:bg-brand-100 transition-colors';
      }
      toggleBtn.onclick = () => {
        closeMemberDetailModal();
        promptToggleSharing(member.id, !isSharing);
      };
    }

    modal.classList.remove('hidden');
  } catch (err) {
    console.error('Error opening member detail modal:', err);
  }
};

window.closeMemberDetailModal = function () {
  const modal = document.getElementById('member-detail-modal');
  if (modal) modal.classList.add('hidden');
  currentDetailMemberId = null;
};

/**
 * Initialize / update mini Leaflet map inside Member Detail Modal
 */
function initDetailMap(coords, memberName) {
  const container = document.getElementById('member-detail-map');
  if (!container || typeof L === 'undefined') return;

  const latLng = [coords.lat, coords.lng];

  if (!detailMap) {
    detailMap = L.map('member-detail-map', {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: false
    }).setView(latLng, 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(detailMap);

    detailMarker = L.marker(latLng).addTo(detailMap);
  } else {
    detailMap.invalidateSize();
    detailMap.setView(latLng, 16);
    if (detailMarker) {
      detailMarker.setLatLng(latLng);
    } else {
      detailMarker = L.marker(latLng).addTo(detailMap);
    }
  }

  detailMarker.bindPopup(`<strong class="text-xs">${memberName}</strong>`).openPopup();
}

/**
 * Location-Sharing Consent Modal logic (Section 21.E)
 */
window.promptToggleSharing = function (memberId, enable) {
  pendingConsentMemberId = memberId;
  pendingConsentEnable = enable;

  const modal = document.getElementById('family-consent-modal');
  if (!modal) return;

  const title = document.getElementById('consent-modal-title');
  const desc = document.getElementById('consent-modal-desc');

  if (enable) {
    if (title) title.textContent = 'Enable Location Sharing';
    if (desc) {
      desc.textContent = 'By enabling location sharing, this family member explicitly authorizes sharing their approximate GPS coordinates with verified members of your household emergency circle during disaster operations. Consent can be revoked at any time.';
    }
  } else {
    if (title) title.textContent = 'Revoke Location Sharing';
    if (desc) {
      desc.textContent = 'Location sharing will be immediately deactivated for this member. Their GPS coordinates will no longer be visible on the Family Safety Map.';
    }
  }

  modal.classList.remove('hidden');
};

window.confirmToggleSharing = async function () {
  if (!pendingConsentMemberId) return;

  try {
    await window.geoSafeStore.toggleFamilyLocationSharing(pendingConsentMemberId, pendingConsentEnable);
    closeConsentModal();

    GeoSafeUI.showToast(
      pendingConsentEnable
        ? 'Location sharing enabled with consent.'
        : 'Location sharing revoked.',
      'info'
    );

    await loadFamilySafety();
  } catch (err) {
    console.error('Error toggling location sharing:', err);
    GeoSafeUI.showToast('Unable to modify location sharing settings.', 'error');
  }
};

window.closeConsentModal = function () {
  const modal = document.getElementById('family-consent-modal');
  if (modal) modal.classList.add('hidden');
  pendingConsentMemberId = null;
};

// Modal open/close controls for Add Member
window.openAddMemberModal = function () {
  const modal = document.getElementById('add-member-modal');
  if (modal) modal.classList.remove('hidden');
};

window.closeAddMemberModal = function () {
  const modal = document.getElementById('add-member-modal');
  if (modal) modal.classList.add('hidden');
};

window.loadFamilySafety = loadFamilySafety;
