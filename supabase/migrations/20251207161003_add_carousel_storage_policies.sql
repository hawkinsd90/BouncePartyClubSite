/*
  # Add Carousel Media Storage Policies

  1. Storage Policies
    - Public read access to carousel-media bucket
    - Admin-only upload, update, and delete access
*/

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Anyone can view carousel media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload carousel media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update carousel media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete carousel media" ON storage.objects;

-- Policy: Anyone can view files in carousel-media bucket
CREATE POLICY "Anyone can view carousel media"
ON storage.objects FOR SELECT
USING (bucket_id = 'carousel-media');

-- Policy: Admins can upload files to carousel-media bucket
CREATE POLICY "Admins can upload carousel media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'carousel-media'
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'ADMIN'
  )
);

-- Policy: Admins can update files in carousel-media bucket
CREATE POLICY "Admins can update carousel media"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'carousel-media'
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'ADMIN'
  )
)
WITH CHECK (
  bucket_id = 'carousel-media'
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'ADMIN'
  )
);

-- Policy: Admins can delete files from carousel-media bucket
CREATE POLICY "Admins can delete carousel media"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'carousel-media'
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'ADMIN'
  )
);