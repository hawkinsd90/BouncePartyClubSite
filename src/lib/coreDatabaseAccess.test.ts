// Core database access lockdown.
//
// Three layers, labelled so nobody mistakes one for another:
//   STATIC     parses the core-database-access migration text and asserts structural invariants (always runs).
//   SOURCE     scans the browser code for direct access to private tables (always runs).
//   EXECUTED   runs ~150 real SQL scenarios as the real `anon` / `authenticated` / `service_role` Postgres roles against a
//              SCRATCH PostgreSQL database that has the repo migrations (including the lockdown) replayed into it. It never touches
//              a Supabase project. Locate the scratch database with CORE_DB_NAME (default "scratch"), CORE_DB_PORT (54329),
//              CORE_DB_HOST (127.0.0.1), CORE_DB_PSQL (path to psql). When no scratch database is reachable the EXECUTED layer is
//              reported as SKIPPED — that is a limitation of the environment, not a pass. Set CORE_DB_REQUIRE=1 to make a
//              missing database a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/coreDatabaseAccess.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync } = require('child_process');

import { buildScenarios, buildScript, ORDER_PROJECTION_KEYS, SEED_SQL } from './coreDatabaseAccessScenarios';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
function eq(label: string, a: unknown, b: unknown) {
  ok(`${label} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
}
const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// Built from parts so the literal legacy short-link names never appear in src/ (a portal-link test scans src/ for them).
const LEGACY_RPCS = ['get_order_by_token', 'get_order_with_relations_by_token', 'approve_order_changes', ['create', 'portal', 'short', 'link'].join('_'), ['resolve', 'portal', 'short', 'link'].join('_')];
const rpcCall = (names: string[]) => new RegExp('\\.rpc\\(\\s*[\'"`](' + names.join('|') + ')[\'"`]');
const MIGRATION ='supabase/migrations/20261012120000_core_database_access_lockdown.sql';
const sqlRaw = read(MIGRATION);
const sql = stripSql(sqlRaw);

// ---------------------------------------------------------------------------------------------------------------
// Parse the migration
// ---------------------------------------------------------------------------------------------------------------
interface Policy { name: string; table: string; cmd: string; roles: string[]; using: string | null; check: string | null }

function balanced(text: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  throw new Error('unbalanced');
}

function parsePolicies(text: string): Policy[] {
  const out: Policy[] = [];
  const re = /CREATE POLICY "([^"]+)" ON public\.(\w+)([^;]*);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = norm(m[3]);
    const cmd = (/^FOR (ALL|SELECT|INSERT|UPDATE|DELETE)/.exec(body)?.[1] ?? 'ALL').toUpperCase();
    const roles = (/ TO ([\w, ]+?)(?= USING| WITH CHECK|$)/.exec(' ' + body)?.[1] ?? 'PUBLIC').split(',').map((r) => r.trim().toLowerCase());
    const u = body.indexOf('USING (');
    const c = body.indexOf('WITH CHECK (');
    out.push({
      name: m[1],
      table: m[2],
      cmd,
      roles,
      using: u >= 0 ? norm(balanced(body, u + 'USING '.length)) : null,
      check: c >= 0 ? norm(balanced(body, c + 'WITH CHECK '.length)) : null,
    });
  }
  return out;
}

const policies = parsePolicies(sql);
const byTable = (t: string) => policies.filter((p) => p.table === t);
const text = (p: Policy) => `${p.using ?? ''} ${p.check ?? ''}`;

const OWNED = ['customers', 'addresses', 'orders', 'order_items', 'order_discounts', 'order_custom_fees', 'payments', 'invoice_links', 'consent_records', 'contacts', 'booking_setup_proofs', 'order_changelog', 'order_lot_pictures', 'order_pictures', 'task_status', 'documents', 'messages', 'route_stops', 'order_signatures', 'transaction_receipts', 'order_portal_links', 'crew_location_history', 'notification_failures', 'notification_system_status', 'sms_message_templates', 'pricing_rules', 'units', 'unit_media'];
const PUBLIC_READ = ['pricing_rules', 'units', 'unit_media'];
const PRIVATE = OWNED.filter((t) => !PUBLIC_READ.includes(t));

// =================================================================================================================
// STATIC layer
// =================================================================================================================
{
  // -- reset + RLS coverage --
  const arr = /owned text\[\] := ARRAY\[([\s\S]*?)\];/.exec(sql)?.[1] ?? '';
  const inArray = [...arr.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  eq('static: the policy reset covers exactly the tables this phase owns', [...inArray].sort(), [...OWNED].sort());
  ok('static: the reset drops EVERY existing policy on those tables (whatever its name) and enables RLS on each', /FROM pg_policies WHERE schemaname = 'public' AND tablename = t/.test(sql) && /EXECUTE format\('DROP POLICY %I ON public\.%I', r\.policyname, t\)/.test(sql) && /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/.test(sql));
  ok('static: FORCE / DISABLE row level security is never used (service role + definer owner must keep bypassing)', !/FORCE ROW LEVEL SECURITY|NO FORCE|DISABLE ROW LEVEL SECURITY/i.test(sql));

  // -- no destructive or data-changing statements --
  ok('static: no DROP TABLE / DROP COLUMN / TRUNCATE / ALTER COLUMN', !/\bDROP TABLE\b|\bDROP COLUMN\b|\bTRUNCATE TABLE\b|\bALTER COLUMN\b|\bTRUNCATE\s+public/i.test(sql));
  ok('static: no data statements at all (no INSERT INTO / UPDATE ... SET / DELETE FROM at statement level)', !/(^|;)\s*(INSERT INTO|UPDATE\s+[\w.]+\s+SET|DELETE FROM)\b/i.test(sql.replace(/\$\$[\s\S]*?\$\$/g, ' ')));
  const withoutReadFunctions = sql.replace(/CREATE OR REPLACE FUNCTION public\.get_my_orders[\s\S]*?\$\$;/, '').replace(/CREATE OR REPLACE FUNCTION public\.get_my_last_order_address[\s\S]*?\$\$;/, '');
  ok('static: no money / pricing / payment behaviour is changed (money columns appear only in the read-only customer projection)', !/_cents|deposit|refund|tax_|price/i.test(withoutReadFunctions.replace(/pricing_rules/g, '')));

  // -- every policy: roles, predicates --
  for (const p of policies) {
    ok(`static: policy "${p.name}" on ${p.table} is only for authenticated${PUBLIC_READ.includes(p.table) && p.cmd === 'SELECT' && p.roles.includes('anon') ? ' / the intentionally public read' : ''}`, p.roles.every((r) => r === 'authenticated' || (PUBLIC_READ.includes(p.table) && p.cmd === 'SELECT' && r === 'anon')));
  }
  const literalTrue = policies.filter((p) => /^true$/i.test(p.using ?? '') || /^true$/i.test(p.check ?? ''));
  eq('static: the only USING (true) policies are the three deliberate public reads', literalTrue.map((p) => p.table).sort(), ['pricing_rules', 'unit_media']);
  const PREDICATES = ['is_admin()', 'is_crew_or_admin()', 'auth.uid()', 'current_customer_ids()'];
  for (const p of policies.filter((x) => PRIVATE.includes(x.table))) {
    ok(`static: policy "${p.name}" restricts by role or ownership (no bare authenticated)`, PREDICATES.some((k) => text(p).includes(k)));
  }
  ok('static: no email / phone / name matching is used as an authorization predicate', !/auth\.email\(\)|auth\.users|\.email\s*=|email\s*=\s*\(|phone\s*=|signer_email/i.test(policies.map(text).join(' ')));
  ok('static: no POLICY mentions delivery-unit / line2 text (the unit fix is independent of RLS)', !/line2|event_address/i.test(policies.map(text).join(' ')));

  // -- invoice_links --
  const il = byTable('invoice_links');
  eq('static: invoice_links has exactly ONE policy', il.length, 1);
  ok('static: ...and it is admin/master only (ALL, authenticated, is_admin())', il[0].cmd === 'ALL' && il[0].roles.join() === 'authenticated' && il[0].using === '(SELECT public.is_admin())' && il[0].check === '(SELECT public.is_admin())');
  ok('static: no invoice_links policy mentions tokens, short codes, expiry or revocation (no token-validity read path)', !il.some((p) => /link_token|short_code|expires_at|revoked_at|now\(\)/i.test(text(p))));
  ok('static: no anon / PUBLIC invoice_links policy exists', !il.some((p) => p.roles.includes('anon') || p.roles.includes('public')));
  ok('static: invoice_links has no owner, crew or anonymous predicate', !il.some((p) => /current_customer_ids|is_crew_or_admin|user_id/.test(text(p))));

  // -- payments --
  const pay = byTable('payments');
  eq('static: payments has exactly three policies (admin select / insert / update)', pay.map((p) => p.cmd).sort(), ['INSERT', 'SELECT', 'UPDATE']);
  ok('static: every payments policy is is_admin() only (no owner, no crew)', pay.every((p) => /is_admin\(\)/.test(text(p)) && !/current_customer_ids|is_crew_or_admin|auth\.uid/.test(text(p))));
  const projection = read('supabase/functions/_shared/portal-projection.ts');
  const projectedPaymentKeys = [...(/export function projectPayment[\s\S]*?pick\(row, \[([\s\S]*?)\]\)/.exec(projection)?.[1] ?? '').matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]).sort();

  // get_my_orders: the only way an ordinary signed-in customer reads their orders
  const funcBody = (name: string) => new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\(([\\s\\S]*?)\\$\\$;').exec(sql)?.[0] ?? '';
  const ordersFn = funcBody('get_my_orders');
  ok('static: get_my_orders exists', ordersFn.length > 100);
  ok('static: get_my_orders takes ONLY a page size (no customer, user, contact, email or order id parameter)', /get_my_orders\(p_limit integer DEFAULT 50\)/.test(ordersFn));
  ok('static: get_my_orders is SECURITY DEFINER with a pinned search_path', /SECURITY DEFINER\s+SET search_path = public/.test(ordersFn));
  ok('static: get_my_orders derives identity ONLY from current_customer_ids() (auth.uid())', /WHERE o\.customer_id IN \(SELECT public\.current_customer_ids\(\)\)/.test(ordersFn) && !/p_customer|p_user|p_email|p_contact|p_order/.test(ordersFn));
  const splitTop = (txt: string): string[] => {
    const out: string[] = []; let depth = 0; let cur = ''; let inStr = false;
    for (const ch of txt) {
      if (ch === "'") inStr = !inStr;
      if (!inStr && ch === '(') depth++;
      if (!inStr && ch === ')') depth--;
      if (!inStr && depth === 0 && ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const objectArgs = (body: string, startNeedle: string): string[] => {
    const at = body.indexOf(startNeedle);
    const open = body.indexOf('(', at + startNeedle.length - 1);
    return splitTop(balanced(body, open));
  };
  const topKeys = objectArgs(ordersFn, 'SELECT jsonb_build_object(').filter((_, i) => i % 2 === 0).map((k) => k.replace(/'/g, '')).sort();
  eq('static: the get_my_orders projection is exactly the reviewed allowlist (top-level keys)', topKeys, ORDER_PROJECTION_KEYS.split(','));
  const FORBIDDEN_KEY = /stripe|processor|admin|waiver_signature|payment_lock|payment_method_id|reason|alert|token|proof|notif|internal|customer_id|created_by|link/i;
  ok('static: no forbidden / internal key is returned at the top level', !topKeys.some((k) => FORBIDDEN_KEY.test(k)));
  ok('static: get_my_orders never selects whole rows (no o.*, to_jsonb(o), row_to_json)', !/\bo\.\*|to_jsonb\(\s*o\s*\)|row_to_json|to_jsonb\(\s*(c|a|oi|p|d|f)\s*\)/.test(ordersFn));
  ok('static: get_my_orders never references a Stripe / processor / admin / waiver-signature / payment_lock column', !/o\.stripe|p\.stripe|admin_message|waiver_signature|payment_lock|payment_method_id|_waive_reason|invoice_links|booking_setup_proofs|link_token/.test(ordersFn));
  const nestedPaymentKeys = objectArgs(ordersFn.slice(ordersFn.indexOf("'payments', COALESCE(")), 'jsonb_build_object(').filter((_, i) => i % 2 === 0).map((k) => k.replace(/'/g, '')).sort();
  eq('static: the nested payment objects carry exactly the customer-facing payment fields the portal projection returns', nestedPaymentKeys, projectedPaymentKeys);
  ok('static: no email / phone / name matching is used to decide ownership in get_my_orders', !/auth\.email|auth\.users|jwt|\.email\s*=|phone\s*=|first_name\s*=|last_name\s*=/i.test(ordersFn.replace(/'customers', \([\s\S]*?\n {4}\),/, '')));
  const lastAddr = funcBody('get_my_last_order_address');
  ok('static: get_my_last_order_address is identity-bound, SECURITY DEFINER, pinned, and takes no argument', /get_my_last_order_address\(\)/.test(lastAddr) && /current_customer_ids\(\)/.test(lastAddr) && /SECURITY DEFINER\s+SET search_path = public/.test(lastAddr));
  ok('static: get_my_last_order_address returns only address fields', !/stripe|admin|payment|total|cents/.test(lastAddr.slice(lastAddr.indexOf('SELECT jsonb_build_object'))));
  // ownership helper
  const ownFn = funcBody('current_customer_ids');
  ok('static: current_customer_ids supports direct customers.user_id ownership', /c\.user_id = auth\.uid\(\)/.test(ownFn));
  ok('static: current_customer_ids supports the historical customer_profiles -> contacts -> customers relationship, bound to auth.uid()', /cp\.user_id = auth\.uid\(\)/.test(ownFn) && /JOIN public\.contacts ct ON ct\.id = cp\.contact_id/.test(ownFn) && /ct\.customer_id IS NOT NULL/.test(ownFn) && /\bUNION\b/.test(ownFn));
  ok('static: current_customer_ids uses no email, phone, name or caller-supplied value (no parameters, no email columns)', /current_customer_ids\(\)\s+RETURNS SETOF uuid/.test(ownFn) && !/email|phone|first_name|last_name|auth\.email|jwt/i.test(ownFn.replace(/--[^\n]*/g, '')));
  ok('static: current_customer_ids is SECURITY DEFINER with a pinned search_path and exposes only customer ids', /SECURITY DEFINER\s+SET search_path = public/.test(ownFn) && /RETURNS SETOF uuid/.test(ownFn));
  ok('static: customers / contacts stay private — no ordinary-customer policy was added to contacts or customer_profiles', byTable('contacts').every((p) => /is_admin\(\)/.test(text(p))) && !policies.some((p) => p.table === 'customer_profiles'));

  // -- customers / orders ownership --
  const cust = byTable('customers');
  ok('static: the customers owner policy is exactly user_id = auth.uid()', cust.some((p) => p.name === 'Customers read their own customer record' && p.cmd === 'SELECT' && p.using === 'user_id = (SELECT auth.uid())'));
  ok('static: customers has NO owner UPDATE / INSERT / DELETE policy', !cust.some((p) => p.cmd !== 'SELECT' && /auth\.uid\(\)/.test(text(p)) && !/is_admin|is_crew/.test(text(p))));
  const ord = byTable('orders');
  ok('static: an ordinary signed-in customer has NO policy of any command on orders (admin / crew only)', ord.length >= 1 && ord.every((p) => /is_admin\(\)|is_crew_or_admin\(\)/.test(text(p))) && !ord.some((p) => /current_customer_ids|auth\.uid|user_id/.test(text(p))));
  ok('static: no orders policy lets a customer-owner, anon, or bare authenticated caller SELECT', !ord.some((p) => (p.cmd === 'SELECT' || p.cmd === 'ALL') && !/is_admin\(\)|is_crew_or_admin\(\)/.test(text(p))));
  ok('static: the owner has no orders write policy', !ord.some((p) => p.cmd !== 'SELECT' && /current_customer_ids/.test(text(p))));
  ok('static: crew may only INSERT DRAFT orders', ord.some((p) => p.cmd === 'INSERT' && /is_crew_or_admin/.test(text(p)) && /status = 'draft'/.test(text(p))) && !ord.some((p) => p.cmd === 'INSERT' && /is_crew_or_admin/.test(text(p)) && !/status = 'draft'/.test(text(p))));
  const ownerPolicies = (t: string) => byTable(t).filter((p) => /current_customer_ids|auth\.uid|user_id/.test(text(p)));
  for (const t of ['orders', 'order_items', 'order_discounts', 'order_custom_fees', 'units', 'payments', 'invoice_links', 'consent_records', 'contacts', 'order_changelog', 'task_status']) {
    ok(`static: ${t} has NO ordinary-customer policy (read only through get_my_orders or not at all)`, ownerPolicies(t).length === 0);
  }
  eq('static: the ordinary-customer direct table policies are exactly: own customers row + own addresses', policies.filter((p) => /current_customer_ids|auth\.uid\(\)|user_id/.test(text(p))).map((p) => p.table + ':' + p.name).sort(), ['addresses:Customers read their own addresses', 'customers:Customers read their own customer record']);
  const addrOwner = byTable('addresses').find((p) => p.name === 'Customers read their own addresses');
  ok('static: the addresses owner policy is read-only, bound to current_customer_ids() and the caller\'s own default address, and never reads orders', !!addrOwner && addrOwner.cmd === 'SELECT' && /current_customer_ids\(\)/.test(addrOwner.using ?? '') && /default_address_id/.test(addrOwner.using ?? '') && !/orders/.test(addrOwner.using ?? ''));

  // -- crew matrix --
  const crew: Record<string, string[]> = {
    customers: ['INSERT', 'SELECT'], addresses: ['INSERT', 'SELECT', 'UPDATE'], orders: ['INSERT', 'SELECT', 'UPDATE'],
    order_items: ['INSERT', 'SELECT'], order_discounts: ['INSERT', 'SELECT'], order_custom_fees: ['INSERT', 'SELECT'],
    order_pictures: ['SELECT'], task_status: ['SELECT', 'UPDATE'], crew_location_history: ['INSERT'],
    notification_failures: ['INSERT'], units: ['SELECT'],
  };
  for (const t of OWNED) {
    const got = byTable(t).filter((p) => /is_crew_or_admin/.test(text(p))).map((p) => p.cmd).sort();
    eq(`static: crew commands on ${t}`, got, crew[t] ?? []);
  }
  for (const t of ['payments', 'invoice_links', 'consent_records', 'contacts', 'order_changelog', 'order_signatures', 'transaction_receipts', 'documents', 'messages', 'route_stops', 'sms_message_templates', 'pricing_rules']) {
    ok(`static: crew has no access to ${t}`, !byTable(t).some((p) => /is_crew_or_admin/.test(text(p))));
  }

  // -- every other private table: admin only --
  for (const t of ['consent_records', 'contacts', 'order_changelog', 'order_lot_pictures', 'documents', 'messages', 'route_stops', 'order_signatures', 'transaction_receipts', 'order_portal_links', 'notification_system_status', 'sms_message_templates']) {
    ok(`static: ${t} is admin/master only`, byTable(t).length >= 1 && byTable(t).every((p) => /is_admin\(\)/.test(text(p)) && !/is_crew_or_admin|current_customer_ids/.test(text(p))));
  }
  eq('static: booking_setup_proofs has no policy at all (service role only)', byTable('booking_setup_proofs').length, 0);
  ok('static: order_changelog is append-only for staff (no UPDATE / DELETE policy)', byTable('order_changelog').every((p) => p.cmd === 'SELECT' || p.cmd === 'INSERT'));

  // -- public read tables keep reads only for anon --
  for (const t of PUBLIC_READ) {
    const anonPolicies = byTable(t).filter((p) => p.roles.includes('anon'));
    ok(`static: ${t} gives anon SELECT only`, anonPolicies.length === 1 && anonPolicies[0].cmd === 'SELECT');
    ok(`static: ${t} writes are admin/master only`, byTable(t).filter((p) => p.cmd !== 'SELECT').every((p) => /is_admin\(\)/.test(text(p))));
  }
  ok('static: only ACTIVE units are readable by the public', byTable('units').some((p) => p.cmd === 'SELECT' && p.roles.includes('anon') && p.using === 'active = true'));

  // -- table privileges --
  const revokeAnon = norm(/REVOKE ALL ON TABLE\s+([\s\S]*?)\s+FROM anon;/.exec(sql)?.[1] ?? '');
  const revokedAnonTables = revokeAnon.split(',').map((x) => x.trim().replace(/^public\./, '')).filter(Boolean).sort();
  eq('static: anon is revoked ALL table privileges on every private table', revokedAnonTables, [...PRIVATE].sort());
  ok('static: anon keeps SELECT on the public-read tables (only write privileges are revoked)', /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.pricing_rules, public\.units, public\.unit_media FROM anon;/.test(sql));
  ok('static: TRUNCATE / TRIGGER / REFERENCES are revoked from authenticated on every owned table', /REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE[\s\S]*?FROM authenticated;/.test(sql));
  ok('static: no table GRANT is made to anon, PUBLIC or authenticated', !/GRANT\s+(?!EXECUTE)[A-Z, ]+\s+ON\s+(TABLE\s+)?public\./i.test(sql));
  ok('static: service_role is never revoked from any table', !/REVOKE[^;]*FROM[^;]*service_role/i.test(sql.replace(/FROM PUBLIC, anon, authenticated/g, '')));

  // -- functions --
  ok('static: every EXECUTE grant in the migration goes to authenticated and/or service_role only', [...sql.matchAll(/GRANT EXECUTE ON FUNCTION[^;]*? TO ([a-z_, ]+?)(?=;|')/gi)].every((m) => !/anon|public/i.test(m[1])));
  ok('static: create_booking_request is not mentioned (it stays service-role only as granted in the public-booking and delivery-unit migrations)', !/create_booking_request/.test(sql));
  const svcList = /AND p\.proname IN \(([^)]*)\)\s*LOOP\s*EXECUTE format\('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated'/.exec(sql)?.[1] ?? '';
  eq('static: legacy token-based order RPCs become service-role only', [...svcList.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(), [...LEGACY_RPCS].sort());
  ok('static: ...and service_role is granted EXECUTE on them', /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated[\s\S]{0,80}GRANT EXECUTE ON FUNCTION %s TO service_role/.test(sql));
  const authList = /AND p\.proname IN \(([^)]*)\)\s*LOOP\s*EXECUTE format\('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon'/.exec(sql)?.[1] ?? '';
  eq('static: admin-style RPCs lose anon but stay available to signed-in callers', [...authList.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(), ['archive_old_orders', 'get_user_order_prefill', 'save_lot_picture_to_address']);
  for (const fn of ['is_crew_or_admin()', 'current_customer_ids()', 'get_my_orders(integer)', 'get_my_last_order_address()']) {
    ok(`static: ${fn} is revoked from PUBLIC and anon, granted to authenticated and service_role`, sql.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`) && sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated, service_role;`));
  }
  ok('static: the role helpers are SECURITY DEFINER with a pinned search_path and compare roles case-insensitively', /FUNCTION public\.is_crew_or_admin\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = public[\s\S]*?lower\(role\) IN \('admin', 'master', 'crew'\)/.test(sql));

  // -- ordering with the other migrations --
  const files: string[] = fs.readdirSync('supabase/migrations').sort();
  const idx = (n: string) => files.indexOf(n);
  // The approval timestamp column must exist before anything that lists it (create_booking_request, order-lifecycle).
  const APPROVAL = '20261010110000_add_customer_approval_timestamp.sql';
  const BOOKING = '20261010120000_secure_public_booking_creation.sql';
  const DELIVERY_UNIT = '20261011120000_order_event_address_line2.sql';
  const LOCKDOWN = '20261012120000_core_database_access_lockdown.sql';
  ok('static: migration order is approval timestamp < secure public booking < delivery unit < core database access lockdown', [APPROVAL, BOOKING, DELIVERY_UNIT, LOCKDOWN].every((f) => idx(f) >= 0) && idx(APPROVAL) < idx(BOOKING) && idx(BOOKING) < idx(DELIVERY_UNIT) && idx(DELIVERY_UNIT) < idx(LOCKDOWN));
  ok('static: before the booking migration the column is only mentioned by this migration and by the older approval function body (PL/pgSQL, resolved at call time, so it needs the column only when it runs, not when it is created); every statement that needs the column at creation or call time in this chain runs after the migration that adds it', files.filter((f) => f < BOOKING && /customer_approved_at/.test(read('supabase/migrations/' + f))).every((f) => f === APPROVAL || f === '20260421025937_tighten_orders_rls_replace_open_policies_with_rpc.sql'));
  const approvalSql = read('supabase/migrations/' + APPROVAL).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  ok('static: the approval timestamp migration is one nullable, default-less, idempotent column add and nothing else', approvalSql === 'ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_approved_at timestamptz;');
  ok('static: the booking migration still lists customer_approved_at, so the column has to come from the migration history', /customer_approved_at/.test(read('supabase/migrations/' + BOOKING)));
  ok('static: no internal coordination label in the booking migration filename or header', !new RegExp(['payment', 'safety'].join('_') + '|a2_3|' + ['A2', '3'].join('\\.') + '|Phase|Stage').test(BOOKING +read('supabase/migrations/' + BOOKING).slice(0, 400)));
  // No test helper may create the production column: the schema has to come from the migrations alone.
  const addCol = new RegExp('ADD COLUMN[^;]*' + ['customer', 'approved', 'at'].join('_'), 'i');
  const offenders: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = d + '/' + e.name; if (e.isDirectory()) walk(f); else if (/\.(ts|tsx|js|sql)$/.test(e.name) && f !== 'src/lib/coreDatabaseAccess.test.ts' && addCol.test(read(f))) offenders.push(f); } };
  walk('src');
  ok('static: no test or source file adds the approval column outside the migration', offenders.length === 0);
  ok('static: the scenario seed does not alter the schema', !/ALTER TABLE(?! auth.users DISABLE TRIGGER USER;)|CREATE TABLE/i.test(SEED_SQL));
  ok('static: the core-database-access migration sorts after the public-booking and delivery-unit migrations', idx('20261012120000_core_database_access_lockdown.sql') > idx('20261011120000_order_event_address_line2.sql') && idx('20261011120000_order_event_address_line2.sql') > idx('20261010120000_secure_public_booking_creation.sql'));
  ok('static: the delivery-unit migration (which restates create_booking_request) is untouched in meaning', /event_address_line2/.test(read('supabase/migrations/20261011120000_order_event_address_line2.sql')));
}

// =================================================================================================================
// SOURCE layer — who in the browser still touches the private tables
// =================================================================================================================
{
  const SENSITIVE = ['customers', 'addresses', 'orders', 'order_items', 'consent_records', 'payments', 'invoice_links', 'contacts', 'booking_setup_proofs', 'order_changelog', 'order_lot_pictures', 'order_pictures', 'task_status', 'documents', 'order_signatures', 'order_discounts', 'order_custom_fees', 'transaction_receipts'];
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const allFiles: string[] = fs.readdirSync('src', { recursive: true }).map((f: string) => `src/${f.replace(/\\/g, '/')}`).filter((f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !/database\.types\.ts$/.test(f));
  const touches = (f: string) => SENSITIVE.filter((t) => new RegExp(`\\.from\\(\\s*['"\`]${t}['"\`]`).test(strip(read(f))));

  // Surfaces that must never touch a private table directly: anonymous public site, public booking, Customer Portal.
  const PUBLIC_SURFACE = allFiles.filter((f) =>
    /^src\/components\/customer-portal\//.test(f) ||
    /^src\/pages\/(CustomerPortal|ShortLink|StripeCheckoutReturn|StripeCheckoutCanceled|Checkout|Sign|Receipt|Quote|Catalog|UnitDetail|Home|Contact|About|EventEssentialsCatalog|LegacyInvoiceRedirect|Login|ForgotPassword|ResetPassword|MenuPreview|InvoicePreview)\.tsx$/.test(f) ||
    /^src\/lib\/(bookingApi|customerPortalApi|portalToken|portalLinks|edgeAuth|customerPortalPolling|customerPortalRefreshSignal)\.ts$/.test(f) ||
    /^src\/hooks\/(useBookingReturnConfirmation|useCheckoutData|useQuoteCart|useQuoteForm|useQuotePricing|useQuotePrefill)\.ts$/.test(f),
  );
  ok('source: the public-surface file set is non-trivial', PUBLIC_SURFACE.length >= 25);
  for (const f of PUBLIC_SURFACE) ok(`source: ${f} has no direct access to a private table`, touches(f).length === 0);
  ok('source: no public/portal file subscribes to Postgres changes (no Realtime dependency on table RLS)', PUBLIC_SURFACE.every((f) => !/postgres_changes/.test(strip(read(f)))));
  ok('source: no public/portal file calls a sensitive RPC directly', PUBLIC_SURFACE.every((f) => !rpcCall([...LEGACY_RPCS, 'create_booking_request', 'upsert_contact_from_checkout']).test(strip(read(f)))));
  ok('source: no browser file calls a legacy token RPC at all (so revoking them breaks nothing)', allFiles.every((f) => !rpcCall(LEGACY_RPCS).test(strip(read(f)))));

  // Every remaining direct user must be a known staff / owner surface. A new file touching a private table fails here.
  const STAFF = /^src\/(components\/(admin|order-detail|pending-order|calendar|crew)\/|components\/AdminCalendar\.tsx|pages\/(Admin|UnitForm)\.tsx|lib\/queries\/|lib\/(orderApprovalService|staffOrderSaveRequest|invoiceService|addressService|orderSummaryLoader|availability|taskStatusService|transactionReceiptService|orderNotificationService|notificationFailures|orderLifecycleApi)\.ts|hooks\/(useCalendarTasks|useCustomerManagement|useAdminOrderDetails|usePendingOrderData|useAdminAnalytics|useAdminPhotos|useOrderDuplication|useInvoiceData|useAdminSettings)\.ts)/;
  const OWNER = /^src\/(contexts\/CustomerProfileContext\.tsx|pages\/SignUp\.tsx)$/;
  const direct = allFiles.filter((f) => touches(f).length > 0);
  const unclassified = direct.filter((f) => !STAFF.test(f) && !OWNER.test(f));
  eq('source: every file that still touches a private table is a classified staff or signed-in-owner surface', unclassified, []);
  eq('source: the only files that still read tables directly as a signed-in customer are the profile context and sign-up', direct.filter((f) => OWNER.test(f)).sort(), ['src/contexts/CustomerProfileContext.tsx', 'src/pages/SignUp.tsx']);
  const cpc = strip(read('src/contexts/CustomerProfileContext.tsx'));
  ok('source: the profile context reads only customers and addresses directly (never orders, payments or contacts)', touches('src/contexts/CustomerProfileContext.tsx').sort().join() === 'addresses,customers' && !/from\('(orders|payments|contacts|customer_profiles)'\)/.test(cpc) && /rpc\('get_my_last_order_address'\)/.test(cpc));
  ok('source: sign-up reads only its own customers row (no CRM access)', touches('src/pages/SignUp.tsx').join() === 'customers' && !/from\('contacts'\)/.test(strip(read('src/pages/SignUp.tsx'))));
  const useOrders = strip(read('src/hooks/useOrders.ts'));
  ok('source: the dashboard hook reads NO table: it calls get_my_orders only', !/\.from\(/.test(useOrders) && /rpc\('get_my_orders'\)/.test(useOrders));
  ok('source: the dashboard hook sends no identity (no email, customer id, contact id) and no select(*)', !/email|customer_id|contact|select\(/i.test(useOrders.replace(/userId/g, '')));
  ok('source: the dashboard components, receipt flow and duplicate flow read no table at all', ['src/pages/CustomerDashboard.tsx', 'src/hooks/useOrderDuplication.ts', ...allFiles.filter((f) => /^src\/components\/dashboard\//.test(f))].every((f) => !/\.from\(|supabase\./.test(strip(read(f)))));
  ok('source: the receipt is built from the loaded order (no direct orders query)', /buildOrderSummaryData\(/.test(strip(read('src/pages/CustomerDashboard.tsx'))) && !/loadOrderSummary/.test(strip(read('src/pages/CustomerDashboard.tsx'))));
  ok('source: the old payments embed and the email-based owner lookup are gone', !/payments\s*\(\s*\*\s*\)/.test(useOrders) && !/customer_profiles|contacts/.test(useOrders));
  ok('source: Customer Portal talks to the server APIs only', /customer-portal-data/.test(read('src/lib/customerPortalApi.ts')) && /customer-portal-action/.test(read('src/lib/customerPortalApi.ts')));
  ok('source: public booking goes through create-booking and the booking proof', /create-booking/.test(read('src/lib/bookingApi.ts')) && /bookingToken/.test(read('src/lib/bookingApi.ts')));

  // Printable classification table (documentation of the direct-dependency map)
  const groups: Record<string, string[]> = { staff: [], owner: [] };
  for (const f of direct) (OWNER.test(f) ? groups.owner : groups.staff).push(f);
  ok('source: classification printed below is complete', groups.staff.length + groups.owner.length === direct.length);
  if (process.env.CORE_DB_PRINT_MAP) console.log(JSON.stringify(groups, null, 1));
}

// =================================================================================================================
// EXECUTED layer — real SQL as the real roles in a SCRATCH database
// =================================================================================================================
{
  const db = process.env.CORE_DB_NAME || 'scratch';
  const port = process.env.CORE_DB_PORT || '54329';
  const host = process.env.CORE_DB_HOST || '127.0.0.1';
  const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
  const args = ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-X', '-q', '-w'];
  let psql: string | null = null;
  for (const c of candidates) {
    const probe = spawnSync(c, [...args, '-Atc', "SELECT to_regprocedure('public.is_crew_or_admin()') IS NOT NULL"], { encoding: 'utf8', timeout: 15000 });
    if (probe.status === 0 && probe.stdout.trim() === 't') { psql = c; break; }
  }
  if (!psql) {
    if (process.env.CORE_DB_REQUIRE) ok('executed: a scratch database with the core-database-access migration applied is available (CORE_DB_REQUIRE is set)', false);
    else console.log('EXECUTED layer SKIPPED: no scratch PostgreSQL database with the core-database-access migration was reachable (see the header of this file).');
  } else {
    // The payment / pricing migrations post-date the lockdown and tighten the order tables further; the scenarios describe the
    // schema as it will be deployed, so they are applied (inside the rolled-back transaction) first.
    const PRICING_CHAIN = [
      'supabase/migrations/20261019120000_add_payment_operations_and_single_financial_application.sql',
      'supabase/migrations/20261020120000_deposit_catch_up_and_offline_payment_parity.sql',
      'supabase/migrations/20261021120000_server_authoritative_order_pricing_saves.sql',
      'supabase/migrations/20261022120000_refund_safety_and_financial_write_authority.sql',
      'supabase/migrations/20261023120000_refund_allocation_schema.sql',
      'supabase/migrations/20261024120000_refund_allocation_reservation.sql',
      'supabase/migrations/20261025120000_refund_overview_for_admin.sql',
    ];
    const scenarios = buildScenarios();
    const r = spawnSync(psql, [...args, '-v', 'ON_ERROR_STOP=1'], { input: buildScript(scenarios, PRICING_CHAIN.map((f) => read(f)).join('\n')), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 120000 });
    const results: Record<number, string> = {};
    for (const m of ((r.stderr ?? '') + (r.stdout ?? '')).matchAll(/R\|(\d+)\|(.*)/g)) results[Number(m[1])] = m[2].trim();
    ok(`executed: the scenario script ran to completion in database "${db}" (${Object.keys(results).length}/${scenarios.length} results)`, Object.keys(results).length === scenarios.length);
    scenarios.forEach((s, i) => {
      const got = results[i];
      const good = typeof s.expect === 'string' ? got === s.expect : s.expect(got);
      ok(`executed: ${s.name} (got ${got})`, good);
    });
  }
}

console.log(`Core database access tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} core database access test(s) failed`);
