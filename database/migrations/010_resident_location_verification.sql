-- ============================================================================
-- Migration 010: Resident GPS Location Verification for Barangay Bayanan
-- Reuses user_profiles and system_settings without creating duplicate tables.
-- ============================================================================

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

-- Sync existing verified residents
UPDATE user_profiles
SET location_verification_status = 'verified',
    location_verification_method = CASE WHEN location_verification_method = 'none' THEN 'manual_admin' ELSE location_verification_method END
WHERE verification_status = 'Verified Resident'
  AND location_verification_status = 'pending_review';

-- Configurable GPS accuracy threshold in system_settings (default 100 meters)
INSERT INTO system_settings (setting_key, category, setting_value, description, is_protected)
VALUES (
  'gps_accuracy_threshold_meters',
  'system',
  '100',
  'Maximum acceptable GPS accuracy radius in meters for Barangay Bayanan resident location verification',
  FALSE
)
ON CONFLICT (setting_key) DO NOTHING;
