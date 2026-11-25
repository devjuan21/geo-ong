-- Safe, idempotent migration for Centralized System Settings & Maintenance
-- 1. Extend incident_categories with sort_order and updated_at
ALTER TABLE incident_categories
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE incident_categories SET sort_order = id * 10 WHERE sort_order = 0;

INSERT INTO incident_categories (name, description, default_severity, is_active, sort_order)
SELECT 'Other Disaster Hazard', 'Other hazard or emergency condition', 'Medium', TRUE, 70
WHERE NOT EXISTS (
  SELECT 1 FROM incident_categories WHERE LOWER(name) = LOWER('Other Disaster Hazard')
);

-- 2. Create rescue_categories table for database-managed Resident Rescue Request types
CREATE TABLE IF NOT EXISTS rescue_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  display_label VARCHAR(160),
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO rescue_categories (name, display_label, description, sort_order, is_active)
VALUES
  ('Trapped by Rising Floodwater', 'Trapped by Rising Floodwater (Roof / 2nd Floor)', 'Resident trapped by rising floodwater requiring immediate extraction', 10, TRUE),
  ('Critical Medical Evacuation', 'Critical Medical Evacuation Needed', 'Urgent medical evacuation or ambulance assistance', 20, TRUE),
  ('Collapsed / Compromised Structure', 'Collapsed House Structure', 'Resident trapped or endangered by structural collapse', 30, TRUE),
  ('Trapped by Fire / Dense Smoke', 'Trapped by Fire / Dense Smoke', 'Resident trapped by fire or heavy smoke', 40, TRUE),
  ('Special Vulnerability Emergency', 'Bedridden / Senior / Infant Assistance', 'Emergency rescue assistance for bedridden, senior, or infant residents', 50, TRUE)
ON CONFLICT (name) DO NOTHING;
