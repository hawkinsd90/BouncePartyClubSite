-- Add physical waiver fields to order_signatures
ALTER TABLE order_signatures
  ADD COLUMN IF NOT EXISTS physical_waiver_storage_path text,
  ADD COLUMN IF NOT EXISTS physical_waiver_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS physical_waiver_uploaded_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS physical_waiver_uploaded_by_role text,
  ADD COLUMN IF NOT EXISTS physical_waiver_file_type text,
  ADD COLUMN IF NOT EXISTS physical_waiver_original_filename text,
  ADD COLUMN IF NOT EXISTS physical_waiver_upload_source text,
  ADD COLUMN IF NOT EXISTS physical_waiver_override_reason text;

-- Create private physical-waivers storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'physical-waivers',
  'physical-waivers',
  false,
  20971520,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- No client-facing storage policies. All uploads route through the
-- upload-physical-waiver Edge Function which uses the service role key.
-- Admins retrieve files via signed URLs generated server-side in get-waiver-status.
