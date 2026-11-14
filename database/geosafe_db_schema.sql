-- ============================================================================
-- GeoSafe Emergency Assistance & Disaster Reporting System
-- Fresh Database Schema Definition: geosafe_db
-- Target Server: MySQL Community Server 8.0+ / 8.4 LTS
-- Character Set: utf8mb4, Collation: utf8mb4_unicode_ci
-- ============================================================================
-- STRICT FRESH DATABASE POLICY:
--   * Drops any existing `geosafe_db` database and recreates all 33 InnoDB
--     tables, 40 ON DELETE RESTRICT foreign keys, and 18 triggers from scratch.
--   * Initializes the 3 required RBAC roles (1=Administrator, 2=Responder, 3=Resident),
--     role_sequences (ADM, RSPDR, RSDNT), and verified Barangay Bayanan
--     evacuation centers, routes, and Muntinlupa hospitals.
-- ============================================================================

DROP DATABASE IF EXISTS geosafe_db;

CREATE DATABASE geosafe_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE geosafe_db;

-- ----------------------------------------------------------------------------
-- MODULE 1: AUTHENTICATION, ROLES & USER ACCOUNTS
-- ----------------------------------------------------------------------------

-- 1.1 Roles Definition Table (Authoritative System Roles: Strictly 3)
CREATE TABLE roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.1b Role Sequences (Atomic sequence generation per canonical role)
CREATE TABLE role_sequences (
  role_id INT NOT NULL PRIMARY KEY,
  role_name VARCHAR(50) NOT NULL UNIQUE,
  prefix VARCHAR(10) NOT NULL UNIQUE,
  next_val INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_role_sequences_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.2 Core Users Table
-- Authoritative role relationship: users.role_id -> roles.id
-- Legacy compatibility column (role) is synchronized by triggers
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_code VARCHAR(32) DEFAULT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role_id INT NOT NULL DEFAULT 3,
  role ENUM('resident', 'responder', 'admin') DEFAULT NULL,
  safety_status ENUM('safe', 'need_help', 'injured', 'no_response') NOT NULL DEFAULT 'no_response',
  last_latitude DECIMAL(10, 8) DEFAULT NULL,
  last_longitude DECIMAL(11, 8) DEFAULT NULL,
  last_location_at TIMESTAMP NULL DEFAULT NULL,
  battery_level TINYINT UNSIGNED DEFAULT NULL,
  status ENUM('active', 'suspended', 'deactivated') NOT NULL DEFAULT 'active',
  account_status ENUM('active', 'suspended', 'deactivated') NOT NULL DEFAULT 'active',
  reset_token_hash VARCHAR(255) DEFAULT NULL,
  reset_token_expires TIMESTAMP NULL DEFAULT NULL,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role_id (role_id),
  INDEX idx_users_role_enum (role),
  INDEX idx_users_status (account_status),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.3 Resident User Profiles Table (1:1 with users)
CREATE TABLE user_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  phone_number VARCHAR(30) DEFAULT NULL,
  street_address VARCHAR(255) DEFAULT NULL,
  barangay VARCHAR(100) NOT NULL DEFAULT 'Barangay Bayanan',
  city VARCHAR(100) NOT NULL DEFAULT 'Muntinlupa City',
  province VARCHAR(100) NOT NULL DEFAULT 'Metro Manila',
  postal_code VARCHAR(20) DEFAULT NULL,
  verification_status ENUM('Unverified Resident', 'Verified Resident') NOT NULL DEFAULT 'Unverified Resident',
  barangay_id_number VARCHAR(60) DEFAULT NULL,
  household_members_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  emergency_contact_name VARCHAR(120) DEFAULT NULL,
  emergency_contact_relationship VARCHAR(60) DEFAULT NULL,
  emergency_contact_phone VARCHAR(30) DEFAULT NULL,
  medical_notes TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.4 Responder Operational Profiles Table (1:1 with Responder users)
CREATE TABLE responder_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  badge_number VARCHAR(50) NOT NULL UNIQUE,
  callsign VARCHAR(50) DEFAULT NULL,
  assigned_unit VARCHAR(120) NOT NULL,
  department VARCHAR(120) NOT NULL DEFAULT 'Barangay Bayanan Emergency Operations',
  specialization VARCHAR(100) DEFAULT NULL,
  availability_status ENUM('On Duty', 'Off Duty', 'Unavailable') NOT NULL DEFAULT 'Off Duty',
  current_latitude DECIMAL(10, 8) DEFAULT NULL,
  current_longitude DECIMAL(11, 8) DEFAULT NULL,
  last_location_updated_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_responder_availability (availability_status),
  CONSTRAINT fk_responder_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- MODULE 2: INCIDENT REPORTING & HAZARD VERIFICATION
-- ----------------------------------------------------------------------------

-- 2.1 Incident Categories Lookup Table
CREATE TABLE incident_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) DEFAULT NULL,
  default_severity ENUM('Low', 'Medium', 'High', 'Critical') NOT NULL DEFAULT 'Medium',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2.2 Canonical Incident Reports Table (`reports`)
CREATE TABLE reports (
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

-- 2.3 Frozen Legacy Incident Reports Table (`incident_reports`)
-- Retained strictly as an empty, read-only frozen compatibility structure
CREATE TABLE incident_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference_number VARCHAR(30) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  category_id INT DEFAULT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  address VARCHAR(255) NOT NULL,
  severity ENUM('Low', 'Medium', 'High', 'Critical') NOT NULL DEFAULT 'Medium',
  status ENUM('Pending', 'Verified', 'Dispatched', 'In Progress', 'Resolved', 'False Alarm') NOT NULL DEFAULT 'Pending',
  is_public TINYINT(1) NOT NULL DEFAULT 1,
  assigned_to INT DEFAULT NULL,
  verified_by INT DEFAULT NULL,
  verified_at TIMESTAMP NULL DEFAULT NULL,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_legacy_incident_user (user_id),
  INDEX idx_legacy_incident_status (status),
  INDEX idx_legacy_incident_severity (severity),
  INDEX idx_legacy_incident_coords (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2.4 Incident Attachments Table (References canonical `reports.id`, ON DELETE RESTRICT)
CREATE TABLE incident_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  incident_id INT NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  file_name VARCHAR(150) NOT NULL,
  file_type VARCHAR(50) DEFAULT NULL,
  file_size INT UNSIGNED DEFAULT NULL,
  uploaded_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_incident_attachments_incident (incident_id),
  CONSTRAINT fk_incident_attachments_report FOREIGN KEY (incident_id) REFERENCES reports(id) ON DELETE RESTRICT,
  CONSTRAINT fk_incident_attachments_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2.5 Incident Status History Table (References canonical `reports.id`, ON DELETE RESTRICT)
CREATE TABLE incident_status_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  incident_id INT NOT NULL,
  old_status VARCHAR(40) DEFAULT NULL,
  new_status VARCHAR(40) NOT NULL,
  changed_by INT NOT NULL,
  remarks TEXT DEFAULT NULL,
  is_internal_note TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_incident_history_incident (incident_id),
  INDEX idx_incident_history_created (created_at),
  CONSTRAINT fk_incident_history_report FOREIGN KEY (incident_id) REFERENCES reports(id) ON DELETE RESTRICT,
  CONSTRAINT fk_incident_history_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2.6 Incident Assignments Table (References canonical `reports.id`, ON DELETE RESTRICT)
CREATE TABLE incident_assignments (
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

-- 2.7 Incident Progress Updates & Field Notes Table (References canonical `reports.id`, ON DELETE RESTRICT)
CREATE TABLE incident_updates (
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

-- ----------------------------------------------------------------------------
-- MODULE 3: EMERGENCY RESCUE REQUESTS & RESPONDER DISPATCH
-- ----------------------------------------------------------------------------

-- 3.1 Emergency Rescue Requests Table
CREATE TABLE rescue_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference_number VARCHAR(30) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  emergency_type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  people_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  vulnerable_details VARCHAR(255) DEFAULT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  address VARCHAR(255) NOT NULL,
  landmark VARCHAR(180) DEFAULT NULL,
  priority ENUM('Critical', 'High', 'Medium', 'Low') NOT NULL,
  status ENUM('Pending Dispatch', 'Assigned', 'Accepted', 'En Route', 'On Scene', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Pending Dispatch',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  confirmed_resolved_at TIMESTAMP NULL DEFAULT NULL,
  resident_confirmed_at TIMESTAMP NULL DEFAULT NULL,
  confirmed_by INT DEFAULT NULL,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_rescue_user (user_id),
  INDEX idx_rescue_status (status),
  INDEX idx_rescue_priority (priority),
  INDEX idx_rescue_coords (latitude, longitude),
  CONSTRAINT fk_rescue_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rescue_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.2 Rescue Assignments Table
CREATE TABLE rescue_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rescue_id INT NOT NULL,
  responder_user_id INT NOT NULL,
  assigned_by INT NOT NULL,
  assignment_status ENUM('Assigned', 'Accepted', 'En Route', 'On Scene', 'Completed', 'Reassigned') NOT NULL DEFAULT 'Assigned',
  dispatch_instructions TEXT DEFAULT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMP NULL DEFAULT NULL,
  en_route_at TIMESTAMP NULL DEFAULT NULL,
  on_scene_at TIMESTAMP NULL DEFAULT NULL,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_rescue_assign_rescue (rescue_id),
  INDEX idx_rescue_assign_responder (responder_user_id),
  INDEX idx_rescue_assign_status (assignment_status),
  CONSTRAINT fk_rescue_assign_request FOREIGN KEY (rescue_id) REFERENCES rescue_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rescue_assign_responder FOREIGN KEY (responder_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rescue_assign_dispatcher FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.3 Rescue Attachments Table
CREATE TABLE rescue_attachments (
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

-- 3.4 Rescue Progress Updates & Field Notes Table
CREATE TABLE rescue_updates (
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

-- 3.5 Rescue Status History Table
CREATE TABLE rescue_status_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  rescue_id INT NOT NULL,
  old_status VARCHAR(40) DEFAULT NULL,
  new_status VARCHAR(40) NOT NULL,
  changed_by INT NOT NULL,
  work_notes TEXT DEFAULT NULL,
  photo_url VARCHAR(255) DEFAULT NULL,
  is_internal_only TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rescue_history_rescue (rescue_id),
  CONSTRAINT fk_rescue_history_request FOREIGN KEY (rescue_id) REFERENCES rescue_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rescue_history_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.6 Responder Assignment History Table
CREATE TABLE responder_assignment_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  responder_user_id INT NOT NULL,
  assignment_type ENUM('rescue', 'incident') NOT NULL,
  rescue_id INT DEFAULT NULL,
  incident_id INT DEFAULT NULL,
  status VARCHAR(40) NOT NULL,
  notes TEXT DEFAULT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_resp_hist_responder (responder_user_id),
  INDEX idx_resp_hist_type (assignment_type),
  CONSTRAINT fk_resp_hist_user FOREIGN KEY (responder_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_resp_hist_rescue FOREIGN KEY (rescue_id) REFERENCES rescue_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_resp_hist_report FOREIGN KEY (incident_id) REFERENCES reports(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- MODULE 4: EVACUATION CENTERS, ROUTES & MEDICAL FACILITIES
-- ----------------------------------------------------------------------------

-- 4.1 Evacuation Centers Table
CREATE TABLE evacuation_centers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  address VARCHAR(255) NOT NULL,
  barangay VARCHAR(100) NOT NULL DEFAULT 'Barangay Bayanan',
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  capacity INT UNSIGNED NOT NULL,
  available_slots INT UNSIGNED NOT NULL,
  total_capacity INT UNSIGNED NOT NULL,
  current_occupancy INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('Open - Accommodating', 'Near Capacity', 'Full / Closed', 'Standby') NOT NULL DEFAULT 'Standby',
  contact_person VARCHAR(120) DEFAULT NULL,
  contact_phone VARCHAR(40) DEFAULT NULL,
  contact_number VARCHAR(40) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_evac_status (status),
  INDEX idx_evac_coords (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.2 Evacuation Center Facilities Table
CREATE TABLE evacuation_center_facilities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  center_id INT NOT NULL,
  facility_name VARCHAR(100) NOT NULL,
  is_available TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_evac_facility_center (center_id),
  CONSTRAINT fk_evac_facility_center FOREIGN KEY (center_id) REFERENCES evacuation_centers(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.3 Emergency Medical Facilities Table (`hospitals`)
CREATE TABLE hospitals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  address VARCHAR(255) NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  emergency_contact VARCHAR(60) NOT NULL,
  status ENUM('Operational', 'Full Capacity', 'Critical Supplies', 'Closed', 'Under Assessment') NOT NULL DEFAULT 'Under Assessment',
  capacity INT UNSIGNED NOT NULL,
  available_slots INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_hospitals_status (status),
  INDEX idx_hospitals_coords (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.4 Evacuation Routes Table
CREATE TABLE evacuation_routes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_name VARCHAR(150) NOT NULL,
  description TEXT DEFAULT NULL,
  route_description TEXT DEFAULT NULL,
  origin_name VARCHAR(150) NOT NULL,
  origin_latitude DECIMAL(10, 8) NOT NULL,
  origin_longitude DECIMAL(11, 8) NOT NULL,
  destination_center_id INT NOT NULL,
  distance_meters INT UNSIGNED DEFAULT NULL,
  estimated_distance_km DECIMAL(6, 2) DEFAULT NULL,
  estimated_duration_seconds INT UNSIGNED DEFAULT NULL,
  estimated_walk_minutes INT UNSIGNED DEFAULT NULL,
  route_type ENUM('pedestrian', 'vehicular', 'accessible') NOT NULL DEFAULT 'pedestrian',
  route_status ENUM('active', 'congested', 'impassable', 'under_review') NOT NULL DEFAULT 'under_review',
  is_official_approved TINYINT(1) NOT NULL DEFAULT 0,
  approval_authority VARCHAR(120) DEFAULT NULL,
  approved_at TIMESTAMP NULL DEFAULT NULL,
  encoded_geometry TEXT DEFAULT NULL,
  path_coordinates JSON DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_evac_routes_center (destination_center_id),
  INDEX idx_evac_routes_status (route_status),
  INDEX idx_evac_routes_type (route_type),
  INDEX idx_evac_routes_approved (is_official_approved),
  CONSTRAINT fk_evac_routes_center FOREIGN KEY (destination_center_id) REFERENCES evacuation_centers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_evac_routes_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.5 Evacuation Route Waypoints Table
CREATE TABLE evacuation_route_waypoints (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  route_id INT NOT NULL,
  sequence_order SMALLINT UNSIGNED NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  instruction VARCHAR(255) DEFAULT NULL,
  landmark_name VARCHAR(120) DEFAULT NULL,
  INDEX idx_route_waypoint (route_id, sequence_order),
  CONSTRAINT fk_route_waypoints_route FOREIGN KEY (route_id) REFERENCES evacuation_routes(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- MODULE 6: NOTIFICATIONS & EMERGENCY BROADCASTS
-- ----------------------------------------------------------------------------

-- 6.1 Notifications Master Table
CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'info',
  severity ENUM('Low', 'Medium', 'Moderate', 'High', 'Critical', 'Info', 'Advisory', 'Warning') NOT NULL DEFAULT 'Medium',
  category ENUM('Alert', 'Dispatch', 'General', 'Report', 'Rescue', 'Broadcast', 'System', 'Incident') NOT NULL DEFAULT 'Alert',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  action_url VARCHAR(255) DEFAULT NULL,
  related_entity_type VARCHAR(60) DEFAULT NULL,
  related_entity_id INT DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_severity (severity),
  INDEX idx_notifications_created (created_at),
  CONSTRAINT fk_notifications_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6.2 Notification Recipients Table
CREATE TABLE notification_recipients (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  notification_id INT NOT NULL,
  user_id INT NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  read_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_notif_recip_user (user_id, is_read),
  CONSTRAINT fk_notif_recip_notif FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE RESTRICT,
  CONSTRAINT fk_notif_recip_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6.3 Dedicated Alerts Table
CREATE TABLE alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message TEXT NOT NULL,
  severity ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_alerts_created (created_at),
  INDEX idx_alerts_severity (severity),
  CONSTRAINT fk_alerts_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6.4 Emergency Broadcast Audit Logs Table
CREATE TABLE emergency_broadcast_logs (
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

-- ----------------------------------------------------------------------------
-- MODULE 7: SECURITY, AUDIT TRAIL & SYSTEM SETTINGS
-- ----------------------------------------------------------------------------

-- 7.1 Administrative Audit Logs Table
CREATE TABLE audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(60) DEFAULT NULL,
  old_values JSON DEFAULT NULL,
  new_values JSON DEFAULT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_action (action),
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_entity (entity_type, entity_id),
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7.2 Authentication & Security Event Logs Table
CREATE TABLE auth_security_logs (
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

-- 7.3 Account Status History Table
CREATE TABLE account_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  previous_status VARCHAR(40) DEFAULT NULL,
  new_status VARCHAR(40) NOT NULL,
  changed_by INT NOT NULL,
  reason VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_account_status_user (user_id),
  CONSTRAINT fk_account_status_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_status_changer FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7.4 System Settings Table
CREATE TABLE system_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  category ENUM('eoc', 'evacuation', 'dispatch', 'system') NOT NULL DEFAULT 'system',
  setting_value TEXT DEFAULT NULL,
  description VARCHAR(255) DEFAULT NULL,
  is_protected TINYINT(1) NOT NULL DEFAULT 1,
  updated_by INT DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_settings_key (setting_key),
  INDEX idx_settings_category (category),
  CONSTRAINT fk_settings_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- DATABASE TRIGGERS (18 ENFORCEMENT, SYNC & AUDIT-PROTECTION TRIGGERS)
-- ----------------------------------------------------------------------------

DELIMITER $

-- 1. User Role Synchronization & User Code Immutability Triggers
CREATE TRIGGER trg_users_sync_role_insert
BEFORE INSERT ON users
FOR EACH ROW
BEGIN
  DECLARE v_role_name VARCHAR(50);

  IF (NEW.role_id IS NULL OR NEW.role_id = 3) AND NEW.role IS NOT NULL THEN
    SET NEW.role_id = CASE NEW.role
      WHEN 'admin' THEN 1
      WHEN 'responder' THEN 2
      WHEN 'resident' THEN 3
      ELSE NULL
    END;
  END IF;

  IF NEW.role_id IS NULL THEN
    SET NEW.role_id = 3;
  END IF;

  SELECT name INTO v_role_name FROM roles WHERE id = NEW.role_id LIMIT 1;
  IF v_role_name IS NULL OR NEW.role_id NOT IN (1, 2, 3) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unauthorized or non-existent role_id. Only Administrator (1), Responder (2), and Resident (3) are permitted.';
  END IF;

  IF NEW.role IS NOT NULL THEN
    IF (NEW.role_id = 1 AND NEW.role <> 'admin')
       OR (NEW.role_id = 2 AND NEW.role <> 'responder')
       OR (NEW.role_id = 3 AND NEW.role <> 'resident') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Role mismatch between users.role_id and users.role on INSERT';
    END IF;
  END IF;

  SET NEW.role = CASE NEW.role_id
    WHEN 1 THEN 'admin'
    WHEN 2 THEN 'responder'
    ELSE 'resident'
  END;
END$

CREATE TRIGGER trg_users_sync_role_update
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
  DECLARE v_role_name VARCHAR(50);

  IF NEW.role_id <> OLD.role_id AND NEW.role <> OLD.role THEN
    IF (NEW.role_id = 1 AND NEW.role <> 'admin')
       OR (NEW.role_id = 2 AND NEW.role <> 'responder')
       OR (NEW.role_id = 3 AND NEW.role <> 'resident') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Conflicting simultaneous update to users.role_id and users.role';
    END IF;
  ELSEIF NEW.role <> OLD.role AND NEW.role_id = OLD.role_id THEN
    SET NEW.role_id = CASE NEW.role
      WHEN 'admin' THEN 1
      WHEN 'responder' THEN 2
      WHEN 'resident' THEN 3
      ELSE NULL
    END;
  END IF;

  SELECT name INTO v_role_name FROM roles WHERE id = NEW.role_id LIMIT 1;
  IF v_role_name IS NULL OR NEW.role_id NOT IN (1, 2, 3) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unauthorized or non-existent role_id. Only Administrator (1), Responder (2), and Resident (3) are permitted.';
  END IF;

  SET NEW.role = CASE NEW.role_id
    WHEN 1 THEN 'admin'
    WHEN 2 THEN 'responder'
    ELSE 'resident'
  END;
END$

CREATE TRIGGER trg_users_user_code_immutable
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
  IF OLD.user_code IS NOT NULL AND NEW.user_code IS NOT NULL AND NEW.user_code <> OLD.user_code THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'user_code is permanent and immutable; it cannot be modified once assigned.';
  END IF;
END$

-- 2. Frozen Legacy `incident_reports` Protection Triggers
CREATE TRIGGER trg_incident_reports_freeze_insert
BEFORE INSERT ON incident_reports
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incident_reports is a frozen legacy table. Insert incidents into reports.';
END$$

CREATE TRIGGER trg_incident_reports_freeze_update
BEFORE UPDATE ON incident_reports
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incident_reports is a frozen legacy table. Update incidents in reports.';
END$$

CREATE TRIGGER trg_incident_reports_freeze_delete
BEFORE DELETE ON incident_reports
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incident_reports is a frozen legacy table.';
END$$

-- 7. Immutable Audit & Historical Log Triggers (Prevent DELETE and UPDATE)
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

-- ----------------------------------------------------------------------------
-- CANONICAL APPLICATION ROLES (RBAC DEFINITION ONLY — ZERO OPERATIONAL DATA)
-- ----------------------------------------------------------------------------
INSERT INTO roles (id, name, description) VALUES
  (1, 'Administrator', 'Full emergency operations command, user governance, and disaster dispatch oversight'),
  (2, 'Responder', 'Field responder unit handling active incident verification and rescue missions'),
  (3, 'Resident', 'Community member reporting incidents, requesting rescue, and monitoring alerts');

INSERT INTO role_sequences (role_id, role_name, prefix, next_val) VALUES
  (1, 'Administrator', 'ADM', 1),
  (2, 'Responder', 'RSPDR', 1),
  (3, 'Resident', 'RSDNT', 1);


-- ----------------------------------------------------------------------------
-- VERIFIED BARANGAY BAYANAN GEOGRAPHICAL & FACILITY SEED DATA (MODULE E)
-- ----------------------------------------------------------------------------
INSERT INTO incident_categories (id, name, description, default_severity, is_active) VALUES
  (1, 'Flooding', 'Street, residential, or lakeshore flooding in Barangay Bayanan', 'High', 1),
  (2, 'Fire', 'Structural, residential, or electrical fire emergency', 'Critical', 1),
  (3, 'Medical Emergency', 'Urgent medical assistance or injury response', 'High', 1),
  (4, 'Road Obstruction / Fallen Tree', 'Blocked roads, fallen trees, or debris hazards', 'Medium', 1),
  (5, 'Power Line / Utility Hazard', 'Downed power lines, transformer sparks, or utility leaks', 'High', 1),
  (6, 'Structural Damage', 'Collapsed walls, damaged roofs, or unsafe structures', 'High', 1);

INSERT INTO evacuation_centers
  (id, name, address, barangay, latitude, longitude, capacity, available_slots, total_capacity, current_occupancy, status, contact_person, contact_phone, contact_number)
VALUES
  (1, 'Bayanan Elementary School Main', 'National Road, Barangay Bayanan, Muntinlupa City', 'Barangay Bayanan', 14.40820000, 121.04580000, 500, 420, 500, 80, 'Open - Accommodating', 'Engr. Ramon Bautista (BDRRMC)', '0917-555-0101', '0917-555-0101'),
  (2, 'Barangay Bayanan Multi-Purpose Covered Court', 'Bayanan Road cor. Purok 2, Barangay Bayanan, Muntinlupa City', 'Barangay Bayanan', 14.40710000, 121.04790000, 350, 290, 350, 60, 'Open - Accommodating', 'Kag. Lorna Mendoza', '0917-555-0102', '0917-555-0102'),
  (3, 'Bayanan Elementary School Unit I', 'Purok 4 Interior, Barangay Bayanan, Muntinlupa City', 'Barangay Bayanan', 14.40950000, 121.04920000, 400, 365, 400, 35, 'Open - Accommodating', 'Maria Teresa Villanueva', '0917-555-0103', '0917-555-0103'),
  (4, 'Summitville Community Evacuation Center', 'Summitville Subdivision, Barangay Bayanan, Muntinlupa City', 'Barangay Bayanan', 14.40580000, 121.04350000, 250, 250, 250, 0, 'Standby', 'Capt. Eduardo Santos', '0917-555-0104', '0917-555-0104');

INSERT INTO evacuation_center_facilities (center_id, facility_name, is_available) VALUES
  (1, 'First Aid & Triage Station', 1),
  (1, 'Potable Water Supply', 1),
  (1, 'Emergency Generator', 1),
  (1, 'Community Kitchen', 1),
  (1, 'Restrooms & Wash Area', 1),
  (2, 'First Aid & Triage Station', 1),
  (2, 'Potable Water Supply', 1),
  (2, 'Emergency Generator', 1),
  (2, 'Restrooms & Wash Area', 1),
  (3, 'First Aid & Triage Station', 1),
  (3, 'Potable Water Supply', 1),
  (3, 'Community Kitchen', 1),
  (3, 'Breastfeeding & Child-Friendly Space', 1),
  (4, 'First Aid & Triage Station', 1),
  (4, 'Potable Water Supply', 1),
  (4, 'Restrooms & Wash Area', 1);

INSERT INTO evacuation_routes
  (id, route_name, description, route_description, origin_name, origin_latitude, origin_longitude,
   destination_center_id, distance_meters, estimated_distance_km, estimated_duration_seconds, estimated_walk_minutes,
   route_type, route_status, is_official_approved, approval_authority, approved_at, encoded_geometry, path_coordinates, created_by)
VALUES
  (1, 'Baywalk Lakeshore to Bayanan Elementary School Main',
   'Primary flood-safe pedestrian corridor from Laguna Lake Baywalk Purok 1 westward along Bayanan Road to National Road.',
   'Primary flood-safe pedestrian corridor from Laguna Lake Baywalk Purok 1 westward along Bayanan Road to National Road.',
   'Bayanan Baywalk Lakeshore (Purok 1)', 14.40650000, 121.05100000,
   1, 650, 0.65, 480, 8, 'pedestrian', 'active', 1, 'Barangay Bayanan BDRRMC', CURRENT_TIMESTAMP,
   '[[14.4065,121.051],[14.4071,121.049],[14.4076,121.0472],[14.4082,121.0458]]',
   '[[14.4065,121.051],[14.4071,121.049],[14.4076,121.0472],[14.4082,121.0458]]', NULL),
  (2, 'Purok 3 & 5 Coastal Zone to Bayanan Multi-Purpose Covered Court',
   'Direct elevated access route from coastal Purok 3 and Purok 5 to the Barangay Bayanan Multi-Purpose Covered Court.',
   'Direct elevated access route from coastal Purok 3 and Purok 5 to the Barangay Bayanan Multi-Purpose Covered Court.',
   'Bayanan Coastal Purok 3 Junction', 14.40880000, 121.05150000,
   2, 480, 0.48, 360, 6, 'pedestrian', 'active', 1, 'Barangay Bayanan BDRRMC', CURRENT_TIMESTAMP,
   '[[14.4088,121.0515],[14.408,121.0498],[14.4071,121.0479]]',
   '[[14.4088,121.0515],[14.408,121.0498],[14.4071,121.0479]]', NULL),
  (3, 'North Bayanan Purok 6 to Bayanan Elementary School Unit I',
   'Secondary northern evacuation path serving Purok 6 and interior compounds to Bayanan Elementary School Unit I.',
   'Secondary northern evacuation path serving Purok 6 and interior compounds to Bayanan Elementary School Unit I.',
   'Purok 6 North Compound', 14.41050000, 121.05180000,
   3, 350, 0.35, 240, 4, 'accessible', 'active', 1, 'Barangay Bayanan BDRRMC', CURRENT_TIMESTAMP,
   '[[14.4105,121.0518],[14.41,121.0505],[14.4095,121.0492]]',
   '[[14.4105,121.0518],[14.41,121.0505],[14.4095,121.0492]]', NULL);

INSERT INTO evacuation_route_waypoints
  (route_id, sequence_order, latitude, longitude, instruction, landmark_name)
VALUES
  (1, 1, 14.40650000, 121.05100000, 'Start at Bayanan Baywalk Lakeshore assembly marker and head west on Bayanan Road.', 'Bayanan Baywalk Assembly Point'),
  (1, 2, 14.40710000, 121.04900000, 'Continue straight past Purok 2 junction staying on elevated sidewalk.', 'Purok 2 Junction'),
  (1, 3, 14.40760000, 121.04720000, 'Pass Barangay Bayanan Hall and proceed toward National Road.', 'Barangay Bayanan Hall'),
  (1, 4, 14.40820000, 121.04580000, 'Enter Bayanan Elementary School Main gate on National Road.', 'Bayanan Elementary School Main Gate'),
  (2, 1, 14.40880000, 121.05150000, 'Assemble at Purok 3 coastal marker and move southwest away from shoreline.', 'Purok 3 Coastal Marker'),
  (2, 2, 14.40800000, 121.04980000, 'Turn right onto Bayanan Interior Road toward the barangay complex.', 'Bayanan Interior Road'),
  (2, 3, 14.40710000, 121.04790000, 'Arrive at Barangay Bayanan Multi-Purpose Covered Court.', 'Bayanan Covered Court'),
  (3, 1, 14.41050000, 121.05180000, 'Depart Purok 6 North Compound heading west.', 'Purok 6 Waiting Shed'),
  (3, 2, 14.41000000, 121.05050000, 'Follow Purok 4 street sign toward Unit I school campus.', 'Purok 4 Corner'),
  (3, 3, 14.40950000, 121.04920000, 'Arrive at Bayanan Elementary School Unit I.', 'BES Unit I Gate');

INSERT INTO hospitals
  (id, name, address, latitude, longitude, emergency_contact, status, capacity, available_slots)
VALUES
  (1, 'Ospital ng Muntinlupa (OsMun)', 'Civic Drive, Filinvest Corporate City, Alabang, Muntinlupa City', 14.41680000, 121.04420000, '(02) 8771-0457', 'Operational', 200, 45),
  (2, 'Barangay Bayanan Health Center & Emergency Clinic', 'Bayanan Road, Barangay Bayanan, Muntinlupa City', 14.40740000, 121.04760000, '(02) 8862-0115', 'Operational', 30, 18),
  (3, 'Medical Center Muntinlupa (MCM)', '38 National Road, Putatan, Muntinlupa City', 14.39820000, 121.04510000, '(02) 8862-0162', 'Operational', 120, 28),
  (4, 'Asian Hospital and Medical Center', '2205 Civic Drive, Filinvest Corporate City, Alabang, Muntinlupa City', 14.41430000, 121.04360000, '(02) 8771-9000', 'Operational', 300, 62);
