-- ============================================================================
-- GeoSafe Migration 003: Role Synchronization Triggers
-- Target Database: geosafe_db
-- ============================================================================

USE geosafe_db;

-- 1. Ensure Canonical Roles Exist
INSERT INTO roles (id, name, description) VALUES
  (1, 'Administrator', 'Full emergency operations command, user governance, and disaster dispatch oversight'),
  (2, 'Responder', 'Field responder unit handling active incident verification and rescue missions'),
  (3, 'Resident', 'Community member reporting incidents, requesting rescue, and monitoring alerts')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- 2. Role Synchronization Triggers
DROP TRIGGER IF EXISTS trg_users_sync_role_insert;
DROP TRIGGER IF EXISTS trg_users_sync_role_update;

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
END$$

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
END$$

DELIMITER ;
