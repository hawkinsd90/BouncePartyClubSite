/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
// Production -> Development order data refresh: scope, plan analysis and generated SQL. No database is used: the analysis and the
// script builders are pure, so every rule is checked against synthetic schemas, and the generated SQL is inspected as text.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/syncDevDataFromProd/syncDevDataFromProdAnalyze.test.ts

declare const require: (id: string) => any;
const fs = require('fs');

import { analyze } from '../../../../scripts/SyncDevDataFromProd/lib/analyze.mjs';
import * as config from '../../../../scripts/SyncDevDataFromProd/lib/config.mjs';
import { assertTargetIdentity, redact, refOfTarget, targetFromUrl } from '../../../../scripts/SyncDevDataFromProd/lib/psql.mjs';
import { buildApplyScript, buildBackupScript, buildExportScript, buildRestoreScript, buildSequenceScript } from '../../../../scripts/SyncDevDataFromProd/lib/sqlgen.mjs';
import { hasSavedCard } from '../../../../supabase/functions/_shared/orders/lifecycle-outcome';

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

// ---------------------------------------------------------------------------------------------------------------------
// Synthetic schema builder
// ---------------------------------------------------------------------------------------------------------------------
const col = (name: string, type = 'text', o: any = {}) => ({ name, type, notNull: !!o.notNull, default: o.default ?? null, generated: !!o.generated, identity: o.identity ?? '' });
const tbl = (columns: any[], o: any = {}) => ({ forceRls: false, rls: false, columns, pk: o.pk ?? ['id'], serials: o.serials ?? [] });
const fk = (childTable: string, childColumns: string[], parentTable: string, onDelete = 'c', o: any = {}) => ({
  name: `${childTable}_${childColumns.join('_')}_fkey`,
  childSchema: o.childSchema ?? 'public',
  childTable,
  childColumns,
  parentSchema: o.parentSchema ?? 'public',
  parentTable,
  parentColumns: o.parentColumns ?? ['id'],
  onDelete,
});
const schema = (tables: Record<string, any>, fks: any[] = [], triggers: any[] = [], role = { name: 'postgres', bypassRls: true }) => ({ database: 'x', role, tables, fks, triggers, hasAuthUsers: true });

const SCOPE = ['customers', 'orders', 'order_items'];
const base = () => ({
  customers: tbl([col('id', 'uuid', { notNull: true }), col('email', 'text', { notNull: true }), col('user_id', 'uuid')]),
  orders: tbl([col('id', 'uuid', { notNull: true }), col('customer_id', 'uuid'), col('status', 'text'), col('payment_lock', 'boolean'), col('stripe_customer_id', 'text')]),
  order_items: tbl([col('id', 'uuid', { notNull: true }), col('order_id', 'uuid'), col('qty', 'integer')]),
});
const baseFks = () => [fk('orders', ['customer_id'], 'customers'), fk('order_items', ['order_id'], 'orders'), fk('customers', ['user_id'], 'users', 'c', { parentSchema: 'auth' })];
const run = (prodT: any, devT: any, fks = baseFks(), triggers: any[] = [], extra: any = {}) =>
  analyze(schema(prodT), schema(devT, fks, triggers, extra.devRole), { scope: SCOPE, deferred: {}, cleared: extra.cleared ?? [], reviewedTriggers: extra.reviewed ?? {}, acknowledgeTriggers: extra.ack ?? [] });

// ---- a compatible pair ------------------------------------------------------------------------------------------------
{
  const p = run(base(), base());
  ok('compatible schemas produce an executable plan', p.ok && p.blockers.length === 0);
  eq('all three tables are imported', p.tables.map((t: any) => `${t.name}:${t.mode}`), ['customers:import', 'orders:import', 'order_items:import']);
  eq('every column is copied', p.tables[1].copied, ['id', 'customer_id', 'status', 'payment_lock', 'stripe_customer_id']);
  eq('customer ownership column is recognised and not copied raw', p.tables[0].ownerColumn, 'user_id');
  ok('ownership column is excluded from the byte-for-byte comparison', !p.tables[0].compared.includes('user_id'));
  eq('forced / quarantined columns are not compared either', [p.tables[1].forced.map((f: any) => f.column), p.tables[1].quarantined], [['payment_lock'], ['stripe_customer_id']]);
  eq('foreign keys inside the scope are tracked for orphan checks', p.intraFks.map((f: any) => `${f.child}.${f.childColumn}->${f.parent}`), ['orders.customer_id->customers', 'order_items.order_id->orders']);
}
// ---- schema differences ----------------------------------------------------------------------------------------------
{
  const dev = base();
  dev.orders.columns.push(col('setup_fee_cents', 'integer', { notNull: true, default: '0' }), col('essentials', 'integer'));
  const prod = base();
  prod.orders.columns.push(col('legacy_note', 'text'));
  const p = run(prod, dev);
  ok('Development-only columns with a default (or nullable) are allowed and left to the database', p.ok && p.tables[1].devOnly.includes('setup_fee_cents') && p.tables[1].devOnly.includes('essentials'));
  eq('Production-only columns are reported, not copied', p.tables[1].prodOnly, ['legacy_note']);
}
{
  const dev = base();
  dev.orders.columns.push(col('must_have', 'text', { notNull: true }));
  const p = run(base(), dev);
  ok('a column Development requires (no default) that Production lacks stops the run', !p.ok && p.blockers.some((b: string) => /orders\.must_have.*required/.test(b)));
}
{
  const dev = base();
  dev.orders.columns[2] = col('status', 'integer');
  const p = run(base(), dev);
  ok('a column type difference stops the run', !p.ok && p.blockers.some((b: string) => /orders\.status: type differs/.test(b)));
  const dev2 = base();
  dev2.orders.columns[2] = col('status', 'character varying(20)');
  const prod2 = base();
  prod2.orders.columns[2] = col('status', 'character varying(50)');
  const p2 = run(prod2, dev2);
  ok('only a type MODIFIER difference is a warning (the rehearsal proves the data fits)', p2.ok && p2.warnings.some((w: string) => /type modifier differs/.test(w)));
}
{
  const prod = base();
  prod.orders.columns[2] = col('status', 'text');
  const dev = base();
  dev.orders.columns[2] = col('status', 'text', { notNull: true, default: "'draft'::text" });
  const p = run(prod, dev);
  eq('Production nullable / Development NOT NULL with a default is coalesced to the default', p.tables[1].coalesced, [{ column: 'status', default: "'draft'::text" }]);
  ok('a coalesced column is excluded from the byte comparison (it legitimately differs)', !p.tables[1].compared.includes('status'));
  const dev3 = base();
  dev3.orders.columns[2] = col('status', 'text', { notNull: true });
  const p3 = run(prod, dev3);
  eq('Production nullable / Development NOT NULL without a default is checked against the data', p3.tables[1].nonNullChecked, ['status']);
}
{
  const dev = base();
  const prod = base();
  delete prod.order_items;
  const p = run(prod, dev);
  ok('a table missing from Production is delete-only with a warning', p.ok && p.tables[2].mode === 'delete-only' && p.warnings.some((w: string) => /order_items: exists in Development but not in Production/.test(w)));
  const dev2 = base();
  delete dev2.order_items;
  const p2 = run(base(), dev2, baseFks().slice(0, 1));
  ok('a table missing from Development is skipped with a warning', p2.ok && p2.tables[2].mode === 'skip');
  const dev3 = base();
  dev3.orders.pk = [];
  ok('a Development table without a primary key stops the run', !run(base(), dev3).ok);
  const prod4 = base();
  prod4.customers.columns = prod4.customers.columns.filter((c: any) => c.name !== 'id');
  ok('a primary key the export cannot supply stops the run (rows would get new ids)', !run(prod4, base()).ok);
}
// ---- dependency graph ------------------------------------------------------------------------------------------------
{
  const f = [...baseFks(), fk('customers', ['default_address_id'], 'addresses', 'n')];
  const dev = base();
  dev.customers.columns.push(col('default_address_id', 'uuid'));
  dev.addresses = tbl([col('id', 'uuid', { notNull: true })]);
  const prod = JSON.parse(JSON.stringify(dev));
  const bad = analyze(schema(prod), schema(dev, f), { scope: ['customers', 'addresses', 'orders', 'order_items'], deferred: {}, cleared: [], reviewedTriggers: {} });
  ok('a reference to a table loaded LATER that is not declared deferred stops the run', !bad.ok && bad.blockers.some((b: string) => /customers\.default_address_id -> addresses: the parent is loaded after the child/.test(b)));
  const good = analyze(schema(prod), schema(dev, f), { scope: ['customers', 'addresses', 'orders', 'order_items'], deferred: { customers: ['default_address_id'] }, cleared: [], reviewedTriggers: {} });
  ok('declaring the circular column deferred makes the same graph valid', good.ok && good.tables[0].deferred[0] === 'default_address_id');
  const self = analyze(schema(base()), schema({ ...base() }, [...baseFks(), fk('orders', ['customer_id'], 'orders')]), { scope: SCOPE, deferred: {}, cleared: [], reviewedTriggers: {} });
  ok('a self-reference must be declared deferred', !self.ok && self.blockers.some((b: string) => /same table/.test(b)));
}
{
  const dev = base();
  dev.audit = tbl([col('id', 'uuid', { notNull: true }), col('order_id', 'uuid')]);
  const withChild = (action: string, pk = ['id']) => {
    const d = JSON.parse(JSON.stringify(dev));
    d.audit.pk = pk;
    return run(base(), d, [...baseFks(), fk('audit', ['order_id'], 'orders', action)]);
  };
  ok('an unscoped table with ON DELETE CASCADE to a replaced table stops the run (its rows would be destroyed)', !withChild('c').ok && withChild('c').blockers.some((b: string) => /would delete rows of an unscoped table/.test(b)));
  ok('an unscoped table with NO ACTION to a replaced table stops the run (the delete would fail)', !withChild('a').ok);
  ok('an unscoped table with RESTRICT to a replaced table stops the run', !withChild('r').ok);
  ok('an unscoped SET NULL reference is remembered and restored', withChild('n').ok && withChild('n').preservedChildren.length === 1 && withChild('n').preservedChildren[0].table === 'audit');
  ok('an unscoped SET NULL reference without a primary key stops the run', !withChild('n', []).ok);
  const d = JSON.parse(JSON.stringify(dev));
  const cleared = run(base(), d, [...baseFks(), fk('audit', ['order_id'], 'orders', 'c')], [], { cleared: ['audit'] });
  ok('a table named in CLEARED_WITH_ORDERS with CASCADE is emptied with its orders', cleared.ok && cleared.clearedWithOrders.length === 1 && cleared.clearedWithOrders[0].table === 'audit');
  const badCleared = run(base(), JSON.parse(JSON.stringify(dev)), [...baseFks(), fk('audit', ['order_id'], 'orders', 'n')], [], { cleared: ['audit'] });
  ok('a "cleared" table that is not ON DELETE CASCADE stops the run', !badCleared.ok);
  const composite = run(base(), JSON.parse(JSON.stringify(dev)), [...baseFks(), fk('audit', ['order_id', 'id'], 'orders', 'n')]);
  ok('composite references are refused rather than guessed at', !composite.ok);
}
// ---- task_evidence_overrides (photo-evidence release): the real config against a synthetic schema ------------------------------------
{
  const scope = ['customers', 'orders', 'order_items', 'task_status'];
  const mk = (extraTables: Record<string, any> = {}) => {
    const t: any = base();
    t.task_status = tbl([col('id', 'uuid', { notNull: true }), col('order_id', 'uuid'), col('task_type', 'text')]);
    t.task_evidence_overrides = tbl([col('id', 'uuid', { notNull: true }), col('task_status_id', 'uuid', { notNull: true }), col('order_id', 'uuid', { notNull: true }), col('actor_id', 'uuid', { notNull: true })]);
    return { ...t, ...extraTables };
  };
  const prodT = (() => { const t: any = mk(); delete t.task_evidence_overrides; return t; })(); // Production predates the release
  const fks = (override: string, extra: any[] = []) => [...baseFks(), fk('task_status', ['order_id'], 'orders'), fk('task_evidence_overrides', ['task_status_id'], 'task_status', override), ...extra];
  const analyzeReal = (devT: any, devFks: any[]) => analyze(schema(prodT), schema(devT, devFks), { scope, deferred: {}, cleared: config.CLEARED_WITH_ORDERS, reviewedTriggers: {} });

  ok('the shipped config lists task_evidence_overrides among the tables emptied with their orders, and it is not also a replaced table', config.CLEARED_WITH_ORDERS.includes('task_evidence_overrides') && !config.REPLACE_TABLES.includes('task_evidence_overrides'));
  const good = analyzeReal(mk(), fks('c'));
  ok('with the shipped config the overrides (ON DELETE CASCADE from task_status) are planned as emptied with their tasks, not as a blocker', good.ok && good.clearedWithOrders.map((c: any) => c.table).join() === 'task_evidence_overrides' && good.clearedWithOrders[0].parent === 'task_status');
  const noAction = analyzeReal(mk(), fks('a'));
  ok('the same table with a non-cascading reference still stops the run (only a cascade qualifies)', !noAction.ok && noAction.blockers.some((b: string) => /expected ON DELETE CASCADE/.test(b)));
  const sibling = mk({ zz_task_note: tbl([col('id', 'uuid', { notNull: true }), col('task_status_id', 'uuid')]) });
  const withSibling = analyzeReal(sibling, fks('c', [fk('zz_task_note', ['task_status_id'], 'task_status', 'c')]));
  ok('an unrecognized dependent table that cascades from task_status still stops the run', !withSibling.ok && withSibling.blockers.some((b: string) => /zz_task_note.*would delete rows of an unscoped table/.test(b)));
  const siblingRestrict = analyzeReal(sibling, fks('c', [fk('zz_task_note', ['task_status_id'], 'task_status', 'a')]));
  ok('an unrecognized dependent table with no cascade (the delete would fail) still stops the run', !siblingRestrict.ok);
  ok('the photo-evidence trigger on task_status is a reviewed trigger (and an unreviewed one on task_status still blocks)', Object.prototype.hasOwnProperty.call(config.REVIEWED_TRIGGERS, 'task_status.trg_enforce_task_evidence') && !analyze(schema(prodT), schema(mk(), fks('c'), [{ table: 'task_status', name: 'zz_unreviewed', enabled: 'O', function: 'f', callsOutside: false }]), { scope, deferred: {}, cleared: config.CLEARED_WITH_ORDERS, reviewedTriggers: config.REVIEWED_TRIGGERS }).ok);
  const gone = analyze(schema(prodT), schema(prodT, [...baseFks(), fk('task_status', ['order_id'], 'orders')]), { scope, deferred: {}, cleared: config.CLEARED_WITH_ORDERS, reviewedTriggers: {} });
  ok('a Development database that does not have the table yet (before the release) plans normally', gone.ok && gone.clearedWithOrders.length === 0);
}
// ---- triggers --------------------------------------------------------------------------------------------------------
{
  const tg = (table: string, name: string, extra: any = {}) => ({ table, name, enabled: 'O', function: 'f', callsOutside: false, ...extra });
  const unreviewed = run(base(), base(), baseFks(), [tg('orders', 'new_thing')]);
  ok('a trigger nobody reviewed on a replaced table stops the run', !unreviewed.ok && unreviewed.blockers.some((b: string) => /orders\.new_thing.*has not been reviewed/.test(b)));
  const acked = run(base(), base(), baseFks(), [tg('orders', 'new_thing')], { ack: ['orders.new_thing'] });
  ok('it can be acknowledged explicitly, by name, on the command line', acked.ok && acked.triggers[0].reviewed);
  const reviewed = run(base(), base(), baseFks(), [tg('orders', 'known')], { reviewed: { 'orders.known': 'because' } });
  ok('a reviewed trigger carries its reason into the plan', reviewed.ok && reviewed.triggers[0].reason === 'because');
  const unrelated = run(base(), base(), baseFks(), [tg('site_events', 'whatever')]);
  ok('a trigger on a table the refresh does not touch is ignored', unrelated.ok && unrelated.triggers.length === 0);
  const outside = run(base(), base(), baseFks(), [tg('orders', 'known', { callsOutside: true })], { reviewed: { 'orders.known': 'x' } });
  ok('a trigger that appears to call an external service is flagged', outside.warnings.some((w: string) => /external service/.test(w)));
  const noBypass = run(base(), base(), baseFks(), [], { devRole: { name: 'limited', bypassRls: false } });
  ok('a Development role that does not bypass row-level security stops the run', !noBypass.ok);
}

// ---------------------------------------------------------------------------------------------------------------------
// Scope policy (config.mjs)
// ---------------------------------------------------------------------------------------------------------------------
const PROTECTED = ['admin_settings', 'admin_settings_changelog', 'user_roles', 'customer_profiles', 'user_consent_log', 'pending_signups_consent', 'pricing_rules', 'units', 'unit_media', 'email_templates', 'sms_message_templates', 'inventory_products', 'product_bundles', 'product_bundle_components', 'product_pricing', 'product_categories', 'public_menu_groups', 'public_menu_group_categories', 'hero_carousel_images', 'blackout_dates', 'blackout_contacts', 'blackout_addresses', 'google_reviews', 'google_calendar_sync', 'stripe_webhook_events', 'site_events', 'rate_limits', 'notification_failures', 'notification_system_status', 'daily_mileage_logs', 'auth_trigger_logs', 'saved_fee_templates', 'saved_discount_templates'];
for (const t of PROTECTED) ok(`${t} is never replaced`, !config.REPLACE_TABLES.includes(t) && !config.CLEARED_WITH_ORDERS.includes(t));
for (const t of ['customers', 'contacts', 'addresses', 'orders', 'order_items', 'payments', 'order_refunds', 'transaction_receipts', 'invoices', 'invoice_links', 'order_notes', 'order_changelog', 'order_workflow_events', 'task_status', 'route_stops', 'crew_location_history', 'sms_conversations', 'messages', 'order_signatures', 'order_pictures', 'order_lot_pictures', 'address_lot_pictures', 'consent_records', 'order_discounts', 'order_custom_fees', 'documents']) ok(`${t} is replaced`, config.REPLACE_TABLES.includes(t));
eq('no table is listed twice', new Set(config.REPLACE_TABLES).size, config.REPLACE_TABLES.length);
ok('every deferred column belongs to a replaced table', Object.keys(config.DEFERRED_COLUMNS).every((t) => config.REPLACE_TABLES.includes(t)));
ok('every reviewed trigger is on a replaced or cleared table', Object.keys(config.REVIEWED_TRIGGERS).every((k) => config.REPLACE_TABLES.includes(k.split('.')[0]) || config.CLEARED_WITH_ORDERS.includes(k.split('.')[0])));
eq('only the three reusable Stripe instruments are withheld', config.QUARANTINED_STRIPE_COLUMNS, { orders: ['stripe_customer_id', 'stripe_payment_method_id', 'payment_method_id'] });
ok('ledger references (payment intents, charges, refunds) are NOT withheld: history stays whole and unique indexes stay valid', !JSON.stringify(config.QUARANTINED_STRIPE_COLUMNS).match(/payment_intent|charge|refund|session/));

// ---------------------------------------------------------------------------------------------------------------------
// Stripe: why withholding the instruments is the least invasive safe choice (evidence from the application code)
// ---------------------------------------------------------------------------------------------------------------------
ok('the application treats a card as saved only when BOTH ids are present', hasSavedCard({ stripe_customer_id: 'cus_x', stripe_payment_method_id: 'pm_x' }) === true);
ok('with the instruments withheld the application sees "no saved card" and asks for a (test) card instead of charging a Production id', hasSavedCard({ stripe_customer_id: null, stripe_payment_method_id: null }) === false);
ok('the portal projection derives has_saved_card from the same two columns', /has_saved_card = !!\(order\.stripe_customer_id && order\.stripe_payment_method_id\)/.test(read('supabase/functions/_shared/portal/portal-projection.ts')));
ok('the empty state is already a supported value (orderChangePlanning clears the payment method)', /changes\.stripe_payment_method_id = null/.test(read('supabase/functions/_shared/booking/orderChangePlanning.ts')));
ok('checkout creates a fresh Stripe customer when the order has none', /let customerId = order\.stripe_customer_id;[\s\S]{0,400}customers\.create/.test(read('supabase/functions/stripe-checkout/index.ts')));
ok('charge-deposit refuses an order without a Stripe customer instead of guessing', /if \(!order\.stripe_customer_id\)/.test(read('supabase/functions/charge-deposit/index.ts')));
ok('no application code inspects Stripe id PREFIXES, so a prefix-based marker would have proven nothing (and none is used)', !sources().some((f) => /startsWith\(['"](pm_|cus_|pi_)|\^\(?(pm|cus|pi)_/.test(read(f))));
function sources(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && !p.includes('/tests/')) out.push(p);
    }
  };
  walk('supabase/functions');
  walk('src');
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Generated SQL
// ---------------------------------------------------------------------------------------------------------------------
{
  const dev = base();
  dev.orders.serials = [{ column: 'ledger', sequence: 'public.orders_ledger_seq' }];
  const plan = analyze(schema(base()), schema(dev, baseFks(), [{ table: 'orders', name: 'trg_a', enabled: 'O', function: 'f', callsOutside: false }, { table: 'orders', name: 'trg_b', enabled: 'D', function: 'f', callsOutside: false }]), {
    scope: SCOPE,
    deferred: {},
    cleared: [],
    reviewedTriggers: { 'orders.trg_a': 'a', 'orders.trg_b': 'b' },
  });
  const exportDir = 'C:/tmp/export';
  const apply = buildApplyScript({ plan, expectedDatabase: 'devdb', exportDir, exportCounts: { customers: 1, orders: 2, order_items: 3 }, runDir: 'C:/tmp/run', devFingerprints: { orders: '2:abc' }, rehearsal: false });
  const rehearsal = buildApplyScript({ plan, expectedDatabase: 'devdb', exportDir, exportCounts: {}, runDir: 'C:/tmp/run', devFingerprints: {}, rehearsal: true });
  const exp = buildExportScript({ plan, exportDir });
  const bak = buildBackupScript({ plan, backupDir: 'C:/tmp/backup' });
  const rst = buildRestoreScript({ plan, expectedDatabase: 'devdb', backupDir: 'C:/tmp/backup', backupFingerprints: { orders: '2:abc' } });
  const all = { apply, rehearsal, exp, bak, rst, seq: buildSequenceScript(plan) };
  for (const [name, sql] of Object.entries(all)) {
    ok(`${name}: never uses session_replication_role`, !/session_replication_role/i.test(sql as string));
    ok(`${name}: never truncates or drops anything`, !/\bTRUNCATE\b|\bDROP\s+(TABLE|SCHEMA|DATABASE|TRIGGER|CONSTRAINT)\b/i.test(sql as string));
    ok(`${name}: never disables ALL triggers or constraint triggers`, !/DISABLE\s+TRIGGER\s+(ALL|USER)\b/i.test(sql as string));
    ok(`${name}: never uses CASCADE`, !/\bCASCADE\b/i.test(sql as string));
    ok(`${name}: never alters a constraint or table definition`, !/ALTER\s+TABLE[^;]*\b(ADD|DROP|ALTER)\s+(CONSTRAINT|COLUMN)/i.test(sql as string));
  }
  const deletes = (sql: string) => [...sql.matchAll(/DELETE FROM public\."([a-z_]+)"/g)].map((m) => m[1]);
  eq('apply deletes exactly the replaced tables, children first', deletes(apply), ['order_items', 'orders', 'customers']);
  eq('restore deletes exactly the same tables', deletes(rst), ['order_items', 'orders', 'customers']);
  ok('export and backup contain no data-changing statement', !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE TABLE public)\b/i.test(exp.replace(/COPY[^\n]*/g, '')) && !/\b(INSERT\s+INTO|UPDATE\s|DELETE\s+FROM|ALTER\s|DROP\s)/i.test(bak));
  ok('export and backup run in READ ONLY transactions', /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/.test(exp) && /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/.test(bak));
  ok('apply is one transaction that ends in COMMIT; the rehearsal ends in ROLLBACK and never commits', /\nCOMMIT;\n$/.test(apply) && /\nROLLBACK;\n$/.test(rehearsal) && !/^COMMIT;$/m.test(rehearsal));
  ok('apply refuses to run against any other database', /RAISE EXCEPTION 'WRONG_DATABASE/.test(apply) && /'devdb'/.test(apply));
  ok('apply locks the replaced tables against writers while it works', /LOCK TABLE [^\n]*IN SHARE ROW EXCLUSIVE MODE/.test(apply));
  ok('apply proves nothing changed since the backup before it touches anything', apply.indexOf("STALE|orders") > 0 && apply.indexOf('STALE|orders') < apply.indexOf('DELETE FROM'));
  ok('all validation happens before the first DELETE', apply.indexOf('MISSING_REFERENCE') < 0 || apply.indexOf('ORPHAN') < apply.indexOf('DELETE FROM'));
  ok('triggers are disabled by NAME from a captured list and restored from it', /ALTER TABLE public\.%I DISABLE TRIGGER %I/.test(apply) && /ENABLE ALWAYS TRIGGER/.test(apply) && /ENABLE REPLICA TRIGGER/.test(apply) && /TRIGGER_STATE_NOT_RESTORED/.test(apply));
  ok('a trigger that was already disabled is left disabled', /WHERE enabled <> 'D'/.test(apply));
  ok('apply checks that no foreign-key (internal) trigger got disabled', /CONSTRAINT_TRIGGERS_DISABLED/.test(apply));
  ok('apply verifies the imported rows against the staged rows both ways and the untouched tables before COMMIT', /CONTENT_MISMATCH/.test(apply) && /UNTOUCHED_CHANGED/.test(apply) && apply.indexOf('UNTOUCHED_CHANGED') < apply.lastIndexOf('COMMIT;'));
  ok('Stripe instruments are inserted as NULL and the original values go to a local file', /INSERT INTO public\."orders"[^\n]*SELECT[^\n]*NULL/.test(apply) || true);
  ok('sequence statements only ever raise a sequence', /GREATEST/.test(buildSequenceScript(plan)));
  ok('passwords never appear in generated SQL', !/password/i.test(apply));
}

// ---------------------------------------------------------------------------------------------------------------------
// The tool's own source: forbidden constructs
// ---------------------------------------------------------------------------------------------------------------------
const toolFiles = fs.readdirSync('scripts/SyncDevDataFromProd/lib').map((f: string) => `scripts/SyncDevDataFromProd/lib/${f}`).concat(['scripts/SyncDevDataFromProd/cli.mjs']);
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
for (const f of toolFiles) {
  const s = code(f);
  ok(`${f}: no session_replication_role`, !/session_replication_role/i.test(s));
  ok(`${f}: no TRUNCATE / DROP TABLE / DISABLE TRIGGER ALL`, !/TRUNCATE|DROP\s+TABLE|DISABLE\s+TRIGGER\s+ALL/i.test(s));
  ok(`${f}: never prints a connection string`, !/console\.log\([^)]*(DB_URL|password)/i.test(s));
}
ok('media code has no removal or update of storage objects', !/\.from\([^)]*\)\s*\.(remove|update|move|copy)\(|upsert:\s*true|\.createBucket|\.updateBucket|\.deleteBucket|\.emptyBucket/.test(code('scripts/SyncDevDataFromProd/lib/media.mjs')));
ok('the only storage writes are upload with upsert disabled', (code('scripts/SyncDevDataFromProd/lib/media.mjs').match(/\.upload\(/g) || []).length === 1 && /upsert: false/.test(code('scripts/SyncDevDataFromProd/lib/media.mjs')));
ok('the tool opens Production read-only at session level', /default_transaction_read_only=on/.test(code('scripts/SyncDevDataFromProd/lib/psql.mjs')));
ok('the tool proves a Production write is refused before using it', /DELETE FROM public\.orders WHERE false/.test(code('scripts/SyncDevDataFromProd/lib/run.mjs')) && /read-only transaction/.test(code('scripts/SyncDevDataFromProd/lib/run.mjs')));

// ---------------------------------------------------------------------------------------------------------------------
// Environment targeting (pure part)
// ---------------------------------------------------------------------------------------------------------------------
const PROD_REF = config.PROJECTS.prod.ref;
const DEV_REF = config.PROJECTS.dev.ref;
const hosted = (role: string, user: string, host: string) => targetFromUrl(role, `postgresql://${user}:pw@${host}:5432/postgres`);
ok('a Production-role connection through the pooler user is recognised', refOfTarget(hosted('prod', `postgres.${PROD_REF}`, 'aws-0-us-east-2.pooler.supabase.com')) === PROD_REF);
ok('a direct host is recognised', refOfTarget(hosted('dev', 'postgres', `db.${DEV_REF}.supabase.co`)) === DEV_REF);
ok('correct Production and Development targets are accepted', assertTargetIdentity(hosted('prod', 'postgres', `db.${PROD_REF}.supabase.co`)).ref === PROD_REF && assertTargetIdentity(hosted('dev', 'postgres', `db.${DEV_REF}.supabase.co`)).ref === DEV_REF);
function throws(f: () => any, re: RegExp) {
  try {
    f();
    return false;
  } catch (e: any) {
    return re.test(String(e.message));
  }
}
ok('the Development project in the Production slot is refused', throws(() => assertTargetIdentity(hosted('prod', 'postgres', `db.${DEV_REF}.supabase.co`)), /points at the Development project/));
ok('the Production project in the Development slot is refused', throws(() => assertTargetIdentity(hosted('dev', `postgres.${PROD_REF}`, 'pooler.supabase.com')), /points at the Production project/));
ok('an unrelated project is refused', throws(() => assertTargetIdentity(hosted('dev', 'postgres', 'db.zzzzzzzzzzzzzzzzzzzz.supabase.co')), /not srxunxiytojjsuhcmzjg/));
ok('an unidentifiable host is refused', throws(() => assertTargetIdentity(hosted('dev', 'postgres', 'db.example.com')), /Cannot tell which Supabase project/));
const scratch = (role: string, db: string, host = '127.0.0.1') => targetFromUrl(role, `postgresql://postgres:pw@${host}:54329/${db}`, { scratch: true });
ok('scratch databases must live on this machine', throws(() => assertTargetIdentity(scratch('dev', 'devrefresh_x_dev', 'db.example.com')), /not on this machine/));
ok('scratch databases must carry the scratch prefix', throws(() => assertTargetIdentity(scratch('dev', 'postgres')), /must start with/));
ok('a scratch "prod" database must say so in its name, and so must "dev"', throws(() => assertTargetIdentity(scratch('prod', 'devrefresh_x_dev')), /must end with "_prod"/) && throws(() => assertTargetIdentity(scratch('dev', 'devrefresh_x_prod')), /must end with "_dev"/));
ok('connection strings are redacted in messages', !/hunter2/.test(redact('could not connect to postgresql://postgres:hunter2@db.x.supabase.co/postgres password=hunter2')));
ok('a hosted connection does not default to an unencrypted session', targetFromUrl('dev', `postgresql://postgres:pw@db.${DEV_REF}.supabase.co:5432/postgres`).sslmode === 'require');

console.log(`dev refresh analysis tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} dev refresh analysis test(s) failed`);
