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
    if (typeof stopAllRegisterCameras === 'function') stopAllRegisterCameras();
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
          body: JSON.stringify({ fullName, email, accountRole, description }),
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

const regIdentityPhotoState = {
  idDataUrl: null,
  selfieDataUrl: null,
  streams: { id: null, selfie: null },
};

function stopCameraStream(slot) {
  const stream = regIdentityPhotoState.streams[slot];
  if (stream && typeof stream.getTracks === 'function') {
    stream.getTracks().forEach((t) => {
      try { t.stop(); } catch (_) {}
    });
  }
  regIdentityPhotoState.streams[slot] = null;
  const video = document.getElementById(`reg-${slot}-video`);
  if (video) {
    video.srcObject = null;
    video.classList.add('hidden');
  }
}

function stopAllRegisterCameras() {
  stopCameraStream('id');
  stopCameraStream('selfie');
}

function updateIdentitySlotUI(slot) {
  const dataUrl = slot === 'id' ? regIdentityPhotoState.idDataUrl : regIdentityPhotoState.selfieDataUrl;
  const isStreaming = Boolean(regIdentityPhotoState.streams[slot]);

  const wrap = document.getElementById(`reg-${slot}-preview-wrap`);
  const video = document.getElementById(`reg-${slot}-video`);
  const img = document.getElementById(`reg-${slot}-img`);
  const badge = document.getElementById(`reg-${slot}-photo-badge`);
  const openBtn = document.getElementById(`btn-${slot}-open-camera`);
  const captureBtn = document.getElementById(`btn-${slot}-capture`);
  const retakeBtn = document.getElementById(`btn-${slot}-retake`);
  const removeBtn = document.getElementById(`btn-${slot}-remove`);

  if (wrap) wrap.classList.toggle('hidden', !isStreaming && !dataUrl);
  if (video) video.classList.toggle('hidden', !isStreaming);
  if (img) {
    if (dataUrl && !isStreaming) {
      img.src = dataUrl;
      img.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
    }
  }

  if (openBtn) openBtn.classList.toggle('hidden', isStreaming || Boolean(dataUrl));
  if (captureBtn) captureBtn.classList.toggle('hidden', !isStreaming);
  if (retakeBtn) retakeBtn.classList.toggle('hidden', isStreaming || !dataUrl);
  if (removeBtn) removeBtn.classList.toggle('hidden', isStreaming || !dataUrl);

  if (badge) {
    if (dataUrl) {
      badge.textContent = 'Captured';
      badge.className = 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800';
    } else if (isStreaming) {
      badge.textContent = 'Camera Active';
      badge.className = 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800';
    } else {
      badge.textContent = 'Required';
      badge.className = 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F1F5F9] text-[#475569]';
    }
  }
}

function resetRegisterIdentityPhotos() {
  stopAllRegisterCameras();
  regIdentityPhotoState.idDataUrl = null;
  regIdentityPhotoState.selfieDataUrl = null;
  const errBox = document.getElementById('reg-camera-error-box');
  if (errBox) {
    errBox.textContent = '';
    errBox.classList.add('hidden');
  }
  updateIdentitySlotUI('id');
  updateIdentitySlotUI('selfie');
}

function setupRegisterIdentityCameras() {
  const errBox = document.getElementById('reg-camera-error-box');

  const showCamError = (msg) => {
    if (errBox) {
      errBox.textContent = msg;
      errBox.classList.remove('hidden');
    }
    showToastNotification(msg, 'warning');
  };

  const clearCamError = () => {
    if (errBox) {
      errBox.textContent = '';
      errBox.classList.add('hidden');
    }
  };

  const startCameraForSlot = async (slot) => {
    clearCamError();
    // Stop other slot camera first so mobile/desktop browsers don't conflict on single-camera devices
    stopAllRegisterCameras();

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      showCamError('Camera API is unavailable in this browser or requires a secure (HTTPS) connection.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: slot === 'selfie' ? 'user' : { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });

      regIdentityPhotoState.streams[slot] = stream;
      const video = document.getElementById(`reg-${slot}-video`);
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      updateIdentitySlotUI(slot);
    } catch (err) {
      stopCameraStream(slot);
      updateIdentitySlotUI(slot);
      const isDenied = err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      showCamError(
        isDenied
          ? 'Camera permission was denied. Please allow camera access in your browser settings to capture your verification photo.'
          : 'Unable to access camera. Please ensure a camera is connected and not in use by another app.'
      );
    }
  };

  const captureFromSlot = (slot) => {
    clearCamError();
    const video = document.getElementById(`reg-${slot}-video`);
    if (!video || !video.videoWidth || !video.videoHeight) {
      showCamError('Camera preview is still loading. Please wait a moment and try again.');
      return;
    }

    const maxDim = 1280;
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if (slot === 'id') {
      regIdentityPhotoState.idDataUrl = dataUrl;
    } else {
      regIdentityPhotoState.selfieDataUrl = dataUrl;
    }

    stopCameraStream(slot);
    updateIdentitySlotUI(slot);
  };

  ['id', 'selfie'].forEach((slot) => {
    const openBtn = document.getElementById(`btn-${slot}-open-camera`);
    const captureBtn = document.getElementById(`btn-${slot}-capture`);
    const retakeBtn = document.getElementById(`btn-${slot}-retake`);
    const removeBtn = document.getElementById(`btn-${slot}-remove`);

    if (openBtn) openBtn.addEventListener('click', () => startCameraForSlot(slot));
    if (captureBtn) captureBtn.addEventListener('click', () => captureFromSlot(slot));
    if (retakeBtn) {
      retakeBtn.addEventListener('click', () => {
        if (slot === 'id') regIdentityPhotoState.idDataUrl = null;
        else regIdentityPhotoState.selfieDataUrl = null;
        startCameraForSlot(slot);
      });
    }
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        stopCameraStream(slot);
        if (slot === 'id') regIdentityPhotoState.idDataUrl = null;
        else regIdentityPhotoState.selfieDataUrl = null;
        updateIdentitySlotUI(slot);
      });
    }
  });

  window.addEventListener('beforeunload', stopAllRegisterCameras);
  window.addEventListener('pagehide', stopAllRegisterCameras);
}

function setupRegisterForm() {
  const form = document.getElementById('register-form');
  if (!form) return;

  let currentWizardStep = 1;
  let isSubmitting = false;

  const wizardErrBox = document.getElementById('reg-wizard-error-box');
  const showWizardError = (msg) => {
    if (wizardErrBox) {
      if (!msg) {
        wizardErrBox.textContent = '';
        wizardErrBox.classList.add('hidden');
      } else {
        wizardErrBox.textContent = msg;
        wizardErrBox.classList.remove('hidden');
      }
    }
    if (msg) showToastNotification(msg, 'warning');
  };

  const showWizardStep = (step) => {
    currentWizardStep = step;
    showWizardError(null);
    if (step !== 3 && typeof stopAllRegisterCameras === 'function') {
      stopAllRegisterCameras();
      updateIdentitySlotUI('id');
      updateIdentitySlotUI('selfie');
    }
    [1, 2, 3].forEach((n) => {
      const panel = document.getElementById(`reg-wizard-step-${n}`);
      const ind = document.getElementById(`reg-step-ind-${n}`);
      if (panel) panel.classList.toggle('hidden', n !== step);
      if (ind) {
        if (n === step) {
          ind.className = 'px-2 py-1.5 rounded-[4px] text-center text-[11px] font-bold bg-[#0B203B] text-white transition-colors';
        } else if (n < step) {
          ind.className = 'px-2 py-1.5 rounded-[4px] text-center text-[11px] font-semibold bg-emerald-100 text-emerald-800 transition-colors';
        } else {
          ind.className = 'px-2 py-1.5 rounded-[4px] text-center text-[11px] font-semibold text-[#64748B] transition-colors';
        }
      }
    });
  };

  const step1NextBtn = document.getElementById('btn-reg-step1-next');
  const step2BackBtn = document.getElementById('btn-reg-step2-back');
  const step2NextBtn = document.getElementById('btn-reg-step2-next');
  const step3BackBtn = document.getElementById('btn-reg-step3-back');

  if (step1NextBtn) {
    step1NextBtn.addEventListener('click', () => {
      const firstName = (document.getElementById('reg-first-name')?.value || '').trim();
      const lastName = (document.getElementById('reg-last-name')?.value || '').trim();
      if (!firstName || !lastName) {
        showWizardError('Please enter both your first name and last name.');
        return;
      }
      showWizardStep(2);
      const emailEl = document.getElementById('reg-email');
      if (emailEl && !emailEl.value) emailEl.focus();
    });
  }

  if (step2BackBtn) {
    step2BackBtn.addEventListener('click', () => showWizardStep(1));
  }

  if (step2NextBtn) {
    step2NextBtn.addEventListener('click', () => {
      const email = (document.getElementById('reg-email')?.value || '').trim().toLowerCase();
      const password = document.getElementById('reg-password')?.value || '';
      const confirmPassword = document.getElementById('reg-confirm-password')?.value || '';
      if (!email || !isValidEmail(email)) {
        showWizardError('Please enter a valid email address.');
        return;
      }
      if (!password || password.length < 8) {
        showWizardError('Password must be at least 8 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        showWizardError('Passwords do not match. Please verify your password confirmation.');
        return;
      }
      showWizardStep(3);
    });
  }

  if (step3BackBtn) {
    step3BackBtn.addEventListener('click', () => showWizardStep(2));
  }

  setupRegisterIdentityCameras();
  showWizardStep(1);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    hideErrorBanner();
    showWizardError(null);

    const firstName = (document.getElementById('reg-first-name')?.value || '').trim();
    const lastName = (document.getElementById('reg-last-name')?.value || '').trim();
    const email = (document.getElementById('reg-email')?.value || '').trim().toLowerCase();
    const phone = (document.getElementById('reg-phone')?.value || '').trim();
    const street = (document.getElementById('reg-street')?.value || '').trim();
    const password = document.getElementById('reg-password')?.value || '';
    const confirmPassword = document.getElementById('reg-confirm-password')?.value || '';

    if (!firstName || !lastName) {
      showWizardStep(1);
      showWizardError('Please enter both your first name and last name.');
      return;
    }
    if (!email || !isValidEmail(email) || !password || password.length < 8 || password !== confirmPassword) {
      showWizardStep(2);
      showWizardError('Please check your email and password details.');
      return;
    }
    if (!regIdentityPhotoState.idDataUrl) {
      showWizardError('Please capture a clear photo of your Barangay Address ID.');
      return;
    }
    if (!regIdentityPhotoState.selfieDataUrl) {
      showWizardError('Please capture a selfie holding your Barangay Address ID.');
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
        idPhotoDataUrl: regIdentityPhotoState.idDataUrl,
        selfiePhotoDataUrl: regIdentityPhotoState.selfieDataUrl,
      });

      isSubmitting = false;
      setRegisterSubmittingState(false);
      form.reset();
      resetRegisterIdentityPhotos();
      showWizardStep(1);

      // Switch to Sign In tab with empty fields requiring manual credential entry
      window.switchAuthTab('login');
      clearLoginFormFields();
      const loginEmailInput = document.getElementById('login-email');
      if (loginEmailInput) loginEmailInput.focus();

      showSuccessBanner('Application submitted! Your account is awaiting Administrator verification. You will be able to sign in once approved.');
    } catch (err) {
      isSubmitting = false;
      setRegisterSubmittingState(false);
      showWizardError(err.message || 'Failed to submit verification application. Please try again.');
    }
  });
}
