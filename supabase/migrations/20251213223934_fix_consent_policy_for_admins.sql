/*
  # Fix Consent Records Policy for Admin Checkouts

  1. Problem
    - Admins cannot create consent records for customers during checkout
    - Policy only allows creating records where customer_id = auth.uid()
    - This fails when admin creates orders on behalf of customers
    
  2. Solution
    - Update policy to allow admins/masters to create consent records for any customer
*/

-- Drop and recreate the authenticated user policy
DROP POLICY IF EXISTS "Users can create own consent records" ON consent_records;

CREATE POLICY "Users can create own consent records"
  ON consent_records
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if creating for own customer_id
    customer_id = (SELECT auth.uid())
    -- OR if user is admin/master (can create for any customer)
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = (SELECT auth.uid())
      AND role = ANY(ARRAY['ADMIN', 'MASTER'])
    )
  );