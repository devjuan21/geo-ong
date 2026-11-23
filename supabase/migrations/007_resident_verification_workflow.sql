-- Administrator-Verified Resident Registration Workflow Migration
-- 1. Extend users.account_status & users.status CHECK constraints to support
--    'pending_verification' and 'rejected' alongside existing statuses.
-- 2. Create resident_verification_applications table for private identity photo
--    references, review metadata, rejection reasons, and retention timestamps.
-- 3. Extend auth_security_logs_event_type_check for verification events.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_account_status_check
  CHECK (
    (account_status)::text = ANY (
      ARRAY[
        'pending_verification'::character varying,
        'active'::character varying,
        'rejected'::character varying,
        'suspended'::character varying,
        'deactivated'::character varying
      ]::text[]
    )
  );

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_status_check
  CHECK (
    (status)::text = ANY (
      ARRAY[
        'pending_verification'::character varying,
        'active'::character varying,
        'rejected'::character varying,
        'suspended'::character varying,
        'deactivated'::character varying
      ]::text[]
    )
  );

CREATE TABLE IF NOT EXISTS resident_verification_applications (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'active', 'rejected')),
  id_photo_path VARCHAR(500) NOT NULL,
  id_photo_mime VARCHAR(80) NOT NULL,
  id_photo_size INTEGER NOT NULL,
  selfie_photo_path VARCHAR(500) NOT NULL,
  selfie_photo_mime VARCHAR(80) NOT NULL,
  selfie_photo_size INTEGER NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  rejection_reason TEXT DEFAULT NULL,
  retention_expires_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_res_verif_status_submitted
  ON resident_verification_applications (status, submitted_at DESC);

ALTER TABLE auth_security_logs
  DROP CONSTRAINT IF EXISTS auth_security_logs_event_type_check;

ALTER TABLE auth_security_logs
  ADD CONSTRAINT auth_security_logs_event_type_check
  CHECK (
    (event_type)::text = ANY (
      ARRAY[
        'login_success'::character varying,
        'login_failed'::character varying,
        'logout'::character varying,
        'token_revoked'::character varying,
        'unauthorized_role_attempt'::character varying,
        'password_changed'::character varying,
        'account_suspended'::character varying,
        'account_reactivated'::character varying,
        'password_reset_requested'::character varying,
        'password_reset_completed'::character varying,
        'password_reset_failed'::character varying,
        'password_reset_email_failed'::character varying,
        'location_verification_bypass_attempt'::character varying,
        'resident_application_submitted'::character varying,
        'resident_application_approved'::character varying,
        'resident_application_rejected'::character varying,
        'resident_verification_email_failed'::character varying
      ]::text[]
    )
  );
