/**
 * GeoSafe - Hazard Alerts Page Logic
 */

let activeSeverityFilter = 'All';

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeUI.init('hazard-alerts', 'Alerts');
  setupSeverityTabs();
  await loadHazardAlerts();

  window.addEventListener('geosafe:realtime-update', () => {
    loadHazardAlerts();
  });
});

function setupSeverityTabs() {
  const tabs = document.querySelectorAll('.severity-tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('bg-[#F5B900]', 'text-[#202020]', 'border-[#F5B900]', 'font-bold', 'shadow-subtle');
        t.classList.add('bg-white', 'text-[#555555]', 'border-[#EEEEEE]', 'font-semibold');
      });
      tab.classList.remove('bg-white', 'text-[#555555]', 'border-[#EEEEEE]', 'font-semibold');
      tab.classList.add('bg-[#F5B900]', 'text-[#202020]', 'border-[#F5B900]', 'font-bold', 'shadow-subtle');

      activeSeverityFilter = tab.getAttribute('data-severity');
      loadHazardAlerts();
    });
  });
}

async function loadHazardAlerts() {
  const loadingEl = document.getElementById('alerts-loading');
  const errorEl = document.getElementById('alerts-error');
  const emptyEl = document.getElementById('alerts-empty');
  const listContainer = document.getElementById('alerts-list-container');

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');
  if (listContainer) listContainer.classList.add('hidden');

  try {
    const alerts = await window.geoSafeStore.getHazardAlerts({ severity: activeSeverityFilter });
    if (loadingEl) loadingEl.classList.add('hidden');

    if (!alerts || alerts.length === 0) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (listContainer) {
      listContainer.classList.remove('hidden');
      renderAlerts(alerts);
    }
  } catch (err) {
    console.error('Failed to load hazard alerts:', err);
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

function getSeverityAccent(severity) {
  const s = String(severity || '').toLowerCase();
  if (s === 'critical') return 'border-[#D93636]';
  if (s === 'high') return 'border-rose-400';
  if (s === 'moderate' || s === 'medium') return 'border-amber-400';
  if (s === 'low') return 'border-blue-400';
  return 'border-[#EEEEEE]';
}

function renderAlerts(alerts) {
  const container = document.getElementById('alerts-list');
  if (!container) return;

  container.innerHTML = alerts.map(alert => {
    const isCritical = String(alert.severity || '').toLowerCase() === 'critical';
    const borderCls = getSeverityAccent(alert.severity);
    const instructions = Array.isArray(alert.safetyInstructions) ? alert.safetyInstructions : [];

    return `
      <div class="bg-white rounded-2xl border-l-4 border ${borderCls} shadow-card overflow-hidden">
        <div class="p-3.5 sm:p-4 space-y-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2 flex-wrap">
              ${GeoSafeUI.renderSeverityBadge(alert.severity)}
              <span class="text-[11px] font-semibold text-[#555555]">${alert.category || 'Alert'}</span>
              <span class="text-[11px] text-[#777777]">${GeoSafeUI.formatDate(alert.publishedAt)}</span>
            </div>
            <div class="text-[11px] text-[#555555] inline-flex items-center gap-1">
              ${GeoSafeUI.getIcon('map-pin', 'w-3.5 h-3.5 text-[#8A6800]')}
              <span class="font-semibold text-[#202020]">${alert.affectedLocation || 'Barangay Bayanan'}</span>
            </div>
          </div>

          <div>
            <h2 class="text-sm sm:text-base font-bold text-[#202020] leading-snug">${alert.title || 'Safety Alert'}</h2>
            ${alert.description ? `<p class="text-xs text-[#555555] mt-1 leading-relaxed">${alert.description}</p>` : ''}
          </div>

          ${instructions.length > 0 ? `
            <div class="p-2.5 rounded-xl ${isCritical ? 'bg-[#FFF1F1] border border-[#FFC2C2] text-[#202020]' : 'bg-[#FFF9E8] border border-[#FFE872] text-[#202020]'}">
              <ul class="list-disc list-inside space-y-0.5 text-[11px] leading-snug">
                ${instructions.map(instr => `<li>${instr}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          <div class="pt-2 flex items-center justify-between gap-2 text-[11px] text-[#777777] border-t border-[#F3F4F6]">
            <span>${alert.issuingAuthority || 'BDRRMC Barangay Bayanan'}</span>
            <a href="evacuation-routes.html" class="inline-flex items-center gap-1 text-[#8A6800] hover:text-[#202020] font-bold">
              <span>Evacuation Routes</span>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.loadHazardAlerts = loadHazardAlerts;
