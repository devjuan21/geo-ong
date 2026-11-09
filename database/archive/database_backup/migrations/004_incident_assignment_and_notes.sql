-- ============================================================================
-- GeoSafe Migration 004: Canonical `reports` Table, Assignments & Notes
-- Target Database: geosafe_db (Fresh Database)
-- ============================================================================

USE geosafe_db;

-- 1. Canonical Incident Reports Table (`reports`)
CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference_number VARCHAR(30) DEFAULT NULL UNIQUE,
  user_id INT NOT NULL,
  category_id INT DEFAULT NULL,
  incident_type VARCHAR(100) NOT NULL,
  title VARCHAR(180) DEFAULT NULL,
  description TEXT NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  address VARCHAR(255) DEFAULT NULL,
  severity ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
  status ENUM('pending', 'verified', 'dispatched', 'responding', 'on_site', 'in_progress', 'resolved', 'false_alarm') NOT NULL DEFAULT 'pending',
  is_public TINYINT(1) NOT NULL DEFAULT 1,
  assigned_to INT DEFAULT NULL,
  verified_by INT DEFAULT NULL,
  verified_at TIMESTAMP NULL DEFAULT NULL,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  confirmed_resolved_at TIMESTAMP NULL DEFAULT NULL,
  resident_confirmed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_reports_user (user_id),
  INDEX idx_reports_status (status),
  INDEX idx_reports_severity (severity),
  INDEX idx_reports_assigned (assigned_to),
  INDEX idx_reports_created (created_at),
  INDEX idx_reports_coords (latitude, longitude),
  CONSTRAINT fk_reports_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reports_category FOREIGN KEY (category_id) REFERENCES incident_categories(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reports_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reports_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Incident Assignments Table (References canonical `reports.id`, ON DELETE RESTRICT)
CREATE TABLE IF NOT EXISTS incident_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id INT NOT NULL,
  responder_user_id INT NOT NULL,
  assigned_by INT NOT NULL,
  assignment_status ENUM('Assigned', 'Accepted', 'En Route', 'On Scene', 'Completed', 'Reassigned') NOT NULL DEFAULT 'Assigned',
  dispatch_instructions TEXT DEFAULT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMP NULL DEFAULT NULL,
  en_route_at TIMESTAMP NULL DEFAULT NULL,
  on_scene_at TIMESTAMP NULL DEFAULT NULL,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_incident_assign_report (report_id),
  INDEX idx_incident_assign_responder (responder_user_id),
  INDEX idx_incident_assign_status (assignment_status),
  CONSTRAINT fk_incident_assign_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE RESTRICT,
  CONSTRAINT fk_incident_assign_responder FOREIGN KEY (responder_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_incident_assign_dispatcher FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Incident Progress Updates & Field Notes Table (References canonical `reports.id`, ON DELETE RESTRICT)
CREATE TABLE IF NOT EXISTS incident_updates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  report_id INT NOT NULL,
  responder_user_id INT NOT NULL,
  status_update VARCHAR(40) NOT NULL,
  work_notes TEXT NOT NULL,
  photo_url VARCHAR(255) DEFAULT NULL,
  is_internal_only TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_incident_updates_report (report_id),
  INDEX idx_incident_updates_responder (responder_user_id),
  INDEX idx_incident_updates_privacy (is_internal_only),
  INDEX idx_incident_updates_created (created_at),
  CONSTRAINT fk_incident_updates_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE RESTRICT,
  CONSTRAINT fk_incident_updates_responder FOREIGN KEY (responder_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Freeze Legacy `incident_reports` Table (Read-Only Protection)
DROP TRIGGER IF EXISTS trg_incident_reports_freeze_insert;
DROP TRIGGER IF EXISTS trg_incident_reports_freeze_update;
DROP TRIGGER IF EXISTS trg_incident_reports_freeze_delete;

DELIMITER $$
CREATE TRIGGER trg_incident_reports_freeze_insert BEFORE INSERT ON incident_reports
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incident_reports is a frozen legacy table. Insert incidents into reports.';
END$$
CREATE TRIGGER trg_incident_reports_freeze_update BEFORE UPDATE ON incident_reports
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incident_reports is a frozen legacy table. Update incidents in reports.';
END$$
CREATE TRIGGER trg_incident_reports_freeze_delete BEFORE DELETE ON incident_reports
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incident_reports is a frozen legacy table.';
END$$
DELIMITER ;
