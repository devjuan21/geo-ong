-- ============================================================================
-- GeoSafe Migration 008: Security Audit Logs, Emergency Broadcasts & Immutability Triggers
-- Target Database: geosafe_db (Fresh Database)
-- ============================================================================

USE geosafe_db;

-- 1. Authentication & Security Event Logs Table
CREATE TABLE IF NOT EXISTS auth_security_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  attempted_email VARCHAR(160) DEFAULT NULL,
  event_type ENUM('login_success', 'login_failed', 'logout', 'token_revoked', 'unauthorized_role_attempt', 'password_changed', 'account_suspended', 'account_reactivated') NOT NULL,
  attempted_role VARCHAR(50) DEFAULT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  details VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auth_sec_user (user_id),
  INDEX idx_auth_sec_email (attempted_email),
  INDEX idx_auth_sec_event (event_type),
  INDEX idx_auth_sec_created (created_at),
  CONSTRAINT fk_auth_sec_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Emergency Broadcast Audit Logs Table
CREATE TABLE IF NOT EXISTS emergency_broadcast_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  severity ENUM('Advisory', 'Watch', 'Warning', 'Critical Evacuation') NOT NULL DEFAULT 'Advisory',
  target_scope ENUM('All Barangay Bayanan', 'Lakeshore Zone', 'Specific Purok', 'Responders Only') NOT NULL DEFAULT 'All Barangay Bayanan',
  target_zones VARCHAR(255) DEFAULT NULL,
  recipients_count INT UNSIGNED NOT NULL DEFAULT 0,
  authorized_by INT NOT NULL,
  broadcasted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_broadcast_active (is_active),
  INDEX idx_broadcast_severity (severity),
  INDEX idx_broadcast_time (broadcasted_at),
  CONSTRAINT fk_broadcast_authorizer FOREIGN KEY (authorized_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Immutable Audit & History Protection Triggers (Prevent DELETE and UPDATE)
DROP TRIGGER IF EXISTS trg_audit_logs_prevent_delete;
DROP TRIGGER IF EXISTS trg_auth_security_logs_prevent_delete;
DROP TRIGGER IF EXISTS trg_account_status_history_prevent_delete;
DROP TRIGGER IF EXISTS trg_incident_status_history_prevent_delete;
DROP TRIGGER IF EXISTS trg_rescue_status_history_prevent_delete;
DROP TRIGGER IF EXISTS trg_emergency_broadcast_logs_prevent_delete;
DROP TRIGGER IF EXISTS trg_audit_logs_prevent_update;
DROP TRIGGER IF EXISTS trg_auth_security_logs_prevent_update;
DROP TRIGGER IF EXISTS trg_account_status_history_prevent_update;
DROP TRIGGER IF EXISTS trg_incident_status_history_prevent_update;
DROP TRIGGER IF EXISTS trg_rescue_status_history_prevent_update;
DROP TRIGGER IF EXISTS trg_emergency_broadcast_logs_prevent_update;

DELIMITER $$

CREATE TRIGGER trg_audit_logs_prevent_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deletion of audit_logs records is prohibited to preserve operational accountability.';
END$$

CREATE TRIGGER trg_auth_security_logs_prevent_delete
BEFORE DELETE ON auth_security_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deletion of auth_security_logs records is prohibited to preserve security audit history.';
END$$

CREATE TRIGGER trg_account_status_history_prevent_delete
BEFORE DELETE ON account_status_history
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deletion of account_status_history records is prohibited to preserve user governance history.';
END$$

CREATE TRIGGER trg_incident_status_history_prevent_delete
BEFORE DELETE ON incident_status_history
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deletion of incident_status_history records is prohibited to preserve emergency timeline records.';
END$$

CREATE TRIGGER trg_rescue_status_history_prevent_delete
BEFORE DELETE ON rescue_status_history
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deletion of rescue_status_history records is prohibited to preserve rescue accountability records.';
END$$

CREATE TRIGGER trg_emergency_broadcast_logs_prevent_delete
BEFORE DELETE ON emergency_broadcast_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deletion of emergency_broadcast_logs records is prohibited to preserve public warning history.';
END$$

CREATE TRIGGER trg_audit_logs_prevent_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Modification of audit_logs records is prohibited; audit history is append-only.';
END$$

CREATE TRIGGER trg_auth_security_logs_prevent_update
BEFORE UPDATE ON auth_security_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Modification of auth_security_logs records is prohibited; security history is append-only.';
END$$

CREATE TRIGGER trg_account_status_history_prevent_update
BEFORE UPDATE ON account_status_history
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Modification of account_status_history records is prohibited; governance history is append-only.';
END$$

CREATE TRIGGER trg_incident_status_history_prevent_update
BEFORE UPDATE ON incident_status_history
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Modification of incident_status_history records is prohibited; incident timeline is append-only.';
END$$

CREATE TRIGGER trg_rescue_status_history_prevent_update
BEFORE UPDATE ON rescue_status_history
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Modification of rescue_status_history records is prohibited; rescue timeline is append-only.';
END$$

CREATE TRIGGER trg_emergency_broadcast_logs_prevent_update
BEFORE UPDATE ON emergency_broadcast_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Modification of emergency_broadcast_logs records is prohibited; broadcast log is append-only.';
END$$

DELIMITER ;
