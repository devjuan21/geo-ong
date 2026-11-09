-- ============================================================================
-- GeoSafe Migration 007: Weather Data Cache, Cyclone Bulletins & Alerts
-- Target Database: geosafe_db (Fresh Database)
-- ============================================================================

USE geosafe_db;

-- 1. Weather Data Cache Table
CREATE TABLE IF NOT EXISTS weather_cache (
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

-- 2. Official Tropical Cyclone Bulletins Table
CREATE TABLE IF NOT EXISTS tropical_cyclone_bulletins (
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

-- 3. Dedicated `alerts` Table
CREATE TABLE IF NOT EXISTS alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message TEXT NOT NULL,
  severity ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_alerts_created (created_at),
  INDEX idx_alerts_severity (severity),
  CONSTRAINT fk_alerts_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
