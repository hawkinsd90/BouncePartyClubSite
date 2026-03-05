/*
  # Clean Up Duplicate Lot Pictures Storage Policies
  
  1. Changes
    - Remove duplicate storage policies for lot-pictures bucket
    - Keep only necessary policies with clear permissions
  
  2. Security
    - Allow anon and authenticated to upload (INSERT)
    - Allow anon and authenticated to delete (DELETE)
    - Allow public to read (SELECT)
*/

-- Drop all existing lot-pictures policies
DROP POLICY IF EXISTS "Allow anon upload to lot-pictures" ON storage.objects;
DROP POLICY IF EXISTS "Allow auth upload to lot-pictures" ON storage.objects;
DROP POLICY IF EXISTS "Anonymous users can upload lot pictures" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload lot pictures" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read from lot-pictures" ON storage.objects;
DROP POLICY IF EXISTS "Public can view lot pictures" ON storage.objects;
DROP POLICY IF EXISTS "Anon can delete lot pictures for cleanup" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete lot pictures" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete lot pictures" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own lot pictures" ON storage.objects;

-- Create clean set of policies
CREATE POLICY "Public can view lot pictures"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'lot-pictures');

CREATE POLICY "Anyone can upload lot pictures"
  ON storage.objects
  FOR INSERT
  TO public
  WITH CHECK (bucket_id = 'lot-pictures');

CREATE POLICY "Anyone can delete lot pictures"
  ON storage.objects
  FOR DELETE
  TO public
  USING (bucket_id = 'lot-pictures');

CREATE POLICY "Anyone can update lot pictures"
  ON storage.objects
  FOR UPDATE
  TO public
  USING (bucket_id = 'lot-pictures')
  WITH CHECK (bucket_id = 'lot-pictures');
