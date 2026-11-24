/**
 * GeoSafe - Unified Authentication & Resident Registration Controller
 * ============================================================================
 * - Zero role selection dropdowns or manual role buttons.
 * - Supports Resident Self-Registration (POST /api/register -> role_id = 3)
 *   and directs new registrants to Sign In.
 * - Authenticates via POST /api/login (sets HttpOnly session cookie + CSRF token)
 *   and redirects based on the server-verified MySQL role:
 *     * Resident      -> /index.html
 *     * Responder     -> /responder-dashboard.html
 *     * Administrator -> /admin.html
 * ============================================================================
 */

document.addEventListener('DOMContentLoaded', async () => {
  clearLoginFormFields();
  setupPasswordVisibilityToggle();
  setupForgotPasswordHandler();
  setupLoginForm();
  setupRegisterForm();
  await checkExistingServerSession();

  // Support ?mode=register query parameter
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') === 'register') {
    window.switchAuthTab('register');
  } else if (params.get('forgot') === '1') {
    document.getElementById('forgot-password-btn')?.click();
  } else if (params.get('forgot') === '1') {
    document.getElementById('forgot-password-btn')?.click();
  }
});

/**
 * Checks if the user already has a valid server-managed HttpOnly session cookie.
 */
async function checkExistingServerSession() {
  if (!window.geoSafeStore) return;
  const check = await window.geoSafeStore.verifySession(null, true);
  if (check && check.authenticated && check.user) {
    if (check.user.mustChangePassword) {
      window.location.replace('change-password.html');
      return;
    }
    redirectByVerifiedRole(check.user.role);
  }
}

/**
 * Redirects user strictly based on backend-verified role
 */
function redirectByVerifiedRole(role) {
  const normalizedRole = (role || '').toString().trim().toLowerCase();

  if (normalizedRole === 'responder') {
    window.location.replace('responder-dashboard.html');
  } else if (normalizedRole === 'admin' || normalizedRole === 'administrator') {
    window.location.replace('admin.html');
  } else {
    window.location.replace('index.html');
  }
}

/**
 * Switches between 'login' and 'register' tabs on login.html
 */
window.switchAuthTab = function (mode) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const tabLogin = document.getElementById('tab-btn-login');
  const tabRegister = document.getElementById('tab-btn-register');
  const titleEl = document.getElementById('auth-card-title');
  const subEl = document.getElementById('auth-card-subtitle');
  const headerSwitchBtn = document.getElementById('header-switch-register-btn');

  hideErrorBanner();

  if (mode === 'register') {
    loginForm?.classList.add('hidden');
    registerForm?.classList.remove('hidden');
    if (tabRegister) {
      tabRegister.className = 'py-2 px-3 rounded-md text-xs font-bold transition-all bg-[#F5B900] text-[#202020] shadow-subtle';
    }
    if (tabLogin) {
      tabLogin.className = 'py-2 px-3 rounded-md text-xs font-bold transition-all text-[#777777] hover:text-[#202020]';
    }
    if (titleEl) titleEl.textContent = 'Create Resident Account';
    if (subEl) subEl.textContent = 'Register for Barangay Bayanan community safety access.';
    if (headerSwitchBtn) {
      headerSwitchBtn.innerHTML = '<span>Sign In</span>';
      headerSwitchBtn.setAttribute('onclick', "switchAuthTab('login')");
    }
  } else {
    stopAllRegisterCameras();
    registerForm?.classList.add('hidden');
    loginForm?.classList.remove('hidden');
    if (tabLogin) {
      tabLogin.className = 'py-2 px-3 rounded-md text-xs font-bold transition-all bg-[#F5B900] text-[#202020] shadow-subtle';
    }
    if (tabRegister) {
      tabRegister.className = 'py-2 px-3 rounded-md text-xs font-bold transition-all text-[#777777] hover:text-[#202020]';
    }
    if (titleEl) titleEl.textContent = 'Welcome Back';
    if (subEl) subEl.textContent = 'Sign in to access your account.';
    if (headerSwitchBtn) {
      headerSwitchBtn.innerHTML = '<span>Create Resident Account</span>';
      headerSwitchBtn.setAttribute('onclick', "switchAuthTab('register')");
    }
  }
};

function setupPasswordVisibilityToggle() {
  const toggleBtn = document.getElementById('toggle-password-btn');
  const passwordInput = document.getElementById('login-password');
  const eyeOpen = document.getElementById('eye-open-icon');
  const eyeClosed = document.getElementById('eye-closed-icon');

  if (!toggleBtn || !passwordInput) return;

  toggleBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    toggleBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    if (eyeOpen && eyeClosed) {
      eyeOpen.classList.toggle('hidden', isPassword);
      eyeClosed.classList.toggle('hidden', !isPassword);
    }
  });
}

function setupForgotPasswordHandler() {
  const forgotBtn = document.getElementById('forgot-password-btn');
  const modal = document.getElementById('forgot-password-modal');
  if (!forgotBtn || !modal) return;

  const closeBtn = document.getElementById('fp-close-btn');
  const doneBtn = document.getElementById('fp-done-btn');
  const errBox = document.getElementById('pa-error-box');
  const ticketForm = document.getElementById('pa-ticket-form');
  const successStep = document.getElementById('pa-step-success');
  const fullNameInput = document.getElementById('pa-full-name');
  const emailInput = document.getElementById('pa-email');
  const mobileInput = document.getElementById('pa-mobile');
  const roleSelect = document.getElementById('pa-role');
  const descInput = document.getElementById('pa-description');
  const submitBtn = document.getElementById('pa-submit-btn');
  const submitBtnText = document.getElementById('pa-submit-btn-text');
  const ticketRefEl = document.getElementById('pa-ticket-ref');

  let isSubmittingTicket = false;

  const showError = (msg) => {
    if (!errBox) return;
    if (!msg) {
      errBox.textContent = '';
      errBox.classList.add('hidden');
    } else {
      errBox.textContent = msg;
      errBox.classList.remove('hidden');
    }
  };

  const openModal = () => {
    showError(null);
    if (ticketForm) {
      ticketForm.reset();
      ticketForm.classList.remove('hidden');
    }
    if (successStep) successStep.classList.add('hidden');
    const loginEmail = document.getElementById('login-email');
    if (emailInput && loginEmail && loginEmail.value.trim()) {
      emailInput.value = loginEmail.value.trim();
    }
    modal.classList.remove('hidden');
    if (fullNameInput) fullNameInput.focus();
  };

  const closeModal = () => {
    modal.classList.add('hidden');
  };

  forgotBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (doneBtn) doneBtn.addEventListener('click', closeModal);

  if (ticketForm) {
    ticketForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isSubmittingTicket) return;
      showError(null);

      const fullName = String(fullNameInput ? fullNameInput.value : '').trim();
      const email = String(emailInput ? emailInput.value : '').trim().toLowerCase();
      const mobileNumber = String(mobileInput ? mobileInput.value : '').trim();
      const accountRole = String(roleSelect ? roleSelect.value : 'resident').trim().toLowerCase();
      const description = String(descInput ? descInput.value : '').trim();

      if (fullName.length < 2) {
        showError('Please enter your full name (at least 2 characters).');
        return;
      }
      if (!isValidEmail(email)) {
        showError('Please enter a valid registered email address.');
        return;
      }
      if (!/^[0-9+\-\s()]{7,30}$/.test(mobileNumber)) {
        showError('Please enter a valid mobile number (7 to 30 digits).');
        return;
      }
      if (description.length < 10) {
        showError('Please describe your issue (at least 10 characters). Do not include your password.');
        return;
      }

      isSubmittingTicket = true;
      if (submitBtn) submitBtn.disabled = true;
      if (submitBtnText) submitBtnText.textContent = 'Submitting...';

      try {
        const res = await fetch('/api/auth/password-assistance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ fullName, email, mobileNumber, accountRole, description }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(data.error || 'Unable to submit password assistance request.');
          return;
        }
        if (ticketRefEl) ticketRefEl.textContent = data.ticketReference || 'Submitted';
        if (ticketForm) ticketForm.classList.add('hidden');
        if (successStep) successStep.classList.remove('hidden');
      } catch (_) {
        showError('Network error contacting GeoSafe server. Please try again.');
      } finally {
        isSubmittingTicket = false;
        if (submitBtn) submitBtn.disabled = false;
        if (submitBtnText) submitBtnText.textContent = 'Submit Assistance Request';
      }
    });
  }
}

/**
 * Universal Floating Toast Notification Helper for Auth Pages
 */
function showToastNotification(message, type = 'error') {
  if (window.GeoSafeToast && typeof window.GeoSafeToast.show === 'function') {
    return window.GeoSafeToast.show({ message, type, duration: 3500 });
  } else if (window.GeoSafeUI && typeof window.GeoSafeUI.showToast === 'function') {
    return window.GeoSafeUI.showToast(message, type, 3500);
  }
}

function showErrorBanner(message) {
  showToastNotification(message, 'error');
}

function showSuccessBanner(message) {
  showToastNotification(message, 'success');
}

function hideErrorBanner() {
  // Toast notifications manage their own auto-dismiss and lifecycle
}

function setSubmittingState(isSubmitting) {
  const submitBtn = document.getElementById('login-submit-btn');
  const btnText = document.getElementById('login-btn-text');
  const btnArrow = document.getElementById('login-btn-arrow');
  const btnSpinner = document.getElementById('login-btn-spinner');

  if (!submitBtn) return;
  submitBtn.disabled = isSubmitting;

  if (isSubmitting) {
    submitBtn.classList.add('opacity-80', 'cursor-wait');
    if (btnText) btnText.textContent = 'Signing in...';
    if (btnArrow) btnArrow.classList.add('hidden');
    if (btnSpinner) btnSpinner.classList.remove('hidden');
  } else {
    submitBtn.classList.remove('opacity-80', 'cursor-wait');
    if (btnText) btnText.textContent = 'Sign In';
    if (btnArrow) btnArrow.classList.remove('hidden');
    if (btnSpinner) btnSpinner.classList.add('hidden');
  }
}

function setRegisterSubmittingState(isSubmitting) {
  const submitBtn = document.getElementById('register-submit-btn');
  const btnText = document.getElementById('register-btn-text');
  const btnSpinner = document.getElementById('register-btn-spinner');

  if (!submitBtn) return;
  submitBtn.disabled = isSubmitting;

  if (isSubmitting) {
    submitBtn.classList.add('opacity-80', 'cursor-wait');
    if (btnText) btnText.textContent = 'Creating Resident Account...';
    if (btnSpinner) btnSpinner.classList.remove('hidden');
  } else {
    submitBtn.classList.remove('opacity-80', 'cursor-wait');
    if (btnText) btnText.textContent = 'Create Resident Account';
    if (btnSpinner) btnSpinner.classList.add('hidden');
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

let userPhysicallyInteracted = false;

function clearLoginFormFields(force = false) {
  if (userPhysicallyInteracted && !force) return;
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  if (form && (!userPhysicallyInteracted || force)) {
    try {
      form.reset();
    } catch (_) {}
  }
  if (emailInput && (!userPhysicallyInteracted || force)) {
    emailInput.value = '';
    if (typeof emailInput.removeAttribute === 'function') emailInput.removeAttribute('value');
  }
  if (passwordInput && (!userPhysicallyInteracted || force)) {
    passwordInput.value = '';
    if (typeof passwordInput.removeAttribute === 'function') passwordInput.removeAttribute('value');
  }
}

function setupLoginForm() {
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const rememberInput = document.getElementById('login-remember');

  if (!form || !emailInput || !passwordInput) return;

  // Clear any default or prefilled credentials immediately on initialization
  clearLoginFormFields(true);

  // Only genuine physical keystrokes, beforeinput, or intentional paste by the user mark form interaction.
  // Synthetic input/change events fired by browser password managers (autofill) on load are NOT physical interactions.
  const markPhysicalInteraction = () => {
    userPhysicallyInteracted = true;
  };

  ['keydown', 'beforeinput', 'paste'].forEach((evt) => {
    emailInput.addEventListener(evt, markPhysicalInteraction, { passive: true });
    passwordInput.addEventListener(evt, markPhysicalInteraction, { passive: true });
  });

  // Guard against browser password managers injecting saved credentials before any user interaction
  const guardAutofillInjection = () => {
    if (!userPhysicallyInteracted) {
      clearLoginFormFields();
    }
  };

  ['input', 'change'].forEach((evt) => {
    emailInput.addEventListener(evt, guardAutofillInjection, { passive: true });
    passwordInput.addEventListener(evt, guardAutofillInjection, { passive: true });
  });

  // Clear on back/forward cache navigation and page load (before user interaction)
  window.addEventListener('pageshow', () => {
    userPhysicallyInteracted = false;
    clearLoginFormFields(true);
  });
  window.addEventListener('load', () => {
    if (!userPhysicallyInteracted) {
      clearLoginFormFields(true);
    }
  });

  // Intercept delayed browser password manager autofill rounds on page open (only while untouched)
  [0, 50, 100, 200, 400, 600, 1000, 1500, 2000].forEach((delay) => {
    setTimeout(() => {
      if (!userPhysicallyInteracted) {
        clearLoginFormFields(true);
      }
    }, delay);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const rememberMe = Boolean(rememberInput && rememberInput.checked);

    if (!email) {
      showToastNotification('Please enter your email address.', 'warning');
      emailInput.focus();
      return;
    }

    if (!isValidEmail(email)) {
      showToastNotification('Please enter a valid email address.', 'warning');
      emailInput.focus();
      return;
    }

    if (!password) {
      showToastNotification('Please enter your password.', 'warning');
      passwordInput.focus();
      return;
    }

    setSubmittingState(true);

    try {
      const authResult = await window.geoSafeStore.login(email, password, rememberMe);

      const verifiedRole = authResult.user?.role || authResult.role || 'Resident';
      const roleLabel =
        verifiedRole.toLowerCase() === 'responder'
          ? 'Responder Portal'
          : verifiedRole.toLowerCase().includes('admin')
          ? 'Administrator Command Portal'
          : 'Resident Portal';

      if (authResult.user?.mustChangePassword) {
        showToastNotification('First-login password change required. Redirecting...', 'info');
        setTimeout(() => {
          window.location.replace('change-password.html');
        }, 350);
        return;
      }

      showSuccessBanner(`Authenticated as ${authResult.user?.name || email}. Redirecting to ${roleLabel}...`);

      setTimeout(() => {
        redirectByVerifiedRole(verifiedRole);
      }, 350);
    } catch (err) {
      setSubmittingState(false);
      let errorMsg = 'Invalid email or password.';
      if (err && (err.status === 401 || err.statusCode === 401)) {
        errorMsg = 'Invalid email or password.';
      } else if (err && err.isOffline) {
        errorMsg = 'No internet connection. Please check your connection and try again.';
      } else if (err && err.message) {
        const msg = String(err.message).trim();
        if (/invalid.*(email|password|credential)/i.test(msg) || /authentication failed/i.test(msg) || /unauthorized/i.test(msg)) {
          errorMsg = 'Invalid email or password.';
        } else {
          errorMsg = msg.endsWith('.') ? msg : `${msg}.`;
        }
      }
      showToastNotification(errorMsg, 'error');
    }
  });
}

const registerCameraState = {
  id: { stream: null, dataUrl: '' },
  selfie: { stream: null, dataUrl: '' },
};

function getRegisterSlotElements(slot) {
  const prefix = slot === 'id' ? 'reg-id' : 'reg-selfie';
  return {
    placeholder: document.getElementById(`${prefix}-placeholder`),
    video: document.getElementById(`${prefix}-video`),
    preview: document.getElementById(`${prefix}-preview`),
    canvas: document.getElementById(`${prefix}-canvas`),
    status: document.getElementById(`${prefix}-status`),
    startBtn: document.getElementById(`${prefix}-start-btn`),
    captureBtn: document.getElementById(`${prefix}-capture-btn`),
    retakeBtn: document.getElementById(`${prefix}-retake-btn`),
    removeBtn: document.getElementById(`${prefix}-remove-btn`),
  };
}

function stopCameraStream(slot) {
  const state = registerCameraState[slot];
  if (state && state.stream) {
    state.stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (_) {}
    });
    state.stream = null;
  }
  const els = getRegisterSlotElements(slot);
  if (els.video) {
    els.video.srcObject = null;
  }
}

function stopAllRegisterCameras() {
  stopCameraStream('id');
  stopCameraStream('selfie');
}

function updateRegisterSlotUI(slot) {
  const state = registerCameraState[slot];
  const els = getRegisterSlotElements(slot);
  if (!els.placeholder || !els.video || !els.preview) return;

  const hasStream = Boolean(state.stream);
  const hasPhoto = Boolean(state.dataUrl);

  els.placeholder.classList.toggle('hidden', hasStream || hasPhoto);
  els.video.classList.toggle('hidden', !hasStream || hasPhoto);
  els.preview.classList.toggle('hidden', !hasPhoto);

  if (hasPhoto) {
    els.preview.src = state.dataUrl;
  } else {
    els.preview.removeAttribute('src');
  }

  if (els.startBtn) els.startBtn.classList.toggle('hidden', hasStream || hasPhoto);
  if (els.captureBtn) els.captureBtn.classList.toggle('hidden', !hasStream || hasPhoto);
  if (els.retakeBtn) els.retakeBtn.classList.toggle('hidden', !hasPhoto);
  if (els.removeBtn) els.removeBtn.classList.toggle('hidden', !hasPhoto);

  if (els.status) {
    if (hasPhoto) {
      els.status.textContent = 'Captured';
      els.status.className = 'text-[10px] font-semibold text-emerald-700';
    } else if (hasStream) {
      els.status.textContent = 'Live Camera';
      els.status.className = 'text-[10px] font-semibold text-[#164579]';
    } else {
      els.status.textContent = 'Required';
      els.status.className = 'text-[10px] font-semibold text-[#64748B]';
    }
  }
}

async function waitForVideoReadyFrame(videoEl, timeoutMs = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0;
}

function isCanvasBlankOrBlack(canvas) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;
    const { width, height } = canvas;
    if (!width || !height) return true;
    const data = ctx.getImageData(0, 0, width, height).data;
    let maxLuma = 0;
    const step = 16;
    for (let i = 0; i < data.length; i += 4 * step) {
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (luma > maxLuma) maxLuma = luma;
      if (maxLuma >= 2) return false;
    }
    return maxLuma < 2;
  } catch (_) {
    return false;
  }
}

async function startCameraForSlot(slot) {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    showToastNotification('Camera access is not supported in this browser or context (HTTPS required).', 'error');
    return;
  }

  // Stop the other camera first so mobile/laptop single-camera devices don't conflict
  const otherSlot = slot === 'id' ? 'selfie' : 'id';
  stopCameraStream(otherSlot);
  updateRegisterSlotUI(otherSlot);

  stopCameraStream(slot);
  registerCameraState[slot].dataUrl = '';

  const els = getRegisterSlotElements(slot);
  try {
    const facingMode = slot === 'selfie' ? 'user' : 'environment';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
    } catch (_) {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    registerCameraState[slot].stream = stream;
    if (els.video) {
      els.video.srcObject = stream;
      await els.video.play().catch(() => {});
    }
    updateRegisterSlotUI(slot);
  } catch (err) {
    stopCameraStream(slot);
    updateRegisterSlotUI(slot);
    showToastNotification(err?.message || 'Unable to access camera. Please allow camera permission.', 'error');
  }
}

async function captureFromSlot(slot) {
  const state = registerCameraState[slot];
  const els = getRegisterSlotElements(slot);
  if (!state.stream || !els.video || !els.canvas) {
    showToastNotification('Please open the camera first before capturing.', 'warning');
    return;
  }

  const ready = await waitForVideoReadyFrame(els.video);
  if (!ready) {
    showToastNotification('Camera feed is still initializing. Please wait a moment and try again.', 'warning');
    return;
  }

  const maxWidth = 1024;
  const srcWidth = els.video.videoWidth || 640;
  const srcHeight = els.video.videoHeight || 480;
  const scale = srcWidth > maxWidth ? maxWidth / srcWidth : 1;
  const width = Math.round(srcWidth * scale);
  const height = Math.round(srcHeight * scale);

  els.canvas.width = width;
  els.canvas.height = height;
  const ctx = els.canvas.getContext('2d');
  if (!ctx) {
    showToastNotification('Unable to capture image frame.', 'error');
    return;
  }
  ctx.drawImage(els.video, 0, 0, width, height);

  if (isCanvasBlankOrBlack(els.canvas)) {
    showToastNotification('Captured frame appears unrendered. Please wait a second and capture again.', 'warning');
    return;
  }

  state.dataUrl = els.canvas.toDataURL('image/jpeg', 0.85);
  stopCameraStream(slot);
  updateRegisterSlotUI(slot);
}

function removeSlotPhoto(slot) {
  stopCameraStream(slot);
  registerCameraState[slot].dataUrl = '';
  updateRegisterSlotUI(slot);
}

function setupRegisterCameraControls() {
  ['id', 'selfie'].forEach((slot) => {
    const els = getRegisterSlotElements(slot);
    if (els.startBtn) els.startBtn.addEventListener('click', () => startCameraForSlot(slot));
    if (els.captureBtn) els.captureBtn.addEventListener('click', () => captureFromSlot(slot));
    if (els.retakeBtn) els.retakeBtn.addEventListener('click', () => startCameraForSlot(slot));
    if (els.removeBtn) els.removeBtn.addEventListener('click', () => removeSlotPhoto(slot));
    updateRegisterSlotUI(slot);
  });

  window.addEventListener('beforeunload', stopAllRegisterCameras);
}

function setupRegisterForm() {
  const form = document.getElementById('register-form');
  if (!form) return;

  setupRegisterCameraControls();
  let isSubmitting = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    hideErrorBanner();

    const firstName = (document.getElementById('reg-first-name')?.value || '').trim();
    const lastName = (document.getElementById('reg-last-name')?.value || '').trim();
    const email = (document.getElementById('reg-email')?.value || '').trim().toLowerCase();
    const phone = (document.getElementById('reg-phone')?.value || '').trim();
    const street = (document.getElementById('reg-street')?.value || '').trim();
    const password = document.getElementById('reg-password')?.value || '';
    const confirmPassword = document.getElementById('reg-confirm-password')?.value || '';
    const idPhotoDataUrl = registerCameraState.id.dataUrl || '';
    const selfiePhotoDataUrl = registerCameraState.selfie.dataUrl || '';

    if (!firstName || !lastName) {
      showToastNotification('Please enter both your first name and last name.', 'warning');
      return;
    }
    if (!email || !isValidEmail(email)) {
      showToastNotification('Please enter a valid email address.', 'warning');
      return;
    }
    if (!password || password.length < 8) {
      showToastNotification('Password must be at least 8 characters long.', 'warning');
      return;
    }
    if (password !== confirmPassword) {
      showToastNotification('Passwords do not match. Please verify your password confirmation.', 'error');
      return;
    }
    if (!idPhotoDataUrl) {
      showToastNotification('Please capture a live photo of your Barangay Address ID.', 'warning');
      return;
    }
    if (!selfiePhotoDataUrl) {
      showToastNotification('Please capture a live selfie holding the same ID.', 'warning');
      return;
    }

    isSubmitting = true;
    setRegisterSubmittingState(true);

    try {
      await window.geoSafeStore.registerResident({
        firstName,
        lastName,
        email,
        phone,
        street,
        password,
        idPhotoDataUrl,
        selfiePhotoDataUrl,
      });

      isSubmitting = false;
      setRegisterSubmittingState(false);
      form.reset();
      removeSlotPhoto('id');
      removeSlotPhoto('selfie');

      window.switchAuthTab('login');
      clearLoginFormFields();
      const loginEmailInput = document.getElementById('login-email');
      if (loginEmailInput) loginEmailInput.focus();

      showSuccessBanner('Account successfully created. Please sign in with your email and password.');
    } catch (err) {
      isSubmitting = false;
      setRegisterSubmittingState(false);
      showToastNotification(err.message || 'Failed to create account. Please try again.', 'error');
    }
  });
}
