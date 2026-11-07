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
      center: [reportCoords.lat, reportCoords.lng],
      zoom: 15,
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
      center: [rescueCoords.lat, rescueCoords.lng],
      zoom: 15,
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

/**
 * Handle Photo Upload Preview
 */
window.handlePhotoUpload = function (event, prefix) {
  const file = event.target.files?.[0];
  const nameLabel = document.getElementById(`${prefix}-photo-filename`);
  const previewContainer = document.getElementById(`${prefix}-photo-preview-container`);
  const previewImg = document.getElementById(`${prefix}-photo-preview`);

  if (!file) return;

  if (nameLabel) nameLabel.textContent = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    if (prefix === 'rep') {
      reportPhotoBase64 = dataUrl;
    } else {
      rescuePhotoBase64 = dataUrl;
    }

    if (previewImg && previewContainer) {
      previewImg.src = dataUrl;
      previewContainer.classList.remove('hidden');
    }
  };
  reader.readAsDataURL(file);
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

window.submitReportFinal = async function () {
  const submitBtn = document.getElementById('btn-submit-report-final');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Transmitting...';
  }

  const payload = {
    incidentType: document.getElementById('rep-type').value,
    title: document.getElementById('rep-title').value.trim(),
    description: document.getElementById('rep-desc').value.trim(),
    location: document.getElementById('rep-loc').value.trim(),
    coordinates: { lat: reportCoords.lat, lng: reportCoords.lng },
    authorizedForCommunity: document.getElementById('rep-community-auth')?.checked !== false,
    photos: reportPhotoBase64 ? [reportPhotoBase64] : []
  };

  try {
    const saved = await window.geoSafeStore.submitReport(payload);
    closeReportConfirmModal();

    // Show Success Modal (Section 5.C)
    showSubmissionSuccess(
      'Incident Report Transmitted',
      'Your incident report has been securely transmitted to Barangay Bayanan Emergency Operations. It has been queued for verification.',
      saved.id
    );

    // Reset Form
    document.getElementById('form-report-incident')?.reset();
    document.getElementById('rep-photo-preview-container')?.classList.add('hidden');
    reportPhotoBase64 = null;
    initDateTimeDisplay();
  } catch (err) {
    console.error('Report submission error:', err);
    GeoSafeUI.showToast('Failed to submit report. Please check connection and try again.', 'error');
  } finally {
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
  const submitBtn = document.getElementById('btn-submit-rescue-final');
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

