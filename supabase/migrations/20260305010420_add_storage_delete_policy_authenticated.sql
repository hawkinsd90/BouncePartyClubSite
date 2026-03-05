/*
  # Add Storage Delete Policy for Authenticated Users
  
  1. Changes
    - Add DELETE policy on storage.objects for authenticated users to delete lot pictures
  
  2. Security
    - Authenticated users can delete files from lot-pictures bucket
*/

-- Allow authenticated users to delete from lot-pictures bucket
DO $$
BEGIN
  -- Drop if exists
  DROP POLICY IF EXISTS "Authenticated can delete lot pictures" ON storage.objects;
  
  CREATE POLICY "Authenticated can delete lot pictures"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'lot-pictures');
END $$;
