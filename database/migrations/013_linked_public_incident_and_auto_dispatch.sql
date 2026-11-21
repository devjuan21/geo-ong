-- 013_linked_public_incident_and_auto_dispatch.sql
-- Links verified Fire/Flood Rescue Requests to sanitized public Incident Reports
-- and prevents duplicate public incidents per Rescue Request.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS source_rescue_id INTEGER REFERENCES rescue_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_source_rescue_unique
  ON reports (source_rescue_id)
  WHERE source_rescue_id IS NOT NULL;
