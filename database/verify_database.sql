-- ============================================================================
-- GeoSafe Emergency Assistance & Disaster Reporting System
-- Comprehensive Read-Only Database Verification & Consistency Audit Script
-- Database: geosafe_db
-- Target Server: MySQL 8.0+ / 8.4 LTS
-- Mode: STRICTLY READ-ONLY (Zero schema or data modifications; safe in all environments)
-- ============================================================================

USE geosafe_db;

-- ============================================================================
-- SECTION 1: DATABASE STRUCTURE — 33 CORE TABLES, ENGINE, COLLATION & EXTRAS
-- ============================================================================

-- 1.1 Verify all 33 expected core tables, storage engine (InnoDB), and collation
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
  SELECT 'role_sequences' UNION ALL
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
  SELECT 'evacuation_centers' UNION ALL
  SELECT 'evacuation_center_facilities' UNION ALL
  SELECT 'evacuation_routes' UNION ALL
  SELECT 'evacuation_route_waypoints' UNION ALL
  SELECT 'hospitals' UNION ALL
  SELECT 'notifications' UNION ALL
  SELECT 'notification_recipients' UNION ALL
  SELECT 'emergency_broadcast_logs' UNION ALL
  SELECT 'alerts' UNION ALL
  SELECT 'system_settings' UNION ALL
  SELECT 'audit_logs'
) expected
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'geosafe_db' AND t.table_name = expected.expected_table
ORDER BY expected.expected_table;

-- 1.2 Detect unexpected extra tables or views
SELECT
  t.table_name AS object_name,
  t.table_type AS object_type,
  CASE
    WHEN t.table_type = 'VIEW'
      THEN 'FAIL: Unexpected VIEW detected (views must not replace canonical tables)'
    ELSE 'WARNING / MANUAL REVIEW REQUIRED: Unexpected table in geosafe_db schema'
  END AS verification_status
FROM information_schema.tables t
WHERE t.table_schema = 'geosafe_db'
  AND t.table_name NOT IN (
    'roles', 'role_sequences', 'users', 'user_profiles', 'responder_profiles', 'account_status_history',
    'auth_security_logs', 'incident_categories', 'incident_reports', 'reports',
    'incident_attachments', 'incident_status_history', 'incident_assignments',
    'incident_updates', 'rescue_requests', 'rescue_assignments', 'rescue_attachments',
    'rescue_updates', 'rescue_status_history', 'responder_assignment_history',
    'evacuation_centers', 'evacuation_center_facilities', 'evacuation_routes',
    'evacuation_route_waypoints', 'hospitals', 'notifications',
    'notification_recipients', 'emergency_broadcast_logs', 'alerts',
    'system_settings', 'audit_logs'
  )
ORDER BY t.table_name;

-- 1.3 Verify Primary Keys on all 31 core tables
SELECT
  expected.expected_table AS table_name,
  COALESCE(kcu.column_name, 'MISSING') AS primary_key_column,
  CASE
    WHEN kcu.column_name IN ('id', 'role_id') THEN CONCAT('PASS: Primary key (', kcu.column_name, ') verified')
    WHEN kcu.column_name IS NOT NULL THEN CONCAT('WARNING: Non-standard PK column (', kcu.column_name, ')')
    ELSE 'FAIL: Missing PRIMARY KEY constraint'
  END AS verification_status
FROM (
  SELECT 'roles' AS expected_table UNION ALL SELECT 'role_sequences' UNION ALL SELECT 'users' UNION ALL
  SELECT 'user_profiles' UNION ALL SELECT 'responder_profiles' UNION ALL
  SELECT 'account_status_history' UNION ALL SELECT 'auth_security_logs' UNION ALL
  SELECT 'incident_categories' UNION ALL SELECT 'incident_reports' UNION ALL
  SELECT 'reports' UNION ALL SELECT 'incident_attachments' UNION ALL
  SELECT 'incident_status_history' UNION ALL SELECT 'incident_assignments' UNION ALL
  SELECT 'incident_updates' UNION ALL SELECT 'rescue_requests' UNION ALL
  SELECT 'rescue_assignments' UNION ALL SELECT 'rescue_attachments' UNION ALL
  SELECT 'rescue_updates' UNION ALL SELECT 'rescue_status_history' UNION ALL
  SELECT 'responder_assignment_history' UNION ALL SELECT 'evacuation_centers' UNION ALL
  SELECT 'evacuation_center_facilities' UNION ALL SELECT 'evacuation_routes' UNION ALL
  SELECT 'evacuation_route_waypoints' UNION ALL SELECT 'hospitals' UNION ALL
  SELECT 'notifications' UNION ALL SELECT 'notification_recipients' UNION ALL
  SELECT 'emergency_broadcast_logs' UNION ALL SELECT 'alerts' UNION ALL
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
  SELECT 'users', 'user_code', 'varchar', 'YES', NULL, 0 UNION ALL
  SELECT 'users', 'email', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'users', 'password_hash', 'varchar', 'NO', NULL, 0 UNION ALL
  SELECT 'users', 'role_id', 'int', 'NO', NULL, 0 UNION ALL
  SELECT 'users', 'role', 'enum', 'YES', NULL, 1 UNION ALL
  SELECT 'users', 'status', 'enum', 'NO', 'active', 1 UNION ALL
  SELECT 'users', 'safety_status', 'enum', 'NO', 'no_response', 1 UNION ALL
  SELECT 'users', 'last_latitude', 'decimal', 'YES', NULL, 1 UNION ALL
  SELECT 'users', 'last_longitude', 'decimal', 'YES', NULL, 1 UNION ALL
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
  -- Evacuation, Hospitals & Alerts
  SELECT 'evacuation_centers', 'status', 'enum', 'NO', 'Standby', 1 UNION ALL
  SELECT 'evacuation_routes', 'route_status', 'enum', 'NO', 'under_review', 1 UNION ALL
  SELECT 'evacuation_routes', 'is_official_approved', 'tinyint', 'NO', '0', 1 UNION ALL
  SELECT 'hospitals', 'status', 'enum', 'NO', 'Under Assessment', 1 UNION ALL
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
  SELECT 'role_sequences', 'role_name' UNION ALL
  SELECT 'role_sequences', 'prefix' UNION ALL
  SELECT 'users', 'user_code' UNION ALL
  SELECT 'users', 'email' UNION ALL
  SELECT 'user_profiles', 'user_id' UNION ALL
  SELECT 'responder_profiles', 'user_id' UNION ALL
  SELECT 'responder_profiles', 'badge_number' UNION ALL
  SELECT 'incident_categories', 'name' UNION ALL
  SELECT 'reports', 'reference_number' UNION ALL
  SELECT 'rescue_requests', 'reference_number' UNION ALL
  SELECT 'evacuation_centers', 'name' UNION ALL
  SELECT 'hospitals', 'name' UNION ALL
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

-- 1.6 Verify All Required Database Triggers (18 Triggers)
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
  SELECT 'trg_users_sync_role_insert' AS trig_name, 'users' AS tbl, 'BEFORE' AS timing, 'INSERT' AS evt UNION ALL
  SELECT 'trg_users_sync_role_update', 'users', 'BEFORE', 'UPDATE' UNION ALL
  SELECT 'trg_users_user_code_immutable', 'users', 'BEFORE', 'UPDATE' UNION ALL
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

-- ============================================================================
-- SECTION 3: COMPREHENSIVE FOREIGN KEY & DELETION RULE AUDIT ACROSS ALL TABLES
-- ============================================================================

-- 3.1 Verify all 40 expected foreign keys enforce ON DELETE RESTRICT
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
  SELECT 'role_sequences' AS tbl, 'role_id' AS col, 'roles' AS ref_tbl, 'RESTRICT' AS exp_del UNION ALL
  SELECT 'users', 'role_id', 'roles', 'RESTRICT' UNION ALL
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
  -- Module 5 & 6: Notifications, Broadcasts & Audit Logs
  SELECT 'notifications', 'created_by', 'users', 'RESTRICT' UNION ALL
  SELECT 'notification_recipients', 'notification_id', 'notifications', 'RESTRICT' UNION ALL
  SELECT 'notification_recipients', 'user_id', 'users', 'RESTRICT' UNION ALL
  SELECT 'alerts', 'created_by', 'users', 'RESTRICT' UNION ALL
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
