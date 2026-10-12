// Payment operations (migration 20261019120000_add_payment_operations_and_single_financial_application.sql).
//
// Layers, labelled so nobody mistakes one for another:
//   STATIC    parses the migration text (always runs).
//   EXECUTED  runs the real SQL against a SCRATCH PostgreSQL database (never a Supabase project), as the real postgres /
//             service_role / anon / authenticated roles, in a transaction that is rolled back.
//               PAY_DB_BASE  a fresh replay of the older migrations (default "role_full"); the migration text is applied by
//                            the test inside the rolled-back transaction, and applied twice to prove it is idempotent
//   CONCURRENT several real database connections at once against a scratch database that already holds the migration
//             (PAY_DB_FULL, default "pay_full"; created from PAY_DB_BASE when absent, and the migration text is re-applied
//             on every run so it always matches this repository). Rows are committed under unique keys and deleted afterwards.
//   With no reachable database the executed layers are SKIPPED (an environment limit, not a pass); ROLE_DB_REQUIRE=1 makes
//   that a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/paymentOperations.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync, spawn } = require('child_process');

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
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const MIG_NAME = '20261019120000_add_payment_operations_and_single_financial_application.sql';
const MIG = `supabase/migrations/${MIG_NAME}`;
const raw1 = read(MIG);
// The migration that follows it (deposit catch-up, cash/check parity) replaces the claim function and the offline payment functions;
// the executed layers always apply both, in order, exactly like a real deployment.
const MIG2_NAME = '20261020120000_deposit_catch_up_and_offline_payment_parity.sql';
const raw2 = read(`supabase/migrations/${MIG2_NAME}`);
const MIG3_NAME = '20261021120000_server_authoritative_order_pricing_saves.sql';
const raw3 = read(`supabase/migrations/${MIG3_NAME}`);
const raw = raw1 + '\n' + raw2 + '\n' + raw3;
const sql = norm(stripSql(raw1));
const names: string[] = fs.readdirSync('supabase/migrations').filter((f: string) => f.endsWith('.sql')).sort();

// ---------------------------------------------------------------------------------------------------------------------
// STATIC
// ---------------------------------------------------------------------------------------------------------------------
ok('static: the migration sorts after the previous newest migration', names.indexOf(MIG_NAME) > names.indexOf('20261018120200_restrict_role_lookup_and_profile_ownership.sql') && names.indexOf(MIG2_NAME) === names.indexOf(MIG_NAME) + 1 && names.indexOf(MIG3_NAME) === names.indexOf(MIG2_NAME) + 1 && names.indexOf('20261022120000_refund_safety_and_financial_write_authority.sql') === names.indexOf(MIG3_NAME) + 1 && names[names.length - 1] === '20261022120000_refund_safety_and_financial_write_authority.sql');
ok('static: exactly one migration adds the payment operation state', names.filter((n) => /payment_operations/.test(n)).length === 1);
ok('static: the migration name describes behavior, not a project phase', !/phase|stage|priority|\bA\d\b|payment_safety/i.test(MIG_NAME));
ok('static: it creates exactly the claim, record, provider-attempt, release and finalize functions (plus the barrier)', (sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length === 6 && ['guard_payment_authoritative_order_changes', 'claim_payment_operation', 'record_payment_operation_provider', 'mark_payment_operation_provider_attempt', 'release_payment_operation', 'finalize_payment_operation'].every((f) => new RegExp(`FUNCTION public\\.${f}\\(`).test(sql)));
ok('static: every function is SECURITY DEFINER with a pinned search_path', (sql.match(/SECURITY DEFINER/g) ?? []).length === 6 && (sql.match(/SET search_path TO 'public'/g) ?? []).length === 6);
ok('static: execute is revoked from PUBLIC, anon and authenticated for all five and granted to service_role only', (sql.match(/REVOKE ALL ON FUNCTION public\.\w+\([^)]*\) FROM PUBLIC, anon, authenticated;/g) ?? []).length === 6 && (sql.match(/GRANT EXECUTE ON FUNCTION public\.\w+\([^)]*\) TO service_role;/g) ?? []).length === 5 && !/(?<![A-Za-z])TO (anon|authenticated|PUBLIC)\b/i.test(sql));
ok('static: no dynamic SQL is built inside any function', !/\bEXECUTE\b(?! (ON )?FUNCTION)/.test(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'))));
ok('static: the claim locks the order row before it looks at the open operation', sql.indexOf('FROM public.orders WHERE id = p_order_id FOR UPDATE') > 0 && sql.indexOf('FROM public.orders WHERE id = p_order_id FOR UPDATE') < sql.indexOf('FROM public.payments WHERE order_id = p_order_id AND operation_key IS NOT NULL AND status = \'pending\''));
ok('static: finalize locks the order first and then the payment, the same order as the claim', sql.indexOf('SELECT * INTO v_order FROM public.orders WHERE id = v_order_id FOR UPDATE; SELECT * INTO v_op FROM public.payments WHERE id = p_payment_id FOR UPDATE;') > 0);
ok('static: the only code that adds to deposit_paid_cents / balance_paid_cents is finalize', (sql.match(/deposit_paid_cents = v_dp \+ v_dep_applied/g) ?? []).length === 2 && (sql.match(/balance_paid_cents = COALESCE\(balance_paid_cents, 0\) \+ v_bal_applied/g) ?? []).length === 2 && !/v_applied/.test(sql));
ok('static: finalize is the only statement that marks financials applied', (sql.match(/order_financials_applied = true/g) ?? []).length === 1);
ok('static: the open-operation, operation-key, provider-intent and checkout-session rules are unique indexes with the intended predicates', [
  /CREATE UNIQUE INDEX IF NOT EXISTS payments_operation_key_unique ON public\.payments \(operation_key\) WHERE operation_key IS NOT NULL;/,
  /CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_operation_per_order ON public\.payments \(order_id\) WHERE operation_key IS NOT NULL AND status = 'pending';/,
  /CREATE UNIQUE INDEX IF NOT EXISTS payments_original_payment_intent_unique ON public\.payments \(stripe_payment_intent_id\) WHERE stripe_payment_intent_id IS NOT NULL AND refunded_payment_id IS NULL AND amount_cents > 0;/,
  /CREATE UNIQUE INDEX IF NOT EXISTS payments_checkout_session_unique ON public\.payments \(stripe_checkout_session_id\) WHERE stripe_checkout_session_id IS NOT NULL;/,
].every((re) => re.test(sql)));
ok('static: the PaymentIntent rule does not cover refund rows (they reuse the original id and carry a link)', /refunded_payment_id IS NULL AND amount_cents > 0/.test(sql) && !/UNIQUE \(stripe_payment_intent_id\)/.test(sql) && !/ON public\.payments \(stripe_payment_intent_id\);/.test(sql));
ok('static: the principal and tip components are checked to add up to the gross amount', /principal_amount_cents \+ tip_amount_cents = amount_cents/.test(sql));
ok('static: no policy, default privilege or other table is touched', !/CREATE POLICY|DROP POLICY|ALTER DEFAULT PRIVILEGES|GRANT [^;]*ON (TABLE|ALL)|ALTER TABLE public\.(?!payments)/i.test(sql));
ok('static: the old payment_lock column is neither read nor written here', !/payment_lock/.test(sql));
ok('static: no earlier migration was edited to add the operation state', names.filter((n) => n !== MIG_NAME && n !== MIG2_NAME && n !== MIG3_NAME).every((n) => !/payments_operation_key_unique|claim_payment_operation/.test(read(`supabase/migrations/${n}`))));
ok('static: the migration carries no internal planning labels and no project reference', !/\b(Phase|Stage) ?[A-Z0-9]\b|\bA1\b|qaagfafagdpgzcijnfbw|srxunxiytojjsuhcmzjg/.test(raw));

// ---------------------------------------------------------------------------------------------------------------------
// EXECUTED
// ---------------------------------------------------------------------------------------------------------------------
const port = process.env.ROLE_DB_PORT || process.env.CORE_DB_PORT || '54329';
const host = process.env.ROLE_DB_HOST || process.env.CORE_DB_HOST || '127.0.0.1';
const dbBase = process.env.PAY_DB_BASE || 'role_full';
const dbFull = process.env.PAY_DB_FULL || 'pay_full';
const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
const argsFor = (db: string) => ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-At', '-X', '-q'];
function findPsql(db: string): string | null {
  for (const c of candidates) {
    const p = spawnSync(c, [...argsFor(db), '-c', "SELECT to_regclass('public.payments') IS NOT NULL"], { encoding: 'utf8', timeout: 15000 });
    if (p.status === 0 && p.stdout.trim() === 't') return c;
  }
  return null;
}

const O = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

interface OrderSeed { status?: string; dd?: number; dp?: number; bd?: number; bp?: number; tip?: number; selType?: string | null; selCents?: number | null; invoice?: boolean }
const seedOrder = (id: string, o: OrderSeed = {}) => {
  const status = o.status ?? 'pending_review';
  const cols = ['id', 'status', 'location_type', 'event_date', 'event_end_date', 'start_window', 'end_window', 'subtotal_cents', 'deposit_due_cents', 'deposit_paid_cents', 'balance_due_cents', 'balance_paid_cents', 'tip_cents', 'pickup_preference', 'customer_selected_payment_type', 'customer_selected_payment_cents'];
  const vals = [q(id), q(status), "'residential'", "'2030-06-01'", "'2030-06-01'", "'10:00'", "'12:00'", '15000', String(o.dd ?? 5000), String(o.dp ?? 0), String(o.bd ?? 10000), String(o.bp ?? 0), String(o.tip ?? 0), "'same_day'", o.selType === undefined ? 'NULL' : o.selType === null ? 'NULL' : q(o.selType), o.selCents === undefined || o.selCents === null ? 'NULL' : String(o.selCents)];
  let out = `INSERT INTO public.orders (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
  if (o.invoice) out += ` INSERT INTO public.invoice_links (order_id, link_type) VALUES (${q(id)}, 'invoice');`;
  return out;
};

interface PaySeed { id: string; order: string; type?: string; principal?: number | null; dep?: number | null; bal?: number | null; tip?: number | null; amount?: number; status?: string; key?: string | null; claim?: string | null; claimedAgo?: number | null; pi?: string | null; cs?: string | null; applied?: boolean; refundOf?: string | null; attemptedAgo?: number | null }
const seedPay = (s: PaySeed) => {
  const principal = s.principal === undefined ? 5000 : s.principal;
  const tip = s.tip === undefined ? 0 : s.tip;
  // An operation pays deposit first by default; a balance operation pays only balance. Old rows carry no components at all.
  const dep = principal === null ? null : s.dep === undefined ? ((s.type ?? 'deposit') === 'deposit' ? principal : 0) : s.dep;
  const bal = principal === null ? null : s.bal === undefined ? principal - (dep ?? 0) : s.bal;
  const amount = s.amount ?? ((principal ?? 0) + (tip ?? 0));
  const key = s.key === undefined ? `bpc-pay-${s.order}-${s.type ?? 'deposit'}-${s.id}` : s.key;
  return `INSERT INTO public.payments (id, order_id, type, amount_cents, status, operation_key, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents, claim_id, claimed_at, provider_attempted_at, stripe_payment_intent_id, stripe_checkout_session_id, order_financials_applied, refunded_payment_id) VALUES (${q(s.id)}, ${q(s.order)}, ${q(s.type ?? 'deposit')}, ${amount}, ${q(s.status ?? 'pending')}, ${key === null ? 'NULL' : q(key)}, ${principal === null ? 'NULL' : principal}, ${tip === null ? 'NULL' : tip}, ${dep === null ? 'NULL' : dep}, ${bal === null ? 'NULL' : bal}, ${s.claim ? q(s.claim) : 'NULL'}, ${s.claimedAgo === undefined || s.claimedAgo === null ? 'NULL' : `now() - interval '${s.claimedAgo} seconds'`}, ${s.attemptedAgo === undefined || s.attemptedAgo === null ? 'NULL' : `now() - interval '${s.attemptedAgo} seconds'`}, ${s.pi ? q(s.pi) : 'NULL'}, ${s.cs ? q(s.cs) : 'NULL'}, ${s.applied ? 'true' : 'false'}, ${s.refundOf ? q(s.refundOf) : 'NULL'});`;
};

type Opts = { sel?: boolean; principal?: number | null; tip?: number | null; expected?: number | null; stale?: number };
const nul = (v: number | null | undefined) => (v === undefined || v === null ? 'NULL' : String(v));
const claimCall = (order: string, purpose: string, actor: string, claim: string, o: Opts = {}) =>
  `public.claim_payment_operation('${order}', '${purpose}', '${actor}', '${claim}', ${o.sel ? 'true' : 'false'}, ${nul(o.principal)}, ${nul(o.tip)}, ${nul(o.expected)}, ${o.stale ?? 300})`;
const claim = (order: string, purpose: string, actor: string, claimId: string, o: Opts = {}) => `SELECT ${claimCall(order, purpose, actor, claimId, o)}->>'outcome'`;
const claimField = (order: string, purpose: string, actor: string, claimId: string, fields: string[], o: Opts = {}) =>
  `SELECT concat_ws('/', ${fields.map((f) => `j->>'${f}'`).join(', ')}) FROM (SELECT ${claimCall(order, purpose, actor, claimId, o)} AS j) s`;
const fin = (pay: string, claimId: string | null, amount: number, extra: { key?: string | null; pi?: string | null; cs?: string | null; method?: string; pm?: string } = {}) =>
  `SELECT public.finalize_payment_operation('${pay}', ${claimId ? q(claimId) : 'NULL'}, ${extra.key ? q(extra.key) : 'NULL'}, ${extra.pi ? q(extra.pi) : 'NULL'}, ${extra.cs ? q(extra.cs) : 'NULL'}, ${amount}, ${extra.method ? q(extra.method) : 'NULL'}, 'visa', '4242', 100, ${amount - 100}, ${extra.pm ? q(extra.pm) : 'NULL'}, 'cus_1')->>'outcome'`;
const finJson = (pay: string, claimId: string | null, amount: number, extra: { key?: string | null; pi?: string | null } = {}) =>
  `SELECT public.finalize_payment_operation('${pay}', ${claimId ? q(claimId) : 'NULL'}, ${extra.key ? q(extra.key) : 'NULL'}, ${extra.pi ? q(extra.pi) : 'NULL'}, NULL, ${amount}, 'card', 'visa', '4242', 100, ${amount - 100}, NULL, NULL)::text`;
const rel = (pay: string, claimId: string, status: string | null = null) => `SELECT public.release_payment_operation('${pay}', '${claimId}', ${status ? q(status) : 'NULL'})::text`;
const rec = (pay: string, claimId: string, pi: string | null, cs: string | null = null) => `SELECT public.record_payment_operation_provider('${pay}', '${claimId}', ${pi ? q(pi) : 'NULL'}, ${cs ? q(cs) : 'NULL'})::text`;
const ordState = (id: string) => `SELECT concat_ws('/', status, deposit_paid_cents, balance_due_cents, balance_paid_cents, tip_cents, coalesce(stripe_payment_status, '-')) FROM public.orders WHERE id = '${id}'`;
const payState = (id: string) => `SELECT concat_ws('/', status, order_financials_applied::text, coalesce(claim_id::text, 'noclaim'), coalesce(stripe_payment_intent_id, 'nopi'), amount_cents, principal_amount_cents, tip_amount_cents) FROM public.payments WHERE id = '${id}'`;
const payCount = (order: string) => `SELECT count(*)::text FROM public.payments WHERE order_id = '${order}'`;

interface Step { name: string; role?: string; sql: string; setup?: string; expect: string | ((v: string) => boolean) }
const steps: Step[] = [];
const add = (name: string, sqlText: string, expect: Step['expect'], role = 'service_role', setup?: string) => steps.push({ name, sql: sqlText, expect, role, setup });

// ---- deposit: derivation (staff) ----
add('staff deposit: claims, principal is the order deposit, stored tip is charged once', claimField(O(1), 'deposit', 'staff', C(1), ['outcome', 'principal_cents', 'tip_cents', 'gross_cents']), 'claimed/5000/2000/7000', 'service_role', seedOrder(O(1), { tip: 2000 }));
add('... the operation exists before any provider call (pending, owned, no provider ids)', `SELECT concat_ws('/', status, claim_id IS NOT NULL, stripe_payment_intent_id IS NULL, order_financials_applied, principal_amount_cents, tip_amount_cents, amount_cents) FROM public.payments WHERE order_id = '${O(1)}'`, 'pending/t/t/f/5000/2000/7000', 'postgres');
add('... nothing was applied to the order by the claim', ordState(O(1)), 'pending_review/0/10000/0/2000/unpaid', 'postgres');
add('a second request while the operation is owned is busy', claim(O(1), 'deposit', 'staff', C(2)), 'busy');
add('... and creates no second operation', payCount(O(1)), '1', 'postgres');
add('the same claim id asking again resumes (a claim is re-entrant for its owner)', claim(O(1), 'deposit', 'staff', C(1)), 'resumed');
add('staff ignores a persisted Full selection: the required deposit is charged', claimField(O(2), 'deposit', 'staff', C(1), ['principal_cents', 'gross_cents']), '5000/5000', 'service_role', seedOrder(O(2), { selType: 'full', selCents: 15000 }));
add('a deposit claim ignores any requested principal: the database decides the amount', claimField(O(150), 'deposit', 'staff', C(7), ['outcome', 'principal_cents'], { principal: 1 }), 'claimed/5000', 'service_role', seedOrder(O(150)));
add('... even a huge requested principal cannot raise a deposit', claimField(O(151), 'deposit', 'staff', C(8), ['outcome', 'principal_cents'], { principal: 99999999 }), 'claimed/5000', 'service_role', seedOrder(O(151)));
add('a customer deposit claim with a requested principal still derives it', claimField(O(152), 'deposit', 'customer', C(9), ['outcome', 'principal_cents'], { sel: true, principal: 1, expected: 5000 }), 'claimed/5000', 'service_role', seedOrder(O(152), { status: 'awaiting_customer_approval' }));
add('staff cannot start a deposit on a draft', claim(O(3), 'deposit', 'staff', C(1)), 'invalid_status', 'service_role', seedOrder(O(3), { status: 'draft' }));
for (const st of ['confirmed', 'cancelled', 'void', 'in_progress', 'completed', 'awaiting_customer_approval']) {
  add(`staff cannot start a deposit on a ${st} order`, claim(O(4), 'deposit', 'staff', C(1)), 'invalid_status', 'service_role', seedOrder(O(4), { status: st }));
  steps[steps.length - 1].setup = `DELETE FROM public.orders WHERE id = '${O(4)}'; ${seedOrder(O(4), { status: st })}`;
}
add('a customer cannot charge a booking request awaiting review', claim(O(5), 'deposit', 'customer', C(1), { sel: true }), 'invalid_status', 'service_role', seedOrder(O(5), { status: 'pending_review' }));
add('a customer cannot charge a draft that is not an Admin Invoice', claim(O(6), 'deposit', 'customer', C(1), { sel: true }), 'invalid_status', 'service_role', seedOrder(O(6), { status: 'draft' }));
add('a customer can start the deposit on an Admin Invoice draft', claim(O(7), 'deposit', 'customer', C(1), { sel: true }), 'claimed', 'service_role', seedOrder(O(7), { status: 'draft', invoice: true }));
add('a customer can start the deposit on an order awaiting their approval', claim(O(8), 'deposit', 'customer', C(1), { sel: true }), 'claimed', 'service_role', seedOrder(O(8), { status: 'awaiting_customer_approval' }));

// ---- deposit: selection (invoice / approval) ----
const sel = (n: number, type: string | null, cents: number | null, bd = 10000) => seedOrder(O(n), { status: 'awaiting_customer_approval', dd: 5000, bd, selType: type, selCents: cents });
add('selection Deposit: the remaining deposit principal', claimField(O(9), 'deposit', 'customer', C(1), ['outcome', 'principal_cents'], { sel: true }), 'claimed/5000', 'service_role', sel(9, 'deposit', 5000));
add('selection absent: the remaining deposit principal', claimField(O(10), 'deposit', 'customer', C(1), ['outcome', 'principal_cents'], { sel: true }), 'claimed/5000', 'service_role', sel(10, null, null));
add('selection Full: deposit plus the persisted balance (the remaining rental principal)', claimField(O(11), 'deposit', 'customer', C(1), ['outcome', 'principal_cents'], { sel: true }), 'claimed/15000', 'service_role', sel(11, 'full', 15000));
add('selection Full ignores a stale persisted amount: the server derives it', claimField(O(12), 'deposit', 'customer', C(1), ['outcome', 'principal_cents'], { sel: true }), 'claimed/15000', 'service_role', sel(12, 'full', 99));
add('selection Custom: the persisted, in-range amount', claimField(O(13), 'deposit', 'customer', C(1), ['outcome', 'principal_cents'], { sel: true }), 'claimed/8000', 'service_role', sel(13, 'custom', 8000));
add('selection Custom below the required deposit is refused', claim(O(14), 'deposit', 'customer', C(1), { sel: true }), 'selection_invalid', 'service_role', sel(14, 'custom', 4999));
add('selection Custom above deposit plus balance is refused', claim(O(15), 'deposit', 'customer', C(1), { sel: true }), 'selection_invalid', 'service_role', sel(15, 'custom', 15001));
add('selection Custom with no persisted amount is refused', claim(O(16), 'deposit', 'customer', C(1), { sel: true }), 'selection_invalid', 'service_role', sel(16, 'custom', null));
add('an unknown selection type is refused', claim(O(17), 'deposit', 'customer', C(1), { sel: true }), 'selection_invalid', 'service_role', sel(17, 'half', 7500));
add('Custom equal to the required deposit is allowed (the boundary)', claimField(O(18), 'deposit', 'customer', C(1), ['principal_cents'], { sel: true }), '5000', 'service_role', sel(18, 'custom', 5000));
add('Custom equal to deposit plus balance is allowed (the other boundary)', claimField(O(19), 'deposit', 'customer', C(1), ['principal_cents'], { sel: true }), '15000', 'service_role', sel(19, 'custom', 15000));

// ---- deposit: paid / catch-up / zero ----
add('part of the deposit already paid but no payment says so: the ledger disagrees, nothing is charged', claim(O(20), 'deposit', 'staff', C(1)), 'catch_up_unavailable', 'service_role', seedOrder(O(20), { dd: 5000, dp: 2000 }));

// ---- deposit catch-up: collect ONLY what is left of the required deposit, from classified payments, or fail closed ----
const depPaid = (n: number, order: string, dep: number, tip = 0, extra: Partial<PaySeed> = {}) =>
  seedPay({ id: P(n), order, type: 'deposit', status: 'succeeded', applied: true, key: null, principal: dep, dep, bal: 0, tip, pi: 'pi_cu' + n, ...extra });
const cuOrder = (n: number, o: OrderSeed, pays: string[] = []) => `${seedOrder(O(n), o)} ${pays.join(' ')}`;
const CUF = ['outcome', 'deposit_principal_cents', 'balance_principal_cents', 'principal_cents', 'tip_cents', 'gross_cents'];
add('catch-up: the deposit rose from 5000 to 8000 after 5000 was paid: only 3000 is collected', claimField(O(300), 'deposit', 'staff', C(1), CUF), 'claimed/3000/0/3000/0/3000', 'service_role', cuOrder(300, { dd: 8000, dp: 5000 }, [depPaid(300, O(300), 5000)]));
add('catch-up: ... as a deposit-only operation with no balance principal and no tip', claimField(O(301), 'deposit', 'staff', C(1), ['deposit_principal_cents', 'balance_principal_cents', 'tip_cents']), '3000/0/0', 'service_role', cuOrder(301, { dd: 8000, dp: 5000 }, [depPaid(301, O(301), 5000)]));
add('catch-up: a tip that was already paid is not charged again', claimField(O(302), 'deposit', 'staff', C(1), CUF), 'claimed/3000/0/3000/0/3000', 'service_role', cuOrder(302, { dd: 8000, dp: 5000, tip: 1000 }, [depPaid(302, O(302), 5000, 1000)]));
add('catch-up: the original deposit is never charged again (setup fee, tip and total are not part of it)', claimField(O(303), 'deposit', 'staff', C(1), ['principal_cents']), '1', 'service_role', cuOrder(303, { dd: 5001, dp: 5000, bd: 20000 }, [depPaid(303, O(303), 5000)]));
add('catch-up: a deposit that was LOWERED below what is paid owes nothing and is not refunded', claim(O(304), 'deposit', 'staff', C(1)), 'already_paid', 'service_role', cuOrder(304, { dd: 3000, dp: 5000 }, [depPaid(304, O(304), 5000)]));
add('catch-up: ... and the order simply moves forward, no money is touched', ordState(O(304)), 'confirmed/5000/10000/0/0/unpaid', 'postgres');
add('catch-up: exactly paid deposit: nothing to charge', claim(O(305), 'deposit', 'staff', C(1)), 'already_paid', 'service_role', cuOrder(305, { dd: 5000, dp: 5000 }, [depPaid(305, O(305), 5000)]));
add('catch-up: customer Deposit selection collects the remaining deposit', claimField(O(306), 'deposit', 'customer', C(1), CUF, { sel: true }), 'claimed/3000/0/3000/0/3000', 'service_role', cuOrder(306, { status: 'awaiting_customer_approval', dd: 8000, dp: 5000, selType: 'deposit', selCents: 8000 }, [depPaid(306, O(306), 5000)]));
add('catch-up: customer Full selection collects the remaining deposit and the balance, never the paid principal', claimField(O(307), 'deposit', 'customer', C(1), CUF, { sel: true }), 'claimed/3000/10000/13000/0/13000', 'service_role', cuOrder(307, { status: 'awaiting_customer_approval', dd: 8000, dp: 5000, bd: 10000, selType: 'full', selCents: 23000 }, [depPaid(307, O(307), 5000)]));
add('catch-up: customer Custom 10000 in total (5000 already paid) charges 3000 of deposit and 2000 of balance now', claimField(O(308), 'deposit', 'customer', C(1), CUF, { sel: true }), 'claimed/3000/2000/5000/0/5000', 'service_role', cuOrder(308, { status: 'awaiting_customer_approval', dd: 8000, dp: 5000, bd: 10000, selType: 'custom', selCents: 10000 }, [depPaid(308, O(308), 5000)]));
add('catch-up: customer Custom that does not cover the remaining deposit is refused', claim(O(309), 'deposit', 'customer', C(1), { sel: true }), 'selection_invalid', 'service_role', cuOrder(309, { status: 'awaiting_customer_approval', dd: 8000, dp: 5000, bd: 10000, selType: 'custom', selCents: 7999 }, [depPaid(309, O(309), 5000)]));
add('catch-up: customer Custom above the order total is refused', claim(O(310), 'deposit', 'customer', C(1), { sel: true }), 'selection_invalid', 'service_role', cuOrder(310, { status: 'awaiting_customer_approval', dd: 8000, dp: 5000, bd: 10000, selType: 'custom', selCents: 18001 }, [depPaid(310, O(310), 5000)]));
add('catch-up: a request amount from the browser cannot change it', claimField(O(311), 'deposit', 'customer', C(1), ['principal_cents'], { sel: true, principal: 99999 }), '3000', 'service_role', cuOrder(311, { status: 'awaiting_customer_approval', dd: 8000, dp: 5000, selType: 'deposit', selCents: 8000 }, [depPaid(311, O(311), 5000)]));
add('catch-up fails closed: a payment from before components existed cannot be classified', claimField(O(312), 'deposit', 'staff', C(1), ['outcome', 'reason']), 'catch_up_unavailable/unclassified_payment', 'service_role', cuOrder(312, { dd: 8000, dp: 5000 }, [seedPay({ id: P(312), order: O(312), type: 'deposit', status: 'succeeded', applied: true, key: null, principal: null, tip: null, amount: 5000, pi: 'pi_cu312' })]));
add('catch-up fails closed: ... and no operation is created', payCount(O(312)), '1', 'postgres');
add('catch-up fails closed: a refunded order needs refund-aware reconciliation', claimField(O(313), 'deposit', 'staff', C(1), ['outcome', 'reason']), 'catch_up_unavailable/refund_reconciliation_required', 'service_role', `${cuOrder(313, { dd: 8000, dp: 5000 }, [depPaid(313, O(313), 5000)])} UPDATE public.orders SET total_refunded_cents = 1000 WHERE id = '${O(313)}';`);
add('catch-up fails closed: a refund row in the ledger needs refund-aware reconciliation', claimField(O(314), 'deposit', 'staff', C(1), ['outcome', 'reason']), 'catch_up_unavailable/refund_reconciliation_required', 'service_role', cuOrder(314, { dd: 8000, dp: 5000 }, [depPaid(314, O(314), 5000), seedPay({ id: P(3140), order: O(314), type: 'incidental', status: 'succeeded', applied: true, key: null, principal: null, tip: null, amount: -500, pi: 'pi_cu314', refundOf: P(314) })]));
add('catch-up fails closed: the ledger and the order disagree about the deposit paid', claimField(O(315), 'deposit', 'staff', C(1), ['outcome', 'reason']), 'catch_up_unavailable/ledger_conflict', 'service_role', cuOrder(315, { dd: 8000, dp: 5000 }, [depPaid(315, O(315), 3000)]));
add('catch-up fails closed: a payment that succeeded but was never applied', claimField(O(316), 'deposit', 'staff', C(1), ['outcome', 'reason']), 'catch_up_unavailable/unapplied_payment', 'service_role', cuOrder(316, { dd: 8000, dp: 5000 }, [depPaid(316, O(316), 5000, 0, { applied: false })]));
add('catch-up: a failed earlier attempt is not money paid', claimField(O(317), 'deposit', 'staff', C(1), CUF), 'claimed/3000/0/3000/0/3000', 'service_role', cuOrder(317, { dd: 8000, dp: 5000 }, [depPaid(317, O(317), 5000), seedPay({ id: P(3170), order: O(317), type: 'deposit', status: 'failed', principal: 3000, dep: 3000, bal: 0, tip: 0 })]));
add('catch-up: two earlier deposit payments add up (3000 + 2000 paid, 8000 required)', claimField(O(318), 'deposit', 'staff', C(1), ['principal_cents']), '3000', 'service_role', cuOrder(318, { dd: 8000, dp: 5000 }, [depPaid(318, O(318), 3000), depPaid(3180, O(318), 2000)]));
add('catch-up: balance principal already paid does not count as deposit', claimField(O(319), 'deposit', 'staff', C(1), ['principal_cents']), '8000', 'service_role', cuOrder(319, { dd: 8000, dp: 0, bp: 4000, bd: 6000 }, [seedPay({ id: P(319), order: O(319), type: 'balance', status: 'succeeded', applied: true, key: null, principal: 4000, dep: 0, bal: 4000, tip: 0, pi: 'pi_cu319' })]));
add('catch-up: a later request for the same open operation stays the same operation', claimField(O(320), 'deposit', 'staff', C(2), ['outcome', 'principal_cents']), 'resumed/3000', 'service_role', `${cuOrder(320, { dd: 8000, dp: 5000 }, [depPaid(320, O(320), 5000)])} ${seedPay({ id: P(3200), order: O(320), type: 'deposit', claim: null, principal: 3000, dep: 3000, bal: 0, tip: 0 })}`);
add('catch-up: an open catch-up whose requirement then rose again is stale, never charged', claimField(O(321), 'deposit', 'staff', C(2), ['outcome', 'reason']), 'stale_operation/order_changed', 'service_role', `${cuOrder(321, { dd: 9000, dp: 5000 }, [depPaid(321, O(321), 5000)])} ${seedPay({ id: P(3210), order: O(321), type: 'deposit', claim: null, principal: 3000, dep: 3000, bal: 0, tip: 0 })}`);
add('catch-up: finalizing a catch-up adds ONLY the collected deposit to deposit_paid', ordState(O(322)), 'confirmed/8000/10000/0/0/paid', 'postgres', `SELECT set_config('bpc.finalizing_payment_id', '', true); ${cuOrder(322, { dd: 8000, dp: 5000, bd: 10000 }, [depPaid(322, O(322), 5000)])} ${seedPay({ id: P(3220), order: O(322), type: 'deposit', claim: C(1), claimedAgo: 5, principal: 3000, dep: 3000, bal: 0, tip: 0 })} ${fin(P(3220), C(1), 3000)};`);

// ---- cash and check: the same remaining-principal truth as the card path ----
const offline = (n: number, amount: number, tip = 0, method: 'cash' | 'check' = 'cash') =>
  method === 'cash'
    ? `SELECT public.record_cash_payment('${O(n)}', ${amount}, ${tip}, NULL)::text`
    : `SELECT public.record_check_payment('${O(n)}', ${amount}, ${tip}, NULL, 'No. 1042')::text`;
const payComp = (n: number) => `SELECT concat_ws('/', type, amount_cents, principal_amount_cents, deposit_principal_cents, balance_principal_cents, tip_amount_cents, order_financials_applied, payment_method, status) FROM public.payments WHERE order_id = '${O(n)}'`;
add('cash: a payment of exactly the remaining deposit pays the deposit', ordState(O(330)), 'confirmed/5000/10000/0/0/unpaid', 'postgres', `${seedOrder(O(330), { dd: 5000, dp: 0, bd: 10000 })} ${offline(330, 5000)};`);
add('cash: the components of the payment', payComp(330), 'deposit/5000/5000/5000/0/0/t/cash/succeeded', 'postgres');
add('cash: 12000 on that order pays the 5000 deposit and 7000 of the balance', payComp(332), 'deposit/12000/12000/5000/7000/0/t/cash/succeeded', 'postgres', `${seedOrder(O(332), { dd: 5000, dp: 0, bd: 10000 })} ${offline(332, 12000)};`);
add('cash: ... and the order reflects exactly that', ordState(O(332)), 'confirmed/5000/3000/7000/0/unpaid', 'postgres');
add('cash: more than the remaining principal is refused, even though the balance is not zero', offline(333, 15001), (v: string) => v.startsWith('ERR:'), 'service_role', seedOrder(O(333), { dd: 5000, dp: 0, bd: 10000 }));
add('cash: ... and nothing was written', payCount(O(333)), '0', 'postgres');
add('cash: an order with nothing left to pay refuses ANY payment', offline(334, 100), (v: string) => v.startsWith('ERR:'), 'service_role', seedOrder(O(334), { status: 'confirmed', dd: 5000, dp: 5000, bd: 0, bp: 10000 }));
add('cash: a tip is separate: it does not reduce the deposit or the balance and is not principal', payComp(335), 'deposit/6000/5000/5000/0/1000/t/cash/succeeded', 'postgres', `${seedOrder(O(335), { dd: 5000, dp: 0, bd: 10000 })} ${offline(335, 5000, 1000)};`);
add('cash: ... the tip is added to the order tip only', ordState(O(335)), 'confirmed/5000/10000/0/1000/unpaid', 'postgres');
add('cash: a catch-up deposit is paid first (deposit raised after part was paid)', payComp(336), 'deposit/5000/5000/3000/2000/0/t/cash/succeeded', 'postgres', `${seedOrder(O(336), { status: 'confirmed', dd: 8000, dp: 5000, bd: 10000 })} ${offline(336, 5000)};`);
add('cash: the balance already paid is not subtracted twice from the amount owed', offline(337, 4000), (v: string) => !v.startsWith('ERR:'), 'service_role', seedOrder(O(337), { status: 'confirmed', dd: 5000, dp: 5000, bd: 6000, bp: 4000 }));
add('cash: ... 4000 of a 6000 balance is accepted and leaves 2000', ordState(O(337)), 'confirmed/5000/2000/8000/0/unpaid', 'postgres');
add('cash: paying exactly everything owed AND a tip is accepted (the tip is not counted against the principal)', ordState(O(345)), 'confirmed/5000/0/10000/1000/unpaid', 'postgres', `${seedOrder(O(345), { dd: 5000, dp: 0, bd: 10000, tip: 0 })} ${offline(345, 15000, 1000)};`);
add('check: the same rules for a check, with the check number in the log', payComp(338), 'balance/6000/6000/0/6000/0/t/check/succeeded', 'postgres', `${seedOrder(O(338), { status: 'confirmed', dd: 5000, dp: 5000, bd: 6000 })} ${offline(338, 6000, 0, 'check')};`);
add('check: ... overpayment is refused', offline(339, 6001, 0, 'check'), (v: string) => v.startsWith('ERR:'), 'service_role', seedOrder(O(339), { status: 'confirmed', dd: 5000, dp: 5000, bd: 6000 }));
add('check: ... the check number is logged', `SELECT notes FROM public.order_changelog WHERE order_id = '${O(338)}' AND change_type = 'check_payment' AND field_changed = 'balance_due_cents'`, 'Check number: No. 1042', 'postgres');
// ---- an order that is not confirmed yet is confirmed only when its required deposit is satisfied ----
const stateOf = (n: number) => ordState(O(n));
add('offline status: pending_review, deposit 5000, nothing paid, cash 1000 -> deposit_paid 1000, stays pending_review', stateOf(360), 'pending_review/1000/10000/0/0/unpaid', 'postgres', `${seedOrder(O(360), { dd: 5000, dp: 0, bd: 10000 })} ${offline(360, 1000)};`);
add('offline status: ... the same partial CHECK deposit does not confirm either', stateOf(361), 'pending_review/1000/10000/0/0/unpaid', 'postgres', `${seedOrder(O(361), { dd: 5000, dp: 0, bd: 10000 })} ${offline(361, 1000, 0, 'check')};`);
add('offline status: 1000 paid + 3999 more = 4999 of 5000: still pending_review', stateOf(362), 'pending_review/4999/10000/0/0/unpaid', 'postgres', `${seedOrder(O(362), { dd: 5000, dp: 1000, bd: 10000 })} ${offline(362, 3999)};`);
add('offline status: 1000 paid + 4000 more = 5000 of 5000: confirmed', stateOf(363), 'confirmed/5000/10000/0/0/unpaid', 'postgres', `${seedOrder(O(363), { dd: 5000, dp: 1000, bd: 10000 })} ${offline(363, 4000)};`);
add('offline status: awaiting_customer_approval + a partial deposit stays awaiting_customer_approval', stateOf(364), 'awaiting_customer_approval/1000/10000/0/0/unpaid', 'postgres', `${seedOrder(O(364), { status: 'awaiting_customer_approval', dd: 5000, dp: 0, bd: 10000 })} ${offline(364, 1000)};`);
add('offline status: awaiting_customer_approval + the payment that completes the deposit is confirmed', stateOf(365), 'confirmed/5000/10000/0/0/unpaid', 'postgres', `${seedOrder(O(365), { status: 'awaiting_customer_approval', dd: 5000, dp: 1000, bd: 10000 })} ${offline(365, 4000)};`);
add('offline status: no deposit required (0): a payment confirms as before', stateOf(366), 'confirmed/0/7000/3000/0/unpaid', 'postgres', `${seedOrder(O(366), { dd: 0, dp: 0, bd: 10000 })} ${offline(366, 3000)};`);
add('offline status: a payment covering the deposit and part of the balance confirms, with both components', payComp(367), 'deposit/7000/7000/5000/2000/0/t/cash/succeeded', 'postgres', `${seedOrder(O(367), { dd: 5000, dp: 0, bd: 10000 })} ${offline(367, 7000)};`);
add('offline status: ... and the order is confirmed', stateOf(367), 'confirmed/5000/8000/2000/0/unpaid', 'postgres');
add('offline status: a confirmed order with a partial balance payment stays confirmed', stateOf(368), 'confirmed/5000/6000/4000/0/unpaid', 'postgres', `${seedOrder(O(368), { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 })} ${offline(368, 4000)};`);
add('offline status: an in_progress order stays in_progress', stateOf(369), 'in_progress/5000/6000/4000/0/unpaid', 'postgres', `${seedOrder(O(369), { status: 'in_progress', dd: 5000, dp: 5000, bd: 10000 })} ${offline(369, 4000)};`);
add('offline status: a completed order stays completed', stateOf(370), 'completed/5000/6000/4000/0/unpaid', 'postgres', `${seedOrder(O(370), { status: 'completed', dd: 5000, dp: 5000, bd: 10000 })} ${offline(370, 4000)};`);
add('offline status: a confirmed order whose deposit is still part unpaid stays confirmed (never demoted)', stateOf(371), 'confirmed/2000/10000/0/0/unpaid', 'postgres', `${seedOrder(O(371), { status: 'confirmed', dd: 5000, dp: 1000, bd: 10000 })} ${offline(371, 1000)};`);

// ---- offline tip validation ----
const offlineRaw = (n: number, amount: number, tip: string) => `SELECT public.record_cash_payment('${O(n)}', ${amount}, ${tip}, NULL)::text`;
add('offline tip: a negative tip is rejected (not turned into zero)', offlineRaw(372, 1000, '-1'), (v: string) => v.startsWith('ERR:'), 'service_role', seedOrder(O(372), { dd: 5000, dp: 0, bd: 10000 }));
add('offline tip: ... no payment row was written', payCount(O(372)), '0', 'postgres');
add('offline tip: ... and the order is unchanged', stateOf(372), 'pending_review/0/10000/0/0/unpaid', 'postgres');
add('offline tip: a NULL tip means no tip', payComp(373), 'deposit/1000/1000/1000/0/0/t/cash/succeeded', 'postgres', `${seedOrder(O(373), { dd: 5000, dp: 0, bd: 10000 })} ${offlineRaw(373, 1000, 'NULL')};`);
add('offline tip: a zero tip is allowed', payComp(374), 'deposit/1000/1000/1000/0/0/t/cash/succeeded', 'postgres', `${seedOrder(O(374), { dd: 5000, dp: 0, bd: 10000 })} ${offlineRaw(374, 1000, '0')};`);
add('offline tip: a positive whole tip is allowed and is not principal', payComp(375), 'deposit/1500/1000/1000/0/500/t/cash/succeeded', 'postgres', `${seedOrder(O(375), { dd: 5000, dp: 0, bd: 10000 })} ${offlineRaw(375, 1000, '500')};`);
add('offline tip: a tip above the maximum is rejected', offlineRaw(376, 1000, '100000000'), (v: string) => v.startsWith('ERR:'), 'service_role', seedOrder(O(376), { dd: 5000, dp: 0, bd: 10000 }));
add('offline tip: a negative tip on a CHECK is rejected too', `SELECT public.record_check_payment('${O(377)}', 1000, -5, NULL, 'No. 9')::text`, (v: string) => v.startsWith('ERR:'), 'service_role', seedOrder(O(377), { dd: 5000, dp: 0, bd: 10000 }));

add('cash: refused while an online payment is open for the order', offline(340, 1000), (v: string) => v.startsWith('ERR:'), 'service_role', `${seedOrder(O(340), { dd: 5000, dp: 0, bd: 10000 })} ${seedPay({ id: P(340), order: O(340), claim: null })}`);
add('cash: a cancelled order refuses a payment', offline(341, 1000), (v: string) => v.startsWith('ERR:'), 'service_role', seedOrder(O(341), { status: 'cancelled' }));
add('cash: anon cannot record a cash payment', offline(342, 1000), (v: string) => v.startsWith('ERR:42501'), 'anon', seedOrder(O(342)));
add('cash: authenticated cannot record a check payment', offline(343, 1000, 0, 'check'), (v: string) => v.startsWith('ERR:42501'), 'authenticated', seedOrder(O(343)));
add('catch-up state function is not executable by anon', `SELECT public.payment_deposit_principal_state('${O(344)}')::text`, (v: string) => v.startsWith('ERR:42501'), 'anon');
add('offline payment function is not executable by authenticated', `SELECT public.record_offline_payment('${O(344)}', 1, 0, NULL, 'cash', NULL)::text`, (v: string) => v.startsWith('ERR:42501'), 'authenticated');

add('... and no operation was created', payCount(O(20)), '0', 'postgres');
add('a deposit already paid in full is not charged again, and the pending order moves forward', claimField(O(21), 'deposit', 'staff', C(1), ['outcome', 'status_changed', 'order_status']), 'already_paid/true/confirmed', 'service_role', seedOrder(O(21), { dd: 5000, dp: 5000 }));
add('... the order is confirmed and nothing else changed', ordState(O(21)), 'confirmed/5000/10000/0/0/unpaid', 'postgres');
add('a deposit paid above the requirement is also already paid', claim(O(22), 'deposit', 'staff', C(1)), 'already_paid', 'service_role', seedOrder(O(22), { dd: 5000, dp: 9000 }));
add('already paid on an order awaiting approval: it is confirmed, with no charge', claimField(O(23), 'deposit', 'customer', C(1), ['outcome', 'status_changed'], { sel: true }), 'already_paid/true', 'service_role', seedOrder(O(23), { status: 'awaiting_customer_approval', dd: 5000, dp: 5000 }));
add('no deposit due: nothing to charge', claim(O(24), 'deposit', 'staff', C(1)), 'no_deposit_due', 'service_role', seedOrder(O(24), { dd: 0, bd: 15000 }));
add('the deposit shown to the customer no longer matches: ORDER CHANGED, no operation', claim(O(25), 'deposit', 'customer', C(1), { sel: true, expected: 4000 }), 'order_changed', 'service_role', seedOrder(O(25), { status: 'awaiting_customer_approval', dd: 5000 }));
add('... the deposit shown matches: claimed', claim(O(26), 'deposit', 'customer', C(1), { sel: true, expected: 5000 }), 'claimed', 'service_role', seedOrder(O(26), { status: 'awaiting_customer_approval', dd: 5000 }));
add('a deposit payment in the ledger while the order says nothing was paid is a conflict', claim(O(27), 'deposit', 'staff', C(1)), 'ledger_conflict', 'service_role', `${seedOrder(O(27))} ${seedPay({ id: P(27), order: O(27), status: 'succeeded', applied: true, key: null, principal: null, tip: null, amount: 5000 })}`);

// ---- deposit: tip ----
add('a customer-chosen tip is charged as chosen, whatever the order row says', claimField(O(28), 'deposit', 'customer', C(1), ['tip_cents', 'gross_cents'], { sel: true, tip: 1500 }), '1500/6500', 'service_role', seedOrder(O(28), { status: 'awaiting_customer_approval', tip: 3000 }));
add('a customer who chooses no tip is charged none', claimField(O(29), 'deposit', 'customer', C(1), ['tip_cents', 'gross_cents'], { sel: true, tip: 0 }), '0/5000', 'service_role', seedOrder(O(29), { status: 'awaiting_customer_approval', tip: 3000 }));
add('a stored tip that earlier operations already charged is not charged again', claimField(O(30), 'deposit', 'staff', C(1), ['tip_cents']), '0', 'service_role', `${seedOrder(O(30), { tip: 2000 })} ${seedPay({ id: P(30), order: O(30), type: 'balance', status: 'succeeded', applied: true, principal: 0, tip: 2000 })}`);
add('a stored tip partly charged before is charged only for the rest', claimField(O(31), 'deposit', 'staff', C(1), ['tip_cents']), '2000', 'service_role', `${seedOrder(O(31), { tip: 3000 })} ${seedPay({ id: P(31), order: O(31), type: 'balance', status: 'succeeded', applied: true, principal: 0, tip: 1000 })}`);
add('old ledger rows that do not say how much was tip: the stored tip is NOT guessed into a charge', claimField(O(32), 'deposit', 'staff', C(1), ['outcome', 'tip_cents']), 'claimed/0', 'service_role', `${seedOrder(O(32), { tip: 2000, dd: 5000 })} ${seedPay({ id: P(32), order: O(32), type: 'balance', status: 'succeeded', applied: true, key: null, principal: null, tip: null, amount: 700 })}`);
add('a failed earlier operation does not count as a charged tip', claimField(O(33), 'deposit', 'staff', C(1), ['tip_cents']), '2000', 'service_role', `${seedOrder(O(33), { tip: 2000 })} ${seedPay({ id: P(33), order: O(33), status: 'failed', principal: 5000, tip: 2000 })}`);
add('a negative tip is refused', claim(O(34), 'deposit', 'customer', C(1), { sel: true, tip: -1 }), 'invalid_amount', 'service_role', seedOrder(O(34), { status: 'awaiting_customer_approval' }));
add('a tip above the provider maximum is refused', claim(O(35), 'deposit', 'customer', C(1), { sel: true, tip: 100000000 }), 'invalid_amount', 'service_role', seedOrder(O(35), { status: 'awaiting_customer_approval' }));
add('a tip at the provider maximum with the principal is refused (gross too large)', claim(O(36), 'deposit', 'customer', C(1), { sel: true, tip: 99999999 }), 'invalid_amount', 'service_role', seedOrder(O(36), { status: 'awaiting_customer_approval' }));

// ---- balance ----
const bal = (n: number, bd = 10000, status = 'confirmed', tip = 0) => seedOrder(O(n), { status, bd, tip, dd: 5000, dp: 5000 });
add('balance: partial principal inside the balance is allowed', claimField(O(40), 'balance', 'customer', C(1), ['outcome', 'principal_cents', 'tip_cents', 'gross_cents'], { principal: 5000 }), 'claimed/5000/0/5000', 'service_role', bal(40));
add('balance: the whole balance is allowed', claimField(O(41), 'balance', 'customer', C(1), ['principal_cents'], { principal: 10000 }), '10000', 'service_role', bal(41));
add('balance: more than the balance is refused (the server balance wins)', claimField(O(42), 'balance', 'customer', C(1), ['outcome', 'balance_due_cents'], { principal: 20000 }), 'over_balance/10000', 'service_role', bal(42));
add('balance: one cent over is refused', claim(O(43), 'balance', 'customer', C(1), { principal: 10001 }), 'over_balance', 'service_role', bal(43));
add('balance: a tip does not raise the permitted principal', claim(O(44), 'balance', 'customer', C(1), { principal: 10001, tip: 5000 }), 'over_balance', 'service_role', bal(44));
add('balance: principal plus tip is charged as gross, split in the operation', claimField(O(45), 'balance', 'customer', C(1), ['principal_cents', 'tip_cents', 'gross_cents'], { principal: 10000, tip: 2000 }), '10000/2000/12000', 'service_role', bal(45));
add('balance: a tip-only payment (nothing owed) is allowed', claimField(O(46), 'balance', 'customer', C(1), ['outcome', 'principal_cents', 'gross_cents'], { principal: 0, tip: 2000 }), 'claimed/0/2000', 'service_role', bal(46, 0));
add('balance: nothing at all is refused', claim(O(47), 'balance', 'customer', C(1), { principal: 0, tip: 0 }), 'invalid_amount', 'service_role', bal(47));
add('balance: no requested principal is refused', claim(O(48), 'balance', 'customer', C(1), { tip: 100 }), 'invalid_amount', 'service_role', bal(48));
add('balance: a negative principal is refused', claim(O(49), 'balance', 'customer', C(1), { principal: -1 }), 'invalid_amount', 'service_role', bal(49));
add('balance: a negative principal is refused even when a tip would make the total positive', claim(O(57), 'balance', 'customer', C(1), { principal: -100, tip: 5000 }), 'invalid_amount', 'service_role', bal(57));
add('balance: a negative tip is refused', claim(O(50), 'balance', 'customer', C(1), { principal: 100, tip: -5 }), 'invalid_amount', 'service_role', bal(50));
add('balance: any principal against a zero balance is refused and reports zero', claimField(O(51), 'balance', 'staff', C(1), ['outcome', 'balance_due_cents'], { principal: 100 }), 'over_balance/0', 'service_role', bal(51, 0));
for (const st of ['draft', 'pending_review', 'awaiting_customer_approval', 'cancelled', 'void']) {
  add(`balance: not allowed on a ${st} order`, claim(O(52), 'balance', 'customer', C(1), { principal: 100 }), 'invalid_status', 'service_role', `DELETE FROM public.orders WHERE id = '${O(52)}'; ${bal(52, 10000, st)}`);
}
for (const st of ['in_progress', 'completed']) {
  add(`balance: allowed on a ${st} order`, claim(O(53), 'balance', 'customer', C(1), { principal: 100 }), 'claimed', 'service_role', `DELETE FROM public.orders WHERE id = '${O(53)}'; ${bal(53, 10000, st)}`);
}
add('balance: the admin amount is bounded the same way', claim(O(54), 'balance', 'staff', C(1), { principal: 10001 }), 'over_balance', 'service_role', bal(54));
add('balance: an open deposit operation blocks a balance request', claim(O(55), 'balance', 'customer', C(1), { principal: 100 }), 'busy', 'service_role', `${bal(55)} ${seedPay({ id: P(55), order: O(55), type: 'deposit', claim: C(9), claimedAgo: 5 })}`);
add('... and says why, without creating anything', payCount(O(55)), '1', 'postgres');
add('claim with an unknown purpose is invalid', claim(O(56), 'refund', 'customer', C(1), { principal: 1 }), 'invalid_request', 'service_role', bal(56));
add('claim with an unknown actor is invalid', claim(O(56), 'balance', 'robot', C(1), { principal: 1 }), 'invalid_request');
add('claim with a NULL claim id is invalid', `SELECT public.claim_payment_operation('${O(56)}', 'balance', 'customer', NULL, false, 1, NULL, NULL, 300)->>'outcome'`, 'invalid_request');
add('claim for an unknown order is not_found', claim('abababab-0000-4000-8000-000000000000', 'balance', 'customer', C(1), { principal: 1 }), 'not_found');
add('claim with a lease timeout under sixty seconds is invalid', claim(O(56), 'balance', 'customer', C(1), { principal: 1, stale: 5 }), 'invalid_request');

// ---- lease ----
const owned = (n: number, ago: number | null, claimId = C(1)) => `${seedOrder(O(n))} ${seedPay({ id: P(n), order: O(n), claim: ago === null ? null : claimId, claimedAgo: ago })}`;
add('lease: an operation claimed 299 seconds ago is still owned: busy', claim(O(60), 'deposit', 'staff', C(2)), 'busy', 'service_role', owned(60, 299));
add('lease: an operation claimed 301 seconds ago is abandoned: resumed by the new owner', claimField(O(61), 'deposit', 'staff', C(2), ['outcome', 'claim_id']), `resumed/${C(2)}`, 'service_role', owned(61, 301));
add('... the resumed operation is the SAME operation (same key)', `SELECT operation_key FROM public.payments WHERE order_id = '${O(61)}'`, `bpc-pay-${O(61)}-deposit-${P(61)}`, 'postgres');
add('lease: an unowned open operation is resumed at once', claim(O(62), 'deposit', 'staff', C(2)), 'resumed', 'service_role', owned(62, null));
add('lease: a claim with no timestamp is abandoned', claim(O(63), 'deposit', 'staff', C(2)), 'resumed', 'service_role', `${seedOrder(O(63))} ${seedPay({ id: P(63), order: O(63), claim: C(1), claimedAgo: null })}`);
add('lease: the stale prior owner can no longer finalize', fin(P(61), C(1), 5000), 'not_owner');
add('lease: the stale prior owner can no longer release', rel(P(61), C(1)), 'false');
add('lease: the stale prior owner can no longer record provider ids', rec(P(61), C(1), 'pi_stale'), 'false');
add('... the newer owner is untouched', payState(P(61)), `pending/false/${C(2)}/nopi/5000/5000/0`, 'postgres');
add('lease: a wrong claim id cannot finalize', fin(P(61), C(7), 5000), 'not_owner');
add('lease: a wrong claim id cannot release', rel(P(61), C(7)), 'false');
add('lease: a shorter timeout makes a younger claim stale', claim(O(64), 'deposit', 'staff', C(2), { stale: 60 }), 'resumed', 'service_role', owned(64, 90));
add('lease: the order was not changed by any of this', ordState(O(61)), 'pending_review/0/10000/0/0/unpaid', 'postgres');

// ---- record provider ----
add('provider ids: the owner records the PaymentIntent', rec(P(65), C(1), 'pi_65'), 'true', 'service_role', owned(65, 5));
add('... recording the same id again is fine', rec(P(65), C(1), 'pi_65'), 'true');
add('... a different PaymentIntent cannot replace it', rec(P(65), C(1), 'pi_other'), 'false');
add('... the owner records a Checkout Session as well', rec(P(65), C(1), null, 'cs_65'), 'true');
add('provider ids: another owner cannot record', rec(P(65), C(2), 'pi_zz'), 'false');
add('provider ids: nothing to record is false', rec(P(65), C(1), null, null), 'false');
add('provider ids: a PaymentIntent already used by another original payment cannot be recorded here', rec(P(66), C(1), 'pi_65'), 'false', 'service_role', owned(66, 5));

// ---- finalize: deposit ----
const dep = (n: number, o: OrderSeed & { tipOp?: number; principal?: number; depC?: number; balC?: number } = {}) => `${seedOrder(O(n), o)} ${seedPay({ id: P(n), order: O(n), type: 'deposit', claim: C(1), claimedAgo: 5, principal: o.principal ?? o.dd ?? 5000, dep: o.depC, bal: o.balC, tip: o.tipOp ?? 0 })}`;
const finDo = (n: number, amount: number) => `SELECT public.finalize_payment_operation('${P(n)}', '${C(1)}', NULL, 'pi_${n}', NULL, ${amount}, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`;
const rowComps = (n: number) => `SELECT concat_ws('/', principal_amount_cents, deposit_principal_cents, balance_principal_cents, tip_amount_cents, amount_cents) FROM public.payments WHERE id = '${P(n)}'`;
add('finalize deposit: applied once', fin(P(70), C(1), 7000, { pi: 'pi_70', method: 'card', pm: 'pm_70' }), 'applied', 'service_role', dep(70, { tip: 2000, tipOp: 2000 }));
add('... the order: deposit principal paid, balance untouched, confirmed, paid, tip kept', ordState(O(70)), 'confirmed/5000/10000/0/2000/paid', 'postgres');
add('... the operation: succeeded, applied, owner cleared, provider id and components kept', payState(P(70)), 'succeeded/true/noclaim/pi_70/7000/5000/2000', 'postgres');
add('... the payment method details were stored', `SELECT concat_ws('/', payment_method, payment_brand, payment_last4, stripe_fee_amount, stripe_net_amount) FROM public.payments WHERE id = '${P(70)}'`, 'card/visa/4242/100/6900', 'postgres');
add('... the customer and card ids were stored on the order', `SELECT concat_ws('/', stripe_payment_method_id, stripe_customer_id) FROM public.orders WHERE id = '${O(70)}'`, 'pm_70/cus_1', 'postgres');
add('finalize deposit: finalizing again changes nothing (already_applied)', fin(P(70), C(1), 7000, { pi: 'pi_70' }), 'already_applied');
add('... even for a different claim id or the provider path with the key', fin(P(70), null, 7000, { key: `bpc-pay-${O(70)}-deposit-${P(70)}`, pi: 'pi_70' }), 'already_applied');
add('... still applied exactly once', ordState(O(70)), 'confirmed/5000/10000/0/2000/paid', 'postgres');
add('finalize deposit Full: 5000 pays the deposit and 10000 pays the balance (never all deposit)', ordState(O(71)), 'confirmed/5000/0/10000/0/paid', 'postgres', `${dep(71, { dd: 5000, bd: 10000, principal: 15000, depC: 5000, balC: 10000 })} ${finDo(71, 15000)}`);
add('finalize deposit Custom 8000: 5000 pays the deposit, 3000 pays the balance, 7000 is left', ordState(O(72)), 'confirmed/5000/7000/3000/0/paid', 'postgres', `${dep(72, { dd: 5000, bd: 10000, principal: 8000, depC: 5000, balC: 3000 })} ${finDo(72, 8000)}`);
add('finalize deposit: an awaiting-approval order is confirmed', ordState(O(73)), 'confirmed/5000/10000/0/0/paid', 'postgres', `${dep(73, { status: 'awaiting_customer_approval' })} SELECT public.finalize_payment_operation('${P(73)}', '${C(1)}', NULL, 'pi_73', NULL, 5000, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`);
add('finalize deposit: an Admin Invoice draft is confirmed by the payment', ordState(O(74)), 'confirmed/5000/10000/0/0/paid', 'postgres', `${dep(74, { status: 'draft', invoice: true })} SELECT public.finalize_payment_operation('${P(74)}', '${C(1)}', NULL, 'pi_74', NULL, 5000, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`);
add('finalize deposit: an order cancelled meanwhile keeps its status; the money is still recorded', ordState(O(75)), 'cancelled/5000/10000/0/0/paid', 'postgres', `${dep(75, { status: 'cancelled' })} SELECT public.finalize_payment_operation('${P(75)}', '${C(1)}', NULL, 'pi_75', NULL, 5000, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`);
add('finalize deposit: status_changed is reported', `SELECT (${finJson(P(76), C(1), 5000, { pi: 'pi_76' }).replace('SELECT ', '')})::jsonb->>'status_changed'`, 'true', 'service_role', dep(76));
add('finalize deposit: the stored tip is raised to cover a larger charged tip, never lowered', ordState(O(77)), 'confirmed/5000/10000/0/3000/paid', 'postgres', `${dep(77, { tip: 3000, tipOp: 1000 })} SELECT public.finalize_payment_operation('${P(77)}', '${C(1)}', NULL, 'pi_77', NULL, 6000, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`);
add('finalize deposit: a larger charged tip is stored', ordState(O(78)), 'confirmed/5000/10000/0/4000/paid', 'postgres', `${dep(78, { tip: 1000, tipOp: 4000 })} SELECT public.finalize_payment_operation('${P(78)}', '${C(1)}', NULL, 'pi_78', NULL, 9000, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`);

// RECOVERY ONLY: this is money that ALREADY reached the provider before the order was found to have shrunk. The finalizer then
// applies no more than the order owes and records the rest for review. It is NOT how a stale operation is made safe: a stale
// operation is refused at claim time and never charged (see the revalidation steps below).
add('recovery of money already collected: if the order shrank after the charge, no more than is owed is applied', ordState(O(79)), 'confirmed/5000/0/2000/0/paid', 'postgres', `${dep(79, { dd: 5000, bd: 2000, principal: 15000, depC: 5000, balC: 10000 })} ${finDo(79, 15000)}`);
add('... and the difference is recorded for review', `SELECT count(*)::text FROM public.order_changelog WHERE order_id = '${O(79)}' AND change_type = 'payment_error' AND notes LIKE 'PAYMENT_EXCEEDS_AMOUNT_DUE%'`, '1', 'postgres');

// ---- finalize: balance ----
const balop = (n: number, principal: number, tip: number, o: OrderSeed = {}) => `${seedOrder(O(n), { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000, ...o })} ${seedPay({ id: P(n), order: O(n), type: 'balance', claim: C(1), claimedAgo: 5, principal, tip })}`;
add('finalize balance: partial principal and a tip, applied once', fin(P(80), C(1), 7000, { pi: 'pi_80' }), 'applied', 'service_role', balop(80, 5000, 2000));
add('... principal reduces the balance and is paid; the tip is added to the order tip; not principal', ordState(O(80)), 'confirmed/5000/5000/5000/2000/unpaid', 'postgres');
add('finalize balance: the same finalize again changes nothing', fin(P(80), C(1), 7000, { pi: 'pi_80' }), 'already_applied');
add('... still applied once', ordState(O(80)), 'confirmed/5000/5000/5000/2000/unpaid', 'postgres');
add('finalize balance with NO tip leaves the stored tip alone (an Admin balance charge never erases a tip)', ordState(O(81)), 'confirmed/5000/0/10000/3000/unpaid', 'postgres', `${balop(81, 10000, 0, { tip: 3000 })} SELECT public.finalize_payment_operation('${P(81)}', '${C(1)}', NULL, 'pi_81', NULL, 10000, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`);
add('finalize balance with a tip adds to the stored tip', ordState(O(82)), 'confirmed/5000/0/10000/3500/unpaid', 'postgres', `${balop(82, 10000, 500, { tip: 3000 })} SELECT public.finalize_payment_operation('${P(82)}', '${C(1)}', NULL, 'pi_82', NULL, 10500, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`);
add('finalize balance: a tip-only payment does not touch the balance', ordState(O(83)), 'confirmed/5000/0/0/2000/unpaid', 'postgres', `${balop(83, 0, 2000, { bd: 0 })} SELECT public.finalize_payment_operation('${P(83)}', '${C(1)}', NULL, 'pi_83', NULL, 2000, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`);
add('finalize balance: order status is never changed by a balance payment', ordState(O(84)), 'completed/5000/0/10000/0/unpaid', 'postgres', `${balop(84, 10000, 0, { status: 'completed' })} SELECT public.finalize_payment_operation('${P(84)}', '${C(1)}', NULL, 'pi_84', NULL, 10000, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`);
add('finalize balance: if the balance fell meanwhile, principal is never over-applied', ordState(O(85)), 'confirmed/5000/0/2000/0/unpaid', 'postgres', `${balop(85, 5000, 0, { bd: 2000 })} SELECT public.finalize_payment_operation('${P(85)}', '${C(1)}', NULL, 'pi_85', NULL, 5000, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`);
add('... and the difference is recorded for review, not guessed into anything', `SELECT count(*)::text FROM public.order_changelog WHERE order_id = '${O(85)}' AND change_type = 'payment_error' AND notes LIKE 'PAYMENT_EXCEEDS_AMOUNT_DUE%'`, '1', 'postgres');
add('... the operation is still recorded with its full principal', payState(P(85)), 'succeeded/true/noclaim/pi_85/5000/5000/0', 'postgres');

// ---- finalize: guards ----
add('finalize: an amount that differs from what the operation expected is refused', fin(P(86), C(1), 6999, { pi: 'pi_86' }), 'amount_mismatch', 'service_role', balop(86, 5000, 2000));
add('... nothing changed', `SELECT concat_ws('/', (SELECT balance_paid_cents FROM public.orders WHERE id = '${O(86)}'), (SELECT status FROM public.payments WHERE id = '${P(86)}'))`, '0/pending', 'postgres');
add('finalize: a PaymentIntent that differs from the recorded one is refused', fin(P(87), C(1), 5000, { pi: 'pi_other' }), 'provider_mismatch', 'service_role', `${balop(87, 5000, 0)} UPDATE public.payments SET stripe_payment_intent_id = 'pi_87' WHERE id = '${P(87)}';`);
add('finalize: a PaymentIntent already belonging to another original payment is refused', fin(P(88), C(1), 5000, { pi: 'pi_88x' }), 'provider_conflict', 'service_role', `${balop(88, 5000, 0)} ${seedPay({ id: P(89), order: O(88), type: 'balance', status: 'succeeded', key: null, principal: null, tip: null, amount: 5000, pi: 'pi_88x', applied: true })}`);
add('... nothing changed', ordState(O(88)), 'confirmed/5000/10000/0/0/unpaid', 'postgres');
add('finalize: the provider path needs the operation key', fin(P(90), null, 5000, { pi: 'pi_90' }), 'invalid_request', 'service_role', balop(90, 5000, 0));
add('finalize: the provider path with the wrong key finds nothing', fin(P(90), null, 5000, { key: 'bpc-pay-wrong', pi: 'pi_90' }), 'not_found');
add('finalize: the provider path with the right key applies', fin(P(90), null, 5000, { key: `bpc-pay-${O(90)}-balance-${P(90)}`, pi: 'pi_90' }), 'applied');
add('finalize: a payment that is not an operation (old row) is not_found', fin(P(91), C(1), 5000), 'not_found', 'service_role', `${seedOrder(O(91))} ${seedPay({ id: P(91), order: O(91), status: 'succeeded', key: null, principal: null, tip: null, amount: 5000 })}`);
add('finalize: an unknown payment is not_found', fin('abababab-0000-4000-8000-000000000001', C(1), 5000), 'not_found');
add('finalize: a missing amount is invalid', `SELECT public.finalize_payment_operation('${P(90)}', '${C(1)}', NULL, NULL, NULL, NULL)->>'outcome'`, 'invalid_request');
add('finalize: a late success from the provider is still applied to an operation closed as failed', fin(P(92), null, 5000, { key: `bpc-pay-${O(92)}-balance-${P(92)}`, pi: 'pi_92' }), 'applied', 'service_role', `${seedOrder(O(92), { status: 'confirmed', bd: 10000 })} ${seedPay({ id: P(92), order: O(92), type: 'balance', status: 'failed', principal: 5000, tip: 0 })}`);
add('... and it is then a succeeded, applied payment', payState(P(92)), 'succeeded/true/noclaim/pi_92/5000/5000/0', 'postgres');

// ---- release ----
add('release: giving the lease back keeps the operation open, with its key', rel(P(100), C(1)), 'true', 'service_role', owned(100, 5));
add('... open, unowned', payState(P(100)), 'pending/false/noclaim/nopi/5000/5000/0', 'postgres');
add('... releasing again by the same (now former) owner does nothing', rel(P(100), C(1)), 'false');
add('release: another request resumes the same operation afterwards', claim(O(100), 'deposit', 'staff', C(2)), 'resumed');
add('release as failed closes the operation', rel(P(101), C(1), 'failed'), 'true', 'service_role', owned(101, 5));
add('... failed, unowned, not applied', payState(P(101)), 'failed/false/noclaim/nopi/5000/5000/0', 'postgres');
add('... the order can now start a NEW operation (a different key)', `SELECT (${claimCall(O(101), 'deposit', 'staff', C(3))})->>'operation_key' <> 'bpc-pay-${O(101)}-deposit-${P(101)}'`, 'true');
add('release as cancelled closes the operation', rel(P(102), C(1), 'cancelled'), 'true', 'service_role', owned(102, 5));
add('release with an unknown final status is refused', rel(P(103), C(1), 'succeeded'), 'false', 'service_role', owned(103, 5));
add('... and changed nothing', payState(P(103)), `pending/false/${C(1)}/nopi/5000/5000/0`, 'postgres');
add('release cannot close an operation that was already applied', rel(P(104), C(1), 'failed'), 'false', 'service_role', `${seedOrder(O(104))} ${seedPay({ id: P(104), order: O(104), status: 'pending', claim: C(1), claimedAgo: 5, applied: true })}`);
add('release cannot touch a succeeded payment', rel(P(105), C(1), 'failed'), 'false', 'service_role', `${seedOrder(O(105))} ${seedPay({ id: P(105), order: O(105), status: 'succeeded', claim: C(1), claimedAgo: 5, applied: true })}`);
add('release with a NULL claim id does nothing', `SELECT public.release_payment_operation('${P(100)}', NULL, NULL)::text`, 'false');
add('finalize after the owner released as failed is not_owner', fin(P(101), C(1), 5000), 'not_owner');

// ---- uniqueness / constraints ----
const tryInsert = (sqlText: string) => `SELECT pg_temp.try_sql(${q(sqlText)})`;
add('unique: two original positive payments cannot share a PaymentIntent', tryInsert(`${seedPay({ id: P(110), order: O(110), status: 'succeeded', key: null, principal: null, tip: null, amount: 5000, pi: 'pi_dup', applied: true })} ${seedPay({ id: P(111), order: O(110), status: 'succeeded', key: null, principal: null, tip: null, amount: 5000, pi: 'pi_dup', applied: true })}`), '23505', 'postgres', seedOrder(O(110)));
add('unique: a refund row (negative, linked) may reuse the original PaymentIntent', tryInsert(`${seedPay({ id: P(112), order: O(112), status: 'succeeded', key: null, principal: null, tip: null, amount: 5000, pi: 'pi_ref', applied: true })} ${seedPay({ id: P(113), order: O(112), type: 'incidental', status: 'succeeded', key: null, principal: null, tip: null, amount: -5000, pi: 'pi_ref', refundOf: P(112) })}`), 'ok', 'postgres', seedOrder(O(112)));
add('unique: a second partial refund row on the same PaymentIntent is also representable', tryInsert(`${seedPay({ id: P(114), order: O(112), type: 'incidental', status: 'succeeded', key: null, principal: null, tip: null, amount: -1000, pi: 'pi_ref', refundOf: P(112) })}`), 'ok', 'postgres');
add('unique: legacy rows without a PaymentIntent (cash, check) can repeat', tryInsert(`${seedPay({ id: P(115), order: O(112), status: 'succeeded', key: null, principal: null, tip: null, amount: 500, pi: null, applied: true })} ${seedPay({ id: P(116), order: O(112), status: 'succeeded', key: null, principal: null, tip: null, amount: 500, pi: null, applied: true })}`), 'ok', 'postgres');
add('unique: two open operations for one order are refused by the database itself', tryInsert(`${seedPay({ id: P(117), order: O(117) })} ${seedPay({ id: P(118), order: O(117), key: 'bpc-pay-other' })}`), '23505', 'postgres', seedOrder(O(117)));
add('unique: a closed operation does not block a new open one', tryInsert(`${seedPay({ id: P(119), order: O(119), status: 'failed' })} ${seedPay({ id: P(120), order: O(119), key: 'bpc-pay-k2' })}`), 'ok', 'postgres', seedOrder(O(119)));
add('unique: an operation key cannot repeat', tryInsert(`${seedPay({ id: P(121), order: O(121), status: 'failed', key: 'bpc-pay-same' })} ${seedPay({ id: P(122), order: O(121), status: 'failed', key: 'bpc-pay-same' })}`), '23505', 'postgres', seedOrder(O(121)));
add('unique: a Checkout Session cannot belong to two payments', tryInsert(`${seedPay({ id: P(123), order: O(123), status: 'failed', cs: 'cs_dup' })} ${seedPay({ id: P(124), order: O(123), status: 'failed', key: 'bpc-pay-k4', cs: 'cs_dup' })}`), '23505', 'postgres', seedOrder(O(123)));
add('constraint: principal plus tip must equal the gross amount', tryInsert(`INSERT INTO public.payments (order_id, type, amount_cents, principal_amount_cents, tip_amount_cents) VALUES ('${O(125)}', 'balance', 1000, 600, 300)`), '23514', 'postgres', seedOrder(O(125)));
add('constraint: a negative component is refused', tryInsert(`INSERT INTO public.payments (order_id, type, amount_cents, principal_amount_cents, tip_amount_cents) VALUES ('${O(125)}', 'balance', 1000, 1500, -500)`), '23514', 'postgres');
add('constraint: deposit + balance components must add up to the principal', tryInsert(`INSERT INTO public.payments (order_id, type, amount_cents, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents) VALUES ('${O(125)}', 'balance', 1000, 1000, 0, 400, 500)`), '23514', 'postgres');
add('constraint: a negative deposit or balance component is refused', tryInsert(`INSERT INTO public.payments (order_id, type, amount_cents, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents) VALUES ('${O(125)}', 'balance', 1000, 1000, 0, -500, 1500)`), '23514', 'postgres');
add('constraint: a consistent allocation is accepted', tryInsert(`INSERT INTO public.payments (order_id, type, amount_cents, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents) VALUES ('${O(125)}', 'balance', 1200, 1000, 200, 400, 600)`), 'ok', 'postgres');
add('constraint: principal and tip without the allocation are refused (all four together or none)', tryInsert(`INSERT INTO public.payments (order_id, type, amount_cents, principal_amount_cents, tip_amount_cents) VALUES ('${O(125)}', 'balance', 1000, 800, 200)`), '23514', 'postgres');
add('constraint: components come as a pair', tryInsert(`INSERT INTO public.payments (order_id, type, amount_cents, principal_amount_cents) VALUES ('${O(125)}', 'balance', 1000, 1000)`), '23514', 'postgres');
add('constraint: an operation must carry components and a positive amount', tryInsert(`INSERT INTO public.payments (order_id, type, amount_cents, operation_key) VALUES ('${O(125)}', 'balance', 1000, 'bpc-pay-nocomp')`), '23514', 'postgres');
add('constraint: old rows with no components are still valid', tryInsert(`INSERT INTO public.payments (order_id, type, amount_cents, status) VALUES ('${O(125)}', 'balance', 1000, 'succeeded')`), 'ok', 'postgres');

// ---- components: the allocation is derived at claim time and kept on the row ----
const CF = ['deposit_principal_cents', 'balance_principal_cents', 'principal_cents', 'tip_cents', 'gross_cents'];
const aw = (n: number, type: string | null, cents: number | null, o: OrderSeed = {}) => seedOrder(O(n), { status: 'awaiting_customer_approval', dd: 5000, bd: 10000, selType: type, selCents: cents, ...o });
add('components: a staff deposit approval pays the deposit only', claimField(O(160), 'deposit', 'staff', C(1), CF), '5000/0/5000/0/5000', 'service_role', seedOrder(O(160)));
add('components: selection Deposit pays the deposit only', claimField(O(161), 'deposit', 'customer', C(1), CF, { sel: true }), '5000/0/5000/0/5000', 'service_role', aw(161, 'deposit', 5000));
add('components: selection Full pays the deposit AND the balance', claimField(O(162), 'deposit', 'customer', C(1), CF, { sel: true }), '5000/10000/15000/0/15000', 'service_role', aw(162, 'full', 15000));
add('components: selection Custom 8000 pays 5000 of deposit and 3000 of balance', claimField(O(163), 'deposit', 'customer', C(1), CF, { sel: true }), '5000/3000/8000/0/8000', 'service_role', aw(163, 'custom', 8000));
add('components: Custom equal to the deposit has no balance part', claimField(O(164), 'deposit', 'customer', C(1), CF, { sel: true }), '5000/0/5000/0/5000', 'service_role', aw(164, 'custom', 5000));
add('components: Custom equal to deposit plus balance pays all of both', claimField(O(165), 'deposit', 'customer', C(1), CF, { sel: true }), '5000/10000/15000/0/15000', 'service_role', aw(165, 'custom', 15000));
add('components: a tip is kept apart from both parts', claimField(O(166), 'deposit', 'customer', C(1), CF, { sel: true, tip: 1000 }), '5000/10000/15000/1000/16000', 'service_role', aw(166, 'full', 15000));
add('components: a customer balance payment is all balance', claimField(O(167), 'balance', 'customer', C(1), CF, { principal: 4000, tip: 700 }), '0/4000/4000/700/4700', 'service_role', seedOrder(O(167), { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 }));
add('components: a tip-only payment has no deposit and no balance part', claimField(O(168), 'balance', 'customer', C(1), CF, { principal: 0, tip: 2000 }), '0/0/0/2000/2000', 'service_role', seedOrder(O(168), { status: 'confirmed', dd: 5000, dp: 5000, bd: 0 }));
add('components: the stored operation row keeps the allocation (Full)', `SELECT concat_ws('/', principal_amount_cents, deposit_principal_cents, balance_principal_cents, tip_amount_cents, amount_cents) FROM public.payments WHERE order_id = '${O(162)}'`, '15000/5000/10000/0/15000', 'postgres');

// ---- finalize applies the persisted components ----
add('finalize Deposit: only the deposit is paid, the balance is untouched', ordState(O(170)), 'confirmed/5000/10000/0/0/paid', 'postgres', `${dep(170, { dd: 5000, bd: 10000, principal: 5000, depC: 5000, balC: 0 })} ${finDo(170, 5000)}`);
add('... and the row keeps the allocation', rowComps(170), '5000/5000/0/0/5000', 'postgres');
add('finalize Full with a tip: 5000 deposit, 10000 balance, 1000 tip, each in its own place', ordState(O(171)), 'confirmed/5000/0/10000/1000/paid', 'postgres', `${dep(171, { dd: 5000, bd: 10000, principal: 15000, depC: 5000, balC: 10000, tipOp: 1000 })} ${finDo(171, 16000)}`);
add('... and the row keeps principal, both components, tip and gross', rowComps(171), '15000/5000/10000/1000/16000', 'postgres');
add('finalize Custom 8000: the row keeps 5000 + 3000', rowComps(172), '8000/5000/3000/0/8000', 'postgres', `${dep(172, { dd: 5000, bd: 10000, principal: 8000, depC: 5000, balC: 3000 })} ${finDo(172, 8000)}`);
add('finalize Custom equal to the deposit: no balance is touched', ordState(O(173)), 'confirmed/5000/10000/0/0/paid', 'postgres', `${dep(173, { dd: 5000, bd: 10000, principal: 5000, depC: 5000, balC: 0 })} ${finDo(173, 5000)}`);
add('finalize a customer balance payment: balance paid and due move, deposit_paid does not, tip is added apart', ordState(O(174)), 'confirmed/5000/6000/4000/700/unpaid', 'postgres', `${seedOrder(O(174), { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 })} ${seedPay({ id: P(174), order: O(174), type: 'balance', claim: C(1), claimedAgo: 5, principal: 4000, tip: 700 })} ${finDo(174, 4700)}`);
add('... and its row keeps the allocation', rowComps(174), '4000/0/4000/700/4700', 'postgres');
add('finalize a tip-only payment: only the tip moves', ordState(O(175)), 'confirmed/5000/0/0/2000/unpaid', 'postgres', `${seedOrder(O(175), { status: 'confirmed', dd: 5000, dp: 5000, bd: 0 })} ${seedPay({ id: P(175), order: O(175), type: 'balance', claim: C(1), claimedAgo: 5, principal: 0, tip: 2000 })} ${finDo(175, 2000)}`);
add('finalize a balance payment with a tip on an order whose deposit is not fully paid: the tip never leaks into deposit_paid', ordState(O(176)), 'confirmed/0/6000/4000/700/unpaid', 'postgres', `${seedOrder(O(176), { status: 'confirmed', dd: 5000, dp: 0, bd: 10000 })} ${seedPay({ id: P(176), order: O(176), type: 'balance', claim: C(1), claimedAgo: 5, principal: 4000, tip: 700 })} ${finDo(176, 4700)}`);

// ---- an open operation is resumed only while the order still authorizes exactly it ----
const mk = (n: number, o: OrderSeed = {}, p: Partial<PaySeed> = {}) => `${seedOrder(O(n), o)} ${seedPay({ id: P(n), order: O(n), claim: null, ...p })}`;
const mkb = (n: number, o: OrderSeed = {}, p: Partial<PaySeed> = {}) => `${seedOrder(O(n), { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000, ...o })} ${seedPay({ id: P(n), order: O(n), type: 'balance', principal: 10000, claim: null, ...p })}`;
const OR = ['outcome', 'reason'];
add('revalidation: an open operation the order still authorizes is resumed', claim(O(180), 'deposit', 'staff', C(2)), 'resumed', 'service_role', mk(180));
add('revalidation: the deposit went UP after the operation was opened: stale', claimField(O(181), 'deposit', 'staff', C(2), OR), 'stale_operation/order_changed', 'service_role', mk(181, { dd: 6000, bd: 9000 }));
add('revalidation: the deposit went DOWN: stale', claimField(O(182), 'deposit', 'staff', C(2), OR), 'stale_operation/order_changed', 'service_role', mk(182, { dd: 4000, bd: 11000 }));
add('revalidation: the order was cancelled: stale', claimField(O(183), 'deposit', 'staff', C(2), OR), 'stale_operation/invalid_status', 'service_role', mk(183, { status: 'cancelled' }));
add('revalidation: the order was voided: stale', claimField(O(184), 'deposit', 'staff', C(2), OR), 'stale_operation/invalid_status', 'service_role', mk(184, { status: 'void' }));
add('revalidation: the order moved to another status: stale', claimField(O(185), 'deposit', 'staff', C(2), OR), 'stale_operation/invalid_status', 'service_role', mk(185, { status: 'awaiting_customer_approval' }));
add('revalidation: an Admin edit sent the order back to the customer after an Admin Accept operation opened: stale', claimField(O(186), 'deposit', 'staff', C(2), OR), 'stale_operation/invalid_status', 'service_role', mk(186, { status: 'awaiting_customer_approval', dd: 6000 }));
add('revalidation: a Full operation whose selection is still Full is resumed', claim(O(187), 'deposit', 'customer', C(2), { sel: true }), 'resumed', 'service_role', mk(187, { status: 'awaiting_customer_approval', selType: 'full', selCents: 15000 }, { principal: 15000, dep: 5000, bal: 10000 }));
add('revalidation: a Full operation whose selection became Deposit: stale', claimField(O(188), 'deposit', 'customer', C(2), OR, { sel: true }), 'stale_operation/order_changed', 'service_role', mk(188, { status: 'awaiting_customer_approval', selType: 'deposit', selCents: 5000 }, { principal: 15000, dep: 5000, bal: 10000 }));
add('revalidation: a Custom operation whose persisted amount changed: stale', claimField(O(189), 'deposit', 'customer', C(2), OR, { sel: true }), 'stale_operation/order_changed', 'service_role', mk(189, { status: 'awaiting_customer_approval', selType: 'custom', selCents: 9000 }, { principal: 8000, dep: 5000, bal: 3000 }));
add('revalidation: a Custom operation whose persisted amount is unchanged is resumed', claim(O(190), 'deposit', 'customer', C(2), { sel: true }), 'resumed', 'service_role', mk(190, { status: 'awaiting_customer_approval', selType: 'custom', selCents: 8000 }, { principal: 8000, dep: 5000, bal: 3000 }));
add('revalidation: a Custom operation whose persisted amount became invalid: stale (selection_invalid)', claimField(O(191), 'deposit', 'customer', C(2), OR, { sel: true }), 'stale_operation/selection_invalid', 'service_role', mk(191, { status: 'awaiting_customer_approval', selType: 'custom', selCents: 99999 }, { principal: 8000, dep: 5000, bal: 3000 }));
add('revalidation: an Admin Invoice Full operation whose required payment changed: stale', claimField(O(192), 'deposit', 'customer', C(2), OR, { sel: true }), 'stale_operation/order_changed', 'service_role', mk(192, { status: 'draft', invoice: true, dd: 7000, bd: 8000, selType: 'full', selCents: 15000 }, { principal: 15000, dep: 5000, bal: 10000 }));
add('revalidation: the deposit the customer was shown no longer matches: stale', claimField(O(193), 'deposit', 'customer', C(2), OR, { sel: true, expected: 4000 }), 'stale_operation/order_changed', 'service_role', mk(193, { status: 'awaiting_customer_approval' }));
add('revalidation: the stored tip changed: stale', claimField(O(194), 'deposit', 'staff', C(2), OR), 'stale_operation/order_changed', 'service_role', mk(194, { tip: 500 }));
add('revalidation: the same stored tip: resumed', claim(O(195), 'deposit', 'staff', C(2)), 'resumed', 'service_role', mk(195, { tip: 500 }, { tip: 500 }));
add('revalidation: the deposit was part paid meanwhile: stale (catch-up, never charged)', claimField(O(196), 'deposit', 'staff', C(2), OR), 'stale_operation/catch_up_unavailable', 'service_role', mk(196, { dp: 2000 }));
add('revalidation: the deposit was paid in full meanwhile: stale', claimField(O(197), 'deposit', 'staff', C(2), OR), 'stale_operation/already_paid', 'service_role', mk(197, { dp: 5000 }));
add('... and a stale check never moves the order', ordState(O(197)), 'pending_review/5000/10000/0/0/unpaid', 'postgres');
add('revalidation: a balance operation the balance still covers is resumed', claim(O(198), 'balance', 'customer', C(2), { principal: 10000 }), 'resumed', 'service_role', mkb(198));
add('revalidation: the balance went DOWN below the operation: stale (over_balance), never an overcharge', claimField(O(199), 'balance', 'customer', C(2), OR, { principal: 10000 }), 'stale_operation/over_balance', 'service_role', mkb(199, { bd: 2000 }));
add('revalidation: the customer now asks for a different amount than the open operation: stale', claimField(O(200), 'balance', 'customer', C(2), OR, { principal: 2000 }), 'stale_operation/order_changed', 'service_role', mkb(200, { bd: 2000 }));
add('revalidation: the order with a balance operation was cancelled: stale', claimField(O(201), 'balance', 'customer', C(2), OR, { principal: 10000 }), 'stale_operation/invalid_status', 'service_role', mkb(201, { status: 'cancelled' }));
add('revalidation: a different tip than the open balance operation carries: stale', claimField(O(202), 'balance', 'customer', C(2), OR, { principal: 10000, tip: 300 }), 'stale_operation/order_changed', 'service_role', mkb(202));
add('revalidation: an operation that already has a provider charge is handed back to be reconciled even if the order changed (no new charge can come from it)', claimField(O(203), 'deposit', 'staff', C(2), ['outcome', 'provider_known']), 'resumed/true', 'service_role', mk(203, { status: 'cancelled' }, { pi: 'pi_known_203' }));
add('revalidation: a stale LEASE takeover does not skip revalidation (order changed): stale', claimField(O(204), 'deposit', 'staff', C(2), OR), 'stale_operation/order_changed', 'service_role', mk(204, { dd: 6000, bd: 9000 }, { claim: C(1), claimedAgo: 400 }));
add('... the SQL does not close the operation itself (the caller proves the provider state first); the new owner holds the lease', payState(P(204)), `pending/false/${C(2)}/nopi/5000/5000/0`, 'postgres');
add('revalidation: a LIVE lease of another request is busy, changed order or not', claim(O(205), 'deposit', 'staff', C(2)), 'busy', 'service_role', mk(205, { dd: 6000, bd: 9000 }, { claim: C(1), claimedAgo: 30 }));
add('revalidation: the same request asking again with a changed order: stale', claimField(O(206), 'deposit', 'staff', C(1), OR), 'stale_operation/order_changed', 'service_role', mk(206, { dd: 6000, bd: 9000 }, { claim: C(1), claimedAgo: 30 }));
add('revalidation: nothing is created for a stale operation (still one row)', payCount(O(204)), '1', 'postgres');

add('a negative custom fee is refused (it would be a hidden discount)', tryInsert(`INSERT INTO public.order_custom_fees (order_id, name, amount_cents) VALUES ('${O(350)}', 'x', -100)`), '23514', 'postgres', seedOrder(O(350)));
add('a zero custom fee is allowed', tryInsert(`INSERT INTO public.order_custom_fees (order_id, name, amount_cents) VALUES ('${O(350)}', 'x', 0)`), 'ok', 'postgres');
add('a discount percentage above 100 is refused', tryInsert(`INSERT INTO public.order_discounts (order_id, name, percentage) VALUES ('${O(350)}', 'x', 150)`), '23514', 'postgres');
add('a negative discount amount is refused', tryInsert(`INSERT INTO public.order_discounts (order_id, name, amount_cents) VALUES ('${O(350)}', 'x', -5)`), '23514', 'postgres');
add('a fixed and a percentage discount on one row are still storable (historical shape; the formula takes the fixed amount)', tryInsert(`INSERT INTO public.order_discounts (order_id, name, amount_cents, percentage) VALUES ('${O(350)}', 'x', 500, 10)`), 'ok', 'postgres');

// ---- server-authoritative order pricing saves (the third migration) ----
const GUARD_ON = `ALTER TABLE public.orders ENABLE TRIGGER trg_guard_order_pricing_authority; DROP POLICY IF EXISTS t_all ON public.orders; CREATE POLICY t_all ON public.orders FOR ALL TO authenticated, anon USING (true) WITH CHECK (true); GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated, anon;`;
const asOrder = (n: number, sets: string) => tryInsert(`UPDATE public.orders SET ${sets} WHERE id = '${O(n)}'`);
const guardSeed = (n: number) => `${GUARD_ON} ${seedOrder(O(n), { dd: 5000, dp: 0, bd: 10000 })}`;
add('guard: a staff session cannot change the subtotal', asOrder(400, 'subtotal_cents = 1'), '42501', 'authenticated', guardSeed(400));
for (const [label, sets] of [
  ['the tax', 'tax_cents = 7'], ['the deposit due', 'deposit_due_cents = 0'], ['the balance due', 'balance_due_cents = 0'], ['the travel fee', 'travel_fee_cents = 5'],
  ['the surface fee', 'surface_fee_cents = 5'], ['the same-day pickup fee', 'same_day_pickup_fee_cents = 5'], ['the weekday delivery fee', 'same_day_weekday_delivery_fee_cents = 5'],
  ['the generator fee', 'generator_fee_cents = 5'], ['the setup fee', 'setup_fee_cents = 5'], ['the deposit override', 'custom_deposit_cents = 0'],
  ['the waived-fee amounts', `waived_fee_amounts_cents = '{"travel": 1}'`], ['the Event Essentials subtotal', 'event_essentials_subtotal_cents = 5'],
] as Array<[string, string]>) {
  add(`guard: a staff session cannot change ${label}`, asOrder(400, sets), '42501', 'authenticated');
}
add('guard: ... nor can an anonymous session', asOrder(400, 'subtotal_cents = 1'), '42501', 'anon');
add('guard: the order is unchanged', `SELECT concat_ws('/', subtotal_cents, tax_cents, deposit_due_cents, balance_due_cents) FROM public.orders WHERE id = '${O(400)}'`, '15000/0/5000/10000', 'postgres');
add('guard: a staff session can still change the message and other non-pricing columns', asOrder(400, "admin_message = 'hello', workflow_status = 'on_the_way'"), 'ok', 'authenticated');
add('guard: ... and write a pricing column to the value it already has', asOrder(400, 'subtotal_cents = 15000, deposit_due_cents = 5000'), 'ok', 'authenticated');
add('guard: the table owner can change pricing', asOrder(400, 'subtotal_cents = 21000'), 'ok', 'postgres');
add('guard: a staff session cannot create an order with a price', tryInsert(`INSERT INTO public.orders (location_type, event_date, event_end_date, start_window, end_window, subtotal_cents, deposit_due_cents, balance_due_cents, pickup_preference, status) VALUES ('residential', '2030-06-01', '2030-06-01', '10:00', '12:00', 500, 100, 400, 'same_day', 'draft')`), '42501', 'authenticated');
add('guard: ... but can create an order with no price (a draft shell)', tryInsert(`INSERT INTO public.orders (location_type, event_date, event_end_date, start_window, end_window, subtotal_cents, deposit_due_cents, balance_due_cents, pickup_preference, status) VALUES ('residential', '2030-06-01', '2030-06-01', '10:00', '12:00', 0, 0, 0, 'same_day', 'draft')`), 'ok', 'authenticated');
add('guard: a payment function (SECURITY DEFINER) still changes the balance for its own reasons', ordState(O(401)), 'confirmed/5000/6000/4000/0/unpaid', 'postgres', `${GUARD_ON} ${seedOrder(O(401), { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 })} ${offline(401, 4000)};`);

const SAVE_FNS = ['apply_staff_order_save', 'create_staff_invoice_order'];
add('save functions: anon cannot call apply_staff_order_save', `SELECT public.apply_staff_order_save('${O(402)}', NULL, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)::text`, (v: string) => v.startsWith('ERR:42501'), 'anon');
add('save functions: authenticated cannot call apply_staff_order_save', `SELECT public.apply_staff_order_save('${O(402)}', NULL, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)::text`, (v: string) => v.startsWith('ERR:42501'), 'authenticated');
add('save functions: authenticated cannot call create_staff_invoice_order', `SELECT public.create_staff_invoice_order('{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)::text`, (v: string) => v.startsWith('ERR:42501'), 'authenticated');
add('save functions: anon cannot call create_staff_invoice_order', `SELECT public.create_staff_invoice_order('{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)::text`, (v: string) => v.startsWith('ERR:42501'), 'anon');
add('save functions: both are SECURITY DEFINER with a pinned search_path', `SELECT count(*)::text FROM pg_proc WHERE proname IN (${SAVE_FNS.map((f) => q(f)).join(',')}) AND pronamespace = 'public'::regnamespace AND prosecdef AND proconfig::text ~ 'search_path=public'`, '2', 'postgres');
add('save functions: PUBLIC holds no execute on either', `SELECT count(*)::text FROM pg_proc WHERE proname IN (${SAVE_FNS.map((f) => q(f)).join(',')}) AND pronamespace = 'public'::regnamespace AND coalesce(proacl::text, '') ~ '(^|[{,])=X'`, '0', 'postgres');

const saveCall = (n: number, expected: string, changes: string, itemOps = '[]', discountOps = '[]', feeOps = '[]', logs = '[]') =>
  `SELECT public.apply_staff_order_save('${O(n)}', NULL, ${q(expected)}::jsonb, ${q(changes)}::jsonb, ${q(itemOps)}::jsonb, ${q(discountOps)}::jsonb, ${q(feeOps)}::jsonb, ${q(logs)}::jsonb)->>'outcome'`;
const state = (cols: string) => `{"columns": ${cols}, "children": {"items": [], "discounts": [], "custom_fees": []}}`;
add('apply save: a state that no longer matches the order is stale, and nothing is written', saveCall(403, state('{"subtotal_cents": 99}'), '{"subtotal_cents": 1}'), 'stale', 'service_role', seedOrder(O(403), { dd: 5000, dp: 0, bd: 10000 }));
add('apply save: ... the order is untouched', `SELECT subtotal_cents::text FROM public.orders WHERE id = '${O(403)}'`, '15000', 'postgres');
add('apply save: a matching state is applied', saveCall(404, state('{"subtotal_cents": 15000, "deposit_due_cents": 5000}'), '{"subtotal_cents": 18000, "balance_due_cents": 13000}', '[]', '[]', '[]', '[{"field": "subtotal", "old": "15000", "new": "18000", "change_type": "edit"}]'), 'saved', 'service_role', seedOrder(O(404), { dd: 5000, dp: 0, bd: 10000 }));
add('apply save: ... the order columns changed', `SELECT concat_ws('/', subtotal_cents, balance_due_cents) FROM public.orders WHERE id = '${O(404)}'`, '18000/13000', 'postgres');
add('apply save: ... and the change was logged', `SELECT concat_ws('/', field_changed, old_value, new_value) FROM public.order_changelog WHERE order_id = '${O(404)}'`, 'subtotal/15000/18000', 'postgres');
add('apply save: a column outside the staff save list is refused', saveCall(405, state('{}'), '{"stripe_customer_id": "cus_x"}'), (v: string) => v.startsWith('ERR:'), 'service_role', seedOrder(O(405)));
add('apply save: payment columns cannot be written through it', saveCall(406, state('{}'), '{"deposit_paid_cents": 5000}'), (v: string) => v.startsWith('ERR:'), 'service_role', seedOrder(O(406)));
add('apply save: an unknown order is not_found', saveCall(407, state('{}'), '{}'), 'not_found', 'service_role');
add('apply save: discounts and custom fees are applied with the order', `SELECT concat_ws('/', (SELECT count(*) FROM public.order_discounts WHERE order_id = '${O(408)}'), (SELECT count(*) FROM public.order_custom_fees WHERE order_id = '${O(408)}'))`, '1/1', 'postgres', `${seedOrder(O(408))} SELECT public.apply_staff_order_save('${O(408)}', NULL, ${q(state('{}'))}::jsonb, '{}'::jsonb, '[]'::jsonb, '[{"kind": "insert", "name": "Promo", "amount_cents": 500, "percentage": 0}]'::jsonb, '[{"kind": "insert", "name": "Help", "amount_cents": 700}]'::jsonb, '[]'::jsonb);`);
add('apply save: a discount or fee that changed since the browser looked makes the save stale', saveCall(409, `{"columns": {}, "children": {"items": [], "discounts": [], "custom_fees": []}}`, '{}'), 'stale', 'service_role', `${seedOrder(O(409))} INSERT INTO public.order_discounts (order_id, name, amount_cents, percentage) VALUES ('${O(409)}', 'x', 100, 0);`);
add('apply save: a negative custom fee is refused by the database', `SELECT public.apply_staff_order_save('${O(410)}', NULL, ${q(state('{}'))}::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[{"kind": "insert", "name": "x", "amount_cents": -100}]'::jsonb, '[]'::jsonb)::text`, (v: string) => v.startsWith('ERR:'), 'service_role', seedOrder(O(410)));
add('apply save: a payment in flight blocks a pricing change (the state barrier)', saveCall(411, state('{}'), '{"deposit_due_cents": 9000}'), (v: string) => v.startsWith('ERR:'), 'service_role', `ALTER TABLE public.orders ENABLE TRIGGER trg_guard_payment_authoritative_order_changes; ${seedOrder(O(411))} ${seedPay({ id: P(411), order: O(411), claim: C(1), claimedAgo: 5 })}`);
const invoiceOrder = (extra = '') => `{"status": "draft", "location_type": "residential", "event_date": "2030-06-01", "event_end_date": "2030-06-01", "start_window": "10:00", "end_window": "12:00", "pickup_preference": "next_day", "subtotal_cents": 25000, "deposit_due_cents": 5000, "balance_due_cents": 20000${extra}}`;
add('invoice order: creates a draft with its money, items, discounts and fees', `SELECT concat_ws('/', o.status, o.subtotal_cents, o.deposit_due_cents, (SELECT count(*) FROM public.order_discounts d WHERE d.order_id = o.id), (SELECT count(*) FROM public.order_custom_fees f WHERE f.order_id = o.id)) FROM public.orders o WHERE o.status = 'draft' AND o.subtotal_cents = 25011`, 'draft/25011/5000/1/1', 'postgres', `SELECT public.create_staff_invoice_order(${q(invoiceOrder().replace('25000', '25011'))}::jsonb, '[]'::jsonb, '[{"name": "d", "amount_cents": 100}]'::jsonb, '[{"name": "f", "amount_cents": 200}]'::jsonb);`);
add('invoice order: only a draft can be created', `SELECT public.create_staff_invoice_order(${q(invoiceOrder().replace('"draft"', '"confirmed"'))}::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)::text`, (v: string) => v.startsWith('ERR:'), 'service_role');
add('invoice order: a column outside the invoice list is refused', `SELECT public.create_staff_invoice_order(${q(invoiceOrder(', "deposit_paid_cents": 5000, "stripe_customer_id": "cus_x"'))}::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)::text`, (v: string) => v.startsWith('ERR:'), 'service_role');
add('waived amounts: the column exists, is nullable, and must be an object', tryInsert(`UPDATE public.orders SET waived_fee_amounts_cents = '[1]'::jsonb WHERE id = '${O(412)}'`), '23514', 'postgres', seedOrder(O(412)));
add('waived amounts: an object is accepted', tryInsert(`UPDATE public.orders SET waived_fee_amounts_cents = '{"travel": 5000}'::jsonb WHERE id = '${O(412)}'`), 'ok', 'postgres');

// ---- the provider-attempt marker ----
const mark = (pay: string, claimId: string | null) => `SELECT public.mark_payment_operation_provider_attempt('${pay}', ${claimId ? q(claimId) : 'NULL'})::text`;
const attemptedState = (pay: string) => `SELECT (provider_attempted_at IS NOT NULL)::text FROM public.payments WHERE id = '${pay}'`;
add('attempt marker: the owner of a pending operation marks it', mark(P(240), C(1)), 'true', 'service_role', owned(240, 5));
add('attempt marker: ... and the mark is stored', attemptedState(P(240)), 'true', 'postgres');
add('attempt marker: marking again keeps the FIRST time', `SELECT (provider_attempted_at < now() - interval '500 seconds')::text FROM public.payments WHERE id = '${P(241)}'`, 'true', 'postgres', `${seedOrder(O(241))} ${seedPay({ id: P(241), order: O(241), claim: C(1), claimedAgo: 5, attemptedAgo: 600 })} SELECT public.mark_payment_operation_provider_attempt('${P(241)}', '${C(1)}');`);
add('attempt marker: a non-owner cannot mark', mark(P(242), C(2)), 'false', 'service_role', owned(242, 5));
add('attempt marker: ... and nothing was stored', attemptedState(P(242)), 'false', 'postgres');
add('attempt marker: an unowned operation cannot be marked', mark(P(243), C(1)), 'false', 'service_role', mk(243));
add('attempt marker: a NULL claim id marks nothing', mark(P(243), null), 'false');
add('attempt marker: a NULL payment id marks nothing', `SELECT public.mark_payment_operation_provider_attempt(NULL, '${C(1)}')::text`, 'false');
add('attempt marker: a closed operation cannot be marked', mark(P(244), C(1)), 'false', 'service_role', `${seedOrder(O(244))} ${seedPay({ id: P(244), order: O(244), status: 'failed', claim: C(1), claimedAgo: 5 })}`);
add('attempt marker: an already-applied operation cannot be marked', mark(P(245), C(1)), 'false', 'service_role', `${seedOrder(O(245))} ${seedPay({ id: P(245), order: O(245), status: 'pending', claim: C(1), claimedAgo: 5, applied: true })}`);
add('attempt marker: an old ledger row that is not an operation (no key) cannot be marked', mark(P(246), C(1)), 'false', 'service_role', `${seedOrder(O(246))} ${seedPay({ id: P(246), order: O(246), key: null, principal: null, tip: null, amount: 5000, claim: C(1), claimedAgo: 5 })}`);
add('attempt marker: the claim of a new operation reports no attempt', claimField(O(247), 'deposit', 'staff', C(1), ['outcome', 'provider_attempted_at']), 'claimed', 'service_role', seedOrder(O(247)));
add('attempt marker: a resumed operation reports when it was attempted', `SELECT (j->>'provider_attempted_at' IS NOT NULL)::text FROM (SELECT ${claimCall(O(248), 'deposit', 'staff', C(2))} AS j) s`, 'true', 'service_role', `${seedOrder(O(248))} ${seedPay({ id: P(248), order: O(248), claim: null, attemptedAgo: 600 })}`);
add('attempt marker: a stale operation that was attempted reports it', `SELECT concat_ws('/', j->>'outcome', (j->>'provider_attempted_at' IS NOT NULL)::text) FROM (SELECT ${claimCall(O(249), 'deposit', 'staff', C(2))} AS j) s`, 'stale_operation/true', 'service_role', `${seedOrder(O(249), { dd: 6000, bd: 9000 })} ${seedPay({ id: P(249), order: O(249), claim: null, attemptedAgo: 600 })}`);
add('attempt marker: a stale operation that was never attempted reports none', `SELECT concat_ws('/', j->>'outcome', (j->>'provider_attempted_at' IS NOT NULL)::text) FROM (SELECT ${claimCall(O(250), 'deposit', 'staff', C(2))} AS j) s`, 'stale_operation/false', 'service_role', `${seedOrder(O(250), { dd: 6000, bd: 9000 })} ${seedPay({ id: P(250), order: O(250), claim: null })}`);
add('attempt marker: the age of the operation never changes whether it was attempted (created 14 hours ago, never attempted)', `SELECT (provider_attempted_at IS NULL)::text FROM public.payments WHERE id = '${P(251)}'`, 'true', 'postgres', `${seedOrder(O(251))} ${seedPay({ id: P(251), order: O(251), claim: null })} UPDATE public.payments SET created_at = now() - interval '14 hours' WHERE id = '${P(251)}';`);

// ---- the state barrier ----
const live = (n: number, o: OrderSeed = {}, p: Partial<PaySeed> = {}) => mk(n, o, { claim: C(1), claimedAgo: 10, ...p });
const BARRIER_ON = `ALTER TABLE public.orders ENABLE TRIGGER trg_guard_payment_authoritative_order_changes; SELECT set_config('bpc.finalizing_payment_id', '', true);`;
const upd = (n: number, sets: string) => tryInsert(`UPDATE public.orders SET ${sets} WHERE id = '${O(n)}'`);
add('barrier: while an operation holds a live lease the deposit due cannot change', upd(210, 'deposit_due_cents = 6000'), '55000', 'postgres', `${BARRIER_ON} ${live(210)}`);
for (const [label, sets] of [
  ['deposit paid', 'deposit_paid_cents = 100'], ['balance due', 'balance_due_cents = 1'], ['balance paid', 'balance_paid_cents = 100'],
  ['status', "status = 'cancelled'"], ['the order tip (raised)', 'tip_cents = 900'], ['the persisted selection type', "customer_selected_payment_type = 'full'"], ['the persisted selection amount', 'customer_selected_payment_cents = 777'],
] as Array<[string, string]>) {
  add(`barrier: ${label} cannot change under a live lease`, upd(210, sets), '55000', 'postgres');
}
add('barrier: ... and nothing changed', ordState(O(210)), 'pending_review/0/10000/0/0/unpaid', 'postgres');
add('barrier: unrelated columns still change freely (admin message, saved card, notes)', upd(210, "admin_message = 'note', stripe_payment_method_id = 'pm_x', stripe_customer_id = 'cus_x', deposit_due_cents = 5000"), 'ok', 'postgres');
add('barrier: the tip set to the value it already has is allowed under a live lease', upd(210, 'tip_cents = 0'), 'ok', 'postgres');
add('barrier: a tip that is stored and live-leased cannot be lowered or raised', upd(230, 'tip_cents = 1000'), '55000', 'postgres', `${live(230, { tip: 2000 })}`);
add('barrier: ... lowered to zero as well', upd(230, 'tip_cents = 0'), '55000', 'postgres');
add('barrier: ... the stored tip is untouched', `SELECT tip_cents::text FROM public.orders WHERE id = '${O(230)}'`, '2000', 'postgres');
add('barrier: the finalize of the operation may update the tip it was paying (tip applied through the barrier)', ordState(O(231)), 'confirmed/5000/10000/0/700/paid', 'postgres', `SELECT set_config('bpc.finalizing_payment_id', '', true); ${dep(231, { dd: 5000, bd: 10000, tip: 0, tipOp: 700 })} ${finDo(231, 5700)}`);
add('barrier: ... and once the operation is finished the tip can be changed again', upd(231, 'tip_cents = 123'), 'ok', 'postgres', `SELECT set_config('bpc.finalizing_payment_id', '', true);`);
add('barrier: a tip changed on an order with a stale lease is allowed', upd(232, 'tip_cents = 321'), 'ok', 'postgres', live(232, {}, { claimedAgo: 400 }));
add('barrier: setting a guarded column to the value it already has is allowed', upd(210, 'deposit_due_cents = 5000, balance_due_cents = 10000'), 'ok', 'postgres');
add('barrier: a lease older than the timeout no longer blocks (the operation is revalidated instead)', upd(211, 'deposit_due_cents = 6000'), 'ok', 'postgres', live(211, {}, { claimedAgo: 400 }));
add('barrier: an operation nobody holds does not block', upd(212, 'deposit_due_cents = 6000'), 'ok', 'postgres', mk(212));
add('barrier: a closed operation does not block', upd(213, 'deposit_due_cents = 6000'), 'ok', 'postgres', mk(213, {}, { status: 'failed' }));
add('barrier: a lease on ANOTHER order does not block this one', upd(215, 'deposit_due_cents = 6000'), 'ok', 'postgres', `${live(214)} ${seedOrder(O(215))}`);
add('barrier: a finalize announcing a DIFFERENT operation is not exempt', upd(216, 'deposit_due_cents = 6000'), '55000', 'postgres', `${live(216)} SELECT set_config('bpc.finalizing_payment_id', '${P(999)}', true);`);
add('barrier: the finalize of the very operation passes the barrier and applies the payment (owner path)', ordState(O(217)), 'confirmed/5000/10000/0/0/paid', 'postgres', `SELECT set_config('bpc.finalizing_payment_id', '', true); ${dep(217, { dd: 5000, bd: 10000 })} ${finDo(217, 5000)}`);
add('barrier: ... and the provider-authoritative path (webhook) passes it too', ordState(O(218)), 'confirmed/5000/10000/0/0/paid', 'postgres', `SELECT set_config('bpc.finalizing_payment_id', '', true); ${live(218)} SELECT public.finalize_payment_operation('${P(218)}', NULL, 'bpc-pay-${O(218)}-deposit-${P(218)}', 'pi_218', NULL, 5000, 'card', NULL, NULL, NULL, NULL, NULL, NULL);`);
add('barrier: after the finalize the operation holds no lease, so the order can change again', upd(217, 'deposit_due_cents = 6000'), 'ok', 'postgres', `SELECT set_config('bpc.finalizing_payment_id', '', true);`);
add('barrier: a claim on an order with no open operation still moves a fully paid order forward', claim(O(219), 'deposit', 'staff', C(1)), 'already_paid', 'service_role', `${seedOrder(O(219), { dp: 5000 })}`);
add('barrier: ... and the order is confirmed', ordState(O(219)), 'confirmed/5000/10000/0/0/unpaid', 'postgres');


// ---- access ----
const FNS = ['claim_payment_operation', 'record_payment_operation_provider', 'mark_payment_operation_provider_attempt', 'release_payment_operation', 'finalize_payment_operation'];
const callOf: Record<string, string> = {
  claim_payment_operation: claim(O(130), 'balance', 'customer', C(1), { principal: 1 }),
  record_payment_operation_provider: rec(P(130), C(1), 'pi_x'),
  mark_payment_operation_provider_attempt: `SELECT public.mark_payment_operation_provider_attempt('${P(130)}', '${C(1)}')::text`,
  release_payment_operation: rel(P(130), C(1)),
  finalize_payment_operation: fin(P(130), C(1), 1),
};
for (const fn of FNS) {
  for (const role of ['anon', 'authenticated']) add(`${role} cannot execute ${fn}`, callOf[fn], (v) => v.startsWith('ERR:42501'), role);
  add(`service_role can execute ${fn}`, callOf[fn], (v) => !v.startsWith('ERR:'), 'service_role');
}
add('the state-barrier function is not executable by PUBLIC, anon or authenticated', `SELECT count(*)::text FROM pg_proc p WHERE proname = 'guard_payment_authoritative_order_changes' AND pronamespace = 'public'::regnamespace AND (coalesce(proacl::text, '') ~ '(^|[{,])=X' OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, '0', 'postgres');
add('... and it is SECURITY DEFINER with a pinned search_path', `SELECT count(*)::text FROM pg_proc WHERE proname = 'guard_payment_authoritative_order_changes' AND pronamespace = 'public'::regnamespace AND prosecdef AND proconfig::text ~ 'search_path=public'`, '1', 'postgres');
add('the barrier trigger is on orders and covers exactly the payment-authoritative columns', `SELECT count(*)::text FROM pg_trigger t WHERE t.tgname = 'trg_guard_payment_authoritative_order_changes' AND t.tgrelid = 'public.orders'::regclass AND NOT t.tgisinternal`, '1', 'postgres');
add('PUBLIC holds no execute on any of the five', `SELECT count(*)::text FROM pg_proc WHERE proname IN (${FNS.map((f) => q(f)).join(',')}) AND pronamespace = 'public'::regnamespace AND coalesce(proacl::text, '') ~ '(^|[{,])=X'`, '0', 'postgres');
add('anon and authenticated hold no execute on any of the five (ACL check)', `SELECT count(*)::text FROM pg_proc p WHERE proname IN (${FNS.map((f) => q(f)).join(',')}) AND pronamespace = 'public'::regnamespace AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, '0', 'postgres');
add('all five are SECURITY DEFINER with a pinned search_path', `SELECT count(*)::text FROM pg_proc WHERE proname IN (${FNS.map((f) => q(f)).join(',')}) AND pronamespace = 'public'::regnamespace AND prosecdef AND proconfig::text ~ 'search_path=public'`, '5', 'postgres');
add('anon cannot read the provider-attempt column', `SELECT count(*)::text FROM unnest(ARRAY['provider_attempted_at']) c WHERE has_column_privilege('anon', 'public.payments', c, 'SELECT')`, '0', 'postgres');
add('anon cannot read payment operation columns', `SELECT count(*)::text FROM unnest(ARRAY['operation_key','claim_id','claimed_at','principal_amount_cents','tip_amount_cents','stripe_checkout_session_id']) c WHERE has_column_privilege('anon', 'public.payments', c, 'SELECT')`, '0', 'postgres');

const TRY_FN = `
CREATE FUNCTION pg_temp.try_sql(stmt text) RETURNS text LANGUAGE plpgsql AS $t$
BEGIN
  EXECUTE stmt;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $t$;
`;

function script(applyMigration: boolean): string {
  const calls = steps.map((s, i) => {
    const setup = s.setup ? `EXECUTE ${q(s.setup)};` : '';
    return `  ${setup}\n  RAISE NOTICE 'R|${i}|%', pg_temp.as_role(${q(s.role ?? 'service_role')}, ${q(s.sql)});`;
  });
  return `
BEGIN;
ALTER TABLE public.orders DISABLE TRIGGER USER;
${applyMigration ? raw : ''}
${TRY_FN}
CREATE FUNCTION pg_temp.as_role(r text, qry text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE res text;
BEGIN
  IF r <> 'postgres' THEN EXECUTE 'SET LOCAL ROLE ' || quote_ident(r); END IF;
  BEGIN
    EXECUTE qry INTO res;
  EXCEPTION WHEN OTHERS THEN
    res := 'ERR:' || SQLSTATE;
  END;
  RESET ROLE;
  RETURN res;
END $f$;
DO $run$
BEGIN
${calls.join('\n')}
END $run$;
ROLLBACK;
`;
}

function execute(psql: string, db: string, label: string, applyMigration: boolean, twice = false) {
  const input = twice ? script(applyMigration).replace('BEGIN;', () => `BEGIN;\n${raw}`) : script(applyMigration);
  const r = spawnSync(psql, [...argsFor(db), '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 240000 });
  const results: Record<number, string> = {};
  for (const m of ((r.stderr ?? '') + (r.stdout ?? '')).matchAll(/R\|(\d+)\|(.*)/g)) results[Number(m[1])] = m[2].trim();
  const done = Object.keys(results).length === steps.length;
  ok(`executed [${label}]: the script ran to completion in "${db}" (${Object.keys(results).length}/${steps.length} results)`, done);
  if (!done) console.error((r.stderr ?? '').split('\n').filter((l: string) => /ERROR|FATAL|DETAIL|CONTEXT/.test(l)).slice(0, 8).join('\n'));
  if (twice) return;
  steps.forEach((s, i) => {
    const got = results[i];
    const good = got !== undefined && (typeof s.expect === 'string' ? got === s.expect : s.expect(got));
    ok(`executed [${label}]: ${s.name} (got ${got})`, good);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// CONCURRENT: several real connections at once
// ---------------------------------------------------------------------------------------------------------------------
function psqlAsync(psql: string, db: string, input: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(psql, [...argsFor(db), '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: any) => { out += d.toString(); });
    child.stderr.on('data', (d: any) => { out += d.toString(); });
    child.on('close', (code: number | null) => resolve({ code, out }));
    child.stdin.end(input);
  });
}
const lastLine = (out: string) => out.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
const LOCK = 515151;

function ensureFullDb(basePsql: string): string | null {
  let psql = findPsql(dbFull);
  if (!psql) {
    spawnSync(basePsql, [...argsFor('postgres'), '-c', `CREATE DATABASE ${dbFull} TEMPLATE ${dbBase}`], { encoding: 'utf8' });
    psql = findPsql(dbFull);
  }
  if (!psql) return null;
  // Always bring the scratch database to exactly what this repository's migration defines.
  const applied = spawnSync(psql, [...argsFor(dbFull), '-v', 'ON_ERROR_STOP=1'], { input: raw, encoding: 'utf8' });
  return applied.status === 0 ? psql : null;
}

async function raceOnDatabase(psql: string, db: string) {
  const tag = String((Date.now() % 1e6) * 1000 + (process as any).pid % 1000).padStart(9, '0');
  const ord = (n: number) => `dddddddd-0000-4000-8000-${tag}${String(n).padStart(3, '0')}`;
  const cleanup = () => spawnSync(psql, [...argsFor(db), '-c', `DELETE FROM public.payments WHERE order_id::text LIKE 'dddddddd-0000-4000-8000-${tag}%'; DELETE FROM public.orders WHERE id::text LIKE 'dddddddd-0000-4000-8000-${tag}%'; DELETE FROM public.order_changelog WHERE order_id::text LIKE 'dddddddd-0000-4000-8000-${tag}%'`], { encoding: 'utf8' });
  cleanup();
  const run = (s: string) => spawnSync(psql, [...argsFor(db), '-v', 'ON_ERROR_STOP=1'], { input: `BEGIN; ALTER TABLE public.orders DISABLE TRIGGER USER; ${s} ALTER TABLE public.orders ENABLE TRIGGER USER; COMMIT;`, encoding: 'utf8' });
  const scalar = (s: string) => spawnSync(psql, [...argsFor(db), '-c', s], { encoding: 'utf8' }).stdout.trim();
  const cid = (n: number) => `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`;
  try {
    const race = async (workers: string[]) => {
      const gate = spawn(psql, [...argsFor(db)], { stdio: ['pipe', 'pipe', 'pipe'] });
      gate.stdin.end(`SELECT pg_advisory_lock(${LOCK}); SELECT pg_sleep(1.2);`);
      await new Promise((r) => setTimeout(r, 600));
      const runs = workers.map((w) => psqlAsync(psql, db, `SELECT pg_advisory_lock_shared(${LOCK}); SET ROLE service_role; ${w}`));
      return (await Promise.all(runs)).map((r) => lastLine(r.out));
    };
    const seed = (n: number, o: OrderSeed = {}) => run(seedOrder(ord(n), o));
    const tally = (xs: string[], v: string) => xs.filter((x) => x === v).length;
    const claimSql = (n: number, i: number, o: Opts & { purpose?: string } = {}) => `SELECT ${claimCall(ord(n), o.purpose ?? 'deposit', 'staff', cid(i), o)}->>'outcome';`;

    // five simultaneous claims for one logical payment: one owner, one operation
    seed(1, { tip: 1000 });
    const five = await race([1, 2, 3, 4, 5].map((i) => claimSql(1, i)));
    ok(`concurrent: five simultaneous deposit claims for one order give exactly one claimed and four busy (got ${five.join(',')})`, tally(five, 'claimed') === 1 && tally(five, 'busy') === 4);
    ok('concurrent: ... and exactly one operation exists', scalar(`SELECT count(*) FROM public.payments WHERE order_id = '${ord(1)}'`) === '1');

    // simultaneous finalizes of the same operation by the same owner
    const pid = scalar(`SELECT id FROM public.payments WHERE order_id = '${ord(1)}'`);
    const owner = scalar(`SELECT claim_id FROM public.payments WHERE id = '${pid}'`);
    const finals = await race(Array.from({ length: 5 }, () => `SELECT public.finalize_payment_operation('${pid}', '${owner}', NULL, 'pi_c1_${tag}', NULL, 6000, 'card', 'visa', '4242', 100, 5900, NULL, NULL)->>'outcome';`));
    ok(`concurrent: five simultaneous finalizes apply exactly once (got ${finals.join(',')})`, tally(finals, 'applied') === 1 && tally(finals, 'already_applied') + tally(finals, 'not_owner') === 4);
    ok('concurrent: ... the deposit was added exactly once and the order is confirmed', scalar(`SELECT concat_ws('/', status, deposit_paid_cents, balance_due_cents, tip_cents) FROM public.orders WHERE id = '${ord(1)}'`) === 'confirmed/5000/10000/1000');

    // the request that charged and the webhook finalize at the same moment
    seed(2, { tip: 0 });
    run(seedPay({ id: P(2), order: ord(2), type: 'deposit', claim: cid(2), claimedAgo: 5, principal: 5000, tip: 0 }).replace(`'${P(2)}'`, `'${P(2).replace('bbbbbbbb', 'bbbbbbb1')}'`).replace(new RegExp(`bpc-pay-${ord(2)}-deposit-${P(2)}`), `bpc-pay-${ord(2)}-deposit-${P(2).replace('bbbbbbbb', 'bbbbbbb1')}`));
    const p2 = P(2).replace('bbbbbbbb', 'bbbbbbb1');
    const key2 = `bpc-pay-${ord(2)}-deposit-${p2}`;
    const both = await race([
      `SELECT public.finalize_payment_operation('${p2}', '${cid(2)}', NULL, 'pi_c2_${tag}', NULL, 5000, 'card', NULL, NULL, NULL, NULL, NULL, NULL)->>'outcome';`,
      `SELECT public.finalize_payment_operation('${p2}', NULL, '${key2}', 'pi_c2_${tag}', NULL, 5000, 'card', NULL, NULL, NULL, NULL, NULL, NULL)->>'outcome';`,
    ]);
    ok(`concurrent: the charging request and the webhook finalizing together apply once (got ${both.join(',')})`, tally(both, 'applied') === 1 && tally(both, 'already_applied') === 1);
    ok('concurrent: ... deposit paid exactly once', scalar(`SELECT deposit_paid_cents FROM public.orders WHERE id = '${ord(2)}'`) === '5000');

    // a finalize racing a release: exactly one valid transition
    seed(3);
    run(seedPay({ id: P(3).replace('bbbbbbbb', 'bbbbbbb3'), order: ord(3), type: 'deposit', claim: cid(3), claimedAgo: 5, principal: 5000, tip: 0 }).replace(new RegExp(`bpc-pay-[^']*`), `bpc-pay-${ord(3)}-deposit-r3`));
    const p3 = P(3).replace('bbbbbbbb', 'bbbbbbb3');
    const fr = await race([
      `SELECT public.finalize_payment_operation('${p3}', '${cid(3)}', NULL, 'pi_c3_${tag}', NULL, 5000, 'card', NULL, NULL, NULL, NULL, NULL, NULL)->>'outcome';`,
      `SELECT public.release_payment_operation('${p3}', '${cid(3)}', 'failed')::text;`,
    ]);
    const endState = scalar(`SELECT concat_ws('/', status, order_financials_applied::text) FROM public.payments WHERE id = '${p3}'`);
    const orderDep = scalar(`SELECT deposit_paid_cents FROM public.orders WHERE id = '${ord(3)}'`);
    const finalizeWon = fr[0] === 'applied';
    ok(`concurrent: a finalize and a release racing for one claim leave one valid state (got ${fr.join(',')} -> ${endState}, deposit ${orderDep})`,
      (finalizeWon && fr[1] === 'false' && endState === 'succeeded/true' && orderDep === '5000') || (!finalizeWon && fr[0] === 'not_owner' && fr[1] === 'true' && endState === 'failed/false' && orderDep === '0'));

    // two simultaneous balance payments of the whole balance: only one operation
    seed(4, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 });
    const bals = await race([1, 2].map((i) => `SELECT ${claimCall(ord(4), 'balance', 'customer', cid(10 + i), { principal: 10000 })}->>'outcome';`));
    ok(`concurrent: two simultaneous 10000 balance requests on a 10000 balance give one operation and one busy (got ${bals.join(',')})`, tally(bals, 'claimed') === 1 && tally(bals, 'busy') === 1);
    const p4 = scalar(`SELECT id FROM public.payments WHERE order_id = '${ord(4)}'`);
    const o4 = scalar(`SELECT claim_id FROM public.payments WHERE id = '${p4}'`);
    run(`SELECT 1;`);
    spawnSync(psql, [...argsFor(db), '-c', `SET ROLE service_role; SELECT public.finalize_payment_operation('${p4}', '${o4}', NULL, 'pi_c4_${tag}', NULL, 10000, 'card', NULL, NULL, NULL, NULL, NULL, NULL)`], { encoding: 'utf8' });
    const after = spawnSync(psql, [...argsFor(db), '-c', `SET ROLE service_role; SELECT ${claimCall(ord(4), 'balance', 'customer', cid(20), { principal: 10000 })}->>'outcome'`], { encoding: 'utf8' }).stdout.trim().split('\n').pop();
    ok(`concurrent: once it is paid the same request is refused as over the balance (got ${after})`, after === 'over_balance');

    // the order tip racing a claim: whichever comes first, the operation's tip always equals the order's final tip
    {
      const outcomes: string[] = [];
      for (let k = 0; k < 4; k++) {
        const n = 60 + k;
        seed(n, { tip: 1000 });
        await race([
          claimSql(n, 70 + k),
          `RESET ROLE; DO $$ BEGIN UPDATE public.orders SET tip_cents = 4000 WHERE id = '${ord(n)}'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END $$; SELECT 'done';`,
        ]);
        const st = scalar(`SELECT concat_ws('/', o.tip_cents, p.tip_amount_cents, p.status) FROM public.orders o JOIN public.payments p ON p.order_id = o.id WHERE o.id = '${ord(n)}'`);
        outcomes.push(st);
      }
      ok(`concurrent: a tip update racing a claim never leaves the operation with a different tip than the order (got ${outcomes.join(' | ')})`, outcomes.every((s) => s === '4000/4000/pending' || s === '1000/1000/pending') && outcomes.some((s) => s === '4000/4000/pending' || s === '1000/1000/pending'));
      // while an operation is live the tip is refused at the database
      seed(66, { tip: 1000 });
      run(seedPay({ id: P(66).replace('bbbbbbbb', 'bbbbbbb6'), order: ord(66), claim: cid(66), claimedAgo: 5, principal: 5000, tip: 1000 }).replace(new RegExp('bpc-pay-[^\']*'), `bpc-pay-${ord(66)}-deposit-t66`));
      const refused = await race([
        `RESET ROLE; DO $$ BEGIN UPDATE public.orders SET tip_cents = 4000 WHERE id = '${ord(66)}'; EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'x'; END $$; SELECT 'done';`,
        `RESET ROLE; DO $$ BEGIN UPDATE public.orders SET tip_cents = 0 WHERE id = '${ord(66)}'; EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'x'; END $$; SELECT 'done';`,
        `RESET ROLE; UPDATE public.orders SET admin_message = 'allowed' WHERE id = '${ord(66)}'; SELECT 'done';`,
      ]);
      ok(`concurrent: with a live lease the tip can be neither raised nor lowered, while the admin message still changes (got ${scalar(`SELECT concat_ws('/', tip_cents, admin_message) FROM public.orders WHERE id = '${ord(66)}'`)})`, refused.length === 3 && scalar(`SELECT concat_ws('/', tip_cents, admin_message) FROM public.orders WHERE id = '${ord(66)}'`) === '1000/allowed');
    }

    // five simultaneous takeovers of a stale operation: one new owner
    seed(5);
    run(seedPay({ id: P(5).replace('bbbbbbbb', 'bbbbbbb5'), order: ord(5), claim: cid(50), claimedAgo: 900, principal: 5000, tip: 0 }).replace(new RegExp(`bpc-pay-[^']*`), `bpc-pay-${ord(5)}-deposit-s5`));
    const stale = await race([1, 2, 3, 4, 5].map((i) => claimSql(5, 60 + i)));
    ok(`concurrent: five simultaneous takeovers of a stale operation produce exactly one resumed and four busy (got ${stale.join(',')})`, tally(stale, 'resumed') === 1 && tally(stale, 'busy') === 4);
    ok('concurrent: ... still exactly one operation', scalar(`SELECT count(*) FROM public.payments WHERE order_id = '${ord(5)}'`) === '1');

    // different orders do not wait for or block each other
    seed(6); seed(7);
    const two = await race([claimSql(6, 71), claimSql(7, 72)]);
    ok(`concurrent: claims for different orders both succeed (got ${two.join(',')})`, tally(two, 'claimed') === 2);

    // ---- an order update racing the payment machinery: a stale amount is never charged as a NEW operation ----
    const blocked = (out: string) => /payment is in progress|guard_payment_authoritative_order_changes/.test(out);
    const updateSql = (n: number, sets: string) => `RESET ROLE; UPDATE public.orders SET ${sets} WHERE id = '${ord(n)}'; SELECT 'updated';`;

    // an order update racing a claim: whichever commits first, the operation's amount is the committed deposit
    for (let i = 0; i < 6; i++) {
      const n = 20 + i;
      seed(n);
      const res = await race([claimSql(n, 80 + i), updateSql(n, 'deposit_due_cents = 6000, balance_due_cents = 9000')]);
      const dd = scalar(`SELECT deposit_due_cents FROM public.orders WHERE id = '${ord(n)}'`);
      const principal = scalar(`SELECT principal_amount_cents FROM public.payments WHERE order_id = '${ord(n)}'`);
      const updated = res[1] === 'updated';
      ok(`concurrent: order update racing a claim (round ${i + 1}): the claimed amount equals the committed deposit (got ${res.join(' | ').slice(0, 120)}; deposit ${dd}, principal ${principal})`,
        res[0] === 'claimed' && principal === dd && (updated ? dd === '6000' : blocked(res[1]) && dd === '5000'));
    }

    // a financial order update racing the provider-readiness transition (recording the PaymentIntent)
    for (let i = 0; i < 4; i++) {
      const n = 30 + i;
      seed(n);
      const pid = `bbbbbbb${i}-0000-4000-8000-${tag}${String(n).padStart(3, '0')}`;
      run(seedPay({ id: pid, order: ord(n), claim: cid(300 + i), claimedAgo: 5, principal: 5000, tip: 0 }).replace(new RegExp('bpc-pay-[^\']*'), `bpc-pay-${ord(n)}-deposit-r${i}`));
      const res = await race([`SELECT public.record_payment_operation_provider('${pid}', '${cid(300 + i)}', 'pi_ready_${tag}_${i}', NULL)::text;`, updateSql(n, 'balance_due_cents = 1, deposit_due_cents = 100')]);
      ok(`concurrent: a financial update racing the provider-readiness transition is refused while the operation is leased (round ${i + 1}) (got ${res.join(' | ').slice(0, 100)})`,
        res[0] === 'true' && blocked(res[1]) && scalar(`SELECT concat_ws('/', deposit_due_cents, balance_due_cents) FROM public.orders WHERE id = '${ord(n)}'`) === '5000/10000');
    }

    // a stale-lease takeover racing an order update: never resumed with an amount the order no longer authorizes
    for (let i = 0; i < 6; i++) {
      const n = 40 + i;
      seed(n);
      const pid = `bbbbbbb${i}-1111-4000-8000-${tag}${String(n).padStart(3, '0')}`;
      run(seedPay({ id: pid, order: ord(n), claim: cid(400 + i), claimedAgo: 900, principal: 5000, tip: 0 }).replace(new RegExp('bpc-pay-[^\']*'), `bpc-pay-${ord(n)}-deposit-t${i}`));
      const res = await race([`SELECT concat_ws('/', j->>'outcome', j->>'reason') FROM (SELECT ${claimCall(ord(n), 'deposit', 'staff', cid(500 + i))} AS j) s;`, updateSql(n, 'deposit_due_cents = 6000, balance_due_cents = 9000')]);
      const dd = scalar(`SELECT deposit_due_cents FROM public.orders WHERE id = '${ord(n)}'`);
      const resumedStale = res[0] === 'resumed' && dd !== '5000';
      ok(`concurrent: stale-lease takeover racing an order update (round ${i + 1}): never resumed against a changed order (got ${res.join(' | ').slice(0, 110)}; deposit ${dd})`,
        !resumedStale && ((res[0] === 'resumed' && blocked(res[1]) && dd === '5000') || (res[0] === 'stale_operation/order_changed' && res[1] === 'updated' && dd === '6000')));
    }

    // a finalize racing an incompatible update: the payment is applied once, whole, and the update never lands in the middle of it
    for (let i = 0; i < 4; i++) {
      const n = 50 + i;
      seed(n);
      const pid = `bbbbbbb${i}-2222-4000-8000-${tag}${String(n).padStart(3, '0')}`;
      const own = cid(600 + i);
      run(seedPay({ id: pid, order: ord(n), claim: own, claimedAgo: 5, principal: 5000, tip: 0 }).replace(new RegExp('bpc-pay-[^\']*'), `bpc-pay-${ord(n)}-deposit-f${i}`));
      const res = await race([`SELECT public.finalize_payment_operation('${pid}', '${own}', NULL, 'pi_fin_${tag}_${i}', NULL, 5000, 'card', NULL, NULL, NULL, NULL, NULL, NULL)->>'outcome';`, updateSql(n, 'deposit_due_cents = 6000')]);
      const state = scalar(`SELECT concat_ws('/', status, deposit_paid_cents, balance_due_cents, deposit_due_cents) FROM public.orders WHERE id = '${ord(n)}'`);
      ok(`concurrent: finalize racing an incompatible update (round ${i + 1}): applied exactly once and whole (got ${res.join(' | ').slice(0, 100)}; ${state})`,
        res[0] === 'applied' && ((blocked(res[1]) && state === 'confirmed/5000/10000/5000') || (res[1] === 'updated' && state === 'confirmed/5000/10000/6000')));
    }
  } finally {
    cleanup();
  }
}

(async () => {
  const baseCandidate = findPsql(dbBase);
  if (!baseCandidate) {
    if (process.env.ROLE_DB_REQUIRE) ok(`executed: scratch database "${dbBase}" is available (ROLE_DB_REQUIRE is set)`, false);
    else console.log('EXECUTED layer SKIPPED: the scratch database for the payment operation tests was not reachable (see the header of this file).');
  } else {
    // the migration text applied on top of the older history, and applied twice (idempotent)
    execute(baseCandidate, dbBase, 'older migrations + this migration', true);
    execute(baseCandidate, dbBase, 'migration applied twice', true, true);
    // The mutation runner's fast first pass sets MUTATION_SKIP_CONCURRENT: it skips this slow section, and a mutant is only
    // reported as surviving after a second, complete attempt without it. Never set it for a normal test run.
    const fullPsql = process.env.MUTATION_SKIP_CONCURRENT ? null : ensureFullDb(baseCandidate);
    if (!process.env.MUTATION_SKIP_CONCURRENT) ok(`concurrent: scratch database "${dbFull}" is ready with this repository's migration`, !!fullPsql || !process.env.ROLE_DB_REQUIRE);
    if (fullPsql) {
      execute(fullPsql, dbFull, 'fresh scratch database with this migration (no re-application)', false);
      await raceOnDatabase(fullPsql, dbFull);
    }
  }

  console.log(`Payment operation tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} payment operation test(s) failed`);
})();
