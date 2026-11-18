-- Migration 016: Remove Medical Center Muntinlupa (id=3) from active facility directory, maps, and recommendations
-- Preserves historical FK integrity by marking Closed / Unverified.

BEGIN;

UPDATE hospitals
SET
  status = 'Closed',
  verification_status = 'Unverified',
  emergency_capable = FALSE,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 3;

COMMIT;
