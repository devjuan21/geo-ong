/**
 * GeoSafe — Centralized System Settings & Maintenance Controller
 * Manages Health Facilities, Evacuation Centers, Incident Categories,
 * Rescue Request Categories, and Broadcast Alert Categories from PostgreSQL.
 */
(function () {
  const state = {
    activeTab: 'overview',
    facilities: [],
    evac: [],
    incidentCats: [],
    rescueCats: [],
    broadcastCats: [],
    modal: { kind: null, id: null },
  };

  function esc(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getCsrfToken() {
    const match = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('geosafe_csrf='));
    return match ? decodeURIComponent(match.split('=')[1]) : '';
  }

  async function apiCall(path, options = {}) {
    const base = window.geoSafeStore?.config?.API_BASE_URL || '/api';
    const headers = {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': getCsrfToken() } : {}),
      ...(options.headers || {}),
    };
    const res = await fetch(`${base}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function showFeedback(elId, message, isError = false) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = message;
    el.className = isError
      ? 'p-2.5 rounded-md text-xs font-semibold bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2]'
      : 'p-2.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200';
    el.classList.remove('hidden');
  }

  function statusBadge(active, activeLabel = 'Active', inactiveLabel = 'Inactive') {
    return active
      ? `<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">${esc(activeLabel)}</span>`
      : `<span class="px-2 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-bold uppercase">${esc(inactiveLabel)}</span>`;
  }

  function renderFacilitiesTable() {
    const tbody = document.getElementById('maint-facilities-tbody');
    if (!tbody) return;
    const q = (document.getElementById('maint-facilities-search')?.value || '').trim().toLowerCase();
    const rows = state.facilities.filter(
      (f) => !q || `${f.name} ${f.facility_type} ${f.address}`.toLowerCase().includes(q)
    );
    tbody.innerHTML = rows.length
      ? rows
          .map((f) => {
            const isActive = f.status !== 'Closed';
            return `
            <tr class="hover:bg-slate-50">
              <td class="px-3 py-2.5 font-bold text-[#202020]">${esc(f.name)}</td>
              <td class="px-3 py-2.5">${esc(f.facility_type)}</td>
              <td class="px-3 py-2.5 text-slate-600">${esc(f.address)}</td>
              <td class="px-3 py-2.5 font-mono text-[11px] text-slate-500">${Number(f.latitude).toFixed(5)}, ${Number(f.longitude).toFixed(5)}</td>
              <td class="px-3 py-2.5 text-slate-600">${esc(f.emergency_contact || '—')}</td>
              <td class="px-3 py-2.5">${statusBadge(isActive, f.status, 'Closed')}</td>
              <td class="px-3 py-2.5 text-right whitespace-nowrap space-x-1.5">
                <button type="button" onclick="window.GeoSafeAdmin.openMaintenanceModal('facility', ${f.id})"
                  class="px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 text-[11px] font-bold text-[#202020]">Edit</button>
                <button type="button" onclick="window.GeoSafeAdmin.toggleMaintenanceStatus('facility', ${f.id}, ${!isActive})"
                  class="px-2.5 py-1 rounded border ${isActive ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'} text-[11px] font-bold">
                  ${isActive ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="7" class="px-3 py-6 text-center text-slate-500">No health facilities found.</td></tr>';
  }

  function renderEvacTable() {
    const tbody = document.getElementById('maint-evac-tbody');
    if (!tbody) return;
    const q = (document.getElementById('maint-evac-search')?.value || '').trim().toLowerCase();
    const rows = state.evac.filter((e) => !q || `${e.name} ${e.address}`.toLowerCase().includes(q));
    tbody.innerHTML = rows.length
      ? rows
          .map((e) => {
            const isActive = !String(e.status || '').toLowerCase().includes('closed');
            return `
            <tr class="hover:bg-slate-50">
              <td class="px-3 py-2.5 font-bold text-[#202020]">${esc(e.name)}</td>
              <td class="px-3 py-2.5 text-slate-600">${esc(e.address || 'Barangay Bayanan')}</td>
              <td class="px-3 py-2.5 font-mono text-[11px] text-slate-500">${Number(e.latitude).toFixed(5)}, ${Number(e.longitude).toFixed(5)}</td>
              <td class="px-3 py-2.5 tabular-nums">${Number(e.available_slots ?? e.capacity ?? 0)} / ${Number(e.capacity || 0)}</td>
              <td class="px-3 py-2.5">${statusBadge(isActive, e.status || 'Open - Accommodating', e.status || 'Full / Closed')}</td>
              <td class="px-3 py-2.5 text-right whitespace-nowrap space-x-1.5">
                <button type="button" onclick="window.GeoSafeAdmin.openMaintenanceModal('evac', ${e.id})"
                  class="px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 text-[11px] font-bold text-[#202020]">Edit</button>
                <button type="button" onclick="window.GeoSafeAdmin.toggleMaintenanceStatus('evac', ${e.id}, ${!isActive})"
                  class="px-2.5 py-1 rounded border ${isActive ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'} text-[11px] font-bold">
                  ${isActive ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="6" class="px-3 py-6 text-center text-slate-500">No evacuation centers found.</td></tr>';
  }

  function renderIncidentCatsTable() {
    const tbody = document.getElementById('maint-incident-cats-tbody');
    if (!tbody) return;
    tbody.innerHTML = state.incidentCats.length
      ? state.incidentCats
          .map(
            (c) => `
          <tr class="hover:bg-slate-50">
            <td class="px-3 py-2.5 font-mono text-slate-500">${Number(c.sort_order || 0)}</td>
            <td class="px-3 py-2.5 font-bold text-[#202020]">${esc(c.name)}</td>
            <td class="px-3 py-2.5">${esc(c.default_severity || 'Medium')}</td>
            <td class="px-3 py-2.5 tabular-nums">${Number(c.usage_count || 0)}</td>
            <td class="px-3 py-2.5">${statusBadge(c.is_active)}</td>
            <td class="px-3 py-2.5 text-right whitespace-nowrap space-x-1.5">
              <button type="button" onclick="window.GeoSafeAdmin.openMaintenanceModal('incident-cat', ${c.id})"
                class="px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 text-[11px] font-bold text-[#202020]">Edit</button>
              <button type="button" onclick="window.GeoSafeAdmin.toggleMaintenanceStatus('incident-cat', ${c.id}, ${!c.is_active})"
                class="px-2.5 py-1 rounded border ${c.is_active ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'} text-[11px] font-bold">
                ${c.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="px-3 py-6 text-center text-slate-500">No incident categories found.</td></tr>';
  }

  function renderRescueCatsTable() {
    const tbody = document.getElementById('maint-rescue-cats-tbody');
    if (!tbody) return;
    tbody.innerHTML = state.rescueCats.length
      ? state.rescueCats
          .map(
            (c) => `
          <tr class="hover:bg-slate-50">
            <td class="px-3 py-2.5 font-mono text-slate-500">${Number(c.sort_order || 0)}</td>
            <td class="px-3 py-2.5 font-bold text-[#202020]">${esc(c.name)}</td>
            <td class="px-3 py-2.5 text-slate-600">${esc(c.display_label || c.name)}</td>
            <td class="px-3 py-2.5 tabular-nums">${Number(c.usage_count || 0)}</td>
            <td class="px-3 py-2.5">${statusBadge(c.is_active)}</td>
            <td class="px-3 py-2.5 text-right whitespace-nowrap space-x-1.5">
              <button type="button" onclick="window.GeoSafeAdmin.openMaintenanceModal('rescue-cat', ${c.id})"
                class="px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 text-[11px] font-bold text-[#202020]">Edit</button>
              <button type="button" onclick="window.GeoSafeAdmin.toggleMaintenanceStatus('rescue-cat', ${c.id}, ${!c.is_active})"
                class="px-2.5 py-1 rounded border ${c.is_active ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'} text-[11px] font-bold">
                ${c.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="px-3 py-6 text-center text-slate-500">No rescue categories found.</td></tr>';
  }

  function renderBroadcastCatsTable() {
    const tbody = document.getElementById('maint-broadcast-cats-tbody');
    if (!tbody) return;
    tbody.innerHTML = state.broadcastCats.length
      ? state.broadcastCats
          .map(
            (c) => `
          <tr class="hover:bg-slate-50">
            <td class="px-3 py-2.5 font-mono text-slate-500">${Number(c.priority || 0)}</td>
            <td class="px-3 py-2.5 font-bold text-[#202020]">${esc(c.name)}</td>
            <td class="px-3 py-2.5 capitalize">${esc(c.badge_color || 'slate')}</td>
            <td class="px-3 py-2.5">${statusBadge(c.is_active)}</td>
            <td class="px-3 py-2.5 text-right whitespace-nowrap space-x-1.5">
              <button type="button" onclick="window.GeoSafeAdmin.openMaintenanceModal('broadcast-cat', ${c.id})"
                class="px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 text-[11px] font-bold text-[#202020]">Edit</button>
              <button type="button" onclick="window.GeoSafeAdmin.toggleMaintenanceStatus('broadcast-cat', ${c.id}, ${!c.is_active})"
                class="px-2.5 py-1 rounded border ${c.is_active ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'} text-[11px] font-bold">
                ${c.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="px-3 py-6 text-center text-slate-500">No broadcast categories found.</td></tr>';
  }

  async function loadTabData(tab) {
    try {
      if (tab === 'facilities') {
        const res = await apiCall('/admin/facilities?includeInactive=true');
        state.facilities = res.facilities || [];
        renderFacilitiesTable();
      } else if (tab === 'evacuation') {
        const evacBody = document.getElementById('maint-evac-tbody');
        if (evacBody) evacBody.innerHTML = '<tr><td colspan="6" class="px-3 py-6 text-center text-slate-500">Loading evacuation centers from PostgreSQL...</td></tr>';
        const res = await apiCall('/evacuation-centers');
        state.evac = Array.isArray(res) ? res : res.evacuation_centers || res.centers || res.evacuationCenters || [];
        renderEvacTable();
      } else if (tab === 'incident-cats') {
        const res = await apiCall('/admin/incident-categories');
        state.incidentCats = res.categories || [];
        renderIncidentCatsTable();
      } else if (tab === 'rescue-cats') {
        const res = await apiCall('/admin/rescue-categories');
        state.rescueCats = res.categories || [];
        renderRescueCatsTable();
      } else if (tab === 'broadcast-cats') {
        const res = await apiCall('/admin/broadcast-categories?includeInactive=true');
        state.broadcastCats = res.categories || [];
        renderBroadcastCatsTable();
      }
    } catch (err) {
      const fbMap = {
        facilities: 'maint-facilities-feedback',
        evacuation: 'maint-evac-feedback',
        'incident-cats': 'maint-incident-cats-feedback',
        'rescue-cats': 'maint-rescue-cats-feedback',
        'broadcast-cats': 'maint-broadcast-cats-feedback',
      };
      if (fbMap[tab]) showFeedback(fbMap[tab], err.message, true);
      if (tab === 'evacuation') {
        const evacBody = document.getElementById('maint-evac-tbody');
        if (evacBody) evacBody.innerHTML = `<tr><td colspan="6" class="px-3 py-6 text-center text-red-700 font-semibold">${esc(err.message)}</td></tr>`;
      }
    }
  }

  function fieldHtml(id, label, value = '', type = 'text', extra = '') {
    return `
      <div>
        <label for="${id}" class="block text-[10px] font-bold text-slate-500 uppercase mb-1">${esc(label)}</label>
        <input id="${id}" type="${type}" value="${esc(value)}" ${extra}
          class="w-full h-9 px-3 rounded border border-slate-300 text-xs text-[#202020]">
      </div>`;
  }

  function openMaintenanceModal(kind, id = null) {
    state.modal = { kind, id };
    const modal = document.getElementById('maintenance-modal');
    const titleEl = document.getElementById('maintenance-modal-title');
    const fieldsEl = document.getElementById('maintenance-modal-fields');
    const errEl = document.getElementById('maintenance-modal-error');
    if (!modal || !fieldsEl) return;
    if (errEl) errEl.classList.add('hidden');

    let rec = null;
    if (kind === 'facility') {
      rec = id ? state.facilities.find((x) => Number(x.id) === Number(id)) : null;
      titleEl.textContent = rec ? 'Edit Health Facility' : 'Add Health Facility';
      fieldsEl.innerHTML = [
        fieldHtml('m-fac-name', 'Facility Name *', rec?.name || '', 'text', 'required'),
        `<div><label for="m-fac-type" class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Facility Type</label>
          <select id="m-fac-type" class="w-full h-9 px-3 rounded border border-slate-300 text-xs bg-white">
            ${['Hospital', 'Health Center', 'Medical Clinic'].map((t) => `<option value="${t}" ${rec?.facility_type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>`,
        fieldHtml('m-fac-addr', 'Address *', rec?.address || '', 'text', 'required'),
        `<div class="grid grid-cols-2 gap-2.5">${fieldHtml('m-fac-lat', 'Latitude *', rec?.latitude ?? '', 'number', 'step="any" required')}${fieldHtml('m-fac-lng', 'Longitude *', rec?.longitude ?? '', 'number', 'step="any" required')}</div>`,
        fieldHtml('m-fac-contact', 'Emergency Contact', rec?.emergency_contact || ''),
      ].join('');
    } else if (kind === 'evac') {
      rec = id ? state.evac.find((x) => Number(x.id) === Number(id)) : null;
      titleEl.textContent = rec ? 'Edit Evacuation Center' : 'Add Evacuation Center';
      fieldsEl.innerHTML = [
        fieldHtml('m-evac-name', 'Center Name *', rec?.name || '', 'text', 'required'),
        fieldHtml('m-evac-addr', 'Address *', rec?.address || '', 'text', 'required'),
        `<div class="grid grid-cols-2 gap-2.5">${fieldHtml('m-evac-lat', 'Latitude *', rec?.latitude ?? '', 'number', 'step="any" required')}${fieldHtml('m-evac-lng', 'Longitude *', rec?.longitude ?? '', 'number', 'step="any" required')}</div>`,
        `<div class="grid grid-cols-2 gap-2.5">${fieldHtml('m-evac-cap', 'Capacity', rec?.capacity ?? 0, 'number', 'min="0"')}${fieldHtml('m-evac-slots', 'Available Slots', rec?.available_slots ?? 0, 'number', 'min="0"')}</div>`,
      ].join('');
    } else if (kind === 'incident-cat') {
      rec = id ? state.incidentCats.find((x) => Number(x.id) === Number(id)) : null;
      titleEl.textContent = rec ? 'Edit Incident Category' : 'Add Incident Category';
      fieldsEl.innerHTML = [
        fieldHtml('m-ic-name', 'Category Name *', rec?.name || '', 'text', 'required'),
        `<div class="grid grid-cols-2 gap-2.5">
          <div><label for="m-ic-sev" class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Default Severity</label>
            <select id="m-ic-sev" class="w-full h-9 px-3 rounded border border-slate-300 text-xs bg-white">
              ${['Low', 'Medium', 'High', 'Critical'].map((s) => `<option value="${s}" ${(rec?.default_severity || 'Medium') === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select></div>
          ${fieldHtml('m-ic-order', 'Sort Order', rec?.sort_order ?? 80, 'number', 'min="0"')}
        </div>`,
        fieldHtml('m-ic-desc', 'Description', rec?.description || ''),
      ].join('');
    } else if (kind === 'rescue-cat') {
      rec = id ? state.rescueCats.find((x) => Number(x.id) === Number(id)) : null;
      titleEl.textContent = rec ? 'Edit Rescue Category' : 'Add Rescue Category';
      fieldsEl.innerHTML = [
        fieldHtml('m-rc-name', 'Category Key *', rec?.name || '', 'text', 'required'),
        fieldHtml('m-rc-label', 'Form Display Label', rec?.display_label || ''),
        fieldHtml('m-rc-order', 'Sort Order', rec?.sort_order ?? 60, 'number', 'min="0"'),
        fieldHtml('m-rc-desc', 'Description', rec?.description || ''),
      ].join('');
    } else if (kind === 'broadcast-cat') {
      rec = id ? state.broadcastCats.find((x) => Number(x.id) === Number(id)) : null;
      titleEl.textContent = rec ? 'Edit Broadcast Category' : 'Add Broadcast Category';
      fieldsEl.innerHTML = [
        fieldHtml('m-bc-name', 'Category Name *', rec?.name || '', 'text', 'required'),
        `<div class="grid grid-cols-2 gap-2.5">
          <div><label for="m-bc-color" class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Badge Color</label>
            <select id="m-bc-color" class="w-full h-9 px-3 rounded border border-slate-300 text-xs bg-white">
              ${['blue', 'red', 'amber', 'emerald', 'slate'].map((c) => `<option value="${c}" ${(rec?.badge_color || 'blue') === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select></div>
          ${fieldHtml('m-bc-priority', 'Priority', rec?.priority ?? 70, 'number', 'min="1"')}
        </div>`,
        fieldHtml('m-bc-desc', 'Description', rec?.description || ''),
      ].join('');
    }

    modal.classList.remove('hidden');
  }

  function closeMaintenanceModal() {
    document.getElementById('maintenance-modal')?.classList.add('hidden');
    state.modal = { kind: null, id: null };
  }

  async function submitMaintenanceForm(e) {
    e.preventDefault();
    const { kind, id } = state.modal;
    const errEl = document.getElementById('maintenance-modal-error');
    if (errEl) errEl.classList.add('hidden');

    try {
      let fbId = '';
      if (kind === 'facility') {
        fbId = 'maint-facilities-feedback';
        const body = {
          name: document.getElementById('m-fac-name').value.trim(),
          facilityType: document.getElementById('m-fac-type').value,
          address: document.getElementById('m-fac-addr').value.trim(),
          latitude: Number(document.getElementById('m-fac-lat').value),
          longitude: Number(document.getElementById('m-fac-lng').value),
          emergencyContact: document.getElementById('m-fac-contact').value.trim(),
        };
        const res = await apiCall(id ? `/admin/facilities/${id}` : '/admin/facilities', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        });
        showFeedback(fbId, res.message || 'Facility saved.');
        await loadTabData('facilities');
      } else if (kind === 'evac') {
        fbId = 'maint-evac-feedback';
        const body = {
          name: document.getElementById('m-evac-name').value.trim(),
          address: document.getElementById('m-evac-addr').value.trim(),
          latitude: Number(document.getElementById('m-evac-lat').value),
          longitude: Number(document.getElementById('m-evac-lng').value),
          capacity: Number(document.getElementById('m-evac-cap').value || 0),
          available_slots: Number(document.getElementById('m-evac-slots').value || 0),
        };
        const res = await apiCall(id ? `/evacuation-centers/${id}` : '/evacuation-centers', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        });
        showFeedback(fbId, res.message || 'Evacuation center saved.');
        await loadTabData('evacuation');
      } else if (kind === 'incident-cat') {
        fbId = 'maint-incident-cats-feedback';
        const body = {
          name: document.getElementById('m-ic-name').value.trim(),
          defaultSeverity: document.getElementById('m-ic-sev').value,
          sortOrder: Number(document.getElementById('m-ic-order').value || 0),
          description: document.getElementById('m-ic-desc').value.trim(),
        };
        const res = await apiCall(id ? `/admin/incident-categories/${id}` : '/admin/incident-categories', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        });
        showFeedback(fbId, res.message || 'Incident category saved.');
        await loadTabData('incident-cats');
      } else if (kind === 'rescue-cat') {
        fbId = 'maint-rescue-cats-feedback';
        const body = {
          name: document.getElementById('m-rc-name').value.trim(),
          displayLabel: document.getElementById('m-rc-label').value.trim(),
          sortOrder: Number(document.getElementById('m-rc-order').value || 0),
          description: document.getElementById('m-rc-desc').value.trim(),
        };
        const res = await apiCall(id ? `/admin/rescue-categories/${id}` : '/admin/rescue-categories', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        });
        showFeedback(fbId, res.message || 'Rescue category saved.');
        await loadTabData('rescue-cats');
      } else if (kind === 'broadcast-cat') {
        fbId = 'maint-broadcast-cats-feedback';
        const body = {
          name: document.getElementById('m-bc-name').value.trim(),
          badgeColor: document.getElementById('m-bc-color').value,
          priority: Number(document.getElementById('m-bc-priority').value || 70),
          description: document.getElementById('m-bc-desc').value.trim(),
        };
        const res = await apiCall(id ? `/admin/broadcast-categories/${id}` : '/admin/broadcast-categories', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        });
        showFeedback(fbId, res.message || 'Broadcast category saved.');
        await loadTabData('broadcast-cats');
      }
      closeMaintenanceModal();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    }
  }

  async function toggleMaintenanceStatus(kind, id, nextActive) {
    if (!nextActive && !window.confirm('Deactivate this record? Historical reports and operational references will remain preserved.')) {
      return;
    }
    try {
      if (kind === 'facility') {
        const res = await apiCall(`/admin/facilities/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextActive ? 'Operational' : 'Closed' }),
        });
        showFeedback('maint-facilities-feedback', res.message || 'Facility status updated.');
        await loadTabData('facilities');
      } else if (kind === 'evac') {
        const res = await apiCall(`/evacuation-centers/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextActive ? 'Open - Accommodating' : 'Full / Closed' }),
        });
        showFeedback('maint-evac-feedback', res.message || 'Evacuation center status updated.');
        await loadTabData('evacuation');
      } else if (kind === 'incident-cat') {
        const res = await apiCall(`/admin/incident-categories/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: nextActive }),
        });
        showFeedback('maint-incident-cats-feedback', res.message || 'Incident category updated.');
        await loadTabData('incident-cats');
      } else if (kind === 'rescue-cat') {
        const res = await apiCall(`/admin/rescue-categories/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: nextActive }),
        });
        showFeedback('maint-rescue-cats-feedback', res.message || 'Rescue category updated.');
        await loadTabData('rescue-cats');
      } else if (kind === 'broadcast-cat') {
        const res = await apiCall(`/admin/broadcast-categories/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: nextActive }),
        });
        showFeedback('maint-broadcast-cats-feedback', res.message || 'Broadcast category updated.');
        await loadTabData('broadcast-cats');
      }
    } catch (err) {
      const fbMap = {
        facility: 'maint-facilities-feedback',
        evac: 'maint-evac-feedback',
        'incident-cat': 'maint-incident-cats-feedback',
        'rescue-cat': 'maint-rescue-cats-feedback',
        'broadcast-cat': 'maint-broadcast-cats-feedback',
      };
      if (fbMap[kind]) showFeedback(fbMap[kind], err.message, true);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.GeoSafeAdmin) {
      window.GeoSafeAdmin.switchSettingsTab = function (tab) {
        state.activeTab = tab;
        const panels = ['overview', 'facilities', 'evacuation', 'incident-cats', 'rescue-cats', 'broadcast-cats'];
        panels.forEach((p) => {
          document.getElementById(`settings-tab-${p}`)?.classList.toggle('hidden', p !== tab);
        });
        document.querySelectorAll('[data-settings-tab]').forEach((btn) => {
          const active = btn.getAttribute('data-settings-tab') === tab;
          btn.className = active
            ? 'px-3 py-1.5 rounded-md text-xs font-bold bg-[#0f172a] text-white transition-colors'
            : 'px-3 py-1.5 rounded-md text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors';
        });
        if (tab === 'facilities') { window.GeoSafeAdmin?.resetFacilityForm?.(); window.GeoSafeAdmin?.loadAdminFacilitiesList?.(); } else if (tab !== 'overview') { loadTabData(tab); }
      };
      window.GeoSafeAdmin.filterMaintenanceTable = function (kind) {
        if (kind === 'facilities') renderFacilitiesTable();
        else if (kind === 'evac') renderEvacTable();
      };
      window.GeoSafeAdmin.openMaintenanceModal = openMaintenanceModal;
      window.GeoSafeAdmin.closeMaintenanceModal = closeMaintenanceModal;
      window.GeoSafeAdmin.submitMaintenanceForm = submitMaintenanceForm;
      window.GeoSafeAdmin.toggleMaintenanceStatus = toggleMaintenanceStatus;
      window.GeoSafeAdmin.refreshMaintenanceTab = loadTabData;
    }
  });
})();
