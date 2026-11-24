-- Replace OTP-based verification with Administrator-managed Password Assistance Tickets
-- Safely drops obsolete OTP tables now that all code references are removed.

CREATE SEQUENCE IF NOT EXISTS password_assistance_ticket_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS password_assistance_tickets (
  id SERIAL PRIMARY KEY,
  ticket_reference VARCHAR(40) NOT NULL UNIQUE,
  user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  submitted_name VARCHAR(120) NOT NULL,
  submitted_email VARCHAR(255) NOT NULL,
  account_role VARCHAR(30) NOT NULL CHECK (account_role IN ('resident', 'responder')),
  description TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'resolved')),
  reviewed_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  decision_reason TEXT DEFAULT NULL,
  password_reset_at TIMESTAMPTZ DEFAULT NULL,
  request_ip VARCHAR(45) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pat_status_created
  ON password_assistance_tickets (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pat_email_lower
  ON password_assistance_tickets (LOWER(submitted_email));

CREATE INDEX IF NOT EXISTS idx_pat_user_id
  ON password_assistance_tickets (user_id)
  WHERE user_id IS NOT NULL;

DROP TABLE IF EXISTS registration_email_otps;
DROP TABLE IF EXISTS password_reset_otps;
