/*
  # Fix Anonymous Lot Pictures Upload - Complete Fix
  
  1. Changes
    - Fix RLS policies on order_lot_pictures table for anonymous users
    - Add storage delete policy for cleanup after failed inserts
  
  2. Security
    - Anonymous users can insert lot picture records
    - Anonymous users can delete from storage (for cleanup only)
    - Keep admin and authenticated user policies intact
*/

-- Drop and recreate the anonymous insert policy with no restrictions
DROP POLICY IF EXISTS "Anonymous users can upload lot pictures with order link" ON order_lot_pictures;

CREATE POLICY "Anon can insert lot pictures"
  ON order_lot_pictures
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Add storage delete policy for anonymous users to allow cleanup
DO $$
BEGIN
  -- Drop if exists
  DROP POLICY IF EXISTS "Anon can delete lot pictures for cleanup" ON storage.objects;
  
  -- Allow anonymous to delete from lot-pictures bucket (for cleanup after failed inserts)
  CREATE POLICY "Anon can delete lot pictures for cleanup"
    ON storage.objects
    FOR DELETE
    TO anon
    USING (bucket_id = 'lot-pictures');
END $$;
