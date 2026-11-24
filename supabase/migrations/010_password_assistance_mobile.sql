-- Add submitted_phone column to password_assistance_tickets
ALTER TABLE password_assistance_tickets
  ADD COLUMN IF NOT EXISTS submitted_phone VARCHAR(30) DEFAULT NULL;
