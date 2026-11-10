/**
 * GeoSafe — Universal Floating Toast Notification Component
 * ============================================================================
 * Accessible, responsive, non-blocking toast notification system.
 * - Desktop: Top-right corner (sm:top-6 sm:right-6)
 * - Mobile: Top with balanced insets (top-4 inset-x-4 sm:inset-x-auto)
 * - Types: 'error', 'success', 'warning', 'info'
 * - Clean GeoSafe design system: #FFF9E8, #F5B900, #202020, zero emojis
 * - Non-blocking pointer events (container pointer-events-none, toast pointer-events-auto)
 * - Deduplication: prevents stacking of identical notifications on repeated clicks
 * - Accessible: role="alert", aria-live="assertive", keyboard close & ESC key support
 * - Auto-dismiss: ~3.5 seconds with smooth fade-and-slide entrance and exit
 * ============================================================================
 */

(function (global) {
  'use strict';

  // Active toast registry keyed by type + normalized message to prevent duplicate stacking
  const activeToasts = new Map();

  const ICONS = {
    error: `
      <svg class="w-4 h-4 text-[#D93636]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke-width="2"></circle>
        <line x1="12" y1="8" x2="12" y2="12" stroke-width="2" stroke-linecap="round"></line>
        <line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2" stroke-linecap="round"></line>
      </svg>
    `,
    success: `
      <svg class="w-4 h-4 text-[#278653]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
      </svg>
    `,
    warning: `
      <svg class="w-4 h-4 text-[#8A6800]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
      </svg>
    `,
    info: `
      <svg class="w-4 h-4 text-[#202020]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke-width="2"></circle>
        <line x1="12" y1="16" x2="12" y2="12" stroke-width="2" stroke-linecap="round"></line>
        <line x1="12" y1="8" x2="12.01" y2="8" stroke-width="2" stroke-linecap="round"></line>
      </svg>
    `,
    close: `
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    `
  };

  const THEMES = {
    error: {
      card: 'bg-[#FFF1F1] text-[#202020] border-[#FFC2C2] shadow-modal',
      badge: 'bg-[#FFE0E0] text-[#D93636]',
      text: 'text-[#202020]',
      role: 'alert',
      ariaLive: 'assertive'
    },
    success: {
      card: 'bg-[#F0FDF4] text-[#202020] border-[#BBF7D0] shadow-modal',
      badge: 'bg-[#DCFCE7] text-[#278653]',
      text: 'text-[#202020]',
      role: 'status',
      ariaLive: 'polite'
    },
    warning: {
      card: 'bg-[#FFFDF0] text-[#202020] border-[#FFE872] shadow-modal',
      badge: 'bg-[#FFF3D0] text-[#8A6800]',
      text: 'text-[#202020]',
      role: 'alert',
      ariaLive: 'polite'
    },
    info: {
      card: 'bg-[#F8FAFC] text-[#202020] border-[#E2E8F0] shadow-modal',
      badge: 'bg-[#E2E8F0] text-[#475569]',
      text: 'text-[#202020]',
      role: 'status',
      ariaLive: 'polite'
    }
  };

  function ensureContainer() {
    let container = document.getElementById('geosafe-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'geosafe-toast-container';
      container.className = 'fixed top-4 inset-x-4 sm:inset-x-auto sm:top-6 sm:right-6 z-[100] pointer-events-none flex flex-col gap-2.5 items-center sm:items-end w-auto max-w-[calc(100%-2rem)] sm:max-w-sm sm:w-full';
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'Notifications');
      document.body.appendChild(container);
    }
    return container;
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return String(str || '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function show(options = {}) {
    const message = typeof options === 'string' ? options : (options.message || '');
    const type = (options.type || 'info').toLowerCase();
    const duration = typeof options.duration === 'number' ? options.duration : 3500;
    const sanitizedType = THEMES[type] ? type : 'info';
    const theme = THEMES[sanitizedType];

    if (!message || typeof document === 'undefined') return null;

    const normalizedKey = `${sanitizedType}:${message.trim().toLowerCase()}`;

    // Deduplication (Requirement 11): Prevent multiple identical toasts from stacking
    if (activeToasts.has(normalizedKey)) {
      const existing = activeToasts.get(normalizedKey);
      if (existing && existing.toastEl) {
        // Reset auto-dismiss timer
        if (existing.timer) clearTimeout(existing.timer);
        existing.timer = setTimeout(() => dismissToast(existing.toastEl, normalizedKey), duration);

        // Visual pulse / tactile feedback on existing toast
        existing.toastEl.classList.remove('scale-100');
        existing.toastEl.classList.add('scale-[1.03]');
        setTimeout(() => {
          if (existing.toastEl) {
            existing.toastEl.classList.remove('scale-[1.03]');
            existing.toastEl.classList.add('scale-100');
          }
        }, 150);

        return existing.toastEl;
      }
    }

    const container = ensureContainer();

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto w-full border rounded-2xl p-3.5 sm:p-4 flex items-start gap-3 text-xs font-semibold backdrop-blur-md transform transition-all duration-300 ease-out opacity-0 -translate-y-3 sm:translate-y-0 sm:translate-x-6 scale-95 focus:outline-none focus:ring-2 focus:ring-[#F5B900] ${theme.card}`;
    toast.setAttribute('role', theme.role);
    toast.setAttribute('aria-live', theme.ariaLive);
    toast.setAttribute('tabindex', '0');

    toast.innerHTML = `
      <div class="w-6 h-6 rounded-xl ${theme.badge} flex items-center justify-center flex-shrink-0 mt-0.5 shadow-subtle">
        ${ICONS[sanitizedType]}
      </div>
      <div class="flex-1 min-w-0 pt-0.5">
        <p class="${theme.text} leading-snug break-words">${escapeHtml(message)}</p>
      </div>
      <button
        type="button"
        aria-label="Close notification"
        class="toast-dismiss-btn flex-shrink-0 p-1 -mr-1 -mt-0.5 rounded-xl text-[#777777] hover:text-[#202020] hover:bg-black/5 transition-colors focus:outline-none focus:ring-2 focus:ring-[#F5B900]"
      >
        ${ICONS.close}
      </button>
    `;

    // Close button handler
    const closeBtn = toast.querySelector('.toast-dismiss-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissToast(toast, normalizedKey);
      });
    }

    // Auto-dismiss timer
    const toastRecord = {
      toastEl: toast,
      timer: null
    };

    function startTimer() {
      toastRecord.timer = setTimeout(() => {
        dismissToast(toast, normalizedKey);
      }, duration);
    }

    function pauseTimer() {
      if (toastRecord.timer) clearTimeout(toastRecord.timer);
    }

    // Pause on hover or keyboard focus, resume on leave/blur
    toast.addEventListener('mouseenter', pauseTimer);
    toast.addEventListener('mouseleave', startTimer);
    toast.addEventListener('focusin', pauseTimer);
    toast.addEventListener('focusout', startTimer);

    // ESC key support
    toast.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dismissToast(toast, normalizedKey);
      }
    });

    activeToasts.set(normalizedKey, toastRecord);
    container.appendChild(toast);

    // Trigger smooth fade-and-slide entrance animation
    const requestFrame = typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);

    requestFrame(() => {
      toast.classList.remove('opacity-0', '-translate-y-3', 'sm:translate-x-6', 'scale-95');
      toast.classList.add('opacity-100', 'translate-y-0', 'sm:translate-x-0', 'scale-100');
    });

    startTimer();
    return toast;
  }

  function dismissToast(toast, key) {
    if (!toast || toast._isDismissing) return;
    toast._isDismissing = true;

    if (key && activeToasts.has(key)) {
      const record = activeToasts.get(key);
      if (record && record.timer) clearTimeout(record.timer);
      activeToasts.delete(key);
    }

    // Smooth exit animation
    toast.classList.remove('opacity-100', 'translate-y-0', 'sm:translate-x-0', 'scale-100');
    toast.classList.add('opacity-0', '-translate-y-2', 'sm:translate-x-6', 'scale-95', 'duration-200');

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 220);
  }

  function dismissAll() {
    activeToasts.forEach((record, key) => {
      if (record && record.toastEl) {
        dismissToast(record.toastEl, key);
      }
    });
    activeToasts.clear();
  }

  // Global ESC key listener to dismiss the newest toast
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activeToasts.size > 0) {
        const lastKey = Array.from(activeToasts.keys()).pop();
        if (lastKey) {
          const record = activeToasts.get(lastKey);
          if (record && record.toastEl) {
            dismissToast(record.toastEl, lastKey);
          }
        }
      }
    });
  }

  const GeoSafeToast = {
    show,
    error(message, duration) {
      return show({ message, type: 'error', duration });
    },
    success(message, duration) {
      return show({ message, type: 'success', duration });
    },
    warning(message, duration) {
      return show({ message, type: 'warning', duration });
    },
    info(message, duration) {
      return show({ message, type: 'info', duration });
    },
    dismiss(toast) {
      dismissToast(toast);
    },
    dismissAll
  };

  global.GeoSafeToast = GeoSafeToast;

  // Also bridge with GeoSafeUI if already loaded
  if (global.GeoSafeUI) {
    global.GeoSafeUI.showToast = function (message, type = 'info', duration = 3500) {
      return GeoSafeToast.show({ message, type, duration });
    };
  }
})(typeof window !== 'undefined' ? window : this);

