/**
 * GeoSafe Administrator Portal Controller
 * ============================================================================
 * Connects the GeoSafe Administrator UI to live Node.js/Express + PostgreSQL endpoints:
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
        locationStatus: 'all',
        search: ''
      },
      loading: false,
      selectedUser: null,
      locationReviewUser: null
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
    // Route admin notifications through the shared floating toast system when available.
    if (window.GeoSafeToast && typeof window.GeoSafeToast.show === 'function') {
      const toastType = ['success', 'error', 'info', 'warning'].includes(type) ? type : 'info';
      return window.GeoSafeToast.show({ message, type: toastType });
    }
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

  function handleSidebarToggle() {
    if (window.innerWidth < 1024) {
      toggleMobileDrawer();
    } else {
      toggleDesktopSidebar();
    }
  }

  function toggleDesktopSidebar(forceState) {
    const sidebar = document.getElementById('admin-sidebar');
    const wrapper = document.getElementById('admin-layout-wrapper');
    const toggleBtn = document.getElementById('topbar-sidebar-toggle-btn');
    if (!sidebar || !wrapper) return;

    if (typeof forceState === 'boolean') {
      isDesktopSidebarCollapsed = forceState;
    } else {
      isDesktopSidebarCollapsed = !isDesktopSidebarCollapsed;
    }

    if (isDesktopSidebarCollapsed) {
      sidebar.classList.add('sidebar-collapsed');
      wrapper.classList.add('sidebar-collapsed');
      sidebar.classList.remove('w-64');
      sidebar.classList.add('w-20');
      wrapper.classList.remove('lg:pl-64');
      wrapper.classList.add('lg:pl-20');
      document.querySelectorAll('.sidebar-label-wrap').forEach((el) => el.classList.add('lg:hidden'));
      if (toggleBtn) {
        toggleBtn.setAttribute('title', 'Expand sidebar');
        toggleBtn.setAttribute('aria-label', 'Expand sidebar');
      }
    } else {
      sidebar.classList.remove('sidebar-collapsed');
      wrapper.classList.remove('sidebar-collapsed');
      sidebar.classList.remove('w-20');
      sidebar.classList.add('w-64');
      wrapper.classList.remove('lg:pl-20');
      wrapper.classList.add('lg:pl-64');
      document.querySelectorAll('.sidebar-label-wrap').forEach((el) => el.classList.remove('lg:hidden'));
      if (toggleBtn) {
        toggleBtn.setAttribute('title', 'Collapse sidebar');
        toggleBtn.setAttribute('aria-label', 'Collapse sidebar');
      }
    }

    try {
      localStorage.setItem('geosafe_admin_sidebar_collapsed', isDesktopSidebarCollapsed ? 'true' : 'false');
    } catch (_) {}

    if (state.mapInstance) {
      setTimeout(() => state.mapInstance.invalidateSize(), 260);
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
      loadBroadcastCategories();
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
    if (state.mapMarkersByUid) state.mapMarkersByUid.clear();

    const items = state.overview.mapItems || [];
    const filterType = state.mapFilters.type;
    const filterStatus = state.mapFilters.status;

    const visibleItems = items.filter((item) => {
      if (filterType !== 'all' && item.recordType !== filterType) return false;
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
      const lat = Number(item.latitude);
      const lng = Number(item.longitude);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180 ||
        (lat === 0 && lng === 0)
      ) {
        return;
      }

      const isRescue = item.recordType === 'rescue';
      const markerType = isRescue ? 'rescue' : 'incident';
      const isSelected = Boolean(state.selectedMapItem && state.selectedMapItem.uid === item.uid);

      const hasSharedIcons = window.GeoSafeMapping && typeof window.GeoSafeMapping.createCustomIcon === 'function';
      const marker = hasSharedIcons
        ? L.marker([lat, lng], {
          icon: window.GeoSafeMapping.createCustomIcon(markerType, { selected: isSelected }),
          zIndexOffset: isRescue ? 350 : 250
        })
        : L.circleMarker([lat, lng], {
          radius: 7,
          color: isRescue ? '#D93636' : '#D97706',
          weight: 2,
          fillColor: isRescue ? '#FEE2E2' : '#FEF3C7',
          fillOpacity: 0.9
        });

      marker.bindTooltip(`${escapeHtml(item.referenceNumber || '')} (${lat.toFixed(6)}, ${lng.toFixed(6)})`, {
        direction: 'top'
      });

      marker.on('click', () => {
        if (state.mapInstance) {
          state.mapInstance.panTo([lat, lng]);
        }
        showMapMarkerPanel(item);
        if (hasSharedIcons && state.mapMarkersByUid) {
          state.mapMarkersByUid.forEach((entry, uid) => {
            if (typeof entry.marker.setIcon === 'function') {
              entry.marker.setIcon(
                window.GeoSafeMapping.createCustomIcon(entry.markerType, { selected: uid === item.uid })
              );
            }
          });
        }
      });

      if (!state.mapMarkersByUid) {
        state.mapMarkersByUid = new Map();
      }
      state.mapMarkersByUid.set(item.uid, { marker, markerType });

      marker.addTo(state.mapLayerGroup);
      bounds.extend([lat, lng]);
    });

    // Render evacuation centers on map using the shared Resident UI evacuation icon
    const evacCenters = state.overview.evacuationCenters || [];
    const evacIcon =
      window.GeoSafeMapping && typeof window.GeoSafeMapping.createCustomIcon === 'function'
        ? window.GeoSafeMapping.createCustomIcon('evacuation')
        : null;
    evacCenters.forEach((evac) => {
      if (!Number.isFinite(evac.latitude) || !Number.isFinite(evac.longitude)) return;
      const evacMarker = evacIcon
        ? L.marker([evac.latitude, evac.longitude], { icon: evacIcon, zIndexOffset: 200 })
        : L.circleMarker([evac.latitude, evac.longitude], {
          radius: 8,
          color: '#278653',
          weight: 2,
          fillColor: '#D1FAE5',
          fillOpacity: 0.9
        });
      evacMarker.bindTooltip(`Evacuation Center: ${escapeHtml(evac.name)}`, {
        direction: 'top'
      });
      evacMarker.bindPopup(`
        <div class="p-1.5 text-xs font-sans">
          <div class="text-[10px] font-bold text-[#278653] uppercase tracking-wider mb-0.5">Evacuation Center</div>
          <div class="font-bold text-[#202020]">${escapeHtml(evac.name)}</div>
          <div class="text-[11px] text-[#6B7280]">${escapeHtml(evac.address || 'Barangay Bayanan, Muntinlupa City')}</div>
        </div>
      `);
      evacMarker.addTo(state.mapLayerGroup);
      bounds.extend([evac.latitude, evac.longitude]);
    });

    // Plot Official GeoSafe Emergency Operations Center (EOC) Marker
    const eoc = state.overview.eocLocation || (window.GeoSafeMapping && typeof window.GeoSafeMapping.getEocLocation === 'function' ? window.GeoSafeMapping.getEocLocation() : null);
    if (eoc && Number.isFinite(Number(eoc.latitude)) && Number.isFinite(Number(eoc.longitude))) {
      const eocLat = Number(eoc.latitude);
      const eocLng = Number(eoc.longitude);
      const eocIcon = window.GeoSafeMapping && typeof window.GeoSafeMapping.createCustomIcon === 'function'
        ? window.GeoSafeMapping.createCustomIcon('eoc', 'EOC')
        : null;
      const eocMarker = eocIcon
        ? L.marker([eocLat, eocLng], { icon: eocIcon, zIndexOffset: 300 })
        : L.circleMarker([eocLat, eocLng], { radius: 9, color: '#4338CA', weight: 2, fillColor: '#EEF2FF', fillOpacity: 0.95 });
      eocMarker.bindTooltip(`${escapeHtml(eoc.name || 'GeoSafe EOC')}`, { direction: 'top' });
      eocMarker.bindPopup(`
        <div class="p-1.5 text-xs font-sans">
          <div class="text-[10px] font-bold text-[#4338CA] uppercase tracking-wider mb-0.5">Official Command Center</div>
          <div class="font-bold text-[#202020]">${escapeHtml(eoc.name || 'GeoSafe Emergency Operations Center (EOC)')}</div>
          <div class="text-[11px] text-[#555555]">${escapeHtml(eoc.address || 'Bayanan Baywalk Ilaya, Muntinlupa, Metro Manila, Philippines')}</div>
          <div class="text-[10px] font-mono text-[#777777] mt-0.5">${eocLat.toFixed(5)}, ${eocLng.toFixed(5)}</div>
        </div>
      `);
      eocMarker.addTo(state.mapLayerGroup);
      bounds.extend([eocLat, eocLng]);
    }

    const bayananBounds = window.GeoSafeMapping && typeof window.GeoSafeMapping.getBayananBounds === 'function'
      ? window.GeoSafeMapping.getBayananBounds()
      : null;
    if (bayananBounds && bayananBounds.isValid()) {
      bounds.extend(bayananBounds);
    }

    if (bounds.isValid()) {
      state.mapInstance.fitBounds(bounds, { padding: [24, 24] });
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
    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    const sourceText = item.locationSource === 'gps' ? 'GPS' : item.locationSource === 'manual' ? 'Manual Pin' : '';
    const accText = Number.isFinite(Number(item.gpsAccuracy)) ? ` (+/-${Math.round(Number(item.gpsAccuracy))}m)` : '';
    const coordSuffix = hasCoords
      ? ` [${lat.toFixed(6)}, ${lng.toFixed(6)}${sourceText ? ` | ${sourceText}${accText}` : ''}]`
      : ' [Coordinates unavailable]';
    document.getElementById('map-panel-location').textContent = `${item.location || 'Location not specified'}${coordSuffix}`;
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

  let overviewFetchSeq = 0;

  async function loadDashboardOverview() {
    const reqSeq = ++overviewFetchSeq;
    const loadingOverlay = document.getElementById('admin-map-loading');
    const errorOverlay = document.getElementById('admin-map-error');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    if (errorOverlay) errorOverlay.classList.add('hidden');

    try {
      const data = await apiRequest('/overview');
      if (reqSeq !== overviewFetchSeq) return;
      state.overview = {
        summary: data.summary || {},
        mapItems: data.mapItems || [],
        evacuationCenters: data.evacuationCenters || [],
        eocLocation: data.eocLocation || null,
        recentActivities: data.recentActivities || []
      };
      if (data.eocLocation && window.GeoSafeMapping && typeof window.GeoSafeMapping.setEocLocation === 'function') {
        window.GeoSafeMapping.setEocLocation(data.eocLocation);
      }
      if (
        state.selectedMapItem &&
        !state.overview.mapItems.some((m) => m.uid === state.selectedMapItem.uid)
      ) {
        closeMapMarkerPanel();
      }

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

  function initOrUpdateModalMap(lat, lng, refText, locText, recordType = 'incident') {
    const mapEl = document.getElementById('modal-report-map');
    const fallbackEl = document.getElementById('modal-report-map-fallback');
    if (!mapEl || typeof L === 'undefined') return;

    const numLat = lat !== null && lat !== undefined ? Number(lat) : NaN;
    const numLng = lng !== null && lng !== undefined ? Number(lng) : NaN;
    if (
      !Number.isFinite(numLat) ||
      !Number.isFinite(numLng) ||
      numLat < -90 ||
      numLat > 90 ||
      numLng < -180 ||
      numLng > 180 ||
      (numLat === 0 && numLng === 0)
    ) {
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
        }).setView([numLat, numLng], 17);

        if (window.GeoSafeMapping && typeof window.GeoSafeMapping.addBaseTileLayer === 'function') {
          window.GeoSafeMapping.addBaseTileLayer(modalLeafletMap);
          if (typeof window.GeoSafeMapping.addBayananBoundary === 'function') {
            window.GeoSafeMapping.addBayananBoundary(modalLeafletMap, { fitBounds: false });
          }
        } else {
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors | GeoSafe'
          }).addTo(modalLeafletMap);
        }

        const markerType = recordType === 'rescue' ? 'rescue' : 'incident';
        const modalIcon =
          window.GeoSafeMapping && typeof window.GeoSafeMapping.createCustomIcon === 'function'
            ? window.GeoSafeMapping.createCustomIcon(markerType)
            : null;
        modalLeafletMarker = modalIcon
          ? L.marker([numLat, numLng], { icon: modalIcon }).addTo(modalLeafletMap)
          : L.marker([numLat, numLng]).addTo(modalLeafletMap);
      } else {
        modalLeafletMap.setView([numLat, numLng], 17);
        const markerType = recordType === 'rescue' ? 'rescue' : 'incident';
        const modalIcon =
          window.GeoSafeMapping && typeof window.GeoSafeMapping.createCustomIcon === 'function'
            ? window.GeoSafeMapping.createCustomIcon(markerType)
            : null;
        if (modalLeafletMarker) {
          modalLeafletMarker.setLatLng([numLat, numLng]);
          if (modalIcon && typeof modalLeafletMarker.setIcon === 'function') {
            modalLeafletMarker.setIcon(modalIcon);
          }
        } else {
          modalLeafletMarker = modalIcon
            ? L.marker([numLat, numLng], { icon: modalIcon }).addTo(modalLeafletMap)
            : L.marker([numLat, numLng]).addTo(modalLeafletMap);
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

  const attachmentPreviewState = {
    items: [],
    index: 0,
    zoom: 1,
    keyHandler: null,
  };

  function updateAttachmentZoomUI() {
    const zoomLabel = document.getElementById('attachment-preview-zoom-label');
    if (zoomLabel) {
      zoomLabel.textContent = `${Math.round(attachmentPreviewState.zoom * 100)}%`;
    }
    const img = document.getElementById('attachment-preview-image');
    if (img) {
      if (attachmentPreviewState.zoom > 1) {
        img.style.maxHeight = 'none';
        img.style.maxWidth = 'none';
        img.style.width = `${Math.round(attachmentPreviewState.zoom * 100)}%`;
        img.style.height = 'auto';
      } else {
        img.style.maxHeight = '68vh';
        img.style.maxWidth = '100%';
        img.style.width = 'auto';
        img.style.height = 'auto';
      }
    }
  }

  function renderAttachmentPreview() {
    const titleEl = document.getElementById('attachment-preview-title');
    const counterEl = document.getElementById('attachment-preview-counter');
    const downloadLink = document.getElementById('attachment-preview-download');
    const contentEl = document.getElementById('attachment-preview-content');
    const prevBtn = document.getElementById('attachment-preview-prev');
    const nextBtn = document.getElementById('attachment-preview-next');
    const zoomControls = document.getElementById('attachment-preview-zoom-controls');
    if (!contentEl) return;

    const items = attachmentPreviewState.items;
    if (!items.length) return;
    const current = items[attachmentPreviewState.index] || items[0];
    const fileUrl = current.fileUrl || '';
    const fileName = current.fileName || 'Photo Evidence';
    const fileType = current.fileType || 'image/jpeg';

    if (titleEl) titleEl.textContent = fileName;
    if (counterEl) {
      if (items.length > 1) {
        counterEl.textContent = `${attachmentPreviewState.index + 1} / ${items.length}`;
        counterEl.classList.remove('hidden');
      } else {
        counterEl.classList.add('hidden');
      }
    }
    if (prevBtn) prevBtn.classList.toggle('hidden', items.length <= 1);
    if (nextBtn) nextBtn.classList.toggle('hidden', items.length <= 1);

    if (downloadLink) {
      downloadLink.href = fileUrl || '#';
      downloadLink.classList.toggle('pointer-events-none', !fileUrl);
      downloadLink.classList.toggle('opacity-50', !fileUrl);
    }

    const isVideo = (fileType && fileType.includes('video')) || /\.(mp4|webm|mov|ogg)$/i.test(fileUrl);
    if (zoomControls) zoomControls.classList.toggle('hidden', isVideo);

    if (!fileUrl) {
      contentEl.innerHTML = '<div class="p-8 text-center text-xs text-[#777777]">Photo evidence is unavailable.</div>';
      return;
    }

    if (isVideo) {
      contentEl.innerHTML = `<video controls autoplay class="max-h-[68vh] w-full rounded-xl bg-black">
        <source src="${escapeHtml(fileUrl)}">
        Your browser does not support the video tag.
      </video>`;
    } else {
      contentEl.innerHTML = `<img id="attachment-preview-image" src="${escapeHtml(fileUrl)}" alt="${escapeHtml(fileName)}" class="object-contain rounded-xl transition-all duration-150" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'p-8 text-center text-xs text-[#777777]\\'>Photo evidence is unavailable or could not be loaded.</div>';">`;
      updateAttachmentZoomUI();
    }
  }

  function openAttachmentPreviewModal(indexOrUrl, attachmentsOrName, legacyFileType) {
    const modal = document.getElementById('admin-attachment-preview-modal');
    if (!modal) return;

    if (Array.isArray(attachmentsOrName)) {
      attachmentPreviewState.items = attachmentsOrName.map((att, idx) => ({
        fileUrl: att.fileUrl || att.file_url || '',
        fileName: att.fileName || att.file_name || `Photo Evidence ${idx + 1}`,
        fileType: att.fileType || att.file_type || 'image/jpeg',
      }));
      const idx = Number(indexOrUrl);
      attachmentPreviewState.index = Number.isInteger(idx) && idx >= 0 && idx < attachmentPreviewState.items.length ? idx : 0;
    } else {
      attachmentPreviewState.items = [{
        fileUrl: String(indexOrUrl || ''),
        fileName: attachmentsOrName || 'Photo Evidence',
        fileType: legacyFileType || 'image/jpeg',
      }];
      attachmentPreviewState.index = 0;
    }

    attachmentPreviewState.zoom = 1;
    renderAttachmentPreview();
    modal.classList.remove('hidden');

    if (attachmentPreviewState.keyHandler) {
      document.removeEventListener('keydown', attachmentPreviewState.keyHandler);
    }
    attachmentPreviewState.keyHandler = (ev) => {
      if (ev.key === 'Escape') {
        closeAttachmentPreviewModal();
      } else if (ev.key === 'ArrowLeft' && attachmentPreviewState.items.length > 1) {
        navigateAttachmentPreview(-1);
      } else if (ev.key === 'ArrowRight' && attachmentPreviewState.items.length > 1) {
        navigateAttachmentPreview(1);
      }
    };
    document.addEventListener('keydown', attachmentPreviewState.keyHandler);
  }

  function navigateAttachmentPreview(delta) {
    const len = attachmentPreviewState.items.length;
    if (len <= 1) return;
    attachmentPreviewState.index = (attachmentPreviewState.index + delta + len) % len;
    attachmentPreviewState.zoom = 1;
    renderAttachmentPreview();
  }

  function adjustAttachmentZoom(delta) {
    const next = Math.min(3, Math.max(1, attachmentPreviewState.zoom + delta));
    attachmentPreviewState.zoom = next;
    updateAttachmentZoomUI();
  }

  function resetAttachmentZoom() {
    attachmentPreviewState.zoom = 1;
    updateAttachmentZoomUI();
  }

  function closeAttachmentPreviewModal() {
    const modal = document.getElementById('admin-attachment-preview-modal');
    const contentEl = document.getElementById('attachment-preview-content');
    if (modal) modal.classList.add('hidden');
    if (contentEl) contentEl.innerHTML = '';
    if (attachmentPreviewState.keyHandler) {
      document.removeEventListener('keydown', attachmentPreviewState.keyHandler);
      attachmentPreviewState.keyHandler = null;
    }
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
      const locText = data.location || data.address || 'Location not specified';
      document.getElementById('modal-report-location').textContent = locText;
      const latVal = data.latitude !== null && data.latitude !== undefined ? Number(data.latitude) : NaN;
      const lngVal = data.longitude !== null && data.longitude !== undefined ? Number(data.longitude) : NaN;
      const hasValidCoords =
        Number.isFinite(latVal) &&
        Number.isFinite(lngVal) &&
        latVal >= -90 &&
        latVal <= 90 &&
        lngVal >= -180 &&
        lngVal <= 180 &&
        !(latVal === 0 && lngVal === 0);

      if (hasValidCoords) {
        const metaBits = [];
        if (data.locationSource === 'gps') metaBits.push('GPS');
        else if (data.locationSource === 'manual') metaBits.push('Manual Map Pin');
        if (Number.isFinite(Number(data.gpsAccuracy))) {
          const acc = Math.round(Number(data.gpsAccuracy));
          metaBits.push(acc > 100 ? `+/-${acc}m (Low accuracy)` : `+/-${acc}m`);
        }
        if (data.locationCapturedAt) {
          metaBits.push(`Captured ${formatDateTime(data.locationCapturedAt)}`);
        }
        const metaSuffix = metaBits.length ? ` (${metaBits.join(' | ')})` : '';
        document.getElementById('modal-report-coords').textContent = `${latVal.toFixed(6)}° N, ${lngVal.toFixed(6)}° E${metaSuffix}`;
        initOrUpdateModalMap(latVal, lngVal, data.referenceNumber, locText, data.recordType);
      } else {
        document.getElementById('modal-report-coords').textContent = 'Coordinates unavailable';
        initOrUpdateModalMap(null, null, null, null, data.recordType);
      }

      // Section D: Reporter Profile
      const rep = data.reporter || {};
      document.getElementById('modal-reporter-name').textContent = rep.name || 'Anonymous Resident';
      const repIdEl = document.getElementById('modal-reporter-id');
      if (repIdEl) {
        repIdEl.textContent = rep.userCode || rep.userId || (rep.id ? `RSDNT-${String(rep.id).padStart(4, '0')}` : '—');
      }
      document.getElementById('modal-reporter-phone').textContent = rep.phone || 'Not provided';
      document.getElementById('modal-reporter-email').textContent = rep.email || 'Not provided';
      document.getElementById('modal-reporter-address').textContent = rep.address || 'Barangay Bayanan, Muntinlupa City';

      const verEl = document.getElementById('modal-reporter-verification');
      if (verEl) {
        const isVer = String(rep.verificationStatus || '').toLowerCase().includes('verified');
        verEl.innerHTML = `
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${isVer ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
          }">
            ${escapeHtml(rep.verificationStatus || 'Unverified Resident')}
          </span>
        `;
      }

      // Section F: Photo Evidence
      const attachEl = document.getElementById('modal-report-attachments');
      const countEl = document.getElementById('modal-report-attachment-count');
      attachEl.innerHTML = '';
      const attachments = data.attachments || [];
      if (countEl) {
        countEl.textContent = `${attachments.length} ${attachments.length === 1 ? 'file' : 'files'}`;
      }

      if (attachments.length === 0) {
        attachEl.innerHTML = '<div class="rounded-xl border border-dashed border-[#EEEEEE] bg-[#FBFBFA] p-4 text-center text-xs text-[#777777]">No photo evidence submitted for this report.</div>';
      } else {
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3';
        attachments.forEach((att, idx) => {
          const fileUrl = att.fileUrl || att.file_url || '';
          const fileName = att.fileName || att.file_name || `Photo Evidence ${idx + 1}`;
          const fileType = att.fileType || att.file_type || 'image/jpeg';
          const isVideo = fileType.includes('video') || /\.(mp4|webm|mov|ogg)$/i.test(fileUrl);

          const card = document.createElement('div');
          card.className = 'group relative rounded-2xl overflow-hidden border border-[#EEEEEE] h-40 bg-[#FFFDF7] cursor-pointer hover:border-[#F5B900] transition-colors shadow-subtle flex items-center justify-center p-1.5';
          card.onclick = () => openAttachmentPreviewModal(idx, attachments);

          if (isVideo) {
            card.innerHTML = `
              <div class="w-full h-full flex flex-col items-center justify-center bg-black/5 rounded-xl text-xs font-bold text-[#202020] p-2 text-center">
                <span class="p-2 rounded-full bg-white shadow mb-1">
                  <svg class="w-4 h-4 text-[#202020]" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </span>
                <span class="truncate max-w-[140px] text-[10px]">${escapeHtml(fileName)}</span>
              </div>
            `;
          } else {
            card.innerHTML = `
              <img src="${escapeHtml(fileUrl)}" alt="${escapeHtml(fileName)}" class="max-w-full max-h-full w-auto h-auto object-contain rounded-xl transition-transform group-hover:scale-[1.02]" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<div class=\\'p-2 text-[11px] text-center text-[#777777] flex items-center justify-center h-full\\'>Photo unavailable</div>';">
              <div class="absolute inset-x-0 bottom-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity py-1 px-2 text-center text-white text-[10px] font-bold">
                Click to Preview
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
          <td class="px-4 py-3 font-mono text-xs font-bold text-[#202020]">${escapeHtml(r.userCode || r.badgeNumber || r.userId || '—')}</td>
          <td class="px-4 py-3 text-xs">
            <span class="font-bold text-[#202020] block">${escapeHtml(r.fullName || r.name)}</span>
            <span class="text-[11px] text-[#777777]">${escapeHtml(r.designation || r.specialization || 'Responder')}</span>
          </td>
          <td class="px-4 py-3 text-xs text-[#555555]">${escapeHtml(r.organization || r.assignedUnit || 'Barangay Bayanan Emergency Response Team')}</td>
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
      // 1. Fetch open, unassigned operations (exclude already-assigned, in-progress, resolved, or rejected items)
      const reportsData = await apiRequest('/reports?filter=all');
      targetSelect.innerHTML = '';
      const allItems = reportsData.items || reportsData.reports || [];
      const items = allItems.filter((item) => {
        const isExplicitTarget =
          defaultTargetId &&
          Number(item.id) === Number(defaultTargetId) &&
          (!defaultType || item.recordType === defaultType);
        if (item.assignedTo) return false;
        const isOpenBucket = item.filterBucket === 'pending' || item.filterBucket === 'verified';
        return isOpenBucket || isExplicitTarget;
      });
      if (items.length === 0) {
        targetSelect.innerHTML = '<option value="">No unassigned operations available</option>';
      } else {
        items.forEach((item) => {
          const opt = document.createElement('option');
          opt.value = `${item.recordType}:${item.id}`;
          opt.textContent = `[${item.typeLabel}] ${item.referenceNumber} - ${item.category}`;
          if (
            defaultTargetId &&
            Number(item.id) === Number(defaultTargetId) &&
            (!defaultType || item.recordType === defaultType)
          ) {
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

  function getLocationVerificationBadgeHtml(locStatus) {
    const map = {
      verified: { label: 'Verified', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      outside_boundary: { label: 'Outside Boundary', cls: 'bg-rose-50 text-[#D93636] border-rose-200' },
      pending_review: { label: 'Pending Review', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
      gps_denied: { label: 'GPS Denied', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
      gps_unavailable: { label: 'GPS Unavailable', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
      retry_required: { label: 'Retry Required', cls: 'bg-amber-50 text-amber-800 border-amber-200' }
    };
    const key = String(locStatus || 'pending_review').toLowerCase();
    const meta = map[key] || map.pending_review;
    return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${meta.cls}">${escapeHtml(meta.label)}</span>`;
  }

  async function loadUsersList() {
    if (isUsersLoading) return;
    isUsersLoading = true;

    const isResidentTab = state.users.filters.role === 'resident';
    const locFilterEl = document.getElementById('users-location-filter-select');
    const locThEl = document.getElementById('users-th-location-verification');
    if (locFilterEl) locFilterEl.classList.toggle('hidden', !isResidentTab);
    if (locThEl) locThEl.classList.toggle('hidden', !isResidentTab);

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
        locationStatus: isResidentTab ? (state.users.filters.locationStatus || 'all') : 'all',
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

    const isResidentTab = state.users.filters.role === 'resident';

    uniqueUsers.forEach((u) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-[#FFF9E8]/40 transition-colors';
      const userRole = u.role || u.roleName || 'Resident';
      const roleUnit = u.badgeNumber ? `${userRole} (${u.badgeNumber})` : userRole;
      const displayId = u.userCode || u.userId || u.user_code || (u.id ? `USR-${String(u.id).padStart(5, '0')}` : '—');
      const locMethodLabel = u.locationVerificationMethod === 'gps'
        ? 'GPS'
        : u.locationVerificationMethod === 'manual_admin'
        ? 'Admin Review'
        : '';
      const locMetaText = [
        locMethodLabel,
        u.locationAccuracyMeters ? `(+/-${Math.round(u.locationAccuracyMeters)}m)` : ''
      ].filter(Boolean).join(' ');

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
        ${isResidentTab ? `
        <td class="px-4 py-3 text-xs whitespace-nowrap">
          <div class="flex flex-col items-start gap-0.5">
            ${getLocationVerificationBadgeHtml(u.locationVerificationStatus)}
            ${locMetaText ? `<span class="text-[10px] text-[#777777]">${escapeHtml(locMetaText)}</span>` : ''}
          </div>
        </td>
        ` : ''}
        <td class="px-4 py-3 text-xs text-[#777777] whitespace-nowrap">
          ${formatShortDate(u.registeredAt)}
        </td>
        <td class="px-4 py-3 text-xs text-right whitespace-nowrap space-x-1.5">
          ${isResidentTab ? `
          <button type="button" onclick="window.GeoSafeAdmin.openLocationReviewModal(${u.id})" class="px-3 py-1.5 rounded-xl border border-[#FFE872] bg-[#FFF9E8] hover:bg-[#F5B900] text-xs font-bold text-[#202020] transition-colors">
            Review Location
          </button>
          ` : ''}
          <button type="button" onclick="window.GeoSafeAdmin.openUserStatusModal(${u.id}, '${escapeHtml(u.name)}', '${escapeHtml(u.email)}', '${u.status}', '${escapeHtml(displayId)}')" class="px-3 py-1.5 rounded-xl border border-[#EEEEEE] hover:bg-[#FFF9E8] text-xs font-bold text-[#202020] transition-colors">
            Manage Status
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function openLocationReviewModal(userId) {
    const user = (state.users.items || []).find((u) => Number(u.id) === Number(userId));
    if (!user) return;
    state.users.locationReviewUser = user;

    const modal = document.getElementById('admin-location-review-modal');
    if (!modal) return;

    const codeEl = document.getElementById('loc-modal-user-code');
    if (codeEl) codeEl.textContent = user.userCode || user.userId || `RSDNT-${user.id}`;
    document.getElementById('loc-modal-name').textContent = user.name || '-';
    document.getElementById('loc-modal-email').textContent = user.email || '-';
    document.getElementById('loc-modal-current-badge').innerHTML = getLocationVerificationBadgeHtml(user.locationVerificationStatus);

    const methodMap = {
      gps: 'Automatic GPS',
      manual_admin: 'Manual Admin Review',
      none: 'None'
    };
    document.getElementById('loc-modal-method').textContent = methodMap[user.locationVerificationMethod] || 'None';
    document.getElementById('loc-modal-accuracy').textContent = user.locationAccuracyMeters !== null && user.locationAccuracyMeters !== undefined
      ? `+/-${Math.round(user.locationAccuracyMeters)} m`
      : 'N/A';
    document.getElementById('loc-modal-distance').textContent = user.locationBoundaryDistanceMeters !== null && user.locationBoundaryDistanceMeters !== undefined
      ? `${user.locationBoundaryDistanceMeters} m from edge`
      : 'N/A';
    document.getElementById('loc-modal-timestamp').textContent = user.locationVerifiedAt
      ? formatShortDate(user.locationVerifiedAt)
      : 'Not yet verified';

    const prevReasonParts = [];
    if (user.locationReviewReason) prevReasonParts.push(user.locationReviewReason);
    if (user.locationVerifiedByName) prevReasonParts.push(`Reviewed by: ${user.locationVerifiedByName}`);
    document.getElementById('loc-modal-prev-reason').textContent = prevReasonParts.length > 0
      ? prevReasonParts.join(' | ')
      : 'None recorded';

    document.getElementById('loc-modal-reason').value = '';
    modal.classList.remove('hidden');
  }

  function closeLocationReviewModal() {
    const modal = document.getElementById('admin-location-review-modal');
    if (modal) modal.classList.add('hidden');
    state.users.locationReviewUser = null;
  }

  async function submitLocationVerificationDecision(decision) {
    const user = state.users.locationReviewUser;
    if (!user) return;
    const reasonEl = document.getElementById('loc-modal-reason');
    const reason = (reasonEl ? reasonEl.value : '').trim();

    if (!reason || reason.length < 3) {
      showToast('Please enter a brief reason for your verification decision (min 3 characters).', 'warning');
      if (reasonEl) reasonEl.focus();
      return;
    }

    const approveBtn = document.getElementById('loc-modal-approve-btn');
    const rejectBtn = document.getElementById('loc-modal-reject-btn');
    if (approveBtn) approveBtn.disabled = true;
    if (rejectBtn) rejectBtn.disabled = true;

    try {
      const res = await apiRequest(`/users/${user.id}/location-verification`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason })
      });
      closeLocationReviewModal();
      showToast(res.message || 'Location verification updated.', 'success');
      await loadUsersList();
    } catch (err) {
      showToast(err.message || 'Failed to update location verification.', 'error');
    } finally {
      if (approveBtn) approveBtn.disabled = false;
      if (rejectBtn) rejectBtn.disabled = false;
    }
  }

  function openUserStatusModal(id, name, email, currentStatus, userCode) {
    state.users.selectedUser = { id, name, email, currentStatus, userCode };
    const modal = document.getElementById('admin-user-status-modal');
    if (!modal) return;

    const idEl = document.getElementById('user-modal-id');
    if (idEl) idEl.textContent = userCode || (id ? `USR-${id}` : '—');
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

  function handleResponderDesignationChange() {
    const desigSelect = document.getElementById('resp-designation');
    const customWrap = document.getElementById('resp-custom-designation-wrap');
    const customInput = document.getElementById('resp-custom-designation');
    if (!desigSelect || !customWrap) return;

    if (desigSelect.value === 'Other') {
      customWrap.classList.remove('hidden');
      if (customInput) customInput.required = true;
    } else {
      customWrap.classList.add('hidden');
      if (customInput) {
        customInput.required = false;
        customInput.value = '';
      }
    }
  }

  function openCreateResponderModal() {
    const modal = document.getElementById('admin-create-responder-modal');
    if (modal) {
      const errEl = document.getElementById('create-responder-error');
      if (errEl) errEl.classList.add('hidden');
      const form = document.getElementById('admin-create-responder-form');
      if (form) form.reset();
      const desigSelect = document.getElementById('resp-designation');
      if (desigSelect) desigSelect.value = 'Responder / Rescue Personnel';
      const customWrap = document.getElementById('resp-custom-designation-wrap');
      if (customWrap) customWrap.classList.add('hidden');
      const customInput = document.getElementById('resp-custom-designation');
      if (customInput) {
        customInput.required = false;
        customInput.value = '';
      }
      modal.classList.remove('hidden');
    }
  }

  function closeCreateResponderModal() {
    const modal = document.getElementById('admin-create-responder-modal');
    if (modal) modal.classList.add('hidden');
  }

  function closeResponderCreatedModal() {
    const modal = document.getElementById('admin-responder-created-modal');
    if (modal) modal.classList.add('hidden');
  }

  function copyTemporaryPassword() {
    const passInput = document.getElementById('created-resp-temp-pass');
    if (!passInput || !passInput.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(passInput.value).then(() => {
        showBannerMessage('Temporary password copied to clipboard.');
      }).catch(() => {
        passInput.select();
        document.execCommand('copy');
        showBannerMessage('Temporary password copied to clipboard.');
      });
    } else {
      passInput.select();
      document.execCommand('copy');
      showBannerMessage('Temporary password copied to clipboard.');
    }
  }

  async function submitCreateResponder(e) {
    e.preventDefault();
    const errEl = document.getElementById('create-responder-error');
    if (errEl) errEl.classList.add('hidden');

    const firstName = (document.getElementById('resp-first-name')?.value || '').trim();
    const middleName = (document.getElementById('resp-middle-name')?.value || '').trim();
    const lastName = (document.getElementById('resp-last-name')?.value || '').trim();
    const phone = (document.getElementById('resp-phone')?.value || '').trim();
    const email = (document.getElementById('resp-email')?.value || '').trim();
    const desigSelect = document.getElementById('resp-designation');
    const rawDesig = desigSelect ? desigSelect.value : '';
    const customDesig = (document.getElementById('resp-custom-designation')?.value || '').trim();
    const serviceId = (document.getElementById('resp-service-id')?.value || '').trim();
    const status = 'active';

    if (!firstName || !lastName) {
      if (errEl) {
        errEl.textContent = 'First name and last name are required.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (!email) {
      if (errEl) {
        errEl.textContent = 'Email address is required.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (!phone) {
      if (errEl) {
        errEl.textContent = 'Contact number is required.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    let effectiveDesignation = rawDesig;
    if (rawDesig === 'Other') {
      if (!customDesig) {
        if (errEl) {
          errEl.textContent = 'Please specify the designation / position.';
          errEl.classList.remove('hidden');
        }
        return;
      }
      effectiveDesignation = customDesig;
    }

    const payload = {
      first_name: firstName,
      middle_name: middleName || undefined,
      last_name: lastName,
      contact_number: phone,
      email: email,
      organization: 'Barangay Bayanan Emergency Response Team',
      responder_unit: 'Barangay Bayanan Emergency Response Team',
      designation: effectiveDesignation,
      service_id: serviceId || undefined,
      account_status: status
    };

    const submitBtn = document.getElementById('resp-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';
    }

    try {
      const result = await apiRequest('/users/responders', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      closeCreateResponderModal();

      // Display the auto-generated credentials and confirmation modal
      const createdModal = document.getElementById('admin-responder-created-modal');
      const resp = result.responder || result.user || {};
      if (createdModal) {
        const idEl = document.getElementById('created-resp-id');
        const nameEl = document.getElementById('created-resp-name');
        const emailEl = document.getElementById('created-resp-email');
        const orgEl = document.getElementById('created-resp-org');
        const desigEl = document.getElementById('created-resp-desig');
        const statusEl = document.getElementById('created-resp-status');
        const passEl = document.getElementById('created-resp-temp-pass');

        if (idEl) idEl.textContent = resp.userCode || resp.responderId || 'RSPDR-XXXX';
        if (nameEl) nameEl.textContent = resp.name || `${firstName} ${lastName}`;
        if (emailEl) emailEl.textContent = resp.email || email;
        if (orgEl) orgEl.textContent = resp.organization || 'Barangay Bayanan Emergency Response Team';
        if (desigEl) desigEl.textContent = resp.designation || effectiveDesignation;
        if (statusEl) {
          const finalStatus = (resp.status || status).toLowerCase();
          statusEl.textContent = finalStatus.toUpperCase();
          statusEl.className = finalStatus === 'active' ? 'font-bold text-emerald-600' : 'font-bold text-slate-500';
        }
        if (passEl) passEl.value = resp.temporaryPassword || '';

        createdModal.classList.remove('hidden');
      } else {
        showBannerMessage(result.message || 'Responder account provisioned.');
      }

      switchUsersRoleTab('responder');
      loadRespondersList();
      loadUsersList();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Failed to create responder account.';
        errEl.classList.remove('hidden');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Responder';
      }
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

    const catSelect = document.getElementById('broadcast-advisory-type-select');
    const selectedOpt = catSelect && catSelect.selectedOptions ? catSelect.selectedOptions[0] : null;
    const categoryId = (catSelect?.value || '').trim();
    const categoryName = (selectedOpt?.getAttribute('data-name') || selectedOpt?.textContent || '').trim();
    const badgeColor = (selectedOpt?.getAttribute('data-color') || '').trim();
    const title = document.getElementById('broadcast-title-input').value.trim();
    const scope = document.getElementById('broadcast-scope-select').value;
    const zones = document.getElementById('broadcast-zones-input').value.trim();
    const message = document.getElementById('broadcast-message-input').value.trim();

    if (!categoryId || !categoryName) {
      if (errEl) {
        errEl.textContent = 'Please select an Advisory Category.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (!title || !message) {
      if (errEl) {
        errEl.textContent = 'Please provide both an alert title and message content.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (scope === 'Specific Purok' && !zones) {
      if (errEl) {
        errEl.textContent = 'Please specify the affected Purok or specific zones.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    state.broadcasts.pendingBroadcast = { categoryId: Number(categoryId), advisoryType: categoryName, badgeColor, title, scope, zones, message };

    const advisoryPreviewEl = document.getElementById('confirm-broadcast-advisory-type');
    if (advisoryPreviewEl) {
      advisoryPreviewEl.innerHTML = window.GeoSafeAdvisories
        ? window.GeoSafeAdvisories.renderBadge(categoryName, { badgeColor })
        : escapeHtml(categoryName);
    }
    document.getElementById('confirm-broadcast-title').textContent = title;
    document.getElementById('confirm-broadcast-scope').textContent = zones ? `${scope} (${zones})` : scope;
    document.getElementById('confirm-broadcast-message').textContent = message;

    const modal = document.getElementById('admin-broadcast-confirm-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function closeBroadcastConfirmModal() {
    if (state.broadcasts.isSubmitting) return;
    const modal = document.getElementById('admin-broadcast-confirm-modal');
    if (modal) modal.classList.add('hidden');
    state.broadcasts.pendingBroadcast = null;
  }

  async function executeBroadcastTransmission() {
    if (!state.broadcasts.pendingBroadcast || state.broadcasts.isSubmitting) return;
    const pending = state.broadcasts.pendingBroadcast;
    const submitBtn = document.getElementById('confirm-broadcast-submit-btn');
    const cancelBtn = document.getElementById('confirm-broadcast-cancel-btn');

    state.broadcasts.isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Transmitting...';
    }
    if (cancelBtn) cancelBtn.disabled = true;

    try {
      const result = await apiRequest('/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          category_id: pending.categoryId,
          advisory_type: pending.advisoryType,
          title: pending.title,
          target_scope: pending.scope,
          target_zones: pending.zones || null,
          message: pending.message
        })
      });

      showBannerMessage(result.message || 'Emergency alert transmitted successfully.');
      state.broadcasts.isSubmitting = false;
      closeBroadcastConfirmModal();
      document.getElementById('emergency-broadcast-form').reset();
      const descEl = document.getElementById('broadcast-advisory-type-desc');
      if (descEl) descEl.textContent = 'Select a category from the database.';
      loadBroadcastsList();
      loadDashboardOverview();
    } catch (err) {
      state.broadcasts.isSubmitting = false;
      closeBroadcastConfirmModal();
      const errEl = document.getElementById('broadcast-form-error');
      if (errEl) {
        errEl.textContent = err.message || 'Unable to save emergency broadcast.';
        errEl.classList.remove('hidden');
      }
    } finally {
      state.broadcasts.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm & Transmit';
      }
      if (cancelBtn) cancelBtn.disabled = false;
    }
  }

  async function loadBroadcastCategories(selectedId = null) {
    const selectEl = document.getElementById('broadcast-advisory-type-select');
    const descEl = document.getElementById('broadcast-advisory-type-desc');
    if (!selectEl) return;

    try {
      const data = await apiRequest('/broadcast-categories');
      const categories = Array.isArray(data && data.categories) ? data.categories : [];
      state.broadcasts.categories = categories;
      selectEl.innerHTML = '<option value="">Select advisory category...</option>' + categories.map((c) =>
        `<option value="${c.id}" data-name="${escapeHtml(c.name)}" data-color="${escapeHtml(c.badge_color || 'gray')}" data-desc="${escapeHtml(c.description || '')}">${escapeHtml(c.name)}</option>`
      ).join('');
      if (selectedId) {
        selectEl.value = String(selectedId);
        selectEl.dispatchEvent(new Event('change'));
      } else if (descEl) {
        descEl.textContent = categories.length > 0 ? 'Select a category from the database.' : 'No active broadcast categories found.';
      }
    } catch (err) {
      console.error('[Admin] loadBroadcastCategories failed:', err.message);
      selectEl.innerHTML = '<option value="">Unable to load categories</option>';
    }
  }

  async function promptNewBroadcastCategory() {
    const rawName = window.prompt('Enter new Advisory Category name:');
    if (!rawName || !rawName.trim()) return;
    try {
      const res = await apiRequest('/broadcast-categories', {
        method: 'POST',
        body: JSON.stringify({ name: rawName.trim() })
      });
      await loadBroadcastCategories(res && res.category ? res.category.id : null);
      showBannerMessage(`Category "${rawName.trim()}" added.`);
    } catch (err) {
      showBannerMessage(err.message || 'Unable to add category.', 'error');
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
        const catLabel = b.categoryName || b.advisoryType || 'Other';
        const advisoryBadge = window.GeoSafeAdvisories
          ? window.GeoSafeAdvisories.renderBadge(catLabel, { badgeColor: b.badgeColor })
          : escapeHtml(catLabel);
        tr.innerHTML = `
          <td class="px-4 py-3 font-mono text-xs font-bold text-[#202020]">${escapeHtml(b.referenceNumber)}</td>
          <td class="px-4 py-3 text-xs whitespace-nowrap">${advisoryBadge}</td>
          <td class="px-4 py-3 text-xs">
            <span class="font-bold text-[#202020] block">${escapeHtml(b.title)}</span>
            <span class="text-[11px] text-[#555555] line-clamp-1">${escapeHtml(b.message)}</span>
          </td>
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
  const CATEGORY_CHART_COLOR_MAP = {
    flooding: '#3478C7',
    flood: '#3478C7',
    fire: '#D93636',
    'medical emergency': '#278653',
    'road obstruction / fallen tree': '#F5B900',
    'power line / utility hazard': '#8B5CF6',
    'structural damage': '#EA580C',
    earthquake: '#7C3AED',
    landslide: '#B45309'
  };
  const CATEGORY_CHART_PALETTE = ['#3478C7', '#D93636', '#278653', '#F5B900', '#8B5CF6', '#EA580C', '#0D9488', '#DB2777', '#4F46E5'];

  function getCategoryChartColor(name, idx) {
    const key = String(name || '').trim().toLowerCase();
    if (CATEGORY_CHART_COLOR_MAP[key]) return CATEGORY_CHART_COLOR_MAP[key];
    return CATEGORY_CHART_PALETTE[idx % CATEGORY_CHART_PALETTE.length];
  }

  function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180.0;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad)
    };
  }

  function describeDoughnutArc(cx, cy, outerR, innerR, startAngle, endAngle) {
    const startOuter = polarToCartesian(cx, cy, outerR, endAngle);
    const endOuter = polarToCartesian(cx, cy, outerR, startAngle);
    const startInner = polarToCartesian(cx, cy, innerR, endAngle);
    const endInner = polarToCartesian(cx, cy, innerR, startAngle);
    const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
    return [
      'M', startOuter.x.toFixed(2), startOuter.y.toFixed(2),
      'A', outerR, outerR, 0, largeArc, 0, endOuter.x.toFixed(2), endOuter.y.toFixed(2),
      'L', endInner.x.toFixed(2), endInner.y.toFixed(2),
      'A', innerR, innerR, 0, largeArc, 1, startInner.x.toFixed(2), startInner.y.toFixed(2),
      'Z'
    ].join(' ');
  }

  function renderCategoryDoughnutChart(containerId, badgeId, distribution, options = {}) {
    const container = document.getElementById(containerId);
    const badgeEl = badgeId ? document.getElementById(badgeId) : null;
    if (!container) return;

    if (options.error) {
      if (badgeEl) badgeEl.textContent = 'Error';
      container.innerHTML = `
        <div class="p-6 rounded-2xl bg-[#FFF1F1] border border-[#FFC2C2] text-center space-y-2">
          <p class="text-xs font-bold text-[#D93636]">Unable to load disaster category distribution.</p>
          <p class="text-[11px] text-[#B82828]">${escapeHtml(options.error)}</p>
          ${options.onRetry ? `<button type="button" onclick="${escapeHtml(options.onRetry)}" class="px-3 py-1.5 rounded-xl bg-white border border-[#FFC2C2] text-[#D93636] text-xs font-bold hover:bg-[#FFF9E8]">Retry</button>` : ''}
        </div>
      `;
      return;
    }

    const totalReports = Number((distribution && distribution.totalReports) || 0);
    const rawCats = Array.isArray(distribution && distribution.categories) ? distribution.categories : [];
    const allCats = Array.isArray(distribution && distribution.allCategories) && distribution.allCategories.length > 0
      ? distribution.allCategories
      : rawCats;

    if (badgeEl) {
      badgeEl.textContent = `${totalReports.toLocaleString()} Total ${totalReports === 1 ? 'Report' : 'Reports'}`;
    }

    if (totalReports <= 0 || rawCats.length === 0) {
      container.innerHTML = `
        <div class="gs-doughnut-layout">
          <div class="gs-doughnut-visual">
            <div class="relative flex-shrink-0 flex items-center justify-center" style="width: clamp(210px, 55vw, 268px); height: clamp(210px, 55vw, 268px); aspect-ratio: 1 / 1;">
              <svg viewBox="0 0 260 260" class="w-full h-full" role="img" aria-label="Empty disaster category distribution chart">
                <circle cx="130" cy="130" r="95" fill="none" stroke="#EEEEEE" stroke-width="38"></circle>
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
                <span class="text-3xl font-black text-[#202020] leading-none">0</span>
                <span class="text-[11px] font-bold text-[#777777] uppercase tracking-wider mt-1">Total Reports</span>
              </div>
            </div>
          </div>
          <div class="gs-doughnut-legend text-center md:text-left space-y-1.5">
            <p class="text-[11px] font-bold text-[#777777] uppercase tracking-wider">Disaster category legend</p>
            <p class="text-sm font-bold text-[#202020]">No incident reports available.</p>
            <p class="text-xs text-[#777777] leading-relaxed">Genuine incident reports submitted by residents will appear here grouped by disaster category.</p>
          </div>
        </div>
      `;
      return;
    }

    const segments = rawCats
      .map((c, idx) => {
        const count = Number(c.count || 0);
        const pct = totalReports > 0 ? Number(((count / totalReports) * 100).toFixed(1)) : 0;
        return {
          name: c.name || 'Uncategorized',
          count,
          percentage: pct,
          color: getCategoryChartColor(c.name, idx)
        };
      })
      .filter((s) => s.count > 0);

    let currentAngle = 0;
    const svgParts = [];
    segments.forEach((seg, segIdx) => {
      const sweep = (seg.count / totalReports) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sweep;
      const midAngle = startAngle + sweep / 2;
      currentAngle = endAngle;

      const labelText = `${seg.name} - ${seg.count} ${seg.count === 1 ? 'report' : 'reports'} (${seg.percentage}%)`;

      if (sweep >= 359.9) {
        svgParts.push(`
          <circle
            cx="130" cy="130" r="95" fill="none"
            stroke="${seg.color}" stroke-width="38"
            class="gs-doughnut-seg cursor-pointer"
            data-seg-idx="${segIdx}"
            data-mid-angle="90"
            data-name="${escapeHtml(seg.name)}"
            data-count="${seg.count}"
            data-pct="${seg.percentage}"
            data-color="${seg.color}"
            tabindex="0"
            role="button"
            aria-pressed="false"
            aria-label="${escapeHtml(labelText)}"
          ></circle>
        `);
      } else {
        const d = describeDoughnutArc(130, 130, 114, 76, startAngle, endAngle);
        svgParts.push(`
          <path
            d="${d}"
            fill="${seg.color}"
            stroke="#FFFFFF"
            stroke-width="2"
            class="gs-doughnut-seg cursor-pointer"
            data-seg-idx="${segIdx}"
            data-mid-angle="${midAngle.toFixed(2)}"
            data-name="${escapeHtml(seg.name)}"
            data-count="${seg.count}"
            data-pct="${seg.percentage}"
            data-color="${seg.color}"
            tabindex="0"
            role="button"
            aria-pressed="false"
            aria-label="${escapeHtml(labelText)}"
          ></path>
        `);
      }

      if (seg.percentage >= 8) {
        const pos = polarToCartesian(130, 130, 95, midAngle);
        const textFill = seg.color === '#F5B900' ? '#202020' : '#FFFFFF';
        svgParts.push(`
          <text
            x="${pos.x.toFixed(2)}"
            y="${pos.y.toFixed(2)}"
            fill="${textFill}"
            font-size="11.5"
            font-weight="800"
            text-anchor="middle"
            dominant-baseline="central"
            class="pointer-events-none select-none"
          >${Math.round(seg.percentage)}%</text>
        `);
      }
    });

    const segIndexByName = new Map(segments.map((s, i) => [s.name, i]));
    const legendItems = (allCats.length > 0 ? allCats : segments).map((c, idx) => {
      const count = Number(c.count || 0);
      const color = getCategoryChartColor(c.name, idx);
      const isZero = count === 0;
      const segIdx = segIndexByName.has(c.name) ? segIndexByName.get(c.name) : -1;
      return `
        <div
          class="gs-doughnut-legend-item flex items-center gap-2.5 px-3.5 py-2 rounded-xl border border-[#EEEEEE] bg-[#FFFDF7] ${isZero ? 'opacity-60' : 'cursor-pointer hover:bg-[#FFF9E8]/70'}"
          ${segIdx >= 0 ? `data-legend-seg-idx="${segIdx}"` : ''}
        >
          <span class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${color};"></span>
          <span class="text-xs font-bold text-[#202020] truncate">${escapeHtml(c.name)}</span>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="gs-doughnut-layout">
        <div class="gs-doughnut-visual">
          <div class="relative flex-shrink-0 flex items-center justify-center" style="width: clamp(210px, 55vw, 268px); height: clamp(210px, 55vw, 268px); aspect-ratio: 1 / 1;">
            <svg viewBox="0 0 260 260" class="w-full h-full" role="img" aria-label="Reports by Disaster Category doughnut chart">
              ${svgParts.join('')}
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
              <span class="text-3xl font-black text-[#202020] leading-none">${totalReports.toLocaleString()}</span>
              <span class="text-[11px] font-bold text-[#777777] uppercase tracking-wider mt-1">Total Reports</span>
            </div>
          </div>
          <div class="gs-doughnut-tooltip hidden absolute"></div>
        </div>

        <div class="gs-doughnut-legend">
          <p class="text-[11px] font-bold text-[#777777] uppercase tracking-wider mb-2">Disaster category legend</p>
          <div class="gs-doughnut-legend-list">
            ${legendItems}
          </div>
        </div>
      </div>
    `;

    const visualWrap = container.querySelector('.gs-doughnut-visual');
    const svgEl = container.querySelector('svg');
    const tooltip = container.querySelector('.gs-doughnut-tooltip');
    const segEls = Array.from(container.querySelectorAll('.gs-doughnut-seg'));
    const legendEls = Array.from(container.querySelectorAll('.gs-doughnut-legend-item[data-legend-seg-idx]'));
    let selectedIdx = null;

    const renderTooltipContent = (el) => {
      if (!tooltip || !el) return;
      const name = el.getAttribute('data-name') || '';
      const count = Number(el.getAttribute('data-count') || 0);
      const pct = el.getAttribute('data-pct') || '0';
      const color = el.getAttribute('data-color') || '#F5B900';
      tooltip.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${color};"></span>
          <span class="font-bold text-[#202020]">${escapeHtml(name)}</span>
          <span class="text-[#777777]">-</span>
          <span class="font-semibold text-[#202020]">${count.toLocaleString()} ${count === 1 ? 'report' : 'reports'} (${pct}%)</span>
        </div>
      `;
    };

    const positionTooltip = (el, pointerEvent) => {
      if (!tooltip || !visualWrap || !svgEl || !el) return;
      renderTooltipContent(el);
      tooltip.classList.remove('hidden');

      const visRect = visualWrap.getBoundingClientRect();
      const svgRect = svgEl.getBoundingClientRect();
      const tipW = tooltip.offsetWidth || 160;
      const tipH = tooltip.offsetHeight || 30;
      const centerX = svgRect.left - visRect.left + svgRect.width / 2;
      const centerY = svgRect.top - visRect.top + svgRect.height / 2;

      let targetX;
      let targetY;

      if (pointerEvent && typeof pointerEvent.clientX === 'number') {
        const px = pointerEvent.clientX - visRect.left;
        const py = pointerEvent.clientY - visRect.top;
        const dx = px - centerX;
        const dy = py - centerY;
        const len = Math.hypot(dx, dy) || 1;
        // Nudge slightly outward from doughnut center so the center count stays unobstructed
        const outX = px + (dx / len) * 14;
        const outY = py + (dy / len) * 14;
        targetX = outX - tipW / 2;
        targetY = outY >= centerY ? outY + 6 : outY - tipH - 6;
      } else {
        const midAngle = Number(el.getAttribute('data-mid-angle') || 0);
        const edgePt = polarToCartesian(130, 130, 114, midAngle);
        const scaleX = svgRect.width / 260;
        const scaleY = svgRect.height / 260;
        const anchorX = (svgRect.left - visRect.left) + edgePt.x * scaleX;
        const anchorY = (svgRect.top - visRect.top) + edgePt.y * scaleY;
        targetX = anchorX - tipW / 2;
        targetY = anchorY >= centerY ? anchorY + 8 : anchorY - tipH - 8;
      }

      const maxLeft = Math.max(4, visRect.width - tipW - 4);
      const maxTop = Math.max(4, visRect.height - tipH - 4);
      tooltip.style.left = `${Math.max(4, Math.min(maxLeft, targetX))}px`;
      tooltip.style.top = `${Math.max(4, Math.min(maxTop, targetY))}px`;
    };

    const hideTooltip = () => {
      if (tooltip) tooltip.classList.add('hidden');
    };

    const applySelectionState = () => {
      segEls.forEach((segEl) => {
        const idx = Number(segEl.getAttribute('data-seg-idx'));
        const isSelected = selectedIdx !== null && idx === selectedIdx;
        segEl.classList.toggle('is-selected', isSelected);
        segEl.classList.toggle('is-dimmed', selectedIdx !== null && !isSelected);
        segEl.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      });
      legendEls.forEach((legEl) => {
        const idx = Number(legEl.getAttribute('data-legend-seg-idx'));
        legEl.classList.toggle('is-selected', selectedIdx !== null && idx === selectedIdx);
      });
      if (selectedIdx !== null && segEls[selectedIdx]) {
        positionTooltip(segEls[selectedIdx], null);
      } else {
        hideTooltip();
      }
    };

    const toggleSegment = (idx) => {
      selectedIdx = selectedIdx === idx ? null : idx;
      applySelectionState();
    };

    segEls.forEach((el) => {
      const idx = Number(el.getAttribute('data-seg-idx'));
      el.addEventListener('mousedown', (e) => {
        // Prevent browser focus rectangle on mouse click while keeping Tab focus-visible intact
        e.preventDefault();
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSegment(idx);
      });
      el.addEventListener('mouseenter', (e) => positionTooltip(el, e));
      el.addEventListener('mousemove', (e) => positionTooltip(el, e));
      el.addEventListener('mouseleave', () => {
        if (selectedIdx !== null && segEls[selectedIdx]) {
          positionTooltip(segEls[selectedIdx], null);
        } else {
          hideTooltip();
        }
      });
      el.addEventListener('focus', () => {
        if (el.matches(':focus-visible')) {
          positionTooltip(el, null);
        }
      });
      el.addEventListener('blur', () => {
        if (selectedIdx !== null && segEls[selectedIdx]) {
          positionTooltip(segEls[selectedIdx], null);
        } else {
          hideTooltip();
        }
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleSegment(idx);
        } else if (e.key === 'Escape' && selectedIdx !== null) {
          selectedIdx = null;
          applySelectionState();
        }
      });
    });

    legendEls.forEach((legEl) => {
      const idx = Number(legEl.getAttribute('data-legend-seg-idx'));
      legEl.addEventListener('click', () => toggleSegment(idx));
      legEl.addEventListener('mouseenter', () => {
        if (segEls[idx]) positionTooltip(segEls[idx], null);
      });
      legEl.addEventListener('mouseleave', () => {
        if (selectedIdx !== null && segEls[selectedIdx]) {
          positionTooltip(segEls[selectedIdx], null);
        } else {
          hideTooltip();
        }
      });
    });

    if (visualWrap) {
      visualWrap.addEventListener('click', (e) => {
        if (!e.target.closest('.gs-doughnut-seg') && selectedIdx !== null) {
          selectedIdx = null;
          applySelectionState();
        }
      });
    }
  }

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

      const dist = data.categoryDistribution || {
        totalReports: Number(sum.totalReports || 0),
        categories: data.categories || []
      };
      renderCategoryDoughnutChart(
        'analytics-category-doughnut',
        'analytics-category-total-badge',
        dist,
        { onRetry: 'window.GeoSafeAdmin.loadAnalyticsData()' }
      );

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
      renderCategoryDoughnutChart(
        'analytics-category-doughnut',
        'analytics-category-total-badge',
        null,
        { error: err.message, onRetry: 'window.GeoSafeAdmin.loadAnalyticsData()' }
      );
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
        if (window.innerWidth < 1024) {
          closeMobileDrawer();
        }
      });
    });

    // Map Filters
    const mapTypeSelect = document.getElementById('map-filter-type');
    const mapStatusSelect = document.getElementById('map-filter-status');

    if (mapTypeSelect) {
      mapTypeSelect.addEventListener('change', (e) => {
        state.mapFilters.type = e.target.value;
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

    const advisoryTypeSelect = document.getElementById('broadcast-advisory-type-select');
    const advisoryTypeDesc = document.getElementById('broadcast-advisory-type-desc');
    if (advisoryTypeSelect && advisoryTypeDesc) {
      advisoryTypeSelect.addEventListener('change', (e) => {
        const opt = e.target.selectedOptions ? e.target.selectedOptions[0] : null;
        const desc = opt ? opt.getAttribute('data-desc') : '';
        advisoryTypeDesc.textContent = desc || 'Select a category from the database.';
      });
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

    const usersLocationFilterSelect = document.getElementById('users-location-filter-select');
    if (usersLocationFilterSelect) {
      usersLocationFilterSelect.addEventListener('change', (e) => {
        state.users.filters.locationStatus = e.target.value;
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

    bindDropdownListeners();
  }

  /**
   * Admin Profile Dropdown & Modal Controls
   */
  function toggleProfileDropdown(event) {
    if (event) {
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }
    const dropdown = document.getElementById('admin-profile-dropdown');
    const chevron = document.getElementById('admin-profile-chevron');
    const btn = document.getElementById('admin-profile-menu-btn');
    if (!dropdown) return;

    const isHidden = dropdown.classList.contains('hidden');
    if (isHidden) {
      closeAllDropdowns();
      dropdown.classList.remove('hidden');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      if (chevron) chevron.classList.add('rotate-180');
    } else {
      closeProfileDropdown();
    }
  }

  function closeProfileDropdown() {
    const dropdown = document.getElementById('admin-profile-dropdown');
    const chevron = document.getElementById('admin-profile-chevron');
    const btn = document.getElementById('admin-profile-menu-btn');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      dropdown.classList.add('hidden');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (chevron) chevron.classList.remove('rotate-180');
    }
  }

  function closeAllDropdowns() {
    document.querySelectorAll('[id$="-profile-dropdown"]').forEach(dd => {
      dd.classList.add('hidden');
    });
    document.querySelectorAll('[id$="-profile-chevron"]').forEach(ch => {
      ch.classList.remove('rotate-180');
    });
    document.querySelectorAll('[id$="-profile-menu-btn"]').forEach(btn => {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  function openAdminProfileModal() {
    closeProfileDropdown();
    const modal = document.getElementById('admin-profile-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function closeAdminProfileModal() {
    const modal = document.getElementById('admin-profile-modal');
    if (modal) modal.classList.add('hidden');
  }

  function bindDropdownListeners() {
    if (state._dropdownListenersBound) return;
    state._dropdownListenersBound = true;

    if (typeof document !== 'undefined') {
      document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('admin-header-profile-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
          closeProfileDropdown();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'Esc') {
          closeProfileDropdown();
          closeAdminProfileModal();
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
      const adminDisplayName = check.user.name || check.user.email || 'Administrator';
      const adminRoleName = check.user.role || 'Administrator';
      const adminUserCode = check.user.userCode || check.user.user_code || '—';
      const adminEmail = check.user.email || '—';

      if (headerName && check.user) {
        headerName.textContent = adminDisplayName;
      }
      const headerMobileName = document.getElementById('admin-header-name-mobile');
      if (headerMobileName) headerMobileName.textContent = adminDisplayName;

      const headerRole = document.getElementById('admin-header-role');
      if (headerRole) headerRole.textContent = adminRoleName;
      const headerMobileRole = document.getElementById('admin-header-role-mobile');
      if (headerMobileRole) headerMobileRole.textContent = adminRoleName;

      const headerAvatar = document.getElementById('admin-header-avatar');
      if (headerAvatar) {
        const initials = (adminDisplayName[0] || 'A').toUpperCase();
        headerAvatar.textContent = initials;
      }

      // Populate Admin Profile Modal fields
      const modalName = document.getElementById('admin-modal-name');
      if (modalName) modalName.textContent = adminDisplayName;
      const modalEmail = document.getElementById('admin-modal-email');
      if (modalEmail) modalEmail.textContent = adminEmail;
      const modalUserId = document.getElementById('admin-modal-user-id');
      if (modalUserId) modalUserId.textContent = adminUserCode;
      const modalRole = document.getElementById('admin-modal-role');
      if (modalRole) modalRole.textContent = adminRoleName;
      const modalAvatar = document.getElementById('admin-modal-avatar');
      if (modalAvatar) {
        const initials = (adminDisplayName[0] || 'A').toUpperCase();
        modalAvatar.textContent = initials;
      }

      if (shellEl) shellEl.classList.remove('hidden');

      bindEvents();
      startLiveClock();
      switchAdminSection('dashboard');

      // Restore persisted desktop sidebar collapsed state
      if (window.innerWidth >= 1024) {
        try {
          const savedCollapsed = localStorage.getItem('geosafe_admin_sidebar_collapsed') === 'true';
          if (savedCollapsed) {
            toggleDesktopSidebar(true);
          }
        } catch (_) {}
      }

      window.addEventListener('geosafe:realtime-update', () => {
        if (state.currentSection === 'dashboard') {
          loadDashboardOverview();
        } else if (state.currentSection === 'reports') {
          loadReportsList();
        } else if (state.currentSection === 'responders') {
          loadRespondersList();
        } else if (state.currentSection === 'alerts') {
          loadBroadcastsList();
        }
      });
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
    handleSidebarToggle,
    openMobileDrawer,
    closeMobileDrawer,
    toggleMobileDrawer,
    toggleDesktopSidebar,
    toggleProfileDropdown,
    closeProfileDropdown,
    openAdminProfileModal,
    closeAdminProfileModal,
    switchAdminSection,
    loadDashboardOverview,
    closeMapMarkerPanel,
    handleMapPanelReview,
    loadReportsList,
    navigateReportsPage,
    openReportDetailModal,
    closeReportDetailModal,
    openAttachmentPreviewModal,
    navigateAttachmentPreview,
    adjustAttachmentZoom,
    resetAttachmentZoom,
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
    openLocationReviewModal,
    closeLocationReviewModal,
    submitLocationVerificationDecision,
    openCreateResponderModal,
    closeCreateResponderModal,
    closeResponderCreatedModal,
    copyTemporaryPassword,
    handleResponderDesignationChange,
    submitCreateResponder,
    openCreateResidentModal,
    closeCreateResidentModal,
    submitCreateResident,
    handleBroadcastSubmit,
    closeBroadcastConfirmModal,
    executeBroadcastTransmission,
    loadBroadcastsList,
    loadBroadcastCategories,
    promptNewBroadcastCategory,
    loadAnalyticsData,
    downloadAnalyticsCsv,
    loadSystemSettings,
    saveSetting,
    loadAuditLogs
  };

  document.addEventListener('DOMContentLoaded', initAdminPortal);
})(window);
