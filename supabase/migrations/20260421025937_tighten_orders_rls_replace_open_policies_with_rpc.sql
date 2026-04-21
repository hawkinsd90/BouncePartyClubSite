/*
  # Tighten orders table RLS: remove open public/anon policies and replace with SECURITY DEFINER RPCs

  ## Summary
  The orders table had two overly-permissive RLS policies:
  - "Public can approve orders": UPDATE with USING (true) / WITH CHECK (true) for the `public` role
    — any unauthenticated client could update any column on any order row
  - "Anonymous users can read orders": SELECT with USING (true) for `anon`
    — any unauthenticated client could read any order row (PII/financial exposure)
  - "Public can view orders for invoice links": SELECT with USING (true) for `public`
    — same problem

  ## What this migration does
  1. Drops all three unsafe policies
  2. Creates `get_order_by_token(p_token text)` — SECURITY DEFINER function that validates a
     link_token against invoice_links (checking expiry) and returns the order row. This is the
     only legitimate public read path; the calling client must present a valid unexpired token.
  3. Creates `approve_order_changes(...)` — SECURITY DEFINER function that validates a
     link_token, confirms the order is in awaiting_customer_approval status, and only writes
     the three fields the approval flow needs: customer_selected_payment_cents,
     customer_selected_payment_type, tip_cents (and optionally status → confirmed).
     Cannot be used to change status to anything other than 'confirmed' or to write
     arbitrary fields.

  ## Security notes
  - Both RPCs are SECURITY DEFINER so they run as the DB owner and bypass RLS for their
    internal reads/writes — the token validation IS the access control.
  - The approve RPC enforces: valid token, unexpired link, order in awaiting_customer_approval,
    and only writes the declared fields.
  - The get_order RPC enforces: valid token, unexpired link. Returns NULL if either check fails
    (no error message that leaks existence).
  - The existing "Customers can view own orders" authenticated SELECT policy is untouched.
  - The existing "Service role full access to orders" policy is untouched (used by edge functions
    running with service role key).
  - The existing "Anonymous users can mark booking confirmation sent" UPDATE policy is left in
    place for now — it is scoped to booking_confirmation_sent field only via WITH CHECK.
*/

-- ============================================================
-- Step 1: Drop the three unsafe open policies
-- ============================================================

DROP POLICY IF EXISTS "Public can approve orders" ON public.orders;
DROP POLICY IF EXISTS "Anonymous users can read orders" ON public.orders;
DROP POLICY IF EXISTS "Public can view orders for invoice links" ON public.orders;

-- ============================================================
-- Step 2: get_order_by_token — safe public order read via token
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_order_by_token(p_token text)
RETURNS setof public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  -- Validate token: must exist and not be expired
  SELECT order_id INTO v_order_id
  FROM public.invoice_links
  WHERE link_token = p_token
    AND expires_at > now()
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN;  -- Return empty set; do not reveal whether order exists
  END IF;

  RETURN QUERY
  SELECT o.*
  FROM public.orders o
  WHERE o.id = v_order_id;
END;
$$;

-- Grant execute to anon and authenticated so the client JS SDK can call it
GRANT EXECUTE ON FUNCTION public.get_order_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_order_by_token(text) TO authenticated;

-- ============================================================
-- Step 3: approve_order_changes — safe public approval write via token
-- ============================================================

CREATE OR REPLACE FUNCTION public.approve_order_changes(
  p_order_id uuid,
  p_token text,
  p_customer_selected_payment_cents integer DEFAULT NULL,
  p_customer_selected_payment_type text DEFAULT NULL,
  p_tip_cents integer DEFAULT NULL,
  p_confirm_status boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link_order_id uuid;
  v_current_status text;
BEGIN
  -- Validate token: must exist, not expired, and match the given order_id
  SELECT il.order_id INTO v_link_order_id
  FROM public.invoice_links il
  WHERE il.link_token = p_token
    AND il.expires_at > now()
    AND il.order_id = p_order_id
  LIMIT 1;

  IF v_link_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_token');
  END IF;

  -- Confirm the order is in the expected status for customer approval
  SELECT status INTO v_current_status
  FROM public.orders
  WHERE id = p_order_id;

  IF v_current_status IS DISTINCT FROM 'awaiting_customer_approval' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status', 'status', v_current_status);
  END IF;

  -- Write only the explicitly allowed fields
  UPDATE public.orders
  SET
    customer_selected_payment_cents = COALESCE(p_customer_selected_payment_cents, customer_selected_payment_cents),
    customer_selected_payment_type  = COALESCE(p_customer_selected_payment_type, customer_selected_payment_type),
    tip_cents                       = COALESCE(p_tip_cents, tip_cents),
    status                          = CASE WHEN p_confirm_status THEN 'confirmed' ELSE status END,
    customer_approved_at            = CASE WHEN p_confirm_status THEN now() ELSE customer_approved_at END
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_order_changes(uuid, text, integer, text, integer, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.approve_order_changes(uuid, text, integer, text, integer, boolean) TO authenticated;
