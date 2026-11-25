-- Migration: Add 'Open for Accommodation' status for evacuation_centers
-- Safely normalizes legacy 'Open - Accommodating' / 'OPEN-ACCOMMODATING' rows to 'Open for Accommodation'.

ALTER TABLE evacuation_centers DROP CONSTRAINT IF EXISTS evacuation_centers_status_check;

ALTER TABLE evacuation_centers
  ADD CONSTRAINT evacuation_centers_status_check
  CHECK (
    status IN (
      'Open for Accommodation',
      'Operational',
      'Full',
      'Temporarily Closed',
      'Inactive',
      'Open - Accommodating',
      'OPEN-ACCOMMODATING',
      'Full / Closed',
      'Standby'
    )
  );

UPDATE evacuation_centers
SET status = 'Open for Accommodation',
    updated_at = NOW()
WHERE status IN ('Open - Accommodating', 'OPEN-ACCOMMODATING');
