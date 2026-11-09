/**
 * GeoSafe - Report an Incident Page Logic
 * Features:
 * - Form validation with clear feedback
 * - Browser Geolocation API integration
 * - Leaflet map preview with draggable marker for manual location picking
 * - Image attachment dropzone with live previews
 * - Two-step review confirmation modal
 * - Online connectivity check before server submission
 * - Success confirmation view with generated reference number
 */

let reportMap = null;
let reportMarker = null;
let attachedPhotos = [];

const DEFAULT_COORDS = { lat: 14.4075, lng: 121.0475 }; // Barangay Bayanan center

document.addEventListener('DOMContentLoaded', () => {
  GeoSafeUI.init('report-incident', 'Report an Incident');
  initFormDefaults();
  initMap();
  setupImageDropzone();
  setupFormListeners();
});

function initFormDefaults() {
  const dateTimeInput = document.getElementById('incident-datetime');
  if (dateTimeInput) {
    const now = new Date();
    // format as YYYY-MM-DDThh:mm for datetime-local
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - offset)).toISOString().slice(0, 16);
    dateTimeInput.value = localISOTime;
  }
}

function initMap() {
  const mapEl = document.getElementById('report-map');
  if (!mapEl || typeof L === 'undefined') return;

  try {
    reportMap = L.map('report-map').setView([DEFAULT_COORDS.lat, DEFAULT_COORDS.lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors | GeoSafe Bayanan'
    }).addTo(reportMap);

    // Draggable marker
    reportMarker = L.marker([DEFAULT_COORDS.lat, DEFAULT_COORDS.lng], {
      draggable: true
    }).addTo(reportMap);

    reportMarker.on('dragend', function (e) {
      const position = reportMarker.getLatLng();
      updateCoordinatesDisplay(position.lat, position.lng);
    });

    reportMap.on('click', function (e) {
      reportMarker.setLatLng(e.latlng);
      updateCoordinatesDisplay(e.latlng.lat, e.latlng.lng);
    });

    updateCoordinatesDisplay(DEFAULT_COORDS.lat, DEFAULT_COORDS.lng);
  } catch (err) {
    console.warn('Map initialization deferred or failed:', err);
  }
}

function updateCoordinatesDisplay(lat, lng) {
  const latInput = document.getElementById('incident-lat');
  const lngInput = document.getElementById('incident-lng');
  const display = document.getElementById('gps-coords-display');

  if (latInput) latInput.value = lat.toFixed(6);
  if (lngInput) lngInput.value = lng.toFixed(6);
  if (display) {
    display.textContent = `${lat.toFixed(6)}° N, ${lng.toFixed(6)}° E`;
  }
}

// Browser Geolocation API
window.getCurrentLocation = function () {
  const btn = document.getElementById('btn-get-gps');
  const statusEl = document.getElementById('gps-status-indicator');

  if (!navigator.geolocation) {
    GeoSafeUI.showToast('Geolocation is not supported by your browser.', 'warning');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg class="animate-spin w-3.5 h-3.5 mr-1 inline-block text-brand-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Locating...`;
  }
  if (statusEl) statusEl.textContent = 'Acquiring GPS fix...';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      updateCoordinatesDisplay(latitude, longitude);

      if (reportMap && reportMarker) {
        reportMap.setView([latitude, longitude], 17);
        reportMarker.setLatLng([latitude, longitude]);
      }

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${GeoSafeUI.getIcon('crosshair', 'w-4 h-4')} <span>Use My GPS</span>`;
      }
      if (statusEl) statusEl.textContent = `GPS Fix Acquired (Accuracy: ±${Math.round(position.coords.accuracy)}m)`;

      GeoSafeUI.showToast('Location coordinates acquired successfully.', 'success');
    },
    (error) => {
      console.warn('Geolocation error:', error);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${GeoSafeUI.getIcon('crosshair', 'w-4 h-4')} <span>Use My GPS</span>`;
      }
      let msg = 'Unable to retrieve location. Please adjust the pin on the map manually.';
      if (error.code === error.PERMISSION_DENIED) {
        msg = 'Location permission denied. Please enable GPS permissions or drag the map pin.';
      }
      if (statusEl) statusEl.textContent = 'GPS Unavailable (manual selection active)';
      GeoSafeUI.showToast(msg, 'warning');
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
};

// Photo attachment handling
function setupImageDropzone() {
  const dropzone = document.getElementById('image-dropzone');
  const fileInput = document.getElementById('incident-photos');
  const previewContainer = document.getElementById('photos-preview-container');

  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('border-brand-500', 'bg-brand-50/50');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('border-brand-500', 'bg-brand-50/50');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('border-brand-500', 'bg-brand-50/50');
    if (e.dataTransfer.files) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
    }
  });

  function handleFiles(files) {
    const validFiles = files.filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) {
      GeoSafeUI.showToast('Please select valid image files (JPG, PNG, WEBP).', 'warning');
      return;
    }

    if (attachedPhotos.length + validFiles.length > 5) {
      GeoSafeUI.showToast('Maximum 5 images allowed per report.', 'warning');
      return;
    }

    validFiles.forEach(file => {
      if (file.size > 5 * 1024 * 1024) {
        GeoSafeUI.showToast(`${file.name} exceeds 5MB limit.`, 'warning');
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        attachedPhotos.push({
          name: file.name,
          dataUrl: event.target.result
        });
        renderPhotoPreviews();
      };
      reader.readAsDataURL(file);
    });
  }

  function renderPhotoPreviews() {
    if (!previewContainer) return;
    previewContainer.innerHTML = attachedPhotos.map((photo, index) => `
      <div class="relative group w-20 h-20 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shadow-sm flex-shrink-0">
        <img src="${photo.dataUrl}" alt="Preview" class="w-full h-full object-cover">
        <button type="button" onclick="removePhoto(${index})" class="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-900/70 hover:bg-rose-600 text-white flex items-center justify-center transition-colors">
          ${GeoSafeUI.getIcon('x', 'w-3 h-3')}
        </button>
      </div>
    `).join('');
  }

  window.removePhoto = function (index) {
    attachedPhotos.splice(index, 1);
    renderPhotoPreviews();
  };
}

// Form validation and Review Modal
function setupFormListeners() {
  const form = document.getElementById('incident-report-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    if (!validateForm()) {
      GeoSafeUI.showToast('Please complete all required fields.', 'error');
      return;
    }

    // Open Confirmation Step Modal
    openReviewModal();
  });
}

function validateForm() {
  let isValid = true;

  const fields = [
    { id: 'incident-type', errorId: 'err-incident-type' },
    { id: 'incident-title', errorId: 'err-incident-title', minLen: 6 },
    { id: 'incident-description', errorId: 'err-incident-description', minLen: 15 },
    { id: 'incident-location', errorId: 'err-incident-location', minLen: 5 },
    { id: 'incident-datetime', errorId: 'err-incident-datetime' }
  ];

  fields.forEach(field => {
    const input = document.getElementById(field.id);
    const errEl = document.getElementById(field.errorId);
    if (!input || !errEl) return;

    const val = input.value.trim();
    if (!val || (field.minLen && val.length < field.minLen)) {
      isValid = false;
      errEl.classList.remove('hidden');
      input.classList.add('border-rose-400', 'bg-rose-50/20');
    } else {
      errEl.classList.add('hidden');
      input.classList.remove('border-rose-400', 'bg-rose-50/20');
    }
  });

  return isValid;
}

function getFormData() {
  const type = document.getElementById('incident-type').value;
  const title = document.getElementById('incident-title').value.trim();
  const description = document.getElementById('incident-description').value.trim();
  const location = document.getElementById('incident-location').value.trim();
  const datetime = document.getElementById('incident-datetime').value;
  const severity = document.getElementById('incident-severity') ? document.getElementById('incident-severity').value : 'Moderate';
  const lat = parseFloat(document.getElementById('incident-lat').value) || DEFAULT_COORDS.lat;
  const lng = parseFloat(document.getElementById('incident-lng').value) || DEFAULT_COORDS.lng;

  return {
    incidentType: type,
    title,
    description,
    location,
    dateTime: datetime,
    severity,
    coordinates: { lat, lng },
    photos: attachedPhotos.map(p => p.dataUrl)
  };
}

function openReviewModal() {
  const data = getFormData();
  const modal = document.getElementById('report-review-modal');
  if (!modal) return;

  document.getElementById('review-type').textContent = data.incidentType;
  document.getElementById('review-title').textContent = data.title;
  document.getElementById('review-description').textContent = data.description;
  document.getElementById('review-location').textContent = data.location;
  document.getElementById('review-gps').textContent = `${data.coordinates.lat.toFixed(6)}° N, ${data.coordinates.lng.toFixed(6)}° E`;
  document.getElementById('review-datetime').textContent = GeoSafeUI.formatDate(data.dateTime);
  document.getElementById('review-photos-count').textContent = `${data.photos.length} photo(s) attached`;

  modal.classList.remove('hidden');
}

window.closeReviewModal = function () {
  const modal = document.getElementById('report-review-modal');
  if (modal) modal.classList.add('hidden');
};

let isSubmittingIncident = false;

window.confirmAndSubmitReport = async function () {
  if (isSubmittingIncident) return;

  const submitBtn = document.getElementById('btn-confirm-submit');
  const errorEl = document.getElementById('modal-submit-error');

  if (errorEl) errorEl.classList.add('hidden');

  // Strict network verification (Requirement 15)
  if (!window.geoSafeStore.isOnline()) {
    if (errorEl) {
      errorEl.classList.remove('hidden');
      errorEl.textContent = 'Cannot submit: No active internet connection. Please verify your network and retry.';
    }
    GeoSafeUI.showToast('No active internet connection. Reporting requires online connectivity.', 'error');
    return;
  }

  isSubmittingIncident = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<svg class="animate-spin w-4 h-4 mr-2 inline-block text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Transmitting to Operations...`;
  }

  try {
    const payload = getFormData();
    const result = await window.geoSafeStore.submitReport(payload);

    window.closeReviewModal();
    showSubmissionSuccess(result);
  } catch (err) {
    console.error('Submission failed:', err);
    if (errorEl) {
      errorEl.classList.remove('hidden');
      errorEl.textContent = err.message || 'Failed to submit report. Please retry.';
    }
    GeoSafeUI.showToast(err.message || 'Submission error. Failed to transmit report.', 'error');
  } finally {
    isSubmittingIncident = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Confirm & Transmit Report';
    }
  }
};

function showSubmissionSuccess(report) {
  const successModal = document.getElementById('report-success-modal');
  if (!successModal) return;

  const refId = report.id || report.referenceNumber || 'INC-PENDING';
  const incType = report.incidentType || report.incident_type || 'Incident';
  const loc = report.location || report.address || 'Barangay Bayanan';

  document.getElementById('success-report-id').textContent = refId;
  document.getElementById('success-report-type').textContent = incType;
  document.getElementById('success-report-location').textContent = loc;

  // Reset reporting form
  const form = document.getElementById('incident-report-form');
  if (form) form.reset();

  successModal.classList.remove('hidden');
}

window.copyReportId = function () {
  const ref = document.getElementById('success-report-id').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(ref).then(() => {
      GeoSafeUI.showToast('Reference number copied to clipboard.', 'success');
    });
  }
};

