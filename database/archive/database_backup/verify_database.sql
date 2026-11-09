-- ============================================================================
-- GeoSafe Emergency Assistance & Disaster Reporting System
-- Comprehensive Read-Only Database Verification & Consistency Audit Script
-- Database: geosafe_db
-- Target Server: MySQL 8.0+ / 8.4 LTS
-- Mode: STRICTLY READ-ONLY (Zero schema or data modifications; safe in all environments)
-- ============================================================================

USE geosafe_db;

-- ============================================================================
-- SECTION 1: DATABASE STRUCTURE — 38 CORE TABLES, ENGINE, COLLATION & EXTRAS
-- ============================================================================

-- 1.1 Verify all 38 expected core tables, storage engine (InnoDB), and collation
SELECT
  expected.expected_table AS table_name,
  COALESCE(t.table_type, 'MISSING') AS table_type,
  COALESCE(t.engine, 'MISSING') AS engine,
  COALESCE(t.table_collation, 'MISSING') AS collation,
  CASE
    WHEN t.table_name IS NULL THEN 'FAIL: Missing required core table'
    WHEN t.table_type <> 'BASE TABLE' THEN CONCAT('FAIL: Expected BASE TABLE but found ', t.table_type)
    WHEN t.engine <> 'InnoDB' THEN CONCAT('FAIL: Expected InnoDB engine but found ', COALESCE(t.engine, 'NULL'))
    WHEN t.table_collation NOT LIKE 'utf8mb4%' THEN CONCAT('WARNING: Non-utf8mb4 collation (', t.table_collation, ')')
    ELSE 'PASS'
  END AS verification_status
FROM (
  SELECT 'roles' AS expected_table UNION ALL
  SELECT 'users' UNION ALL
  SELECT 'user_profiles' UNION ALL
  SELECT 'responder_profiles' UNION ALL
  SELECT 'account_status_history' UNION ALL
  SELECT 'auth_security_logs' UNION ALL
  SELECT 'incident_categories' UNION ALL
  SELECT 'incident_reports' UNION ALL
  SELECT 'reports' UNION ALL
  SELECT 'incident_attachments' UNION ALL
  SELECT 'incident_status_history' UNION ALL
  SELECT 'incident_assignments' UNION ALL
  SELECT 'incident_updates' UNION ALL
  SELECT 'rescue_requests' UNION ALL
  SELECT 'rescue_assignments' UNION ALL
  SELECT 'rescue_attachments' UNION ALL
  SELECT 'rescue_updates' UNION ALL
  SELECT 'rescue_status_history' UNION ALL
  SELECT 'responder_assignment_history' UNION ALL
  SELECT 'family_groups' UNION ALL
  SELECT 'family_members' UNION ALL
  SELECT 'family_invitations' UNION ALL
  SELECT 'family_join_requests' UNION ALL
  SELECT 'family_location_sharing_consents' UNION ALL
  SELECT 'family_location_updates' UNION ALL
  SELECT 'evacuation_centers' UNION ALL
  SELECT 'evacuation_center_facilities' UNION ALL
  SELECT 'evacuation_routes' UNION ALL
  SELECT 'evacuation_route_waypoints' UNION ALL
  SELECT 'hospitals' UNION ALL
  SELECT 'notifications' UNION ALL
  SELECT 'notification_recipients' UNION ALL
  SELECT 'emergency_broadcast_logs' UNION ALL
  SELECT 'alerts' UNION ALL
  SELECT 'weather_cache' UNION ALL
  SELECT 'tropical_cyclone_bulletins' UNION ALL
  SELECT 'system_settings' UNION ALL
  SELECT 'audit_logs'
) expected
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'geosafe_db' AND t.table_name = expected.expected_table
ORDER BY expected.expected_table;

-- 1.2 Detect unexpected extra tables or views (duplicate structures or rogue objects)
SELECT
  t.table_name AS object_name,
  t.table_type AS object_type,
  CASE
    WHEN t.table_name = 'incident_migration_map' AND t.table_type = 'BASE TABLE'
      THEN 'PASS: Authorized Migration 004 incident mapping audit table'
    WHEN t.table_type = 'VIEW'
      THEN 'FAIL: Unexpected VIEW detected (views must not replace canonical tables)'
    ELSE 'WARNING / MANUAL REVIEW REQUIRED: Unexpected table in geosafe_db schema'
  END AS verification_status
FROM information_schema.tables t
WHERE t.table_schema = 'geosafe_db'
  AND t.table_name NOT IN (
    'roles', 'users', 'user_profiles', 'responder_profiles', 'account_status_history',
    'auth_security_logs', 'incident_categories', 'incident_reports', 'reports',
    'incident_attachments', 'incident_status_history', 'incident_assignments',
    'incident_updates', 'rescue_requests', 'rescue_assignments', 'rescue_attachments',
    'rescue_updates', 'rescue_status_history', 'responder_assignment_history',
    'family_groups', 'family_members', 'family_invitations', 'family_join_requests',
    'family_location_sharing_consents', 'family_location_updates', 'evacuation_centers',
    'evacuation_center_facilities', 'evacuation_routes', 'evacuation_route_waypoints',
    'hospitals', 'notifications', 'notification_recipients', 'emergency_broadcast_logs',
    'alerts', 'weather_cache', 'tropical_cyclone_bulletins', 'system_settings', 'audit_logs'
  )
ORDER BY t.table_name;

-- 1.3 Verify Primary Keys on all 38 core tables
SELECT
  expected.expected_table AS table_name,
  COALESCE(kcu.column_name, 'MISSING') AS primary_key_column,
  CASE
    WHEN kcu.column_name = 'id' THEN 'PASS: Primary key (id) verified'
    WHEN kcu.column_name IS NOT NULL THEN CONCAT('WARNING: Non-standard PK column (', kcu.column_name, ')')
    ELSE 'FAIL: Missing PRIMARY KEY constraint'
  END AS verification_status
FROM (
  SELECT 'roles' AS expected_table UNION ALL SELECT 'users' UNION ALL
  SELECT 'user_profiles' UNION ALL SELECT 'responder_profiles' UNION ALL
  SELECT 'account_status_history' UNION ALL SELECT 'auth_security_logs' UNION ALL
  SELECT 'incident_categories' UNION ALL SELECT 'incident_reports' UNION ALL
  SELECT 'reports' UNION ALL SELECT 'incident_attachments' UNION ALL
  SELECT 'incident_status_history' UNION ALL SELECT 'incident_assignments' UNION ALL
  SELECT 'incident_updates' UNION ALL SELECT 'rescue_requests' UNION ALL
  SELECT 'rescue_assignments' UNION ALL SELECT 'rescue_attachments' UNION ALL
  SELECT 'rescue_updates' UNION ALL SELECT 'rescue_status_history' UNION ALL
  SELECT 'responder_assignment_history' UNION ALL SELECT 'family_groups' UNION ALL
  SELECT 'family_members' UNION ALL SELECT 'family_invitations' UNION ALL
  SELECT 'family_join_requests' UNION ALL SELECT 'family_location_sharing_consents' UNION ALL
  SELECT 'family_location_updates' UNION ALL SELECT 'evacuation_centers' UNION ALL
  SELECT 'evacuation_center_facilities' UNION ALL SELECT 'evacuation_routes' UNION ALL
  SELECT 'evacuation_route_waypoints' UNION ALL SELECT 'hospitals' UNION ALL
  SELECT 'notifications' UNION ALL SELECT 'notification_recipients' UNION ALL
  SELECT 'emergency_broadcast_logs' UNION ALL SELECT 'alerts' UNION ALL
  SELECT 'weather_cache' UNION ALL SELECT 'tropical_cyclone_bulletins' UNION ALL
  SELECT 'system_settings' UNION ALL SELECT 'audit_logs'
) expected
LEFT JOIN information_schema.key_column_usage kcu
  ON kcu.table_schema = 'geosafe_db'
 AND kcu.table_name = expected.expected_table
 AND kcu.constraint_name = 'PRIMARY'
ORDER BY expected.expected_table;

-- 1.4 Verify Critical Columns, Data Types, Nullability, and Defaults Across Modules
SELECT
  spec.tbl AS table_name,
  spec.col AS column_name,
  spec.exp_type AS expected_data_type,
  COALESCE(c.data_type, 'MISSING') AS actual_data_type,
  spec.exp_null AS expected_nullable,
  COALESCE(c.is_nullable, 'MISSING') AS actual_nullable,
  COALESCE(spec.exp_default, '(NULL/NONE)') AS expected_default,
  COALESCE(c.column_default, '(NULL/NONE)') AS actual_default,
  CASE
    WHEN c.column_name IS NULL THEN 'FAIL: Missing required column'
    WHEN LOWER(c.data_type) <> LOWER(spec.exp_type)
      THEN CONCAT('FAIL: Data type mismatch (expected ', spec.exp_type, ', found ', c.data_type, ')')
    WHEN c.is_nullable <> spec.exp_null
      THEN CONCAT('FAIL: Nullability mismatch (expected IS_NULLABLE=', spec.exp_null, ', found ', c.is_nullable, ')')
    WHEN spec.check_default = 1 AND NOT (c.column_default <=> spec.exp_default)
      THEN CONCAT('FAIL: Default value mismatch (expected ', COALESCE(spec.exp_default, 'NULL'), ', found ', COALESCE(c.column_default, 'NULL'), ')')
    ELSE 'PASS'
  END AS verification_status
FROM (
  -- Roles & Users
  SELECT 'roles' AS tbl, 'name' AS col, 'varchar' AS exp_type, 'NO' AS exp_null, NULL AS exp_default, 0 AS check_default UNION ALL
  SELECT 'users', 'email', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'users', 'password_hash', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'users', 'role_id', 'int', 'NO', NULL, 0 UNION ALL
  SELECT 'users', 'role', 'enum', 'YES', NULL, 1 UNION ALL
  SELECT 'users', 'status', 'enum', 'NO', 'active', 1 UNION ALL
  SELECT 'users', 'safety_status', 'enum', 'NO', 'no_response', 1 UNION ALL
  SELECT 'users', 'last_latitude', 'decimal', 'YES', NULL, 1 UNION ALL
  SELECT 'users', 'last_longitude', 'decimal', 'YES', NULL, 1 UNION ALL
  SELECT 'users', 'family_group_id', 'int', 'YES', NULL, 1 UNION ALL
  SELECT 'users', 'reset_token_hash', 'varchar', 'YES', NULL, 1 UNION ALL
  SELECT 'user_profiles', 'verification_status', 'enum', 'NO', 'Unverified Resident', 1 UNION ALL
  SELECT 'responder_profiles', 'badge_number', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'responder_profiles', 'availability_status', 'enum', 'NO', 'Off Duty', 1 UNION ALL
  -- Canonical Incidents (reports)
  SELECT 'reports', 'reference_number', 'varchar', 'YES', NULL, 0 UNION ALL
  SELECT 'reports', 'user_id', 'int', 'NO', NULL, 0 UNION ALL
  SELECT 'reports', 'category_id', 'int', 'YES', NULL, 0 UNION ALL
  SELECT 'reports', 'incident_type', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'reports', 'title', 'varchar', 'YES', NULL, 0 UNION ALL
  SELECT 'reports', 'description', 'text', 'NO', NULL, 0 UNION ALL
  SELECT 'reports', 'latitude', 'decimal', 'NO', NULL, 0 UNION ALL
  SELECT 'reports', 'longitude', 'decimal', 'NO', NULL, 0 UNION ALL
  SELECT 'reports', 'severity', 'enum', 'NO', 'medium', 1 UNION ALL
  SELECT 'reports', 'status', 'enum', 'NO', 'pending', 1 UNION ALL
  SELECT 'reports', 'assigned_to', 'int', 'YES', NULL, 1 UNION ALL
  SELECT 'reports', 'verified_by', 'int', 'YES', NULL, 1 UNION ALL
  SELECT 'incident_assignments', 'report_id', 'int', 'NO', NULL, 0 UNION ALL
  SELECT 'incident_assignments', 'responder_user_id', 'int', 'NO', NULL, 0 UNION ALL
  SELECT 'incident_updates', 'report_id', 'int', 'NO', NULL, 0 UNION ALL
  SELECT 'incident_updates', 'is_internal_only', 'tinyint', 'NO', '0', 1 UNION ALL
  -- Rescue Requests
  SELECT 'rescue_requests', 'reference_number', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'rescue_requests', 'priority', 'enum', 'NO', NULL, 1 UNION ALL
  SELECT 'rescue_requests', 'status', 'enum', 'NO', 'Pending Dispatch', 1 UNION ALL
  SELECT 'rescue_requests', 'confirmed_resolved_at', 'timestamp', 'YES', NULL, 1 UNION ALL
  SELECT 'rescue_requests', 'resident_confirmed_at', 'timestamp', 'YES', NULL, 1 UNION ALL
  -- Family Address & Membership
  SELECT 'family_groups', 'family_name', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'family_groups', 'created_by', 'int', 'NO', NULL, 0 UNION ALL
  SELECT 'family_groups', 'house_number', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'family_groups', 'street', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'family_groups', 'barangay', 'varchar', 'NO', 'Bayanan', 1 UNION ALL
  SELECT 'family_groups', 'city', 'varchar', 'NO', 'Muntinlupa City', 1 UNION ALL
  SELECT 'family_groups', 'province', 'varchar', 'NO', 'Metro Manila', 1 UNION ALL
  SELECT 'family_groups', 'region', 'varchar', 'NO', 'National Capital Region', 1 UNION ALL
  SELECT 'family_groups', 'country', 'varchar', 'NO', 'Philippines', 1 UNION ALL
  SELECT 'family_groups', 'status', 'enum', 'NO', 'active', 1 UNION ALL
  SELECT 'family_members', 'family_id', 'int', 'NO', NULL, 0 UNION ALL
  SELECT 'family_members', 'user_id', 'int', 'NO', NULL, 0 UNION ALL
  SELECT 'family_members', 'membership_role', 'enum', 'NO', 'member', 1 UNION ALL
  SELECT 'family_members', 'membership_status', 'enum', 'NO', 'active', 1 UNION ALL
  SELECT 'family_members', 'active_user_id', 'int', 'YES', NULL, 0 UNION ALL
  SELECT 'family_invitations', 'token_hash', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'family_invitations', 'expires_at', 'timestamp', 'NO', NULL, 0 UNION ALL
  SELECT 'family_invitations', 'revoked_at', 'timestamp', 'YES', NULL, 1 UNION ALL
  SELECT 'family_join_requests', 'invitation_id', 'int', 'NO', NULL, 0 UNION ALL
  SELECT 'family_join_requests', 'relationship', 'varchar', 'NO', 'Member', 1 UNION ALL
  SELECT 'family_join_requests', 'request_status', 'enum', 'NO', 'pending', 1 UNION ALL
  SELECT 'family_location_sharing_consents', 'sharing_enabled', 'tinyint', 'NO', '0', 1 UNION ALL
  SELECT 'family_location_sharing_consents', 'consented_at', 'timestamp', 'YES', NULL, 1 UNION ALL
  SELECT 'family_location_sharing_consents', 'revoked_at', 'timestamp', 'YES', NULL, 1 UNION ALL
  SELECT 'family_location_updates', 'safety_status', 'enum', 'NO', 'no_response', 1 UNION ALL
  -- Evacuation, Hospitals, Weather & Alerts
  SELECT 'evacuation_centers', 'status', 'enum', 'NO', 'Standby', 1 UNION ALL
  SELECT 'evacuation_routes', 'route_status', 'enum', 'NO', 'under_review', 1 UNION ALL
  SELECT 'evacuation_routes', 'is_official_approved', 'tinyint', 'NO', '0', 1 UNION ALL
  SELECT 'hospitals', 'status', 'enum', 'NO', 'Under Assessment', 1 UNION ALL
  SELECT 'weather_cache', 'provider_name', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'weather_cache', 'data_type', 'enum', 'NO', 'observation', 1 UNION ALL
  SELECT 'weather_cache', 'source_attribution', 'varchar', 'YES', NULL, 1 UNION ALL
  SELECT 'weather_cache', 'expires_at', 'timestamp', 'NO', NULL, 0 UNION ALL
  SELECT 'tropical_cyclone_bulletins', 'is_active', 'tinyint', 'NO', '0', 1 UNION ALL
  SELECT 'system_settings', 'setting_key', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'system_settings', 'is_protected', 'tinyint', 'NO', '1', 1
) spec
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'geosafe_db'
 AND c.table_name = spec.tbl
 AND c.column_name = spec.col
ORDER BY spec.tbl, spec.col;

-- 1.5 Verify Required Unique Indexes Across Schema
SELECT
  req.tbl AS table_name,
  req.col_list AS expected_unique_columns,
  COALESCE(actual.index_name, 'MISSING') AS index_name,
  CASE
    WHEN actual.index_name IS NOT NULL THEN 'PASS: Unique constraint verified'
    ELSE 'FAIL: Missing required unique index'
  END AS verification_status
FROM (
  SELECT 'roles' AS tbl, 'name' AS col_list UNION ALL
  SELECT 'users', 'email' UNION ALL
  SELECT 'user_profiles', 'user_id' UNION ALL
  SELECT 'responder_profiles', 'user_id' UNION ALL
  SELECT 'responder_profiles', 'badge_number' UNION ALL
  SELECT 'incident_categories', 'name' UNION ALL
  SELECT 'reports', 'reference_number' UNION ALL
  SELECT 'rescue_requests', 'reference_number' UNION ALL
  SELECT 'evacuation_centers', 'name' UNION ALL
  SELECT 'hospitals', 'name' UNION ALL
  SELECT 'family_members', 'active_user_id' UNION ALL
  SELECT 'family_members', 'family_id,user_id' UNION ALL
  SELECT 'family_invitations', 'token_hash' UNION ALL
  SELECT 'family_location_sharing_consents', 'family_member_id' UNION ALL
  SELECT 'system_settings', 'setting_key'
) req
LEFT JOIN (
  SELECT
    table_name,
    index_name,
    GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS col_list
  FROM information_schema.statistics
  WHERE table_schema = 'geosafe_db'
    AND non_unique = 0
    AND index_name <> 'PRIMARY'
  GROUP BY table_name, index_name
) actual
  ON actual.table_name = req.tbl AND actual.col_list = req.col_list
ORDER BY req.tbl, req.col_list;

-- 1.6 Verify All Required Database Triggers (27 Triggers)
SELECT
  req.trig_name AS trigger_name,
  req.tbl AS target_table,
  req.timing AS expected_timing,
  req.evt AS expected_event,
  CASE
    WHEN tr.trigger_name IS NULL THEN 'FAIL: Missing required database trigger'
    WHEN tr.action_timing <> req.timing OR tr.event_manipulation <> req.evt
      THEN CONCAT('FAIL: Trigger timing/event mismatch (found ', tr.action_timing, ' ', tr.event_manipulation, ')')
    ELSE 'PASS'
  END AS verification_status
FROM (
  SELECT 'trg_family_groups_fixed_location_insert' AS trig_name, 'family_groups' AS tbl, 'BEFORE' AS timing, 'INSERT' AS evt UNION ALL
  SELECT 'trg_family_groups_fixed_location_update', 'family_groups', 'BEFORE', 'UPDATE' UNION ALL
  SELECT 'trg_family_groups_sync_status_update', 'family_groups', 'AFTER', 'UPDATE' UNION ALL
  SELECT 'trg_family_invitations_validate_insert', 'family_invitations', 'BEFORE', 'INSERT' UNION ALL
  SELECT 'trg_family_consent_validate_insert', 'family_location_sharing_consents', 'BEFORE', 'INSERT' UNION ALL
  SELECT 'trg_family_consent_validate_update', 'family_location_sharing_consents', 'BEFORE', 'UPDATE' UNION ALL
  SELECT 'trg_family_location_updates_require_consent', 'family_location_updates', 'BEFORE', 'INSERT' UNION ALL
  SELECT 'trg_users_sync_role_insert', 'users', 'BEFORE', 'INSERT' UNION ALL
  SELECT 'trg_users_sync_role_update', 'users', 'BEFORE', 'UPDATE' UNION ALL
  SELECT 'trg_family_members_sync_user_insert', 'family_members', 'AFTER', 'INSERT' UNION ALL
  SELECT 'trg_family_members_sync_user_update', 'family_members', 'AFTER', 'UPDATE' UNION ALL
  SELECT 'trg_family_members_sync_user_delete', 'family_members', 'AFTER', 'DELETE' UNION ALL
  SELECT 'trg_incident_reports_freeze_insert', 'incident_reports', 'BEFORE', 'INSERT' UNION ALL
  SELECT 'trg_incident_reports_freeze_update', 'incident_reports', 'BEFORE', 'UPDATE' UNION ALL
  SELECT 'trg_incident_reports_freeze_delete', 'incident_reports', 'BEFORE', 'DELETE' UNION ALL
  SELECT 'trg_audit_logs_prevent_delete', 'audit_logs', 'BEFORE', 'DELETE' UNION ALL
  SELECT 'trg_auth_security_logs_prevent_delete', 'auth_security_logs', 'BEFORE', 'DELETE' UNION ALL
  SELECT 'trg_account_status_history_prevent_delete', 'account_status_history', 'BEFORE', 'DELETE' UNION ALL
  SELECT 'trg_incident_status_history_prevent_delete', 'incident_status_history', 'BEFORE', 'DELETE' UNION ALL
  SELECT 'trg_rescue_status_history_prevent_delete', 'rescue_status_history', 'BEFORE', 'DELETE' UNION ALL
  SELECT 'trg_emergency_broadcast_logs_prevent_delete', 'emergency_broadcast_logs', 'BEFORE', 'DELETE' UNION ALL
  SELECT 'trg_audit_logs_prevent_update', 'audit_logs', 'BEFORE', 'UPDATE' UNION ALL
  SELECT 'trg_auth_security_logs_prevent_update', 'auth_security_logs', 'BEFORE', 'UPDATE' UNION ALL
  SELECT 'trg_account_status_history_prevent_update', 'account_status_history', 'BEFORE', 'UPDATE' UNION ALL
  SELECT 'trg_incident_status_history_prevent_update', 'incident_status_history', 'BEFORE', 'UPDATE' UNION ALL
  SELECT 'trg_rescue_status_history_prevent_update', 'rescue_status_history', 'BEFORE', 'UPDATE' UNION ALL
  SELECT 'trg_emergency_broadcast_logs_prevent_update', 'emergency_broadcast_logs', 'BEFORE', 'UPDATE'
) req
LEFT JOIN information_schema.triggers tr
  ON tr.trigger_schema = 'geosafe_db'
 AND tr.trigger_name = req.trig_name
 AND tr.event_object_table = req.tbl
ORDER BY req.tbl, req.trig_name;

-- ============================================================================
-- SECTION 2: ROLES AND USERS VERIFICATION
-- ============================================================================

-- 2.1 Verify Roles Table (Strictly 3 Authorized Roles: Administrator, Responder, Resident)
SELECT
  id,
  name AS role_name,
  description,
  CASE
    WHEN (id = 1 AND name = 'Administrator')
      OR (id = 2 AND name = 'Responder')
      OR (id = 3 AND name = 'Resident')
      THEN 'PASS: Authorized canonical role'
    ELSE 'FAIL: Unauthorized role or non-canonical ID mapping'
  END AS role_row_status
FROM roles
ORDER BY id;

SELECT
  COUNT(*) AS total_roles,
  SUM(CASE WHEN (id = 1 AND name = 'Administrator')
             OR (id = 2 AND name = 'Responder')
             OR (id = 3 AND name = 'Resident') THEN 1 ELSE 0 END) AS authorized_roles_matched,
  CASE
    WHEN COUNT(*) = 3
     AND SUM(CASE WHEN (id = 1 AND name = 'Administrator')
                    OR (id = 2 AND name = 'Responder')
                    OR (id = 3 AND name = 'Resident') THEN 1 ELSE 0 END) = 3
      THEN 'PASS: Exactly 3 canonical roles verified (1=Administrator, 2=Responder, 3=Resident)'
    WHEN COUNT(*) < 3 THEN 'FAIL: Missing required canonical role(s)'
    ELSE 'FAIL: Unauthorized additional role(s) or mismatched IDs in roles table'
  END AS role_whitelist_verification
FROM roles;

-- 2.2 Verify User-to-Role Reference & Synchronization Integrity
SELECT
  COUNT(*) AS total_users,
  SUM(CASE WHEN r.id IS NULL OR u.role_id NOT IN (1, 2, 3) THEN 1 ELSE 0 END) AS invalid_role_id_users,
  SUM(CASE WHEN u.role IS NULL
             OR (u.role_id = 1 AND u.role <> 'admin')
             OR (u.role_id = 2 AND u.role <> 'responder')
             OR (u.role_id = 3 AND u.role <> 'resident') THEN 1 ELSE 0 END) AS desynchronized_role_users,
  CASE
    WHEN SUM(CASE WHEN r.id IS NULL OR u.role_id NOT IN (1, 2, 3) THEN 1 ELSE 0 END) > 0
      THEN 'FAIL: User(s) with invalid or unreferenced role_id detected'
    WHEN SUM(CASE WHEN u.role IS NULL
                    OR (u.role_id = 1 AND u.role <> 'admin')
                    OR (u.role_id = 2 AND u.role <> 'responder')
                    OR (u.role_id = 3 AND u.role <> 'resident') THEN 1 ELSE 0 END) > 0
      THEN 'FAIL: Mismatch between users.role_id and users.role detected'
    ELSE 'PASS: All users have valid, 100% synchronized role assignments'
  END AS user_role_verification
FROM users u
LEFT JOIN roles r ON u.role_id = r.id;

-- 2.3 List any individual user accounts with role inconsistencies (0 rows expected)
SELECT
  u.id AS user_id,
  u.email,
  u.role_id,
  r.name AS referenced_role_name,
  u.role AS legacy_role_enum,
  'FAIL: Inconsistent user role assignment requires manual review' AS issue
FROM users u
LEFT JOIN roles r ON u.role_id = r.id
WHERE r.id IS NULL
   OR u.role_id NOT IN (1, 2, 3)
   OR u.role IS NULL
   OR (u.role_id = 1 AND u.role <> 'admin')
   OR (u.role_id = 2 AND u.role <> 'responder')
   OR (u.role_id = 3 AND u.role <> 'resident');

-- 2.4 Detect any seeded test, demo, or sample accounts (0 rows expected)
SELECT
  id AS user_id,
  name,
  email,
  role_id,
  'FAIL: Test, demo, or placeholder account detected' AS verification_status
FROM users
WHERE LOWER(email) LIKE '%@geosafe.local%'
   OR LOWER(email) LIKE '%@example.%'
   OR LOWER(email) LIKE '%@test.%'
   OR LOWER(email) LIKE 'test%'
   OR LOWER(email) LIKE 'demo%'
   OR LOWER(email) LIKE 'sample%'
   OR LOWER(name) LIKE '%test user%'
   OR LOWER(name) LIKE '%demo %'
   OR LOWER(name) LIKE '%sample %';

-- ============================================================================
-- SECTION 3: FAMILY ADDRESS STRUCTURE & FIXED BARANGAY BAYANAN VERIFICATION
-- ============================================================================

-- 3.1 Verify Family Address Schema Columns & Fixed Location Defaults
SELECT
  column_name,
  column_type,
  is_nullable,
  column_default,
  CASE
    WHEN column_name = 'house_number' AND data_type = 'varchar' THEN 'PASS: Separate house_number input column (new rows enforced by trigger)'
    WHEN column_name = 'street' AND data_type = 'varchar' THEN 'PASS: Separate street input column (new rows enforced by trigger)'
    WHEN column_name = 'barangay' AND is_nullable = 'NO' AND column_default = 'Bayanan' THEN 'PASS: Fixed Barangay Bayanan enforced'
    WHEN column_name = 'city' AND is_nullable = 'NO' AND column_default = 'Muntinlupa City' THEN 'PASS: Fixed Muntinlupa City enforced'
    WHEN column_name = 'province' AND is_nullable = 'NO' AND column_default = 'Metro Manila' THEN 'PASS: Fixed Metro Manila compatibility default'
    WHEN column_name = 'region' AND is_nullable = 'NO' AND column_default = 'National Capital Region' THEN 'PASS: Fixed National Capital Region enforced'
    WHEN column_name = 'country' AND is_nullable = 'NO' AND column_default = 'Philippines' THEN 'PASS: Fixed Philippines enforced'
    WHEN column_name = 'subdivision_purok' AND is_nullable = 'YES' THEN 'PASS: Optional legacy column (not required)'
    ELSE 'FAIL: Family address column definition or default mismatch'
  END AS verification_status
FROM information_schema.columns
WHERE table_schema = 'geosafe_db'
  AND table_name = 'family_groups'
  AND column_name IN ('house_number', 'street', 'barangay', 'city', 'province', 'region', 'country', 'subdivision_purok')
ORDER BY ordinal_position;

-- 3.2 Verify Family Address Data Integrity (Completeness & Fixed Coverage)
SELECT
  COUNT(*) AS total_family_groups,
  SUM(CASE WHEN house_number IS NULL OR street IS NULL
             OR CHAR_LENGTH(TRIM(house_number)) = 0 OR CHAR_LENGTH(TRIM(street)) = 0
           THEN 1 ELSE 0 END) AS incomplete_or_blank_addresses,
  SUM(CASE WHEN barangay <> 'Bayanan'
             OR city <> 'Muntinlupa City'
             OR region <> 'National Capital Region'
             OR country <> 'Philippines'
           THEN 1 ELSE 0 END) AS non_bayanan_rows,
  CASE
    WHEN SUM(CASE WHEN house_number IS NULL OR street IS NULL
                    OR CHAR_LENGTH(TRIM(house_number)) = 0 OR CHAR_LENGTH(TRIM(street)) = 0
                  THEN 1 ELSE 0 END) > 0
      THEN 'FAIL: Blank, whitespace-only, or half-completed family address(es) detected'
    WHEN SUM(CASE WHEN barangay <> 'Bayanan'
                    OR city <> 'Muntinlupa City'
                    OR region <> 'National Capital Region'
                    OR country <> 'Philippines'
                  THEN 1 ELSE 0 END) > 0
      THEN 'MANUAL REVIEW REQUIRED: Pre-existing family_groups row(s) differ from fixed Barangay Bayanan coverage'
    ELSE 'PASS: All family addresses comply with house_number + street and fixed Barangay Bayanan coverage'
  END AS family_address_data_verification
FROM family_groups;

-- 3.3 List any family_groups rows requiring manual address review (0 rows expected)
SELECT
  id AS family_id,
  family_name,
  house_number,
  street,
  barangay,
  city,
  region,
  country,
  CASE
    WHEN house_number IS NULL OR street IS NULL
      OR CHAR_LENGTH(TRIM(house_number)) = 0 OR CHAR_LENGTH(TRIM(street)) = 0
      THEN 'FAIL: Incomplete or whitespace-only house_number/street'
    ELSE 'MANUAL REVIEW REQUIRED: Location differs from fixed Barangay Bayanan, Muntinlupa City coverage'
  END AS review_reason
FROM family_groups
WHERE house_number IS NULL OR street IS NULL
   OR CHAR_LENGTH(TRIM(house_number)) = 0 OR CHAR_LENGTH(TRIM(street)) = 0
   OR barangay <> 'Bayanan'
   OR city <> 'Muntinlupa City'
   OR region <> 'National Capital Region'
   OR country <> 'Philippines';

-- ============================================================================
-- SECTION 4: FAMILY MEMBERSHIP, QR INVITATIONS & PRIVACY CONSENT VERIFICATION
-- ============================================================================

-- 4.1 Verify Authoritative Family Membership Rules & Synchronization
SELECT
  (SELECT COUNT(*) FROM (
     SELECT user_id FROM family_members WHERE membership_status = 'active' GROUP BY user_id HAVING COUNT(*) > 1
   ) d) AS users_with_multiple_active_memberships,
  (SELECT COUNT(*) FROM users u
   LEFT JOIN (
     SELECT fm.user_id, fm.family_id
     FROM family_members fm
     JOIN family_groups fg ON fg.id = fm.family_id
     WHERE fm.membership_status = 'active' AND fg.status = 'active'
   ) auth_fm ON u.id = auth_fm.user_id
   WHERE NOT (u.family_group_id <=> auth_fm.family_id)) AS user_family_group_sync_mismatches,
  (SELECT COUNT(*) FROM family_groups fg
   WHERE fg.status = 'active'
     AND NOT EXISTS (
       SELECT 1 FROM family_members fm
       WHERE fm.family_id = fg.id AND fm.membership_status = 'active' AND fm.membership_role = 'manager'
     )) AS active_families_without_manager,
  (SELECT COUNT(*) FROM family_members fm
   JOIN family_groups fg ON fg.id = fm.family_id
   WHERE fm.membership_status = 'active' AND fg.status <> 'active') AS active_members_in_archived_groups,
  CASE
    WHEN (SELECT COUNT(*) FROM (
            SELECT user_id FROM family_members WHERE membership_status = 'active' GROUP BY user_id HAVING COUNT(*) > 1
          ) d) > 0
      THEN 'FAIL: User(s) with multiple active family memberships detected'
    WHEN (SELECT COUNT(*) FROM users u
          LEFT JOIN (
            SELECT fm.user_id, fm.family_id
            FROM family_members fm
            JOIN family_groups fg ON fg.id = fm.family_id
            WHERE fm.membership_status = 'active' AND fg.status = 'active'
          ) auth_fm ON u.id = auth_fm.user_id
          WHERE NOT (u.family_group_id <=> auth_fm.family_id)) > 0
      THEN 'FAIL: Desynchronized users.family_group_id detected'
    WHEN (SELECT COUNT(*) FROM family_groups fg
          WHERE fg.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM family_members fm
              WHERE fm.family_id = fg.id AND fm.membership_status = 'active' AND fm.membership_role = 'manager'
            )) > 0
      THEN 'FAIL: Active family group without an active manager detected'
    WHEN (SELECT COUNT(*) FROM family_members fm
          JOIN family_groups fg ON fg.id = fm.family_id
          WHERE fm.membership_status = 'active' AND fg.status <> 'active') > 0
      THEN 'WARNING: Active member row inside an archived family group'
    ELSE 'PASS: Authoritative family_members relationships and users.family_group_id are 100% consistent'
  END AS family_membership_verification;

-- 4.2 Verify QR Invitations & Join Request Workflow Integrity
SELECT
  (SELECT COUNT(*) FROM family_invitations
   WHERE token_hash IS NULL
      OR CHAR_LENGTH(token_hash) <> 64
      OR token_hash NOT REGEXP '^[0-9a-fA-F]{64}$') AS non_sha256_invitation_tokens,
  (SELECT COUNT(*) FROM family_invitations
   WHERE expires_at <= created_at) AS invalid_expiration_invitations,
  (SELECT COUNT(*) FROM family_join_requests
   WHERE request_status IN ('approved', 'rejected')
     AND (reviewed_by IS NULL OR reviewed_at IS NULL)) AS unreviewed_approved_or_rejected_requests,
  CASE
    WHEN (SELECT COUNT(*) FROM family_invitations
          WHERE token_hash IS NULL
             OR CHAR_LENGTH(token_hash) <> 64
             OR token_hash NOT REGEXP '^[0-9a-fA-F]{64}$') > 0
      THEN 'FAIL: Non-SHA-256 or raw invitation token detected in family_invitations'
    WHEN (SELECT COUNT(*) FROM family_invitations WHERE expires_at <= created_at) > 0
      THEN 'FAIL: Invitation with expires_at <= created_at detected'
    WHEN (SELECT COUNT(*) FROM family_join_requests
          WHERE request_status IN ('approved', 'rejected')
            AND (reviewed_by IS NULL OR reviewed_at IS NULL)) > 0
      THEN 'WARNING: Approved/rejected join request missing reviewer audit metadata'
    ELSE 'PASS: QR invitation token hashing, expiration, and join request workflow verified'
  END AS invitation_and_join_request_verification;

-- 4.3 Verify Explicit Location-Sharing Consent & Privacy Rules
SELECT
  (SELECT COUNT(*) FROM family_location_sharing_consents
   WHERE sharing_enabled = 1 AND consented_at IS NULL) AS enabled_consents_missing_timestamp,
  (SELECT COUNT(*) FROM family_members fm
   JOIN family_location_sharing_consents flc ON flc.family_member_id = fm.id
   WHERE fm.membership_status <> 'active' AND flc.sharing_enabled = 1) AS inactive_members_still_sharing,
  CASE
    WHEN (SELECT COUNT(*) FROM family_location_sharing_consents
          WHERE sharing_enabled = 1 AND consented_at IS NULL) > 0
      THEN 'FAIL: Location sharing enabled without explicit consented_at timestamp'
    WHEN (SELECT COUNT(*) FROM family_members fm
          JOIN family_location_sharing_consents flc ON flc.family_member_id = fm.id
          WHERE fm.membership_status <> 'active' AND flc.sharing_enabled = 1) > 0
      THEN 'FAIL: Inactive or removed family member still has sharing_enabled = 1'
    ELSE 'PASS: Explicit revocable location-sharing consent verified'
  END AS location_consent_verification;

-- ============================================================================
-- SECTION 5: INCIDENT RELATIONSHIPS & LEGACY TABLE DEPENDENCY AUDIT
-- ============================================================================

-- 5.1 Check all foreign keys referencing either `reports` or legacy `incident_reports`
SELECT
  kcu.table_name AS child_table,
  kcu.column_name AS fk_column,
  kcu.constraint_name,
  kcu.referenced_table_name AS referenced_incident_table,
  rc.delete_rule AS on_delete_rule,
  CASE
    WHEN kcu.referenced_table_name = 'incident_reports'
      THEN 'FAIL: Child table still references legacy incident_reports instead of canonical reports'
    WHEN kcu.referenced_table_name = 'reports'
     AND rc.delete_rule IN ('RESTRICT', 'NO ACTION')
      THEN 'PASS: Canonical reports(id) referenced with RESTRICT deletion'
    ELSE CONCAT('FAIL: Unexpected incident FK target or unsafe delete rule (', rc.delete_rule, ')')
  END AS verification_status
FROM information_schema.key_column_usage kcu
JOIN information_schema.referential_constraints rc
  ON kcu.constraint_name = rc.constraint_name
 AND kcu.constraint_schema = rc.constraint_schema
WHERE kcu.table_schema = 'geosafe_db'
  AND kcu.referenced_table_name IN ('reports', 'incident_reports')
ORDER BY kcu.table_name, kcu.column_name;

-- 5.2 Verify all 5 required incident child tables have active foreign keys to `reports(id)`
SELECT
  req.child_table,
  req.fk_col AS expected_fk_column,
  COALESCE(kcu.referenced_table_name, 'MISSING FK') AS actual_referenced_table,
  COALESCE(rc.delete_rule, 'MISSING FK') AS actual_delete_rule,
  CASE
    WHEN kcu.referenced_table_name = 'reports' AND rc.delete_rule = req.exp_del
      THEN 'PASS: Canonical incident relationship verified'
    WHEN kcu.referenced_table_name = 'incident_reports'
      THEN 'FAIL: Still pointing to legacy incident_reports'
    WHEN kcu.referenced_table_name IS NULL
      THEN 'FAIL: Missing foreign key to canonical reports(id)'
    ELSE CONCAT('FAIL: Delete rule is ', rc.delete_rule, ' (expected ', req.exp_del, ')')
  END AS verification_status
FROM (
  SELECT 'incident_attachments' AS child_table, 'incident_id' AS fk_col, 'RESTRICT' AS exp_del UNION ALL
  SELECT 'incident_status_history', 'incident_id', 'RESTRICT' UNION ALL
  SELECT 'incident_assignments', 'report_id', 'RESTRICT' UNION ALL
  SELECT 'incident_updates', 'report_id', 'RESTRICT' UNION ALL
  SELECT 'responder_assignment_history', 'incident_id', 'RESTRICT'
) req
LEFT JOIN information_schema.key_column_usage kcu
  ON kcu.table_schema = 'geosafe_db'
 AND kcu.table_name = req.child_table
 AND kcu.column_name = req.fk_col
 AND kcu.referenced_table_name IS NOT NULL
LEFT JOIN information_schema.referential_constraints rc
  ON rc.constraint_schema = kcu.table_schema
 AND rc.constraint_name = kcu.constraint_name
ORDER BY req.child_table;

-- 5.3 Check for orphaned child rows across all incident-related tables (0 expected)
SELECT 'incident_attachments' AS child_table, COUNT(*) AS orphan_rows,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL: Orphaned attachment rows found' END AS status
FROM incident_attachments c WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.id = c.incident_id)
UNION ALL
SELECT 'incident_status_history', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL: Orphaned status history rows found' END
FROM incident_status_history c WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.id = c.incident_id)
UNION ALL
SELECT 'incident_assignments', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL: Orphaned assignment rows found' END
FROM incident_assignments c WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.id = c.report_id)
UNION ALL
SELECT 'incident_updates', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL: Orphaned progress update rows found' END
FROM incident_updates c WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.id = c.report_id)
UNION ALL
SELECT 'responder_assignment_history (incident_id)', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL: Orphaned responder history incident references found' END
FROM responder_assignment_history c
WHERE c.incident_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.id = c.incident_id);

-- 5.4 Verify Legacy `incident_reports` Freeze Status & Migration Completeness
SELECT
  (SELECT COUNT(*) FROM incident_reports) AS legacy_incident_rows,
  (SELECT COUNT(*) FROM reports) AS canonical_report_rows,
  (SELECT COUNT(*) FROM information_schema.triggers
   WHERE trigger_schema = 'geosafe_db'
     AND event_object_table = 'incident_reports'
     AND trigger_name IN (
       'trg_incident_reports_freeze_insert',
       'trg_incident_reports_freeze_update',
       'trg_incident_reports_freeze_delete'
     )) AS freeze_triggers_installed,
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.triggers
          WHERE trigger_schema = 'geosafe_db'
            AND event_object_table = 'incident_reports'
            AND trigger_name IN (
              'trg_incident_reports_freeze_insert',
              'trg_incident_reports_freeze_update',
              'trg_incident_reports_freeze_delete'
            )) = 3
      THEN 'PASS: Legacy incident_reports is frozen read-only (all 3 reject-write triggers active)'
    ELSE 'FAIL: Legacy incident_reports is missing read-only freeze triggers (second write path risk)'
  END AS legacy_freeze_verification;

-- ============================================================================
-- SECTION 6: COMPREHENSIVE FOREIGN KEY & DELETION RULE AUDIT ACROSS ALL TABLES
-- ============================================================================

-- 6.1 Verify all 57 expected foreign keys enforce ON DELETE RESTRICT
SELECT
  req.tbl AS child_table,
  req.col AS fk_column,
  req.ref_tbl AS expected_parent_table,
  COALESCE(actual.referenced_table_name, 'MISSING') AS actual_parent_table,
  req.exp_del AS expected_on_delete,
  COALESCE(actual.delete_rule, 'MISSING') AS actual_on_delete,
  CASE
    WHEN actual.referenced_table_name IS NULL
      THEN 'FAIL: Missing required foreign key constraint'
    WHEN actual.referenced_table_name <> req.ref_tbl
      THEN CONCAT('FAIL: Foreign key references ', actual.referenced_table_name, ' instead of ', req.ref_tbl)
    WHEN actual.delete_rule <> req.exp_del
      THEN CONCAT('FAIL: ON DELETE rule is ', actual.delete_rule, ' (expected ', req.exp_del, ')')
    ELSE 'PASS'
  END AS verification_status
FROM (
  -- Module 1: Users & Profiles
  SELECT 'users' AS tbl, 'role_id' AS col, 'roles' AS ref_tbl, 'RESTRICT' AS exp_del UNION ALL
  SELECT 'users', 'family_group_id', 'family_groups', 'RESTRICT' UNION ALL
  SELECT 'user_profiles', 'user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'responder_profiles', 'user_id', 'users', 'RESTRICT' UNION ALL
  -- Module 2: Incidents
  SELECT 'reports', 'user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'reports', 'category_id', 'incident_categories', 'RESTRICT' UNION ALL
  SELECT 'reports', 'assigned_to', 'users', 'RESTRICT' UNION ALL
  SELECT 'reports', 'verified_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'incident_attachments', 'incident_id', 'reports', 'RESTRICT' UNION ALL
  SELECT 'incident_attachments', 'uploaded_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'incident_status_history', 'incident_id', 'reports', 'RESTRICT' UNION ALL
  SELECT 'incident_status_history', 'changed_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'incident_assignments', 'report_id', 'reports', 'RESTRICT' UNION ALL
  SELECT 'incident_assignments', 'responder_user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'incident_assignments', 'assigned_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'incident_updates', 'report_id', 'reports', 'RESTRICT' UNION ALL
  SELECT 'incident_updates', 'responder_user_id', 'users', 'RESTRICT' UNION ALL
  -- Module 3: Rescue Requests
  SELECT 'rescue_requests', 'user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'rescue_requests', 'confirmed_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'rescue_assignments', 'rescue_id', 'rescue_requests', 'RESTRICT' UNION ALL
  SELECT 'rescue_assignments', 'responder_user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'rescue_assignments', 'assigned_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'rescue_attachments', 'rescue_id', 'rescue_requests', 'RESTRICT' UNION ALL
  SELECT 'rescue_attachments', 'uploaded_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'rescue_updates', 'rescue_id', 'rescue_requests', 'RESTRICT' UNION ALL
  SELECT 'rescue_updates', 'responder_user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'rescue_status_history', 'rescue_id', 'rescue_requests', 'RESTRICT' UNION ALL
  SELECT 'rescue_status_history', 'changed_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'responder_assignment_history', 'responder_user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'responder_assignment_history', 'rescue_id', 'rescue_requests', 'RESTRICT' UNION ALL
  SELECT 'responder_assignment_history', 'incident_id', 'reports', 'RESTRICT' UNION ALL
  -- Module 4: Evacuation & Facilities
  SELECT 'evacuation_center_facilities', 'center_id', 'evacuation_centers', 'RESTRICT' UNION ALL
  SELECT 'evacuation_routes', 'destination_center_id', 'evacuation_centers', 'RESTRICT' UNION ALL
  SELECT 'evacuation_routes', 'created_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'evacuation_route_waypoints', 'route_id', 'evacuation_routes', 'RESTRICT' UNION ALL
  -- Module 5: Family Safety Tracker (Strict History Preservation: RESTRICT)
  SELECT 'family_groups', 'created_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'family_members', 'family_id', 'family_groups', 'RESTRICT' UNION ALL
  SELECT 'family_members', 'user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'family_invitations', 'family_id', 'family_groups', 'RESTRICT' UNION ALL
  SELECT 'family_invitations', 'created_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'family_join_requests', 'family_id', 'family_groups', 'RESTRICT' UNION ALL
  SELECT 'family_join_requests', 'user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'family_join_requests', 'invitation_id', 'family_invitations', 'RESTRICT' UNION ALL
  SELECT 'family_join_requests', 'reviewed_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'family_location_sharing_consents', 'family_member_id', 'family_members', 'RESTRICT' UNION ALL
  SELECT 'family_location_updates', 'family_member_id', 'family_members', 'RESTRICT' UNION ALL
  -- Module 6 & 7: Notifications, Weather, Broadcasts & Audit Logs
  SELECT 'notifications', 'created_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'notification_recipients', 'notification_id', 'notifications', 'RESTRICT' UNION ALL
  SELECT 'notification_recipients', 'user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'alerts', 'created_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'tropical_cyclone_bulletins', 'published_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'audit_logs', 'user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'account_status_history', 'user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'account_status_history', 'changed_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'auth_security_logs', 'user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'emergency_broadcast_logs', 'authorized_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'system_settings', 'updated_by', 'users', 'RESTRICT'
) req
LEFT JOIN (
  SELECT
    kcu.table_name,
    kcu.column_name,
    kcu.referenced_table_name,
    rc.delete_rule
  FROM information_schema.key_column_usage kcu
  JOIN information_schema.referential_constraints rc
    ON kcu.constraint_name = rc.constraint_name
   AND kcu.constraint_schema = rc.constraint_schema
  WHERE kcu.table_schema = 'geosafe_db'
) actual
  ON actual.table_name = req.tbl AND actual.column_name = req.col
ORDER BY req.tbl, req.col;

-- 6.2 Detect any remaining ON DELETE CASCADE or ON DELETE SET NULL anywhere in geosafe_db (0 expected)
SELECT
  rc.table_name AS child_table,
  rc.constraint_name,
  rc.referenced_table_name AS parent_table,
  rc.delete_rule,
  'FAIL: Non-RESTRICT deletion rule risks erasing historical records or attribution' AS verification_status
FROM information_schema.referential_constraints rc
WHERE rc.constraint_schema = 'geosafe_db'
  AND rc.delete_rule NOT IN ('RESTRICT', 'NO ACTION');

-- ============================================================================
-- SECTION 7: EVACUATION ROUTES & WEATHER CACHE STRUCTURE AUDIT
-- ============================================================================

-- 7.1 Verify Evacuation Routes Approval & Weather Cache Non-Deterministic Column Absence
SELECT
  (SELECT COUNT(*) FROM evacuation_routes
   WHERE is_official_approved = 1 AND (approval_authority IS NULL OR approved_at IS NULL)) AS routes_approved_without_metadata,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = 'geosafe_db' AND table_name = 'weather_cache' AND column_name = 'is_stale') AS weather_nondeterministic_stale_col,
  CASE
    WHEN (SELECT COUNT(*) FROM evacuation_routes
          WHERE is_official_approved = 1 AND (approval_authority IS NULL OR approved_at IS NULL)) > 0
      THEN 'FAIL: Evacuation route marked is_official_approved = 1 without approval_authority / approved_at'
    WHEN (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = 'geosafe_db' AND table_name = 'weather_cache' AND column_name = 'is_stale') > 0
      THEN 'FAIL: Nondeterministic generated column weather_cache.is_stale still present'
    ELSE 'PASS: Route approval controls and weather cache structure verified'
  END AS route_and_weather_verification;

-- ============================================================================
-- SECTION 8: FRESH INSTALLATION ZERO-OPERATIONAL-DATA AUDIT (37 TABLES)
-- ============================================================================
-- On a fresh installation, all 37 non-role tables below MUST have 0 rows.
-- Only the `roles` table (1=Administrator, 2=Responder, 3=Resident) is populated.

SELECT
  op.operational_table,
  op.record_count,
  op.category,
  CASE
    WHEN op.record_count = 0 THEN 'PASS: 0 records (Clean fresh installation)'
    ELSE CONCAT('FAIL: ', op.record_count, ' record(s) present in fresh database')
  END AS fresh_install_status
FROM (
  SELECT 'users' AS operational_table, COUNT(*) AS record_count, 'Actual User Accounts' AS category FROM users
  UNION ALL SELECT 'user_profiles', COUNT(*), 'Resident Profiles' FROM user_profiles
  UNION ALL SELECT 'responder_profiles', COUNT(*), 'Responder Profiles' FROM responder_profiles
  UNION ALL SELECT 'account_status_history', COUNT(*), 'Account Status Audit' FROM account_status_history
  UNION ALL SELECT 'auth_security_logs', COUNT(*), 'Auth & Security Events' FROM auth_security_logs
  UNION ALL SELECT 'incident_categories', COUNT(*), 'Incident Categories' FROM incident_categories
  UNION ALL SELECT 'reports', COUNT(*), 'Canonical Incident Reports' FROM reports
  UNION ALL SELECT 'incident_reports', COUNT(*), 'Legacy Incident Reports' FROM incident_reports
  UNION ALL SELECT 'incident_attachments', COUNT(*), 'Incident Attachments' FROM incident_attachments
  UNION ALL SELECT 'incident_status_history', COUNT(*), 'Incident Status History' FROM incident_status_history
  UNION ALL SELECT 'incident_assignments', COUNT(*), 'Responder Incident Assignments' FROM incident_assignments
  UNION ALL SELECT 'incident_updates', COUNT(*), 'Incident Progress Updates' FROM incident_updates
  UNION ALL SELECT 'rescue_requests', COUNT(*), 'Rescue Requests' FROM rescue_requests
  UNION ALL SELECT 'rescue_assignments', COUNT(*), 'Responder Rescue Assignments' FROM rescue_assignments
  UNION ALL SELECT 'rescue_attachments', COUNT(*), 'Rescue Attachments' FROM rescue_attachments
  UNION ALL SELECT 'rescue_updates', COUNT(*), 'Rescue Progress Updates' FROM rescue_updates
  UNION ALL SELECT 'rescue_status_history', COUNT(*), 'Rescue Status History' FROM rescue_status_history
  UNION ALL SELECT 'responder_assignment_history', COUNT(*), 'Responder Assignment Audit' FROM responder_assignment_history
  UNION ALL SELECT 'family_groups', COUNT(*), 'Family Groups' FROM family_groups
  UNION ALL SELECT 'family_members', COUNT(*), 'Family Memberships' FROM family_members
  UNION ALL SELECT 'family_invitations', COUNT(*), 'Family QR Invitations' FROM family_invitations
  UNION ALL SELECT 'family_join_requests', COUNT(*), 'Family Join Requests' FROM family_join_requests
  UNION ALL SELECT 'family_location_sharing_consents', COUNT(*), 'Family Location Consents' FROM family_location_sharing_consents
  UNION ALL SELECT 'family_location_updates', COUNT(*), 'Family Location Coordinates' FROM family_location_updates
  UNION ALL SELECT 'evacuation_centers', COUNT(*), 'Evacuation Centers' FROM evacuation_centers
  UNION ALL SELECT 'evacuation_center_facilities', COUNT(*), 'Evacuation Center Facilities' FROM evacuation_center_facilities
  UNION ALL SELECT 'evacuation_routes', COUNT(*), 'Evacuation Routes' FROM evacuation_routes
  UNION ALL SELECT 'evacuation_route_waypoints', COUNT(*), 'Evacuation Route Waypoints' FROM evacuation_route_waypoints
  UNION ALL SELECT 'hospitals', COUNT(*), 'Hospitals & Medical Facilities' FROM hospitals
  UNION ALL SELECT 'notifications', COUNT(*), 'Notifications' FROM notifications
  UNION ALL SELECT 'notification_recipients', COUNT(*), 'Notification Recipients' FROM notification_recipients
  UNION ALL SELECT 'emergency_broadcast_logs', COUNT(*), 'Emergency Broadcasts' FROM emergency_broadcast_logs
  UNION ALL SELECT 'alerts', COUNT(*), 'Emergency Alerts' FROM alerts
  UNION ALL SELECT 'weather_cache', COUNT(*), 'Weather Observations' FROM weather_cache
  UNION ALL SELECT 'tropical_cyclone_bulletins', COUNT(*), 'Tropical Cyclone Bulletins' FROM tropical_cyclone_bulletins
  UNION ALL SELECT 'system_settings', COUNT(*), 'System Settings' FROM system_settings
  UNION ALL SELECT 'audit_logs', COUNT(*), 'Administrative Audit Logs' FROM audit_logs
) op
ORDER BY op.operational_table;

-- ============================================================================
-- SECTION 9: EXECUTIVE VERIFICATION SUMMARY ROLLUP (PASS / FAIL / WARNING)
-- ============================================================================

SELECT
  '1. Database Structure' AS check_domain,
  '38 Required Core InnoDB Base Tables' AS check_item,
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = 'geosafe_db' AND table_type = 'BASE TABLE' AND engine = 'InnoDB'
            AND table_name IN (
              'roles', 'users', 'user_profiles', 'responder_profiles', 'account_status_history',
              'auth_security_logs', 'incident_categories', 'incident_reports', 'reports',
              'incident_attachments', 'incident_status_history', 'incident_assignments',
              'incident_updates', 'rescue_requests', 'rescue_assignments', 'rescue_attachments',
              'rescue_updates', 'rescue_status_history', 'responder_assignment_history',
              'family_groups', 'family_members', 'family_invitations', 'family_join_requests',
              'family_location_sharing_consents', 'family_location_updates', 'evacuation_centers',
              'evacuation_center_facilities', 'evacuation_routes', 'evacuation_route_waypoints',
              'hospitals', 'notifications', 'notification_recipients', 'emergency_broadcast_logs',
              'alerts', 'weather_cache', 'tropical_cyclone_bulletins', 'system_settings', 'audit_logs'
            )) = 38
      THEN 'PASS'
    ELSE 'FAIL: One or more of the 38 required InnoDB base tables are missing'
  END AS audit_result
UNION ALL
SELECT
  '1. Database Structure',
  '27 Required Enforcement, Sync & Audit-Protection Triggers',
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.triggers
          WHERE trigger_schema = 'geosafe_db'
            AND trigger_name IN (
              'trg_family_groups_fixed_location_insert',
              'trg_family_groups_fixed_location_update',
              'trg_family_groups_sync_status_update',
              'trg_family_invitations_validate_insert',
              'trg_family_consent_validate_insert',
              'trg_family_consent_validate_update',
              'trg_family_location_updates_require_consent',
              'trg_users_sync_role_insert',
              'trg_users_sync_role_update',
              'trg_family_members_sync_user_insert',
              'trg_family_members_sync_user_update',
              'trg_family_members_sync_user_delete',
              'trg_incident_reports_freeze_insert',
              'trg_incident_reports_freeze_update',
              'trg_incident_reports_freeze_delete',
              'trg_audit_logs_prevent_delete',
              'trg_auth_security_logs_prevent_delete',
              'trg_account_status_history_prevent_delete',
              'trg_incident_status_history_prevent_delete',
              'trg_rescue_status_history_prevent_delete',
              'trg_emergency_broadcast_logs_prevent_delete',
              'trg_audit_logs_prevent_update',
              'trg_auth_security_logs_prevent_update',
              'trg_account_status_history_prevent_update',
              'trg_incident_status_history_prevent_update',
              'trg_rescue_status_history_prevent_update',
              'trg_emergency_broadcast_logs_prevent_update'
            )) = 27
      THEN 'PASS'
    ELSE 'FAIL: Missing one or more required database triggers (see Section 1.6)'
  END
UNION ALL
SELECT
  '1. Database Structure',
  '100% Audit-Safe Foreign Keys (Zero CASCADE / Zero SET NULL)',
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.referential_constraints
          WHERE constraint_schema = 'geosafe_db' AND delete_rule NOT IN ('RESTRICT', 'NO ACTION')) = 0
      THEN 'PASS'
    ELSE 'FAIL: One or more foreign keys use CASCADE or SET NULL instead of RESTRICT (see Section 6.2)'
  END
UNION ALL
SELECT
  '2. Roles and Users',
  'Strictly 3 Authorized Roles & Synchronized User Roles',
  CASE
    WHEN (SELECT COUNT(*) FROM roles) = 3
     AND (SELECT COUNT(*) FROM roles WHERE (id = 1 AND name = 'Administrator') OR (id = 2 AND name = 'Responder') OR (id = 3 AND name = 'Resident')) = 3
     AND (SELECT COUNT(*) FROM users u LEFT JOIN roles r ON u.role_id = r.id
          WHERE r.id IS NULL OR u.role_id NOT IN (1, 2, 3) OR u.role IS NULL
             OR (u.role_id = 1 AND u.role <> 'admin')
             OR (u.role_id = 2 AND u.role <> 'responder')
             OR (u.role_id = 3 AND u.role <> 'resident')) = 0
      THEN 'PASS'
    ELSE 'FAIL: Unauthorized role or user role desynchronization detected (see Section 2)'
  END
UNION ALL
SELECT
  '3. Family Address',
  'Fixed Barangay Bayanan, Muntinlupa City & Separate house_number/street',
  CASE
    WHEN (SELECT COUNT(*) FROM family_groups
          WHERE house_number IS NULL OR street IS NULL
             OR CHAR_LENGTH(TRIM(house_number)) = 0 OR CHAR_LENGTH(TRIM(street)) = 0) > 0
      THEN 'FAIL: Incomplete or blank family address detected (see Section 3.3)'
    WHEN (SELECT COUNT(*) FROM family_groups
          WHERE barangay <> 'Bayanan' OR city <> 'Muntinlupa City' OR region <> 'National Capital Region' OR country <> 'Philippines') > 0
      THEN 'MANUAL REVIEW REQUIRED: Pre-existing family row(s) outside fixed Bayanan coverage (see Section 3.3)'
    ELSE 'PASS'
  END
UNION ALL
SELECT
  '4. Family Membership',
  'family_members authoritative; legacy family_group_id cache synchronized; SHA-256 QR and explicit consent',
  CASE
    WHEN (SELECT COUNT(*) FROM (SELECT user_id FROM family_members WHERE membership_status = 'active' GROUP BY user_id HAVING COUNT(*) > 1) d) > 0
      OR (SELECT COUNT(*) FROM users u
          LEFT JOIN (
            SELECT fm.user_id, fm.family_id FROM family_members fm JOIN family_groups fg ON fg.id = fm.family_id
            WHERE fm.membership_status = 'active' AND fg.status = 'active'
          ) auth_fm ON u.id = auth_fm.user_id
          WHERE NOT (u.family_group_id <=> auth_fm.family_id)) > 0
      OR (SELECT COUNT(*) FROM family_invitations WHERE token_hash IS NULL OR CHAR_LENGTH(token_hash) <> 64 OR token_hash NOT REGEXP '^[0-9a-fA-F]{64}$') > 0
      OR (SELECT COUNT(*) FROM family_location_sharing_consents WHERE sharing_enabled = 1 AND consented_at IS NULL) > 0
      OR (SELECT COUNT(*) FROM family_members fm JOIN family_location_sharing_consents flc ON flc.family_member_id = fm.id WHERE fm.membership_status <> 'active' AND flc.sharing_enabled = 1) > 0
      THEN 'FAIL: Family membership, QR token, or consent violation detected (see Section 4)'
    ELSE 'PASS'
  END
UNION ALL
SELECT
  '5. Incident Relationships',
  'Canonical reports(id) Foreign Keys & Frozen Legacy incident_reports',
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.key_column_usage
          WHERE table_schema = 'geosafe_db' AND referenced_table_name = 'incident_reports') > 0
      THEN 'FAIL: One or more child tables still reference legacy incident_reports (see Section 5.1)'
    WHEN (SELECT COUNT(*) FROM information_schema.key_column_usage
          WHERE table_schema = 'geosafe_db' AND referenced_table_name = 'reports'
            AND table_name IN ('incident_attachments', 'incident_status_history', 'incident_assignments', 'incident_updates', 'responder_assignment_history')) < 5
      THEN 'FAIL: Missing canonical foreign key to reports(id) on incident child table(s) (see Section 5.2)'
    ELSE 'PASS'
  END
UNION ALL
SELECT
  '6. Fresh Installation',
  'Zero Operational Records Across All 37 Non-Role Tables',
  CASE
    WHEN (
      (SELECT COUNT(*) FROM users) +
      (SELECT COUNT(*) FROM user_profiles) +
      (SELECT COUNT(*) FROM responder_profiles) +
      (SELECT COUNT(*) FROM account_status_history) +
      (SELECT COUNT(*) FROM auth_security_logs) +
      (SELECT COUNT(*) FROM incident_categories) +
      (SELECT COUNT(*) FROM reports) +
      (SELECT COUNT(*) FROM incident_reports) +
      (SELECT COUNT(*) FROM incident_attachments) +
      (SELECT COUNT(*) FROM incident_status_history) +
      (SELECT COUNT(*) FROM incident_assignments) +
      (SELECT COUNT(*) FROM incident_updates) +
      (SELECT COUNT(*) FROM rescue_requests) +
      (SELECT COUNT(*) FROM rescue_assignments) +
      (SELECT COUNT(*) FROM rescue_attachments) +
      (SELECT COUNT(*) FROM rescue_updates) +
      (SELECT COUNT(*) FROM rescue_status_history) +
      (SELECT COUNT(*) FROM responder_assignment_history) +
      (SELECT COUNT(*) FROM family_groups) +
      (SELECT COUNT(*) FROM family_members) +
      (SELECT COUNT(*) FROM family_invitations) +
      (SELECT COUNT(*) FROM family_join_requests) +
      (SELECT COUNT(*) FROM family_location_sharing_consents) +
      (SELECT COUNT(*) FROM family_location_updates) +
      (SELECT COUNT(*) FROM evacuation_centers) +
      (SELECT COUNT(*) FROM evacuation_center_facilities) +
      (SELECT COUNT(*) FROM evacuation_routes) +
      (SELECT COUNT(*) FROM evacuation_route_waypoints) +
      (SELECT COUNT(*) FROM hospitals) +
      (SELECT COUNT(*) FROM notifications) +
      (SELECT COUNT(*) FROM notification_recipients) +
      (SELECT COUNT(*) FROM emergency_broadcast_logs) +
      (SELECT COUNT(*) FROM alerts) +
      (SELECT COUNT(*) FROM weather_cache) +
      (SELECT COUNT(*) FROM tropical_cyclone_bulletins) +
      (SELECT COUNT(*) FROM system_settings) +
      (SELECT COUNT(*) FROM audit_logs)
    ) = 0
      THEN 'PASS: Pristine fresh installation (0 operational records)'
    ELSE 'FAIL: Non-zero operational records present in fresh database (see Section 8)'
  END;
