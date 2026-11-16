-- ============================================================================
-- PROPOSED SCHEMA MIGRATION: COMPLETE REMOVAL OF SEVERITY & PRIORITY FEATURE
-- Target Database: PostgreSQL 14+ / GeoSafe Production Database
-- Execution Status: PROPOSED ONLY (AWAITING USER APPROVAL)
-- Purpose: Safely drop severity and priority columns, constraints, and indexes
--          while preserving all incident, rescue, alert, and user records.
-- ============================================================================

BEGIN;

-- 1. Drop severity/priority-specific indexes
DROP INDEX IF EXISTS idx_reports_severity;
DROP INDEX IF EXISTS idx_rescue_priority;
DROP INDEX IF EXISTS idx_alerts_severity;
DROP INDEX IF EXISTS idx_notifications_severity;
DROP INDEX IF EXISTS idx_broadcast_severity;

-- 2. Drop table constraints related to priority/severity
ALTER TABLE rescue_requests DROP CONSTRAINT IF EXISTS rescue_requests_priority_check;

-- 3. Drop severity and priority columns from application tables
-- Note: All existing rows and foreign key relationships remain intact.
ALTER TABLE reports DROP COLUMN IF EXISTS severity;
ALTER TABLE rescue_requests DROP COLUMN IF EXISTS priority;
ALTER TABLE alerts DROP COLUMN IF EXISTS severity;
ALTER TABLE notifications DROP COLUMN IF EXISTS severity;
ALTER TABLE emergency_broadcast_logs DROP COLUMN IF EXISTS severity;
ALTER TABLE incident_categories DROP COLUMN IF EXISTS default_severity;

COMMIT;

-- ============================================================================
-- ROLLBACK SCRIPT (IF RESTORATION REQUIRED)
-- ============================================================================
-- BEGIN;
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS severity VARCHAR(50) DEFAULT 'medium';
-- ALTER TABLE rescue_requests ADD COLUMN IF NOT EXISTS priority VARCHAR(50) NOT NULL DEFAULT 'Medium';
-- ALTER TABLE rescue_requests ADD CONSTRAINT rescue_requests_priority_check CHECK (priority IN ('Critical', 'High', 'Medium', 'Low'));
-- ALTER TABLE alerts ADD COLUMN IF NOT EXISTS severity VARCHAR(50) DEFAULT 'medium';
-- ALTER TABLE notifications ADD COLUMN IF NOT EXISTS severity VARCHAR(50) DEFAULT 'Medium';
-- ALTER TABLE emergency_broadcast_logs ADD COLUMN IF NOT EXISTS severity VARCHAR(50) DEFAULT 'Advisory';
-- ALTER TABLE incident_categories ADD COLUMN IF NOT EXISTS default_severity VARCHAR(50) DEFAULT 'Medium';
-- CREATE INDEX IF NOT EXISTS idx_reports_severity ON reports(severity);
-- CREATE INDEX IF NOT EXISTS idx_rescue_priority ON rescue_requests(priority);
-- CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
-- CREATE INDEX IF NOT EXISTS idx_notifications_severity ON notifications(severity);
-- CREATE INDEX IF NOT EXISTS idx_broadcast_severity ON emergency_broadcast_logs(severity);
-- COMMIT;
