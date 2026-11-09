/**
 * GeoSafe - Hazard Alerts Page Logic
 */

let activeSeverityFilter = 'All';

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeUI.init('hazard-alerts', 'Hazard Alerts');
  setupSeverityTabs();
  await loadHazardAlerts();
});

function setupSeverityTabs() {
  const tabs = document.querySelectorAll('.severity-tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('bg-brand-900', 'text-white', 'font-semibold', 'shadow-sm');
        t.classList.add('bg-white', 'text-slate-600', 'hover:bg-slate-100');
      });
      tab.classList.remove('bg-white', 'text-slate-600', 'hover:bg-slate-100');
      tab.classList.add('bg-brand-900', 'text-white', 'font-semibold', 'shadow-sm');

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
          ? 'Network offline. An active internet connection is required to receive verified hazard alerts.'
          : 'Unable to retrieve alert feed. Please retry.';
      }
    }
  }
}

function renderAlerts(alerts) {
  const container = document.getElementById('alerts-list');
  if (!container) return;

  container.innerHTML = alerts.map(alert => {
    const isCritical = alert.severity === 'Critical';
    const borderCls = isCritical ? 'border-emergency-300 ring-1 ring-emergency-200' : 'border-slate-200';
    const bgHeader = isCritical ? 'bg-emergency-50/70' : 'bg-slate-50/60';

    return `
      <div class="bg-white rounded-2xl border ${borderCls} shadow-card overflow-hidden transition-all hover:shadow-card-hover">
        <div class="p-5 sm:p-6 ${bgHeader} border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div class="flex items-center gap-2 mb-1.5">
              ${GeoSafeUI.renderSeverityBadge(alert.severity)}
              <span class="text-xs font-semibold text-slate-600">${alert.category}</span>
              <span class="w-1 h-1 rounded-full bg-slate-300 inline-block"></span>
              <span class="text-xs text-slate-500">${GeoSafeUI.formatDate(alert.publishedAt)}</span>
            </div>
            <h3 class="text-base sm:text-lg font-bold text-slate-900 leading-snug">${alert.title}</h3>
          </div>
          <div class="text-xs text-slate-500 flex items-center gap-1.5 flex-shrink-0">
            ${GeoSafeUI.getIcon('map-pin', 'w-4 h-4 text-slate-400')}
            <span class="font-medium text-slate-700">${alert.affectedLocation}</span>
          </div>
        </div>

        <div class="p-5 sm:p-6 space-y-4 text-xs sm:text-sm">
          <div>
            <span class="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Alert Advisory</span>
            <p class="text-slate-700 leading-relaxed">${alert.description}</p>
          </div>

          <!-- Official Safety Directives -->
          <div class="p-4 rounded-xl ${isCritical ? 'bg-emergency-50/50 border border-emergency-100 text-emergency-950' : 'bg-amber-50/60 border border-amber-100 text-amber-950'}">
            <h4 class="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
              ${GeoSafeUI.getIcon('shield-check', 'w-4 h-4')}
              Actionable Safety Instructions
            </h4>
            <ul class="list-disc list-inside space-y-1 text-xs leading-relaxed">
              ${alert.safetyInstructions.map(instr => `<li>${instr}</li>`).join('')}
            </ul>
          </div>

          <!-- Issuing Authority -->
          <div class="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500 border-t border-slate-100">
            <div>
              <span class="font-medium">Issuing Authority:</span>
              <strong class="text-slate-700 ml-1">${alert.issuingAuthority}</strong>
            </div>
            <div class="flex items-center gap-2">
              <a href="evacuation-centers.html" class="inline-flex items-center gap-1 text-brand-600 hover:text-brand-800 font-semibold">
                <span>Evacuation Centers</span>
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.loadHazardAlerts = loadHazardAlerts;

