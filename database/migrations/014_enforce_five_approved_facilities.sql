-- Migration 014: Enforce the 5 Approved Medical Facilities (3 Hospitals, 2 Health Centers)
-- Updates Bayanan Main Health Center (id=5) with verified coordinates (14.41058940, 121.05004360)
-- and deactivates any non-canonical records (preserving IDs/FKs safely without deleting).

BEGIN;

-- 1. Update Bayanan Main Health Center (id=5) to verified coordinates and status
UPDATE hospitals
SET
  facility_type = 'Health Center',
  latitude = 14.41058940,
  longitude = 121.05004360,
  verification_status = 'Verified',
  status = 'Operational',
  coordinate_flag = NULL,
  last_verified_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 5;

-- 2. Ensure canonical Hospitals (ids 1, 3, 4) and Bayanan Annex Health Center (id=6) have exact classifications & status
UPDATE hospitals
SET
  facility_type = 'Hospital',
  verification_status = 'Verified',
  status = 'Operational',
  emergency_capable = TRUE,
  coordinate_flag = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (1, 3, 4);

UPDATE hospitals
SET
  facility_type = 'Health Center',
  verification_status = 'Verified',
  status = 'Operational',
  coordinate_flag = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 6;

-- 3. Deactivate any non-approved duplicate or unverified records while preserving historical FKs
UPDATE hospitals
SET
  status = 'Closed',
  verification_status = 'Unverified',
  emergency_capable = FALSE,
  updated_at = CURRENT_TIMESTAMP
WHERE id NOT IN (1, 3, 4, 5, 6);

COMMIT;
