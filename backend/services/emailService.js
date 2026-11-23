const nodemailer = require('nodemailer');

function getEmailProviderConfig() {
  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
  const smtpHost = String(process.env.SMTP_HOST || '').trim();
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = String(process.env.SMTP_USER || '').trim();
  const smtpPass = String(process.env.SMTP_PASS || '').trim();
  const smtpSecure =
    String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || smtpPort === 465;
  const fromAddress =
    String(process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM || smtpUser || '').trim();

  if (resendApiKey) {
    return {
      provider: 'resend',
      apiKey: resendApiKey,
      from: fromAddress || 'GeoSafe <onboarding@resend.dev>',
    };
  }

  if (smtpHost && smtpUser && smtpPass) {
    return {
      provider: 'smtp',
      host: smtpHost,
      port: Number.isFinite(smtpPort) ? smtpPort : 587,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: fromAddress || smtpUser,
    };
  }

  return null;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildResetEmailContent({ name, resetUrl, expiresMinutes = 30 }) {
  const displayName = String(name || 'User').trim() || 'User';
  const safeName = escapeHtml(displayName);
  const safeUrl = escapeHtml(resetUrl);

  const subject = 'GeoSafe — Password Reset Request';
  const text = [
    `Hello ${displayName},`,
    '',
    'We received a request to reset the password for your GeoSafe — Barangay Bayanan account.',
    '',
    `Reset your password using this link (valid for ${expiresMinutes} minutes, single-use):`,
    resetUrl,
    '',
    'If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.',
    '',
    'Barangay Bayanan Emergency Operations Center (GeoSafe)',
  ].join('\n');

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
            We received a request to reset the password for your GeoSafe account. Click the button below to choose a new password.
          </p>
          <p style="margin:0 0 20px 0;">
            <a href="${safeUrl}" style="display:inline-block; background:#164579; color:#FFFFFF; text-decoration:none; font-weight:600; font-size:14px; padding:11px 20px; border-radius:6px;">
              Reset Password
            </a>
          </p>
          <p style="margin:0 0 12px 0; font-size:12px; color:#64748B;">
            This link expires in <strong>${expiresMinutes} minutes</strong> and can only be used once. If the button does not work, copy and paste this URL into your browser:
          </p>
          <p style="margin:0 0 16px 0; font-size:12px; word-break:break-all; color:#164579;">
            ${safeUrl}
          </p>
          <p style="margin:0; font-size:12px; color:#64748B; border-top:1px solid #E2E8F0; padding-top:14px;">
            If you did not request a password reset, you can safely ignore this email.
          </p>
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
}

async function sendPasswordResetEmail({ to, name, resetUrl, expiresMinutes = 30 }) {
  const cfg = getEmailProviderConfig();
  if (!cfg) {
    const err = new Error(
      'Email delivery service is not configured. Set RESEND_API_KEY (or SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) in environment variables.'
    );
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  const { subject, text, html } = buildResetEmailContent({ name, resetUrl, expiresMinutes });

  if (cfg.provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [to],
        subject,
        text,
        html,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.message || body.error || `Resend delivery failed (HTTP ${res.status})`);
      err.code = 'EMAIL_DELIVERY_FAILED';
      throw err;
    }
    return { provider: 'resend', messageId: body.id || null };
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  const info = await transporter.sendMail({
    from: cfg.from,
    to,
    subject,
    text,
    html,
  });

  return { provider: 'smtp', messageId: info && info.messageId ? info.messageId : null };
}

module.exports = {
  getEmailProviderConfig,
  sendPasswordResetEmail,
};
