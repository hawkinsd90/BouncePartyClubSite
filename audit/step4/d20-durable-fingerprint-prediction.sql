-- READ-ONLY. Predicts the schema-fingerprint effect of d20-durable-contact-statistics-correction.sql on the CURRENT catalog without changing anything.
-- It renders the real rows of the two affected fingerprint categories (fn, trg) exactly as scripts/dev/hosted-executor/lib/fingerprint.cjs does under the canonical
-- search path, removes the two replaced functions and two replaced triggers, and adds the rows the correction creates (their function-body md5 values and
-- trigger definitions were taken from running the correction on a scratch PostgreSQL 18 database; the function ACL after the correction is owner-only).
-- Run it again immediately before the authorized correction (at S12b the other rows will differ from today's) and compare 'predicted' with the result after.
-- On 2026-10-20 against Development: current fn 3a11af85b0f081a4f046a6caf9759e03/82 and trg f729c8fe14404bc4272a79c1f181800a/37 (equal to the AUTH-1 baseline);
-- predicted fn 32f59f0ec0d7363565e290c2d3065a3b/84 and trg 939498986d6ddad3dd105070bc326e0c/39; the other nine categories do not change.
SET LOCAL search_path = "$user", public, extensions;
WITH cur AS (
SELECT 'fn' AS k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||p.prokind::text||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||p.proleakproof||'|'||pg_get_userbyid(p.proowner)||'|'||p.prorettype::regtype::text||'|'||coalesce(p.proconfig::text,'')||'|'||md5(p.prosrc)||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '') AS v
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'trg', tgrelid::regclass::text||'|'||tgname||'|'||tgenabled::text||'|'||pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND (tgrelid::regclass::text LIKE 'public.%' OR tgrelid::regclass::text IN ('auth.users','storage.objects','storage.buckets') OR tgrelid::regclass::text NOT LIKE '%.%')
), pred AS (
SELECT k, v FROM cur WHERE NOT (v LIKE 'public.update_contact_stats(%' OR v LIKE 'public.update_contact_booking_stats(%' OR v LIKE 'orders|update_contact_stats_trigger|%' OR v LIKE 'orders|trigger_update_contact_stats|%')
UNION ALL SELECT * FROM (VALUES
 ('fn','public.refresh_contact_booking_stats(p_email text)|f|true|v|false|postgres|void|{search_path=public}|776610e61590eaee6614166d7eafb52e|EXECUTE:postgres:postgres:false'),
 ('fn','public.update_contact_booking_stats()|f|true|v|false|postgres|trigger|{search_path=public}|91430613783b9cbfba5e7d7edef847ac|EXECUTE:postgres:postgres:false'),
 ('fn','public.update_contact_booking_stats_for_new_contact()|f|true|v|false|postgres|trigger|{search_path=public}|9ada290b0946c55832e7f02be0cff6cb|EXECUTE:postgres:postgres:false'),
 ('fn','public.update_contact_booking_stats_from_order_child()|f|true|v|false|postgres|trigger|{search_path=public}|29c45d1cc0ee88d55850f1254eeb6eac|EXECUTE:postgres:postgres:false'),
 ('trg','contacts|trigger_update_contact_stats_new_contact|O|CREATE TRIGGER trigger_update_contact_stats_new_contact AFTER INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION update_contact_booking_stats_for_new_contact()'),
 ('trg','order_custom_fees|trigger_update_contact_stats_order_fees|O|CREATE TRIGGER trigger_update_contact_stats_order_fees AFTER INSERT OR DELETE OR UPDATE ON public.order_custom_fees FOR EACH ROW EXECUTE FUNCTION update_contact_booking_stats_from_order_child()'),
 ('trg','order_discounts|trigger_update_contact_stats_order_discounts|O|CREATE TRIGGER trigger_update_contact_stats_order_discounts AFTER INSERT OR DELETE OR UPDATE ON public.order_discounts FOR EACH ROW EXECUTE FUNCTION update_contact_booking_stats_from_order_child()'),
 ('trg','orders|trigger_update_contact_stats|O|CREATE TRIGGER trigger_update_contact_stats AFTER INSERT OR DELETE OR UPDATE OF status, customer_id, event_date, subtotal_cents, travel_fee_cents, surface_fee_cents, generator_fee_cents, setup_fee_cents, same_day_pickup_fee_cents, same_day_weekday_delivery_fee_cents, tax_cents ON public.orders FOR EACH ROW EXECUTE FUNCTION update_contact_booking_stats()')
) x(k,v))
SELECT 'current' AS which, k, md5(string_agg(v, E'\n' ORDER BY v)) AS d, count(*) AS n FROM cur GROUP BY k
UNION ALL SELECT 'predicted', k, md5(string_agg(v, E'\n' ORDER BY v)), count(*) FROM pred GROUP BY k ORDER BY 1, 2;
