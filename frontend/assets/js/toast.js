/**
 * GeoSafe — Modern Floating Toast Notification System
 * ============================================================================
 * Redesigned based on the reference showcase:
 *   - Success: Vibrant Green (#28C76F), circular white check icon, "Success!" title.
 *   - Error:   Vibrant Red-Orange (#F25430), circular white X icon, "Error!" title.
 *   - Info:    Vibrant Blue (#0082E6), circular white info icon, "Info!" title.
 *   - Warning: Vibrant Amber-Yellow (#F5A623), circular white warning icon, "Warning!" title.
 *
 * Key Features:
 *   - Large modern floating card layout with clean rounded corners (rounded-2xl).
 *   - Large circular white icon on the left with centered colored glyph.
 *   - Bold title and legible message text in crisp white contrast.
 *   - Clean top-right dismiss button (X).
 *   - Smooth bottom progress bar indicating remaining auto-dismiss time (~4s).
 *   - Hover/focus pause: pauses both auto-dismiss timer and progress bar smoothly.
 *   - Responsive: 400-450px on desktop (max 90vw), calc(100% - 32px) on mobile.
 *   - Accessible: role="alert" / role="status", aria-live, keyboard close & ESC key.
 *   - Deduplication: prevents duplicate notifications for the same operation.
 *   - Non-blocking container (pointer-events-none container, pointer-events-auto toast).
 *   - Zero external dependencies.
 * ============================================================================
 */

(function (global) {
  'use strict';

  // Active toast registry keyed by type + normalized message to prevent duplicate stacking
  const activeToasts = new Map();

  const DEFAULT_DURATION = 4000; // ~4 seconds auto-dismiss

  const THEMES = {
    success: {
      bg: 'bg-[#28C76F]',
      accentColor: '#28C76F',
      defaultTitle: 'Success!',
      role: 'status',
      ariaLive: 'polite',
      iconSvg: `
        <svg class="w-5 h-5 text-[#28C76F]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
        </svg>
      `
    },
    error: {
      bg: 'bg-[#F25430]',
      accentColor: '#F25430',
      defaultTitle: 'Error!',
      role: 'alert',
      ariaLive: 'assertive',
      iconSvg: `
        <svg class="w-5 h-5 text-[#F25430]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      `
    },
    info: {
      bg: 'bg-[#0082E6]',
      accentColor: '#0082E6',
      defaultTitle: 'Info!',
      role: 'status',
      ariaLive: 'polite',
      iconSvg: `
        <svg class="w-5 h-5 text-[#0082E6]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.75" aria-hidden="true">
          <circle cx="12" cy="7" r="1.25" fill="currentColor" stroke="none"></circle>
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 11v6"></path>
        </svg>
      `
    },
    warning: {
      bg: 'bg-[#F5A623]',
      accentColor: '#F5A623',
      defaultTitle: 'Warning!',
      role: 'alert',
      ariaLive: 'polite',
      iconSvg: `
        <svg class="w-5 h-5 text-[#F5A623]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.75" aria-hidden="true">
          <circle cx="12" cy="7" r="1.25" fill="currentColor" stroke="none"></circle>
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 11v6"></path>
        </svg>
      `
    }
  };

  const CONTAINER_CLASS = 'fixed top-4 inset-x-4 sm:inset-x-auto sm:top-6 sm:right-6 z-[9999] pointer-events-none flex flex-col gap-3.5 items-center sm:items-end w-auto max-w-[calc(100%-2rem)] sm:max-w-[440px] sm:w-[440px]';
  const STYLE_ID = 'geosafe-toast-styles';

  /**
   * Critical toast styles injected once at runtime so the notifications render
   * correctly even when the pre-compiled Tailwind build (assets/css/style.css)
   * is missing some of the utility classes used below.
   */
  const CRITICAL_CSS = `
#geosafe-toast-container{position:fixed;top:16px;left:16px;right:16px;bottom:auto;transform:none;z-index:9999;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:14px;width:auto;max-width:calc(100% - 32px);margin:0 auto;}
@media (min-width:640px){#geosafe-toast-container{top:24px;right:24px;left:auto;width:440px;max-width:440px;align-items:flex-end;margin:0;}}
#geosafe-toast-container .geosafe-toast{pointer-events:auto;position:relative;box-sizing:border-box;width:100%;border-radius:16px;padding:16px;display:flex;align-items:flex-start;gap:14px;color:#fff;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);transition:opacity 300ms ease-out,transform 300ms ease-out;opacity:0;transform:translateX(32px) scale(0.95);}
@media (min-width:640px){#geosafe-toast-container .geosafe-toast{padding:20px;gap:16px;}}
#geosafe-toast-container .geosafe-toast.geosafe-toast-visible{opacity:1;transform:translateX(0) scale(1);}
#geosafe-toast-container .geosafe-toast.geosafe-toast-bump{transform:translateX(0) scale(1.03);}
#geosafe-toast-container .geosafe-toast.geosafe-toast-leaving{opacity:0;transform:translateX(32px) scale(0.95);transition-duration:200ms;}
#geosafe-toast-container .geosafe-toast-success{background-color:#28C76F;}
#geosafe-toast-container .geosafe-toast-error{background-color:#F25430;}
#geosafe-toast-container .geosafe-toast-info{background-color:#0082E6;}
#geosafe-toast-container .geosafe-toast-warning{background-color:#F5A623;}
#geosafe-toast-container .geosafe-toast-icon{width:40px;height:40px;border-radius:9999px;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);}
@media (min-width:640px){#geosafe-toast-container .geosafe-toast-icon{width:44px;height:44px;}}
#geosafe-toast-container .geosafe-toast-icon svg{width:20px;height:20px;}
#geosafe-toast-container .geosafe-toast-body{flex:1 1 0%;min-width:0;padding-right:24px;padding-top:2px;}
#geosafe-toast-container .geosafe-toast-title{margin:0;font-weight:800;color:#fff;font-size:14px;line-height:1.25;letter-spacing:-0.025em;}
#geosafe-toast-container .geosafe-toast-message{margin:4px 0 0;color:rgba(255,255,255,0.95);font-size:12px;line-height:1.375;overflow-wrap:break-word;word-break:break-word;}
@media (min-width:640px){#geosafe-toast-container .geosafe-toast-title{font-size:16px;}#geosafe-toast-container .geosafe-toast-message{font-size:14px;}}
#geosafe-toast-container .toast-dismiss-btn{position:absolute;top:14px;right:14px;padding:4px;border:0;background:transparent;border-radius:8px;color:rgba(255,255,255,0.8);cursor:pointer;line-height:0;}
#geosafe-toast-container .toast-dismiss-btn:hover{color:#fff;background:rgba(255,255,255,0.1);}
#geosafe-toast-container .toast-dismiss-btn svg{width:16px;height:16px;}
#geosafe-toast-container .toast-progress-track{position:absolute;left:0;right:0;bottom:0;height:6px;background:rgba(0,0,0,0.15);overflow:hidden;pointer-events:none;}
#geosafe-toast-container .toast-progress-fill{height:100%;background:rgba(255,255,255,0.4);}
`;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    // Only inject in real browser DOMs where <head> or <html> exists (keeps minimal
    // Node/VM test sandboxes that only mock document.body.children unaffected).
    const styleTarget = document.head || document.documentElement;
    if (!styleTarget || typeof styleTarget.appendChild !== 'function') return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CRITICAL_CSS;
    styleTarget.appendChild(style);
  }

  function ensureContainer() {
    ensureStyles();
    let container = document.getElementById('geosafe-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'geosafe-toast-container';
      document.body.appendChild(container);
    }
    // Always normalize the container to the top-right layout defined here, even if
    // another script (e.g. a legacy fallback) created it with different classes.
    container.className = CONTAINER_CLASS;
    if (typeof container.removeAttribute === 'function') {
      container.removeAttribute('aria-live');
    }
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Notifications');
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
    if (typeof document === 'undefined') return null;

    let message = '';
    let type = 'info';
    let title = '';
    let duration = DEFAULT_DURATION;

    if (typeof options === 'string') {
      message = options;
    } else if (typeof options === 'object' && options !== null) {
      message = options.message || '';
      type = (options.type || 'info').toLowerCase();
      title = options.title || '';
      if (typeof options.duration === 'number' && options.duration > 0) {
        duration = options.duration;
      }
    }

    if (!message) return null;

    const sanitizedType = THEMES[type] ? type : 'info';
    const theme = THEMES[sanitizedType];
    const displayTitle = title || theme.defaultTitle;

    const normalizedKey = `${sanitizedType}:${message.trim().toLowerCase()}`;

    // Deduplication: Prevent multiple identical toasts from stacking
    if (activeToasts.has(normalizedKey)) {
      const existing = activeToasts.get(normalizedKey);
      if (existing && existing.toastEl) {
        // Reset remaining time and restart timer
        existing.remaining = duration;
        existing.startTime = Date.now();
        if (existing.timer) clearTimeout(existing.timer);

        existing.timer = setTimeout(() => {
          dismissToast(existing.toastEl, normalizedKey);
        }, duration);

        // Reset progress bar back to 100% and restart smooth decrease
        const fillEl = existing.toastEl.querySelector('.toast-progress-fill');
        if (fillEl) {
          fillEl.style.transition = 'none';
          fillEl.style.width = '100%';
          const requestFrame = typeof requestAnimationFrame !== 'undefined'
            ? requestAnimationFrame
            : (cb) => setTimeout(cb, 16);
          requestFrame(() => {
            fillEl.style.transition = `width ${duration}ms linear`;
            fillEl.style.width = '0%';
          });
        }

        // Tactile scale feedback on existing toast
        existing.toastEl.classList.remove('scale-100');
        existing.toastEl.classList.add('scale-[1.03]', 'geosafe-toast-bump');
        setTimeout(() => {
          if (existing.toastEl) {
            existing.toastEl.classList.remove('scale-[1.03]', 'geosafe-toast-bump');
            existing.toastEl.classList.add('scale-100');
          }
        }, 150);

        return existing.toastEl;
      }
    }

    const container = ensureContainer();

    const toast = document.createElement('div');
    toast.className = `geosafe-toast geosafe-toast-${sanitizedType} pointer-events-auto relative w-full rounded-2xl p-4 sm:p-5 flex items-start gap-3.5 sm:gap-4 text-white shadow-2xl backdrop-blur-md transform transition-all duration-300 ease-out opacity-0 translate-x-8 scale-95 overflow-hidden focus:outline-none focus:ring-2 focus:ring-white/50 ${theme.bg}`;
    toast.setAttribute('role', theme.role);
    toast.setAttribute('aria-live', theme.ariaLive);
    toast.setAttribute('tabindex', '0');

    toast.innerHTML = `
      <!-- Circular White Icon Badge -->
      <div class="geosafe-toast-icon w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow-md">
        ${theme.iconSvg}
      </div>

      <!-- Content: Bold Title & Message -->
      <div class="geosafe-toast-body flex-1 min-w-0 pr-6 pt-0.5">
        <h4 class="geosafe-toast-title font-extrabold text-sm sm:text-base text-white tracking-tight leading-tight">${escapeHtml(displayTitle)}</h4>
        <p class="geosafe-toast-message text-xs sm:text-sm text-white/95 mt-1 leading-snug break-words">${escapeHtml(message)}</p>
      </div>

      <!-- Close Button (Top Right) -->
      <button
        type="button"
        aria-label="Close notification"
        class="toast-dismiss-btn absolute top-3.5 right-3.5 p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>

      <!-- Bottom Progress Bar -->
      <div class="toast-progress-track absolute bottom-0 left-0 right-0 h-1.5 bg-black/15 overflow-hidden pointer-events-none">
        <div class="toast-progress-fill h-full bg-white/40" style="width: 100%;"></div>
      </div>
    `;

    // Close button handler
    const closeBtn = toast.querySelector('.toast-dismiss-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissToast(toast, normalizedKey);
      });
    }

    // Progress bar fill element
    const progressFill = toast.querySelector('.toast-progress-fill');

    // Timer & pause/resume state management
    const toastRecord = {
      toastEl: toast,
      timer: null,
      startTime: Date.now(),
      duration,
      remaining: duration,
      isPaused: false
    };

    function startTimer(ms) {
      toastRecord.startTime = Date.now();
      toastRecord.isPaused = false;
      toastRecord.timer = setTimeout(() => {
        dismissToast(toast, normalizedKey);
      }, ms);

      if (progressFill) {
        progressFill.style.transition = `width ${ms}ms linear`;
        const requestFrame = typeof requestAnimationFrame !== 'undefined'
          ? requestAnimationFrame
          : (cb) => setTimeout(cb, 16);
        requestFrame(() => {
          progressFill.style.width = '0%';
        });
      }
    }

    function pauseTimer() {
      if (toastRecord.isPaused || toast._isDismissing) return;
      toastRecord.isPaused = true;

      if (toastRecord.timer) {
        clearTimeout(toastRecord.timer);
        toastRecord.timer = null;
      }

      const elapsed = Date.now() - toastRecord.startTime;
      toastRecord.remaining = Math.max(0, toastRecord.remaining - elapsed);

      if (progressFill) {
        // Freeze progress bar at current visually computed position
        const computedWidth = typeof window !== 'undefined' && window.getComputedStyle
          ? window.getComputedStyle(progressFill).width
          : progressFill.style.width;
        progressFill.style.transition = 'none';
        progressFill.style.width = computedWidth;
      }
    }

    function resumeTimer() {
      if (!toastRecord.isPaused || toast._isDismissing || toastRecord.remaining <= 0) return;
      startTimer(toastRecord.remaining);
    }

    // Pause on hover or keyboard focus, resume on leave/blur
    toast.addEventListener('mouseenter', pauseTimer);
    toast.addEventListener('mouseleave', resumeTimer);
    toast.addEventListener('focusin', pauseTimer);
    toast.addEventListener('focusout', resumeTimer);

    // ESC key support
    toast.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dismissToast(toast, normalizedKey);
      }
    });

    activeToasts.set(normalizedKey, toastRecord);
    container.appendChild(toast);

    // Trigger smooth entrance animation from right
    const requestFrame = typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);

    requestFrame(() => {
      toast.classList.remove('opacity-0', 'translate-x-8', 'scale-95');
      toast.classList.add('opacity-100', 'translate-x-0', 'scale-100', 'geosafe-toast-visible');
    });

    startTimer(duration);
    return toast;
  }

  function dismissToast(toast, key) {
    if (!toast || toast._isDismissing) return;
    toast._isDismissing = true;

    if (key && activeToasts.has(key)) {
      const record = activeToasts.get(key);
      if (record && record.timer) clearTimeout(record.timer);
      activeToasts.delete(key);
    } else {
      // Find key by element if not provided
      for (const [k, rec] of activeToasts.entries()) {
        if (rec && rec.toastEl === toast) {
          if (rec.timer) clearTimeout(rec.timer);
          activeToasts.delete(k);
          break;
        }
      }
    }

    // Smooth exit animation
    toast.classList.remove('opacity-100', 'translate-x-0', 'scale-100', 'geosafe-toast-visible');
    toast.classList.add('opacity-0', 'translate-x-8', 'scale-95', 'duration-200', 'geosafe-toast-leaving');

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

  function resolveArgs(message, titleOrDuration, maybeDuration) {
    let title = '';
    let duration = DEFAULT_DURATION;

    if (typeof titleOrDuration === 'string') {
      title = titleOrDuration;
      if (typeof maybeDuration === 'number') duration = maybeDuration;
    } else if (typeof titleOrDuration === 'number') {
      duration = titleOrDuration;
    } else if (typeof titleOrDuration === 'object' && titleOrDuration !== null) {
      if (titleOrDuration.title) title = titleOrDuration.title;
      if (typeof titleOrDuration.duration === 'number') duration = titleOrDuration.duration;
    }

    return { message, title, duration };
  }

  const GeoSafeToast = {
    show,
    success(message, titleOrDuration, maybeDuration) {
      const parsed = resolveArgs(message, titleOrDuration, maybeDuration);
      return show({ ...parsed, type: 'success' });
    },
    error(message, titleOrDuration, maybeDuration) {
      const parsed = resolveArgs(message, titleOrDuration, maybeDuration);
      return show({ ...parsed, type: 'error' });
    },
    info(message, titleOrDuration, maybeDuration) {
      const parsed = resolveArgs(message, titleOrDuration, maybeDuration);
      return show({ ...parsed, type: 'info' });
    },
    warning(message, titleOrDuration, maybeDuration) {
      const parsed = resolveArgs(message, titleOrDuration, maybeDuration);
      return show({ ...parsed, type: 'warning' });
    },
    dismiss(toast) {
      dismissToast(toast);
    },
    dismissAll
  };

  global.GeoSafeToast = GeoSafeToast;

  // Bridge with GeoSafeUI and GeoSafeResponderUI
  if (global.GeoSafeUI) {
    global.GeoSafeUI.showToast = function (message, type = 'info', duration = DEFAULT_DURATION) {
      return GeoSafeToast.show({ message, type, duration });
    };
  }
  if (global.GeoSafeResponderUI) {
    global.GeoSafeResponderUI.showToast = function (message, type = 'info', duration = DEFAULT_DURATION) {
      return GeoSafeToast.show({ message, type, duration });
    };
  }
})(typeof window !== 'undefined' ? window : this);
