-- ============================================================================
-- GeoSafe Migration 002: Family QR Membership, Address & Privacy Consent
-- Target Database: geosafe_db (Fresh Database)
-- ============================================================================

USE geosafe_db;

-- 1. Family Groups (Fixed Barangay Bayanan, Muntinlupa City; Required house_number & street)
CREATE TABLE IF NOT EXISTS family_groups (
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

-- 2. Family Members (Authoritative Family Membership: One Active Family per User)
CREATE TABLE IF NOT EXISTS family_members (
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

-- 3. Family QR Invitations (SHA-256 Hashed Tokens)
CREATE TABLE IF NOT EXISTS family_invitations (
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

-- 4. Family Join Requests
CREATE TABLE IF NOT EXISTS family_join_requests (
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

-- 5. Family Location Sharing Consents
CREATE TABLE IF NOT EXISTS family_location_sharing_consents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  family_member_id INT NOT NULL UNIQUE,
  sharing_enabled TINYINT(1) NOT NULL DEFAULT 0,
  consented_at TIMESTAMP NULL DEFAULT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_loc_consent_member FOREIGN KEY (family_member_id) REFERENCES family_members(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Family Location Updates
CREATE TABLE IF NOT EXISTS family_location_updates (
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

-- 7. Family Address, QR & Consent Triggers
DROP TRIGGER IF EXISTS trg_family_groups_fixed_location_insert;
DROP TRIGGER IF EXISTS trg_family_groups_fixed_location_update;
DROP TRIGGER IF EXISTS trg_family_invitations_validate_insert;
DROP TRIGGER IF EXISTS trg_family_consent_validate_insert;
DROP TRIGGER IF EXISTS trg_family_consent_validate_update;
DROP TRIGGER IF EXISTS trg_family_location_updates_require_consent;

DELIMITER $$

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

DELIMITER ;
