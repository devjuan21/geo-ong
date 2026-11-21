-- 012_rescue_verification_and_public_visibility.sql
-- Adds Responder verification and sanitized public map visibility columns to rescue_requests.

ALTER TABLE rescue_requests
  ADD COLUMN IF NOT EXISTS verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
