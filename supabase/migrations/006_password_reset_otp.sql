-- Password Reset 6-Digit Email OTP & Single-Use Reset Authorization Table
-- Stores only HMAC-SHA256 hashes (never plaintext OTPs or reset tokens).

CREATE TABLE IF NOT EXISTS password_reset_otps (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash VARCHAR(128) NOT NULL,
  reset_auth_hash VARCHAR(128) DEFAULT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  reset_auth_expires_at TIMESTAMPTZ DEFAULT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMPTZ DEFAULT NULL,
  consumed_at TIMESTAMPTZ DEFAULT NULL,
  request_ip VARCHAR(45) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_otps_user_active
  ON password_reset_otps (user_id, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pwd_reset_otps_auth_hash
  ON password_reset_otps (reset_auth_hash)
  WHERE reset_auth_hash IS NOT NULL AND consumed_at IS NULL;
