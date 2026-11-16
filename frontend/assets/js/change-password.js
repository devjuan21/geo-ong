/**
 * GeoSafe - Mandatory First Login Password Change Controller
 */
document.addEventListener('DOMContentLoaded', async () => {
  if (!window.geoSafeStore) return;

  const session = await window.geoSafeStore.verifySession(null);
  if (!session || !session.authenticated || !session.user) {
    window.location.replace('/login.html');
    return;
  }

  if (!session.user.mustChangePassword) {
    window.location.replace(session.user.portal || window.geoSafeStore.portalForRole(session.user.role));
    return;
  }

  const identityBox = document.getElementById('account-identity-box');
  const nameEl = document.getElementById('cp-user-name');
  const emailEl = document.getElementById('cp-user-email');
  if (identityBox && nameEl && emailEl) {
    nameEl.textContent = `${session.user.name || 'Responder'} (${session.user.role || 'Responder'})`;
    emailEl.textContent = session.user.email || '';
    identityBox.classList.remove('hidden');
  }

  document.querySelectorAll('.toggle-pw-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle-target');
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      btn.querySelector('.eye-open')?.classList.toggle('hidden', isPassword);
      btn.querySelector('.eye-closed')?.classList.toggle('hidden', !isPassword);
    });
  });

  document.getElementById('btn-logout-change-pw')?.addEventListener('click', async () => {
    await window.geoSafeStore.logout();
    window.location.replace('/login.html');
  });

  const form = document.getElementById('change-password-form');
  const errBox = document.getElementById('cp-error-box');
  const submitBtn = document.getElementById('cp-submit-btn');
  let isSubmitting = false;

  const showError = (msg) => {
    if (!errBox) return;
    errBox.textContent = msg;
    errBox.classList.remove('hidden');
  };

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (errBox) errBox.classList.add('hidden');

    const currentPassword = document.getElementById('current-password')?.value || '';
    const newPassword = document.getElementById('new-password')?.value || '';
    const confirmPassword = document.getElementById('confirm-password')?.value || '';

    if (!currentPassword) {
      showError('Please enter your temporary / current password.');
      return;
    }
    if (newPassword.length < 8) {
      showError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showError('New password and confirmation do not match.');
      return;
    }
    if (currentPassword === newPassword) {
      showError('New password cannot be the same as your temporary password.');
      return;
    }

    isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating Password...';
    }

    try {
      const result = await window.geoSafeStore.changePassword(currentPassword, newPassword, confirmPassword);
      if (window.GeoSafeToast && typeof window.GeoSafeToast.show === 'function') {
        window.GeoSafeToast.show({
          message: result.message || 'Password updated successfully.',
          type: 'success',
          duration: 3000,
        });
      }
      const targetPortal = result.redirectTo || session.user.portal || '/responder-dashboard.html';
      setTimeout(() => {
        window.location.replace(targetPortal);
      }, 450);
    } catch (err) {
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update Password & Continue';
      }
      showError(err.message || 'Failed to update password. Please try again.');
    }
  });
});
