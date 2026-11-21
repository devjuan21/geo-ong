/**
 * GeoSafe - Responder Portal Navigation & Shell Component
 * ============================================================================
 * Strictly 4 Primary Navigation Items (Section 2):
 * 1. Dashboard (responder-dashboard.html)
 * 2. Assignments (responder-assignments.html)
 * 3. Map (responder-map.html)
 * 4. Hazard Alerts (responder-alerts.html)
 * 
 * - Mobile: Fixed 4-item bottom navigation bar with active yellow pill highlight.
 * - Desktop/Tablet: Responsive operational header with duty status switcher.
 * - Viewport-centered Toast Notifications (z-[70]).
 * - ZERO emojis.
 * ============================================================================
 */

const GeoSafeResponderUI = {
  // Exactly 4 Primary Navigation Destinations
  navItems: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Dashboard',
      href: 'responder-dashboard.html',
      icon: 'layout-grid'
    },
    {
      id: 'assignments',
      label: 'Reports/ Request',
      shortLabel: 'Reports/ Request',
      href: 'responder-assignments.html',
      icon: 'clipboard-list'
    },
    {
      id: 'map',
      label: 'Operations Map',
      shortLabel: 'Map',
      href: 'responder-map.html',
      icon: 'map-pin'
    },
    {
      id: 'alerts',
      label: 'Hazard Alerts',
      shortLabel: 'Alerts',
      href: 'responder-alerts.html',
      icon: 'alert-triangle'
    },
    {
      id: 'messages',
      label: 'Messages',
      shortLabel: 'Messages',
      href: 'responder-messages.html',
      icon: 'message-square'
    }
  ],

  // SVG Icon definitions (NO emojis)
  getIcon(name, extraClasses = 'w-5 h-5') {
    const icons = {
      'alert-triangle': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`,
      'message-square': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>`,
      'layout-grid': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke-width="2"></rect><rect x="14" y="3" width="7" height="7" rx="1.5" stroke-width="2"></rect><rect x="14" y="14" width="7" height="7" rx="1.5" stroke-width="2"></rect><rect x="3" y="14" width="7" height="7" rx="1.5" stroke-width="2"></rect></svg>`,
      'clipboard-list': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>`,
      'map-pin': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>`,
      'user-shield': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>`,
      'bell': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>`,
      'radio': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.93 4.93a10 10 0 0114.14 0m-11.31 2.83a6 6 0 018.48 0m-5.65 2.83a2 2 0 012.83 0M12 14v7m-3 0h6"></path></svg>`,
      'check-circle': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
      'alert-circle': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"></circle><line x1="12" y1="8" x2="12" y2="12" stroke-width="2" stroke-linecap="round"></line><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2" stroke-linecap="round"></line></svg>`,
      'x': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`,
      'navigation': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polygon points="3 11 22 2 13 21 11 13 3 11" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polygon></svg>`,
      'truck': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1" stroke-width="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" stroke-width="2"></polygon><circle cx="5.5" cy="18.5" r="2.5" stroke-width="2"></circle><circle cx="18.5" cy="18.5" r="2.5" stroke-width="2"></circle></svg>`
    };
    return icons[name] || '';
  },

  /**
   * Determine active page ID
   */
  resolveActivePageId(explicitId) {
    if (explicitId && this.navItems.some(i => i.id === explicitId)) {
      return explicitId;
    }
    if (typeof window !== 'undefined' && window.location) {
      const path = (window.location.pathname || '').toLowerCase();
      if (path.includes('assignment')) return 'assignments';
      if (path.includes('map')) return 'map';
      if (path.includes('alert')) return 'alerts';
      if (path.includes('message')) return 'messages';
      if (path.includes('profile')) return 'profile';
      if (path.includes('dashboard')) return 'dashboard';
    }
    return explicitId || 'dashboard';
  },

  /**
   * Inject shared responsive CSS for Desktop Sidebar (1024px+),
   * Mobile/Tablet Fixed Bottom Nav (<1024px), and safe-area spacing.
   */
  injectResponsiveLayoutStyles() {
    if (document.getElementById('geosafe-responder-layout-css')) return;
    const style = document.createElement('style');
    style.id = 'geosafe-responder-layout-css';
    style.textContent = `
      :root {
        --gs-resp-sidebar-width: 240px;
        --gs-resp-sidebar-collapsed-width: 76px;
        --gs-resp-bottom-nav-height: 64px;
      }

      body.gs-resp-shell {
        padding-top: 3.5rem;
      }

      /* Guarantee Operations Map container never collapses to 0px height */
      main.gs-resp-map-main {
        position: relative;
        width: 100%;
        min-height: 360px;
      }
      #responder-operational-map {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        min-height: 360px;
      }
      #responder-operational-map .leaflet-top {
        top: 3.75rem;
      }

      /* Desktop (1024px+): Fixed Left Sidebar + Offset Body */
      @media (min-width: 1024px) {
        body.gs-resp-shell {
          padding-left: var(--gs-resp-sidebar-width);
          transition: padding-left 250ms cubic-bezier(0.4, 0, 0.2, 1);
          overflow-x: hidden;
        }
        body.gs-resp-shell.gs-resp-sidebar-collapsed {
          padding-left: var(--gs-resp-sidebar-collapsed-width);
        }

        #geosafe-responder-top-header {
          left: var(--gs-resp-sidebar-width);
          transition: left 250ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        body.gs-resp-shell.gs-resp-sidebar-collapsed #geosafe-responder-top-header {
          left: var(--gs-resp-sidebar-collapsed-width);
        }

        #geosafe-responder-sidebar {
          display: flex;
          flex-direction: column;
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          width: var(--gs-resp-sidebar-width);
          background-color: #ffffff;
          border-right: 1px solid #EEEEEE;
          z-index: 40;
          transition: width 250ms cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
          box-shadow: 2px 0 12px rgba(32, 32, 32, 0.03);
        }
        body.gs-resp-shell.gs-resp-sidebar-collapsed #geosafe-responder-sidebar {
          width: var(--gs-resp-sidebar-collapsed-width);
        }

        body.gs-resp-shell.gs-resp-sidebar-collapsed .gs-resp-sidebar-text {
          display: none;
        }
        body.gs-resp-shell.gs-resp-sidebar-collapsed .gs-resp-sidebar-brand {
          justify-content: center;
          padding-left: 0.5rem;
          padding-right: 0.5rem;
        }
        body.gs-resp-shell.gs-resp-sidebar-collapsed .gs-resp-sidebar-link {
          justify-content: center;
          padding-left: 0;
          padding-right: 0;
        }
        body.gs-resp-shell.gs-resp-sidebar-collapsed .gs-resp-sidebar-footer-card {
          justify-content: center;
          padding: 0.5rem;
        }

        #geosafe-responder-bottom-nav {
          display: none !important;
        }
        .gs-resp-header-brand {
          display: none !important;
        }
        .gs-resp-sidebar-toggle {
          display: inline-flex !important;
        }
        main.gs-resp-main {
          padding-bottom: 2.5rem !important;
        }
        main.gs-resp-map-main {
          height: calc(100vh - 3.5rem) !important;
          height: calc(100dvh - 3.5rem) !important;
          padding-bottom: 0 !important;
        }
      }

      /* Mobile & Tablet (<1024px): Hidden Sidebar + Fixed Bottom Navigation */
      @media (max-width: 1023.98px) {
        body.gs-resp-shell {
          padding-left: 0 !important;
          overflow-x: hidden;
        }
        #geosafe-responder-sidebar {
          display: none !important;
        }
        #geosafe-responder-bottom-nav {
          display: block !important;
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        .gs-resp-sidebar-toggle {
          display: none !important;
        }
        main.gs-resp-main {
          padding-bottom: calc(6.5rem + env(safe-area-inset-bottom, 0px)) !important;
        }
        main.gs-resp-map-main {
          height: calc(100vh - 3.5rem - var(--gs-resp-bottom-nav-height) - env(safe-area-inset-bottom, 0px)) !important;
          height: calc(100dvh - 3.5rem - var(--gs-resp-bottom-nav-height) - env(safe-area-inset-bottom, 0px)) !important;
          padding-bottom: 0 !important;
        }
      }
    `;
    document.head.appendChild(style);
  },

  /**
   * Initialize navigation and shell for the active page
   */
  async init(activePageId, pageTitle = '') {
    const resolvedActiveId = this.resolveActivePageId(activePageId);
    this.activePageId = resolvedActiveId;

    this.injectResponsiveLayoutStyles();
    document.body.classList.add('gs-resp-shell');

    const savedCollapsed = localStorage.getItem('geosafe_responder_sidebar_collapsed') === 'true';
    if (savedCollapsed) {
      document.body.classList.add('gs-resp-sidebar-collapsed');
    }

    const mainEl = document.querySelector('main');
    if (mainEl && !mainEl.classList.contains('gs-resp-map-main')) {
      mainEl.classList.add('gs-resp-main');
    }

    this.renderDesktopSidebar(resolvedActiveId);
    this.renderTopNav(resolvedActiveId);
    this.renderMobileBottomNav(resolvedActiveId);
    this.setupToastContainer();
    this.renderNotificationsModal();
    this.renderDutyStatusModal();
    this.bindDropdownListeners();

    await this.syncHeaderResponderData();

    // Listen for availability changes
    window.addEventListener('geosafe:responder-availability', (e) => {
      this.updateAvailabilityBadges(e.detail.status);
    });

    if (!this._realtimeNotifBound) {
      this._realtimeNotifBound = true;
      const headerSyncEvents = new Set([
        'new-hazard-alert',
        'alert-broadcast',
        'hazard-alert-expired',
        'alert-expired',
        'hazard-alert-cancelled',
        'alert-cancelled',
        'new-incident-report',
        'new-report',
        'new-rescue-request',
        'rescue-assignment-updated',
        'rescue-status-updated',
        'assignment-updated',
        'report-verification-result',
        'status-update',
        'incident-resolved',
        'administrator-announcement',
        'reconnect-sync'
      ]);
      if (!this._seenNotifToastKeys) this._seenNotifToastKeys = new Set();
      window.addEventListener('geosafe:realtime-update', (ev) => {
        const evt = ev && ev.detail ? ev.detail.event : '';
        if (!headerSyncEvents.has(evt)) return;
        const payload = (ev && ev.detail && (ev.detail.data || ev.detail.payload)) || {};
        const refKey = payload.referenceNumber || payload.reference_number || payload.id || payload.reportId || payload.rescueId || '';
        const isCurrentlyViewingRef = (() => {
          if (!refKey) return false;
          try {
            const urlId = new URLSearchParams(window.location.search).get('id');
            if (urlId && String(urlId).toUpperCase() === String(refKey).toUpperCase()) {
              const dtlModal = document.getElementById('assign-details-modal');
              if (dtlModal && !dtlModal.classList.contains('hidden')) return true;
            }
            const dtlRefEl = document.getElementById('dtl-ref');
            const dtlModal = document.getElementById('assign-details-modal');
            if (dtlModal && !dtlModal.classList.contains('hidden') && dtlRefEl && dtlRefEl.textContent.trim().toUpperCase() === String(refKey).toUpperCase()) {
              return true;
            }
          } catch (_) {}
          return false;
        })();

        if (refKey && !isCurrentlyViewingRef) {
          const timeStr = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
          if (evt === 'new-incident-report' || evt === 'new-report') {
            const incKey = `incoming-inc:${refKey}`;
            if (!this._seenNotifToastKeys.has(incKey)) {
              this._seenNotifToastKeys.add(incKey);
              const cat = payload.incidentType || payload.incident_type || payload.category || 'Incident';
              const loc = payload.location || payload.address || 'Barangay Bayanan';
              const targetUrl = `./responder-assignments.html?id=${encodeURIComponent(refKey)}`;
              this.showToast(`${refKey} • ${cat} at ${loc} (${timeStr})`, 'warning', 7000, {
                title: 'New Incident Report Received',
                key: incKey,
                onClick: () => { window.location.href = targetUrl; },
              });
            }
          } else if (evt === 'new-rescue-request') {
            const resKey = `incoming-res:${refKey}`;
            if (!this._seenNotifToastKeys.has(resKey)) {
              this._seenNotifToastKeys.add(resKey);
              const cat = payload.emergencyType || payload.emergency_type || payload.category || 'Rescue Request';
              const loc = payload.location || payload.address || 'Barangay Bayanan';
              const targetUrl = `./responder-assignments.html?id=${encodeURIComponent(refKey)}`;
              this.showToast(`${refKey} • ${cat} at ${loc} (${timeStr})`, 'critical', 8000, {
                title: 'New Rescue Request Received',
                key: resKey,
                onClick: () => { window.location.href = targetUrl; },
              });
            }
          } else if (evt === 'assignment-updated') {
            const assignKey = `${evt}:${refKey}:${payload.responderId || ''}`;
            if (!this._seenNotifToastKeys.has(assignKey)) {
              this._seenNotifToastKeys.add(assignKey);
              if (Number(payload.responderId) === Number(this._currentUserId || 0)) {
                this.showToast(`Accepted & assigned to ${refKey}`, 'success');
              } else {
                this.showToast(`${refKey} was accepted by ${payload.responderName || 'another responder'}`, 'info');
              }
            }
          }
        }
        this.syncHeaderResponderData();
        const modal = document.getElementById('responder-notif-modal');
        if (modal && !modal.classList.contains('hidden')) {
          this.openNotificationsModal();
        }
      });
    }
  },

  /**
   * Toggle Desktop Sidebar Expanded/Collapsed state via Header Hamburger Button
   */
  toggleDesktopSidebar() {
    const isCollapsed = document.body.classList.toggle('gs-resp-sidebar-collapsed');
    localStorage.setItem('geosafe_responder_sidebar_collapsed', String(isCollapsed));

    const toggleBtn = document.getElementById('responder-sidebar-toggle-btn');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
      toggleBtn.setAttribute('title', isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar');
    }

    // Notify Leaflet maps after transition so map tiles/viewport resize cleanly
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 260);
  },

  /**
   * Render Desktop Fixed Left Sidebar (1024px+)
   */
  renderDesktopSidebar(activeId) {
    let sidebar = document.getElementById('geosafe-responder-sidebar');
    if (!sidebar) {
      sidebar = document.createElement('aside');
      sidebar.id = 'geosafe-responder-sidebar';
      sidebar.setAttribute('aria-label', 'Responder Navigation');
      document.body.insertBefore(sidebar, document.body.firstChild);
    }

    const navLinksHtml = this.navItems.map(item => {
      const isActive = item.id === activeId;
      return `
        <a
          href="${item.href}"
          title="${item.label}"
          class="gs-resp-sidebar-link flex items-center gap-3 px-3 py-2 rounded-md text-xs transition-colors ${
            isActive
              ? 'bg-slate-900 text-white font-semibold'
              : 'text-slate-600 font-medium hover:text-slate-900 hover:bg-slate-100'
          }"
        >
          <span class="flex-shrink-0 ${isActive ? 'text-amber-400' : 'text-slate-500'}">
            ${this.getIcon(item.icon, 'w-4 h-4')}
          </span>
          <span class="gs-resp-sidebar-text flex-1 truncate whitespace-nowrap">${item.label}</span>
          ${item.id === 'messages' ? '<span data-resp-nav-unread="messages" class="hidden gs-resp-sidebar-text px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white leading-none gs-tabular">0</span>' : ''}
        </a>
      `;
    }).join('');

    sidebar.innerHTML = `
      <!-- Top Brand & Responder Identification -->
      <div class="gs-resp-sidebar-brand h-14 px-4 border-b border-slate-200 flex items-center gap-2.5 flex-shrink-0">
        <a href="responder-dashboard.html" class="flex items-center gap-2.5 min-w-0 group" title="GeoSafe Responder Portal">
          <img src="./assets/icons/geosafe-logo.jpg" alt="GeoSafe Logo" class="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-slate-200" style="border-radius: 50%;">
          <div class="gs-resp-sidebar-text min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="gs-brand-nav font-bold text-sm tracking-tight text-slate-900">GeoSafe</span>
              <span class="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 uppercase tracking-wider">Responder</span>
            </div>
            <span id="sidebar-responder-unit" class="text-[10px] text-slate-500 font-medium block leading-tight truncate">Emergency Operations</span>
          </div>
        </a>
      </div>

      <!-- Navigation Section -->
      <div class="flex-1 overflow-y-auto px-3 py-3.5 space-y-1.5 custom-scrollbar">
        <div class="gs-resp-sidebar-text px-2.5 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Operations
        </div>
        <nav class="space-y-0.5" aria-label="Primary Responder Navigation">
          ${navLinksHtml}
        </nav>
      </div>

      <!-- Bottom Unit Card -->
      <div class="p-3 border-t border-slate-200 flex-shrink-0">
        <div class="gs-resp-sidebar-footer-card flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-slate-50 border border-slate-200">
          <span class="w-2 h-2 rounded-full bg-emerald-600 flex-shrink-0"></span>
          <div class="gs-resp-sidebar-text min-w-0">
            <span class="text-xs font-semibold text-slate-900 block truncate">Barangay Bayanan</span>
            <span class="text-[10px] text-slate-500 font-medium block truncate">Emergency Response</span>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Render Top Operational Header Bar (Aligned with content area)
   */
  renderTopNav(activeId) {
    const container = document.getElementById('geosafe-responder-nav-container');
    if (!container) return;

    const isCollapsed = document.body.classList.contains('gs-resp-sidebar-collapsed');

    container.innerHTML = `
      <header id="geosafe-responder-top-header" class="bg-white border-b border-slate-200 fixed top-0 left-0 right-0 z-30">
        <div class="w-full px-3 sm:px-5 lg:px-6">
          <div class="flex items-center justify-between h-14 gap-2">
            
            <!-- Left: Desktop Hamburger Toggle + Mobile Brand + Responder Identity -->
            <div class="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-hidden">
              <!-- Single Desktop Sidebar Toggle Button (1024px+ only) -->
              <button
                type="button"
                id="responder-sidebar-toggle-btn"
                onclick="GeoSafeResponderUI.toggleDesktopSidebar()"
                class="gs-resp-sidebar-toggle hidden items-center justify-center w-8 h-8 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors focus:outline-none flex-shrink-0"
                aria-label="Toggle navigation sidebar"
                aria-expanded="${String(!isCollapsed)}"
                title="${isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
                </svg>
              </button>

              <!-- Mobile/Tablet Brand (<1024px only; Desktop shows brand in Sidebar) -->
              <a href="responder-dashboard.html" class="gs-resp-header-brand flex items-center gap-2 group min-w-0 flex-1 lg:flex-initial">
                <img src="./assets/icons/geosafe-logo.jpg" alt="GeoSafe Logo" class="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-slate-200" style="border-radius: 50%;">
                <div class="min-w-0 flex-1 overflow-hidden">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="gs-brand-nav font-bold text-sm tracking-tight text-slate-900 truncate">GeoSafe</span>
                    <span class="hidden sm:inline-flex text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 uppercase flex-shrink-0">Responder</span>
                  </div>
                  <span id="header-responder-unit" class="text-[10px] text-slate-500 font-medium block leading-tight truncate">Emergency Operations</span>
                </div>
              </a>

              <!-- Responder Identity Display -->
              <div class="hidden sm:block lg:border-l-0 border-l border-slate-200 pl-2.5 lg:pl-0 min-w-0">
                <span class="text-[9px] text-slate-400 uppercase font-semibold tracking-wider block">Responder</span>
                <span id="header-responder-name" class="text-xs sm:text-sm font-semibold text-slate-900 tracking-tight block truncate max-w-[180px]">—</span>
              </div>
            </div>

            <!-- Right: Interactive Duty Status, Notifications & Profile Avatar -->
            <div class="flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
              
              <!-- Interactive Duty Status Pill -->
              <button type="button" onclick="GeoSafeResponderUI.openDutyStatusModal()" id="header-duty-btn" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] sm:text-xs font-semibold transition-colors border cursor-pointer bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200 whitespace-nowrap" title="Change Duty Availability">
                <span id="header-duty-dot" class="w-2 h-2 rounded-full bg-slate-400 flex-shrink-0"></span>
                <span id="header-duty-label">Not Configured</span>
                <svg class="w-3 h-3 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
              </button>

              <!-- Notification Bell with Unread Badge -->
              <button onclick="GeoSafeResponderUI.openNotificationsModal()" id="header-notif-btn" class="relative p-1.5 rounded-md text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none flex-shrink-0" title="Notifications">
                ${this.getIcon('bell', 'w-4 h-4 sm:w-5 sm:h-5')}
                <span id="header-notif-badge" class="hidden absolute top-1 right-1 w-2 h-2 rounded-full bg-red-600 ring-2 ring-white"></span>
              </button>

              <!-- Interactive Responder Profile Section & Dropdown -->
              <div class="relative flex-shrink-0" id="responder-header-profile-wrapper">
                <button
                  type="button"
                  id="responder-profile-menu-btn"
                  onclick="GeoSafeResponderUI.toggleProfileDropdown(event)"
                  class="flex items-center gap-1.5 p-1 sm:pl-1.5 sm:pr-2 rounded-md hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors focus:outline-none cursor-pointer group"
                  aria-haspopup="true"
                  aria-expanded="false"
                  title="Account menu"
                >
                  <div id="header-profile-avatar" class="w-7 h-7 rounded-md bg-slate-900 text-amber-400 font-bold text-xs flex items-center justify-center flex-shrink-0">
                    —
                  </div>
                  <div class="text-left hidden sm:block min-w-0">
                    <span id="header-responder-dropdown-name" class="text-xs font-semibold text-slate-900 block leading-tight truncate max-w-[130px]">Responder</span>
                    <span id="header-responder-dropdown-role" class="text-[10px] text-slate-500 font-medium block leading-tight">Responder</span>
                  </div>
                  <svg id="responder-profile-chevron" class="w-3.5 h-3.5 text-slate-400 transition-transform duration-200 group-hover:text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </button>

                <!-- Dropdown Menu -->
                <div
                  id="responder-profile-dropdown"
                  class="hidden absolute right-0 top-full mt-1.5 w-52 bg-white rounded-lg border border-slate-200 shadow-modal py-1 z-50 transform origin-top-right transition-all"
                  role="menu"
                  aria-orientation="vertical"
                >
                  <div class="px-3.5 py-2 border-b border-slate-100 sm:hidden">
                    <span id="header-responder-dropdown-name-mobile" class="text-xs font-semibold text-slate-900 block truncate">Responder</span>
                    <span id="header-responder-dropdown-role-mobile" class="text-[10px] text-slate-500 font-medium block">Responder</span>
                  </div>
                  <a
                    href="responder-profile.html"
                    id="responder-menu-item-profile"
                    role="menuitem"
                    class="flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                  >
                    <svg class="w-4 h-4 text-[#777777]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                    </svg>
                    <span>Profile</span>
                  </a>
                  <div class="my-1 border-t border-slate-200"></div>
                  <button
                    type="button"
                    id="responder-menu-item-logout"
                    role="menuitem"
                    onclick="GeoSafeResponderUI.handleLogout()"
                    class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-[#D93636] hover:bg-[#FFF1F1] transition-colors text-left"
                  >
                    <svg class="w-4 h-4 text-[#D93636]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
                    </svg>
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>

            </div>

          </div>
        </div>
      </header>
    `;
  },

  /**
   * Render Mobile Fixed Bottom Navigation Bar (Section 2: Exactly 4 Items)
   * Active item uses the GeoSafe yellow rounded pill highlight style.
   */
  renderMobileBottomNav(activeId) {
    let bottomNavContainer = document.getElementById('geosafe-responder-bottom-nav');
    if (!bottomNavContainer) {
      bottomNavContainer = document.createElement('nav');
      bottomNavContainer.id = 'geosafe-responder-bottom-nav';
      document.body.appendChild(bottomNavContainer);
    }

    bottomNavContainer.className = 'fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200';

    const itemsHtml = this.navItems.map(item => {
      const isActive = item.id === activeId;

      return `
        <a href="${item.href}" data-nav-id="${item.id}" class="flex-1 flex items-center justify-center py-1 px-1 focus:outline-none">
          <div class="w-full flex flex-col items-center justify-center py-1.5 px-2 rounded-md transition-colors ${
            isActive
              ? 'bg-slate-900 text-white'
              : 'bg-transparent hover:bg-slate-100 text-slate-600'
          }">
            <span class="gs-msg-icon-wrap transition-colors ${isActive ? 'text-amber-400' : 'text-slate-500'}">
              ${this.getIcon(item.icon, 'w-5 h-5')}
              ${item.id === 'messages' ? '<span data-resp-nav-unread="messages" class="gs-msg-badge hidden">0</span>' : ''}
            </span>
            <span class="gs-bottom-nav-label text-[10px] mt-0.5 whitespace-nowrap text-center tracking-tight transition-colors ${
              isActive ? 'font-semibold text-white' : 'font-medium text-slate-600'
            }">
              ${item.shortLabel}
            </span>
          </div>
        </a>
      `;
    }).join('');

    bottomNavContainer.innerHTML = `
      <div class="max-w-lg mx-auto flex items-center justify-around h-16 px-2">
        ${itemsHtml}
      </div>
    `;
  },

  /**
   * Verify authenticated responder session and role against the backend
   */
  async verifyResponderSession() {
    if (!window.geoSafeStore) return { authorized: false, profile: null, reason: 'store_missing' };
    try {
      const check = await window.geoSafeStore.verifySession('Responder');
      if (!check.authenticated) {
        window.location.replace('/login.html');
        return { authorized: false, profile: null, reason: 'unauthenticated' };
      }
      if (!check.authorized) {
        window.location.replace(check.redirectTo || '/login.html');
        return { authorized: false, profile: null, reason: 'unauthorized_role' };
      }
      const profile = check.profile || (await window.geoSafeStore.getResponderProfile());
      return { authorized: true, profile };
    } catch (err) {
      console.warn('[ResponderUI] Verification error:', err);
      return { authorized: false, profile: null, reason: 'error' };
    }
  },

  /**
   * Render unauthorized access block on responder pages
   */
  renderUnauthorizedScreen(container, message) {
    if (!container) return;
    container.innerHTML = `
      <div class="max-w-md mx-auto my-8 p-6 sm:p-8 bg-white rounded-lg border border-slate-200 shadow-subtle text-center space-y-4">
        <div class="w-14 h-14 rounded-lg bg-[#FFF1F1] border border-[#FFC2C2] text-[#D93636] flex items-center justify-center mx-auto shadow-subtle">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
        </div>
        <div>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2] uppercase mb-1">
            Restricted Operational Access
          </span>
          <h2 class="text-base sm:text-lg font-bold text-[#202020] tracking-tight">Responder Authentication Required</h2>
          <p class="text-xs text-[#777777] mt-1.5 leading-relaxed">
            ${message || 'This operations portal is restricted to authorized Barangay Bayanan emergency responders. To receive dispatch assignments, view coordinates, and submit situation reports, please authenticate with your responder credentials.'}
          </p>
        </div>

        <div class="pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-center gap-2">
          <a href="index.html" class="w-full sm:w-auto px-4 py-2.5 rounded-md bg-slate-100 hover:bg-slate-200 text-[#202020] text-xs font-bold transition-all text-center">
            Return to Resident Portal
          </a>
          <a href="login.html" class="w-full sm:w-auto px-4 py-2.5 rounded-md bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] text-xs font-bold shadow-subtle transition-all text-center">
            Sign In with Credentials
          </a>
        </div>
      </div>
    `;
  },

  /**
   * Sync Header with Real Authenticated Store Responder Data
   */
  async syncHeaderResponderData() {
    if (this._headerSyncPromise) return this._headerSyncPromise;
    this._headerSyncPromise = (async () => {
      try {
        if (!window.geoSafeStore) return;
        const profile = await window.geoSafeStore.getResponderProfile();

      const nameEl = document.getElementById('header-responder-name');
      const unitEl = document.getElementById('header-responder-unit');
      const sidebarUnitEl = document.getElementById('sidebar-responder-unit');
      const avatarEl = document.getElementById('header-profile-avatar');

      if (!profile || profile.role !== 'Responder') {
        if (nameEl) nameEl.textContent = 'Not Signed In';
        if (unitEl) unitEl.textContent = 'Access Restricted';
        if (sidebarUnitEl) sidebarUnitEl.textContent = 'Access Restricted';
        if (avatarEl) avatarEl.textContent = '—';
        this.updateAvailabilityBadges('Not Set');
        return;
      }

      const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Responder';
      const roleName = profile.role || 'Responder';

      if (nameEl) {
        nameEl.textContent = fullName;
      }
      const dropdownName = document.getElementById('header-responder-dropdown-name');
      const dropdownNameMobile = document.getElementById('header-responder-dropdown-name-mobile');
      const dropdownRole = document.getElementById('header-responder-dropdown-role');
      const dropdownRoleMobile = document.getElementById('header-responder-dropdown-role-mobile');

      if (dropdownName) dropdownName.textContent = fullName;
      if (dropdownNameMobile) dropdownNameMobile.textContent = fullName;
      if (dropdownRole) dropdownRole.textContent = roleName;
      if (dropdownRoleMobile) dropdownRoleMobile.textContent = roleName;

      const unitLabel = profile.assignedUnit || profile.department || 'Emergency Operations';
      if (unitEl) {
        unitEl.textContent = unitLabel;
      }
      if (sidebarUnitEl) {
        sidebarUnitEl.textContent = unitLabel;
      }
      if (avatarEl) {
        let initials = '';
        if (profile.firstName) initials += profile.firstName.trim()[0];
        if (profile.lastName) initials += profile.lastName.trim()[0];
        avatarEl.textContent = (initials || '—').toUpperCase();
      }

      if (profile.availability) {
        this.updateAvailabilityBadges(profile.availability);
      } else {
        this.updateAvailabilityBadges('Not Set');
      }

      // Check for unread notifications
      const notifs = await window.geoSafeStore.getNotifications('Unread');
      const badge = document.getElementById('header-notif-badge');
      if (badge) {
        if (notifs && notifs.length > 0) {
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }

      // Ensure live GPS sync runs across all responder pages (including Messages & Profile)
      this.startGlobalResponderGpsSync();

      // Sync unread messages badge
      await this.refreshMessagesUnreadBadge();
      if (!this._respMsgUnreadListenerBound) {
        this._respMsgUnreadListenerBound = true;
        window.addEventListener('geosafe:realtime-update', (ev) => {
          const evt = ev && ev.detail ? ev.detail.event : '';
          if (['conversation:new-message', 'messages:unread-update', 'messages:incoming-notification', 'conversation:messages-read', 'reconnect-sync'].includes(evt)) {
            this.refreshMessagesUnreadBadge();
          }
        });
      }
      } catch (err) {
        console.warn('[ResponderUI] Error syncing header responder data:', err);
      }
    })();
    try {
      return await this._headerSyncPromise;
    } finally {
      this._headerSyncPromise = null;
    }
  },

  async refreshMessagesUnreadBadge() {
    if (!window.geoSafeStore) return;
    try {
      const msgUnreadRes = await window.geoSafeStore.request('/messages/unread-count', { method: 'GET' }).catch(() => null);
      const unreadMsgCount = Number((msgUnreadRes && msgUnreadRes.unreadCount) || 0);
      document.querySelectorAll('[data-resp-nav-unread="messages"]').forEach((el) => {
        el.textContent = unreadMsgCount > 99 ? '99+' : String(unreadMsgCount);
        el.classList.toggle('hidden', unreadMsgCount <= 0);
      });
    } catch (_) {}
  },

  startGlobalResponderGpsSync() {
    if (
      this._globalGpsWatchId !== undefined ||
      typeof navigator === 'undefined' ||
      !navigator.geolocation ||
      window.isSecureContext === false
    ) {
      return;
    }

    const pushReading = (pos) => {
      if (!pos || !pos.coords || !window.geoSafeStore || typeof window.geoSafeStore.syncResponderLocation !== 'function') return;
      let sharingEnabled = true;
      try { sharingEnabled = localStorage.getItem('geosafe_responder_location_sharing') !== 'false'; } catch (_) {}
      if (!sharingEnabled) return;

      const now = Date.now();
      if (now - Number(window.__geosafeLastRespGpsSyncAt || 0) < 9500) return;
      window.__geosafeLastRespGpsSyncAt = now;

      window.geoSafeStore.syncResponderLocation({
        lat: Number(pos.coords.latitude),
        lng: Number(pos.coords.longitude),
        accuracy: Number.isFinite(Number(pos.coords.accuracy)) ? Number(pos.coords.accuracy) : null,
        sharingEnabled: true,
      }).catch(() => {});
    };

    try {
      this._globalGpsWatchId = navigator.geolocation.watchPosition(
        pushReading,
        () => {},
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
      );
      window.addEventListener('beforeunload', () => {
        if (this._globalGpsWatchId !== undefined && navigator.geolocation) {
          try { navigator.geolocation.clearWatch(this._globalGpsWatchId); } catch (_) {}
        }
      }, { once: true });
    } catch (_) {}
  },

  /**
   * Update availability badges and styling across the UI
   */
  updateAvailabilityBadges(status) {
    const btn = document.getElementById('header-duty-btn');
    const dot = document.getElementById('header-duty-dot');
    const label = document.getElementById('header-duty-label');

    if (!btn || !dot || !label) return;

    label.textContent = status || 'Not Set';

    if (status === 'On Duty') {
      btn.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all shadow-subtle border cursor-pointer bg-emerald-50 text-[#278653] border-emerald-200 hover:bg-emerald-100';
      dot.className = 'w-2 h-2 rounded-full bg-[#278653] animate-pulse';
    } else if (status === 'Off Duty') {
      btn.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all shadow-subtle border cursor-pointer bg-slate-100 text-[#777777] border-slate-200 hover:bg-slate-200';
      dot.className = 'w-2 h-2 rounded-full bg-[#777777]';
    } else if (status === 'On Break' || status === 'Unavailable') {
      label.textContent = 'On Break';
      btn.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all shadow-subtle border cursor-pointer bg-amber-50 text-[#E99524] border-amber-200 hover:bg-amber-100';
      dot.className = 'w-2 h-2 rounded-full bg-[#E99524]';
    } else {
      // Neutral unconfigured / Standby / Not Set state
      btn.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all shadow-subtle border cursor-pointer bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200';
      dot.className = 'w-2 h-2 rounded-full bg-slate-400';
    }
  },

  /**
   * Profile Dropdown Controls (Section 1 & 2: Interactive Header Dropdown)
   */
  toggleProfileDropdown(event) {
    if (event) {
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }
    const dropdown = document.getElementById('responder-profile-dropdown');
    const chevron = document.getElementById('responder-profile-chevron');
    const btn = document.getElementById('responder-profile-menu-btn');
    if (!dropdown) return;

    const isHidden = dropdown.classList.contains('hidden');
    if (isHidden) {
      this.closeAllDropdowns();
      dropdown.classList.remove('hidden');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      if (chevron) chevron.classList.add('rotate-180');
    } else {
      this.closeProfileDropdown();
    }
  },

  closeProfileDropdown() {
    const dropdown = document.getElementById('responder-profile-dropdown');
    const chevron = document.getElementById('responder-profile-chevron');
    const btn = document.getElementById('responder-profile-menu-btn');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      dropdown.classList.add('hidden');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (chevron) chevron.classList.remove('rotate-180');
    }
  },

  closeAllDropdowns() {
    document.querySelectorAll('[id$="-profile-dropdown"]').forEach(dd => {
      dd.classList.add('hidden');
    });
    document.querySelectorAll('[id$="-profile-chevron"]').forEach(ch => {
      ch.classList.remove('rotate-180');
    });
    document.querySelectorAll('[id$="-profile-menu-btn"]').forEach(btn => {
      btn.setAttribute('aria-expanded', 'false');
    });
  },

  bindDropdownListeners() {
    if (this._dropdownListenersBound) return;
    this._dropdownListenersBound = true;

    if (typeof document !== 'undefined') {
      document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('responder-header-profile-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
          this.closeProfileDropdown();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'Esc') {
          this.closeProfileDropdown();
        }
      });
    }
  },

  async handleLogout() {
    if (window.geoSafeStore) {
      if (typeof window.geoSafeStore.logoutResponder === 'function') {
        await window.geoSafeStore.logoutResponder();
      } else {
        await window.geoSafeStore.logout();
      }
    }
    window.location.replace('/login.html');
  },

  /**
   * Setup fixed viewport-centered toast container
   */
  setupToastContainer() {
    // The shared GeoSafeToast system (toast.js) owns the top-right container.
    if (typeof window !== 'undefined' && window.GeoSafeToast) return;
    let container = document.getElementById('geosafe-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'geosafe-toast-container';
      container.className = 'fixed left-1/2 -translate-x-1/2 z-[70] bottom-20 md:bottom-8 w-11/12 max-w-md pointer-events-none flex flex-col items-center gap-2 transition-all';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('role', 'status');
      document.body.appendChild(container);
    }
  },

  /**
   * Trigger a modern viewport-centered notification toast
   */
  showToast(message, type = 'info', duration = 4000, extra = {}) {
    if (typeof window !== 'undefined' && window.GeoSafeToast) {
      return window.GeoSafeToast.show({
        message,
        type,
        duration,
        ...(extra && typeof extra === 'object' ? extra : {}),
      });
    }
    this.setupToastContainer();
    const container = document.getElementById('geosafe-toast-container');
    if (!container) return;

    const styles = {
      success: { bg: 'bg-[#278653]', icon: this.getIcon('check-circle', 'w-4 h-4 text-white') },
      error: { bg: 'bg-[#D93636]', icon: this.getIcon('alert-circle', 'w-4 h-4 text-white') },
      warning: { bg: 'bg-[#E99524]', icon: this.getIcon('alert-circle', 'w-4 h-4 text-white') },
      info: { bg: 'bg-[#202020]', icon: this.getIcon('radio', 'w-4 h-4 text-[#F5B900]') }
    };

    const cfg = styles[type] || styles.info;

    const toast = document.createElement('div');
    toast.className = `${cfg.bg} text-white px-4 py-2.5 rounded-lg shadow-modal flex items-center gap-3 text-xs sm:text-sm font-semibold pointer-events-auto transform transition-all duration-300 translate-y-2 opacity-0 max-w-full`;
    toast.innerHTML = `
      <div class="flex-shrink-0">${cfg.icon}</div>
      <span class="flex-1 leading-snug break-words">${message}</span>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
    });

    setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('translate-y-2', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  /**
   * Render Notifications Modal for Responders
   */
  renderNotificationsModal() {
    let modal = document.getElementById('responder-notif-modal');
    if (modal) return;

    modal = document.createElement('div');
    modal.id = 'responder-notif-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm hidden';
    modal.innerHTML = `
      <div class="bg-white rounded-lg max-w-md w-full p-4 sm:p-5 shadow-modal border border-slate-200 max-h-[85vh] flex flex-col">
        <div class="flex items-center justify-between pb-3 border-b border-slate-200">
          <div class="flex items-center gap-2">
            ${this.getIcon('bell', 'w-4 h-4 text-amber-600')}
            <div>
              <h3 class="font-semibold text-sm text-slate-900">Dispatch Notifications</h3>
              <p class="text-[11px] text-slate-500">Operational alerts & assignment events</p>
            </div>
          </div>
          <button onclick="GeoSafeResponderUI.closeNotificationsModal()" class="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 transition-colors">
            ${this.getIcon('x', 'w-4 h-4')}
          </button>
        </div>

        <div id="responder-notif-list" class="flex-1 overflow-y-auto py-3 space-y-2 custom-scrollbar">
          <div class="py-6 text-center text-xs text-slate-500">Checking notifications...</div>
        </div>

        <div class="pt-2.5 border-t border-slate-200 flex items-center justify-between text-xs">
          <button type="button" onclick="GeoSafeResponderUI.markAllRead()" class="font-semibold text-slate-700 hover:text-slate-900">Mark all as read</button>
          <button type="button" onclick="GeoSafeResponderUI.closeNotificationsModal()" class="gs-btn-secondary py-1 px-3">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  async openNotificationsModal() {
    const modal = document.getElementById('responder-notif-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    const listEl = document.getElementById('responder-notif-list');
    if (!listEl) return;

    const escapeTxt = (val) => String(val || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    try {
      const notifs = await window.geoSafeStore.getNotifications('All');
      this._loadedNotifs = Array.isArray(notifs) ? notifs : [];
      if (this._loadedNotifs.length === 0) {
        listEl.innerHTML = `
          <div class="py-8 text-center text-xs text-[#777777]">
            <p class="font-semibold text-[#202020]">No notifications available.</p>
            <p class="text-[11px] mt-0.5">Dispatch assignments and emergency broadcasts will appear here.</p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = this._loadedNotifs.map(n => {
        const badgeLabel = n.advisoryType || (n.category ? n.category.toUpperCase() : 'ALERT');
        const isUnread = !n.read;
        return `
          <div onclick="GeoSafeResponderUI.viewNotificationDetail('${escapeTxt(n.id)}')" role="button" tabindex="0"
            class="p-3 rounded-md border cursor-pointer transition-colors hover:border-slate-300 ${isUnread ? 'bg-amber-50/50 border-amber-200' : 'bg-white border-slate-200'} space-y-1">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 uppercase flex-shrink-0">${escapeTxt(badgeLabel)}</span>
                ${isUnread ? '<span class="w-2 h-2 rounded-full bg-red-600 flex-shrink-0" title="Unread"></span>' : ''}
              </div>
              <span class="text-[10px] text-slate-500 whitespace-nowrap gs-tabular">${GeoSafeResponderUI.formatRelativeTime(n.timestamp)}</span>
            </div>
            <div class="font-semibold text-xs text-slate-900">${escapeTxt(n.title)}</div>
            <p class="text-[11px] text-slate-600 leading-relaxed line-clamp-2">${escapeTxt(n.description)}</p>
          </div>
        `;
      }).join('');
    } catch (err) {
      listEl.innerHTML = `<div class="py-4 text-center text-xs text-[#D93636]">Could not load notifications.</div>`;
    }
  },

  async viewNotificationDetail(notifId) {
    const listEl = document.getElementById('responder-notif-list');
    const n = (this._loadedNotifs || []).find((item) => String(item.id) === String(notifId));
    if (!listEl || !n) return;

    const escapeTxt = (val) => String(val || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    if (!n.read && window.geoSafeStore) {
      try {
        await window.geoSafeStore.markNotificationAsRead(n.id);
        n.read = true;
        await this.syncHeaderResponderData();
      } catch (_) {}
    }

    const badgeLabel = n.advisoryType || (n.category ? n.category.toUpperCase() : 'ALERT');
    let targetActionUrl = n.actionUrl || '';
    if (!targetActionUrl) {
      const refMatch = `${n.title || ''} ${n.description || ''}`.match(/\b(?:INC|RES|REP)-\d{4}-\d+\b/i);
      if (refMatch) {
        targetActionUrl = `./responder-assignments.html?id=${encodeURIComponent(refMatch[0].toUpperCase())}`;
      }
    } else if (targetActionUrl.startsWith('/')) {
      targetActionUrl = `.${targetActionUrl}`;
    }

    listEl.innerHTML = `
      <div class="space-y-3">
        <button type="button" onclick="GeoSafeResponderUI.openNotificationsModal()"
          class="inline-flex items-center gap-1 text-xs font-bold text-[#8A6800] hover:text-[#202020]">
          <span>← Back to Notifications</span>
        </button>
        <div class="p-4 rounded-lg bg-slate-50 border border-[#FFE872] space-y-2">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-slate-50 text-[#8A6800] border border-[#FFE872] uppercase">${escapeTxt(badgeLabel)}</span>
            <span class="text-[10px] text-[#777777]">${GeoSafeResponderUI.formatRelativeTime(n.timestamp)}</span>
          </div>
          <h4 class="text-sm font-bold text-[#202020]">${escapeTxt(n.title)}</h4>
          <p class="text-xs text-[#333333] whitespace-pre-line leading-relaxed">${escapeTxt(n.description)}</p>
          ${targetActionUrl ? `
            <div class="pt-2">
              <a href="${escapeTxt(targetActionUrl)}" onclick="GeoSafeResponderUI.closeNotificationsModal()"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] font-bold text-xs shadow-subtle transition-colors">
                <span>Open Operational Details</span>
                <span>→</span>
              </a>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  },

  closeNotificationsModal() {
    document.getElementById('responder-notif-modal')?.classList.add('hidden');
  },

  async markAllRead() {
    if (window.geoSafeStore) {
      await window.geoSafeStore.markAllNotificationsAsRead();
      this.showToast('All notifications marked as read.', 'success');
      document.getElementById('header-notif-badge')?.classList.add('hidden');
      this.closeNotificationsModal();
    }
  },

  /**
   * Duty Status Modal for quick availability switching (Section 7)
   */
  renderDutyStatusModal() {
    let modal = document.getElementById('duty-status-modal');
    if (modal) return;

    modal = document.createElement('div');
    modal.id = 'duty-status-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm hidden';
    modal.innerHTML = `
      <div class="bg-white rounded-lg max-w-sm w-full p-4 sm:p-5 shadow-modal border border-slate-200">
        <div class="flex items-center justify-between pb-3 border-b border-slate-200">
          <h3 class="font-semibold text-sm text-slate-900">Update Duty Availability</h3>
          <button onclick="GeoSafeResponderUI.closeDutyStatusModal()" class="p-1 rounded-md text-slate-500 hover:bg-slate-100">
            ${this.getIcon('x', 'w-4 h-4')}
          </button>
        </div>

        <p class="text-xs text-slate-600 my-3">
          Your availability determines dispatch priority and EOC operational assignment in Barangay Bayanan.
        </p>

        <div class="space-y-2">
          <button type="button" data-duty-option="On Duty" onclick="GeoSafeResponderUI.selectDutyOption('On Duty')" class="w-full p-3 rounded-md border border-emerald-200 hover:border-emerald-500 bg-emerald-50/50 text-left transition-colors flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span data-duty-check="On Duty" class="w-5 h-5 rounded-full border-2 border-slate-300 bg-white flex items-center justify-center flex-shrink-0 transition-colors">
                <svg class="w-3 h-3 text-white hidden" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
              </span>
              <div>
                <span class="font-semibold text-xs text-slate-900 block">On Duty</span>
                <span class="text-[11px] text-slate-500">Available for active emergency dispatch</span>
              </div>
            </div>
            <span class="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">Active</span>
          </button>

          <button type="button" data-duty-option="On Break" onclick="GeoSafeResponderUI.selectDutyOption('On Break')" class="w-full p-3 rounded-md border border-amber-200 hover:border-amber-400 bg-amber-50/50 text-left transition-colors flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span data-duty-check="On Break" class="w-5 h-5 rounded-full border-2 border-slate-300 bg-white flex items-center justify-center flex-shrink-0 transition-colors">
                <svg class="w-3 h-3 text-white hidden" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
              </span>
              <div>
                <span class="font-semibold text-xs text-slate-900 block">On Break</span>
                <span class="text-[11px] text-slate-500">Meal break, vehicle maintenance, or on-task</span>
              </div>
            </div>
            <span class="text-[10px] font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">Standby</span>
          </button>

          <button type="button" data-duty-option="Off Duty" onclick="GeoSafeResponderUI.selectDutyOption('Off Duty')" class="w-full p-3 rounded-md border border-slate-200 hover:border-slate-300 bg-slate-50 text-left transition-colors flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span data-duty-check="Off Duty" class="w-5 h-5 rounded-full border-2 border-slate-300 bg-white flex items-center justify-center flex-shrink-0 transition-colors">
                <svg class="w-3 h-3 text-white hidden" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
              </span>
              <div>
                <span class="font-semibold text-xs text-slate-900 block">Off Duty</span>
                <span class="text-[11px] text-slate-500">Shift concluded; not dispatched</span>
              </div>
            </div>
            <span class="text-[10px] font-semibold text-slate-600 bg-slate-200 px-2 py-0.5 rounded">Off</span>
          </button>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button type="button" onclick="GeoSafeResponderUI.closeDutyStatusModal()" class="px-4 py-1.5 rounded-md text-xs font-bold bg-slate-100 text-[#202020] hover:bg-slate-200">
            Cancel
          </button>
          <button type="button" id="duty-status-save-btn" onclick="GeoSafeResponderUI.saveDutyStatus()" class="px-4 py-1.5 rounded-md text-xs font-bold bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] shadow-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            Save
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  selectDutyOption(status) {
    this.pendingDutyStatus = status;
    this.syncDutyModalSelection(status);
  },

  syncDutyModalSelection(currentStatus) {
    const activeColors = {
      'On Duty': { check: 'bg-[#278653] border-[#278653]', card: 'ring-2 ring-emerald-400/50 border-emerald-500' },
      'On Break': { check: 'bg-[#E99524] border-[#E99524]', card: 'ring-2 ring-amber-400/50 border-amber-500' },
      'Off Duty': { check: 'bg-slate-600 border-slate-600', card: 'ring-2 ring-slate-400/50 border-slate-400' },
    };
    const normalized = currentStatus === 'Unavailable' ? 'On Break' : currentStatus;
    document.querySelectorAll('#duty-status-modal [data-duty-option]').forEach((btn) => {
      const opt = btn.getAttribute('data-duty-option');
      const isSelected = opt === normalized;
      const checkEl = btn.querySelector('[data-duty-check]');
      const svgEl = checkEl ? checkEl.querySelector('svg') : null;

      btn.classList.remove('ring-2', 'ring-emerald-400/50', 'border-emerald-500', 'ring-amber-400/50', 'border-amber-500', 'ring-slate-400/50', 'border-slate-400');
      if (isSelected && activeColors[opt]) {
        btn.classList.add(...activeColors[opt].card.split(' '));
      }

      if (checkEl) {
        checkEl.className = `w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
          isSelected && activeColors[opt] ? activeColors[opt].check : 'border-slate-300 bg-white'
        }`;
      }
      if (svgEl) {
        svgEl.classList.toggle('hidden', !isSelected);
      }
    });
  },

  openDutyStatusModal() {
    const currentStatus = document.getElementById('responder-duty-label')?.textContent?.trim() || '';
    const normalized = currentStatus === 'Unavailable' ? 'On Break' : currentStatus;
    this.pendingDutyStatus = normalized;
    this.syncDutyModalSelection(normalized);
    document.getElementById('duty-status-modal')?.classList.remove('hidden');
  },

  closeDutyStatusModal() {
    document.getElementById('duty-status-modal')?.classList.add('hidden');
  },

  async saveDutyStatus() {
    const status = this.pendingDutyStatus;
    if (!status) {
      this.showToast('Please select a duty availability option.', 'error');
      return;
    }
    const saveBtn = document.getElementById('duty-status-save-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }
    try {
      await this.setDutyStatus(status);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    }
  },

  async setDutyStatus(status) {
    try {
      if (window.geoSafeStore) {
        await window.geoSafeStore.updateResponderAvailability(status);
        this.updateAvailabilityBadges(status);
        this.showToast(`Availability updated to "${status}".`, 'success');
        this.closeDutyStatusModal();
      }
    } catch (err) {
      this.showToast(err.message || 'Could not update availability.', 'error');
    }
  },

  renderResponderLoginModal() {
    let modal = document.getElementById('responder-auth-modal');
    if (modal) return;

    modal = document.createElement('div');
    modal.id = 'responder-auth-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm hidden';
    modal.innerHTML = `
      <div class="bg-white rounded-lg max-w-sm w-full p-5 sm:p-6 shadow-modal border border-slate-200">
        <div class="flex items-center justify-between pb-3 border-b border-slate-200">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-md bg-slate-50 border border-[#FFE872] text-[#8A6800] flex items-center justify-center">
              <svg class="w-4 h-4 text-[#F5B900]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            </div>
            <div>
              <h3 class="font-bold text-sm text-[#202020]">Responder Sign In</h3>
              <p class="text-[10px] text-[#777777]">Authorized BDRRMC Personnel</p>
            </div>
          </div>
          <button onclick="GeoSafeResponderUI.closeResponderLoginModal()" class="p-1 rounded-md text-[#777777] hover:bg-slate-100">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <form id="responder-auth-form" onsubmit="GeoSafeResponderUI.handleResponderLoginSubmit(event)" class="space-y-3.5 mt-3.5 text-xs">
          <div>
            <label class="block font-bold text-[#202020] mb-1">Responder ID / Badge #</label>
            <input type="text" id="auth-resp-id" required placeholder="e.g. RESP-2026-001" class="w-full px-3 py-2 rounded-md border border-slate-200 text-[#202020] focus:ring-2 focus:ring-[#F5B900] focus:outline-none">
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block font-bold text-[#202020] mb-1">First Name</label>
              <input type="text" id="auth-resp-first" required placeholder="First name" class="w-full px-3 py-2 rounded-md border border-slate-200 text-[#202020] focus:ring-2 focus:ring-[#F5B900] focus:outline-none">
            </div>
            <div>
              <label class="block font-bold text-[#202020] mb-1">Last Name</label>
              <input type="text" id="auth-resp-last" required placeholder="Last name" class="w-full px-3 py-2 rounded-md border border-slate-200 text-[#202020] focus:ring-2 focus:ring-[#F5B900] focus:outline-none">
            </div>
          </div>

          <div>
            <label class="block font-bold text-[#202020] mb-1">Assigned Department / Team</label>
            <input type="text" id="auth-resp-unit" required placeholder="e.g. BDRRMC Quick Response Unit" class="w-full px-3 py-2 rounded-md border border-slate-200 text-[#202020] focus:ring-2 focus:ring-[#F5B900] focus:outline-none">
          </div>

          <div class="pt-2 border-t border-slate-200 flex items-center justify-end gap-2">
            <button type="button" onclick="GeoSafeResponderUI.closeResponderLoginModal()" class="px-3.5 py-2 rounded-md border border-slate-200 text-[#777777] font-bold text-xs hover:bg-slate-100">
              Cancel
            </button>
            <button type="submit" class="px-4 py-2 rounded-md bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] font-bold text-xs shadow-subtle">
              Verify & Sign In
            </button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
  },

  openResponderLoginModal() {
    this.renderResponderLoginModal();
    document.getElementById('responder-auth-modal')?.classList.remove('hidden');
  },

  closeResponderLoginModal() {
    document.getElementById('responder-auth-modal')?.classList.add('hidden');
  },

  async handleResponderLoginSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('auth-resp-id')?.value.trim();
    const firstName = document.getElementById('auth-resp-first')?.value.trim();
    const lastName = document.getElementById('auth-resp-last')?.value.trim();
    const unit = document.getElementById('auth-resp-unit')?.value.trim();

    if (!id || !firstName || !lastName) return;

    if (window.geoSafeStore) {
      await window.geoSafeStore.setAuthenticatedResponder({
        id,
        badgeNumber: id,
        firstName,
        lastName,
        role: 'Responder',
        department: unit,
        assignedUnit: unit,
        availability: 'On Duty',
        phone: '',
        email: '',
        skills: [],
        currentLocation: { lat: 14.4075, lng: 121.0475 }
      });
      this.showToast('Responder session authenticated successfully.', 'success');
      this.closeResponderLoginModal();
      await this.syncHeaderResponderData();
      window.dispatchEvent(new CustomEvent('geosafe:realtime-update', { detail: { event: 'reconnect-sync', data: {} } }));
    }
  },

  formatRelativeTime(isoString) {
    if (!isoString) return 'Just now';
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);

    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  }
};

window.GeoSafeResponderUI = GeoSafeResponderUI;

