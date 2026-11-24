-- Safely activate existing Resident accounts stuck in pending_verification
-- Preserves IDs, emails, password hashes, roles, and profiles.
-- Does not touch Administrator/Responder accounts or rejected/suspended/deactivated accounts.

WITH migrated AS (
  UPDATE users
     SET status = 'active',
         account_status = 'active',
         updated_at = NOW()
   WHERE role_id = 3
     AND LOWER(role) = 'resident'
     AND (status = 'pending_verification' OR account_status = 'pending_verification')
  RETURNING id, user_code, email
)
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
SELECT
  id,
  'USER_STATUS_MIGRATED_ACTIVE',
  'USER_MANAGEMENT',
  CAST(id AS VARCHAR),
  jsonb_build_object(
    'user_code', user_code,
    'previous_status', 'pending_verification',
    'new_status', 'active',
    'reason', 'Removed Resident pending_verification requirement'
  )
FROM migrated;
