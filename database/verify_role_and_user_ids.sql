-- ============================================================================
-- GeoSafe Disaster Preparedness & Emergency Response System
-- Verification Script: Role IDs & Unique User ID Formats
-- Target Database: geosafe_db
-- ============================================================================
-- Run this script in MySQL Workbench or via MySQL CLI:
--   mysql -u root -p geosafe_db < database/verify_role_and_user_ids.sql
-- ============================================================================

USE geosafe_db;

SELECT '==================================================================' AS header;
SELECT ' GEOSAFE ROLE AND USER ID VERIFICATION REPORT' AS header;
SELECT '==================================================================' AS header;

-- ----------------------------------------------------------------------------
-- 1. VERIFY THE THREE CANONICAL ROLES
-- ----------------------------------------------------------------------------
SELECT '1. Checking Canonical Roles in roles table:' AS section;

SELECT
    id,
    name,
    description,
    CASE 
        WHEN id = 1 AND name = 'Administrator' THEN 'PASS: Role ID 1 is Administrator'
        WHEN id = 2 AND name = 'Responder'     THEN 'PASS: Role ID 2 is Responder'
        WHEN id = 3 AND name = 'Resident'      THEN 'PASS: Role ID 3 is Resident'
        ELSE 'FAIL: Invalid role mapping'
    END AS verification_status
FROM roles
ORDER BY id ASC;

-- Summary test for exactly 3 canonical roles
SELECT 
    CASE 
        WHEN COUNT(*) = 3 
         AND SUM(CASE WHEN id = 1 AND name = 'Administrator' THEN 1 ELSE 0 END) = 1
         AND SUM(CASE WHEN id = 2 AND name = 'Responder' THEN 1 ELSE 0 END) = 1
         AND SUM(CASE WHEN id = 3 AND name = 'Resident' THEN 1 ELSE 0 END) = 1
        THEN 'PASS: Exactly 3 canonical roles exist with fixed IDs (1, 2, 3)'
        ELSE 'FAIL: Roles table does not match canonical specification'
    END AS canonical_roles_check
FROM roles;

-- ----------------------------------------------------------------------------
-- 2. VERIFY ROLE SEQUENCES TABLE
-- ----------------------------------------------------------------------------
SELECT '2. Checking role_sequences table:' AS section;

SELECT 
    rs.role_id,
    rs.role_name,
    rs.prefix,
    rs.next_val,
    CASE
        WHEN rs.role_id = 1 AND rs.prefix = 'ADM'   THEN 'PASS: ADM prefix for Administrator'
        WHEN rs.role_id = 2 AND rs.prefix = 'RSPDR' THEN 'PASS: RSPDR prefix for Responder'
        WHEN rs.role_id = 3 AND rs.prefix = 'RSDNT' THEN 'PASS: RSDNT prefix for Resident'
        ELSE 'FAIL: Unexpected sequence configuration'
    END AS sequence_status
FROM role_sequences rs
ORDER BY rs.role_id ASC;

-- ----------------------------------------------------------------------------
-- 3. VERIFY USERS TABLE SCHEMA & USER_CODE COLUMN
-- ----------------------------------------------------------------------------
SELECT '3. Checking users table schema for user_code and constraints:' AS section;

SELECT 
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_KEY,
    EXTRA
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME IN ('id', 'user_code', 'role_id', 'role');

-- ----------------------------------------------------------------------------
-- 4. VERIFY USER ID FORMAT AND UNIQUENESS ACROSS EXISTING USERS
-- ----------------------------------------------------------------------------
SELECT '4. Checking User ID Format & Role Synchronization on Users:' AS section;

SELECT 
    u.id,
    u.user_code,
    u.name,
    u.email,
    u.role_id,
    r.name AS role_name,
    CASE 
        WHEN u.user_code IS NULL THEN 'WARN: user_code is NULL (pending backfill migration)'
        WHEN u.role_id = 1 AND u.user_code REGEXP '^ADM-[0-9]{4,}$' THEN 'PASS: Valid Administrator ID (ADM-XXXX)'
        WHEN u.role_id = 2 AND u.user_code REGEXP '^RSPDR-[0-9]{4,}$' THEN 'PASS: Valid Responder ID (RSPDR-XXXX)'
        WHEN u.role_id = 3 AND u.user_code REGEXP '^RSDNT-[0-9]{4,}$' THEN 'PASS: Valid Resident ID (RSDNT-XXXX)'
        ELSE 'FAIL: User ID format or role mismatch'
    END AS format_validation
FROM users u
LEFT JOIN roles r ON r.id = u.role_id
ORDER BY u.role_id, u.id;

-- Duplicate check
SELECT 
    user_code,
    COUNT(*) AS occurrences,
    IF(COUNT(*) = 1, 'PASS: Unique', 'FAIL: Duplicate User ID detected') AS uniqueness_check
FROM users
WHERE user_code IS NOT NULL
GROUP BY user_code
HAVING COUNT(*) > 1;

-- ----------------------------------------------------------------------------
-- 5. FOREIGN KEY INTEGRITY CHECK
-- ----------------------------------------------------------------------------
SELECT '5. Checking Foreign Keys Referencing users(id) and roles(id):' AS section;

SELECT 
    TABLE_NAME,
    COLUMN_NAME,
    CONSTRAINT_NAME,
    REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND REFERENCED_TABLE_NAME IN ('users', 'roles')
ORDER BY TABLE_NAME, COLUMN_NAME;

SELECT '==================================================================' AS footer;
SELECT ' VERIFICATION QUERY COMPLETE' AS footer;
SELECT '==================================================================' AS footer;

