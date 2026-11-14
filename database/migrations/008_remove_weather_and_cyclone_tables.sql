-- GeoSafe Migration 008: Remove all weather & tropical cyclone database objects
-- Safe forward migration (does not reset or recreate the database)

BEGIN;

DROP TRIGGER IF EXISTS trg_tropical_cyclone_bulletins_updated_at ON tropical_cyclone_bulletins;
DROP TABLE IF EXISTS weather_cache CASCADE;
DROP TABLE IF EXISTS tropical_cyclone_bulletins CASCADE;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('Alert', 'Dispatch', 'General', 'Report', 'Rescue', 'Broadcast', 'System', 'Incident'));

ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_category_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_category_check
  CHECK (category IN ('eoc', 'evacuation', 'dispatch', 'system'));

COMMIT;
