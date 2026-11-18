-- ============================================================================
-- Migration 011: Responder First Aid, Optional Patient Transportation,
--                Handover Tracking, and Healthcare Facility Directory
-- ============================================================================

-- 1. Extend hospitals table into a verified Healthcare Facility Directory
ALTER TABLE hospitals
  ADD COLUMN IF NOT EXISTS facility_type VARCHAR(40) NOT NULL DEFAULT 'Hospital',
  ADD COLUMN IF NOT EXISTS operating_hours VARCHAR(100) NOT NULL DEFAULT 'Unverified',
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(30) NOT NULL DEFAULT 'Unverified',
  ADD COLUMN IF NOT EXISTS coordinate_flag VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS verified_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS emergency_capable BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_hospitals_facility_type'
  ) THEN
    ALTER TABLE hospitals
      ADD CONSTRAINT chk_hospitals_facility_type
      CHECK (facility_type IN ('Hospital', 'Health Center', 'Medical Clinic', 'Birthing Home', 'Laboratory'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_hospitals_verification_status'
  ) THEN
    ALTER TABLE hospitals
      ADD CONSTRAINT chk_hospitals_verification_status
      CHECK (verification_status IN ('Verified', 'Unverified', 'Flagged'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hospitals_facility_type ON hospitals(facility_type);
CREATE INDEX IF NOT EXISTS idx_hospitals_verification_status ON hospitals(verification_status);

-- Classify existing pre-seeded directory records accurately
UPDATE hospitals
SET facility_type = 'Hospital',
    operating_hours = CASE WHEN operating_hours = 'Unverified' THEN '24 Hours' ELSE operating_hours END,
    verification_status = 'Verified',
    emergency_capable = TRUE,
    last_verified_at = COALESCE(last_verified_at, CURRENT_TIMESTAMP)
WHERE name IN (
  'Ospital ng Muntinlupa (OsMun)',
  'Medical Center Muntinlupa (MCM)',
  'Asian Hospital and Medical Center'
);

UPDATE hospitals
SET facility_type = 'Health Center',
    verification_status = 'Verified',
    emergency_capable = FALSE,
    last_verified_at = COALESCE(last_verified_at, CURRENT_TIMESTAMP)
WHERE name = 'Barangay Bayanan Health Center & Emergency Clinic';

-- 2. Import supplied healthcare facilities (without fabricating capacity/beds or auto-fixing flagged coordinates)
INSERT INTO hospitals (
  name, address, latitude, longitude, emergency_contact, status,
  capacity, available_slots, facility_type, operating_hours,
  verification_status, coordinate_flag, emergency_capable
)
VALUES
  (
    'Bayanan Health Center',
    '16 Ilaya, Alabang, Muntinlupa, 1770 Metro Manila',
    14.41014900,
    21.05252000,
    'Unverified',
    'Under Assessment',
    0,
    0,
    'Health Center',
    '8:00 AM–5:00 PM',
    'Flagged',
    'Suspicious longitude (21.052520 is outside Metro Manila ~121E range); manual verification required.',
    FALSE
  ),
  (
    'Bayanan Health Center (Annex)',
    'Block 2, Purok 1, 292 M Dolleton St, Muntinlupa, Metro Manila',
    14.40837200,
    121.04444400,
    'Unverified',
    'Under Assessment',
    0,
    0,
    'Health Center',
    'Unverified',
    'Unverified',
    NULL,
    FALSE
  ),
  (
    'Bayanan Medical Clinic – X-Ray and Laboratory Services',
    '231 National Road, Bayanan, Muntinlupa, 1770 Metro Manila',
    14.40989200,
    121.04619000,
    'Unverified',
    'Under Assessment',
    0,
    0,
    'Medical Clinic',
    '8:00 AM–5:30 PM',
    'Unverified',
    NULL,
    FALSE
  ),
  (
    'Elysian Birthing Home',
    'C25X+JXX, San Guillermo St, Muntinlupa, Metro Manila',
    14.40929300,
    121.05034300,
    'Unverified',
    'Under Assessment',
    0,
    0,
    'Birthing Home',
    '24 Hours',
    'Unverified',
    NULL,
    FALSE
  ),
  (
    'Arciaga Medical Clinic',
    'C25W+3HM, National Road, Muntinlupa, 1772 Metro Manila',
    14.40791600,
    121.04670600,
    'Unverified',
    'Under Assessment',
    0,
    0,
    'Medical Clinic',
    '8:00 AM–3:30 PM',
    'Unverified',
    NULL,
    FALSE
  ),
  (
    'Silverio Medical Clinic',
    'C25W+2M8, 233g National Road, Bayanan, Muntinlupa, 1772 Metro Manila',
    14.40755000,
    121.04711600,
    'Unverified',
    'Under Assessment',
    0,
    0,
    'Medical Clinic',
    'Unverified',
    'Unverified',
    NULL,
    FALSE
  ),
  (
    'South Medhub Multispecialty Clinic',
    '242 National Road, Bayanan, Muntinlupa, 1772 Metro Manila',
    14.40895000,
    121.04637900,
    'Unverified',
    'Under Assessment',
    0,
    0,
    'Medical Clinic',
    '8:00 AM–8:00 PM',
    'Unverified',
    NULL,
    FALSE
  ),
  (
    'Global Health Industrial Clinic & Laboratory',
    '235 National Road, Muntinlupa, 1772 Metro Manila',
    14.40792800,
    121.04726500,
    'Unverified',
    'Under Assessment',
    0,
    0,
    'Laboratory',
    '8:30 AM–4:00 PM',
    'Unverified',
    NULL,
    FALSE
  ),
  (
    'Martinez Medical Center',
    '226 National Road, Purok 1, Bayanan, Muntinlupa, 1772 Metro Manila',
    14.40958300,
    121.04720200,
    'Unverified',
    'Under Assessment',
    0,
    0,
    'Medical Clinic',
    'Unverified',
    'Unverified',
    NULL,
    FALSE
  )
ON CONFLICT (name) DO NOTHING;

-- 3. Rescue Outcomes Table (First Aid & Optional Transport Summary)
CREATE TABLE IF NOT EXISTS rescue_outcomes (
  id SERIAL PRIMARY KEY,
  rescue_id INTEGER NOT NULL UNIQUE REFERENCES rescue_requests(id) ON DELETE CASCADE,
  responder_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  primary_outcome VARCHAR(40) NOT NULL CHECK (
    primary_outcome IN ('first_aid', 'hospital', 'medical_facility', 'evacuation_center', 'other')
  ),
  total_rescued SMALLINT NOT NULL DEFAULT 0 CHECK (total_rescued >= 0),
  first_aid_count SMALLINT NOT NULL DEFAULT 0 CHECK (first_aid_count >= 0),
  hospital_transport_count SMALLINT NOT NULL DEFAULT 0 CHECK (hospital_transport_count >= 0),
  medical_facility_count SMALLINT NOT NULL DEFAULT 0 CHECK (medical_facility_count >= 0),
  evacuation_center_count SMALLINT NOT NULL DEFAULT 0 CHECK (evacuation_center_count >= 0),
  still_assisting_count SMALLINT NOT NULL DEFAULT 0 CHECK (still_assisting_count >= 0),
  first_aid_actions TEXT DEFAULT NULL,
  further_medical_recommended BOOLEAN NOT NULL DEFAULT FALSE,
  transport_required BOOLEAN NOT NULL DEFAULT FALSE,
  other_description TEXT DEFAULT NULL,
  admin_coordination_required BOOLEAN NOT NULL DEFAULT FALSE,
  operational_notes TEXT DEFAULT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rescue_outcomes_rescue ON rescue_outcomes(rescue_id);
CREATE INDEX IF NOT EXISTS idx_rescue_outcomes_outcome ON rescue_outcomes(primary_outcome);

-- 4. Rescue Transports Table (Supports single or multi-destination patient transport & handover)
CREATE TABLE IF NOT EXISTS rescue_transports (
  id SERIAL PRIMARY KEY,
  rescue_id INTEGER NOT NULL REFERENCES rescue_requests(id) ON DELETE CASCADE,
  responder_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  destination_category VARCHAR(30) NOT NULL CHECK (
    destination_category IN ('hospital', 'medical_facility', 'evacuation_center')
  ),
  hospital_id INTEGER DEFAULT NULL REFERENCES hospitals(id) ON DELETE RESTRICT,
  evacuation_center_id INTEGER DEFAULT NULL REFERENCES evacuation_centers(id) ON DELETE RESTRICT,
  destination_name VARCHAR(180) NOT NULL,
  destination_facility_type VARCHAR(50) NOT NULL,
  destination_latitude NUMERIC(10, 8) DEFAULT NULL,
  destination_longitude NUMERIC(11, 8) DEFAULT NULL,
  people_count SMALLINT NOT NULL DEFAULT 1 CHECK (people_count >= 1),
  route_distance_meters INTEGER DEFAULT NULL,
  route_duration_seconds INTEGER DEFAULT NULL,
  transport_status VARCHAR(30) NOT NULL DEFAULT 'Pending' CHECK (
    transport_status IN ('Pending', 'In Transit', 'Arrived', 'Handed Over', 'Cancelled')
  ),
  started_at TIMESTAMPTZ DEFAULT NULL,
  arrived_at TIMESTAMPTZ DEFAULT NULL,
  handed_over_at TIMESTAMPTZ DEFAULT NULL,
  handover_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  handover_notes TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rescue_transports_rescue ON rescue_transports(rescue_id);
CREATE INDEX IF NOT EXISTS idx_rescue_transports_status ON rescue_transports(transport_status);
