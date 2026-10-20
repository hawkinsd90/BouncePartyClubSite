-- BPC-DEV-EXECUTOR step 21/28; version 20261023120000; file 20261023120000_refund_allocation_schema.sql; sha256_lf 371b5e99b0188103b580ff91a66ce202ed7d785fc8399896e66db8c37c4bb31b; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261023120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261022120000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261023120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 20 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
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

  IF fp_all IS DISTINCT FROM '4f8a66e1f504df0efd287f2732fd9fda' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261023120000 (expected 4f8a66e1f504df0efd287f2732fd9fda, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261023120000_refund_allocation_schema.sql
/*
  # Refund component allocation: schema and read-only net financials (database foundation)

  ## What this adds
  1. Six NULLABLE columns on `order_refunds` that can record WHICH part of a payment a refund returned: deposit principal, balance
     principal, tip, or "unclassified" (the split is not known).
  2. One CHECK constraint that keeps those columns coherent.
  3. `order_net_financials(order_id)`: a read-only function that totals what was recorded as collected and returned, and says
     plainly when the split between rental and tip cannot be known.

  ## What this does NOT do
  Nothing writes the new columns yet. Refund reservation, the Stripe refund function, the webhook, the transition function, the
  payment claim / finalize functions, the order columns and every UI are unchanged. No row is rewritten. The function only reads.

  ## Representation
    allocation_version NULL   no allocation was recorded. This is every refund row that exists today (legacy rows and ledger-version-2
                              rows alike) and every amount-only refund created by the current functions. Such a row's whole
                              amount is treated as UNCLASSIFIED in the net figures; it is never guessed to be principal or tip.
    allocation_version 1      an explicit allocation: the four amounts are present, nonnegative and total `amount_cents`, and the
                              canonical request signature is recorded.

  ## Why the constraint is added NOT VALID and then validated
  A NOT VALID constraint is skipped for rows that already exist, but it IS checked against the new version of any row that is
  later UPDATED, so it cannot be used to let old rows "pass" a stricter rule. The rule here is written so that the legacy shape
  (all new columns NULL) is one of the two allowed shapes: an old row stays valid when its status, provider id or total_applied
  flag changes, because those updates leave the new columns NULL. NOT VALID + VALIDATE is used only to keep the lock short
  (VALIDATE takes SHARE UPDATE EXCLUSIVE, so refunds are not blocked). Validation succeeds because every existing row has the
  legacy shape.

  Three-valued logic matters in a CHECK (a NULL result PASSES), so the rule never relies on a comparison with a possibly NULL value
  being false: presence is tested with IS [NOT] NULL and the version with COALESCE.

  ## net_financials authority
  SECURITY INVOKER: the function runs with the caller's own privileges, so the existing staff-only RLS on `payments` and
  `order_refunds` applies and nothing is exposed that the caller could not already read. A guard additionally returns NULL
  (not zeros) unless the caller is an Admin / Master (`is_admin()`) or the service role. Crew and customers get NULL. anon cannot
  execute it.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- Columns (no defaults: existing rows stay NULL = "no allocation recorded")
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.order_refunds
  ADD COLUMN IF NOT EXISTS allocation_version smallint,
  ADD COLUMN IF NOT EXISTS deposit_principal_refunded_cents integer,
  ADD COLUMN IF NOT EXISTS balance_principal_refunded_cents integer,
  ADD COLUMN IF NOT EXISTS tip_refunded_cents integer,
  ADD COLUMN IF NOT EXISTS unclassified_refunded_cents integer,
  ADD COLUMN IF NOT EXISTS request_allocation text;

-- ---------------------------------------------------------------------------------------------------------------------
-- Constraint
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_refunds_allocation_shape' AND conrelid = 'public.order_refunds'::regclass) THEN
    ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_allocation_shape CHECK (
      (
        allocation_version IS NULL
        AND deposit_principal_refunded_cents IS NULL
        AND balance_principal_refunded_cents IS NULL
        AND tip_refunded_cents IS NULL
        AND unclassified_refunded_cents IS NULL
        AND request_allocation IS NULL
      )
      OR
      (
        COALESCE(allocation_version, 0) = 1
        AND deposit_principal_refunded_cents IS NOT NULL
        AND balance_principal_refunded_cents IS NOT NULL
        AND tip_refunded_cents IS NOT NULL
        AND unclassified_refunded_cents IS NOT NULL
        AND request_allocation IS NOT NULL
        AND btrim(request_allocation) <> ''
        AND amount_cents IS NOT NULL
        AND deposit_principal_refunded_cents >= 0
        AND balance_principal_refunded_cents >= 0
        AND tip_refunded_cents >= 0
        AND unclassified_refunded_cents >= 0
        AND deposit_principal_refunded_cents::bigint + balance_principal_refunded_cents::bigint
            + tip_refunded_cents::bigint + unclassified_refunded_cents::bigint = amount_cents::bigint
      )
    ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.order_refunds VALIDATE CONSTRAINT order_refunds_allocation_shape;

-- ---------------------------------------------------------------------------------------------------------------------
-- order_net_financials
-- ---------------------------------------------------------------------------------------------------------------------
-- One SQL statement: it reads one snapshot, so the figures always describe a state the ledger really had.
--
-- Collected = every payment of the order that is succeeded, positive, and not a refund copy (Stripe, cash and check alike).
-- Returned  = succeeded `order_refunds` rows. The negative `payments` rows that copy a refund are NEVER subtracted (they are only
--             reported as a cross-check), so a refund is never subtracted twice.
-- A figure is "exact" only when nothing in the order is unclassified or unsettled; otherwise it is NULL, never a guess.
--
-- Every figure is what THIS SYSTEM RECORDED. Nothing is reconciled against Stripe or a bank, and "exact" means "fully classified in
-- our own records", not "verified against the provider". `recorded_only` is TRUE when the order holds a payment with no PaymentIntent
-- (cash / check): the system has no record of any refund of such a payment, so money returned outside Stripe cannot appear in the
-- figures. FALSE does not mean the order has been reconciled with anything.
CREATE OR REPLACE FUNCTION public.order_net_financials(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH gate AS (
    SELECT o.deposit_paid_cents AS cached_deposit_paid_cents,
           o.balance_paid_cents AS cached_balance_paid_cents,
           o.total_refunded_cents AS cached_total_refunded_cents
    FROM public.orders o
    WHERE o.id = p_order_id
      AND (current_user = 'service_role' OR public.is_admin())
  ),
  pay AS (
    SELECT p.* FROM public.payments p
    WHERE p.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
      AND p.status = 'succeeded' AND p.amount_cents > 0
      AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL
  ),
  pagg AS (
    SELECT
      COALESCE(SUM(amount_cents), 0)::bigint AS gross_recorded,
      COALESCE(SUM(deposit_principal_cents) FILTER (WHERE principal_amount_cents IS NOT NULL), 0)::bigint AS known_gross_deposit,
      COALESCE(SUM(balance_principal_cents) FILTER (WHERE principal_amount_cents IS NOT NULL), 0)::bigint AS known_gross_balance,
      COALESCE(SUM(tip_amount_cents) FILTER (WHERE principal_amount_cents IS NOT NULL), 0)::bigint AS known_gross_tips,
      COALESCE(SUM(amount_cents) FILTER (WHERE principal_amount_cents IS NULL), 0)::bigint AS unclassified_gross,
      COALESCE(BOOL_OR(stripe_payment_intent_id IS NULL), false) AS offline_payments_present
    FROM pay
  ),
  legacy AS (
    -- A positive payment whose status says "refunded" is not counted as collected (the old status carries no amount), and the
    -- order cannot be called exact while one exists.
    SELECT COUNT(*)::bigint AS legacy_refunded_status_payments
    FROM public.payments p
    WHERE p.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
      AND p.status = 'refunded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL
  ),
  -- The negative payment rows that mirror a refund. They are NEVER subtracted (the refund is taken from order_refunds); they are
  -- evidence, compared ONE-TO-ONE with the refund ledger by provider refund id:
  --   a copy is "backed" only if it is the single best copy of a succeeded refund with the same provider id AND the same amount.
  --   unbacked  every other succeeded negative row: no refund of that id (an older or unlinked row), an amount that disagrees with
  --             the refund, or an extra copy of a refund that already has one (a duplicate). Money may have been returned that
  --             order_refunds does not show, so the order is not exact.
  --   duplicates  how many extra copies of one provider refund exist (a subset of unbacked; the database normally forbids them by
  --             a unique index, so this is defence for databases where the index could not exist).
  --   missing   a succeeded ledger-version-2 refund that has no copy of the right amount. The refund is still counted from
  --             order_refunds, so this is harmless for the figures: it is reported, and does not make the order inexact.
  -- Nothing is deleted, rewritten or reclassified here: the evidence is only counted.
  copies AS (
    SELECT COALESCE(SUM(-x.amount_cents), 0)::bigint AS refund_copy_cents,
           COALESCE(SUM(-x.amount_cents) FILTER (WHERE x.refund_amount IS NULL OR x.refund_amount <> -x.amount_cents OR x.rn > 1), 0)::bigint AS unbacked_refund_copy_cents,
           COUNT(*) FILTER (WHERE x.stripe_refund_id IS NOT NULL AND x.rn > 1)::bigint AS duplicate_refund_copies
    FROM (
      SELECT c.amount_cents, c.stripe_refund_id, m.amount_cents AS refund_amount,
             ROW_NUMBER() OVER (PARTITION BY c.stripe_refund_id ORDER BY (m.amount_cents = -c.amount_cents) DESC NULLS LAST, c.created_at, c.id) AS rn
      FROM public.payments c
      LEFT JOIN LATERAL (
        SELECT r.amount_cents FROM public.order_refunds r
        WHERE r.order_id = c.order_id AND r.status = 'succeeded' AND c.stripe_refund_id IS NOT NULL AND r.stripe_refund_id = c.stripe_refund_id
        ORDER BY (r.amount_cents = -c.amount_cents) DESC, r.created_at LIMIT 1
      ) m ON true
      WHERE c.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
        AND c.status = 'succeeded' AND c.amount_cents < 0
    ) x
  ),
  missing AS (
    SELECT COALESCE(SUM(r.amount_cents), 0)::bigint AS missing_refund_copy_cents
    FROM public.order_refunds r
    WHERE r.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
      AND r.status = 'succeeded' AND r.ledger_version = 2 AND r.stripe_refund_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payments c
        WHERE c.order_id = r.order_id AND c.stripe_refund_id = r.stripe_refund_id AND c.status = 'succeeded'
          AND c.amount_cents = -r.amount_cents
      )
  ),
  ragg AS (
    SELECT
      COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded'), 0)::bigint AS total_succeeded,
      COALESCE(SUM(deposit_principal_refunded_cents) FILTER (WHERE status = 'succeeded' AND allocation_version = 1), 0)::bigint AS deposit_refunded,
      COALESCE(SUM(balance_principal_refunded_cents) FILTER (WHERE status = 'succeeded' AND allocation_version = 1), 0)::bigint AS balance_refunded,
      COALESCE(SUM(tip_refunded_cents) FILTER (WHERE status = 'succeeded' AND allocation_version = 1), 0)::bigint AS tips_refunded,
      COALESCE(SUM(CASE WHEN allocation_version = 1 THEN unclassified_refunded_cents ELSE amount_cents END) FILTER (WHERE status = 'succeeded'), 0)::bigint AS unclassified_succeeded,
      COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0)::bigint AS pending_reservations,
      COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending' AND ledger_version IS NULL), 0)::bigint AS historic_unsettled,
      COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded' AND ledger_version = 2), 0)::bigint AS v2_succeeded
    FROM public.order_refunds
    WHERE order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
  ),
  dups AS (
    -- The same provider refund recorded twice (legacy rows were never made unique): reported, not silently merged.
    SELECT COUNT(*)::bigint AS duplicate_refund_ids FROM (
      SELECT stripe_refund_id FROM public.order_refunds
      WHERE order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
        AND stripe_refund_id IS NOT NULL AND status IN ('pending', 'succeeded')
      GROUP BY stripe_refund_id HAVING COUNT(*) > 1
    ) d
  ),
  calc AS (
    SELECT
      pagg.*, ragg.*, legacy.*, copies.*, missing.*, dups.*, gate.*,
      (pagg.known_gross_deposit + pagg.known_gross_balance) AS known_gross_principal,
      (ragg.deposit_refunded + ragg.balance_refunded) AS known_principal_refunded,
      (pagg.known_gross_deposit - ragg.deposit_refunded) AS known_net_deposit,
      (pagg.known_gross_balance - ragg.balance_refunded) AS known_net_balance,
      (pagg.known_gross_tips - ragg.tips_refunded) AS known_net_tips
    FROM gate, pagg, ragg, legacy, copies, missing, dups
  ),
  flags AS (
    SELECT calc.*,
      (known_net_deposit < 0 OR known_net_balance < 0 OR known_net_tips < 0 OR gross_recorded - total_succeeded < 0) AS inconsistent,
      (unclassified_gross > 0 OR unclassified_succeeded > 0) AS has_unclassified,
      (unclassified_gross = 0 AND unclassified_succeeded = 0 AND historic_unsettled = 0 AND legacy_refunded_status_payments = 0
        AND duplicate_refund_ids = 0 AND unbacked_refund_copy_cents = 0
        AND NOT (known_net_deposit < 0 OR known_net_balance < 0 OR known_net_tips < 0 OR gross_recorded - total_succeeded < 0)) AS complete
    FROM calc
  )
  SELECT jsonb_build_object(
    'gross_recorded_payments_cents', gross_recorded,
    'known_gross_deposit_principal_cents', known_gross_deposit,
    'known_gross_balance_principal_cents', known_gross_balance,
    'known_gross_principal_cents', known_gross_principal,
    'known_gross_tips_cents', known_gross_tips,
    'unclassified_gross_payments_cents', unclassified_gross,
    'total_succeeded_refunds_cents', total_succeeded,
    'deposit_principal_refunded_cents', deposit_refunded,
    'balance_principal_refunded_cents', balance_refunded,
    'known_principal_refunded_cents', known_principal_refunded,
    'tips_refunded_cents', tips_refunded,
    'unclassified_succeeded_refunds_cents', unclassified_succeeded,
    'pending_refund_reservations_cents', pending_reservations,
    'recorded_net_cash_retained_cents', gross_recorded - total_succeeded,
    'known_net_deposit_principal_cents', known_net_deposit,
    'known_net_balance_principal_cents', known_net_balance,
    'known_net_principal_cents', known_net_deposit + known_net_balance,
    'known_net_tips_cents', known_net_tips,
    'net_principal_exact_cents', CASE WHEN complete THEN known_net_deposit + known_net_balance END,
    'net_tips_exact_cents', CASE WHEN complete THEN known_net_tips END,
    'classification_complete', complete,
    'exact_net_available', complete,
    'recorded_only', offline_payments_present,
    'offline_refunds_tracked', false,
    'historic_unsettled_refunds_cents', historic_unsettled,
    'legacy_refunded_status_payments', legacy_refunded_status_payments,
    'duplicate_refund_ids', duplicate_refund_ids,
    'inconsistent', inconsistent,
    'has_unclassified_transactions', has_unclassified,
    'refund_copy_cents', refund_copy_cents,
    'unbacked_refund_copy_cents', unbacked_refund_copy_cents,
    'duplicate_refund_copies', duplicate_refund_copies,
    'missing_refund_copy_cents', missing_refund_copy_cents,
    'refund_copies_match_ledger', refund_copy_cents = v2_succeeded,
    'cached_deposit_paid_cents', cached_deposit_paid_cents,
    'cached_balance_paid_cents', cached_balance_paid_cents,
    'cached_total_refunded_cents', cached_total_refunded_cents,
    'cached_principal_matches_ledger',
      CASE WHEN unclassified_gross > 0 THEN NULL
           ELSE COALESCE(cached_deposit_paid_cents, 0) + COALESCE(cached_balance_paid_cents, 0) = known_gross_principal END
  )
  FROM flags
$$;

REVOKE ALL ON FUNCTION public.order_net_financials(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_net_financials(uuid) TO authenticated, service_role;
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

  IF fp_all IS DISTINCT FROM 'ec8a31d7d4268f914d36664a7d2ffd01' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261023120000 (expected ec8a31d7d4268f914d36664a7d2ffd01, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261023120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261023120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261023120000', 'refund_allocation_schema', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=21/28; version=20261023120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=371b5e99b0188103b580ff91a66ce202ed7d785fc8399896e66db8c37c4bb31b', $bpcsql$/*
  # Refund component allocation: schema and read-only net financials (database foundation)

  ## What this adds
  1. Six NULLABLE columns on `order_refunds` that can record WHICH part of a payment a refund returned: deposit principal, balance
     principal, tip, or "unclassified" (the split is not known).
  2. One CHECK constraint that keeps those columns coherent.
  3. `order_net_financials(order_id)`: a read-only function that totals what was recorded as collected and returned, and says
     plainly when the split between rental and tip cannot be known.

  ## What this does NOT do
  Nothing writes the new columns yet. Refund reservation, the Stripe refund function, the webhook, the transition function, the
  payment claim / finalize functions, the order columns and every UI are unchanged. No row is rewritten. The function only reads.

  ## Representation
    allocation_version NULL   no allocation was recorded. This is every refund row that exists today (legacy rows and ledger-version-2
                              rows alike) and every amount-only refund created by the current functions. Such a row's whole
                              amount is treated as UNCLASSIFIED in the net figures; it is never guessed to be principal or tip.
    allocation_version 1      an explicit allocation: the four amounts are present, nonnegative and total `amount_cents`, and the
                              canonical request signature is recorded.

  ## Why the constraint is added NOT VALID and then validated
  A NOT VALID constraint is skipped for rows that already exist, but it IS checked against the new version of any row that is
  later UPDATED, so it cannot be used to let old rows "pass" a stricter rule. The rule here is written so that the legacy shape
  (all new columns NULL) is one of the two allowed shapes: an old row stays valid when its status, provider id or total_applied
  flag changes, because those updates leave the new columns NULL. NOT VALID + VALIDATE is used only to keep the lock short
  (VALIDATE takes SHARE UPDATE EXCLUSIVE, so refunds are not blocked). Validation succeeds because every existing row has the
  legacy shape.

  Three-valued logic matters in a CHECK (a NULL result PASSES), so the rule never relies on a comparison with a possibly NULL value
  being false: presence is tested with IS [NOT] NULL and the version with COALESCE.

  ## net_financials authority
  SECURITY INVOKER: the function runs with the caller's own privileges, so the existing staff-only RLS on `payments` and
  `order_refunds` applies and nothing is exposed that the caller could not already read. A guard additionally returns NULL
  (not zeros) unless the caller is an Admin / Master (`is_admin()`) or the service role. Crew and customers get NULL. anon cannot
  execute it.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- Columns (no defaults: existing rows stay NULL = "no allocation recorded")
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.order_refunds
  ADD COLUMN IF NOT EXISTS allocation_version smallint,
  ADD COLUMN IF NOT EXISTS deposit_principal_refunded_cents integer,
  ADD COLUMN IF NOT EXISTS balance_principal_refunded_cents integer,
  ADD COLUMN IF NOT EXISTS tip_refunded_cents integer,
  ADD COLUMN IF NOT EXISTS unclassified_refunded_cents integer,
  ADD COLUMN IF NOT EXISTS request_allocation text;

-- ---------------------------------------------------------------------------------------------------------------------
-- Constraint
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_refunds_allocation_shape' AND conrelid = 'public.order_refunds'::regclass) THEN
    ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_allocation_shape CHECK (
      (
        allocation_version IS NULL
        AND deposit_principal_refunded_cents IS NULL
        AND balance_principal_refunded_cents IS NULL
        AND tip_refunded_cents IS NULL
        AND unclassified_refunded_cents IS NULL
        AND request_allocation IS NULL
      )
      OR
      (
        COALESCE(allocation_version, 0) = 1
        AND deposit_principal_refunded_cents IS NOT NULL
        AND balance_principal_refunded_cents IS NOT NULL
        AND tip_refunded_cents IS NOT NULL
        AND unclassified_refunded_cents IS NOT NULL
        AND request_allocation IS NOT NULL
        AND btrim(request_allocation) <> ''
        AND amount_cents IS NOT NULL
        AND deposit_principal_refunded_cents >= 0
        AND balance_principal_refunded_cents >= 0
        AND tip_refunded_cents >= 0
        AND unclassified_refunded_cents >= 0
        AND deposit_principal_refunded_cents::bigint + balance_principal_refunded_cents::bigint
            + tip_refunded_cents::bigint + unclassified_refunded_cents::bigint = amount_cents::bigint
      )
    ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.order_refunds VALIDATE CONSTRAINT order_refunds_allocation_shape;

-- ---------------------------------------------------------------------------------------------------------------------
-- order_net_financials
-- ---------------------------------------------------------------------------------------------------------------------
-- One SQL statement: it reads one snapshot, so the figures always describe a state the ledger really had.
--
-- Collected = every payment of the order that is succeeded, positive, and not a refund copy (Stripe, cash and check alike).
-- Returned  = succeeded `order_refunds` rows. The negative `payments` rows that copy a refund are NEVER subtracted (they are only
--             reported as a cross-check), so a refund is never subtracted twice.
-- A figure is "exact" only when nothing in the order is unclassified or unsettled; otherwise it is NULL, never a guess.
--
-- Every figure is what THIS SYSTEM RECORDED. Nothing is reconciled against Stripe or a bank, and "exact" means "fully classified in
-- our own records", not "verified against the provider". `recorded_only` is TRUE when the order holds a payment with no PaymentIntent
-- (cash / check): the system has no record of any refund of such a payment, so money returned outside Stripe cannot appear in the
-- figures. FALSE does not mean the order has been reconciled with anything.
CREATE OR REPLACE FUNCTION public.order_net_financials(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH gate AS (
    SELECT o.deposit_paid_cents AS cached_deposit_paid_cents,
           o.balance_paid_cents AS cached_balance_paid_cents,
           o.total_refunded_cents AS cached_total_refunded_cents
    FROM public.orders o
    WHERE o.id = p_order_id
      AND (current_user = 'service_role' OR public.is_admin())
  ),
  pay AS (
    SELECT p.* FROM public.payments p
    WHERE p.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
      AND p.status = 'succeeded' AND p.amount_cents > 0
      AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL
  ),
  pagg AS (
    SELECT
      COALESCE(SUM(amount_cents), 0)::bigint AS gross_recorded,
      COALESCE(SUM(deposit_principal_cents) FILTER (WHERE principal_amount_cents IS NOT NULL), 0)::bigint AS known_gross_deposit,
      COALESCE(SUM(balance_principal_cents) FILTER (WHERE principal_amount_cents IS NOT NULL), 0)::bigint AS known_gross_balance,
      COALESCE(SUM(tip_amount_cents) FILTER (WHERE principal_amount_cents IS NOT NULL), 0)::bigint AS known_gross_tips,
      COALESCE(SUM(amount_cents) FILTER (WHERE principal_amount_cents IS NULL), 0)::bigint AS unclassified_gross,
      COALESCE(BOOL_OR(stripe_payment_intent_id IS NULL), false) AS offline_payments_present
    FROM pay
  ),
  legacy AS (
    -- A positive payment whose status says "refunded" is not counted as collected (the old status carries no amount), and the
    -- order cannot be called exact while one exists.
    SELECT COUNT(*)::bigint AS legacy_refunded_status_payments
    FROM public.payments p
    WHERE p.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
      AND p.status = 'refunded' AND p.amount_cents > 0 AND p.refunded_payment_id IS NULL
  ),
  -- The negative payment rows that mirror a refund. They are NEVER subtracted (the refund is taken from order_refunds); they are
  -- evidence, compared ONE-TO-ONE with the refund ledger by provider refund id:
  --   a copy is "backed" only if it is the single best copy of a succeeded refund with the same provider id AND the same amount.
  --   unbacked  every other succeeded negative row: no refund of that id (an older or unlinked row), an amount that disagrees with
  --             the refund, or an extra copy of a refund that already has one (a duplicate). Money may have been returned that
  --             order_refunds does not show, so the order is not exact.
  --   duplicates  how many extra copies of one provider refund exist (a subset of unbacked; the database normally forbids them by
  --             a unique index, so this is defence for databases where the index could not exist).
  --   missing   a succeeded ledger-version-2 refund that has no copy of the right amount. The refund is still counted from
  --             order_refunds, so this is harmless for the figures: it is reported, and does not make the order inexact.
  -- Nothing is deleted, rewritten or reclassified here: the evidence is only counted.
  copies AS (
    SELECT COALESCE(SUM(-x.amount_cents), 0)::bigint AS refund_copy_cents,
           COALESCE(SUM(-x.amount_cents) FILTER (WHERE x.refund_amount IS NULL OR x.refund_amount <> -x.amount_cents OR x.rn > 1), 0)::bigint AS unbacked_refund_copy_cents,
           COUNT(*) FILTER (WHERE x.stripe_refund_id IS NOT NULL AND x.rn > 1)::bigint AS duplicate_refund_copies
    FROM (
      SELECT c.amount_cents, c.stripe_refund_id, m.amount_cents AS refund_amount,
             ROW_NUMBER() OVER (PARTITION BY c.stripe_refund_id ORDER BY (m.amount_cents = -c.amount_cents) DESC NULLS LAST, c.created_at, c.id) AS rn
      FROM public.payments c
      LEFT JOIN LATERAL (
        SELECT r.amount_cents FROM public.order_refunds r
        WHERE r.order_id = c.order_id AND r.status = 'succeeded' AND c.stripe_refund_id IS NOT NULL AND r.stripe_refund_id = c.stripe_refund_id
        ORDER BY (r.amount_cents = -c.amount_cents) DESC, r.created_at LIMIT 1
      ) m ON true
      WHERE c.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
        AND c.status = 'succeeded' AND c.amount_cents < 0
    ) x
  ),
  missing AS (
    SELECT COALESCE(SUM(r.amount_cents), 0)::bigint AS missing_refund_copy_cents
    FROM public.order_refunds r
    WHERE r.order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
      AND r.status = 'succeeded' AND r.ledger_version = 2 AND r.stripe_refund_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payments c
        WHERE c.order_id = r.order_id AND c.stripe_refund_id = r.stripe_refund_id AND c.status = 'succeeded'
          AND c.amount_cents = -r.amount_cents
      )
  ),
  ragg AS (
    SELECT
      COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded'), 0)::bigint AS total_succeeded,
      COALESCE(SUM(deposit_principal_refunded_cents) FILTER (WHERE status = 'succeeded' AND allocation_version = 1), 0)::bigint AS deposit_refunded,
      COALESCE(SUM(balance_principal_refunded_cents) FILTER (WHERE status = 'succeeded' AND allocation_version = 1), 0)::bigint AS balance_refunded,
      COALESCE(SUM(tip_refunded_cents) FILTER (WHERE status = 'succeeded' AND allocation_version = 1), 0)::bigint AS tips_refunded,
      COALESCE(SUM(CASE WHEN allocation_version = 1 THEN unclassified_refunded_cents ELSE amount_cents END) FILTER (WHERE status = 'succeeded'), 0)::bigint AS unclassified_succeeded,
      COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0)::bigint AS pending_reservations,
      COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending' AND ledger_version IS NULL), 0)::bigint AS historic_unsettled,
      COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded' AND ledger_version = 2), 0)::bigint AS v2_succeeded
    FROM public.order_refunds
    WHERE order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
  ),
  dups AS (
    -- The same provider refund recorded twice (legacy rows were never made unique): reported, not silently merged.
    SELECT COUNT(*)::bigint AS duplicate_refund_ids FROM (
      SELECT stripe_refund_id FROM public.order_refunds
      WHERE order_id = p_order_id AND EXISTS (SELECT 1 FROM gate)
        AND stripe_refund_id IS NOT NULL AND status IN ('pending', 'succeeded')
      GROUP BY stripe_refund_id HAVING COUNT(*) > 1
    ) d
  ),
  calc AS (
    SELECT
      pagg.*, ragg.*, legacy.*, copies.*, missing.*, dups.*, gate.*,
      (pagg.known_gross_deposit + pagg.known_gross_balance) AS known_gross_principal,
      (ragg.deposit_refunded + ragg.balance_refunded) AS known_principal_refunded,
      (pagg.known_gross_deposit - ragg.deposit_refunded) AS known_net_deposit,
      (pagg.known_gross_balance - ragg.balance_refunded) AS known_net_balance,
      (pagg.known_gross_tips - ragg.tips_refunded) AS known_net_tips
    FROM gate, pagg, ragg, legacy, copies, missing, dups
  ),
  flags AS (
    SELECT calc.*,
      (known_net_deposit < 0 OR known_net_balance < 0 OR known_net_tips < 0 OR gross_recorded - total_succeeded < 0) AS inconsistent,
      (unclassified_gross > 0 OR unclassified_succeeded > 0) AS has_unclassified,
      (unclassified_gross = 0 AND unclassified_succeeded = 0 AND historic_unsettled = 0 AND legacy_refunded_status_payments = 0
        AND duplicate_refund_ids = 0 AND unbacked_refund_copy_cents = 0
        AND NOT (known_net_deposit < 0 OR known_net_balance < 0 OR known_net_tips < 0 OR gross_recorded - total_succeeded < 0)) AS complete
    FROM calc
  )
  SELECT jsonb_build_object(
    'gross_recorded_payments_cents', gross_recorded,
    'known_gross_deposit_principal_cents', known_gross_deposit,
    'known_gross_balance_principal_cents', known_gross_balance,
    'known_gross_principal_cents', known_gross_principal,
    'known_gross_tips_cents', known_gross_tips,
    'unclassified_gross_payments_cents', unclassified_gross,
    'total_succeeded_refunds_cents', total_succeeded,
    'deposit_principal_refunded_cents', deposit_refunded,
    'balance_principal_refunded_cents', balance_refunded,
    'known_principal_refunded_cents', known_principal_refunded,
    'tips_refunded_cents', tips_refunded,
    'unclassified_succeeded_refunds_cents', unclassified_succeeded,
    'pending_refund_reservations_cents', pending_reservations,
    'recorded_net_cash_retained_cents', gross_recorded - total_succeeded,
    'known_net_deposit_principal_cents', known_net_deposit,
    'known_net_balance_principal_cents', known_net_balance,
    'known_net_principal_cents', known_net_deposit + known_net_balance,
    'known_net_tips_cents', known_net_tips,
    'net_principal_exact_cents', CASE WHEN complete THEN known_net_deposit + known_net_balance END,
    'net_tips_exact_cents', CASE WHEN complete THEN known_net_tips END,
    'classification_complete', complete,
    'exact_net_available', complete,
    'recorded_only', offline_payments_present,
    'offline_refunds_tracked', false,
    'historic_unsettled_refunds_cents', historic_unsettled,
    'legacy_refunded_status_payments', legacy_refunded_status_payments,
    'duplicate_refund_ids', duplicate_refund_ids,
    'inconsistent', inconsistent,
    'has_unclassified_transactions', has_unclassified,
    'refund_copy_cents', refund_copy_cents,
    'unbacked_refund_copy_cents', unbacked_refund_copy_cents,
    'duplicate_refund_copies', duplicate_refund_copies,
    'missing_refund_copy_cents', missing_refund_copy_cents,
    'refund_copies_match_ledger', refund_copy_cents = v2_succeeded,
    'cached_deposit_paid_cents', cached_deposit_paid_cents,
    'cached_balance_paid_cents', cached_balance_paid_cents,
    'cached_total_refunded_cents', cached_total_refunded_cents,
    'cached_principal_matches_ledger',
      CASE WHEN unclassified_gross > 0 THEN NULL
           ELSE COALESCE(cached_deposit_paid_cents, 0) + COALESCE(cached_balance_paid_cents, 0) = known_gross_principal END
  )
  FROM flags
$$;

REVOKE ALL ON FUNCTION public.order_net_financials(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_net_financials(uuid) TO authenticated, service_role;
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 326 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261023120000'; END IF;
END $bpcend$;
