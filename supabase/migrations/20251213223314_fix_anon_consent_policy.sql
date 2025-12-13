/*
  # Fix Anonymous Consent Records Policy

  1. Problem
    - Anonymous users cannot insert consent records during checkout
    - RLS policy may not be properly configured
    
  2. Solution
    - Drop and recreate the anonymous INSERT policy with correct configuration
*/

-- Drop the existing policy
DROP POLICY IF EXISTS "Anonymous can create consent records" ON consent_records;

-- Recreate with explicit configuration
CREATE POLICY "Anonymous can create consent records"
  ON consent_records
  FOR INSERT
  TO anon
  WITH CHECK (true);