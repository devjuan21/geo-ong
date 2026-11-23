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
  if (!forgotBtn) return;
  if (!modal) {
    forgotBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = 'forgot-password.html';
    });
    return;
  }

  const closeBtn = document.getElementById('fp-close-btn');
  const doneBtn = document.getElementById('fp-done-btn');
  const errorBox = document.getElementById('fp-error-box');
  const infoBox = document.getElementById('fp-info-box');
  const stepEmail = document.getElementById('fp-step-email');
  const stepOtp = document.getElementById('fp-step-otp');
  const stepReset = document.getElementById('fp-step-reset');
  const stepSuccess = document.getElementById('fp-step-success');

  const emailInput = document.getElementById('fp-email-input');
  const otpEmailLabel = document.getElementById('fp-otp-email-label');
  const otpInput = document.getElementById('fp-otp-input');
  const expiryLabel = document.getElementById('fp-expiry-label');
  const resendBtn = document.getElementById('fp-resend-otp-btn');
  const changeEmailBtn = document.getElementById('fp-change-email-btn');
  const newPassInput = document.getElementById('fp-new-password');
  const confirmPassInput = document.getElementById('fp-confirm-password');

  let activeEmail = '';
  let activeResetToken = '';
  let cooldownTimer = null;
  let expiryTimer = null;

  const clearTimers = () => {
    if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
    if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
  };

  const showMsg = (type, msg) => {
    if (errorBox) errorBox.classList.add('hidden');
    if (infoBox) infoBox.classList.add('hidden');
    if (type === 'error' && errorBox) {
      errorBox.textContent = msg;
      errorBox.classList.remove('hidden');
    } else if (type === 'info' && infoBox) {
      infoBox.textContent = msg;
      infoBox.classList.remove('hidden');
    }
  };

  const showStep = (stepName) => {
    [stepEmail, stepOtp, stepReset, stepSuccess].forEach((el) => el && el.classList.add('hidden'));
    if (stepName === 'email' && stepEmail) stepEmail.classList.remove('hidden');
    if (stepName === 'otp' && stepOtp) stepOtp.classList.remove('hidden');
    if (stepName === 'reset' && stepReset) stepReset.classList.remove('hidden');
    if (stepName === 'success' && stepSuccess) stepSuccess.classList.remove('hidden');
  };

  const startTimers = (cooldownSec = 60, expirySec = 300) => {
    clearTimers();
    let cd = cooldownSec;
    let exp = expirySec;
    const renderCd = () => {
      if (!resendBtn) return;
      if (cd > 0) {
        resendBtn.disabled = true;
        resendBtn.textContent = `Resend code (${cd}s)`;
      } else {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend code';
      }
    };
    const renderExp = () => {
      if (!expiryLabel) return;
      if (exp <= 0) {
        expiryLabel.textContent = 'Code expired';
        expiryLabel.className = 'text-[11px] font-semibold text-[#DC2626]';
      } else {
        const m = String(Math.floor(exp / 60)).padStart(2, '0');
        const s = String(exp % 60).padStart(2, '0');
        expiryLabel.textContent = `Expires in ${m}:${s}`;
        expiryLabel.className = 'text-[11px] font-medium text-[#64748B]';
      }
    };
    renderCd();
    renderExp();
    cooldownTimer = setInterval(() => {
      cd -= 1;
      renderCd();
      if (cd <= 0) { clearInterval(cooldownTimer); cooldownTimer = null; }
    }, 1000);
    expiryTimer = setInterval(() => {
      exp -= 1;
      renderExp();
      if (exp <= 0) { clearInterval(expiryTimer); expiryTimer = null; }
    }, 1000);
  };

  const openModal = () => {
    clearTimers();
    activeResetToken = '';
    showMsg(null, '');
    showStep('email');
    if (otpInput) otpInput.value = '';
    if (newPassInput) newPassInput.value = '';
    if (confirmPassInput) confirmPassInput.value = '';
    const loginEmail = document.getElementById('login-email');
    if (emailInput && loginEmail && loginEmail.value.trim()) {
      emailInput.value = loginEmail.value.trim();
    }
    modal.classList.remove('hidden');
    if (emailInput) emailInput.focus();
  };

  const closeModal = () => {
    clearTimers();
    modal.classList.add('hidden');
  };

  forgotBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (doneBtn) doneBtn.addEventListener('click', () => {
    closeModal();
    const loginEmail = document.getElementById('login-email');
    if (loginEmail && activeEmail) loginEmail.value = activeEmail;
    const loginPwd = document.getElementById('login-password');
    if (loginPwd) { loginPwd.value = ''; loginPwd.focus(); }
  });

  document.querySelectorAll('[data-fp-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.getAttribute('data-fp-toggle'));
      if (!target) return;
      target.type = target.type === 'password' ? 'text' : 'password';
    });
  });

  const requestOtp = async (email, triggerBtn) => {
    showMsg(null, '');
    if (triggerBtn) triggerBtn.disabled = true;
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMsg('error', data.error || 'Unable to send verification code.');
        if (res.status === 429 && data.retryAfterSec) {
          startTimers(Number(data.retryAfterSec), 300);
        }
        return false;
      }
      activeEmail = email;
      if (otpEmailLabel) otpEmailLabel.textContent = email;
      showStep('otp');
      showMsg('info', data.message || 'If an account exists for this email address, a 6-digit verification code has been sent.');
      startTimers(Number(data.resendCooldownSeconds || 60), Number(data.expiresInSeconds || 300));
      if (otpInput) { otpInput.value = ''; otpInput.focus(); }
      return true;
    } catch (_) {
      showMsg('error', 'Network error contacting GeoSafe server. Please try again.');
      return false;
    } finally {
      if (triggerBtn) triggerBtn.disabled = false;
    }
  };

  if (stepEmail) {
    stepEmail.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = String(emailInput ? emailInput.value : '').trim().toLowerCase();
      if (!isValidEmail(email)) {
        showMsg('error', 'Please enter a valid email address.');
        return;
      }
      await requestOtp(email, document.getElementById('fp-send-otp-btn'));
    });
  }

  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      if (!activeEmail || resendBtn.disabled) return;
      await requestOtp(activeEmail, resendBtn);
    });
  }

  if (changeEmailBtn) {
    changeEmailBtn.addEventListener('click', () => {
      clearTimers();
      showMsg(null, '');
      showStep('email');
      if (emailInput) emailInput.focus();
    });
  }

  if (stepOtp) {
    stepOtp.addEventListener('submit', async (e) => {
      e.preventDefault();
      showMsg(null, '');
      const otp = String(otpInput ? otpInput.value : '').trim();
      if (!/^\d{6}$/.test(otp)) {
        showMsg('error', 'Please enter the 6-digit numeric verification code.');
        return;
      }
      const btn = document.getElementById('fp-verify-otp-btn');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: activeEmail, otp }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.verified || !data.resetToken) {
          showMsg('error', data.error || 'Invalid or expired verification code.');
          return;
        }
        clearTimers();
        activeResetToken = data.resetToken;
        showStep('reset');
        showMsg('info', 'Code verified. Please enter your new password.');
        if (newPassInput) newPassInput.focus();
      } catch (_) {
        showMsg('error', 'Network error verifying code. Please try again.');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  if (stepReset) {
    stepReset.addEventListener('submit', async (e) => {
      e.preventDefault();
      showMsg(null, '');
      const newPassword = String(newPassInput ? newPassInput.value : '');
      const confirmPassword = String(confirmPassInput ? confirmPassInput.value : '');
      if (newPassword.length < 8) {
        showMsg('error', 'New password must be at least 8 characters long.');
        return;
      }
      if (newPassword !== confirmPassword) {
        showMsg('error', 'New password and confirmation do not match.');
        return;
      }
      const btn = document.getElementById('fp-reset-submit-btn');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resetToken: activeResetToken, newPassword, confirmPassword }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showMsg('error', data.error || 'Unable to reset password.');
          return;
        }
        activeResetToken = '';
        showMsg(null, '');
        showStep('success');
      } catch (_) {
        showMsg('error', 'Network error updating password. Please try again.');
      } finally {
        if (btn) btn.disabled = false;
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

const regLocationState = {
  attempted: false,
  status: null,
  verificationToken: null,
  accuracy: null,
};

function renderLocationVerificationStatus({ status, message, accuracy, accuracyThresholdMeters }) {
  const box = document.getElementById('reg-location-status-box');
  const badge = document.getElementById('reg-location-status-badge');
  const msgEl = document.getElementById('reg-location-status-message');
  const fallbackEl = document.getElementById('reg-location-admin-fallback');
  const accEl = document.getElementById('reg-location-accuracy-label');
  const btnText = document.getElementById('btn-verify-location-text');

  if (!box || !badge || !msgEl) return;

  box.classList.remove(
    'hidden',
    'bg-emerald-50', 'border-emerald-200',
    'bg-amber-50', 'border-amber-200',
    'bg-rose-50', 'border-rose-200',
    'bg-slate-50', 'border-slate-200'
  );
  badge.className = 'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold';

  const statusMeta = {
    verified: {
      label: 'Verified',
      boxCls: ['bg-emerald-50', 'border-emerald-200'],
      badgeCls: ['bg-emerald-100', 'text-emerald-800', 'border', 'border-emerald-300'],
      showFallback: false,
      btnLabel: 'Re-verify Location',
    },
    outside_boundary: {
      label: 'Outside Boundary',
      boxCls: ['bg-amber-50', 'border-amber-200'],
      badgeCls: ['bg-amber-100', 'text-amber-800', 'border', 'border-amber-300'],
      showFallback: true,
      btnLabel: 'Retry Location Verification',
    },
    pending_review: {
      label: 'Pending Review',
      boxCls: ['bg-amber-50', 'border-amber-200'],
      badgeCls: ['bg-amber-100', 'text-amber-800', 'border', 'border-amber-300'],
      showFallback: true,
      btnLabel: 'Retry Location Verification',
    },
    gps_denied: {
      label: 'GPS Denied',
      boxCls: ['bg-rose-50', 'border-rose-200'],
      badgeCls: ['bg-rose-100', 'text-rose-800', 'border', 'border-rose-300'],
      showFallback: true,
      btnLabel: 'Retry Location Verification',
    },
    gps_unavailable: {
      label: 'GPS Unavailable',
      boxCls: ['bg-slate-50', 'border-slate-200'],
      badgeCls: ['bg-slate-200', 'text-slate-800', 'border', 'border-slate-300'],
      showFallback: true,
      btnLabel: 'Retry Location Verification',
    },
    retry_required: {
      label: 'Retry Required',
      boxCls: ['bg-amber-50', 'border-amber-200'],
      badgeCls: ['bg-amber-100', 'text-amber-800', 'border', 'border-amber-300'],
      showFallback: true,
      btnLabel: 'Retry Location Verification',
    },
  };

  const meta = statusMeta[status] || statusMeta.pending_review;
  box.classList.add(...meta.boxCls);
  badge.classList.add(...meta.badgeCls);
  badge.textContent = meta.label;
  msgEl.textContent = message || '';

  if (fallbackEl) {
    fallbackEl.classList.toggle('hidden', !meta.showFallback);
  }
  if (accEl) {
    if (typeof accuracy === 'number' && Number.isFinite(accuracy)) {
      const threshText = accuracyThresholdMeters ? ` (threshold <= ${accuracyThresholdMeters}m)` : '';
      accEl.textContent = `GPS Accuracy: +/-${Math.round(accuracy)}m${threshText}`;
      accEl.classList.remove('hidden');
    } else {
      accEl.classList.add('hidden');
    }
  }
  if (btnText) {
    btnText.textContent = meta.btnLabel;
  }
}

function resetRegisterLocationState() {
  regLocationState.attempted = false;
  regLocationState.status = null;
  regLocationState.verificationToken = null;
  regLocationState.accuracy = null;

  const box = document.getElementById('reg-location-status-box');
  const accEl = document.getElementById('reg-location-accuracy-label');
  const btnText = document.getElementById('btn-verify-location-text');
  if (box) box.classList.add('hidden');
  if (accEl) accEl.classList.add('hidden');
  if (btnText) btnText.textContent = 'Verify My Location';
}

function setupRegisterLocationVerification() {
  const verifyBtn = document.getElementById('btn-verify-location');
  if (!verifyBtn) return;

  // Never request geolocation on page load; only on explicit click.
  verifyBtn.addEventListener('click', async () => {
    const btnText = document.getElementById('btn-verify-location-text');
    verifyBtn.disabled = true;
    if (btnText) btnText.textContent = 'Checking Location...';

    const submitBackendEvaluation = async (payload) => {
      try {
        const result = await window.geoSafeStore.verifyRegistrationLocation(payload);
        regLocationState.attempted = true;
        regLocationState.status = result.status;
        regLocationState.verificationToken = result.verificationToken || null;
        regLocationState.accuracy = result.accuracy ?? null;
        renderLocationVerificationStatus(result);
      } catch (err) {
        regLocationState.attempted = true;
        regLocationState.status = 'gps_unavailable';
        regLocationState.verificationToken = null;
        renderLocationVerificationStatus({
          status: 'gps_unavailable',
          message: err.message || 'Unable to verify location with the server. Please try again.',
        });
      } finally {
        verifyBtn.disabled = false;
      }
    };

    // Browser geolocation requires a secure context (HTTPS or localhost)
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      await submitBackendEvaluation({ gpsErrorStatus: 'gps_unavailable' });
      const msgEl = document.getElementById('reg-location-status-message');
      if (msgEl) {
        msgEl.textContent = 'Browser geolocation is blocked because this connection is not secure (HTTPS required on non-localhost devices). You can still register for Administrator review.';
      }
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      await submitBackendEvaluation({ gpsErrorStatus: 'gps_unavailable' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await submitBackendEvaluation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      async (err) => {
        const isDenied = err && err.code === 1; // PERMISSION_DENIED
        await submitBackendEvaluation({
          gpsErrorStatus: isDenied ? 'gps_denied' : 'gps_unavailable',
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  });
}

function setupRegisterForm() {
  const form = document.getElementById('register-form');
  if (!form) return;

  setupRegisterLocationVerification();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideErrorBanner();

    const firstName = (document.getElementById('reg-first-name')?.value || '').trim();
    const lastName = (document.getElementById('reg-last-name')?.value || '').trim();
    const email = (document.getElementById('reg-email')?.value || '').trim();
    const phone = (document.getElementById('reg-phone')?.value || '').trim();
    const street = (document.getElementById('reg-street')?.value || '').trim();
    const password = document.getElementById('reg-password')?.value || '';
    const confirmPassword = document.getElementById('reg-confirm-password')?.value || '';

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
    if (!regLocationState.attempted) {
      showToastNotification('Please click "Verify My Location" before creating your account.', 'warning');
      return;
    }

    setRegisterSubmittingState(true);

    try {
      await window.geoSafeStore.registerResident({
        firstName,
        lastName,
        email,
        phone,
        street,
        password,
        locationVerificationToken: regLocationState.verificationToken,
        locationStatus: regLocationState.status,
      });

      setRegisterSubmittingState(false);
      form.reset();
      resetRegisterLocationState();

      // Switch to Sign In tab with empty fields requiring manual credential entry
      window.switchAuthTab('login');
      clearLoginFormFields();
      const loginEmailInput = document.getElementById('login-email');
      if (loginEmailInput) loginEmailInput.focus();

      showSuccessBanner('Account successfully created. Please sign in with your email and password.');
    } catch (err) {
      setRegisterSubmittingState(false);
      showToastNotification(err.message || 'Failed to create account. Please try again.', 'error');
    }
  });
}
