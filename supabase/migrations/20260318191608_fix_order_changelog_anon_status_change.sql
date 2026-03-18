/*
  # Fix order_changelog anon policy to include customer status_change

  The RejectionModal inserts a changelog entry with change_type = 'status_change'
  when a customer cancels/rejects their order. The existing anon policy only allows
  'customer_approval'. This extends the policy to also allow 'status_change' from
  anonymous users with null user_id.

  ## Changes
  - Drop and recreate the anon INSERT policy to allow both 'customer_approval'
    and 'status_change' change types with null user_id
*/

DROP POLICY IF EXISTS "Anonymous users can log customer approvals" ON order_changelog;

CREATE POLICY "Anonymous users can log customer actions"
  ON order_changelog FOR INSERT
  TO anon
  WITH CHECK (
    user_id IS NULL
    AND change_type IN ('customer_approval', 'status_change')
  );
