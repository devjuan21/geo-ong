/**
 * GeoSafe — Emergency Operations Analytics Dashboard Controller
 * Renders comprehensive Incident, Rescue, Response, Responder, Geographic,
 * Communication, Heatmap, and Interactive Drill-Down analytics from genuine PostgreSQL data.
 */
(function () {
  const state = {
    data: null,
    incidentTrendGrain: 'daily',
    rescueTrendGrain: 'daily',
    geoLayer: 'all',
    heatmapMode: 'incident',
    geoMap: null,
    geoMarkersLayer: null,
    drilldown: {
      title: 'Filtered Operations',
      params: {},
      page: 1,
      totalPages: 1,
    },
  };

  function esc(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtNum(val) {
    return Number(val || 0).toLocaleString();
  }

  function fmtMin(val, sampleSize) {
    if (val === null || val === undefined || !sampleSize) return 'Insufficient data';
    const num = Number(val);
    if (!Number.isFinite(num)) return 'Insufficient data';
    if (num < 60) return `${num.toFixed(1)} min`;
    const hrs = Math.floor(num / 60);
    const rem = Math.round(num % 60);
    return `${hrs}h ${rem}m`;
  }

  async function fetchJson(path) {
    const base = window.geoSafeStore?.config?.API_BASE_URL || '/api';
    const res = await fetch(`${base}/admin${path}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function getCurrentFilterParams() {
    const period = document.getElementById('analytics-period-select')?.value || 'this_month';
    const from = document.getElementById('analytics-date-from')?.value || '';
    const to = document.getElementById('analytics-date-to')?.value || '';
    const category = document.getElementById('analytics-filter-category')?.value || 'all';
    const rescueType = document.getElementById('analytics-filter-rescue-type')?.value || 'all';
    const status = document.getElementById('analytics-filter-status')?.value || 'all';
    const location = (document.getElementById('analytics-filter-location')?.value || '').trim();
    const responderId = document.getElementById('analytics-filter-responder')?.value || '';
    const organization = document.getElementById('analytics-filter-org')?.value || 'all';

    const params = new URLSearchParams({ period });
    if (period === 'custom' && from && to) {
      params.set('from', from);
      params.set('to', to);
    }
    if (category && category !== 'all') params.set('category', category);
    if (rescueType && rescueType !== 'all') params.set('rescueType', rescueType);
    if (status && status !== 'all') params.set('status', status);
    if (location) params.set('location', location);
    if (responderId) params.set('responderId', responderId);
    if (organization && organization !== 'all') params.set('organization', organization);
    return params;
  }

  function populateFilterSelect(id, options, defaultLabel, currentVal, formatter) {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = currentVal ?? el.value;
    const items = [`<option value="${id === 'analytics-filter-responder' ? '' : 'all'}">${esc(defaultLabel)}</option>`];
    (options || []).forEach((opt) => {
      const val = formatter ? formatter(opt).value : opt;
      const label = formatter ? formatter(opt).label : opt;
      items.push(`<option value="${esc(val)}">${esc(label)}</option>`);
    });
    el.innerHTML = items.join('');
    if (prev) el.value = prev;
  }

  function renderAppliedRange(data) {
    const badge = document.getElementById('analytics-applied-range-badge');
    if (!badge) return;
    const r = data.appliedRange || {};
    if (r.startYmd && r.endYmd) {
      badge.textContent = `${r.startYmd} to ${r.endYmd} (Asia/Manila)`;
    } else {
      badge.textContent = 'All Available Records (Asia/Manila)';
    }
  }

  function renderOperationalSummary(data) {
    const sum = data.summary || {};
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set('analytics-total-reports', fmtNum(sum.totalIncidents ?? sum.totalReports));
    set('analytics-total-rescues', fmtNum(sum.totalRescues));
    set('analytics-total-events', fmtNum(sum.totalOperations ?? sum.totalEvents));
    set('analytics-active-assignments', fmtNum(sum.activeDispatches ?? sum.activeAssignments));
    set('analytics-completed-operations', fmtNum(sum.completedOperations));
    set('analytics-pending-reports', fmtNum(sum.pendingReports));
    set('analytics-unclaimed-requests', fmtNum(sum.unclaimedRequests));

    const avgEl = document.getElementById('analytics-avg-response-kpi');
    if (avgEl) {
      avgEl.textContent = sum.avgResponseSampleSize
        ? `${fmtMin(sum.avgResponseTimeMinutes, sum.avgResponseSampleSize)} (n=${sum.avgResponseSampleSize})`
        : '—';
    }

    const prevBadge = document.getElementById('analytics-prev-period-badge');
    if (prevBadge) {
      const prev = data.previousPeriodComparison;
      if (prev) {
        const cur = Number(sum.totalIncidents || 0);
        const old = Number(prev.incidents || 0);
        const diff = cur - old;
        const sign = diff > 0 ? '+' : '';
        prevBadge.textContent = `Prev period (${prev.startYmd}–${prev.endYmd}): ${old} (${sign}${diff})`;
      } else {
        prevBadge.textContent = '';
      }
    }
  }

  function renderHorizontalBreakdown(data) {
    const catList = document.getElementById('analytics-categories-list');
    const catEmpty = document.getElementById('analytics-categories-empty');
    if (catList) {
      const cats = (data.categories || []).slice().sort((a, b) => b.count - a.count);
      const maxCount = Math.max(1, ...cats.map((c) => Number(c.count || 0)));
      if (catEmpty) catEmpty.classList.toggle('hidden', cats.length > 0);
      catList.innerHTML = cats
        .map((c) => {
          const w = Math.round((Number(c.count || 0) / maxCount) * 100);
          return `
            <button type="button" onclick="window.GeoSafeAdmin.openAnalyticsDrilldown({ title: '${esc(c.name)} Incidents', recordType: 'incident', category: '${esc(c.name)}' })"
              class="w-full text-left block hover:bg-slate-50 rounded p-1.5 transition-colors">
              <div class="flex items-center justify-between gap-2 mb-1">
                <span class="font-semibold text-[#0f172a] truncate">${esc(c.name)}</span>
                <span class="font-bold text-[#0f172a] tabular-nums shrink-0">${fmtNum(c.count)} (${Number(c.percentage || 0).toFixed(1)}%)</span>
              </div>
              <div class="w-full h-1.5 rounded bg-slate-100 overflow-hidden">
                <div class="h-full rounded" style="width:${w}%; background:${esc(c.color || '#164579')}"></div>
              </div>
            </button>
          `;
        })
        .join('');
    }

    const statList = document.getElementById('analytics-statuses-list');
    const statEmpty = document.getElementById('analytics-statuses-empty');
    if (statList) {
      const stats = data.statuses || [];
      if (statEmpty) statEmpty.classList.toggle('hidden', stats.length > 0);
      statList.innerHTML = stats
        .map((st) => {
          const isResolved = st.group === 'resolved';
          const pill = isResolved
            ? '<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">Resolved</span>'
            : '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold uppercase">Active</span>';
          return `
            <button type="button" onclick="window.GeoSafeAdmin.openAnalyticsDrilldown({ title: 'Status: ${esc(st.status)}', recordType: 'incident', status: '${esc(st.status)}' })"
              class="w-full flex items-center justify-between py-2 px-1.5 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 rounded transition-colors">
              <span class="flex items-center gap-2 font-semibold text-[#0f172a] capitalize">${esc(st.status.replace(/_/g, ' '))} ${pill}</span>
              <span class="font-bold text-[#0f172a] tabular-nums">${fmtNum(st.count)} (${Number(st.percentage || 0).toFixed(1)}%)</span>
            </button>
          `;
        })
        .join('');
    }

    const locList = document.getElementById('analytics-locations-list');
    const locEmpty = document.getElementById('analytics-locations-empty');
    if (locList) {
      const locs = data.locations || [];
      if (locEmpty) locEmpty.classList.toggle('hidden', locs.length > 0);
      locList.innerHTML = locs
        .map(
          (l, idx) => `
          <button type="button" onclick="window.GeoSafeAdmin.openAnalyticsDrilldown({ title: 'Location: ${esc(l.location_name)}', recordType: 'incident', location: '${esc(l.location_name)}' })"
            class="w-full flex items-center justify-between py-2 px-1.5 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 rounded transition-colors text-left">
            <span class="font-medium text-[#0f172a] truncate pr-2">${idx + 1}. ${esc(l.location_name)}</span>
            <span class="font-bold text-[#0f172a] tabular-nums shrink-0">${fmtNum(l.count)} (${Number(l.percentage || 0).toFixed(1)}%)</span>
          </button>
        `
        )
        .join('');
    }
  }

  function renderSimpleBarSvg(containerId, rows, labelKey, emptyText, color) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!rows || rows.length === 0) {
      el.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-slate-500">${esc(emptyText)}</div>`;
      return;
    }
    const maxVal = Math.max(1, ...rows.map((r) => Number(r.count || 0)));
    const w = Math.max(420, el.clientWidth || 500);
    const h = 180;
    const padL = 32;
    const padB = 34;
    const padT = 14;
    const plotW = w - padL - 12;
    const plotH = h - padT - padB;
    const slot = plotW / rows.length;
    const barW = Math.max(8, Math.min(28, slot * 0.6));
    const step = rows.length > 10 ? Math.ceil(rows.length / 8) : 1;

    const bars = rows
      .map((r, i) => {
        const cnt = Number(r.count || 0);
        const bh = (cnt / maxVal) * plotH;
        const x = padL + i * slot + (slot - barW) / 2;
        const y = padT + plotH - bh;
        const lbl = String(r[labelKey] || '').slice(-5);
        const showLbl = i % step === 0 || i === rows.length - 1;
        return `
          <g>
            <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, bh).toFixed(1)}" rx="2" fill="${color}">
              <title>${esc(r[labelKey])}: ${cnt}</title>
            </rect>
            ${showLbl ? `<text x="${(x + barW / 2).toFixed(1)}" y="${h - 10}" text-anchor="middle" fill="#64748b" font-size="10">${esc(lbl)}</text>` : ''}
          </g>
        `;
      })
      .join('');

    el.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" class="w-full h-full">
        <line x1="${padL}" y1="${padT + plotH}" x2="${w - 12}" y2="${padT + plotH}" stroke="#cbd5e1" stroke-width="1"/>
        <text x="${padL - 6}" y="${padT + 8}" text-anchor="end" fill="#64748b" font-size="10">${maxVal}</text>
        <text x="${padL - 6}" y="${padT + plotH}" text-anchor="end" fill="#64748b" font-size="10">0</text>
        ${bars}
      </svg>
    `;
  }

  function renderRescueAnalytics(data) {
    const rq = data.rescueAnalytics || {};
    const cvc = rq.completedVsCancelled || {};
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmtNum(v);
    };
    set('rescue-stat-completed', cvc.completed);
    set('rescue-stat-cancelled', cvc.cancelled);
    set('rescue-stat-unclaimed', cvc.pendingUnclaimed);
    set('rescue-stat-active', cvc.acceptedOnScene);

    const peopleBadge = document.getElementById('analytics-rescue-people-badge');
    if (peopleBadge) {
      peopleBadge.textContent = rq.peopleRescuedSampleSize
        ? `People Rescued: ${fmtNum(rq.totalPeopleRescued)} (n=${rq.peopleRescuedSampleSize} outcomes)`
        : 'People Rescued: Not recorded';
    }

    const trendRows = state.rescueTrendGrain === 'monthly' ? rq.byMonth || [] : rq.byDay || [];
    const labelKey = state.rescueTrendGrain === 'monthly' ? 'monthLabel' : 'date';
    renderSimpleBarSvg('analytics-rescue-trend-chart', trendRows, labelKey, 'No rescue requests for the selected filters.', '#b91c1c');

    const stEl = document.getElementById('analytics-rescue-status-list');
    if (stEl) {
      const rows = [
        ...(rq.statusDistribution || []).map((s) => ({
          label: s.status.replace(/_/g, ' '),
          count: s.count,
          pct: s.percentage,
          kind: 'status',
          raw: s.status,
        })),
        ...(rq.byType || []).map((t) => ({
          label: `Type: ${t.type}`,
          count: t.count,
          pct: t.percentage,
          kind: 'rescueType',
          raw: t.type,
        })),
      ];
      stEl.innerHTML = rows.length
        ? rows
            .map(
              (r) => `
              <button type="button" onclick="window.GeoSafeAdmin.openAnalyticsDrilldown({ title: 'Rescues (${esc(r.label)})', recordType: 'rescue', ${r.kind}: '${esc(r.raw)}' })"
                class="w-full flex items-center justify-between py-1 px-1 hover:bg-slate-50 rounded text-left">
                <span class="capitalize text-[#0f172a] truncate pr-2">${esc(r.label)}</span>
                <span class="font-bold text-[#0f172a] tabular-nums shrink-0">${fmtNum(r.count)} (${Number(r.pct || 0).toFixed(1)}%)</span>
              </button>
            `
            )
            .join('')
        : '<p class="text-slate-500 py-4 text-center">No rescue data recorded.</p>';
    }

    const locEl = document.getElementById('analytics-rescue-locations-list');
    if (locEl) {
      const locs = rq.byLocation || [];
      locEl.innerHTML = locs.length
        ? locs
            .map(
              (l) => `
              <button type="button" onclick="window.GeoSafeAdmin.openAnalyticsDrilldown({ title: 'Rescues at ${esc(l.location_name)}', recordType: 'rescue', location: '${esc(l.location_name)}' })"
                class="w-full flex items-center justify-between py-1 px-1 hover:bg-slate-50 rounded text-left">
                <span class="text-[#0f172a] truncate pr-2">${esc(l.location_name)}</span>
                <span class="font-bold text-[#0f172a] tabular-nums shrink-0">${fmtNum(l.count)} (${Number(l.percentage || 0).toFixed(1)}%)</span>
              </button>
            `
            )
            .join('')
        : '<p class="text-slate-500 py-4 text-center">No rescue locations recorded.</p>';
    }
  }

  function renderResponsePerformance(data) {
    const rp = data.responsePerformance || {};
    const container = document.getElementById('analytics-response-perf-grid');
    if (!container) return;

    const rows = [
      { label: 'Average Acceptance Time', val: fmtMin(rp.avgAcceptanceMinutes, rp.acceptanceSampleSize), n: rp.acceptanceSampleSize },
      { label: 'Average Travel Time', val: fmtMin(rp.avgTravelMinutes, rp.travelSampleSize), n: rp.travelSampleSize },
      { label: 'Average Response Time', val: fmtMin(rp.avgResponseMinutes, rp.responseSampleSize), n: rp.responseSampleSize },
      { label: 'Average Operation Duration', val: fmtMin(rp.avgDurationMinutes, rp.durationSampleSize), n: rp.durationSampleSize },
      { label: 'Fastest Recorded Response', val: fmtMin(rp.fastestResponseMinutes, rp.responseSampleSize), n: rp.responseSampleSize },
      { label: 'Longest Recorded Response', val: fmtMin(rp.longestResponseMinutes, rp.responseSampleSize), n: rp.responseSampleSize },
      { label: 'Completed Operations', val: fmtNum(rp.completedOperations), n: null },
      { label: 'Operations Still in Progress', val: fmtNum(rp.inProgressOperations), n: null },
    ];

    container.innerHTML = rows
      .map(
        (r) => `
        <div class="flex items-center justify-between gap-2 py-2">
          <span class="text-slate-600 font-medium">${esc(r.label)}</span>
          <span class="font-bold text-[#0f172a] tabular-nums text-right">
            ${esc(r.val)}${r.n !== null ? ` <span class="text-[10px] font-normal text-slate-500">(n=${r.n})</span>` : ''}
          </span>
        </div>
      `
      )
      .join('');
  }

  function renderResponderPerformance(data) {
    const tbody = document.getElementById('analytics-responder-perf-tbody');
    const orgWrap = document.getElementById('analytics-org-perf-summary');
    const rows = data.responderPerformance || [];
    const orgs = data.organizationPerformance || [];

    if (tbody) {
      tbody.innerHTML = rows.length
        ? rows
            .map(
              (r) => `
              <tr onclick="window.GeoSafeAdmin.openAnalyticsDrilldown({ title: 'Responder: ${esc(r.name)}', recordType: 'all', responderId: ${r.responderId} })"
                class="hover:bg-slate-50 cursor-pointer">
                <td class="px-3 py-2 font-semibold text-[#0f172a]">${esc(r.name)}${r.badgeNumber ? ` <span class="text-[10px] font-mono text-slate-500">(${esc(r.badgeNumber)})</span>` : ''}</td>
                <td class="px-3 py-2 text-slate-600">${esc(r.organization)}</td>
                <td class="px-3 py-2 text-right tabular-nums font-bold">${fmtNum(r.acceptedCount)}</td>
                <td class="px-3 py-2 text-right tabular-nums font-bold text-emerald-700">${fmtNum(r.completedCount)}</td>
                <td class="px-3 py-2 text-right tabular-nums font-bold text-[#164579]">${fmtNum(r.activeAssignments)}</td>
                <td class="px-3 py-2 text-right tabular-nums">${esc(fmtMin(r.avgAcceptanceMinutes, r.acceptanceSampleSize))} <span class="text-[10px] text-slate-400">(${r.acceptanceSampleSize})</span></td>
                <td class="px-3 py-2 text-right tabular-nums">${esc(fmtMin(r.avgArrivalMinutes, r.arrivalSampleSize))} <span class="text-[10px] text-slate-400">(${r.arrivalSampleSize})</span></td>
              </tr>
            `
            )
            .join('')
        : '<tr><td colspan="7" class="px-3 py-6 text-center text-slate-500">No responder assignments recorded for the selected filters.</td></tr>';
    }

    if (orgWrap) {
      orgWrap.innerHTML = orgs
        .map(
          (o) => `
          <button type="button" onclick="window.GeoSafeAdmin.openAnalyticsDrilldown({ title: 'Organization: ${esc(o.organization)}', recordType: 'all', organization: '${esc(o.organization)}' })"
            class="p-2.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left transition-colors">
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-[#0f172a] truncate">${esc(o.organization)}</span>
              <span class="text-[10px] font-semibold text-slate-500">${o.responderCount} responders</span>
            </div>
            <div class="text-[11px] text-slate-600 mt-1">
              Completed: <strong>${fmtNum(o.completedCount)}</strong> • Active: <strong>${fmtNum(o.activeAssignments)}</strong> • Avg Response: <strong>${esc(fmtMin(o.avgResponseMinutes, o.responseSampleSize))}</strong>
            </div>
          </button>
        `
        )
        .join('');
    }
  }

  function renderGeographicAnalytics(data) {
    const geo = data.geographicAnalytics || {};
    const tbody = document.getElementById('analytics-geo-areas-tbody');
    const areas = geo.topAreas || [];

    if (tbody) {
      tbody.innerHTML = areas.length
        ? areas
            .map(
              (a) => `
              <tr onclick="window.GeoSafeAdmin.openAnalyticsDrilldown({ title: 'Area: ${esc(a.locationName)}', recordType: 'all', location: '${esc(a.locationName)}' })"
                class="hover:bg-slate-50 cursor-pointer">
                <td class="px-3 py-2 font-medium text-[#0f172a]">
                  ${esc(a.locationName)}
                  ${a.isRepeated ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-bold uppercase">Repeated</span>' : ''}
                </td>
                <td class="px-3 py-2 text-right tabular-nums font-bold">${fmtNum(a.incidentCount)}</td>
                <td class="px-3 py-2 text-right tabular-nums font-bold text-[#b91c1c]">${fmtNum(a.rescueCount)}</td>
                <td class="px-3 py-2 text-slate-600">${esc(a.topCategory)}</td>
              </tr>
            `
            )
            .join('')
        : '<tr><td colspan="4" class="px-3 py-6 text-center text-slate-500">No geographic area records found.</td></tr>';
    }

    const mapEl = document.getElementById('analytics-geo-map');
    if (!mapEl || typeof L === 'undefined') return;

    if (!state.geoMap) {
      state.geoMap = L.map(mapEl, { zoomControl: true }).setView([14.413, 121.036], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(state.geoMap);
      state.geoMarkersLayer = L.layerGroup().addTo(state.geoMap);
    }

    setTimeout(() => state.geoMap?.invalidateSize(), 120);
    state.geoMarkersLayer.clearLayers();

    const bounds = [];
    if (state.geoLayer === 'all' || state.geoLayer === 'incident') {
      (geo.incidentPoints || []).forEach((p) => {
        const marker = L.circleMarker([p.latitude, p.longitude], {
          radius: 6,
          color: '#164579',
          fillColor: '#2563EB',
          fillOpacity: 0.75,
          weight: 1.5,
        }).bindPopup(`<strong>${esc(p.referenceNumber || 'Incident')}</strong><br>${esc(p.category)} • ${esc(p.status)}<br>${esc(p.address)}`);
        state.geoMarkersLayer.addLayer(marker);
        bounds.push([p.latitude, p.longitude]);
      });
    }
    if (state.geoLayer === 'all' || state.geoLayer === 'rescue') {
      (geo.rescuePoints || []).forEach((p) => {
        const marker = L.circleMarker([p.latitude, p.longitude], {
          radius: 6,
          color: '#991b1b',
          fillColor: '#DC2626',
          fillOpacity: 0.8,
          weight: 1.5,
        }).bindPopup(`<strong>${esc(p.referenceNumber || 'Rescue')}</strong><br>${esc(p.emergencyType)} • ${esc(p.status)}<br>${esc(p.address)}`);
        state.geoMarkersLayer.addLayer(marker);
        bounds.push([p.latitude, p.longitude]);
      });
    }
    if (bounds.length > 0) {
      state.geoMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
    }
  }

  function renderCommunicationAnalytics(data) {
    const comm = data.communicationAnalytics || {};
    const el = document.getElementById('analytics-comm-summary');
    if (!el) return;

    const listChips = (arr) =>
      arr && arr.length
        ? arr.map((x) => `<span class="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-700">${esc(x.label)}: ${fmtNum(x.count)}</span>`).join(' ')
        : '<span class="text-slate-400">None recorded</span>';

    el.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div class="p-2.5 rounded bg-slate-50 border border-slate-200">
          <span class="text-[10px] font-bold text-slate-500 uppercase block">Published</span>
          <span class="text-lg font-bold text-[#0f172a] tabular-nums">${fmtNum(comm.totalBroadcasts)}</span>
        </div>
        <div class="p-2.5 rounded bg-emerald-50 border border-emerald-200">
          <span class="text-[10px] font-bold text-emerald-700 uppercase block">Active / Expired</span>
          <span class="text-lg font-bold text-emerald-800 tabular-nums">${fmtNum(comm.activeBroadcasts)} / ${fmtNum(comm.expiredBroadcasts)}</span>
        </div>
        <div class="p-2.5 rounded bg-blue-50 border border-blue-200">
          <span class="text-[10px] font-bold text-[#164579] uppercase block">Deliveries</span>
          <span class="text-lg font-bold text-[#164579] tabular-nums">${fmtNum(comm.totalDeliveries)}</span>
        </div>
        <div class="p-2.5 rounded bg-amber-50 border border-amber-200">
          <span class="text-[10px] font-bold text-amber-700 uppercase block">Read / Unread</span>
          <span class="text-lg font-bold text-amber-800 tabular-nums">${fmtNum(comm.readCount)} / ${fmtNum(comm.unreadCount)}</span>
        </div>
      </div>
      <div class="space-y-1.5 pt-1">
        <div><span class="text-[10px] font-bold text-slate-500 uppercase block mb-1">By Category</span><div class="flex flex-wrap gap-1.5">${listChips(comm.byCategory)}</div></div>
        <div><span class="text-[10px] font-bold text-slate-500 uppercase block mb-1">By Urgency</span><div class="flex flex-wrap gap-1.5">${listChips(comm.byUrgency)}</div></div>
        <div><span class="text-[10px] font-bold text-slate-500 uppercase block mb-1">Target Audience</span><div class="flex flex-wrap gap-1.5">${listChips(comm.byTargetAudience)}</div></div>
      </div>
    `;
  }

  function renderActivityHeatmap(data) {
    const el = document.getElementById('analytics-activity-heatmap');
    if (!el) return;
    const hm = data.activityHeatmap || {};
    const cells = state.heatmapMode === 'rescue' ? hm.rescueHeatmap || [] : hm.incidentHeatmap || [];

    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    let maxVal = 0;
    cells.forEach((c) => {
      if (c.dow >= 0 && c.dow < 7 && c.hour >= 0 && c.hour < 24) {
        grid[c.dow][c.hour] = c.count;
        if (c.count > maxVal) maxVal = c.count;
      }
    });

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hoursHeader = Array.from({ length: 24 }, (_, h) => `<th class="text-[9px] font-semibold text-slate-500 px-0.5 text-center">${String(h).padStart(2, '0')}</th>`).join('');
    const rowsHtml = days
      .map((dayName, dow) => {
        const tds = Array.from({ length: 24 }, (_, hour) => {
          const val = grid[dow][hour];
          const intensity = maxVal > 0 ? val / maxVal : 0;
          const bg =
            val === 0
              ? 'bg-slate-100 text-slate-300'
              : intensity > 0.75
                ? 'bg-[#164579] text-white'
                : intensity > 0.4
                  ? 'bg-[#3b82f6] text-white'
                  : 'bg-blue-100 text-[#164579]';
          return `
            <td class="p-0.5">
              <button type="button"
                onclick="window.GeoSafeAdmin.openAnalyticsDrilldown({ title: '${dayName} ${String(hour).padStart(2, '0')}:00 PHT', recordType: '${state.heatmapMode}', dow: ${dow}, hour: ${hour} })"
                title="${dayName} ${String(hour).padStart(2, '0')}:00 — ${val} ${state.heatmapMode}(s)"
                class="w-6 h-6 rounded-[3px] text-[10px] font-bold flex items-center justify-center ${bg} hover:ring-1 hover:ring-[#0f172a]">
                ${val > 0 ? val : ''}
              </button>
            </td>
          `;
        }).join('');
        return `<tr><td class="pr-2 text-[10px] font-bold text-slate-600 whitespace-nowrap">${dayName}</td>${tds}</tr>`;
      })
      .join('');

    el.innerHTML = `
      <table class="min-w-max border-collapse">
        <thead><tr><th></th>${hoursHeader}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }

  async function refreshAllAnalytics() {
    const params = getCurrentFilterParams();
    try {
      const data = await fetchJson(`/analytics?${params.toString()}`);
      state.data = data;

      if (data.filterOptions) {
        populateFilterSelect('analytics-filter-category', data.filterOptions.categories, 'All Categories');
        populateFilterSelect('analytics-filter-rescue-type', data.filterOptions.rescueTypes, 'All Rescue Types');
        populateFilterSelect('analytics-filter-responder', data.filterOptions.responders, 'All Responders', null, (r) => ({
          value: String(r.id),
          label: r.badgeNumber ? `${r.name} (${r.badgeNumber})` : r.name,
        }));
        populateFilterSelect('analytics-filter-org', data.filterOptions.organizations, 'All Orgs');
      }

      renderAppliedRange(data);
      renderOperationalSummary(data);
      renderHorizontalBreakdown(data);
      renderRescueAnalytics(data);
      renderResponsePerformance(data);
      renderResponderPerformance(data);
      renderGeographicAnalytics(data);
      renderCommunicationAnalytics(data);
      renderActivityHeatmap(data);

      // Update Monthly previous-year comparison badge when monthly data loads
      const monthlyYear = document.getElementById('analytics-monthly-year-select')?.value || '';
      fetchJson(`/analytics/monthly-categories${monthlyYear ? `?year=${encodeURIComponent(monthlyYear)}` : ''}`)
        .then((mData) => {
          const badge = document.getElementById('analytics-monthly-prev-year-badge');
          if (badge) {
            badge.textContent = mData.previousYearTotal > 0
              ? `Stacked Jan–Dec (${mData.previousYear}: ${fmtNum(mData.previousYearTotal)} reports)`
              : 'Stacked incident report counts by category (January–December)';
          }
        })
        .catch(() => {});

      // Render primary incident trend chart according to selected grain
      if (state.incidentTrendGrain === 'weekly') {
        renderSimpleBarSvg('analytics-daily-bar-chart', data.weeklyTrends || [], 'weekStart', 'No weekly incidents recorded.', '#0A58CA');
        document.getElementById('analytics-daily-empty')?.classList.add('hidden');
        document.getElementById('analytics-daily-bar-chart')?.classList.remove('hidden');
      } else if (state.incidentTrendGrain === 'monthly') {
        renderSimpleBarSvg('analytics-daily-bar-chart', data.monthlyTrends || [], 'month_label', 'No monthly incidents recorded.', '#0A58CA');
        document.getElementById('analytics-daily-empty')?.classList.add('hidden');
        document.getElementById('analytics-daily-bar-chart')?.classList.remove('hidden');
      }
    } catch (err) {
      console.error('[GeoSafeAnalytics] refresh failed:', err.message);
    }
  }

  async function loadDrilldownPage() {
    const tbody = document.getElementById('analytics-drilldown-tbody');
    const pageInfo = document.getElementById('analytics-drilldown-page-info');
    const prevBtn = document.getElementById('analytics-drilldown-prev');
    const nextBtn = document.getElementById('analytics-drilldown-next');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-6 text-center text-slate-500">Loading matching records...</td></tr>';

    const params = getCurrentFilterParams();
    Object.entries(state.drilldown.params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    });
    params.set('page', String(state.drilldown.page));
    params.set('limit', '12');

    try {
      const res = await fetchJson(`/analytics/drilldown?${params.toString()}`);
      state.drilldown.totalPages = res.totalPages || 1;
      if (pageInfo) pageInfo.textContent = `Page ${res.page} of ${res.totalPages} (${fmtNum(res.total)} records)`;
      if (prevBtn) prevBtn.disabled = res.page <= 1;
      if (nextBtn) nextBtn.disabled = res.page >= res.totalPages;

      tbody.innerHTML = res.records && res.records.length
        ? res.records
            .map(
              (r) => `
              <tr class="hover:bg-slate-50">
                <td class="px-3 py-2 font-mono font-bold text-[#0f172a]">${esc(r.referenceNumber)}</td>
                <td class="px-3 py-2 capitalize">${esc(r.recordType)}</td>
                <td class="px-3 py-2">${esc(r.category)}</td>
                <td class="px-3 py-2 capitalize font-semibold">${esc(String(r.status || '').replace(/_/g, ' '))}</td>
                <td class="px-3 py-2">${esc(r.location)}</td>
                <td class="px-3 py-2">${esc(r.responderName)}</td>
                <td class="px-3 py-2 text-slate-500 whitespace-nowrap">${r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
              </tr>
            `
            )
            .join('')
        : '<tr><td colspan="7" class="px-3 py-6 text-center text-slate-500">No matching records found.</td></tr>';
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="px-3 py-6 text-center text-red-600">${esc(err.message)}</td></tr>`;
    }
  }

  function wireFilterListeners() {
    [
      'analytics-filter-category',
      'analytics-filter-rescue-type',
      'analytics-filter-status',
      'analytics-filter-responder',
      'analytics-filter-org',
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => window.GeoSafeAdmin?.loadAnalyticsData?.());
    });
    document.getElementById('analytics-filter-location')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.GeoSafeAdmin?.loadAnalyticsData?.();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireFilterListeners();
    if (window.GeoSafeAdmin) {
      const origLoad = window.GeoSafeAdmin.loadAnalyticsData;
      window.GeoSafeAdmin.loadAnalyticsData = async function () {
        if (typeof origLoad === 'function') await origLoad();
        await refreshAllAnalytics();
      };
      window.GeoSafeAdmin.resetAnalyticsFilters = function () {
        ['analytics-filter-category', 'analytics-filter-rescue-type', 'analytics-filter-status', 'analytics-filter-org'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = 'all';
        });
        const locEl = document.getElementById('analytics-filter-location');
        if (locEl) locEl.value = '';
        const respEl = document.getElementById('analytics-filter-responder');
        if (respEl) respEl.value = '';
        window.GeoSafeAdmin.loadAnalyticsData();
      };
      window.GeoSafeAdmin.setIncidentTrendGrain = function (grain) {
        state.incidentTrendGrain = grain;
        document.querySelectorAll('[data-trend-grain]').forEach((btn) => {
          const active = btn.getAttribute('data-trend-grain') === grain;
          btn.className = active ? 'px-2.5 py-1 bg-[#0f172a] text-white' : 'px-2.5 py-1 bg-white text-slate-700 hover:bg-slate-50';
        });
        window.GeoSafeAdmin.loadAnalyticsData();
      };
      window.GeoSafeAdmin.setRescueTrendGrain = function (grain) {
        state.rescueTrendGrain = grain;
        document.querySelectorAll('[data-rescue-grain]').forEach((btn) => {
          const active = btn.getAttribute('data-rescue-grain') === grain;
          btn.className = active ? 'px-2 py-0.5 bg-[#0f172a] text-white' : 'px-2 py-0.5 bg-white text-slate-700';
        });
        if (state.data) renderRescueAnalytics(state.data);
      };
      window.GeoSafeAdmin.setAnalyticsGeoLayer = function (layer) {
        state.geoLayer = layer;
        document.querySelectorAll('[data-geo-layer]').forEach((btn) => {
          const active = btn.getAttribute('data-geo-layer') === layer;
          btn.className = active ? 'px-2.5 py-1 bg-[#0f172a] text-white' : 'px-2.5 py-1 bg-white text-slate-700';
        });
        if (state.data) renderGeographicAnalytics(state.data);
      };
      window.GeoSafeAdmin.setAnalyticsHeatmapMode = function (mode) {
        state.heatmapMode = mode;
        document.querySelectorAll('[data-heatmap-mode]').forEach((btn) => {
          const active = btn.getAttribute('data-heatmap-mode') === mode;
          btn.className = active ? 'px-2.5 py-1 bg-[#0f172a] text-white' : 'px-2.5 py-1 bg-white text-slate-700';
        });
        if (state.data) renderActivityHeatmap(state.data);
      };
      window.GeoSafeAdmin.openAnalyticsDrilldown = function (opts = {}) {
        state.drilldown.title = opts.title || 'Filtered Operations';
        const { title, ...rest } = opts;
        state.drilldown.params = rest;
        state.drilldown.page = 1;
        const modal = document.getElementById('analytics-drilldown-modal');
        const titleEl = document.getElementById('analytics-drilldown-title');
        if (titleEl) titleEl.textContent = state.drilldown.title;
        if (modal) modal.classList.remove('hidden');
        loadDrilldownPage();
      };
      window.GeoSafeAdmin.closeAnalyticsDrilldown = function () {
        document.getElementById('analytics-drilldown-modal')?.classList.add('hidden');
      };
      window.GeoSafeAdmin.changeDrilldownPage = function (delta) {
        const next = state.drilldown.page + delta;
        if (next < 1 || next > state.drilldown.totalPages) return;
        state.drilldown.page = next;
        loadDrilldownPage();
      };
    }
  });
})();
