-- BPC-DEV-EXECUTOR step 23/28; version 20261025120000; file 20261025120000_refund_overview_for_admin.sql; sha256_lf 84c8cb248fd92f2accd2779e09f138c868132fb91400df7a22f2ca72111f1c92; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261025120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261025120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261024120000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261025120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 22 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
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

  IF fp_all IS DISTINCT FROM '20e5c1d820ae37dfd9b47bfd3b2fdfc0' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261025120000 (expected 20e5c1d820ae37dfd9b47bfd3b2fdfc0, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261025120000_refund_overview_for_admin.sql
/*
  # Read-only refund overview for the Admin refund screen

  ## What this adds
  `order_refund_overview(order_id)`: one read-only statement that tells the Admin screen, for ONE order:
    - each successful card payment: what was collected as deposit principal, balance principal and tip; how much of each has been
      refunded, how much is reserved by refunds still in progress, and how much of each can certainly still be refunded;
    - every refund operation (all the rows that share an operation key), with a verdict on whether the stored rows form one complete,
      consistent operation (so a screen opened later, or by another Admin, can resume exactly that operation);
    - every refund row, newest first, for the history display.

  ## What it does not do
  It writes nothing, calls no provider, and authorizes nothing: `reserve_refund_allocation` remains the only place a refund is
  accepted, and it repeats every rule below. This function exists so the screen shows the numbers the reservation will use, instead
  of re-deriving them in the browser.

  ## The capacity rules (the same as `reserve_refund_allocation`)
  For a payment with deposit principal D, balance principal B and tip T:
    consumed_c  = the component-c amount of its pending and succeeded refund rows that carry an allocation
    unknown     = amount of its pending and succeeded rows with NO allocation (amount-only, older, dashboard), plus any allocated
                  row's unclassified amount; when the order has exactly one refundable payment, older refund rows never linked to a
                  payment are added
    remaining   = payment amount - all its pending and succeeded refunds (and those unlinked rows, as above)
    available_c = max(0, min(component_c - consumed_c - unknown, remaining))
  A payment that is not a Stripe card payment, has no recorded split, or sits on an order that has unlinked older refund rows beside
  several refundable payments, has nothing available and says why.

  ## Authority
  SECURITY INVOKER: it runs with the caller's own rights, so the staff-only row security on payments and order_refunds applies, and a
  guard returns NULL (not an empty overview) unless the caller is an Admin / Master or the service role. Crew, customers and
  anonymous callers get NULL or are refused. It is STABLE and one statement, so the figures describe one snapshot.
*/

CREATE OR REPLACE FUNCTION public.order_refund_overview(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH gate AS (
    SELECT o.id FROM public.orders o
    WHERE o.id = p_order_id AND (current_user = 'service_role' OR public.is_admin())
  ),
  pay AS (
    SELECT p.* FROM public.payments p
    WHERE p.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
      AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL
  ),
  refundable_n AS (
    SELECT COUNT(*)::int AS n FROM pay p
    WHERE p.stripe_payment_intent_id IS NOT NULL AND lower(COALESCE(p.payment_method, '')) NOT IN ('cash', 'check')
  ),
  unl AS (
    SELECT COALESCE(SUM(r.amount_cents), 0)::bigint AS cents FROM public.order_refunds r
    WHERE r.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
      AND r.payment_id IS NULL AND r.status IN ('pending', 'succeeded')
  ),
  per AS (
    SELECT p.id, p.type, p.paid_at, p.created_at, p.amount_cents, p.payment_method, p.payment_brand, p.payment_last4,
      (p.stripe_payment_intent_id IS NOT NULL AND lower(COALESCE(p.payment_method, '')) NOT IN ('cash', 'check')) AS refundable,
      (p.principal_amount_cents IS NOT NULL AND p.tip_amount_cents IS NOT NULL AND p.deposit_principal_cents IS NOT NULL AND p.balance_principal_cents IS NOT NULL) AS classified,
      COALESCE(p.deposit_principal_cents, 0)::bigint AS dep, COALESCE(p.balance_principal_cents, 0)::bigint AS bal, COALESCE(p.tip_amount_cents, 0)::bigint AS tip,
      a.s_d, a.s_b, a.s_t, a.s_u, a.p_d, a.p_b, a.p_t, a.p_u, a.cons
    FROM pay p
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(SUM(r.deposit_principal_refunded_cents) FILTER (WHERE r.status = 'succeeded' AND r.allocation_version = 1), 0)::bigint AS s_d,
        COALESCE(SUM(r.balance_principal_refunded_cents) FILTER (WHERE r.status = 'succeeded' AND r.allocation_version = 1), 0)::bigint AS s_b,
        COALESCE(SUM(r.tip_refunded_cents) FILTER (WHERE r.status = 'succeeded' AND r.allocation_version = 1), 0)::bigint AS s_t,
        COALESCE(SUM(CASE WHEN r.allocation_version = 1 THEN r.unclassified_refunded_cents ELSE r.amount_cents END) FILTER (WHERE r.status = 'succeeded'), 0)::bigint AS s_u,
        COALESCE(SUM(r.deposit_principal_refunded_cents) FILTER (WHERE r.status = 'pending' AND r.allocation_version = 1), 0)::bigint AS p_d,
        COALESCE(SUM(r.balance_principal_refunded_cents) FILTER (WHERE r.status = 'pending' AND r.allocation_version = 1), 0)::bigint AS p_b,
        COALESCE(SUM(r.tip_refunded_cents) FILTER (WHERE r.status = 'pending' AND r.allocation_version = 1), 0)::bigint AS p_t,
        COALESCE(SUM(CASE WHEN r.allocation_version = 1 THEN r.unclassified_refunded_cents ELSE r.amount_cents END) FILTER (WHERE r.status = 'pending'), 0)::bigint AS p_u,
        COALESCE(SUM(r.amount_cents), 0)::bigint AS cons
      FROM public.order_refunds r WHERE r.payment_id = p.id AND r.status IN ('pending', 'succeeded')
    ) a
  ),
  calc AS (
    SELECT per.*,
      (per.s_u + per.p_u + CASE WHEN (SELECT n FROM refundable_n) = 1 THEN (SELECT cents FROM unl) ELSE 0 END) AS unknown,
      (per.amount_cents - per.cons - CASE WHEN (SELECT n FROM refundable_n) = 1 THEN (SELECT cents FROM unl) ELSE 0 END) AS rem_total,
      CASE WHEN NOT per.refundable THEN 'not_refundable'
           WHEN NOT per.classified THEN 'unclassified'
           WHEN (SELECT n FROM refundable_n) > 1 AND (SELECT cents FROM unl) > 0 THEN 'history_ambiguous'
      END AS reason_unavailable
    FROM per
  ),
  pays AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'type', c.type, 'paid_at', c.paid_at, 'created_at', c.created_at, 'amount_cents', c.amount_cents,
      'payment_method', c.payment_method, 'payment_brand', c.payment_brand, 'payment_last4', c.payment_last4,
      'refundable', c.refundable, 'classified', c.classified,
      'deposit_cents', c.dep, 'balance_cents', c.bal, 'tip_cents', c.tip,
      'refunded', jsonb_build_object('deposit_cents', c.s_d, 'balance_cents', c.s_b, 'tip_cents', c.s_t, 'unclassified_cents', c.s_u),
      'pending', jsonb_build_object('deposit_cents', c.p_d, 'balance_cents', c.p_b, 'tip_cents', c.p_t, 'unclassified_cents', c.p_u),
      'remaining_total_cents', GREATEST(0, c.rem_total),
      'has_unclassified_history', c.unknown > 0,
      'reason_unavailable', c.reason_unavailable,
      'available', jsonb_build_object(
        'deposit_cents', CASE WHEN c.reason_unavailable IS NULL THEN GREATEST(0, LEAST(c.dep - c.s_d - c.p_d - c.unknown, c.rem_total)) ELSE 0 END,
        'balance_cents', CASE WHEN c.reason_unavailable IS NULL THEN GREATEST(0, LEAST(c.bal - c.s_b - c.p_b - c.unknown, c.rem_total)) ELSE 0 END,
        'tip_cents', CASE WHEN c.reason_unavailable IS NULL THEN GREATEST(0, LEAST(c.tip - c.s_t - c.p_t - c.unknown, c.rem_total)) ELSE 0 END
      )
    ) ORDER BY c.created_at, c.id) AS j FROM calc c
  ),
  ops AS (
    SELECT r.operation_key,
      MIN(r.created_at) AS created_at,
      COUNT(*)::int AS n,
      COALESCE(BOOL_OR(r.status = 'pending'), false) AS unfinished,
      MAX(r.request_amount_cents) AS request_amount_cents,
      CASE WHEN BOOL_AND(r.allocation_version IS NULL) THEN 'amount_only'
           WHEN BOOL_AND(r.allocation_version = 1) THEN 'allocated'
           ELSE 'mixed' END AS kind,
      MAX(r.request_allocation) AS request_allocation,
      -- The stored rows form ONE complete operation: contiguous indexes from 0, one request total that the rows add up to, and for an
      -- allocated operation one stored identity that is exactly the one the rows themselves produce (no component left unclassified).
      (COUNT(DISTINCT r.operation_index) = COUNT(*) AND MIN(r.operation_index) = 0 AND MAX(r.operation_index) = COUNT(*) - 1
        AND MIN(r.request_amount_cents) = MAX(r.request_amount_cents) AND SUM(r.amount_cents) = MAX(r.request_amount_cents)
        AND (
          BOOL_AND(r.allocation_version IS NULL)
          OR (
            BOOL_AND(r.allocation_version = 1) AND BOOL_AND(r.unclassified_refunded_cents = 0) AND BOOL_AND(r.payment_id IS NOT NULL)
            AND COUNT(DISTINCT r.payment_id) = COUNT(*) AND COUNT(DISTINCT r.request_allocation) = 1
            AND MAX(r.request_allocation) = 'v1|total=' || SUM(r.amount_cents)::text || '|' ||
                string_agg(r.payment_id::text || ':' || r.deposit_principal_refunded_cents::text || ':' || r.balance_principal_refunded_cents::text || ':' || r.tip_refunded_cents::text,
                           '|' ORDER BY r.payment_id::text COLLATE "C")
          )
        )) AS verified,
      jsonb_agg(jsonb_build_object(
        'id', r.id, 'operation_index', r.operation_index, 'payment_id', r.payment_id, 'amount_cents', r.amount_cents, 'status', r.status,
        'stripe_refund_id', r.stripe_refund_id, 'provider_attempted', r.provider_attempted_at IS NOT NULL, 'failure_reason', r.failure_reason,
        'created_at', r.created_at, 'reason', r.reason,
        'deposit_cents', r.deposit_principal_refunded_cents, 'balance_cents', r.balance_principal_refunded_cents,
        'tip_cents', r.tip_refunded_cents, 'unclassified_cents', r.unclassified_refunded_cents, 'allocation_version', r.allocation_version
      ) ORDER BY r.operation_index) AS rows
    FROM public.order_refunds r
    WHERE r.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate) AND r.operation_key IS NOT NULL
    GROUP BY r.operation_key
  ),
  opj AS (
    SELECT jsonb_agg(jsonb_build_object(
      'operation_key', o.operation_key, 'created_at', o.created_at, 'kind', o.kind, 'unfinished', o.unfinished,
      'verified', COALESCE(o.verified, false), 'request_amount_cents', o.request_amount_cents, 'request_allocation', o.request_allocation, 'rows', o.rows
    ) ORDER BY o.created_at DESC) AS j FROM ops o
  ),
  hist AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'operation_key', r.operation_key, 'payment_id', r.payment_id, 'amount_cents', r.amount_cents, 'status', r.status,
      'stripe_refund_id', r.stripe_refund_id, 'provider_attempted', r.provider_attempted_at IS NOT NULL, 'reason', r.reason, 'source', r.source,
      'created_at', r.created_at, 'allocation_version', r.allocation_version,
      'deposit_cents', r.deposit_principal_refunded_cents, 'balance_cents', r.balance_principal_refunded_cents,
      'tip_cents', r.tip_refunded_cents, 'unclassified_cents', r.unclassified_refunded_cents
    ) ORDER BY r.created_at DESC, r.id) AS j
    FROM public.order_refunds r WHERE r.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
  )
  SELECT jsonb_build_object(
    'order_id', p_order_id,
    'payments', COALESCE((SELECT j FROM pays), '[]'::jsonb),
    'operations', COALESCE((SELECT j FROM opj), '[]'::jsonb),
    'refunds', COALESCE((SELECT j FROM hist), '[]'::jsonb),
    'unlinked_history_cents', (SELECT cents FROM unl),
    'refundable_payment_count', (SELECT n FROM refundable_n)
  )
  FROM gate
$$;

REVOKE ALL ON FUNCTION public.order_refund_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_refund_overview(uuid) TO authenticated, service_role;
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

  IF fp_all IS DISTINCT FROM 'bee7c6f06047a0b03ffeffd38b6ed69a' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261025120000 (expected bee7c6f06047a0b03ffeffd38b6ed69a, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261025120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261025120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261025120000', 'refund_overview_for_admin', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=23/28; version=20261025120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=84c8cb248fd92f2accd2779e09f138c868132fb91400df7a22f2ca72111f1c92', $bpcsql$/*
  # Read-only refund overview for the Admin refund screen

  ## What this adds
  `order_refund_overview(order_id)`: one read-only statement that tells the Admin screen, for ONE order:
    - each successful card payment: what was collected as deposit principal, balance principal and tip; how much of each has been
      refunded, how much is reserved by refunds still in progress, and how much of each can certainly still be refunded;
    - every refund operation (all the rows that share an operation key), with a verdict on whether the stored rows form one complete,
      consistent operation (so a screen opened later, or by another Admin, can resume exactly that operation);
    - every refund row, newest first, for the history display.

  ## What it does not do
  It writes nothing, calls no provider, and authorizes nothing: `reserve_refund_allocation` remains the only place a refund is
  accepted, and it repeats every rule below. This function exists so the screen shows the numbers the reservation will use, instead
  of re-deriving them in the browser.

  ## The capacity rules (the same as `reserve_refund_allocation`)
  For a payment with deposit principal D, balance principal B and tip T:
    consumed_c  = the component-c amount of its pending and succeeded refund rows that carry an allocation
    unknown     = amount of its pending and succeeded rows with NO allocation (amount-only, older, dashboard), plus any allocated
                  row's unclassified amount; when the order has exactly one refundable payment, older refund rows never linked to a
                  payment are added
    remaining   = payment amount - all its pending and succeeded refunds (and those unlinked rows, as above)
    available_c = max(0, min(component_c - consumed_c - unknown, remaining))
  A payment that is not a Stripe card payment, has no recorded split, or sits on an order that has unlinked older refund rows beside
  several refundable payments, has nothing available and says why.

  ## Authority
  SECURITY INVOKER: it runs with the caller's own rights, so the staff-only row security on payments and order_refunds applies, and a
  guard returns NULL (not an empty overview) unless the caller is an Admin / Master or the service role. Crew, customers and
  anonymous callers get NULL or are refused. It is STABLE and one statement, so the figures describe one snapshot.
*/

CREATE OR REPLACE FUNCTION public.order_refund_overview(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH gate AS (
    SELECT o.id FROM public.orders o
    WHERE o.id = p_order_id AND (current_user = 'service_role' OR public.is_admin())
  ),
  pay AS (
    SELECT p.* FROM public.payments p
    WHERE p.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
      AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL
  ),
  refundable_n AS (
    SELECT COUNT(*)::int AS n FROM pay p
    WHERE p.stripe_payment_intent_id IS NOT NULL AND lower(COALESCE(p.payment_method, '')) NOT IN ('cash', 'check')
  ),
  unl AS (
    SELECT COALESCE(SUM(r.amount_cents), 0)::bigint AS cents FROM public.order_refunds r
    WHERE r.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
      AND r.payment_id IS NULL AND r.status IN ('pending', 'succeeded')
  ),
  per AS (
    SELECT p.id, p.type, p.paid_at, p.created_at, p.amount_cents, p.payment_method, p.payment_brand, p.payment_last4,
      (p.stripe_payment_intent_id IS NOT NULL AND lower(COALESCE(p.payment_method, '')) NOT IN ('cash', 'check')) AS refundable,
      (p.principal_amount_cents IS NOT NULL AND p.tip_amount_cents IS NOT NULL AND p.deposit_principal_cents IS NOT NULL AND p.balance_principal_cents IS NOT NULL) AS classified,
      COALESCE(p.deposit_principal_cents, 0)::bigint AS dep, COALESCE(p.balance_principal_cents, 0)::bigint AS bal, COALESCE(p.tip_amount_cents, 0)::bigint AS tip,
      a.s_d, a.s_b, a.s_t, a.s_u, a.p_d, a.p_b, a.p_t, a.p_u, a.cons
    FROM pay p
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(SUM(r.deposit_principal_refunded_cents) FILTER (WHERE r.status = 'succeeded' AND r.allocation_version = 1), 0)::bigint AS s_d,
        COALESCE(SUM(r.balance_principal_refunded_cents) FILTER (WHERE r.status = 'succeeded' AND r.allocation_version = 1), 0)::bigint AS s_b,
        COALESCE(SUM(r.tip_refunded_cents) FILTER (WHERE r.status = 'succeeded' AND r.allocation_version = 1), 0)::bigint AS s_t,
        COALESCE(SUM(CASE WHEN r.allocation_version = 1 THEN r.unclassified_refunded_cents ELSE r.amount_cents END) FILTER (WHERE r.status = 'succeeded'), 0)::bigint AS s_u,
        COALESCE(SUM(r.deposit_principal_refunded_cents) FILTER (WHERE r.status = 'pending' AND r.allocation_version = 1), 0)::bigint AS p_d,
        COALESCE(SUM(r.balance_principal_refunded_cents) FILTER (WHERE r.status = 'pending' AND r.allocation_version = 1), 0)::bigint AS p_b,
        COALESCE(SUM(r.tip_refunded_cents) FILTER (WHERE r.status = 'pending' AND r.allocation_version = 1), 0)::bigint AS p_t,
        COALESCE(SUM(CASE WHEN r.allocation_version = 1 THEN r.unclassified_refunded_cents ELSE r.amount_cents END) FILTER (WHERE r.status = 'pending'), 0)::bigint AS p_u,
        COALESCE(SUM(r.amount_cents), 0)::bigint AS cons
      FROM public.order_refunds r WHERE r.payment_id = p.id AND r.status IN ('pending', 'succeeded')
    ) a
  ),
  calc AS (
    SELECT per.*,
      (per.s_u + per.p_u + CASE WHEN (SELECT n FROM refundable_n) = 1 THEN (SELECT cents FROM unl) ELSE 0 END) AS unknown,
      (per.amount_cents - per.cons - CASE WHEN (SELECT n FROM refundable_n) = 1 THEN (SELECT cents FROM unl) ELSE 0 END) AS rem_total,
      CASE WHEN NOT per.refundable THEN 'not_refundable'
           WHEN NOT per.classified THEN 'unclassified'
           WHEN (SELECT n FROM refundable_n) > 1 AND (SELECT cents FROM unl) > 0 THEN 'history_ambiguous'
      END AS reason_unavailable
    FROM per
  ),
  pays AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'type', c.type, 'paid_at', c.paid_at, 'created_at', c.created_at, 'amount_cents', c.amount_cents,
      'payment_method', c.payment_method, 'payment_brand', c.payment_brand, 'payment_last4', c.payment_last4,
      'refundable', c.refundable, 'classified', c.classified,
      'deposit_cents', c.dep, 'balance_cents', c.bal, 'tip_cents', c.tip,
      'refunded', jsonb_build_object('deposit_cents', c.s_d, 'balance_cents', c.s_b, 'tip_cents', c.s_t, 'unclassified_cents', c.s_u),
      'pending', jsonb_build_object('deposit_cents', c.p_d, 'balance_cents', c.p_b, 'tip_cents', c.p_t, 'unclassified_cents', c.p_u),
      'remaining_total_cents', GREATEST(0, c.rem_total),
      'has_unclassified_history', c.unknown > 0,
      'reason_unavailable', c.reason_unavailable,
      'available', jsonb_build_object(
        'deposit_cents', CASE WHEN c.reason_unavailable IS NULL THEN GREATEST(0, LEAST(c.dep - c.s_d - c.p_d - c.unknown, c.rem_total)) ELSE 0 END,
        'balance_cents', CASE WHEN c.reason_unavailable IS NULL THEN GREATEST(0, LEAST(c.bal - c.s_b - c.p_b - c.unknown, c.rem_total)) ELSE 0 END,
        'tip_cents', CASE WHEN c.reason_unavailable IS NULL THEN GREATEST(0, LEAST(c.tip - c.s_t - c.p_t - c.unknown, c.rem_total)) ELSE 0 END
      )
    ) ORDER BY c.created_at, c.id) AS j FROM calc c
  ),
  ops AS (
    SELECT r.operation_key,
      MIN(r.created_at) AS created_at,
      COUNT(*)::int AS n,
      COALESCE(BOOL_OR(r.status = 'pending'), false) AS unfinished,
      MAX(r.request_amount_cents) AS request_amount_cents,
      CASE WHEN BOOL_AND(r.allocation_version IS NULL) THEN 'amount_only'
           WHEN BOOL_AND(r.allocation_version = 1) THEN 'allocated'
           ELSE 'mixed' END AS kind,
      MAX(r.request_allocation) AS request_allocation,
      -- The stored rows form ONE complete operation: contiguous indexes from 0, one request total that the rows add up to, and for an
      -- allocated operation one stored identity that is exactly the one the rows themselves produce (no component left unclassified).
      (COUNT(DISTINCT r.operation_index) = COUNT(*) AND MIN(r.operation_index) = 0 AND MAX(r.operation_index) = COUNT(*) - 1
        AND MIN(r.request_amount_cents) = MAX(r.request_amount_cents) AND SUM(r.amount_cents) = MAX(r.request_amount_cents)
        AND (
          BOOL_AND(r.allocation_version IS NULL)
          OR (
            BOOL_AND(r.allocation_version = 1) AND BOOL_AND(r.unclassified_refunded_cents = 0) AND BOOL_AND(r.payment_id IS NOT NULL)
            AND COUNT(DISTINCT r.payment_id) = COUNT(*) AND COUNT(DISTINCT r.request_allocation) = 1
            AND MAX(r.request_allocation) = 'v1|total=' || SUM(r.amount_cents)::text || '|' ||
                string_agg(r.payment_id::text || ':' || r.deposit_principal_refunded_cents::text || ':' || r.balance_principal_refunded_cents::text || ':' || r.tip_refunded_cents::text,
                           '|' ORDER BY r.payment_id::text COLLATE "C")
          )
        )) AS verified,
      jsonb_agg(jsonb_build_object(
        'id', r.id, 'operation_index', r.operation_index, 'payment_id', r.payment_id, 'amount_cents', r.amount_cents, 'status', r.status,
        'stripe_refund_id', r.stripe_refund_id, 'provider_attempted', r.provider_attempted_at IS NOT NULL, 'failure_reason', r.failure_reason,
        'created_at', r.created_at, 'reason', r.reason,
        'deposit_cents', r.deposit_principal_refunded_cents, 'balance_cents', r.balance_principal_refunded_cents,
        'tip_cents', r.tip_refunded_cents, 'unclassified_cents', r.unclassified_refunded_cents, 'allocation_version', r.allocation_version
      ) ORDER BY r.operation_index) AS rows
    FROM public.order_refunds r
    WHERE r.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate) AND r.operation_key IS NOT NULL
    GROUP BY r.operation_key
  ),
  opj AS (
    SELECT jsonb_agg(jsonb_build_object(
      'operation_key', o.operation_key, 'created_at', o.created_at, 'kind', o.kind, 'unfinished', o.unfinished,
      'verified', COALESCE(o.verified, false), 'request_amount_cents', o.request_amount_cents, 'request_allocation', o.request_allocation, 'rows', o.rows
    ) ORDER BY o.created_at DESC) AS j FROM ops o
  ),
  hist AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'operation_key', r.operation_key, 'payment_id', r.payment_id, 'amount_cents', r.amount_cents, 'status', r.status,
      'stripe_refund_id', r.stripe_refund_id, 'provider_attempted', r.provider_attempted_at IS NOT NULL, 'reason', r.reason, 'source', r.source,
      'created_at', r.created_at, 'allocation_version', r.allocation_version,
      'deposit_cents', r.deposit_principal_refunded_cents, 'balance_cents', r.balance_principal_refunded_cents,
      'tip_cents', r.tip_refunded_cents, 'unclassified_cents', r.unclassified_refunded_cents
    ) ORDER BY r.created_at DESC, r.id) AS j
    FROM public.order_refunds r WHERE r.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
  )
  SELECT jsonb_build_object(
    'order_id', p_order_id,
    'payments', COALESCE((SELECT j FROM pays), '[]'::jsonb),
    'operations', COALESCE((SELECT j FROM opj), '[]'::jsonb),
    'refunds', COALESCE((SELECT j FROM hist), '[]'::jsonb),
    'unlinked_history_cents', (SELECT cents FROM unl),
    'refundable_payment_count', (SELECT n FROM refundable_n)
  )
  FROM gate
$$;

REVOKE ALL ON FUNCTION public.order_refund_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_refund_overview(uuid) TO authenticated, service_role;
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 328 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261025120000'; END IF;
END $bpcend$;
