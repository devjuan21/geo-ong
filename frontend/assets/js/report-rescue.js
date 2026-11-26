/**
 * GeoSafe - Report / Rescue Page Logic (Section 5)
 * ============================================================================
 * Features:
 * - Two distinct emergency workflows:
 *   1. Report an Incident (Disaster observation & community alert)
 *   2. Request Rescue (Immediate life safety & Search & Rescue dispatch)
 * - Interactive Leaflet Map Pickers with draggable markers
 * - Browser Geolocation API integration with OSM reverse geocoding
 * - Photo attachments with live client previews
 * - Confirmation review modal before actual transmission
 * - Real submission to backend/store yielding verified reference numbers
 * ============================================================================
 */

let reportMap = null;
let reportMarker = null;
let reportCoords = { lat: null, lng: null };
let reportLocAutoFilled = false;
let reportPhotoBase64 = null;

let rescueMap = null;
let rescueMarker = null;
let rescueCoords = { lat: null, lng: null, accuracy: null, source: null, capturedAt: null };
let rescueGpsAutoAttempted = false;
let rescueLocAutoFilled = false;
let rescuePhotoBase64 = null;

let incidentCatsFetchInFlight = null;
let rescueCatsFetchInFlight = null;

async function loadDynamicIncidentCategories() {
  const apiBase = window.geoSafeStore?.config?.API_BASE_URL || '/api';
  const repSelect = document.getElementById('rep-type');
  const repErrEl = document.getElementById('rep-category-error');
  if (!repSelect) return;
  if (incidentCatsFetchInFlight) return incidentCatsFetchInFlight;

  incidentCatsFetchInFlight = (async () => {
    if (repErrEl) repErrEl.classList.add('hidden');
    if (!repSelect.options.length || repSelect.options[0]?.textContent === 'Unable to load incident categories') {
      repSelect.innerHTML = '<option value="" disabled selected>Loading incident categories...</option>';
    }
    try {
      const resp = await fetch(`${apiBase}/incident-categories?_=${Date.now()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && Array.isArray(data.categories)) {
        const currentVal = repSelect.value;
        if (data.categories.length === 0) {
          repSelect.innerHTML = '<option value="" disabled selected>No active incident categories available</option>';
          repSelect.value = '';
        } else {
          repSelect.innerHTML = '<option value="" disabled selected>Select category...</option>';
          data.categories.forEach((cat) => {
            const opt = document.createElement('option');
            opt.value = cat.name;
            opt.textContent = cat.name;
            opt.dataset.categoryId = String(cat.id || '');
            repSelect.appendChild(opt);
          });
          if (currentVal && data.categories.some((c) => c.name === currentVal)) {
            repSelect.value = currentVal;
          } else {
            repSelect.value = '';
          }
        }
        if (typeof updateReportSubmitState === 'function') updateReportSubmitState();
      } else {
        repSelect.innerHTML = '<option value="" disabled selected>Unable to load incident categories</option>';
        if (repErrEl) repErrEl.classList.remove('hidden');
      }
    } catch (err) {
      console.warn('[Report/Rescue] Could not load dynamic incident categories:', err.message);
      repSelect.innerHTML = '<option value="" disabled selected>Unable to load incident categories</option>';
      if (repErrEl) repErrEl.classList.remove('hidden');
    } finally {
      incidentCatsFetchInFlight = null;
    }
  })();

  return incidentCatsFetchInFlight;
}

async function loadDynamicRescueCategories() {
  const apiBase = window.geoSafeStore?.config?.API_BASE_URL || '/api';
  const resSelect = document.getElementById('res-type');
  const resErrEl = document.getElementById('res-category-error');
  if (!resSelect) return;
  if (rescueCatsFetchInFlight) return rescueCatsFetchInFlight;

  rescueCatsFetchInFlight = (async () => {
    if (resErrEl) resErrEl.classList.add('hidden');
    if (!resSelect.options.length || resSelect.options[0]?.textContent === 'Unable to load rescue categories') {
      resSelect.innerHTML = '<option value="" disabled selected>Loading rescue categories...</option>';
    }
    try {
      const resp = await fetch(`${apiBase}/rescue-categories?_=${Date.now()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && Array.isArray(data.categories)) {
        const currentVal = resSelect.value;
        if (data.categories.length === 0) {
          resSelect.innerHTML = '<option value="" disabled selected>No active rescue categories available</option>';
          resSelect.value = '';
          if (typeof window.handleRescueConditionChange === 'function') window.handleRescueConditionChange();
        } else {
          resSelect.innerHTML = '<option value="" disabled selected>Select condition...</option>';
          data.categories.forEach((cat) => {
            const opt = document.createElement('option');
            opt.value = cat.name;
            opt.textContent = cat.display_label || cat.name;
            opt.dataset.categoryId = String(cat.id || '');
            resSelect.appendChild(opt);
          });
          if (currentVal && data.categories.some((c) => c.name === currentVal)) {
            resSelect.value = currentVal;
          } else {
            resSelect.value = '';
            if (currentVal && typeof window.handleRescueConditionChange === 'function') {
              window.handleRescueConditionChange();
            }
          }
        }
      } else {
        resSelect.innerHTML = '<option value="" disabled selected>Unable to load rescue categories</option>';
        if (resErrEl) resErrEl.classList.remove('hidden');
      }
    } catch (err) {
      console.warn('[Report/Rescue] Could not load dynamic rescue categories:', err.message);
      resSelect.innerHTML = '<option value="" disabled selected>Unable to load rescue categories</option>';
      if (resErrEl) resErrEl.classList.remove('hidden');
    } finally {
      rescueCatsFetchInFlight = null;
    }
  })();

  return rescueCatsFetchInFlight;
}

async function loadDynamicReportAndRescueCategories() {
  await Promise.all([loadDynamicIncidentCategories(), loadDynamicRescueCategories()]);
}
window.loadDynamicIncidentCategories = loadDynamicIncidentCategories;
window.loadDynamicRescueCategories = loadDynamicRescueCategories;
window.loadDynamicReportAndRescueCategories = loadDynamicReportAndRescueCategories;

document.addEventListener('DOMContentLoaded', () => {
  // Initialize common shell navigation
  GeoSafeUI.init('report-rescue', 'Report / Rescue');

  // Set current date/time in report field
  initDateTimeDisplay();

  // Initialize both Leaflet map pickers
  initReportMapPicker();
  initRescueMapPicker();
  loadDynamicReportAndRescueCategories();

  // Check URL query parameters for direct tab activation (e.g. ?action=rescue)
  const urlParams = new URLSearchParams(window.location.search);
  const actionParam = urlParams.get('action') || urlParams.get('tab');
  if (actionParam === 'rescue') {
    switchActionTab('rescue');
  } else {
    switchActionTab('report');
  }

  // Load authenticated resident's genuine submitted reports & rescue requests
  loadSubmittedReports();
  window.addEventListener('geosafe:realtime-update', (ev) => {
    const evName = ev && ev.detail && ev.detail.event;
    if (evName === 'incident_categories_updated') {
      loadDynamicIncidentCategories();
      return;
    }
    if (evName === 'rescue_categories_updated') {
      loadDynamicRescueCategories();
      return;
    }
    if (evName === 'maintenance:categories-updated' || evName === 'reconnect-sync') {
      loadDynamicReportAndRescueCategories();
    }
    loadSubmittedReports();
  });
  window.addEventListener('focus', loadDynamicReportAndRescueCategories);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadDynamicReportAndRescueCategories();
    }
  });
  startReportRescueLiveGps();

  // Live validation for mandatory Incident Report fields & camera photo evidence
  ['rep-type', 'rep-title', 'rep-desc', 'rep-loc'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateReportSubmitState);
      el.addEventListener('change', updateReportSubmitState);
    }
  });
  updateReportSubmitState();
});

let reportRescueLiveGpsTracker = null;
const reportLiveGpsState = { marker: null, accuracyCircle: null };
const rescueLiveGpsState = { marker: null, accuracyCircle: null };

function startReportRescueLiveGps() {
  if (reportRescueLiveGpsTracker || !window.GeoSafeMapping || typeof window.GeoSafeMapping.createLiveGpsTracker !== 'function') {
    return;
  }
  reportRescueLiveGpsTracker = window.GeoSafeMapping.createLiveGpsTracker({
    syncIntervalMs: 10000,
    onLocation: (reading) => {
      if (reportMap) {
        window.GeoSafeMapping.renderLiveGpsMarker(reportMap, reportLiveGpsState, reading, {
          title: 'Your Current GPS Location',
          zIndexOffset: 500
        });
      }
      if (rescueMap) {
        window.GeoSafeMapping.renderLiveGpsMarker(rescueMap, rescueLiveGpsState, reading, {
          title: 'Your Current GPS Location',
          zIndexOffset: 500
        });
      }
    }
  });
  reportRescueLiveGpsTracker.start();
}

/**
 * Initialize Date & Time display
 */
function initDateTimeDisplay() {
  const dtEl = document.getElementById('rep-datetime');
  if (dtEl) {
    const now = new Date();
    dtEl.value = now.toLocaleDateString('en-PH', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

/**
 * Switch between "Report an Incident" and "Request Rescue"
 * @param {string} tab - 'report' | 'rescue'
 */
window.switchActionTab = function (tab) {
  const btnReport = document.getElementById('tab-btn-report');
  const btnRescue = document.getElementById('tab-btn-rescue');
  const sectionReport = document.getElementById('section-report');
  const sectionRescue = document.getElementById('section-rescue');

  if (tab === 'rescue') {
    loadDynamicRescueCategories();
    if (btnReport) btnReport.className = 'w-full p-3.5 sm:p-4 rounded-lg bg-white/70 border border-slate-200 text-left transition-all hover:border-[#F5B900] flex items-center justify-between gap-3 focus:outline-none';
    if (btnRescue) btnRescue.className = 'w-full p-3.5 sm:p-4 rounded-lg bg-white border-2 border-[#D93636] shadow-subtle ring-2 ring-[#FFC2C2] text-left transition-all flex items-center justify-between gap-3 focus:outline-none';

    if (sectionReport) sectionReport.classList.add('hidden');
    if (sectionRescue) sectionRescue.classList.remove('hidden');

    setTimeout(() => {
      if (rescueMap) rescueMap.invalidateSize();
      if (rescueCoords.lat === null && !rescueGpsAutoAttempted) {
        rescueGpsAutoAttempted = true;
        window.acquireGpsForRescue(true);
      }
    }, 150);
  } else {
    loadDynamicIncidentCategories();
    if (btnReport) btnReport.className = 'w-full p-3.5 sm:p-4 rounded-lg bg-white border-2 border-[#F5B900] shadow-subtle text-left transition-all flex items-center justify-between gap-3 focus:outline-none';
    if (btnRescue) btnRescue.className = 'w-full p-3.5 sm:p-4 rounded-lg bg-white/70 border border-slate-200 text-left transition-all hover:border-[#D93636] flex items-center justify-between gap-3 focus:outline-none';

    if (sectionReport) sectionReport.classList.remove('hidden');
    if (sectionRescue) sectionRescue.classList.add('hidden');

    setTimeout(() => {
      if (reportMap) reportMap.invalidateSize();
    }, 150);
  }
};

/**
 * Initialize Incident Report Map Picker
 */
function initReportMapPicker() {
  const container = document.getElementById('report-map-picker');
  if (!container) return;

  try {
    reportMap = GeoSafeMapping.createMap('report-map-picker', {
      scrollWheelZoom: false
    });

    reportMap.on('click', async (e) => {
      await updateReportPosition(e.latlng.lat, e.latlng.lng);
    });
  } catch (err) {
    console.error('Failed to initialize report map picker:', err);
  }
}

/**
 * Initialize Rescue Request Map Picker
 */
function initRescueMapPicker() {
  const container = document.getElementById('rescue-map-picker');
  if (!container) return;

  try {
    rescueMap = GeoSafeMapping.createMap('rescue-map-picker', {
      scrollWheelZoom: false
    });

    rescueMap.on('click', async (e) => {
      await updateRescuePosition(e.latlng.lat, e.latlng.lng, { source: 'manual' });
    });
  } catch (err) {
    console.error('Failed to initialize rescue map picker:', err);
  }
}

/**
 * Update Report coordinates and reverse geocode
 */
function setReportMarkerPosition(lat, lng) {
  if (!reportMap) return;
  if (!reportMarker) {
    const icon = GeoSafeMapping.createCustomIcon('incident');
    reportMarker = L.marker([lat, lng], {
      icon,
      draggable: true
    }).addTo(reportMap);

    reportMarker.on('dragend', async (e) => {
      const pos = e.target.getLatLng();
      await updateReportPosition(pos.lat, pos.lng);
    });
  } else {
    reportMarker.setLatLng([lat, lng]);
  }
}

function resetReportCoordinates() {
  reportCoords = { lat: null, lng: null };
  reportLocAutoFilled = false;
  if (reportMarker && reportMap) {
    reportMap.removeLayer(reportMarker);
    reportMarker = null;
  }
  const latDisp = document.getElementById('rep-lat-display');
  const lngDisp = document.getElementById('rep-lng-display');
  if (latDisp) latDisp.textContent = 'Not captured';
  if (lngDisp) lngDisp.textContent = 'Not captured';
  updateReportSubmitState();
}

async function updateReportPosition(lat, lng) {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (
    !Number.isFinite(numLat) ||
    !Number.isFinite(numLng) ||
    numLat < -90 ||
    numLat > 90 ||
    numLng < -180 ||
    numLng > 180 ||
    (numLat === 0 && numLng === 0)
  ) {
    return;
  }

  reportCoords.lat = numLat;
  reportCoords.lng = numLng;
  setReportMarkerPosition(numLat, numLng);

  const latDisp = document.getElementById('rep-lat-display');
  const lngDisp = document.getElementById('rep-lng-display');
  const locInput = document.getElementById('rep-loc');

  if (latDisp) latDisp.textContent = numLat.toFixed(6);
  if (lngDisp) lngDisp.textContent = numLng.toFixed(6);

  const address = await GeoSafeMapping.reverseGeocode(numLat, numLng);
  if (locInput && address && (!locInput.value.trim() || reportLocAutoFilled)) {
    locInput.value = address;
    reportLocAutoFilled = true;
  }
  updateReportSubmitState();
}

/**
 * Update Rescue coordinates and reverse geocode
 */
function setRescueMarkerPosition(lat, lng) {
  if (!rescueMap) return;
  if (!rescueMarker) {
    const icon = GeoSafeMapping.createCustomIcon('rescue');
    rescueMarker = L.marker([lat, lng], {
      icon,
      draggable: true
    }).addTo(rescueMap);

    rescueMarker.on('dragend', async (e) => {
      const pos = e.target.getLatLng();
      await updateRescuePosition(pos.lat, pos.lng, { source: 'manual' });
    });
  } else {
    rescueMarker.setLatLng([lat, lng]);
  }
}

function resetRescueCoordinates() {
  rescueCoords = { lat: null, lng: null, accuracy: null, source: null, capturedAt: null };
  rescueGpsAutoAttempted = false;
  rescueLocAutoFilled = false;
  if (rescueMarker && rescueMap) {
    rescueMap.removeLayer(rescueMarker);
    rescueMarker = null;
  }
  const latDisp = document.getElementById('res-lat-display');
  const lngDisp = document.getElementById('res-lng-display');
  const metaDisp = document.getElementById('res-location-meta');
  if (latDisp) latDisp.textContent = 'Not captured';
  if (lngDisp) lngDisp.textContent = 'Not captured';
  if (metaDisp) metaDisp.textContent = '';
}

async function updateRescuePosition(lat, lng, options = {}) {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (
    !Number.isFinite(numLat) ||
    !Number.isFinite(numLng) ||
    numLat < -90 ||
    numLat > 90 ||
    numLng < -180 ||
    numLng > 180 ||
    (numLat === 0 && numLng === 0)
  ) {
    return;
  }

  const accuracy = Number.isFinite(Number(options.accuracy)) ? Math.round(Number(options.accuracy)) : null;
  const source = options.source === 'gps' ? 'gps' : 'manual';
  const capturedAt = options.capturedAt || new Date().toISOString();

  rescueCoords = {
    lat: numLat,
    lng: numLng,
    accuracy,
    source,
    capturedAt
  };

  setRescueMarkerPosition(numLat, numLng);

  const latDisp = document.getElementById('res-lat-display');
  const lngDisp = document.getElementById('res-lng-display');
  const metaDisp = document.getElementById('res-location-meta');
  const locInput = document.getElementById('res-loc');

  if (latDisp) latDisp.textContent = numLat.toFixed(6);
  if (lngDisp) lngDisp.textContent = numLng.toFixed(6);
  if (metaDisp) {
    metaDisp.textContent = source === 'gps'
      ? (accuracy !== null ? `• GPS (±${accuracy} m)` : '• GPS')
      : '• Manual map pin';
  }

  // Reverse geocode only to suggest a readable address; never alter captured coordinates
  const address = await GeoSafeMapping.reverseGeocode(numLat, numLng);
  if (locInput && address && (!locInput.value.trim() || rescueLocAutoFilled)) {
    locInput.value = address;
    rescueLocAutoFilled = true;
  }
}

/**
 * Acquire GPS for Report
 */
window.acquireGpsForReport = async function () {
  try {
    const pos = await GeoSafeMapping.getCurrentLocation();
    if (reportMap) reportMap.setView([pos.lat, pos.lng], 17);
    await updateReportPosition(pos.lat, pos.lng);
    GeoSafeUI.showToast('Incident coordinates set from current GPS.', 'success');
  } catch (err) {
    GeoSafeUI.showToast(err.message || 'Unable to access GPS location.', 'warning');
  }
};

/**
 * Acquire GPS for Rescue
 */
window.acquireGpsForRescue = async function (silent = false) {
  const metaDisp = document.getElementById('res-location-meta');
  if (metaDisp && rescueCoords.lat === null) {
    metaDisp.textContent = '• Acquiring GPS...';
  }
  try {
    const pos = await GeoSafeMapping.getCurrentLocation();
    if (rescueMap) {
      rescueMap.setView([pos.lat, pos.lng], 17);
    }
    await updateRescuePosition(pos.lat, pos.lng, {
      accuracy: pos.accuracy,
      source: 'gps',
      capturedAt: new Date().toISOString()
    });
    if (!silent) {
      GeoSafeUI.showToast('Emergency rescue location set from current GPS.', 'success');
    }
  } catch (err) {
    if (metaDisp && rescueCoords.lat === null) {
      metaDisp.textContent = '• GPS unavailable — tap map to set pin';
    }
    if (!silent) {
      GeoSafeUI.showToast(err.message || 'Unable to access GPS location.', 'warning');
    }
  }
};

let activeCameraStream = null;
let activeCameraPrefix = 'rep';

function stopCameraStream() {
  if (activeCameraStream) {
    activeCameraStream.getTracks().forEach((track) => track.stop());
    activeCameraStream = null;
  }
  const videoEl = document.getElementById('camera-video-preview');
  if (videoEl) {
    videoEl.srcObject = null;
    videoEl.classList.add('hidden');
  }
}

window.addEventListener('pagehide', stopCameraStream);
window.addEventListener('beforeunload', stopCameraStream);

window.openCameraCapture = async function (prefix) {
  activeCameraPrefix = prefix === 'res' ? 'res' : 'rep';

  const modal = document.getElementById('camera-capture-modal');
  const loadingEl = document.getElementById('camera-loading-state');
  const errorEl = document.getElementById('camera-error-state');
  const errorText = document.getElementById('camera-error-text');
  const videoEl = document.getElementById('camera-video-preview');
  const captureBtn = document.getElementById('btn-capture-photo');

  stopCameraStream();
  if (modal) modal.classList.remove('hidden');
  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  if (videoEl) videoEl.classList.add('hidden');
  if (captureBtn) captureBtn.disabled = true;

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) errorEl.classList.remove('hidden');
    if (errorText) errorText.textContent = 'Camera access requires a secure HTTPS (or localhost) connection.';
    return;
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) errorEl.classList.remove('hidden');
    if (errorText) errorText.textContent = 'Camera is not supported by this browser or device.';
    return;
  }

  try {
    try {
      activeCameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
    } catch (constraintErr) {
      if (constraintErr && (constraintErr.name === 'OverconstrainedError' || constraintErr.name === 'NotFoundError')) {
        activeCameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else {
        throw constraintErr;
      }
    }

    if (videoEl) {
      videoEl.srcObject = activeCameraStream;
      await videoEl.play();
      videoEl.classList.remove('hidden');
    }
    if (loadingEl) loadingEl.classList.add('hidden');
    if (captureBtn) captureBtn.disabled = false;
  } catch (err) {
    console.warn('Camera permission/open error:', err);
    stopCameraStream();
    if (loadingEl) loadingEl.classList.add('hidden');
    if (errorEl) errorEl.classList.remove('hidden');

    let msg = 'Unable to access the device camera. Please try again.';
    if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
      msg = 'Camera permission was denied. Please allow camera access in your browser settings to take a photo.';
    } else if (err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
      msg = 'No camera was detected on this device.';
    } else if (err && err.name === 'NotReadableError') {
      msg = 'Camera is currently in use by another application.';
    }
    if (errorText) errorText.textContent = msg;
  }
};

window.retryCameraCapture = function () {
  window.openCameraCapture(activeCameraPrefix);
};

window.closeCameraCapture = function () {
  stopCameraStream();
  document.getElementById('camera-capture-modal')?.classList.add('hidden');
};

window.captureCameraPhoto = function () {
  const videoEl = document.getElementById('camera-video-preview');
  const canvasEl = document.getElementById('camera-capture-canvas');
  if (!videoEl || !canvasEl || !videoEl.videoWidth || !videoEl.videoHeight) {
    GeoSafeUI.showToast('Camera preview is not ready yet.', 'warning');
    return;
  }

  const maxDim = 1280;
  let w = videoEl.videoWidth;
  let h = videoEl.videoHeight;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  canvasEl.width = w;
  canvasEl.height = h;
  const ctx = canvasEl.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, w, h);

  const dataUrl = canvasEl.toDataURL('image/jpeg', 0.85);
  if (activeCameraPrefix === 'rep') {
    reportPhotoBase64 = dataUrl;
  } else {
    rescuePhotoBase64 = dataUrl;
  }

  const previewImg = document.getElementById(`${activeCameraPrefix}-photo-preview`);
  const previewContainer = document.getElementById(`${activeCameraPrefix}-photo-preview-container`);
  if (previewImg && previewContainer) {
    previewImg.src = dataUrl;
    previewContainer.classList.remove('hidden');
  }

  window.closeCameraCapture();
  updateReportSubmitState();
  GeoSafeUI.showToast('Photo captured.', 'success');
};

window.removeCapturedPhoto = function (prefix) {
  if (prefix === 'rep') {
    reportPhotoBase64 = null;
  } else {
    rescuePhotoBase64 = null;
  }
  const previewImg = document.getElementById(`${prefix}-photo-preview`);
  const previewContainer = document.getElementById(`${prefix}-photo-preview-container`);
  if (previewImg) previewImg.src = '';
  if (previewContainer) previewContainer.classList.add('hidden');
  if (prefix === 'rep') {
    updateReportSubmitState();
  }
};

function isValidReportPhoto(dataUrl) {
  return typeof dataUrl === 'string' && /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl);
}

function hasValidReportCoordinates() {
  return (
    Number.isFinite(reportCoords.lat) &&
    Number.isFinite(reportCoords.lng) &&
    reportCoords.lat >= -90 &&
    reportCoords.lat <= 90 &&
    reportCoords.lng >= -180 &&
    reportCoords.lng <= 180 &&
    !(reportCoords.lat === 0 && reportCoords.lng === 0)
  );
}

function updateReportSubmitState() {
  const type = document.getElementById('rep-type')?.value;
  const title = document.getElementById('rep-title')?.value.trim();
  const desc = document.getElementById('rep-desc')?.value.trim();
  const loc = document.getElementById('rep-loc')?.value.trim();
  const hasPhoto = isValidReportPhoto(reportPhotoBase64);
  const hasCoords = hasValidReportCoordinates();

  const photoBadge = document.getElementById('rep-photo-status-badge');
  const photoHint = document.getElementById('rep-photo-required-hint');
  if (photoBadge) photoBadge.classList.toggle('hidden', !hasPhoto);
  if (photoHint) photoHint.classList.toggle('hidden', hasPhoto);

  const openBtn = document.getElementById('btn-open-report-confirm');
  if (openBtn) {
    openBtn.disabled = !(type && title && desc && loc && hasCoords && hasPhoto);
  }
}

/* ========================================================================= */
/* ACTION 1: REPORT SUBMISSION                                               */
/* ========================================================================= */

window.openReportConfirmModal = function () {
  const type = document.getElementById('rep-type')?.value;
  const title = document.getElementById('rep-title')?.value.trim();
  const desc = document.getElementById('rep-desc')?.value.trim();
  const loc = document.getElementById('rep-loc')?.value.trim();

  if (!type || !title || !desc || !loc) {
    GeoSafeUI.showToast('Please complete all required fields for the incident report.', 'error');
    return;
  }

  if (!hasValidReportCoordinates()) {
    GeoSafeUI.showToast('Please capture your GPS location or tap the incident location on the map.', 'error');
    return;
  }

  if (!isValidReportPhoto(reportPhotoBase64)) {
    updateReportSubmitState();
    GeoSafeUI.showToast('Take a photo of the incident as evidence. A photo is required to submit your report.', 'error');
    return;
  }

  document.getElementById('cfm-rep-type').textContent = type;
  document.getElementById('cfm-rep-title').textContent = title;
  document.getElementById('cfm-rep-loc').textContent = loc;

  document.getElementById('confirm-report-modal')?.classList.remove('hidden');
};

window.closeReportConfirmModal = function () {
  document.getElementById('confirm-report-modal')?.classList.add('hidden');
};

let isSubmittingReport = false;
let isSubmittingRescue = false;

window.submitReportFinal = async function () {
  if (isSubmittingReport) return;

  if (!isValidReportPhoto(reportPhotoBase64)) {
    closeReportConfirmModal();
    updateReportSubmitState();
    GeoSafeUI.showToast('Take a photo of the incident as evidence. A photo is required to submit your report.', 'error');
    return;
  }

  const submitBtn = document.getElementById('btn-submit-report-final');
  isSubmittingReport = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Transmitting...';
  }

  const payload = {
    incident_type: document.getElementById('rep-type').value,
    incidentType: document.getElementById('rep-type').value,
    title: document.getElementById('rep-title').value.trim(),
    description: document.getElementById('rep-desc').value.trim(),
    address: document.getElementById('rep-loc').value.trim(),
    location: document.getElementById('rep-loc').value.trim(),
    latitude: reportCoords.lat,
    longitude: reportCoords.lng,
    coordinates: { lat: reportCoords.lat, lng: reportCoords.lng },
    authorizedForCommunity: false,
    photos: reportPhotoBase64 ? [reportPhotoBase64] : []
  };

  try {
    const saved = await window.geoSafeStore.submitReport(payload);
    closeReportConfirmModal();

    // Show Success Modal (Section 5.C)
    showSubmissionSuccess(
      'Incident Report Transmitted',
      'Your incident report has been saved with status Pending Verification and is awaiting Administrator verification before appearing on public maps.',
      saved.id || saved.referenceNumber
    );

    // Reset Form
    document.getElementById('form-report-incident')?.reset();
    document.getElementById('rep-photo-preview-container')?.classList.add('hidden');
    reportPhotoBase64 = null;
    resetReportCoordinates();
    initDateTimeDisplay();
    updateReportSubmitState();
    loadSubmittedReports();
  } catch (err) {
    console.error('Report submission error:', err);
    GeoSafeUI.showToast(err.message || 'Failed to submit report. Please check connection and try again.', 'error');
  } finally {
    isSubmittingReport = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm & Send';
    }
  }
};

/* ========================================================================= */
/* ACTION 2: RESCUE SUBMISSION (CATEGORY-DEPENDENT FIELDS)                   */
/* ========================================================================= */

const RESCUE_CONDITION_CONFIG = {
  'Trapped by Rising Floodwater': {
    mode: 'entrapment',
    countField: 'peopleTrapped',
    countLabel: 'Number of People Trapped',
    confirmLabel: 'People Trapped:',
    unitLabel: 'person(s) trapped',
    locationLabel: 'Trapped Location',
    showVulnerable: false
  },
  'Collapsed / Compromised Structure': {
    mode: 'entrapment',
    countField: 'peopleTrapped',
    countLabel: 'Number of People Trapped',
    confirmLabel: 'People Trapped:',
    unitLabel: 'person(s) trapped',
    locationLabel: 'Trapped Location',
    showVulnerable: false
  },
  'Trapped by Fire / Dense Smoke': {
    mode: 'entrapment',
    countField: 'peopleTrapped',
    countLabel: 'Number of People Trapped',
    confirmLabel: 'People Trapped:',
    unitLabel: 'person(s) trapped',
    locationLabel: 'Trapped Location',
    showVulnerable: false
  },
  'Critical Medical Evacuation': {
    mode: 'medical',
    countField: 'patientCount',
    countLabel: 'Number of Patients Needing Evacuation',
    confirmLabel: 'Patients Needing Evacuation:',
    unitLabel: 'patient(s)',
    locationLabel: 'Patient Location',
    showVulnerable: true,
    vulnerableLabel: 'Medical Condition / Needs (Optional)',
    vulnerablePlaceholder: 'e.g., Oxygen dependent, stretcher needed, chest pain'
  },
  'Special Vulnerability Emergency': {
    mode: 'vulnerability',
    countField: 'assistanceCount',
    countLabel: 'Number of Individuals Needing Assistance',
    confirmLabel: 'Individuals Needing Assistance:',
    unitLabel: 'individual(s)',
    locationLabel: 'Location',
    showVulnerable: true,
    vulnerableLabel: 'Vulnerability Details (Optional)',
    vulnerablePlaceholder: 'e.g., Bedridden senior, infant, wheelchair user'
  }
};

function getRescueConditionConfig(type) {
  if (!type) return null;
  if (RESCUE_CONDITION_CONFIG[type]) return RESCUE_CONDITION_CONFIG[type];
  const low = String(type).toLowerCase();
  if (low.includes('medical')) {
    return RESCUE_CONDITION_CONFIG['Critical Medical Evacuation'];
  }
  if (low.includes('vulnerability') || low.includes('bedridden') || low.includes('senior') || low.includes('infant')) {
    return RESCUE_CONDITION_CONFIG['Special Vulnerability Emergency'];
  }
  return {
    mode: 'entrapment',
    countField: 'peopleTrapped',
    countLabel: 'Number of People Needing Rescue',
    confirmLabel: 'People Needing Rescue:',
    unitLabel: 'person(s)',
    locationLabel: 'Rescue Location',
    showVulnerable: false,
  };
}

window.handleRescueConditionChange = function () {
  const type = document.getElementById('res-type')?.value || '';
  const cfg = getRescueConditionConfig(type);

  const countWrapper = document.getElementById('res-count-wrapper');
  const countLabel = document.getElementById('res-count-label');
  const countInput = document.getElementById('res-count');
  const vulnWrapper = document.getElementById('res-vulnerable-wrapper');
  const vulnLabel = document.getElementById('res-vulnerable-label');
  const vulnInput = document.getElementById('res-vulnerable');
  const locLabel = document.getElementById('res-loc-label');

  // Clear obsolete category-specific values when switching conditions
  if (countInput) countInput.value = '';
  if (vulnInput) vulnInput.value = '';

  if (!cfg) {
    if (countWrapper) countWrapper.classList.add('hidden');
    if (countInput) countInput.required = false;
    if (vulnWrapper) vulnWrapper.classList.add('hidden');
    if (locLabel) locLabel.textContent = 'Location';
    return;
  }

  if (countWrapper) countWrapper.classList.remove('hidden');
  if (countLabel) countLabel.textContent = cfg.countLabel;
  if (countInput) {
    countInput.required = true;
  }
  if (locLabel) locLabel.textContent = cfg.locationLabel;

  if (vulnWrapper && vulnInput) {
    if (cfg.showVulnerable) {
      vulnWrapper.classList.remove('hidden');
      if (vulnLabel) vulnLabel.textContent = cfg.vulnerableLabel;
      vulnInput.placeholder = cfg.vulnerablePlaceholder;
    } else {
      vulnWrapper.classList.add('hidden');
    }
  }
};

function parseRescueCountSelection(rawValue) {
  const trimmed = String(rawValue ?? '').trim().toLowerCase();
  if (trimmed === 'unknown') {
    return { category: 'unknown', count: null, display: "Don't know" };
  }
  if (trimmed === 'more_than_10') {
    return { category: 'more_than_10', count: null, display: 'More than 10' };
  }
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 1 || num > 50) return null;
  return { category: 'exact', count: num, display: `${num}` };
}

window.openRescueConfirmModal = function () {
  const type = document.getElementById('res-type')?.value;
  const cfg = getRescueConditionConfig(type);
  const rawCount = document.getElementById('res-count')?.value;
  const desc = document.getElementById('res-desc')?.value.trim();
  const loc = document.getElementById('res-loc')?.value.trim();

  if (!type || !cfg || !desc || !loc) {
    GeoSafeUI.showToast('Please complete all required fields for emergency rescue.', 'error');
    return;
  }

  const parsedSel = parseRescueCountSelection(rawCount);
  if (parsedSel === null) {
    GeoSafeUI.showToast(`Please select a valid option for ${cfg.countLabel}.`, 'error');
    return;
  }

  const hasValidCoords =
    Number.isFinite(rescueCoords.lat) &&
    Number.isFinite(rescueCoords.lng) &&
    rescueCoords.lat >= -90 &&
    rescueCoords.lat <= 90 &&
    rescueCoords.lng >= -180 &&
    rescueCoords.lng <= 180 &&
    !(rescueCoords.lat === 0 && rescueCoords.lng === 0);

  if (!hasValidCoords) {
    GeoSafeUI.showToast('Please capture your GPS location or tap your exact location on the map before submitting.', 'error');
    return;
  }

  document.getElementById('cfm-res-type').textContent = type;
  const cfmCountLabel = document.getElementById('cfm-res-count-label');
  if (cfmCountLabel) cfmCountLabel.textContent = cfg.confirmLabel;
  document.getElementById('cfm-res-count').textContent =
    parsedSel.category === 'unknown'
      ? "Don't know"
      : parsedSel.category === 'more_than_10'
        ? 'More than 10'
        : `${parsedSel.count} ${cfg.unitLabel}`;
  document.getElementById('cfm-res-loc').textContent = loc;

  document.getElementById('confirm-rescue-modal')?.classList.remove('hidden');
};

window.closeRescueConfirmModal = function () {
  document.getElementById('confirm-rescue-modal')?.classList.add('hidden');
};

window.submitRescueFinal = async function () {
  if (isSubmittingRescue) return;
  const type = document.getElementById('res-type')?.value;
  const cfg = getRescueConditionConfig(type);
  const parsedSel = parseRescueCountSelection(document.getElementById('res-count')?.value);

  if (!cfg || parsedSel === null) {
    GeoSafeUI.showToast('Please enter valid emergency details before submitting.', 'error');
    return;
  }

  const hasValidCoords =
    Number.isFinite(rescueCoords.lat) &&
    Number.isFinite(rescueCoords.lng) &&
    rescueCoords.lat >= -90 &&
    rescueCoords.lat <= 90 &&
    rescueCoords.lng >= -180 &&
    rescueCoords.lng <= 180 &&
    !(rescueCoords.lat === 0 && rescueCoords.lng === 0);

  if (!hasValidCoords) {
    GeoSafeUI.showToast('Valid GPS or map coordinates are required before dispatching rescue.', 'error');
    return;
  }

  const submitBtn = document.getElementById('btn-submit-rescue-final');
  isSubmittingRescue = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Dispatching Emergency Call...';
  }

  const payload = {
    emergencyType: type,
    description: document.getElementById('res-desc').value.trim(),
    location: document.getElementById('res-loc').value.trim(),
    latitude: rescueCoords.lat,
    longitude: rescueCoords.lng,
    coordinates: { lat: rescueCoords.lat, lng: rescueCoords.lng },
    gpsAccuracy: rescueCoords.accuracy,
    locationSource: rescueCoords.source || 'manual',
    locationCapturedAt: rescueCoords.capturedAt || new Date().toISOString(),
    additionalInstructions: document.getElementById('res-notes')?.value.trim() || '',
    photos: rescuePhotoBase64 ? [rescuePhotoBase64] : []
  };

  payload[cfg.countField] = parsedSel.category === 'exact' ? parsedSel.count : parsedSel.category;
  payload.peopleCountCategory = parsedSel.category;
  if (cfg.showVulnerable) {
    const vulnText = document.getElementById('res-vulnerable')?.value.trim();
    if (vulnText) {
      payload.vulnerableDetails = vulnText;
    }
  }

  try {
    const saved = await window.geoSafeStore.submitRescueRequest(payload);
    closeRescueConfirmModal();

    // Show Success Modal (Section 5.C)
    showSubmissionSuccess(
      'Emergency Rescue Request Dispatched',
      'Your urgent rescue call has been received by Barangay Bayanan BDRRMC WASAR commanders. Stay where you are and keep your mobile phone line open.',
      saved.id
    );

    // Reset Form
    document.getElementById('form-request-rescue')?.reset();
    window.handleRescueConditionChange();
    document.getElementById('res-photo-preview-container')?.classList.add('hidden');
    rescuePhotoBase64 = null;
    resetRescueCoordinates();
    loadSubmittedReports();
  } catch (err) {
    console.error('Rescue submission error:', err);
    GeoSafeUI.showToast(err.message || 'Failed to dispatch rescue request. Please call hotline directly: (02) 8861-0185.', 'error');
  } finally {
    isSubmittingRescue = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm Emergency Dispatch';
    }
  }
};

/**
 * Display Success Result Modal (Section 5.C)
 */
function showSubmissionSuccess(title, desc, refNum) {
  const modal = document.getElementById('submission-success-modal');
  const titleEl = document.getElementById('success-modal-title');
  const descEl = document.getElementById('success-modal-desc');
  const refEl = document.getElementById('success-reference-num');

  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;
  if (refEl) refEl.textContent = refNum;

  if (modal) modal.classList.remove('hidden');
}

window.closeSuccessModal = function () {
  const modal = document.getElementById('submission-success-modal');
  if (modal) modal.classList.add('hidden');
  window.location.href = 'index.html';
};

// ============================================================================
// SUBMITTED REPORTS PANEL (Resident's Genuine PostgreSQL Records)
// ============================================================================
let submittedRecordsCache = [];

function escapeHtmlSafe(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSubmissionDate(iso) {
  if (!iso) return 'Date unavailable';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date unavailable';
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getSubmissionStatusStyle(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('resolved') || s.includes('completed')) {
    return 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]';
  }
  if (s.includes('verified') || s.includes('assigned') || s.includes('responding') || s.includes('dispatch') || s.includes('on scene') || s.includes('in progress')) {
    return 'bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]';
  }
  if (s.includes('rejected') || s.includes('cancelled') || s.includes('dismissed')) {
    return 'bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2]';
  }
  return 'bg-slate-50 text-[#8A6800] border border-[#FFE872]';
}

let activeSubmissionDetailKey = null;

window.loadSubmittedReports = async function () {
  const loadingEl = document.getElementById('submitted-reports-loading');
  const errorEl = document.getElementById('submitted-reports-error');
  const errorTextEl = document.getElementById('submitted-reports-error-text');
  const emptyEl = document.getElementById('submitted-reports-empty');
  const listEl = document.getElementById('submitted-reports-list');
  const badgeEl = document.getElementById('submitted-reports-count-badge');

  if (!listEl) return;

  const isInitialLoad = !Array.isArray(submittedRecordsCache) || submittedRecordsCache.length === 0;
  if (isInitialLoad) {
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (errorEl) errorEl.classList.add('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    listEl.classList.add('hidden');
  }

  try {
    const [reportsRes, rescuesRes] = await Promise.all([
      window.geoSafeStore.getReports(),
      window.geoSafeStore.getRescueRequests()
    ]);

    const reports = Array.isArray(reportsRes) ? reportsRes : [];
    const rescues = Array.isArray(rescuesRes) ? rescuesRes : [];

    const normalizedReports = reports.map((r) => ({
      kind: 'report',
      typeLabel: 'Incident Report',
      ref: r.referenceNumber || r.id || '',
      title: r.title || r.incidentType || 'Incident Report',
      category: r.incidentType || r.incident_type || 'Incident',
      description: r.description || '',
      location: r.location || r.address || 'Barangay Bayanan',
      status: r.status || 'Pending Verification',
      reviewRemarks: r.reviewRemarks || '',
      submittedAt: r.submittedAt || r.created_at || r.createdAt || null,
      fullHref: ''
    }));

    const normalizedRescues = rescues.map((q) => ({
      kind: 'rescue',
      dbId: q.dbId || null,
      typeLabel: 'Rescue Request',
      ref: q.referenceNumber || q.id || '',
      title: q.emergencyType || q.emergency_type || 'Rescue Request',
      category: q.emergencyType || q.emergency_type || 'Emergency Rescue',
      description: q.description || q.vulnerableDetails || '',
      location: q.location || q.address || 'Barangay Bayanan',
      status: q.status || 'Pending',
      assignedResponderId: q.assignedResponderId || null,
      assignedResponderName: q.assignedResponderName || null,
      conversationId: q.conversationId || null,
      conversationStatus: q.conversationStatus || null,
      conversationArchived: Boolean(q.conversationArchived),
      submittedAt: q.requestDate || q.created_at || q.createdAt || null,
      fullHref: 'rescue-requests.html'
    }));

    submittedRecordsCache = [...normalizedReports, ...normalizedRescues].sort((a, b) => {
      const ta = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const tb = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return tb - ta;
    });

    if (badgeEl) badgeEl.textContent = String(submittedRecordsCache.length);
    if (loadingEl) loadingEl.classList.add('hidden');

    if (submittedRecordsCache.length === 0) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    listEl.innerHTML = submittedRecordsCache.map((item, idx) => {
      const isRescue = item.kind === 'rescue';
      const typeBadgeClass = isRescue
        ? 'bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2]'
        : 'bg-slate-50 text-[#8A6800] border border-[#FFE872]';
      const statusClass = getSubmissionStatusStyle(item.status);
      const dateStr = formatSubmissionDate(item.submittedAt);

      return `
        <button type="button" onclick="openSubmissionDetailModal(${idx})"
          class="w-full text-left p-3.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-50 hover:border-[#F5B900] transition-colors space-y-2 focus:outline-none">
          <div class="flex items-center justify-between gap-2">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClass}">
              ${escapeHtmlSafe(item.typeLabel)}
            </span>
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${statusClass}">
              ${escapeHtmlSafe(item.status)}
            </span>
          </div>
          <div class="min-w-0">
            <p class="text-xs font-bold text-[#202020] truncate">${escapeHtmlSafe(item.title)}</p>
            ${item.kind === 'report' ? `<p class="text-[11px] font-semibold text-[#555555] truncate mt-0.5">${escapeHtmlSafe(item.category)}</p>` : ''}
          </div>
          <div class="text-[11px] text-[#777777] space-y-0.5">
            <p class="truncate">${escapeHtmlSafe(item.location)}</p>
            <p>${escapeHtmlSafe(dateStr)}</p>
          </div>
        </button>
      `;
    }).join('');

    listEl.classList.remove('hidden');

    const activeModal = document.getElementById('submission-detail-modal');
    if (activeSubmissionDetailKey && activeModal && !activeModal.classList.contains('hidden')) {
      const updatedIdx = submittedRecordsCache.findIndex((rec) => {
        if (rec.kind !== activeSubmissionDetailKey.kind) return false;
        if (activeSubmissionDetailKey.dbId && rec.dbId) {
          return String(rec.dbId) === String(activeSubmissionDetailKey.dbId);
        }
        return Boolean(activeSubmissionDetailKey.ref) && String(rec.ref) === String(activeSubmissionDetailKey.ref);
      });
      if (updatedIdx !== -1) {
        window.openSubmissionDetailModal(updatedIdx);
      }
    }
  } catch (err) {
    console.error('[Report/Rescue] loadSubmittedReports failed:', err);
    if (loadingEl) loadingEl.classList.add('hidden');
    if (badgeEl) badgeEl.textContent = '0';
    if (errorTextEl) errorTextEl.textContent = err.message || 'Unable to load submitted reports.';
    if (errorEl) errorEl.classList.remove('hidden');
  }
};

window.openSubmissionDetailModal = function (index) {
  const item = submittedRecordsCache[index];
  if (!item) return;

  activeSubmissionDetailKey = {
    kind: item.kind,
    dbId: item.dbId || null,
    ref: item.ref || ''
  };

  const modal = document.getElementById('submission-detail-modal');
  const typeBadge = document.getElementById('sub-detail-type-badge');
  const statusBadge = document.getElementById('sub-detail-status-badge');
  const titleEl = document.getElementById('sub-detail-title');
  const refEl = document.getElementById('sub-detail-ref');
  const catEl = document.getElementById('sub-detail-category');
  const locEl = document.getElementById('sub-detail-location');
  const dateEl = document.getElementById('sub-detail-date');
  const descWrap = document.getElementById('sub-detail-desc-wrap');
  const descEl = document.getElementById('sub-detail-desc');
  const remarksWrap = document.getElementById('sub-detail-remarks-wrap');
  const remarksLabel = document.getElementById('sub-detail-remarks-label');
  const remarksEl = document.getElementById('sub-detail-remarks');
  const fullLink = document.getElementById('sub-detail-full-link');
  const msgBtn = document.getElementById('sub-detail-message-btn');
  const msgLabel = document.getElementById('sub-detail-message-label');
  const msgDisabledBtn = document.getElementById('sub-detail-message-disabled');

  if (typeBadge) {
    typeBadge.textContent = item.typeLabel;
    typeBadge.className = item.kind === 'rescue'
      ? 'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold mb-1 bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2]'
      : 'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold mb-1 bg-slate-50 text-[#8A6800] border border-[#FFE872]';
  }
  if (statusBadge) {
    statusBadge.textContent = item.status;
    statusBadge.className = `inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold flex-shrink-0 ${getSubmissionStatusStyle(item.status)}`;
  }
  if (titleEl) titleEl.textContent = item.title;
  if (refEl) refEl.textContent = item.ref ? `Ref: ${item.ref}` : '';
  if (catEl) catEl.textContent = item.category;
  if (locEl) locEl.textContent = item.location;
  if (dateEl) dateEl.textContent = formatSubmissionDate(item.submittedAt);
  if (descWrap && descEl) {
    if (item.description) {
      descEl.textContent = item.description;
      descWrap.classList.remove('hidden');
    } else {
      descWrap.classList.add('hidden');
    }
  }
  if (remarksWrap && remarksEl) {
    if (item.reviewRemarks) {
      if (remarksLabel) {
        remarksLabel.textContent = String(item.status || '').toLowerCase().includes('reject')
          ? 'Rejection Reason:'
          : 'Administrator Review Notes:';
      }
      remarksEl.textContent = item.reviewRemarks;
      remarksWrap.classList.remove('hidden');
    } else {
      remarksWrap.classList.add('hidden');
    }
  }
  if (fullLink) {
    if (item.fullHref) {
      fullLink.href = item.fullHref;
      fullLink.classList.remove('hidden');
    } else {
      fullLink.classList.add('hidden');
    }
  }
  if (msgBtn || msgDisabledBtn) {
    if (item.kind !== 'rescue') {
      if (msgBtn) msgBtn.classList.add('hidden');
      if (msgDisabledBtn) msgDisabledBtn.classList.add('hidden');
    } else if (item.assignedResponderId) {
      if (msgDisabledBtn) msgDisabledBtn.classList.add('hidden');
      if (msgBtn) {
        const qs = new URLSearchParams({
          ...(item.conversationId ? { conversationId: String(item.conversationId) } : {}),
          ...(item.dbId ? { rescueId: String(item.dbId) } : {}),
          from: 'report-rescue',
        });
        msgBtn.href = `messages.html?${qs.toString()}`;
        if (msgLabel) {
          if (item.conversationStatus === 'Closed') {
            msgLabel.textContent = 'Contact Responder (Closed)';
          } else {
            msgLabel.textContent = 'Contact Responder';
          }
        }
        msgBtn.classList.remove('hidden');
      }
    } else {
      if (msgBtn) msgBtn.classList.add('hidden');
      if (msgDisabledBtn) msgDisabledBtn.classList.remove('hidden');
    }
  }

  if (modal) modal.classList.remove('hidden');
};

window.closeSubmissionDetailModal = function () {
  activeSubmissionDetailKey = null;
  const modal = document.getElementById('submission-detail-modal');
  if (modal) modal.classList.add('hidden');
};

