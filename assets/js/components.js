/**
 * GeoSafe - Resident Portal UI Navigation & Shell Component
 * ============================================================================
 * Strictly 4 Primary Navigation Items (Sections 1 & 2):
 * 1. Home (index.html)
 * 2. Evacuation Routes (evacuation-routes.html)
 * 3. Report / Rescue (report-rescue.html) - Visually emphasized emergency action
 * 4. Family (family.html)
 * 
 * - Mobile: Fixed 4-item bottom navigation bar with safe-area insets.
 * - Desktop/Tablet: Top navigation bar with the exact same 4 items.
 *   (Strictly NO administrator sidebar or management dashboard).
 * - Compact Header with dynamic time-based greeting, notification bell with unread indicator, and resident avatar.
 * ============================================================================
 */

const GeoSafeUI = {
  // Exactly 4 Primary Navigation Items
  navItems: [
    {
      id: 'home',
      label: 'Home',
      shortLabel: 'Home',
      href: 'index.html',
      icon: 'home'
    },
    {
      id: 'evacuation-routes',
      label: 'Evacuation Routes',
      shortLabel: 'Evacuation',
      href: 'evacuation-routes.html',
      icon: 'map-route'
    },
    {
      id: 'report-rescue',
      label: 'Report / Rescue',
      shortLabel: 'Report / Rescue',
      href: 'report-rescue.html',
      icon: 'alert-triangle',
      isEmergencyAction: true
    },
    {
      id: 'family',
      label: 'Family Safety',
      shortLabel: 'Family',
      href: 'family.html',
      icon: 'users'
    }
  ],

  // SVG Icon definitions
  getIcon(name, extraClasses = 'w-5 h-5') {
    const icons = {
      'home': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>`,
      'map-route': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>`,
      'alert-triangle': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`,
      'users': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>`,
      'bell': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>`,
      'phone': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>`,
      'map-pin': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>`,
      'crosshair': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"></circle><line x1="22" y1="12" x2="18" y2="12" stroke-width="2" stroke-linecap="round"></line><line x1="6" y1="12" x2="2" y2="12" stroke-width="2" stroke-linecap="round"></line><line x1="12" y1="6" x2="12" y2="2" stroke-width="2" stroke-linecap="round"></line><line x1="12" y1="22" x2="12" y2="18" stroke-width="2" stroke-linecap="round"></line></svg>`,
      'shield-check': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>`,
      'info': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`,
      'x': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`,
      'check': `<svg class="${extraClasses}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`
    };
    return icons[name] || '';
  },

  /**
   * Determine active page ID based on parameter or current URL route
   * @param {string} explicitId
   * @returns {string}
   */
  resolveActivePageId(explicitId) {
    if (explicitId && this.navItems.some(item => item.id === explicitId)) {
      return explicitId;
    }
    if (typeof window !== 'undefined' && window.location) {
      const path = (window.location.pathname || '').toLowerCase();
      if (path.includes('evacuation-routes') || path.includes('evacuation')) {
        return 'evacuation-routes';
      }
      if (path.includes('report-rescue') || path.includes('report') || path.includes('rescue')) {
        return 'report-rescue';
      }
      if (path.includes('family')) {
        return 'family';
      }
      if (path.includes('index') || path.endsWith('/') || path === '') {
        return 'home';
      }
    }
    return explicitId || 'home';
  },

  /**
   * Initialize navigation for the active page
   * @param {string} activePageId - 'home' | 'evacuation-routes' | 'report-rescue' | 'family'
   * @param {string} pageTitle - Human readable title
   */
  async init(activePageId, pageTitle = '') {
    const resolvedActiveId = this.resolveActivePageId(activePageId);
    this.activePageId = resolvedActiveId;
    this.renderTopNav(resolvedActiveId);
    this.renderMobileBottomNav(resolvedActiveId);
    this.renderOfflineBanner();
    this.setupToastContainer();
    this.renderNotificationsModal();

    // Dynamically update greeting and notification counts from real records
    await this.syncHeaderResidentData();

    // Sync online/offline indicators
    if (window.geoSafeStore) {
      window.geoSafeStore.notifyNetworkChange(window.geoSafeStore.isOnline());
    }
  },

  /**
   * Render Top Navigation Bar for Desktop & Tablet, and Mobile Header (Section 2.A)
   */
  renderTopNav(activeId) {
    const container = document.getElementById('geosafe-nav-container') || document.getElementById('geosafe-header-container');
    if (!container) return;

    const navLinksHtml = this.navItems.map(item => {
      const isActive = item.id === activeId;
      if (item.isEmergencyAction) {
        return `
          <a href="${item.href}" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-sm ${
            isActive
              ? 'bg-[#D93636] text-white ring-2 ring-[#FFC2C2] shadow-emergency-glow'
              : 'bg-[#FFF1F1] text-[#D93636] hover:bg-[#D93636] hover:text-white border border-[#FFC2C2]'
          }">
            <span class="flex-shrink-0">${this.getIcon(item.icon, 'w-4 h-4')}</span>
            <span>${item.label}</span>
          </a>
        `;
      }

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
          <div class="flex items-center justify-between h-12 sm:h-13 gap-2">
            
            <!-- Left: Logo & Dynamic Resident Greeting (Compact Section 1) -->
            <div class="flex items-center gap-2 sm:gap-2.5 flex-shrink-0">
              <a href="index.html" class="flex items-center gap-1.5 group flex-shrink-0">
                <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[#F5B900] text-[#202020] flex items-center justify-center font-black text-xs shadow-subtle ring-1 ring-[#FFF2A5]">
                  GS
                </div>
                <div class="hidden sm:block">
                  <span class="font-black text-sm tracking-tight text-[#202020] group-hover:text-[#F5B900] transition-colors">GeoSafe</span>
                </div>
              </a>

              <!-- Greeting, Resident Name & Role Badge (Compact) -->
              <div class="border-l border-[#EEEEEE] pl-2 sm:pl-2.5">
                <span id="header-greeting-label" class="text-[10px] text-[#777777] font-medium block leading-tight">Greeting</span>
                <div class="flex items-center gap-1.5">
                  <span id="header-resident-name" class="text-xs sm:text-sm font-bold text-[#202020] tracking-tight block truncate max-w-[110px] sm:max-w-[160px]">Resident</span>
                  <span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#FFF9E8] text-[#8A6800] border border-[#FFE872] hidden xs:inline-block">Resident</span>
                </div>
              </div>
            </div>

            <!-- Center: Desktop & Tablet Navigation (Exactly 4 Items) -->
            <nav class="hidden md:flex items-center gap-1 lg:gap-1.5">
              ${navLinksHtml}
            </nav>

            <!-- Right: Status, Notification Bell & Profile Avatar (Compact Section 1) -->
            <div class="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <!-- Online / Offline Badge -->
              <div id="online-status-badge" class="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-[#278653] border border-emerald-200">
                <span class="badge-pulse mr-1"><span class="badge-pulse-ping bg-emerald-400"></span><span class="badge-pulse-dot bg-[#278653]"></span></span>
                <span>Online</span>
              </div>

              <!-- Notification Bell with Unread Indicator -->
              <button onclick="GeoSafeUI.openNotificationsModal()" id="header-notif-btn" class="relative p-1.5 rounded-xl text-[#202020] hover:bg-[#FFF9E8] transition-colors focus:outline-none" title="Notifications">
                ${this.getIcon('bell', 'w-4 h-4 sm:w-5 sm:h-5')}
                <!-- Unread Indicator (Only shown when actual unread records exist) -->
                <span id="header-notif-badge" class="hidden absolute top-1 right-1 w-2 h-2 rounded-full bg-[#D93636] ring-2 ring-white"></span>
              </button>

              <!-- Resident Profile Avatar -->
              <div id="header-profile-avatar" class="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#FFF3D0] border border-[#FFD54F] text-[#202020] font-bold text-xs flex items-center justify-center flex-shrink-0 shadow-subtle cursor-pointer" title="Resident Profile">
                R
              </div>
            </div>

          </div>
        </div>
      </header>
    `;
  },

  /**
   * Render Mobile Fixed Bottom Navigation Bar (Exactly 4 Items)
   * Fixed at the bottom of the viewport while scrolling.
   */
  renderMobileBottomNav(activeId) {
    let bottomNavContainer = document.getElementById('geosafe-bottom-nav');
    if (!bottomNavContainer) {
      bottomNavContainer = document.createElement('nav');
      bottomNavContainer.id = 'geosafe-bottom-nav';
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
   * Synchronize greeting, resident name, and unread notification badge from store
   */
  async syncHeaderResidentData() {
    if (!window.geoSafeStore) return;

    try {
      // 1. Time-of-day greeting (Section 2.A)
      const hour = new Date().getHours();
      let greeting = 'Good morning';
      if (hour >= 12 && hour < 18) {
        greeting = 'Good afternoon';
      } else if (hour >= 18 || hour < 5) {
        greeting = 'Good evening';
      }

      const greetingLabelEl = document.getElementById('header-greeting-label');
      if (greetingLabelEl) greetingLabelEl.textContent = greeting;

      // 2. Resident Profile Name & Avatar (Section 2.A: Dynamic, not hardcoded)
      const profile = await window.geoSafeStore.getResidentProfile().catch(() => ({}));
      const nameEl = document.getElementById('header-resident-name');
      const avatarEl = document.getElementById('header-profile-avatar');

      const firstName = profile.firstName ? profile.firstName.trim() : 'Resident';
      const lastName = profile.lastName ? profile.lastName.trim() : '';

      if (nameEl) nameEl.textContent = firstName;
      if (avatarEl) {
        const initials = ((firstName[0] || 'R') + (lastName[0] || '')).toUpperCase();
        avatarEl.textContent = initials;
      }

      // 3. Unread Notifications Count (Section 2.A: Only show indicator when actual unread exist)
      const unreadNotifs = await window.geoSafeStore.getNotifications('Unread').catch(() => []);
      const badgeEl = document.getElementById('header-notif-badge');
      if (badgeEl) {
        if (unreadNotifs && unreadNotifs.length > 0) {
          badgeEl.classList.remove('hidden');
        } else {
          badgeEl.classList.add('hidden');
        }
      }
    } catch (err) {
      console.warn('Could not sync header resident info:', err);
    }
  },

  /**
   * Notifications Modal (Section 2.A & 7)
   */
  renderNotificationsModal() {
    if (document.getElementById('geosafe-notifications-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'geosafe-notifications-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#202020]/50 backdrop-blur-sm hidden';
    modal.innerHTML = `
      <div class="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-modal border border-[#EEEEEE]">
        <div class="flex items-center justify-between pb-3.5 border-b border-[#EEEEEE]">
          <div class="flex items-center gap-2">
            <span class="w-8 h-8 rounded-xl bg-[#FFF9E8] text-[#F5B900] flex items-center justify-center">
              ${this.getIcon('bell', 'w-4 h-4 text-[#F5B900]')}
            </span>
            <h3 class="text-sm sm:text-base font-bold text-[#202020]">Notifications</h3>
          </div>
          <button onclick="GeoSafeUI.closeNotificationsModal()" class="p-1.5 rounded-xl text-[#777777] hover:text-[#202020] hover:bg-[#FFF9E8] transition-colors">
            ${this.getIcon('x', 'w-4 h-4')}
          </button>
        </div>

        <div id="notif-modal-content" class="py-4 max-h-72 overflow-y-auto space-y-2.5 custom-scrollbar">
          <!-- Populated dynamically via openNotificationsModal -->
        </div>

        <div class="pt-3.5 border-t border-[#EEEEEE] flex items-center justify-between">
          <button onclick="GeoSafeUI.markAllNotificationsRead()" class="text-xs font-semibold text-[#8A6800] hover:text-[#5C4500] transition-colors">
            Mark all as read
          </button>
          <button onclick="GeoSafeUI.closeNotificationsModal()" class="px-4 py-2 rounded-xl bg-[#FFF9E8] hover:bg-[#FFF3D0] text-[#202020] text-xs font-bold transition-colors">
            Close
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  async openNotificationsModal() {
    const modal = document.getElementById('geosafe-notifications-modal');
    const content = document.getElementById('notif-modal-content');
    if (!modal || !content) return;

    modal.classList.remove('hidden');
    content.innerHTML = `<div class="py-6 text-center text-xs text-slate-400">Checking notifications...</div>`;

    try {
      const notifs = await window.geoSafeStore.getNotifications('All');
      if (!notifs || notifs.length === 0) {
        content.innerHTML = `
          <div class="py-8 text-center text-xs text-slate-400">
            <p class="font-medium text-slate-600">No notifications available.</p>
            <p class="text-[11px] mt-0.5">Emergency advisories and report updates will appear here.</p>
          </div>
        `;
        return;
      }

      content.innerHTML = notifs.map(n => `
        <div class="p-3.5 rounded-2xl border text-xs ${n.read ? 'bg-[#FFFDF7] border-[#EEEEEE] text-[#777777]' : 'bg-[#FFF9E8] border-[#FFE872] text-[#202020]'} space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-xs text-[#202020]">${n.title}</span>
            <span class="text-[10px] text-[#777777]">${GeoSafeUI.formatRelative(n.timestamp)}</span>
          </div>
          <p class="text-[11px] leading-relaxed text-[#777777]">${n.description}</p>
        </div>
      `).join('');
    } catch (err) {
      content.innerHTML = `<div class="py-6 text-center text-xs text-rose-600">Unable to load notifications.</div>`;
    }
  },

  closeNotificationsModal() {
    const modal = document.getElementById('geosafe-notifications-modal');
    if (modal) modal.classList.add('hidden');
  },

  async markAllNotificationsRead() {
    if (!window.geoSafeStore) return;
    try {
      await window.geoSafeStore.markAllNotificationsAsRead();
      this.syncHeaderResidentData();
      this.openNotificationsModal();
      this.showToast('All notifications marked as read.', 'success');
    } catch (err) {
      this.showToast('Could not update notifications.', 'error');
    }
  },

  /**
   * Render Persistent Offline Banner
   */
  renderOfflineBanner() {
    let banner = document.getElementById('geosafe-offline-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'geosafe-offline-banner';
      banner.className = 'hidden bg-rose-600 text-white px-4 py-2 text-xs font-semibold text-center sticky top-14 sm:top-16 z-20 shadow-md';
      banner.innerHTML = `
        <div class="max-w-6xl mx-auto flex items-center justify-center gap-2">
          ${this.getIcon('alert-triangle', 'w-4 h-4 text-white')}
          <span>No Internet Connection. GeoSafe requires an active internet connection to communicate with Emergency Operations.</span>
        </div>
      `;
      const header = document.querySelector('header');
      if (header && header.parentNode) {
        header.parentNode.insertBefore(banner, header.nextSibling);
      } else {
        document.body.prepend(banner);
      }
    }
  },

  /**
   * Setup toast container
   */
  setupToastContainer() {
    let container = document.getElementById('geosafe-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'geosafe-toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('role', 'status');
      container.className = 'fixed bottom-20 md:bottom-8 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none w-[calc(100%-2rem)] max-w-md px-2';
      document.body.appendChild(container);
    }
    return container;
  },

  /**
   * Display modern toast notification
   * @param {string} message - Message text
   * @param {string} type - 'success' | 'error' | 'warning' | 'info'
   * @param {number} duration - Auto close duration ms
   */
  showToast(message, type = 'info', duration = 4000) {
    const container = this.setupToastContainer();

    const toast = document.createElement('div');
    toast.className = 'pointer-events-auto w-full transform transition-all duration-300 ease-out translate-y-3 opacity-0 px-4 py-3 rounded-2xl shadow-lg text-xs font-semibold flex items-center gap-3 border backdrop-blur-md';

    if (type === 'success') {
      toast.classList.add('bg-emerald-900/95', 'text-white', 'border-emerald-600/50', 'shadow-emerald-950/30');
      toast.innerHTML = `
        <div class="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center flex-shrink-0">
          ${this.getIcon('check', 'w-3.5 h-3.5')}
        </div>
        <span class="flex-1 text-xs leading-snug break-words">${message}</span>
      `;
    } else if (type === 'error') {
      toast.classList.add('bg-rose-900/95', 'text-white', 'border-rose-600/50', 'shadow-rose-950/30');
      toast.innerHTML = `
        <div class="w-5 h-5 rounded-full bg-rose-500/20 text-rose-300 flex items-center justify-center flex-shrink-0">
          ${this.getIcon('alert-triangle', 'w-3.5 h-3.5')}
        </div>
        <span class="flex-1 text-xs leading-snug break-words">${message}</span>
      `;
    } else if (type === 'warning') {
      toast.classList.add('bg-amber-900/95', 'text-white', 'border-amber-600/50', 'shadow-amber-950/30');
      toast.innerHTML = `
        <div class="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center flex-shrink-0">
          ${this.getIcon('alert-triangle', 'w-3.5 h-3.5')}
        </div>
        <span class="flex-1 text-xs leading-snug break-words">${message}</span>
      `;
    } else {
      toast.classList.add('bg-slate-900/95', 'text-white', 'border-slate-600/50', 'shadow-slate-950/30');
      toast.innerHTML = `
        <div class="w-5 h-5 rounded-full bg-slate-500/20 text-slate-300 flex items-center justify-center flex-shrink-0">
          ${this.getIcon('info', 'w-3.5 h-3.5')}
        </div>
        <span class="flex-1 text-xs leading-snug break-words">${message}</span>
      `;
    }

    container.appendChild(toast);

    const triggerAnimate = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
    triggerAnimate(() => {
      toast.classList.remove('translate-y-3', 'opacity-0');
    });

    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-3');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /**
   * Helper to format relative time strings (e.g. "5 mins ago", "Today at 2:30 PM")
   */
  formatRelative(isoDateString) {
    if (!isoDateString) return '—';
    const date = new Date(isoDateString);
    if (isNaN(date.getTime())) return isoDateString;

    const now = new Date();
    const diffSecs = Math.floor((now - date) / 1000);

    if (diffSecs < 60) return 'Just now';
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;

    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
};

window.GeoSafeUI = GeoSafeUI;
