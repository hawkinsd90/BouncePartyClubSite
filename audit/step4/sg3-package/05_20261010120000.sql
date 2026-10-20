-- BPC-DEV-EXECUTOR step 5/28; version 20261010120000; file 20261010120000_secure_public_booking_creation.sql; sha256_lf a75b9d371585201ba000d5580a1182686998f669295f96105bd6e0fdef4f521e; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261010120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261010120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261010110000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261010120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 4 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
  SELECT count(*), encode(sha256(convert_to(coalesce(string_agg(version, E'\n' ORDER BY version), ''), 'UTF8')), 'hex') INTO v_n, v_h FROM supabase_migrations.schema_migrations WHERE version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]);
  IF v_n <> 305 OR v_h <> '76025b5b681008ec5b0239c57be1f54fd7bbed3a3f70fa1384698afcc6476c59' THEN RAISE EXCEPTION 'BPC-EXECUTOR: ledger outside the package differs from the approved export (% rows, hash %)', v_n, v_h; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: schema containment is not in force'; END IF;

  old_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT jsonb_object_agg(k, d||'/'||n), md5(string_agg(k||':'||d||':'||n, ',' ORDER BY k)) INTO fp, fp_all FROM (SELECT k, md5(string_agg(v, E'\n' ORDER BY v)) AS d, count(*) AS n FROM (
SELECT 'fn' AS k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||p.prokind::text||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||p.proleakproof||'|'||pg_get_userbyid(p.proowner)||'|'||p.prorettype::regtype::text||'|'||coalesce(p.proconfig::text,'')||'|'||md5(p.prosrc)||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '') AS v
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'rel', n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity||'|'||c.relpersistence::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public') AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
UNION ALL
SELECT 'col', c.relname||'.'||a.attname||'|'||format_type(a.atttypid, a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin, d.adrelid),'')||'|'||a.attidentity::text||'|'||a.attgenerated::text||'|'||
  coalesce((SELECT string_agg(x.privilege_type||':'||CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, ',' ORDER BY x.privilege_type, CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END) FROM aclexplode(a.attacl) x), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'con', conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
UNION ALL
SELECT 'idx', schemaname||'.'||tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'trg', tgrelid::regclass::text||'|'||tgname||'|'||tgenabled::text||'|'||pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND (tgrelid::regclass::text LIKE 'public.%' OR tgrelid::regclass::text IN ('auth.users','storage.objects','storage.buckets') OR tgrelid::regclass::text NOT LIKE '%.%')
UNION ALL
SELECT 'pol', schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') FROM pg_policies WHERE schemaname IN ('public','storage')
UNION ALL
SELECT 'nsp', nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(coalesce(nspacl, acldefault('n', nspowner))) a), '')
FROM pg_namespace WHERE nspname IN ('public','storage')
UNION ALL
SELECT 'dacl', pg_get_userbyid(defaclrole)||'|'||coalesce(defaclnamespace::regnamespace::text,'global')||'|'||defaclobjtype::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(defaclacl) a), '') FROM pg_default_acl WHERE defaclnamespace = 0 OR defaclnamespace = 'public'::regnamespace
UNION ALL
SELECT 'bkt', id||'|'||public||'|'||coalesce(file_size_limit::text,'null')||'|'||coalesce(allowed_mime_types::text,'null') FROM storage.buckets
UNION ALL
SELECT 'pub', pubname||'|'||schemaname||'.'||tablename FROM pg_publication_tables
UNION ALL
SELECT 'ext', extname||'|'||extnamespace::regnamespace::text FROM pg_extension WHERE extname <> 'supabase_vault'
) f GROUP BY k ORDER BY k) z;
  PERFORM set_config('search_path', old_sp, true);

  IF fp_all IS DISTINCT FROM '709544044bb6a57794cb7d8ef716eee7' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261010120000 (expected 709544044bb6a57794cb7d8ef716eee7, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261010120000_secure_public_booking_creation.sql
/*
  # Secure public booking creation

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
;
DO $bpcpost$
DECLARE fp jsonb; fp_all text; old_sp text;
BEGIN

  old_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT jsonb_object_agg(k, d||'/'||n), md5(string_agg(k||':'||d||':'||n, ',' ORDER BY k)) INTO fp, fp_all FROM (SELECT k, md5(string_agg(v, E'\n' ORDER BY v)) AS d, count(*) AS n FROM (
SELECT 'fn' AS k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||p.prokind::text||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||p.proleakproof||'|'||pg_get_userbyid(p.proowner)||'|'||p.prorettype::regtype::text||'|'||coalesce(p.proconfig::text,'')||'|'||md5(p.prosrc)||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '') AS v
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'rel', n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity||'|'||c.relpersistence::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public') AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
UNION ALL
SELECT 'col', c.relname||'.'||a.attname||'|'||format_type(a.atttypid, a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin, d.adrelid),'')||'|'||a.attidentity::text||'|'||a.attgenerated::text||'|'||
  coalesce((SELECT string_agg(x.privilege_type||':'||CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, ',' ORDER BY x.privilege_type, CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END) FROM aclexplode(a.attacl) x), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'con', conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
UNION ALL
SELECT 'idx', schemaname||'.'||tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'trg', tgrelid::regclass::text||'|'||tgname||'|'||tgenabled::text||'|'||pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND (tgrelid::regclass::text LIKE 'public.%' OR tgrelid::regclass::text IN ('auth.users','storage.objects','storage.buckets') OR tgrelid::regclass::text NOT LIKE '%.%')
UNION ALL
SELECT 'pol', schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') FROM pg_policies WHERE schemaname IN ('public','storage')
UNION ALL
SELECT 'nsp', nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(coalesce(nspacl, acldefault('n', nspowner))) a), '')
FROM pg_namespace WHERE nspname IN ('public','storage')
UNION ALL
SELECT 'dacl', pg_get_userbyid(defaclrole)||'|'||coalesce(defaclnamespace::regnamespace::text,'global')||'|'||defaclobjtype::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(defaclacl) a), '') FROM pg_default_acl WHERE defaclnamespace = 0 OR defaclnamespace = 'public'::regnamespace
UNION ALL
SELECT 'bkt', id||'|'||public||'|'||coalesce(file_size_limit::text,'null')||'|'||coalesce(allowed_mime_types::text,'null') FROM storage.buckets
UNION ALL
SELECT 'pub', pubname||'|'||schemaname||'.'||tablename FROM pg_publication_tables
UNION ALL
SELECT 'ext', extname||'|'||extnamespace::regnamespace::text FROM pg_extension WHERE extname <> 'supabase_vault'
) f GROUP BY k ORDER BY k) z;
  PERFORM set_config('search_path', old_sp, true);

  IF fp_all IS DISTINCT FROM 'a52956b50336793a894567f997cd4d1b' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261010120000 (expected a52956b50336793a894567f997cd4d1b, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261010120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261010120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261010120000', 'secure_public_booking_creation', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=5/28; version=20261010120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=a75b9d371585201ba000d5580a1182686998f669295f96105bd6e0fdef4f521e', $bpcsql$/*
  # Secure public booking creation

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
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 310 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261010120000'; END IF;
END $bpcend$;
