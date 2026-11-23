-- Password Reset Security & Session Invalidation Migration
-- 1. Track password_changed_at on users so active JWT sessions issued prior to
--    a password reset are automatically invalidated.
-- 2. Index reset_token_hash for fast single-use token lookup.
-- 3. Extend auth_security_logs_event_type_check to cover password reset events.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_reset_token_hash
  ON users (reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;

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
        'password_reset_email_failed'::character varying
      ]::text[]
    )
  );
