/**
 * GeoSafe - Responder Portal Navigation & Shell Component
 * ============================================================================
 * Strictly 4 Primary Navigation Items (Section 2):
 * 1. Dashboard (responder-dashboard.html)
 * 2. Assignments (responder-assignments.html)
 * 3. Map (responder-map.html)
 * 4. Profile (responder-profile.html)
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
      label: 'Assignments',
      shortLabel: 'Assignments',
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
      id: 'profile',
      label: 'Responder Profile',
      shortLabel: 'Profile',
      href: 'responder-profile.html',
      icon: 'user-shield'
    }
  ],

  // SVG Icon definitions (NO emojis)
  getIcon(name, extraClasses = 'w-5 h-5') {
    const icons = {
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
      if (path.includes('profile')) return 'profile';
      if (path.includes('dashboard')) return 'dashboard';
    }
    return explicitId || 'dashboard';
  },

  /**
   * Initialize navigation and shell for the active page
   */
  async init(activePageId, pageTitle = '') {
    const resolvedActiveId = this.resolveActivePageId(activePageId);
    this.activePageId = resolvedActiveId;

    this.renderTopNav(resolvedActiveId);
    this.renderMobileBottomNav(resolvedActiveId);
    this.setupToastContainer();
    this.renderNotificationsModal();
    this.renderDutyStatusModal();

    await this.syncHeaderResponderData();

    // Listen for availability changes
    window.addEventListener('geosafe:responder-availability', (e) => {
      this.updateAvailabilityBadges(e.detail.status);
    });
  },

  /**
   * Render Top Navigation Bar for Desktop & Tablet, and Mobile Header
   */
  renderTopNav(activeId) {
    const container = document.getElementById('geosafe-responder-nav-container');
    if (!container) return;

    const navLinksHtml = this.navItems.map(item => {
      const isActive = item.id === activeId;
      return `
        <a href="${item.href}" class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs sm:text-sm transition-all font-semibold ${
          isActive
            ? 'bg-[#F5B900] text-[#202020] shadow-sm font-bold ring-1 ring-[#F5B900]'
            : 'text-[#777777] hover:text-[#202020] hover:bg-[#FFF9E8]'
        }">
          <span class="flex-shrink-0 ${isActive ? 'text-[#202020]' : 'text-[#777777]'}">${this.getIcon(item.icon, 'w-4 h-4')}</span>
          <span>${item.label}</span>
        </a>
      `;
    }).join('');

    container.innerHTML = `
      <header class="bg-white/95 backdrop-blur-md border-b border-[#EEEEEE] sticky top-0 z-30 shadow-subtle">
        <div class="max-w-7xl mx-auto px-3 sm:px-5 lg:px-8">
          <div class="flex items-center justify-between h-13 sm:h-14 gap-2">
            
            <!-- Left: Logo & Responder Unit -->
            <div class="flex items-center gap-2 sm:gap-2.5 flex-shrink-0">
              <a href="responder-dashboard.html" class="flex items-center gap-2 group flex-shrink-0">
                <div class="w-8 h-8 rounded-xl bg-[#202020] text-[#F5B900] flex items-center justify-center font-black text-xs shadow-subtle ring-2 ring-[#FFE872]">
                  <svg class="w-4 h-4 text-[#F5B900]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                </div>
                <div>
                  <div class="flex items-center gap-1.5">
                    <span class="font-black text-sm tracking-tight text-[#202020]">GeoSafe</span>
                    <span class="text-[9px] font-black px-1.5 py-0.2 rounded bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2] uppercase">Responder</span>
                  </div>
                  <span id="header-responder-unit" class="text-[10px] text-[#777777] font-medium block leading-none">Emergency Operations</span>
                </div>
              </a>

              <!-- Responder Identity Display (Compact) -->
              <div class="hidden sm:block border-l border-[#EEEEEE] pl-2.5">
                <span class="text-[9px] text-[#777777] uppercase font-bold tracking-wider block">Responder</span>
                <span id="header-responder-name" class="text-xs sm:text-sm font-bold text-[#202020] tracking-tight block truncate max-w-[140px]">—</span>
              </div>
            </div>

            <!-- Center: Desktop & Tablet Navigation (Exactly 4 Items) -->
            <nav class="hidden md:flex items-center gap-1 lg:gap-1.5">
              ${navLinksHtml}
            </nav>

            <!-- Right: Interactive Duty Status, Notifications & Profile Avatar -->
            <div class="flex items-center gap-2 sm:gap-2.5 flex-shrink-0">
              
              <!-- Interactive Duty Status Pill -->
              <button type="button" onclick="GeoSafeResponderUI.openDutyStatusModal()" id="header-duty-btn" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all shadow-subtle border cursor-pointer bg-slate-100 text-[#777777] border-slate-200 hover:bg-slate-200" title="Change Duty Availability">
                <span id="header-duty-dot" class="w-2 h-2 rounded-full bg-[#777777]"></span>
                <span id="header-duty-label">Not Configured</span>
                <svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
              </button>

              <!-- Notification Bell with Unread Badge -->
              <button onclick="GeoSafeResponderUI.openNotificationsModal()" id="header-notif-btn" class="relative p-1.5 rounded-xl text-[#202020] hover:bg-[#FFF9E8] transition-colors focus:outline-none" title="Notifications">
                ${this.getIcon('bell', 'w-4 h-4 sm:w-5 sm:h-5')}
                <span id="header-notif-badge" class="hidden absolute top-1 right-1 w-2 h-2 rounded-full bg-[#D93636] ring-2 ring-white"></span>
              </button>

              <!-- Responder Profile Avatar (Links to Profile) -->
              <a href="responder-profile.html" id="header-profile-avatar" class="w-8 h-8 rounded-full bg-[#202020] border-2 border-[#F5B900] text-[#F5B900] font-black text-xs flex items-center justify-center flex-shrink-0 shadow-subtle hover:scale-105 transition-all" title="View Responder Profile">
                —
              </a>

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

    bottomNavContainer.className = 'md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#EEEEEE] shadow-[0_-4px_20px_rgba(32,32,32,0.06)]';

    const itemsHtml = this.navItems.map(item => {
      const isActive = item.id === activeId;

      return `
        <a href="${item.href}" data-nav-id="${item.id}" class="flex-1 flex items-center justify-center py-1 px-1 focus:outline-none">
          <div class="w-full flex flex-col items-center justify-center py-1.5 px-2 rounded-2xl transition-all duration-200 ${
            isActive
              ? 'bg-[#FFF1BF] shadow-sm'
              : 'bg-transparent hover:bg-[#FFF9E8]/50'
          }">
            <span class="flex-shrink-0 transition-colors ${isActive ? 'text-[#B88600]' : 'text-[#777777]'}">
              ${this.getIcon(item.icon, 'w-5 h-5')}
            </span>
            <span class="text-[10px] mt-0.5 whitespace-nowrap text-center tracking-tight transition-colors ${
              isActive ? 'font-bold text-[#202020]' : 'font-medium text-[#777777]'
            }">
              ${item.shortLabel}
            </span>
          </div>
        </a>
      `;
    }).join('');

    bottomNavContainer.innerHTML = `
      <div class="max-w-md mx-auto flex items-center justify-around h-16 px-2 safe-area-bottom">
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
      <div class="max-w-md mx-auto my-8 p-6 sm:p-8 bg-white rounded-3xl border border-[#EEEEEE] shadow-card text-center space-y-4">
        <div class="w-14 h-14 rounded-2xl bg-[#FFF1F1] border border-[#FFC2C2] text-[#D93636] flex items-center justify-center mx-auto shadow-subtle">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
        </div>
        <div>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2] uppercase mb-1">
            Restricted Operational Access
          </span>
          <h2 class="text-base sm:text-lg font-black text-[#202020] tracking-tight">Responder Authentication Required</h2>
          <p class="text-xs text-[#777777] mt-1.5 leading-relaxed">
            ${message || 'This operations portal is restricted to authorized Barangay Bayanan emergency responders. To receive dispatch assignments, view coordinates, and submit situation reports, please authenticate with your responder credentials.'}
          </p>
        </div>

        <div class="pt-3 border-t border-[#EEEEEE] flex flex-col sm:flex-row items-center justify-center gap-2">
          <a href="index.html" class="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#202020] text-xs font-bold transition-all text-center">
            Return to Resident Portal
          </a>
          <a href="login.html" class="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] text-xs font-black shadow-subtle transition-all text-center">
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
    try {
      if (!window.geoSafeStore) return;
      const profile = await window.geoSafeStore.getResponderProfile();

      const nameEl = document.getElementById('header-responder-name');
      const unitEl = document.getElementById('header-responder-unit');
      const avatarEl = document.getElementById('header-profile-avatar');

      if (!profile || profile.role !== 'Responder') {
        if (nameEl) nameEl.textContent = 'Not Signed In';
        if (unitEl) unitEl.textContent = 'Access Restricted';
        if (avatarEl) avatarEl.textContent = '—';
        this.updateAvailabilityBadges('Not Set');
        return;
      }

      const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
      if (nameEl) {
        nameEl.textContent = fullName || 'Responder';
      }
      if (unitEl) {
        unitEl.textContent = profile.assignedUnit || profile.department || 'Emergency Operations';
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
    } catch (err) {
      console.warn('[ResponderUI] Error syncing header responder data:', err);
    }
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
      btn.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all shadow-subtle border cursor-pointer bg-emerald-50 text-[#278653] border-emerald-200 hover:bg-emerald-100';
      dot.className = 'w-2 h-2 rounded-full bg-[#278653] animate-pulse';
    } else if (status === 'Off Duty') {
      btn.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all shadow-subtle border cursor-pointer bg-slate-100 text-[#777777] border-slate-200 hover:bg-slate-200';
      dot.className = 'w-2 h-2 rounded-full bg-[#777777]';
    } else if (status === 'Unavailable') {
      btn.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all shadow-subtle border cursor-pointer bg-amber-50 text-[#E99524] border-amber-200 hover:bg-amber-100';
      dot.className = 'w-2 h-2 rounded-full bg-[#E99524]';
    } else {
      // Neutral unconfigured / Standby / Not Set state
      btn.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all shadow-subtle border cursor-pointer bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200';
      dot.className = 'w-2 h-2 rounded-full bg-slate-400';
    }
  },

  /**
   * Setup fixed viewport-centered toast container
   */
  setupToastContainer() {
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
  showToast(message, type = 'info') {
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
    toast.className = `${cfg.bg} text-white px-4 py-2.5 rounded-2xl shadow-modal flex items-center gap-3 text-xs sm:text-sm font-semibold pointer-events-auto transform transition-all duration-300 translate-y-2 opacity-0 max-w-full`;
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
      <div class="bg-white rounded-3xl max-w-md w-full p-4 sm:p-5 shadow-modal border border-[#EEEEEE] max-h-[85vh] flex flex-col">
        <div class="flex items-center justify-between pb-3 border-b border-[#EEEEEE]">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-[#FFF9E8] border border-[#FFE872] text-[#8A6800] flex items-center justify-center">
              ${this.getIcon('bell', 'w-4 h-4 text-[#F5B900]')}
            </div>
            <div>
              <h3 class="font-bold text-sm text-[#202020]">Dispatch Notifications</h3>
              <p class="text-[10px] text-[#777777]">Operational alerts & assignment events</p>
            </div>
          </div>
          <button onclick="GeoSafeResponderUI.closeNotificationsModal()" class="p-1 rounded-xl text-[#777777] hover:bg-[#FFF9E8] transition-colors">
            ${this.getIcon('x', 'w-4 h-4')}
          </button>
        </div>

        <div id="responder-notif-list" class="flex-1 overflow-y-auto py-3 space-y-2 custom-scrollbar">
          <div class="py-6 text-center text-xs text-[#777777]">Checking notifications...</div>
        </div>

        <div class="pt-2.5 border-t border-[#EEEEEE] flex items-center justify-between text-[11px]">
          <button type="button" onclick="GeoSafeResponderUI.markAllRead()" class="font-bold text-[#8A6800] hover:text-[#5C4500]">Mark all as read</button>
          <button type="button" onclick="GeoSafeResponderUI.closeNotificationsModal()" class="px-3 py-1 rounded-xl bg-slate-100 text-[#202020] font-bold">Close</button>
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

    try {
      const notifs = await window.geoSafeStore.getNotifications('All');
      if (!notifs || notifs.length === 0) {
        listEl.innerHTML = `
          <div class="py-8 text-center text-xs text-[#777777]">
            <p class="font-semibold text-[#202020]">No notifications available.</p>
            <p class="text-[11px] mt-0.5">New dispatch assignments will trigger alerts here.</p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = notifs.map(n => `
        <div class="p-3 rounded-2xl border ${n.read ? 'bg-white border-[#EEEEEE]' : 'bg-[#FFFDF7] border-[#FFE872] shadow-subtle'} space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-xs text-[#202020]">${n.title}</span>
            <span class="text-[9px] text-[#777777] whitespace-nowrap">${GeoSafeResponderUI.formatRelativeTime(n.timestamp)}</span>
          </div>
          <p class="text-[11px] text-[#555555] leading-relaxed">${n.description}</p>
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = `<div class="py-4 text-center text-xs text-[#D93636]">Could not load notifications.</div>`;
    }
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
      <div class="bg-white rounded-3xl max-w-sm w-full p-4 sm:p-5 shadow-modal border border-[#EEEEEE]">
        <div class="flex items-center justify-between pb-3 border-b border-[#EEEEEE]">
          <h3 class="font-bold text-sm text-[#202020]">Update Duty Availability</h3>
          <button onclick="GeoSafeResponderUI.closeDutyStatusModal()" class="p-1 rounded-xl text-[#777777] hover:bg-[#FFF9E8]">
            ${this.getIcon('x', 'w-4 h-4')}
          </button>
        </div>

        <p class="text-[11px] text-[#777777] my-3">
          Your availability determines dispatch priority and EOC operational assignment in Barangay Bayanan.
        </p>

        <div class="space-y-2">
          <button type="button" onclick="GeoSafeResponderUI.setDutyStatus('On Duty')" class="w-full p-3 rounded-2xl border-2 border-emerald-500/30 hover:border-emerald-500 bg-emerald-50/60 text-left transition-all flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span class="w-3 h-3 rounded-full bg-[#278653] animate-pulse"></span>
              <div>
                <span class="font-bold text-xs text-[#202020] block">On Duty</span>
                <span class="text-[10px] text-[#777777]">Available for active emergency dispatch</span>
              </div>
            </div>
            <span class="text-[10px] font-bold text-[#278653] bg-emerald-100 px-2 py-0.5 rounded-full">Active</span>
          </button>

          <button type="button" onclick="GeoSafeResponderUI.setDutyStatus('Unavailable')" class="w-full p-3 rounded-2xl border border-amber-200 hover:border-amber-400 bg-amber-50/50 text-left transition-all flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span class="w-3 h-3 rounded-full bg-[#E99524]"></span>
              <div>
                <span class="font-bold text-xs text-[#202020] block">Unavailable</span>
                <span class="text-[10px] text-[#777777]">Meal break, vehicle maintenance, or on-task</span>
              </div>
            </div>
            <span class="text-[10px] font-bold text-[#E99524] bg-amber-100 px-2 py-0.5 rounded-full">Standby</span>
          </button>

          <button type="button" onclick="GeoSafeResponderUI.setDutyStatus('Off Duty')" class="w-full p-3 rounded-2xl border border-slate-200 hover:border-slate-300 bg-slate-50 text-left transition-all flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span class="w-3 h-3 rounded-full bg-slate-400"></span>
              <div>
                <span class="font-bold text-xs text-[#202020] block">Off Duty</span>
                <span class="text-[10px] text-[#777777]">Shift concluded; not dispatched</span>
              </div>
            </div>
            <span class="text-[10px] font-bold text-slate-600 bg-slate-200 px-2 py-0.5 rounded-full">Off</span>
          </button>
        </div>

        <div class="mt-4 pt-3 border-t border-[#EEEEEE] text-right">
          <button type="button" onclick="GeoSafeResponderUI.closeDutyStatusModal()" class="px-4 py-1.5 rounded-xl text-xs font-bold bg-slate-100 text-[#202020] hover:bg-slate-200">
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  openDutyStatusModal() {
    document.getElementById('duty-status-modal')?.classList.remove('hidden');
  },

  closeDutyStatusModal() {
    document.getElementById('duty-status-modal')?.classList.add('hidden');
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
      <div class="bg-white rounded-3xl max-w-sm w-full p-5 sm:p-6 shadow-modal border border-[#EEEEEE]">
        <div class="flex items-center justify-between pb-3 border-b border-[#EEEEEE]">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-[#FFF9E8] border border-[#FFE872] text-[#8A6800] flex items-center justify-center">
              <svg class="w-4 h-4 text-[#F5B900]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            </div>
            <div>
              <h3 class="font-bold text-sm text-[#202020]">Responder Sign In</h3>
              <p class="text-[10px] text-[#777777]">Authorized BDRRMC Personnel</p>
            </div>
          </div>
          <button onclick="GeoSafeResponderUI.closeResponderLoginModal()" class="p-1 rounded-xl text-[#777777] hover:bg-[#FFF9E8]">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <form id="responder-auth-form" onsubmit="GeoSafeResponderUI.handleResponderLoginSubmit(event)" class="space-y-3.5 mt-3.5 text-xs">
          <div>
            <label class="block font-bold text-[#202020] mb-1">Responder ID / Badge #</label>
            <input type="text" id="auth-resp-id" required placeholder="e.g. RESP-2026-001" class="w-full px-3 py-2 rounded-xl border border-[#EEEEEE] text-[#202020] focus:ring-2 focus:ring-[#F5B900] focus:outline-none">
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block font-bold text-[#202020] mb-1">First Name</label>
              <input type="text" id="auth-resp-first" required placeholder="First name" class="w-full px-3 py-2 rounded-xl border border-[#EEEEEE] text-[#202020] focus:ring-2 focus:ring-[#F5B900] focus:outline-none">
            </div>
            <div>
              <label class="block font-bold text-[#202020] mb-1">Last Name</label>
              <input type="text" id="auth-resp-last" required placeholder="Last name" class="w-full px-3 py-2 rounded-xl border border-[#EEEEEE] text-[#202020] focus:ring-2 focus:ring-[#F5B900] focus:outline-none">
            </div>
          </div>

          <div>
            <label class="block font-bold text-[#202020] mb-1">Assigned Department / Team</label>
            <input type="text" id="auth-resp-unit" required placeholder="e.g. BDRRMC Quick Response Unit" class="w-full px-3 py-2 rounded-xl border border-[#EEEEEE] text-[#202020] focus:ring-2 focus:ring-[#F5B900] focus:outline-none">
          </div>

          <div class="pt-2 border-t border-[#EEEEEE] flex items-center justify-end gap-2">
            <button type="button" onclick="GeoSafeResponderUI.closeResponderLoginModal()" class="px-3.5 py-2 rounded-xl border border-[#EEEEEE] text-[#777777] font-bold text-xs hover:bg-[#FFF9E8]">
              Cancel
            </button>
            <button type="submit" class="px-4 py-2 rounded-xl bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] font-black text-xs shadow-subtle">
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
      window.location.reload();
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

