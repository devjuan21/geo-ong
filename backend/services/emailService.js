const { Resend } = require('resend');

function getResendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || '').trim() || 'GeoSafe <onboarding@resend.dev>';
  if (!apiKey) return null;
  return { apiKey, from };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildOtpEmailContent({ name, otp, expiresMinutes = 5, frontendUrl = '' }) {
  const displayName = String(name || 'User').trim() || 'User';
  const safeName = escapeHtml(displayName);
  const safeOtp = escapeHtml(String(otp || '').trim());
  const portalUrl = String(frontendUrl || '').trim();

  const subject = 'GeoSafe — Password Reset Verification Code';
  const text = [
    `Hello ${displayName},`,
    '',
    'We received a request to reset the password for your GeoSafe — Barangay Bayanan account.',
    '',
    `Your 6-digit verification code is: ${otp}`,
    '',
    `This code expires in ${expiresMinutes} minutes and can only be used once.`,
    portalUrl ? `Portal: ${portalUrl}/login.html` : '',
    '',
    'If you did not request a password reset, you can safely ignore this email.',
    '',
    'Barangay Bayanan Emergency Operations Center (GeoSafe)',
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; background:#F1F5F9; padding:24px; color:#0F172A;">
      <div style="max-width:520px; margin:0 auto; background:#FFFFFF; border:1px solid #CBD5E1; border-radius:8px; overflow:hidden;">
        <div style="background:#0B203B; color:#FFFFFF; padding:18px 24px;">
          <div style="font-size:16px; font-weight:700; letter-spacing:-0.01em;">GeoSafe</div>
          <div style="font-size:11px; color:#9EB8D6; margin-top:2px;">Barangay Bayanan Emergency Operations Center</div>
        </div>
        <div style="padding:24px; font-size:14px; line-height:1.6;">
          <p style="margin:0 0 12px 0;">Hello <strong>${safeName}</strong>,</p>
          <p style="margin:0 0 16px 0; color:#334155;">
            Use the 6-digit verification code below to reset your GeoSafe account password:
          </p>
          <div style="margin:0 0 20px 0; padding:14px 18px; background:#F8FAFC; border:1px solid #CBD5E1; border-radius:6px; text-align:center;">
            <span style="font-family:monospace; font-size:28px; font-weight:700; letter-spacing:8px; color:#0B203B;">${safeOtp}</span>
          </div>
          <p style="margin:0 0 12px 0; font-size:12px; color:#64748B;">
            This verification code expires in <strong>${expiresMinutes} minutes</strong> and allows a maximum of 5 verification attempts.
          </p>
          ${portalUrl ? `<p style="margin:0 0 14px 0; font-size:12px; color:#164579;">GeoSafe Portal: <a href="${escapeHtml(portalUrl)}/login.html" style="color:#164579;">${escapeHtml(portalUrl)}</a></p>` : ''}
          <p style="margin:0; font-size:12px; color:#64748B; border-top:1px solid #E2E8F0; padding-top:14px;">
            If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
          </p>
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
}

async function sendPasswordResetOtpEmail({ to, name, otp, expiresMinutes = 5, frontendUrl = '' }) {
  const cfg = getResendConfig();
  if (!cfg) {
    const err = new Error('Email delivery service is not configured. Set RESEND_API_KEY and EMAIL_FROM in environment variables.');
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  const resend = new Resend(cfg.apiKey);
  const { subject, text, html } = buildOtpEmailContent({ name, otp, expiresMinutes, frontendUrl });

  const { data, error } = await resend.emails.send({
    from: cfg.from,
    to: [to],
    subject,
    text,
    html,
  });

  if (error) {
    const err = new Error(error.message || 'Resend email delivery failed.');
    err.code = error.name || 'RESEND_ERROR';
    throw err;
  }

  return {
    provider: 'resend',
    messageId: data && data.id ? data.id : null,
  };
}

module.exports = {
  getResendConfig,
  sendPasswordResetOtpEmail,
};
