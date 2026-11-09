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
  await checkExistingServerSession();
  setupPasswordVisibilityToggle();
  setupForgotPasswordHandler();
  setupLoginForm();
  setupRegisterForm();

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
      tabRegister.className = 'py-2 px-3 rounded-xl text-xs font-black transition-all bg-[#F5B900] text-[#202020] shadow-subtle';
    }
    if (tabLogin) {
      tabLogin.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all text-[#777777] hover:text-[#202020]';
    }
    if (titleEl) titleEl.textContent = 'Create Resident Account';
    if (subEl) {
      subEl.textContent = 'Register as a Barangay Bayanan resident to submit incident reports, request emergency rescue, and manage family safety.';
    }
    if (headerSwitchBtn) {
      headerSwitchBtn.innerHTML = '<span>Back to Sign In</span>';
      headerSwitchBtn.setAttribute('onclick', "switchAuthTab('login')");
    }
  } else {
    registerForm?.classList.add('hidden');
    loginForm?.classList.remove('hidden');
    if (tabLogin) {
      tabLogin.className = 'py-2 px-3 rounded-xl text-xs font-black transition-all bg-[#F5B900] text-[#202020] shadow-subtle';
    }
    if (tabRegister) {
      tabRegister.className = 'py-2 px-3 rounded-xl text-xs font-bold transition-all text-[#777777] hover:text-[#202020]';
    }
    if (titleEl) titleEl.textContent = 'Sign In to GeoSafe';
    if (subEl) {
      subEl.textContent = 'Enter your registered email and password. Your portal is determined automatically by your verified account role.';
    }
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
  if (!forgotBtn) return;

  forgotBtn.addEventListener('click', () => {
    showErrorBanner(
      'For password resets or credential recovery, please contact the Barangay Bayanan Emergency Operations Center (EOC) administrator.'
    );
  });
}

function showErrorBanner(message) {
  const errorBanner = document.getElementById('login-error-banner');
  const errorText = document.getElementById('login-error-text');
  const successBanner = document.getElementById('login-success-banner');

  if (successBanner) successBanner.classList.add('hidden');
  if (errorText) errorText.textContent = message;
  if (errorBanner) errorBanner.classList.remove('hidden');
}

function showSuccessBanner(message) {
  const errorBanner = document.getElementById('login-error-banner');
  const successBanner = document.getElementById('login-success-banner');
  const successText = document.getElementById('login-success-text');

  if (errorBanner) errorBanner.classList.add('hidden');
  if (successText) successText.textContent = message;
  if (successBanner) successBanner.classList.remove('hidden');
}

function hideErrorBanner() {
  const errorBanner = document.getElementById('login-error-banner');
  if (errorBanner) errorBanner.classList.add('hidden');
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
    if (btnText) btnText.textContent = 'Verifying Credentials...';
    if (btnArrow) btnArrow.classList.add('hidden');
    if (btnSpinner) btnSpinner.classList.remove('hidden');
  } else {
    submitBtn.classList.remove('opacity-80', 'cursor-wait');
    if (btnText) btnText.textContent = 'Sign In to GeoSafe';
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

function setupLoginForm() {
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const rememberInput = document.getElementById('login-remember');
  const emailMsg = document.getElementById('email-validation-msg');
  const passwordMsg = document.getElementById('password-validation-msg');

  if (!form || !emailInput || !passwordInput) return;

  emailInput.addEventListener('input', () => {
    emailMsg?.classList.add('hidden');
    hideErrorBanner();
  });

  passwordInput.addEventListener('input', () => {
    passwordMsg?.classList.add('hidden');
    hideErrorBanner();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideErrorBanner();

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const rememberMe = Boolean(rememberInput && rememberInput.checked);

    let hasValidationError = false;
    if (!email || !isValidEmail(email)) {
      emailMsg?.classList.remove('hidden');
      hasValidationError = true;
    } else {
      emailMsg?.classList.add('hidden');
    }

    if (!password || password.length < 1) {
      passwordMsg?.classList.remove('hidden');
      hasValidationError = true;
    } else {
      passwordMsg?.classList.add('hidden');
    }

    if (hasValidationError) return;

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

      showSuccessBanner(`Authenticated as ${authResult.user?.name || email}. Redirecting to ${roleLabel}...`);

      setTimeout(() => {
        redirectByVerifiedRole(verifiedRole);
      }, 350);
    } catch (err) {
      setSubmittingState(false);
      showErrorBanner(err.message || 'Authentication failed. Please check your email and password.');
    }
  });
}

function setupRegisterForm() {
  const form = document.getElementById('register-form');
  if (!form) return;

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
      showErrorBanner('Please enter both your first name and last name.');
      return;
    }
    if (!email || !isValidEmail(email)) {
      showErrorBanner('Please enter a valid email address.');
      return;
    }
    if (!password || password.length < 8) {
      showErrorBanner('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      showErrorBanner('Passwords do not match. Please verify your password confirmation.');
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
        password
      });

      setRegisterSubmittingState(false);
      form.reset();

      // Switch to Sign In tab and prefill email address as required
      window.switchAuthTab('login');
      const loginEmailInput = document.getElementById('login-email');
      const loginPassInput = document.getElementById('login-password');
      if (loginEmailInput) loginEmailInput.value = email;
      if (loginPassInput) loginPassInput.focus();

      showSuccessBanner('Resident account created in MySQL! Please sign in with your password below.');
    } catch (err) {
      setRegisterSubmittingState(false);
      showErrorBanner(err.message || 'Registration failed. Please try again.');
    }
  });
}
