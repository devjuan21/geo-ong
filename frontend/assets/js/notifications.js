/**
 * GeoSafe - Notification Center Page Logic
 */

let activeFilter = 'All';

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeUI.init('notifications', 'Notifications');
  setupFilterTabs();
  await loadNotifications();
});

function setupFilterTabs() {
  const tabs = document.querySelectorAll('.notif-filter-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('bg-brand-900', 'text-white', 'font-semibold');
        t.classList.add('bg-white', 'text-slate-600', 'hover:bg-slate-100');
      });
      tab.classList.remove('bg-white', 'text-slate-600', 'hover:bg-slate-100');
      tab.classList.add('bg-brand-900', 'text-white', 'font-semibold');

      activeFilter = tab.getAttribute('data-filter');
      loadNotifications();
    });
  });
}

async function loadNotifications() {
  const loadingEl = document.getElementById('notifs-loading');
  const errorEl = document.getElementById('notifs-error');
  const emptyEl = document.getElementById('notifs-empty');
  const container = document.getElementById('notifs-container');

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');
  if (container) container.classList.add('hidden');

  try {
    const list = await window.geoSafeStore.getNotifications(activeFilter);
    if (loadingEl) loadingEl.classList.add('hidden');

    if (!list || list.length === 0) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (container) {
      container.classList.remove('hidden');
      renderNotifications(list);
    }
  } catch (err) {
    console.error(err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) {
      errorEl.classList.remove('hidden');
      const msg = document.getElementById('notifs-error-text');
      if (msg) {
        msg.textContent = err.isOffline
          ? 'Network offline. An active connection is required to retrieve notification feed.'
          : 'Unable to load notifications.';
      }
    }
  }
}

function renderNotifications(notifs) {
  const listEl = document.getElementById('notifs-list');
  if (!listEl) return;

  const categoryIcons = {
    rescue: { icon: 'life-buoy', color: 'bg-emergency-100 text-emergency-600' },
    report: { icon: 'file-text', color: 'bg-brand-100 text-brand-700' },
    alert: { icon: 'alert-triangle', color: 'bg-amber-100 text-amber-700' },
    family: { icon: 'users', color: 'bg-emerald-100 text-emerald-700' },
    system: { icon: 'info', color: 'bg-slate-100 text-slate-700' }
  };

  listEl.innerHTML = notifs.map(n => {
    const iconCfg = categoryIcons[n.category] || categoryIcons.system;
    const isUnread = !n.read;

    return `
      <div class="p-4 sm:p-5 rounded-2xl border ${isUnread ? 'border-brand-200 bg-brand-50/30' : 'border-slate-200 bg-white'} shadow-subtle flex items-start gap-4 transition-all hover:shadow-card">
        <div class="w-10 h-10 rounded-xl ${iconCfg.color} flex items-center justify-center flex-shrink-0">
          ${GeoSafeUI.getIcon(iconCfg.icon, 'w-5 h-5')}
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <h4 class="text-sm font-bold text-slate-900 leading-snug">${n.title}</h4>
            <div class="flex items-center gap-2 flex-shrink-0">
              <span class="text-xs text-slate-400">${GeoSafeUI.formatRelative(n.timestamp)}</span>
              ${isUnread ? `<span class="w-2.5 h-2.5 rounded-full bg-brand-600" title="Unread"></span>` : ''}
            </div>
          </div>
          <p class="text-xs text-slate-600 mt-1 leading-relaxed">${n.description}</p>

          <div class="mt-3 flex items-center justify-between pt-2 border-t border-slate-100">
            <a href="${n.link || '#'}" class="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-800">
              <span>View Related Details</span>
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
            </a>
            ${isUnread ? `
              <button onclick="markAsRead('${n.id}')" class="text-xs text-slate-500 hover:text-slate-800 font-medium">
                Mark as Read
              </button>
            ` : `
              <span class="text-[11px] text-slate-400">Read</span>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.markAsRead = async function (id) {
  try {
    await window.geoSafeStore.markNotificationAsRead(id);
    GeoSafeUI.updateUnreadNotificationBadge();
    await loadNotifications();
  } catch (e) {
    GeoSafeUI.showToast('Could not update notification status.', 'error');
  }
};

window.markAllAsRead = async function () {
  try {
    await window.geoSafeStore.markAllNotificationsAsRead();
    GeoSafeUI.updateUnreadNotificationBadge();
    GeoSafeUI.showToast('All notifications marked as read.', 'success');
    await loadNotifications();
  } catch (e) {
    GeoSafeUI.showToast('Could not mark all notifications.', 'error');
  }
};

window.loadNotifications = loadNotifications;

