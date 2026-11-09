/**
 * GeoSafe Administrator Portal Controller
 * ============================================================================
 * Connects the GeoSafe Administrator UI to live Node.js/Express + MySQL endpoints:
 * - GET   /api/admin/overview
 * - GET   /api/admin/reports
 * - GET   /api/admin/reports/:type/:id
 * - PATCH /api/admin/reports/:type/:id/review
 * - GET   /api/admin/responders
 * - POST  /api/admin/responders/assign
 * - GET   /api/admin/users
 * - POST  /api/admin/users/responders
 * - POST  /api/admin/users/residents
 * - PATCH /api/admin/users/:id/status
 * - GET   /api/admin/broadcasts
 * - POST  /api/admin/broadcasts
 * - GET   /api/admin/analytics
 * - GET   /api/admin/analytics/export
 * - GET   /api/admin/settings
 * - PATCH /api/admin/settings/:key
 * - GET   /api/admin/audit-logs
 *
 * Strict Compliance:
 * - Zero hardcoded operational records, zero fake coordinates, zero emojis.
 * - Enforces backend session + Administrator RBAC verification before rendering.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const state = {
    currentSection: 'dashboard',
    adminUser: null,
    overview: {
      summary: {
        totalReports: 0,
        pendingReview: 0,
        verifiedIncidents: 0,
        activeRescues: 0,
        availableResponders: 0,
        registeredResidents: 0
      },
      mapItems: [],
      evacuationCenters: [],
      recentActivities: []
    },
    mapInstance: null,
    mapLayerGroup: null,
    selectedMapItem: null,
    mapFilters: {
      type: 'all',
      severity: 'all',
      status: 'all'
    },
    reports: {
      items: [],
      pagination: {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 1
      },
      counts: {
        all: 0,
        pending: 0,
        under_review: 0,
        verified: 0,
        rejected: 0,
        resolved: 0
      },
      filters: {
        status: 'all',
        type: 'all',
        severity: 'all',
        search: ''
      },
      loading: false,
      activeDetail: null,
      activeResponders: []
    },
    responders: {
      items: [],
      counts: { total: 0, onDuty: 0, offDuty: 0, active: 0 },
      filters: { search: '' },
      loading: false
    },
    users: {
      items: [],
      pagination: { page: 1, limit: 15, total: 0, totalPages: 1 },
      counts: { residents: 0, responders: 0 },
      filters: {
        role: 'resident',
        status: 'all',
        search: ''
      },
      loading: false,
      selectedUser: null
    },
    broadcasts: {
      items: [],
      loading: false,
      pendingBroadcast: null
    },
    analytics: {
      data: null,
      period: 'all',
      loading: false
    },
    settings: {
      items: [],
      health: null,
      securityStats: null,
      recentSecurityEvents: [],
      loading: false
    },
    audit: {
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      filters: {
        dateFrom: '',
        dateTo: '',
        user: '',
        role: 'all',
        activity: '',
        result: 'all',
        search: ''
      },
      loading: false
    }
  };

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateTime(iso) {
    if (!iso) return 'N/A';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatShortDate(iso) {
    if (!iso) return 'N/A';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    });
  }

  async function apiRequest(endpoint, options = {}) {
    const store = window.geoSafeStore;
    const headers = {
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (store && typeof store.getAuthHeaders === 'function') {
      Object.assign(headers, store.getAuthHeaders(headers));
    } else if (store && typeof store.getCsrfToken === 'function') {
      const csrf = store.getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    const response = await fetch(`/api/admin${endpoint}`, {
      credentials: 'include',
      ...options,
      headers
    });

    if (response.status === 401) {
      window.location.replace('/login.html');
      throw new Error('Authentication session expired. Redirecting to login.');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }

    if (!response.ok) {
      const errMsg = (payload && (payload.error || payload.message)) || `Request failed (HTTP ${response.status})`;
      throw new Error(errMsg);
    }

    return payload;
  }

  function showBannerMessage(message, type = 'success') {
    const banner = document.getElementById('admin-toast-banner');
    const textEl = document.getElementById('admin-toast-text');
    if (!banner || !textEl) return;

    banner.className = 'fixed bottom-5 right-5 z-50 max-w-md px-4 py-3 rounded-2xl border shadow-card text-xs font-semibold flex items-center justify-between gap-3 transition-all';
    if (type === 'error') {
      banner.classList.add('bg-[#FFF1F1]', 'border-[#FFC2C2]', 'text-[#D93636]');
    } else {
      banner.classList.add('bg-[#202020]', 'border-[#202020]', 'text-[#FFF9E8]');
    }

    textEl.textContent = message;
    banner.classList.remove('hidden');

    if (window._adminToastTimer) clearTimeout(window._adminToastTimer);
    window._adminToastTimer = setTimeout(() => {
      banner.classList.add('hidden');
    }, 4500);
  }

  function getSeverityBadgeHtml(severity) {
    const sev = String(severity || 'Medium');
    const lower = sev.toLowerCase();
    if (lower === 'critical' || lower === 'critical evacuation') {
      return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2]">${escapeHtml(sev)}</span>`;
    }
    if (lower === 'high' || lower === 'warning') {
      return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">${escapeHtml(sev)}</span>`;
    }
    if (lower === 'low' || lower === 'advisory') {
      return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">${escapeHtml(sev)}</span>`;
    }
    return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-[#FFF9E8] text-[#8A6800] border border-[#FFE872]">${escapeHtml(sev)}</span>`;
  }

  function getStatusBadgeHtml(statusBucket, statusLabel) {
    const bucket = String(statusBucket || '').toLowerCase();
    const label = escapeHtml(statusLabel || statusBucket || 'Pending');
    if (bucket === 'pending') {
      return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">${label}</span>`;
    }
    if (bucket === 'under_review') {
      return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-blue-50 text-[#3478C7] border border-blue-200">${label}</span>`;
    }
    if (bucket === 'verified') {
      return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-[#FFF9E8] text-[#8A6800] border border-[#FFE872]">${label}</span>`;
    }
    if (bucket === 'resolved') {
      return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-[#278653] border border-emerald-200">${label}</span>`;
    }
    if (bucket === 'rejected') {
      return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">${label}</span>`;
    }
    return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">${label}</span>`;
  }

  function getAccountStatusBadgeHtml(status) {
    const s = String(status || 'active').toLowerCase();
    if (s === 'active') {
      return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-[#278653] border border-emerald-200">Active</span>`;
    }
    if (s === 'suspended') {
      return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">Suspended</span>`;
    }
    if (s === 'deactivated') {
      return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2]">Deactivated</span>`;
    }
    return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">${escapeHtml(status)}</span>`;
  }

  // ============================================================================
  // NAVIGATION (8 Primary Sections & Fixed Sidebar Controls)
  // ============================================================================
  const SECTION_TITLES = {
    dashboard: 'Dashboard Overview',
    reports: 'Disaster Reports & Rescue Requests',
    responders: 'Responder Personnel & Dispatch',
    users: 'User Account Management',
    alerts: 'Emergency Alerts & Notifications',
    analytics: 'Reports & Analytics',
    settings: 'System Settings & Maintenance',
    audit: 'System Audit Logs'
  };

  function openMobileDrawer() {
    const sidebar = document.getElementById('admin-sidebar');
    const overlay = document.getElementById('admin-sidebar-overlay');
    if (sidebar) sidebar.classList.remove('-translate-x-full');
    if (overlay) overlay.classList.remove('hidden');
  }

  function closeMobileDrawer() {
    const sidebar = document.getElementById('admin-sidebar');
    const overlay = document.getElementById('admin-sidebar-overlay');
    if (sidebar) sidebar.classList.add('-translate-x-full');
    if (overlay) overlay.classList.add('hidden');
  }

  function toggleMobileDrawer() {
    const sidebar = document.getElementById('admin-sidebar');
    if (sidebar && sidebar.classList.contains('-translate-x-full')) {
      openMobileDrawer();
    } else {
      closeMobileDrawer();
    }
  }

  let isDesktopSidebarCollapsed = false;
  function toggleDesktopSidebar() {
    const sidebar = document.getElementById('admin-sidebar');
    const wrapper = document.getElementById('admin-layout-wrapper');
    const icon = document.getElementById('sidebar-collapse-icon');
    if (!sidebar || !wrapper) return;

    isDesktopSidebarCollapsed = !isDesktopSidebarCollapsed;

    if (isDesktopSidebarCollapsed) {
      sidebar.classList.remove('w-64');
      sidebar.classList.add('w-20');
      wrapper.classList.remove('lg:pl-64');
      wrapper.classList.add('lg:pl-20');
      document.querySelectorAll('.sidebar-label-wrap').forEach((el) => el.classList.add('lg:hidden'));
      if (icon) icon.classList.add('rotate-180');
    } else {
      sidebar.classList.remove('w-20');
      sidebar.classList.add('w-64');
      wrapper.classList.remove('lg:pl-20');
      wrapper.classList.add('lg:pl-64');
      document.querySelectorAll('.sidebar-label-wrap').forEach((el) => el.classList.remove('lg:hidden'));
      if (icon) icon.classList.remove('rotate-180');
    }

    if (state.mapInstance) {
      setTimeout(() => state.mapInstance.invalidateSize(), 300);
    }
  }

  function startLiveClock() {
    const clockEl = document.getElementById('topbar-live-clock');
    if (!clockEl) return;
    const update = () => {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString('en-PH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    };
    update();
    setInterval(update, 1000);
  }

  function switchAdminSection(sectionKey) {
    const validSections = ['dashboard', 'reports', 'responders', 'users', 'alerts', 'analytics', 'settings', 'audit'];
    const target = validSections.includes(sectionKey) ? sectionKey : 'dashboard';
    state.currentSection = target;

    validSections.forEach((sec) => {
      const panel = document.getElementById(`section-${sec}`);
      if (panel) {
        const isHidden = sec !== target;
        panel.classList.toggle('hidden', isHidden);
        panel.hidden = isHidden;
      }
    });

    // Update Topbar Section Title
    const titleEl = document.getElementById('topbar-section-title');
    if (titleEl && SECTION_TITLES[target]) {
      titleEl.textContent = SECTION_TITLES[target];
    }

    // Update Desktop Sidebar Buttons
    document.querySelectorAll('.admin-sidebar-btn').forEach((btn) => {
      const isMatch = btn.getAttribute('data-admin-nav') === target;
      btn.className = isMatch
        ? 'admin-sidebar-btn w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold bg-[#F5B900] text-[#202020] shadow-subtle transition-all'
        : 'admin-sidebar-btn w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold text-[#555555] hover:bg-[#FFF9E8] hover:text-[#202020] transition-all';
    });

    // Close mobile drawer if open
    closeMobileDrawer();

    if (target === 'dashboard') {
      loadDashboardOverview();
      if (state.mapInstance) {
        setTimeout(() => state.mapInstance.invalidateSize(), 150);
      }
    } else if (target === 'reports') {
      loadReportsList();
    } else if (target === 'responders') {
      loadRespondersList();
    } else if (target === 'users') {
      loadUsersList();
    } else if (target === 'alerts') {
      loadBroadcastsList();
    } else if (target === 'analytics') {
      loadAnalyticsData();
    } else if (target === 'settings') {
      loadSystemSettings();
    } else if (target === 'audit') {
      loadAuditLogs();
    }
  }

  // ============================================================================
  // SECTION 1: DASHBOARD (Summary Statistics + Incident Map + Activity Feed)
  // ============================================================================
  function initIncidentMap() {
    const mapContainer = document.getElementById('admin-incident-map');
    if (!mapContainer || state.mapInstance) return;

    try {
      if (!window.GeoSafeMapping || typeof L === 'undefined') {
        throw new Error('Map library is unavailable.');
      }

      state.mapInstance = window.GeoSafeMapping.createMap('admin-incident-map', {
        scrollWheelZoom: true
      });
      state.mapLayerGroup = L.layerGroup().addTo(state.mapInstance);
    } catch (err) {
      const errorOverlay = document.getElementById('admin-map-error');
      const errorMsg = document.getElementById('admin-map-error-text');
      if (errorOverlay) errorOverlay.classList.remove('hidden');
      if (errorMsg) errorMsg.textContent = 'Incident map initialized with fallback view.';
    }
  }

  function renderMapMarkers() {
    if (!state.mapInstance || !state.mapLayerGroup) return;

    state.mapLayerGroup.clearLayers();

    const items = state.overview.mapItems || [];
    const filterType = state.mapFilters.type;
    const filterSev = state.mapFilters.severity;
    const filterStatus = state.mapFilters.status;

    const visibleItems = items.filter((item) => {
      if (filterType !== 'all' && item.recordType !== filterType) return false;
      if (filterSev !== 'all' && item.rawSeverity !== filterSev) return false;
      if (filterStatus !== 'all' && item.filterBucket !== filterStatus) return false;
      return true;
    });

    const badgeEl = document.getElementById('admin-map-count-badge');
    if (badgeEl) {
      badgeEl.textContent = `${visibleItems.length} marker${visibleItems.length === 1 ? '' : 's'}`;
    }

    const emptyOverlay = document.getElementById('admin-map-empty');
    if (emptyOverlay) {
      emptyOverlay.classList.toggle('hidden', visibleItems.length > 0);
      const emptyText = document.getElementById('admin-map-empty-text');
      if (emptyText) emptyText.textContent = 'No incident locations are currently available.';
    }

    const bounds = L.latLngBounds([]);

    visibleItems.forEach((item) => {
      if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return;

      const isCritical = String(item.severity).toLowerCase() === 'critical';
      const isRescue = item.recordType === 'rescue';

      const color = isCritical ? '#D93636' : isRescue ? '#F5B900' : '#202020';
      const fillColor = isCritical ? '#FFC2C2' : isRescue ? '#FFF9E8' : '#EEEEEE';

      const circle = L.circleMarker([item.latitude, item.longitude], {
        radius: isCritical ? 9 : 7,
        color,
        weight: 2,
        fillColor,
        fillOpacity: 0.9
      });

      circle.on('click', () => {
        showMapMarkerPanel(item);
      });

      circle.addTo(state.mapLayerGroup);
      bounds.extend([item.latitude, item.longitude]);
    });

    // Render evacuation centers on map if available
    const evacCenters = state.overview.evacuationCenters || [];
    evacCenters.forEach((evac) => {
      if (!Number.isFinite(evac.latitude) || !Number.isFinite(evac.longitude)) return;
      const evacMarker = L.circleMarker([evac.latitude, evac.longitude], {
        radius: 8,
        color: '#278653',
        weight: 2,
        fillColor: '#D1FAE5',
        fillOpacity: 0.9
      });
      evacMarker.bindTooltip(`Evacuation Center: ${escapeHtml(evac.name)} (${evac.availableSlots} slots)`, {
        direction: 'top'
      });
      evacMarker.addTo(state.mapLayerGroup);
      bounds.extend([evac.latitude, evac.longitude]);
    });

    if (visibleItems.length > 0 && bounds.isValid()) {
      state.mapInstance.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    }
  }

  function showMapMarkerPanel(item) {
    state.selectedMapItem = item;
    const panel = document.getElementById('admin-map-marker-panel');
    if (!panel) return;

    document.getElementById('map-panel-type').textContent = item.reportTypeLabel;
    document.getElementById('map-panel-ref').textContent = item.referenceNumber;
    document.getElementById('map-panel-category').textContent = item.category;
    document.getElementById('map-panel-time').textContent = formatDateTime(item.submittedAt);
    document.getElementById('map-panel-location').textContent = item.location;

    document.getElementById('map-panel-severity').innerHTML = getSeverityBadgeHtml(item.severity);
    document.getElementById('map-panel-status').innerHTML = getStatusBadgeHtml(item.filterBucket, item.statusLabel);

    const actionBtn = document.getElementById('map-panel-action-btn');
    if (actionBtn) {
      actionBtn.onclick = () => {
        switchAdminSection('reports');
        openReportDetailModal(item.recordType, item.id);
      };
    }

    panel.classList.remove('hidden');
  }

  function closeMapMarkerPanel() {
    const panel = document.getElementById('admin-map-marker-panel');
    if (panel) panel.classList.add('hidden');
    state.selectedMapItem = null;
  }

  function handleMapPanelReview() {
    if (state.selectedMapItem) {
      switchAdminSection('reports');
      openReportDetailModal(state.selectedMapItem.recordType, state.selectedMapItem.id);
    } else {
      switchAdminSection('reports');
    }
  }

  async function loadDashboardOverview() {
    const loadingOverlay = document.getElementById('admin-map-loading');
    const errorOverlay = document.getElementById('admin-map-error');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    if (errorOverlay) errorOverlay.classList.add('hidden');

    try {
      const data = await apiRequest('/overview');
      state.overview = {
        summary: data.summary || {},
        mapItems: data.mapItems || [],
        evacuationCenters: data.evacuationCenters || [],
        recentActivities: data.recentActivities || []
      };

      // Summary Statistics (6 Compact Cards)
      const s = state.overview.summary;
      const elTotal = document.getElementById('stat-total-reports');
      const elPending = document.getElementById('stat-pending-review');
      const elVerified = document.getElementById('stat-verified-incidents');
      const elActive = document.getElementById('stat-active-rescues');
      const elResp = document.getElementById('stat-available-responders');
      const elResidents = document.getElementById('stat-registered-residents');

      if (elTotal) elTotal.textContent = Number(s.totalReports || 0).toLocaleString();
      if (elPending) elPending.textContent = Number(s.pendingReview || 0).toLocaleString();
      if (elVerified) elVerified.textContent = Number(s.verifiedIncidents || 0).toLocaleString();
      if (elActive) elActive.textContent = Number(s.activeRescues || 0).toLocaleString();
      if (elResp) elResp.textContent = Number(s.availableResponders || 0).toLocaleString();
      if (elResidents) elResidents.textContent = Number(s.registeredResidents || s.residentsCount || 0).toLocaleString();

      // Update Pending Badge in sidebar
      const navBadge = document.getElementById('nav-pending-badge');
      const mobileNavBadge = document.getElementById('mobile-nav-pending-badge');
      const pendingCount = Number(s.pendingReview || 0);
      if (navBadge) {
        navBadge.textContent = pendingCount;
        navBadge.classList.toggle('hidden', pendingCount === 0);
      }
      if (mobileNavBadge) {
        mobileNavBadge.textContent = pendingCount;
        mobileNavBadge.classList.toggle('hidden', pendingCount === 0);
      }

      initIncidentMap();
      renderMapMarkers();
      renderActivityFeed(state.overview.recentActivities);
    } catch (err) {
      console.error('[Admin] loadDashboardOverview failed:', err.message);
      if (errorOverlay) errorOverlay.classList.remove('hidden');
    } finally {
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }
  }

  function renderActivityFeed(activities) {
    const listEl = document.getElementById('admin-activity-list');
    const emptyEl = document.getElementById('admin-activity-empty');
    if (!listEl) return;

    listEl.innerHTML = '';
    const items = activities || [];

    if (emptyEl) {
      emptyEl.classList.toggle('hidden', items.length > 0);
    }

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-2.5 rounded-xl border border-[#EEEEEE] hover:bg-[#FFF9E8]/30 text-xs transition-colors';
      row.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-2 h-2 rounded-full bg-[#F5B900]"></div>
          <div>
            <span class="font-bold text-[#202020]">${escapeHtml(item.actionLabel || item.action)}</span>
            <span class="text-[#777777] block text-[11px]">${escapeHtml(item.actorName)} (${escapeHtml(item.role)})</span>
          </div>
        </div>
        <span class="text-[11px] font-medium text-[#777777]">${formatDateTime(item.timestamp)}</span>
      `;
      listEl.appendChild(row);
    });
  }

  // ============================================================================
  // SECTION 2: INCIDENT REPORTS & RESCUE REQUESTS
  // ============================================================================
  function renderReportsTable() {
    const tbody = document.getElementById('admin-reports-tbody');
    const emptyEl = document.getElementById('admin-reports-empty');
    if (!tbody) return;

    tbody.innerHTML = '';
    const allItems = state.reports.items || [];
    const total = allItems.length;
    state.reports.pagination.total = total;
    state.reports.pagination.totalPages = Math.max(1, Math.ceil(total / state.reports.pagination.limit));
    if (state.reports.pagination.page > state.reports.pagination.totalPages) {
      state.reports.pagination.page = state.reports.pagination.totalPages;
    }
    if (state.reports.pagination.page < 1) {
      state.reports.pagination.page = 1;
    }

    if (emptyEl) {
      emptyEl.classList.toggle('hidden', total > 0);
    }

    const page = state.reports.pagination.page;
    const limit = state.reports.pagination.limit;
    const startIdx = (page - 1) * limit;
    const slice = allItems.slice(startIdx, startIdx + limit);

    slice.forEach((r) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-[#FFF9E8]/40 transition-colors';
      tr.innerHTML = `
        <td class="px-4 py-3 font-mono text-xs font-bold text-[#202020]">
          ${escapeHtml(r.referenceNumber)}
        </td>
        <td class="px-4 py-3 text-xs">
          <span class="font-bold text-[#202020] block">${escapeHtml(r.category)}</span>
          <span class="text-[10px] uppercase font-bold text-[#777777]">${escapeHtml(r.typeLabel)}</span>
        </td>
        <td class="px-4 py-3 text-xs text-[#555555] max-w-[200px] truncate" title="${escapeHtml(r.location)}">
          ${escapeHtml(r.location)}
        </td>
        <td class="px-4 py-3 text-xs">
          ${getSeverityBadgeHtml(r.severity)}
        </td>
        <td class="px-4 py-3 text-xs">
          ${getStatusBadgeHtml(r.filterBucket, r.statusLabel)}
        </td>
        <td class="px-4 py-3 text-xs text-[#777777] whitespace-nowrap">
          ${formatShortDate(r.submittedAt || r.createdAt)}
        </td>
        <td class="px-4 py-3 text-xs text-right">
          <button type="button" onclick="window.GeoSafeAdmin.openReportDetailModal('${r.recordType}', ${r.id})" class="px-3 py-1.5 rounded-xl border border-[#EEEEEE] hover:bg-[#FFF9E8] text-xs font-bold text-[#202020] transition-colors">
            Review
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    const pageInfo = document.getElementById('reports-pagination-info');
    if (pageInfo) {
      pageInfo.textContent = `Page ${page} of ${state.reports.pagination.totalPages} (${total} items)`;
    }
    const prevBtn = document.getElementById('reports-prev-btn');
    const nextBtn = document.getElementById('reports-next-btn');
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= state.reports.pagination.totalPages;
  }

  function navigateReportsPage(direction) {
    const target = state.reports.pagination.page + direction;
    if (target < 1 || target > state.reports.pagination.totalPages) return;
    state.reports.pagination.page = target;
    renderReportsTable();
  }

  async function loadReportsList() {
    const loadingEl = document.getElementById('admin-reports-loading');
    const emptyEl = document.getElementById('admin-reports-empty');

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    try {
      const params = new URLSearchParams({
        status: state.reports.filters.status,
        type: state.reports.filters.type,
        search: state.reports.filters.search
      });

      const data = await apiRequest(`/reports?${params.toString()}`);
      state.reports.items = data.items || data.reports || [];
      state.reports.counts = data.counts || state.reports.counts;

      renderReportsTable();
    } catch (err) {
      console.error('[Admin] loadReportsList failed:', err.message);
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        document.getElementById('admin-reports-empty-text').textContent = 'Unable to load reports from MySQL.';
      }
    } finally {
      if (loadingEl) loadingEl.classList.add('hidden');
    }
  }

  let modalLeafletMap = null;
  let modalLeafletMarker = null;

  function initOrUpdateModalMap(lat, lng, refText, locText) {
    const mapEl = document.getElementById('modal-report-map');
    const fallbackEl = document.getElementById('modal-report-map-fallback');
    if (!mapEl || typeof L === 'undefined') return;

    if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) {
      mapEl.classList.add('hidden');
      if (fallbackEl) fallbackEl.classList.remove('hidden');
      return;
    }

    mapEl.classList.remove('hidden');
    if (fallbackEl) fallbackEl.classList.add('hidden');

    try {
      if (!modalLeafletMap) {
        modalLeafletMap = L.map('modal-report-map', {
          zoomControl: true,
          scrollWheelZoom: false,
        }).setView([lat, lng], 16);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors | GeoSafe'
        }).addTo(modalLeafletMap);

        modalLeafletMarker = L.marker([lat, lng]).addTo(modalLeafletMap);
      } else {
        modalLeafletMap.setView([lat, lng], 16);
        if (modalLeafletMarker) {
          modalLeafletMarker.setLatLng([lat, lng]);
        } else {
          modalLeafletMarker = L.marker([lat, lng]).addTo(modalLeafletMap);
        }
      }

      if (modalLeafletMarker) {
        modalLeafletMarker.bindPopup(`<strong>${escapeHtml(refText || 'Incident')}</strong><br>${escapeHtml(locText || '')}`).openPopup();
      }

      setTimeout(() => {
        if (modalLeafletMap) {
          modalLeafletMap.invalidateSize();
        }
      }, 250);
    } catch (err) {
      console.warn('[Admin] Modal map initialization deferred:', err.message);
    }
  }

  function openAttachmentPreviewModal(fileUrl, fileName, fileType) {
    const modal = document.getElementById('admin-attachment-preview-modal');
    const titleEl = document.getElementById('attachment-preview-title');
    const downloadLink = document.getElementById('attachment-preview-download');
    const contentEl = document.getElementById('attachment-preview-content');
    if (!modal || !contentEl) return;

    if (titleEl) titleEl.textContent = fileName || 'Attachment Preview';
    if (downloadLink) {
      downloadLink.href = fileUrl;
      downloadLink.setAttribute('download', fileName || 'attachment');
    }

    const isVideo = (fileType && fileType.includes('video')) || /\.(mp4|webm|mov|ogg)$/i.test(fileUrl);
    if (isVideo) {
      contentEl.innerHTML = `<video controls autoplay class="max-h-[65vh] w-full rounded-xl bg-black">
        <source src="${escapeHtml(fileUrl)}">
        Your browser does not support the video tag.
      </video>`;
    } else {
      contentEl.innerHTML = `<img src="${escapeHtml(fileUrl)}" alt="${escapeHtml(fileName || 'Incident Attachment')}" class="max-h-[65vh] max-w-full object-contain rounded-xl" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'p-8 text-center text-xs text-[#777777]\\'>File cannot be previewed or was removed from server disk.</div>';">`;
    }

    modal.classList.remove('hidden');
  }

  function closeAttachmentPreviewModal() {
    const modal = document.getElementById('admin-attachment-preview-modal');
    const contentEl = document.getElementById('attachment-preview-content');
    if (modal) modal.classList.add('hidden');
    if (contentEl) contentEl.innerHTML = '';
  }

  async function openReportDetailModal(recordType, id) {
    const modal = document.getElementById('admin-report-modal');
    const loadingEl = document.getElementById('admin-report-modal-loading');
    const bodyEl = document.getElementById('admin-report-modal-body');
    const errEl = document.getElementById('review-form-error');
    if (!modal) return;

    modal.classList.remove('hidden');
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (bodyEl) bodyEl.classList.add('hidden');
    if (errEl) errEl.classList.add('hidden');

    try {
      const raw = await apiRequest(`/reports/${recordType}/${id}`);
      const data = raw.detail || raw;
      state.reports.activeDetail = data;

      // Header & Titles
      const typeLabel = data.typeLabel || data.reportType || (recordType === 'rescue' ? 'Rescue Request' : 'Incident Report');
      document.getElementById('modal-report-type').textContent = typeLabel;
      document.getElementById('modal-report-ref').textContent = data.referenceNumber || `${recordType.toUpperCase()}-${id}`;
      const titleEl = document.getElementById('modal-report-title');
      if (titleEl) {
        titleEl.textContent = data.title || `${data.category || 'Incident'} Report`;
      }

      // Section A: Metadata
      document.getElementById('modal-report-category').textContent = data.category || data.incidentType || 'General';
      document.getElementById('modal-report-submitted').textContent = formatDateTime(data.submittedAt || data.createdAt);
      document.getElementById('modal-report-severity').innerHTML = getSeverityBadgeHtml(data.severity);
      document.getElementById('modal-report-status').innerHTML = getStatusBadgeHtml(data.filterBucket, data.statusLabel || data.status);

      // Section B: Description & Category Details
      document.getElementById('modal-report-description').textContent = data.description || 'No description provided.';
      
      const catBox = document.getElementById('modal-category-details');
      if (catBox) {
        if (data.recordType === 'rescue' || data.categoryDetails || data.peopleCount || data.vulnerableDetails || data.landmark) {
          catBox.classList.remove('hidden');
          const people = (data.categoryDetails && data.categoryDetails.peopleCount) || data.peopleCount || 1;
          const vul = (data.categoryDetails && data.categoryDetails.vulnerableDetails) || data.vulnerableDetails || 'None specified';
          const lmk = (data.categoryDetails && data.categoryDetails.landmark) || data.landmark || 'None specified';
          document.getElementById('modal-cat-people').textContent = `${people} person(s)`;
          document.getElementById('modal-cat-vulnerable').textContent = vul;
          document.getElementById('modal-cat-landmark').textContent = lmk;
        } else {
          catBox.classList.add('hidden');
        }
      }

      // Section C: Location & Interactive Map
      const locText = data.location || data.address || 'Barangay Bayanan, Muntinlupa City';
      document.getElementById('modal-report-location').textContent = locText;
      const latVal = data.latitude !== null && data.latitude !== undefined ? Number(data.latitude) : null;
      const lngVal = data.longitude !== null && data.longitude !== undefined ? Number(data.longitude) : null;

      if (latVal !== null && lngVal !== null && !isNaN(latVal) && !isNaN(lngVal)) {
        document.getElementById('modal-report-coords').textContent = `${latVal.toFixed(6)}° N, ${lngVal.toFixed(6)}° E`;
        initOrUpdateModalMap(latVal, lngVal, data.referenceNumber, locText);
      } else {
        document.getElementById('modal-report-coords').textContent = 'No GPS coordinates recorded';
        initOrUpdateModalMap(null, null, null, null);
      }

      // Section D: Reporter Profile
      const rep = data.reporter || {};
      document.getElementById('modal-reporter-name').textContent = rep.name || 'Anonymous Resident';
      const repIdEl = document.getElementById('modal-reporter-id');
      if (repIdEl) {
        repIdEl.textContent = rep.userId || (rep.id ? `USR-${String(rep.id).padStart(5, '0')}` : 'USR-00000');
      }
      document.getElementById('modal-reporter-phone').textContent = rep.phone || 'Not provided';
      document.getElementById('modal-reporter-email').textContent = rep.email || 'Not provided';
      document.getElementById('modal-reporter-address').textContent = rep.address || 'Barangay Bayanan, Muntinlupa City';

      const verEl = document.getElementById('modal-reporter-verification');
      if (verEl) {
        const isVer = String(rep.verificationStatus || '').toLowerCase().includes('verified');
        verEl.innerHTML = `
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
            isVer ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
          }">
            ${escapeHtml(rep.verificationStatus || 'Unverified Resident')}
          </span>
        `;
      }

      // Section E: Triage & Severity Details
      const det = data.severityDetection || {};
      const prio = data.priorityDetails || {};
      const tierEl = document.getElementById('modal-report-priority-tier');
      if (tierEl) {
        tierEl.textContent = prio.tier || (data.severity === 'Critical' ? 'Immediate' : 'Standard');
      }
      const scoreEl = document.getElementById('modal-report-urgency-score');
      if (scoreEl) {
        const scoreVal = prio.score !== undefined ? prio.score : (det.urgencyScore !== undefined ? det.urgencyScore : 50);
        scoreEl.textContent = `${scoreVal} / 100`;
      }
      const kwEl = document.getElementById('modal-report-keywords');
      if (kwEl) {
        const keywords = (det.matchedKeywords && det.matchedKeywords.length > 0)
          ? det.matchedKeywords.join(', ')
          : (det.recommendation || 'Standard automated rules');
        kwEl.textContent = keywords;
      }

      // Section F: Media Attachments
      const attachEl = document.getElementById('modal-report-attachments');
      const countEl = document.getElementById('modal-report-attachment-count');
      attachEl.innerHTML = '';
      const attachments = data.attachments || [];
      if (countEl) {
        countEl.textContent = `${attachments.length} file(s)`;
      }

      if (attachments.length === 0) {
        attachEl.innerHTML = '<span class="text-xs text-[#777777]">No media attached to this submission.</span>';
      } else {
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-2 sm:grid-cols-4 gap-2.5';
        attachments.forEach((att) => {
          const fileUrl = att.fileUrl || att.file_url || '';
          const fileName = att.fileName || att.file_name || 'Incident Attachment';
          const fileType = att.fileType || att.file_type || 'image/jpeg';
          const isVideo = fileType.includes('video') || /\.(mp4|webm|mov|ogg)$/i.test(fileUrl);

          const card = document.createElement('div');
          card.className = 'group relative rounded-2xl overflow-hidden border border-[#EEEEEE] aspect-video bg-[#F7F7F7] cursor-pointer hover:border-[#F5B900] transition-colors shadow-subtle';
          card.onclick = () => openAttachmentPreviewModal(fileUrl, fileName, fileType);

          if (isVideo) {
            card.innerHTML = `
              <div class="w-full h-full flex flex-col items-center justify-center bg-black/10 text-xs font-bold text-[#202020] p-2 text-center">
                <span class="p-2 rounded-full bg-white shadow mb-1">
                  <svg class="w-4 h-4 text-[#202020]" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </span>
                <span class="truncate max-w-[120px] text-[10px]">${escapeHtml(fileName)}</span>
              </div>
            `;
          } else {
            card.innerHTML = `
              <img src="${escapeHtml(fileUrl)}" alt="${escapeHtml(fileName)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<div class=\\'p-2 text-[10px] text-center text-[#777777] flex items-center justify-center h-full\\'>Image unavailable</div>';">
              <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-bold">
                Click to Enlarge
              </div>
            `;
          }
          grid.appendChild(card);
        });
        attachEl.appendChild(grid);
      }

      // Section G: Review Selectors
      const statusSelect = document.getElementById('review-status-select');
      statusSelect.innerHTML = '';
      const allowedStatuses = data.allowedStatuses || data.validStatuses || [];
      allowedStatuses.forEach((st) => {
        const opt = document.createElement('option');
        opt.value = st;
        opt.textContent = st;
        if (st.toLowerCase() === String(data.rawStatus || data.status || '').toLowerCase()) {
          opt.selected = true;
        }
        statusSelect.appendChild(opt);
      });

      const sevSelect = document.getElementById('review-severity-select');
      sevSelect.innerHTML = '';
      const allowedSeverities = data.allowedSeverities || data.validSeverities || [];
      allowedSeverities.forEach((sv) => {
        const opt = document.createElement('option');
        opt.value = sv;
        opt.textContent = sv;
        if (String(sv).toLowerCase() === String(data.rawSeverity || data.severity || '').toLowerCase()) {
          opt.selected = true;
        }
        sevSelect.appendChild(opt);
      });

      // Populate Responders
      const respSelect = document.getElementById('review-responder-select');
      respSelect.innerHTML = '<option value="">-- No Assigned Responder --</option>';
      const responders = data.availableResponders || data.activeResponders || [];
      responders.forEach((resp) => {
        const opt = document.createElement('option');
        opt.value = resp.id;
        opt.textContent = `${resp.name} (${resp.badge_number || resp.badgeNumber || resp.assigned_unit || resp.assignedUnit || 'Active'})`;
        if (Number(data.assignedTo) === Number(resp.id)) {
          opt.selected = true;
        }
        respSelect.appendChild(opt);
      });

      // Section H: Status History
      const histEl = document.getElementById('modal-report-history');
      histEl.innerHTML = '';
      const history = data.statusHistory || data.history || [];
      if (history.length === 0) {
        histEl.innerHTML = '<span class="text-xs text-[#777777]">No historical state changes recorded.</span>';
      } else {
        history.forEach((h) => {
          const item = document.createElement('div');
          item.className = 'text-xs border-b border-[#EEEEEE] pb-2 last:border-b-0';
          const actor = h.actorName || h.changedByName || h.changed_by_name || 'System';
          const role = h.changedByRole || h.changed_by_role || '';
          const notes = h.notes || h.remarks || '';
          item.innerHTML = `
            <div class="flex items-center justify-between text-[#777777] text-[10px]">
              <span>${formatDateTime(h.createdAt || h.created_at)}</span>
              <span>By: ${escapeHtml(actor)}${role ? ` (${escapeHtml(role)})` : ''}</span>
            </div>
            <p class="font-bold text-[#202020] mt-0.5">Status: ${escapeHtml(h.newStatus || h.new_status || h.status)}</p>
            ${notes ? `<p class="text-[11px] text-[#555555] bg-[#F7F7F7] p-1.5 rounded-lg mt-1">${escapeHtml(notes)}</p>` : ''}
          `;
          histEl.appendChild(item);
        });
      }

      if (loadingEl) loadingEl.classList.add('hidden');
      if (bodyEl) bodyEl.classList.remove('hidden');
    } catch (err) {
      console.error('[Admin] openReportDetailModal failed:', err.message);
      if (loadingEl) loadingEl.textContent = 'Unable to load report detail from MySQL.';
    }
  }

  function closeReportDetailModal() {
    const modal = document.getElementById('admin-report-modal');
    if (modal) modal.classList.add('hidden');
    state.reports.activeDetail = null;
  }

  async function submitReportReviewAction(actionType) {
    if (!state.reports.activeDetail) return;
    const errEl = document.getElementById('review-form-error');
    if (errEl) errEl.classList.add('hidden');

    const detail = state.reports.activeDetail;
    const statusVal = document.getElementById('review-status-select').value;
    const sevVal = document.getElementById('review-severity-select').value;
    const respVal = document.getElementById('review-responder-select').value;
    const reasonVal = document.getElementById('review-reason-input').value.trim();

    if ((actionType === 'reject' || actionType === 'clarify') && !reasonVal) {
      if (errEl) {
        errEl.textContent = 'An administrative reason is required when rejecting or requesting clarification.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    try {
      const payload = {
        action: actionType,
        status: statusVal,
        severity: sevVal,
        assignedTo: respVal ? Number(respVal) : null,
        reason: reasonVal
      };

      const result = await apiRequest(`/reports/${detail.recordType}/${detail.id}/review`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });

      showBannerMessage(result.message || 'Report review action completed.');
      closeReportDetailModal();
      loadReportsList();
      loadDashboardOverview();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    }
  }

  // ============================================================================
  // SECTION 3: RESPONDER MANAGEMENT
  // ============================================================================
  async function loadRespondersList() {
    const tbody = document.getElementById('admin-responders-tbody');
    const loadingEl = document.getElementById('admin-responders-loading');
    const emptyEl = document.getElementById('admin-responders-empty');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    try {
      const data = await apiRequest('/responders');
      state.responders.items = data.responders || [];

      let onDuty = 0;
      let offDuty = 0;
      let activeDispatches = 0;

      state.responders.items.forEach((r) => {
        if (r.availabilityStatus === 'On Duty') onDuty += 1;
        else offDuty += 1;
        activeDispatches += Number(r.activeAssignmentsCount || 0);
      });

      document.getElementById('stat-resp-total').textContent = state.responders.items.length;
      document.getElementById('stat-resp-onduty').textContent = onDuty;
      document.getElementById('stat-resp-offduty').textContent = offDuty;
      document.getElementById('stat-resp-active').textContent = activeDispatches;

      if (emptyEl) {
        emptyEl.classList.toggle('hidden', state.responders.items.length > 0);
        emptyEl.innerHTML = '<p class="text-xs font-semibold text-[#777777]">No responders registered.</p>';
      }

      state.responders.items.forEach((r) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-[#FFF9E8]/40 transition-colors';
        const isOnDuty = r.availabilityStatus === 'On Duty';
        const dutyBadge = isOnDuty
          ? '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">On Duty</span>'
          : '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Off Duty</span>';

        tr.innerHTML = `
          <td class="px-4 py-3 font-mono text-xs font-bold text-[#202020]">${escapeHtml(r.badgeNumber)}</td>
          <td class="px-4 py-3 text-xs">
            <span class="font-bold text-[#202020] block">${escapeHtml(r.fullName)}</span>
            <span class="text-[11px] text-[#777777]">${escapeHtml(r.specialization)}</span>
          </td>
          <td class="px-4 py-3 text-xs text-[#555555]">${escapeHtml(r.assignedUnit)}</td>
          <td class="px-4 py-3 text-xs text-[#555555]">${escapeHtml(r.phone || r.email)}</td>
          <td class="px-4 py-3 text-xs">${dutyBadge}</td>
          <td class="px-4 py-3 text-xs font-bold text-[#202020]">${r.activeAssignmentsCount}</td>
          <td class="px-4 py-3 text-xs text-right">
            <button type="button" onclick="window.GeoSafeAdmin.openAssignResponderModal('incident', null, ${r.id})" class="px-3 py-1.5 rounded-xl bg-[#F5B900] hover:bg-[#E5AC00] text-xs font-black text-[#202020] transition-colors shadow-subtle">
              Dispatch
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error('[Admin] loadRespondersList failed:', err.message);
      if (emptyEl) emptyEl.classList.remove('hidden');
    } finally {
      if (loadingEl) loadingEl.classList.add('hidden');
    }
  }

  async function openAssignResponderModal(defaultType = 'incident', defaultTargetId = null, defaultResponderId = null) {
    const modal = document.getElementById('admin-assign-responder-modal');
    const targetSelect = document.getElementById('assign-target-select');
    const respSelect = document.getElementById('assign-responder-select');
    const errEl = document.getElementById('assign-responder-error');
    if (!modal) return;

    modal.classList.remove('hidden');
    if (errEl) errEl.classList.add('hidden');

    targetSelect.innerHTML = '<option value="">Loading active operations...</option>';
    respSelect.innerHTML = '<option value="">Loading responders...</option>';

    try {
      // 1. Fetch open reports
      const reportsData = await apiRequest('/reports?status=pending');
      targetSelect.innerHTML = '';
      const items = reportsData.items || reportsData.reports || [];
      if (items.length === 0) {
        targetSelect.innerHTML = '<option value="">No open reports available</option>';
      } else {
        items.forEach((item) => {
          const opt = document.createElement('option');
          opt.value = `${item.recordType}:${item.id}`;
          opt.textContent = `[${item.typeLabel}] ${item.referenceNumber} - ${item.category}`;
          if (defaultTargetId && Number(item.id) === Number(defaultTargetId)) {
            opt.selected = true;
          }
          targetSelect.appendChild(opt);
        });
      }

      // 2. Fetch responders
      const respData = await apiRequest('/responders');
      respSelect.innerHTML = '';
      const resps = respData.responders || [];
      resps.forEach((r) => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = `${r.fullName} (${r.badgeNumber} - ${r.availabilityStatus})`;
        if (defaultResponderId && Number(r.id) === Number(defaultResponderId)) {
          opt.selected = true;
        }
        respSelect.appendChild(opt);
      });
    } catch (err) {
      if (errEl) {
        errEl.textContent = 'Unable to populate dispatch choices.';
        errEl.classList.remove('hidden');
      }
    }
  }

  function closeAssignResponderModal() {
    const modal = document.getElementById('admin-assign-responder-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function submitAssignResponder(e) {
    e.preventDefault();
    const errEl = document.getElementById('assign-responder-error');
    if (errEl) errEl.classList.add('hidden');

    const targetVal = document.getElementById('assign-target-select').value;
    const respVal = document.getElementById('assign-responder-select').value;
    const instructions = document.getElementById('assign-instructions-input').value.trim();

    if (!targetVal || !respVal) {
      if (errEl) {
        errEl.textContent = 'Please select both an active operation and an authorized responder.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    const [type, targetId] = targetVal.split(':');

    try {
      const result = await apiRequest('/responders/assign', {
        method: 'POST',
        body: JSON.stringify({
          type,
          targetId: Number(targetId),
          responderUserId: Number(respVal),
          dispatchInstructions: instructions
        })
      });

      showBannerMessage(result.message || 'Responder assigned successfully.');
      closeAssignResponderModal();
      loadRespondersList();
      loadReportsList();
      loadDashboardOverview();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    }
  }

  // ============================================================================
  // SECTION 4: USER MANAGEMENT
  // ============================================================================
  function switchUsersRoleTab(role) {
    state.users.filters.role = role === 'responder' ? 'responder' : 'resident';
    state.users.pagination.page = 1;

    const btnRes = document.getElementById('users-tab-residents');
    const btnResp = document.getElementById('users-tab-responders');

    if (btnRes && btnResp) {
      if (state.users.filters.role === 'resident') {
        btnRes.className = 'user-role-tab-btn px-4 py-1.5 rounded-lg bg-[#202020] text-[#FFF9E8] font-bold';
        btnResp.className = 'user-role-tab-btn px-4 py-1.5 rounded-lg text-[#555555] hover:text-[#202020] font-bold';
      } else {
        btnRes.className = 'user-role-tab-btn px-4 py-1.5 rounded-lg text-[#555555] hover:text-[#202020] font-bold';
        btnResp.className = 'user-role-tab-btn px-4 py-1.5 rounded-lg bg-[#202020] text-[#FFF9E8] font-bold';
      }
    }

    loadUsersList();
  }

  let isUsersLoading = false;

  async function loadUsersList() {
    if (isUsersLoading) return;
    isUsersLoading = true;

    const tbody = document.getElementById('admin-users-tbody');
    const loadingEl = document.getElementById('admin-users-loading');
    const emptyEl = document.getElementById('admin-users-empty');
    const refreshBtn = document.getElementById('users-refresh-btn');
    if (!tbody) {
      isUsersLoading = false;
      return;
    }

    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.classList.add('opacity-60', 'cursor-not-allowed');
    }

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    try {
      const params = new URLSearchParams({
        role: state.users.filters.role,
        status: state.users.filters.status,
        search: state.users.filters.search,
        page: state.users.pagination.page,
        limit: state.users.pagination.limit
      });

      const data = await apiRequest(`/users?${params.toString()}`);
      state.users.items = data.users || [];
      state.users.pagination = data.pagination || state.users.pagination;

      renderAdminUsersTable(state.users.items);

      const info = document.getElementById('users-pagination-info');
      if (info) {
        info.textContent = `Page ${state.users.pagination.page} of ${state.users.pagination.totalPages} (${state.users.pagination.total} users)`;
      }
    } catch (err) {
      console.error('[Admin] loadUsersList failed:', err.message);
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        const emptyText = document.getElementById('admin-users-empty-text');
        if (emptyText) emptyText.textContent = 'Failed to load user accounts. Please click Refresh.';
      }
    } finally {
      isUsersLoading = false;
      if (loadingEl) loadingEl.classList.add('hidden');
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    }
  }

  function renderAdminUsersTable(users) {
    const tbody = document.getElementById('admin-users-tbody');
    const emptyEl = document.getElementById('admin-users-empty');
    if (!tbody) return;

    // Atomically replace the existing table contents - NEVER append
    tbody.innerHTML = '';

    // Deduplicate by user ID on frontend as an additional safety guarantee
    const seen = new Set();
    const uniqueUsers = [];
    (users || []).forEach((u) => {
      if (!seen.has(u.id)) {
        seen.add(u.id);
        uniqueUsers.push(u);
      }
    });

    if (emptyEl) {
      emptyEl.classList.toggle('hidden', uniqueUsers.length > 0);
      const emptyText = document.getElementById('admin-users-empty-text');
      if (emptyText) emptyText.textContent = 'No users found.';
    }

    uniqueUsers.forEach((u) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-[#FFF9E8]/40 transition-colors';
      const userRole = u.role || u.roleName || 'Resident';
      const roleUnit = u.badgeNumber ? `${userRole} (${u.badgeNumber})` : userRole;
      const displayId = u.userId || u.userCode || `USR-${String(u.id).padStart(5, '0')}`;

      tr.innerHTML = `
        <td class="px-4 py-3 text-xs font-mono font-bold text-[#202020] whitespace-nowrap">
          <span class="bg-[#FFF9E8] px-2 py-0.5 rounded-md border border-[#FFE872] text-[11px] font-black">${escapeHtml(displayId)}</span>
        </td>
        <td class="px-4 py-3 text-xs font-bold text-[#202020] whitespace-nowrap">
          ${escapeHtml(u.name)}
        </td>
        <td class="px-4 py-3 text-xs text-[#555555]">
          <span class="block text-[#202020] font-medium">${escapeHtml(u.email)}</span>
          ${u.phone && u.phone !== 'Not provided' ? `<span class="text-[11px] text-[#777777]">${escapeHtml(u.phone)}</span>` : ''}
        </td>
        <td class="px-4 py-3 text-xs text-[#555555] whitespace-nowrap">
          ${escapeHtml(roleUnit)}
        </td>
        <td class="px-4 py-3 text-xs whitespace-nowrap">
          ${getAccountStatusBadgeHtml(u.status)}
        </td>
        <td class="px-4 py-3 text-xs text-[#777777] whitespace-nowrap">
          ${formatShortDate(u.registeredAt)}
        </td>
        <td class="px-4 py-3 text-xs text-right whitespace-nowrap">
          <button type="button" onclick="window.GeoSafeAdmin.openUserStatusModal(${u.id}, '${escapeHtml(u.name)}', '${escapeHtml(u.email)}', '${u.status}', '${escapeHtml(displayId)}')" class="px-3 py-1.5 rounded-xl border border-[#EEEEEE] hover:bg-[#FFF9E8] text-xs font-bold text-[#202020] transition-colors">
            Manage Status
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function openUserStatusModal(id, name, email, currentStatus, userCode) {
    state.users.selectedUser = { id, name, email, currentStatus, userCode };
    const modal = document.getElementById('admin-user-status-modal');
    if (!modal) return;

    const idEl = document.getElementById('user-modal-id');
    if (idEl) idEl.textContent = userCode || `USR-${String(id).padStart(5, '0')}`;
    document.getElementById('user-modal-name').textContent = name;
    document.getElementById('user-modal-email').textContent = email;
    document.getElementById('user-modal-current-status').innerHTML = getAccountStatusBadgeHtml(currentStatus);
    document.getElementById('user-modal-status-select').value = currentStatus;
    document.getElementById('user-modal-reason').value = '';
    document.getElementById('user-modal-error').classList.add('hidden');

    modal.classList.remove('hidden');
  }

  function closeUserStatusModal() {
    const modal = document.getElementById('admin-user-status-modal');
    if (modal) modal.classList.add('hidden');
    state.users.selectedUser = null;
  }

  async function submitUserStatusUpdate(e) {
    e.preventDefault();
    if (!state.users.selectedUser) return;
    const errEl = document.getElementById('user-modal-error');
    errEl.classList.add('hidden');

    const newStatus = document.getElementById('user-modal-status-select').value;
    const reason = document.getElementById('user-modal-reason').value.trim();

    if ((newStatus === 'suspended' || newStatus === 'deactivated') && !reason) {
      errEl.textContent = 'A reason is required when suspending or deactivating an account.';
      errEl.classList.remove('hidden');
      return;
    }

    try {
      const result = await apiRequest(`/users/${state.users.selectedUser.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus, reason })
      });

      showBannerMessage(result.message || 'User status updated successfully.');
      closeUserStatusModal();
      loadUsersList();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  }

  function openCreateResponderModal() {
    const modal = document.getElementById('admin-create-responder-modal');
    if (modal) {
      document.getElementById('create-responder-error').classList.add('hidden');
      document.getElementById('admin-create-responder-form').reset();
      modal.classList.remove('hidden');
    }
  }

  function closeCreateResponderModal() {
    const modal = document.getElementById('admin-create-responder-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function submitCreateResponder(e) {
    e.preventDefault();
    const errEl = document.getElementById('create-responder-error');
    errEl.classList.add('hidden');

    const payload = {
      first_name: document.getElementById('resp-first-name').value.trim(),
      last_name: document.getElementById('resp-surname').value.trim(),
      email: document.getElementById('resp-email').value.trim(),
      password: document.getElementById('resp-password').value,
      phone_number: document.getElementById('resp-phone').value.trim(),
      badge_number: document.getElementById('resp-badge').value.trim(),
      callsign: document.getElementById('resp-callsign').value.trim(),
      assigned_unit: document.getElementById('resp-unit').value.trim(),
      department: document.getElementById('resp-department').value.trim(),
      specialization: document.getElementById('resp-specialization').value.trim()
    };

    try {
      const result = await apiRequest('/users/responders', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      showBannerMessage(result.message || 'Responder account provisioned.');
      closeCreateResponderModal();
      switchUsersRoleTab('responder');
      loadRespondersList();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  }

  function openCreateResidentModal() {
    const modal = document.getElementById('admin-create-resident-modal');
    if (modal) {
      document.getElementById('create-resident-error').classList.add('hidden');
      document.getElementById('admin-create-resident-form').reset();
      modal.classList.remove('hidden');
    }
  }

  function closeCreateResidentModal() {
    const modal = document.getElementById('admin-create-resident-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function submitCreateResident(e) {
    e.preventDefault();
    const errEl = document.getElementById('create-resident-error');
    errEl.classList.add('hidden');

    const payload = {
      first_name: document.getElementById('resident-first-name').value.trim(),
      last_name: document.getElementById('resident-last-name').value.trim(),
      email: document.getElementById('resident-email').value.trim(),
      password: document.getElementById('resident-password').value,
      phone_number: document.getElementById('resident-phone').value.trim(),
      address: document.getElementById('resident-address').value.trim()
    };

    try {
      const result = await apiRequest('/users/residents', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      showBannerMessage(result.message || 'Resident registered successfully.');
      closeCreateResidentModal();
      switchUsersRoleTab('resident');
      loadDashboardOverview();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  }

  // ============================================================================
  // SECTION 5: ALERTS & NOTIFICATIONS
  // ============================================================================
  function handleBroadcastSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById('broadcast-form-error');
    if (errEl) errEl.classList.add('hidden');

    const title = document.getElementById('broadcast-title-input').value.trim();
    const severity = document.getElementById('broadcast-severity-select').value;
    const scope = document.getElementById('broadcast-scope-select').value;
    const zones = document.getElementById('broadcast-zones-input').value.trim();
    const message = document.getElementById('broadcast-message-input').value.trim();

    if (!title || !message) {
      if (errEl) {
        errEl.textContent = 'Please provide both an alert title and message content.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    state.broadcasts.pendingBroadcast = { title, severity, scope, zones, message };

    document.getElementById('confirm-broadcast-title').textContent = title;
    document.getElementById('confirm-broadcast-severity').textContent = severity;
    document.getElementById('confirm-broadcast-scope').textContent = scope;
    document.getElementById('confirm-broadcast-message').textContent = message;

    const modal = document.getElementById('admin-broadcast-confirm-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function closeBroadcastConfirmModal() {
    const modal = document.getElementById('admin-broadcast-confirm-modal');
    if (modal) modal.classList.add('hidden');
    state.broadcasts.pendingBroadcast = null;
  }

  async function executeBroadcastTransmission() {
    if (!state.broadcasts.pendingBroadcast) return;
    const pending = state.broadcasts.pendingBroadcast;

    try {
      const result = await apiRequest('/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          title: pending.title,
          severity: pending.severity,
          target_scope: pending.scope,
          target_zones: pending.zones,
          message: pending.message
        })
      });

      showBannerMessage(result.message || 'Emergency alert transmitted successfully.');
      closeBroadcastConfirmModal();
      document.getElementById('emergency-broadcast-form').reset();
      loadBroadcastsList();
      loadDashboardOverview();
    } catch (err) {
      closeBroadcastConfirmModal();
      const errEl = document.getElementById('broadcast-form-error');
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    }
  }

  async function loadBroadcastsList() {
    const tbody = document.getElementById('admin-broadcasts-tbody');
    const loadingEl = document.getElementById('admin-broadcasts-loading');
    const emptyEl = document.getElementById('admin-broadcasts-empty');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    try {
      const data = await apiRequest('/broadcasts');
      state.broadcasts.items = data.broadcasts || [];

      if (emptyEl) {
        emptyEl.classList.toggle('hidden', state.broadcasts.items.length > 0);
        emptyEl.innerHTML = '<p class="text-xs font-semibold text-[#777777]">No broadcast notifications recorded.</p>';
      }

      state.broadcasts.items.forEach((b) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-[#FFF9E8]/40 transition-colors';
        tr.innerHTML = `
          <td class="px-4 py-3 font-mono text-xs font-bold text-[#202020]">${escapeHtml(b.referenceNumber)}</td>
          <td class="px-4 py-3 text-xs">
            <span class="font-bold text-[#202020] block">${escapeHtml(b.title)}</span>
            <span class="text-[11px] text-[#555555] line-clamp-1">${escapeHtml(b.message)}</span>
          </td>
          <td class="px-4 py-3 text-xs">${getSeverityBadgeHtml(b.severity)}</td>
          <td class="px-4 py-3 text-xs text-[#555555]">${escapeHtml(b.targetScope)}</td>
          <td class="px-4 py-3 text-xs font-bold text-[#202020]">${b.recipientsCount} users</td>
          <td class="px-4 py-3 text-xs text-[#555555]">${escapeHtml(b.authorizedBy)}</td>
          <td class="px-4 py-3 text-xs text-[#777777] whitespace-nowrap">${formatDateTime(b.broadcastedAt)}</td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error('[Admin] loadBroadcastsList failed:', err.message);
      if (emptyEl) emptyEl.classList.remove('hidden');
    } finally {
      if (loadingEl) loadingEl.classList.add('hidden');
    }
  }

  // ============================================================================
  // SECTION 6: REPORTS & ANALYTICS
  // ============================================================================
  async function loadAnalyticsData() {
    const periodSelect = document.getElementById('analytics-period-select');
    const period = periodSelect ? periodSelect.value : 'all';
    const dateFrom = document.getElementById('analytics-date-from')?.value || '';
    const dateTo = document.getElementById('analytics-date-to')?.value || '';

    try {
      const params = new URLSearchParams({ period, from: dateFrom, to: dateTo });
      const data = await apiRequest(`/analytics?${params.toString()}`);
      state.analytics.data = data;

      const sum = data.summary || {};
      document.getElementById('analytics-total-reports').textContent = Number(sum.totalReports || 0).toLocaleString();
      document.getElementById('analytics-total-rescues').textContent = Number(sum.totalRescues || 0).toLocaleString();
      document.getElementById('analytics-total-events').textContent = Number(sum.totalEvents || 0).toLocaleString();
      document.getElementById('analytics-active-assignments').textContent = Number(sum.activeAssignments || 0).toLocaleString();

      // Categories
      const catList = document.getElementById('analytics-categories-list');
      const catEmpty = document.getElementById('analytics-categories-empty');
      if (catList) {
        catList.innerHTML = '';
        const cats = data.categories || [];
        if (catEmpty) catEmpty.classList.toggle('hidden', cats.length > 0);
        cats.forEach((c) => {
          const item = document.createElement('div');
          item.className = 'flex items-center justify-between p-2 rounded-xl border border-[#EEEEEE]';
          item.innerHTML = `<span class="font-bold text-[#202020]">${escapeHtml(c.name)}</span><span class="font-black text-[#8A6800]">${c.count}</span>`;
          catList.appendChild(item);
        });
      }

      // Severities
      const sevList = document.getElementById('analytics-severities-list');
      const sevEmpty = document.getElementById('analytics-severities-empty');
      if (sevList) {
        sevList.innerHTML = '';
        const sevs = data.severities || [];
        if (sevEmpty) sevEmpty.classList.toggle('hidden', sevs.length > 0);
        sevs.forEach((s) => {
          const item = document.createElement('div');
          item.className = 'flex items-center justify-between p-2 rounded-xl border border-[#EEEEEE]';
          item.innerHTML = `<span>${getSeverityBadgeHtml(s.severity)}</span><span class="font-black text-[#202020]">${s.count}</span>`;
          sevList.appendChild(item);
        });
      }

      // Statuses
      const statList = document.getElementById('analytics-statuses-list');
      const statEmpty = document.getElementById('analytics-statuses-empty');
      if (statList) {
        statList.innerHTML = '';
        const stats = data.statuses || [];
        if (statEmpty) statEmpty.classList.toggle('hidden', stats.length > 0);
        stats.forEach((st) => {
          const item = document.createElement('div');
          item.className = 'flex items-center justify-between p-2 rounded-xl border border-[#EEEEEE]';
          item.innerHTML = `<span class="font-bold text-[#202020]">${escapeHtml(st.status)}</span><span class="font-black text-[#202020]">${st.count}</span>`;
          statList.appendChild(item);
        });
      }

      // Locations
      const locList = document.getElementById('analytics-locations-list');
      const locEmpty = document.getElementById('analytics-locations-empty');
      if (locList) {
        locList.innerHTML = '';
        const locs = data.locations || [];
        if (locEmpty) locEmpty.classList.toggle('hidden', locs.length > 0);
        locs.forEach((l) => {
          const item = document.createElement('div');
          item.className = 'flex items-center justify-between p-2 rounded-xl border border-[#EEEEEE]';
          item.innerHTML = `<span class="font-bold text-[#202020]">${escapeHtml(l.location_name)}</span><span class="font-black text-[#202020]">${l.count}</span>`;
          locList.appendChild(item);
        });
      }
    } catch (err) {
      console.error('[Admin] loadAnalyticsData failed:', err.message);
    }
  }

  function downloadAnalyticsCsv() {
    const periodSelect = document.getElementById('analytics-period-select');
    const period = periodSelect ? periodSelect.value : 'all';
    const dateFrom = document.getElementById('analytics-date-from')?.value || '';
    const dateTo = document.getElementById('analytics-date-to')?.value || '';

    const params = new URLSearchParams({ period, from: dateFrom, to: dateTo });
    window.location.href = `/api/admin/analytics/export?${params.toString()}`;
  }

  // ============================================================================
  // SECTION 7: SYSTEM SETTINGS & MAINTENANCE
  // ============================================================================
  async function loadSystemSettings() {
    const listEl = document.getElementById('system-settings-list');
    const loadEl = document.getElementById('system-settings-loading');
    if (!listEl) return;

    listEl.innerHTML = '';
    if (loadEl) loadEl.classList.remove('hidden');

    try {
      const data = await apiRequest('/settings');
      state.settings = data;

      if (data.health) {
        const h = data.health;
        document.getElementById('health-db-status').textContent = h.databaseStatus;
        document.getElementById('health-db-latency').textContent = `${h.databaseLatencyMs} ms`;
        document.getElementById('health-server-uptime').textContent = `${Math.floor(h.serverUptimeSeconds / 60)} minutes`;
        document.getElementById('health-environment').textContent = h.environment;
        document.getElementById('health-node-version').textContent = h.nodeVersion;
      }

      if (data.securityStats) {
        document.getElementById('security-stat-failed').textContent = data.securityStats.failedLogins24h;
        document.getElementById('security-stat-success').textContent = data.securityStats.successLogins24h;
      }

      // Editable settings from system_settings
      (data.settings || []).forEach((st) => {
        const box = document.createElement('div');
        box.className = 'p-3.5 rounded-2xl border border-[#EEEEEE] space-y-2';
        box.innerHTML = `
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-[#202020]">${escapeHtml(st.setting_key)}</span>
            <span class="text-[10px] uppercase font-bold text-[#777777]">${escapeHtml(st.category)}</span>
          </div>
          <p class="text-[11px] text-[#777777]">${escapeHtml(st.description || 'System setting')}</p>
          <div class="flex items-center gap-2">
            <input id="setting-input-${st.id}" type="text" value="${escapeHtml(st.setting_value || '')}" class="flex-1 px-3 py-1.5 rounded-xl border border-[#EEEEEE] text-xs text-[#202020] focus:outline-none focus:border-[#F5B900]">
            <button type="button" onclick="window.GeoSafeAdmin.saveSetting('${st.setting_key}', document.getElementById('setting-input-${st.id}').value)" class="px-3 py-1.5 rounded-xl bg-[#202020] hover:bg-[#333333] text-[#FFF9E8] text-xs font-bold transition-colors">
              Save
            </button>
          </div>
        `;
        listEl.appendChild(box);
      });

      // Recent Security Events
      const secTbody = document.getElementById('security-events-tbody');
      const secEmpty = document.getElementById('security-events-empty');
      if (secTbody) {
        secTbody.innerHTML = '';
        const events = data.recentSecurityEvents || [];
        if (secEmpty) secEmpty.classList.toggle('hidden', events.length > 0);
        events.forEach((ev) => {
          const tr = document.createElement('tr');
          tr.className = 'hover:bg-[#FFF9E8]/40';
          tr.innerHTML = `
            <td class="px-3 py-2 font-bold text-[#202020]">${escapeHtml(ev.event_type)}</td>
            <td class="px-3 py-2 text-[#555555]">${escapeHtml(ev.attempted_email || '-')}</td>
            <td class="px-3 py-2 font-mono text-[#555555]">${escapeHtml(ev.ip_address || '-')}</td>
            <td class="px-3 py-2 text-[#777777]">${escapeHtml(ev.details || '-')}</td>
            <td class="px-3 py-2 text-[#777777] whitespace-nowrap">${formatDateTime(ev.created_at)}</td>
          `;
          secTbody.appendChild(tr);
        });
      }
    } catch (err) {
      console.error('[Admin] loadSystemSettings failed:', err.message);
    } finally {
      if (loadEl) loadEl.classList.add('hidden');
    }
  }

  async function saveSetting(key, val) {
    const feedback = document.getElementById('settings-save-feedback');
    if (feedback) feedback.classList.add('hidden');

    try {
      const res = await apiRequest('/settings', {
        method: 'POST',
        body: JSON.stringify({ setting_key: key, setting_value: val })
      });
      showBannerMessage(res.message || 'Setting updated.');
      if (feedback) {
        feedback.className = 'p-2.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 block';
        feedback.textContent = res.message || 'Saved successfully.';
      }
    } catch (err) {
      if (feedback) {
        feedback.className = 'p-2.5 rounded-xl text-xs font-semibold bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2] block';
        feedback.textContent = err.message;
      }
    }
  }

  // ============================================================================
  // SECTION 8: AUDIT LOGS
  // ============================================================================
  async function loadAuditLogs() {
    const tbody = document.getElementById('admin-audit-tbody');
    const loadingEl = document.getElementById('admin-audit-loading');
    const emptyEl = document.getElementById('admin-audit-empty');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    try {
      const params = new URLSearchParams({
        page: state.audit.pagination.page,
        limit: state.audit.pagination.limit,
        from: state.audit.filters.dateFrom,
        to: state.audit.filters.dateTo,
        user: state.audit.filters.user,
        role: state.audit.filters.role,
        activity: state.audit.filters.activity,
        result: state.audit.filters.result,
        search: state.audit.filters.search
      });

      const data = await apiRequest(`/audit-logs?${params.toString()}`);
      state.audit.items = data.logs || [];
      state.audit.pagination = data.pagination || state.audit.pagination;

      if (emptyEl) {
        emptyEl.classList.toggle('hidden', state.audit.items.length > 0);
        const emptyText = document.getElementById('admin-audit-empty-text');
        if (emptyText) emptyText.textContent = 'No audit activities available.';
      }

      state.audit.items.forEach((log) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-[#FFF9E8]/40 transition-colors';
        const isSuccess = String(log.result || '').toUpperCase() === 'SUCCESS';
        const resultBadge = isSuccess
          ? '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-[#278653] border border-emerald-200">Success</span>'
          : '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2]">Failure</span>';

        tr.innerHTML = `
          <td class="px-4 py-2.5 text-xs text-[#777777] whitespace-nowrap">${formatDateTime(log.timestamp)}</td>
          <td class="px-4 py-2.5 text-xs font-semibold text-[#202020]">
            ${escapeHtml(log.userName)}
            <span class="block text-[10px] text-[#777777]">${escapeHtml(log.userEmail)}</span>
          </td>
          <td class="px-4 py-2.5 text-xs text-[#555555]">${escapeHtml(log.role)}</td>
          <td class="px-4 py-2.5 text-xs font-bold text-[#202020]">${escapeHtml(log.activity)}</td>
          <td class="px-4 py-2.5 text-xs font-mono text-[#555555]">${escapeHtml(log.module)}</td>
          <td class="px-4 py-2.5 text-xs">${resultBadge}</td>
          <td class="px-4 py-2.5 text-xs font-mono text-[#777777]">${escapeHtml(log.ipAddress || '-')}</td>
        `;
        tbody.appendChild(tr);
      });

      const info = document.getElementById('audit-pagination-info');
      if (info) {
        info.textContent = `Page ${state.audit.pagination.page} of ${state.audit.pagination.totalPages} (${state.audit.pagination.total} records)`;
      }
    } catch (err) {
      console.error('[Admin] loadAuditLogs failed:', err.message);
      if (emptyEl) emptyEl.classList.remove('hidden');
    } finally {
      if (loadingEl) loadingEl.classList.add('hidden');
    }
  }

  // ============================================================================
  // EVENT BINDINGS & INITIALIZATION
  // ============================================================================
  function bindEvents() {
    // Navigation Clicks
    document.querySelectorAll('[data-admin-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchAdminSection(btn.getAttribute('data-admin-nav'));
      });
    });

    // Map Filters
    const mapTypeSelect = document.getElementById('map-filter-type');
    const mapSevSelect = document.getElementById('map-filter-severity');
    const mapStatusSelect = document.getElementById('map-filter-status');

    if (mapTypeSelect) {
      mapTypeSelect.addEventListener('change', (e) => {
        state.mapFilters.type = e.target.value;
        renderMapMarkers();
      });
    }
    if (mapSevSelect) {
      mapSevSelect.addEventListener('change', (e) => {
        state.mapFilters.severity = e.target.value;
        renderMapMarkers();
      });
    }
    if (mapStatusSelect) {
      mapStatusSelect.addEventListener('change', (e) => {
        state.mapFilters.status = e.target.value;
        renderMapMarkers();
      });
    }

    // Reports Status Filter Pills
    document.querySelectorAll('.report-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.report-filter-btn').forEach((b) => {
          b.className = 'report-filter-btn px-3 py-1 rounded-lg text-[#555555] hover:text-[#202020]';
        });
        btn.className = 'report-filter-btn px-3 py-1 rounded-lg bg-[#202020] text-[#FFF9E8] font-bold';

        state.reports.filters.status = btn.getAttribute('data-report-filter') || 'all';
        loadReportsList();
      });
    });

    const reportTypeSelect = document.getElementById('reports-type-select');
    const reportSearchInput = document.getElementById('reports-search-input');
    if (reportTypeSelect) {
      reportTypeSelect.addEventListener('change', (e) => {
        state.reports.filters.type = e.target.value;
        loadReportsList();
      });
    }
    if (reportSearchInput) {
      let searchTimer = null;
      reportSearchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.reports.filters.search = e.target.value.trim();
          state.reports.pagination.page = 1;
          loadReportsList();
        }, 300);
      });
    }

    const reportsPrevBtn = document.getElementById('reports-prev-btn');
    const reportsNextBtn = document.getElementById('reports-next-btn');
    if (reportsPrevBtn) {
      reportsPrevBtn.addEventListener('click', () => navigateReportsPage(-1));
    }
    if (reportsNextBtn) {
      reportsNextBtn.addEventListener('click', () => navigateReportsPage(1));
    }

    const mapActionBtn = document.getElementById('map-panel-action-btn');
    if (mapActionBtn) {
      mapActionBtn.addEventListener('click', handleMapPanelReview);
    }

    // Users Search & Tab Filters
    const usersTabResidents = document.getElementById('users-tab-residents');
    const usersTabResponders = document.getElementById('users-tab-responders');
    if (usersTabResidents) {
      usersTabResidents.addEventListener('click', () => switchUsersRoleTab('resident'));
    }
    if (usersTabResponders) {
      usersTabResponders.addEventListener('click', () => switchUsersRoleTab('responder'));
    }

    const usersRefreshBtn = document.getElementById('users-refresh-btn');
    if (usersRefreshBtn) {
      usersRefreshBtn.addEventListener('click', () => loadUsersList());
    }

    const usersStatusSelect = document.getElementById('users-status-select');
    if (usersStatusSelect) {
      usersStatusSelect.addEventListener('change', (e) => {
        state.users.filters.status = e.target.value;
        state.users.pagination.page = 1;
        loadUsersList();
      });
    }

    const userSearchInput = document.getElementById('users-search-input');
    if (userSearchInput) {
      let uTimer = null;
      userSearchInput.addEventListener('input', (e) => {
        clearTimeout(uTimer);
        uTimer = setTimeout(() => {
          state.users.filters.search = e.target.value.trim();
          state.users.pagination.page = 1;
          loadUsersList();
        }, 300);
      });
    }

    const usersPrevBtn = document.getElementById('users-prev-btn');
    const usersNextBtn = document.getElementById('users-next-btn');
    if (usersPrevBtn) {
      usersPrevBtn.addEventListener('click', () => {
        if (state.users.pagination.page > 1) {
          state.users.pagination.page -= 1;
          loadUsersList();
        }
      });
    }
    if (usersNextBtn) {
      usersNextBtn.addEventListener('click', () => {
        if (state.users.pagination.page < state.users.pagination.totalPages) {
          state.users.pagination.page += 1;
          loadUsersList();
        }
      });
    }

    // Analytics Custom Date Toggle
    const analyticsPeriodSelect = document.getElementById('analytics-period-select');
    if (analyticsPeriodSelect) {
      analyticsPeriodSelect.addEventListener('change', (e) => {
        const customContainer = document.getElementById('analytics-custom-date-container');
        if (customContainer) {
          customContainer.classList.toggle('hidden', e.target.value !== 'custom');
        }
      });
    }

    // Audit Logs Filter Controls
    const applyAuditBtn = document.getElementById('audit-apply-filters-btn');
    const resetAuditBtn = document.getElementById('audit-reset-filters-btn');
    if (applyAuditBtn) {
      applyAuditBtn.addEventListener('click', () => {
        state.audit.filters.dateFrom = document.getElementById('audit-filter-date-from').value;
        state.audit.filters.dateTo = document.getElementById('audit-filter-date-to').value;
        state.audit.filters.user = document.getElementById('audit-filter-user').value.trim();
        state.audit.filters.role = document.getElementById('audit-filter-role').value;
        state.audit.filters.activity = document.getElementById('audit-filter-activity').value.trim();
        state.audit.filters.result = document.getElementById('audit-filter-result').value;
        state.audit.filters.search = document.getElementById('audit-filter-search').value.trim();
        state.audit.pagination.page = 1;
        loadAuditLogs();
      });
    }
    if (resetAuditBtn) {
      resetAuditBtn.addEventListener('click', () => {
        document.getElementById('audit-filter-date-from').value = '';
        document.getElementById('audit-filter-date-to').value = '';
        document.getElementById('audit-filter-user').value = '';
        document.getElementById('audit-filter-role').value = 'all';
        document.getElementById('audit-filter-activity').value = '';
        document.getElementById('audit-filter-result').value = 'all';
        document.getElementById('audit-filter-search').value = '';
        state.audit.filters = {
          dateFrom: '',
          dateTo: '',
          user: '',
          role: 'all',
          activity: '',
          result: 'all',
          search: ''
        };
        state.audit.pagination.page = 1;
        loadAuditLogs();
      });
    }

    const auditPrevBtn = document.getElementById('audit-prev-btn');
    const auditNextBtn = document.getElementById('audit-next-btn');
    if (auditPrevBtn) {
      auditPrevBtn.addEventListener('click', () => {
        if (state.audit.pagination.page > 1) {
          state.audit.pagination.page -= 1;
          loadAuditLogs();
        }
      });
    }
    if (auditNextBtn) {
      auditNextBtn.addEventListener('click', () => {
        if (state.audit.pagination.page < state.audit.pagination.totalPages) {
          state.audit.pagination.page += 1;
          loadAuditLogs();
        }
      });
    }
  }

  async function initAdminPortal() {
    const loadingEl = document.getElementById('admin-loading');
    const unauthEl = document.getElementById('admin-unauthorized');
    const shellEl = document.getElementById('admin-shell');
    const headerName = document.getElementById('admin-header-name');

    if (shellEl) shellEl.classList.add('hidden');

    if (!window.geoSafeStore) {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (unauthEl) unauthEl.classList.remove('hidden');
      return;
    }

    try {
      const check = await window.geoSafeStore.verifySession('Administrator');
      if (loadingEl) loadingEl.classList.add('hidden');

      if (!check || !check.authenticated) {
        window.location.replace('/login.html');
        return;
      }

      const isAuthorizedAdmin = !!(
        check.authorized &&
        check.user &&
        (typeof window.geoSafeStore.isAuthorizedAdmin === 'function'
          ? window.geoSafeStore.isAuthorizedAdmin()
          : window.geoSafeStore.normalizeRoleName(check.user.role) === 'Administrator')
      );

      if (!isAuthorizedAdmin) {
        if (unauthEl) unauthEl.classList.remove('hidden');
        return;
      }

      state.adminUser = check.user;
      if (headerName && check.user) {
        headerName.textContent = check.user.name || check.user.email || 'Administrator';
      }
      const sidebarName = document.getElementById('admin-sidebar-name');
      if (sidebarName && check.user) {
        sidebarName.textContent = check.user.name || check.user.email || 'Administrator';
      }

      if (shellEl) shellEl.classList.remove('hidden');

      bindEvents();
      startLiveClock();
      switchAdminSection('dashboard');
    } catch (err) {
      console.error('[Admin] Session authorization verification failed:', err);
      if (loadingEl) loadingEl.classList.add('hidden');
      if (unauthEl) unauthEl.classList.remove('hidden');
    }
  }

  window.handleAdminLogout = async function () {
    if (window.geoSafeStore) {
      await window.geoSafeStore.logout();
    }
    window.location.replace('/login.html');
  };

  window.GeoSafeAdmin = {
    openMobileDrawer,
    closeMobileDrawer,
    toggleMobileDrawer,
    toggleDesktopSidebar,
    switchAdminSection,
    loadDashboardOverview,
    closeMapMarkerPanel,
    handleMapPanelReview,
    loadReportsList,
    navigateReportsPage,
    openReportDetailModal,
    closeReportDetailModal,
    openAttachmentPreviewModal,
    closeAttachmentPreviewModal,
    submitReportReviewAction,
    loadRespondersList,
    openAssignResponderModal,
    closeAssignResponderModal,
    submitAssignResponder,
    switchUsersRoleTab,
    loadUsersList,
    openUserStatusModal,
    closeUserStatusModal,
    submitUserStatusUpdate,
    openCreateResponderModal,
    closeCreateResponderModal,
    submitCreateResponder,
    openCreateResidentModal,
    closeCreateResidentModal,
    submitCreateResident,
    handleBroadcastSubmit,
    closeBroadcastConfirmModal,
    executeBroadcastTransmission,
    loadBroadcastsList,
    loadAnalyticsData,
    downloadAnalyticsCsv,
    loadSystemSettings,
    saveSetting,
    loadAuditLogs
  };

  document.addEventListener('DOMContentLoaded', initAdminPortal);
})(window);
