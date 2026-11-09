/**
 * GeoSafe - Evacuation Centers Page Logic
 * Features:
 * - Interactive Leaflet map with colored capacity markers
 * - Evacuation center list with real-time occupancy metrics
 * - Facilities checklist
 * - "View on Map" auto-panning and popup trigger
 * - Filter by status
 */

let evacMap = null;
let evacMarkers = {};
let allCenters = [];

document.addEventListener('DOMContentLoaded', async () => {
  GeoSafeUI.init('evacuation-centers', 'Evacuation Centers');
  initEvacMap();
  setupFilterButtons();
  await loadEvacuationCenters();
});

function initEvacMap() {
  const mapEl = document.getElementById('evac-map');
  if (!mapEl || typeof L === 'undefined') return;

  try {
    evacMap = L.map('evac-map').setView([14.4075, 121.0475], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors | Barangay Bayanan Evac Map'
    }).addTo(evacMap);
  } catch (err) {
    console.warn('Evac map init warning:', err);
  }
}

function setupFilterButtons() {
  const buttons = document.querySelectorAll('.evac-filter-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => {
        b.classList.remove('bg-brand-900', 'text-white', 'font-semibold');
        b.classList.add('bg-white', 'text-slate-600', 'hover:bg-slate-100');
      });
      btn.classList.remove('bg-white', 'text-slate-600', 'hover:bg-slate-100');
      btn.classList.add('bg-brand-900', 'text-white', 'font-semibold');

      const filter = btn.getAttribute('data-status');
      filterEvacuationCenters(filter);
    });
  });
}

async function loadEvacuationCenters() {
  const loadingEl = document.getElementById('evac-loading');
  const errorEl = document.getElementById('evac-error');
  const container = document.getElementById('evac-content-container');

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  if (container) container.classList.add('hidden');

  try {
    allCenters = await window.geoSafeStore.getEvacuationCenters('All');
    if (loadingEl) loadingEl.classList.add('hidden');

    if (container) container.classList.remove('hidden');

    renderCenterCards(allCenters);
    renderMapMarkers(allCenters);
  } catch (err) {
    console.error(err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) {
      errorEl.classList.remove('hidden');
      const msg = document.getElementById('evac-error-text');
      if (msg) {
        msg.textContent = err.isOffline
          ? 'Network offline. An active internet connection is required to fetch evacuation center availability.'
          : 'Unable to retrieve evacuation centers.';
      }
    }
  }
}

function filterEvacuationCenters(status) {
  let filtered = allCenters;
  if (status !== 'All') {
    filtered = allCenters.filter(c => c.status.toLowerCase().includes(status.toLowerCase()));
  }
  renderCenterCards(filtered);
}

function renderMapMarkers(centers) {
  if (!evacMap || typeof L === 'undefined') return;

  // Clear existing
  Object.values(evacMarkers).forEach(m => m.remove());
  evacMarkers = {};

  const bounds = [];

  centers.forEach(c => {
    if (!c.coordinates) return;

    const popupHtml = `
      <div class="p-1 font-sans text-xs">
        <h4 class="font-bold text-slate-900">${c.name}</h4>
        <p class="text-slate-600 mt-0.5">${c.address}</p>
        <div class="mt-1.5 flex items-center justify-between">
          <span class="font-bold ${c.status === 'Open - Accommodating' ? 'text-emerald-700' : 'text-amber-700'}">${c.status}</span>
          <span class="text-slate-500">${c.capacity.available} available</span>
        </div>
      </div>
    `;

    const marker = L.marker([c.coordinates.lat, c.coordinates.lng])
      .addTo(evacMap)
      .bindPopup(popupHtml);

    evacMarkers[c.id] = marker;
    bounds.push([c.coordinates.lat, c.coordinates.lng]);
  });

  if (bounds.length > 0) {
    evacMap.fitBounds(bounds, { padding: [30, 30] });
  }
}

function renderCenterCards(centers) {
  const container = document.getElementById('evac-cards-container');
  const emptyEl = document.getElementById('evac-empty');
  if (!container) return;

  if (!centers || centers.length === 0) {
    container.classList.add('hidden');
    if (emptyEl) {
      emptyEl.classList.remove('hidden');
      const textEl = document.getElementById('evac-empty-text');
      if (textEl) {
        textEl.textContent = (allCenters.length === 0)
          ? 'Designated emergency shelter records from the Barangay database will be displayed here.'
          : 'No evacuation centers match the selected filter.';
      }
    }
    return;
  }

  container.classList.remove('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');

  container.innerHTML = centers.map(c => {
    const pct = Math.round((c.capacity.current / c.capacity.total) * 100);
    let barColor = 'bg-emerald-500';
    if (pct >= 85) barColor = 'bg-rose-500';
    else if (pct >= 60) barColor = 'bg-amber-500';

    return `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-card p-5 transition-all hover:shadow-card-hover flex flex-col justify-between" id="center-card-${c.id}">
        <div>
          <div class="flex items-start justify-between gap-3 mb-2">
            <div>
              <h3 class="text-base font-bold text-slate-900">${c.name}</h3>
              <p class="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                ${GeoSafeUI.getIcon('map-pin', 'w-3.5 h-3.5 text-slate-400')}
                ${c.address}
              </p>
            </div>
            ${GeoSafeUI.renderCenterStatusBadge(c.status)}
          </div>

          <!-- Capacity Meter -->
          <div class="my-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200/60">
            <div class="flex items-center justify-between text-xs font-semibold mb-1.5">
              <span class="text-slate-700">Occupancy Level</span>
              <span class="text-slate-900">${c.capacity.current} / ${c.capacity.total} (${pct}%)</span>
            </div>
            <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
              <div class="${barColor} h-2 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500 mt-1.5">
              <span>Remaining Space: <strong class="text-emerald-700 font-bold">${c.capacity.available} individuals</strong></span>
            </div>
          </div>

          <!-- Facilities -->
          <div class="mb-4">
            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Available Amenities</span>
            <div class="flex flex-wrap gap-1.5">
              ${c.facilities.map(f => `
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-slate-100 text-slate-700 font-medium">
                  <svg class="w-3 h-3 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
                  <span>${f}</span>
                </span>
              `).join('')}
            </div>
          </div>

          <!-- Camp Manager -->
          <div class="p-2.5 bg-slate-50 rounded-xl border border-slate-200/60 text-xs">
            <span class="text-[10px] text-slate-400 font-medium block">Center Camp Manager</span>
            <span class="font-bold text-slate-800">${c.campManager.name}</span>
            <span class="text-slate-500 ml-1">(${c.campManager.contact})</span>
          </div>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
          <span class="text-[11px] text-slate-500 truncate max-w-[200px]" title="${c.evacuationRoute}">
            Route: ${c.evacuationRoute}
          </span>
          <button onclick="panToCenter('${c.id}')" class="px-3 py-1.5 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 font-semibold text-xs flex items-center gap-1 transition-colors">
            ${GeoSafeUI.getIcon('map-pin', 'w-3.5 h-3.5')}
            View on Map
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.panToCenter = function (id) {
  const center = allCenters.find(c => c.id === id);
  if (!center || !center.coordinates || !evacMap) return;

  evacMap.setView([center.coordinates.lat, center.coordinates.lng], 16, { animate: true });

  if (evacMarkers[id]) {
    evacMarkers[id].openPopup();
  }

  // Scroll map into view on mobile
  const mapEl = document.getElementById('evac-map');
  if (mapEl && window.innerWidth < 768) {
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

window.loadEvacuationCenters = loadEvacuationCenters;

