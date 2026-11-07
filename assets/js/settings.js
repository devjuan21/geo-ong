/**
 * GeoSafe - Settings & Preferences Page Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  GeoSafeUI.init('settings', 'Settings');
  setupSettingsForms();
});

function setupSettingsForms() {
  const pwdForm = document.getElementById('password-change-form');
  const prefsForm = document.getElementById('preferences-form');

  if (pwdForm) {
    pwdForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const curPwd = document.getElementById('curr-pwd').value;
      const newPwd = document.getElementById('new-pwd').value;
      const confPwd = document.getElementById('confirm-pwd').value;

      if (!curPwd || !newPwd || !confPwd) {
        GeoSafeUI.showToast('Please fill out all password fields.', 'error');
        return;
      }

      if (newPwd.length < 8) {
        GeoSafeUI.showToast('New password must be at least 8 characters long.', 'warning');
        return;
      }

      if (newPwd !== confPwd) {
        GeoSafeUI.showToast('New passwords do not match.', 'error');
        return;
      }

      if (!window.geoSafeStore.isOnline()) {
        GeoSafeUI.showToast('Password updates require an active internet connection.', 'error');
        return;
      }

      try {
        await window.geoSafeStore.updateSettings({ passwordLastChanged: new Date().toISOString() });
        pwdForm.reset();
        GeoSafeUI.showToast('Your password has been successfully updated.', 'success');
      } catch (err) {
        GeoSafeUI.showToast('Failed to update password.', 'error');
      }
    });
  }

  if (prefsForm) {
    prefsForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const smsAlerts = document.getElementById('pref-sms').checked;
      const emailAlerts = document.getElementById('pref-email').checked;
      const soundAlerts = document.getElementById('pref-sound').checked;
      const responderVisibility = document.getElementById('pref-visibility').checked;

      if (!window.geoSafeStore.isOnline()) {
        GeoSafeUI.showToast('Active internet connection required to save preferences.', 'error');
        return;
      }

      try {
        await window.geoSafeStore.updateSettings({
          notifications: { smsAlerts, emailAlerts, soundAlerts },
          privacy: { responderVisibility }
        });
        GeoSafeUI.showToast('Preferences updated successfully.', 'success');
      } catch (err) {
        GeoSafeUI.showToast('Failed to save preferences.', 'error');
      }
    });
  }
}

