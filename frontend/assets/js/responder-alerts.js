/**
 * GeoSafe - Responder Hazard Alerts Page Logic
 */

let allResponderAlerts = [];

function escapeHtmlSafe(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAlertDate(isoString) {
  if (!isoString) return 'Unknown date';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeResponderUI.init('alerts', 'Hazard Alerts');

  const auth = await GeoSafeResponderUI.verifyResponderSession();
  if (!auth.authorized) {
    GeoSafeResponderUI.renderUnauthorizedScreen(document.querySelector('main'));
    return;
  }

  await Promise.all([loadResponderCategoriesFilter(), loadResponderHazardAlerts()]);

  window.addEventListener('geosafe:realtime-update', () => {
    loadResponderHazardAlerts();
  });
});

async function loadResponderCategoriesFilter() {
  const selectEl = document.getElementById('alerts-filter-type');
  if (!selectEl || !window.geoSafeStore) return;
  try {
    const data = await window.geoSafeStore.request('/broadcast-categories', { method: 'GET' });
    const categories = Array.isArray(data && data.categories) ? data.categories : [];
    const currentVal = selectEl.value || 'All';
    selectEl.innerHTML = '<option value="All">All Categories</option>' + categories.map((c) =>
      `<option value="${escapeHtmlSafe(c.name)}">${escapeHtmlSafe(c.name)}</option>`
    ).join('');
    selectEl.value = currentVal;
  } catch (err) {
    console.warn('[ResponderAlerts] Could not load categories filter:', err.message);
  }
}

async function loadResponderHazardAlerts() {
  const loadingEl = document.getElementById('alerts-loading');
  const errorEl = document.getElementById('alerts-error');
  const emptyEl = document.getElementById('alerts-empty');
  const listContainer = document.getElementById('alerts-list-container');
  const totalBadge = document.getElementById('alerts-total-badge');
  const statusFilter = document.getElementById('alerts-filter-status')?.value || 'active';

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');
  if (listContainer) listContainer.classList.add('hidden');

  try {
    const endpoint = statusFilter === 'all' ? '/hazard-alerts?includeArchived=true' : '/hazard-alerts';
    const alerts = await window.geoSafeStore.request(endpoint, { method: 'GET' });
    const rawList = Array.isArray(alerts) ? alerts : [];
    allResponderAlerts = statusFilter === 'active'
      ? rawList.filter((a) => String(a.status || 'Active') === 'Active')
      : rawList;
    if (loadingEl) loadingEl.classList.add('hidden');
    if (totalBadge) {
      const activeCount = rawList.filter((a) => String(a.status || 'Active') === 'Active').length;
      totalBadge.textContent = `${activeCount} Active`;
    }

    applyResponderAlertsFilterAndSort();
  } catch (err) {
    console.error('[ResponderAlerts] Failed to load hazard alerts:', err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) {
      errorEl.classList.remove('hidden');
      const msg = document.getElementById('alerts-error-text');
      if (msg) {
        msg.textContent = err.isOffline
          ? 'Network offline. Connect to load alerts.'
          : 'Unable to retrieve alerts. Please retry.';
      }
    }
  }
}

function applyResponderAlertsFilterAndSort() {
  const emptyEl = document.getElementById('alerts-empty');
  const listContainer = document.getElementById('alerts-list-container');
  const filterType = document.getElementById('alerts-filter-type')?.value || 'All';
  const sortOrder = document.getElementById('alerts-sort-order')?.value || 'priority';

  let filtered = allResponderAlerts.filter((a) => {
    if (filterType === 'All') return true;
    const type = a.categoryName || a.advisoryType || a.category || 'Other';
    return type.toLowerCase() === filterType.toLowerCase();
  });

  if (sortOrder === 'priority' && window.GeoSafeAdvisories) {
    filtered = [...filtered].sort(window.GeoSafeAdvisories.comparePriorityThenNewest);
  } else {
    filtered = [...filtered].sort(
      (a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()
    );
  }

  if (filtered.length === 0) {
    if (listContainer) listContainer.classList.add('hidden');
    if (emptyEl) {
      emptyEl.classList.remove('hidden');
      const span = emptyEl.querySelector('span');
      if (span) {
        span.textContent = allResponderAlerts.length === 0
          ? 'No hazard alerts at the moment.'
          : `No ${filterType} advisories found.`;
      }
    }
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (listContainer) {
    listContainer.classList.remove('hidden');
    renderResponderAlerts(filtered);
  }
}

function renderUrgencyBadgeSafe(urgency) {
  const level = String(urgency || 'Advisory').trim();
  const styles = {
    Informational: 'bg-sky-50 text-sky-700 border-sky-200',
    Advisory: 'bg-amber-50 text-amber-700 border-amber-200',
    Warning: 'bg-orange-50 text-orange-700 border-orange-200',
    Critical: 'bg-[#FFF1F1] text-[#D93636] border-[#FFC2C2]',
  };
  const cls = styles[level] || styles.Advisory;
  return `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}">${escapeHtmlSafe(level)}</span>`;
}

function renderResponderAlerts(alerts) {
  const container = document.getElementById('alerts-list');
  if (!container) return;

  container.innerHTML = alerts.map((alert) => {
    const categoryName = alert.categoryName || alert.advisoryType || alert.category || 'Other';
    const badgeHtml = window.GeoSafeAdvisories
      ? window.GeoSafeAdvisories.renderBadge(categoryName, { badgeColor: alert.badgeColor })
      : `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#FFF9E8] text-[#8A6800] border border-[#FFE872]">${escapeHtmlSafe(categoryName)}</span>`;
    const urgencyHtml = renderUrgencyBadgeSafe(alert.urgencyLevel);
    const rawArea = String(alert.locationAddress || alert.targetZones || alert.affectedLocation || '').trim();
    const areaText = rawArea ? escapeHtmlSafe(rawArea) : '';
    const statusText = escapeHtmlSafe(alert.status || 'Active');
    const statusLower = statusText.toLowerCase();
    const isMutedStatus = statusLower === 'expired' || statusLower === 'archived' || statusLower === 'cancelled';
    const statusBadgeClass = statusLower === 'expired'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : (isMutedStatus ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-emerald-50 text-[#278653] border-emerald-200');
    const isEmergency = Boolean(alert.isEmergency || Number(alert.priority || 5) <= 2);
    const cardAccent = isEmergency && !isMutedStatus
      ? 'border-[#FFC2C2] border-l-4 border-l-[#D93636]'
      : 'border-[#EEEEEE]';

    return `
      <div onclick="openResponderAdvisoryModal('${escapeHtmlSafe(alert.id)}')" role="button" tabindex="0"
        class="bg-white rounded-2xl border ${cardAccent} shadow-card hover:border-[#F5B900] transition-all cursor-pointer overflow-hidden">
        <div class="p-3.5 sm:p-4 space-y-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2 flex-wrap">
              ${badgeHtml}
              ${urgencyHtml}
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusBadgeClass}">${statusText}</span>
              <span class="text-[11px] text-[#777777]">${formatAlertDate(alert.publishedAt)}</span>
              ${alert.expiresAt ? `<span class="text-[10px] text-[#777777]">• ${statusLower === 'expired' ? 'Expired' : 'Expires'}: ${formatAlertDate(alert.expiresAt)}</span>` : ''}
            </div>
            ${areaText ? `<div class="text-[11px] text-[#555555] inline-flex items-center gap-1">
              ${GeoSafeResponderUI.getIcon('map-pin', 'w-3.5 h-3.5 text-[#8A6800]')}
              <span class="font-semibold text-[#202020]">${areaText}</span>
            </div>` : ''}
          </div>

          <div>
            <h2 class="text-sm sm:text-base font-bold text-[#202020] leading-snug">${escapeHtmlSafe(alert.title || 'Advisory')}</h2>
            ${alert.description ? `<p class="text-xs text-[#555555] mt-1 leading-relaxed line-clamp-2">${escapeHtmlSafe(alert.description)}</p>` : ''}
          </div>

          <div class="pt-2 flex items-center justify-between gap-2 text-[11px] text-[#777777] border-t border-[#F3F4F6]">
            <span>Issued by: <strong class="text-[#202020]">${escapeHtmlSafe(alert.issuingAuthority || 'BDRRMC Barangay Bayanan')}</strong></span>
            <span class="inline-flex items-center gap-1 text-[#8A6800] font-bold">
              <span>View Details</span>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
            </span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openResponderAdvisoryModal(alertId) {
  const alert = allResponderAlerts.find((a) => String(a.id) === String(alertId));
  const modal = document.getElementById('advisory-detail-modal');
  if (!alert || !modal) return;

  const categoryName = alert.categoryName || alert.advisoryType || alert.category || 'Other';
  const badgeEl = document.getElementById('modal-adv-badge');
  if (badgeEl) {
    badgeEl.innerHTML = window.GeoSafeAdvisories
      ? window.GeoSafeAdvisories.renderBadge(categoryName, { badgeColor: alert.badgeColor })
      : escapeHtmlSafe(categoryName);
  }
  const urgencyEl = document.getElementById('modal-adv-urgency');
  if (urgencyEl) urgencyEl.innerHTML = renderUrgencyBadgeSafe(alert.urgencyLevel);

  const statusEl = document.getElementById('modal-adv-status');
  const statusText = alert.status || 'Active';
  const statusLower = statusText.toLowerCase();
  const isMuted = statusLower === 'expired' || statusLower === 'archived' || statusLower === 'cancelled';
  if (statusEl) {
    statusEl.textContent = statusText;
    const statusCls = statusLower === 'expired'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : (isMuted ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-emerald-50 text-[#278653] border-emerald-200');
    statusEl.className = `text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusCls}`;
  }
  document.getElementById('modal-adv-title').textContent = alert.title || 'Advisory';
  document.getElementById('modal-adv-message').textContent = alert.description || '';

  const areaWrap = document.getElementById('modal-adv-area-wrap');
  const affectedLoc = String(alert.locationAddress || alert.targetZones || alert.affectedLocation || '').trim();
  if (areaWrap) {
    areaWrap.classList.toggle('hidden', !affectedLoc);
    if (affectedLoc) {
      document.getElementById('modal-adv-area').textContent = affectedLoc;
    }
  }

  document.getElementById('modal-adv-date').textContent = formatAlertDate(alert.publishedAt);
  const expiresWrap = document.getElementById('modal-adv-expires-wrap');
  const expiresEl = document.getElementById('modal-adv-expires');
  if (expiresWrap && expiresEl) {
    expiresWrap.classList.toggle('hidden', !alert.expiresAt);
    if (alert.expiresAt) {
      expiresEl.textContent = formatAlertDate(alert.expiresAt);
    }
  }
  document.getElementById('modal-adv-author').textContent = alert.issuingAuthority || 'BDRRMC Barangay Bayanan';
  document.getElementById('modal-adv-ref').textContent = alert.id || '-';

  modal.classList.remove('hidden');
}

function closeResponderAdvisoryModal() {
  document.getElementById('advisory-detail-modal')?.classList.add('hidden');
}

window.loadResponderHazardAlerts = loadResponderHazardAlerts;
window.applyResponderAlertsFilterAndSort = applyResponderAlertsFilterAndSort;
window.openResponderAdvisoryModal = openResponderAdvisoryModal;
window.closeResponderAdvisoryModal = closeResponderAdvisoryModal;
