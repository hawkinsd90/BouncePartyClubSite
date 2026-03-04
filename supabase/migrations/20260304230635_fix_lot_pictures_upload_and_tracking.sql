/*
  # Fix Lot Pictures Upload and Add Request Tracking

  1. Changes to `orders` table
    - Add `lot_pictures_requested` boolean field to track if admin requested pictures
    - Add `lot_pictures_requested_at` timestamp for when request was made
  
  2. Storage Policies
    - Ensure anonymous users can upload to lot-pictures bucket
  
  3. Security
    - Keep existing RLS policies on order_lot_pictures table
    - Anonymous users can upload when they have the order link
*/

-- Add lot pictures request tracking to orders table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'lot_pictures_requested'
  ) THEN
    ALTER TABLE orders ADD COLUMN lot_pictures_requested boolean DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'lot_pictures_requested_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN lot_pictures_requested_at timestamptz;
  END IF;
END $$;

-- Ensure storage policies allow anonymous uploads to lot-pictures bucket
DO $$
BEGIN
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "Allow anon upload to lot-pictures" ON storage.objects;
  DROP POLICY IF EXISTS "Allow public read from lot-pictures" ON storage.objects;
  
  -- Create new policies
  CREATE POLICY "Allow anon upload to lot-pictures"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'lot-pictures');
  
  CREATE POLICY "Allow public read from lot-pictures"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'lot-pictures');
  
  -- Allow authenticated users to upload
  DROP POLICY IF EXISTS "Allow auth upload to lot-pictures" ON storage.objects;
  CREATE POLICY "Allow auth upload to lot-pictures"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'lot-pictures');
END $$;
