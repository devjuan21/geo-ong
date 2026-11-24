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

async function sendResendTransactionalEmail({ to, subject, text, html }) {
  const cfg = getResendConfig();
  if (!cfg) {
    const err = new Error('Email delivery service is not configured. Set RESEND_API_KEY and EMAIL_FROM in environment variables.');
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }
  const resend = new Resend(cfg.apiKey);
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

async function sendResidentApplicationSubmittedEmail({ to, name, frontendUrl = '' }) {
  const displayName = String(name || 'Resident').trim() || 'Resident';
  const safeName = escapeHtml(displayName);
  const subject = 'GeoSafe — Resident Registration Received (Pending Verification)';
  const text = [
    `Hello ${displayName},`,
    '',
    'Thank you for registering with GeoSafe — Barangay Bayanan Emergency Operations Center.',
    'Your registration and identity verification documents have been received and are currently pending Administrator review.',
    'You will receive another email once your account has been reviewed.',
    '',
    'Barangay Bayanan Emergency Operations Center (GeoSafe)',
  ].join('\n');
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; background:#F1F5F9; padding:24px; color:#0F172A;">
      <div style="max-width:520px; margin:0 auto; background:#FFFFFF; border:1px solid #CBD5E1; border-radius:8px; overflow:hidden;">
        <div style="background:#0B203B; color:#FFFFFF; padding:18px 24px;">
          <div style="font-size:16px; font-weight:700;">GeoSafe</div>
          <div style="font-size:11px; color:#9EB8D6; margin-top:2px;">Barangay Bayanan Emergency Operations Center</div>
        </div>
        <div style="padding:24px; font-size:14px; line-height:1.6;">
          <p style="margin:0 0 12px 0;">Hello <strong>${safeName}</strong>,</p>
          <p style="margin:0 0 14px 0; color:#334155;">
            Your Resident registration has been submitted and is currently <strong>pending Administrator verification</strong>.
          </p>
          <p style="margin:0 0 14px 0; font-size:13px; color:#475569;">
            An authorized Barangay Bayanan Administrator will review your submitted identity documents. You will receive an email notification once your account is approved.
          </p>
          ${frontendUrl ? `<p style="margin:0; font-size:12px; color:#64748B;">Portal: ${escapeHtml(frontendUrl)}/login.html</p>` : ''}
        </div>
      </div>
    </div>
  `;
  return sendResendTransactionalEmail({ to, subject, text, html });
}

async function sendResidentApplicationApprovedEmail({ to, name, frontendUrl = '' }) {
  const displayName = String(name || 'Resident').trim() || 'Resident';
  const safeName = escapeHtml(displayName);
  const loginLink = frontendUrl ? `${String(frontendUrl).replace(/\/+$/, '')}/login.html` : '';
  const subject = 'GeoSafe — Resident Account Approved';
  const text = [
    `Hello ${displayName},`,
    '',
    'Your GeoSafe Resident registration for Barangay Bayanan has been approved by an Administrator.',
    'Your account is now active and you may sign in to access the GeoSafe Resident Portal.',
    loginLink ? `Sign In: ${loginLink}` : '',
    '',
    'Barangay Bayanan Emergency Operations Center (GeoSafe)',
  ].filter(Boolean).join('\n');
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; background:#F1F5F9; padding:24px; color:#0F172A;">
      <div style="max-width:520px; margin:0 auto; background:#FFFFFF; border:1px solid #CBD5E1; border-radius:8px; overflow:hidden;">
        <div style="background:#0B203B; color:#FFFFFF; padding:18px 24px;">
          <div style="font-size:16px; font-weight:700;">GeoSafe</div>
          <div style="font-size:11px; color:#9EB8D6; margin-top:2px;">Barangay Bayanan Emergency Operations Center</div>
        </div>
        <div style="padding:24px; font-size:14px; line-height:1.6;">
          <p style="margin:0 0 12px 0;">Hello <strong>${safeName}</strong>,</p>
          <p style="margin:0 0 16px 0; color:#334155;">
            Good news! Your Barangay Bayanan Resident registration has been <strong>approved</strong>. Your account is now active.
          </p>
          ${loginLink ? `<p style="margin:0 0 18px 0;"><a href="${escapeHtml(loginLink)}" style="display:inline-block; background:#164579; color:#FFFFFF; text-decoration:none; font-weight:600; font-size:14px; padding:11px 20px; border-radius:6px;">Sign In to GeoSafe</a></p>` : ''}
          <p style="margin:0; font-size:12px; color:#64748B;">You can now report incidents, request rescue assistance, and view evacuation routes.</p>
        </div>
      </div>
    </div>
  `;
  return sendResendTransactionalEmail({ to, subject, text, html });
}

async function sendResidentApplicationRejectedEmail({ to, name, reason, frontendUrl = '' }) {
  const displayName = String(name || 'Applicant').trim() || 'Applicant';
  const safeName = escapeHtml(displayName);
  const safeReason = escapeHtml(String(reason || 'Your submitted identity documents could not be verified.').trim());
  const subject = 'GeoSafe — Resident Registration Update';
  const text = [
    `Hello ${displayName},`,
    '',
    'Your GeoSafe Resident registration for Barangay Bayanan could not be approved at this time.',
    '',
    `Reason: ${reason || 'Submitted identity documents could not be verified.'}`,
    '',
    'If you believe this is an error or need assistance, please contact the Barangay Bayanan Emergency Operations Center (EOC).',
    frontendUrl ? `Portal: ${frontendUrl}/login.html` : '',
  ].filter(Boolean).join('\n');
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; background:#F1F5F9; padding:24px; color:#0F172A;">
      <div style="max-width:520px; margin:0 auto; background:#FFFFFF; border:1px solid #CBD5E1; border-radius:8px; overflow:hidden;">
        <div style="background:#0B203B; color:#FFFFFF; padding:18px 24px;">
          <div style="font-size:16px; font-weight:700;">GeoSafe</div>
          <div style="font-size:11px; color:#9EB8D6; margin-top:2px;">Barangay Bayanan Emergency Operations Center</div>
        </div>
        <div style="padding:24px; font-size:14px; line-height:1.6;">
          <p style="margin:0 0 12px 0;">Hello <strong>${safeName}</strong>,</p>
          <p style="margin:0 0 14px 0; color:#334155;">
            Your Barangay Bayanan Resident registration was <strong>not approved</strong>.
          </p>
          <div style="margin:0 0 16px 0; padding:12px 14px; background:#FEF2F2; border:1px solid #FECACA; border-radius:6px; font-size:13px; color:#991B1B;">
            <strong>Reason:</strong> ${safeReason}
          </div>
          <p style="margin:0; font-size:12px; color:#64748B;">
            Please contact the Barangay Bayanan Emergency Operations Center (EOC) if you need assistance or clarification.
          </p>
        </div>
      </div>
    </div>
  `;
  return sendResendTransactionalEmail({ to, subject, text, html });
}

function buildRegistrationOtpEmailContent({ name, otp, expiresMinutes = 5, frontendUrl = '' }) {
  const displayName = String(name || 'Applicant').trim() || 'Applicant';
  const safeName = escapeHtml(displayName);
  const safeOtp = escapeHtml(String(otp || '').trim());
  const portalUrl = String(frontendUrl || '').trim();

  const subject = 'GeoSafe — Verify Your Email for Resident Registration';
  const text = [
    `Hello ${displayName},`,
    '',
    'Use the 6-digit verification code below to confirm your email address for your GeoSafe Resident Registration (Barangay Bayanan):',
    '',
    `Registration Verification Code: ${otp}`,
    '',
    `This code expires in ${expiresMinutes} minutes and can only be used once.`,
    'Note: Confirming your email allows you to submit your identity documents for Administrator review. Your account will still require Administrator approval before sign-in.',
    portalUrl ? `Portal: ${portalUrl}/login.html` : '',
    '',
    'If you did not start a Resident registration on GeoSafe, you can safely ignore this email.',
    '',
    'Barangay Bayanan Emergency Operations Center (GeoSafe)',
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; background:#F1F5F9; padding:24px; color:#0F172A;">
      <div style="max-width:520px; margin:0 auto; background:#FFFFFF; border:1px solid #CBD5E1; border-radius:8px; overflow:hidden;">
        <div style="background:#0B203B; color:#FFFFFF; padding:18px 24px;">
          <div style="font-size:16px; font-weight:700; letter-spacing:-0.01em;">GeoSafe</div>
          <div style="font-size:11px; color:#9EB8D6; margin-top:2px;">Barangay Bayanan Resident Registration Verification</div>
        </div>
        <div style="padding:24px; font-size:14px; line-height:1.6;">
          <p style="margin:0 0 12px 0;">Hello <strong>${safeName}</strong>,</p>
          <p style="margin:0 0 16px 0; color:#334155;">
            Enter the 6-digit code below to verify your email address and continue your <strong>GeoSafe Resident Registration</strong>:
          </p>
          <div style="margin:0 0 20px 0; padding:14px 18px; background:#F8FAFC; border:1px solid #CBD5E1; border-radius:6px; text-align:center;">
            <span style="font-family:monospace; font-size:28px; font-weight:700; letter-spacing:8px; color:#0B203B;">${safeOtp}</span>
          </div>
          <p style="margin:0 0 12px 0; font-size:12px; color:#64748B;">
            This registration verification code expires in <strong>${expiresMinutes} minutes</strong> and allows up to 5 attempts.
          </p>
          <p style="margin:0 0 12px 0; font-size:12px; color:#475569; background:#EFF6FF; border:1px solid #BFDBFE; border-radius:6px; padding:10px 12px;">
            After verifying your email and submitting your Barangay Address ID and selfie, an Administrator must still review and approve your application before you can sign in.
          </p>
          ${portalUrl ? `<p style="margin:0 0 14px 0; font-size:12px; color:#164579;">GeoSafe Portal: <a href="${escapeHtml(portalUrl)}/login.html" style="color:#164579;">${escapeHtml(portalUrl)}</a></p>` : ''}
          <p style="margin:0; font-size:12px; color:#64748B; border-top:1px solid #E2E8F0; padding-top:14px;">
            If you did not request Resident registration on GeoSafe, you can safely ignore this email.
          </p>
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
}

async function sendRegistrationOtpEmail({ to, name, otp, expiresMinutes = 5, frontendUrl = '' }) {
  const { subject, text, html } = buildRegistrationOtpEmailContent({ name, otp, expiresMinutes, frontendUrl });
  return sendResendTransactionalEmail({ to, subject, text, html });
}

module.exports = {
  getResendConfig,
  sendPasswordResetOtpEmail,
  sendRegistrationOtpEmail,
  sendResidentApplicationSubmittedEmail,
  sendResidentApplicationApprovedEmail,
  sendResidentApplicationRejectedEmail,
};
