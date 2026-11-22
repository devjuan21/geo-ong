-- Align emergency_broadcast_logs.target_scope CHECK constraint with all valid
-- Admin Broadcast Alert target audiences ('Everyone', 'Residents', 'Responders',
-- and legacy/zone-specific scopes).

ALTER TABLE emergency_broadcast_logs
  DROP CONSTRAINT IF EXISTS emergency_broadcast_logs_target_scope_check;

ALTER TABLE emergency_broadcast_logs
  ADD CONSTRAINT emergency_broadcast_logs_target_scope_check
  CHECK (
    (target_scope)::text = ANY (
      ARRAY[
        'Everyone'::character varying,
        'Residents'::character varying,
        'Residents Only'::character varying,
        'Responders'::character varying,
        'Responders Only'::character varying,
        'All Barangay Bayanan'::character varying,
        'Lakeshore Zone'::character varying,
        'Specific Purok'::character varying
      ]::text[]
    )
  );
