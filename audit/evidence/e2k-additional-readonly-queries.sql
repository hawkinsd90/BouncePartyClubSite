-- =====================================================================================================================
-- E2K: PROPOSED additional read-only Development queries for the unresolved versions. NOT RUN. Not part of the approved
-- 42-statement package (hash 6f0be432...57a3); each needs separate owner approval, the same protocol (SET TRANSACTION READ ONLY +
-- SET LOCAL timeouts, one statement per call) and the same privacy rules. All return counts, booleans or role names only.
-- Q31 corrects a defect in Q15: the contact counters are keyed by e-mail through customers (see 20260323164559), not by contacts.customer_id,
-- and the final trigger excludes draft, void and cancelled. Q15's "87 of 95" is therefore NOT valid evidence of a conflict.
-- =====================================================================================================================

-- @query Q31 1   (versions 20251008153245, 20260323155222, 20260323163432, 20260323164559)
SELECT count(*) AS contacts_total,
       count(*) FILTER (WHERE c.total_bookings IS DISTINCT FROM COALESCE(x.n, 0)) AS booking_count_differs,
       count(*) FILTER (WHERE c.completed_bookings_count IS DISTINCT FROM COALESCE(x.completed, 0)) AS completed_count_differs
FROM contacts c
LEFT JOIN (SELECT cu.email,
                  count(*) FILTER (WHERE o.status NOT IN ('draft','void','cancelled')) AS n,
                  count(*) FILTER (WHERE o.status = 'completed') AS completed
           FROM orders o JOIN customers cu ON cu.id = o.customer_id GROUP BY cu.email) x ON x.email = c.email;

-- @query Q32 1   (version 20260305205811: when were the 22 orders created, and in which status)
SELECT (created_at < timestamptz '2026-03-06') AS created_before_migration_date, status, count(*) AS n
FROM orders
WHERE customer_selected_payment_cents IS NULL AND deposit_due_cents IS NOT NULL
GROUP BY 1, 2 ORDER BY 1, 2;

-- @query Q33 1   (version 20260611184401: any database-internal caller of update_pricing_rules)
SELECT count(*) AS functions_mentioning_update_pricing_rules
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ILIKE '%update_pricing_rules%';

-- @query Q34 1   (version 20251003170350: state of the existing demo admin login; booleans and role names only)
SELECT (u.last_sign_in_at IS NOT NULL) AS has_ever_signed_in,
       (u.last_sign_in_at > now() - interval '90 days') AS signed_in_last_90_days,
       (SELECT string_agg(ur.role, ',' ORDER BY ur.role) FROM user_roles ur WHERE ur.user_id = u.id) AS roles
FROM auth.users u WHERE u.email = 'admin@bouncepartyclub.com';
