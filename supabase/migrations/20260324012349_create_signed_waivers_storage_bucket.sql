/*
  # Create signed-waivers storage bucket

  ## Problem
  The waiver email sends a download link pointing to:
  /storage/v1/object/public/signed-waivers/waiver-[order-id]-[timestamp].pdf

  This returns "Bucket not found" because the bucket was never provisioned in
  this environment. The migration that defines it in the signatures system was
  never applied, or the bucket was dropped.

  ## Changes
  - Creates the `signed-waivers` storage bucket (public=true so email links work)
  - Adds storage policies for public read and service_role upload
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signed-waivers',
  'signed-waivers',
  true,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Signed waivers are publicly readable'
  ) THEN
    CREATE POLICY "Signed waivers are publicly readable"
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'signed-waivers');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Admins can upload signed waivers'
  ) THEN
    CREATE POLICY "Admins can upload signed waivers"
      ON storage.objects FOR INSERT
      TO service_role
      WITH CHECK (bucket_id = 'signed-waivers');
  END IF;
END $$;
