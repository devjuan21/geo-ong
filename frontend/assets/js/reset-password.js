document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const token = String(params.get('token') || '').trim();

  const verifyingEl = document.getElementById('reset-verifying-state');
  const invalidEl = document.getElementById('reset-invalid-state');
  const invalidMsgEl = document.getElementById('reset-invalid-message');
  const successEl = document.getElementById('reset-success-state');
  const successMsgEl = document.getElementById('reset-success-message');
  const form = document.getElementById('reset-password-form');
  const newPassInput = document.getElementById('reset-new-password');
  const confirmPassInput = document.getElementById('reset-confirm-password');
  const errorBox = document.getElementById('reset-form-error');
  const submitBtn = document.getElementById('reset-submit-btn');
  const btnText = document.getElementById('reset-btn-text');
  const btnSpinner = document.getElementById('reset-btn-spinner');
  const reqMinEl = document.getElementById('req-min-length');
  const reqMatchEl = document.getElementById('req-match');

  document.querySelectorAll('[data-toggle-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle-target');
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  });

  const updatePolicyFeedback = () => {
    const p1 = String(newPassInput ? newPassInput.value : '');
    const p2 = String(confirmPassInput ? confirmPassInput.value : '');
    if (reqMinEl) {
      reqMinEl.className = p1.length >= 8 ? 'text-[#0D9488] font-semibold' : '';
    }
    if (reqMatchEl) {
      reqMatchEl.className = p1.length > 0 && p1 === p2 ? 'text-[#0D9488] font-semibold' : '';
    }
  };
  if (newPassInput) newPassInput.addEventListener('input', updatePolicyFeedback);
  if (confirmPassInput) confirmPassInput.addEventListener('input', updatePolicyFeedback);

  const showInvalid = (msg) => {
    if (verifyingEl) verifyingEl.classList.add('hidden');
    if (form) form.classList.add('hidden');
    if (invalidMsgEl) invalidMsgEl.textContent = msg || 'This password reset link is invalid or has expired.';
    if (invalidEl) invalidEl.classList.remove('hidden');
  };

  if (!token || token.length < 32) {
    showInvalid('This password reset link is missing or invalid.');
    return;
  }

  try {
    const verifyRes = await fetch(`/api/auth/reset-password/verify?token=${encodeURIComponent(token)}`);
    const verifyData = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok || !verifyData.valid) {
      showInvalid(verifyData.error || 'This password reset link is invalid, expired, or has already been used.');
      return;
    }
    if (verifyingEl) verifyingEl.classList.add('hidden');
    if (form) form.classList.remove('hidden');
  } catch (_) {
    showInvalid('Unable to verify your password reset link. Please try again.');
    return;
  }

  const setLoading = (loading) => {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    submitBtn.classList.toggle('opacity-80', loading);
    submitBtn.classList.toggle('cursor-wait', loading);
    if (btnText) btnText.textContent = loading ? 'Updating Password...' : 'Submit New Password';
    if (btnSpinner) btnSpinner.classList.toggle('hidden', !loading);
  };

  const showFormError = (msg) => {
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.classList.remove('hidden');
    }
  };

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errorBox) errorBox.classList.add('hidden');

      const newPassword = String(newPassInput ? newPassInput.value : '');
      const confirmPassword = String(confirmPassInput ? confirmPassInput.value : '');

      if (newPassword.length < 8) {
        showFormError('New password must be at least 8 characters long.');
        if (newPassInput) newPassInput.focus();
        return;
      }
      if (newPassword !== confirmPassword) {
        showFormError('New password and confirmation do not match.');
        if (confirmPassInput) confirmPassInput.focus();
        return;
      }

      setLoading(true);
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, newPassword, confirmPassword }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showFormError(data.error || 'Unable to reset password.');
          return;
        }
        form.classList.add('hidden');
        if (successMsgEl && data.message) successMsgEl.textContent = data.message;
        if (successEl) successEl.classList.remove('hidden');
      } catch (_) {
        showFormError('Network error while resetting password. Please try again.');
      } finally {
        setLoading(false);
      }
    });
  }
});
