-- ============================================================================
-- GeoSafe Supabase Storage Buckets (Private Evidence Storage)
-- Execute in Supabase SQL Editor after running migrations/001 & 002.
-- ============================================================================
-- Maps to existing GeoSafe attachment workflows:
--   1. incident-evidence          -> incident_attachments (resident & responder incident photos)
--   2. rescue-evidence            -> rescue_attachments (evidence_type = 'resident_submission')
--   3. rescue-completion-evidence -> rescue_attachments (evidence_type = 'responder_completion')
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'incident-evidence',
    'incident-evidence',
    FALSE,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'rescue-evidence',
    'rescue-evidence',
    FALSE,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'rescue-completion-evidence',
    'rescue-completion-evidence',
    FALSE,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  )
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
