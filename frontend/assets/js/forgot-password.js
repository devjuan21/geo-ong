document.addEventListener('DOMContentLoaded', () => {
  const emailForm = document.getElementById('step-email-form');
  const otpForm = document.getElementById('step-otp-form');
  const resetForm = document.getElementById('step-reset-form');
  const successBox = document.getElementById('step-success-box');
  const successMsgEl = document.getElementById('step-success-message');
  const subtitleEl = document.getElementById('recovery-subtitle');
  const errorBox = document.getElementById('recovery-error-box');
  const infoBox = document.getElementById('recovery-info-box');

  const emailInput = document.getElementById('forgot-email');
  const otpInput = document.getElementById('otp-code-input');
  const newPassInput = document.getElementById('otp-new-password');
  const confirmPassInput = document.getElementById('otp-confirm-password');
  const resendBtn = document.getElementById('resend-otp-btn');
  const changeEmailBtn = document.getElementById('change-email-btn');
  const reqMinEl = document.getElementById('req-min-length');
  const reqMatchEl = document.getElementById('req-match');

  let activeEmail = '';
  let verifiedResetToken = '';
  let cooldownTimer = null;

  const clearAlerts = () => {
    if (errorBox) errorBox.classList.add('hidden');
    if (infoBox) infoBox.classList.add('hidden');
  };

  const showError = (msg) => {
    if (infoBox) infoBox.classList.add('hidden');
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.classList.remove('hidden');
    }
  };

  const showInfo = (msg) => {
    if (errorBox) errorBox.classList.add('hidden');
    if (infoBox) {
      infoBox.textContent = msg;
      infoBox.classList.remove('hidden');
    }
  };

  const setBtnLoading = (btnId, textId, spinnerId, loading, idleText, busyText) => {
    const btn = document.getElementById(btnId);
    const txt = document.getElementById(textId);
    const spin = document.getElementById(spinnerId);
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle('opacity-80', loading);
    btn.classList.toggle('cursor-wait', loading);
    if (txt) txt.textContent = loading ? busyText : idleText;
    if (spin) spin.classList.toggle('hidden', !loading);
  };

  const showStep = (step) => {
    [emailForm, otpForm, resetForm, successBox].forEach((el) => el && el.classList.add('hidden'));
    if (step === 'email') {
      emailForm && emailForm.classList.remove('hidden');
      if (subtitleEl) subtitleEl.textContent = 'Enter your registered email address to receive a 6-digit verification code.';
    } else if (step === 'otp') {
      otpForm && otpForm.classList.remove('hidden');
      if (subtitleEl) subtitleEl.textContent = `Enter the 6-digit verification code sent to ${activeEmail}.`;
      if (otpInput) otpInput.focus();
    } else if (step === 'reset') {
      resetForm && resetForm.classList.remove('hidden');
      if (subtitleEl) subtitleEl.textContent = 'Create a new password for your GeoSafe account.';
      if (newPassInput) newPassInput.focus();
    } else if (step === 'success') {
      successBox && successBox.classList.remove('hidden');
      if (subtitleEl) subtitleEl.textContent = 'Your password has been updated.';
    }
  };

  const startResendCooldown = (seconds = 60) => {
    if (cooldownTimer) clearInterval(cooldownTimer);
    let remaining = Math.max(1, Number(seconds) || 60);
    const updateLabel = () => {
      if (!resendBtn) return;
      if (remaining > 0) {
        resendBtn.disabled = true;
        resendBtn.textContent = `Resend in ${remaining}s`;
      } else {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend Code';
        clearInterval(cooldownTimer);
        cooldownTimer = null;
      }
    };
    updateLabel();
    cooldownTimer = setInterval(() => {
      remaining -= 1;
      updateLabel();
    }, 1000);
  };

  document.querySelectorAll('[data-toggle-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('data-toggle-target'));
      if (!input) return;
      const isPwd = input.type === 'password';
      input.type = isPwd ? 'text' : 'password';
      btn.setAttribute('aria-label', isPwd ? 'Hide password' : 'Show password');
    });
  });

  if (otpInput) {
    otpInput.addEventListener('input', () => {
      otpInput.value = otpInput.value.replace(/\D/g, '').slice(0, 6);
    });
  }

  const updatePolicyFeedback = () => {
    const p1 = String(newPassInput ? newPassInput.value : '');
    const p2 = String(confirmPassInput ? confirmPassInput.value : '');
    if (reqMinEl) reqMinEl.className = p1.length >= 8 ? 'text-[#0D9488] font-semibold' : '';
    if (reqMatchEl) reqMatchEl.className = p1.length > 0 && p1 === p2 ? 'text-[#0D9488] font-semibold' : '';
  };
  if (newPassInput) newPassInput.addEventListener('input', updatePolicyFeedback);
  if (confirmPassInput) confirmPassInput.addEventListener('input', updatePolicyFeedback);

  const requestOtpForEmail = async (email) => {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  if (emailForm) {
    emailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlerts();
      const email = String(emailInput ? emailInput.value : '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('Please enter a valid email address.');
        if (emailInput) emailInput.focus();
        return;
      }

      setBtnLoading('forgot-submit-btn', 'forgot-btn-text', 'forgot-btn-spinner', true, 'Send Verification Code', 'Sending...');
      try {
        const { res, data } = await requestOtpForEmail(email);
        if (!res.ok) {
          showError(data.error || 'Unable to send verification code.');
          if (res.status === 429 && data.retryAfterSeconds) {
            activeEmail = email;
            showStep('otp');
            startResendCooldown(data.retryAfterSeconds);
          }
          return;
        }
        activeEmail = email;
        showStep('otp');
        showInfo(data.message || 'If an account exists for this email address, a 6-digit verification code will be sent.');
        startResendCooldown(data.cooldownSeconds || 60);
      } catch (_) {
        showError('Network error while contacting the GeoSafe server. Please try again.');
      } finally {
        setBtnLoading('forgot-submit-btn', 'forgot-btn-text', 'forgot-btn-spinner', false, 'Send Verification Code', 'Sending...');
      }
    });
  }

  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      if (!activeEmail || resendBtn.disabled) return;
      clearAlerts();
      resendBtn.disabled = true;
      resendBtn.textContent = 'Sending...';
      try {
        const { res, data } = await requestOtpForEmail(activeEmail);
        if (!res.ok) {
          showError(data.error || 'Unable to resend verification code.');
          startResendCooldown(data.retryAfterSeconds || 60);
          return;
        }
        showInfo('A new 6-digit verification code has been sent if the account is registered.');
        startResendCooldown(data.cooldownSeconds || 60);
      } catch (_) {
        showError('Network error while resending code.');
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend Code';
      }
    });
  }

  if (changeEmailBtn) {
    changeEmailBtn.addEventListener('click', () => {
      clearAlerts();
      if (cooldownTimer) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
      }
      if (otpInput) otpInput.value = '';
      showStep('email');
    });
  }

  if (otpForm) {
    otpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlerts();
      const otp = String(otpInput ? otpInput.value : '').trim();
      if (!/^\d{6}$/.test(otp)) {
        showError('Please enter the 6-digit verification code.');
        if (otpInput) otpInput.focus();
        return;
      }

      setBtnLoading('verify-otp-btn', 'verify-otp-text', 'verify-otp-spinner', true, 'Verify Code', 'Verifying...');
      try {
        const res = await fetch('/api/auth/verify-reset-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: activeEmail, otp }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.verified || !data.resetToken) {
          showError(data.error || 'Invalid or expired verification code.');
          return;
        }
        verifiedResetToken = data.resetToken;
        if (cooldownTimer) {
          clearInterval(cooldownTimer);
          cooldownTimer = null;
        }
        showStep('reset');
        showInfo('Code verified. Enter your new password below.');
      } catch (_) {
        showError('Network error while verifying code. Please try again.');
      } finally {
        setBtnLoading('verify-otp-btn', 'verify-otp-text', 'verify-otp-spinner', false, 'Verify Code', 'Verifying...');
      }
    });
  }

  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlerts();
      const newPassword = String(newPassInput ? newPassInput.value : '');
      const confirmPassword = String(confirmPassInput ? confirmPassInput.value : '');

      if (newPassword.length < 8) {
        showError('New password must be at least 8 characters long.');
        if (newPassInput) newPassInput.focus();
        return;
      }
      if (newPassword !== confirmPassword) {
        showError('New password and confirmation do not match.');
        if (confirmPassInput) confirmPassInput.focus();
        return;
      }

      setBtnLoading('reset-submit-btn', 'reset-btn-text', 'reset-btn-spinner', true, 'Submit New Password', 'Updating...');
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resetToken: verifiedResetToken,
            newPassword,
            confirmPassword,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(data.error || 'Unable to reset password.');
          return;
        }
        verifiedResetToken = '';
        clearAlerts();
        if (successMsgEl && data.message) successMsgEl.textContent = data.message;
        showStep('success');
      } catch (_) {
        showError('Network error while updating password. Please try again.');
      } finally {
        setBtnLoading('reset-submit-btn', 'reset-btn-text', 'reset-btn-spinner', false, 'Submit New Password', 'Updating...');
      }
    });
  }
});
