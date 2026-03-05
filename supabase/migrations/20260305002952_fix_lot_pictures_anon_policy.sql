/*
  # Fix Anonymous Lot Pictures Upload Policy
  
  1. Changes
    - Drop and recreate anonymous insert policy with proper WITH CHECK
    - Ensure anonymous users can upload lot pictures
  
  2. Security
    - Anonymous users can upload via public portal link
*/

-- Drop existing anonymous policy if it exists
DROP POLICY IF EXISTS "Anonymous users can upload lot pictures with order link" ON order_lot_pictures;

-- Recreate with explicit WITH CHECK
CREATE POLICY "Anonymous users can upload lot pictures with order link"
  ON order_lot_pictures
  FOR INSERT
  TO anon
  WITH CHECK (
    -- Allow insert for any order
    order_id IS NOT NULL
  );
