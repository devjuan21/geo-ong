-- Secure Email OTP Password Reset Transactions Table
-- Stores HMAC-SHA256 OTP hashes (5-min expiry), attempt counters (max 5),
-- 60-second resend cooldown, and short-lived single-use reset authorization hashes.

CREATE TABLE IF NOT EXISTS password_reset_otps (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(150) DEFAULT NULL,
  otp_hash VARCHAR(128) NOT NULL,
  reset_auth_hash VARCHAR(128) DEFAULT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  reset_auth_expires_at TIMESTAMPTZ DEFAULT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resend_available_at TIMESTAMPTZ DEFAULT NULL,
  verified_at TIMESTAMPTZ DEFAULT NULL,
  consumed_at TIMESTAMPTZ DEFAULT NULL,
  request_ip VARCHAR(45) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE password_reset_otps
  ADD COLUMN IF NOT EXISTS email VARCHAR(150) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS resend_available_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS request_ip VARCHAR(45) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_pwd_reset_otps_user_created
  ON password_reset_otps (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_otps_email_created
  ON password_reset_otps (LOWER(email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_otps_auth_hash
  ON password_reset_otps (reset_auth_hash)
  WHERE reset_auth_hash IS NOT NULL AND consumed_at IS NULL;
