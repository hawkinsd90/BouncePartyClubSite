/*
# Create Event Essentials Media Storage Bucket

1. Purpose
   Creates a dedicated public storage bucket for Event Essentials product
   and package images. Admin/master-only writes; public read.

   This replaces the prior plan to use `public-assets` (which allows any
   authenticated user to upload) and `unit-images` (which lacks MIME/size
   limits and is scoped to inflatables).

2. Bucket
   - id: event-essentials-media
   - public: true (public read via URL)
   - file_size_limit: 10 MB (10,485,760 bytes)
   - allowed_mime_types: png, jpeg, jpg, gif, webp, heic, heif

3. Storage Policies (on storage.objects)
   - Public read (TO public, SELECT)
   - Admin/master insert (TO authenticated, INSERT + WITH CHECK)
   - Admin/master update (TO authenticated, UPDATE + USING + WITH CHECK)
   - Admin/master delete (TO authenticated, DELETE + USING)

   All admin policies use public.get_user_role(auth.uid()) IN ('admin', 'master')
   for authorization. This is the established project pattern.

4. Security
   - Non-admin authenticated users cannot upload, update, or delete
   - Public can only read, not write
   - Bucket MIME and size limits are server-enforced regardless of RLS
*/

-- ---------------------------------------------------------------------------
-- Create the bucket (retry-safe upsert)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'event-essentials-media',
  'event-essentials-media',
  true,
  10485760,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Storage policies (drop-first for retry safety)
-- ---------------------------------------------------------------------------

-- Public read
DROP POLICY IF EXISTS "Public can read event-essentials media" ON storage.objects;
CREATE POLICY "Public can read event-essentials media"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'event-essentials-media');

-- Admin/master insert
DROP POLICY IF EXISTS "Admins can upload event-essentials media" ON storage.objects;
CREATE POLICY "Admins can upload event-essentials media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'event-essentials-media'
    AND public.get_user_role(auth.uid()) IN ('admin', 'master')
  );

-- Admin/master update
DROP POLICY IF EXISTS "Admins can update event-essentials media" ON storage.objects;
CREATE POLICY "Admins can update event-essentials media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'event-essentials-media'
    AND public.get_user_role(auth.uid()) IN ('admin', 'master')
  )
  WITH CHECK (
    bucket_id = 'event-essentials-media'
    AND public.get_user_role(auth.uid()) IN ('admin', 'master')
  );

-- Admin/master delete
DROP POLICY IF EXISTS "Admins can delete event-essentials media" ON storage.objects;
CREATE POLICY "Admins can delete event-essentials media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'event-essentials-media'
    AND public.get_user_role(auth.uid()) IN ('admin', 'master')
  );
