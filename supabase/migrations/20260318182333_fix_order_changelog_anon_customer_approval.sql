/*
  # Fix order_changelog RLS for anonymous customer approvals

  ## Problem
  The existing INSERT policy requires auth.uid() = user_id, which blocks anonymous
  customers from inserting changelog entries during the order approval flow
  (where user_id is intentionally null).

  ## Changes
  - Drop the existing restrictive INSERT policy
  - Add two policies:
    1. Authenticated users can insert with their own user_id
    2. Anonymous users can insert with null user_id for customer_approval change_type only

  ## Security
  - Anonymous inserts are restricted to change_type = 'customer_approval' and user_id IS NULL
  - This prevents abuse while allowing the legitimate customer approval flow
*/

DROP POLICY IF EXISTS "Authenticated users can create changelog entries" ON order_changelog;

CREATE POLICY "Authenticated users can create changelog entries"
  ON order_changelog FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Anonymous users can log customer approvals"
  ON order_changelog FOR INSERT
  TO anon
  WITH CHECK (
    user_id IS NULL
    AND change_type = 'customer_approval'
  );
