-- Dedicated Registration Email OTP Verification Table
-- Strictly separate from password_reset_otps (Forgot Password workflow)

CREATE TABLE IF NOT EXISTS registration_email_otps (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp_hash VARCHAR(64) NOT NULL,
  verification_token_hash VARCHAR(64) DEFAULT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verification_token_expires_at TIMESTAMPTZ DEFAULT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resend_available_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ DEFAULT NULL,
  consumed_at TIMESTAMPTZ DEFAULT NULL,
  request_ip VARCHAR(45) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reg_email_otps_email_created
  ON registration_email_otps (LOWER(email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reg_email_otps_token_hash
  ON registration_email_otps (verification_token_hash)
  WHERE verification_token_hash IS NOT NULL;

ALTER TABLE resident_verification_applications
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT NULL;
