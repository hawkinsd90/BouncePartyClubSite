-- BPC-DEV-EXECUTOR step 20/28; version 20261022120000; file 20261022120000_refund_safety_and_financial_write_authority.sql; sha256_lf 05fec2307df354198cbeea4a04f133e898263a0ec208e3fd616b5e4717f58229; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261022120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261022120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261021120000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261022120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 19 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
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

  IF fp_all IS DISTINCT FROM 'a0b1f0c66983e1d2f23b68f788c306ea' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261022120000 (expected a0b1f0c66983e1d2f23b68f788c306ea, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261022120000_refund_safety_and_financial_write_authority.sql
/*
  # Refund safety, recovery and financial write authority (Step 3C-A)

  ## Problems (verified in the Step 3C audit)
  - A refund request could create two real Stripe refunds (no idempotency key, a read-then-write reservation with no lock), and a
    refund created at Stripe could be lost before any local row existed.
  - `order_refunds` had no uniqueness, no amount bound and no link to the payment refunded; the webhook recorded the cumulative
    `charge.amount_refunded` against `refunds.data[0]` and resolved the original payment with a lookup that a refund row itself
    matched, so a second partial refund was silently dropped. Refund status never left `pending`.
  - A refund existed in up to three stores (`order_refunds`, a negative `payments` row, `orders.total_refunded_cents`) written by
    different code with different rules.
  - An authenticated Admin / Master could INSERT or UPDATE `payments` rows and INSERT / UPDATE / DELETE `order_refunds` rows from a
    browser session, and could write `orders.stripe_payment_status` / `payment_lock`.
  - Rejecting an order cancelled pending payment rows from the browser.

  ## Boundary
  `order_refunds` owns the identity and status of each refund event. A refund request is reserved ATOMICALLY (under the order row
  lock) as one or more `pending` rows, BEFORE any Stripe call; each row carries a stable Stripe idempotency key. The Edge Function
  then performs the provider call(s) and records the result. A retry with the same operation key finds the same rows and never
  creates a second refund; a row whose provider result is unknown stays `pending` and keeps its reservation until the provider says
  otherwise. Three service-role functions do all writes:

    reserve_refund_operation        reserve (or re-read) the rows of one refund request
    mark_refund_provider_attempt    durable "a provider request may have started"
    record_refund_provider_result   record what Stripe said for a row we created
    apply_provider_refund_event     record what Stripe says about ANY refund (webhook): ours, or one made in the Stripe dashboard

  A row becomes `succeeded` exactly once; that single transition adds the amount to `orders.total_refunded_cents` and writes one
  negative `payments` row (unique per Stripe refund). A refund that later fails reverses both. Pending and failed refunds are never
  counted as cash returned and a failed refund releases its reservation.

  ## Historical rows
  Nothing is rewritten or deleted. Rows that exist today have `ledger_version` NULL ("legacy"): they keep counting toward the
  refundable-amount reservation (so the amount that may still be refunded can only be understated, never overstated), their provider
  identity is looked up for status updates, but they never change `total_refunded_cents` or the payments ledger, and no uniqueness is
  enforced between them. New rows carry `ledger_version` 2 and the new constraints apply to them.

  ## Write authority
  `authenticated` and `anon` can no longer INSERT / UPDATE / DELETE `payments` or `order_refunds` (staff keep SELECT). The pricing
  authority trigger now also refuses a direct change of `orders.stripe_payment_status` and `orders.payment_lock`. When an order is
  cancelled, payment rows that never reached the provider are cancelled by the database; a payment that does reach the provider later
  is still applied (the money is real) and leaves a review note on the order.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- order_refunds: identity, linkage, lifecycle
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.order_refunds
  ADD COLUMN IF NOT EXISTS operation_key text,
  ADD COLUMN IF NOT EXISTS operation_index integer,
  ADD COLUMN IF NOT EXISTS request_amount_cents integer,
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id),
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS provider_idempotency_key text,
  ADD COLUMN IF NOT EXISTS provider_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS total_applied boolean,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ledger_version smallint;

-- Added WITHOUT a default so existing rows stay NULL ("legacy"); only rows created from now on are version 2.
ALTER TABLE public.order_refunds ALTER COLUMN ledger_version SET DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_refunds_amount_positive' AND conrelid = 'public.order_refunds'::regclass) THEN
    -- NOT VALID: enforced for every new and changed row, without failing on (or rewriting) rows that already exist.
    ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_amount_positive CHECK (amount_cents > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_refunds_operation_shape' AND conrelid = 'public.order_refunds'::regclass) THEN
    ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_operation_shape
      CHECK (operation_key IS NULL OR (operation_index IS NOT NULL AND request_amount_cents IS NOT NULL AND provider_idempotency_key IS NOT NULL)) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS order_refunds_operation_unique
  ON public.order_refunds (operation_key, operation_index) WHERE operation_key IS NOT NULL;
-- One row per Stripe refund for every row written by this ledger (legacy rows are exempt: they may already contain duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS order_refunds_provider_refund_unique
  ON public.order_refunds (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL AND ledger_version = 2;
CREATE INDEX IF NOT EXISTS idx_order_refunds_payment_id ON public.order_refunds (payment_id);
CREATE INDEX IF NOT EXISTS idx_order_refunds_stripe_refund_id ON public.order_refunds (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL;

-- One negative ledger row per Stripe refund.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS stripe_refund_id text;
CREATE UNIQUE INDEX IF NOT EXISTS payments_refund_event_unique ON public.payments (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- Provider status -> local status
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._refund_status_from_provider(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(p_status, ''))
    WHEN 'succeeded' THEN 'succeeded'
    WHEN 'failed' THEN 'failed'
    WHEN 'canceled' THEN 'failed'
    WHEN 'cancelled' THEN 'failed'
    ELSE 'pending'
  END
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- _apply_refund_transition: the ONLY place a refund row changes status (and the only writer of the totals derived from it)
-- ---------------------------------------------------------------------------------------------------------------------
-- Callers hold the order row lock. pending -> succeeded applies the refund once; succeeded -> failed reverses it; failed is final.
CREATE OR REPLACE FUNCTION public._apply_refund_transition(
  p_refund_id uuid,
  p_new_status text,
  p_failure_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.order_refunds%ROWTYPE;
  orig public.payments%ROWTYPE;
  v_payment_row uuid;
  v_applied_now boolean := false;
BEGIN
  IF p_new_status NOT IN ('pending', 'succeeded', 'failed') THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  SELECT * INTO r FROM public.order_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF r.status = p_new_status THEN
    RETURN jsonb_build_object('outcome', 'unchanged', 'status', r.status, 'refund_id', r.id, 'order_id', r.order_id, 'applied_now', false);
  END IF;

  IF r.status = 'failed' THEN
    -- A refund that failed does not come back: Stripe does not move a failed refund to succeeded. Leave a note for a person.
    INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value, notes)
    VALUES (r.order_id, NULL, 'payment_error', 'order_refunds.status', r.status, p_new_status,
            'REFUND_EVENT_AFTER_FAILURE: refund row ' || r.id::text || ' is failed but the provider now reports ' || p_new_status || '; review it in Stripe.');
    RETURN jsonb_build_object('outcome', 'invalid_transition', 'status', r.status, 'refund_id', r.id, 'order_id', r.order_id, 'applied_now', false);
  END IF;

  IF p_new_status = 'pending' THEN
    -- succeeded -> pending is not a provider transition.
    RETURN jsonb_build_object('outcome', 'invalid_transition', 'status', r.status, 'refund_id', r.id, 'order_id', r.order_id, 'applied_now', false);
  END IF;

  IF p_new_status = 'succeeded' THEN
    UPDATE public.order_refunds SET status = 'succeeded', failure_reason = NULL, updated_at = now() WHERE id = r.id;

    -- Only rows of this ledger change the order-level total and the payments ledger; a legacy row's history is unknown.
    IF r.ledger_version = 2 AND r.total_applied IS NOT TRUE AND r.order_id IS NOT NULL THEN
      UPDATE public.orders SET total_refunded_cents = COALESCE(total_refunded_cents, 0) + r.amount_cents WHERE id = r.order_id;
      UPDATE public.order_refunds SET total_applied = true WHERE id = r.id;
      v_applied_now := true;

      IF r.payment_id IS NOT NULL AND r.stripe_refund_id IS NOT NULL THEN
        SELECT * INTO orig FROM public.payments WHERE id = r.payment_id;
        IF FOUND THEN
          INSERT INTO public.payments (
            order_id, stripe_payment_intent_id, amount_cents, type, status, paid_at, payment_method, payment_brand,
            refunded_payment_id, stripe_refund_id, stripe_fee_amount, stripe_net_amount, currency
          ) VALUES (
            r.order_id, orig.stripe_payment_intent_id, -r.amount_cents, 'incidental', 'succeeded', now(), orig.payment_method, orig.payment_brand,
            orig.id, r.stripe_refund_id, 0, -r.amount_cents, 'usd'
          )
          ON CONFLICT (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL DO NOTHING
          RETURNING id INTO v_payment_row;
        END IF;
      END IF;

      INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value, notes)
      VALUES (r.order_id, r.refunded_by, 'refund', 'total_refunded_cents', NULL, r.amount_cents::text,
              'Refund ' || COALESCE(r.stripe_refund_id, r.id::text) || ' succeeded for ' || r.amount_cents::text || ' cents');
    END IF;

    RETURN jsonb_build_object('outcome', 'succeeded', 'status', 'succeeded', 'refund_id', r.id, 'order_id', r.order_id, 'applied_now', v_applied_now,
                              'ledger_payment_id', v_payment_row, 'payment_id', r.payment_id);
  END IF;

  -- p_new_status = 'failed'
  UPDATE public.order_refunds
  SET status = 'failed', failure_reason = COALESCE(p_failure_reason, failure_reason), updated_at = now(), total_applied = CASE WHEN total_applied IS TRUE THEN false ELSE total_applied END
  WHERE id = r.id;

  IF r.status = 'succeeded' AND r.total_applied IS TRUE AND r.order_id IS NOT NULL THEN
    UPDATE public.orders SET total_refunded_cents = GREATEST(0, COALESCE(total_refunded_cents, 0) - r.amount_cents) WHERE id = r.order_id;
    UPDATE public.payments SET status = 'failed', failed_at = now() WHERE stripe_refund_id = r.stripe_refund_id AND r.stripe_refund_id IS NOT NULL;
    INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value, notes)
    VALUES (r.order_id, NULL, 'payment_error', 'total_refunded_cents', r.amount_cents::text, '0',
            'REFUND_REVERSED: refund ' || COALESCE(r.stripe_refund_id, r.id::text) || ' was reported failed after it had succeeded; it no longer counts as returned.');
  END IF;

  RETURN jsonb_build_object('outcome', 'failed', 'status', 'failed', 'refund_id', r.id, 'order_id', r.order_id, 'applied_now', false, 'payment_id', r.payment_id);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- reserve_refund_operation
-- ---------------------------------------------------------------------------------------------------------------------
-- One refund request = one operation key. Under the order row lock it either returns the rows it already reserved (a retry or a
-- double submit) or reserves new `pending` rows, allocated newest payment first, against what can still be refunded.
CREATE OR REPLACE FUNCTION public.reserve_refund_operation(
  p_order_id uuid,
  p_operation_key text,
  p_amount_cents integer,
  p_reason text,
  p_actor uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_existing public.order_refunds%ROWTYPE;
  v_captured bigint;
  v_reserved bigint;
  v_max bigint;
  v_remaining integer;
  v_idx integer := 0;
  v_take integer;
  v_pay record;
  v_linked bigint;
  v_avail bigint;
  v_rows jsonb;
  v_unsettled record;
  v_pay_count integer;
BEGIN
  IF p_order_id IS NULL OR p_operation_key IS NULL OR p_operation_key !~ '^[A-Za-z0-9_-]{8,64}$'
     OR p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > 99999999 THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'order_not_found');
  END IF;

  -- The same key again: same rows, nothing new. A key reused for different parameters is refused.
  SELECT * INTO v_existing FROM public.order_refunds WHERE operation_key = p_operation_key ORDER BY operation_index LIMIT 1;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id OR v_existing.request_amount_cents IS DISTINCT FROM p_amount_cents THEN
      RETURN jsonb_build_object('outcome', 'key_conflict');
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', id, 'operation_index', operation_index, 'payment_id', payment_id, 'stripe_payment_intent_id', stripe_payment_intent_id,
             'amount_cents', amount_cents, 'status', status, 'stripe_refund_id', stripe_refund_id,
             'provider_idempotency_key', provider_idempotency_key, 'provider_attempted_at', provider_attempted_at,
             'failure_reason', failure_reason, 'created_at', created_at) ORDER BY operation_index), '[]'::jsonb)
      INTO v_rows FROM public.order_refunds WHERE operation_key = p_operation_key;
    RETURN jsonb_build_object('outcome', 'existing', 'refunds', v_rows);
  END IF;

  -- A refund request that was started and never finished is not silently replaced by another one. Requests that never reached Stripe and
  -- were left for a quarter of an hour are released (nothing was sent, so nothing can be owed); any other request that has no Stripe refund
  -- yet blocks a NEW request on the order, and the answer names it so the caller can send its operation key again and settle it.
  UPDATE public.order_refunds o
  SET status = 'failed', failure_reason = 'abandoned before any provider request was made', updated_at = now()
  WHERE o.order_id = p_order_id AND o.operation_key IS NOT NULL AND o.operation_key <> p_operation_key
    AND o.status = 'pending' AND o.stripe_refund_id IS NULL
    AND o.created_at < now() - interval '15 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.order_refunds x
      WHERE x.operation_key = o.operation_key AND (x.stripe_refund_id IS NOT NULL OR x.provider_attempted_at IS NOT NULL OR x.status = 'succeeded')
    );

  SELECT o.operation_key, o.request_amount_cents INTO v_unsettled
  FROM public.order_refunds o
  WHERE o.order_id = p_order_id AND o.operation_key IS NOT NULL AND o.operation_key <> p_operation_key
    AND o.status = 'pending' AND o.stripe_refund_id IS NULL
  ORDER BY o.created_at LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('outcome', 'unsettled_operation', 'operation_key', v_unsettled.operation_key, 'request_amount_cents', v_unsettled.request_amount_cents);
  END IF;

  -- What can be refunded: the card payments (positive, with a PaymentIntent) minus every pending or succeeded refund on the order,
  -- including rows from before this ledger existed. Negative payment rows are not consulted (they are a copy of a refund).
  SELECT COALESCE(SUM(p.amount_cents), 0) INTO v_captured
  FROM public.payments p
  WHERE p.order_id = p_order_id AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL
    AND p.stripe_payment_intent_id IS NOT NULL;
  IF v_captured <= 0 THEN
    RETURN jsonb_build_object('outcome', 'no_refundable_payment');
  END IF;

  -- Refunds recorded before refunds were linked to a payment cannot be attributed to one. With a single card payment that is not a
  -- question (they all belong to it); with several it is, and nothing is guessed: the request is refused for a person to handle.
  SELECT count(*) INTO v_pay_count
  FROM public.payments p
  WHERE p.order_id = p_order_id AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL AND p.stripe_payment_intent_id IS NOT NULL;
  IF v_pay_count > 1 AND EXISTS (
    SELECT 1 FROM public.order_refunds WHERE order_id = p_order_id AND ledger_version IS NULL AND payment_id IS NULL AND status IN ('pending', 'succeeded')
  ) THEN
    RETURN jsonb_build_object('outcome', 'allocation_ambiguous');
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_reserved
  FROM public.order_refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded');
  v_max := GREATEST(0, v_captured - v_reserved);
  IF p_amount_cents > v_max THEN
    RETURN jsonb_build_object('outcome', 'exceeds_refundable', 'max_refundable_cents', v_max);
  END IF;

  v_remaining := p_amount_cents;
  FOR v_pay IN
    SELECT p.id, p.amount_cents, p.stripe_payment_intent_id
    FROM public.payments p
    WHERE p.order_id = p_order_id AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL
      AND p.stripe_payment_intent_id IS NOT NULL
    ORDER BY p.created_at DESC, p.id
  LOOP
    EXIT WHEN v_remaining <= 0;
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_linked
    FROM public.order_refunds WHERE payment_id = v_pay.id AND status IN ('pending', 'succeeded');
    v_avail := GREATEST(0, v_pay.amount_cents - v_linked);
    v_take := LEAST(v_remaining, v_avail);
    IF v_take > 0 THEN
      INSERT INTO public.order_refunds (
        order_id, amount_cents, reason, status, refunded_by, operation_key, operation_index, request_amount_cents,
        payment_id, stripe_payment_intent_id, provider_idempotency_key, source, updated_at
      ) VALUES (
        p_order_id, v_take, COALESCE(NULLIF(left(p_reason, 500), ''), 'Admin refund'), 'pending', p_actor, p_operation_key, v_idx, p_amount_cents,
        v_pay.id, v_pay.stripe_payment_intent_id, 'refund:' || p_operation_key || ':' || v_idx::text, 'admin', now()
      );
      v_idx := v_idx + 1;
      v_remaining := v_remaining - v_take;
    END IF;
  END LOOP;

  IF v_remaining > 0 THEN
    -- The legacy rows hold part of the reservation that cannot be attributed to a payment; nothing is reserved.
    RAISE EXCEPTION 'refund_allocation_incomplete' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'operation_index', operation_index, 'payment_id', payment_id, 'stripe_payment_intent_id', stripe_payment_intent_id,
           'amount_cents', amount_cents, 'status', status, 'stripe_refund_id', stripe_refund_id,
           'provider_idempotency_key', provider_idempotency_key, 'provider_attempted_at', provider_attempted_at,
           'failure_reason', failure_reason, 'created_at', created_at) ORDER BY operation_index), '[]'::jsonb)
    INTO v_rows FROM public.order_refunds WHERE operation_key = p_operation_key;
  RETURN jsonb_build_object('outcome', 'reserved', 'refunds', v_rows);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- mark_refund_provider_attempt
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_refund_provider_attempt(p_refund_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_refund_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.order_refunds
  SET provider_attempted_at = COALESCE(provider_attempted_at, now()), updated_at = now()
  WHERE id = p_refund_id AND status = 'pending' AND stripe_refund_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- record_refund_provider_result: what Stripe said about a refund row WE created
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_refund_provider_result(
  p_refund_id uuid,
  p_stripe_refund_id text,
  p_stripe_status text,
  p_failure_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.order_refunds%ROWTYPE;
  v_new text;
BEGIN
  IF p_refund_id IS NULL OR p_stripe_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  SELECT * INTO r FROM public.order_refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF r.order_id IS NOT NULL THEN
    PERFORM 1 FROM public.orders WHERE id = r.order_id FOR UPDATE;
  END IF;
  SELECT * INTO r FROM public.order_refunds WHERE id = p_refund_id FOR UPDATE;

  IF p_stripe_refund_id IS NOT NULL THEN
    IF r.stripe_refund_id IS NOT NULL AND r.stripe_refund_id <> p_stripe_refund_id THEN
      RETURN jsonb_build_object('outcome', 'provider_mismatch');
    END IF;
    IF r.stripe_refund_id IS NULL THEN
      BEGIN
        UPDATE public.order_refunds SET stripe_refund_id = p_stripe_refund_id, updated_at = now() WHERE id = r.id;
      EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('outcome', 'provider_conflict');
      END;
    END IF;
  END IF;

  v_new := public._refund_status_from_provider(p_stripe_status);
  RETURN public._apply_refund_transition(r.id, v_new, p_failure_reason);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- apply_provider_refund_event: the webhook's single entry point for any refund (ours or one made in the Stripe dashboard)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_provider_refund_event(
  p_stripe_refund_id text,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_stripe_status text,
  p_failure_reason text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_bpc_refund_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.order_refunds%ROWTYPE;
  orig public.payments%ROWTYPE;
  v_new text;
  v_id uuid;
  v_result jsonb;
BEGIN
  IF p_stripe_refund_id IS NULL OR p_stripe_refund_id = '' OR p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_stripe_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;
  v_new := public._refund_status_from_provider(p_stripe_status);

  -- Our own refund carries the id of its row in its metadata (set when we created it), so a webhook that arrives before the
  -- initiating request has recorded the Stripe id still finds the right row.
  r := NULL;
  IF p_bpc_refund_id IS NOT NULL AND p_bpc_refund_id ~ '^[0-9a-fA-F-]{36}$' THEN
    SELECT * INTO r FROM public.order_refunds WHERE id = p_bpc_refund_id::uuid;
  END IF;
  IF r.id IS NULL THEN
    SELECT * INTO r FROM public.order_refunds WHERE stripe_refund_id = p_stripe_refund_id ORDER BY (ledger_version = 2) DESC NULLS LAST, created_at LIMIT 1;
  END IF;

  IF r.id IS NOT NULL THEN
    IF r.order_id IS NOT NULL THEN
      PERFORM 1 FROM public.orders WHERE id = r.order_id FOR UPDATE;
    END IF;
    SELECT * INTO r FROM public.order_refunds WHERE id = r.id FOR UPDATE;

    IF r.stripe_refund_id IS NOT NULL AND r.stripe_refund_id <> p_stripe_refund_id THEN
      RETURN jsonb_build_object('outcome', 'provider_mismatch', 'refund_id', r.id);
    END IF;
    -- A legacy webhook row recorded the CUMULATIVE amount of the charge; an individual event cannot be compared with it.
    IF r.amount_cents <> p_amount_cents THEN
      INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value, notes)
      VALUES (r.order_id, NULL, 'payment_error', 'order_refunds.amount_cents', r.amount_cents::text, p_amount_cents::text,
              'REFUND_AMOUNT_MISMATCH: refund row ' || r.id::text || ' (' || COALESCE(r.stripe_refund_id, 'no provider id yet') || ') differs from the provider event; nothing was changed.');
      RETURN jsonb_build_object('outcome', 'amount_mismatch', 'refund_id', r.id);
    END IF;
    IF r.stripe_refund_id IS NULL THEN
      BEGIN
        UPDATE public.order_refunds SET stripe_refund_id = p_stripe_refund_id, stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, p_payment_intent_id), updated_at = now() WHERE id = r.id;
      EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('outcome', 'provider_conflict', 'refund_id', r.id);
      END;
    END IF;
    RETURN public._apply_refund_transition(r.id, v_new, p_failure_reason);
  END IF;

  -- Not one of ours: a refund made outside the application. It needs the successful positive payment it refunds.
  SELECT * INTO orig FROM public.payments
  WHERE stripe_payment_intent_id = p_payment_intent_id AND p_payment_intent_id IS NOT NULL
    AND status = 'succeeded' AND amount_cents > 0 AND refunded_payment_id IS NULL
  ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_original_payment');
  END IF;

  PERFORM 1 FROM public.orders WHERE id = orig.order_id FOR UPDATE;
  -- Re-check under the lock: another delivery of the same event may have just recorded it.
  SELECT * INTO r FROM public.order_refunds WHERE stripe_refund_id = p_stripe_refund_id LIMIT 1;
  IF r.id IS NOT NULL THEN
    RETURN public._apply_refund_transition(r.id, v_new, p_failure_reason);
  END IF;

  BEGIN
    INSERT INTO public.order_refunds (
      order_id, amount_cents, reason, status, refunded_by, stripe_refund_id, payment_id, stripe_payment_intent_id, source, updated_at
    ) VALUES (
      orig.order_id, p_amount_cents, COALESCE(NULLIF(left(p_reason, 500), ''), 'Refund made outside the application'), 'pending', NULL,
      p_stripe_refund_id, orig.id, p_payment_intent_id, 'external', now()
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.order_refunds WHERE stripe_refund_id = p_stripe_refund_id LIMIT 1;
  END;

  v_result := public._apply_refund_transition(v_id, v_new, p_failure_reason);
  RETURN v_result || jsonb_build_object('external', true);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Cancelling an order cancels the payment attempts that never reached the provider
-- ---------------------------------------------------------------------------------------------------------------------
-- A payment row that already has a provider id, or whose provider request may have started, is left alone: only the provider can
-- say whether the money moved (the operation functions finalize it truthfully either way).
CREATE OR REPLACE FUNCTION public.cancel_unattempted_payments_on_order_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'void') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.payments
    SET status = 'cancelled', claim_id = NULL, claimed_at = NULL
    WHERE order_id = NEW.id
      AND status = 'pending'
      AND COALESCE(order_financials_applied, false) = false
      AND stripe_payment_intent_id IS NULL
      AND stripe_checkout_session_id IS NULL
      AND provider_attempted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_unattempted_payments_on_order_close ON public.orders;
CREATE TRIGGER trg_cancel_unattempted_payments_on_order_close
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.cancel_unattempted_payments_on_order_close();

-- A payment that reaches the provider after the order was closed is still applied (the money is real), and says so.
CREATE OR REPLACE FUNCTION public.note_payment_applied_to_closed_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.orders WHERE id = NEW.order_id;
  IF v_status IN ('cancelled', 'void') THEN
    INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value, notes)
    VALUES (NEW.order_id, NULL, 'payment_error', 'payments.order_financials_applied', 'false', 'true',
            'PAYMENT_APPLIED_TO_CLOSED_ORDER: payment ' || NEW.id::text || ' for ' || NEW.amount_cents::text || ' cents reached the provider after the order was ' || v_status || '. The order stays ' || v_status || '; whether to refund it is a decision for a person.');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_note_payment_applied_to_closed_order ON public.payments;
CREATE TRIGGER trg_note_payment_applied_to_closed_order
  AFTER UPDATE OF order_financials_applied ON public.payments
  FOR EACH ROW
  WHEN (COALESCE(OLD.order_financials_applied, false) = false AND NEW.order_financials_applied = true)
  EXECUTE FUNCTION public.note_payment_applied_to_closed_order();

-- ---------------------------------------------------------------------------------------------------------------------
-- Write authority: money tables are written by the server functions only
-- ---------------------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Admins can update payments" ON public.payments;
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated, anon;

DROP POLICY IF EXISTS "Admins can manage refunds" ON public.order_refunds;
DROP POLICY IF EXISTS "Admins can view refunds" ON public.order_refunds;
CREATE POLICY "Admins can view refunds" ON public.order_refunds FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
REVOKE ALL ON public.order_refunds FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.order_refunds FROM authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The order guard also covers the payment state flags
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
     OR NEW.same_day_weekday_delivery_fee_waive_reason IS DISTINCT FROM OLD.same_day_weekday_delivery_fee_waive_reason
     -- Whether the order counts as paid is written by the payment functions (a card charge, or the server-side zero-deposit waiver).
     OR NEW.stripe_payment_status IS DISTINCT FROM OLD.stripe_payment_status
     OR NEW.payment_lock IS DISTINCT FROM OLD.payment_lock THEN
    RAISE EXCEPTION 'Order pricing is derived by the server and cannot be changed directly.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Access: service role only
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._apply_refund_transition(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_refund_operation(uuid, text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_refund_provider_attempt(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_refund_provider_result(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_provider_refund_event(text, text, integer, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_unattempted_payments_on_order_close() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.note_payment_applied_to_closed_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_order_pricing_authority() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_refund_operation(uuid, text, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_refund_provider_attempt(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_refund_provider_result(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_provider_refund_event(text, text, integer, text, text, text, text) TO service_role;
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

  IF fp_all IS DISTINCT FROM '4f8a66e1f504df0efd287f2732fd9fda' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261022120000 (expected 4f8a66e1f504df0efd287f2732fd9fda, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261022120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261022120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261022120000', 'refund_safety_and_financial_write_authority', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=20/28; version=20261022120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=05fec2307df354198cbeea4a04f133e898263a0ec208e3fd616b5e4717f58229', $bpcsql$/*
  # Refund safety, recovery and financial write authority (Step 3C-A)

  ## Problems (verified in the Step 3C audit)
  - A refund request could create two real Stripe refunds (no idempotency key, a read-then-write reservation with no lock), and a
    refund created at Stripe could be lost before any local row existed.
  - `order_refunds` had no uniqueness, no amount bound and no link to the payment refunded; the webhook recorded the cumulative
    `charge.amount_refunded` against `refunds.data[0]` and resolved the original payment with a lookup that a refund row itself
    matched, so a second partial refund was silently dropped. Refund status never left `pending`.
  - A refund existed in up to three stores (`order_refunds`, a negative `payments` row, `orders.total_refunded_cents`) written by
    different code with different rules.
  - An authenticated Admin / Master could INSERT or UPDATE `payments` rows and INSERT / UPDATE / DELETE `order_refunds` rows from a
    browser session, and could write `orders.stripe_payment_status` / `payment_lock`.
  - Rejecting an order cancelled pending payment rows from the browser.

  ## Boundary
  `order_refunds` owns the identity and status of each refund event. A refund request is reserved ATOMICALLY (under the order row
  lock) as one or more `pending` rows, BEFORE any Stripe call; each row carries a stable Stripe idempotency key. The Edge Function
  then performs the provider call(s) and records the result. A retry with the same operation key finds the same rows and never
  creates a second refund; a row whose provider result is unknown stays `pending` and keeps its reservation until the provider says
  otherwise. Three service-role functions do all writes:

    reserve_refund_operation        reserve (or re-read) the rows of one refund request
    mark_refund_provider_attempt    durable "a provider request may have started"
    record_refund_provider_result   record what Stripe said for a row we created
    apply_provider_refund_event     record what Stripe says about ANY refund (webhook): ours, or one made in the Stripe dashboard

  A row becomes `succeeded` exactly once; that single transition adds the amount to `orders.total_refunded_cents` and writes one
  negative `payments` row (unique per Stripe refund). A refund that later fails reverses both. Pending and failed refunds are never
  counted as cash returned and a failed refund releases its reservation.

  ## Historical rows
  Nothing is rewritten or deleted. Rows that exist today have `ledger_version` NULL ("legacy"): they keep counting toward the
  refundable-amount reservation (so the amount that may still be refunded can only be understated, never overstated), their provider
  identity is looked up for status updates, but they never change `total_refunded_cents` or the payments ledger, and no uniqueness is
  enforced between them. New rows carry `ledger_version` 2 and the new constraints apply to them.

  ## Write authority
  `authenticated` and `anon` can no longer INSERT / UPDATE / DELETE `payments` or `order_refunds` (staff keep SELECT). The pricing
  authority trigger now also refuses a direct change of `orders.stripe_payment_status` and `orders.payment_lock`. When an order is
  cancelled, payment rows that never reached the provider are cancelled by the database; a payment that does reach the provider later
  is still applied (the money is real) and leaves a review note on the order.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- order_refunds: identity, linkage, lifecycle
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.order_refunds
  ADD COLUMN IF NOT EXISTS operation_key text,
  ADD COLUMN IF NOT EXISTS operation_index integer,
  ADD COLUMN IF NOT EXISTS request_amount_cents integer,
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id),
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS provider_idempotency_key text,
  ADD COLUMN IF NOT EXISTS provider_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS total_applied boolean,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ledger_version smallint;

-- Added WITHOUT a default so existing rows stay NULL ("legacy"); only rows created from now on are version 2.
ALTER TABLE public.order_refunds ALTER COLUMN ledger_version SET DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_refunds_amount_positive' AND conrelid = 'public.order_refunds'::regclass) THEN
    -- NOT VALID: enforced for every new and changed row, without failing on (or rewriting) rows that already exist.
    ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_amount_positive CHECK (amount_cents > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_refunds_operation_shape' AND conrelid = 'public.order_refunds'::regclass) THEN
    ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_operation_shape
      CHECK (operation_key IS NULL OR (operation_index IS NOT NULL AND request_amount_cents IS NOT NULL AND provider_idempotency_key IS NOT NULL)) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS order_refunds_operation_unique
  ON public.order_refunds (operation_key, operation_index) WHERE operation_key IS NOT NULL;
-- One row per Stripe refund for every row written by this ledger (legacy rows are exempt: they may already contain duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS order_refunds_provider_refund_unique
  ON public.order_refunds (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL AND ledger_version = 2;
CREATE INDEX IF NOT EXISTS idx_order_refunds_payment_id ON public.order_refunds (payment_id);
CREATE INDEX IF NOT EXISTS idx_order_refunds_stripe_refund_id ON public.order_refunds (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL;

-- One negative ledger row per Stripe refund.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS stripe_refund_id text;
CREATE UNIQUE INDEX IF NOT EXISTS payments_refund_event_unique ON public.payments (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- Provider status -> local status
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._refund_status_from_provider(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(p_status, ''))
    WHEN 'succeeded' THEN 'succeeded'
    WHEN 'failed' THEN 'failed'
    WHEN 'canceled' THEN 'failed'
    WHEN 'cancelled' THEN 'failed'
    ELSE 'pending'
  END
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- _apply_refund_transition: the ONLY place a refund row changes status (and the only writer of the totals derived from it)
-- ---------------------------------------------------------------------------------------------------------------------
-- Callers hold the order row lock. pending -> succeeded applies the refund once; succeeded -> failed reverses it; failed is final.
CREATE OR REPLACE FUNCTION public._apply_refund_transition(
  p_refund_id uuid,
  p_new_status text,
  p_failure_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.order_refunds%ROWTYPE;
  orig public.payments%ROWTYPE;
  v_payment_row uuid;
  v_applied_now boolean := false;
BEGIN
  IF p_new_status NOT IN ('pending', 'succeeded', 'failed') THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  SELECT * INTO r FROM public.order_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF r.status = p_new_status THEN
    RETURN jsonb_build_object('outcome', 'unchanged', 'status', r.status, 'refund_id', r.id, 'order_id', r.order_id, 'applied_now', false);
  END IF;

  IF r.status = 'failed' THEN
    -- A refund that failed does not come back: Stripe does not move a failed refund to succeeded. Leave a note for a person.
    INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value, notes)
    VALUES (r.order_id, NULL, 'payment_error', 'order_refunds.status', r.status, p_new_status,
            'REFUND_EVENT_AFTER_FAILURE: refund row ' || r.id::text || ' is failed but the provider now reports ' || p_new_status || '; review it in Stripe.');
    RETURN jsonb_build_object('outcome', 'invalid_transition', 'status', r.status, 'refund_id', r.id, 'order_id', r.order_id, 'applied_now', false);
  END IF;

  IF p_new_status = 'pending' THEN
    -- succeeded -> pending is not a provider transition.
    RETURN jsonb_build_object('outcome', 'invalid_transition', 'status', r.status, 'refund_id', r.id, 'order_id', r.order_id, 'applied_now', false);
  END IF;

  IF p_new_status = 'succeeded' THEN
    UPDATE public.order_refunds SET status = 'succeeded', failure_reason = NULL, updated_at = now() WHERE id = r.id;

    -- Only rows of this ledger change the order-level total and the payments ledger; a legacy row's history is unknown.
    IF r.ledger_version = 2 AND r.total_applied IS NOT TRUE AND r.order_id IS NOT NULL THEN
      UPDATE public.orders SET total_refunded_cents = COALESCE(total_refunded_cents, 0) + r.amount_cents WHERE id = r.order_id;
      UPDATE public.order_refunds SET total_applied = true WHERE id = r.id;
      v_applied_now := true;

      IF r.payment_id IS NOT NULL AND r.stripe_refund_id IS NOT NULL THEN
        SELECT * INTO orig FROM public.payments WHERE id = r.payment_id;
        IF FOUND THEN
          INSERT INTO public.payments (
            order_id, stripe_payment_intent_id, amount_cents, type, status, paid_at, payment_method, payment_brand,
            refunded_payment_id, stripe_refund_id, stripe_fee_amount, stripe_net_amount, currency
          ) VALUES (
            r.order_id, orig.stripe_payment_intent_id, -r.amount_cents, 'incidental', 'succeeded', now(), orig.payment_method, orig.payment_brand,
            orig.id, r.stripe_refund_id, 0, -r.amount_cents, 'usd'
          )
          ON CONFLICT (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL DO NOTHING
          RETURNING id INTO v_payment_row;
        END IF;
      END IF;

      INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value, notes)
      VALUES (r.order_id, r.refunded_by, 'refund', 'total_refunded_cents', NULL, r.amount_cents::text,
              'Refund ' || COALESCE(r.stripe_refund_id, r.id::text) || ' succeeded for ' || r.amount_cents::text || ' cents');
    END IF;

    RETURN jsonb_build_object('outcome', 'succeeded', 'status', 'succeeded', 'refund_id', r.id, 'order_id', r.order_id, 'applied_now', v_applied_now,
                              'ledger_payment_id', v_payment_row, 'payment_id', r.payment_id);
  END IF;

  -- p_new_status = 'failed'
  UPDATE public.order_refunds
  SET status = 'failed', failure_reason = COALESCE(p_failure_reason, failure_reason), updated_at = now(), total_applied = CASE WHEN total_applied IS TRUE THEN false ELSE total_applied END
  WHERE id = r.id;

  IF r.status = 'succeeded' AND r.total_applied IS TRUE AND r.order_id IS NOT NULL THEN
    UPDATE public.orders SET total_refunded_cents = GREATEST(0, COALESCE(total_refunded_cents, 0) - r.amount_cents) WHERE id = r.order_id;
    UPDATE public.payments SET status = 'failed', failed_at = now() WHERE stripe_refund_id = r.stripe_refund_id AND r.stripe_refund_id IS NOT NULL;
    INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value, notes)
    VALUES (r.order_id, NULL, 'payment_error', 'total_refunded_cents', r.amount_cents::text, '0',
            'REFUND_REVERSED: refund ' || COALESCE(r.stripe_refund_id, r.id::text) || ' was reported failed after it had succeeded; it no longer counts as returned.');
  END IF;

  RETURN jsonb_build_object('outcome', 'failed', 'status', 'failed', 'refund_id', r.id, 'order_id', r.order_id, 'applied_now', false, 'payment_id', r.payment_id);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- reserve_refund_operation
-- ---------------------------------------------------------------------------------------------------------------------
-- One refund request = one operation key. Under the order row lock it either returns the rows it already reserved (a retry or a
-- double submit) or reserves new `pending` rows, allocated newest payment first, against what can still be refunded.
CREATE OR REPLACE FUNCTION public.reserve_refund_operation(
  p_order_id uuid,
  p_operation_key text,
  p_amount_cents integer,
  p_reason text,
  p_actor uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_existing public.order_refunds%ROWTYPE;
  v_captured bigint;
  v_reserved bigint;
  v_max bigint;
  v_remaining integer;
  v_idx integer := 0;
  v_take integer;
  v_pay record;
  v_linked bigint;
  v_avail bigint;
  v_rows jsonb;
  v_unsettled record;
  v_pay_count integer;
BEGIN
  IF p_order_id IS NULL OR p_operation_key IS NULL OR p_operation_key !~ '^[A-Za-z0-9_-]{8,64}$'
     OR p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > 99999999 THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'order_not_found');
  END IF;

  -- The same key again: same rows, nothing new. A key reused for different parameters is refused.
  SELECT * INTO v_existing FROM public.order_refunds WHERE operation_key = p_operation_key ORDER BY operation_index LIMIT 1;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id OR v_existing.request_amount_cents IS DISTINCT FROM p_amount_cents THEN
      RETURN jsonb_build_object('outcome', 'key_conflict');
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', id, 'operation_index', operation_index, 'payment_id', payment_id, 'stripe_payment_intent_id', stripe_payment_intent_id,
             'amount_cents', amount_cents, 'status', status, 'stripe_refund_id', stripe_refund_id,
             'provider_idempotency_key', provider_idempotency_key, 'provider_attempted_at', provider_attempted_at,
             'failure_reason', failure_reason, 'created_at', created_at) ORDER BY operation_index), '[]'::jsonb)
      INTO v_rows FROM public.order_refunds WHERE operation_key = p_operation_key;
    RETURN jsonb_build_object('outcome', 'existing', 'refunds', v_rows);
  END IF;

  -- A refund request that was started and never finished is not silently replaced by another one. Requests that never reached Stripe and
  -- were left for a quarter of an hour are released (nothing was sent, so nothing can be owed); any other request that has no Stripe refund
  -- yet blocks a NEW request on the order, and the answer names it so the caller can send its operation key again and settle it.
  UPDATE public.order_refunds o
  SET status = 'failed', failure_reason = 'abandoned before any provider request was made', updated_at = now()
  WHERE o.order_id = p_order_id AND o.operation_key IS NOT NULL AND o.operation_key <> p_operation_key
    AND o.status = 'pending' AND o.stripe_refund_id IS NULL
    AND o.created_at < now() - interval '15 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.order_refunds x
      WHERE x.operation_key = o.operation_key AND (x.stripe_refund_id IS NOT NULL OR x.provider_attempted_at IS NOT NULL OR x.status = 'succeeded')
    );

  SELECT o.operation_key, o.request_amount_cents INTO v_unsettled
  FROM public.order_refunds o
  WHERE o.order_id = p_order_id AND o.operation_key IS NOT NULL AND o.operation_key <> p_operation_key
    AND o.status = 'pending' AND o.stripe_refund_id IS NULL
  ORDER BY o.created_at LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('outcome', 'unsettled_operation', 'operation_key', v_unsettled.operation_key, 'request_amount_cents', v_unsettled.request_amount_cents);
  END IF;

  -- What can be refunded: the card payments (positive, with a PaymentIntent) minus every pending or succeeded refund on the order,
  -- including rows from before this ledger existed. Negative payment rows are not consulted (they are a copy of a refund).
  SELECT COALESCE(SUM(p.amount_cents), 0) INTO v_captured
  FROM public.payments p
  WHERE p.order_id = p_order_id AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL
    AND p.stripe_payment_intent_id IS NOT NULL;
  IF v_captured <= 0 THEN
    RETURN jsonb_build_object('outcome', 'no_refundable_payment');
  END IF;

  -- Refunds recorded before refunds were linked to a payment cannot be attributed to one. With a single card payment that is not a
  -- question (they all belong to it); with several it is, and nothing is guessed: the request is refused for a person to handle.
  SELECT count(*) INTO v_pay_count
  FROM public.payments p
  WHERE p.order_id = p_order_id AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL AND p.stripe_payment_intent_id IS NOT NULL;
  IF v_pay_count > 1 AND EXISTS (
    SELECT 1 FROM public.order_refunds WHERE order_id = p_order_id AND ledger_version IS NULL AND payment_id IS NULL AND status IN ('pending', 'succeeded')
  ) THEN
    RETURN jsonb_build_object('outcome', 'allocation_ambiguous');
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_reserved
  FROM public.order_refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded');
  v_max := GREATEST(0, v_captured - v_reserved);
  IF p_amount_cents > v_max THEN
    RETURN jsonb_build_object('outcome', 'exceeds_refundable', 'max_refundable_cents', v_max);
  END IF;

  v_remaining := p_amount_cents;
  FOR v_pay IN
    SELECT p.id, p.amount_cents, p.stripe_payment_intent_id
    FROM public.payments p
    WHERE p.order_id = p_order_id AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL
      AND p.stripe_payment_intent_id IS NOT NULL
    ORDER BY p.created_at DESC, p.id
  LOOP
    EXIT WHEN v_remaining <= 0;
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_linked
    FROM public.order_refunds WHERE payment_id = v_pay.id AND status IN ('pending', 'succeeded');
    v_avail := GREATEST(0, v_pay.amount_cents - v_linked);
    v_take := LEAST(v_remaining, v_avail);
    IF v_take > 0 THEN
      INSERT INTO public.order_refunds (
        order_id, amount_cents, reason, status, refunded_by, operation_key, operation_index, request_amount_cents,
        payment_id, stripe_payment_intent_id, provider_idempotency_key, source, updated_at
      ) VALUES (
        p_order_id, v_take, COALESCE(NULLIF(left(p_reason, 500), ''), 'Admin refund'), 'pending', p_actor, p_operation_key, v_idx, p_amount_cents,
        v_pay.id, v_pay.stripe_payment_intent_id, 'refund:' || p_operation_key || ':' || v_idx::text, 'admin', now()
      );
      v_idx := v_idx + 1;
      v_remaining := v_remaining - v_take;
    END IF;
  END LOOP;

  IF v_remaining > 0 THEN
    -- The legacy rows hold part of the reservation that cannot be attributed to a payment; nothing is reserved.
    RAISE EXCEPTION 'refund_allocation_incomplete' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'operation_index', operation_index, 'payment_id', payment_id, 'stripe_payment_intent_id', stripe_payment_intent_id,
           'amount_cents', amount_cents, 'status', status, 'stripe_refund_id', stripe_refund_id,
           'provider_idempotency_key', provider_idempotency_key, 'provider_attempted_at', provider_attempted_at,
           'failure_reason', failure_reason, 'created_at', created_at) ORDER BY operation_index), '[]'::jsonb)
    INTO v_rows FROM public.order_refunds WHERE operation_key = p_operation_key;
  RETURN jsonb_build_object('outcome', 'reserved', 'refunds', v_rows);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- mark_refund_provider_attempt
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_refund_provider_attempt(p_refund_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_refund_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.order_refunds
  SET provider_attempted_at = COALESCE(provider_attempted_at, now()), updated_at = now()
  WHERE id = p_refund_id AND status = 'pending' AND stripe_refund_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- record_refund_provider_result: what Stripe said about a refund row WE created
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_refund_provider_result(
  p_refund_id uuid,
  p_stripe_refund_id text,
  p_stripe_status text,
  p_failure_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.order_refunds%ROWTYPE;
  v_new text;
BEGIN
  IF p_refund_id IS NULL OR p_stripe_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  SELECT * INTO r FROM public.order_refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF r.order_id IS NOT NULL THEN
    PERFORM 1 FROM public.orders WHERE id = r.order_id FOR UPDATE;
  END IF;
  SELECT * INTO r FROM public.order_refunds WHERE id = p_refund_id FOR UPDATE;

  IF p_stripe_refund_id IS NOT NULL THEN
    IF r.stripe_refund_id IS NOT NULL AND r.stripe_refund_id <> p_stripe_refund_id THEN
      RETURN jsonb_build_object('outcome', 'provider_mismatch');
    END IF;
    IF r.stripe_refund_id IS NULL THEN
      BEGIN
        UPDATE public.order_refunds SET stripe_refund_id = p_stripe_refund_id, updated_at = now() WHERE id = r.id;
      EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('outcome', 'provider_conflict');
      END;
    END IF;
  END IF;

  v_new := public._refund_status_from_provider(p_stripe_status);
  RETURN public._apply_refund_transition(r.id, v_new, p_failure_reason);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- apply_provider_refund_event: the webhook's single entry point for any refund (ours or one made in the Stripe dashboard)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_provider_refund_event(
  p_stripe_refund_id text,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_stripe_status text,
  p_failure_reason text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_bpc_refund_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.order_refunds%ROWTYPE;
  orig public.payments%ROWTYPE;
  v_new text;
  v_id uuid;
  v_result jsonb;
BEGIN
  IF p_stripe_refund_id IS NULL OR p_stripe_refund_id = '' OR p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_stripe_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;
  v_new := public._refund_status_from_provider(p_stripe_status);

  -- Our own refund carries the id of its row in its metadata (set when we created it), so a webhook that arrives before the
  -- initiating request has recorded the Stripe id still finds the right row.
  r := NULL;
  IF p_bpc_refund_id IS NOT NULL AND p_bpc_refund_id ~ '^[0-9a-fA-F-]{36}$' THEN
    SELECT * INTO r FROM public.order_refunds WHERE id = p_bpc_refund_id::uuid;
  END IF;
  IF r.id IS NULL THEN
    SELECT * INTO r FROM public.order_refunds WHERE stripe_refund_id = p_stripe_refund_id ORDER BY (ledger_version = 2) DESC NULLS LAST, created_at LIMIT 1;
  END IF;

  IF r.id IS NOT NULL THEN
    IF r.order_id IS NOT NULL THEN
      PERFORM 1 FROM public.orders WHERE id = r.order_id FOR UPDATE;
    END IF;
    SELECT * INTO r FROM public.order_refunds WHERE id = r.id FOR UPDATE;

    IF r.stripe_refund_id IS NOT NULL AND r.stripe_refund_id <> p_stripe_refund_id THEN
      RETURN jsonb_build_object('outcome', 'provider_mismatch', 'refund_id', r.id);
    END IF;
    -- A legacy webhook row recorded the CUMULATIVE amount of the charge; an individual event cannot be compared with it.
    IF r.amount_cents <> p_amount_cents THEN
      INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value, notes)
      VALUES (r.order_id, NULL, 'payment_error', 'order_refunds.amount_cents', r.amount_cents::text, p_amount_cents::text,
              'REFUND_AMOUNT_MISMATCH: refund row ' || r.id::text || ' (' || COALESCE(r.stripe_refund_id, 'no provider id yet') || ') differs from the provider event; nothing was changed.');
      RETURN jsonb_build_object('outcome', 'amount_mismatch', 'refund_id', r.id);
    END IF;
    IF r.stripe_refund_id IS NULL THEN
      BEGIN
        UPDATE public.order_refunds SET stripe_refund_id = p_stripe_refund_id, stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, p_payment_intent_id), updated_at = now() WHERE id = r.id;
      EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('outcome', 'provider_conflict', 'refund_id', r.id);
      END;
    END IF;
    RETURN public._apply_refund_transition(r.id, v_new, p_failure_reason);
  END IF;

  -- Not one of ours: a refund made outside the application. It needs the successful positive payment it refunds.
  SELECT * INTO orig FROM public.payments
  WHERE stripe_payment_intent_id = p_payment_intent_id AND p_payment_intent_id IS NOT NULL
    AND status = 'succeeded' AND amount_cents > 0 AND refunded_payment_id IS NULL
  ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_original_payment');
  END IF;

  PERFORM 1 FROM public.orders WHERE id = orig.order_id FOR UPDATE;
  -- Re-check under the lock: another delivery of the same event may have just recorded it.
  SELECT * INTO r FROM public.order_refunds WHERE stripe_refund_id = p_stripe_refund_id LIMIT 1;
  IF r.id IS NOT NULL THEN
    RETURN public._apply_refund_transition(r.id, v_new, p_failure_reason);
  END IF;

  BEGIN
    INSERT INTO public.order_refunds (
      order_id, amount_cents, reason, status, refunded_by, stripe_refund_id, payment_id, stripe_payment_intent_id, source, updated_at
    ) VALUES (
      orig.order_id, p_amount_cents, COALESCE(NULLIF(left(p_reason, 500), ''), 'Refund made outside the application'), 'pending', NULL,
      p_stripe_refund_id, orig.id, p_payment_intent_id, 'external', now()
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.order_refunds WHERE stripe_refund_id = p_stripe_refund_id LIMIT 1;
  END;

  v_result := public._apply_refund_transition(v_id, v_new, p_failure_reason);
  RETURN v_result || jsonb_build_object('external', true);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Cancelling an order cancels the payment attempts that never reached the provider
-- ---------------------------------------------------------------------------------------------------------------------
-- A payment row that already has a provider id, or whose provider request may have started, is left alone: only the provider can
-- say whether the money moved (the operation functions finalize it truthfully either way).
CREATE OR REPLACE FUNCTION public.cancel_unattempted_payments_on_order_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'void') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.payments
    SET status = 'cancelled', claim_id = NULL, claimed_at = NULL
    WHERE order_id = NEW.id
      AND status = 'pending'
      AND COALESCE(order_financials_applied, false) = false
      AND stripe_payment_intent_id IS NULL
      AND stripe_checkout_session_id IS NULL
      AND provider_attempted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_unattempted_payments_on_order_close ON public.orders;
CREATE TRIGGER trg_cancel_unattempted_payments_on_order_close
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.cancel_unattempted_payments_on_order_close();

-- A payment that reaches the provider after the order was closed is still applied (the money is real), and says so.
CREATE OR REPLACE FUNCTION public.note_payment_applied_to_closed_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.orders WHERE id = NEW.order_id;
  IF v_status IN ('cancelled', 'void') THEN
    INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value, notes)
    VALUES (NEW.order_id, NULL, 'payment_error', 'payments.order_financials_applied', 'false', 'true',
            'PAYMENT_APPLIED_TO_CLOSED_ORDER: payment ' || NEW.id::text || ' for ' || NEW.amount_cents::text || ' cents reached the provider after the order was ' || v_status || '. The order stays ' || v_status || '; whether to refund it is a decision for a person.');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_note_payment_applied_to_closed_order ON public.payments;
CREATE TRIGGER trg_note_payment_applied_to_closed_order
  AFTER UPDATE OF order_financials_applied ON public.payments
  FOR EACH ROW
  WHEN (COALESCE(OLD.order_financials_applied, false) = false AND NEW.order_financials_applied = true)
  EXECUTE FUNCTION public.note_payment_applied_to_closed_order();

-- ---------------------------------------------------------------------------------------------------------------------
-- Write authority: money tables are written by the server functions only
-- ---------------------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Admins can update payments" ON public.payments;
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated, anon;

DROP POLICY IF EXISTS "Admins can manage refunds" ON public.order_refunds;
DROP POLICY IF EXISTS "Admins can view refunds" ON public.order_refunds;
CREATE POLICY "Admins can view refunds" ON public.order_refunds FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
REVOKE ALL ON public.order_refunds FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.order_refunds FROM authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The order guard also covers the payment state flags
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
     OR NEW.same_day_weekday_delivery_fee_waive_reason IS DISTINCT FROM OLD.same_day_weekday_delivery_fee_waive_reason
     -- Whether the order counts as paid is written by the payment functions (a card charge, or the server-side zero-deposit waiver).
     OR NEW.stripe_payment_status IS DISTINCT FROM OLD.stripe_payment_status
     OR NEW.payment_lock IS DISTINCT FROM OLD.payment_lock THEN
    RAISE EXCEPTION 'Order pricing is derived by the server and cannot be changed directly.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Access: service role only
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._apply_refund_transition(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_refund_operation(uuid, text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_refund_provider_attempt(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_refund_provider_result(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_provider_refund_event(text, text, integer, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_unattempted_payments_on_order_close() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.note_payment_applied_to_closed_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_order_pricing_authority() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_refund_operation(uuid, text, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_refund_provider_attempt(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_refund_provider_result(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_provider_refund_event(text, text, integer, text, text, text, text) TO service_role;
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 325 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261022120000'; END IF;
END $bpcend$;
