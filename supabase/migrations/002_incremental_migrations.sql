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

-- ----------------------------------------------------------------------------
-- 4. Broadcast Categories & Advisory Columns
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS broadcast_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(120) NOT NULL UNIQUE,
  badge_color VARCHAR(30) NOT NULL DEFAULT 'blue',
  priority INTEGER NOT NULL DEFAULT 10,
  description TEXT DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO broadcast_categories (name, slug, badge_color, priority, description, is_active)
VALUES
  ('Weather Advisory', 'weather-advisory', 'blue', 10, 'Rainfall, typhoon, and weather advisories', TRUE),
  ('Flood Warning', 'flood-warning', 'red', 20, 'Rising water levels and flood evacuation advisories', TRUE),
  ('Fire Emergency', 'fire-emergency', 'red', 30, 'Fire hazard and smoke advisories', TRUE),
  ('Road & Utility Advisory', 'road-utility-advisory', 'amber', 40, 'Road closures, fallen trees, and power line advisories', TRUE),
  ('Evacuation Notice', 'evacuation-notice', 'red', 50, 'Mandatory or voluntary evacuation instructions', TRUE),
  ('General Announcement', 'general-announcement', 'slate', 60, 'General Barangay Bayanan EOC notices', TRUE)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE emergency_broadcast_logs
  ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES broadcast_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS advisory_type VARCHAR(100) DEFAULT 'General Announcement',
  ADD COLUMN IF NOT EXISTS urgency_level VARCHAR(40) DEFAULT 'Advisory';

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS advisory_type VARCHAR(100) DEFAULT NULL;

-- ----------------------------------------------------------------------------
-- 5. Approved Hospitals & Health Centers Directory (from 013-016)
-- ----------------------------------------------------------------------------
INSERT INTO hospitals (id, name, address, latitude, longitude, emergency_contact, status, capacity, available_slots, facility_type, operating_hours, verification_status, emergency_capable, last_verified_at)
VALUES
  (1, 'Ospital ng Muntinlupa (OsMun)', 'Civic Drive, Filinvest Corporate City, Alabang, Muntinlupa City', 14.41425000, 121.04417000, '(02) 8771-0457', 'Operational', 200, 45, 'Hospital', '24/7', 'Verified', TRUE, CURRENT_TIMESTAMP),
  (4, 'Asian Hospital and Medical Center', '2205 Civic Drive, Filinvest Corporate City, Alabang, Muntinlupa City', 14.41325000, 121.04371000, '(02) 8771-9000', 'Operational', 300, 62, 'Hospital', '24/7', 'Verified', TRUE, CURRENT_TIMESTAMP),
  (5, 'Bayanan Main Health Center', 'Bayanan Road, Barangay Bayanan, Muntinlupa City', 14.41058940, 121.05004360, '(02) 8862-0115', 'Operational', 30, 18, 'Health Center', 'Mon-Fri 8:00 AM - 5:00 PM', 'Verified', FALSE, CURRENT_TIMESTAMP),
  (6, 'Bayanan Annex Health Center', 'Purok 2, Barangay Bayanan, Muntinlupa City', 14.40738400, 121.04278870, '(02) 8862-0115', 'Operational', 20, 12, 'Health Center', 'Mon-Fri 8:00 AM - 5:00 PM', 'Verified', FALSE, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  status = EXCLUDED.status,
  facility_type = EXCLUDED.facility_type,
  operating_hours = EXCLUDED.operating_hours,
  verification_status = EXCLUDED.verification_status,
  emergency_capable = EXCLUDED.emergency_capable,
  coordinate_flag = NULL,
  last_verified_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP;

UPDATE hospitals
SET status = 'Closed',
    verification_status = 'Unverified',
    emergency_capable = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE id NOT IN (1, 4, 5, 6);

SELECT setval(pg_get_serial_sequence('hospitals', 'id'), GREATEST((SELECT MAX(id) FROM hospitals), 6), true);

-- ----------------------------------------------------------------------------
-- 6. Evidence Attachment Columns (incident_attachments & rescue_attachments)
-- ----------------------------------------------------------------------------
ALTER TABLE incident_attachments
  ADD COLUMN IF NOT EXISTS evidence_type VARCHAR(50) NOT NULL DEFAULT 'resident_submission',
  ADD COLUMN IF NOT EXISTS assignment_id INTEGER DEFAULT NULL REFERENCES incident_assignments(id) ON DELETE SET NULL;

ALTER TABLE rescue_attachments
  ADD COLUMN IF NOT EXISTS evidence_type VARCHAR(50) NOT NULL DEFAULT 'resident_submission',
  ADD COLUMN IF NOT EXISTS assignment_id INTEGER DEFAULT NULL REFERENCES rescue_assignments(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 7. Rescue Verification & Public Visibility Columns (from 012)
-- ----------------------------------------------------------------------------
ALTER TABLE rescue_requests
  ADD COLUMN IF NOT EXISTS verified_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

-- ----------------------------------------------------------------------------
-- 8. Official Barangay Bayanan Evacuation Centers (Muntinlupa City Poster)
--    Preserves existing IDs (1, 2, 3, 5) & FKs; updates verified coordinates
-- ----------------------------------------------------------------------------
UPDATE evacuation_centers
SET
  name = 'Bayanan Elementary Main Court',
  address = 'National Road, Barangay Bayanan, Muntinlupa City',
  latitude = 14.40713740,
  longitude = 121.04530380,
  status = 'Open - Accommodating',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

UPDATE evacuation_centers
SET
  name = 'Bayanan Baywalk Covered Court',
  address = 'Baywalk, Purok 6, Barangay Bayanan, Muntinlupa City',
  latitude = 14.41097870,
  longitude = 121.05130140,
  status = 'Open - Accommodating',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 2;

UPDATE evacuation_centers
SET
  name = 'Bayanan Elementary School Unit 1 Court',
  address = 'Bautista St. cor. Baywalk, Barangay Bayanan, Muntinlupa City',
  latitude = 14.41207000,
  longitude = 121.05170000,
  status = 'Open - Accommodating',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 3;

INSERT INTO evacuation_centers (
  name,
  address,
  barangay,
  latitude,
  longitude,
  capacity,
  available_slots,
  total_capacity,
  current_occupancy,
  status,
  contact_person,
  contact_phone
)
VALUES (
  'Pleasant Covered Court',
  'Intercon St. cor. Hyatt St., Pleasant Village, Barangay Bayanan, Muntinlupa City',
  'Barangay Bayanan',
  14.40765000,
  121.03779300,
  0,
  0,
  0,
  0,
  'Open - Accommodating',
  NULL,
  NULL
)
ON CONFLICT (name) DO UPDATE
SET
  address = EXCLUDED.address,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  status = EXCLUDED.status,
  updated_at = CURRENT_TIMESTAMP;

SELECT setval(pg_get_serial_sequence('evacuation_centers', 'id'), GREATEST((SELECT MAX(id) FROM evacuation_centers), 1), true);

COMMIT;
