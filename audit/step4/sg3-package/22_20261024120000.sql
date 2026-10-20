-- BPC-DEV-EXECUTOR step 22/28; version 20261024120000; file 20261024120000_refund_allocation_reservation.sql; sha256_lf 353b63b371f241dcc258d72ebce40105edbd04256d396faddded36f25df90912; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261024120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261024120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261023120000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261024120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 21 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
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

  IF fp_all IS DISTINCT FROM 'ec8a31d7d4268f914d36664a7d2ffd01' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261024120000 (expected ec8a31d7d4268f914d36664a7d2ffd01, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261024120000_refund_allocation_reservation.sql
/*
  # Allocation-aware refund reservation

  ## What this adds
  `reserve_refund_allocation(order, operation key, allocations, reason, actor, expected total)`: reserves a refund whose
  deposit-principal, balance-principal and tip parts are chosen EXPLICITLY, payment by payment, and validated by the database
  against what each original payment can still return.

  ## What it does not change
  `reserve_refund_operation` (the amount-only reservation the deployed refund function calls) is NOT touched and keeps working.
  The provider-attempt marker, the provider-result recorder, the transition function, the webhook function, the order columns and
  every other function are unchanged. A row reserved here is an ordinary `order_refunds` row (same operation key, index,
  idempotency key and status lifecycle), so the existing provider call, recovery, retry and webhook settlement work on it as they
  do on any other row; the only difference is that the row also carries its allocation (allocation_version 1).

  ## The request
    p_allocations   jsonb array of { "paymentId": uuid, "depositPrincipalCents": int, "balancePrincipalCents": int, "tipCents": int }
                    every field is required; amounts are whole, nonnegative cents; a payment appears at most once; a line is not
                    all zero. Unknown fields are refused.
    p_expected_total_cents   optional: when given it must equal the sum of the allocations (a browser total is only ever checked,
                    never trusted).

  ## Request identity
  The database computes it: "v1|total=<sum>|" followed by the lines sorted by payment id, each "<payment id>:<deposit>:<balance>:<tip>"
  joined with "|" (lower-case ids, byte order). It is stored in `request_allocation` on every row of the operation and never
  rewritten. The same key with the same identity resumes the operation; the same key with anything else is `key_conflict`.
  A key that belongs to an amount-only operation can never be given an allocation afterwards.

  ## Capacity (checked under the order row lock, before anything is written)
  For each payment, with its recorded components D (deposit principal), B (balance principal) and T (tip):
    consumed_c   = sum of component c over its pending and succeeded refund rows that carry an allocation
    U            = amount of its pending and succeeded refund rows that carry NO allocation (amount-only, older, made in the Stripe
                   dashboard), plus any allocated row's unclassified amount; for a single refundable payment this includes older
                   refund rows that were never linked to a payment
    remaining_c  = component_c - consumed_c
    guaranteed_c = max(0, remaining_c - U)
  The unknown amount U was returned from SOME component; at most min(U, remaining_c) of it came from component c, so at least
  guaranteed_c is certainly still there. A request is accepted only within guaranteed_c. Summed over components the guarantees never
  exceed (sum of remaining) - U, so asking for several components at once is safe too. Nothing is inferred and nothing is rewritten.
  When a request would fit but for the unknown amount, the answer is `ambiguous_historical_refund`, not a plain capacity error.
  The total is also bounded: line total <= payment amount - every pending and succeeded refund of the payment.
  With several refundable payments and older refund rows that were never linked to one, nothing can be attributed: the request is
  refused (`ambiguous_historical_refund`), exactly as the amount-only reservation refuses.

  ## Concurrency
  The order row is locked first (every payment and refund function takes the same lock first), the payments named are locked
  FOR SHARE, and the whole request is validated before the first row is inserted, so a refused request leaves nothing behind.

  ## Authority
  SECURITY DEFINER, fixed search_path, executable by the service role only.
*/

CREATE OR REPLACE FUNCTION public.reserve_refund_allocation(
  p_order_id uuid,
  p_operation_key text,
  p_allocations jsonb,
  p_reason text,
  p_actor uuid DEFAULT NULL,
  p_expected_total_cents integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_existing public.order_refunds%ROWTYPE;
  v_unsettled record;
  v_elem jsonb;
  v_key text;
  v_val jsonb;
  v_num numeric;
  v_c integer[];
  v_idx integer;
  v_pid uuid;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_norm jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_sig text;
  v_line record;
  v_p public.payments%ROWTYPE;
  v_dep_cons bigint;
  v_bal_cons bigint;
  v_tip_cons bigint;
  v_unknown bigint;
  v_all_cons bigint;
  v_unlinked bigint;
  v_refundable_count integer;
  v_rem_total bigint;
  v_rem_dep bigint;
  v_rem_bal bigint;
  v_rem_tip bigint;
  v_line_total bigint;
  v_n integer := 0;
  v_rows jsonb;
BEGIN
  IF p_order_id IS NULL OR p_operation_key IS NULL OR p_operation_key !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  -- ---- shape of the request (no table is read yet) ----
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 OR jsonb_array_length(p_allocations) > 20 THEN
    RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'allocations_required');
  END IF;

  FOR v_elem IN SELECT e FROM jsonb_array_elements(p_allocations) AS t(e) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'line_not_an_object');
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_elem) k WHERE k NOT IN ('paymentId', 'depositPrincipalCents', 'balancePrincipalCents', 'tipCents')) THEN
      RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'unknown_field');
    END IF;
    IF jsonb_typeof(v_elem->'paymentId') IS DISTINCT FROM 'string'
       OR (v_elem->>'paymentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'payment_id_invalid');
    END IF;
    v_pid := lower(v_elem->>'paymentId')::uuid;
    IF v_pid = ANY (v_seen) THEN
      RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'duplicate_payment');
    END IF;
    v_seen := v_seen || v_pid;

    v_c := ARRAY[0, 0, 0];
    v_idx := 0;
    FOREACH v_key IN ARRAY ARRAY['depositPrincipalCents', 'balancePrincipalCents', 'tipCents'] LOOP
      v_idx := v_idx + 1;
      v_val := v_elem->v_key;
      IF v_val IS NULL OR jsonb_typeof(v_val) <> 'number' THEN
        RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'component_missing');
      END IF;
      v_num := (v_val #>> '{}')::numeric;
      IF v_num < 0 THEN
        RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'component_negative');
      END IF;
      IF v_num <> trunc(v_num) THEN
        RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'component_fractional');
      END IF;
      IF v_num > 99999999 THEN
        RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'component_too_large');
      END IF;
      v_c[v_idx] := v_num::integer;
    END LOOP;
    IF v_c[1] + v_c[2] + v_c[3] = 0 THEN
      RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'zero_line');
    END IF;
    v_total := v_total + v_c[1] + v_c[2] + v_c[3];
    v_norm := v_norm || jsonb_build_array(jsonb_build_object('p', v_pid::text, 'd', v_c[1], 'b', v_c[2], 't', v_c[3]));
  END LOOP;

  IF v_total <= 0 OR v_total > 99999999 THEN
    RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'total_out_of_range');
  END IF;
  IF p_expected_total_cents IS NOT NULL AND p_expected_total_cents::bigint <> v_total THEN
    RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'total_mismatch');
  END IF;

  -- The canonical identity, computed here from the validated lines (never taken from the caller).
  SELECT 'v1|total=' || v_total::text || '|' || string_agg((e->>'p') || ':' || (e->>'d') || ':' || (e->>'b') || ':' || (e->>'t'), '|' ORDER BY (e->>'p') COLLATE "C")
    INTO v_sig FROM jsonb_array_elements(v_norm) AS t(e);

  -- ---- the order lock: the same serialization point every payment and refund function uses ----
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'order_not_found');
  END IF;

  -- ---- the same key again: the same rows, or a conflict ----
  SELECT * INTO v_existing FROM public.order_refunds WHERE operation_key = p_operation_key ORDER BY operation_index LIMIT 1;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id THEN
      RETURN jsonb_build_object('outcome', 'key_conflict');
    END IF;
    IF v_existing.allocation_version IS NULL THEN
      RETURN jsonb_build_object('outcome', 'key_conflict', 'detail', 'amount_only_operation');
    END IF;
    IF v_existing.request_allocation IS DISTINCT FROM v_sig THEN
      RETURN jsonb_build_object('outcome', 'key_conflict', 'detail', 'allocation_changed');
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', id, 'operation_index', operation_index, 'payment_id', payment_id, 'stripe_payment_intent_id', stripe_payment_intent_id,
             'amount_cents', amount_cents, 'status', status, 'stripe_refund_id', stripe_refund_id,
             'provider_idempotency_key', provider_idempotency_key, 'provider_attempted_at', provider_attempted_at,
             'failure_reason', failure_reason, 'created_at', created_at,
             'allocation_version', allocation_version, 'deposit_principal_refunded_cents', deposit_principal_refunded_cents,
             'balance_principal_refunded_cents', balance_principal_refunded_cents, 'tip_refunded_cents', tip_refunded_cents,
             'unclassified_refunded_cents', unclassified_refunded_cents) ORDER BY operation_index), '[]'::jsonb)
      INTO v_rows FROM public.order_refunds WHERE operation_key = p_operation_key;
    RETURN jsonb_build_object('outcome', 'existing', 'request_allocation', v_sig, 'refunds', v_rows);
  END IF;

  -- ---- an earlier request that never finished is not silently replaced (same rules as the amount-only reservation) ----
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

  -- ---- refund rows from before refunds were linked to a payment cannot be attributed to one ----
  SELECT COUNT(*) INTO v_refundable_count
  FROM public.payments p
  WHERE p.order_id = p_order_id AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL
    AND p.stripe_refund_id IS NULL AND p.stripe_payment_intent_id IS NOT NULL AND lower(COALESCE(p.payment_method, '')) NOT IN ('cash', 'check');
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_unlinked
  FROM public.order_refunds
  WHERE order_id = p_order_id AND payment_id IS NULL AND status IN ('pending', 'succeeded');
  IF v_unlinked > 0 AND v_refundable_count > 1 THEN
    RETURN jsonb_build_object('outcome', 'ambiguous_historical_refund', 'detail', 'unlinked_refunds');
  END IF;

  -- ---- pass 1: validate EVERY line against its payment before anything is written ----
  FOR v_line IN
    SELECT (e->>'p')::uuid AS pid, (e->>'d')::bigint AS d, (e->>'b')::bigint AS b, (e->>'t')::bigint AS t
    FROM jsonb_array_elements(v_norm) AS t(e) ORDER BY (e->>'p') COLLATE "C"
  LOOP
    SELECT * INTO v_p FROM public.payments WHERE id = v_line.pid FOR SHARE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('outcome', 'payment_not_found');
    END IF;
    IF v_p.order_id IS DISTINCT FROM p_order_id THEN
      RETURN jsonb_build_object('outcome', 'payment_wrong_order');
    END IF;
    IF v_p.status IS DISTINCT FROM 'succeeded' THEN
      RETURN jsonb_build_object('outcome', 'payment_not_succeeded', 'payment_id', v_p.id);
    END IF;
    IF v_p.amount_cents IS NULL OR v_p.amount_cents <= 0 OR v_p.refunded_payment_id IS NOT NULL OR v_p.stripe_refund_id IS NOT NULL
       OR v_p.stripe_payment_intent_id IS NULL OR lower(COALESCE(v_p.payment_method, '')) IN ('cash', 'check') THEN
      RETURN jsonb_build_object('outcome', 'payment_not_refundable', 'payment_id', v_p.id);
    END IF;
    IF v_p.principal_amount_cents IS NULL OR v_p.deposit_principal_cents IS NULL OR v_p.balance_principal_cents IS NULL OR v_p.tip_amount_cents IS NULL THEN
      RETURN jsonb_build_object('outcome', 'unclassified_payment', 'payment_id', v_p.id);
    END IF;

    SELECT COALESCE(SUM(deposit_principal_refunded_cents) FILTER (WHERE allocation_version = 1), 0),
           COALESCE(SUM(balance_principal_refunded_cents) FILTER (WHERE allocation_version = 1), 0),
           COALESCE(SUM(tip_refunded_cents) FILTER (WHERE allocation_version = 1), 0),
           COALESCE(SUM(CASE WHEN allocation_version = 1 THEN unclassified_refunded_cents ELSE amount_cents END), 0),
           COALESCE(SUM(amount_cents), 0)
      INTO v_dep_cons, v_bal_cons, v_tip_cons, v_unknown, v_all_cons
    FROM public.order_refunds
    WHERE payment_id = v_p.id AND status IN ('pending', 'succeeded');

    IF v_refundable_count = 1 THEN
      -- one refundable payment: refund rows that were never linked to a payment can only belong to it
      v_unknown := v_unknown + v_unlinked;
      v_all_cons := v_all_cons + v_unlinked;
    END IF;

    v_rem_total := v_p.amount_cents - v_all_cons;
    v_rem_dep := v_p.deposit_principal_cents - v_dep_cons;
    v_rem_bal := v_p.balance_principal_cents - v_bal_cons;
    v_rem_tip := v_p.tip_amount_cents - v_tip_cons;
    v_line_total := v_line.d + v_line.b + v_line.t;

    IF v_line_total > v_rem_total THEN
      RETURN jsonb_build_object('outcome', 'total_capacity_exceeded', 'payment_id', v_p.id, 'remaining_cents', GREATEST(0, v_rem_total));
    END IF;
    IF v_line.d > v_rem_dep THEN
      RETURN jsonb_build_object('outcome', 'deposit_capacity_exceeded', 'payment_id', v_p.id, 'remaining_cents', GREATEST(0, v_rem_dep));
    END IF;
    IF v_line.b > v_rem_bal THEN
      RETURN jsonb_build_object('outcome', 'balance_capacity_exceeded', 'payment_id', v_p.id, 'remaining_cents', GREATEST(0, v_rem_bal));
    END IF;
    IF v_line.t > v_rem_tip THEN
      RETURN jsonb_build_object('outcome', 'tip_capacity_exceeded', 'payment_id', v_p.id, 'remaining_cents', GREATEST(0, v_rem_tip));
    END IF;
    -- It fits, unless the refunds of unknown composition took it: only what is certainly still there may be refunded.
    IF v_line.d > GREATEST(0, v_rem_dep - v_unknown) OR v_line.b > GREATEST(0, v_rem_bal - v_unknown) OR v_line.t > GREATEST(0, v_rem_tip - v_unknown) THEN
      RETURN jsonb_build_object('outcome', 'ambiguous_historical_refund', 'detail', 'unclassified_refunds_on_payment', 'payment_id', v_p.id,
                                'unclassified_refunded_cents', v_unknown);
    END IF;
  END LOOP;

  -- ---- pass 2: reserve. Every line passed, so these inserts cannot be refused for capacity. ----
  FOR v_line IN
    SELECT (e->>'p')::uuid AS pid, (e->>'d')::integer AS d, (e->>'b')::integer AS b, (e->>'t')::integer AS t
    FROM jsonb_array_elements(v_norm) AS t(e) ORDER BY (e->>'p') COLLATE "C"
  LOOP
    SELECT * INTO v_p FROM public.payments WHERE id = v_line.pid;
    INSERT INTO public.order_refunds (
      order_id, amount_cents, reason, status, refunded_by, operation_key, operation_index, request_amount_cents,
      payment_id, stripe_payment_intent_id, provider_idempotency_key, source, updated_at,
      allocation_version, deposit_principal_refunded_cents, balance_principal_refunded_cents, tip_refunded_cents,
      unclassified_refunded_cents, request_allocation
    ) VALUES (
      p_order_id, v_line.d + v_line.b + v_line.t, COALESCE(NULLIF(left(p_reason, 500), ''), 'Admin refund'), 'pending', p_actor,
      p_operation_key, v_n, v_total::integer, v_p.id, v_p.stripe_payment_intent_id,
      'refund:' || p_operation_key || ':' || v_n::text, 'admin', now(),
      1, v_line.d, v_line.b, v_line.t, 0, v_sig
    );
    v_n := v_n + 1;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'operation_index', operation_index, 'payment_id', payment_id, 'stripe_payment_intent_id', stripe_payment_intent_id,
           'amount_cents', amount_cents, 'status', status, 'stripe_refund_id', stripe_refund_id,
           'provider_idempotency_key', provider_idempotency_key, 'provider_attempted_at', provider_attempted_at,
           'failure_reason', failure_reason, 'created_at', created_at,
           'allocation_version', allocation_version, 'deposit_principal_refunded_cents', deposit_principal_refunded_cents,
           'balance_principal_refunded_cents', balance_principal_refunded_cents, 'tip_refunded_cents', tip_refunded_cents,
           'unclassified_refunded_cents', unclassified_refunded_cents) ORDER BY operation_index), '[]'::jsonb)
    INTO v_rows FROM public.order_refunds WHERE operation_key = p_operation_key;
  RETURN jsonb_build_object('outcome', 'reserved', 'request_allocation', v_sig, 'refunds', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_refund_allocation(uuid, text, jsonb, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_refund_allocation(uuid, text, jsonb, text, uuid, integer) TO service_role;
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

  IF fp_all IS DISTINCT FROM '20e5c1d820ae37dfd9b47bfd3b2fdfc0' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261024120000 (expected 20e5c1d820ae37dfd9b47bfd3b2fdfc0, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261024120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261024120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261024120000', 'refund_allocation_reservation', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=22/28; version=20261024120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=353b63b371f241dcc258d72ebce40105edbd04256d396faddded36f25df90912', $bpcsql$/*
  # Allocation-aware refund reservation

  ## What this adds
  `reserve_refund_allocation(order, operation key, allocations, reason, actor, expected total)`: reserves a refund whose
  deposit-principal, balance-principal and tip parts are chosen EXPLICITLY, payment by payment, and validated by the database
  against what each original payment can still return.

  ## What it does not change
  `reserve_refund_operation` (the amount-only reservation the deployed refund function calls) is NOT touched and keeps working.
  The provider-attempt marker, the provider-result recorder, the transition function, the webhook function, the order columns and
  every other function are unchanged. A row reserved here is an ordinary `order_refunds` row (same operation key, index,
  idempotency key and status lifecycle), so the existing provider call, recovery, retry and webhook settlement work on it as they
  do on any other row; the only difference is that the row also carries its allocation (allocation_version 1).

  ## The request
    p_allocations   jsonb array of { "paymentId": uuid, "depositPrincipalCents": int, "balancePrincipalCents": int, "tipCents": int }
                    every field is required; amounts are whole, nonnegative cents; a payment appears at most once; a line is not
                    all zero. Unknown fields are refused.
    p_expected_total_cents   optional: when given it must equal the sum of the allocations (a browser total is only ever checked,
                    never trusted).

  ## Request identity
  The database computes it: "v1|total=<sum>|" followed by the lines sorted by payment id, each "<payment id>:<deposit>:<balance>:<tip>"
  joined with "|" (lower-case ids, byte order). It is stored in `request_allocation` on every row of the operation and never
  rewritten. The same key with the same identity resumes the operation; the same key with anything else is `key_conflict`.
  A key that belongs to an amount-only operation can never be given an allocation afterwards.

  ## Capacity (checked under the order row lock, before anything is written)
  For each payment, with its recorded components D (deposit principal), B (balance principal) and T (tip):
    consumed_c   = sum of component c over its pending and succeeded refund rows that carry an allocation
    U            = amount of its pending and succeeded refund rows that carry NO allocation (amount-only, older, made in the Stripe
                   dashboard), plus any allocated row's unclassified amount; for a single refundable payment this includes older
                   refund rows that were never linked to a payment
    remaining_c  = component_c - consumed_c
    guaranteed_c = max(0, remaining_c - U)
  The unknown amount U was returned from SOME component; at most min(U, remaining_c) of it came from component c, so at least
  guaranteed_c is certainly still there. A request is accepted only within guaranteed_c. Summed over components the guarantees never
  exceed (sum of remaining) - U, so asking for several components at once is safe too. Nothing is inferred and nothing is rewritten.
  When a request would fit but for the unknown amount, the answer is `ambiguous_historical_refund`, not a plain capacity error.
  The total is also bounded: line total <= payment amount - every pending and succeeded refund of the payment.
  With several refundable payments and older refund rows that were never linked to one, nothing can be attributed: the request is
  refused (`ambiguous_historical_refund`), exactly as the amount-only reservation refuses.

  ## Concurrency
  The order row is locked first (every payment and refund function takes the same lock first), the payments named are locked
  FOR SHARE, and the whole request is validated before the first row is inserted, so a refused request leaves nothing behind.

  ## Authority
  SECURITY DEFINER, fixed search_path, executable by the service role only.
*/

CREATE OR REPLACE FUNCTION public.reserve_refund_allocation(
  p_order_id uuid,
  p_operation_key text,
  p_allocations jsonb,
  p_reason text,
  p_actor uuid DEFAULT NULL,
  p_expected_total_cents integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_existing public.order_refunds%ROWTYPE;
  v_unsettled record;
  v_elem jsonb;
  v_key text;
  v_val jsonb;
  v_num numeric;
  v_c integer[];
  v_idx integer;
  v_pid uuid;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_norm jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_sig text;
  v_line record;
  v_p public.payments%ROWTYPE;
  v_dep_cons bigint;
  v_bal_cons bigint;
  v_tip_cons bigint;
  v_unknown bigint;
  v_all_cons bigint;
  v_unlinked bigint;
  v_refundable_count integer;
  v_rem_total bigint;
  v_rem_dep bigint;
  v_rem_bal bigint;
  v_rem_tip bigint;
  v_line_total bigint;
  v_n integer := 0;
  v_rows jsonb;
BEGIN
  IF p_order_id IS NULL OR p_operation_key IS NULL OR p_operation_key !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  -- ---- shape of the request (no table is read yet) ----
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 OR jsonb_array_length(p_allocations) > 20 THEN
    RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'allocations_required');
  END IF;

  FOR v_elem IN SELECT e FROM jsonb_array_elements(p_allocations) AS t(e) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'line_not_an_object');
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_elem) k WHERE k NOT IN ('paymentId', 'depositPrincipalCents', 'balancePrincipalCents', 'tipCents')) THEN
      RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'unknown_field');
    END IF;
    IF jsonb_typeof(v_elem->'paymentId') IS DISTINCT FROM 'string'
       OR (v_elem->>'paymentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'payment_id_invalid');
    END IF;
    v_pid := lower(v_elem->>'paymentId')::uuid;
    IF v_pid = ANY (v_seen) THEN
      RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'duplicate_payment');
    END IF;
    v_seen := v_seen || v_pid;

    v_c := ARRAY[0, 0, 0];
    v_idx := 0;
    FOREACH v_key IN ARRAY ARRAY['depositPrincipalCents', 'balancePrincipalCents', 'tipCents'] LOOP
      v_idx := v_idx + 1;
      v_val := v_elem->v_key;
      IF v_val IS NULL OR jsonb_typeof(v_val) <> 'number' THEN
        RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'component_missing');
      END IF;
      v_num := (v_val #>> '{}')::numeric;
      IF v_num < 0 THEN
        RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'component_negative');
      END IF;
      IF v_num <> trunc(v_num) THEN
        RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'component_fractional');
      END IF;
      IF v_num > 99999999 THEN
        RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'component_too_large');
      END IF;
      v_c[v_idx] := v_num::integer;
    END LOOP;
    IF v_c[1] + v_c[2] + v_c[3] = 0 THEN
      RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'zero_line');
    END IF;
    v_total := v_total + v_c[1] + v_c[2] + v_c[3];
    v_norm := v_norm || jsonb_build_array(jsonb_build_object('p', v_pid::text, 'd', v_c[1], 'b', v_c[2], 't', v_c[3]));
  END LOOP;

  IF v_total <= 0 OR v_total > 99999999 THEN
    RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'total_out_of_range');
  END IF;
  IF p_expected_total_cents IS NOT NULL AND p_expected_total_cents::bigint <> v_total THEN
    RETURN jsonb_build_object('outcome', 'invalid_allocation', 'detail', 'total_mismatch');
  END IF;

  -- The canonical identity, computed here from the validated lines (never taken from the caller).
  SELECT 'v1|total=' || v_total::text || '|' || string_agg((e->>'p') || ':' || (e->>'d') || ':' || (e->>'b') || ':' || (e->>'t'), '|' ORDER BY (e->>'p') COLLATE "C")
    INTO v_sig FROM jsonb_array_elements(v_norm) AS t(e);

  -- ---- the order lock: the same serialization point every payment and refund function uses ----
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'order_not_found');
  END IF;

  -- ---- the same key again: the same rows, or a conflict ----
  SELECT * INTO v_existing FROM public.order_refunds WHERE operation_key = p_operation_key ORDER BY operation_index LIMIT 1;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id THEN
      RETURN jsonb_build_object('outcome', 'key_conflict');
    END IF;
    IF v_existing.allocation_version IS NULL THEN
      RETURN jsonb_build_object('outcome', 'key_conflict', 'detail', 'amount_only_operation');
    END IF;
    IF v_existing.request_allocation IS DISTINCT FROM v_sig THEN
      RETURN jsonb_build_object('outcome', 'key_conflict', 'detail', 'allocation_changed');
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', id, 'operation_index', operation_index, 'payment_id', payment_id, 'stripe_payment_intent_id', stripe_payment_intent_id,
             'amount_cents', amount_cents, 'status', status, 'stripe_refund_id', stripe_refund_id,
             'provider_idempotency_key', provider_idempotency_key, 'provider_attempted_at', provider_attempted_at,
             'failure_reason', failure_reason, 'created_at', created_at,
             'allocation_version', allocation_version, 'deposit_principal_refunded_cents', deposit_principal_refunded_cents,
             'balance_principal_refunded_cents', balance_principal_refunded_cents, 'tip_refunded_cents', tip_refunded_cents,
             'unclassified_refunded_cents', unclassified_refunded_cents) ORDER BY operation_index), '[]'::jsonb)
      INTO v_rows FROM public.order_refunds WHERE operation_key = p_operation_key;
    RETURN jsonb_build_object('outcome', 'existing', 'request_allocation', v_sig, 'refunds', v_rows);
  END IF;

  -- ---- an earlier request that never finished is not silently replaced (same rules as the amount-only reservation) ----
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

  -- ---- refund rows from before refunds were linked to a payment cannot be attributed to one ----
  SELECT COUNT(*) INTO v_refundable_count
  FROM public.payments p
  WHERE p.order_id = p_order_id AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL
    AND p.stripe_refund_id IS NULL AND p.stripe_payment_intent_id IS NOT NULL AND lower(COALESCE(p.payment_method, '')) NOT IN ('cash', 'check');
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_unlinked
  FROM public.order_refunds
  WHERE order_id = p_order_id AND payment_id IS NULL AND status IN ('pending', 'succeeded');
  IF v_unlinked > 0 AND v_refundable_count > 1 THEN
    RETURN jsonb_build_object('outcome', 'ambiguous_historical_refund', 'detail', 'unlinked_refunds');
  END IF;

  -- ---- pass 1: validate EVERY line against its payment before anything is written ----
  FOR v_line IN
    SELECT (e->>'p')::uuid AS pid, (e->>'d')::bigint AS d, (e->>'b')::bigint AS b, (e->>'t')::bigint AS t
    FROM jsonb_array_elements(v_norm) AS t(e) ORDER BY (e->>'p') COLLATE "C"
  LOOP
    SELECT * INTO v_p FROM public.payments WHERE id = v_line.pid FOR SHARE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('outcome', 'payment_not_found');
    END IF;
    IF v_p.order_id IS DISTINCT FROM p_order_id THEN
      RETURN jsonb_build_object('outcome', 'payment_wrong_order');
    END IF;
    IF v_p.status IS DISTINCT FROM 'succeeded' THEN
      RETURN jsonb_build_object('outcome', 'payment_not_succeeded', 'payment_id', v_p.id);
    END IF;
    IF v_p.amount_cents IS NULL OR v_p.amount_cents <= 0 OR v_p.refunded_payment_id IS NOT NULL OR v_p.stripe_refund_id IS NOT NULL
       OR v_p.stripe_payment_intent_id IS NULL OR lower(COALESCE(v_p.payment_method, '')) IN ('cash', 'check') THEN
      RETURN jsonb_build_object('outcome', 'payment_not_refundable', 'payment_id', v_p.id);
    END IF;
    IF v_p.principal_amount_cents IS NULL OR v_p.deposit_principal_cents IS NULL OR v_p.balance_principal_cents IS NULL OR v_p.tip_amount_cents IS NULL THEN
      RETURN jsonb_build_object('outcome', 'unclassified_payment', 'payment_id', v_p.id);
    END IF;

    SELECT COALESCE(SUM(deposit_principal_refunded_cents) FILTER (WHERE allocation_version = 1), 0),
           COALESCE(SUM(balance_principal_refunded_cents) FILTER (WHERE allocation_version = 1), 0),
           COALESCE(SUM(tip_refunded_cents) FILTER (WHERE allocation_version = 1), 0),
           COALESCE(SUM(CASE WHEN allocation_version = 1 THEN unclassified_refunded_cents ELSE amount_cents END), 0),
           COALESCE(SUM(amount_cents), 0)
      INTO v_dep_cons, v_bal_cons, v_tip_cons, v_unknown, v_all_cons
    FROM public.order_refunds
    WHERE payment_id = v_p.id AND status IN ('pending', 'succeeded');

    IF v_refundable_count = 1 THEN
      -- one refundable payment: refund rows that were never linked to a payment can only belong to it
      v_unknown := v_unknown + v_unlinked;
      v_all_cons := v_all_cons + v_unlinked;
    END IF;

    v_rem_total := v_p.amount_cents - v_all_cons;
    v_rem_dep := v_p.deposit_principal_cents - v_dep_cons;
    v_rem_bal := v_p.balance_principal_cents - v_bal_cons;
    v_rem_tip := v_p.tip_amount_cents - v_tip_cons;
    v_line_total := v_line.d + v_line.b + v_line.t;

    IF v_line_total > v_rem_total THEN
      RETURN jsonb_build_object('outcome', 'total_capacity_exceeded', 'payment_id', v_p.id, 'remaining_cents', GREATEST(0, v_rem_total));
    END IF;
    IF v_line.d > v_rem_dep THEN
      RETURN jsonb_build_object('outcome', 'deposit_capacity_exceeded', 'payment_id', v_p.id, 'remaining_cents', GREATEST(0, v_rem_dep));
    END IF;
    IF v_line.b > v_rem_bal THEN
      RETURN jsonb_build_object('outcome', 'balance_capacity_exceeded', 'payment_id', v_p.id, 'remaining_cents', GREATEST(0, v_rem_bal));
    END IF;
    IF v_line.t > v_rem_tip THEN
      RETURN jsonb_build_object('outcome', 'tip_capacity_exceeded', 'payment_id', v_p.id, 'remaining_cents', GREATEST(0, v_rem_tip));
    END IF;
    -- It fits, unless the refunds of unknown composition took it: only what is certainly still there may be refunded.
    IF v_line.d > GREATEST(0, v_rem_dep - v_unknown) OR v_line.b > GREATEST(0, v_rem_bal - v_unknown) OR v_line.t > GREATEST(0, v_rem_tip - v_unknown) THEN
      RETURN jsonb_build_object('outcome', 'ambiguous_historical_refund', 'detail', 'unclassified_refunds_on_payment', 'payment_id', v_p.id,
                                'unclassified_refunded_cents', v_unknown);
    END IF;
  END LOOP;

  -- ---- pass 2: reserve. Every line passed, so these inserts cannot be refused for capacity. ----
  FOR v_line IN
    SELECT (e->>'p')::uuid AS pid, (e->>'d')::integer AS d, (e->>'b')::integer AS b, (e->>'t')::integer AS t
    FROM jsonb_array_elements(v_norm) AS t(e) ORDER BY (e->>'p') COLLATE "C"
  LOOP
    SELECT * INTO v_p FROM public.payments WHERE id = v_line.pid;
    INSERT INTO public.order_refunds (
      order_id, amount_cents, reason, status, refunded_by, operation_key, operation_index, request_amount_cents,
      payment_id, stripe_payment_intent_id, provider_idempotency_key, source, updated_at,
      allocation_version, deposit_principal_refunded_cents, balance_principal_refunded_cents, tip_refunded_cents,
      unclassified_refunded_cents, request_allocation
    ) VALUES (
      p_order_id, v_line.d + v_line.b + v_line.t, COALESCE(NULLIF(left(p_reason, 500), ''), 'Admin refund'), 'pending', p_actor,
      p_operation_key, v_n, v_total::integer, v_p.id, v_p.stripe_payment_intent_id,
      'refund:' || p_operation_key || ':' || v_n::text, 'admin', now(),
      1, v_line.d, v_line.b, v_line.t, 0, v_sig
    );
    v_n := v_n + 1;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'operation_index', operation_index, 'payment_id', payment_id, 'stripe_payment_intent_id', stripe_payment_intent_id,
           'amount_cents', amount_cents, 'status', status, 'stripe_refund_id', stripe_refund_id,
           'provider_idempotency_key', provider_idempotency_key, 'provider_attempted_at', provider_attempted_at,
           'failure_reason', failure_reason, 'created_at', created_at,
           'allocation_version', allocation_version, 'deposit_principal_refunded_cents', deposit_principal_refunded_cents,
           'balance_principal_refunded_cents', balance_principal_refunded_cents, 'tip_refunded_cents', tip_refunded_cents,
           'unclassified_refunded_cents', unclassified_refunded_cents) ORDER BY operation_index), '[]'::jsonb)
    INTO v_rows FROM public.order_refunds WHERE operation_key = p_operation_key;
  RETURN jsonb_build_object('outcome', 'reserved', 'request_allocation', v_sig, 'refunds', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_refund_allocation(uuid, text, jsonb, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_refund_allocation(uuid, text, jsonb, text, uuid, integer) TO service_role;
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 327 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261024120000'; END IF;
END $bpcend$;
