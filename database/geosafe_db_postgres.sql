-- ============================================================================
-- GeoSafe: A Web-Based Disaster Preparedness and Emergency Response System for
-- Real-Time Incident Reporting and Evacuation Route Mapping in Barangay Bayanan,
-- Muntinlupa City
-- ============================================================================
-- Native PostgreSQL Schema Definition: geosafe_db
-- Target Server: PostgreSQL 16+ / 18+
-- Encoding: UTF8
-- ============================================================================

BEGIN;

-- Drop existing tables in reverse dependency order if re-initializing
DROP TABLE IF EXISTS system_settings CASCADE;
DROP TABLE IF EXISTS emergency_broadcast_logs CASCADE;
DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS notification_recipients CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS evacuation_route_waypoints CASCADE;
DROP TABLE IF EXISTS evacuation_routes CASCADE;
DROP TABLE IF EXISTS hospitals CASCADE;
DROP TABLE IF EXISTS evacuation_center_facilities CASCADE;
DROP TABLE IF EXISTS evacuation_centers CASCADE;
DROP TABLE IF EXISTS responder_assignment_history CASCADE;
DROP TABLE IF EXISTS rescue_status_history CASCADE;
DROP TABLE IF EXISTS rescue_updates CASCADE;
DROP TABLE IF EXISTS rescue_attachments CASCADE;
DROP TABLE IF EXISTS rescue_assignments CASCADE;
DROP TABLE IF EXISTS rescue_requests CASCADE;
DROP TABLE IF EXISTS incident_updates CASCADE;
DROP TABLE IF EXISTS incident_assignments CASCADE;
DROP TABLE IF EXISTS incident_status_history CASCADE;
DROP TABLE IF EXISTS incident_attachments CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS incident_categories CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS auth_security_logs CASCADE;
DROP TABLE IF EXISTS account_status_history CASCADE;
DROP TABLE IF EXISTS responder_profiles CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS role_sequences CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- ============================================================================
-- MODULE 1: AUTHENTICATION, ROLES & USER ACCOUNTS
-- ============================================================================

-- 1.1 Roles Definition Table (Strictly 3 Canonical System Roles)
CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1.2 Role Sequences Table (Atomic sequence generation per canonical role)
CREATE TABLE role_sequences (
  role_id INTEGER NOT NULL PRIMARY KEY REFERENCES roles(id) ON DELETE RESTRICT,
  role_name VARCHAR(50) NOT NULL UNIQUE,
  prefix VARCHAR(10) NOT NULL UNIQUE,
  next_val INTEGER NOT NULL DEFAULT 1 CHECK (next_val >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1.3 Core Users Table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  user_code VARCHAR(32) DEFAULT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role_id INTEGER NOT NULL DEFAULT 3 REFERENCES roles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  role VARCHAR(20) DEFAULT NULL CHECK (role IN ('resident', 'responder', 'admin')),
  safety_status VARCHAR(20) NOT NULL DEFAULT 'no_response' CHECK (safety_status IN ('safe', 'need_help', 'injured', 'no_response')),
  last_latitude NUMERIC(10, 8) DEFAULT NULL,
  last_longitude NUMERIC(11, 8) DEFAULT NULL,
  last_location_at TIMESTAMPTZ DEFAULT NULL,
  battery_level SMALLINT DEFAULT NULL CHECK (battery_level IS NULL OR (battery_level >= 0 AND battery_level <= 100)),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
  account_status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'deactivated')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  reset_token_hash VARCHAR(255) DEFAULT NULL,
  reset_token_expires TIMESTAMPTZ DEFAULT NULL,
  last_login_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_role_enum ON users(role);
CREATE INDEX idx_users_status ON users(account_status);

-- 1.4 Resident User Profiles Table (1:1 with users)
CREATE TABLE user_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  first_name VARCHAR(80) NOT NULL,
  middle_name VARCHAR(80) DEFAULT NULL,
  last_name VARCHAR(80) NOT NULL,
  phone_number VARCHAR(30) DEFAULT NULL,
  street_address VARCHAR(255) DEFAULT NULL,
  barangay VARCHAR(100) NOT NULL DEFAULT 'Barangay Bayanan',
  city VARCHAR(100) NOT NULL DEFAULT 'Muntinlupa City',
  province VARCHAR(100) NOT NULL DEFAULT 'Metro Manila',
  postal_code VARCHAR(20) DEFAULT NULL,
  verification_status VARCHAR(40) NOT NULL DEFAULT 'Unverified Resident' CHECK (verification_status IN ('Unverified Resident', 'Verified Resident')),
  barangay_id_number VARCHAR(60) DEFAULT NULL,
  household_members_count SMALLINT NOT NULL DEFAULT 1 CHECK (household_members_count >= 1),
  emergency_contact_name VARCHAR(120) DEFAULT NULL,
  emergency_contact_relationship VARCHAR(60) DEFAULT NULL,
  emergency_contact_phone VARCHAR(30) DEFAULT NULL,
  medical_notes TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1.5 Responder Operational Profiles Table (1:1 with Responder users)
CREATE TABLE responder_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  badge_number VARCHAR(50) NOT NULL UNIQUE,
  callsign VARCHAR(50) DEFAULT NULL,
  assigned_unit VARCHAR(120) NOT NULL,
  department VARCHAR(120) NOT NULL DEFAULT 'Barangay Bayanan Emergency Operations',
  specialization VARCHAR(100) DEFAULT NULL,
  organization VARCHAR(150) DEFAULT NULL,
  custom_organization VARCHAR(150) DEFAULT NULL,
  designation VARCHAR(120) DEFAULT NULL,
  service_id VARCHAR(80) DEFAULT NULL,
  availability_status VARCHAR(20) NOT NULL DEFAULT 'Off Duty' CHECK (availability_status IN ('On Duty', 'Off Duty', 'Unavailable')),
  current_latitude NUMERIC(10, 8) DEFAULT NULL,
  current_longitude NUMERIC(11, 8) DEFAULT NULL,
  last_location_updated_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_responder_availability ON responder_profiles(availability_status);

-- ============================================================================
-- MODULE 2: INCIDENT REPORTING & HAZARD VERIFICATION (MODULE A)
-- ============================================================================

-- 2.1 Incident Categories Lookup Table
CREATE TABLE incident_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) DEFAULT NULL,
  default_severity VARCHAR(20) NOT NULL DEFAULT 'Medium' CHECK (default_severity IN ('Low', 'Medium', 'High', 'Critical')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2.2 Canonical Incident Reports Table (reports)
CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  reference_number VARCHAR(30) DEFAULT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id INTEGER DEFAULT NULL REFERENCES incident_categories(id) ON DELETE RESTRICT,
  incident_type VARCHAR(100) NOT NULL,
  title VARCHAR(180) DEFAULT NULL,
  description TEXT NOT NULL,
  latitude NUMERIC(10, 8) NOT NULL,
  longitude NUMERIC(11, 8) NOT NULL,
  address VARCHAR(255) DEFAULT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'dispatched', 'responding', 'on_site', 'in_progress', 'resolved', 'false_alarm')),
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_to INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verified_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ DEFAULT NULL,
  resolved_at TIMESTAMPTZ DEFAULT NULL,
  closed_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  closure_reason TEXT DEFAULT NULL,
  confirmed_resolved_at TIMESTAMPTZ DEFAULT NULL,
  resident_confirmed_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reports_user ON reports(user_id);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_severity ON reports(severity);
CREATE INDEX idx_reports_assigned ON reports(assigned_to);
CREATE INDEX idx_reports_created ON reports(created_at);
CREATE INDEX idx_reports_coords ON reports(latitude, longitude);

-- 2.3 Incident Attachments Table
CREATE TABLE incident_attachments (
  id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  file_url VARCHAR(255) NOT NULL,
  file_name VARCHAR(150) NOT NULL,
  file_type VARCHAR(50) DEFAULT NULL,
  file_size INTEGER DEFAULT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_incident_attachments_incident ON incident_attachments(incident_id);

-- 2.4 Incident Status History Table
CREATE TABLE incident_status_history (
  id BIGSERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  old_status VARCHAR(40) DEFAULT NULL,
  new_status VARCHAR(40) NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  remarks TEXT DEFAULT NULL,
  is_internal_note BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_incident_history_incident ON incident_status_history(incident_id);
CREATE INDEX idx_incident_history_created ON incident_status_history(created_at);

-- 2.5 Incident Assignments Table
CREATE TABLE incident_assignments (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  responder_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assignment_status VARCHAR(30) NOT NULL DEFAULT 'Assigned' CHECK (assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene', 'Completed', 'Reassigned')),
  dispatch_instructions TEXT DEFAULT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMPTZ DEFAULT NULL,
  en_route_at TIMESTAMPTZ DEFAULT NULL,
  on_scene_at TIMESTAMPTZ DEFAULT NULL,
  completed_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX idx_incident_assign_report ON incident_assignments(report_id);
CREATE INDEX idx_incident_assign_responder ON incident_assignments(responder_user_id);
CREATE INDEX idx_incident_assign_status ON incident_assignments(assignment_status);
CREATE UNIQUE INDEX uq_incident_assignments_active ON incident_assignments(report_id)
  WHERE assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene');

-- 2.6 Incident Progress Updates & Field Notes Table
CREATE TABLE incident_updates (
  id BIGSERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  responder_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status_update VARCHAR(40) NOT NULL,
  work_notes TEXT NOT NULL,
  photo_url VARCHAR(255) DEFAULT NULL,
  is_internal_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_incident_updates_report ON incident_updates(report_id);
CREATE INDEX idx_incident_updates_responder ON incident_updates(responder_user_id);
CREATE INDEX idx_incident_updates_privacy ON incident_updates(is_internal_only);
CREATE INDEX idx_incident_updates_created ON incident_updates(created_at);

-- ============================================================================
-- MODULE 3: EMERGENCY RESCUE REQUESTS & RESPONDER DISPATCH (MODULE B)
-- ============================================================================

-- 3.1 Emergency Rescue Requests Table
CREATE TABLE rescue_requests (
  id SERIAL PRIMARY KEY,
  reference_number VARCHAR(30) NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  emergency_type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  people_count SMALLINT DEFAULT NULL CHECK (people_count IS NULL OR people_count >= 1),
  people_count_category VARCHAR(20) NOT NULL DEFAULT 'exact' CHECK (people_count_category IN ('exact', 'more_than_10', 'unknown')),
  vulnerable_details VARCHAR(255) DEFAULT NULL,
  latitude NUMERIC(10, 8) NOT NULL,
  longitude NUMERIC(11, 8) NOT NULL,
  address VARCHAR(255) NOT NULL,
  landmark VARCHAR(180) DEFAULT NULL,
  priority VARCHAR(20) NOT NULL CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  status VARCHAR(30) NOT NULL DEFAULT 'Pending Dispatch' CHECK (status IN ('Pending Dispatch', 'Assigned', 'Accepted', 'En Route', 'On Scene', 'Completed', 'Cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_resolved_at TIMESTAMPTZ DEFAULT NULL,
  resident_confirmed_at TIMESTAMPTZ DEFAULT NULL,
  confirmed_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX idx_rescue_user ON rescue_requests(user_id);
CREATE INDEX idx_rescue_status ON rescue_requests(status);
CREATE INDEX idx_rescue_priority ON rescue_requests(priority);
CREATE INDEX idx_rescue_coords ON rescue_requests(latitude, longitude);

-- 3.2 Rescue Assignments Table
CREATE TABLE rescue_assignments (
  id SERIAL PRIMARY KEY,
  rescue_id INTEGER NOT NULL REFERENCES rescue_requests(id) ON DELETE RESTRICT,
  responder_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assignment_status VARCHAR(30) NOT NULL DEFAULT 'Assigned' CHECK (assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene', 'Completed', 'Reassigned')),
  dispatch_instructions TEXT DEFAULT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMPTZ DEFAULT NULL,
  en_route_at TIMESTAMPTZ DEFAULT NULL,
  on_scene_at TIMESTAMPTZ DEFAULT NULL,
  completed_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX idx_rescue_assign_rescue ON rescue_assignments(rescue_id);
CREATE INDEX idx_rescue_assign_responder ON rescue_assignments(responder_user_id);
CREATE INDEX idx_rescue_assign_status ON rescue_assignments(assignment_status);
CREATE UNIQUE INDEX uq_rescue_assignments_active ON rescue_assignments(rescue_id)
  WHERE assignment_status IN ('Assigned', 'Accepted', 'En Route', 'On Scene');

-- 3.3 Rescue Attachments Table
CREATE TABLE rescue_attachments (
  id SERIAL PRIMARY KEY,
  rescue_id INTEGER NOT NULL REFERENCES rescue_requests(id) ON DELETE RESTRICT,
  file_url VARCHAR(255) NOT NULL,
  file_name VARCHAR(150) NOT NULL,
  file_type VARCHAR(50) DEFAULT NULL,
  file_size INTEGER DEFAULT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rescue_attachments_rescue ON rescue_attachments(rescue_id);

-- 3.4 Rescue Progress Updates & Field Notes Table
CREATE TABLE rescue_updates (
  id BIGSERIAL PRIMARY KEY,
  rescue_id INTEGER NOT NULL REFERENCES rescue_requests(id) ON DELETE RESTRICT,
  responder_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status_update VARCHAR(40) NOT NULL,
  work_notes TEXT NOT NULL,
  photo_url VARCHAR(255) DEFAULT NULL,
  is_internal_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rescue_updates_rescue ON rescue_updates(rescue_id);
CREATE INDEX idx_rescue_updates_responder ON rescue_updates(responder_user_id);
CREATE INDEX idx_rescue_updates_privacy ON rescue_updates(is_internal_only);
CREATE INDEX idx_rescue_updates_created ON rescue_updates(created_at);

-- 3.5 Rescue Status History Table
CREATE TABLE rescue_status_history (
  id BIGSERIAL PRIMARY KEY,
  rescue_id INTEGER NOT NULL REFERENCES rescue_requests(id) ON DELETE RESTRICT,
  old_status VARCHAR(40) DEFAULT NULL,
  new_status VARCHAR(40) NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  work_notes TEXT DEFAULT NULL,
  photo_url VARCHAR(255) DEFAULT NULL,
  is_internal_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rescue_history_rescue ON rescue_status_history(rescue_id);

-- 3.6 Responder Assignment History Table
CREATE TABLE responder_assignment_history (
  id BIGSERIAL PRIMARY KEY,
  responder_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assignment_type VARCHAR(20) NOT NULL CHECK (assignment_type IN ('rescue', 'incident')),
  rescue_id INTEGER DEFAULT NULL REFERENCES rescue_requests(id) ON DELETE RESTRICT,
  incident_id INTEGER DEFAULT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  status VARCHAR(40) NOT NULL,
  notes TEXT DEFAULT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_resp_hist_responder ON responder_assignment_history(responder_user_id);
CREATE INDEX idx_resp_hist_type ON responder_assignment_history(assignment_type);

-- 3.7 Rescue Outcomes Table (First Aid & Optional Transport Summary)
CREATE TABLE rescue_outcomes (
  id SERIAL PRIMARY KEY,
  rescue_id INTEGER NOT NULL UNIQUE REFERENCES rescue_requests(id) ON DELETE CASCADE,
  responder_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  primary_outcome VARCHAR(40) NOT NULL CHECK (
    primary_outcome IN ('first_aid', 'hospital', 'medical_facility', 'evacuation_center', 'other')
  ),
  total_rescued SMALLINT NOT NULL DEFAULT 0 CHECK (total_rescued >= 0),
  first_aid_count SMALLINT NOT NULL DEFAULT 0 CHECK (first_aid_count >= 0),
  hospital_transport_count SMALLINT NOT NULL DEFAULT 0 CHECK (hospital_transport_count >= 0),
  medical_facility_count SMALLINT NOT NULL DEFAULT 0 CHECK (medical_facility_count >= 0),
  evacuation_center_count SMALLINT NOT NULL DEFAULT 0 CHECK (evacuation_center_count >= 0),
  still_assisting_count SMALLINT NOT NULL DEFAULT 0 CHECK (still_assisting_count >= 0),
  first_aid_actions TEXT DEFAULT NULL,
  further_medical_recommended BOOLEAN NOT NULL DEFAULT FALSE,
  transport_required BOOLEAN NOT NULL DEFAULT FALSE,
  other_description TEXT DEFAULT NULL,
  admin_coordination_required BOOLEAN NOT NULL DEFAULT FALSE,
  operational_notes TEXT DEFAULT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rescue_outcomes_rescue ON rescue_outcomes(rescue_id);
CREATE INDEX idx_rescue_outcomes_outcome ON rescue_outcomes(primary_outcome);

-- 3.8 Rescue Transports Table (Single or Multi-Destination Patient Transport & Handover)
CREATE TABLE rescue_transports (
  id SERIAL PRIMARY KEY,
  rescue_id INTEGER NOT NULL REFERENCES rescue_requests(id) ON DELETE CASCADE,
  responder_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  destination_category VARCHAR(30) NOT NULL CHECK (
    destination_category IN ('hospital', 'medical_facility', 'evacuation_center')
  ),
  hospital_id INTEGER DEFAULT NULL REFERENCES hospitals(id) ON DELETE RESTRICT,
  evacuation_center_id INTEGER DEFAULT NULL REFERENCES evacuation_centers(id) ON DELETE RESTRICT,
  destination_name VARCHAR(180) NOT NULL,
  destination_facility_type VARCHAR(50) NOT NULL,
  destination_latitude NUMERIC(10, 8) DEFAULT NULL,
  destination_longitude NUMERIC(11, 8) DEFAULT NULL,
  people_count SMALLINT DEFAULT NULL CHECK (people_count IS NULL OR people_count >= 1),
  people_count_category VARCHAR(20) NOT NULL DEFAULT 'exact' CHECK (people_count_category IN ('exact', 'more_than_10', 'unknown')),
  route_distance_meters INTEGER DEFAULT NULL,
  route_duration_seconds INTEGER DEFAULT NULL,
  transport_status VARCHAR(30) NOT NULL DEFAULT 'Pending' CHECK (
    transport_status IN ('Pending', 'In Transit', 'Arrived', 'Handed Over', 'Cancelled')
  ),
  started_at TIMESTAMPTZ DEFAULT NULL,
  arrived_at TIMESTAMPTZ DEFAULT NULL,
  handed_over_at TIMESTAMPTZ DEFAULT NULL,
  handover_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  handover_notes TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rescue_transports_rescue ON rescue_transports(rescue_id);
CREATE INDEX idx_rescue_transports_status ON rescue_transports(transport_status);

-- ============================================================================
-- MODULE 4: EVACUATION CENTERS, ROUTES & MEDICAL FACILITIES (MODULE E)
-- ============================================================================

-- 4.1 Evacuation Centers Table
CREATE TABLE evacuation_centers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  address VARCHAR(255) NOT NULL,
  barangay VARCHAR(100) NOT NULL DEFAULT 'Barangay Bayanan',
  latitude NUMERIC(10, 8) NOT NULL,
  longitude NUMERIC(11, 8) NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity >= 0),
  available_slots INTEGER NOT NULL CHECK (available_slots >= 0),
  total_capacity INTEGER NOT NULL CHECK (total_capacity >= 0),
  current_occupancy INTEGER NOT NULL DEFAULT 0 CHECK (current_occupancy >= 0),
  status VARCHAR(40) NOT NULL DEFAULT 'Standby' CHECK (status IN ('Open - Accommodating', 'Near Capacity', 'Full / Closed', 'Standby')),
  contact_person VARCHAR(120) DEFAULT NULL,
  contact_phone VARCHAR(40) DEFAULT NULL,
  contact_number VARCHAR(40) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_evac_status ON evacuation_centers(status);
CREATE INDEX idx_evac_coords ON evacuation_centers(latitude, longitude);

-- 4.2 Evacuation Center Facilities Table
CREATE TABLE evacuation_center_facilities (
  id SERIAL PRIMARY KEY,
  center_id INTEGER NOT NULL REFERENCES evacuation_centers(id) ON DELETE RESTRICT,
  facility_name VARCHAR(100) NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_evac_facility_center ON evacuation_center_facilities(center_id);

-- 4.3 Emergency Medical Facilities Table (hospitals)
CREATE TABLE hospitals (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  address VARCHAR(255) NOT NULL,
  latitude NUMERIC(10, 8) NOT NULL,
  longitude NUMERIC(11, 8) NOT NULL,
  emergency_contact VARCHAR(60) NOT NULL DEFAULT 'Unverified',
  status VARCHAR(40) NOT NULL DEFAULT 'Under Assessment' CHECK (status IN ('Operational', 'Full Capacity', 'Critical Supplies', 'Closed', 'Under Assessment')),
  capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  available_slots INTEGER NOT NULL DEFAULT 0 CHECK (available_slots >= 0),
  facility_type VARCHAR(40) NOT NULL DEFAULT 'Hospital' CHECK (facility_type IN ('Hospital', 'Health Center', 'Medical Clinic', 'Birthing Home', 'Laboratory')),
  operating_hours VARCHAR(100) NOT NULL DEFAULT 'Unverified',
  verification_status VARCHAR(30) NOT NULL DEFAULT 'Unverified' CHECK (verification_status IN ('Verified', 'Unverified', 'Flagged', 'Pending Verification')),
  coordinate_flag VARCHAR(255) DEFAULT NULL,
  last_verified_at TIMESTAMPTZ DEFAULT NULL,
  verified_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  emergency_capable BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_hospitals_status ON hospitals(status);
CREATE INDEX idx_hospitals_coords ON hospitals(latitude, longitude);
CREATE INDEX idx_hospitals_facility_type ON hospitals(facility_type);
CREATE INDEX idx_hospitals_verification_status ON hospitals(verification_status);

-- 4.4 Evacuation Routes Table
CREATE TABLE evacuation_routes (
  id SERIAL PRIMARY KEY,
  route_name VARCHAR(150) NOT NULL,
  description TEXT DEFAULT NULL,
  route_description TEXT DEFAULT NULL,
  origin_name VARCHAR(150) NOT NULL,
  origin_latitude NUMERIC(10, 8) NOT NULL,
  origin_longitude NUMERIC(11, 8) NOT NULL,
  destination_center_id INTEGER NOT NULL REFERENCES evacuation_centers(id) ON DELETE RESTRICT,
  distance_meters INTEGER DEFAULT NULL,
  estimated_distance_km NUMERIC(6, 2) DEFAULT NULL,
  estimated_duration_seconds INTEGER DEFAULT NULL,
  estimated_walk_minutes INTEGER DEFAULT NULL,
  route_type VARCHAR(20) NOT NULL DEFAULT 'pedestrian' CHECK (route_type IN ('pedestrian', 'vehicular', 'accessible')),
  route_status VARCHAR(20) NOT NULL DEFAULT 'under_review' CHECK (route_status IN ('active', 'congested', 'impassable', 'under_review')),
  is_official_approved BOOLEAN NOT NULL DEFAULT FALSE,
  approval_authority VARCHAR(120) DEFAULT NULL,
  approved_at TIMESTAMPTZ DEFAULT NULL,
  encoded_geometry TEXT DEFAULT NULL,
  path_coordinates JSONB DEFAULT NULL,
  created_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_evac_routes_center ON evacuation_routes(destination_center_id);
CREATE INDEX idx_evac_routes_status ON evacuation_routes(route_status);
CREATE INDEX idx_evac_routes_type ON evacuation_routes(route_type);
CREATE INDEX idx_evac_routes_approved ON evacuation_routes(is_official_approved);

-- 4.5 Evacuation Route Waypoints Table
CREATE TABLE evacuation_route_waypoints (
  id BIGSERIAL PRIMARY KEY,
  route_id INTEGER NOT NULL REFERENCES evacuation_routes(id) ON DELETE RESTRICT,
  sequence_order SMALLINT NOT NULL,
  latitude NUMERIC(10, 8) NOT NULL,
  longitude NUMERIC(11, 8) NOT NULL,
  instruction VARCHAR(255) DEFAULT NULL,
  landmark_name VARCHAR(120) DEFAULT NULL
);

CREATE INDEX idx_route_waypoint ON evacuation_route_waypoints(route_id, sequence_order);

-- ============================================================================
-- MODULE 5: NOTIFICATIONS & EMERGENCY BROADCASTS (MODULES C & D)
-- ============================================================================

-- 5.1 Notifications Master Table
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'info',
  severity VARCHAR(30) NOT NULL DEFAULT 'Medium' CHECK (severity IN ('Low', 'Medium', 'Moderate', 'High', 'Critical', 'Info', 'Advisory', 'Warning')),
  category VARCHAR(30) NOT NULL DEFAULT 'Alert' CHECK (category IN ('Alert', 'Dispatch', 'General', 'Report', 'Rescue', 'Broadcast', 'System', 'Incident')),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  action_url VARCHAR(255) DEFAULT NULL,
  related_entity_type VARCHAR(60) DEFAULT NULL,
  related_entity_id INTEGER DEFAULT NULL,
  created_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_severity ON notifications(severity);
CREATE INDEX idx_notifications_created ON notifications(created_at);

-- 5.2 Notification Recipients Table
CREATE TABLE notification_recipients (
  id BIGSERIAL PRIMARY KEY,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX idx_notif_recip_user ON notification_recipients(user_id, is_read);

-- 5.3 Dedicated Alerts Table
CREATE TABLE alerts (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_alerts_created ON alerts(created_at);
CREATE INDEX idx_alerts_severity ON alerts(severity);

-- 5.4 Emergency Broadcast Audit Logs Table
CREATE TABLE emergency_broadcast_logs (
  id SERIAL PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(40) NOT NULL DEFAULT 'Advisory' CHECK (severity IN ('Advisory', 'Watch', 'Warning', 'Critical Evacuation')),
  target_scope VARCHAR(50) NOT NULL DEFAULT 'All Barangay Bayanan' CHECK (target_scope IN ('All Barangay Bayanan', 'Lakeshore Zone', 'Specific Purok', 'Responders Only')),
  target_zones VARCHAR(255) DEFAULT NULL,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  authorized_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  broadcasted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiration_duration_minutes INTEGER DEFAULT NULL,
  expires_at TIMESTAMPTZ DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expired', 'Cancelled')),
  expired_at TIMESTAMPTZ DEFAULT NULL,
  cancelled_at TIMESTAMPTZ DEFAULT NULL,
  cancelled_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  location_coverage VARCHAR(30) NOT NULL DEFAULT 'Entire Barangay Bayanan' CHECK (location_coverage IN ('Entire Barangay Bayanan', 'Specific Location')),
  latitude DOUBLE PRECISION DEFAULT NULL,
  longitude DOUBLE PRECISION DEFAULT NULL,
  location_address VARCHAR(255) DEFAULT NULL
);

CREATE INDEX idx_broadcast_active ON emergency_broadcast_logs(is_active);
CREATE INDEX idx_broadcast_severity ON emergency_broadcast_logs(severity);
CREATE INDEX idx_broadcast_time ON emergency_broadcast_logs(broadcasted_at);
CREATE INDEX idx_broadcast_expires_at ON emergency_broadcast_logs(expires_at);
CREATE INDEX idx_broadcast_status ON emergency_broadcast_logs(status);

-- 5.5 Rescue Request Messaging & Conversations
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  rescue_id INTEGER NOT NULL UNIQUE REFERENCES rescue_requests(id) ON DELETE CASCADE,
  assignment_id INTEGER DEFAULT NULL REFERENCES rescue_assignments(id) ON DELETE SET NULL,
  resident_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  responder_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'Closed')),
  last_message_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversations_resident ON conversations(resident_user_id);
CREATE INDEX idx_conversations_responder ON conversations(responder_user_id);
CREATE INDEX idx_conversations_last_msg ON conversations(last_message_at DESC);

CREATE TABLE conversation_participants (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('Resident', 'Responder')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ DEFAULT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMPTZ DEFAULT NULL,
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX idx_conv_participants_user ON conversation_participants(user_id, is_active);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_message_id VARCHAR(80) DEFAULT NULL,
  body TEXT NOT NULL CHECK (char_length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (conversation_id, sender_user_id, client_message_id)
);

CREATE INDEX idx_messages_conversation_time ON messages(conversation_id, created_at ASC, id ASC);

CREATE TABLE message_read_status (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (message_id, user_id)
);

CREATE INDEX idx_msg_read_conv_user ON message_read_status(conversation_id, user_id);

-- ============================================================================
-- MODULE 6: SECURITY, AUDIT TRAIL & SYSTEM SETTINGS
-- ============================================================================

-- 6.1 Administrative Audit Logs Table
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(60) DEFAULT NULL,
  old_values JSONB DEFAULT NULL,
  new_values JSONB DEFAULT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- 6.2 Authentication & Security Event Logs Table
CREATE TABLE auth_security_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempted_email VARCHAR(160) DEFAULT NULL,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('login_success', 'login_failed', 'logout', 'token_revoked', 'unauthorized_role_attempt', 'password_changed', 'account_suspended', 'account_reactivated')),
  attempted_role VARCHAR(50) DEFAULT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  details VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auth_sec_user ON auth_security_logs(user_id);
CREATE INDEX idx_auth_sec_email ON auth_security_logs(attempted_email);
CREATE INDEX idx_auth_sec_event ON auth_security_logs(event_type);
CREATE INDEX idx_auth_sec_created ON auth_security_logs(created_at);

-- 6.3 Account Status History Table
CREATE TABLE account_status_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_status VARCHAR(40) DEFAULT NULL,
  new_status VARCHAR(40) NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_account_status_user ON account_status_history(user_id);

-- 6.4 System Settings Table
CREATE TABLE system_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  category VARCHAR(30) NOT NULL DEFAULT 'system' CHECK (category IN ('eoc', 'evacuation', 'dispatch', 'system')),
  setting_value TEXT DEFAULT NULL,
  description VARCHAR(255) DEFAULT NULL,
  is_protected BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_settings_key ON system_settings(setting_key);
CREATE INDEX idx_settings_category ON system_settings(category);

-- ============================================================================
-- PL/pgSQL TRIGGER FUNCTIONS & TRIGGERS
-- ============================================================================

-- 1. Automatic updated_at Timestamp Trigger Function
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_role_sequences_updated_at BEFORE UPDATE ON role_sequences FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_responder_profiles_updated_at BEFORE UPDATE ON responder_profiles FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_reports_updated_at BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_rescue_requests_updated_at BEFORE UPDATE ON rescue_requests FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_evacuation_centers_updated_at BEFORE UPDATE ON evacuation_centers FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_hospitals_updated_at BEFORE UPDATE ON hospitals FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_evacuation_routes_updated_at BEFORE UPDATE ON evacuation_routes FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_system_settings_updated_at BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 2. User Role Synchronization Trigger Function (trg_users_sync_role)
CREATE OR REPLACE FUNCTION fn_users_sync_role()
RETURNS TRIGGER AS $$
DECLARE
  v_role_name VARCHAR(50);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.role_id IS NULL OR NEW.role_id = 3) AND NEW.role IS NOT NULL THEN
      NEW.role_id := CASE NEW.role
        WHEN 'admin' THEN 1
        WHEN 'responder' THEN 2
        WHEN 'resident' THEN 3
        ELSE NULL
      END;
    END IF;
    IF NEW.role_id IS NULL THEN
      NEW.role_id := 3;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role_id IS DISTINCT FROM OLD.role_id AND NEW.role IS DISTINCT FROM OLD.role THEN
      IF (NEW.role_id = 1 AND NEW.role <> 'admin')
         OR (NEW.role_id = 2 AND NEW.role <> 'responder')
         OR (NEW.role_id = 3 AND NEW.role <> 'resident') THEN
        RAISE EXCEPTION 'Conflicting simultaneous update to users.role_id and users.role';
      END IF;
    ELSIF NEW.role IS DISTINCT FROM OLD.role AND NEW.role_id = OLD.role_id THEN
      NEW.role_id := CASE NEW.role
        WHEN 'admin' THEN 1
        WHEN 'responder' THEN 2
        WHEN 'resident' THEN 3
        ELSE NULL
      END;
    END IF;
  END IF;

  SELECT name INTO v_role_name FROM roles WHERE id = NEW.role_id LIMIT 1;
  IF v_role_name IS NULL OR NEW.role_id NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'Unauthorized or non-existent role_id. Only Administrator (1), Responder (2), and Resident (3) are permitted.';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.role IS NOT NULL THEN
    IF (NEW.role_id = 1 AND NEW.role <> 'admin')
       OR (NEW.role_id = 2 AND NEW.role <> 'responder')
       OR (NEW.role_id = 3 AND NEW.role <> 'resident') THEN
      RAISE EXCEPTION 'Role mismatch between users.role_id and users.role on INSERT';
    END IF;
  END IF;

  NEW.role := CASE NEW.role_id
    WHEN 1 THEN 'admin'
    WHEN 2 THEN 'responder'
    ELSE 'resident'
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_sync_role_insert
BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION fn_users_sync_role();

CREATE TRIGGER trg_users_sync_role_update
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION fn_users_sync_role();

-- 3. User Code Immutability Trigger Function (trg_users_user_code_immutable)
CREATE OR REPLACE FUNCTION fn_users_user_code_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.user_code IS NOT NULL AND NEW.user_code IS NOT NULL AND NEW.user_code <> OLD.user_code THEN
    RAISE EXCEPTION 'user_code is permanent and immutable; it cannot be modified once assigned.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_user_code_immutable
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION fn_users_user_code_immutable();

-- 4. Append-Only Audit & History Protection Trigger Function
CREATE OR REPLACE FUNCTION fn_prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Modification or deletion of immutable audit/history records in % is prohibited.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION fn_prevent_audit_modification();
CREATE TRIGGER trg_auth_security_logs_immutable BEFORE UPDATE OR DELETE ON auth_security_logs FOR EACH ROW EXECUTE FUNCTION fn_prevent_audit_modification();
CREATE TRIGGER trg_account_status_history_immutable BEFORE UPDATE OR DELETE ON account_status_history FOR EACH ROW EXECUTE FUNCTION fn_prevent_audit_modification();
CREATE TRIGGER trg_incident_status_history_immutable BEFORE UPDATE OR DELETE ON incident_status_history FOR EACH ROW EXECUTE FUNCTION fn_prevent_audit_modification();
CREATE TRIGGER trg_rescue_status_history_immutable BEFORE UPDATE OR DELETE ON rescue_status_history FOR EACH ROW EXECUTE FUNCTION fn_prevent_audit_modification();
CREATE OR REPLACE FUNCTION fn_emergency_broadcast_logs_protect()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Deletion of immutable records in emergency_broadcast_logs is prohibited.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.message IS DISTINCT FROM OLD.message
    OR NEW.category_id IS DISTINCT FROM OLD.category_id
    OR NEW.advisory_type IS DISTINCT FROM OLD.advisory_type
    OR NEW.target_scope IS DISTINCT FROM OLD.target_scope
    OR NEW.target_zones IS DISTINCT FROM OLD.target_zones
    OR NEW.recipients_count IS DISTINCT FROM OLD.recipients_count
    OR NEW.authorized_by IS DISTINCT FROM OLD.authorized_by
    OR NEW.broadcasted_at IS DISTINCT FROM OLD.broadcasted_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.location_coverage IS DISTINCT FROM OLD.location_coverage
    OR NEW.latitude IS DISTINCT FROM OLD.latitude
    OR NEW.longitude IS DISTINCT FROM OLD.longitude
    OR NEW.location_address IS DISTINCT FROM OLD.location_address THEN
    RAISE EXCEPTION 'Modification of immutable broadcast fields in emergency_broadcast_logs is prohibited.';
  END IF;

  IF OLD.status IN ('Expired', 'Cancelled') AND (NEW.status = 'Active' OR NEW.is_active = TRUE) THEN
    RAISE EXCEPTION 'Expired or cancelled broadcast alerts cannot be reactivated.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_emergency_broadcast_logs_immutable BEFORE UPDATE OR DELETE ON emergency_broadcast_logs FOR EACH ROW EXECUTE FUNCTION fn_emergency_broadcast_logs_protect();

-- ============================================================================
-- CANONICAL SEED DATA (ROLES, SEQUENCES & BARANGAY BAYANAN GEOGRAPHY)
-- ============================================================================

INSERT INTO roles (id, name, description) VALUES
  (1, 'Administrator', 'Full emergency operations command, user governance, and disaster dispatch oversight'),
  (2, 'Responder', 'Field responder unit handling active incident verification and rescue missions'),
  (3, 'Resident', 'Community member reporting incidents, requesting rescue, and monitoring alerts');

SELECT setval(pg_get_serial_sequence('roles', 'id'), 3, true);

INSERT INTO role_sequences (role_id, role_name, prefix, next_val) VALUES
  (1, 'Administrator', 'ADM', 1),
  (2, 'Responder', 'RSPDR', 1),
  (3, 'Resident', 'RSDNT', 1);

INSERT INTO incident_categories (id, name, description, default_severity, is_active) VALUES
  (1, 'Flooding', 'Street, residential, or lakeshore flooding in Barangay Bayanan', 'High', TRUE),
  (2, 'Fire', 'Structural, residential, or electrical fire emergency', 'Critical', TRUE),
  (3, 'Medical Emergency', 'Urgent medical assistance or injury response', 'High', TRUE),
  (4, 'Road Obstruction / Fallen Tree', 'Blocked roads, fallen trees, or debris hazards', 'Medium', TRUE),
  (5, 'Power Line / Utility Hazard', 'Downed power lines, transformer sparks, or utility leaks', 'High', TRUE),
  (6, 'Structural Damage', 'Collapsed walls, damaged roofs, or unsafe structures', 'High', TRUE);

SELECT setval(pg_get_serial_sequence('incident_categories', 'id'), 6, true);

INSERT INTO evacuation_centers
  (id, name, address, barangay, latitude, longitude, capacity, available_slots, total_capacity, current_occupancy, status, contact_person, contact_phone, contact_number)
VALUES
  (1, 'Bayanan Elementary School Main', 'National Road, Barangay Bayanan, Muntinlupa City', 'Barangay Bayanan', 14.40820000, 121.04580000, 500, 420, 500, 80, 'Open - Accommodating', 'Engr. Ramon Bautista (BDRRMC)', '0917-555-0101', '0917-555-0101'),
  (2, 'Barangay Bayanan Multi-Purpose Covered Court', 'Bayanan Road cor. Purok 2, Barangay Bayanan, Muntinlupa City', 'Barangay Bayanan', 14.40710000, 121.04790000, 350, 290, 350, 60, 'Open - Accommodating', 'Kag. Lorna Mendoza', '0917-555-0102', '0917-555-0102'),
  (3, 'Bayanan Elementary School Unit I', 'Purok 4 Interior, Barangay Bayanan, Muntinlupa City', 'Barangay Bayanan', 14.40950000, 121.04920000, 400, 365, 400, 35, 'Open - Accommodating', 'Maria Teresa Villanueva', '0917-555-0103', '0917-555-0103'),
  (4, 'Summitville Community Evacuation Center', 'Summitville Subdivision, Barangay Bayanan, Muntinlupa City', 'Barangay Bayanan', 14.40580000, 121.04350000, 250, 250, 250, 0, 'Standby', 'Capt. Eduardo Santos', '0917-555-0104', '0917-555-0104');

SELECT setval(pg_get_serial_sequence('evacuation_centers', 'id'), 4, true);

INSERT INTO evacuation_center_facilities (center_id, facility_name, is_available) VALUES
  (1, 'First Aid & Triage Station', TRUE),
  (1, 'Potable Water Supply', TRUE),
  (1, 'Emergency Generator', TRUE),
  (1, 'Community Kitchen', TRUE),
  (1, 'Restrooms & Wash Area', TRUE),
  (2, 'First Aid & Triage Station', TRUE),
  (2, 'Potable Water Supply', TRUE),
  (2, 'Emergency Generator', TRUE),
  (2, 'Restrooms & Wash Area', TRUE),
  (3, 'First Aid & Triage Station', TRUE),
  (3, 'Potable Water Supply', TRUE),
  (3, 'Community Kitchen', TRUE),
  (3, 'Breastfeeding & Child-Friendly Space', TRUE),
  (4, 'First Aid & Triage Station', TRUE),
  (4, 'Potable Water Supply', TRUE),
  (4, 'Restrooms & Wash Area', TRUE);

INSERT INTO evacuation_routes
  (id, route_name, description, route_description, origin_name, origin_latitude, origin_longitude,
   destination_center_id, distance_meters, estimated_distance_km, estimated_duration_seconds, estimated_walk_minutes,
   route_type, route_status, is_official_approved, approval_authority, approved_at, encoded_geometry, path_coordinates, created_by)
VALUES
  (1, 'Baywalk Lakeshore to Bayanan Elementary School Main',
   'Primary flood-safe pedestrian corridor from Laguna Lake Baywalk Purok 1 westward along Bayanan Road to National Road.',
   'Primary flood-safe pedestrian corridor from Laguna Lake Baywalk Purok 1 westward along Bayanan Road to National Road.',
   'Bayanan Baywalk Lakeshore (Purok 1)', 14.40650000, 121.05100000,
   1, 650, 0.65, 480, 8, 'pedestrian', 'active', TRUE, 'Barangay Bayanan BDRRMC', CURRENT_TIMESTAMP,
   '[[14.4065,121.051],[14.4071,121.049],[14.4076,121.0472],[14.4082,121.0458]]',
   '[[14.4065,121.051],[14.4071,121.049],[14.4076,121.0472],[14.4082,121.0458]]'::jsonb, NULL),
  (2, 'Purok 3 & 5 Coastal Zone to Bayanan Multi-Purpose Covered Court',
   'Direct elevated access route from coastal Purok 3 and Purok 5 to the Barangay Bayanan Multi-Purpose Covered Court.',
   'Direct elevated access route from coastal Purok 3 and Purok 5 to the Barangay Bayanan Multi-Purpose Covered Court.',
   'Bayanan Coastal Purok 3 Junction', 14.40880000, 121.05150000,
   2, 480, 0.48, 360, 6, 'pedestrian', 'active', TRUE, 'Barangay Bayanan BDRRMC', CURRENT_TIMESTAMP,
   '[[14.4088,121.0515],[14.408,121.0498],[14.4071,121.0479]]',
   '[[14.4088,121.0515],[14.408,121.0498],[14.4071,121.0479]]'::jsonb, NULL),
  (3, 'North Bayanan Purok 6 to Bayanan Elementary School Unit I',
   'Secondary northern evacuation path serving Purok 6 and interior compounds to Bayanan Elementary School Unit I.',
   'Secondary northern evacuation path serving Purok 6 and interior compounds to Bayanan Elementary School Unit I.',
   'Purok 6 North Compound', 14.41050000, 121.05180000,
   3, 350, 0.35, 240, 4, 'accessible', 'active', TRUE, 'Barangay Bayanan BDRRMC', CURRENT_TIMESTAMP,
   '[[14.4105,121.0518],[14.41,121.0505],[14.4095,121.0492]]',
   '[[14.4105,121.0518],[14.41,121.0505],[14.4095,121.0492]]'::jsonb, NULL);

SELECT setval(pg_get_serial_sequence('evacuation_routes', 'id'), 3, true);

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

SELECT setval(pg_get_serial_sequence('hospitals', 'id'), 4, true);

COMMIT;
