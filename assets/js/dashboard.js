/**
 * GeoSafe - Dashboard Page Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeUI.init('dashboard', 'Dashboard');
  updateLiveDate();
  await loadDashboardData();
});

function updateLiveDate() {
  const dateEl = document.getElementById('current-date-display');
  if (!dateEl) return;
  const now = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  dateEl.textContent = now.toLocaleDateString('en-US', options);
}

async function loadDashboardData() {
  const container = document.getElementById('dashboard-content');
  const loadingEl = document.getElementById('dashboard-loading');
  const errorEl = document.getElementById('dashboard-error');

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (container) container.classList.add('hidden');
  if (errorEl) errorEl.classList.add('hidden');

  try {
    const data = await window.geoSafeStore.getDashboardSummary();
    if (loadingEl) loadingEl.classList.add('hidden');
    if (container) container.classList.remove('hidden');

    const welcomeHeading = document.getElementById('dashboard-welcome-heading');
    if (welcomeHeading) {
      if (data.resident && data.resident.firstName) {
        welcomeHeading.textContent = `Magandang araw, ${data.resident.firstName} ${data.resident.lastName || ''}`.trim();
      } else {
        welcomeHeading.textContent = 'Magandang araw, Resident';
      }
    }

    renderSummaryCounts(data.counts);
    renderActiveRescueBanner(data.activeRescue);
    renderLatestAlerts(data.latestAlerts);
    renderRecentReports(data.recentReports);
    renderEvacuationSummary();
  } catch (err) {
    console.error('Error loading dashboard data:', err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) {
      errorEl.classList.remove('hidden');
      const errorMsg = document.getElementById('dashboard-error-msg');
      if (errorMsg) {
        errorMsg.textContent = err.isOffline
          ? 'Network disconnected. GeoSafe requires an active internet connection to load current emergency data.'
          : 'Failed to retrieve dashboard records. Please verify your connection and try again.';
      }
    }
  }
}

function renderSummaryCounts(counts) {
  document.getElementById('count-total-reports').textContent = counts.total || 0;
  document.getElementById('count-pending-reports').textContent = counts.pending || 0;
  document.getElementById('count-verified-reports').textContent = counts.verified || 0;
  document.getElementById('count-resolved-reports').textContent = counts.resolved || 0;
}

function renderActiveRescueBanner(activeRescue) {
  const banner = document.getElementById('active-rescue-banner');
  if (!banner) return;

  if (activeRescue) {
    banner.classList.remove('hidden');
    banner.innerHTML = `
      <div class="bg-gradient-to-r from-emergency-600 to-rose-700 rounded-2xl p-4 sm:p-5 text-white shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
            ${GeoSafeUI.getIcon('life-buoy', 'w-6 h-6 text-white animate-spin-slow')}
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-white text-emergency-700 uppercase tracking-wide">Active Rescue</span>
              <span class="text-xs font-semibold text-rose-100">${activeRescue.id}</span>
            </div>
            <h3 class="text-base font-bold mt-1">${activeRescue.emergencyType}</h3>
            <p class="text-xs text-rose-100 mt-0.5">${activeRescue.location} | Status: <strong class="underline">${activeRescue.status}</strong> (${activeRescue.assignedUnit})</p>
          </div>
        </div>
        <div class="flex items-center gap-2.5 w-full md:w-auto">
          <a href="rescue-requests.html" class="w-full md:w-auto text-center px-4 py-2 bg-white hover:bg-rose-50 text-emergency-700 font-bold text-xs rounded-xl shadow-sm transition-colors">
            Track Rescue Dispatch
          </a>
        </div>
      </div>
    `;
  } else {
    banner.classList.add('hidden');
  }
}

function renderLatestAlerts(alerts) {
  const listEl = document.getElementById('dashboard-alerts-list');
  const emptyEl = document.getElementById('dashboard-alerts-empty');
  if (!listEl) return;

  if (!alerts || alerts.length === 0) {
    listEl.classList.add('hidden');
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }

  listEl.classList.remove('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');

  listEl.innerHTML = alerts.map(alert => `
    <div class="p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-card transition-all bg-white flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-xs font-medium text-slate-500">${alert.category}</span>
          ${GeoSafeUI.renderSeverityBadge(alert.severity)}
        </div>
        <h4 class="text-sm font-bold text-slate-900 leading-snug hover:text-brand-700 cursor-pointer" onclick="openAlertDetailModal('${alert.id}')">
          ${alert.title}
        </h4>
        <p class="text-xs text-slate-600 mt-1 line-clamp-2">${alert.description}</p>
      </div>
      <div class="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span class="truncate max-w-[180px] flex items-center gap-1">
          ${GeoSafeUI.getIcon('map-pin', 'w-3.5 h-3.5 text-slate-400')}
          ${alert.affectedLocation}
        </span>
        <button onclick="openAlertDetailModal('${alert.id}')" class="text-brand-600 hover:text-brand-800 font-semibold text-xs inline-flex items-center gap-1">
          Details
        </button>
      </div>
    </div>
  `).join('');
}

function renderRecentReports(reports) {
  const container = document.getElementById('dashboard-reports-container');
  const emptyEl = document.getElementById('dashboard-reports-empty');
  if (!container) return;

  if (!reports || reports.length === 0) {
    container.classList.add('hidden');
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }

  container.classList.remove('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');

  // Desktop Table / Mobile Cards
  container.innerHTML = `
    <!-- Desktop Table -->
    <div class="hidden md:block overflow-x-auto">
      <table class="w-full text-left border-collapse text-xs">
        <thead>
          <tr class="border-b border-slate-200 text-slate-500 font-semibold bg-slate-50/50">
            <th class="py-3 px-4">Ref #</th>
            <th class="py-3 px-4">Incident Type</th>
            <th class="py-3 px-4">Location</th>
            <th class="py-3 px-4">Date</th>
            <th class="py-3 px-4">Status</th>
            <th class="py-3 px-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${reports.map(r => `
            <tr class="hover:bg-slate-50 transition-colors">
              <td class="py-3 px-4 font-mono font-semibold text-slate-900">${r.id}</td>
              <td class="py-3 px-4 font-medium text-slate-800">${r.incidentType}</td>
              <td class="py-3 px-4 text-slate-600 truncate max-w-[180px]">${r.location}</td>
              <td class="py-3 px-4 text-slate-500">${GeoSafeUI.formatDate(r.submittedAt)}</td>
              <td class="py-3 px-4">${GeoSafeUI.renderReportStatusBadge(r.status)}</td>
              <td class="py-3 px-4 text-right">
                <button onclick="openReportDetailModal('${r.id}')" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-brand-50 text-slate-700 hover:text-brand-700 font-medium transition-colors">
                  View
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- Mobile Stacked Cards -->
    <div class="md:hidden space-y-3">
      ${reports.map(r => `
        <div class="p-4 rounded-xl border border-slate-200 bg-white shadow-subtle">
          <div class="flex items-center justify-between mb-2">
            <span class="font-mono text-xs font-bold text-slate-900">${r.id}</span>
            ${GeoSafeUI.renderReportStatusBadge(r.status)}
          </div>
          <h4 class="text-sm font-semibold text-slate-800">${r.incidentType}</h4>
          <p class="text-xs text-slate-500 mt-0.5">${r.location}</p>
          <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
            <span class="text-[11px] text-slate-400">${GeoSafeUI.formatRelative(r.submittedAt)}</span>
            <button onclick="openReportDetailModal('${r.id}')" class="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-800">
              <span>View Details</span>
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function renderEvacuationSummary() {
  const container = document.getElementById('dashboard-evacuation-list');
  if (!container || !window.geoSafeStore) return;

  try {
    const centers = await window.geoSafeStore.getEvacuationCenters('All');
    if (!centers || centers.length === 0) {
      container.innerHTML = `<div class="p-4 rounded-xl border border-slate-200 bg-white text-center text-xs text-slate-500">No evacuation centers registered yet.</div>`;
      return;
    }
    const topCenters = centers.slice(0, 3);

    container.innerHTML = topCenters.map(c => `
      <div class="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between gap-2 mb-1.5">
            <h4 class="text-xs font-bold text-slate-900 leading-tight">${c.name}</h4>
            <span class="inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.status === 'Open - Accommodating' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
              ${c.status.split(' - ')[0]}
            </span>
          </div>
          <p class="text-[11px] text-slate-500 truncate">${c.address}</p>
        </div>
        <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
          <span class="text-[11px] text-slate-600 font-medium">Capacity: ${c.capacity.available} available</span>
          <a href="evacuation-centers.html" class="text-brand-600 hover:text-brand-800 font-semibold text-[11px]">View on Map</a>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<p class="text-xs text-slate-400">Centers unavailable.</p>`;
  }
}

// Global modal triggers for dashboard
async function openAlertDetailModal(id) {
  try {
    const alerts = await window.geoSafeStore.getHazardAlerts();
    const alert = alerts.find(a => a.id === id);
    if (!alert) return;

    let modal = document.getElementById('dashboard-alert-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dashboard-alert-modal';
      modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm';
      document.body.appendChild(modal);
    }

    modal.classList.remove('hidden');
    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-lg w-full p-6 shadow-modal border border-slate-200 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div class="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div class="flex items-center gap-2 mb-1">
              ${GeoSafeUI.renderSeverityBadge(alert.severity)}
              <span class="text-xs font-medium text-slate-500">${alert.category}</span>
            </div>
            <h3 class="text-base font-bold text-slate-900">${alert.title}</h3>
          </div>
          <button onclick="document.getElementById('dashboard-alert-modal').classList.add('hidden')" class="p-1 rounded-lg text-slate-400 hover:text-slate-600">
            ${GeoSafeUI.getIcon('x', 'w-5 h-5')}
          </button>
        </div>

        <div class="mt-4 space-y-3.5 text-xs">
          <div>
            <span class="text-slate-400 block font-medium">Affected Sector:</span>
            <span class="text-slate-800 font-semibold">${alert.affectedLocation}</span>
          </div>
          <div>
            <span class="text-slate-400 block font-medium">Issuing Authority:</span>
            <span class="text-slate-800 font-medium">${alert.issuingAuthority}</span>
          </div>
          <div>
            <span class="text-slate-400 block font-medium">Advisory Overview:</span>
            <p class="text-slate-700 leading-relaxed mt-0.5">${alert.description}</p>
          </div>
          <div class="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl">
            <h4 class="font-bold text-amber-900 mb-1.5 flex items-center gap-1.5">
              ${GeoSafeUI.getIcon('alert-triangle', 'w-4 h-4 text-amber-700')}
              Safety Directives
            </h4>
            <ul class="list-disc list-inside space-y-1 text-amber-900 text-[11px] leading-relaxed">
              ${alert.safetyInstructions.map(instr => `<li>${instr}</li>`).join('')}
            </ul>
          </div>
        </div>

        <div class="mt-5 flex items-center justify-between pt-3 border-t border-slate-100">
          <span class="text-[11px] text-slate-400">Published: ${GeoSafeUI.formatDate(alert.publishedAt)}</span>
          <button onclick="document.getElementById('dashboard-alert-modal').classList.add('hidden')" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs">
            Close
          </button>
        </div>
      </div>
    `;
  } catch (e) {
    console.error(e);
  }
}

async function openReportDetailModal(id) {
  try {
    const report = await window.geoSafeStore.getReportById(id);
    if (!report) return;

    let modal = document.getElementById('dashboard-report-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dashboard-report-modal';
      modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm';
      document.body.appendChild(modal);
    }

    modal.classList.remove('hidden');
    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-lg w-full p-6 shadow-modal border border-slate-200 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div class="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="font-mono text-xs font-bold text-slate-900">${report.id}</span>
              ${GeoSafeUI.renderReportStatusBadge(report.status)}
            </div>
            <h3 class="text-base font-bold text-slate-900">${report.title}</h3>
          </div>
          <button onclick="document.getElementById('dashboard-report-modal').classList.add('hidden')" class="p-1 rounded-lg text-slate-400 hover:text-slate-600">
            ${GeoSafeUI.getIcon('x', 'w-5 h-5')}
          </button>
        </div>

        <div class="mt-4 space-y-3 text-xs">
          <div>
            <span class="text-slate-400 block font-medium">Incident Type:</span>
            <span class="text-slate-800 font-semibold">${report.incidentType}</span>
          </div>
          <div>
            <span class="text-slate-400 block font-medium">Location:</span>
            <span class="text-slate-800 font-medium">${report.location}</span>
          </div>
          <div>
            <span class="text-slate-400 block font-medium">Description:</span>
            <p class="text-slate-700 leading-relaxed mt-0.5">${report.description}</p>
          </div>
          ${report.assignedTeam ? `
            <div class="p-2.5 bg-brand-50 border border-brand-200 rounded-lg">
              <span class="text-[10px] font-bold text-brand-800 uppercase tracking-wide">Assigned Unit</span>
              <p class="text-xs font-semibold text-brand-900">${report.assignedTeam}</p>
            </div>
          ` : ''}

          <!-- Timeline -->
          <div class="pt-2">
            <h4 class="font-bold text-slate-800 mb-2">Status Timeline</h4>
            <div class="border-l-2 border-slate-200 pl-3 space-y-3">
              ${report.timeline.map(t => `
                <div class="relative">
                  <div class="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-brand-600 ring-4 ring-white"></div>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-slate-900 text-xs">${t.status}</span>
                    <span class="text-[10px] text-slate-400">${GeoSafeUI.formatRelative(t.time)}</span>
                  </div>
                  <p class="text-slate-500 text-[11px] mt-0.5">${t.note}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-end pt-3 border-t border-slate-100">
          <button onclick="document.getElementById('dashboard-report-modal').classList.add('hidden')" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs">
            Close
          </button>
        </div>
      </div>
    `;
  } catch (e) {
    console.error(e);
  }
}

window.openAlertDetailModal = openAlertDetailModal;
window.openReportDetailModal = openReportDetailModal;
window.loadDashboardData = loadDashboardData;

