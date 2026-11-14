-- ============================================================================
-- PROPOSED DATABASE CORRECTION SCRIPT (REVIEW & CONFIRM BEFORE EXECUTING)
-- GeoSafe - Barangay Bayanan Evacuation Centers Audit & Alignment
-- Target Database: geosafe_db (PostgreSQL)
-- ============================================================================
-- IMPORTANT:
-- 1. Do NOT execute blindly. Existing IDs (1..4) are referenced by
--    evacuation_center_facilities and evacuation_routes.
-- 2. Coordinates for the 3 official Muntinlupa City CDRRMO Bayanan sites
--    MUST be verified via on-site GPS survey or official CDRRMO/CGIS GIS
--    before inserting or marking any record 'Open - Accommodating'.
-- 3. Historical references (IDs 1 & 3) and unconfirmed records (IDs 2 & 4)
--    are placed in 'Standby' to preserve foreign-key integrity until
--    Barangay Bayanan BDRRMO / Muntinlupa CDRRMO confirms current status.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- STEP 1: Deactivate unconfirmed / historical existing records (preserve IDs)
-- ----------------------------------------------------------------------------
-- ID 1: Bayanan Elementary School Main (Historical reference; verify parcel coords)
-- ID 2: Barangay Bayanan Multi-Purpose Covered Court (Not in official 3-site CDRRMO list)
-- ID 3: Bayanan Elementary School Unit I (Historical reference; verify parcel coords)
-- ID 4: Summitville Community Evacuation Center (Unconfirmed; Summitville is near Putatan border)
UPDATE evacuation_centers
SET status = 'Standby',
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (1, 2, 3, 4)
  AND status <> 'Standby';

-- ----------------------------------------------------------------------------
-- STEP 2: Insert Official Muntinlupa City CDRRMO Bayanan Evacuation Centers
--         ONLY AFTER actual WGS84 coordinates (inside Barangay Bayanan) and
--         capacities are confirmed by BDRRMC / CDRRMO.
-- ----------------------------------------------------------------------------
/*
INSERT INTO evacuation_centers (
  name,
  address,
  barangay,
  latitude,
  longitude,
  status,
  capacity,
  total_capacity,
  available_slots,
  current_occupancy
) VALUES
  (
    'Bayanan Baywalk Covered Court & Open Field',
    'Block 1-2, Purok 6, Baywalk, Bayanan, Muntinlupa City',
    'Barangay Bayanan',
    <VERIFIED_LATITUDE>,   -- Required: field GPS / official GIS inside Bayanan
    <VERIFIED_LONGITUDE>,  -- Required: field GPS / official GIS inside Bayanan
    'Standby',             -- Change to 'Open - Accommodating' only when activated
    <CONFIRMED_CAPACITY>,
    <CONFIRMED_CAPACITY>,
    <CONFIRMED_CAPACITY>,
    0
  ),
  (
    'Pleasant Village Open Lot/Area',
    'Upper Bayanan, Purok 1, Block 9, Pleasant Village, Barangay Bayanan, Muntinlupa City',
    'Barangay Bayanan',
    <VERIFIED_LATITUDE>,
    <VERIFIED_LONGITUDE>,
    'Standby',
    <CONFIRMED_CAPACITY>,
    <CONFIRMED_CAPACITY>,
    <CONFIRMED_CAPACITY>,
    0
  ),
  (
    'Block 10 A-B Open Area',
    'Upper Bayanan, Purok 1, Barangay Bayanan, Muntinlupa City',
    'Barangay Bayanan',
    <VERIFIED_LATITUDE>,
    <VERIFIED_LONGITUDE>,
    'Standby',
    <CONFIRMED_CAPACITY>,
    <CONFIRMED_CAPACITY>,
    <CONFIRMED_CAPACITY>,
    0
  );
*/

COMMIT;
