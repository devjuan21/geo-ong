-- Migration 017: Align incident_categories with the 6 canonical GeoSafe Resident incident categories
-- Preserves existing category IDs (1..6) for FK compatibility.

BEGIN;

UPDATE incident_categories SET name = 'Flooding / Rising Water', is_active = TRUE WHERE id = 1;
UPDATE incident_categories SET name = 'Fallen Tree / Road Obstruction', is_active = TRUE WHERE id = 4;
UPDATE incident_categories SET name = 'Downed Electrical Power Cable', is_active = TRUE WHERE id = 5;
UPDATE incident_categories SET name = 'Structural / Wall Collapse', is_active = TRUE WHERE id = 6;
UPDATE incident_categories SET name = 'Fire Outbreak', is_active = TRUE WHERE id = 2;
UPDATE incident_categories SET name = 'Severe Drainage Overflow', is_active = TRUE WHERE id = 3;

COMMIT;
