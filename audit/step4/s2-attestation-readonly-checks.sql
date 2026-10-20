-- S2 attestation review: the read-only SQL run against Development (project srxunxiytojjsuhcmzjg) on 2026-10-20
-- through the Supabase integration (role postgres). Every statement is a single SELECT. Nothing was written.
-- Customer data: only counts, flags and masked values were selected; no secret value was selected (only booleans, lengths and md5s).
-- Ledger at the time: 223 rows, SHA-256 e8f53b1e951463a8731ac8fdb7497b689c4677da437cad02ff7b29b1b493bbf4 (Q1 re-computed it).
-- One statement (an earlier Q4 draft referencing orders.total_cents / orders.updated_at, columns that do not exist) failed with a column error and changed nothing.

-- ===== Q1: ledger, D01 to D07 =====
select jsonb_build_object(
 'ledger_rows',(select count(*) from supabase_migrations.schema_migrations),
 'ledger_sha',encode(sha256(convert_to((select string_agg(version || '|' || coalesce(name,'') || '|' || md5(coalesce(array_to_string(statements, E'\n'),'')), E'\n' ORDER BY version) from supabase_migrations.schema_migrations), 'UTF8')), 'hex'),
 'd01', jsonb_build_object('cols',(select jsonb_agg(column_name order by column_name) from information_schema.columns where table_schema='public' and table_name='payments' and column_name in ('paid_at','failed_at','updated_at')),
   'succ_no_paid',(select count(*) from payments where status='succeeded' and paid_at is null),
   'failed_no_failed',(select count(*) from payments where status='failed' and failed_at is null),
   'payments_total',(select count(*) from payments),
   'status_dist',(select jsonb_object_agg(status,c) from (select status,count(*) c from payments group by 1) s),
   'trig',(select jsonb_agg(tgname) from pg_trigger where tgrelid='public.payments'::regclass and not tgisinternal),
   'fn',(select jsonb_agg(proname) from pg_proc where pronamespace='public'::regnamespace and proname like 'update_payment%')),
 'd02', jsonb_build_object('orders',(select count(*) from orders),
   'auto_reason_rows',(select count(*) from orders where tax_waive_reason like 'Auto-adjusted for compatibility%'),
   'tax_gt0',(select count(*) from orders where tax_cents>0),
   'tax_gt0_waived_true',(select count(*) from orders where tax_cents>0 and tax_waived=true),
   'tax_gt0_waived_null',(select count(*) from orders where tax_cents>0 and tax_waived is null),
   'pre_0119_tax_gt0',(select count(*) from orders where tax_cents>0 and created_at<'2026-01-19'),
   'pre_0119_tax_gt0_notwaived',(select count(*) from orders where tax_cents>0 and created_at<'2026-01-19' and (tax_waived=false)),
   'pre_0119_all',(select count(*) from orders where created_at<'2026-01-19'),
   'pre_0119_tax0',(select count(*) from orders where created_at<'2026-01-19' and coalesce(tax_cents,0)=0),
   'waived_true_total',(select count(*) from orders where tax_waived=true),
   'waived_true_with_other_reason',(select count(*) from orders where tax_waived=true and tax_waive_reason is not null),
   'orders_min_created',(select min(created_at) from orders),'orders_max_created',(select max(created_at) from orders)),
 'd04', jsonb_build_object('user_id_col',(select count(*) from information_schema.columns where table_schema='public' and table_name='customers' and column_name='user_id'),
   'idx',(select count(*) from pg_indexes where indexname='customers_user_id_idx'),
   'pols',(select jsonb_agg(policyname) from pg_policies where tablename='customers' and policyname like 'Users can % their own customer profile'),
   'customers',(select count(*) from customers),
   'with_user_id',(select count(*) from customers where user_id is not null),
   'email_match_unlinked',(select count(*) from customers c join auth.users u on u.email=c.email where c.user_id is null),
   'orphan_user_id',(select count(*) from customers c where c.user_id is not null and not exists (select 1 from auth.users u where u.id=c.user_id))),
 'd05', jsonb_build_object('check_def',(select pg_get_constraintdef(oid) from pg_constraint where conname='invoices_status_check' and conrelid='public.invoices'::regclass),
   'status_dist',(select jsonb_object_agg(status,c) from (select status,count(*) c from invoices group by 1) s),
   'paid_but_partial',(select count(*) from invoices where status='paid' and paid_amount_cents<total_cents)),
 'd06', jsonb_build_object('key_col',(select count(*) from information_schema.columns where table_schema='public' and table_name='addresses' and column_name='address_key'),
   'uidx',(select indexdef from pg_indexes where indexname='addresses_address_key_unique'),
   'addresses',(select count(*) from addresses),
   'null_key_with_fields',(select count(*) from addresses where address_key is null and line1 is not null and city is not null and state is not null and zip is not null),
   'null_key_total',(select count(*) from addresses where address_key is null),
   'dup_groups',(select count(*) from (select address_key from addresses where address_key is not null group by 1 having count(*)>1) d),
   'key_mismatch_formula',(select count(*) from addresses where line1 is not null and city is not null and state is not null and zip is not null and address_key is distinct from (lower(trim(line1)) || '|' || lower(trim(city)) || '|' || upper(trim(state)) || '|' || regexp_replace(trim(zip), '\s+', '', 'g'))),
   'zip_with_space',(select count(*) from addresses where trim(zip) ~ '\s'),
   'with_coords',(select count(*) from addresses where lat is not null and lng is not null),
   'orders_dangling_address',(select count(*) from orders o where o.address_id is not null and not exists (select 1 from addresses a where a.id=o.address_id)))
 ) r;

-- ===== Q2: D08, D09, pricing_rules (D10 to D15), roles (D16, D17) =====
select jsonb_build_object(
 'd08', jsonb_build_object('changelog_rows',(select count(*) from admin_settings_changelog),
   'sensitive_rows',(select count(*) from admin_settings_changelog where setting_key in ('stripe_secret_key','twilio_auth_token','resend_api_key') or setting_key ilike '%secret%' or setting_key ilike '%_key' or setting_key ilike '%token%' or setting_key ilike '%password%'),
   'sensitive_not_redacted',(select count(*) from admin_settings_changelog where (setting_key in ('stripe_secret_key','twilio_auth_token','resend_api_key') or setting_key ilike '%secret%' or setting_key ilike '%_key' or setting_key ilike '%token%' or setting_key ilike '%password%') and (old_value is distinct from '[REDACTED]' or new_value is distinct from '[REDACTED]')),
   'sensitive_null_both',(select count(*) from admin_settings_changelog where (setting_key ilike '%secret%' or setting_key ilike '%_key' or setting_key ilike '%token%' or setting_key ilike '%password%') and old_value is null and new_value is null),
   'trigger',(select jsonb_agg(tgname) from pg_trigger where tgrelid='public.admin_settings_changelog'::regclass and not tgisinternal),
   'fn',(select jsonb_build_object('secdef',prosecdef,'cfg',proconfig) from pg_proc where pronamespace='public'::regnamespace and proname='redact_sensitive_changelog_values'),
   'distinct_sensitive_keys',(select jsonb_agg(distinct setting_key) from admin_settings_changelog where setting_key in ('stripe_secret_key','twilio_auth_token','resend_api_key') or setting_key ilike '%secret%' or setting_key ilike '%_key' or setting_key ilike '%token%' or setting_key ilike '%password%'),
   'settings_keys_secretish',(select jsonb_agg(key order by key) from admin_settings where key ilike '%secret%' or key ilike '%_key' or key ilike '%token%' or key ilike '%password%')),
 'd09', jsonb_build_object('orders_with_pm',(select count(*) from orders where stripe_payment_method_id is not null),
   'missing_last4_or_brand',(select count(*) from orders where stripe_payment_method_id is not null and (payment_method_last_four is null or payment_method_brand is null)),
   'missing_and_backfillable',(select count(*) from orders o where o.stripe_payment_method_id is not null and (o.payment_method_last_four is null or o.payment_method_brand is null) and exists (select 1 from payments p where p.order_id=o.id and p.status='succeeded' and p.payment_last4 is not null)),
   'has_both',(select count(*) from orders where stripe_payment_method_id is not null and payment_method_last_four is not null and payment_method_brand is not null),
   'payments_with_last4',(select count(*) from payments where payment_last4 is not null)),
 'pricing_rules', (select to_jsonb(p) - 'id' from pricing_rules p limit 1),
 'pricing_rules_n',(select count(*) from pricing_rules),
 'd16', jsonb_build_object('role_dist',(select jsonb_object_agg(role,c) from (select role,count(*) c from user_roles group by 1) s),
   'non_lower',(select count(*) from user_roles where role<>lower(role)),
   'fn_has_lower',(select position('lower(role)' in lower(prosrc))>0 from pg_proc where pronamespace='public'::regnamespace and proname='get_user_role' limit 1),
   'fn_overloads',(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='get_user_role'),
   'trigger_states',(select jsonb_agg(jsonb_build_object('t',tgname,'en',tgenabled)) from pg_trigger where tgrelid='public.user_roles'::regclass and not tgisinternal))
 ) r;

-- ===== Q3: templates (D18, D29 to D33), payment tracking (D19), total spent (D20), demo administrator (D21) =====
-- 'pw_is_admin123' and 'users_pw_admin123' compare the stored hash with the value published in the public migration file; no login was attempted.
select jsonb_build_object(
 'sms_templates',(select jsonb_agg(jsonb_build_object('k',template_key,'name',template_name,'len',length(message_template),'md5',md5(message_template),'created',created_at,'updated',updated_at) order by template_key) from sms_message_templates),
 'email_templates',(select jsonb_agg(jsonb_build_object('n',template_name,'md5',md5(content_template),'subj_md5',md5(subject),'created',created_at,'updated',updated_at,'theme',theme,'cat',category) order by template_name) from email_templates),
 'sms_table_policies',(select jsonb_agg(jsonb_build_object('p',policyname,'cmd',cmd,'roles',roles)) from pg_policies where tablename='sms_message_templates'),
 'd19', jsonb_build_object('cols',(select jsonb_agg(column_name) from information_schema.columns where table_schema='public' and table_name='orders' and column_name like 'customer_selected_payment%'),
   'orders',(select count(*) from orders),
   'sel_null',(select count(*) from orders where customer_selected_payment_cents is null),
   'sel_null_status',(select jsonb_object_agg(coalesce(status,'null'),c) from (select status,count(*) c from orders where customer_selected_payment_cents is null group by 1) s),
   'sel_null_deposit_due_gt0',(select count(*) from orders where customer_selected_payment_cents is null and coalesce(deposit_due_cents,0)>0),
   'sel_null_deposit_due_null_or_0',(select count(*) from orders where customer_selected_payment_cents is null and coalesce(deposit_due_cents,0)=0),
   'sel_null_created_min',(select min(created_at) from orders where customer_selected_payment_cents is null),
   'sel_null_created_max',(select max(created_at) from orders where customer_selected_payment_cents is null),
   'sel_set',(select count(*) from orders where customer_selected_payment_cents is not null),
   'sel_set_equals_deposit_due',(select count(*) from orders where customer_selected_payment_cents is not null and customer_selected_payment_cents=deposit_due_cents),
   'sel_set_differs_deposit_due',(select count(*) from orders where customer_selected_payment_cents is not null and customer_selected_payment_cents is distinct from deposit_due_cents),
   'type_dist',(select jsonb_object_agg(coalesce(customer_selected_payment_type,'null'),c) from (select customer_selected_payment_type,count(*) c from orders group by 1) s),
   'sel_null_with_payment',(select count(*) from orders o where customer_selected_payment_cents is null and exists (select 1 from payments p where p.order_id=o.id)),
   'sel_null_with_payment_succeeded',(select count(*) from orders o where customer_selected_payment_cents is null and exists (select 1 from payments p where p.order_id=o.id and p.status='succeeded'))),
 'd20', jsonb_build_object('contacts',(select count(*) from contacts),
   'fn_has_custom_fees',(select position('order_custom_fees' in prosrc)>0 from pg_proc where pronamespace='public'::regnamespace and proname='update_contact_booking_stats'),
   'fn_secdef',(select prosecdef from pg_proc where pronamespace='public'::regnamespace and proname='update_contact_booking_stats'),
   'triggers_using_fn',(select jsonb_agg(jsonb_build_object('tbl',tgrelid::regclass::text,'t',tgname,'en',tgenabled)) from pg_trigger where tgfoid=(select oid from pg_proc where pronamespace='public'::regnamespace and proname='update_contact_booking_stats') and not tgisinternal),
   'mismatch',(with calc as (select c2.email, count(*) filter (where o.status not in ('draft','void','cancelled')) tb,
      coalesce(sum(o.subtotal_cents+o.travel_fee_cents+o.surface_fee_cents+coalesce(o.same_day_pickup_fee_cents,0)+coalesce(o.generator_fee_cents,0)+o.tax_cents+coalesce((select sum(cf.amount_cents) from order_custom_fees cf where cf.order_id=o.id),0)-coalesce((select sum(case when od.percentage is not null and od.percentage>0 then round(o.subtotal_cents*(od.percentage/100.0)) else coalesce(od.amount_cents,0) end) from order_discounts od where od.order_id=o.id),0)) filter (where o.status not in ('draft','void','cancelled')),0) ts
     from orders o join customers c2 on c2.id=o.customer_id group by c2.email)
     select jsonb_build_object('contacts_with_orders',(select count(*) from contacts ct join calc on calc.email=ct.email),
       'total_spent_mismatch',(select count(*) from contacts ct join calc on calc.email=ct.email where ct.total_spent_cents is distinct from calc.ts),
       'bookings_mismatch',(select count(*) from contacts ct join calc on calc.email=ct.email where ct.total_bookings is distinct from calc.tb),
       'sum_stored',(select coalesce(sum(ct.total_spent_cents),0) from contacts ct join calc on calc.email=ct.email),
       'sum_calc',(select coalesce(sum(calc.ts),0) from contacts ct join calc on calc.email=ct.email),
       'contacts_no_match',(select count(*) from contacts ct where not exists (select 1 from calc where calc.email=ct.email)),
       'contacts_no_match_nonzero',(select count(*) from contacts ct where not exists (select 1 from calc where calc.email=ct.email) and coalesce(ct.total_spent_cents,0)<>0)))),
 'd21', jsonb_build_object(
   'admin_demo',(select jsonb_build_object('exists',true,'confirmed',email_confirmed_at is not null,'banned_until',banned_until,'last_sign_in',last_sign_in_at,'created',created_at,'updated',updated_at,'deleted_at',deleted_at,'pw_is_admin123',(encrypted_password = crypt('admin123', encrypted_password)),'role_col',role,'app_meta_role',raw_app_meta_data->>'role','is_sso',is_sso_user) from auth.users where lower(email)='admin@bouncepartyclub.com'),
   'admin_demo_count',(select count(*) from auth.users where lower(email)='admin@bouncepartyclub.com'),
   'its_roles',(select jsonb_agg(ur.role) from user_roles ur join auth.users u on u.id=ur.user_id where lower(u.email)='admin@bouncepartyclub.com'),
   'its_identities',(select count(*) from auth.identities i join auth.users u on u.id=i.user_id where lower(u.email)='admin@bouncepartyclub.com'),
   'users_total',(select count(*) from auth.users),
   'users_pw_admin123',(select count(*) from auth.users where encrypted_password is not null and encrypted_password = crypt('admin123', encrypted_password)),
   'users_last_sign_in_recent_30d',(select count(*) from auth.users where last_sign_in_at > now()-interval '30 days'),
   'roles_dist_master_users',(select count(*) from user_roles where role='master'))
 ) r;

-- ===== Q4: second account with the published password (masked), SMS policies, D19 detail, D20 formula comparison =====
select jsonb_build_object(
 'second_admin123',(select jsonb_agg(jsonb_build_object('masked',left(u.email,2)||'***@'||split_part(u.email,'@',2),'roles',(select jsonb_agg(ur.role) from user_roles ur where ur.user_id=u.id),'last_sign_in',u.last_sign_in_at,'created',u.created_at,'app_meta_role',u.raw_app_meta_data->>'role')) from auth.users u where u.encrypted_password is not null and u.encrypted_password = crypt('admin123', u.encrypted_password)),
 'weak_other_pw',(select count(*) from auth.users u where u.encrypted_password is not null and (u.encrypted_password = crypt('password', u.encrypted_password) or u.encrypted_password = crypt('admin', u.encrypted_password) or u.encrypted_password = crypt('Password1', u.encrypted_password))),
 'sms_policy_quals',(select jsonb_agg(jsonb_build_object('p',policyname,'qual',qual,'wc',with_check)) from pg_policies where tablename='sms_message_templates'),
 'd19_nondraft',(select jsonb_agg(jsonb_build_object('status',status,'created',created_at::date,'deposit_due',deposit_due_cents,'pays',(select count(*) from payments p where p.order_id=o.id),'pay_sum',(select coalesce(sum(amount_cents),0) from payments p where p.order_id=o.id))) from orders o where customer_selected_payment_cents is null and status<>'draft'),
 'd19_draft_dd',(select jsonb_build_object('n',count(*),'dd_gt0',count(*) filter (where coalesce(deposit_due_cents,0)>0),'min',min(created_at::date),'max',max(created_at::date)) from orders where customer_selected_payment_cents is null and status='draft'),
 'd19_set_differs_types',(select jsonb_object_agg(coalesce(t,'null'),c) from (select customer_selected_payment_type t,count(*) c from orders where customer_selected_payment_cents is not null and customer_selected_payment_cents is distinct from deposit_due_cents group by 1) s),
 'd19_orders_before_mig',(select count(*) from orders where created_at < '2026-03-05T20:58:00Z'),
 'd20_alt',(with calc as (select c2.email,
      coalesce(sum(o.subtotal_cents+o.travel_fee_cents+o.surface_fee_cents+coalesce(o.same_day_pickup_fee_cents,0)+o.tax_cents) filter (where o.status not in ('draft','void','cancelled')),0) old_formula,
      coalesce(sum(o.subtotal_cents+o.travel_fee_cents+o.surface_fee_cents+coalesce(o.same_day_pickup_fee_cents,0)+coalesce(o.generator_fee_cents,0)+o.tax_cents+coalesce((select sum(cf.amount_cents) from order_custom_fees cf where cf.order_id=o.id),0)-coalesce((select sum(case when od.percentage is not null and od.percentage>0 then round(o.subtotal_cents*(od.percentage/100.0)) else coalesce(od.amount_cents,0) end) from order_discounts od where od.order_id=o.id),0)) filter (where o.status not in ('draft','void','cancelled')),0) new_formula
     from orders o join customers c2 on c2.id=o.customer_id group by c2.email)
   select jsonb_build_object('match_old_formula',(select count(*) from contacts ct join calc on calc.email=ct.email where ct.total_spent_cents=calc.old_formula),
     'match_new_formula',(select count(*) from contacts ct join calc on calc.email=ct.email where ct.total_spent_cents=calc.new_formula),
     'mismatch_new_but_match_old',(select count(*) from contacts ct join calc on calc.email=ct.email where ct.total_spent_cents<>calc.new_formula and ct.total_spent_cents=calc.old_formula),
     'mismatch_both',(select count(*) from contacts ct join calc on calc.email=ct.email where ct.total_spent_cents<>calc.new_formula and ct.total_spent_cents<>calc.old_formula),
     'stored_zero_calc_pos',(select count(*) from contacts ct join calc on calc.email=ct.email where coalesce(ct.total_spent_cents,0)=0 and calc.new_formula>0),
     'stored_lt_calc',(select count(*) from contacts ct join calc on calc.email=ct.email where ct.total_spent_cents<calc.new_formula),
     'stored_gt_calc',(select count(*) from contacts ct join calc on calc.email=ct.email where ct.total_spent_cents>calc.new_formula),
     'contacts_updated_range',(select jsonb_build_object('min',min(updated_at),'max',max(updated_at)) from contacts))),
 'd20_bookings_zero_stored_but_orders',(select count(*) from contacts where coalesce(total_bookings,0)=0 and exists (select 1 from customers c2 join orders o on o.customer_id=c2.id where c2.email=contacts.email and o.status not in ('draft','void','cancelled')))
 ) r;

-- ===== Q5: settings (D22 to D28), status/columns (D34 to D39), notification objects (D40), units and media (D41 to D43), links (D44) =====
-- Secret settings are reported as present/length only (val is NULL for twilio_*, stripe_*, resend_api_key, google_oauth_client_secret).
select jsonb_build_object(
 'settings',(select jsonb_agg(jsonb_build_object('key',key,'nonempty',coalesce(length(value),0)>0,'len',length(value),'val', case when key in ('twilio_account_sid','twilio_auth_token','twilio_from_number','stripe_publishable_key','stripe_secret_key','resend_api_key','google_oauth_client_secret') then null else left(value,80) end,'updated',updated_at) order by key) from admin_settings where key in ('twilio_account_sid','twilio_auth_token','twilio_from_number','admin_email','stripe_publishable_key','business_name','business_name_short','business_legal_entity','business_address','business_phone','business_email','business_website','business_license_number','apply_travel_fee_by_default','home_address_line1','home_address_line2','home_address_city','home_address_state','home_address_zip','home_address_lat','home_address_lng','instagram_url','facebook_url','use_business_address_for_travel','carousel_show_arrows','admin_phone','google_review_url')),
 'settings_total',(select count(*) from admin_settings),
 'd20_burst',(select jsonb_build_object('updated_in_burst',count(*) filter (where updated_at between '2026-03-23T16:45:30Z' and '2026-03-23T16:47:00Z'),'total',count(*),'before_burst',count(*) filter (where updated_at<'2026-03-23T16:45:30Z')) from contacts),
 'd34', jsonb_build_object('status_dist',(select jsonb_object_agg(coalesce(status,'null'),c) from (select status,count(*) c from orders group by 1) s),'null_or_empty',(select count(*) from orders where status is null or status=''),'payment_pending',(select count(*) from orders where status='payment_pending'),
   'col_comment',(select col_description('public.orders'::regclass,(select attnum from pg_attribute where attrelid='public.orders'::regclass and attname='status')))),
 'd36', jsonb_build_object('col',(select jsonb_build_object('type',data_type,'default',column_default,'nullable',is_nullable) from information_schema.columns where table_schema='public' and table_name='orders' and column_name='deposit_required'),'nulls',(select count(*) from orders where deposit_required is null),'dist',(select jsonb_object_agg(coalesce(deposit_required::text,'null'),c) from (select deposit_required,count(*) c from orders group by 1) s)),
 'd37', jsonb_build_object('end_col',(select is_nullable from information_schema.columns where table_schema='public' and table_name='orders' and column_name='event_end_date'),'pick_col',(select is_nullable from information_schema.columns where table_schema='public' and table_name='orders' and column_name='pickup_preference'),
   'chk',(select pg_get_constraintdef(oid) from pg_constraint where conname='orders_pickup_preference_check'),'end_lt_start',(select count(*) from orders where event_end_date<event_date),'pickup_dist',(select jsonb_object_agg(pickup_preference,c) from (select pickup_preference,count(*) c from orders group by 1) s),'end_ne_start',(select count(*) from orders where event_end_date<>event_date)),
 'd38', jsonb_build_object('col',(select jsonb_build_object('type',data_type,'default',column_default,'nullable',is_nullable) from information_schema.columns where table_schema='public' and table_name='orders' and column_name='payment_lock'),'dist',(select jsonb_object_agg(payment_lock::text,c) from (select payment_lock,count(*) c from orders group by 1) s),'service_role_update',has_table_privilege('service_role','public.orders','UPDATE')),
 'd39', jsonb_build_object('cols',(select jsonb_agg(column_name) from information_schema.columns where table_schema='public' and table_name='orders' and column_name like 'parks_acknowledgment%'),'required_true',(select count(*) from orders where parks_acknowledgment_required),'counties',(select jsonb_object_agg(coalesce(parks_acknowledgment_county,'null'),c) from (select parks_acknowledgment_county,count(*) c from orders where parks_acknowledgment_required group by 1) s),
   'target_order_exists',(select count(*) from orders where id='4ae9723c-936f-4155-ad93-2e47ef844feb'),'target_flags',(select jsonb_build_object('req',parks_acknowledgment_required,'county',parks_acknowledgment_county) from orders where id='4ae9723c-936f-4155-ad93-2e47ef844feb'),'orders_with_county_not_required',(select count(*) from orders where not parks_acknowledgment_required and parks_acknowledgment_county is not null)),
 'd40', jsonb_build_object('tables',(select jsonb_agg(table_name) from information_schema.tables where table_schema='public' and table_name in ('notification_failures','notification_system_status')),
   'status_rows',(select jsonb_agg(jsonb_build_object('t',system_type,'op',is_operational,'cf',consecutive_failures,'f24',total_failures_24h,'last_fail',last_failure_at,'last_ok',last_success_at)) from notification_system_status),'failures_total',(select count(*) from notification_failures),'failures_unresolved',(select count(*) from notification_failures where resolved_at is null),
   'fns',(select jsonb_agg(proname||':'||prosecdef) from pg_proc where pronamespace='public'::regnamespace and proname in ('record_notification_failure','record_notification_success','get_unresolved_failures_count')),
   'policies',(select jsonb_agg(jsonb_build_object('t',tablename,'p',policyname,'cmd',cmd,'roles',roles,'qual',qual,'wc',with_check)) from pg_policies where tablename in ('notification_failures','notification_system_status')),
   'anon_fn_exec',(select jsonb_agg(p.proname||':'||has_function_privilege('anon',p.oid,'EXECUTE')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('record_notification_failure','record_notification_success','get_unresolved_failures_count')),
   'tbl_privs_anon',(select jsonb_agg(c.relname||':'||has_table_privilege('anon',c.oid,'INSERT')||'/'||has_table_privilege('anon',c.oid,'SELECT')) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('notification_failures','notification_system_status'))),
 'd41', jsonb_build_object('types_col',(select jsonb_build_object('type',data_type,'nullable',is_nullable) from information_schema.columns where table_schema='public' and table_name='units' and column_name='types'),'old_type_col',(select count(*) from information_schema.columns where table_schema='public' and table_name='units' and column_name='type'),'chk',(select pg_get_constraintdef(oid) from pg_constraint where conname='units_types_not_empty'),'idx',(select count(*) from pg_indexes where indexname='idx_units_types'),'units',(select count(*) from units),'types_dist',(select jsonb_object_agg(t,c) from (select unnest(types) t,count(*) c from units group by 1) s)),
 'd42', jsonb_build_object('wslide_total',(select count(*) from units where 'Water Slide'=any(types)),'wslide_water0_dry_pos',(select count(*) from units where 'Water Slide'=any(types) and price_water_cents=0 and price_dry_cents>0),'wslide_water_eq_dry',(select count(*) from units where 'Water Slide'=any(types) and price_water_cents=price_dry_cents),'wslide_water_gt_dry',(select count(*) from units where 'Water Slide'=any(types) and price_water_cents>price_dry_cents),'wslide_water_lt_dry_pos',(select count(*) from units where 'Water Slide'=any(types) and price_water_cents<price_dry_cents and price_water_cents>0)),
 'd43', jsonb_build_object('col',(select jsonb_build_object('type',data_type,'default',column_default) from information_schema.columns where table_schema='public' and table_name='unit_media' and column_name='visibility_mode'),'mode_col',(select count(*) from information_schema.columns where table_schema='public' and table_name='unit_media' and column_name='mode'),'rows',(select count(*) from unit_media),'vis_dist',(select jsonb_object_agg(coalesce(visibility_mode,'null'),c) from (select visibility_mode,count(*) c from unit_media group by 1) s),'mode_dist',(select jsonb_object_agg(coalesce(mode,'null'),c) from (select mode,count(*) c from unit_media group by 1) s),'mismatch',(select count(*) from unit_media where mode is not null and visibility_mode is distinct from mode)),
 'd44', jsonb_build_object('link_type_dist',(select jsonb_object_agg(coalesce(link_type,'null'),c) from (select link_type,count(*) c from invoice_links group by 1) s),'backfill_candidates',(select count(*) from invoice_links where link_type='invoice' and deposit_cents=0 and customer_filled=true and short_code is not null),'total',(select count(*) from invoice_links),'shortlink_with_deposit',(select count(*) from invoice_links where link_type='portal_shortlink' and deposit_cents<>0),'null_short_code',(select count(*) from invoice_links where short_code is null))
 ) r;

-- ===== Q6: Stripe key mode (prefix only), D43/D44 detail, D20 detail =====
select jsonb_build_object(
 'stripe_pk_mode',(select left(value,8) from admin_settings where key='stripe_publishable_key'),
 'd43_rerun_would_change',(select count(*) from unit_media where visibility_mode='dry' and mode is not null and mode<>'dry'),
 'd43_mismatch_detail',(select jsonb_agg(jsonb_build_object('mode',mode,'vis',visibility_mode)) from unit_media where mode is not null and visibility_mode is distinct from mode),
 'd43_created_range',(select jsonb_build_object('min',min(created_at),'max',max(created_at)) from unit_media),
 'd44_candidates',(select jsonb_agg(jsonb_build_object('created',created_at::date,'type',link_type,'filled',customer_filled)) from invoice_links where link_type='invoice' and deposit_cents=0 and customer_filled=true and short_code is not null),
 'd44_invoice_created_dist',(select jsonb_build_object('before_mig',count(*) filter (where created_at<'2026-04-15T23:47:00Z'),'after_mig',count(*) filter (where created_at>='2026-04-15T23:47:00Z')) from invoice_links where link_type='invoice'),
 'd44_shortlink_created_dist',(select jsonb_build_object('before_mig',count(*) filter (where created_at<'2026-04-15T23:47:00Z'),'after_mig',count(*) filter (where created_at>='2026-04-15T23:47:00Z')) from invoice_links where link_type='portal_shortlink'),
 'd44_invoice_nonfilled_or_deposit',(select count(*) from invoice_links where link_type='invoice' and not (deposit_cents=0 and customer_filled=true and short_code is not null)),
 'd20_contacts_updated_distinct',(select count(distinct updated_at) from contacts),
 'd20_zero_stored_examples_have_orders_nondraft',(select count(*) from contacts ct where coalesce(ct.total_spent_cents,0)=0 and exists (select 1 from customers c2 join orders o on o.customer_id=c2.id where c2.email=ct.email and o.status not in ('draft','void','cancelled'))),
 'd20_contact_created_range',(select jsonb_build_object('min',min(created_at),'max',max(created_at)) from contacts),
 'd20_zero_stored_contact_created',(select jsonb_build_object('min',min(created_at),'max',max(created_at)) from contacts ct where coalesce(ct.total_spent_cents,0)=0 and exists (select 1 from customers c2 join orders o on o.customer_id=c2.id where c2.email=ct.email and o.status not in ('draft','void','cancelled'))),
 'd20_zero_stored_updated',(select jsonb_build_object('min',min(updated_at),'max',max(updated_at)) from contacts ct where coalesce(ct.total_spent_cents,0)=0 and exists (select 1 from customers c2 join orders o on o.customer_id=c2.id where c2.email=ct.email and o.status not in ('draft','void','cancelled'))),
 'd20_order_status_completed_vs_stored',(select count(*) from contacts ct where ct.completed_bookings_count is distinct from (select count(*) from customers c2 join orders o on o.customer_id=c2.id where c2.email=ct.email and o.status='completed')),
 'd20_orders_created_range_for_mismatch',(select jsonb_build_object('min',min(o.created_at),'max',max(o.created_at)) from orders o join customers c2 on c2.id=o.customer_id join contacts ct on ct.email=c2.email where coalesce(ct.total_spent_cents,0)=0 and o.status not in ('draft','void','cancelled')),
 'd20_trigger_def',(select pg_get_triggerdef(oid) from pg_trigger where tgname='trigger_update_contact_stats' and tgrelid='public.orders'::regclass),
 'd20_dup_contact_email',(select count(*) from (select email from contacts group by 1 having count(*)>1) d)
 ) r;
