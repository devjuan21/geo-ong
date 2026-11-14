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
let reportCoords = { lat: 14.4075, lng: 121.0475 };
let reportPhotoBase64 = null;

let rescueMap = null;
let rescueMarker = null;
let rescueCoords = { lat: 14.4075, lng: 121.0475 };
let rescuePhotoBase64 = null;

document.addEventListener('DOMContentLoaded', () => {
  // Initialize common shell navigation
  GeoSafeUI.init('report-rescue', 'Report / Rescue');

  // Set current date/time in report field
  initDateTimeDisplay();

  // Initialize both Leaflet map pickers
  initReportMapPicker();
  initRescueMapPicker();

  // Check URL query parameters for direct tab activation (e.g. ?action=rescue)
  const urlParams = new URLSearchParams(window.location.search);
  const actionParam = urlParams.get('action') || urlParams.get('tab');
  if (actionParam === 'rescue') {
    switchActionTab('rescue');
  } else {
    switchActionTab('report');
  }
});

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
    if (btnReport) btnReport.className = 'w-full p-3.5 sm:p-4 rounded-3xl bg-white/70 border border-[#EEEEEE] text-left transition-all hover:border-[#F5B900] flex items-center justify-between gap-3 focus:outline-none';
    if (btnRescue) btnRescue.className = 'w-full p-3.5 sm:p-4 rounded-3xl bg-white border-2 border-[#D93636] shadow-emergency-glow ring-2 ring-[#FFC2C2] text-left transition-all flex items-center justify-between gap-3 focus:outline-none';

    if (sectionReport) sectionReport.classList.add('hidden');
    if (sectionRescue) sectionRescue.classList.remove('hidden');

    setTimeout(() => {
      if (rescueMap) rescueMap.invalidateSize();
    }, 150);
  } else {
    if (btnReport) btnReport.className = 'w-full p-3.5 sm:p-4 rounded-3xl bg-white border-2 border-[#F5B900] shadow-card text-left transition-all flex items-center justify-between gap-3 focus:outline-none';
    if (btnRescue) btnRescue.className = 'w-full p-3.5 sm:p-4 rounded-3xl bg-white/70 border border-[#EEEEEE] text-left transition-all hover:border-[#D93636] flex items-center justify-between gap-3 focus:outline-none';

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

    const icon = GeoSafeMapping.createCustomIcon('incident');
    reportMarker = L.marker([reportCoords.lat, reportCoords.lng], {
      icon,
      draggable: true
    }).addTo(reportMap);

    reportMarker.on('dragend', async (e) => {
      const pos = e.target.getLatLng();
      await updateReportPosition(pos.lat, pos.lng);
    });

    reportMap.on('click', async (e) => {
      reportMarker.setLatLng(e.latlng);
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

    const icon = GeoSafeMapping.createCustomIcon('incident');
    rescueMarker = L.marker([rescueCoords.lat, rescueCoords.lng], {
      icon,
      draggable: true
    }).addTo(rescueMap);

    rescueMarker.on('dragend', async (e) => {
      const pos = e.target.getLatLng();
      await updateRescuePosition(pos.lat, pos.lng);
    });

    rescueMap.on('click', async (e) => {
      rescueMarker.setLatLng(e.latlng);
      await updateRescuePosition(e.latlng.lat, e.latlng.lng);
    });
  } catch (err) {
    console.error('Failed to initialize rescue map picker:', err);
  }
}

/**
 * Update Report coordinates and reverse geocode
 */
async function updateReportPosition(lat, lng) {
  reportCoords.lat = lat;
  reportCoords.lng = lng;

  const latDisp = document.getElementById('rep-lat-display');
  const lngDisp = document.getElementById('rep-lng-display');
  const locInput = document.getElementById('rep-loc');

  if (latDisp) latDisp.textContent = lat.toFixed(5);
  if (lngDisp) lngDisp.textContent = lng.toFixed(5);

  const address = await GeoSafeMapping.reverseGeocode(lat, lng);
  if (locInput && (!locInput.value || locInput.value.includes('Bayanan'))) {
    locInput.value = address;
  }
}

/**
 * Update Rescue coordinates and reverse geocode
 */
async function updateRescuePosition(lat, lng) {
  rescueCoords.lat = lat;
  rescueCoords.lng = lng;

  const latDisp = document.getElementById('res-lat-display');
  const lngDisp = document.getElementById('res-lng-display');
  const locInput = document.getElementById('res-loc');

  if (latDisp) latDisp.textContent = lat.toFixed(5);
  if (lngDisp) lngDisp.textContent = lng.toFixed(5);

  const address = await GeoSafeMapping.reverseGeocode(lat, lng);
  if (locInput && (!locInput.value || locInput.value.includes('Bayanan'))) {
    locInput.value = address;
  }
}

/**
 * Acquire GPS for Report
 */
window.acquireGpsForReport = async function () {
  try {
    const pos = await GeoSafeMapping.getCurrentLocation();
    reportMap.setView([pos.lat, pos.lng], 16);
    reportMarker.setLatLng([pos.lat, pos.lng]);
    await updateReportPosition(pos.lat, pos.lng);
    GeoSafeUI.showToast('Incident coordinates set from current GPS.', 'success');
  } catch (err) {
    GeoSafeUI.showToast(err.message || 'Unable to access GPS location.', 'warning');
  }
};

/**
 * Acquire GPS for Rescue
 */
window.acquireGpsForRescue = async function () {
  try {
    const pos = await GeoSafeMapping.getCurrentLocation();
    rescueMap.setView([pos.lat, pos.lng], 16);
    rescueMarker.setLatLng([pos.lat, pos.lng]);
    await updateRescuePosition(pos.lat, pos.lng);
    GeoSafeUI.showToast('Emergency rescue location set from current GPS.', 'success');
  } catch (err) {
    GeoSafeUI.showToast(err.message || 'Unable to access GPS location.', 'warning');
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
};

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
      'Your incident report has been securely transmitted to Barangay Bayanan Emergency Operations. It has been queued for verification.',
      saved.id || saved.referenceNumber
    );

    // Reset Form
    document.getElementById('form-report-incident')?.reset();
    document.getElementById('rep-photo-preview-container')?.classList.add('hidden');
    reportPhotoBase64 = null;
    initDateTimeDisplay();
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
/* ACTION 2: RESCUE SUBMISSION                                               */
/* ========================================================================= */

window.openRescueConfirmModal = function () {
  const type = document.getElementById('res-type')?.value;
  const count = document.getElementById('res-count')?.value;
  const desc = document.getElementById('res-desc')?.value.trim();
  const loc = document.getElementById('res-loc')?.value.trim();

  if (!type || !count || !desc || !loc) {
    GeoSafeUI.showToast('Please complete all required fields for emergency rescue.', 'error');
    return;
  }

  document.getElementById('cfm-res-type').textContent = type;
  document.getElementById('cfm-res-count').textContent = `${count} individual(s)`;
  document.getElementById('cfm-res-loc').textContent = loc;

  document.getElementById('confirm-rescue-modal')?.classList.remove('hidden');
};

window.closeRescueConfirmModal = function () {
  document.getElementById('confirm-rescue-modal')?.classList.add('hidden');
};

window.submitRescueFinal = async function () {
  if (isSubmittingRescue) return;
  const submitBtn = document.getElementById('btn-submit-rescue-final');
  isSubmittingRescue = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Dispatching Emergency Call...';
  }

  const payload = {
    emergencyType: document.getElementById('res-type').value,
    peopleCount: parseInt(document.getElementById('res-count').value, 10) || 1,
    description: document.getElementById('res-desc').value.trim(),
    location: document.getElementById('res-loc').value.trim(),
    coordinates: { lat: rescueCoords.lat, lng: rescueCoords.lng },
    additionalInstructions: document.getElementById('res-notes')?.value.trim() || '',
    photos: rescuePhotoBase64 ? [rescuePhotoBase64] : []
  };

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
    document.getElementById('res-photo-preview-container')?.classList.add('hidden');
    rescuePhotoBase64 = null;
  } catch (err) {
    console.error('Rescue submission error:', err);
    GeoSafeUI.showToast('Failed to dispatch rescue request. Please call hotline directly: (02) 8861-0185.', 'error');
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

