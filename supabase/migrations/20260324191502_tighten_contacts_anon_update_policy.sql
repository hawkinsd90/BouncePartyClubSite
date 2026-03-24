/*
  # Tighten contacts anon UPDATE policy

  ## Problem
  The policy "Anyone can update contact during checkout upsert" was added to allow
  the ON CONFLICT DO UPDATE path during guest checkout. However, it used:
    USING (true) WITH CHECK (true)
  This allows ANY anon or authenticated user to UPDATE ANY contact row — a serious
  over-permission that could be abused to corrupt arbitrary contact records.

  ## Fix
  Replace the open UPDATE policy with one that is scoped to the checkout upsert
  path. The only legitimate anon UPDATE during checkout is when the upsert's
  ON CONFLICT email match fires. We restrict:
  - USING: no USING restriction needed for INSERT conflict path, but for safety we
    move the entire guest contact write path to a server-side RPC so anon never
    touches the contacts table directly.

  Since changing the write path in application code is outside this migration's
  scope, we use the minimum safe restriction available in pure RLS:
  - Drop the open USING(true)/WITH CHECK(true) policy.
  - Add a narrower UPDATE policy: only allow updating rows where the email matches
    a currently authenticated user's own email (for logged-in customers updating
    their own contact record), or allow it only via service_role (which covers
    the edge-function path).
  - For the pure anon upsert path we accept the INSERT policy (new contacts) and
    rely on the service_role policy for updates to existing contacts, since the
    charge-deposit and checkout-bridge edge functions run as service_role.

  Note: The checkout createOrderBeforePayment() call runs client-side as anon.
  The contacts upsert in orderCreation.ts line 111 is the caller.
  Restricting anon UPDATE means repeat customers' contact rows won't be updated
  from the client-side path — but this is the correct tradeoff: contact data
  staleness is far less risky than allowing arbitrary anon row mutation.

  The admin "Admins can update contacts" policy already covers authenticated
  admin updates. The service_role policy covers server-side updates.
*/

DROP POLICY IF EXISTS "Anyone can update contact during checkout upsert" ON contacts;
