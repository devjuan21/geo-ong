-- ============================================================================
-- GeoSafe Migration 005: Rescue Attachments, Field Progress & Closure Distinction
-- Target Database: geosafe_db
-- Description:
--   1. Creates `rescue_attachments` table (Audit Preservation: ON DELETE RESTRICT).
--   2. Creates `rescue_updates` table (Audit Preservation: ON DELETE RESTRICT).
--   3. Adds closure distinction columns (`confirmed_resolved_at`, `resident_confirmed_at`)
--      to `rescue_requests` to separate responder completion from resident/EOC closure.
--   4. Removes arbitrary default priority on rescue requests (priority must be explicitly triaged).
-- Prerequisites: Migration 004 completed.
-- Execution Safety: Strict MySQL 8.4 compatibility, InnoDB, zero mock data.
-- ============================================================================

USE geosafe_db;

-- ----------------------------------------------------------------------------
-- 1. Rescue Attachments Table (Preserve Scene Evidence: ON DELETE RESTRICT)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rescue_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rescue_id INT NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  file_name VARCHAR(150) NOT NULL,
  file_type VARCHAR(50) DEFAULT NULL,
  file_size INT UNSIGNED DEFAULT NULL,
  uploaded_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rescue_attachments_rescue (rescue_id),
  CONSTRAINT fk_rescue_attachments_rescue FOREIGN KEY (rescue_id) REFERENCES rescue_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rescue_attachments_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Rescue Progress Updates & Field Notes Table (Audit: ON DELETE RESTRICT)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rescue_updates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  rescue_id INT NOT NULL,
  responder_user_id INT NOT NULL,
  status_update VARCHAR(40) NOT NULL,
  work_notes TEXT NOT NULL,
  photo_url VARCHAR(255) DEFAULT NULL,
  is_internal_only TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rescue_updates_rescue (rescue_id),
  INDEX idx_rescue_updates_responder (responder_user_id),
  INDEX idx_rescue_updates_privacy (is_internal_only),
  INDEX idx_rescue_updates_created (created_at),
  CONSTRAINT fk_rescue_updates_rescue FOREIGN KEY (rescue_id) REFERENCES rescue_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rescue_updates_responder FOREIGN KEY (responder_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Extend `rescue_requests` with Closure Distinction Columns
-- ----------------------------------------------------------------------------
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = 'geosafe_db' AND TABLE_NAME = 'rescue_requests' AND COLUMN_NAME = 'confirmed_resolved_at');
SET @stmt := IF(@col_exists = 0, 
  'ALTER TABLE rescue_requests ADD COLUMN confirmed_resolved_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at, ADD COLUMN resident_confirmed_at TIMESTAMP NULL DEFAULT NULL AFTER confirmed_resolved_at, ADD COLUMN confirmed_by INT DEFAULT NULL AFTER resident_confirmed_at, ADD CONSTRAINT fk_rescue_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE RESTRICT', 
  'SELECT "Closure distinction columns already exist on rescue_requests" AS status');
PREPARE stmt FROM @stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Remove misleading arbitrary 'Critical' default on rescue priority (require explicit priority)
ALTER TABLE rescue_requests MODIFY COLUMN priority ENUM('Critical', 'High', 'Medium', 'Low') NOT NULL;
