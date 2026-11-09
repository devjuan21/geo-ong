-- ============================================================================
-- GeoSafe Migration 003: Role Synchronization & Family Membership Sync Triggers
-- Target Database: geosafe_db (Fresh Database)
-- ============================================================================

USE geosafe_db;

-- 1. Ensure Canonical Roles Exist
INSERT INTO roles (id, name, description) VALUES
  (1, 'Administrator', 'Full emergency operations command, user governance, and disaster dispatch oversight'),
  (2, 'Responder', 'Field responder unit handling active incident verification and rescue missions'),
  (3, 'Resident', 'Community member reporting incidents, requesting rescue, and monitoring alerts')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- 2. Ensure `fk_users_family_group` Foreign Key Exists on `users.family_group_id`
SET @fk_exists := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = 'geosafe_db' AND TABLE_NAME = 'users'
    AND CONSTRAINT_NAME = 'fk_users_family_group');
SET @stmt := IF(@fk_exists = 0,
  'ALTER TABLE users ADD CONSTRAINT fk_users_family_group FOREIGN KEY (family_group_id) REFERENCES family_groups(id) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT "Foreign key fk_users_family_group already exists" AS status');
PREPARE stmt FROM @stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Role & Family Membership Synchronization Triggers
DROP TRIGGER IF EXISTS trg_users_sync_role_insert;
DROP TRIGGER IF EXISTS trg_users_sync_role_update;
DROP TRIGGER IF EXISTS trg_family_members_sync_user_insert;
DROP TRIGGER IF EXISTS trg_family_members_sync_user_update;
DROP TRIGGER IF EXISTS trg_family_members_sync_user_delete;
DROP TRIGGER IF EXISTS trg_family_groups_sync_status_update;

DELIMITER $$

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

DELIMITER ;
