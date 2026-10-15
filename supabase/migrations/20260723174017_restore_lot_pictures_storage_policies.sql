/*
  # Restore lot-pictures storage policies

  The lot-pictures bucket exists and is public, but all storage object
  policies were lost. Re-create the clean set:
  - Public SELECT (read images)
  - Public INSERT (upload lot pictures)
  - Authenticated DELETE (admin cleanup)
*/

-- Drop any remnants
DROP POLICY IF EXISTS "Public can view lot pictures" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload lot pictures" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete lot pictures" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update lot pictures" ON storage.objects;
DROP POLICY IF EXISTS "Anon can insert lot pictures for existing orders" ON storage.objects;

-- Public can read
CREATE POLICY "Public can view lot pictures"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'lot-pictures');

-- Public can upload (anon + authenticated)
CREATE POLICY "Anyone can upload lot pictures"
  ON storage.objects
  FOR INSERT
  TO public
  WITH CHECK (bucket_id = 'lot-pictures');

-- Authenticated (admins) can delete
CREATE POLICY "Authenticated can delete lot pictures"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'lot-pictures');
