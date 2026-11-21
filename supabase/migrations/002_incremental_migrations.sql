-- ============================================================================
-- GeoSafe Incremental Migrations for Supabase PostgreSQL
-- Applies only schema/seed updates not already included in 001_initial_schema.sql
-- Safe and idempotent to run after 001_initial_schema.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Resident GPS Location Verification (from 010_resident_location_verification.sql)
-- ----------------------------------------------------------------------------
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS location_verification_status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS location_verification_method VARCHAR(32) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS location_accuracy_meters NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS location_boundary_distance_meters NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS location_verified_lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS location_verified_lng NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS location_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location_verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_review_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_location_verification_status_check'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_location_verification_status_check
      CHECK (location_verification_status IN (
        'verified',
        'outside_boundary',
        'pending_review',
        'gps_denied',
        'gps_unavailable',
        'retry_required'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_location_verification_method_check'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_location_verification_method_check
      CHECK (location_verification_method IN ('none', 'gps', 'manual_admin'));
  END IF;
END $$;

UPDATE user_profiles
SET location_verification_status = 'verified',
    location_verification_method = CASE
      WHEN location_verification_method = 'none' THEN 'manual_admin'
      ELSE location_verification_method
    END
WHERE verification_status = 'Verified Resident'
  AND location_verification_status = 'pending_review';

INSERT INTO system_settings (setting_key, category, setting_value, description, is_protected)
VALUES (
  'gps_accuracy_threshold_meters',
  'system',
  '100',
  'Maximum acceptable GPS accuracy radius in meters for Barangay Bayanan resident location verification',
  FALSE
)
ON CONFLICT (setting_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Linked Public Flood/Fire Incidents (from 013_linked_public_incident_and_auto_dispatch.sql)
-- ----------------------------------------------------------------------------
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS source_rescue_id INTEGER REFERENCES rescue_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_source_rescue_unique
  ON reports (source_rescue_id)
  WHERE source_rescue_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Canonical Resident Incident Categories (from 017_canonical_incident_categories.sql)
-- ----------------------------------------------------------------------------
UPDATE incident_categories SET name = 'Flooding / Rising Water', is_active = TRUE WHERE id = 1;
UPDATE incident_categories SET name = 'Fire Outbreak', is_active = TRUE WHERE id = 2;
UPDATE incident_categories SET name = 'Severe Drainage Overflow', is_active = TRUE WHERE id = 3;
UPDATE incident_categories SET name = 'Fallen Tree / Road Obstruction', is_active = TRUE WHERE id = 4;
UPDATE incident_categories SET name = 'Downed Electrical Power Cable', is_active = TRUE WHERE id = 5;
UPDATE incident_categories SET name = 'Structural / Wall Collapse', is_active = TRUE WHERE id = 6;

COMMIT;
