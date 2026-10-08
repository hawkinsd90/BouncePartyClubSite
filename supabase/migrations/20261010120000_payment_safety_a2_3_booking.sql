/*
  # Payment Safety A2.3 — secure public booking creation

  NOT APPLIED BY THIS CHANGE. Review, then apply manually.

  1. booking_setup_proofs
     The credential that lets an anonymous browser start the Stripe card-save (setup) session for the booking request it
     just created. Only the SHA-256 hash of a 256-bit random token is stored. One proof per order, short-lived, single
     use (claim -> create Stripe session -> consume). It is a different credential from a portal or invoice link and lives
     in its own table. No customer-facing policies: the table is service-role only.

  2. create_booking_request(...)
     One transaction that creates the customer (or resolves the existing one by email), contact, canonical address, the
     draft order, its items, consent records and the booking proof. SECURITY DEFINER, executable only by service_role.
     The order's status, payment, refund, approval and alert columns are written here as literal safe values; nothing in
     the payload can set them. Money columns are copied from the payload, which is built only by the create-booking Edge
     Function from server-loaded prices.

  3. upsert_contact_from_checkout is no longer callable by the browser roles (the booking RPC does the contact upsert).

  Nothing in this migration charges anyone. Creating a booking request never creates a PaymentIntent or a payment.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. booking_setup_proofs
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_setup_proofs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  claim_id    uuid,
  claimed_at  timestamptz,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_setup_proofs_order_unique UNIQUE (order_id),
  CONSTRAINT booking_setup_proofs_hash_unique UNIQUE (token_hash)
);

ALTER TABLE public.booking_setup_proofs ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) can read or write proofs.

REVOKE ALL ON public.booking_setup_proofs FROM PUBLIC;
REVOKE ALL ON public.booking_setup_proofs FROM anon;
REVOKE ALL ON public.booking_setup_proofs FROM authenticated;
GRANT ALL ON public.booking_setup_proofs TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. create_booking_request
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_booking_request(
  p_payload          jsonb,
  p_proof_hash       text,
  p_proof_expires_at timestamptz,
  p_caller_user_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact     jsonb := p_payload->'contact';
  v_address     jsonb := p_payload->'address';
  v_order       jsonb := p_payload->'order';
  v_meta        jsonb := COALESCE(p_payload->'request_meta', '{}'::jsonb);
  v_email       text  := lower(btrim(v_contact->>'email'));
  v_customer_id uuid;
  v_customer_uid uuid;
  v_address_id  uuid;
  v_order_id    uuid;
  v_item        jsonb;
  v_consent     jsonb;
BEGIN
  IF p_payload IS NULL OR v_contact IS NULL OR v_address IS NULL OR v_order IS NULL THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;
  IF p_proof_hash IS NULL OR length(p_proof_hash) < 32 OR p_proof_expires_at IS NULL THEN
    RAISE EXCEPTION 'invalid_proof';
  END IF;
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'invalid_contact';
  END IF;
  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;

  -- Customer: resolve by email. The caller never supplies a customer id.
  SELECT id, user_id INTO v_customer_id, v_customer_uid
    FROM customers
   WHERE lower(email) = v_email
   ORDER BY created_at ASC
   LIMIT 1
   FOR UPDATE;

  IF v_customer_id IS NULL THEN
    INSERT INTO customers (first_name, last_name, email, phone, business_name)
    VALUES (v_contact->>'first_name', v_contact->>'last_name', v_email, v_contact->>'phone', NULLIF(v_contact->>'business_name', ''))
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO v_customer_id;

    IF v_customer_id IS NULL THEN
      SELECT id, user_id INTO v_customer_id, v_customer_uid FROM customers WHERE lower(email) = v_email ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
    END IF;
  END IF;

  -- ACCOUNT BOUNDARY. A customer record that belongs to a login (user_id IS NOT NULL) can be used ONLY by that signed-in
  -- user. An anonymous caller, or a different signed-in user, who merely knows the email is rejected here, inside the
  -- transaction and BEFORE any contact / address / order / item / consent / proof write, so a rejection leaves nothing
  -- behind (the contacts row is not touched either). Guest records (user_id IS NULL) keep the existing behaviour.
  IF v_customer_uid IS NOT NULL AND v_customer_uid IS DISTINCT FROM p_caller_user_id THEN
    RAISE EXCEPTION 'account_sign_in_required';
  END IF;

  -- Profile refresh: guest-created record, or the signed-in owner of the record.
  IF v_customer_uid IS NULL OR v_customer_uid = p_caller_user_id THEN
    UPDATE customers
       SET first_name = v_contact->>'first_name',
           last_name  = v_contact->>'last_name',
           phone      = v_contact->>'phone'
     WHERE id = v_customer_id;
  END IF;

  INSERT INTO contacts (first_name, last_name, email, phone, business_name, source, opt_in_email, opt_in_sms)
  VALUES (v_contact->>'first_name', v_contact->>'last_name', v_email, v_contact->>'phone', NULLIF(v_contact->>'business_name', ''), 'booking', true, true)
  ON CONFLICT (email) DO UPDATE SET
    first_name    = EXCLUDED.first_name,
    last_name     = EXCLUDED.last_name,
    phone         = EXCLUDED.phone,
    business_name = EXCLUDED.business_name,
    opt_in_sms    = EXCLUDED.opt_in_sms,
    updated_at    = now();

  -- Canonical address: the server derives the key; an existing row keeps its owner and its coordinates.
  INSERT INTO addresses (customer_id, line1, line2, city, state, zip, lat, lng, address_key)
  VALUES (
    v_customer_id,
    v_address->>'line1',
    NULLIF(v_address->>'line2', ''),
    v_address->>'city',
    v_address->>'state',
    v_address->>'zip',
    (v_address->>'lat')::double precision,
    (v_address->>'lng')::double precision,
    v_address->>'address_key'
  )
  ON CONFLICT (address_key) DO UPDATE SET
    customer_id = COALESCE(addresses.customer_id, EXCLUDED.customer_id),
    lat         = COALESCE(addresses.lat, EXCLUDED.lat),
    lng         = COALESCE(addresses.lng, EXCLUDED.lng)
  RETURNING id INTO v_address_id;

  -- Order: status and every payment / refund / approval / alert column are literals, never payload values.
  INSERT INTO orders (
    customer_id, address_id, status,
    location_type, surface, event_date, event_end_date, pickup_preference, start_window, end_window,
    until_end_of_day, same_day_responsibility_accepted, overnight_responsibility_accepted,
    generator_qty, generator_fee_cents,
    billing_address_line1, billing_address_line2, billing_city, billing_state, billing_zip,
    subtotal_cents, event_essentials_subtotal_cents,
    travel_fee_cents, travel_total_miles, travel_base_radius_miles, travel_chargeable_miles, travel_per_mile_cents, travel_is_flat_fee,
    surface_fee_cents, same_day_pickup_fee_cents, same_day_weekday_delivery_fee_cents, setup_fee_cents, tax_cents,
    tax_waived, tax_waive_reason, travel_fee_waived, travel_fee_waive_reason, same_day_pickup_fee_waived, same_day_pickup_fee_waive_reason,
    tip_cents, deposit_due_cents, deposit_paid_cents, balance_due_cents, balance_paid_cents, total_refunded_cents, custom_deposit_cents,
    stripe_payment_status, payment_lock, customer_approved_at,
    customer_selected_payment_cents, customer_selected_payment_type,
    card_on_file_consent, admin_message, booking_confirmation_sent, cancellation_reason,
    sms_consent_text, sms_consented_at, sms_consent,
    special_details, referral_source, referral_source_detail
  ) VALUES (
    v_customer_id, v_address_id, 'draft',
    v_order->>'location_type', v_order->>'surface', (v_order->>'event_date')::date, (v_order->>'event_end_date')::date,
    v_order->>'pickup_preference', (v_order->>'start_window')::time, (v_order->>'end_window')::time,
    COALESCE((v_order->>'until_end_of_day')::boolean, false),
    COALESCE((v_order->>'same_day_responsibility_accepted')::boolean, false),
    COALESCE((v_order->>'overnight_responsibility_accepted')::boolean, false),
    0, 0,
    v_order->>'billing_address_line1', v_order->>'billing_address_line2', v_order->>'billing_city', v_order->>'billing_state', v_order->>'billing_zip',
    (v_order->>'subtotal_cents')::integer, (v_order->>'event_essentials_subtotal_cents')::integer,
    (v_order->>'travel_fee_cents')::integer, (v_order->>'travel_total_miles')::numeric, (v_order->>'travel_base_radius_miles')::numeric,
    (v_order->>'travel_chargeable_miles')::numeric, (v_order->>'travel_per_mile_cents')::integer, (v_order->>'travel_is_flat_fee')::boolean,
    (v_order->>'surface_fee_cents')::integer, (v_order->>'same_day_pickup_fee_cents')::integer,
    (v_order->>'same_day_weekday_delivery_fee_cents')::integer, (v_order->>'setup_fee_cents')::integer, (v_order->>'tax_cents')::integer,
    false, NULL, false, NULL, false, NULL,
    (v_order->>'tip_cents')::integer, (v_order->>'deposit_due_cents')::integer, 0, (v_order->>'balance_due_cents')::integer, 0, 0, NULL,
    'unpaid', false, NULL,
    (v_order->>'customer_selected_payment_cents')::integer, v_order->>'customer_selected_payment_type',
    true, NULL, false, NULL,
    v_order->>'sms_consent_text', now(), true,
    NULLIF(v_order->>'special_details', ''), NULLIF(v_order->>'referral_source', ''), NULLIF(v_order->>'referral_source_detail', '')
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    INSERT INTO order_items (order_id, unit_id, wet_or_dry, unit_price_cents, qty, product_id, bundle_id, item_name, pricing_context, component_snapshot)
    VALUES (
      v_order_id,
      (v_item->>'unit_id')::uuid,
      v_item->>'wet_or_dry',
      (v_item->>'unit_price_cents')::integer,
      (v_item->>'qty')::integer,
      (v_item->>'product_id')::uuid,
      (v_item->>'bundle_id')::uuid,
      v_item->>'item_name',
      v_item->>'pricing_context',
      CASE WHEN jsonb_typeof(v_item->'component_snapshot') = 'object' THEN v_item->'component_snapshot' ELSE NULL END
    );
  END LOOP;

  IF jsonb_typeof(p_payload->'consents') = 'array' THEN
    FOR v_consent IN SELECT * FROM jsonb_array_elements(p_payload->'consents') LOOP
      INSERT INTO consent_records (order_id, customer_id, consent_type, consented, consent_text, consent_version, ip_address, user_agent)
      VALUES (
        v_order_id, v_customer_id,
        v_consent->>'consent_type', true, v_consent->>'consent_text', COALESCE(v_consent->>'consent_version', '1.0'),
        NULLIF(left(v_meta->>'ip_address', 100), ''), NULLIF(left(v_meta->>'user_agent', 500), '')
      );
    END LOOP;
  END IF;

  INSERT INTO booking_setup_proofs (order_id, token_hash, expires_at)
  VALUES (v_order_id, p_proof_hash, p_proof_expires_at);

  RETURN jsonb_build_object('order_id', v_order_id, 'customer_id', v_customer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking_request(jsonb, text, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_booking_request(jsonb, text, timestamptz, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_booking_request(jsonb, text, timestamptz, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_request(jsonb, text, timestamptz, uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. The browser no longer upserts contacts directly.
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.upsert_contact_from_checkout(text, text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_contact_from_checkout(text, text, text, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_contact_from_checkout(text, text, text, text, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_contact_from_checkout(text, text, text, text, text, boolean) TO service_role;
