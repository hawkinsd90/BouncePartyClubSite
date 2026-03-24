/*
  # Drop anon SELECT policy on order_signatures

  ## Problem
  Two successive anon SELECT policies on order_signatures were both effectively
  permissive:

  1. Original: USING (true)
     — allows any anon caller to read all rows

  2. Previous "fix": USING (EXISTS (SELECT 1 FROM orders WHERE orders.id = order_signatures.order_id))
     — still allows any anon caller to read all rows, because every valid
     order_signatures row has an order_id that satisfies the EXISTS check.
     The orders table itself has an anon SELECT USING(true) policy, so the
     subquery always resolves. This is functionally identical to USING(true).

  ## Root cause
  The customer portal (/customer-portal/:orderId) is an unauthenticated flow
  gated only by UUID knowledge. There is no session token or secret that could
  be checked inside a Postgres RLS policy to bind signature access to the specific
  portal visitor. Any RLS policy that only checks order_id provides no restriction
  beyond what order_id knowledge already allows.

  ## Fix
  1. Drop the ineffective anon SELECT policy entirely.
  2. The WaiverTab component now calls the get-waiver-status edge function (service
     role) which:
     - Verifies the order exists
     - Returns only the columns needed for display (signed_at, signer_name,
       signer_email, waiver_version, ip_address, initials_data,
       signature_image_url, pdf_url)
     - Never exposes: waiver_text_snapshot, home_address_*, device_info,
       user_agent, electronic_consent_text, typed_name, event_address_*

  ## Effect
  Anonymous Postgres clients (direct REST API calls with the anon key) can no
  longer SELECT from order_signatures at all. Access is only through the
  controlled edge function surface.

  ## Notes
  - The anon INSERT policy is preserved (required for unauthenticated waiver signing)
  - Authenticated policies (users see own, admins see all) are unchanged
  - The realtime subscription on order_signatures in CustomerPortal.tsx triggers
    a reload via the edge function path, which is correct — the subscription only
    fires the debouncedReload callback, not a direct DB read
*/

DROP POLICY IF EXISTS "Anonymous can view signatures for valid orders" ON order_signatures;
DROP POLICY IF EXISTS "Anonymous can view signatures by order id" ON order_signatures;
