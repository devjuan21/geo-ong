-- ============================================================================
-- Migration 013: Update Hospital & Health Center Directory with Five
--                Approved Facilities (Matching Existing IDs, No Duplicates)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_hospitals_verification_status') THEN
    ALTER TABLE hospitals DROP CONSTRAINT chk_hospitals_verification_status;
  END IF;
  ALTER TABLE hospitals
    ADD CONSTRAINT chk_hospitals_verification_status
    CHECK (verification_status IN ('Verified', 'Unverified', 'Flagged', 'Pending Verification'));
END $$;

-- 1. Ospital ng Muntinlupa (OsMun) — id = 1
UPDATE hospitals
SET name = 'Ospital ng Muntinlupa (OsMun)',
    facility_type = 'Hospital',
    latitude = 14.41425000,
    longitude = 121.04417000,
    verification_status = 'Verified',
    coordinate_flag = NULL,
    status = 'Operational',
    emergency_capable = TRUE,
    last_verified_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

-- 2. Medical Center Muntinlupa — id = 3
UPDATE hospitals
SET name = 'Medical Center Muntinlupa',
    facility_type = 'Hospital',
    latitude = 14.39496200,
    longitude = 121.04519900,
    verification_status = 'Verified',
    coordinate_flag = NULL,
    status = 'Operational',
    emergency_capable = TRUE,
    last_verified_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 3;

-- 3. Asian Hospital and Medical Center — id = 4
UPDATE hospitals
SET name = 'Asian Hospital and Medical Center',
    facility_type = 'Hospital',
    latitude = 14.41325000,
    longitude = 121.04371000,
    verification_status = 'Verified',
    coordinate_flag = NULL,
    status = 'Operational',
    emergency_capable = TRUE,
    last_verified_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 4;

-- 4. Bayanan Main Health Center — id = 5 (Pending Verification)
UPDATE hospitals
SET name = 'Bayanan Main Health Center',
    facility_type = 'Health Center',
    latitude = 14.41014900,
    longitude = 121.05252000,
    verification_status = 'Pending Verification',
    coordinate_flag = 'Coordinates marked for verification; confirm actual location before activating navigation.',
    status = 'Under Assessment',
    emergency_capable = FALSE,
    last_verified_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 5;

-- 5. Bayanan Annex Health Center — id = 6
UPDATE hospitals
SET name = 'Bayanan Annex Health Center',
    facility_type = 'Health Center',
    latitude = 14.40848400,
    longitude = 121.04568100,
    verification_status = 'Verified',
    coordinate_flag = NULL,
    status = 'Operational',
    emergency_capable = FALSE,
    last_verified_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 6;
