document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('forgot-password-form');
  const emailInput = document.getElementById('forgot-email');
  const submitBtn = document.getElementById('forgot-submit-btn');
  const btnText = document.getElementById('forgot-btn-text');
  const btnSpinner = document.getElementById('forgot-btn-spinner');
  const errorBox = document.getElementById('forgot-error-box');
  const successBox = document.getElementById('forgot-success-box');
  const successText = document.getElementById('forgot-success-text');

  if (!form || !emailInput) return;

  const setLoading = (loading) => {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    submitBtn.classList.toggle('opacity-80', loading);
    submitBtn.classList.toggle('cursor-wait', loading);
    if (btnText) btnText.textContent = loading ? 'Sending...' : 'Send Reset Link';
    if (btnSpinner) btnSpinner.classList.toggle('hidden', !loading);
  };

  const showError = (msg) => {
    if (successBox) successBox.classList.add('hidden');
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.classList.remove('hidden');
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorBox) errorBox.classList.add('hidden');
    if (successBox) successBox.classList.add('hidden');

    const email = String(emailInput.value || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('Please enter a valid email address.');
      emailInput.focus();
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'Unable to send password reset instructions right now.');
        return;
      }

      if (successText) {
        successText.textContent =
          data.message || 'If an account exists for this email address, password reset instructions will be sent.';
      }
      if (successBox) successBox.classList.remove('hidden');
      form.reset();
    } catch (_) {
      showError('Network error while contacting the GeoSafe server. Please try again.');
    } finally {
      setLoading(false);
    }
  });
});
