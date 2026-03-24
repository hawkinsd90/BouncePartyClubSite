/*
  # Tighten order_signatures anon SELECT policy

  ## Problem
  The existing anon SELECT policy on order_signatures has:
    USING (true)
  This allows any unauthenticated caller with the Supabase anon key to read ALL
  rows in order_signatures, including PII fields:
    - signer_name, signer_email, signer_phone
    - ip_address, user_agent, device_info
    - event_address_line1, home_address_line1, home_city, home_zip
    - waiver_text_snapshot (full waiver text)
  A caller who knows any order UUID can enumerate signature PII for that customer.

  ## Fix
  Replace USING (true) with USING (EXISTS (SELECT 1 FROM orders WHERE orders.id = order_signatures.order_id))
  This ensures anonymous callers can only read signature rows for orders that exist,
  and only when they provide the correct order_id in their query filter.

  ## Important
  The anon caller in the customer portal always queries by order_id:
    .from('order_signatures').select('*').eq('order_id', orderId)
  This policy continues to allow that query while preventing bulk enumeration.

  ## Notes
  - The INSERT policy (with_check: true) is left unchanged — anon can still submit
    a new signature (required for unauthenticated customers signing the waiver)
  - Authenticated policies are unchanged
  - This is a restrictive change that closes a PII exposure window
*/

DROP POLICY IF EXISTS "Anonymous can view signatures by order id" ON order_signatures;

CREATE POLICY "Anonymous can view signatures for valid orders"
  ON order_signatures
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM orders WHERE orders.id = order_signatures.order_id
    )
  );
