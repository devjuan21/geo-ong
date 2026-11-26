-- Migration: Add optional BYTEA persistence fallback for incident_attachments and rescue_attachments
-- Ensures newly uploaded evidence persists even when external object storage env vars are not configured.

ALTER TABLE incident_attachments ADD COLUMN IF NOT EXISTS file_data BYTEA;
ALTER TABLE rescue_attachments ADD COLUMN IF NOT EXISTS file_data BYTEA;
