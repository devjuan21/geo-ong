-- ============================================================================
-- GeoSafe Disaster Preparedness & Emergency Response System
-- Migration 009: Role Sequences & Unique Readable User Identifiers (user_code)
-- Target Database: geosafe_db
-- ============================================================================
-- 
-- PURPOSE:
-- 1. Verifies that exactly three canonical RBAC roles exist with fixed IDs:
--      Role ID 1 -> Administrator  (Prefix: ADM)
--      Role ID 2 -> Responder      (Prefix: RSPDR)
--      Role ID 3 -> Resident       (Prefix: RSDNT)
-- 2. Introduces a dedicated, transaction-safe sequence table `role_sequences`
--    to guarantee independent, gap-free, non-reusable numbering for each role.
-- 3. Adds `user_code` (VARCHAR(32), UNIQUE, NOT NULL) to `users` to provide
--    human-readable, role-specific public identifiers:
--      Administrator: ADM-0001, ADM-0002...
--      Responder:     RSPDR-0001, RSPDR-0002...
--      Resident:      RSDNT-0001, RSDNT-0002...
-- 4. Preserves the internal numeric primary key (`users.id`) and all 51 foreign
--    key relationships across the database.
-- ============================================================================

USE geosafe_db;

-- 1. Ensure Canonical Roles (1=Administrator, 2=Responder, 3=Resident)
INSERT INTO roles (id, name, description)
VALUES 
    (1, 'Administrator', 'Full emergency operations command, user governance, and disaster dispatch oversight'),
    (2, 'Responder', 'Field responder unit handling active incident verification and rescue missions'),
    (3, 'Resident', 'Community member reporting incidents, requesting rescue, and monitoring alerts')
ON DUPLICATE KEY UPDATE 
    name = VALUES(name),
    description = VALUES(description);

-- 2. Create the Dedicated Role Sequences Table
CREATE TABLE IF NOT EXISTS role_sequences (
    role_id INT NOT NULL,
    role_name VARCHAR(50) NOT NULL,
    prefix VARCHAR(10) NOT NULL,
    next_val INT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id),
    UNIQUE KEY uq_role_sequences_name (role_name),
    UNIQUE KEY uq_role_sequences_prefix (prefix),
    CONSTRAINT fk_role_sequences_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Initialize Sequences for Each Canonical Role
INSERT INTO role_sequences (role_id, role_name, prefix, next_val)
VALUES 
    (1, 'Administrator', 'ADM', 1),
    (2, 'Responder', 'RSPDR', 1),
    (3, 'Resident', 'RSDNT', 1)
ON DUPLICATE KEY UPDATE
    role_name = VALUES(role_name),
    prefix = VALUES(prefix);

-- 4. Add user_code Column to users Table If Not Present
SET @col_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'users' 
      AND COLUMN_NAME = 'user_code'
);

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE users ADD COLUMN user_code VARCHAR(32) NULL AFTER id', 
    'SELECT "user_code column already present"'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. Safe Backfill for Existing Accounts Lacking a user_code
-- Administrator backfill
UPDATE users u
SET u.user_code = CONCAT('ADM-', LPAD(u.id, 4, '0'))
WHERE u.role_id = 1 AND (u.user_code IS NULL OR u.user_code = '');

-- Responder backfill
UPDATE users u
SET u.user_code = CONCAT('RSPDR-', LPAD(u.id, 4, '0'))
WHERE u.role_id = 2 AND (u.user_code IS NULL OR u.user_code = '');

-- Resident backfill
UPDATE users u
SET u.user_code = CONCAT('RSDNT-', LPAD(u.id, 4, '0'))
WHERE u.role_id = 3 AND (u.user_code IS NULL OR u.user_code = '');

-- 6. Synchronize role_sequences next_val Based on Any Existing Max Numbers
UPDATE role_sequences rs
JOIN (
    SELECT 1 AS role_id, COALESCE(MAX(CAST(SUBSTRING(user_code, 5) AS UNSIGNED)), 0) + 1 AS max_seq
    FROM users WHERE role_id = 1 AND user_code LIKE 'ADM-%'
) m ON rs.role_id = m.role_id
SET rs.next_val = GREATEST(rs.next_val, m.max_seq);

UPDATE role_sequences rs
JOIN (
    SELECT 2 AS role_id, COALESCE(MAX(CAST(SUBSTRING(user_code, 7) AS UNSIGNED)), 0) + 1 AS max_seq
    FROM users WHERE role_id = 2 AND user_code LIKE 'RSPDR-%'
) m ON rs.role_id = m.role_id
SET rs.next_val = GREATEST(rs.next_val, m.max_seq);

UPDATE role_sequences rs
JOIN (
    SELECT 3 AS role_id, COALESCE(MAX(CAST(SUBSTRING(user_code, 7) AS UNSIGNED)), 0) + 1 AS max_seq
    FROM users WHERE role_id = 3 AND user_code LIKE 'RSDNT-%'
) m ON rs.role_id = m.role_id
SET rs.next_val = GREATEST(rs.next_val, m.max_seq);

-- 7. Add UNIQUE Constraint on user_code If Not Present
SET @idx_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'users' 
      AND INDEX_NAME = 'uq_users_user_code'
);

SET @sql_idx = IF(@idx_exists = 0, 
    'ALTER TABLE users ADD UNIQUE KEY uq_users_user_code (user_code)', 
    'SELECT "uq_users_user_code index already present"'
);
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

