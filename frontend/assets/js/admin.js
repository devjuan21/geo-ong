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
    },
    messages: {
      items: [],
      activeConversationId: null
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

    banner.className = 'fixed bottom-5 right-5 z-50 max-w-md px-4 py-3 rounded-lg border shadow-subtle text-xs font-semibold flex items-center justify-between gap-3 transition-all';
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
      return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-slate-50 text-[#8A6800] border border-[#FFE872]">${label}</span>`;
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
    'password-assistance': 'Password Reset Requests',
    alerts: 'Emergency Alerts & Notifications',
    analytics: 'Reports & Analytics',
    settings: 'System Settings & Maintenance',
    audit: 'System Audit Logs',
    messages: 'Rescue Conversation Oversight',
    facilities: 'Healthcare & Hospital Directory'
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
    } catch (_) { }

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
    const validSections = ['dashboard', 'reports', 'responders', 'users', 'password-assistance', 'alerts', 'analytics', 'settings', 'audit', 'messages', 'facilities'];
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
        ? 'admin-sidebar-btn w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold bg-slate-900 text-white transition-colors'
        : 'admin-sidebar-btn w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors';
    });

    // Close mobile drawer if open
    closeMobileDrawer();
    document.body.classList.toggle('gs-admin-messages-mobile', target === 'messages');

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
    } else if (target === 'password-assistance') {
      loadPasswordAssistanceTickets();
    } else if (target === 'alerts') {
      loadBroadcastCategories();
      handleExpirationDurationChange();
      loadBroadcastsList();
    } else if (target === 'analytics') {
      loadAnalyticsData();
    } else if (target === 'settings') {
      loadSystemSettings();
      resetFacilityForm();
      loadAdminFacilitiesList();
    } else if (target === 'audit') {
      loadAuditLogs();
    } else if (target === 'messages') {
      loadAdminConversationsList();
    } else if (target === 'facilities') {
      switchSection('settings');
      return;
    }
  }

  // ============================================================================
  // SECTION 1: DASHBOARD (Summary Statistics + Incident Map + Activity Feed)
  // ============================================================================
  const adminGpsMarkerState = { marker: null, accuracyCircle: null };
  let adminLiveGpsTracker = null;
  let adminResponderStalenessTimer = null;

  function buildResponderLivePopupHtml(entry, isStale) {
    const timeStr = entry.updatedAt ? new Date(entry.updatedAt).toLocaleTimeString() : 'Unknown';
    const accText = Number.isFinite(Number(entry.accuracy)) && entry.accuracy > 0 ? ` • ±${Math.round(entry.accuracy)}m` : '';
    const statusBadge = isStale
      ? '<span style="display:inline-block;padding:1px 6px;border-radius:9999px;background:#FFF9E8;color:#8A6800;border:1px solid #FFE872;font-size:10px;font-weight:700;">Stale</span>'
      : '<span style="display:inline-block;padding:1px 6px;border-radius:9999px;background:#ECFDF5;color:#047857;border:1px solid #A7F3D0;font-size:10px;font-weight:700;">Live</span>';
    return `
      <div class="text-xs p-1 space-y-0.5 min-w-[210px]">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <strong class="text-[#202020]">${escapeHtml(entry.name || 'Responder')}</strong>
          ${statusBadge}
        </div>
        <span class="block font-mono text-[10px] font-semibold text-[#8A6800]">ID: ${escapeHtml(entry.responderId || entry.badgeNumber || `RSP-${entry.userId}`)}</span>
        <span class="block text-[10px] text-[#555555]">Org: ${escapeHtml(entry.organization || 'Emergency Operations')}</span>
        <span class="block text-[10px] text-[#555555]">Unit: ${escapeHtml(entry.assignedUnit || 'Response Unit')}${entry.callsign ? ` (${escapeHtml(entry.callsign)})` : ''}</span>
        <span class="block text-[10px] text-[#777777]">Availability: <strong>${escapeHtml(entry.availabilityStatus || 'On Duty')}</strong>${accText}</span>
        <span class="block font-mono text-[10px] text-[#555555]">${Number(entry.lat).toFixed(5)}, ${Number(entry.lng).toFixed(5)}</span>
        <span class="block text-[10px] text-[#777777]">Last GPS: ${escapeHtml(timeStr)}</span>
      </div>
    `;
  }

  function getResponderInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return 'R';
  }

  function createResponderLiveIcon(isStale, name = '') {
    const initials = escapeHtml(getResponderInitials(name));
    return L.divIcon({
      className: 'geosafe-admin-responder-live',
      html: `
        <div style="position:relative;display:flex;align-items:center;justify-content:center;width:32px;height:32px;">
          <span class="${isStale ? '' : 'animate-ping'}" style="position:absolute;width:28px;height:28px;border-radius:9999px;background:${isStale ? 'rgba(217,119,6,0.28)' : 'rgba(37,99,235,0.32)'};"></span>
          <div style="width:24px;height:24px;border-radius:9999px;background:${isStale ? '#D97706' : '#1D4ED8'};border:2.5px solid #FFFFFF;box-shadow:0 3px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:#FFFFFF;font-size:9px;font-weight:800;letter-spacing:-0.02em;">${initials}</div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }

  function updateAdminMapCountBadge() {
    const badgeEl = document.getElementById('admin-map-count-badge');
    if (!badgeEl) return;
    const incCount = Number(state.lastVisibleMapItemsCount || 0);
    const respCount = state.responderLiveMarkers ? state.responderLiveMarkers.size : 0;
    const incLabel = `${incCount} marker${incCount === 1 ? '' : 's'}`;
    badgeEl.textContent = respCount > 0 ? `${incLabel} • ${respCount} responder${respCount === 1 ? '' : 's'}` : incLabel;
  }

  function upsertAdminResponderLocationMarker(entry) {
    if (!state.mapInstance || !state.responderLiveLayer || !entry || !entry.userId) return;
    const lat = Number(entry.lat);
    const lng = Number(entry.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    const uid = Number(entry.userId);
    const updatedMs = entry.updatedAt ? new Date(entry.updatedAt).getTime() : Date.now();
    const prev = state.responderLiveData.get(uid);
    if (prev && prev.updatedAtMs && updatedMs < prev.updatedAtMs) return;

    const isStale = Boolean(entry.isStale) || (Date.now() - updatedMs > 45000);
    const stored = { ...entry, userId: uid, lat, lng, updatedAtMs: updatedMs, isStale };
    state.responderLiveData.set(uid, stored);

    const popupHtml = buildResponderLivePopupHtml(stored, isStale);
    const tooltipText = `${stored.name || 'Responder'} (${stored.availabilityStatus || 'On Duty'}${isStale ? ' • Stale' : ' • Live'})`;
    const existing = state.responderLiveMarkers.get(uid);
    if (!existing) {
      const marker = L.marker([lat, lng], {
        icon: createResponderLiveIcon(isStale, stored.name),
        zIndexOffset: isStale ? 840 : 860
      }).addTo(state.responderLiveLayer);
      marker.bindTooltip(escapeHtml(tooltipText), { direction: 'top' });
      marker.bindPopup(popupHtml);
      state.responderLiveMarkers.set(uid, marker);
      if (window.__GEOSAFE_GPS_DEBUG__) console.debug('[GeoSafe GPS][Admin] Marker created for responder', uid, lat, lng);
    } else {
      existing.setLatLng([lat, lng]);
      existing.setIcon(createResponderLiveIcon(isStale, stored.name));
      existing.setZIndexOffset(isStale ? 840 : 860);
      existing.setTooltipContent(escapeHtml(tooltipText));
      existing.setPopupContent(popupHtml);
      if (window.__GEOSAFE_GPS_DEBUG__) console.debug('[GeoSafe GPS][Admin] Marker updated for responder', uid, lat, lng);
    }
    updateAdminMapCountBadge();
  }

  function removeAdminResponderLocationMarker(userId) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || !state.responderLiveMarkers) return;
    const marker = state.responderLiveMarkers.get(uid);
    if (marker && state.responderLiveLayer) {
      try { state.responderLiveLayer.removeLayer(marker); } catch (_) { }
    }
    state.responderLiveMarkers.delete(uid);
    if (state.responderLiveData) state.responderLiveData.delete(uid);
    updateAdminMapCountBadge();
  }

  function refreshAdminResponderStaleness() {
    if (!state.responderLiveData || !state.responderLiveMarkers) return;
    const now = Date.now();
    state.responderLiveData.forEach((entry, uid) => {
      const staleNow = Boolean(entry.isStale) || (now - (entry.updatedAtMs || now) > 45000);
      if (staleNow !== entry.lastRenderedStale) {
        entry.lastRenderedStale = staleNow;
        const marker = state.responderLiveMarkers.get(uid);
        if (marker) {
          marker.setIcon(createResponderLiveIcon(staleNow, entry.name));
          marker.setPopupContent(buildResponderLivePopupHtml(entry, staleNow));
        }
      }
    });
  }

  async function loadLiveResponderLocations() {
    if (!state.mapInstance || !state.responderLiveLayer) return;
    try {
      const data = await apiRequest('/responders/live-locations');
      const list = Array.isArray(data && data.responders) ? data.responders : [];
      const activeIds = new Set();
      list.forEach((entry) => {
        activeIds.add(Number(entry.userId));
        upsertAdminResponderLocationMarker(entry);
      });
      if (state.responderLiveMarkers) {
        Array.from(state.responderLiveMarkers.keys()).forEach((uid) => {
          if (!activeIds.has(uid)) removeAdminResponderLocationMarker(uid);
        });
      }
    } catch (err) {
      console.warn('[Admin] Unable to load live responder locations:', err.message);
    }
  }

  function startAdminLiveGpsTracker() {
    if (!state.mapInstance || adminLiveGpsTracker || !window.GeoSafeMapping || typeof window.GeoSafeMapping.createLiveGpsTracker !== 'function') {
      return;
    }
    adminLiveGpsTracker = window.GeoSafeMapping.createLiveGpsTracker({
      syncIntervalMs: 10000,
      onLocation: (reading) => {
        if (!state.mapInstance) return;
        window.GeoSafeMapping.renderLiveGpsMarker(state.mapInstance, adminGpsMarkerState, reading, {
          title: 'Your Admin GPS Location',
          zIndexOffset: 900
        });
      }
    });
    adminLiveGpsTracker.start();
  }

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
      state.responderLiveLayer = L.layerGroup().addTo(state.mapInstance);
      state.responderLiveMarkers = new Map();
      state.responderLiveData = new Map();

      startAdminLiveGpsTracker();
      loadLiveResponderLocations();
      if (!adminResponderStalenessTimer) {
        adminResponderStalenessTimer = setInterval(refreshAdminResponderStaleness, 10000);
        window.addEventListener('geosafe:logout', () => {
          if (adminResponderStalenessTimer) {
            clearInterval(adminResponderStalenessTimer);
            adminResponderStalenessTimer = null;
          }
        });
      }
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

    if (state.responderLiveLayer && state.mapInstance) {
      const showResponders = filterType === 'all' || filterType === 'responder';
      if (showResponders && !state.mapInstance.hasLayer(state.responderLiveLayer)) {
        state.responderLiveLayer.addTo(state.mapInstance);
      } else if (!showResponders && state.mapInstance.hasLayer(state.responderLiveLayer)) {
        state.mapInstance.removeLayer(state.responderLiveLayer);
      }
    }

    const isFacilityFilter = ['facilities', 'hospital', 'health_center'].includes(filterType);
    const visibleItems = (filterType === 'responder' || isFacilityFilter)
      ? []
      : items.filter((item) => {
        if (filterType !== 'all' && item.recordType !== filterType) return false;
        if (filterStatus !== 'all' && item.filterBucket !== filterStatus) return false;
        return true;
      });

    const allFacilities = Array.isArray(state.overview.hospitals) ? state.overview.hospitals : [];
    const filteredFacilities = allFacilities.filter((fac) => {
      if (filterType === 'hospital') return fac.facilityType === 'Hospital';
      if (filterType === 'health_center') return fac.facilityType === 'Health Center';
      return true;
    });
    const showHospitalsToggle = document.getElementById('map-toggle-hospitals');
    const showFacilities = isFacilityFilter || (showHospitalsToggle ? showHospitalsToggle.checked : true);

    state.lastVisibleMapItemsCount = isFacilityFilter ? filteredFacilities.length : visibleItems.length;
    updateAdminMapCountBadge();

    const emptyOverlay = document.getElementById('admin-map-empty');
    if (emptyOverlay) {
      const hasVisible = isFacilityFilter ? filteredFacilities.length > 0 : visibleItems.length > 0;
      emptyOverlay.classList.toggle('hidden', hasVisible);
      const emptyText = document.getElementById('admin-map-empty-text');
      if (emptyText) {
        emptyText.textContent = isFacilityFilter
          ? 'No matching facilities are currently available.'
          : 'No incident locations are currently available.';
      }
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

    // Render Hospitals and Health Centers on map with consistent red/blue medical pin icons
    if (showFacilities) {
      const hospitalIcon = GeoSafeMapping.createMedicalFacilityIcon('Hospital');
      const healthCenterIcon = GeoSafeMapping.createMedicalFacilityIcon('Health Center');

      filteredFacilities.forEach((fac) => {
        const hLat = Number(fac.latitude);
        const hLng = Number(fac.longitude);
        if (!Number.isFinite(hLat) || !Number.isFinite(hLng)) return;

        const isHospital = fac.facilityType === 'Hospital';
        const isVerified = fac.verificationStatus === 'Verified';
        const iconToUse = isHospital ? hospitalIcon : healthCenterIcon;
        const typeColor = isHospital ? '#DC2626' : '#2563EB';
        const verBadgeCls = isVerified
          ? 'bg-emerald-50 text-[#278653] border-emerald-200'
          : 'bg-amber-50 text-amber-800 border-amber-200';

        const hMarker = L.marker([hLat, hLng], { icon: iconToUse, zIndexOffset: isHospital ? 245 : 235 });
        hMarker.bindTooltip(`${escapeHtml(fac.facilityType)}: ${escapeHtml(fac.name)} (${escapeHtml(fac.verificationStatus)})`, { direction: 'top' });
        hMarker.bindPopup(`
          <div class="p-1.5 text-xs font-sans space-y-1 max-w-[260px]">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-bold uppercase tracking-wider" style="color:${typeColor};">${escapeHtml(fac.facilityType || 'Hospital')}</span>
              <span class="px-1.5 py-0.5 rounded border text-[9px] font-bold ${verBadgeCls}">${escapeHtml(fac.verificationStatus || 'Pending Verification')}</span>
            </div>
            <div class="font-bold text-[#0f172a]">${escapeHtml(fac.name)}</div>
            <div class="text-[11px] text-[#475569]">${escapeHtml(fac.address || 'Address unavailable')}</div>
            <div class="text-[10px] text-[#334155]">
              <strong>Hours:</strong> ${escapeHtml(fac.operatingHours || 'Unverified')} &bull;
              <strong>Status:</strong> ${escapeHtml(fac.status || 'Under Assessment')}
            </div>
            <div class="text-[10px] font-mono text-[#64748b]">${hLat.toFixed(6)}, ${hLng.toFixed(6)}</div>
            ${fac.coordinateFlag ? `<div class="text-[10px] text-amber-800 font-semibold">${escapeHtml(fac.coordinateFlag)}</div>` : ''}
          </div>
        `);
        hMarker.addTo(state.mapLayerGroup);
        bounds.extend([hLat, hLng]);
      });
    }

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
        hospitals: data.hospitals || [],
        eocLocation: data.eocLocation || null,
        recentActivities: data.recentActivities || []
      };
      if (data.eocLocation && window.GeoSafeMapping && typeof window.GeoSafeMapping.setEocLocation === 'function') {
        window.GeoSafeMapping.setEocLocation(data.eocLocation);
      }
      if (state.selectedMapItem) {
        const refreshedItem = state.overview.mapItems.find((m) => m.uid === state.selectedMapItem.uid);
        if (!refreshedItem) {
          closeMapMarkerPanel();
        } else {
          state.selectedMapItem = refreshedItem;
          const mapPanelStatusEl = document.getElementById('map-panel-status');
          if (mapPanelStatusEl) {
            mapPanelStatusEl.innerHTML = getStatusBadgeHtml(refreshedItem.filterBucket, refreshedItem.statusLabel);
          }
        }
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
      loadLiveResponderLocations();
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
      row.className = 'flex items-center justify-between p-2.5 rounded-md border border-slate-200 hover:bg-slate-50 text-xs transition-colors';
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
      tr.className = 'hover:bg-slate-50 transition-colors';
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
          <button type="button" onclick="window.GeoSafeAdmin.openReportDetailModal('${r.recordType}', ${r.id})" class="px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-xs font-bold text-[#202020] transition-colors">
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

  let reportsFetchSeq = 0;

  async function loadReportsList() {
    const reqSeq = ++reportsFetchSeq;
    const loadingEl = document.getElementById('admin-reports-loading');
    const emptyEl = document.getElementById('admin-reports-empty');
    const emptyTextEl = document.getElementById('admin-reports-empty-text');
    const tbody = document.getElementById('admin-reports-tbody');

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (tbody) tbody.innerHTML = '';

    try {
      const params = new URLSearchParams({
        status: state.reports.filters.status,
        filter: state.reports.filters.status,
        type: state.reports.filters.type,
        search: state.reports.filters.search
      });

      const data = await apiRequest(`/reports?${params.toString()}`);
      if (reqSeq !== reportsFetchSeq) return;

      state.reports.items = data.items || data.reports || [];
      state.reports.counts = data.counts || state.reports.counts;
      if (emptyTextEl) {
        emptyTextEl.textContent = 'No reports match the selected filter.';
      }

      renderReportsTable();
    } catch (err) {
      if (reqSeq !== reportsFetchSeq) return;
      console.error('[Admin] loadReportsList failed:', err.message);
      state.reports.items = [];
      renderReportsTable();
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        if (emptyTextEl) {
          emptyTextEl.textContent = err.message || 'Unable to load reports from database.';
        }
      }
    } finally {
      if (reqSeq === reportsFetchSeq && loadingEl) {
        loadingEl.classList.add('hidden');
      }
    }
  }

  let modalLeafletMap = null;
  let modalLeafletMarker = null;

  function formatExactCoordinate(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return '—';
    const fixed8 = n.toFixed(8).replace(/0+$/, '');
    const parts = fixed8.split('.');
    if (!parts[1] || parts[1].length < 6) return n.toFixed(6);
    return fixed8;
  }

  function initOrUpdateModalMap(lat, lng, refText, locText, recordType = 'incident', sourceLabel = '') {
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
      const markerType = recordType === 'rescue' ? 'rescue' : 'incident';
      const modalIcon =
        window.GeoSafeMapping && typeof window.GeoSafeMapping.createCustomIcon === 'function'
          ? window.GeoSafeMapping.createCustomIcon(markerType)
          : null;

      if (!modalLeafletMap) {
        modalLeafletMap = window.GeoSafeMapping.createMap('modal-report-map', {
          center: [numLat, numLng],
          zoom: 17,
          zoomControl: true,
          scrollWheelZoom: false,
          fitBoundary: false
        });

        modalLeafletMarker = modalIcon
          ? L.marker([numLat, numLng], { icon: modalIcon }).addTo(modalLeafletMap)
          : L.marker([numLat, numLng]).addTo(modalLeafletMap);
      } else {
        modalLeafletMap.setView([numLat, numLng], 17, { animate: false });
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
        const latStr = formatExactCoordinate(numLat);
        const lngStr = formatExactCoordinate(numLng);
        modalLeafletMarker.bindPopup(
          `<div class="text-xs space-y-0.5 max-w-[220px]">
            <strong>${escapeHtml(refText || 'Incident')}</strong>
            <span class="block text-[11px] text-[#555555]">${escapeHtml(locText || 'Area address unavailable')}</span>
            <span class="block font-mono text-[10px] text-[#202020]">${latStr}, ${lngStr}</span>
          </div>`,
          { autoPan: true, autoPanPadding: [24, 24] }
        );
      }

      setTimeout(() => {
        if (modalLeafletMap) {
          modalLeafletMap.invalidateSize({ animate: false });
          modalLeafletMap.setView([numLat, numLng], 17, { animate: false });
          if (modalLeafletMarker) modalLeafletMarker.openPopup();
        }
      }, 200);
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
      contentEl.innerHTML = `<video controls autoplay class="max-h-[68vh] w-full rounded-md bg-black">
        <source src="${escapeHtml(fileUrl)}">
        Your browser does not support the video tag.
      </video>`;
    } else {
      contentEl.innerHTML = `<img id="attachment-preview-image" src="${escapeHtml(fileUrl)}" alt="${escapeHtml(fileName)}" class="object-contain rounded-md transition-all duration-150" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'p-8 text-center text-xs text-[#777777]\\'>Photo evidence is unavailable or could not be loaded.</div>';">`;
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
          const peopleDisplay =
            (data.categoryDetails && data.categoryDetails.peopleCountDisplay) ||
            data.peopleCountDisplay ||
            (() => {
              const pCat = (data.categoryDetails && data.categoryDetails.peopleCountCategory) || data.peopleCountCategory;
              if (pCat === 'unknown') return 'Unknown';
              if (pCat === 'more_than_10') return 'More than 10';
              const people = (data.categoryDetails && data.categoryDetails.peopleCount) || data.peopleCount;
              return people ? `${people} person(s)` : 'Unknown';
            })();
          const vul = (data.categoryDetails && data.categoryDetails.vulnerableDetails) || data.vulnerableDetails || 'None specified';
          const lmk = (data.categoryDetails && data.categoryDetails.landmark) || data.landmark || 'None specified';
          document.getElementById('modal-cat-people').textContent = peopleDisplay;
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
        const sourceLabel = data.locationSource === 'gps'
          ? 'GPS'
          : data.locationSource === 'manual'
            ? 'Manual Map Pin'
            : '';
        if (sourceLabel) metaBits.push(sourceLabel);
        if (
          data.gpsAccuracy !== null &&
          data.gpsAccuracy !== undefined &&
          Number.isFinite(Number(data.gpsAccuracy)) &&
          Number(data.gpsAccuracy) > 0
        ) {
          const acc = Math.round(Number(data.gpsAccuracy));
          metaBits.push(acc > 100 ? `+/-${acc}m (Low accuracy)` : `+/-${acc}m`);
        }
        if (data.locationCapturedAt) {
          metaBits.push(`Captured ${formatDateTime(data.locationCapturedAt)}`);
        }
        const metaSuffix = metaBits.length ? ` (${metaBits.join(' | ')})` : '';
        document.getElementById('modal-report-coords').textContent = `${formatExactCoordinate(latVal)}° N, ${formatExactCoordinate(lngVal)}° E${metaSuffix}`;
        initOrUpdateModalMap(latVal, lngVal, data.referenceNumber, locText, data.recordType, sourceLabel);
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

      // Section F2: Rescue Outcome & Optional Transportation (Rescues Only)
      const outcomeSec = document.getElementById('modal-rescue-outcome-section');
      const outcomeBadge = document.getElementById('modal-rescue-outcome-badge');
      const outcomeBody = document.getElementById('modal-rescue-outcome-body');
      const nearbyHospWrap = document.getElementById('modal-nearby-hospitals-wrap');
      if (outcomeSec && outcomeBody) {
        if (recordType !== 'rescue') {
          outcomeSec.classList.add('hidden');
          if (nearbyHospWrap) nearbyHospWrap.innerHTML = '';
        } else {
          outcomeSec.classList.remove('hidden');
          if (nearbyHospWrap) {
            if (Number.isFinite(Number(data.latitude)) && Number.isFinite(Number(data.longitude))) {
              nearbyHospWrap.innerHTML = `<div class="text-[10px] font-bold text-[#777777] uppercase">Nearby Verified Hospitals</div><div class="text-[11px] text-slate-500">Calculating route distances...</div>`;
              apiRequest(`/hospitals/recommendations?lat=${encodeURIComponent(data.latitude)}&lng=${encodeURIComponent(data.longitude)}&category=hospital`, {}, true)
                .then((recData) => {
                  const recs = Array.isArray(recData && recData.recommendations) ? recData.recommendations : [];
                  if (recs.length === 0) {
                    nearbyHospWrap.innerHTML = `<div class="text-[10px] font-bold text-[#777777] uppercase">Nearby Verified Hospitals</div><div class="text-[11px] text-slate-500">No verified hospitals found.</div>`;
                    return;
                  }
                  nearbyHospWrap.innerHTML = `
                    <div class="text-[10px] font-bold text-[#777777] uppercase">Nearby Verified Hospitals (Reference for Coordination)</div>
                    ${recs.slice(0, 4).map((h) => {
                    const distKm = Number.isFinite(Number(h.routeDistanceMeters)) ? `${(Number(h.routeDistanceMeters) / 1000).toFixed(2)} km` : '—';
                    const etaMin = Number.isFinite(Number(h.routeDurationSeconds)) ? ` (~${Math.max(1, Math.round(Number(h.routeDurationSeconds) / 60))} min)` : '';
                    return `
                        <div class="p-2 rounded bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div>
                            <strong class="text-[#0f172a]">${escapeHtml(h.name)}</strong>
                            <span class="block text-[10px] text-slate-500">${escapeHtml(h.address || '')} &bull; Hours: ${escapeHtml(h.operatingHours || 'Unverified')}</span>
                          </div>
                          <span class="text-[11px] font-bold text-[#0A58CA] tabular-nums">${distKm}${etaMin}</span>
                        </div>
                      `;
                  }).join('')}
                  `;
                })
                .catch(() => {
                  nearbyHospWrap.innerHTML = `<div class="text-[10px] font-bold text-[#777777] uppercase">Nearby Verified Hospitals</div><div class="text-[11px] text-[#D93636]">Unable to load nearby hospital route distances.</div>`;
                });
            } else {
              nearbyHospWrap.innerHTML = '';
            }
          }
          const out = data.outcome || null;
          const transports = Array.isArray(data.transports) ? data.transports : [];
          const outcomeNames = {
            first_aid: 'First Aid / On-Site Assistance',
            hospital: 'Transport to Hospital',
            medical_facility: 'Transport to Medical Facility',
            evacuation_center: 'Transport to Evacuation Center',
            other: 'Other / Special Assistance',
          };
          if (outcomeBadge) {
            outcomeBadge.textContent = out ? (outcomeNames[out.primaryOutcome] || out.primaryOutcome) : 'Pending Outcome';
          }
          if (!out && transports.length === 0) {
            outcomeBody.innerHTML = `<p class="text-[11px] text-[#777777]">No rescue outcome or transportation details recorded by responder yet.</p>`;
          } else {
            outcomeBody.innerHTML = `
              ${out ? `
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white p-2.5 rounded border border-slate-200 text-[11px]">
                  <div><span class="text-[#777777] block">Total Rescued</span><strong class="text-[#202020]">${out.totalRescued}</strong></div>
                  <div><span class="text-[#777777] block">First Aid</span><strong class="text-[#202020]">${out.firstAidCount}</strong></div>
                  <div><span class="text-[#777777] block">Transport Required</span><strong class="text-[#202020]">${out.transportRequired ? 'Yes' : 'No (On-Site)'}</strong></div>
                  <div><span class="text-[#777777] block">Still Assisting</span><strong class="text-[#202020]">${out.stillAssistingCount}</strong></div>
                </div>
                ${out.firstAidActions ? `<div class="text-[11px]"><strong>First-Aid Actions:</strong> ${escapeHtml(out.firstAidActions)}</div>` : ''}
                ${out.furtherMedicalRecommended ? `<div class="text-[11px] font-semibold text-amber-800">Further medical evaluation recommended.</div>` : ''}
                ${out.otherDescription ? `<div class="text-[11px]"><strong>Special Assistance:</strong> ${escapeHtml(out.otherDescription)}</div>` : ''}
              ` : ''}
              ${transports.length > 0 ? `
                <div class="space-y-1.5">
                  <div class="text-[10px] font-bold text-[#777777] uppercase">Transport &amp; Handover Legs</div>
                  ${transports.map((t) => `
                    <div class="p-2 rounded bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div>
                        <strong>${escapeHtml(t.destinationName)}</strong>
                        <span class="ml-1 text-[10px] text-[#777777]">(${escapeHtml(t.destinationFacilityType)}, ${t.peopleCount} person(s))</span>
                        ${t.arrivedAt ? `<span class="block text-[10px] text-[#64748b]">Arrived: ${formatDateTime(t.arrivedAt)}</span>` : ''}
                        ${t.handedOverAt ? `<span class="block text-[10px] text-[#278653]">Handed Over: ${formatDateTime(t.handedOverAt)}</span>` : ''}
                      </div>
                      <span class="px-2 py-0.5 rounded text-[10px] font-bold ${t.transportStatus === 'Handed Over' ? 'bg-emerald-50 text-[#278653] border border-emerald-200' : 'bg-blue-50 text-[#0A58CA] border border-blue-200'}">${escapeHtml(t.transportStatus)}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            `;
          }
        }
      }

      // Section F: Photo Evidence (Separated Resident Report Evidence & Responder Completion Evidence)
      const attachEl = document.getElementById('modal-report-attachments');
      const countEl = document.getElementById('modal-report-attachment-count');
      attachEl.innerHTML = '';
      const attachments = data.attachments || [];
      const residentEv = Array.isArray(data.residentEvidence)
        ? data.residentEvidence
        : attachments.filter((a) => !a.evidenceType || a.evidenceType === 'resident_report');
      const completionEv = Array.isArray(data.responderCompletionEvidence)
        ? data.responderCompletionEvidence
        : attachments.filter((a) => a.evidenceType === 'responder_completion');

      if (countEl) {
        countEl.textContent = `${attachments.length} ${attachments.length === 1 ? 'file' : 'files'}`;
      }

      const buildAdminEvidenceGroup = (title, subtitle, items, emptyText, showUploader) => {
        const wrap = document.createElement('div');
        wrap.className = 'space-y-1.5';
        wrap.innerHTML = `
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-[11px] font-bold text-[#202020]">${escapeHtml(title)}</p>
              <p class="text-[10px] text-[#777777]">${escapeHtml(subtitle)}</p>
            </div>
            <span class="text-[10px] font-semibold text-[#777777]">${items.length} ${items.length === 1 ? 'file' : 'files'}</span>
          </div>
        `;

        if (items.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'rounded-md border border-dashed border-slate-200 bg-[#FBFBFA] p-2.5 text-center text-[11px] text-[#777777]';
          empty.textContent = emptyText;
          wrap.appendChild(empty);
          return wrap;
        }

        const grid = document.createElement('div');
        grid.className = 'flex flex-wrap gap-2';
        items.forEach((att, idx) => {
          const fileUrl = att.fileUrl || att.file_url || '';
          const fileName = att.fileName || att.file_name || `Photo Evidence ${idx + 1}`;
          const fileType = att.fileType || att.file_type || 'image/jpeg';
          const isVideo = fileType.includes('video') || /\.(mp4|webm|mov|ogg)$/i.test(fileUrl);
          const timeLabel = formatDateTime(att.createdAt || att.created_at);
          const metaLabel = showUploader && att.uploadedByName ? `${att.uploadedByName} • ${timeLabel}` : timeLabel;

          const card = document.createElement('div');
          card.style.width = '128px';
          card.className = 'group relative rounded-md overflow-hidden border border-slate-200 bg-slate-50 cursor-pointer hover:border-[#F5B900] transition-colors shadow-subtle flex-shrink-0';
          card.title = 'Click to view full size';
          card.onclick = () => openAttachmentPreviewModal(idx, items);

          if (isVideo) {
            card.innerHTML = `
              <div class="flex flex-col items-center justify-center bg-black/5 text-xs font-bold text-[#202020] p-2 text-center" style="height:80px;">
                <span class="p-1.5 rounded-full bg-white shadow mb-1">
                  <svg class="w-3.5 h-3.5 text-[#202020]" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </span>
                <span class="truncate max-w-full text-[10px]">${escapeHtml(fileName)}</span>
              </div>
              <div class="px-1.5 py-1 border-t border-slate-200 bg-white text-[9px] text-[#777777] truncate">${escapeHtml(metaLabel)}</div>
            `;
          } else {
            card.innerHTML = `
              <div class="w-full overflow-hidden bg-[#F7F7F7] flex items-center justify-center" style="height:80px;">
                <img src="${escapeHtml(fileUrl)}" alt="${escapeHtml(fileName)}" class="w-full h-full object-cover transition-transform group-hover:scale-[1.03]" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<div class=\\'p-2 text-[10px] text-center text-[#777777] flex items-center justify-center h-full\\'>Photo unavailable</div>';">
              </div>
              <div class="px-1.5 py-1 border-t border-slate-200 bg-white text-[9px] text-[#777777] truncate">${escapeHtml(metaLabel)}</div>
            `;
          }
          grid.appendChild(card);
        });
        wrap.appendChild(grid);
        return wrap;
      };

      const containerWrap = document.createElement('div');
      containerWrap.className = 'space-y-3';
      containerWrap.appendChild(
        buildAdminEvidenceGroup(
          'Resident Report Evidence',
          'Original photos submitted with the report.',
          residentEv,
          'No resident report photos submitted.',
          false
        )
      );
      containerWrap.appendChild(
        buildAdminEvidenceGroup(
          'Responder Completion Evidence',
          'Photos captured by the assigned Responder on completion.',
          completionEv,
          'No responder completion photos uploaded yet.',
          true
        )
      );
      attachEl.appendChild(containerWrap);

      const rawStLower = String(data.rawStatus || data.status || '').toLowerCase();
      const isAlreadyRejected = ['false_alarm', 'dismissed', 'cancelled'].includes(rawStLower);
      const isAlreadyVerified = recordType === 'rescue'
        ? Boolean(data.verifiedAt || data.isPublic)
        : Boolean(data.verifiedAt || data.isPublic || ['verified', 'dispatched', 'responding', 'on_site', 'in_progress', 'resolved'].includes(rawStLower) || data.hasActiveAssignment);
      const hasAssignedResponder = Boolean(data.assignedTo || data.hasActiveAssignment);
      const isClosedOrRejected = isAlreadyRejected || ['resolved', 'completed', 'cancelled', 'false_alarm', 'dismissed'].includes(rawStLower);

      const verStatusEl = document.getElementById('review-verification-status');
      if (verStatusEl) {
        if (isAlreadyRejected) {
          verStatusEl.textContent = 'Rejected';
          verStatusEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-[#D93636] border border-red-200';
        } else if (isAlreadyVerified) {
          verStatusEl.textContent = 'Verified';
          verStatusEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-[#278653] border border-emerald-200';
        } else {
          verStatusEl.textContent = 'Pending Verification';
          verStatusEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200';
        }
      }

      const assignStatusEl = document.getElementById('review-assignment-status');
      const assignedRespNameEl = document.getElementById('review-assigned-responder-name');
      const assignStatusText = data.assignmentStatus || (hasAssignedResponder ? 'Assigned' : 'Unassigned');
      if (assignStatusEl) {
        assignStatusEl.textContent = assignStatusText;
        assignStatusEl.className = hasAssignedResponder
          ? 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-[#0A58CA] border border-blue-200'
          : 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200';
      }
      if (assignedRespNameEl) {
        assignedRespNameEl.textContent = data.assignedResponderName || 'None';
      }

      const reasonInput = document.getElementById('review-reason-input');
      const notesLockNote = document.getElementById('review-notes-lock-note');
      const isNotesLocked = Boolean(data.reviewNotesLocked);
      if (reasonInput) {
        reasonInput.value = isNotesLocked ? (data.savedReviewNotes || '') : '';
        reasonInput.readOnly = isNotesLocked;
        reasonInput.disabled = isNotesLocked;
      }
      if (notesLockNote) {
        notesLockNote.classList.toggle('hidden', !isNotesLocked);
      }
      const verifyBtn = document.getElementById('review-verify-btn');
      const rejectBtn = document.getElementById('review-reject-btn');

      if (verifyBtn) {
        verifyBtn.disabled = isNotesLocked || isAlreadyVerified || isAlreadyRejected;
        if (isAlreadyVerified) {
          verifyBtn.textContent = 'Verified';
        } else if (isAlreadyRejected) {
          verifyBtn.textContent = 'Rejected';
        } else {
          verifyBtn.textContent = recordType === 'rescue' ? 'Verify Rescue' : 'Verify Report';
        }
      }
      if (rejectBtn) rejectBtn.disabled = isNotesLocked || isAlreadyVerified || isAlreadyRejected;

      const closureInfoEl = document.getElementById('modal-report-closure-info');
      const closeIncidentBtn = document.getElementById('review-close-incident-btn');
      const isClosableIncident =
        recordType === 'incident' &&
        ['verified', 'dispatched', 'responding', 'on_site', 'in_progress'].includes(rawStLower);
      if (closeIncidentBtn) {
        closeIncidentBtn.classList.toggle('hidden', !isClosableIncident);
        closeIncidentBtn.disabled = !isClosableIncident;
      }
      if (closureInfoEl) {
        if (recordType === 'incident' && rawStLower === 'resolved') {
          closureInfoEl.classList.remove('hidden');
          const byEl = document.getElementById('modal-closure-by');
          const atEl = document.getElementById('modal-closure-at');
          const reasonEl = document.getElementById('modal-closure-reason');
          if (byEl) byEl.textContent = data.closedByName || 'Administrator';
          if (atEl) atEl.textContent = data.resolvedAt ? formatDateTime(data.resolvedAt) : 'Recorded';
          if (reasonEl) reasonEl.textContent = data.closureReason || data.savedReviewNotes || 'Closed by Administrator';
        } else {
          closureInfoEl.classList.add('hidden');
        }
      }

      // Section H: Status History (newest first, no nested scrollbar, Show More for lengthy histories)
      const histEl = document.getElementById('modal-report-history');
      histEl.innerHTML = '';
      const history = data.statusHistory || data.history || [];
      if (history.length === 0) {
        histEl.innerHTML = '<span class="text-xs text-[#777777]">No historical state changes recorded.</span>';
      } else {
        const initialLimit = 4;
        let showAllHistory = false;
        const renderHistoryEntries = () => {
          histEl.innerHTML = '';
          const visible = showAllHistory ? history : history.slice(0, initialLimit);
          visible.forEach((h) => {
            const item = document.createElement('div');
            item.className = 'text-xs border-b border-slate-200 pb-2 last:border-b-0';
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
          if (history.length > initialLimit) {
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'mt-1 text-[11px] font-bold text-[#8A6800] hover:underline';
            toggleBtn.textContent = showAllHistory
              ? 'Show Less'
              : `Show More (${history.length - initialLimit} older entries)`;
            toggleBtn.onclick = () => {
              showAllHistory = !showAllHistory;
              renderHistoryEntries();
            };
            histEl.appendChild(toggleBtn);
          }
        };
        renderHistoryEntries();
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

  let isClosingIncident = false;

  function openCloseIncidentModal() {
    const detail = state.reports.activeDetail;
    if (!detail || detail.recordType !== 'incident') return;
    const modal = document.getElementById('admin-close-incident-modal');
    if (!modal) return;

    const refEl = document.getElementById('close-incident-modal-ref');
    const titleEl = document.getElementById('close-incident-modal-title');
    const presetEl = document.getElementById('close-incident-preset-select');
    const reasonEl = document.getElementById('close-incident-reason-input');
    const reqStarEl = document.getElementById('close-incident-reason-req');
    const errEl = document.getElementById('close-incident-modal-error');

    if (refEl) refEl.textContent = detail.referenceNumber || `INC-${detail.id}`;
    if (titleEl) titleEl.textContent = detail.title || detail.category || 'Verified Incident';
    if (presetEl) presetEl.value = '';
    if (reasonEl) reasonEl.value = '';
    if (reqStarEl) reqStarEl.classList.add('hidden');
    if (errEl) errEl.classList.add('hidden');
    modal.classList.remove('hidden');
  }

  function closeCloseIncidentModal() {
    document.getElementById('admin-close-incident-modal')?.classList.add('hidden');
  }

  function handleCloseIncidentPresetChange() {
    const presetEl = document.getElementById('close-incident-preset-select');
    const reasonEl = document.getElementById('close-incident-reason-input');
    const reqStarEl = document.getElementById('close-incident-reason-req');
    const errEl = document.getElementById('close-incident-modal-error');
    if (errEl) errEl.classList.add('hidden');
    if (!presetEl || !reasonEl) return;

    const val = presetEl.value;
    if (val === 'Other') {
      reasonEl.value = '';
      reasonEl.focus();
      if (reqStarEl) reqStarEl.classList.remove('hidden');
    } else if (val) {
      reasonEl.value = val;
      if (reqStarEl) reqStarEl.classList.add('hidden');
    } else {
      reasonEl.value = '';
      if (reqStarEl) reqStarEl.classList.add('hidden');
    }
  }

  async function confirmCloseIncident() {
    const detail = state.reports.activeDetail;
    if (!detail || detail.recordType !== 'incident' || isClosingIncident) return;

    const presetEl = document.getElementById('close-incident-preset-select');
    const reasonEl = document.getElementById('close-incident-reason-input');
    const errEl = document.getElementById('close-incident-modal-error');
    const confirmBtn = document.getElementById('close-incident-confirm-btn');

    if (errEl) errEl.classList.add('hidden');

    const presetVal = presetEl ? presetEl.value : '';
    const typedVal = reasonEl ? reasonEl.value.trim() : '';
    const finalReason = presetVal === 'Other' ? typedVal : (typedVal || presetVal);

    if (!finalReason || finalReason.toLowerCase() === 'other') {
      const msg = presetVal === 'Other'
        ? 'Please write an explanation for closing this incident.'
        : 'Please select or enter a closure reason.';
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      }
      if (window.GeoSafeToast?.flagInvalidField) {
        window.GeoSafeToast.flagInvalidField(presetVal === 'Other' ? reasonEl : (presetEl || reasonEl), msg);
      }
      return;
    }

    isClosingIncident = true;
    const prevText = confirmBtn ? confirmBtn.textContent : 'Confirm Close Incident';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Closing...';
    }

    try {
      const res = await window.geoSafeStore.request(
        `/admin/reports/incident/${encodeURIComponent(detail.id)}/close`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: finalReason }),
        }
      );
      closeCloseIncidentModal();
      window.GeoSafeToast?.show?.({
        message: res?.message || `Incident ${detail.referenceNumber || ''} closed successfully.`,
        type: 'success',
      });
      await Promise.all([
        loadReportsList(),
        loadDashboardOverview(),
        openReportDetailModal('incident', detail.id),
      ]);
    } catch (err) {
      const msg = err?.message || 'Unable to close incident report.';
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      }
      window.GeoSafeToast?.show?.({ message: msg, type: 'error' });
    } finally {
      isClosingIncident = false;
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = prevText;
      }
    }
  }

  let isReviewSubmitting = false;

  async function submitReportReviewAction(actionType) {
    if (!state.reports.activeDetail || isReviewSubmitting) return;
    const errEl = document.getElementById('review-form-error');
    if (errEl) errEl.classList.add('hidden');

    const detail = state.reports.activeDetail;
    const reasonInput = document.getElementById('review-reason-input');
    const verifyBtn = document.getElementById('review-verify-btn');
    const rejectBtn = document.getElementById('review-reject-btn');
    const respVal = detail.assignedTo ? String(detail.assignedTo) : '';
    const reasonVal = detail.reviewNotesLocked ? '' : (reasonInput?.value.trim() || '');

    if (detail.reviewNotesLocked) {
      if (errEl) {
        errEl.textContent = 'Operation completed – review notes and status cannot be modified.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if ((actionType === 'reject' || actionType === 'clarify') && !reasonVal) {
      const msg = 'An administrative reason is required when rejecting or requesting clarification.';
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      }
      window.GeoSafeToast?.flagInvalidField?.(reasonInput, msg);
      return;
    }

    isReviewSubmitting = true;
    const prevVerifyText = verifyBtn ? verifyBtn.textContent : '';
    const prevRejectText = rejectBtn ? rejectBtn.textContent : '';
    const prevVerifyDisabled = verifyBtn ? verifyBtn.disabled : false;
    const prevRejectDisabled = rejectBtn ? rejectBtn.disabled : false;

    if (verifyBtn) {
      verifyBtn.disabled = true;
      if (actionType === 'verify') verifyBtn.textContent = 'Processing...';
    }
    if (rejectBtn) {
      rejectBtn.disabled = true;
      if (actionType === 'reject') rejectBtn.textContent = 'Processing...';
    }

    try {
      const payload = {
        action: actionType,
        status: detail.rawStatus || detail.status,
        reason: reasonVal
      };

      const result = await apiRequest(`/reports/${detail.recordType}/${detail.id}/review`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });

      showBannerMessage(result.message || 'Report verification updated.');
      await openReportModal(detail.recordType, detail.dbId || detail.id);
      loadReportsList();
      loadDashboardOverview();
    } catch (err) {
      const msg = String((err && err.message) || '');
      const alreadyDone = /already been verified|already been rejected|already completed|locked/i.test(msg);
      if (verifyBtn) {
        if (alreadyDone) {
          verifyBtn.disabled = true;
          verifyBtn.textContent = /rejected/i.test(msg) ? 'Rejected' : 'Verified';
        } else {
          verifyBtn.disabled = prevVerifyDisabled;
          verifyBtn.textContent = prevVerifyText;
        }
      }
      if (rejectBtn) {
        rejectBtn.disabled = alreadyDone ? true : prevRejectDisabled;
        rejectBtn.textContent = prevRejectText;
      }
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      }
    } finally {
      isReviewSubmitting = false;
    }
  }

  let isAssignSubmitting = false;
  async function assignResponderFromModal() {
    if (!state.reports.activeDetail || isAssignSubmitting) return;
    const detail = state.reports.activeDetail;
    const errEl = document.getElementById('review-form-error');
    if (errEl) errEl.classList.add('hidden');

    const respSelect = document.getElementById('review-responder-select');
    const reasonInput = document.getElementById('review-reason-input');
    const assignBtn = document.getElementById('review-assign-btn');
    const respVal = respSelect ? respSelect.value : '';

    if (!respVal) {
      const msg = 'Please select an eligible Responder to assign.';
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      }
      window.GeoSafeToast?.flagInvalidField?.(respSelect, msg);
      return;
    }

    isAssignSubmitting = true;
    const prevText = assignBtn ? assignBtn.textContent : 'Assign Responder';
    if (assignBtn) {
      assignBtn.disabled = true;
      assignBtn.textContent = 'Assigning...';
    }

    try {
      const result = await apiRequest('/responders/assign', {
        method: 'POST',
        body: JSON.stringify({
          type: detail.recordType,
          targetId: detail.dbId || detail.id,
          responderUserId: Number(respVal),
          dispatchInstructions: reasonInput?.value.trim() || null
        })
      });

      showBannerMessage(result.message || 'Responder assigned successfully.');
      await openReportModal(detail.recordType, detail.dbId || detail.id);
      loadReportsList();
      loadDashboardOverview();
    } catch (err) {
      if (errEl) {
        errEl.textContent = (err && err.message) || 'Failed to assign responder.';
        errEl.classList.remove('hidden');
      }
      if (assignBtn) {
        assignBtn.disabled = false;
        assignBtn.textContent = prevText;
      }
    } finally {
      isAssignSubmitting = false;
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
        tr.className = 'hover:bg-slate-50 transition-colors';
        const status = r.availabilityStatus === 'Unavailable' ? 'On Break' : (r.availabilityStatus || 'Off Duty');
        const dutyBadgeMap = {
          'On Duty': '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">On Duty</span>',
          'On Break': '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">On Break</span>',
          'Off Duty': '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Off Duty</span>',
        };
        const dutyBadge = dutyBadgeMap[status] || dutyBadgeMap['Off Duty'];

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
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
              Self-Claim Enabled
            </span>
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

  function formatProximityDistance(meters) {
    if (!Number.isFinite(Number(meters))) return 'Distance unavailable';
    const m = Math.round(Number(meters));
    return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`;
  }

  let assignRecommendationSeq = 0;

  async function loadAssignProximityRecommendations(defaultResponderId = null) {
    const targetSelect = document.getElementById('assign-target-select');
    const respSelect = document.getElementById('assign-responder-select');
    const listEl = document.getElementById('assign-proximity-list');
    const excludedEl = document.getElementById('assign-proximity-excluded');
    if (!targetSelect || !respSelect) return;

    const targetVal = targetSelect.value;
    if (!targetVal || !targetVal.includes(':')) {
      respSelect.innerHTML = '<option value="">Select a target operation first</option>';
      if (listEl) listEl.innerHTML = '<p class="text-[11px] text-[#777777]">Select an operation to view nearby eligible responders.</p>';
      if (excludedEl) excludedEl.textContent = '';
      return;
    }

    const [type, targetId] = targetVal.split(':');
    const seq = ++assignRecommendationSeq;
    respSelect.innerHTML = '<option value="">Calculating proximity...</option>';
    if (listEl) listEl.innerHTML = '<p class="text-[11px] text-[#777777]">Checking live GPS &amp; responder eligibility...</p>';

    try {
      const recData = await apiRequest(`/responders/recommendations?type=${encodeURIComponent(type)}&targetId=${encodeURIComponent(targetId)}`);
      if (seq !== assignRecommendationSeq) return;

      const candidates = Array.isArray(recData && recData.candidates) ? recData.candidates : [];
      const targetCoords = recData && recData.target && recData.target.coordinates ? recData.target.coordinates : null;
      const ex = (recData && recData.excludedSummary) || {};

      if (excludedEl) {
        const parts = [];
        if (ex.alreadyAssigned) parts.push(`${ex.alreadyAssigned} Assigned`);
        if (ex.offDuty) parts.push(`${ex.offDuty} Off Duty`);
        if (ex.unavailable) parts.push(`${ex.unavailable} Unavailable`);
        excludedEl.textContent = parts.length ? `Excluded: ${parts.join(', ')}` : '';
      }

      respSelect.innerHTML = '';
      if (candidates.length === 0) {
        respSelect.innerHTML = '<option value="">No eligible On-Duty responders available</option>';
        if (listEl) {
          listEl.innerHTML = '<p class="text-[11px] text-[#D93636] font-semibold p-2 rounded-md bg-[#FFF1F1] border border-[#FFC2C2]">No eligible On-Duty responders are currently available for dispatch.</p>';
        }
        return;
      }

      candidates.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        const distTag = c.straightLineMeters !== null
          ? ` — ${formatProximityDistance(c.straightLineMeters)} (${c.isStale ? 'Stale GPS' : 'Live GPS'})`
          : ' — No GPS';
        opt.textContent = `${c.fullName} (${c.responderId || c.badgeNumber})${distTag}`;
        if (defaultResponderId && Number(c.id) === Number(defaultResponderId)) {
          opt.selected = true;
        }
        respSelect.appendChild(opt);
      });

      // Compute real OSRM road distance & ETA for top 3 GPS-enabled candidates when target has coordinates
      if (targetCoords && window.GeoSafeMapping && typeof window.GeoSafeMapping.calculateRoute === 'function') {
        const topGps = candidates.filter((c) => c.hasValidGps).slice(0, 3);
        await Promise.all(topGps.map(async (c) => {
          try {
            const route = await window.GeoSafeMapping.calculateRoute(
              { lat: c.lat, lng: c.lng },
              { lat: targetCoords.lat, lng: targetCoords.lng },
              'driving'
            );
            if (route && Number.isFinite(Number(route.distanceMeters))) {
              c.roadDistanceMeters = Math.round(Number(route.distanceMeters));
              c.roadDurationMinutes = Math.max(1, Math.round(Number(route.durationSeconds || 0) / 60));
            }
          } catch (_) {
            // Routing provider fallback: retain straight-line distance only
          }
        }));
        if (seq !== assignRecommendationSeq) return;
      }

      if (listEl) {
        listEl.innerHTML = candidates.map((c, idx) => {
          const isSelected = Number(respSelect.value) === Number(c.id);
          const gpsBadge = !c.hasValidGps
            ? '<span class="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200">No GPS</span>'
            : (c.isStale
              ? '<span class="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-50 text-[#8A6800] border border-[#FFE872]">Stale GPS</span>'
              : '<span class="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-[#278653] border border-emerald-200">Live GPS</span>');

          const straightText = c.straightLineMeters !== null
            ? `Direct: ${formatProximityDistance(c.straightLineMeters)}`
            : 'Direct: —';
          const roadText = Number.isFinite(c.roadDistanceMeters)
            ? ` • Road: ${formatProximityDistance(c.roadDistanceMeters)} (~${c.roadDurationMinutes} min)`
            : '';
          const accText = Number.isFinite(Number(c.accuracy)) ? ` • ±${Math.round(c.accuracy)}m` : '';
          const timeText = c.lastLocationUpdate ? ` • ${new Date(c.lastLocationUpdate).toLocaleTimeString()}` : '';

          return `
            <button type="button" data-rec-resp-id="${c.id}"
              class="w-full text-left p-2 rounded-md border transition-colors ${isSelected ? 'border-[#F5B900] bg-slate-50' : 'border-slate-200 bg-slate-50 hover:border-[#F5B900]/70'}">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-bold text-[#202020] truncate">${idx === 0 && c.hasValidGps ? 'Nearest • ' : ''}${escapeHtml(c.fullName)}</span>
                ${gpsBadge}
              </div>
              <div class="text-[10px] text-[#555555] truncate">${escapeHtml(c.responderId || c.badgeNumber)} • ${escapeHtml(c.organization || c.assignedUnit)}</div>
              <div class="text-[10px] text-[#777777] font-mono mt-0.5">${straightText}${roadText}${accText}${timeText}</div>
            </button>
          `;
        }).join('');

        listEl.querySelectorAll('[data-rec-resp-id]').forEach((btn) => {
          btn.addEventListener('click', () => {
            respSelect.value = btn.getAttribute('data-rec-resp-id');
            listEl.querySelectorAll('[data-rec-resp-id]').forEach((b) => {
              const active = b.getAttribute('data-rec-resp-id') === respSelect.value;
              b.className = `w-full text-left p-2 rounded-md border transition-colors ${active ? 'border-[#F5B900] bg-slate-50' : 'border-slate-200 bg-slate-50 hover:border-[#F5B900]/70'}`;
            });
          });
        });
      }
    } catch (err) {
      console.warn('[Admin] Proximity recommendations failed:', err.message);
      respSelect.innerHTML = '<option value="">Unable to load eligible responders</option>';
      if (listEl) listEl.innerHTML = `<p class="text-[11px] text-[#D93636]">${escapeHtml(err.message || 'Unable to load proximity recommendations.')}</p>`;
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
    respSelect.innerHTML = '<option value="">Loading eligible responders...</option>';

    try {
      // 1. Fetch open, unassigned operations (exclude already-assigned, in-progress, resolved, or rejected items)
      const reportsData = await apiRequest('/reports?filter=all');
      targetSelect.innerHTML = '';
      const allItems = reportsData.items || reportsData.reports || [];
      const items = allItems.filter((item) => {
        if (item.assignedTo || item.hasActiveAssignment) return false;
        const isExplicitTarget =
          defaultTargetId &&
          Number(item.id) === Number(defaultTargetId) &&
          (!defaultType || item.recordType === defaultType);
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

      targetSelect.onchange = () => loadAssignProximityRecommendations(null);
      await loadAssignProximityRecommendations(defaultResponderId);
    } catch (err) {
      console.error('[Admin] openAssignResponderModal failed:', err.message);
      targetSelect.innerHTML = '<option value="">Unable to load operations</option>';
      respSelect.innerHTML = '<option value="">Unable to load responders</option>';
      if (errEl) {
        errEl.textContent = err.message || 'Unable to populate dispatch choices.';
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
      const msg = !targetVal ? 'Please select a target operation before continuing.' : 'Please select a Responder before continuing.';
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      }
      window.GeoSafeToast?.flagInvalidField?.(
        document.getElementById(!targetVal ? 'assign-target-select' : 'assign-responder-select'),
        msg
      );
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
      tr.className = 'hover:bg-slate-50 transition-colors';
      const userRole = u.role || u.roleName || 'Resident';
      const roleUnit = u.badgeNumber ? `${userRole} (${u.badgeNumber})` : userRole;
      const displayId = u.userCode || u.userId || u.user_code || (u.id ? `USR-${String(u.id).padStart(5, '0')}` : '—');
      const locMethodLabel = u.locationVerificationMethod === 'manual_admin' ? 'Admin Review' : '';

      tr.innerHTML = `
        <td class="px-4 py-3 text-xs font-mono font-bold text-[#202020] whitespace-nowrap">
          <span class="bg-slate-50 px-2 py-0.5 rounded-md border border-[#FFE872] text-[11px] font-bold">${escapeHtml(displayId)}</span>
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
            ${locMethodLabel ? `<span class="text-[10px] text-[#777777]">${escapeHtml(locMethodLabel)}</span>` : ''}
          </div>
        </td>
        ` : ''}
        <td class="px-4 py-3 text-xs text-[#777777] whitespace-nowrap">
          ${formatShortDate(u.registeredAt)}
        </td>
        <td class="px-4 py-3 text-xs text-right whitespace-nowrap space-x-1.5">
          <button type="button" onclick="window.GeoSafeAdmin.openUserStatusModal(${u.id}, '${escapeHtml(u.name)}', '${escapeHtml(u.email)}', '${u.status}', '${escapeHtml(displayId)}', '${escapeHtml(u.role || '')}')" class="px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-xs font-bold text-[#202020] transition-colors">
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

  let userDocObjectUrls = { id: null, selfie: null };
  let userDocLoadToken = 0;

  function revokeUserDocObjectUrls() {
    ['id', 'selfie'].forEach((slot) => {
      if (userDocObjectUrls[slot]) {
        try {
          URL.revokeObjectURL(userDocObjectUrls[slot]);
        } catch (_) {}
        userDocObjectUrls[slot] = null;
      }
      const img = document.getElementById(`user-doc-${slot}-img`);
      if (img) {
        img.removeAttribute('src');
        img.classList.add('hidden');
      }
      const enlargeBtn = document.getElementById(`user-doc-${slot}-enlarge-btn`);
      if (enlargeBtn) enlargeBtn.classList.add('hidden');
    });
  }

  function setUserDocSlotState(slot, mode, message = '') {
    const loadingEl = document.getElementById(`user-doc-${slot}-loading`);
    const imgEl = document.getElementById(`user-doc-${slot}-img`);
    const unavailableEl = document.getElementById(`user-doc-${slot}-unavailable`);
    const enlargeBtn = document.getElementById(`user-doc-${slot}-enlarge-btn`);

    if (loadingEl) loadingEl.classList.toggle('hidden', mode !== 'loading');
    if (imgEl) imgEl.classList.toggle('hidden', mode !== 'ready');
    if (unavailableEl) {
      unavailableEl.classList.toggle('hidden', mode !== 'unavailable');
      if (mode === 'unavailable' && message) {
        unavailableEl.textContent = message;
      }
    }
    if (enlargeBtn) enlargeBtn.classList.toggle('hidden', mode !== 'ready');
  }

  async function fetchProtectedIdentityDocBlob(userId, slot) {
    const baseUrl = window.geoSafeStore?.config?.API_BASE_URL || '/api';
    const resp = await fetch(`${baseUrl}/admin/users/${userId}/identity-documents/${slot}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  }

  async function loadUserIdentityDocuments(userId) {
    const token = ++userDocLoadToken;
    const submittedEl = document.getElementById('user-modal-docs-submitted-at');
    if (submittedEl) submittedEl.textContent = 'Checking documents...';

    revokeUserDocObjectUrls();
    setUserDocSlotState('id', 'loading');
    setUserDocSlotState('selfie', 'loading');

    try {
      const meta = await apiRequest(`/users/${userId}/identity-documents`);
      if (token !== userDocLoadToken) return;

      if (submittedEl) {
        submittedEl.textContent = meta.submittedAt
          ? `Submitted: ${new Date(meta.submittedAt).toLocaleString()}`
          : 'No submission timestamp';
      }
      renderResidentLocationVerification(meta.registeredAddress, meta.locationVerification);

      const slots = [
        { key: 'id', available: Boolean(meta.hasIdPhoto) },
        { key: 'selfie', available: Boolean(meta.hasSelfiePhoto) },
      ];

      await Promise.all(
        slots.map(async ({ key, available }) => {
          if (!available) {
            setUserDocSlotState(key, 'unavailable', 'Document unavailable — no photo on file');
            return;
          }
          try {
            const objectUrl = await fetchProtectedIdentityDocBlob(userId, key);
            if (token !== userDocLoadToken) {
              URL.revokeObjectURL(objectUrl);
              return;
            }
            userDocObjectUrls[key] = objectUrl;
            const imgEl = document.getElementById(`user-doc-${key}-img`);
            if (imgEl) imgEl.src = objectUrl;
            setUserDocSlotState(key, 'ready');
          } catch (_) {
            if (token === userDocLoadToken) {
              setUserDocSlotState(key, 'unavailable', 'Document unavailable — unable to load');
            }
          }
        })
      );
    } catch (_) {
      if (token !== userDocLoadToken) return;
      if (submittedEl) submittedEl.textContent = '';
      setUserDocSlotState('id', 'unavailable', 'Document unavailable');
      setUserDocSlotState('selfie', 'unavailable', 'Document unavailable');
    }
  }

  function applyLocationBadge(status) {
    const badge = document.getElementById('user-loc-status-badge');
    if (!badge) return;
    if (status === 'verified') {
      badge.textContent = 'Verified';
      badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded uppercase bg-emerald-100 text-emerald-800';
    } else if (status === 'unable_to_verify') {
      badge.textContent = 'Unable to Verify';
      badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded uppercase bg-amber-100 text-amber-800';
    } else {
      badge.textContent = 'Not Reviewed';
      badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded uppercase bg-slate-200 text-slate-700';
    }
  }

  function handleLocationStatusSelectChange() {
    const selectEl = document.getElementById('user-loc-status-select');
    const labelEl = document.getElementById('user-loc-remarks-label');
    const errEl = document.getElementById('user-loc-error');
    if (errEl) errEl.classList.add('hidden');
    if (!selectEl || !labelEl) return;
    if (selectEl.value === 'unable_to_verify') {
      labelEl.textContent = 'Reason / Administrator Remarks (Required for Unable to Verify)';
    } else {
      labelEl.textContent = 'Administrator Remarks (Optional)';
    }
  }

  let savedLocationState = {
    isSaved: false,
    status: 'not_reviewed',
    remarks: '',
    verifiedAt: null,
    verifiedByName: null,
  };
  let isLocationSaveInFlight = false;

  function applyLocationLockUI({ locked = false, editing = false, justSaved = false } = {}) {
    const selectEl = document.getElementById('user-loc-status-select');
    const remarksEl = document.getElementById('user-loc-remarks');
    const saveBtn = document.getElementById('user-loc-save-btn');
    const editBtn = document.getElementById('user-loc-edit-btn');
    const cancelBtn = document.getElementById('user-loc-cancel-edit-btn');
    const successEl = document.getElementById('user-loc-success');

    if (selectEl) selectEl.disabled = locked;
    if (remarksEl) remarksEl.disabled = locked;
    if (saveBtn) {
      saveBtn.disabled = locked;
      saveBtn.textContent = editing ? 'Save Changes' : 'Save Location Verification';
    }
    if (editBtn) editBtn.classList.toggle('hidden', !locked);
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !editing);

    if (successEl) {
      if (locked && (justSaved || savedLocationState.isSaved)) {
        successEl.textContent = 'Location Verification Saved';
        successEl.classList.remove('hidden');
      } else {
        successEl.classList.add('hidden');
      }
    }
  }

  function enterLocationVerificationEditMode() {
    const errEl = document.getElementById('user-loc-error');
    if (errEl) errEl.classList.add('hidden');
    applyLocationLockUI({ locked: false, editing: true, justSaved: false });
  }

  function cancelLocationVerificationEdit() {
    const selectEl = document.getElementById('user-loc-status-select');
    const remarksEl = document.getElementById('user-loc-remarks');
    const errEl = document.getElementById('user-loc-error');
    if (errEl) errEl.classList.add('hidden');

    if (selectEl) selectEl.value = savedLocationState.status;
    if (remarksEl) remarksEl.value = savedLocationState.remarks;
    applyLocationBadge(savedLocationState.status);
    handleLocationStatusSelectChange();
    applyLocationLockUI({ locked: savedLocationState.isSaved, editing: false, justSaved: false });
  }

  function renderResidentLocationVerification(address, loc) {
    const streetEl = document.getElementById('user-loc-street');
    const brgyEl = document.getElementById('user-loc-barangay');
    const cityEl = document.getElementById('user-loc-city');
    const selectEl = document.getElementById('user-loc-status-select');
    const remarksEl = document.getElementById('user-loc-remarks');
    const metaEl = document.getElementById('user-loc-reviewed-meta');
    const errEl = document.getElementById('user-loc-error');

    if (errEl) errEl.classList.add('hidden');

    if (streetEl) streetEl.textContent = (address && address.streetAddress) ? address.streetAddress : 'Not provided';
    if (brgyEl) brgyEl.textContent = (address && address.barangay) ? address.barangay : 'Not provided';
    if (cityEl) cityEl.textContent = (address && address.city) ? address.city : 'Not provided';

    const uiStatus = (loc && loc.status) ? loc.status : 'not_reviewed';
    const remarks = (loc && loc.remarks) ? loc.remarks : '';
    const isSaved = Boolean(loc && loc.verifiedAt);

    savedLocationState = {
      isSaved,
      status: uiStatus,
      remarks,
      verifiedAt: loc ? loc.verifiedAt : null,
      verifiedByName: loc ? loc.verifiedByName : null,
    };

    applyLocationBadge(uiStatus);
    if (selectEl) selectEl.value = uiStatus;
    if (remarksEl) remarksEl.value = remarks;
    handleLocationStatusSelectChange();

    if (metaEl) {
      if (loc && loc.verifiedAt) {
        const who = loc.verifiedByName ? ` by ${loc.verifiedByName}` : '';
        metaEl.textContent = `Last reviewed${who} on ${new Date(loc.verifiedAt).toLocaleString()}`;
        metaEl.classList.remove('hidden');
      } else {
        metaEl.textContent = '';
        metaEl.classList.add('hidden');
      }
    }

    applyLocationLockUI({ locked: isSaved, editing: false, justSaved: false });
  }

  async function submitUserLocationVerification() {
    if (!state.users.selectedUser || isLocationSaveInFlight) return;
    const errEl = document.getElementById('user-loc-error');
    const successEl = document.getElementById('user-loc-success');
    const selectEl = document.getElementById('user-loc-status-select');
    const remarksEl = document.getElementById('user-loc-remarks');

    if (errEl) errEl.classList.add('hidden');
    if (successEl) successEl.classList.add('hidden');

    const status = selectEl ? selectEl.value : 'not_reviewed';
    const remarks = remarksEl ? remarksEl.value.trim() : '';

    if (status === 'unable_to_verify' && (!remarks || remarks.length < 3)) {
      const msg = 'Please provide a reason (at least 3 characters) when selecting Unable to Verify.';
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      }
      window.GeoSafeToast?.flagInvalidField?.(remarksEl, msg);
      return;
    }

    isLocationSaveInFlight = true;
    try {
      const result = await apiRequest(`/users/${state.users.selectedUser.id}/location-verification`, {
        method: 'POST',
        body: JSON.stringify({ status, remarks, isEdit: savedLocationState.isSaved }),
      });

      const resData = result.resident || {};
      const nextStatus = resData.locationVerificationUiStatus || status;
      const nextRemarks = resData.locationReviewReason !== undefined ? resData.locationReviewReason : remarks;
      const verifiedAt = resData.locationVerifiedAt || new Date().toISOString();
      const verifiedByName = resData.locationVerifiedByName || null;

      savedLocationState = {
        isSaved: true,
        status: nextStatus,
        remarks: nextRemarks,
        verifiedAt,
        verifiedByName,
      };

      applyLocationBadge(nextStatus);
      if (selectEl) selectEl.value = nextStatus;
      if (remarksEl) remarksEl.value = nextRemarks;
      handleLocationStatusSelectChange();

      const metaEl = document.getElementById('user-loc-reviewed-meta');
      if (metaEl && verifiedAt) {
        const who = verifiedByName ? ` by ${verifiedByName}` : '';
        metaEl.textContent = `Last reviewed${who} on ${new Date(verifiedAt).toLocaleString()}`;
        metaEl.classList.remove('hidden');
      }

      applyLocationLockUI({ locked: true, editing: false, justSaved: true });
      loadUsersList();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Unable to save location verification.';
        errEl.classList.remove('hidden');
      }
    } finally {
      isLocationSaveInFlight = false;
    }
  }

  function openUserDocLightbox(slot) {
    const objectUrl = userDocObjectUrls[slot];
    const modal = document.getElementById('user-doc-lightbox-modal');
    const img = document.getElementById('user-doc-lightbox-img');
    const title = document.getElementById('user-doc-lightbox-title');
    if (!objectUrl || !modal || !img) return;

    if (title) {
      title.textContent = slot === 'selfie' ? 'Selfie Holding the Same ID' : 'Barangay Address ID Photo';
    }
    img.src = objectUrl;
    modal.classList.remove('hidden');
  }

  function closeUserDocLightbox() {
    const modal = document.getElementById('user-doc-lightbox-modal');
    const img = document.getElementById('user-doc-lightbox-img');
    if (modal) modal.classList.add('hidden');
    if (img) img.removeAttribute('src');
  }

  function openUserStatusModal(id, name, email, currentStatus, userCode, userRole = '') {
    state.users.selectedUser = { id, name, email, currentStatus, userCode, userRole };
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

    const docsWrap = document.getElementById('user-modal-identity-docs');
    const locWrap = document.getElementById('user-modal-location-verification');
    const isResident =
      String(userRole || '').trim().toLowerCase() === 'resident' ||
      String(userCode || '').trim().toUpperCase().startsWith('RSDNT');
    if (docsWrap) {
      docsWrap.classList.toggle('hidden', !isResident);
    }
    if (locWrap) {
      locWrap.classList.toggle('hidden', !isResident);
    }
    if (isResident) {
      renderResidentLocationVerification(null, null);
      loadUserIdentityDocuments(id);
    } else {
      userDocLoadToken++;
      revokeUserDocObjectUrls();
    }

    modal.classList.remove('hidden');
  }

  function closeUserStatusModal() {
    closeUserDocLightbox();
    userDocLoadToken++;
    revokeUserDocObjectUrls();
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
      const msg = 'A reason is required when suspending or deactivating an account.';
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
      window.GeoSafeToast?.flagInvalidField?.(document.getElementById('user-modal-reason'), msg);
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
  function formatManilaDateTime(dateInput) {
    if (!dateInput) return '—';
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-PH', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  function toManilaDatetimeLocalValue(dateInput) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const hour = map.hour === '24' ? '00' : map.hour;
    return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
  }

  function parseManilaLocalInput(val) {
    const str = String(val || '').trim();
    if (!str) return null;
    const normalized = str.length === 16 ? `${str}:00+08:00` : `${str}+08:00`;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatRemainingDuration(expiresAt) {
    if (!expiresAt) return '';
    const diffMs = new Date(expiresAt).getTime() - Date.now();
    if (Number.isNaN(diffMs) || diffMs <= 0) return 'Expiring...';
    const totalMins = Math.ceil(diffMs / 60000);
    if (totalMins < 60) return `${totalMins}m left`;
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
  }

  function getSelectedBroadcastHours() {
    const selectEl = document.getElementById('broadcast-expiration-select');
    const customInput = document.getElementById('broadcast-custom-hours-input');
    if (!selectEl) return { valid: true, hours: 12, isCustom: false };

    const val = selectEl.value;
    if (val === 'custom') {
      const raw = customInput ? customInput.value.trim() : '';
      const num = Number(raw);
      if (!raw || !Number.isFinite(num) || !Number.isInteger(num) || num < 1 || num > 168) {
        return { valid: false, hours: null, isCustom: true };
      }
      return { valid: true, hours: num, isCustom: true };
    }
    const num = Number(val);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1 || num > 168) {
      return { valid: false, hours: null, isCustom: false };
    }
    return { valid: true, hours: num, isCustom: false };
  }

  function updateBroadcastExpirationPreview() {
    const previewEl = document.getElementById('broadcast-expiration-preview-time');
    if (!previewEl) return;
    const sel = getSelectedBroadcastHours();
    if (!sel.valid) {
      previewEl.textContent = sel.isCustom ? 'Enter 1–168 hours' : '--';
      return;
    }
    const target = new Date(Date.now() + sel.hours * 60 * 60 * 1000);
    const label = `${sel.hours} ${sel.hours === 1 ? 'hour' : 'hours'}`;
    previewEl.textContent = `${label} (~${formatManilaDateTime(target)} Asia/Manila)`;
  }

  function handleExpirationDurationChange() {
    const selectEl = document.getElementById('broadcast-expiration-select');
    const customWrap = document.getElementById('broadcast-custom-expiration-wrap');
    const customInput = document.getElementById('broadcast-custom-hours-input');
    if (selectEl && customWrap) {
      const isCustom = selectEl.value === 'custom';
      customWrap.classList.toggle('hidden', !isCustom);
      if (customInput) {
        customInput.required = isCustom;
        if (!isCustom) customInput.value = '';
      }
    }
    updateBroadcastExpirationPreview();
  }

  function renderUrgencyBadge(urgency) {
    const level = String(urgency || 'Advisory').trim();
    const styles = {
      Informational: 'bg-sky-50 text-sky-700 border-sky-200',
      Advisory: 'bg-amber-50 text-amber-700 border-amber-200',
      Warning: 'bg-orange-50 text-orange-700 border-orange-200',
      Critical: 'bg-[#FFF1F1] text-[#D93636] border-[#FFC2C2]',
    };
    const cls = styles[level] || styles.Advisory;
    return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold border ${cls}">${escapeHtml(level)}</span>`;
  }

  function handleBroadcastSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById('broadcast-form-error');
    if (errEl) errEl.classList.add('hidden');

    const catSelect = document.getElementById('broadcast-advisory-type-select');
    const selectedOpt = catSelect && catSelect.selectedOptions ? catSelect.selectedOptions[0] : null;
    const categoryId = (catSelect?.value || '').trim();
    const categoryName = (selectedOpt?.getAttribute('data-name') || selectedOpt?.textContent || '').trim();
    const badgeColor = (selectedOpt?.getAttribute('data-color') || '').trim();
    const urgencyLevel = (document.getElementById('broadcast-urgency-select')?.value || '').trim();
    const title = document.getElementById('broadcast-title-input').value.trim();
    const scope = document.getElementById('broadcast-scope-select').value;
    const affectedLocation = (document.getElementById('broadcast-affected-location-input')?.value || '').trim();
    const message = document.getElementById('broadcast-message-input').value.trim();

    if (!title || !message) {
      if (errEl) {
        errEl.textContent = 'Please provide both an alert title and message content.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (!categoryId || !categoryName) {
      if (errEl) {
        errEl.textContent = 'Please select an Alert Category.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (!urgencyLevel) {
      if (errEl) {
        errEl.textContent = 'Please select an Urgency Level.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    const selDuration = getSelectedBroadcastHours();
    if (!selDuration.valid) {
      const msg = 'Please select or enter a valid expiration duration between 1 and 168 hours.';
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      }
      return;
    }

    const durationHours = selDuration.hours;
    const durationMinutes = durationHours * 60;
    const durationLabel = `${durationHours} ${durationHours === 1 ? 'hour' : 'hours'}`;
    const estimatedDate = new Date(Date.now() + durationMinutes * 60000);
    const expirationPreviewText = `${durationLabel} (~${formatManilaDateTime(estimatedDate)} Asia/Manila)`;

    state.broadcasts.pendingBroadcast = {
      categoryId: Number(categoryId),
      advisoryType: categoryName,
      badgeColor,
      urgencyLevel,
      title,
      scope,
      affectedLocation,
      message,
      expirationDurationHours: durationHours,
      expirationDurationMinutes: durationMinutes,
    };

    const advisoryPreviewEl = document.getElementById('confirm-broadcast-advisory-type');
    if (advisoryPreviewEl) {
      advisoryPreviewEl.innerHTML = window.GeoSafeAdvisories
        ? window.GeoSafeAdvisories.renderBadge(categoryName, { badgeColor })
        : escapeHtml(categoryName);
    }
    const urgencyPreviewEl = document.getElementById('confirm-broadcast-urgency');
    if (urgencyPreviewEl) urgencyPreviewEl.innerHTML = renderUrgencyBadge(urgencyLevel);
    document.getElementById('confirm-broadcast-title').textContent = title;
    document.getElementById('confirm-broadcast-scope').textContent = scope;
    const confirmLocEl = document.getElementById('confirm-broadcast-location');
    if (confirmLocEl) confirmLocEl.textContent = affectedLocation || 'Not specified (General)';
    const confirmExpEl = document.getElementById('confirm-broadcast-expires');
    if (confirmExpEl) confirmExpEl.textContent = expirationPreviewText;
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
    const formSubmitBtn = document.getElementById('broadcast-form-submit-btn');

    state.broadcasts.isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Publishing...';
    }
    if (cancelBtn) cancelBtn.disabled = true;
    if (formSubmitBtn) formSubmitBtn.disabled = true;

    try {
      pending.idempotencyKey = pending.idempotencyKey || `brd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const payload = {
        client_request_id: pending.idempotencyKey,
        category_id: pending.categoryId,
        advisory_type: pending.advisoryType,
        urgency_level: pending.urgencyLevel,
        title: pending.title,
        target_scope: pending.scope,
        target_zones: pending.affectedLocation || null,
        location_coverage: 'Entire Barangay Bayanan',
        location_address: pending.affectedLocation || null,
        message: pending.message,
        expiration_duration_hours: pending.expirationDurationHours,
        expiration_duration_minutes: pending.expirationDurationMinutes,
      };

      const result = await apiRequest('/broadcasts', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': pending.idempotencyKey },
        body: JSON.stringify(payload)
      });

      state.broadcasts.pendingBroadcast = null;
      showBannerMessage(result.message || 'Broadcast alert published successfully.');
      state.broadcasts.isSubmitting = false;
      closeBroadcastConfirmModal();
      document.getElementById('emergency-broadcast-form').reset();
      handleExpirationDurationChange();
      loadBroadcastsList();
      loadDashboardOverview();
    } catch (err) {
      state.broadcasts.isSubmitting = false;
      closeBroadcastConfirmModal();
      const errEl = document.getElementById('broadcast-form-error');
      if (errEl) {
        errEl.textContent = err.message || 'Unable to save broadcast alert.';
        errEl.classList.remove('hidden');
      }
    } finally {
      state.broadcasts.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm & Publish';
      }
      if (cancelBtn) cancelBtn.disabled = false;
      if (formSubmitBtn) formSubmitBtn.disabled = false;
    }
  }

  async function cancelBroadcast(id) {
    if (!id) return;
    if (!window.confirm('Are you sure you want to manually cancel this active broadcast alert?')) return;
    try {
      const res = await apiRequest(`/broadcasts/${id}/cancel`, { method: 'PATCH' });
      showBannerMessage((res && res.message) || 'Broadcast alert cancelled.');
      loadBroadcastsList();
    } catch (err) {
      showBannerMessage(err.message || 'Unable to cancel broadcast alert.', 'error');
    }
  }

  const CANONICAL_BROADCAST_CATEGORY_ORDER = [
    'Weather Advisory',
    'Flood Warning',
    'Fire Alert',
    'Earthquake Advisory',
    'Evacuation Notice',
    'Rescue Advisory',
    'Public Safety Advisory',
    'Emergency Announcement',
    'General Announcement',
  ];

  async function loadBroadcastCategories(selectedId = null) {
    const selectEl = document.getElementById('broadcast-advisory-type-select');
    if (!selectEl) return;

    try {
      const data = await apiRequest('/broadcast-categories');
      const allCategories = Array.isArray(data && data.categories) ? data.categories : [];
      const orderMap = new Map(CANONICAL_BROADCAST_CATEGORY_ORDER.map((n, idx) => [n.toLowerCase(), idx]));
      const canonicalOnly = allCategories
        .filter((c) => orderMap.has(String(c.name || '').toLowerCase()))
        .sort((a, b) => orderMap.get(String(a.name).toLowerCase()) - orderMap.get(String(b.name).toLowerCase()));
      const categories = canonicalOnly.length > 0 ? canonicalOnly : allCategories;

      state.broadcasts.categories = categories;
      selectEl.innerHTML = '<option value="">Select alert category...</option>' + categories.map((c) =>
        `<option value="${c.id}" data-name="${escapeHtml(c.name)}" data-color="${escapeHtml(c.badge_color || 'gray')}">${escapeHtml(c.name)}</option>`
      ).join('');
      if (selectedId) {
        selectEl.value = String(selectedId);
        selectEl.dispatchEvent(new Event('change'));
      }
    } catch (err) {
      console.error('[Admin] loadBroadcastCategories failed:', err.message);
      selectEl.innerHTML = '<option value="">Unable to load categories</option>';
    }
  }

  async function promptNewBroadcastCategory() {
    const rawName = window.prompt('Enter new Alert Category name:');
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

  function setBroadcastManagementTab(tab) {
    const filterInput = document.getElementById('admin-broadcasts-status-filter');
    if (filterInput) filterInput.value = tab;
    document.querySelectorAll('.broadcast-tab-btn').forEach((btn) => {
      const isActive = btn.getAttribute('data-broadcast-tab') === tab;
      btn.className = isActive
        ? 'broadcast-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-[#F5B900] text-[#202020]'
        : 'broadcast-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold text-[#555555] hover:text-[#202020]';
    });
    loadBroadcastsList();
  }

  function openBroadcastDetailModal(broadcastId) {
    const b = (state.broadcasts.items || []).find((item) => Number(item.id) === Number(broadcastId));
    const modal = document.getElementById('admin-broadcast-detail-modal');
    if (!b || !modal) return;

    const catLabel = b.categoryName || b.advisoryType || 'Other';
    const catEl = document.getElementById('admin-bdtl-category');
    if (catEl) {
      catEl.innerHTML = window.GeoSafeAdvisories
        ? window.GeoSafeAdvisories.renderBadge(catLabel, { badgeColor: b.badgeColor })
        : escapeHtml(catLabel);
    }
    const urgEl = document.getElementById('admin-bdtl-urgency');
    if (urgEl) urgEl.innerHTML = renderUrgencyBadge(b.urgencyLevel || 'Advisory');

    const statusVal = b.status || (b.isActive ? 'Active' : 'Cancelled');
    const statusEl = document.getElementById('admin-bdtl-status');
    if (statusEl) {
      const sCls = statusVal === 'Active'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : (statusVal === 'Expired' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200');
      statusEl.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold border ${sCls}">${escapeHtml(statusVal)}</span>`;
    }

    document.getElementById('admin-bdtl-title').textContent = b.title || '-';
    document.getElementById('admin-bdtl-message').textContent = b.message || '-';
    document.getElementById('admin-bdtl-audience').textContent = b.targetScope || '-';

    const locWrap = document.getElementById('admin-bdtl-location-wrap');
    const affectedLoc = (b.locationAddress || b.targetZones || '').trim();
    if (locWrap) {
      locWrap.classList.toggle('hidden', !affectedLoc);
      if (affectedLoc) {
        document.getElementById('admin-bdtl-coverage').textContent = affectedLoc;
      }
    }

    document.getElementById('admin-bdtl-published').textContent = formatManilaDateTime(b.broadcastedAt);
    const expText = b.expiresAt
      ? (b.expirationDurationLabel ? `${formatManilaDateTime(b.expiresAt)} (${b.expirationDurationLabel})` : formatManilaDateTime(b.expiresAt))
      : 'No expiration';
    document.getElementById('admin-bdtl-expires').textContent = expText;
    document.getElementById('admin-bdtl-author').textContent = b.authorizedBy || 'Administrator';
    document.getElementById('admin-bdtl-ref').textContent = b.referenceNumber || `BRD-${b.id}`;

    modal.classList.remove('hidden');
  }

  function closeBroadcastDetailModal() {
    document.getElementById('admin-broadcast-detail-modal')?.classList.add('hidden');
  }

  async function loadBroadcastsList() {
    const tbody = document.getElementById('admin-broadcasts-tbody');
    const loadingEl = document.getElementById('admin-broadcasts-loading');
    const emptyEl = document.getElementById('admin-broadcasts-empty');
    if (!tbody) return;

    const reqSeq = (state.broadcasts.loadSeq = (state.broadcasts.loadSeq || 0) + 1);
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    try {
      const data = await apiRequest('/broadcasts');
      // Discard stale out-of-order responses so overlapping loads never duplicate rows
      if (reqSeq !== state.broadcasts.loadSeq) return;

      const dedupedMap = new Map();
      (data.broadcasts || []).forEach((item) => {
        if (item && item.id !== undefined && item.id !== null) {
          dedupedMap.set(Number(item.id), item);
        }
      });
      state.broadcasts.items = Array.from(dedupedMap.values());

      const statusFilter = document.getElementById('admin-broadcasts-status-filter')?.value || 'Active';
      const filteredItems = statusFilter === 'all'
        ? state.broadcasts.items
        : state.broadcasts.items.filter((b) => String(b.status || (b.isActive ? 'Active' : 'Cancelled')) === statusFilter);

      // Clear tbody immediately before rendering (after await) to prevent duplicate row appending
      tbody.innerHTML = '';

      if (emptyEl) {
        emptyEl.classList.toggle('hidden', filteredItems.length > 0);
        emptyEl.innerHTML = statusFilter === 'all'
          ? '<p class="text-xs font-semibold text-[#777777]">No broadcast alerts recorded.</p>'
          : `<p class="text-xs font-semibold text-[#777777]">No ${escapeHtml(statusFilter.toLowerCase())} broadcast alerts found.</p>`;
      }

      filteredItems.forEach((b) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition-colors';
        const catLabel = b.categoryName || b.advisoryType || 'Other';
        const advisoryBadge = window.GeoSafeAdvisories
          ? window.GeoSafeAdvisories.renderBadge(catLabel, { badgeColor: b.badgeColor })
          : escapeHtml(catLabel);
        const urgencyBadge = renderUrgencyBadge(b.urgencyLevel || 'Advisory');
        const statusVal = b.status || (b.isActive ? 'Active' : 'Cancelled');
        let statusBadge = '';
        if (statusVal === 'Active') {
          const rem = b.expiresAt ? formatRemainingDuration(b.expiresAt) : '';
          statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>${rem ? `<span class="block text-[10px] text-emerald-700 font-semibold mt-0.5">${escapeHtml(rem)}</span>` : ''}`;
        } else if (statusVal === 'Expired') {
          statusBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Expired</span>';
        } else {
          statusBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Cancelled</span>';
        }
        const expiresDisplay = b.expiresAt ? formatManilaDateTime(b.expiresAt) : 'No expiration';
        const affectedLoc = (b.locationAddress || b.targetZones || '').trim();
        const cancelBtnHtml = statusVal === 'Active'
          ? `<button type="button" onclick="window.GeoSafeAdmin.cancelBroadcast(${b.id})" class="px-2.5 py-1 rounded-lg bg-[#FFF1F1] hover:bg-[#FFE0E0] border border-[#FFC2C2] text-[11px] font-bold text-[#D93636] transition-colors">Cancel</button>`
          : '';

        tr.innerHTML = `
          <td class="px-4 py-3 text-xs">
            <span class="font-bold text-[#202020] block">${escapeHtml(b.title)}</span>
            <span class="text-[11px] text-[#555555] line-clamp-1">${escapeHtml(b.message)}</span>
            ${affectedLoc ? `<span class="block text-[10px] text-[#8A6800] font-semibold mt-0.5">Location: ${escapeHtml(affectedLoc)}</span>` : ''}
          </td>
          <td class="px-4 py-3 text-xs whitespace-nowrap">${advisoryBadge}</td>
          <td class="px-4 py-3 text-xs whitespace-nowrap">${urgencyBadge}</td>
          <td class="px-4 py-3 text-xs text-[#555555] whitespace-nowrap">${escapeHtml(b.targetScope)}</td>
          <td class="px-4 py-3 text-xs text-[#777777] whitespace-nowrap">${formatManilaDateTime(b.broadcastedAt)}</td>
          <td class="px-4 py-3 text-xs text-[#777777] whitespace-nowrap">${escapeHtml(expiresDisplay)}</td>
          <td class="px-4 py-3 text-xs whitespace-nowrap">${statusBadge}</td>
          <td class="px-4 py-3 text-xs text-right whitespace-nowrap">
            <div class="inline-flex items-center gap-1.5">
              <button type="button" onclick="window.GeoSafeAdmin.openBroadcastDetailModal(${b.id})" class="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-bold text-[#202020] transition-colors">View</button>
              ${cancelBtnHtml}
            </div>
          </td>
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
    'flooding / rising water': '#2563EB',
    'fallen tree / road obstruction': '#D97706',
    'downed electrical power cable': '#8B5CF6',
    'structural / wall collapse': '#EA580C',
    'fire outbreak': '#DC2626',
    'severe drainage overflow': '#0D9488',
    'other disaster hazard': '#475569'
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
        <div class="p-6 rounded-lg bg-[#FFF1F1] border border-[#FFC2C2] text-center space-y-2">
          <p class="text-xs font-bold text-[#D93636]">Unable to load disaster category distribution.</p>
          <p class="text-[11px] text-[#B82828]">${escapeHtml(options.error)}</p>
          ${options.onRetry ? `<button type="button" onclick="${escapeHtml(options.onRetry)}" class="px-3 py-1.5 rounded-md bg-white border border-[#FFC2C2] text-[#D93636] text-xs font-bold hover:bg-slate-100">Retry</button>` : ''}
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
      const emptyLegendItems = allCats.map((c, idx) => {
        const color = getCategoryChartColor(c.name, idx);
        return `
          <div class="gs-doughnut-legend-item flex items-center gap-2.5 px-3 py-1.5 rounded-md border border-slate-200 bg-slate-50 opacity-60">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${color};"></span>
            <span class="text-xs font-bold text-[#202020] truncate">${escapeHtml(c.name)}</span>
          </div>
        `;
      }).join('');

      container.innerHTML = `
        <div class="gs-doughnut-layout">
          <div class="gs-doughnut-visual">
            <div class="relative flex-shrink-0 flex items-center justify-center" style="width: clamp(200px, 48vw, 248px); height: clamp(200px, 48vw, 248px); aspect-ratio: 1 / 1;">
              <svg viewBox="0 0 260 260" class="w-full h-full" role="img" aria-label="Empty disaster category distribution chart">
                <circle cx="130" cy="130" r="95" fill="none" stroke="#EEEEEE" stroke-width="38"></circle>
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
                <span class="text-3xl font-bold text-[#202020] leading-none">0</span>
                <span class="text-[11px] font-bold text-[#777777] uppercase tracking-wider mt-1">Total Reports</span>
              </div>
            </div>
          </div>
          <div class="gs-doughnut-legend space-y-2.5">
            ${emptyLegendItems ? `<div class="gs-doughnut-legend-list">${emptyLegendItems}</div>` : ''}
            <p class="text-[11px] text-[#777777] text-center md:text-left">No incident reports available for the selected range.</p>
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
    const sortedLegendSource = (allCats.length > 0 ? allCats : segments)
      .slice()
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.name || '').localeCompare(String(b.name || '')));
    const legendItems = sortedLegendSource.map((c, idx) => {
      const count = Number(c.count || 0);
      const color = getCategoryChartColor(c.name, idx);
      const isZero = count === 0;
      const segIdx = segIndexByName.has(c.name) ? segIndexByName.get(c.name) : -1;
      return `
        <div
          class="gs-doughnut-legend-item flex items-center gap-2.5 px-3 py-1.5 rounded-md border border-slate-200 bg-slate-50 ${isZero ? 'opacity-60' : 'cursor-pointer hover:bg-slate-50'}"
          ${segIdx >= 0 ? `data-legend-seg-idx="${segIdx}"` : ''}
        >
          <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${color};"></span>
          <span class="text-xs font-bold text-[#202020] truncate">${escapeHtml(c.name)}</span>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="gs-doughnut-layout">
        <div class="gs-doughnut-visual">
          <div class="relative flex-shrink-0 flex items-center justify-center" style="width: clamp(200px, 48vw, 248px); height: clamp(200px, 48vw, 248px); aspect-ratio: 1 / 1;">
            <svg viewBox="0 0 260 260" class="w-full h-full" role="img" aria-label="Reports by Disaster Category doughnut chart">
              ${svgParts.join('')}
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
              <span class="text-3xl font-bold text-[#202020] leading-none">${totalReports.toLocaleString()}</span>
              <span class="text-[11px] font-bold text-[#777777] uppercase tracking-wider mt-1">Total Reports</span>
            </div>
          </div>
          <div class="gs-doughnut-tooltip hidden absolute"></div>
        </div>

        <div class="gs-doughnut-legend">
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
      const params = window.GeoSafeAnalytics && typeof window.GeoSafeAnalytics.getFilterQueryParams === 'function'
        ? window.GeoSafeAnalytics.getFilterQueryParams()
        : new URLSearchParams({ period, from: dateFrom, to: dateTo });
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

      // Daily Incident Count Bar Chart
      renderDailyIncidentsBarChart(data.dailyTrends || [], period, dateFrom, dateTo);

      // Independent Monthly Stacked Incidents by Category Chart
      loadMonthlyStackedAnalytics();

      // Categories
      const catList = document.getElementById('analytics-categories-list');
      const catEmpty = document.getElementById('analytics-categories-empty');
      if (catList) {
        catList.innerHTML = '';
        const cats = data.categories || [];
        if (catEmpty) catEmpty.classList.toggle('hidden', cats.length > 0);
        cats.forEach((c) => {
          const item = document.createElement('div');
          item.className = 'flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0';
          item.innerHTML = `<span class="font-medium text-[#0f172a]">${escapeHtml(c.name)}</span><span class="font-bold text-[#0f172a] tabular-nums">${c.count}</span>`;
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
          item.className = 'flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0';
          item.innerHTML = `<span class="font-medium text-[#0f172a]">${escapeHtml(st.status)}</span><span class="font-bold text-[#0f172a] tabular-nums">${st.count}</span>`;
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
          item.className = 'flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0';
          item.innerHTML = `<span class="font-medium text-[#0f172a]">${escapeHtml(l.location_name)}</span><span class="font-bold text-[#0f172a] tabular-nums">${l.count}</span>`;
          locList.appendChild(item);
        });
      }

      if (window.GeoSafeAnalytics && typeof window.GeoSafeAnalytics.renderFromData === 'function') {
        window.GeoSafeAnalytics.renderFromData(data);
      }
    } catch (err) {
      console.error('[Admin] loadAnalyticsData failed:', err.message);
      renderDailyIncidentsBarChart([], period, dateFrom, dateTo);
      renderCategoryDoughnutChart(
        'analytics-category-doughnut',
        'analytics-category-total-badge',
        null,
        { error: err.message, onRetry: 'window.GeoSafeAdmin.loadAnalyticsData()' }
      );
      if (window.GeoSafeAnalytics && typeof window.GeoSafeAnalytics.renderError === 'function') {
        window.GeoSafeAnalytics.renderError(err.message);
      }
    }
  }

  function formatDailyChartDateLabel(ymd, includeYear = false) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return String(ymd || '');
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const opts = includeYear
      ? { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }
      : { month: 'short', day: '2-digit', timeZone: 'UTC' };
    return dt.toLocaleDateString('en-US', opts);
  }

  function renderDailyIncidentsBarChart(dailyTrends, period, dateFrom, dateTo) {
    const chartEl = document.getElementById('analytics-daily-bar-chart');
    const emptyEl = document.getElementById('analytics-daily-empty');
    const tooltipEl = document.getElementById('analytics-daily-tooltip');
    const rangeLabelEl = document.getElementById('analytics-daily-range-label');
    if (!chartEl) return;

    const rows = Array.isArray(dailyTrends) ? dailyTrends : [];

    if (rangeLabelEl) {
      if (rows.length > 0) {
        rangeLabelEl.textContent = `${formatDailyChartDateLabel(rows[0].date, true)} – ${formatDailyChartDateLabel(rows[rows.length - 1].date, true)}`;
      } else if (period === 'custom' && dateFrom && dateTo) {
        rangeLabelEl.textContent = `${formatDailyChartDateLabel(dateFrom, true)} – ${formatDailyChartDateLabel(dateTo, true)}`;
      } else {
        rangeLabelEl.textContent = '';
      }
    }

    if (rows.length === 0) {
      chartEl.innerHTML = '';
      chartEl.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (tooltipEl) tooltipEl.classList.add('hidden');
      return;
    }

    chartEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    const maxCount = Math.max(1, ...rows.map((r) => Number(r.count || 0)));
    const niceStep = (() => {
      const raw = maxCount / 4;
      if (raw <= 1) return 1;
      if (raw <= 2) return 2;
      if (raw <= 5) return 5;
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const norm = raw / mag;
      if (norm <= 1) return 1 * mag;
      if (norm <= 2) return 2 * mag;
      if (norm <= 5) return 5 * mag;
      return 10 * mag;
    })();
    const yMax = Math.max(niceStep * 4, Math.ceil(maxCount / niceStep) * niceStep);
    const yTicks = [];
    for (let v = 0; v <= yMax; v += niceStep) {
      yTicks.push(v);
    }

    const svgWidth = Math.max(560, Math.round(chartEl.clientWidth || 920));
    const svgHeight = Math.max(260, Math.round(chartEl.clientHeight || 440));
    const padLeft = 56;
    const padRight = 18;
    const padTop = 22;
    const padBottom = 48;
    const plotW = svgWidth - padLeft - padRight;
    const plotH = svgHeight - padTop - padBottom;

    const slotW = plotW / rows.length;
    const barW = Math.max(8, Math.min(30, slotW * 0.52));
    const labelStep = rows.length > 18 ? Math.ceil(rows.length / 12) : 1;

    const gridLinesSvg = yTicks.map((tick) => {
      const y = padTop + plotH - (tick / yMax) * plotH;
      return `
        <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${svgWidth - padRight}" y2="${y.toFixed(1)}"
          stroke="${tick === 0 ? '#94a3b8' : '#e2e8f0'}" stroke-width="1" />
        <text x="${padLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end"
          fill="#64748b" font-size="11" font-weight="500">${tick}</text>
      `;
    }).join('');

    const yAxisLineSvg = `<line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotH}" stroke="#94a3b8" stroke-width="1" />`;
    const yAxisTitleSvg = `
      <text x="15" y="${(padTop + plotH / 2).toFixed(1)}" text-anchor="middle"
        fill="#334155" font-size="11" font-weight="600"
        transform="rotate(-90 15 ${(padTop + plotH / 2).toFixed(1)})">Number of Reports</text>
    `;
    const xAxisTitleSvg = `
      <text x="${(padLeft + plotW / 2).toFixed(1)}" y="${svgHeight - 8}" text-anchor="middle"
        fill="#334155" font-size="11" font-weight="600">Date</text>
    `;

    const barsSvg = rows.map((row, idx) => {
      const count = Number(row.count || 0);
      const barH = yMax > 0 ? (count / yMax) * plotH : 0;
      const centerX = padLeft + idx * slotW + slotW / 2;
      const barX = centerX - barW / 2;
      const barY = padTop + plotH - barH;
      const shortDate = formatDailyChartDateLabel(row.date, false);
      const fullDate = formatDailyChartDateLabel(row.date, true);
      const showTickLabel = idx % labelStep === 0 || idx === rows.length - 1;
      const showValueLabel = rows.length <= 31 && count > 0;

      return `
        <g class="analytics-daily-bar-group cursor-pointer" tabindex="0"
          data-date="${escapeHtml(fullDate)}" data-count="${count}"
          aria-label="${escapeHtml(fullDate)}: ${count} incident report${count === 1 ? '' : 's'}">
          <rect x="${(padLeft + idx * slotW).toFixed(1)}" y="${padTop}" width="${slotW.toFixed(1)}" height="${plotH}"
            fill="transparent" />
          ${barH > 0 ? `
            <rect x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2, barH).toFixed(1)}"
              rx="2" fill="#0A58CA" class="transition-colors duration-150 hover:fill-[#084298]" />
          ` : ''}
          ${showValueLabel ? `
            <text x="${centerX.toFixed(1)}" y="${Math.max(padTop - 5, barY - 6).toFixed(1)}" text-anchor="middle"
              fill="#0f172a" font-size="11" font-weight="600">${count}</text>
          ` : ''}
          ${showTickLabel ? `
            <text x="${centerX.toFixed(1)}" y="${padTop + plotH + 16}" text-anchor="middle"
              fill="#475569" font-size="11" font-weight="500">${escapeHtml(shortDate)}</text>
          ` : ''}
        </g>
      `;
    }).join('');

    chartEl.innerHTML = `
      <svg viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMidYMid meet"
        class="w-full h-full block select-none" role="img"
        aria-label="Incidents by Day bar chart">
        ${gridLinesSvg}
        ${yAxisLineSvg}
        ${yAxisTitleSvg}
        ${xAxisTitleSvg}
        ${barsSvg}
      </svg>
    `;

    if (tooltipEl) {
      const showTooltip = (group, clientX, clientY) => {
        const d = group.getAttribute('data-date') || '';
        const c = Number(group.getAttribute('data-count') || 0);
        tooltipEl.textContent = `${d}: ${c} incident report${c === 1 ? '' : 's'}`;
        tooltipEl.classList.remove('hidden');
        tooltipEl.style.left = `${clientX + 12}px`;
        tooltipEl.style.top = `${Math.max(12, clientY - 36)}px`;
      };
      const hideTooltip = () => tooltipEl.classList.add('hidden');

      chartEl.querySelectorAll('.analytics-daily-bar-group').forEach((group) => {
        group.addEventListener('mouseenter', (e) => showTooltip(group, e.clientX, e.clientY));
        group.addEventListener('mousemove', (e) => showTooltip(group, e.clientX, e.clientY));
        group.addEventListener('mouseleave', hideTooltip);
        group.addEventListener('focus', () => {
          const rect = group.getBoundingClientRect();
          showTooltip(group, rect.left + rect.width / 2, rect.top + 20);
        });
        group.addEventListener('blur', hideTooltip);
      });
    }
  }

  let exportPreviewTimer = null;
  let exportGenerating = false;
  let exportListenersBound = false;

  function getSelectedExportCategories() {
    return Array.from(document.querySelectorAll('.export-category-cb:checked')).map((el) => el.value);
  }

  function updateExportSelectedCount() {
    const count = getSelectedExportCategories().length;
    const countEl = document.getElementById('export-selected-count');
    if (countEl) {
      countEl.textContent = `(${count} selected)`;
    }
  }

  function collectExportPayload() {
    const categories = getSelectedExportCategories();
    const period = document.getElementById('export-period-select')?.value || 'this_month';
    const from = document.getElementById('export-date-from')?.value || '';
    const to = document.getElementById('export-date-to')?.value || '';
    const status = document.getElementById('export-status-filter')?.value || '';
    const category = document.getElementById('export-category-filter')?.value || '';
    const operationType = document.getElementById('export-operation-type-filter')?.value || 'all';
    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'xlsx';
    return { categories, period, from, to, status, category, operationType, format };
  }

  function syncExportCustomDateState() {
    const period = document.getElementById('export-period-select')?.value || 'this_month';
    const fromEl = document.getElementById('export-date-from');
    const toEl = document.getElementById('export-date-to');
    const isCustom = period === 'custom';
    if (fromEl) fromEl.disabled = !isCustom;
    if (toEl) toEl.disabled = !isCustom;
  }

  function scheduleExportPreview() {
    updateExportSelectedCount();
    syncExportCustomDateState();
    clearTimeout(exportPreviewTimer);
    exportPreviewTimer = setTimeout(() => {
      refreshExportPreview();
    }, 180);
  }

  async function refreshExportPreview() {
    const boxEl = document.getElementById('export-preview-box');
    const statusEl = document.getElementById('export-preview-status');
    const errEl = document.getElementById('export-modal-error');
    const genBtn = document.getElementById('btn-generate-export');
    if (!boxEl) return;

    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }

    const payload = collectExportPayload();
    if (payload.categories.length === 0) {
      if (statusEl) statusEl.textContent = 'No categories selected';
      boxEl.innerHTML = '<div class="text-slate-500">Select at least one report category to preview record counts.</div>';
      if (genBtn) genBtn.disabled = true;
      return;
    }

    if (payload.period === 'custom' && (!payload.from || !payload.to)) {
      if (statusEl) statusEl.textContent = 'Select start & end dates';
      boxEl.innerHTML = '<div class="text-amber-700">Choose both a Start Date and End Date for the custom reporting period.</div>';
      if (genBtn) genBtn.disabled = true;
      return;
    }

    if (statusEl) statusEl.textContent = 'Calculating...';
    if (genBtn) genBtn.disabled = true;

    try {
      const preview = await apiRequest('/analytics/export/preview', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const formatLabel = preview.format === 'xlsx'
        ? 'Excel (.xlsx)'
        : preview.format === 'pdf'
          ? 'PDF (.pdf)'
          : preview.categories.length > 1
            ? 'CSV Archive (.zip)'
            : 'CSV (.csv)';

      const countRowsHtml = (preview.categories || []).map((catKey, idx) => {
        const label = (preview.categoryLabels && preview.categoryLabels[idx]) || catKey;
        const count = Number((preview.counts && preview.counts[catKey]) || 0);
        const badge = count === 0
          ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">0 records</span>'
          : `<span class="font-bold text-[#0f172a] tabular-nums">${count.toLocaleString()}</span>`;
        return `<div class="flex items-center justify-between text-[11.5px]"><span>${escapeHtml(label)}</span>${badge}</div>`;
      }).join('');

      const emptyNote = Array.isArray(preview.emptyCategories) && preview.emptyCategories.length > 0
        ? `<div class="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">Empty for selected filters: ${escapeHtml(preview.emptyCategories.join(', '))}</div>`
        : '';

      boxEl.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-200 text-[11px] text-slate-600">
          <span><strong>Period:</strong> ${escapeHtml(preview.dateRangeLabel || '')}</span>
          <span><strong>Format:</strong> ${escapeHtml(formatLabel)}</span>
        </div>
        <div class="space-y-1 pt-1">${countRowsHtml}</div>
        <div class="flex items-center justify-between pt-1.5 border-t border-slate-200 text-xs font-bold text-[#0f172a]">
          <span>Total Records Included</span>
          <span class="tabular-nums">${Number(preview.totalRecords || 0).toLocaleString()}</span>
        </div>
        ${emptyNote}
      `;
      if (statusEl) statusEl.textContent = 'Ready';
      if (genBtn) genBtn.disabled = exportGenerating;
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Error';
      boxEl.innerHTML = '<div class="text-red-700">Unable to load live export preview counts.</div>';
      if (errEl) {
        errEl.textContent = err.message || 'Failed to preview export.';
        errEl.classList.remove('hidden');
      }
      if (genBtn) genBtn.disabled = true;
    }
  }

  function bindExportModalListeners() {
    if (exportListenersBound) return;
    exportListenersBound = true;
    document.querySelectorAll('.export-category-cb').forEach((cb) => {
      cb.addEventListener('change', scheduleExportPreview);
    });
    document.querySelectorAll('input[name="export-format"]').forEach((r) => {
      r.addEventListener('change', scheduleExportPreview);
    });
    ['export-period-select', 'export-date-from', 'export-date-to', 'export-status-filter', 'export-category-filter', 'export-operation-type-filter'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', scheduleExportPreview);
    });
  }

  function openAnalyticsExportModal() {
    const modal = document.getElementById('modal-analytics-export');
    if (!modal) return;
    bindExportModalListeners();

    // Default to current Reports & Analytics period/date range without mutating dashboard filters
    const dashPeriod = document.getElementById('analytics-period-select')?.value || 'this_month';
    const dashFrom = document.getElementById('analytics-date-from')?.value || '';
    const dashTo = document.getElementById('analytics-date-to')?.value || '';

    const expPeriodEl = document.getElementById('export-period-select');
    const expFromEl = document.getElementById('export-date-from');
    const expToEl = document.getElementById('export-date-to');
    if (expPeriodEl) expPeriodEl.value = dashPeriod;
    if (expFromEl) expFromEl.value = dashFrom;
    if (expToEl) expToEl.value = dashTo;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    updateExportSelectedCount();
    syncExportCustomDateState();
    refreshExportPreview();
  }

  function closeAnalyticsExportModal() {
    const modal = document.getElementById('modal-analytics-export');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  function selectAllExportCategories() {
    document.querySelectorAll('.export-category-cb').forEach((cb) => { cb.checked = true; });
    scheduleExportPreview();
  }

  function clearExportCategories() {
    document.querySelectorAll('.export-category-cb').forEach((cb) => { cb.checked = false; });
    scheduleExportPreview();
  }

  async function generateAnalyticsExport() {
    if (exportGenerating) return;
    const payload = collectExportPayload();
    const errEl = document.getElementById('export-modal-error');
    const genBtn = document.getElementById('btn-generate-export');
    const genLabel = document.getElementById('btn-generate-export-label');

    if (payload.categories.length === 0) {
      if (errEl) {
        errEl.textContent = 'Select at least one report category to export.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    exportGenerating = true;
    if (genBtn) genBtn.disabled = true;
    if (genLabel) genLabel.textContent = 'Generating...';
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }

    try {
      const store = window.geoSafeStore;
      let headers = { 'Content-Type': 'application/json' };
      if (store && typeof store.getAuthHeaders === 'function') {
        headers = store.getAuthHeaders(headers);
      }

      const response = await fetch('/api/admin/analytics/export', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(payload)
      });

      if (response.status === 401) {
        window.location.replace('/login.html');
        return;
      }

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Export failed (HTTP ${response.status})`);
      }

      const blob = await response.blob();
      const disp = response.headers.get('Content-Disposition') || '';
      const fnMatch = disp.match(/filename="?([^"]+)"?/i);
      const extFallback = payload.format === 'csv' && payload.categories.length > 1 ? 'zip' : payload.format;
      const filename = fnMatch ? fnMatch[1] : `GeoSafe_Export_${new Date().toISOString().slice(0, 10)}.${extFallback}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      if (typeof showToast === 'function') {
        showToast(`Export generated: ${filename}`, 'success');
      }
      closeAnalyticsExportModal();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Unable to generate export.';
        errEl.classList.remove('hidden');
      }
      if (typeof showToast === 'function') {
        showToast(err.message || 'Export failed.', 'error');
      }
    } finally {
      exportGenerating = false;
      if (genBtn) genBtn.disabled = false;
      if (genLabel) genLabel.textContent = 'Generate Export';
    }
  }

  let monthlyStackedYearBound = false;

  async function loadMonthlyStackedAnalytics(explicitYear) {
    const yearSelect = document.getElementById('analytics-monthly-year-select');
    const chartEl = document.getElementById('analytics-monthly-stacked-chart');
    const emptyEl = document.getElementById('analytics-monthly-stacked-empty');
    const errEl = document.getElementById('analytics-monthly-stacked-error');
    const badgeEl = document.getElementById('analytics-monthly-total-badge');
    if (!chartEl) return;

    if (yearSelect && !monthlyStackedYearBound) {
      monthlyStackedYearBound = true;
      yearSelect.addEventListener('change', () => {
        loadMonthlyStackedAnalytics(yearSelect.value);
      });
    }

    const selectedYear = explicitYear || (yearSelect && yearSelect.value) || '';
    const qs = selectedYear ? `?year=${encodeURIComponent(selectedYear)}` : '';

    try {
      if (errEl) {
        errEl.textContent = '';
        errEl.classList.add('hidden');
      }
      const data = await apiRequest(`/analytics/monthly-categories${qs}`);

      if (yearSelect && Array.isArray(data.availableYears)) {
        yearSelect.innerHTML = data.availableYears
          .map((y) => `<option value="${y}" ${Number(y) === Number(data.year) ? 'selected' : ''}>${y}</option>`)
          .join('');
      }

      if (badgeEl) {
        const tot = Number(data.totalYearReports || 0);
        badgeEl.textContent = `${tot.toLocaleString()} Total ${tot === 1 ? 'Report' : 'Reports'}`;
      }

      renderMonthlyStackedCategoryChart(data);
    } catch (err) {
      chartEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.add('hidden');
      if (errEl) {
        errEl.textContent = err.message || 'Unable to load monthly incident category chart.';
        errEl.classList.remove('hidden');
      }
    }
  }

  function renderMonthlyStackedCategoryChart(data) {
    const chartEl = document.getElementById('analytics-monthly-stacked-chart');
    const emptyEl = document.getElementById('analytics-monthly-stacked-empty');
    const legendEl = document.getElementById('analytics-monthly-stacked-legend');
    const tooltipEl = document.getElementById('analytics-monthly-stacked-tooltip');
    if (!chartEl) return;

    const months = Array.isArray(data && data.months) ? data.months : [];
    const categories = Array.isArray(data && data.categories) ? data.categories : [];
    const yearLabel = data && data.year ? String(data.year) : '';

    if (legendEl) {
      legendEl.innerHTML = categories.map((cat, idx) => {
        const color = getCategoryChartColor(cat, idx);
        return `
          <span class="inline-flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-[2px] inline-block flex-none" style="background:${color};"></span>
            <span class="font-medium text-slate-700">${escapeHtml(cat)}</span>
          </span>
        `;
      }).join('');
    }

    if (months.length === 0) {
      chartEl.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    chartEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    const maxTotal = Math.max(1, ...months.map((m) => Number(m.total || 0)));
    const rawStep = maxTotal <= 5 ? 1 : Math.ceil(maxTotal / 5);
    const yMax = Math.max(5, Math.ceil(maxTotal / rawStep) * rawStep);
    const tickCount = 5;

    const svgW = 860;
    const svgH = 290;
    const padL = 44;
    const padR = 16;
    const padT = 24;
    const padB = 34;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;
    const slotW = plotW / 12;
    const barW = Math.min(40, Math.max(22, slotW * 0.54));

    const gridLines = [];
    for (let i = 0; i <= tickCount; i++) {
      const val = Math.round((yMax / tickCount) * i);
      const y = padT + plotH - (val / yMax) * plotH;
      gridLines.push(`
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${svgW - padR}" y2="${y.toFixed(1)}" stroke="#E2E8F0" stroke-width="1" />
        <text x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="#64748B" font-size="10.5" font-weight="500">${val}</text>
      `);
    }

    const barsHtml = months.map((m, mIdx) => {
      const cx = padL + mIdx * slotW + slotW / 2;
      const bx = cx - barW / 2;
      const monthTotal = Number(m.total || 0);
      let currentY = padT + plotH;

      const segmentsSvg = (m.segments || []).map((seg, sIdx) => {
        const count = Number(seg.count || 0);
        if (count <= 0) return '';
        const segH = (count / yMax) * plotH;
        const sy = currentY - segH;
        currentY = sy;
        const color = getCategoryChartColor(seg.category, sIdx);
        return `
          <rect class="analytics-monthly-seg cursor-pointer transition-opacity hover:opacity-85"
            x="${bx.toFixed(1)}" y="${sy.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1.5, segH).toFixed(1)}"
            fill="${color}" stroke="#FFFFFF" stroke-width="0.75"
            data-month="${escapeHtml(m.monthFullName)} ${escapeHtml(yearLabel)}"
            data-category="${escapeHtml(seg.category)}"
            data-count="${count}"
            data-total="${monthTotal}"
            tabindex="0" />
        `;
      }).join('');

      const totalLabelY = Math.max(12, currentY - 6);
      const totalText = `
        <text x="${cx.toFixed(1)}" y="${totalLabelY.toFixed(1)}" text-anchor="middle" fill="${monthTotal > 0 ? '#0F172A' : '#94A3B8'}" font-size="10.5" font-weight="700">${monthTotal}</text>
      `;

      const xLabel = `
        <text x="${cx.toFixed(1)}" y="${(padT + plotH + 18).toFixed(1)}" text-anchor="middle" fill="#475569" font-size="11" font-weight="600">${escapeHtml(m.monthLabel)}</text>
      `;

      return `<g>${segmentsSvg}${totalText}${xLabel}</g>`;
    }).join('');

    chartEl.innerHTML = `
      <svg viewBox="0 0 ${svgW} ${svgH}" class="w-full h-full select-none" role="img" aria-label="Monthly Incidents by Category stacked bar chart">
        ${gridLines.join('')}
        <line x1="${padL}" y1="${padT + plotH}" x2="${svgW - padR}" y2="${padT + plotH}" stroke="#94A3B8" stroke-width="1.2" />
        ${barsHtml}
      </svg>
    `;

    if (tooltipEl) {
      const showTip = (el, clientX, clientY) => {
        const month = el.getAttribute('data-month') || '';
        const category = el.getAttribute('data-category') || '';
        const count = Number(el.getAttribute('data-count') || 0);
        const total = Number(el.getAttribute('data-total') || 0);
        tooltipEl.innerHTML = `
          <div class="font-bold text-white">${escapeHtml(month)}</div>
          <div class="text-slate-200">${escapeHtml(category)}: <span class="font-bold text-white">${count}</span> ${count === 1 ? 'report' : 'reports'}</div>
          <div class="text-slate-300 text-[10.5px] mt-0.5">Monthly total: <span class="font-semibold text-white">${total}</span></div>
        `;
        tooltipEl.classList.remove('hidden');
        tooltipEl.style.left = `${Math.min(window.innerWidth - 220, clientX + 12)}px`;
        tooltipEl.style.top = `${Math.max(12, clientY - 54)}px`;
      };
      const hideTip = () => tooltipEl.classList.add('hidden');

      chartEl.querySelectorAll('.analytics-monthly-seg').forEach((seg) => {
        seg.addEventListener('mouseenter', (e) => showTip(seg, e.clientX, e.clientY));
        seg.addEventListener('mousemove', (e) => showTip(seg, e.clientX, e.clientY));
        seg.addEventListener('mouseleave', hideTip);
        seg.addEventListener('focus', () => {
          const rect = seg.getBoundingClientRect();
          showTip(seg, rect.left + rect.width / 2, rect.top + 10);
        });
        seg.addEventListener('blur', hideTip);
      });
    }
  }

  function downloadAnalyticsCsv() {
    openAnalyticsExportModal();
  }

  function printAnalyticsReport() {
    window.print();
  }

  function emailAnalyticsSummary() {
    const data = state.analytics?.data || {};
    const sum = data.summary || {};
    const periodSelect = document.getElementById('analytics-period-select');
    const periodLabel = periodSelect ? periodSelect.options[periodSelect.selectedIndex]?.text || periodSelect.value : 'Selected Period';
    const subject = encodeURIComponent(`GeoSafe Incident Count Summary (${periodLabel})`);
    const body = encodeURIComponent(
      `GeoSafe Incident Count Report (${periodLabel})\n` +
      `Total Incidents: ${Number(sum.totalReports || 0).toLocaleString()}\n` +
      `Total Rescues: ${Number(sum.totalRescues || 0).toLocaleString()}\n` +
      `Total Operations: ${Number(sum.totalEvents || 0).toLocaleString()}\n` +
      `Active Dispatches: ${Number(sum.activeAssignments || 0).toLocaleString()}\n`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  function scheduleAnalyticsReport() {
    if (typeof showToast === 'function') {
      showToast('Use Print or Export to save this report; automated email scheduling is configured via System Settings.', 'info');
    }
  }

  // ============================================================================
  // SECTION 7: SYSTEM SETTINGS & MAINTENANCE
  // ============================================================================
  async function loadSystemSettings() {
    const listEl = document.getElementById('system-settings-list');
    const emptyEl = document.getElementById('system-settings-empty');
    const loadEl = document.getElementById('system-settings-loading');
    const dbStatusEl = document.getElementById('health-db-status');
    if (!listEl) return;

    listEl.innerHTML = '';
    listEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (loadEl) loadEl.classList.remove('hidden');

    try {
      const data = await apiRequest('/settings');
      state.settings = data;

      if (data.health) {
        const h = data.health;
        if (dbStatusEl) {
          dbStatusEl.textContent = h.databaseStatus || 'Operational';
          dbStatusEl.className = 'font-bold text-emerald-600';
        }
        document.getElementById('health-db-latency').textContent = `${h.databaseLatencyMs} ms`;
        document.getElementById('health-server-uptime').textContent = `${Math.floor(h.serverUptimeSeconds / 60)} minutes`;
        document.getElementById('health-environment').textContent = h.environment || '—';
        document.getElementById('health-node-version').textContent = h.nodeVersion || '—';
      }

      if (data.securityStats) {
        document.getElementById('security-stat-failed').textContent = data.securityStats.failedLogins24h;
        document.getElementById('security-stat-success').textContent = data.securityStats.successLogins24h;
      }

      if (data.diagnostics) {
        const d = data.diagnostics;
        const st = d.storage || {};
        const stEl = document.getElementById('diag-storage-status');
        const bucketEl = document.getElementById('diag-storage-bucket');
        const acctEl = document.getElementById('diag-accounts-summary');
        const ticketsEl = document.getElementById('diag-open-tickets');
        const auditEl = document.getElementById('diag-audit-summary');

        if (stEl) {
          if (st.mode === 'supabase' && st.category === 'OK') {
            stEl.textContent = 'Supabase Private (Operational)';
            stEl.className = 'font-bold text-emerald-600 text-right';
          } else if (st.mode === 'local_fallback') {
            stEl.textContent = 'Local Disk Fallback';
            stEl.className = 'font-bold text-amber-600 text-right';
          } else {
            stEl.textContent = st.category ? `Unavailable (${st.category})` : 'Unavailable';
            stEl.className = 'font-bold text-[#D93636] text-right';
          }
        }
        if (bucketEl) bucketEl.textContent = st.bucket || '—';
        if (acctEl) acctEl.textContent = `${d.totalAccounts ?? 0} total (${d.activeAccounts ?? 0} active)`;
        if (ticketsEl) ticketsEl.textContent = String(d.openPasswordTickets ?? 0);
        if (auditEl) {
          const lastText = d.lastAuditAt ? formatDateTime(d.lastAuditAt) : 'None';
          auditEl.textContent = `${d.auditEvents24h ?? 0} • ${lastText}`;
        }
      }

      // Editable settings from PostgreSQL system_settings (shown only when present)
      const settingsList = data.settings || [];
      if (settingsList.length === 0) {
        listEl.classList.add('hidden');
        if (emptyEl) emptyEl.classList.add('hidden');
      } else {
        listEl.classList.remove('hidden');
        settingsList.forEach((st) => {
          const box = document.createElement('div');
          box.className = 'p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2.5';
          box.innerHTML = `
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <span class="text-xs font-bold text-[#202020] block truncate">${escapeHtml(st.setting_key)}</span>
                <p class="text-[11px] text-[#64748B] mt-0.5 leading-relaxed">${escapeHtml(st.description || 'System setting')}</p>
              </div>
              <span class="shrink-0 px-2 py-0.5 rounded bg-slate-200/70 text-[10px] uppercase font-bold text-[#555555]">${escapeHtml(st.category)}</span>
            </div>
            <div class="flex items-center gap-2">
              <input id="setting-input-${st.id}" type="text" value="${escapeHtml(st.setting_value || '')}" class="flex-1 h-9 px-3 rounded-md border border-slate-200 bg-white text-xs text-[#202020] focus:outline-none focus:border-[#164579]">
              <button type="button" onclick="window.GeoSafeAdmin.saveSetting('${st.setting_key}', document.getElementById('setting-input-${st.id}').value)" class="h-9 px-4 rounded-md bg-[#202020] hover:bg-[#333333] text-[#FFF9E8] text-xs font-bold transition-colors shrink-0">
                Save
              </button>
            </div>
          `;
          listEl.appendChild(box);
        });
      }

      // Recent Security Events (newest first)
      const secTbody = document.getElementById('security-events-tbody');
      const secEmpty = document.getElementById('security-events-empty');
      if (secTbody) {
        secTbody.innerHTML = '';
        const events = data.recentSecurityEvents || [];
        if (secEmpty) secEmpty.classList.toggle('hidden', events.length > 0);
        events.forEach((ev) => {
          const tr = document.createElement('tr');
          tr.className = 'hover:bg-slate-50 transition-colors';
          const detailsText = ev.details || '-';
          tr.innerHTML = `
            <td class="px-4 py-3 font-bold text-[#202020] whitespace-nowrap">${escapeHtml(ev.event_type)}</td>
            <td class="px-4 py-3 text-[#555555] break-all">${escapeHtml(ev.attempted_email || '-')}</td>
            <td class="px-4 py-3 font-mono text-[#555555] whitespace-nowrap">${escapeHtml(ev.ip_address || '-')}</td>
            <td class="px-4 py-3 text-[#64748B] max-w-[260px] truncate" title="${escapeHtml(detailsText)}">${escapeHtml(detailsText)}</td>
            <td class="px-4 py-3 text-[#64748B] whitespace-nowrap">${formatDateTime(ev.created_at)}</td>
          `;
          secTbody.appendChild(tr);
        });
      }
    } catch (err) {
      console.error('[Admin] loadSystemSettings failed:', err.message);
      if (dbStatusEl) {
        dbStatusEl.textContent = 'Unavailable';
        dbStatusEl.className = 'font-bold text-[#D93636]';
      }
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
        feedback.className = 'p-2.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 block';
        feedback.textContent = res.message || 'Saved successfully.';
      }
    } catch (err) {
      if (feedback) {
        feedback.className = 'p-2.5 rounded-md text-xs font-semibold bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2] block';
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
        tr.className = 'hover:bg-slate-50 transition-colors';
        const isSuccess = String(log.result || '').toUpperCase() === 'SUCCESS';
        const resultBadge = isSuccess
          ? '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-[#278653] border border-emerald-200">Success</span>'
          : '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2]">Failure</span>';

        tr.innerHTML = `
          <td class="px-4 py-2.5 text-xs text-[#777777] whitespace-nowrap truncate align-middle" title="${escapeHtml(formatDateTime(log.timestamp))}">${formatDateTime(log.timestamp)}</td>
          <td class="px-4 py-2.5 text-xs font-semibold text-[#202020] align-middle overflow-hidden">
            <span class="block truncate" title="${escapeHtml(log.userName)}">${escapeHtml(log.userName)}</span>
            <span class="block text-[10px] font-normal text-[#777777] truncate" title="${escapeHtml(log.userEmail)}">${escapeHtml(log.userEmail)}</span>
          </td>
          <td class="px-4 py-2.5 text-xs text-[#555555] whitespace-nowrap truncate align-middle" title="${escapeHtml(log.role)}">${escapeHtml(log.role)}</td>
          <td class="px-4 py-2.5 text-xs font-bold text-[#202020] break-words align-middle">${escapeHtml(log.activity)}</td>
          <td class="px-4 py-2.5 text-xs font-mono text-[#555555] truncate align-middle" title="${escapeHtml(log.module)}">${escapeHtml(log.module)}</td>
          <td class="px-4 py-2.5 text-xs whitespace-nowrap align-middle">${resultBadge}</td>
          <td class="px-4 py-2.5 text-xs font-mono text-[#777777] whitespace-nowrap truncate align-middle" title="${escapeHtml(log.ipAddress || '-')}">${escapeHtml(log.ipAddress || '-')}</td>
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
    const mapHospitalsToggle = document.getElementById('map-toggle-hospitals');
    if (mapHospitalsToggle) {
      mapHospitalsToggle.addEventListener('change', () => {
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
        state.reports.pagination.page = 1;
        loadReportsList();
      });
    });

    const reportTypeSelect = document.getElementById('reports-type-select');
    const reportSearchInput = document.getElementById('reports-search-input');
    if (reportTypeSelect) {
      reportTypeSelect.addEventListener('change', (e) => {
        state.reports.filters.type = e.target.value;
        state.reports.pagination.page = 1;
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

    // Password Assistance Tickets Queue Bindings
    const paRefreshBtn = document.getElementById('pa-refresh-btn');
    if (paRefreshBtn) paRefreshBtn.addEventListener('click', () => loadPasswordAssistanceTickets());
    document.querySelectorAll('.pa-status-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextStatus = btn.getAttribute('data-pa-status') || 'pending';
        paQueueState.statusFilter = nextStatus;
        document.querySelectorAll('.pa-status-tab-btn').forEach((b) => {
          const active = (b.getAttribute('data-pa-status') || '') === nextStatus;
          b.className = active
            ? 'pa-status-tab-btn px-3 py-1.5 rounded-md bg-[#202020] text-[#FFF9E8]'
            : 'pa-status-tab-btn px-3 py-1.5 rounded-md text-[#555555] hover:text-[#202020]';
        });
        loadPasswordAssistanceTickets();
      });
    });
    const paSearchInput = document.getElementById('pa-admin-search-input');
    if (paSearchInput) {
      let paTimer = null;
      paSearchInput.addEventListener('input', (e) => {
        clearTimeout(paTimer);
        paTimer = setTimeout(() => {
          paQueueState.search = e.target.value.trim();
          loadPasswordAssistanceTickets();
        }, 300);
      });
    }
    const paModalCloseBtn = document.getElementById('pa-modal-close-btn');
    if (paModalCloseBtn) paModalCloseBtn.addEventListener('click', closePasswordAssistanceModal);
    const paReviewBtn = document.getElementById('pa-modal-review-btn');
    if (paReviewBtn) paReviewBtn.addEventListener('click', markSelectedTicketInReview);
    const paApproveBtn = document.getElementById('pa-modal-approve-btn');
    if (paApproveBtn) paApproveBtn.addEventListener('click', approveSelectedPasswordTicket);
    const paRejectBtn = document.getElementById('pa-modal-reject-btn');
    if (paRejectBtn) paRejectBtn.addEventListener('click', rejectSelectedPasswordTicket);
    const paCopyBtn = document.getElementById('pa-copy-temp-btn');
    if (paCopyBtn) {
      paCopyBtn.addEventListener('click', async () => {
        const val = document.getElementById('pa-temp-password-value')?.textContent || '';
        if (!val) return;
        try {
          await navigator.clipboard.writeText(val);
          paCopyBtn.textContent = 'Copied!';
          setTimeout(() => { paCopyBtn.textContent = 'Copy'; }, 2000);
        } catch (_) {}
      });
    }

    // Analytics Custom Date Toggle & Instant Filter Refresh
    const analyticsPeriodSelect = document.getElementById('analytics-period-select');
    if (analyticsPeriodSelect) {
      analyticsPeriodSelect.addEventListener('change', (e) => {
        const isCustom = e.target.value === 'custom';
        const customContainer = document.getElementById('analytics-custom-date-container');
        if (customContainer) {
          customContainer.classList.toggle('hidden', !isCustom);
        }
        if (!isCustom) {
          loadAnalyticsData();
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
        } catch (_) { }
      }

      const MESSAGING_REALTIME_EVENTS = new Set([
        'conversation:new-message',
        'conversation:messages-read',
        'conversation:typing',
        'messages:unread-update',
        'messages:access-updated',
        'conversation:archive-updated',
        'admin:conversation-activity',
        'messages:incoming-notification',
      ]);

      const OPERATIONAL_REALTIME_EVENTS = new Set([
        'new-incident-report',
        'new-report',
        'public-report-verified',
        'incident-resolved',
        'report-verification-result',
        'new-rescue-request',
        'rescue-assignment-updated',
        'rescue-status-updated',
        'assignment-updated',
        'status-update',
        'admin-sync',
        'reconnect-sync',
        'new-hazard-alert',
        'alert-broadcast',
        'hazard-alert-expired',
        'alert-expired',
        'hazard-alert-cancelled',
        'alert-cancelled',
        'facility-updated',
        'evacuation-center-updated',
      ]);

      if (!window.__geosafeAdminRealtimeBound) {
        window.__geosafeAdminRealtimeBound = true;
        window.addEventListener('geosafe:realtime-update', (ev) => {
          const detail = (ev && ev.detail) || {};
          const evtName = detail.event || '';

          if (evtName === 'responder:location-updated') {
            upsertAdminResponderLocationMarker(detail.data);
            return;
          }
          if (evtName === 'responder:location-offline') {
            removeAdminResponderLocationMarker(detail.data && detail.data.userId);
            return;
          }
          if (evtName === 'password-assistance-submitted' || evtName === 'password-assistance-updated') {
            loadPasswordAssistanceTickets({ silent: true });
            if (evtName === 'password-assistance-submitted' && typeof showBannerMessage === 'function') {
              showBannerMessage('New Password Assistance ticket submitted.', 'info');
            }
            return;
          }

          // Isolate private messaging events strictly to the Messages oversight section
          if (MESSAGING_REALTIME_EVENTS.has(evtName)) {
            if (evtName === 'conversation:typing') return;
            if (state.currentSection === 'messages') {
              loadAdminConversationsList({ silent: true });
              if (state.messages.activeConversationId) {
                selectAdminConversation(state.messages.activeConversationId, { silent: true });
              }
            }
            return;
          }

          if (!OPERATIONAL_REALTIME_EVENTS.has(evtName)) {
            return;
          }

          if (evtName === 'reconnect-sync') {
            loadLiveResponderLocations();
          }

          if (state.currentSection === 'dashboard') {
            loadDashboardOverview();
          } else if (state.currentSection === 'reports') {
            loadReportsList();
          } else if (state.currentSection === 'responders') {
            loadRespondersList();
          } else if (state.currentSection === 'alerts') {
            const alertEvents = new Set([
              'new-hazard-alert',
              'alert-broadcast',
              'hazard-alert-expired',
              'alert-expired',
              'hazard-alert-cancelled',
              'alert-cancelled',
              'reconnect-sync',
              'admin-sync',
            ]);
            if (alertEvents.has(evtName)) {
              loadBroadcastsList();
            }
          } else if (state.currentSection === 'messages' && evtName === 'reconnect-sync') {
            loadAdminConversationsList({ silent: true });
            if (state.messages.activeConversationId) {
              selectAdminConversation(state.messages.activeConversationId, { silent: true });
            }
          }

          const reportModal = document.getElementById('admin-report-modal');
          if (reportModal && !reportModal.classList.contains('hidden') && state.reports.activeDetail) {
            openReportDetailModal(state.reports.activeDetail.recordType, state.reports.activeDetail.id);
          }
        });
      }

      if (window.geoSafeStore && window.geoSafeStore.socket) {
        const sock = window.geoSafeStore.socket;
        if (!sock._geosafeAdminRescueMonitorBound) {
          sock._geosafeAdminRescueMonitorBound = true;
          const refreshRescueMonitor = () => {
            if (state.currentSection === 'reports') loadReportsTable();
            if (state.currentSection === 'dashboard') loadDashboardOverview();
            const reportModal = document.getElementById('admin-report-modal');
            if (reportModal && !reportModal.classList.contains('hidden') && state.reports.activeDetail) {
              openReportDetailModal(state.reports.activeDetail.recordType, state.reports.activeDetail.id);
            }
          };
          sock.off('assignment:outcome', refreshRescueMonitor);
          sock.off('rescue:transport-updated', refreshRescueMonitor);
          sock.on('assignment:outcome', refreshRescueMonitor);
          sock.on('rescue:transport-updated', refreshRescueMonitor);
        }
      }
    } catch (err) {
      console.error('[Admin] Session authorization verification failed:', err);
      if (loadingEl) loadingEl.classList.add('hidden');
      if (unauthEl) unauthEl.classList.remove('hidden');
    }
  }

  async function loadAdminConversationsList({ silent = false } = {}) {
    const listEl = document.getElementById('admin-conv-list');
    const loadingEl = document.getElementById('admin-conv-loading');
    const emptyEl = document.getElementById('admin-conv-empty');
    const countBadge = document.getElementById('admin-conv-count-badge');
    if (!listEl || !window.geoSafeStore) return;

    if (!silent && loadingEl) loadingEl.classList.remove('hidden');
    if (!silent && emptyEl) emptyEl.classList.add('hidden');

    try {
      const data = await window.geoSafeStore.request('/messages/conversations', { method: 'GET' });
      const conversations = Array.isArray(data && data.conversations) ? data.conversations : [];
      state.messages.items = conversations;

      if (loadingEl) loadingEl.classList.add('hidden');
      if (countBadge) {
        countBadge.textContent = `${conversations.length} record${conversations.length === 1 ? '' : 's'}`;
      }
      if (emptyEl) {
        emptyEl.classList.toggle('hidden', conversations.length > 0);
      }

      if (!conversations.length) {
        listEl.innerHTML = '';
        return;
      }

      listEl.innerHTML = conversations
        .map((c) => {
          const isSelected = Number(c.id) === Number(state.messages.activeConversationId);
          const preview = c.lastMessagePreview
            ? escapeHtml(c.lastMessagePreview)
            : 'No messages exchanged yet';
          const timeStr = c.lastMessageAt ? formatManilaDateTime(c.lastMessageAt) : formatManilaDateTime(c.createdAt);
          const statusCls =
            c.conversationStatus === 'Active'
              ? 'bg-emerald-50 text-[#278653] border-emerald-200'
              : c.conversationStatus === 'Completed'
                ? 'bg-slate-100 text-slate-700 border-slate-200'
                : 'bg-rose-50 text-rose-700 border-rose-200';

          return `
            <button type="button" onclick="window.GeoSafeAdmin.selectAdminConversation(${c.id})"
              class="w-full p-3.5 text-left transition-colors flex items-start justify-between gap-2.5 ${isSelected ? 'bg-slate-50 border-l-4 border-l-[#F5B900]' : 'hover:bg-slate-50'
            }">
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-50 text-[#8A6800] border border-[#FFE872]">${escapeHtml(
              c.rescueReference
            )}</span>
                  <span class="text-xs font-bold text-[#202020] truncate">${escapeHtml(
              c.emergencyType
            )}</span>
                </div>
                <p class="text-[11px] text-[#202020]">
                  Resident: <strong>${escapeHtml(c.resident.name)}</strong> • Responder: <strong>${escapeHtml(
              c.responder.name
            )}</strong>
                </p>
                <p class="text-[11px] text-[#555555] truncate">${preview}</p>
                <span class="block text-[10px] text-[#777777]">${escapeHtml(timeStr)} • ${c.totalMessages
            } msg${c.totalMessages === 1 ? '' : 's'}</span>
              </div>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusCls} flex-shrink-0">${escapeHtml(
              c.conversationStatus
            )}</span>
            </button>
          `;
        })
        .join('');
    } catch (err) {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      console.error('[Admin] loadAdminConversationsList failed:', err.message);
    }
  }

  async function selectAdminConversation(conversationId, { silent = false } = {}) {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0 || !window.geoSafeStore) return;

    state.messages.activeConversationId = convId;
    loadAdminConversationsList({ silent: true });

    const placeholder = document.getElementById('admin-conv-detail-placeholder');
    const activeWrap = document.getElementById('admin-conv-detail-active');
    const bodyEl = document.getElementById('admin-conv-messages-body');
    if (!placeholder || !activeWrap || !bodyEl) return;

    try {
      const data = await window.geoSafeStore.request(
        `/messages/conversations/${convId}/messages`,
        { method: 'GET' }
      );
      const conv = data.conversation;
      const messages = Array.isArray(data.messages) ? data.messages : [];

      placeholder.classList.add('hidden');
      activeWrap.classList.remove('hidden');

      document.getElementById('admin-conv-hdr-ref').textContent = conv.rescueReference;
      document.getElementById('admin-conv-hdr-type').textContent = conv.emergencyType;
      document.getElementById('admin-conv-hdr-participants').textContent = `Resident: ${conv.resident.name} (${conv.resident.userCode}) • Responder: ${conv.responder.name} (${conv.responder.userCode})`;

      const statusEl = document.getElementById('admin-conv-hdr-status');
      if (statusEl) {
        const sCls =
          conv.conversationStatus === 'Active'
            ? 'bg-emerald-50 text-[#278653] border-emerald-200'
            : conv.conversationStatus === 'Completed'
              ? 'bg-slate-100 text-slate-700 border-slate-200'
              : 'bg-rose-50 text-rose-700 border-rose-200';
        statusEl.innerHTML = `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${sCls}">${escapeHtml(
          conv.conversationStatus
        )}</span>`;
      }

      if (!messages.length) {
        bodyEl.innerHTML =
          '<div class="py-10 text-center text-xs text-[#777777]">No messages recorded in this conversation.</div>';
        return;
      }

      bodyEl.innerHTML = messages
        .map((m) => {
          const isResponder = m.senderRole === 'Responder';
          return `
            <div class="p-3 rounded-md border ${isResponder
              ? 'bg-slate-50 border-[#FFE872]'
              : 'bg-white border-slate-200'
            } text-xs space-y-1">
              <div class="flex items-center justify-between gap-2 text-[10px] text-[#777777]">
                <span class="font-bold text-[#202020]">${escapeHtml(m.senderName)} <span class="text-[#8A6800]">(${escapeHtml(
              m.senderRole
            )})</span></span>
                <span>${escapeHtml(formatManilaDateTime(m.createdAt))}${m.isRead ? ' • Read' : ' • Sent'
            }</span>
              </div>
              <p class="text-[#202020] whitespace-pre-line leading-relaxed">${escapeHtml(m.body)}</p>
            </div>
          `;
        })
        .join('');

      if (!silent) {
        bodyEl.scrollTop = bodyEl.scrollHeight;
      }
    } catch (err) {
      showBannerMessage(err.message || 'Unable to load conversation transcript.', 'error');
    }
  }

  window.handleAdminLogout = async function () {
    if (window.geoSafeStore) {
      await window.geoSafeStore.logout();
    }
    window.location.replace('/login.html');
  };

  // ============================================================================
  // HEALTHCARE & HOSPITAL DIRECTORY MANAGEMENT
  // ============================================================================
  const adminFacilityMap = new Map();
  let isSavingFacility = false;

  function resetFacilityForm() {
    document.getElementById('fac-edit-id').value = '';
    document.getElementById('fac-form-title').textContent = 'Add Verified Hospital / Facility';
    const submitBtn = document.getElementById('fac-submit-btn');
    if (submitBtn) {
      submitBtn.textContent = 'Save Facility Record';
      submitBtn.disabled = false;
    }
    document.getElementById('fac-cancel-btn')?.classList.add('hidden');
    document.getElementById('fac-name').value = '';
    document.getElementById('fac-type').value = 'Hospital';
    document.getElementById('fac-verification').value = 'Verified';
    document.getElementById('fac-address').value = '';
    document.getElementById('fac-hours').value = '';
    document.getElementById('fac-lat').value = '';
    document.getElementById('fac-lng').value = '';
    document.getElementById('fac-status').value = 'Operational';
    document.getElementById('fac-emergency-capable').checked = false;
  }

  async function loadAdminFacilitiesList() {
    const listEl = document.getElementById('admin-facility-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="p-4 text-center text-slate-500">Loading facility directory from PostgreSQL...</div>';
    try {
      const data = await apiRequest('/facilities?includeInactive=true');
      const items = Array.isArray(data && data.facilities) ? data.facilities : [];
      adminFacilityMap.clear();
      items.forEach((f) => adminFacilityMap.set(Number(f.id), f));

      if (items.length === 0) {
        listEl.innerHTML = '<div class="p-4 text-center text-slate-500">No facility records found.</div>';
        return;
      }
      listEl.innerHTML = items.map((f) => {
        const badgeCls =
          f.verification_status === 'Verified'
            ? 'bg-emerald-50 text-[#278653] border-emerald-200'
            : f.verification_status === 'Flagged'
              ? 'bg-red-50 text-[#b91c1c] border-red-200'
              : 'bg-amber-50 text-amber-800 border-amber-200';
        const isClosed = f.status === 'Closed';
        return `
          <div class="p-3 rounded border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-1.5">
                <strong class="text-xs text-[#0f172a]">${escapeHtml(f.name)}</strong>
                <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">${escapeHtml(f.facility_type)}</span>
                <span class="px-1.5 py-0.5 rounded border text-[10px] font-bold ${badgeCls}">${escapeHtml(f.verification_status)}</span>
                <span class="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-[10px] font-medium text-slate-700">${escapeHtml(f.status)}</span>
              </div>
              <div class="text-[11px] text-slate-600 mt-0.5">${escapeHtml(f.address)}</div>
              <div class="text-[10px] text-slate-500 mt-0.5 font-mono">
                ${Number(f.latitude).toFixed(6)}, ${Number(f.longitude).toFixed(6)} &bull; Hours: ${escapeHtml(f.operating_hours || 'Unverified')}
              </div>
              ${f.coordinate_flag ? `<div class="text-[10px] text-[#b91c1c] font-semibold mt-0.5">${escapeHtml(f.coordinate_flag)}</div>` : ''}
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button type="button" onclick="window.GeoSafeAdmin.editAdminFacility(${Number(f.id)})"
                class="h-7 px-2.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold">
                Edit
              </button>
              <button type="button" onclick="window.GeoSafeAdmin.toggleFacilityActiveStatus(${Number(f.id)}, '${isClosed ? 'Operational' : 'Closed'}')"
                class="h-7 px-2.5 rounded border ${isClosed ? 'border-emerald-300 text-[#278653] hover:bg-emerald-50' : 'border-red-200 text-[#b91c1c] hover:bg-red-50'} text-[11px] font-semibold">
                ${isClosed ? 'Reactivate' : 'Deactivate'}
              </button>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      listEl.innerHTML = `<div class="p-4 text-center text-[#D93636]">${escapeHtml(err.message || 'Unable to load facilities.')}</div>`;
    }
  }

  function editAdminFacility(idOrObj) {
    const f = typeof idOrObj === 'object' && idOrObj !== null
      ? idOrObj
      : adminFacilityMap.get(Number(idOrObj));
    if (!f) {
      showBannerMessage('Unable to load the selected facility record.', 'error');
      return;
    }
    document.getElementById('fac-edit-id').value = String(f.id);
    document.getElementById('fac-form-title').textContent = 'Edit Healthcare Facility';
    const submitBtn = document.getElementById('fac-submit-btn');
    if (submitBtn) submitBtn.textContent = 'Update Facility';
    document.getElementById('fac-cancel-btn')?.classList.remove('hidden');

    document.getElementById('fac-name').value = f.name || '';
    document.getElementById('fac-type').value = f.facility_type || 'Hospital';
    document.getElementById('fac-verification').value = f.verification_status || 'Unverified';
    document.getElementById('fac-address').value = f.address || '';
    document.getElementById('fac-hours').value = f.operating_hours || 'Unverified';
    document.getElementById('fac-lat').value = f.latitude !== null && f.latitude !== undefined ? String(f.latitude) : '';
    document.getElementById('fac-lng').value = f.longitude !== null && f.longitude !== undefined ? String(f.longitude) : '';
    document.getElementById('fac-status').value = f.status || 'Under Assessment';
    document.getElementById('fac-emergency-capable').checked = Boolean(f.emergency_capable);

    document.getElementById('admin-facility-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveAdminFacility(event) {
    event.preventDefault();
    if (isSavingFacility) return;

    const editId = document.getElementById('fac-edit-id').value.trim();
    const name = document.getElementById('fac-name').value.trim();
    const address = document.getElementById('fac-address').value.trim();
    const lat = Number(document.getElementById('fac-lat').value);
    const lng = Number(document.getElementById('fac-lng').value);

    if (!name || !address) {
      showBannerMessage('Facility name and complete address are required.', 'error');
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
      showBannerMessage('Valid latitude and longitude are required.', 'error');
      return;
    }

    const payload = {
      name,
      facilityType: document.getElementById('fac-type').value,
      verificationStatus: document.getElementById('fac-verification').value,
      address,
      operatingHours: document.getElementById('fac-hours').value.trim() || 'Unverified',
      latitude: lat,
      longitude: lng,
      status: document.getElementById('fac-status').value,
      emergencyCapable: document.getElementById('fac-emergency-capable').checked,
    };

    const submitBtn = document.getElementById('fac-submit-btn');
    isSavingFacility = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = editId ? 'Updating...' : 'Saving...';
    }

    try {
      let res;
      if (editId) {
        res = await apiRequest(`/facilities/${encodeURIComponent(editId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
        if (!res || !res.success) throw new Error((res && res.error) || 'Failed to update facility record.');
        showBannerMessage(`Updated "${res.facility?.name || name}" in PostgreSQL.`, 'success');
      } else {
        res = await apiRequest('/facilities', { method: 'POST', body: JSON.stringify(payload) });
        if (!res || !res.success) throw new Error((res && res.error) || 'Failed to add facility record.');
        showBannerMessage(`Added "${res.facility?.name || name}" to PostgreSQL.`, 'success');
      }
      resetFacilityForm();
      await loadAdminFacilitiesList();
      await loadDashboardOverview();
    } catch (err) {
      showBannerMessage(err.message || 'Unable to save facility record.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = editId ? 'Update Facility' : 'Save Facility Record';
      }
    } finally {
      isSavingFacility = false;
    }
  }

  async function toggleFacilityActiveStatus(id, nextStatus) {
    try {
      const res = await apiRequest(`/facilities/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      if (!res || !res.success) throw new Error((res && res.error) || 'Unable to update facility status.');
      showBannerMessage(`Facility status updated to ${nextStatus}.`, 'success');
      await loadAdminFacilitiesList();
      await loadDashboardOverview();
    } catch (err) {
      showBannerMessage(err.message || 'Unable to update facility status.', 'error');
    }
  }

  // ============================================================================
  // PASSWORD ASSISTANCE TICKETS QUEUE & MODAL
  // ============================================================================
  const paQueueState = {
    statusFilter: 'pending',
    search: '',
    items: [],
    activeTicket: null,
    isSubmitting: false,
  };

  async function loadPasswordAssistanceTickets(opts = {}) {
    const tbody = document.getElementById('pa-tickets-tbody');
    const loadingEl = document.getElementById('pa-tickets-loading');
    const emptyEl = document.getElementById('pa-tickets-empty');
    const badgeEl = document.getElementById('pa-pending-badge');
    if (!tbody) return;

    if (!opts.silent && loadingEl) loadingEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    try {
      const params = new URLSearchParams({
        status: paQueueState.statusFilter || 'pending',
        search: paQueueState.search || '',
      });
      const data = await apiRequest(`/password-assistance?${params.toString()}`);
      const tickets = data.tickets || [];
      const counts = data.counts || { pending: 0 };
      paQueueState.items = tickets;

      const pendingCount = Number(counts.pending || 0);
      const navBadgeEl = document.getElementById('pa-nav-badge');
      if (navBadgeEl) {
        navBadgeEl.textContent = String(pendingCount);
        navBadgeEl.classList.toggle('hidden', pendingCount <= 0);
      }
      if (badgeEl) {
        badgeEl.textContent = `${pendingCount} Pending`;
        badgeEl.className = pendingCount > 0
          ? 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200'
          : 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200';
      }

      if (loadingEl) loadingEl.classList.add('hidden');

      if (!tickets.length) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }

      tbody.innerHTML = tickets.map((t) => {
        const submittedText = t.createdAt
          ? new Date(t.createdAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '—';
        const statusStyles = {
          pending: 'bg-amber-100 text-amber-800',
          in_review: 'bg-blue-100 text-blue-800',
          approved: 'bg-teal-100 text-teal-800',
          rejected: 'bg-red-100 text-red-700',
          resolved: 'bg-emerald-100 text-emerald-800',
        };
        const statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${statusStyles[t.status] || 'bg-slate-100 text-slate-700'} uppercase">${escapeHtml(String(t.status || '').replace('_', ' '))}</span>`;
        const shortDesc = String(t.description || '').length > 65
          ? `${String(t.description).slice(0, 65)}...`
          : String(t.description || '');

        return `
          <tr onclick="window.GeoSafeAdmin.openPasswordAssistanceModal(${Number(t.id)})" class="hover:bg-slate-50 transition-colors cursor-pointer">
            <td class="px-4 py-3 text-xs font-mono font-bold text-[#0B203B] whitespace-nowrap">${escapeHtml(t.ticketReference || '')}</td>
            <td class="px-4 py-3 text-xs">
              <div class="font-bold text-[#202020]">${escapeHtml(t.submittedName || '')}</div>
              <div class="text-[11px] text-[#64748B]">${escapeHtml(t.submittedEmail || '')}${t.submittedPhone ? ` • ${escapeHtml(t.submittedPhone)}` : ''}</div>
            </td>
            <td class="px-4 py-3 text-xs uppercase font-semibold text-[#475569] whitespace-nowrap">${escapeHtml(t.accountRole || '')}</td>
            <td class="px-4 py-3 text-xs text-[#334155] max-w-xs">${escapeHtml(shortDesc)}</td>
            <td class="px-4 py-3 text-xs text-[#475569] whitespace-nowrap">${escapeHtml(submittedText)}</td>
            <td class="px-4 py-3 text-xs whitespace-nowrap">${statusBadge}</td>
            <td class="px-4 py-3 text-xs text-right whitespace-nowrap">
              <button type="button" onclick="event.stopPropagation(); window.GeoSafeAdmin.openPasswordAssistanceModal(${Number(t.id)})"
                class="h-8 px-3 rounded-md bg-[#0B203B] hover:bg-[#164579] text-white text-[11px] font-bold transition-colors">
                Review Ticket
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      if (loadingEl) loadingEl.classList.add('hidden');
      console.error('[Admin] loadPasswordAssistanceTickets failed:', err.message);
    }
  }

  function openPasswordAssistanceModal(ticketId) {
    const ticket = paQueueState.items.find((t) => Number(t.id) === Number(ticketId));
    if (!ticket) return;
    paQueueState.activeTicket = ticket;

    const modal = document.getElementById('password-assistance-modal');
    const errBox = document.getElementById('pa-modal-error');
    const tempBox = document.getElementById('pa-temp-password-box');
    const tempVal = document.getElementById('pa-temp-password-value');
    const chk = document.getElementById('pa-identity-confirmed-chk');
    const reasonEl = document.getElementById('pa-modal-rejection-reason');
    const actionBox = document.getElementById('pa-action-controls-box');
    const reviewBtn = document.getElementById('pa-modal-review-btn');
    const existingBox = document.getElementById('pa-existing-decision-box');
    const existingTitle = document.getElementById('pa-existing-decision-title');
    const existingMeta = document.getElementById('pa-existing-decision-meta');
    const existingReason = document.getElementById('pa-existing-decision-reason');

    if (errBox) { errBox.textContent = ''; errBox.classList.add('hidden'); }
    if (tempBox) tempBox.classList.add('hidden');
    if (tempVal) tempVal.textContent = '';
    if (chk) chk.checked = false;
    if (reasonEl) reasonEl.value = '';

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || '—';
    };
    setText('pa-modal-subtitle', `${ticket.ticketReference} • ${String(ticket.status || '').toUpperCase()}`);
    setText('pa-detail-ref', ticket.ticketReference);
    setText('pa-detail-submitted', ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : '—');
    setText('pa-detail-name', ticket.submittedName);
    setText('pa-detail-email', ticket.submittedEmail);
    setText('pa-detail-phone', ticket.submittedPhone || 'Not provided');
    setText('pa-detail-role', ticket.accountRole);
    setText('pa-detail-status', String(ticket.status || '').replace('_', ' '));
    setText('pa-detail-description', ticket.description);

    const matchedInfoEl = document.getElementById('pa-matched-account-info');
    if (matchedInfoEl) {
      if (ticket.matchedAccount) {
        const m = ticket.matchedAccount;
        matchedInfoEl.innerHTML = `
          <div><strong>${escapeHtml(m.userCode)}</strong> • ${escapeHtml(m.name)} (${escapeHtml(m.role)})</div>
          <div class="text-[11px] text-[#64748B]">Email: ${escapeHtml(m.email)}${m.phone ? ` • Registered Mobile: ${escapeHtml(m.phone)}` : ''} • Status: <strong>${escapeHtml(m.accountStatus)}</strong></div>
        `;
      } else {
        matchedInfoEl.innerHTML = '<span class="text-red-700 font-semibold">No matching account found in PostgreSQL for this email address.</span>';
      }
    }

    const canAct = ['pending', 'in_review', 'approved'].includes(ticket.status);
    if (actionBox) actionBox.classList.toggle('hidden', !canAct);
    if (reviewBtn) reviewBtn.classList.toggle('hidden', ticket.status !== 'pending');

    if (!canAct && existingBox) {
      existingBox.classList.remove('hidden');
      existingBox.className = ticket.status === 'resolved'
        ? 'p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 space-y-1'
        : 'p-3.5 rounded-lg border border-red-200 bg-red-50 space-y-1';
      if (existingTitle) {
        existingTitle.textContent = ticket.status === 'resolved' ? 'Resolved — Temporary Password Issued' : 'Request Rejected';
      }
      if (existingMeta) {
        const revTime = ticket.reviewedAt ? new Date(ticket.reviewedAt).toLocaleString() : '—';
        existingMeta.textContent = `Reviewed by ${ticket.reviewedByName || 'Administrator'} on ${revTime}`;
      }
      if (existingReason) {
        existingReason.textContent = ticket.decisionReason ? `Note: ${ticket.decisionReason}` : '';
      }
    } else if (existingBox) {
      existingBox.classList.add('hidden');
    }

    if (modal) modal.classList.remove('hidden');
  }

  function closePasswordAssistanceModal() {
    const modal = document.getElementById('password-assistance-modal');
    if (modal) modal.classList.add('hidden');
    const tempVal = document.getElementById('pa-temp-password-value');
    if (tempVal) tempVal.textContent = '';
    paQueueState.activeTicket = null;
  }

  function setPaSubmitting(isBusy) {
    paQueueState.isSubmitting = isBusy;
    ['pa-modal-review-btn', 'pa-modal-approve-btn', 'pa-modal-reject-btn'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = isBusy;
    });
  }

  async function markSelectedTicketInReview() {
    if (!paQueueState.activeTicket || paQueueState.isSubmitting) return;
    const errBox = document.getElementById('pa-modal-error');
    if (errBox) errBox.classList.add('hidden');
    setPaSubmitting(true);
    try {
      await apiRequest(`/password-assistance/${encodeURIComponent(paQueueState.activeTicket.id)}/review`, { method: 'POST' });
      showBannerMessage(`Ticket ${paQueueState.activeTicket.ticketReference} marked In Review.`, 'info');
      await loadPasswordAssistanceTickets();
      openPasswordAssistanceModal(paQueueState.activeTicket.id);
    } catch (err) {
      if (errBox) { errBox.textContent = err.message || 'Unable to update ticket.'; errBox.classList.remove('hidden'); }
    } finally {
      setPaSubmitting(false);
    }
  }

  async function approveSelectedPasswordTicket() {
    if (!paQueueState.activeTicket || paQueueState.isSubmitting) return;
    const errBox = document.getElementById('pa-modal-error');
    const chk = document.getElementById('pa-identity-confirmed-chk');
    if (errBox) errBox.classList.add('hidden');

    if (!chk || !chk.checked) {
      if (errBox) {
        errBox.textContent = 'Please check the confirmation box verifying the applicant identity first.';
        errBox.classList.remove('hidden');
      }
      return;
    }

    setPaSubmitting(true);
    try {
      const data = await apiRequest(`/password-assistance/${encodeURIComponent(paQueueState.activeTicket.id)}/approve`, {
        method: 'POST',
        body: JSON.stringify({ identityVerified: true }),
      });
      const tempBox = document.getElementById('pa-temp-password-box');
      const tempVal = document.getElementById('pa-temp-password-value');
      const actionBox = document.getElementById('pa-action-controls-box');
      if (tempVal) tempVal.textContent = data.temporaryPassword || '';
      if (tempBox) tempBox.classList.remove('hidden');
      if (actionBox) actionBox.classList.add('hidden');
      showBannerMessage(`Temporary password issued for ${data.ticketReference}.`, 'success');
      await loadPasswordAssistanceTickets();
    } catch (err) {
      if (errBox) { errBox.textContent = err.message || 'Unable to approve ticket.'; errBox.classList.remove('hidden'); }
    } finally {
      setPaSubmitting(false);
    }
  }

  async function rejectSelectedPasswordTicket() {
    if (!paQueueState.activeTicket || paQueueState.isSubmitting) return;
    const errBox = document.getElementById('pa-modal-error');
    const reason = (document.getElementById('pa-modal-rejection-reason')?.value || '').trim();
    if (errBox) errBox.classList.add('hidden');

    if (reason.length < 5) {
      if (errBox) {
        errBox.textContent = 'Please enter a rejection reason (at least 5 characters).';
        errBox.classList.remove('hidden');
      }
      return;
    }

    setPaSubmitting(true);
    try {
      await apiRequest(`/password-assistance/${encodeURIComponent(paQueueState.activeTicket.id)}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      closePasswordAssistanceModal();
      showBannerMessage('Password assistance ticket rejected.', 'info');
      await loadPasswordAssistanceTickets();
    } catch (err) {
      if (errBox) { errBox.textContent = err.message || 'Unable to reject ticket.'; errBox.classList.remove('hidden'); }
    } finally {
      setPaSubmitting(false);
    }
  }

  window.GeoSafeAdmin = {
    loadPasswordAssistanceTickets,
    openPasswordAssistanceModal,
    closePasswordAssistanceModal,
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
    assignResponderFromModal,
    openCloseIncidentModal,
    closeCloseIncidentModal,
    handleCloseIncidentPresetChange,
    confirmCloseIncident,
    loadRespondersList,
    openAssignResponderModal,
    closeAssignResponderModal,
    submitAssignResponder,
    switchUsersRoleTab,
    loadUsersList,
    openUserStatusModal,
    closeUserStatusModal,
    openUserDocLightbox,
    closeUserDocLightbox,
    handleLocationStatusSelectChange,
    submitUserLocationVerification,
    enterLocationVerificationEditMode,
    cancelLocationVerificationEdit,
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
    handleExpirationDurationChange,
    updateBroadcastExpirationPreview,
    setBroadcastManagementTab,
    openBroadcastDetailModal,
    closeBroadcastDetailModal,
    cancelBroadcast,
    loadBroadcastsList,
    loadBroadcastCategories,
    promptNewBroadcastCategory,
    loadAnalyticsData,
    openAnalyticsExportModal,
    closeAnalyticsExportModal,
    selectAllExportCategories,
    clearExportCategories,
    generateAnalyticsExport,
    downloadAnalyticsCsv,
    printAnalyticsReport,
    emailAnalyticsSummary,
    scheduleAnalyticsReport,
    loadSystemSettings,
    saveSetting,
    loadAuditLogs,
    loadAdminConversationsList,
    selectAdminConversation,
    loadAdminFacilitiesList,
    resetFacilityForm,
    editAdminFacility,
    saveAdminFacility,
    toggleFacilityActiveStatus
  };

  document.addEventListener('DOMContentLoaded', initAdminPortal);
})(window);
