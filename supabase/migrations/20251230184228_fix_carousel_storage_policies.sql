/*
  # Fix Carousel Storage Policies

  1. Problem
    - Storage policies check user_roles table directly
    - Need to support both ADMIN and MASTER roles

  2. Solution
    - Use get_user_role() SECURITY DEFINER function
    - Add MASTER role support

  3. Changes
    - Drop existing storage policies
    - Recreate using get_user_role() function
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view carousel media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload carousel media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update carousel media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete carousel media" ON storage.objects;

-- Anyone can view carousel media
CREATE POLICY "Anyone can view carousel media"
ON storage.objects FOR SELECT
USING (bucket_id = 'carousel-media');

-- Admins can upload carousel media
CREATE POLICY "Admins can upload carousel media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'carousel-media'
  AND UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
);

-- Admins can update carousel media
CREATE POLICY "Admins can update carousel media"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'carousel-media'
  AND UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
)
WITH CHECK (
  bucket_id = 'carousel-media'
  AND UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
);

-- Admins can delete carousel media
CREATE POLICY "Admins can delete carousel media"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'carousel-media'
  AND UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
);