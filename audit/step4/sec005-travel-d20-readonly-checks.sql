-- Read-only SQL run against Development (project srxunxiytojjsuhcmzjg) on 2026-10-20 for the SEC-005 plan, the travel-fee review and the D20 plan.
-- Every statement is a single SELECT (or an EXPLAIN without execution). Nothing was written. No password was used to sign in; the only
-- password-related expressions are hash comparisons inside SELECT lists (booleans). Customer rows were reduced to counts and masked values.
-- Failed drafts (wrong column names: updated_at ambiguity, orders.travel_is_included, orders.updated_at, order_changelog.field_name) changed nothing.

-- ===== Q7: SEC-005 =====
select jsonb_build_object(
 'masters',(select jsonb_agg(jsonb_build_object('masked',left(u.email,2)||'***@'||split_part(u.email,'@',2),'confirmed',u.email_confirmed_at is not null,'banned',u.banned_until,'deleted',u.deleted_at,'last_sign_in',u.last_sign_in_at,'created',u.created_at,'providers',(select jsonb_agg(i.provider) from auth.identities i where i.user_id=u.id),'is_demo',lower(u.email)='admin@bouncepartyclub.com',
    'weak_pw',(u.encrypted_password is not null and u.encrypted_password=crypt('<published value, see migration 20251003170350>',u.encrypted_password)),'has_password',u.encrypted_password is not null and u.encrypted_password<>'') order by u.last_sign_in_at desc nulls last) from auth.users u join user_roles ur on ur.user_id=u.id where ur.role='master'),
 'sessions_demo',(select jsonb_build_object('sessions',count(*),'newest',max(s.updated_at)) from auth.sessions s join auth.users u on u.id=s.user_id where lower(u.email)='admin@bouncepartyclub.com'),
 'refresh_demo',(select jsonb_build_object('total',count(*),'active',count(*) filter (where not r.revoked),'newest',max(r.updated_at)) from auth.refresh_tokens r join auth.users u on u.id::text=r.user_id where lower(u.email)='admin@bouncepartyclub.com'),
 'sessions_second',(select count(*) from auth.sessions s join auth.users u on u.id=s.user_id where u.email ilike 'ad%@offline4ever.com'),
 'refresh_second',(select jsonb_build_object('total',count(*),'active',count(*) filter (where not r.revoked)) from auth.refresh_tokens r join auth.users u on u.id::text=r.user_id where u.email ilike 'ad%@offline4ever.com'),
 'mfa_factors_demo',(select count(*) from auth.mfa_factors f join auth.users u on u.id=f.user_id where lower(u.email)='admin@bouncepartyclub.com'),
 'fks_to_auth_users',(select jsonb_agg(distinct conrelid::regclass::text||'.'||(select attname from pg_attribute where attrelid=conrelid and attnum=conkey[1])||' '||case confdeltype when 'a' then 'NO ACTION' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'r' then 'RESTRICT' else confdeltype::text end) from pg_constraint where confrelid='auth.users'::regclass and contype='f' and connamespace='public'::regnamespace),
 'demo_refs',(with u as (select id from auth.users where lower(email)='admin@bouncepartyclub.com') select jsonb_build_object('user_roles',(select count(*) from user_roles where user_id in (select id from u)),
    'customers_linked',(select count(*) from customers where user_id in (select id from u)),
    'customers_by_email',(select count(*) from customers where lower(email)='admin@bouncepartyclub.com'),
    'contacts_by_email',(select count(*) from contacts where lower(email)='admin@bouncepartyclub.com'),
    'permission_changelog_target',(select count(*) from user_permissions_changelog where target_user_id in (select id from u)),
    'permission_changelog_actor',(select count(*) from user_permissions_changelog where changed_by_user_id in (select id from u)))),
 'second_refs',(with u as (select id from auth.users where email ilike 'ad%@offline4ever.com') select jsonb_build_object('user_roles',(select count(*) from user_roles where user_id in (select id from u)),
    'customers_linked',(select count(*) from customers where user_id in (select id from u)),
    'customers_by_email',(select count(*) from customers where email ilike 'ad%@offline4ever.com'),
    'orders_via_customer',(select count(*) from orders o join customers c on c.id=o.customer_id where c.user_id in (select id from u) or c.email ilike 'ad%@offline4ever.com'),
    'contacts_by_email',(select count(*) from contacts where email ilike 'ad%@offline4ever.com'),
    'permission_changelog',(select count(*) from user_permissions_changelog where target_user_id in (select id from u) or changed_by_user_id in (select id from u)))),
 'settings_using_demo_email',(select jsonb_agg(key) from admin_settings where lower(value) like '%admin@bouncepartyclub.com%'),
 'email_templates_mention',(select count(*) from email_templates where content_template ilike '%admin@bouncepartyclub.com%'),
 'sms_templates_mention',(select count(*) from sms_message_templates where message_template ilike '%admin@bouncepartyclub.com%')
 ) r;

-- ===== Q8: travel-fee storage and history =====
-- Q8a: columns and fee distribution
select jsonb_build_object(
 'order_cols',(select jsonb_agg(column_name||':'||data_type order by column_name) from information_schema.columns where table_schema='public' and table_name='orders' and (column_name ilike '%travel%' or column_name ilike '%mile%' or column_name ilike '%radius%' or column_name ilike '%rate%' or column_name ilike '%snapshot%' or column_name ilike '%pricing%' or column_name ilike '%override%' or column_name ilike '%waive%' or column_name ilike '%zone%' or column_name ilike '%distance%')),
 'invoice_cols',(select jsonb_agg(column_name||':'||data_type order by column_name) from information_schema.columns where table_schema='public' and table_name='invoices' and (column_name ilike '%travel%' or column_name ilike '%snapshot%' or column_name ilike '%rate%')),
 'orders_total',(select count(*) from orders),
 'travel_fee_nonnull',(select count(*) from orders where travel_fee_cents is not null),
 'travel_fee_gt0',(select count(*) from orders where travel_fee_cents>0),
 'pricing_tables',(select jsonb_agg(table_name) from information_schema.tables where table_schema='public' and table_name ilike '%pricing%'),
 'pricing_triggers',(select jsonb_agg(tgname||' on '||tgrelid::regclass::text) from pg_trigger where tgrelid in ('public.pricing_rules'::regclass,'public.orders'::regclass) and not tgisinternal),
 'fns_reading_pricing_rules',(select jsonb_agg(proname) from pg_proc where pronamespace='public'::regnamespace and prosrc ilike '%pricing_rules%')
 ) r;
-- Q8b: snapshot columns and consistency of the stored fee
select jsonb_build_object(
 'with_fee',(select count(*) from orders where travel_fee_cents>0),
 'snap_fill_among_fee',(select jsonb_build_object('per_mile',count(*) filter (where travel_per_mile_cents is not null),'base_radius',count(*) filter (where travel_base_radius_miles is not null),'chargeable',count(*) filter (where travel_chargeable_miles is not null),'total_miles',count(*) filter (where travel_total_miles is not null),'flat',count(*) filter (where travel_is_flat_fee is not null)) from orders where travel_fee_cents>0),
 'snap_fill_all',(select jsonb_build_object('per_mile',count(*) filter (where travel_per_mile_cents is not null),'base_radius',count(*) filter (where travel_base_radius_miles is not null),'chargeable',count(*) filter (where travel_chargeable_miles is not null),'total_miles',count(*) filter (where travel_total_miles is not null),'flat',count(*) filter (where travel_is_flat_fee is not null)) from orders),
 'per_mile_dist_among_fee',(select jsonb_object_agg(coalesce(travel_per_mile_cents::text,'null'),c) from (select travel_per_mile_cents,count(*) c from orders where travel_fee_cents>0 group by 1) s),
 'radius_dist_among_fee',(select jsonb_object_agg(coalesce(travel_base_radius_miles::text,'null'),c) from (select travel_base_radius_miles,count(*) c from orders where travel_fee_cents>0 group by 1) s),
 'fee_eq_chargeable_x_rate_rounded',(select jsonb_build_object('matches',count(*) filter (where abs(travel_fee_cents - round(travel_chargeable_miles*travel_per_mile_cents))<=1),'mismatch',count(*) filter (where travel_per_mile_cents is not null and travel_chargeable_miles is not null and abs(travel_fee_cents - round(travel_chargeable_miles*travel_per_mile_cents))>1)) from orders where travel_fee_cents>0 and coalesce(travel_is_flat_fee,false)=false),
 'waived_travel',(select count(*) from orders where travel_fee_waived),
 'invoices_travel_vs_order',(select jsonb_build_object('invoices',count(*),'travel_equal_order',count(*) filter (where i.travel_fee_cents=o.travel_fee_cents),'travel_differ',count(*) filter (where i.travel_fee_cents is distinct from o.travel_fee_cents)) from invoices i join orders o on o.id=i.order_id),
 'pricing_rules_updated_at',(select updated_at from pricing_rules limit 1)
 ) r;
-- Q8c: what a re-price under today's rules would do to the zero-fee orders
with cur as (select base_radius_miles r, per_mile_after_base_cents pm, included_cities ic from pricing_rules limit 1),
z as (select o.id, o.travel_total_miles m, o.travel_base_radius_miles br, a.city, o.created_at from orders o left join addresses a on a.id=o.address_id where o.travel_fee_cents=0)
select jsonb_build_object(
 'zero_fee_orders',(select count(*) from z),
 'stored_radius_dist_zero',(select jsonb_object_agg(coalesce(br::text,'null'),c) from (select br,count(*) c from z group by 1) s),
 'stored_miles_gt_current_radius',(select count(*) from z,cur where z.m>cur.r),
 'would_get_fee_today_not_included_city',(select count(*) from z,cur where z.m>cur.r and not exists (select 1 from unnest(cur.ic) c where lower(c)=lower(z.city))),
 'would_get_fee_today_amount_sum',(select coalesce(sum(round((z.m-cur.r)*cur.pm)),0) from z,cur where z.m>cur.r and not exists (select 1 from unnest(cur.ic) c where lower(c)=lower(z.city))),
 'zero_fee_included_city',(select count(*) from z,cur where exists (select 1 from unnest(cur.ic) c where lower(c)=lower(z.city))),
 'zero_radius_by_month',(select jsonb_agg(jsonb_build_object('month',mo,'radius',br,'n',c) order by mo,br) from (select to_char(created_at,'YYYY-MM') mo, br, count(*) c from z group by 1,2) s),
 'current_rules',(select jsonb_build_object('radius',r,'per_mile',pm,'included',ic) from cur),
 'zone_overrides',(select zone_overrides_json from pricing_rules limit 1)
 ) r;
-- Q8d: the two invoices that disagree with their order
select jsonb_agg(jsonb_build_object('inv_status',i.status,'inv_travel',i.travel_fee_cents,'order_travel',o.travel_fee_cents,'order_status',o.status,'inv_created',i.created_at::date,'order_created',o.created_at::date,'order_rate',o.travel_per_mile_cents,'order_chargeable',o.travel_chargeable_miles,'inv_total',i.total_cents,'inv_paid',i.paid_amount_cents)) r from invoices i join orders o on o.id=i.order_id where i.travel_fee_cents is distinct from o.travel_fee_cents;

-- ===== Q9: D20 (contact statistics) =====
-- Q9a: the two triggers and the two functions
select jsonb_build_object(
 'triggers',(select jsonb_agg(jsonb_build_object('name',tgname,'def',pg_get_triggerdef(oid),'fn',(select proname from pg_proc where oid=tgfoid))) from pg_trigger where tgrelid='public.orders'::regclass and not tgisinternal and tgname ilike '%contact%'),
 'trigger_fns_src_md5',(select jsonb_agg(jsonb_build_object('fn',proname,'md5',md5(prosrc),'len',length(prosrc),'secdef',prosecdef)) from pg_proc where pronamespace='public'::regnamespace and (proname ilike '%contact%stat%' or proname ilike '%contact_booking%')),
 'contacts_triggers',(select jsonb_agg(tgname) from pg_trigger where tgrelid='public.contacts'::regclass and not tgisinternal)
 ) r;
select proname, prosrc from pg_proc where pronamespace='public'::regnamespace and proname in ('update_contact_stats','update_contact_booking_stats');
-- Q9b: stored values versus the historical D20 formula, the application formula and the legacy formula
with oc as (
 select c.email, o.id, o.status, o.event_date,
   o.subtotal_cents sub, o.travel_fee_cents tr, o.surface_fee_cents sf, coalesce(o.same_day_pickup_fee_cents,0) sdp, coalesce(o.generator_fee_cents,0) gen,
   coalesce(o.setup_fee_cents,0) setup, coalesce(o.same_day_weekday_delivery_fee_cents,0) wd, o.tax_cents tax,
   coalesce((select sum(case when cf.amount_cents>0 then cf.amount_cents else 0 end) from order_custom_fees cf where cf.order_id=o.id),0) cfees,
   (select coalesce(sum(case when od.amount_cents>0 then round(od.amount_cents) when od.percentage>0 then round(o.subtotal_cents*(od.percentage/100.0)) else 0 end),0) from order_discounts od where od.order_id=o.id) disc_raw
 from orders o join customers c on c.id=o.customer_id),
oc2 as (select oc.*, (sub+tr+sf+gen+setup+cfees+sdp+wd) pre from oc),
oc3 as (select *, (pre - least(disc_raw, greatest(0,pre)) + tax) app_total,
   (sub+tr+sf+sdp+gen+tax+cfees - (select coalesce(sum(case when od.percentage is not null and od.percentage>0 then round(sub*(od.percentage/100.0)) else coalesce(od.amount_cents,0) end),0) from order_discounts od where od.order_id=oc2.id)) d20_total from oc2),
agg as (select email,
   count(*) filter (where status not in ('draft','void','cancelled')) tb,
   coalesce(sum(app_total) filter (where status not in ('draft','void','cancelled')),0) app_ts,
   coalesce(sum(d20_total) filter (where status not in ('draft','void','cancelled')),0) d20_ts,
   count(*) filter (where status='completed') cc, min(event_date::date) filter (where status='completed') fc, max(event_date::date) filter (where status='completed') lc,
   count(*) all_orders,
   coalesce(sum(sub+tr+sf+sdp+gen+tax) filter (where status in ('confirmed','approved','completed')),0) legacy_ts
  from oc3 group by email)
select jsonb_build_object(
 'contacts_with_orders',(select count(*) from contacts ct join agg on agg.email=ct.email),
 'stale_total_d20_formula',(select count(*) from contacts ct join agg on agg.email=ct.email where ct.total_spent_cents is distinct from agg.d20_ts),
 'stale_total_app_formula',(select count(*) from contacts ct join agg on agg.email=ct.email where ct.total_spent_cents is distinct from agg.app_ts),
 'd20_vs_app_formula_differ_contacts',(select count(*) from contacts ct join agg on agg.email=ct.email where agg.d20_ts<>agg.app_ts),
 'bookings_mismatch',(select count(*) from contacts ct join agg on agg.email=ct.email where ct.total_bookings is distinct from agg.tb),
 'bookings_equals_all_orders',(select count(*) from contacts ct join agg on agg.email=ct.email where ct.total_bookings = agg.all_orders and agg.all_orders<>agg.tb),
 'completed_mismatch',(select count(*) from contacts ct join agg on agg.email=ct.email where ct.completed_bookings_count is distinct from agg.cc),
 'first_date_mismatch',(select count(*) from contacts ct join agg on agg.email=ct.email where ct.first_completed_booking_date is distinct from agg.fc),
 'last_date_mismatch',(select count(*) from contacts ct join agg on agg.email=ct.email where ct.last_completed_booking_date is distinct from agg.lc),
 'repeat_flag_mismatch',(select count(*) from contacts ct join agg on agg.email=ct.email where ct.is_repeat_customer is distinct from (agg.cc>1)),
 'any_field_stale_app_formula',(select count(*) from contacts ct join agg on agg.email=ct.email where ct.total_spent_cents is distinct from agg.app_ts or ct.total_bookings is distinct from agg.tb or ct.completed_bookings_count is distinct from agg.cc or ct.first_completed_booking_date is distinct from agg.fc or ct.last_completed_booking_date is distinct from agg.lc or ct.is_repeat_customer is distinct from (agg.cc>1)),
 'stored_equals_legacy_formula',(select count(*) from contacts ct join agg on agg.email=ct.email where ct.total_spent_cents=agg.legacy_ts),
 'stale_and_equals_legacy',(select count(*) from contacts ct join agg on agg.email=ct.email where ct.total_spent_cents is distinct from agg.app_ts and ct.total_spent_cents=agg.legacy_ts),
 'sum_stored',(select sum(ct.total_spent_cents) from contacts ct join agg on agg.email=ct.email),
 'sum_app',(select sum(agg.app_ts) from contacts ct join agg on agg.email=ct.email),
 'sum_delta_stale',(select sum(agg.app_ts-ct.total_spent_cents) from contacts ct join agg on agg.email=ct.email where ct.total_spent_cents is distinct from agg.app_ts),
 'orders_inprogress_noncounted_by_legacy',(select count(*) from orders where status='in_progress')
) r;
-- Q9c: syntax and column check of the correction's UPDATE (EXPLAIN only, nothing executed)
explain (costs off) update public.contacts c set total_bookings = t.tb, total_spent_cents = t.ts, completed_bookings_count = t.cc, first_completed_booking_date = t.fc, last_completed_booking_date = t.lc, is_repeat_customer = (t.cc > 1) from (select ct.id, 1::integer tb, 2::integer ts, 3::integer cc, current_date fc, current_date lc from public.contacts ct limit 1) t where c.id = t.id;
