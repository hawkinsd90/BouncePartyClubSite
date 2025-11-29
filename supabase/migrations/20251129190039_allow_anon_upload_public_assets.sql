/*
  # Allow Anonymous Upload to Public Assets

  1. Changes
    - Allow anon role to upload to public-assets bucket
    - This is needed for initial logo setup
    - Can be revoked after logo is uploaded if desired
*/

-- Drop and recreate upload policy to allow anon
DROP POLICY IF EXISTS "Authenticated users can upload public assets" ON storage.objects;

CREATE POLICY "Anyone can upload public assets"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'public-assets');
