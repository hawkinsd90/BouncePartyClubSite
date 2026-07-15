-- ============================================================
-- PENDING MIGRATION (NOT YET APPLIED)
-- File: supabase/migrations/20260716010000_secure_portal_short_links.sql
-- Apply via: mcp__supabase__apply_migration tool after review
-- ============================================================
--
-- Secure portal short-link system
-- Replaces the unsafe anonymous INSERT policy with a
-- SECURITY DEFINER RPC that validates an existing invoice token.
--

-- 1. Drop the unsafe anonymous INSERT policy
DROP POLICY IF EXISTS "Anon can insert portal shortlinks" ON public.invoice_links;

-- 2. Add uniqueness constraints so only one active reusable portal
--    shortlink is created per order, and short codes are globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_links_one_active_portal_shortlink
  ON public.invoice_links (order_id)
  WHERE link_type = 'portal_shortlink' AND expires_at > now();

CREATE UNIQUE INDEX IF NOT EXISTS invoice_links_short_code_key
  ON public.invoice_links (short_code)
  WHERE short_code IS NOT NULL;

-- 3. Add booking_confirmation_status column for atomic duplicate prevention
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS booking_confirmation_status text
  DEFAULT 'pending'
  CHECK (booking_confirmation_status IN ('pending', 'sending', 'sent', 'failed'));

-- 4. SECURITY DEFINER RPC: create_portal_short_link
--    Accepts a valid invoice token, validates it, and creates or reuses
--    a portal shortlink. Never accepts an arbitrary order_id from the caller.
CREATE OR REPLACE FUNCTION public.create_portal_short_link(p_invoice_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_link     invoice_links%ROWTYPE;
  v_order           record;
  v_short_code      text;
  v_existing_code   text;
  v_existing_exp    timestamptz;
  v_new_expiry      timestamptz;
  v_attempts        int := 0;
  v_max_attempts    int := 5;
BEGIN
  -- Validate the source token
  SELECT * INTO v_source_link
  FROM invoice_links
  WHERE link_token = p_invoice_token
    AND link_type IN ('invoice', 'portal_shortlink')
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid token');
  END IF;

  -- Reject expired source links
  IF v_source_link.expires_at IS NOT NULL AND v_source_link.expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token expired');
  END IF;

  -- Fetch the order and reject cancelled/void orders
  SELECT id, status, event_date INTO v_order
  FROM orders
  WHERE id = v_source_link.order_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;

  IF v_order.status IN ('cancelled', 'void') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order is cancelled or void');
  END IF;

  -- Idempotency: reuse an existing unexpired portal shortlink for this order
  SELECT short_code, expires_at INTO v_existing_code, v_existing_exp
  FROM invoice_links
  WHERE order_id = v_source_link.order_id
    AND link_type = 'portal_shortlink'
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_code IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'short_code', v_existing_code,
      'expires_at', to_char(v_existing_exp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
  END IF;

  -- Define maximum expiry: 3 days after event date, or 30 days from now if no event date
  v_new_expiry := CASE
    WHEN v_order.event_date IS NOT NULL THEN
      (v_order.event_date::timestamptz + interval '3 days')
    ELSE
      (now() + interval '30 days')
  END;

  -- If the source link expires sooner than the desired expiry, cap at source expiry
  IF v_source_link.expires_at IS NOT NULL AND v_source_link.expires_at < v_new_expiry THEN
    v_new_expiry := v_source_link.expires_at;
  END IF;

  -- Generate short code with collision retry using cryptographically secure randomness
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > v_max_attempts THEN
      RETURN jsonb_build_object('success', false, 'error', 'Short code generation failed after maximum retries');
    END IF;

    v_short_code := substr(encode(gen_random_bytes(6), 'hex'), 1, 8);

    BEGIN
      INSERT INTO invoice_links (order_id, deposit_cents, customer_filled, expires_at, short_code, link_type)
      VALUES (v_source_link.order_id, 0, true, v_new_expiry, v_short_code, 'portal_shortlink');
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'short_code', v_short_code,
    'expires_at', to_char(v_new_expiry, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_portal_short_link(text) TO anon, authenticated;

-- 5. Atomic claim RPC for booking confirmation duplicate prevention
--    Uses a conditional UPDATE to atomically claim the confirmation slot.
--    Returns { claimed: true } for the winner, { claimed: false } for losers.
CREATE OR REPLACE FUNCTION public.claim_booking_confirmation(p_order_id uuid, p_source text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $
DECLARE
  v_current_status text;
  v_rows_affected int;
BEGIN
  SELECT booking_confirmation_status INTO v_current_status
  FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'error', 'Order not found');
  END IF;

  -- Already sent or being sent by another caller
  IF v_current_status IN ('sent', 'sending') THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  -- Atomic claim: only 'pending' or 'failed' can transition to 'sending'
  UPDATE orders
  SET booking_confirmation_status = 'sending'
  WHERE id = p_order_id
    AND booking_confirmation_status IN ('pending', 'failed');

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  IF v_rows_affected = 0 THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  RETURN jsonb_build_object('claimed', true);
END;
$;

GRANT EXECUTE ON FUNCTION public.claim_booking_confirmation(uuid, text) TO anon, authenticated;
