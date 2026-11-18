-- ============================================================================
-- Migration 012: Explicit Rescue People Count Category
--                (exact count, more_than_10, or unknown)
-- ============================================================================

ALTER TABLE rescue_requests
  ALTER COLUMN people_count DROP NOT NULL,
  ALTER COLUMN people_count DROP DEFAULT;

ALTER TABLE rescue_requests
  ADD COLUMN IF NOT EXISTS people_count_category VARCHAR(20) NOT NULL DEFAULT 'exact';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_rescue_people_count_category'
  ) THEN
    ALTER TABLE rescue_requests
      ADD CONSTRAINT chk_rescue_people_count_category
      CHECK (people_count_category IN ('exact', 'more_than_10', 'unknown'));
  END IF;
END $$;
