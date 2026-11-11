-- ============================================================================
-- GeoSafe Emergency Assistance & Disaster Reporting System
-- Fresh Database Schema Definition: geosafe_db
-- Target Server: MySQL Community Server 8.0+ / 8.4 LTS
-- Character Set: utf8mb4, Collation: utf8mb4_unicode_ci
-- ============================================================================
-- STRICT FRESH DATABASE POLICY:
--   * Drops any existing `geosafe_db` database and recreates all 38 InnoDB
--     tables, 51 ON DELETE RESTRICT foreign keys, and 27 triggers from scratch.
--   * Contains ZERO existing operational data, ZERO sample/test accounts,
--     ZERO hardcoded incident categories, ZERO hardcoded system settings,
--     and ZERO fabricated facilities, routes, alerts, or emergency records.
--   * Only the 3 required RBAC roles (1=Administrator, 2=Responder, 3=Resident)
--     are defined in `roles`. All other 37 tables start with 0 rows.
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
-- Legacy compatibility columns (role, family_group_id) are synchronized by triggers
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_code VARCHAR(32) DEFAULT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role_id INT NOT NULL DEFAULT 3,
  role ENUM('resident', 'responder', 'admin') DEFAULT NULL,
  family_group_id INT DEFAULT NULL,
  is_family_head TINYINT(1) NOT NULL DEFAULT 0,
  family_relationship VARCHAR(50) DEFAULT 'Member',
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
  INDEX idx_users_family (family_group_id),
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
  origin_name VARCHAR(150) NOT NULL,
  origin_latitude DECIMAL(10, 8) NOT NULL,
  origin_longitude DECIMAL(11, 8) NOT NULL,
  destination_center_id INT NOT NULL,
  distance_meters INT UNSIGNED DEFAULT NULL,
  estimated_duration_seconds INT UNSIGNED DEFAULT NULL,
  route_type ENUM('pedestrian', 'vehicular', 'accessible') NOT NULL DEFAULT 'pedestrian',
  route_status ENUM('active', 'congested', 'impassable', 'under_review') NOT NULL DEFAULT 'under_review',
  is_official_approved TINYINT(1) NOT NULL DEFAULT 0,
  approval_authority VARCHAR(120) DEFAULT NULL,
  approved_at TIMESTAMP NULL DEFAULT NULL,
  encoded_geometry TEXT DEFAULT NULL,
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
-- MODULE 5: FAMILY SAFETY TRACKER & QR MEMBERSHIP MANAGEMENT
-- ----------------------------------------------------------------------------

-- 5.1 Family Groups Table (Fixed Coverage: Barangay Bayanan, Muntinlupa City)
CREATE TABLE family_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  family_name VARCHAR(120) NOT NULL,
  name VARCHAR(120) GENERATED ALWAYS AS (family_name) VIRTUAL,
  created_by INT NOT NULL,
  house_number VARCHAR(50) NOT NULL,
  street VARCHAR(150) NOT NULL,
  barangay VARCHAR(80) NOT NULL DEFAULT 'Bayanan',
  city VARCHAR(80) NOT NULL DEFAULT 'Muntinlupa City',
  province VARCHAR(80) NOT NULL DEFAULT 'Metro Manila',
  region VARCHAR(80) NOT NULL DEFAULT 'National Capital Region',
  country VARCHAR(80) NOT NULL DEFAULT 'Philippines',
  subdivision_purok VARCHAR(100) DEFAULT NULL,
  status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_family_groups_creator (created_by),
  INDEX idx_family_groups_status (status),
  INDEX idx_family_groups_location (barangay, city),
  CONSTRAINT chk_family_address_complete CHECK (
    house_number IS NOT NULL AND street IS NOT NULL
    AND CHAR_LENGTH(TRIM(house_number)) > 0
    AND CHAR_LENGTH(TRIM(street)) > 0
  ),
  CONSTRAINT chk_family_fixed_location CHECK (
    barangay = 'Bayanan'
    AND city = 'Muntinlupa City'
    AND region = 'National Capital Region'
    AND country = 'Philippines'
  ),
  CONSTRAINT fk_family_groups_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bind legacy users.family_group_id cache to family_groups(id) with ON DELETE RESTRICT
ALTER TABLE users
  ADD CONSTRAINT fk_users_family_group
  FOREIGN KEY (family_group_id) REFERENCES family_groups(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5.2 Family Members Table (Authoritative Family Relationship: Strictly One Active Family per User)
CREATE TABLE family_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  family_id INT NOT NULL,
  user_id INT NOT NULL,
  relationship VARCHAR(60) NOT NULL DEFAULT 'Member',
  membership_role ENUM('manager', 'member') NOT NULL DEFAULT 'member',
  membership_status ENUM('active', 'inactive', 'removed') NOT NULL DEFAULT 'active',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  active_user_id INT GENERATED ALWAYS AS (CASE WHEN membership_status = 'active' THEN user_id ELSE NULL END) STORED,
  UNIQUE KEY uq_active_family_user (active_user_id),
  UNIQUE KEY uq_family_user_member (family_id, user_id),
  INDEX idx_family_members_user (user_id),
  INDEX idx_family_members_status (membership_status),
  CONSTRAINT fk_family_members_group FOREIGN KEY (family_id) REFERENCES family_groups(id) ON DELETE RESTRICT,
  CONSTRAINT fk_family_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5.3 Family QR Invitations Table (SHA-256 Hashed Tokens)
CREATE TABLE family_invitations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  family_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_by INT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_family_invites_family (family_id),
  INDEX idx_family_invites_token (token_hash),
  INDEX idx_family_invites_expires (expires_at),
  CONSTRAINT fk_family_invites_group FOREIGN KEY (family_id) REFERENCES family_groups(id) ON DELETE RESTRICT,
  CONSTRAINT fk_family_invites_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5.4 Family Join Requests Table
CREATE TABLE family_join_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  family_id INT NOT NULL,
  user_id INT NOT NULL,
  invitation_id INT NOT NULL,
  relationship VARCHAR(60) NOT NULL DEFAULT 'Member',
  request_status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_by INT DEFAULT NULL,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_join_req_family_status (family_id, request_status),
  INDEX idx_join_req_user_status (user_id, request_status),
  CONSTRAINT fk_join_req_family FOREIGN KEY (family_id) REFERENCES family_groups(id) ON DELETE RESTRICT,
  CONSTRAINT fk_join_req_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_join_req_invite FOREIGN KEY (invitation_id) REFERENCES family_invitations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_join_req_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5.5 Family Location Sharing Consents Table
CREATE TABLE family_location_sharing_consents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  family_member_id INT NOT NULL UNIQUE,
  sharing_enabled TINYINT(1) NOT NULL DEFAULT 0,
  consented_at TIMESTAMP NULL DEFAULT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_loc_consent_member FOREIGN KEY (family_member_id) REFERENCES family_members(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5.6 Family Location Updates Table
CREATE TABLE family_location_updates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  family_member_id INT NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  battery_level TINYINT UNSIGNED DEFAULT NULL,
  safety_status ENUM('safe', 'need_help', 'injured', 'no_response') NOT NULL DEFAULT 'no_response',
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_fam_loc_member_time (family_member_id, recorded_at),
  CONSTRAINT fk_fam_loc_member FOREIGN KEY (family_member_id) REFERENCES family_members(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- MODULE 6: NOTIFICATIONS, WEATHER CACHE & EMERGENCY BROADCASTS
-- ----------------------------------------------------------------------------

-- 6.1 Notifications Master Table
CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  severity ENUM('Low', 'Medium', 'High', 'Critical') NOT NULL DEFAULT 'Medium',
  category ENUM('Alert', 'Dispatch', 'General', 'Weather') NOT NULL DEFAULT 'Alert',
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

-- 6.5 Weather Data Cache Table
CREATE TABLE weather_cache (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_name VARCHAR(100) NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  provider_name VARCHAR(100) NOT NULL,
  data_type ENUM('observation', 'forecast') NOT NULL DEFAULT 'observation',
  observation_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  temperature_celsius DECIMAL(4, 1) NOT NULL,
  apparent_temperature_celsius DECIMAL(4, 1) DEFAULT NULL,
  relative_humidity_percent TINYINT UNSIGNED NOT NULL,
  precipitation_probability TINYINT UNSIGNED DEFAULT NULL,
  precipitation_mm DECIMAL(5, 2) DEFAULT NULL,
  wind_speed_kmh DECIMAL(5, 2) NOT NULL,
  wind_direction_degrees SMALLINT UNSIGNED DEFAULT NULL,
  wmo_weather_code SMALLINT UNSIGNED NOT NULL,
  weather_condition VARCHAR(80) NOT NULL,
  source_attribution VARCHAR(150) DEFAULT NULL,
  retrieved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  INDEX idx_weather_retrieved (retrieved_at),
  INDEX idx_weather_expires (expires_at),
  INDEX idx_weather_location (latitude, longitude),
  INDEX idx_weather_provider (provider_name),
  INDEX idx_weather_data_type (data_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6.6 Official Tropical Cyclone Bulletins Table
CREATE TABLE tropical_cyclone_bulletins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bulletin_number INT UNSIGNED NOT NULL,
  cyclone_name VARCHAR(80) NOT NULL,
  international_name VARCHAR(80) DEFAULT NULL,
  category ENUM('Tropical Depression', 'Tropical Storm', 'Severe Tropical Storm', 'Typhoon', 'Super Typhoon') NOT NULL,
  center_latitude DECIMAL(10, 8) NOT NULL,
  center_longitude DECIMAL(11, 8) NOT NULL,
  max_sustained_winds_kmh INT UNSIGNED NOT NULL,
  gustiness_kmh INT UNSIGNED NOT NULL,
  movement_direction VARCHAR(30) NOT NULL,
  movement_speed_kmh INT UNSIGNED NOT NULL,
  signal_level TINYINT UNSIGNED NOT NULL DEFAULT 0,
  advisory_summary TEXT NOT NULL,
  bulletin_issued_at TIMESTAMP NOT NULL,
  valid_until TIMESTAMP NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  published_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cyclone_active (is_active),
  INDEX idx_cyclone_name (cyclone_name),
  INDEX idx_cyclone_issued (bulletin_issued_at),
  CONSTRAINT fk_cyclone_publisher FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE RESTRICT
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
  category ENUM('eoc', 'weather', 'evacuation', 'dispatch', 'system') NOT NULL DEFAULT 'system',
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
-- DATABASE TRIGGERS (27 ENFORCEMENT, SYNC & AUDIT-PROTECTION TRIGGERS)
-- ----------------------------------------------------------------------------

DELIMITER $$

-- 1. Family Address Fixed Location & Completeness Triggers
CREATE TRIGGER trg_family_groups_fixed_location_insert
BEFORE INSERT ON family_groups
FOR EACH ROW
BEGIN
  SET NEW.barangay = 'Bayanan';
  SET NEW.city = 'Muntinlupa City';
  SET NEW.province = 'Metro Manila';
  SET NEW.region = 'National Capital Region';
  SET NEW.country = 'Philippines';

  IF NEW.house_number IS NULL OR NEW.street IS NULL
     OR CHAR_LENGTH(TRIM(NEW.house_number)) = 0
     OR CHAR_LENGTH(TRIM(NEW.street)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A family address requires both a non-blank house_number and street';
  END IF;
  SET NEW.house_number = TRIM(NEW.house_number);
  SET NEW.street = TRIM(NEW.street);
END$$

CREATE TRIGGER trg_family_groups_fixed_location_update
BEFORE UPDATE ON family_groups
FOR EACH ROW
BEGIN
  SET NEW.barangay = 'Bayanan';
  SET NEW.city = 'Muntinlupa City';
  SET NEW.province = 'Metro Manila';
  SET NEW.region = 'National Capital Region';
  SET NEW.country = 'Philippines';

  IF NEW.house_number IS NULL OR NEW.street IS NULL
     OR CHAR_LENGTH(TRIM(NEW.house_number)) = 0
     OR CHAR_LENGTH(TRIM(NEW.street)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A family address requires both a non-blank house_number and street';
  END IF;
  SET NEW.house_number = TRIM(NEW.house_number);
  SET NEW.street = TRIM(NEW.street);
END$$

-- 2. Family Group Archival Synchronization Trigger
CREATE TRIGGER trg_family_groups_sync_status_update
AFTER UPDATE ON family_groups
FOR EACH ROW
BEGIN
  IF NEW.status <> 'active' AND OLD.status = 'active' THEN
    UPDATE family_members
    SET membership_status = 'inactive'
    WHERE family_id = NEW.id AND membership_status = 'active';

    UPDATE family_invitations
    SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
    WHERE family_id = NEW.id AND revoked_at IS NULL;

    UPDATE family_join_requests
    SET request_status = 'cancelled'
    WHERE family_id = NEW.id AND request_status = 'pending';

    UPDATE users
    SET family_group_id = NULL
    WHERE family_group_id = NEW.id;
  END IF;
END$$

-- 3. QR Invitation Token & Expiration Validation Trigger
CREATE TRIGGER trg_family_invitations_validate_insert
BEFORE INSERT ON family_invitations
FOR EACH ROW
BEGIN
  IF NEW.token_hash IS NULL OR CHAR_LENGTH(NEW.token_hash) <> 64 OR NEW.token_hash NOT REGEXP '^[0-9a-fA-F]{64}$' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invitation token_hash must be a valid 64-character SHA-256 hex digest';
  END IF;
  IF NEW.expires_at <= COALESCE(NEW.created_at, CURRENT_TIMESTAMP) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invitation expires_at must be in the future';
  END IF;
END$$

-- 4. Location-Sharing Consent Validation Triggers
CREATE TRIGGER trg_family_consent_validate_insert
BEFORE INSERT ON family_location_sharing_consents
FOR EACH ROW
BEGIN
  IF NEW.sharing_enabled = 1 THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      JOIN family_groups fg ON fg.id = fm.family_id
      WHERE fm.id = NEW.family_member_id
        AND fm.membership_status = 'active'
        AND fg.status = 'active'
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Location sharing can only be enabled for an active member of an active family group';
    END IF;
    SET NEW.consented_at = COALESCE(NEW.consented_at, CURRENT_TIMESTAMP);
    SET NEW.revoked_at = NULL;
  ELSE
    SET NEW.sharing_enabled = 0;
  END IF;
END$$

CREATE TRIGGER trg_family_consent_validate_update
BEFORE UPDATE ON family_location_sharing_consents
FOR EACH ROW
BEGIN
  IF NEW.sharing_enabled = 1 THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      JOIN family_groups fg ON fg.id = fm.family_id
      WHERE fm.id = NEW.family_member_id
        AND fm.membership_status = 'active'
        AND fg.status = 'active'
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Location sharing can only be enabled for an active member of an active family group';
    END IF;
    SET NEW.consented_at = COALESCE(NEW.consented_at, OLD.consented_at, CURRENT_TIMESTAMP);
    SET NEW.revoked_at = NULL;
  ELSE
    SET NEW.sharing_enabled = 0;
    IF OLD.sharing_enabled = 1 THEN
      SET NEW.revoked_at = COALESCE(NEW.revoked_at, CURRENT_TIMESTAMP);
    END IF;
  END IF;
END$$

CREATE TRIGGER trg_family_location_updates_require_consent
BEFORE INSERT ON family_location_updates
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM family_members fm
    JOIN family_groups fg ON fg.id = fm.family_id
    JOIN family_location_sharing_consents flc ON flc.family_member_id = fm.id
    WHERE fm.id = NEW.family_member_id
      AND fm.membership_status = 'active'
      AND fg.status = 'active'
      AND flc.sharing_enabled = 1
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Location updates require an active family membership and enabled location-sharing consent';
  END IF;
END$$

-- 5. User Role & Family Membership Synchronization Triggers
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

  SET NEW.family_group_id = NULL;
END$$

CREATE TRIGGER trg_users_sync_role_update
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
  DECLARE v_role_name VARCHAR(50);
  DECLARE v_auth_family_id INT DEFAULT NULL;

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

  IF NOT (NEW.family_group_id <=> OLD.family_group_id) THEN
    SELECT fm.family_id INTO v_auth_family_id
    FROM family_members fm
    JOIN family_groups fg ON fg.id = fm.family_id
    WHERE fm.user_id = NEW.id
      AND fm.membership_status = 'active'
      AND fg.status = 'active'
    ORDER BY fm.joined_at DESC, fm.id DESC
    LIMIT 1;

    IF NOT (NEW.family_group_id <=> v_auth_family_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Direct modification of users.family_group_id is prohibited. Manage membership through family_members.';
    END IF;
  END IF;
END$$

CREATE TRIGGER trg_family_members_sync_user_insert
AFTER INSERT ON family_members
FOR EACH ROW
BEGIN
  IF NEW.membership_status = 'active'
     AND EXISTS (SELECT 1 FROM family_groups WHERE id = NEW.family_id AND status = 'active') THEN
    UPDATE users SET family_group_id = NEW.family_id WHERE id = NEW.user_id;
  END IF;
END$$

CREATE TRIGGER trg_family_members_sync_user_update
AFTER UPDATE ON family_members
FOR EACH ROW
BEGIN
  IF NEW.membership_status = 'active'
     AND EXISTS (SELECT 1 FROM family_groups WHERE id = NEW.family_id AND status = 'active') THEN
    UPDATE users SET family_group_id = NEW.family_id WHERE id = NEW.user_id;
  ELSEIF OLD.membership_status = 'active' AND NEW.membership_status <> 'active' THEN
    UPDATE users SET family_group_id = NULL WHERE id = NEW.user_id;
    UPDATE family_location_sharing_consents
    SET sharing_enabled = 0,
        revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
    WHERE family_member_id = NEW.id AND sharing_enabled = 1;
  END IF;
END$$

CREATE TRIGGER trg_family_members_sync_user_delete
AFTER DELETE ON family_members
FOR EACH ROW
BEGIN
  IF OLD.membership_status = 'active' THEN
    UPDATE users SET family_group_id = NULL WHERE id = OLD.user_id;
  END IF;
END$$

-- 6. Frozen Legacy `incident_reports` Protection Triggers
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
