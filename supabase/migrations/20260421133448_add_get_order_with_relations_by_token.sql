/*
  # Add get_order_with_relations_by_token RPC

  ## Summary
  Creates a new SECURITY DEFINER function that validates an invoice link token
  and returns the full joined order data needed by the public customer portal,
  equivalent to STANDARD_ORDER_SELECT.

  ## Problem
  After tightening orders RLS (removing open anon SELECT policies), the public
  invoice/portal data-loading path regressed. useOrderData.ts calls
  getOrderById() as an anon client — this now fails with RLS denied because
  there is no anon SELECT policy on orders. The fallback to the flat
  get_order_by_token row is missing all joined relations (customers, addresses,
  payments, order_items/units), causing blank customer name, address, and
  payment info in the portal UI.

  ## Fix
  This function performs a single token-validated query and returns all joined
  data the portal needs as a jsonb object. The frontend replaces the two-call
  get_order_by_token + getOrderById pattern with a single call to this function.

  ## New Functions
  - `get_order_with_relations_by_token(p_token text)` — SECURITY DEFINER
    - Validates token against invoice_links (expires_at > now())
    - Returns jsonb with: orders.*, customers, addresses, order_items (with
      nested units), payments, order_discounts, order_custom_fees
    - Returns NULL if token is invalid or expired

  ## Security
  - SECURITY DEFINER with explicit search_path = public
  - Token validation is inside the DB — no order data leaks without valid token
  - EXECUTE granted to anon and authenticated only
  - Does NOT re-add any broad anon SELECT policy on orders
*/

CREATE OR REPLACE FUNCTION public.get_order_with_relations_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_result   jsonb;
BEGIN
  -- Validate token: must exist and not be expired
  SELECT order_id INTO v_order_id
  FROM public.invoice_links
  WHERE link_token = p_token
    AND expires_at > now()
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    to_jsonb(o.*) ||
    jsonb_build_object(
      'customers', (
        SELECT to_jsonb(c)
        FROM (
          SELECT id, first_name, last_name, email, phone, business_name
          FROM public.customers
          WHERE id = o.customer_id
        ) c
      ),
      'addresses', (
        SELECT to_jsonb(a)
        FROM (
          SELECT id, line1, line2, city, state, zip, lat, lng
          FROM public.addresses
          WHERE id = o.address_id
        ) a
      ),
      'order_items', (
        SELECT COALESCE(jsonb_agg(
          to_jsonb(oi) ||
          jsonb_build_object(
            'units', (
              SELECT to_jsonb(u)
              FROM (
                SELECT id, name, types, price_dry_cents, price_water_cents,
                       dimensions, capacity
                FROM public.units
                WHERE id = oi.unit_id
              ) u
            )
          )
        ), '[]'::jsonb)
        FROM (
          SELECT id, order_id, unit_id, qty, wet_or_dry, unit_price_cents, notes
          FROM public.order_items
          WHERE order_id = o.id
        ) oi
      ),
      'payments', (
        SELECT COALESCE(jsonb_agg(
          to_jsonb(p)
          ORDER BY p.created_at DESC
        ), '[]'::jsonb)
        FROM (
          SELECT id, order_id, amount_cents, type, status,
                 stripe_payment_intent_id, payment_method,
                 payment_last4, payment_brand, created_at
          FROM public.payments
          WHERE order_id = o.id
        ) p
      ),
      'order_discounts', (
        SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
        FROM (
          SELECT id, order_id, name, amount_cents, percentage
          FROM public.order_discounts
          WHERE order_id = o.id
        ) d
      ),
      'order_custom_fees', (
        SELECT COALESCE(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
        FROM (
          SELECT id, order_id, name, amount_cents
          FROM public.order_custom_fees
          WHERE order_id = o.id
        ) f
      )
    )
  INTO v_result
  FROM public.orders o
  WHERE o.id = v_order_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_with_relations_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_order_with_relations_by_token(text) TO authenticated;
