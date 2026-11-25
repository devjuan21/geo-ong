-- Allow Operational, Full, Temporarily Closed, and Inactive on evacuation_centers.status
-- while preserving existing Open - Accommodating, Full / Closed, and Standby values.
ALTER TABLE evacuation_centers
  DROP CONSTRAINT IF EXISTS evacuation_centers_status_check;

ALTER TABLE evacuation_centers
  ADD CONSTRAINT evacuation_centers_status_check
  CHECK (
    status IN (
      'Open - Accommodating',
      'Operational',
      'Full',
      'Temporarily Closed',
      'Inactive',
      'Full / Closed',
      'Standby'
    )
  );
