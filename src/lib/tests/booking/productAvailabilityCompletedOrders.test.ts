// D4 / WP-P1-23: public.check_product_availability (Event Essentials stock) keeps reserving quantities for COMPLETED orders on their
// original rental dates (migration 20261028120000), changing nothing else about the function.
//
//   STATIC    the migration is additive, sorts last, differs from the previous definition (20260716231832) only in the two status lists,
//             and does not touch the inflatable function (always runs).
//   EXECUTED  real SQL in a scratch database holding the COMPLETE repository chain (AVAIL_DB_NAME, default "bpc_replay_full"), one
//             rolled-back transaction, ZZ TEST fixtures only. The scenarios run twice: against the function as the chain left it
//             ("new") and against the previous definition re-applied inside the same transaction ("old"), so the test proves both that
//             the new behaviour is present and that everything else, including signature, SECURITY DEFINER, search_path, owner and
//             grants (pg_proc / has_function_privilege), is identical before and after.
// Run: node scripts/dev/run-tests.cjs productAvailabilityCompletedOrders

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const NEW_FILE = '20261028120000_check_product_availability_count_completed_orders.sql';
const OLD_FILE = '20260716231832_fix_check_product_availability_visibility.sql';
const NEW_SQL = read(`supabase/migrations/${NEW_FILE}`);
const OLD_SQL = read(`supabase/migrations/${OLD_FILE}`);

// ------------------------------------------------------------------ STATIC
{
  const files: string[] = fs.readdirSync('supabase/migrations').filter((f: string) => /^\d{14}_.+\.sql$/.test(f)).sort();
  const versions = files.map((f) => f.slice(0, 14));
  ok('static: every migration has a unique 14-digit version', new Set(versions).size === versions.length);
  ok('static: the new migration version is unique', versions.filter((v) => v === NEW_FILE.slice(0, 14)).length === 1);
  const idx = files.indexOf(NEW_FILE);
  ok('static: the new migration exists and no later-timestamped migration was slipped in before it', idx >= 0 && files.slice(idx + 1).every((f) => f.slice(0, 14) > NEW_FILE.slice(0, 14)));
  ok('static: the previous definition file is unchanged in name and still has no "completed" in its lists', [...OLD_SQL.matchAll(/o\.status IN \(([^)]*)\)/g)].length === 2 && [...OLD_SQL.matchAll(/o\.status IN \(([^)]*)\)/g)].every((m) => !m[1].includes("'completed'")));

  const body = (s: string) => s.slice(s.indexOf('CREATE OR REPLACE FUNCTION')).replace(/\s+$/, '');
  const a = body(OLD_SQL).split('\n');
  const b = body(NEW_SQL).split('\n');
  const diffs = a.length === b.length ? a.map((l, i) => (l === b[i] ? null : [l, b[i]])).filter(Boolean) as string[][] : [];
  ok('static: the new definition has the same line count as the previous one', a.length === b.length);
  ok('static: exactly two lines differ (the two reservation lists)', diffs.length === 2);
  ok('static: each differing line only appends \'completed\' to the status list', diffs.every(([o, n]) => n === o.replace("'in_progress')", "'in_progress', 'completed')")));
  ok('static: no GRANT, REVOKE, ALTER, DROP or inflatable function in the new migration (CREATE OR REPLACE keeps owner and grants)', !/\b(GRANT|REVOKE|ALTER|DROP)\b\s/i.test(NEW_SQL.replace(/\/\*[\s\S]*?\*\//, '')) && !/check_unit_availability/.test(NEW_SQL.replace(/\/\*[\s\S]*?\*\//, '')));
}

// ------------------------------------------------------------------ fixtures (ZZ TEST)
const U = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CAT = U(1), CUST = U(2), ADDR = U(3), UNIT = U(4), BUNDLE = U(5);
const STATUSES = ['pending_review', 'awaiting_customer_approval', 'confirmed', 'in_progress', 'completed', 'cancelled', 'void', 'draft'] as const;
const prodFor = (i: number) => U(100 + i);
const orderFor = (i: number) => U(200 + i);
const BP = (st: string) => U(300 + STATUSES.indexOf(st as any)); // bundle component product per status
const BO = (st: string) => U(400 + STATUSES.indexOf(st as any)); // bundle order per status
const PU = U(600), UO = U(500);                                               // a completed order holding only an inflatable line
const D1 = '2031-03-10', D2 = '2031-03-11';                      // the original rental dates (a two-day booking)
const BOOKED_QTY = 3, BUNDLE_QTY = 2, PER_BUNDLE = 2, STOCK = 5;

const orderInsert = (id: string, status: string) =>
  `INSERT INTO public.orders (id, customer_id, address_id, status, location_type, event_date, event_end_date, start_window, end_window, subtotal_cents, deposit_due_cents, balance_due_cents, pickup_preference) VALUES ('${id}', '${CUST}', '${ADDR}', '${status}', 'residential', '${D1}', '${D2}', '09:00', '17:00', 100, 50, 50, 'next_day');`;

const FIXTURE_SQL = `
INSERT INTO public.product_categories (id, slug, name) VALUES ('${CAT}', 'zz-test-cat', 'ZZ TEST category');
INSERT INTO public.customers (id, first_name, last_name, email, phone) VALUES ('${CUST}', 'ZZ', 'TEST', 'zz-test-avail@example.com', '5550009999');
INSERT INTO public.addresses (id, customer_id, line1, city, state, zip, address_key) VALUES ('${ADDR}', '${CUST}', '1 ZZ TEST St', 'Wayne', 'MI', '48184', 'zz-test-avail-key');
INSERT INTO public.units (id, slug, name, price_dry_cents, dimensions, footprint_sqft, capacity, types, active) VALUES ('${UNIT}', 'zz-test-avail-unit', 'ZZ TEST inflatable', 10000, '10x10', 100, 10, ARRAY['bounce'], true);
INSERT INTO public.product_bundles (id, slug, name) VALUES ('${BUNDLE}', 'zz-test-avail-bundle', 'ZZ TEST package');
${STATUSES.map((st, i) => `
INSERT INTO public.inventory_products (id, slug, name, total_quantity, active, public_visible, category_id) VALUES ('${prodFor(i)}', 'zz-test-p-${st}', 'ZZ TEST product ${st}', ${STOCK}, true, ${st === 'draft' ? 'false' : 'true'}, '${CAT}');
INSERT INTO public.inventory_products (id, slug, name, total_quantity, active, public_visible, category_id) VALUES ('${BP(st)}', 'zz-test-bp-${st}', 'ZZ TEST bundle component ${st}', ${STOCK * 4}, true, true, '${CAT}');
${orderInsert(orderFor(i), st)}
INSERT INTO public.order_items (order_id, product_id, unit_price_cents, qty, wet_or_dry) VALUES ('${orderFor(i)}', '${prodFor(i)}', 100, ${BOOKED_QTY}, 'dry');
${orderInsert(BO(st), st)}
INSERT INTO public.order_items (order_id, bundle_id, unit_price_cents, qty, wet_or_dry, component_snapshot) VALUES ('${BO(st)}', '${BUNDLE}', 100, ${BUNDLE_QTY}, 'dry', '{"components":[{"product_id":"${BP(st)}","quantity_per_bundle":${PER_BUNDLE}}]}'::jsonb);`).join('')}
INSERT INTO public.inventory_products (id, slug, name, total_quantity, active, public_visible, category_id) VALUES ('${PU}', 'zz-test-pu', 'ZZ TEST product with no product orders', ${STOCK}, true, true, '${CAT}');
${orderInsert(UO, 'completed')}
INSERT INTO public.order_items (order_id, unit_id, unit_price_cents, qty, wet_or_dry) VALUES ('${UO}', '${UNIT}', 10000, 1, 'dry');
`;

// ------------------------------------------------------------------ scenarios (each runs under the new and the old definition)
type Role = 'service_role' | 'anon' | 'authenticated';
interface Sc { name: string; role: Role; sql: string }
const S: Sc[] = [];
const call = (pid: string, qty: number, start: string, end: string, col: string, exclude: string | null = null) =>
  `SELECT ${col}::text FROM public.check_product_availability(jsonb_build_array(jsonb_build_object('product_id', '${pid}', 'quantity', ${qty})), '${start}'::date, '${end}'::date, ${exclude ? `'${exclude}'::uuid` : 'NULL::uuid'})`;
const add = (name: string, role: Role, sql: string) => S.push({ name, role, sql });

STATUSES.forEach((st, i) => {
  add(`direct ${st}: already_reserved on the original dates`, 'service_role', call(prodFor(i), 1, D1, D2, 'already_reserved'));
  add(`direct ${st}: already_reserved on a different date`, 'service_role', call(prodFor(i), 1, '2031-03-20', '2031-03-20', 'already_reserved'));
  add(`direct ${st}: requesting ${BOOKED_QTY} of ${STOCK} on the original dates is_allowed`, 'service_role', call(prodFor(i), BOOKED_QTY, D1, D2, 'is_allowed'));
  add(`package ${st}: component already_reserved on the original dates`, 'service_role', call(BP(st), 1, D1, D2, 'already_reserved'));
  add(`package ${st}: component already_reserved on a different date`, 'service_role', call(BP(st), 1, '2031-03-20', '2031-03-20', 'already_reserved'));
});
add('completed direct: overlap at the last original day still reserves', 'service_role', call(prodFor(4), 1, D2, '2031-03-12', 'already_reserved'));
add('completed direct: the day after the original dates does not reserve', 'service_role', call(prodFor(4), 1, '2031-03-12', '2031-03-12', 'already_reserved'));
add('completed direct: the day before the original dates does not reserve', 'service_role', call(prodFor(4), 1, '2031-03-09', '2031-03-09', 'already_reserved'));
add('completed direct: excluding that order releases it (edit-order flow)', 'service_role', call(prodFor(4), 1, D1, D2, 'already_reserved', orderFor(4)));
add('completed direct: remaining_after_request arithmetic', 'service_role', call(prodFor(4), 1, D1, D2, 'remaining_after_request'));
add('completed direct: as anon (public availability) sees the same reservation', 'anon', call(prodFor(4), 1, D1, D2, 'already_reserved'));
add('completed direct: as authenticated sees the same reservation', 'authenticated', call(prodFor(4), 1, D1, D2, 'already_reserved'));
add('an inflatable-only completed order reserves no Event Essentials stock', 'service_role', call(PU, 1, D1, D2, 'already_reserved'));
add('validation unchanged: empty array', 'service_role', `SELECT public.check_product_availability('[]'::jsonb, '${D1}'::date, '${D1}'::date, NULL)::text`);
add('validation unchanged: end before start', 'service_role', `SELECT count(*)::text FROM public.check_product_availability(jsonb_build_array(jsonb_build_object('product_id', '${prodFor(0)}', 'quantity', 1)), '${D2}'::date, '${D1}'::date, NULL)`);
add('visibility unchanged: a hidden (not public_visible) product is refused for anon', 'anon', call(prodFor(7), 1, D1, D2, 'already_reserved'));
add('inflatable function check_unit_availability behaves identically (it is not touched)', 'service_role', `SELECT public.check_unit_availability('${UNIT}'::uuid, '${D1}'::date, '${D2}'::date, NULL)::text`);

const FNID = `'public.check_product_availability(jsonb,date,date,uuid)'::regprocedure`;
const SNAPSHOT_SQL = `SELECT concat_ws('|', p.prosecdef::text, COALESCE(p.proconfig::text, ''), COALESCE(p.proacl::text, ''), p.proowner::regrole::text,
  pg_get_function_identity_arguments(p.oid), pg_get_function_arguments(p.oid), pg_get_function_result(p.oid), p.provolatile::text, p.proparallel::text, p.proleakproof::text,
  (SELECT lanname FROM pg_language WHERE oid = p.prolang), has_function_privilege('anon', p.oid, 'EXECUTE')::text, has_function_privilege('authenticated', p.oid, 'EXECUTE')::text,
  has_function_privilege('service_role', p.oid, 'EXECUTE')::text, has_function_privilege('public', p.oid, 'EXECUTE')::text)
  FROM pg_proc p WHERE p.oid = ${FNID}`;
const UNIT_SRC_SQL = `SELECT md5(prosrc || proacl::text) FROM pg_proc WHERE oid = 'public.check_unit_availability(uuid,date,date,uuid)'::regprocedure`;
const BODY_SQL = `SELECT ((length(prosrc) - length(replace(prosrc, 'completed', ''))) / length('completed') = 2)::text FROM pg_proc WHERE oid = ${FNID}`;

function script(): string {
  const phase = (tag: string) => {
    const calls = S.map((sc, i) => `  RAISE NOTICE 'R|${tag}|${i}|%', pg_temp.as_role('${sc.role}', $q$${sc.sql}$q$);`);
    return `
DO $run$
BEGIN
  RAISE NOTICE 'R|${tag}|snap|%', pg_temp.as_role('postgres', $q$${SNAPSHOT_SQL}$q$);
  RAISE NOTICE 'R|${tag}|unitsrc|%', pg_temp.as_role('postgres', $q$${UNIT_SRC_SQL}$q$);
  RAISE NOTICE 'R|${tag}|body|%', pg_temp.as_role('postgres', $q$${BODY_SQL}$q$);
${calls.join('\n')}
END $run$;`;
  };
  return `
BEGIN;
CREATE FUNCTION pg_temp.as_role(r text, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE res text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', r, true);
  IF r <> 'postgres' THEN EXECUTE 'SET LOCAL ROLE ' || quote_ident(r); END IF;
  BEGIN EXECUTE q INTO res; EXCEPTION WHEN OTHERS THEN res := 'ERR:' || SQLSTATE; END;
  RESET ROLE;
  RETURN COALESCE(res, 'NULL');
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.as_role(text, text) TO PUBLIC;
${FIXTURE_SQL}
${phase('new')}
${OLD_SQL}
${phase('old')}
ROLLBACK;
`;
}

// ------------------------------------------------------------------ EXECUTED
const db = process.env.AVAIL_DB_NAME || 'bpc_replay_full';
const port = process.env.CORE_DB_PORT || '54329';
const host = process.env.CORE_DB_HOST || '127.0.0.1';
const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
let ran = false;
for (const c of candidates) {
  const probe = spawnSync(c, ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-At', '-X', '-q', '-w', '-c', `SELECT to_regprocedure('public.check_product_availability(jsonb,date,date,uuid)') IS NOT NULL AND to_regclass('public.product_bundles') IS NOT NULL`], { encoding: 'utf8', timeout: 15000 });
  if (probe.status !== 0 || probe.stdout.trim() !== 't') continue;
  ran = true;
  const r = spawnSync(c, ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1'], { input: script(), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 120000 });
  const out: Record<string, Record<string, string>> = { new: {}, old: {} };
  for (const m of (((r.stderr ?? '') + (r.stdout ?? '')) as string).matchAll(/R\|(new|old)\|([a-z0-9]+)\|(.*)/g)) out[m[1]][m[2]] = m[3].trim();
  const expectedKeys = S.length + 3;
  ok(`executed: both phases ran to completion in "${db}" (new ${Object.keys(out.new).length}/${expectedKeys}, old ${Object.keys(out.old).length}/${expectedKeys})`, Object.keys(out.new).length === expectedKeys && Object.keys(out.old).length === expectedKeys);
  if (Object.keys(out.new).length !== expectedKeys || Object.keys(out.old).length !== expectedKeys) console.error(((r.stderr ?? '') as string).split('\n').filter((l: string) => /ERROR|DETAIL/.test(l)).slice(0, 5).join('\n'));

  const N = (name: string) => out.new[String(S.findIndex((s) => s.name === name))];
  const O = (name: string) => out.old[String(S.findIndex((s) => s.name === name))];
  const reserved = String(BOOKED_QTY), bundled = String(BUNDLE_QTY * PER_BUNDLE);
  const holds = new Set(['pending_review', 'awaiting_customer_approval', 'confirmed', 'in_progress', 'completed']);
  const oldHolds = new Set(['pending_review', 'awaiting_customer_approval', 'confirmed', 'in_progress']);

  ok('executed: the function in the database is the new definition (completed appears in exactly the two lists)', out.new.body === 'true');
  ok('executed: after re-applying the previous definition the database function has no completed in its lists (the comparison baseline is real)', out.old.body === 'false');

  for (const st of STATUSES) {
    ok(`executed: direct ${st} reserves ${holds.has(st) ? BOOKED_QTY : 0} on its original dates (got ${N(`direct ${st}: already_reserved on the original dates`)})`, N(`direct ${st}: already_reserved on the original dates`) === (holds.has(st) ? reserved : '0'));
    ok(`executed: direct ${st} reserves nothing on a different date`, N(`direct ${st}: already_reserved on a different date`) === '0');
    ok(`executed: direct ${st} blocks a request for ${BOOKED_QTY} of ${STOCK}: ${!holds.has(st)} (is_allowed)`, N(`direct ${st}: requesting ${BOOKED_QTY} of ${STOCK} on the original dates is_allowed`) === (holds.has(st) ? 'false' : 'true'));
    ok(`executed: package ${st} reserves ${holds.has(st) ? bundled : 0} component units on its original dates (got ${N(`package ${st}: component already_reserved on the original dates`)})`, N(`package ${st}: component already_reserved on the original dates`) === (holds.has(st) ? bundled : '0'));
    ok(`executed: package ${st} reserves nothing on a different date`, N(`package ${st}: component already_reserved on a different date`) === '0');
    // the previous definition: identical for every status except completed
    for (const key of [`direct ${st}: already_reserved on the original dates`, `package ${st}: component already_reserved on the original dates`]) {
      const expectOld = key.startsWith('direct') ? (oldHolds.has(st) ? reserved : '0') : (oldHolds.has(st) ? bundled : '0');
      ok(`executed: before the migration "${key}" was ${expectOld} (got ${O(key)})`, O(key) === expectOld);
      if (st !== 'completed') ok(`executed: "${key}" is unchanged by the migration for ${st}`, N(key) === O(key));
    }
    ok(`executed: "${st}" different-date results unchanged by the migration`, N(`direct ${st}: already_reserved on a different date`) === O(`direct ${st}: already_reserved on a different date`) && N(`package ${st}: component already_reserved on a different date`) === O(`package ${st}: component already_reserved on a different date`));
  }
  ok('executed: completed is the ONLY status whose reservation changed (old 0, new quantity)', O('direct completed: already_reserved on the original dates') === '0' && N('direct completed: already_reserved on the original dates') === reserved);
  ok('executed: Awaiting Customer Approval invoices still reserve (before and after)', N('direct awaiting_customer_approval: already_reserved on the original dates') === reserved && O('direct awaiting_customer_approval: already_reserved on the original dates') === reserved);
  ok('executed: completed order reserves through the last original day', N('completed direct: overlap at the last original day still reserves') === reserved);
  ok('executed: completed order does not reserve the day after', N('completed direct: the day after the original dates does not reserve') === '0');
  ok('executed: completed order does not reserve the day before', N('completed direct: the day before the original dates does not reserve') === '0');
  ok('executed: excluding the completed order releases it', N('completed direct: excluding that order releases it (edit-order flow)') === '0');
  ok(`executed: remaining_after_request counts the completed reservation (${STOCK} - ${BOOKED_QTY} - 1 = ${STOCK - BOOKED_QTY - 1})`, N('completed direct: remaining_after_request arithmetic') === String(STOCK - BOOKED_QTY - 1));
  ok('executed: anon and authenticated callers see the completed reservation too', N('completed direct: as anon (public availability) sees the same reservation') === reserved && N('completed direct: as authenticated sees the same reservation') === reserved);
  ok('executed: an inflatable-only completed order reserves no Event Essentials stock', N('an inflatable-only completed order reserves no Event Essentials stock') === '0');
  for (const k of ['validation unchanged: empty array', 'validation unchanged: end before start', 'visibility unchanged: a hidden (not public_visible) product is refused for anon']) ok(`executed: ${k} (new "${N(k)}" equals old "${O(k)}")`, N(k) === O(k) && /^ERR:/.test(N(k)));
  const unitName = 'inflatable function check_unit_availability behaves identically (it is not touched)';
  ok(`executed: check_unit_availability result is identical before and after (new "${N(unitName)}", old "${O(unitName)}")`, N(unitName) === O(unitName));
  ok('executed: check_unit_availability source and ACL are identical before and after', !!out.new.unitsrc && out.new.unitsrc === out.old.unitsrc && out.new.unitsrc !== 'NULL');

  // signature, SECURITY DEFINER, search_path, owner, ACL
  const snap = out.new.snap, snapOld = out.old.snap;
  ok(`executed: pg_proc snapshot (signature, SECURITY DEFINER, search_path, owner, ACL, has_function_privilege) is identical before and after (new "${snap}" old "${snapOld}")`, !!snap && snap === snapOld);
  const parts = (snap ?? '').split('|');
  ok('executed: the function is SECURITY DEFINER', parts[0] === 'true');
  ok('executed: search_path is fixed to public', parts[1] === '{search_path=public}');
  ok('executed: owner is postgres', parts[3] === 'postgres');
  ok('executed: ACL gives EXECUTE to anon, authenticated and service_role (as the access-lockdown migrations left it)', parts[11] === 'true' && parts[12] === 'true' && parts[13] === 'true');
  ok('executed: the ACL is explicit (not an implicit PUBLIC default), as the previous definition had it', /anon=X\/postgres/.test(parts[2] ?? '') && /service_role=X\/postgres/.test(parts[2] ?? ''));
  break;
}
if (!ran) {
  if (process.env.CORE_DB_REQUIRE) ok(`executed: scratch database ${db} with the complete migration chain is available (CORE_DB_REQUIRE is set)`, false);
  else console.log(`EXECUTED layer SKIPPED: scratch database ${db} not reachable or without the migration chain`);
}

console.log(`${ran ? 'EXECUTED against ' + db : 'EXECUTED layer SKIPPED'}`);
console.log(`product availability (completed orders) tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} product availability test(s) failed`);
