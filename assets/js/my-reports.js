/**
 * GeoSafe - My Reports Management Page Logic
 */

let currentFilters = {
  search: '',
  status: 'All',
  incidentType: 'All'
};

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeUI.init('my-reports', 'My Reports');
  setupFilterControls();
  await loadReports();
});

function setupFilterControls() {
  const searchInput = document.getElementById('search-reports-input');
  const statusFilter = document.getElementById('filter-status-select');
  const typeFilter = document.getElementById('filter-type-select');

  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentFilters.search = e.target.value;
        loadReports();
      }, 250);
    });
  }

  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      currentFilters.status = e.target.value;
      loadReports();
    });
  }

  if (typeFilter) {
    typeFilter.addEventListener('change', (e) => {
      currentFilters.incidentType = e.target.value;
      loadReports();
    });
  }
}

async function loadReports() {
  const loadingEl = document.getElementById('reports-loading');
  const errorEl = document.getElementById('reports-error');
  const emptyEl = document.getElementById('reports-empty');
  const tableContainer = document.getElementById('reports-table-container');
  const countEl = document.getElementById('reports-count-label');

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');
  if (tableContainer) tableContainer.classList.add('hidden');

  try {
    const reports = await window.geoSafeStore.getReports(currentFilters);
    if (loadingEl) loadingEl.classList.add('hidden');

    if (countEl) {
      countEl.textContent = `${reports.length} report${reports.length === 1 ? '' : 's'}`;
    }

    if (!reports || reports.length === 0) {
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        const emptyTitle = document.getElementById('reports-empty-title');
        const emptyMsg = document.getElementById('reports-empty-text');
        const isFiltering = (currentFilters.search || currentFilters.status !== 'All' || currentFilters.incidentType !== 'All');

        if (emptyTitle) {
          emptyTitle.textContent = isFiltering ? 'No Reports Found' : 'No reports submitted yet.';
        }
        if (emptyMsg) {
          emptyMsg.textContent = isFiltering
            ? 'No reports match your selected search or filter criteria.'
            : 'When you submit an incident report, its verification progress and responder updates will appear here.';
        }
      }
      return;
    }

    if (tableContainer) {
      tableContainer.classList.remove('hidden');
      renderReportsList(reports);
    }
  } catch (err) {
    console.error('Failed to load reports:', err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) {
      errorEl.classList.remove('hidden');
      const msg = document.getElementById('reports-error-text');
      if (msg) {
        msg.textContent = err.isOffline
          ? 'Network offline. An active connection is required to fetch report records.'
          : 'Failed to retrieve reports from server. Please retry.';
      }
    }
  }
}

function renderReportsList(reports) {
  const desktopTbody = document.getElementById('reports-tbody');
  const mobileCards = document.getElementById('reports-mobile-cards');

  if (desktopTbody) {
    desktopTbody.innerHTML = reports.map(r => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="py-3.5 px-4 font-mono font-bold text-slate-900 text-xs">${r.id}</td>
        <td class="py-3.5 px-4">
          <div class="font-semibold text-slate-800 text-xs">${r.incidentType}</div>
          <div class="text-[11px] text-slate-500 truncate max-w-xs">${r.title}</div>
        </td>
        <td class="py-3.5 px-4 text-xs text-slate-600 truncate max-w-[200px]">${r.location}</td>
        <td class="py-3.5 px-4 text-xs text-slate-500 whitespace-nowrap">${GeoSafeUI.formatDate(r.submittedAt)}</td>
        <td class="py-3.5 px-4">${GeoSafeUI.renderSeverityBadge(r.severity)}</td>
        <td class="py-3.5 px-4">
          ${GeoSafeUI.renderReportStatusBadge(r.status)}
          ${r.status === 'Rejected' && r.rejectionReason ? `<span class="block text-[10px] text-rose-600 truncate max-w-[140px] mt-0.5" title="${r.rejectionReason}">Reason provided</span>` : ''}
        </td>
        <td class="py-3.5 px-4 text-right">
          <button onclick="viewReportDetails('${r.id}')" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-brand-50 hover:text-brand-700 text-slate-700 font-semibold text-xs transition-colors">
            View Details
          </button>
        </td>
      </tr>
    `).join('');
  }

  if (mobileCards) {
    mobileCards.innerHTML = reports.map(r => `
      <div class="p-4 rounded-xl border border-slate-200 bg-white shadow-subtle flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="font-mono text-xs font-bold text-slate-900">${r.id}</span>
            <div class="flex items-center gap-1.5">
              ${GeoSafeUI.renderSeverityBadge(r.severity)}
              ${GeoSafeUI.renderReportStatusBadge(r.status)}
            </div>
          </div>
          <h4 class="text-sm font-bold text-slate-900">${r.incidentType}</h4>
          <p class="text-xs text-slate-600 mt-0.5 font-medium">${r.title}</p>
          <p class="text-xs text-slate-500 mt-1 flex items-center gap-1">
            ${GeoSafeUI.getIcon('map-pin', 'w-3.5 h-3.5 text-slate-400')}
            ${r.location}
          </p>
          ${r.status === 'Rejected' && r.rejectionReason ? `
            <div class="mt-2 p-2 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-700">
              <strong>Rejection Reason:</strong> ${r.rejectionReason}
            </div>
          ` : ''}
        </div>
        <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
          <span class="text-[11px] text-slate-400">${GeoSafeUI.formatRelative(r.submittedAt)}</span>
          <button onclick="viewReportDetails('${r.id}')" class="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-800">
            <span>View Details</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
          </button>
        </div>
      </div>
    `).join('');
  }
}

async function viewReportDetails(reportId) {
  try {
    const report = await window.geoSafeStore.getReportById(reportId);
    if (!report) return;

    const modal = document.getElementById('report-detail-modal');
    if (!modal) return;

    document.getElementById('modal-report-id').textContent = report.id;
    document.getElementById('modal-report-status-badge').innerHTML = GeoSafeUI.renderReportStatusBadge(report.status);
    document.getElementById('modal-report-type').textContent = report.incidentType;
    document.getElementById('modal-report-severity').innerHTML = GeoSafeUI.renderSeverityBadge(report.severity);
    document.getElementById('modal-report-title').textContent = report.title;
    document.getElementById('modal-report-description').textContent = report.description;
    document.getElementById('modal-report-location').textContent = report.location;
    document.getElementById('modal-report-gps').textContent = `${report.coordinates.lat}° N, ${report.coordinates.lng}° E`;
    document.getElementById('modal-report-datetime').textContent = GeoSafeUI.formatDate(report.submittedAt);

    // Rejection reason banner
    const rejectionSection = document.getElementById('modal-report-rejection');
    if (report.status === 'Rejected' && report.rejectionReason) {
      rejectionSection.classList.remove('hidden');
      document.getElementById('modal-report-rejection-reason').textContent = report.rejectionReason;
    } else {
      rejectionSection.classList.add('hidden');
    }

    // Assigned team
    const teamSection = document.getElementById('modal-report-team-section');
    if (report.assignedTeam) {
      teamSection.classList.remove('hidden');
      document.getElementById('modal-report-assigned-team').textContent = report.assignedTeam;
    } else {
      teamSection.classList.add('hidden');
    }

    // Timeline
    const timelineEl = document.getElementById('modal-report-timeline');
    if (timelineEl) {
      timelineEl.innerHTML = report.timeline.map((step, idx) => `
        <div class="relative pl-6 pb-4 ${idx === report.timeline.length - 1 ? '' : 'border-l-2 border-slate-200'}">
          <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-brand-600 ring-4 ring-white"></div>
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-800">${step.status}</span>
            <span class="text-[11px] text-slate-400">${GeoSafeUI.formatDate(step.time)}</span>
          </div>
          <p class="text-xs text-slate-600 mt-0.5">${step.note}</p>
        </div>
      `).join('');
    }

    modal.classList.remove('hidden');
  } catch (err) {
    GeoSafeUI.showToast('Could not load report details.', 'error');
  }
}

window.closeReportDetailsModal = function () {
  const modal = document.getElementById('report-detail-modal');
  if (modal) modal.classList.add('hidden');
};

window.viewReportDetails = viewReportDetails;
window.loadReports = loadReports;

