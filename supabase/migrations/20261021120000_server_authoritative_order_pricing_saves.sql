/*
  # Server-authoritative order pricing saves

  ## Problem
  An Admin Edit and an Admin / Crew Invoice computed their prices in the staff browser and wrote the results (subtotal, fees,
  tax, deposit, balance) straight into `orders` with the staff member's own database session. The browser's arithmetic was
  therefore the authority for what a customer was later asked to pay.

  ## Boundary
  Pricing is now derived by an Edge Function (`staff-order-save`) from the stored order, the catalog and the pricing rules, with
  the same pure code the Quote and the booking use. The function hands the finished, server-derived rows to the two functions
  below, which write them in ONE transaction. They are callable by the service role only.

    apply_staff_order_save         edits an existing order: verifies, under the order row lock, that the order and its items,
                                   discounts and fees are exactly what the server priced against (otherwise `stale`), then applies
                                   the item / discount / fee changes, the order columns and the change log together.
    create_staff_invoice_order     creates a DRAFT order with its items, discounts and fees.

  These functions do not calculate money. They are the narrow, whitelisted write path for money the server already derived.

  ## The staff browser can no longer write the pricing snapshot
  A BEFORE INSERT OR UPDATE trigger on `orders` refuses any change to the pricing snapshot columns (subtotal, fees, tax, deposit and
  balance due, the deposit override, the travel mileage and its snapshot, the waivers and the waived-fee amounts, and the paid / tip /
  damage / refunded ledger amounts) made by a direct `authenticated` or `anon` session. The service role,
  the table owner and SECURITY DEFINER functions (finalize / cash / check / booking) are unaffected.

  ## The staff browser cannot write orders or their financial children at all
  Row level security cannot restrict columns, so the privileges themselves are removed: `authenticated` and `anon` lose INSERT /
  UPDATE / DELETE on order_items, order_discounts and order_custom_fees (SELECT stays), and INSERT / DELETE on orders (UPDATE stays
  for the non-financial workflow columns, behind the trigger above). Orders are created only by the service-backed functions
  (`create_staff_invoice_order`, `create_booking_request`); items, discounts and fees are written only by the server functions.

  ## Waived fee amounts
  `orders.waived_fee_amounts_cents` keeps what a waived fee would have cost WHEN IT WAS WAIVED, so "$X - Waived" never has to be
  rebuilt from today's pricing rules. NULL / a missing key means "not recorded" (every waiver made before this column existed):
  such a fee is shown as "Waived" without a dollar figure. Nothing is back-filled and no fee column changes meaning.

  ## Not changed
  Existing rows, the payment-operation functions, the payment state barrier, and every existing pricing column.
*/

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS waived_fee_amounts_cents jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_waived_fee_amounts_object' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_waived_fee_amounts_object CHECK (waived_fee_amounts_cents IS NULL OR jsonb_typeof(waived_fee_amounts_cents) = 'object');
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The pricing snapshot is not writable from a staff browser session
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_order_pricing_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only a direct session of the browser-facing roles is restricted. The service role, the owner and SECURITY DEFINER
  -- functions (which run as their owner) are how server-derived money is written.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.subtotal_cents, 0) <> 0
       OR COALESCE(NEW.event_essentials_subtotal_cents, 0) <> 0
       OR COALESCE(NEW.travel_fee_cents, 0) <> 0
       OR COALESCE(NEW.surface_fee_cents, 0) <> 0
       OR COALESCE(NEW.same_day_pickup_fee_cents, 0) <> 0
       OR COALESCE(NEW.same_day_weekday_delivery_fee_cents, 0) <> 0
       OR COALESCE(NEW.generator_fee_cents, 0) <> 0
       OR COALESCE(NEW.setup_fee_cents, 0) <> 0
       OR COALESCE(NEW.tax_cents, 0) <> 0
       OR COALESCE(NEW.deposit_due_cents, 0) <> 0
       OR COALESCE(NEW.balance_due_cents, 0) <> 0
       OR COALESCE(NEW.travel_total_miles, 0) <> 0
       OR COALESCE(NEW.deposit_paid_cents, 0) <> 0
       OR COALESCE(NEW.balance_paid_cents, 0) <> 0
       OR COALESCE(NEW.tip_cents, 0) <> 0
       OR COALESCE(NEW.damage_charged_cents, 0) <> 0
       OR COALESCE(NEW.total_refunded_cents, 0) <> 0
       OR COALESCE(NEW.tax_waived, false)
       OR COALESCE(NEW.travel_fee_waived, false)
       OR COALESCE(NEW.surface_fee_waived, false)
       OR COALESCE(NEW.generator_fee_waived, false)
       OR COALESCE(NEW.same_day_pickup_fee_waived, false)
       OR COALESCE(NEW.same_day_weekday_delivery_fee_waived, false)
       OR NEW.custom_deposit_cents IS NOT NULL
       OR NEW.waived_fee_amounts_cents IS NOT NULL THEN
      RAISE EXCEPTION 'Order pricing is derived by the server and cannot be set directly.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
     OR NEW.event_essentials_subtotal_cents IS DISTINCT FROM OLD.event_essentials_subtotal_cents
     OR NEW.travel_fee_cents IS DISTINCT FROM OLD.travel_fee_cents
     OR NEW.travel_total_miles IS DISTINCT FROM OLD.travel_total_miles
     OR NEW.travel_base_radius_miles IS DISTINCT FROM OLD.travel_base_radius_miles
     OR NEW.travel_chargeable_miles IS DISTINCT FROM OLD.travel_chargeable_miles
     OR NEW.travel_per_mile_cents IS DISTINCT FROM OLD.travel_per_mile_cents
     OR NEW.travel_is_flat_fee IS DISTINCT FROM OLD.travel_is_flat_fee
     OR NEW.surface_fee_cents IS DISTINCT FROM OLD.surface_fee_cents
     OR NEW.same_day_pickup_fee_cents IS DISTINCT FROM OLD.same_day_pickup_fee_cents
     OR NEW.same_day_weekday_delivery_fee_cents IS DISTINCT FROM OLD.same_day_weekday_delivery_fee_cents
     OR NEW.generator_fee_cents IS DISTINCT FROM OLD.generator_fee_cents
     OR NEW.setup_fee_cents IS DISTINCT FROM OLD.setup_fee_cents
     OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
     OR NEW.deposit_due_cents IS DISTINCT FROM OLD.deposit_due_cents
     OR NEW.balance_due_cents IS DISTINCT FROM OLD.balance_due_cents
     OR NEW.custom_deposit_cents IS DISTINCT FROM OLD.custom_deposit_cents
     OR NEW.waived_fee_amounts_cents IS DISTINCT FROM OLD.waived_fee_amounts_cents
     -- What has been PAID, tipped, charged for damage or refunded is written by the payment functions, never by a browser session.
     OR NEW.deposit_paid_cents IS DISTINCT FROM OLD.deposit_paid_cents
     OR NEW.balance_paid_cents IS DISTINCT FROM OLD.balance_paid_cents
     OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents
     OR NEW.damage_charged_cents IS DISTINCT FROM OLD.damage_charged_cents
     OR NEW.total_refunded_cents IS DISTINCT FROM OLD.total_refunded_cents
     OR NEW.tax_waived IS DISTINCT FROM OLD.tax_waived
     OR NEW.tax_waive_reason IS DISTINCT FROM OLD.tax_waive_reason
     OR NEW.travel_fee_waived IS DISTINCT FROM OLD.travel_fee_waived
     OR NEW.travel_fee_waive_reason IS DISTINCT FROM OLD.travel_fee_waive_reason
     OR NEW.surface_fee_waived IS DISTINCT FROM OLD.surface_fee_waived
     OR NEW.surface_fee_waive_reason IS DISTINCT FROM OLD.surface_fee_waive_reason
     OR NEW.generator_fee_waived IS DISTINCT FROM OLD.generator_fee_waived
     OR NEW.generator_fee_waive_reason IS DISTINCT FROM OLD.generator_fee_waive_reason
     OR NEW.same_day_pickup_fee_waived IS DISTINCT FROM OLD.same_day_pickup_fee_waived
     OR NEW.same_day_pickup_fee_waive_reason IS DISTINCT FROM OLD.same_day_pickup_fee_waive_reason
     OR NEW.same_day_weekday_delivery_fee_waived IS DISTINCT FROM OLD.same_day_weekday_delivery_fee_waived
     OR NEW.same_day_weekday_delivery_fee_waive_reason IS DISTINCT FROM OLD.same_day_weekday_delivery_fee_waive_reason THEN
    RAISE EXCEPTION 'Order pricing is derived by the server and cannot be changed directly.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_order_pricing_authority ON public.orders;
CREATE TRIGGER trg_guard_order_pricing_authority
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_order_pricing_authority();

-- ---------------------------------------------------------------------------------------------------------------------
-- apply_staff_order_save
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_staff_order_save(
  p_order_id uuid,
  p_acting_user_id uuid,
  p_expected_state jsonb,
  p_order_changes jsonb,
  p_item_ops jsonb,
  p_discount_ops jsonb,
  p_fee_ops jsonb,
  p_logs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_allowed text[] := ARRAY[
    'location_type', 'surface', 'generator_qty', 'start_window', 'end_window', 'event_date', 'event_end_date',
    'pickup_preference', 'overnight_allowed', 'address_id', 'event_address_line2',
    'subtotal_cents', 'generator_fee_cents', 'setup_fee_cents', 'event_essentials_subtotal_cents',
    'travel_fee_cents', 'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles',
    'travel_per_mile_cents', 'travel_is_flat_fee', 'surface_fee_cents', 'same_day_pickup_fee_cents',
    'same_day_weekday_delivery_fee_cents', 'tax_cents', 'deposit_due_cents', 'custom_deposit_cents', 'balance_due_cents',
    'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason',
    'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',
    'generator_fee_waived', 'generator_fee_waive_reason', 'same_day_weekday_delivery_fee_waived',
    'same_day_weekday_delivery_fee_waive_reason', 'parks_acknowledgment_required', 'parks_acknowledgment_county',
    'stripe_payment_method_id', 'stripe_payment_status', 'admin_message', 'require_card_on_file', 'status',
    'customer_view_updated_at', 'waived_fee_amounts_cents'
  ];
  v_key text;
  v_op jsonb;
  v_current jsonb;
  v_sql text;
BEGIN
  IF p_order_id IS NULL OR p_expected_state IS NULL OR p_order_changes IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- The server priced this save against a specific state of the order. If anything that prices it has moved since (another save,
  -- a payment), nothing is written: a stale save never overwrites newer pricing.
  v_current := jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'qty', i.qty, 'unit_price_cents', i.unit_price_cents) ORDER BY i.id) FROM public.order_items i WHERE i.order_id = p_order_id), '[]'::jsonb),
    'discounts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'amount_cents', COALESCE(d.amount_cents, 0), 'percentage', COALESCE(d.percentage, 0)) ORDER BY d.id) FROM public.order_discounts d WHERE d.order_id = p_order_id), '[]'::jsonb),
    'custom_fees', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'amount_cents', COALESCE(f.amount_cents, 0)) ORDER BY f.id) FROM public.order_custom_fees f WHERE f.order_id = p_order_id), '[]'::jsonb)
  );
  IF NOT (to_jsonb(v_order) @> COALESCE(p_expected_state->'columns', '{}'::jsonb))
     -- Containment would treat an expected {} (or a subset) as current; the recorded waived amounts must match exactly.
     OR ((p_expected_state->'columns') ? 'waived_fee_amounts_cents'
         AND to_jsonb(v_order)->'waived_fee_amounts_cents' IS DISTINCT FROM (p_expected_state->'columns')->'waived_fee_amounts_cents')
     OR v_current->'items' IS DISTINCT FROM COALESCE(p_expected_state->'children'->'items', '[]'::jsonb)
     OR v_current->'discounts' IS DISTINCT FROM COALESCE(p_expected_state->'children'->'discounts', '[]'::jsonb)
     OR v_current->'custom_fees' IS DISTINCT FROM COALESCE(p_expected_state->'children'->'custom_fees', '[]'::jsonb) THEN
    RETURN jsonb_build_object('outcome', 'stale');
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_order_changes) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'Order column % is not part of a staff order save', v_key;
    END IF;
  END LOOP;

  FOR v_op IN SELECT * FROM jsonb_array_elements(COALESCE(p_item_ops, '[]'::jsonb)) LOOP
    IF v_op->>'kind' = 'insert' THEN
      INSERT INTO public.order_items (order_id, unit_id, product_id, bundle_id, item_name, qty, unit_price_cents, wet_or_dry, pricing_context, component_snapshot)
      VALUES (
        p_order_id,
        NULLIF(v_op->'payload'->>'unit_id', '')::uuid,
        NULLIF(v_op->'payload'->>'product_id', '')::uuid,
        NULLIF(v_op->'payload'->>'bundle_id', '')::uuid,
        v_op->'payload'->>'item_name',
        (v_op->'payload'->>'qty')::integer,
        (v_op->'payload'->>'unit_price_cents')::integer,
        v_op->'payload'->>'wet_or_dry',
        v_op->'payload'->>'pricing_context',
        CASE WHEN jsonb_typeof(v_op->'payload'->'component_snapshot') = 'object' THEN v_op->'payload'->'component_snapshot' ELSE NULL END
      );
    ELSIF v_op->>'kind' = 'update' THEN
      UPDATE public.order_items
      SET qty = (v_op->'payload'->>'qty')::integer,
          unit_price_cents = CASE WHEN v_op->'payload' ? 'unit_price_cents' THEN (v_op->'payload'->>'unit_price_cents')::integer ELSE unit_price_cents END,
          pricing_context = CASE WHEN v_op->'payload' ? 'pricing_context' THEN v_op->'payload'->>'pricing_context' ELSE pricing_context END
      WHERE id = (v_op->>'itemId')::uuid AND order_id = p_order_id;
    ELSIF v_op->>'kind' = 'delete' THEN
      DELETE FROM public.order_items WHERE id = (v_op->>'itemId')::uuid AND order_id = p_order_id;
    ELSE
      RAISE EXCEPTION 'Unknown item operation';
    END IF;
  END LOOP;

  FOR v_op IN SELECT * FROM jsonb_array_elements(COALESCE(p_discount_ops, '[]'::jsonb)) LOOP
    IF v_op->>'kind' = 'insert' THEN
      INSERT INTO public.order_discounts (order_id, name, amount_cents, percentage)
      VALUES (p_order_id, v_op->>'name', COALESCE((v_op->>'amount_cents')::integer, 0), COALESCE((v_op->>'percentage')::numeric, 0));
    ELSIF v_op->>'kind' = 'update' THEN
      UPDATE public.order_discounts
      SET name = v_op->>'name', amount_cents = COALESCE((v_op->>'amount_cents')::integer, 0), percentage = COALESCE((v_op->>'percentage')::numeric, 0)
      WHERE id = (v_op->>'id')::uuid AND order_id = p_order_id;
    ELSIF v_op->>'kind' = 'delete' THEN
      DELETE FROM public.order_discounts WHERE id = (v_op->>'id')::uuid AND order_id = p_order_id;
    ELSE
      RAISE EXCEPTION 'Unknown discount operation';
    END IF;
  END LOOP;

  FOR v_op IN SELECT * FROM jsonb_array_elements(COALESCE(p_fee_ops, '[]'::jsonb)) LOOP
    IF v_op->>'kind' = 'insert' THEN
      INSERT INTO public.order_custom_fees (order_id, name, amount_cents)
      VALUES (p_order_id, v_op->>'name', COALESCE((v_op->>'amount_cents')::integer, 0));
    ELSIF v_op->>'kind' = 'update' THEN
      UPDATE public.order_custom_fees
      SET name = v_op->>'name', amount_cents = COALESCE((v_op->>'amount_cents')::integer, 0)
      WHERE id = (v_op->>'id')::uuid AND order_id = p_order_id;
    ELSIF v_op->>'kind' = 'delete' THEN
      DELETE FROM public.order_custom_fees WHERE id = (v_op->>'id')::uuid AND order_id = p_order_id;
    ELSE
      RAISE EXCEPTION 'Unknown custom fee operation';
    END IF;
  END LOOP;

  IF p_order_changes <> '{}'::jsonb THEN
    v_sql := 'UPDATE public.orders t SET '
      || (SELECT string_agg(format('%I = r.%I', k, k), ', ') FROM jsonb_object_keys(p_order_changes) k)
      || ' FROM jsonb_populate_record(NULL::public.orders, $1) r WHERE t.id = $2';
    EXECUTE v_sql USING p_order_changes, p_order_id;
  END IF;

  INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value)
  SELECT p_order_id, p_acting_user_id,
         COALESCE(NULLIF(l->>'change_type', ''), 'edit'),
         l->>'field',
         l->>'old',
         l->>'new'
  FROM jsonb_array_elements(COALESCE(p_logs, '[]'::jsonb)) l;

  RETURN jsonb_build_object('outcome', 'saved');
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- create_staff_invoice_order
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_staff_invoice_order(
  p_order jsonb,
  p_items jsonb,
  p_discounts jsonb,
  p_fees jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'customer_id', 'address_id', 'event_address_line2', 'event_date', 'event_end_date', 'start_window', 'end_window',
    'until_end_of_day', 'location_type', 'surface', 'generator_qty', 'pickup_preference',
    'same_day_responsibility_accepted', 'overnight_responsibility_accepted', 'subtotal_cents', 'travel_fee_cents',
    'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',
    'surface_fee_cents', 'same_day_pickup_fee_cents', 'same_day_weekday_delivery_fee_cents', 'generator_fee_cents',
    'setup_fee_cents', 'event_essentials_subtotal_cents', 'tax_cents', 'tax_waived', 'tax_waive_reason', 'travel_fee_waived',
    'travel_fee_waive_reason', 'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason', 'surface_fee_waived',
    'surface_fee_waive_reason', 'generator_fee_waived', 'generator_fee_waive_reason', 'same_day_weekday_delivery_fee_waived',
    'same_day_weekday_delivery_fee_waive_reason', 'deposit_due_cents', 'deposit_required', 'balance_due_cents',
    'custom_deposit_cents', 'tip_cents', 'deposit_paid_cents', 'booking_confirmation_sent', 'cancellation_reason', 'status',
    'card_on_file_consent', 'sms_consent', 'admin_message', 'require_card_on_file', 'waived_fee_amounts_cents'
  ];
  v_key text;
  v_id uuid;
  v_op jsonb;
BEGIN
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'object' THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;
  IF COALESCE(p_order->>'status', '') <> 'draft' THEN
    RAISE EXCEPTION 'A staff invoice order is created as a draft';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_order) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'Order column % is not part of a staff invoice', v_key;
    END IF;
  END LOOP;

  v_id := gen_random_uuid();
  EXECUTE 'INSERT INTO public.orders (id, '
    || (SELECT string_agg(format('%I', k), ', ') FROM jsonb_object_keys(p_order) k)
    || ') SELECT $2, '
    || (SELECT string_agg(format('r.%I', k), ', ') FROM jsonb_object_keys(p_order) k)
    || ' FROM jsonb_populate_record(NULL::public.orders, $1) r'
    USING p_order, v_id;

  FOR v_op IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    INSERT INTO public.order_items (order_id, unit_id, product_id, bundle_id, item_name, qty, unit_price_cents, wet_or_dry, pricing_context, component_snapshot)
    VALUES (
      v_id,
      NULLIF(v_op->>'unit_id', '')::uuid,
      NULLIF(v_op->>'product_id', '')::uuid,
      NULLIF(v_op->>'bundle_id', '')::uuid,
      v_op->>'item_name',
      (v_op->>'qty')::integer,
      (v_op->>'unit_price_cents')::integer,
      v_op->>'wet_or_dry',
      v_op->>'pricing_context',
      CASE WHEN jsonb_typeof(v_op->'component_snapshot') = 'object' THEN v_op->'component_snapshot' ELSE NULL END
    );
  END LOOP;

  INSERT INTO public.order_discounts (order_id, name, amount_cents, percentage)
  SELECT v_id, d->>'name', COALESCE((d->>'amount_cents')::integer, 0), COALESCE((d->>'percentage')::numeric, 0)
  FROM jsonb_array_elements(COALESCE(p_discounts, '[]'::jsonb)) d;

  INSERT INTO public.order_custom_fees (order_id, name, amount_cents)
  SELECT v_id, f->>'name', COALESCE((f->>'amount_cents')::integer, 0)
  FROM jsonb_array_elements(COALESCE(p_fees, '[]'::jsonb)) f;

  RETURN jsonb_build_object('outcome', 'created', 'order_id', v_id);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- No direct browser writes to the financial tables
-- ---------------------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin and master manage order items" ON public.order_items;
DROP POLICY IF EXISTS "Crew create order items" ON public.order_items;
DROP POLICY IF EXISTS "Admin and master manage order discounts" ON public.order_discounts;
DROP POLICY IF EXISTS "Crew create order discounts" ON public.order_discounts;
DROP POLICY IF EXISTS "Admin and master manage order custom fees" ON public.order_custom_fees;
DROP POLICY IF EXISTS "Crew create order custom fees" ON public.order_custom_fees;
DROP POLICY IF EXISTS "Crew create draft orders" ON public.orders;

-- (Staff keep reading these tables through the existing "Crew read ..." SELECT policies, which cover crew, admin and master.)
-- Privileges are the real boundary (a policy cannot restrict columns, and a later policy would silently re-open a write).
REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.order_discounts FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.order_custom_fees FROM authenticated, anon;
REVOKE INSERT, DELETE ON public.orders FROM authenticated, anon;

-- ---------------------------------------------------------------------------------------------------------------------
-- Access: service role only
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.apply_staff_order_save(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_staff_invoice_order(jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_order_pricing_authority() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_staff_order_save(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_staff_invoice_order(jsonb, jsonb, jsonb, jsonb) TO service_role;
