/**
 * GeoSafe — Centralized Priority Toast Notification Queue
 * ============================================================================
 * Features:
 *   - Single-toast display: only ONE toast notification is visible at a time.
 *   - Priority Queue:
 *       1. Emergency / Critical (type: 'critical' | 'emergency' | 'error')
 *       2. Warning              (type: 'warning')
 *       3. Success              (type: 'success')
 *       4. Information          (type: 'info')
 *   - Deduplication: ignores duplicate notifications matching the same key or
 *     type + message while currently displayed or waiting in the queue.
 *   - Consistent duration (~4s default) with hover/focus pause & progress bar.
 *   - Responsive layout with mobile safe-area inset support and non-blocking
 *     pointer-events container.
 *   - Dismissing one toast cleanly advances to the next queued notification.
 * ============================================================================
 */

(function (global) {
  'use strict';

  const DEFAULT_DURATION = 4000;
  const EXIT_ANIMATION_MS = 220;

  const PRIORITY_RANK = {
    critical: 1,
    emergency: 1,
    error: 1,
    warning: 2,
    success: 3,
    info: 4,
  };

  const THEMES = {
    critical: {
      bg: 'bg-[#D93636]',
      accentColor: '#D93636',
      defaultTitle: 'Emergency Alert!',
      role: 'alert',
      ariaLive: 'assertive',
      iconSvg: `
        <svg class="w-5 h-5 text-[#D93636]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.75" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path>
        </svg>
      `,
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
      `,
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
      `,
    },
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
      `,
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
      `,
    },
  };
  THEMES.emergency = THEMES.critical;

  const CONTAINER_CLASS =
    'fixed top-3 inset-x-4 sm:inset-x-auto sm:top-5 sm:right-6 z-[9999] pointer-events-none flex flex-col items-center sm:items-end w-auto max-w-[calc(100%-2rem)] sm:max-w-[420px] sm:w-[420px]';
  const STYLE_ID = 'geosafe-toast-styles';

  const CRITICAL_CSS = `
#geosafe-toast-container{position:fixed;top:calc(env(safe-area-inset-top,0px) + 12px);left:16px;right:16px;bottom:auto;transform:none;z-index:9999;pointer-events:none;display:flex;flex-direction:column;align-items:center;width:auto;max-width:calc(100% - 32px);margin:0 auto;}
@media (min-width:640px){#geosafe-toast-container{top:calc(env(safe-area-inset-top,0px) + 20px);right:24px;left:auto;width:420px;max-width:420px;align-items:flex-end;margin:0;}}
#geosafe-toast-container .geosafe-toast{pointer-events:auto;position:relative;box-sizing:border-box;width:100%;border-radius:12px;padding:14px 16px;display:flex;align-items:flex-start;gap:12px;color:#fff;overflow:hidden;box-shadow:0 18px 38px -10px rgba(0,0,0,0.28);transition:opacity 240ms ease-out,transform 240ms ease-out;opacity:0;transform:translateX(24px) scale(0.96);}
@media (min-width:640px){#geosafe-toast-container .geosafe-toast{padding:16px 18px;gap:14px;}}
#geosafe-toast-container .geosafe-toast.geosafe-toast-visible{opacity:1;transform:translateX(0) scale(1);}
#geosafe-toast-container .geosafe-toast.geosafe-toast-bump{transform:translateX(0) scale(1.02);}
#geosafe-toast-container .geosafe-toast.geosafe-toast-leaving{opacity:0;transform:translateX(24px) scale(0.96);transition-duration:200ms;}
#geosafe-toast-container .geosafe-toast-critical,#geosafe-toast-container .geosafe-toast-emergency{background-color:#D93636;}
#geosafe-toast-container .geosafe-toast-success{background-color:#28C76F;}
#geosafe-toast-container .geosafe-toast-error{background-color:#F25430;}
#geosafe-toast-container .geosafe-toast-info{background-color:#0082E6;}
#geosafe-toast-container .geosafe-toast-warning{background-color:#F5A623;}
#geosafe-toast-container .geosafe-toast-icon{width:38px;height:38px;border-radius:9999px;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 6px -1px rgba(0,0,0,0.12);}
@media (min-width:640px){#geosafe-toast-container .geosafe-toast-icon{width:42px;height:42px;}}
#geosafe-toast-container .geosafe-toast-icon svg{width:20px;height:20px;}
#geosafe-toast-container .geosafe-toast-body{flex:1 1 0%;min-width:0;padding-right:24px;padding-top:1px;}
#geosafe-toast-container .geosafe-toast-title{margin:0;font-weight:800;color:#fff;font-size:14px;line-height:1.25;letter-spacing:-0.015em;}
#geosafe-toast-container .geosafe-toast-message{margin:3px 0 0;color:rgba(255,255,255,0.96);font-size:12px;line-height:1.35;overflow-wrap:break-word;word-break:break-word;}
@media (min-width:640px){#geosafe-toast-container .geosafe-toast-title{font-size:15px;}#geosafe-toast-container .geosafe-toast-message{font-size:13px;}}
#geosafe-toast-container .toast-dismiss-btn{position:absolute;top:12px;right:12px;padding:4px;border:0;background:transparent;border-radius:8px;color:rgba(255,255,255,0.85);cursor:pointer;line-height:0;}
#geosafe-toast-container .toast-dismiss-btn:hover{color:#fff;background:rgba(255,255,255,0.14);}
#geosafe-toast-container .toast-dismiss-btn svg{width:16px;height:16px;}
#geosafe-toast-container .toast-progress-track{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(0,0,0,0.16);overflow:hidden;pointer-events:none;}
#geosafe-toast-container .toast-progress-fill{height:100%;background:rgba(255,255,255,0.45);}
`;

  // Centralized Queue State (strictly max 1 active toast rendered at a time)
  const toastQueue = [];
  let currentToastRecord = null;
  let isTransitioningOut = false;
  let queueSeq = 0;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
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

  function normalizeToastOptions(options) {
    let message = '';
    let type = 'info';
    let title = '';
    let duration = DEFAULT_DURATION;
    let onClick = null;
    let customKey = '';
    let explicitPriority = null;

    if (typeof options === 'string') {
      message = options;
    } else if (typeof options === 'object' && options !== null) {
      message = String(options.message || '').trim();
      type = String(options.type || 'info').toLowerCase().trim();
      title = String(options.title || '').trim();
      onClick = typeof options.onClick === 'function' ? options.onClick : null;
      customKey = options.dedupeKey ? String(options.dedupeKey).trim() : '';
      if (typeof options.duration === 'number' && options.duration > 0) {
        duration = options.duration;
      }
      if (typeof options.priority === 'number' && options.priority >= 1) {
        explicitPriority = options.priority;
      }
    }

    if (!message) return null;

    const sanitizedType = THEMES[type] ? type : 'info';
    const priority = explicitPriority !== null ? explicitPriority : (PRIORITY_RANK[sanitizedType] || 4);
    const dedupeKey = customKey || `${sanitizedType}:${title.toLowerCase()}:${message.toLowerCase()}`;

    return {
      message,
      type: sanitizedType,
      title,
      duration,
      onClick,
      priority,
      dedupeKey,
      seq: ++queueSeq,
    };
  }

  function insertIntoPriorityQueue(item) {
    // Higher priority (smaller rank number) goes first; preserve FIFO within same priority
    let idx = toastQueue.length;
    for (let i = 0; i < toastQueue.length; i++) {
      if (item.priority < toastQueue[i].priority) {
        idx = i;
        break;
      }
    }
    toastQueue.splice(idx, 0, item);
  }

  function refreshActiveToastTimer(record) {
    if (!record || !record.toastEl) return;
    const { toastEl, duration } = record;
    record.remaining = duration;
    record.startTime = Date.now();
    if (record.timer) {
      clearTimeout(record.timer);
      record.timer = null;
    }
    record.timer = setTimeout(() => {
      dismissCurrentToast();
    }, duration);

    const fillEl = toastEl.querySelector('.toast-progress-fill');
    if (fillEl) {
      fillEl.style.transition = 'none';
      fillEl.style.width = '100%';
      const rf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
      rf(() => {
        fillEl.style.transition = `width ${duration}ms linear`;
        fillEl.style.width = '0%';
      });
    }

    toastEl.classList.add('geosafe-toast-bump');
    setTimeout(() => {
      if (toastEl) toastEl.classList.remove('geosafe-toast-bump');
    }, 150);
  }

  function renderToastItem(item) {
    const container = ensureContainer();
    // Enforce single visible toast guarantee: clear any stale DOM nodes before rendering
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const theme = THEMES[item.type] || THEMES.info;
    const displayTitle = item.title || theme.defaultTitle;

    const toast = document.createElement('div');
    toast.className = `geosafe-toast geosafe-toast-${item.type} pointer-events-auto relative w-full rounded-xl p-3.5 sm:p-4 flex items-start gap-3 text-white shadow-lg border border-white/15 transform transition-all duration-300 ease-out opacity-0 translate-x-6 scale-95 overflow-hidden focus:outline-none focus:ring-2 focus:ring-white/50 ${theme.bg}`;
    toast.setAttribute('role', theme.role);
    toast.setAttribute('aria-live', theme.ariaLive);
    toast.setAttribute('tabindex', '0');

    toast.innerHTML = `
      <div class="geosafe-toast-icon w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow-md">
        ${theme.iconSvg}
      </div>
      <div class="geosafe-toast-body flex-1 min-w-0 pr-6 pt-0.5">
        <h4 class="geosafe-toast-title font-extrabold text-sm sm:text-base text-white tracking-tight leading-tight">${escapeHtml(displayTitle)}</h4>
        <p class="geosafe-toast-message text-xs sm:text-sm text-white/95 mt-1 leading-snug break-words">${escapeHtml(item.message)}</p>
      </div>
      <button
        type="button"
        aria-label="Close notification"
        class="toast-dismiss-btn absolute top-3 right-3 p-1 rounded-lg text-white/85 hover:text-white hover:bg-white/15 transition-colors focus:outline-none focus:ring-2 focus:ring-white"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
      <div class="toast-progress-track absolute bottom-0 left-0 right-0 h-1 bg-black/15 overflow-hidden pointer-events-none">
        <div class="toast-progress-fill h-full bg-white/45" style="width: 100%;"></div>
      </div>
    `;

    const record = {
      item,
      dedupeKey: item.dedupeKey,
      toastEl: toast,
      timer: null,
      startTime: Date.now(),
      duration: item.duration,
      remaining: item.duration,
      isPaused: false,
    };

    const closeBtn = toast.querySelector('.toast-dismiss-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissCurrentToast();
      });
    }

    if (item.onClick) {
      toast.style.cursor = 'pointer';
      toast.addEventListener('click', () => {
        try { item.onClick(); } catch (_) {}
        dismissCurrentToast();
      });
    }

    const progressFill = toast.querySelector('.toast-progress-fill');

    function startTimer(ms) {
      record.startTime = Date.now();
      record.isPaused = false;
      if (record.timer) clearTimeout(record.timer);
      record.timer = setTimeout(() => {
        dismissCurrentToast();
      }, ms);

      if (progressFill) {
        progressFill.style.transition = `width ${ms}ms linear`;
        const rf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
        rf(() => {
          progressFill.style.width = '0%';
        });
      }
    }

    function pauseTimer() {
      if (record.isPaused || toast._isDismissing) return;
      record.isPaused = true;
      if (record.timer) {
        clearTimeout(record.timer);
        record.timer = null;
      }
      const elapsed = Date.now() - record.startTime;
      record.remaining = Math.max(0, record.remaining - elapsed);

      if (progressFill) {
        const computedWidth =
          typeof window !== 'undefined' && window.getComputedStyle
            ? window.getComputedStyle(progressFill).width
            : progressFill.style.width;
        progressFill.style.transition = 'none';
        progressFill.style.width = computedWidth;
      }
    }

    function resumeTimer() {
      if (!record.isPaused || toast._isDismissing || record.remaining <= 0) return;
      startTimer(record.remaining);
    }

    toast.addEventListener('mouseenter', pauseTimer);
    toast.addEventListener('mouseleave', resumeTimer);
    toast.addEventListener('focusin', pauseTimer);
    toast.addEventListener('focusout', resumeTimer);
    toast.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dismissCurrentToast();
      }
    });

    currentToastRecord = record;
    container.appendChild(toast);

    const rf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
    rf(() => {
      toast.classList.remove('opacity-0', 'translate-x-6', 'scale-95');
      toast.classList.add('opacity-100', 'translate-x-0', 'scale-100', 'geosafe-toast-visible');
    });

    startTimer(item.duration);
    return toast;
  }

  function processQueue() {
    if (currentToastRecord || isTransitioningOut || toastQueue.length === 0) {
      return null;
    }
    const nextItem = toastQueue.shift();
    return renderToastItem(nextItem);
  }

  function dismissCurrentToast() {
    if (!currentToastRecord || !currentToastRecord.toastEl || isTransitioningOut) return;
    const record = currentToastRecord;
    const toast = record.toastEl;
    if (toast._isDismissing) return;

    toast._isDismissing = true;
    isTransitioningOut = true;

    if (record.timer) {
      clearTimeout(record.timer);
      record.timer = null;
    }

    toast.classList.remove('opacity-100', 'translate-x-0', 'scale-100', 'geosafe-toast-visible');
    toast.classList.add('opacity-0', 'translate-x-6', 'scale-95', 'geosafe-toast-leaving');

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
      if (currentToastRecord === record) {
        currentToastRecord = null;
      }
      isTransitioningOut = false;
      processQueue();
    }, EXIT_ANIMATION_MS);
  }

  function dismissToast(toast) {
    if (!currentToastRecord) return;
    if (!toast || currentToastRecord.toastEl === toast) {
      dismissCurrentToast();
    }
  }

  function dismissAll() {
    toastQueue.length = 0;
    if (currentToastRecord) {
      dismissCurrentToast();
    }
  }

  function show(options = {}) {
    if (typeof document === 'undefined') return null;

    const item = normalizeToastOptions(options);
    if (!item) return null;

    // Deduplicate against currently active toast
    if (currentToastRecord && currentToastRecord.dedupeKey === item.dedupeKey && !isTransitioningOut) {
      refreshActiveToastTimer(currentToastRecord);
      return currentToastRecord.toastEl;
    }

    // Deduplicate against queued items
    if (toastQueue.some((q) => q.dedupeKey === item.dedupeKey)) {
      return currentToastRecord ? currentToastRecord.toastEl : null;
    }

    insertIntoPriorityQueue(item);
    return processQueue();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && currentToastRecord) {
        dismissCurrentToast();
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

  function clearInvalidField(el) {
    if (!el || !el.classList) return;
    el.classList.remove('border-[#D93636]', 'ring-2', 'ring-[#FFC2C2]');
  }

  function flagInvalidField(el, message, title = 'Required Information') {
    if (el && el.classList) {
      el.classList.add('border-[#D93636]', 'ring-2', 'ring-[#FFC2C2]');
      const clearOnce = () => clearInvalidField(el);
      el.addEventListener('input', clearOnce, { once: true });
      el.addEventListener('change', clearOnce, { once: true });
      try {
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (typeof el.focus === 'function') {
          el.focus({ preventScroll: true });
        }
      } catch (_) {}
    }
    if (message) {
      return show({ title, message, type: 'warning', duration: 4500 });
    }
    return null;
  }

  const GeoSafeToast = {
    show,
    flagInvalidField,
    clearInvalidField,
    success(message, titleOrDuration, maybeDuration) {
      const parsed = resolveArgs(message, titleOrDuration, maybeDuration);
      return show({ ...parsed, type: 'success' });
    },
    error(message, titleOrDuration, maybeDuration) {
      const parsed = resolveArgs(message, titleOrDuration, maybeDuration);
      return show({ ...parsed, type: 'error' });
    },
    critical(message, titleOrDuration, maybeDuration) {
      const parsed = resolveArgs(message, titleOrDuration, maybeDuration);
      return show({ ...parsed, type: 'critical' });
    },
    info(message, titleOrDuration, maybeDuration) {
      const parsed = resolveArgs(message, titleOrDuration, maybeDuration);
      return show({ ...parsed, type: 'info' });
    },
    warning(message, titleOrDuration, maybeDuration) {
      const parsed = resolveArgs(message, titleOrDuration, maybeDuration);
      return show({ ...parsed, type: 'warning' });
    },
    dismiss: dismissToast,
    dismissAll,
    getQueueLength() {
      return toastQueue.length;
    },
  };

  global.GeoSafeToast = GeoSafeToast;

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
