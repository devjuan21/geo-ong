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
    if (window.geoSafeStore) {
      const user = await window.geoSafeStore.enforcePageAuth('Resident');
      if (!user) return;
    }

    const resolvedActiveId = this.resolveActivePageId(activePageId);
    this.activePageId = resolvedActiveId;
    this.renderTopNav(resolvedActiveId);
    this.renderMobileBottomNav(resolvedActiveId);
    this.renderOfflineBanner();
    this.setupToastContainer();
    this.renderNotificationsModal();
    this.bindDropdownListeners();

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

              <!-- Interactive Resident Profile Section & Dropdown -->
              <div class="relative" id="resident-header-profile-wrapper">
                <button
                  type="button"
                  id="resident-profile-menu-btn"
                  onclick="GeoSafeUI.toggleProfileDropdown(event)"
                  class="flex items-center gap-2 p-1 pl-1.5 pr-2.5 rounded-2xl hover:bg-[#FFF9E8] border border-transparent hover:border-[#FFE872] transition-all focus:outline-none focus:ring-2 focus:ring-[#F5B900]/40 cursor-pointer group"
                  aria-haspopup="true"
                  aria-expanded="false"
                  title="Account menu"
                >
                  <div id="header-profile-avatar" class="w-8 h-8 rounded-full bg-[#FFF3D0] border border-[#FFD54F] text-[#202020] font-bold text-xs flex items-center justify-center flex-shrink-0 shadow-subtle">
                    R
                  </div>
                  <div class="text-left hidden sm:block min-w-0">
                    <span id="header-profile-name" class="text-xs font-bold text-[#202020] block leading-tight truncate max-w-[130px]">Resident</span>
                    <span id="header-profile-role" class="text-[10px] text-[#777777] font-semibold block leading-tight">Resident</span>
                  </div>
                  <svg id="resident-profile-chevron" class="w-3.5 h-3.5 text-[#777777] transition-transform duration-200 group-hover:text-[#202020]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </button>

                <!-- Dropdown Menu -->
                <div
                  id="resident-profile-dropdown"
                  class="hidden absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl border border-[#EEEEEE] shadow-modal py-1.5 z-50 transform origin-top-right transition-all"
                  role="menu"
                  aria-orientation="vertical"
                >
                  <div class="px-3.5 py-2 border-b border-[#EEEEEE] sm:hidden">
                    <span id="header-profile-name-mobile" class="text-xs font-bold text-[#202020] block truncate">Resident</span>
                    <span id="header-profile-role-mobile" class="text-[10px] text-[#777777] font-semibold block">Resident</span>
                  </div>
                  <a
                    href="profile.html"
                    id="header-menu-item-profile"
                    role="menuitem"
                    class="flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-[#202020] hover:bg-[#FFF9E8] hover:text-[#8A6800] transition-colors"
                  >
                    <svg class="w-4 h-4 text-[#777777]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                    </svg>
                    <span>Profile</span>
                  </a>
                  <div class="my-1 border-t border-[#EEEEEE]"></div>
                  <button
                    type="button"
                    id="header-menu-item-logout"
                    role="menuitem"
                    onclick="GeoSafeUI.handleLogout()"
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
      const profileNameEl = document.getElementById('header-profile-name');
      const profileNameMobileEl = document.getElementById('header-profile-name-mobile');
      const profileRoleEl = document.getElementById('header-profile-role');
      const profileRoleMobileEl = document.getElementById('header-profile-role-mobile');
      const avatarEl = document.getElementById('header-profile-avatar');

      const firstName = profile.firstName ? profile.firstName.trim() : 'Resident';
      const lastName = profile.lastName ? profile.lastName.trim() : '';
      const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'Resident';
      const roleName = profile.role || 'Resident';

      if (nameEl) nameEl.textContent = firstName;
      if (profileNameEl) profileNameEl.textContent = fullName;
      if (profileNameMobileEl) profileNameMobileEl.textContent = fullName;
      if (profileRoleEl) profileRoleEl.textContent = roleName;
      if (profileRoleMobileEl) profileRoleMobileEl.textContent = roleName;

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
   * Profile Dropdown Controls (Section 1 & 2: Interactive Header Dropdown)
   */
  toggleProfileDropdown(event) {
    if (event) {
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }
    const dropdown = document.getElementById('resident-profile-dropdown');
    const chevron = document.getElementById('resident-profile-chevron');
    const btn = document.getElementById('resident-profile-menu-btn');
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
    const dropdown = document.getElementById('resident-profile-dropdown');
    const chevron = document.getElementById('resident-profile-chevron');
    const btn = document.getElementById('resident-profile-menu-btn');
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
        const wrapper = document.getElementById('resident-header-profile-wrapper');
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
      await window.geoSafeStore.logout();
    }
    window.location.replace('/login.html');
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
    if (typeof window !== 'undefined' && window.GeoSafeToast) {
      return document.getElementById('geosafe-toast-container');
    }
    let container = document.getElementById('geosafe-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'geosafe-toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'Notifications');
      container.className = 'fixed top-4 inset-x-4 sm:inset-x-auto sm:top-6 sm:right-6 z-[100] pointer-events-none flex flex-col gap-2.5 items-center sm:items-end w-auto max-w-[calc(100%-2rem)] sm:max-w-sm sm:w-full';
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
    if (typeof window !== 'undefined' && window.GeoSafeToast) {
      return window.GeoSafeToast.show({ message, type, duration });
    }
    const container = this.setupToastContainer();
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'pointer-events-auto w-full transform transition-all duration-300 ease-out opacity-0 -translate-y-3 sm:translate-y-0 sm:translate-x-6 scale-95 p-3.5 sm:p-4 rounded-2xl shadow-modal text-xs font-semibold flex items-start gap-3 border backdrop-blur-md';

    if (type === 'success') {
      toast.classList.add('bg-[#F0FDF4]', 'text-[#202020]', 'border-[#BBF7D0]');
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.innerHTML = `
        <div class="w-6 h-6 rounded-xl bg-[#DCFCE7] text-[#278653] flex items-center justify-center flex-shrink-0 mt-0.5 shadow-subtle">
          ${this.getIcon('check', 'w-3.5 h-3.5 text-[#278653]')}
        </div>
        <div class="flex-1 min-w-0 pt-0.5">
          <p class="leading-snug break-words text-[#202020]">${message}</p>
        </div>
      `;
    } else if (type === 'error') {
      toast.classList.add('bg-[#FFF1F1]', 'text-[#202020]', 'border-[#FFC2C2]');
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'assertive');
      toast.innerHTML = `
        <div class="w-6 h-6 rounded-xl bg-[#FFE0E0] text-[#D93636] flex items-center justify-center flex-shrink-0 mt-0.5 shadow-subtle">
          <svg class="w-4 h-4 text-[#D93636]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"></circle><line x1="12" y1="8" x2="12" y2="12" stroke-width="2" stroke-linecap="round"></line><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2" stroke-linecap="round"></line></svg>
        </div>
        <div class="flex-1 min-w-0 pt-0.5">
          <p class="leading-snug break-words text-[#202020]">${message}</p>
        </div>
      `;
    } else if (type === 'warning') {
      toast.classList.add('bg-[#FFFDF0]', 'text-[#202020]', 'border-[#FFE872]');
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'polite');
      toast.innerHTML = `
        <div class="w-6 h-6 rounded-xl bg-[#FFF3D0] text-[#8A6800] flex items-center justify-center flex-shrink-0 mt-0.5 shadow-subtle">
          ${this.getIcon('alert-triangle', 'w-3.5 h-3.5 text-[#8A6800]')}
        </div>
        <div class="flex-1 min-w-0 pt-0.5">
          <p class="leading-snug break-words text-[#202020]">${message}</p>
        </div>
      `;
    } else {
      toast.classList.add('bg-[#F8FAFC]', 'text-[#202020]', 'border-[#E2E8F0]');
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.innerHTML = `
        <div class="w-6 h-6 rounded-xl bg-[#E2E8F0] text-[#475569] flex items-center justify-center flex-shrink-0 mt-0.5 shadow-subtle">
          ${this.getIcon('info', 'w-3.5 h-3.5 text-[#202020]')}
        </div>
        <div class="flex-1 min-w-0 pt-0.5">
          <p class="leading-snug break-words text-[#202020]">${message}</p>
        </div>
      `;
    }

    container.appendChild(toast);

    const triggerAnimate = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
    triggerAnimate(() => {
      toast.classList.remove('opacity-0', '-translate-y-3', 'sm:translate-x-6', 'scale-95');
      toast.classList.add('opacity-100', 'translate-y-0', 'sm:translate-x-0', 'scale-100');
    });

    setTimeout(() => {
      toast.classList.remove('opacity-100', 'translate-y-0', 'sm:translate-x-0', 'scale-100');
      toast.classList.add('opacity-0', '-translate-y-2', 'sm:translate-x-6', 'scale-95');
      setTimeout(() => toast.remove(), 250);
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
