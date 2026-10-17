-- =====================================================================================================================
-- Stage E1: READ-ONLY Production data-precondition preflight for the 67-migration upgrade.
--
-- STATUS: PREPARED AND REVIEWED, NOT EXECUTED against Production or Development. Syntax and detection were validated only against local disposable
-- scratch databases that hold SYNTHETIC data (see e1-report.md). No current Production count is claimed anywhere.
--
-- How to run (only after the owner approves a hosted read-only step): use the approved G1 read-only method (direct psql with
-- default_transaction_read_only=on). Do not use the Supabase CLI. The script opens a READ ONLY transaction, so it cannot write.
--
-- Output: one row per check with an aggregate count or a boolean. No customer, payment, order or authentication row is returned or exported, and no
-- identifier is selected. Run it inside the window where the Production schema capture is still fresh (24 h) and compare the result with the expected value.
--
-- Pass rule: every row with pass_expected = 'zero' must be 0; 'true' must be true; 'info' rows are informational and need review, not a pass/fail.
-- These checks assume the PRE-UPGRADE Production schema (E1 verified it against the 2026-10-16 capture); P00 proves that assumption first.
-- =====================================================================================================================
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';

-- P00 schema-shape assumptions (all must be true; if any is false the other checks are not valid for the planned upgrade)
SELECT 'P00a'::text AS check_id, 'inventory/portal/menu tables not yet created (dev-line migrations will create them)' AS description,
       (to_regclass('public.inventory_products') IS NULL AND to_regclass('public.product_bundles') IS NULL AND to_regclass('public.product_pricing') IS NULL
        AND to_regclass('public.product_categories') IS NULL AND to_regclass('public.order_portal_links') IS NULL AND to_regclass('public.public_menu_groups') IS NULL)::text AS value, 'true'::text AS pass_expected
UNION ALL SELECT 'P00b', 'October columns not yet present (revoked_at, operation_key, ledger_version, allocation_version)',
       (NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND ((table_name='invoice_links' AND column_name='revoked_at') OR (table_name='payments' AND column_name IN ('operation_key','stripe_checkout_session_id','stripe_refund_id'))
                                                                                               OR (table_name='order_refunds' AND column_name IN ('ledger_version','allocation_version','operation_key')))))::text, 'true'
UNION ALL SELECT 'P00c', 'user_roles has no role CHECK and no foreign key (the K2 Production shape)',
       (NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_roles'::regclass AND contype IN ('c','f')))::text, 'info'
UNION ALL SELECT 'P00d', 'migration history row count (expected 277 before any reconciliation)', (SELECT count(*) FROM supabase_migrations.schema_migrations)::text, 'info'
UNION ALL SELECT 'P00e', 'migration history fingerprint md5(version list) for comparison with the Stage B capture', (SELECT md5(string_agg(version, ',' ORDER BY version)) FROM supabase_migrations.schema_migrations), 'info'

-- 20261016120000 role repair -------------------------------------------------------------------------------------------------------------
UNION ALL SELECT 'P01', 'role rows whose normalized value (lower(btrim)) is outside master/admin/crew/customer (the migration RAISES if > 0)',
       (SELECT count(*) FROM public.user_roles WHERE lower(btrim(role)) NOT IN ('master','admin','crew','customer'))::text, 'zero'
UNION ALL SELECT 'P02', 'role rows that are uppercase or padded and WILL be normalized (informational)', (SELECT count(*) FROM public.user_roles WHERE role <> lower(btrim(role)))::text, 'info'
UNION ALL SELECT 'P03', 'rows that WILL be deleted as duplicates once normalized (later duplicate of the same user and normalized role; informational)',
       (SELECT coalesce(sum(n - 1), 0) FROM (SELECT count(*) AS n FROM public.user_roles GROUP BY user_id, lower(btrim(role)) HAVING count(*) > 1) d)::text, 'info'
UNION ALL SELECT 'P04', 'orphan role rows (user no longer in auth.users) that WILL be deleted (informational)', (SELECT count(*) FROM public.user_roles ur WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ur.user_id))::text, 'info'
UNION ALL SELECT 'P05', 'auth.users is not empty (the migration RAISES when it is empty and no FK exists)', (EXISTS (SELECT 1 FROM auth.users))::text, 'true'
UNION ALL SELECT 'P06', 'role rows by normalized role: master / admin / crew / customer (aggregate counts only)',
       (SELECT string_agg(r || '=' || n, ', ' ORDER BY r) FROM (SELECT lower(btrim(role)) AS r, count(*) AS n FROM public.user_roles GROUP BY 1) s), 'info'
UNION ALL SELECT 'P07', 'users who hold more than one role row (aggregate; the role-repair assignment function replaces roles for the target only)', (SELECT count(*) FROM (SELECT user_id FROM public.user_roles GROUP BY user_id HAVING count(*) > 1) s)::text, 'info'

-- 20261019120000 payment uniqueness ---------------------------------------------------------------------------------------------------------
UNION ALL SELECT 'P10', 'PaymentIntent ids shared by more than one positive, non-refund payment (the unique index creation FAILS if > 0)',
       (SELECT count(*) FROM (SELECT stripe_payment_intent_id FROM public.payments WHERE stripe_payment_intent_id IS NOT NULL AND refunded_payment_id IS NULL AND amount_cents > 0 GROUP BY 1 HAVING count(*) > 1) d)::text, 'zero'
UNION ALL SELECT 'P11', 'payments by sign and refund link (aggregate: positive, negative, negative without refunded_payment_id; informational)',
       (SELECT 'positive=' || count(*) FILTER (WHERE amount_cents > 0) || ', negative=' || count(*) FILTER (WHERE amount_cents < 0) || ', negative_without_link=' || count(*) FILTER (WHERE amount_cents < 0 AND refunded_payment_id IS NULL) FROM public.payments), 'info'

-- 20261009120000 portal links ---------------------------------------------------------------------------------------------------------------
UNION ALL SELECT 'P12', 'orders with more than one portal link (revoked_at does not exist yet, so every portal link counts as active; the unique index FAILS if > 0)',
       (SELECT count(*) FROM (SELECT order_id FROM public.invoice_links WHERE link_type = 'portal' GROUP BY order_id HAVING count(*) > 1) d)::text, 'zero'

-- 20260716151458 order items ------------------------------------------------------------------------------------------------------------------
UNION ALL SELECT 'P13', 'order_items rows without a unit reference (the single-reference CHECK FAILS the migration if > 0)', (SELECT count(*) FROM public.order_items WHERE unit_id IS NULL)::text, 'zero'

-- NOT VALID constraints (do not fail the upgrade; they decide whether a LATER VALIDATE can succeed) -------------------------------------------------
UNION ALL SELECT 'P20', 'custom fees with a negative amount (order_custom_fees_amount_non_negative)', (SELECT count(*) FROM public.order_custom_fees WHERE amount_cents < 0)::text, 'zero'
UNION ALL SELECT 'P21', 'discounts with a negative amount, or a percentage below 0 or above 100 (order_discounts_amounts_valid)',
       (SELECT count(*) FROM public.order_discounts WHERE COALESCE(amount_cents, 0) < 0 OR COALESCE(percentage, 0) < 0 OR COALESCE(percentage, 0) > 100)::text, 'zero'
UNION ALL SELECT 'P22', 'refunds with amount <= 0 (order_refunds_amount_positive)', (SELECT count(*) FROM public.order_refunds WHERE amount_cents <= 0)::text, 'zero'
UNION ALL SELECT 'P23', 'refund rows total and by status (aggregate; the allocation and operation-shape constraints cannot be violated by existing rows because their columns do not exist yet)',
       (SELECT 'total=' || (SELECT count(*) FROM public.order_refunds) || ', ' || coalesce(string_agg(coalesce(status, 'null') || '=' || n, ', ' ORDER BY status), '') FROM (SELECT status, count(*) AS n FROM public.order_refunds GROUP BY status) s), 'info'

-- financial consistency facts the new functions rely on (informational aggregates) ------------------------------------------------------------
UNION ALL SELECT 'P30', 'orders whose cached refunded total differs from the sum of succeeded refund rows (informational; the legacy net-financials classification reports such orders as inexact)',
       (SELECT count(*) FROM public.orders o WHERE COALESCE(o.total_refunded_cents, 0) <> COALESCE((SELECT sum(r.amount_cents) FROM public.order_refunds r WHERE r.order_id = o.id AND r.status = 'succeeded'), 0))::text, 'info'
UNION ALL SELECT 'P31', 'orders with a NULL surface (the column is NOT NULL on Production, so this must be 0; relevant to decision U-5)', (SELECT count(*) FROM public.orders WHERE surface IS NULL)::text, 'zero'

-- storage configuration (bucket ids and visibility only) ------------------------------------------------------------------------------------------
UNION ALL SELECT 'P40', 'bucket ids and visibility (compare with the 2026-10-16 capture: 8 buckets; carousel-media present)',
       (SELECT string_agg(id || '=' || CASE WHEN public THEN 'public' ELSE 'private' END, ', ' ORDER BY id) FROM storage.buckets), 'info'
UNION ALL SELECT 'P41', 'buckets the migrations insert already exist (order-evidence, event-essentials-media): the inserts would conflict or no-op',
       (SELECT count(*) FROM storage.buckets WHERE id IN ('order-evidence','event-essentials-media'))::text, 'zero'
ORDER BY 1;

ROLLBACK;
