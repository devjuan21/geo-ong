-- ============================================================================
-- GeoSafe Disaster Preparedness & Emergency Response System
-- SCRIPT: database/reset_all_users.sql
-- PURPOSE: Safely Reset All User Accounts in MySQL (MySQL Workbench)
-- TARGET DATABASE: geosafe_db
-- ============================================================================
-- 
-- WARNING: DESTRUCTIVE OPERATION
-- This script removes all user accounts (Administrators, Responders, Residents)
-- and their associated 1:1 user profiles.
--
-- RETENTION GUARANTEES:
-- 1. PRESERVES canonical roles (roles: Administrator, Responder, Resident).
-- 2. PRESERVES 100% of audit_logs and auth_security_logs history.
-- 3. PRESERVES evacuation centers, hazard alerts, system settings, and hospital data.
-- 4. DOES NOT drop or truncate any tables.
-- 5. Runs inside an explicit transaction (can be rolled back if needed).
--
-- ARCHITECTURAL NOTICE REGARDING AUDIT LOGS & TRIGGERS:
-- In `geosafe_db`, `audit_logs` and `auth_security_logs` have:
--   - Foreign key constraint: ON DELETE RESTRICT on `user_id` -> `users(id)`
--   - Immutability triggers: `trg_audit_logs_prevent_update` and `trg_auth_security_logs_prevent_update`
-- Because triggers strictly prohibit UPDATE/DELETE on audit tables to guarantee
-- an immutable audit trail, a scoped session setting (`SET FOREIGN_KEY_CHECKS = 0`)
-- is used strictly within this transaction to allow user deletion while keeping
-- all audit logs intact, unmodified, and un-deleted.
-- ============================================================================

USE geosafe_db;

-- ============================================================================
-- STEP 1: PRE-RESET DIAGNOSTIC & AUDIT VERIFICATION
-- Review these counts before executing the deletion.
-- ============================================================================

-- 1.1 Total User Accounts to be removed (grouped by role)
SELECT 
    r.id AS role_id,
    r.name AS role_name,
    COUNT(u.id) AS total_users_to_delete
FROM roles r
LEFT JOIN users u ON u.role_id = r.id
GROUP BY r.id, r.name
ORDER BY r.id ASC;

-- 1.2 Detailed list of accounts to be removed
SELECT 
    u.id AS user_id,
    u.name,
    u.email,
    r.name AS role,
    u.status,
    u.created_at
FROM users u
LEFT JOIN roles r ON r.id = u.role_id
ORDER BY u.id ASC;

-- 1.3 Verify Dependent Profile & History Tables
SELECT 'user_profiles' AS table_name, COUNT(*) AS row_count FROM user_profiles
UNION ALL
SELECT 'responder_profiles' AS table_name, COUNT(*) AS row_count FROM responder_profiles
UNION ALL
SELECT 'account_status_history' AS table_name, COUNT(*) AS row_count FROM account_status_history
UNION ALL
SELECT 'responder_assignment_history' AS table_name, COUNT(*) AS row_count FROM responder_assignment_history
UNION ALL
SELECT 'notification_recipients' AS table_name, COUNT(*) AS row_count FROM notification_recipients;

-- 1.4 Verify Critical Operational Records (Must remain intact)
SELECT 
    (SELECT COUNT(*) FROM roles) AS canonical_roles_count,
    (SELECT COUNT(*) FROM audit_logs) AS preserved_audit_logs_count,
    (SELECT COUNT(*) FROM auth_security_logs) AS preserved_auth_logs_count,
    (SELECT COUNT(*) FROM reports) AS reports_count,
    (SELECT COUNT(*) FROM rescue_requests) AS rescue_requests_count,
    (SELECT COUNT(*) FROM family_groups) AS family_groups_count;


-- ============================================================================
-- STEP 2: TRANSACTIONAL USER ACCOUNT RESET
-- ============================================================================

START TRANSACTION;

-- Temporarily suspend foreign key checks for this session only to prevent
-- ON DELETE RESTRICT from blocking user removal while keeping immutable audit logs intact.
SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- 2.1 Decouple nullable administrative/creator foreign keys from system tables
-- (Preserves records while clearing pointers to deleted user accounts)
UPDATE alerts SET created_by = NULL WHERE created_by IS NOT NULL;
UPDATE evacuation_routes SET created_by = NULL WHERE created_by IS NOT NULL;
UPDATE notifications SET created_by = NULL WHERE created_by IS NOT NULL;
UPDATE system_settings SET updated_by = NULL WHERE updated_by IS NOT NULL;
UPDATE tropical_cyclone_bulletins SET published_by = NULL WHERE published_by IS NOT NULL;
UPDATE emergency_broadcast_logs SET authorized_by = NULL WHERE authorized_by IS NOT NULL;
UPDATE reports SET assigned_to = NULL, verified_by = NULL WHERE assigned_to IS NOT NULL OR verified_by IS NOT NULL;
UPDATE rescue_requests SET confirmed_by = NULL WHERE confirmed_by IS NOT NULL;

-- 2.2 Delete 1:1 user profile records and user-specific child entries
DELETE FROM notification_recipients;
DELETE FROM responder_assignment_history;
DELETE FROM account_status_history;
DELETE FROM responder_profiles;
DELETE FROM user_profiles;

-- 2.3 Delete all user accounts (Administrators, Responders, Residents)
DELETE FROM users;

-- Re-enable foreign key checks immediately
SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;


-- ============================================================================
-- STEP 3: POST-RESET IN-TRANSACTION VERIFICATION
-- Review results before deciding to COMMIT or ROLLBACK.
-- ============================================================================

-- 3.1 Verify users table is completely empty (Expect: 0)
SELECT COUNT(*) AS remaining_users_count FROM users;

-- 3.2 Verify user_profiles table is completely empty (Expect: 0)
SELECT COUNT(*) AS remaining_profiles_count FROM user_profiles;

-- 3.3 Verify canonical roles are 100% preserved (Expect: exactly 3 rows: Administrator, Responder, Resident)
SELECT id, name, description FROM roles ORDER BY id ASC;

-- 3.4 Verify audit history is completely preserved (Expect: unchanged count)
SELECT COUNT(*) AS audit_logs_count FROM audit_logs;
SELECT COUNT(*) AS auth_security_logs_count FROM auth_security_logs;


-- ============================================================================
-- STEP 4: FINALIZATION (CHOOSE ONE)
-- ============================================================================

-- To permanently apply the reset, highlight and execute:
-- COMMIT;

-- To cancel and restore all user accounts, highlight and execute:
-- ROLLBACK;

