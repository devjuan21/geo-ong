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
    return `<span style="${style}" class="inline-flex items-center px-2.5 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide flex-shrink-0"><span>${escapeText(label)}</span></span>`;
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
