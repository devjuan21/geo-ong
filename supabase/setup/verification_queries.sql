-- ============================================================================
-- GeoSafe Supabase Verification Queries (Read-Only)
-- Run in Supabase SQL Editor after executing migrations and storage scripts.
-- Does NOT insert any operational or test data.
-- ============================================================================

-- 1. Verify expected public tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 2. Verify the 3 canonical GeoSafe roles exist
SELECT id, name, description
FROM roles
ORDER BY id;

-- 3. Verify canonical incident categories (1..6)
SELECT id, name, is_active
FROM incident_categories
ORDER BY id;

-- 4. Verify incremental columns from 002_incremental_migrations.sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'user_profiles' AND column_name LIKE 'location_verification%')
    OR (table_name = 'reports' AND column_name = 'source_rescue_id')
  )
ORDER BY table_name, column_name;

-- 5. Verify foreign keys in public schema
SELECT
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_name;

-- 6. Verify indexes in public schema
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 7. Verify triggers and functions in public schema
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

SELECT routine_name, routine_type
FROM information_schema.routines
WHERE specific_schema = 'public'
ORDER BY routine_name;

-- 8. Verify CHECK constraints
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'c'
  AND connamespace = 'public'::regnamespace
ORDER BY table_name, conname;

-- 9. Verify private Supabase Storage buckets and RLS policies
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('incident-evidence', 'rescue-evidence', 'rescue-completion-evidence')
ORDER BY id;

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE 'geosafe_%'
ORDER BY policyname;
