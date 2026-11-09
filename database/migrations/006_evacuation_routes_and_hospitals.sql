-- ============================================================================
-- GeoSafe Migration 006: Evacuation Centers, Routes & Hospitals
-- Target Database: geosafe_db (Fresh Database)
-- ============================================================================

USE geosafe_db;

-- 1. Emergency Medical Facilities Table (`hospitals`)
CREATE TABLE IF NOT EXISTS hospitals (
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

-- 2. Evacuation Routes Table
CREATE TABLE IF NOT EXISTS evacuation_routes (
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

-- 3. Evacuation Route Waypoints Table
CREATE TABLE IF NOT EXISTS evacuation_route_waypoints (
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
