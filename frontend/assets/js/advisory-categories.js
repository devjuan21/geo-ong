/**
 * GeoSafe - Shared Broadcast Advisory Category Helper
 * Visual styling for database-driven broadcast categories.
 */
(function (window) {
  const COLOR_STYLES = {
    blue: 'background-color:#EFF6FF;color:#1D4ED8;border-color:#BFDBFE;',
    cyan: 'background-color:#ECFEFF;color:#0E7490;border-color:#A5F3FC;',
    indigo: 'background-color:#EEF2FF;color:#4338CA;border-color:#C7D2FE;',
    amber: 'background-color:#FFFBEB;color:#B45309;border-color:#FDE68A;',
    red: 'background-color:#FFF1F1;color:#D93636;border-color:#FFC2C2;',
    orange: 'background-color:#FFF7ED;color:#C2410C;border-color:#FDBA74;',
    green: 'background-color:#ECFDF5;color:#15803D;border-color:#A7F3D0;',
    purple: 'background-color:#FAF5FF;color:#7E22CE;border-color:#E9D5FF;',
    gray: 'background-color:#F3F4F6;color:#4B5563;border-color:#E5E7EB;'
  };

  function inferColorFromName(name) {
    const n = String(name || '').trim().toLowerCase();
    if (n.includes('weather')) return 'blue';
    if (n.includes('flood')) return 'cyan';
    if (n.includes('typhoon')) return 'indigo';
    if (n.includes('earthquake')) return 'amber';
    if (n.includes('fire') || n.includes('emergency')) return 'red';
    if (n.includes('evacuation')) return 'orange';
    if (n.includes('health')) return 'green';
    if (n.includes('water')) return 'purple';
    return 'gray';
  }

  function inferPriorityFromName(name) {
    const n = String(name || '').trim().toLowerCase();
    if (n.includes('emergency') || n.includes('evacuation')) return 1;
    if (n.includes('fire') || n.includes('earthquake') || n.includes('typhoon') || n.includes('flood')) return 2;
    if (n.includes('weather')) return 3;
    if (n.includes('health') || n.includes('water')) return 4;
    return 5;
  }

  function iconForName(name) {
    const n = String(name || '').trim().toLowerCase();
    if (n.includes('weather') || n.includes('typhoon')) {
      return '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"></path></svg>';
    }
    if (n.includes('flood') || n.includes('water')) {
      return '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m-6.364-2.636l.707-.707M17.657 6.343l.707-.707M3 12h1m16 0h1M6.343 6.343l-.707-.707M17.657 17.657l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z"></path></svg>';
    }
    if (n.includes('evacuation')) {
      return '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>';
    }
    if (n.includes('health')) {
      return '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>';
    }
    if (n.includes('emergency') || n.includes('fire') || n.includes('earthquake')) {
      return '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>';
    }
    return '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
  }

  function escapeText(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getStyleForCategory(categoryName, badgeColor) {
    const colorKey = String(badgeColor || inferColorFromName(categoryName)).toLowerCase();
    return COLOR_STYLES[colorKey] || COLOR_STYLES.gray;
  }

  function renderBadge(categoryName, options = {}) {
    const label = String(categoryName || 'Other').trim() || 'Other';
    const style = getStyleForCategory(label, options.badgeColor);
    const icon = iconForName(label);
    return `<span style="${style}" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-extrabold uppercase tracking-wide flex-shrink-0">${icon}<span>${escapeText(label)}</span></span>`;
  }

  function comparePriorityThenNewest(a, b) {
    const pa = Number(a.priority || inferPriorityFromName(a.categoryName || a.advisoryType || a.category));
    const pb = Number(b.priority || inferPriorityFromName(b.categoryName || b.advisoryType || b.category));
    if (pa !== pb) return pa - pb;
    return new Date(b.publishedAt || b.broadcastedAt || 0).getTime() - new Date(a.publishedAt || a.broadcastedAt || 0).getTime();
  }

  window.GeoSafeAdvisories = {
    renderBadge,
    comparePriorityThenNewest,
    getStyleForCategory
  };
})(window);
