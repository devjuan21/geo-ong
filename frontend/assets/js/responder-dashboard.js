/**
 * GeoSafe - Responder Dashboard Logic (Section 3)
 * ============================================================================
 * Features:
 * - Dynamic statistics computed strictly from real records (Active, Pending, In Progress, Completed)
 * - Emergency Priority breakdown (Critical, High, Medium, Low)
 * - Active Assignment cards with priority indicators & View Details action
 * - Exact empty state string: "No active assignments."
 * - Mini operational map preview linking to full responder map
 * ============================================================================
 */

let miniPreviewMap = null;
let currentAssignments = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Responder UI Shell
  GeoSafeResponderUI.init('dashboard', 'Responder Dashboard');

  // Load Dashboard Data
  await loadDashboardData();

  // Initialize Mini Map Preview
  initMiniMapPreview();
});

async function loadDashboardData() {
  const loadingEl = document.getElementById('dash-loading');
  const contentEl = document.getElementById('dash-content');

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
    const summary = await window.geoSafeStore.getResponderDashboardSummary();
    currentAssignments = summary.recentAssignments || [];

    // Dynamically update unit text
    const unitBadgeEl = document.getElementById('dash-unit-badge');
    const mapUnitEl = document.getElementById('dash-map-unit');
    const mapBaseEl = document.getElementById('dash-map-base');

    if (unitBadgeEl && auth.profile) {
      unitBadgeEl.textContent = auth.profile.assignedUnit || auth.profile.department || 'Barangay Bayanan Field Unit';
    }
    if (mapUnitEl && auth.profile) {
      mapUnitEl.textContent = auth.profile.assignedUnit || 'Field Unit';
    }
    if (mapBaseEl && auth.profile) {
      mapBaseEl.textContent = auth.profile.department || 'Barangay Bayanan EOC';
    }

    // Render Stats
    renderStatistics(summary.stats);

    // Render Priority Breakdown
    renderPrioritySection(summary.priorityCounts);

    // Render Active Assignments List
    renderActiveAssignments(currentAssignments);

    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');

    // Update mini map markers if initialized
    updateMiniMapMarkers(currentAssignments);
  } catch (err) {
    console.error('[ResponderDashboard] Error loading dashboard:', err);
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="p-6 text-center text-xs text-[#D93636]">
          <p class="font-bold">Failed to load operational dashboard records.</p>
          <button onclick="loadDashboardData()" class="mt-2 px-3 py-1 rounded-xl bg-slate-100 text-[#202020] font-bold hover:bg-slate-200">Retry</button>
        </div>
      `;
    }
  }
}

function renderStatistics(stats) {
  stats = stats || { active: 0, pending: 0, inProgress: 0, completed: 0 };

  const activeEl = document.getElementById('stat-active');
  const pendingEl = document.getElementById('stat-pending');
  const progressEl = document.getElementById('stat-progress');
  const completedEl = document.getElementById('stat-completed');

  if (activeEl) activeEl.textContent = stats.active || 0;
  if (pendingEl) pendingEl.textContent = stats.pending || 0;
  if (progressEl) progressEl.textContent = stats.inProgress || 0;
  if (completedEl) completedEl.textContent = stats.completed || 0;
}

function renderPrioritySection(priorityCounts) {
  priorityCounts = priorityCounts || { critical: 0, high: 0, medium: 0, low: 0 };

  const critEl = document.getElementById('prio-critical-count');
  const highEl = document.getElementById('prio-high-count');
  const medEl = document.getElementById('prio-medium-count');
  const lowEl = document.getElementById('prio-low-count');

  if (critEl) critEl.textContent = priorityCounts.critical || 0;
  if (highEl) highEl.textContent = priorityCounts.high || 0;
  if (medEl) medEl.textContent = priorityCounts.medium || 0;
  if (lowEl) lowEl.textContent = priorityCounts.low || 0;
}

function renderActiveAssignments(assignments) {
  const container = document.getElementById('assignments-container');
  const emptyEl = document.getElementById('assignments-empty');
  if (!container) return;

  // Filter only active assignments (not completed/resolved)
  const activeList = (assignments || []).filter(a => !['completed', 'resolved'].includes((a.status || '').toLowerCase()));

  if (activeList.length === 0) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');

  container.innerHTML = activeList.map(a => {
    const isRescue = a.assignmentType === 'rescue';
    const isCritical = (a.priority || '').toLowerCase() === 'critical';
    const isHigh = (a.priority || '').toLowerCase() === 'high';

    // Priority badge styling
    let prioBadge = 'bg-slate-100 text-slate-700 border-slate-200';
    if (isCritical) prioBadge = 'bg-[#FFF1F1] text-[#D93636] border-[#FFC2C2] font-black';
    else if (isHigh) prioBadge = 'bg-[#FFF8E1] text-[#E99524] border-[#FFE082] font-bold';
    else if ((a.priority || '').toLowerCase() === 'medium') prioBadge = 'bg-sky-50 text-sky-700 border-sky-200';

    // Status badge styling
    let statusBadge = 'bg-slate-100 text-slate-700 border-slate-200';
    const s = (a.status || '').toLowerCase();
    if (s === 'en route' || s === 'responding') statusBadge = 'bg-blue-50 text-[#3478C7] border-blue-200 font-bold';
    else if (s === 'on scene') statusBadge = 'bg-amber-50 text-[#E99524] border-amber-200 font-bold';
    else if (s === 'accepted') statusBadge = 'bg-purple-50 text-purple-700 border-purple-200';
    else if (s === 'completed' || s === 'resolved') statusBadge = 'bg-emerald-50 text-[#278653] border-emerald-200';

    return `
      <div class="bg-white rounded-3xl p-4 sm:p-5 border ${isCritical ? 'border-[#FFC2C2] shadow-emergency-glow ring-1 ring-[#FFC2C2]' : 'border-[#EEEEEE] shadow-card'} transition-all hover:border-[#F5B900] hover:shadow-card-hover space-y-3">
        
        <!-- Header: Ref #, Type, Priority, Status -->
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs sm:text-sm font-black text-[#202020]">${a.referenceNumber || a.id}</span>
            <span class="text-[9px] font-black px-2.5 py-0.5 rounded-full uppercase border ${isRescue ? 'bg-[#FFF1F1] text-[#D93636] border-[#FFC2C2]' : 'bg-[#FFF9E8] text-[#8A6800] border-[#FFE872]'}">
              ${isRescue ? 'Rescue' : 'Incident'}
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <span class="text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full border ${prioBadge}">
              ${a.priority || 'Normal'}
            </span>
            <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${statusBadge}">
              ${a.status || 'Pending'}
            </span>
          </div>
        </div>

        <!-- Body: Category & Location -->
        <div>
          <h4 class="font-bold text-sm sm:text-base text-[#202020] leading-snug">${a.title || a.category}</h4>
          <p class="text-xs text-[#777777] mt-1 flex items-center gap-1">
            <svg class="w-3.5 h-3.5 text-[#F5B900] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path></svg>
            <span class="truncate">${a.location || 'Barangay Bayanan'}</span>
          </p>
          ${isRescue && a.peopleCount ? `
            <div class="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-[#D93636] bg-[#FFF1F1] px-2.5 py-0.5 rounded-xl border border-[#FFC2C2]">
              <svg class="w-3.5 h-3.5 text-[#D93636]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
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

        <!-- Footer: Assigned Time & Action -->
        <div class="pt-2.5 border-t border-[#EEEEEE] flex items-center justify-between gap-2 text-xs">
          <span class="text-[10px] text-[#777777]">Assigned ${GeoSafeResponderUI.formatRelativeTime(a.assignedAt)}</span>
          <a href="responder-assignments.html?id=${encodeURIComponent(a.id)}" class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#202020] hover:bg-[#333333] text-white font-bold text-xs shadow-subtle transition-all active:scale-95">
            <span>Manage & Respond</span>
            <svg class="w-3.5 h-3.5 text-[#F5B900]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
          </a>
        </div>

      </div>
    `;
  }).join('');
}

function initMiniMapPreview() {
  const container = document.getElementById('dash-map-preview');
  if (!container || typeof L === 'undefined') return;

  try {
    miniPreviewMap = GeoSafeMapping.createMap('dash-map-preview', {
      center: [GeoSafeMapping.config.center.lat, GeoSafeMapping.config.center.lng],
      zoom: 14,
      scrollWheelZoom: false,
      zoomControl: false
    });

    // Add Responder Base Marker
    const responderIcon = GeoSafeMapping.createCustomIcon('incident');
    L.marker([GeoSafeMapping.config.center.lat, GeoSafeMapping.config.center.lng], {
      icon: responderIcon
    }).addTo(miniPreviewMap).bindPopup(`
      <div class="text-xs p-1">
        <strong>Barangay Bayanan Emergency Operations Center</strong><br>
        <span class="text-[10px] text-slate-500">Field response operations headquarters</span>
      </div>
    `);
  } catch (err) {
    console.warn('[ResponderDashboard] Could not initialize mini map preview:', err);
  }
}

function updateMiniMapMarkers(assignments) {
  if (!miniPreviewMap) return;

  assignments.forEach(a => {
    if (a.coordinates && typeof a.coordinates.lat === 'number') {
      const isRescue = a.assignmentType === 'rescue';
      const markerColor = isRescue ? '#D93636' : '#F5B900';

      const dot = L.circleMarker([a.coordinates.lat, a.coordinates.lng], {
        radius: 6,
        fillColor: markerColor,
        color: '#ffffff',
        weight: 2,
        fillOpacity: 0.95
      }).addTo(miniPreviewMap);

      dot.bindPopup(`
        <div class="text-xs p-1">
          <strong class="${isRescue ? 'text-red-700' : 'text-amber-800'}">${a.referenceNumber || a.id}</strong><br>
          <span>${a.title || a.category}</span>
        </div>
      `);
    }
  });
}

