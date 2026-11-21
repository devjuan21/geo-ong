-- ============================================================================
-- GeoSafe Supabase Storage Row Level Security (RLS) Policies
-- Execute in Supabase SQL Editor after storage/001_storage_buckets.sql.
-- ============================================================================
-- Security Model:
-- - All GeoSafe evidence buckets are PRIVATE (public = false).
-- - Anonymous (anon) access is completely denied.
-- - GeoSafe's Express backend authenticates users via JWT/RBAC and mediates
--   evidence uploads and signed/proxied retrieval using SUPABASE_SERVICE_ROLE_KEY
--   on the server only (service_role bypasses RLS; never expose it in frontend JS).
-- - If Supabase Auth JWTs are ever used directly, authenticated users are
--   restricted strictly to their own auth.uid() folder prefix.
-- ============================================================================

-- Note: Supabase enables RLS on storage.objects by default (owned by supabase_storage_admin).
-- Do NOT run ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY as postgres.

-- Remove previous GeoSafe storage policies if re-running
DROP POLICY IF EXISTS "geosafe_incident_evidence_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "geosafe_incident_evidence_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "geosafe_rescue_evidence_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "geosafe_rescue_evidence_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "geosafe_rescue_completion_deny_direct" ON storage.objects;

-- Incident evidence: deny anonymous & cross-user access; allow only owner folder if using Supabase Auth
CREATE POLICY "geosafe_incident_evidence_owner_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'incident-evidence'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "geosafe_incident_evidence_owner_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'incident-evidence'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Rescue request evidence: deny anonymous & cross-user access; allow only owner folder if using Supabase Auth
CREATE POLICY "geosafe_rescue_evidence_owner_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'rescue-evidence'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "geosafe_rescue_evidence_owner_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'rescue-evidence'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Rescue completion evidence: backend service_role only (no direct client reads/writes)
CREATE POLICY "geosafe_rescue_completion_deny_direct"
ON storage.objects FOR ALL
TO authenticated, anon
USING (bucket_id = 'rescue-completion-evidence' AND FALSE)
WITH CHECK (bucket_id = 'rescue-completion-evidence' AND FALSE);
