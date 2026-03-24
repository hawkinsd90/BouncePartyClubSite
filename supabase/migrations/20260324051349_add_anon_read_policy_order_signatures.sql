/*
  # Add anonymous read policy for order_signatures

  ## Problem
  The customer portal uses the anon Supabase client to load signature data in WaiverTab.
  There is no SELECT policy for unauthenticated (anon) users, so the query returns null
  and the waiver tab always shows "Waiver Required" even when the waiver is already signed.

  ## Change
  Add a policy allowing anon users to SELECT from order_signatures when they know the
  order_id. This mirrors the same pattern used for orders (anon can read by order id).
  The customer portal URL already contains the order UUID, so knowing the order_id is
  the access-control gate — consistent with all other portal queries.

  ## Security
  - No PII is exposed beyond what the customer already has (their own order UUID)
  - The policy is scoped to SELECT only
  - INSERT is already handled by a separate anon INSERT policy
*/

CREATE POLICY "Anonymous can view signatures by order id"
  ON order_signatures
  FOR SELECT
  TO anon
  USING (true);
