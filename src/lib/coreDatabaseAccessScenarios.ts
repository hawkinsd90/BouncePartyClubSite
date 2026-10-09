// Executable access-control scenarios for the core database lockdown.
//
// These run REAL SQL against a PostgreSQL database that has the repo migrations replayed into it, switching to the actual
// `anon` / `authenticated` / `service_role` roles with Supabase-style JWT claims. Everything happens inside one transaction
// that is rolled back. The database is a SCRATCH database (never a Supabase project); see coreDatabaseAccess.test.ts for how it
// is located and how the suite behaves when none is available.
//
// An expectation is either a count / value ("0", "1", "3") or an error class ("ERR:42501" = permission denied or RLS
// violation). A denied UPDATE/DELETE under RLS silently affects 0 rows, so those expect "0".

export const IDS = {
  uAdmin: '00000000-0000-4000-8000-0000000000a1',
  uCrew: '00000000-0000-4000-8000-0000000000c1',
  uA: '00000000-0000-4000-8000-00000000aaaa',
  uB: '00000000-0000-4000-8000-00000000bbbb',
  custA: '10000000-0000-4000-8000-00000000aaaa',
  custB: '10000000-0000-4000-8000-00000000bbbb',
  custG: '10000000-0000-4000-8000-0000000000ee',
  addrA: '20000000-0000-4000-8000-00000000aaaa',
  addrB: '20000000-0000-4000-8000-00000000bbbb',
  orderA: '30000000-0000-4000-8000-00000000aaaa',
  orderB: '30000000-0000-4000-8000-00000000bbbb',
  orderG: '30000000-0000-4000-8000-0000000000ee',
  unitActive: '40000000-0000-4000-8000-00000000aaaa',
  unitInactiveA: '40000000-0000-4000-8000-00000000a111',
  unitInactiveFree: '40000000-0000-4000-8000-00000000f111',
  payA: '50000000-0000-4000-8000-00000000aaaa',
  payB: '50000000-0000-4000-8000-00000000bbbb',
  linkA: '60000000-0000-4000-8000-00000000aaaa',
  linkB: '60000000-0000-4000-8000-00000000bbbb',
  uLegacy: '00000000-0000-4000-8000-0000000000bb',
  custLegacy: '10000000-0000-4000-8000-0000000001e9',
  contactLegacy: '70000000-0000-4000-8000-0000000001e9',
  addrLegacy: '20000000-0000-4000-8000-0000000001e9',
  orderLegacy: '30000000-0000-4000-8000-0000000001e9',
  payLegacy: '50000000-0000-4000-8000-0000000001e9',
};

export const SEED_SQL = `
-- The fixture creates its own role rows, so the sign-up trigger (which would add a customer role) stays out of the way.
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, email) VALUES
  ('${IDS.uAdmin}', 'admin@example.com'), ('${IDS.uCrew}', 'crew@example.com'),
  ('${IDS.uA}', 'a@example.com'), ('${IDS.uB}', 'b@example.com'), ('${IDS.uLegacy}', 'legacy@example.com');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('${IDS.uAdmin}', 'admin'), ('${IDS.uCrew}', 'crew'), ('${IDS.uA}', 'customer'), ('${IDS.uB}', 'customer');
INSERT INTO public.customers (id, first_name, last_name, email, phone, user_id) VALUES
  ('${IDS.custA}', 'Ann', 'A', 'a@example.com', '5550000001', '${IDS.uA}'),
  ('${IDS.custB}', 'Bob', 'B', 'b@example.com', '5550000002', '${IDS.uB}'),
  ('${IDS.custG}', 'Gus', 'Guest', 'g@example.com', '5550000003', NULL),
  ('${IDS.custLegacy}', 'Lee', 'Legacy', 'legacy@example.com', '5550000004', NULL);
INSERT INTO public.addresses (id, customer_id, line1, city, state, zip, address_key) VALUES
  ('${IDS.addrA}', '${IDS.custA}', '1 A St', 'Wayne', 'MI', '48184', 'a-key'),
  ('${IDS.addrB}', '${IDS.custB}', '2 B St', 'Wayne', 'MI', '48184', 'b-key'),
  ('${IDS.addrLegacy}', '${IDS.custLegacy}', '3 Legacy St', 'Wayne', 'MI', '48184', 'legacy-key');
INSERT INTO public.units (id, slug, name, price_dry_cents, dimensions, footprint_sqft, capacity, types, active) VALUES
  ('${IDS.unitActive}', 'active-u', 'Active Unit', 10000, '10x10', 100, 10, ARRAY['bounce'], true),
  ('${IDS.unitInactiveA}', 'inactive-a', 'Retired Unit A', 10000, '10x10', 100, 10, ARRAY['bounce'], false),
  ('${IDS.unitInactiveFree}', 'inactive-free', 'Retired Unit Free', 10000, '10x10', 100, 10, ARRAY['bounce'], false);
INSERT INTO public.orders (id, customer_id, address_id, status, location_type, event_date, event_end_date, start_window, end_window, subtotal_cents, deposit_due_cents, balance_due_cents, pickup_preference) VALUES
  ('${IDS.orderA}', '${IDS.custA}', '${IDS.addrA}', 'pending_review', 'residential', '2030-06-01', '2030-06-01', '09:00', '17:00', 10000, 5000, 5000, 'next_day'),
  ('${IDS.orderB}', '${IDS.custB}', '${IDS.addrB}', 'pending_review', 'residential', '2030-06-02', '2030-06-02', '09:00', '17:00', 10000, 5000, 5000, 'next_day'),
  ('${IDS.orderG}', '${IDS.custG}', '${IDS.addrB}', 'pending_review', 'residential', '2030-06-03', '2030-06-03', '09:00', '17:00', 10000, 5000, 5000, 'next_day'),
  ('${IDS.orderLegacy}', '${IDS.custLegacy}', '${IDS.addrLegacy}', 'pending_review', 'residential', '2030-06-04', '2030-06-04', '09:00', '17:00', 10000, 5000, 5000, 'next_day');
INSERT INTO public.order_items (order_id, unit_id, unit_price_cents, qty) VALUES
  ('${IDS.orderA}', '${IDS.unitInactiveA}', 10000, 1), ('${IDS.orderB}', '${IDS.unitActive}', 10000, 1), ('${IDS.orderLegacy}', '${IDS.unitActive}', 10000, 1);
INSERT INTO public.order_discounts (order_id, name) VALUES ('${IDS.orderA}', 'disc-A'), ('${IDS.orderB}', 'disc-B');
INSERT INTO public.order_custom_fees (order_id, name) VALUES ('${IDS.orderA}', 'fee-A'), ('${IDS.orderB}', 'fee-B');
INSERT INTO public.payments (id, order_id, type, amount_cents, stripe_payment_intent_id) VALUES
  ('${IDS.payA}', '${IDS.orderA}', 'deposit', 5000, 'pi_secret_A'), ('${IDS.payB}', '${IDS.orderB}', 'deposit', 5000, 'pi_secret_B'),
  ('${IDS.payLegacy}', '${IDS.orderLegacy}', 'deposit', 5000, 'pi_secret_L');
INSERT INTO public.invoice_links (id, order_id, link_token, link_type, expires_at) VALUES
  ('${IDS.linkA}', '${IDS.orderA}', 'tok_secret_A', 'portal', now() + interval '1 day'),
  ('${IDS.linkB}', '${IDS.orderB}', 'tok_secret_B', 'portal', now() + interval '1 day');
INSERT INTO public.consent_records (order_id, consent_type, consented, consent_text) VALUES ('${IDS.orderA}', 'sms', true, 't');
INSERT INTO public.contacts (id, email, first_name, last_name, customer_id) VALUES
  ('00000000-0000-4000-8000-00000000c0a1', 'a@example.com', 'Ann', 'A', NULL),
  ('${IDS.contactLegacy}', 'legacy@example.com', 'Lee', 'Legacy', '${IDS.custLegacy}'),
  ('00000000-0000-4000-8000-00000000c0b2', 'orphan@example.com', 'No', 'Customer', NULL);
-- Historical account: customers.user_id was never populated; ownership is auth user -> customer_profiles -> contacts -> customers.
INSERT INTO public.customer_profiles (user_id, contact_id) VALUES ('${IDS.uLegacy}', '${IDS.contactLegacy}');
-- Internal values that must NEVER reach a customer-facing projection (searched for as sentinels).
UPDATE public.orders SET stripe_customer_id = 'cus_SECRET', stripe_payment_method_id = 'pm_SECRET', payment_method_id = 'pmid_SECRET',
  admin_message = 'INTERNAL_SECRET', waiver_signature_data = 'WAIVER_SECRET', payment_lock = true,
  same_day_pickup_fee_waive_reason = 'WAIVE_SECRET', tax_waive_reason = 'WAIVE_SECRET'
  WHERE id IN ('${IDS.orderA}', '${IDS.orderB}', '${IDS.orderLegacy}');
INSERT INTO public.booking_setup_proofs (order_id, token_hash, expires_at) VALUES ('${IDS.orderA}', 'hash-A-0000000000000000000000000000', now() + interval '1 hour');
INSERT INTO public.task_status (order_id, task_type, task_date) VALUES ('${IDS.orderA}', 'drop-off', '2030-06-01');
INSERT INTO public.order_changelog (order_id, field_changed, change_type) VALUES ('${IDS.orderA}', 'status', 'status_change');
`;

export interface Scenario {
  name: string;
  role: 'anon' | 'authenticated' | 'service_role';
  uid: string | null;
  sql: string; // must return one text/int value
  expect: string | ((v: string) => boolean);
}

const cnt = (t: string, where = 'true') => `SELECT count(*)::text FROM public.${t} WHERE ${where}`;
const denied = 'ERR:42501';
const n = (sql: string) => `pg_temp.n($u$${sql}$u$)`;
const upd = (sql: string) => `SELECT ${n(sql)}::text`;

export const ORDER_PROJECTION_KEYS = ['addresses', 'balance_due_cents', 'balance_paid_cents', 'can_use_stakes', 'custom_deposit_cents', 'customers', 'deposit_due_cents', 'deposit_paid_cents', 'end_window', 'event_date', 'event_end_date', 'event_end_time', 'event_start_time', 'generator_fee_cents', 'generator_fee_waived', 'generator_qty', 'has_pets', 'id', 'location_type', 'order_custom_fees', 'order_discounts', 'order_items', 'payments', 'pickup_preference', 'same_day_pickup_fee_cents', 'same_day_pickup_fee_waived', 'same_day_weekday_delivery_fee_cents', 'same_day_weekday_delivery_fee_waived', 'setup_fee_cents', 'signed_waiver_url', 'special_details', 'start_window', 'status', 'subtotal_cents', 'surface', 'surface_fee_cents', 'surface_fee_waived', 'tax_cents', 'tax_waived', 'tip_cents', 'travel_fee_cents', 'travel_fee_waived', 'travel_per_mile_cents', 'travel_total_miles', 'waiver_signed_at', 'workflow_status'].join(',');

const PRIVATE_TABLES = [
  'customers', 'addresses', 'orders', 'order_items', 'order_discounts', 'order_custom_fees', 'payments', 'invoice_links',
  'consent_records', 'contacts', 'booking_setup_proofs', 'order_changelog', 'order_lot_pictures', 'order_pictures',
  'task_status', 'documents', 'messages', 'route_stops', 'order_signatures', 'transaction_receipts', 'order_portal_links',
  'crew_location_history', 'notification_failures', 'notification_system_status', 'sms_message_templates',
];

// Built from parts so the literal legacy short-link names never appear in src/ (a portal-link test scans src/ for them).
const LEGACY_RPCS = ['get_order_by_token', 'get_order_with_relations_by_token', 'approve_order_changes', ['create', 'portal', 'short', 'link'].join('_'), ['resolve', 'portal', 'short', 'link'].join('_')];

export function buildScenarios(): Scenario[] {
  const s: Scenario[] = [];
  const add = (name: string, role: Scenario['role'], uid: string | null, sql: string, expect: Scenario['expect']) => s.push({ name, role, uid, sql, expect });

  // ---- anonymous attacker (holds only the public anon key; knows every UUID) ----
  for (const t of PRIVATE_TABLES) add(`anon: SELECT on ${t} is denied`, 'anon', null, cnt(t), denied);
  add('anon: cannot select an order by its UUID', 'anon', null, cnt('orders', `id = '${IDS.orderA}'`), denied);
  add('anon: cannot read portal link_token / short_code from invoice_links', 'anon', null, `SELECT link_token FROM public.invoice_links WHERE order_id = '${IDS.orderA}' LIMIT 1`, denied);
  add('anon: cannot read invoice link expiry / revocation state', 'anon', null, `SELECT expires_at::text FROM public.invoice_links WHERE order_id = '${IDS.orderA}' LIMIT 1`, denied);
  add('anon: cannot extend or un-revoke an invoice link', 'anon', null, upd(`UPDATE public.invoice_links SET expires_at = now() + interval '10 years', revoked_at = NULL WHERE order_id = '${IDS.orderA}'`), denied);
  add('anon: cannot update an order status', 'anon', null, upd(`UPDATE public.orders SET status = 'confirmed' WHERE id = '${IDS.orderA}'`), denied);
  add('anon: cannot set booking_confirmation_sent (old anon UPDATE policy)', 'anon', null, upd(`UPDATE public.orders SET booking_confirmation_sent = true WHERE id = '${IDS.orderA}'`), denied);
  add('anon: cannot insert an order', 'anon', null, `INSERT INTO public.orders (location_type, event_date, event_end_date, start_window, end_window, subtotal_cents, deposit_due_cents, balance_due_cents, pickup_preference) VALUES ('residential','2031-01-01','2031-01-01','09:00','17:00',0,0,0,'next_day') RETURNING 'inserted'`, denied);
  add('anon: cannot insert order items', 'anon', null, `INSERT INTO public.order_items (order_id, unit_id, unit_price_cents, qty) VALUES ('${IDS.orderA}', '${IDS.unitActive}', 1, 1) RETURNING 'inserted'`, denied);
  add('anon: cannot insert consent records', 'anon', null, `INSERT INTO public.consent_records (order_id, consent_type, consented, consent_text) VALUES ('${IDS.orderA}', 'sms', true, 'x') RETURNING 'inserted'`, denied);
  add('anon: cannot insert or update customers', 'anon', null, `INSERT INTO public.customers (first_name,last_name,email,phone) VALUES ('x','x','evil@example.com','1') RETURNING 'inserted'`, denied);
  add('anon: cannot insert addresses', 'anon', null, `INSERT INTO public.addresses (line1,city,state,zip) VALUES ('x','x','MI','1') RETURNING 'inserted'`, denied);
  add('anon: cannot insert contacts (old checkout upsert policy)', 'anon', null, `INSERT INTO public.contacts (email, first_name, last_name) VALUES ('evil@example.com','x','x') RETURNING 'inserted'`, denied);
  add('anon: cannot insert payments or transaction receipts', 'anon', null, `INSERT INTO public.payments (order_id, type, amount_cents) VALUES ('${IDS.orderA}', 'deposit', 1) RETURNING 'inserted'`, denied);
  add('anon: cannot obtain booking setup proof hashes', 'anon', null, `SELECT token_hash FROM public.booking_setup_proofs LIMIT 1`, denied);
  add('anon: cannot rewrite pricing_rules', 'anon', null, upd(`UPDATE public.pricing_rules SET deposit_per_unit_cents = 1`), denied);
  add('anon: cannot rewrite unit prices', 'anon', null, upd(`UPDATE public.units SET price_dry_cents = 1`), denied);
  add('anon: cannot insert or delete units', 'anon', null, `DELETE FROM public.units WHERE true RETURNING 'deleted'`, denied);
  add('anon: CAN still read pricing_rules (public quote)', 'anon', null, `SELECT (count(*) >= 1)::text FROM public.pricing_rules`, 'true');
  add('anon: CAN still read active units, and ONLY active units', 'anon', null, `SELECT (count(*) FILTER (WHERE NOT active) = 0 AND count(*) FILTER (WHERE active) >= 1)::text FROM public.units`, 'true');
  add('anon: CAN still read unit media (public catalog)', 'anon', null, `SELECT 'ok' FROM (SELECT count(*) FROM public.unit_media) s`, 'ok');
  for (const fn of ['public.create_booking_request(jsonb, text, timestamptz, uuid)', 'public.get_my_orders(integer)', 'public.get_my_last_order_address()', 'public.is_crew_or_admin()', 'public.current_customer_ids()']) {
    add(`anon: cannot EXECUTE ${fn.split('(')[0]}`, 'anon', null, `SELECT has_function_privilege('anon', '${fn}', 'EXECUTE')::text`, 'false');
  }
  for (const fn of LEGACY_RPCS) {
    add(`anon / authenticated cannot EXECUTE legacy RPC ${fn}`, 'anon', null, `SELECT (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${fn}')::text`, 'false');
    add(`service_role CAN still EXECUTE legacy RPC ${fn}`, 'anon', null, `SELECT (SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${fn}')::text`, 'true');
  }
  add('create_booking_request: service_role only', 'anon', null, `SELECT (has_function_privilege('service_role','public.create_booking_request(jsonb, text, timestamptz, uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.create_booking_request(jsonb, text, timestamptz, uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.create_booking_request(jsonb, text, timestamptz, uuid)','EXECUTE'))::text`, 'true');

  // ---- Customer A (signed in) ----
  const A = IDS.uA;
  add('A: direct SELECT on orders returns ZERO rows (no ordinary-customer policy on the base table)', 'authenticated', A, cnt('orders'), '0');
  add('A: cannot read their own order\'s Stripe customer id directly', 'authenticated', A, cnt('orders', `id = '${IDS.orderA}' AND stripe_customer_id IS NOT NULL`), '0');
  add('A: cannot read their own order row by UUID', 'authenticated', A, cnt('orders', `id = '${IDS.orderA}'`), '0');
  add('A: get_my_orders returns exactly their own order', 'authenticated', A, `SELECT string_agg(x->>'id', ',') FROM public.get_my_orders() x`, IDS.orderA);
  add('A: cannot read Order B by UUID', 'authenticated', A, cnt('orders', `id = '${IDS.orderB}'`), '0');
  add('A: sees only their own customer row', 'authenticated', A, cnt('customers'), '1');
  add('A: cannot read Customer B', 'authenticated', A, cnt('customers', `id = '${IDS.custB}'`), '0');
  add('A: cannot read the guest customer', 'authenticated', A, cnt('customers', `id = '${IDS.custG}'`), '0');
  add('A: sees their own address, not B\'s', 'authenticated', A, `SELECT (count(*) FILTER (WHERE id = '${IDS.addrA}') = 1 AND count(*) FILTER (WHERE id = '${IDS.addrB}') = 0)::text FROM public.addresses`, 'true');
  add('A: no direct access to order items (they arrive inside get_my_orders)', 'authenticated', A, cnt('order_items'), '0');
  add('A: no direct access to discounts or custom fees', 'authenticated', A, `SELECT ((SELECT count(*) FROM public.order_discounts) + (SELECT count(*) FROM public.order_custom_fees))::text`, '0');
  add('A: reads only ACTIVE units directly (no owner policy on units)', 'authenticated', A, `SELECT (count(*) FILTER (WHERE NOT active) = 0)::text FROM public.units`, 'true');
  add('A: get_my_orders still names the (now inactive) unit on their own order', 'authenticated', A, `SELECT string_agg(i->'units'->>'name', ',') FROM public.get_my_orders() x, jsonb_array_elements(x->'order_items') i`, 'Retired Unit A');
  add('A: cannot read ANY payment row directly (no processor ids)', 'authenticated', A, cnt('payments'), '0');
  add('A: get_my_orders carries exactly their own payment', 'authenticated', A, `SELECT string_agg(p->>'id', ',') FROM public.get_my_orders() x, jsonb_array_elements(x->'payments') p`, IDS.payA);
  add('A: get_my_orders never carries Order B\'s payment, items or order', 'authenticated', A, `SELECT count(*)::text FROM public.get_my_orders() x WHERE x::text LIKE '%${IDS.payB}%' OR x::text LIKE '%${IDS.orderB}%'`, '0');
  add('A: nested payment objects expose only customer-facing fields', 'authenticated', A, `SELECT string_agg(k, ',' ORDER BY k) FROM (SELECT DISTINCT jsonb_object_keys(p) k FROM public.get_my_orders() x, jsonb_array_elements(x->'payments') p) s`, 'amount_cents,created_at,id,order_id,paid_at,payment_brand,payment_last4,payment_method,status,type');
  add('A: the order projection has exactly the allowlisted top-level keys', 'authenticated', A, `SELECT string_agg(k, ',' ORDER BY k) FROM (SELECT DISTINCT jsonb_object_keys(x) k FROM public.get_my_orders() x) s`, ORDER_PROJECTION_KEYS);
  add('A: no internal-looking key exists anywhere in the projection', 'authenticated', A, `SELECT count(*)::text FROM (SELECT jsonb_object_keys(x) k FROM public.get_my_orders() x) s WHERE k ~* '(stripe|processor|admin|waiver_signature|payment_lock|payment_method_id|reason|alert|token|proof|notified|internal|customer_id|created_by)'`, '0');
  add('A: LEAK TEST — no sentinel secret value appears anywhere in the serialized get_my_orders() result', 'authenticated', A, `SELECT count(*)::text FROM public.get_my_orders() x WHERE x::text ~ '(cus_SECRET|pm_SECRET|pmid_SECRET|INTERNAL_SECRET|WAIVER_SECRET|WAIVE_SECRET|ch_SECRET|pi_secret|tok_secret|hash-A|stripe)'`, '0');
  add('A: Customer B\'s secrets cannot appear either', 'authenticated', A, `SELECT count(*)::text FROM public.get_my_orders() x WHERE x::text ~ '(pi_secret_B|tok_secret_B)'`, '0');
  add('A: get_my_orders accepts no caller-supplied customer id (named argument is rejected)', 'authenticated', A, `SELECT count(*)::text FROM public.get_my_orders(p_customer_id => '${IDS.custB}')`, 'ERR:42883');
  add('A: get_my_orders accepts no caller-supplied email or user id (positional text is rejected)', 'authenticated', A, `SELECT count(*)::text FROM public.get_my_orders('b@example.com')`, 'ERR:22P02');
  add('A: forging the email JWT claim as Customer B still returns only A\'s order', 'authenticated', A, `SELECT string_agg(x->>'id', ',') FROM (SELECT set_config('request.jwt.claim.email', 'b@example.com', true)) f, public.get_my_orders() x`, IDS.orderA);
  add('A: current_customer_ids() returns exactly Customer A', 'authenticated', A, `SELECT string_agg(c::text, ',') FROM public.current_customer_ids() c`, IDS.custA);
  add('A: get_my_last_order_address returns the event address of their own order only', 'authenticated', A, `SELECT public.get_my_last_order_address()->>'line1'`, '1 A St');
  add('A: cannot read any invoice link row (no token / short code)', 'authenticated', A, cnt('invoice_links'), '0');
  add('A: cannot update an invoice link', 'authenticated', A, upd(`UPDATE public.invoice_links SET expires_at = now() + interval '10 years' WHERE order_id = '${IDS.orderA}'`), '0');
  add('A: cannot insert an invoice link', 'authenticated', A, `INSERT INTO public.invoice_links (order_id, link_token, link_type, expires_at) VALUES ('${IDS.orderA}', 'mine', 'portal', now() + interval '1 day') RETURNING 'inserted'`, denied);
  for (const t of ['consent_records', 'contacts', 'order_changelog', 'task_status', 'documents', 'messages', 'route_stops', 'order_signatures', 'transaction_receipts', 'order_portal_links', 'crew_location_history', 'notification_failures', 'notification_system_status', 'sms_message_templates', 'order_pictures', 'order_lot_pictures']) {
    add(`A: sees no rows of ${t}`, 'authenticated', A, cnt(t), (v) => v === '0' || v === denied);
  }
  add('A: cannot read booking_setup_proofs', 'authenticated', A, cnt('booking_setup_proofs'), denied);
  add('A: cannot update their order status', 'authenticated', A, upd(`UPDATE public.orders SET status = 'confirmed' WHERE id = '${IDS.orderA}'`), '0');
  add('A: cannot update their deposit_paid_cents', 'authenticated', A, upd(`UPDATE public.orders SET deposit_paid_cents = 5000 WHERE id = '${IDS.orderA}'`), '0');
  add('A: cannot insert an order', 'authenticated', A, `INSERT INTO public.orders (customer_id, status, location_type, event_date, event_end_date, start_window, end_window, subtotal_cents, deposit_due_cents, balance_due_cents, pickup_preference) VALUES ('${IDS.custA}','draft','residential','2031-01-01','2031-01-01','09:00','17:00',0,0,0,'next_day') RETURNING 'inserted'`, denied);
  add('A: cannot update a customer record (not even their own)', 'authenticated', A, upd(`UPDATE public.customers SET email = 'taken@example.com' WHERE id = '${IDS.custA}'`), '0');
  add('A: cannot rewrite pricing_rules / unit prices / SMS templates', 'authenticated', A, `SELECT (${n('UPDATE public.pricing_rules SET deposit_per_unit_cents = 1')} + ${n('UPDATE public.units SET price_dry_cents = 1')} + ${n("UPDATE public.sms_message_templates SET message_template = 'x'")})::text`, '0');
  add('A: cannot TRUNCATE a private table', 'authenticated', A, `SELECT has_table_privilege('authenticated', 'public.orders', 'TRUNCATE')::text`, 'false');

  // ---- Customer B (the mirror image) ----
  const B = IDS.uB;
  add('B: direct orders SELECT returns zero rows; get_my_orders returns exactly their own order', 'authenticated', B, `SELECT ((SELECT count(*) FROM public.orders)::text || ':' || (SELECT string_agg(x->>'id', ',') FROM public.get_my_orders() x))`, '0:' + IDS.orderB);
  add('B: cannot read Order A, Customer A, Address A, Payment A, Link A', 'authenticated', B, `SELECT ((SELECT count(*) FROM public.orders WHERE id = '${IDS.orderA}') + (SELECT count(*) FROM public.customers WHERE id = '${IDS.custA}') + (SELECT count(*) FROM public.addresses WHERE id = '${IDS.addrA}') + (SELECT count(*) FROM public.payments) + (SELECT count(*) FROM public.invoice_links))::text`, '0');
  add('B: get_my_orders carries only B\'s payment', 'authenticated', B, `SELECT string_agg(p->>'id', ',') FROM public.get_my_orders() x, jsonb_array_elements(x->'payments') p`, IDS.payB);
  add('B: leak test — no sentinel secret in B\'s projection', 'authenticated', B, `SELECT count(*)::text FROM public.get_my_orders() x WHERE x::text ~ '(cus_SECRET|pm_SECRET|INTERNAL_SECRET|WAIVER_SECRET|pi_secret|tok_secret|stripe)'`, '0');

  // ---- Historical account: customers.user_id NULL, linked through customer_profiles -> contacts -> customers ----
  const L = IDS.uLegacy;
  add('Legacy: current_customer_ids() includes the profile/contact-linked customer', 'authenticated', L, `SELECT string_agg(c::text, ',') FROM public.current_customer_ids() c`, IDS.custLegacy);
  add('Legacy: get_my_orders returns the historical order, and only that one', 'authenticated', L, `SELECT string_agg(x->>'id', ',') FROM public.get_my_orders() x`, IDS.orderLegacy);
  add('Legacy: direct SELECT on orders still returns zero rows', 'authenticated', L, cnt('orders'), '0');
  add('Legacy: payment history of the historical order is included, and safe', 'authenticated', L, `SELECT string_agg(p->>'id', ',') FROM public.get_my_orders() x, jsonb_array_elements(x->'payments') p`, IDS.payLegacy);
  add('Legacy: no sentinel secret in the historical order projection', 'authenticated', L, `SELECT count(*)::text FROM public.get_my_orders() x WHERE x::text ~ '(cus_SECRET|pm_SECRET|INTERNAL_SECRET|WAIVER_SECRET|pi_secret|stripe)'`, '0');
  add('Legacy: cannot see Customer A or B orders', 'authenticated', L, `SELECT count(*)::text FROM public.get_my_orders() x WHERE x->>'id' IN ('${IDS.orderA}', '${IDS.orderB}')`, '0');
  add('Legacy: the matching email address does NOT matter (ownership is the profile link, not the email)', 'authenticated', L, `SELECT count(*)::text FROM (SELECT set_config('request.jwt.claim.email', 'a@example.com', true)) f, public.get_my_orders() x WHERE x->>'id' = '${IDS.orderA}'`, '0');

  // ---- A signed-in user with no customer record ----
  add('Stranger (signed in, no customer record or profile): sees no orders / customers / payments', 'authenticated', '00000000-0000-4000-8000-0000000000ff', `SELECT ((SELECT count(*) FROM public.orders) + (SELECT count(*) FROM public.customers) + (SELECT count(*) FROM public.get_my_orders()) + (SELECT count(*) FROM public.current_customer_ids()))::text`, '0');
  add('Stranger: get_my_last_order_address returns nothing', 'authenticated', '00000000-0000-4000-8000-0000000000ff', `SELECT COALESCE(public.get_my_last_order_address()::text, 'NULL')`, 'NULL');
  add('Anonymous: get_my_orders / current_customer_ids are not callable', 'anon', null, `SELECT count(*)::text FROM public.get_my_orders()`, denied);
  add('service_role: get_my_orders is callable but returns nothing (no auth.uid())', 'service_role', null, `SELECT count(*)::text FROM public.get_my_orders()`, '0');
  add('get_my_orders: authenticated and service_role may execute it, PUBLIC / anon may not', 'anon', null, `SELECT (has_function_privilege('authenticated','public.get_my_orders(integer)','EXECUTE') AND has_function_privilege('service_role','public.get_my_orders(integer)','EXECUTE') AND NOT has_function_privilege('anon','public.get_my_orders(integer)','EXECUTE'))::text`, 'true');

  // ---- Crew ----
  const C = IDS.uCrew;
  add('crew: reads all orders (calendar)', 'authenticated', C, cnt('orders'), '4');
  add('crew: reads customers, addresses, order items, discounts, fees, task status, all units', 'authenticated', C, `SELECT ((SELECT count(*) FROM public.customers) >= 3 AND (SELECT count(*) FROM public.addresses) >= 2 AND (SELECT count(*) FROM public.order_items) >= 2 AND (SELECT count(*) FROM public.task_status) >= 1 AND (SELECT count(*) FROM public.units WHERE NOT active) >= 2)::text`, 'true');
  add('crew: workflow_status update on an order works', 'authenticated', C, upd(`UPDATE public.orders SET workflow_status = 'on_the_way' WHERE id = '${IDS.orderA}'`), '1');
  add('crew: can update task_status (en route / arrived / completed)', 'authenticated', C, upd(`UPDATE public.task_status SET status = 'en_route' WHERE order_id = '${IDS.orderA}'`), '1');
  add('crew: can create a DRAFT invoice order', 'authenticated', C, `INSERT INTO public.orders (status, location_type, event_date, event_end_date, start_window, end_window, subtotal_cents, deposit_due_cents, balance_due_cents, pickup_preference) VALUES ('draft','residential','2031-01-01','2031-01-01','09:00','17:00',0,0,0,'next_day') RETURNING 'inserted'`, 'inserted');
  add('crew: cannot create a CONFIRMED order', 'authenticated', C, `INSERT INTO public.orders (status, location_type, event_date, event_end_date, start_window, end_window, subtotal_cents, deposit_due_cents, balance_due_cents, pickup_preference) VALUES ('confirmed','residential','2031-01-01','2031-01-01','09:00','17:00',0,0,0,'next_day') RETURNING 'inserted'`, denied);
  add('crew: can create customers, addresses, order items for an invoice', 'authenticated', C, `WITH c AS (INSERT INTO public.customers (first_name,last_name,email,phone) VALUES ('n','n','new@example.com','1') RETURNING id), a AS (INSERT INTO public.addresses (line1,city,state,zip,address_key) VALUES ('1','c','MI','1','crew-key') RETURNING id), i AS (INSERT INTO public.order_items (order_id, unit_id, unit_price_cents, qty) VALUES ('${IDS.orderA}', '${IDS.unitActive}', 1, 1) RETURNING 1) SELECT 'ok' FROM c, a, i`, 'ok');
  add('crew: can log location', 'authenticated', C, `INSERT INTO public.crew_location_history (latitude, longitude) VALUES (1, 1) RETURNING 'inserted'`, 'inserted');
  for (const t of ['payments', 'invoice_links', 'consent_records', 'contacts', 'order_changelog', 'order_signatures', 'transaction_receipts', 'documents', 'messages']) {
    add(`crew: sees no rows of ${t} (no financial / link / consent / CRM access)`, 'authenticated', C, cnt(t), '0');
  }
  add('crew: cannot insert a payment', 'authenticated', C, `INSERT INTO public.payments (order_id, type, amount_cents) VALUES ('${IDS.orderA}', 'deposit', 1) RETURNING 'inserted'`, denied);
  add('crew: cannot update an invoice link', 'authenticated', C, upd('UPDATE public.invoice_links SET revoked_at = now()'), '0');
  add('crew: cannot rewrite pricing_rules or unit prices', 'authenticated', C, `SELECT (${n('UPDATE public.pricing_rules SET deposit_per_unit_cents = 1')} + ${n('UPDATE public.units SET price_dry_cents = 1')})::text`, '0');
  add('crew: cannot read booking_setup_proofs', 'authenticated', C, cnt('booking_setup_proofs'), denied);

  // ---- Admin / master ----
  const D = IDS.uAdmin;
  add('admin: reads all orders', 'authenticated', D, cnt('orders'), (v) => Number(v) >= 3);
  add('admin: reads all payments', 'authenticated', D, cnt('payments'), '3');
  add('admin: reads all invoice links', 'authenticated', D, cnt('invoice_links'), '2');
  add('admin: reads all customers', 'authenticated', D, cnt('customers'), (v) => Number(v) >= 3);
  add('admin: reads consent records, contacts, changelog', 'authenticated', D, `SELECT ((SELECT count(*) FROM public.consent_records) = 1 AND (SELECT count(*) FROM public.contacts) = 3 AND (SELECT count(*) FROM public.order_changelog) = 1)::text`, 'true');
  add('admin: can update an order', 'authenticated', D, upd(`UPDATE public.orders SET admin_message = 'hi' WHERE id = '${IDS.orderA}'`), '1');
  add('admin: can update and revoke an invoice link', 'authenticated', D, upd(`UPDATE public.invoice_links SET revoked_at = now() WHERE id = '${IDS.linkA}'`), '1');
  add('admin: can record a payment', 'authenticated', D, `INSERT INTO public.payments (order_id, type, amount_cents) VALUES ('${IDS.orderA}', 'deposit', 1) RETURNING 'inserted'`, 'inserted');
  add('admin: can update pricing_rules and units', 'authenticated', D, `SELECT (${n('UPDATE public.pricing_rules SET deposit_per_unit_cents = deposit_per_unit_cents')} >= 1 AND ${n('UPDATE public.units SET price_dry_cents = price_dry_cents')} >= 1)::text`, 'true');
  add('admin: can append to the changelog but not rewrite it', 'authenticated', D, `SELECT (${n(`INSERT INTO public.order_changelog (order_id, field_changed, change_type) VALUES ('${IDS.orderA}', 'status', 'status_change')`)} = 1 AND ${n("UPDATE public.order_changelog SET change_type = 'x'")} = 0)::text`, 'true');
  add('admin: booking_setup_proofs stays service-role only', 'authenticated', D, cnt('booking_setup_proofs'), denied);

  // ---- Service role (Edge Functions) ----
  for (const t of ['orders', 'customers', 'addresses', 'order_items', 'payments', 'invoice_links', 'consent_records', 'contacts', 'booking_setup_proofs', 'order_changelog', 'task_status']) {
    add(`service_role: reads ${t}`, 'service_role', null, `SELECT (count(*) >= 1)::text FROM public.${t}`, 'true');
  }
  add('service_role: can write orders, invoice links, proofs', 'service_role', null, `SELECT (${n("UPDATE public.orders SET admin_message = 's'")} >= 1 AND ${n('UPDATE public.invoice_links SET revoked_at = NULL')} >= 1 AND ${n('UPDATE public.booking_setup_proofs SET claim_id = NULL')} >= 1)::text`, 'true');


  // ---- Public booking RPC still works for the service role (the server-owned booking boundary); the account guard still applies ----
  const book = (email: string, caller: string | null, line2: string) => `SELECT pg_temp.book('${email}', ${caller ? `'${caller}'::uuid` : 'NULL::uuid'}, '${line2}')`;
  add('booking RPC (service_role): a new guest booking is created as a draft, nothing paid, with its own delivery unit', 'service_role', null, book('brand-new@example.com', null, 'Apt 9'), 'draft|Apt 9|0|true');
  add('booking RPC (service_role): a booking with no unit stores an empty unit', 'service_role', null, book('another-new@example.com', null, ''), 'draft||0|true');
  add('booking RPC (service_role): a GUEST customer record can still be used without sign-in', 'service_role', null, book('g@example.com', null, 'Apt 2'), 'draft|Apt 2|0|true');
  add('booking RPC (service_role): anonymous caller using a REGISTERED customer email is rejected', 'service_role', null, book('a@example.com', null, 'Apt 3'), 'ERR:P0001');
  add('booking RPC (service_role): a different signed-in user using a registered email is rejected', 'service_role', null, book('a@example.com', IDS.uB, 'Apt 3'), 'ERR:P0001');
  add('booking RPC (service_role): the registered owner can book with their own email', 'service_role', null, book('a@example.com', IDS.uA, 'Apt 3'), 'draft|Apt 3|0|true');
  // The approval timestamp the repaired schema provides: NULL until a customer approval stamps it (order-lifecycle's write), then a timestamp.
  add('approval timestamp: a seeded order has none before approval', 'service_role', null, `SELECT (customer_approved_at IS NULL)::text FROM public.orders WHERE id = '${IDS.orderLegacy}'`, 'true');
  add('approval timestamp: stamping it on approval stores a timestamp', 'service_role', null, `WITH u AS (UPDATE public.orders SET customer_approved_at = now() WHERE id = '${IDS.orderLegacy}' AND customer_approved_at IS NULL RETURNING customer_approved_at) SELECT (customer_approved_at IS NOT NULL)::text FROM u`, 'true');
  add('booking RPC: authenticated users and anon cannot call it directly', 'anon', null, `SELECT (NOT has_function_privilege('anon','public.create_booking_request(jsonb, text, timestamptz, uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.create_booking_request(jsonb, text, timestamptz, uuid)','EXECUTE'))::text`, 'true');
  return s;
}

export function buildScript(scenarios: Scenario[]): string {
  const calls = scenarios.map((sc, i) => {
    const uid = sc.uid ? `'${sc.uid}'::uuid` : 'NULL::uuid';
    return `  RAISE NOTICE 'R|${i}|%', pg_temp.as_role('${sc.role}', ${uid}, $q$${sc.sql}$q$);`;
  });
  return `
BEGIN;
${SEED_SQL}
CREATE FUNCTION pg_temp.as_role(r text, uid uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE res text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', r, true);
  EXECUTE 'SET LOCAL ROLE ' || quote_ident(r);
  BEGIN
    EXECUTE q INTO res;
  EXCEPTION WHEN OTHERS THEN
    res := 'ERR:' || SQLSTATE;
  END;
  RESET ROLE;
  RETURN COALESCE(res, 'NULL');
END $f$;
CREATE FUNCTION pg_temp.book(p_email text, p_caller uuid, p_line2 text) RETURNS text LANGUAGE plpgsql AS $b$
DECLARE res jsonb; o record;
BEGIN
  res := public.create_booking_request(
    jsonb_build_object(
      'contact', jsonb_build_object('first_name', 'Test', 'last_name', 'Booker', 'email', p_email, 'phone', '5559990000', 'business_name', NULL),
      'address', jsonb_build_object('line1', '9 Test Rd', 'line2', p_line2, 'city', 'Wayne', 'state', 'MI', 'zip', '48184', 'lat', 42.3, 'lng', -83.4, 'address_key', '9 test rd|wayne|MI|48184'),
      'order', jsonb_build_object('location_type', 'residential', 'surface', 'grass', 'event_date', '2031-02-01', 'event_end_date', '2031-02-01',
        'pickup_preference', 'next_day', 'start_window', '09:00', 'end_window', '17:00', 'until_end_of_day', false,
        'same_day_responsibility_accepted', false, 'overnight_responsibility_accepted', false,
        'subtotal_cents', 10000, 'event_essentials_subtotal_cents', 0, 'travel_fee_cents', 0, 'travel_total_miles', 5, 'travel_base_radius_miles', 20,
        'travel_chargeable_miles', 0, 'travel_per_mile_cents', 200, 'travel_is_flat_fee', false, 'surface_fee_cents', 0, 'same_day_pickup_fee_cents', 0,
        'same_day_weekday_delivery_fee_cents', 0, 'setup_fee_cents', 0, 'tax_cents', 600, 'tip_cents', 0, 'deposit_due_cents', 5000, 'balance_due_cents', 5600,
        'customer_selected_payment_cents', 5000, 'customer_selected_payment_type', 'deposit', 'sms_consent_text', 'sms text'),
      'items', jsonb_build_array(jsonb_build_object('unit_id', '40000000-0000-4000-8000-00000000aaaa','wet_or_dry', 'dry', 'unit_price_cents', 10000, 'qty', 1,
        'product_id', NULL, 'bundle_id', NULL, 'item_name', NULL, 'pricing_context', NULL, 'component_snapshot', NULL)),
      'consents', jsonb_build_array(jsonb_build_object('consent_type', 'sms', 'consent_text', 't', 'consent_version', '1.0')),
      'request_meta', jsonb_build_object('ip_address', '203.0.113.9', 'user_agent', 'scenario')
    ),
    md5(random()::text) || md5(random()::text), now() + interval '30 minutes', p_caller);
  SELECT status, event_address_line2, deposit_paid_cents, customer_approved_at INTO o FROM public.orders WHERE id = (res->>'order_id')::uuid;
  RETURN o.status || '|' || COALESCE(o.event_address_line2, 'NULL') || '|' || o.deposit_paid_cents || '|' || (o.customer_approved_at IS NULL);
END $b$;
CREATE FUNCTION pg_temp.n(q text) RETURNS integer LANGUAGE plpgsql AS $g$
DECLARE c integer;
BEGIN
  EXECUTE q;
  GET DIAGNOSTICS c = ROW_COUNT;
  RETURN c;
END $g$;
-- Functions created by the migration role no longer start out executable by PUBLIC, and these helpers are called while a scenario is
-- running as anon / authenticated / service_role.
GRANT EXECUTE ON FUNCTION pg_temp.n(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.as_role(text, uuid, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.book(text, uuid, text) TO PUBLIC;
DO $run$
BEGIN
${calls.join('\n')}
END $run$;
ROLLBACK;
`;
}
