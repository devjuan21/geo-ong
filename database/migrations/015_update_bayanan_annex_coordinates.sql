-- Migration 015: Correct Bayanan Annex Health Center GPS Coordinates
-- Google Maps reference: https://www.google.com/maps/place/Bayanan+Health+Center+(Annex)/@14.407384,121.0427887
-- Preserves existing facility id (6), name, classification ('Health Center'), address, and operational status.

BEGIN;

UPDATE hospitals
SET
  latitude = 14.40738400,
  longitude = 121.04278870,
  last_verified_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 6;

COMMIT;
