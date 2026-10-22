// Remaining public database access.
//
// Layers:
//   STATIC     parses the migration text and checks what kind of statements it contains (always runs).
//   SOURCE     traces the callers in the application code: who calls each function / touches each table (always runs).
//   EXECUTED   applies the migration inside a rolled-back transaction in a SCRATCH PostgreSQL database that already has the
//              repository migrations replayed, after recreating the live-only Dev state the repository cannot reproduce, and
//              runs scenarios as the real anon / authenticated / service_role roles. It never touches a Supabase project.
//              Same environment variables as the core database access test: CORE_DB_NAME (default "scratch"), CORE_DB_PORT,
//              CORE_DB_HOST, CORE_DB_PSQL. Set CORE_DB_REQUIRE=1 to make a missing scratch database a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/databaseFunctionAccessClassification.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync } = require('child_process');

import {
  SERVER_ONLY, SESSION_HELPERS, INTERNAL_ADMIN_CHECK, CALLER_SCOPED, PUBLIC_API, buildRemainingScenarios, buildRemainingScript,
} from '../support/databaseFunctionAccessClassificationScenarios';

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

const MIGRATION = 'supabase/migrations/20261013120000_restrict_remaining_public_database_access.sql';
const raw = read(MIGRATION);
const sql = stripSql(raw);

// ---------------------------------------------------------------------------------------------------------------
// STATIC
// ---------------------------------------------------------------------------------------------------------------
{
  const files: string[] = fs.readdirSync('supabase/migrations').sort();
  const idx = (n: string) => files.indexOf(n);
  ok('static: the migration sorts after the core database access lockdown', idx('20261013120000_restrict_remaining_public_database_access.sql') > idx('20261012120000_core_database_access_lockdown.sql') && idx('20261012120000_core_database_access_lockdown.sql') >= 0);
  ok('static: no internal coordination label in the migration name or text', !new RegExp(['payment', 'safety'].join('_') + '|payment safety|\\bA[0-9](\\.[0-9])?\\b|\\bPhase\\b|\\bStage\\b', 'i').test('20261013120000_restrict_remaining_public_database_access.sql' + raw));

  ok('static: no schema or data change (the only CREATE is CREATE OR REPLACE FUNCTION for the two number generators; no INSERT / UPDATE / DELETE / DROP / TRUNCATE / sequence change)', !/\b(CREATE\s+(TABLE|POLICY|INDEX|TRIGGER|VIEW|SEQUENCE)|INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|DROP\s+(TABLE|COLUMN|FUNCTION|TRIGGER|SEQUENCE)|TRUNCATE\s+TABLE|ALTER\s+(TABLE|SEQUENCE)|setval)\b/i.test(sql.replace(/REVOKE[^;]*;/gi, ' ')) && (sql.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+[\w.]+/gi) ?? []).map((x) => x.replace(/\s+/g, ' ').toLowerCase()).join() === 'create or replace function public.generate_invoice_number,create or replace function public.generate_receipt_number');
  ok('static: the only function alteration is SECURITY INVOKER', (sql.match(/ALTER FUNCTION[^;]*;/gi) ?? []).every((s) => /SECURITY INVOKER/i.test(s)) && /ALTER FUNCTION/i.test(sql));
  ok('static: no ordinary-user grant is added (grants only to anon/authenticated/service_role on the named public functions)', !/GRANT\s+(ALL|INSERT|UPDATE|DELETE|TRUNCATE|SELECT)\b/i.test(sql));
  ok('static: no money, Stripe, pricing or refund statement', !/\b(refund|deposit|balance|pricing_rules|total_cents|amount_cents)\b/i.test(sql));

  const arr = (name: string): string[] => {
    const m = sql.match(new RegExp(name + '\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]'));
    return m ? [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]) : [];
  };
  const eqSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  ok('static: server_only list in the migration equals the tested list', eqSet(arr('server_only'), SERVER_ONLY) && SERVER_ONLY.length === 8);
  ok('static: session_helpers list in the migration equals the tested list', eqSet(arr('session_helpers'), SESSION_HELPERS));
  ok('static: internal_admin_check list in the migration equals the tested list', eqSet(arr('internal_admin_check'), INTERNAL_ADMIN_CHECK));
  ok('static: caller_scoped list in the migration equals the tested list', eqSet(arr('caller_scoped'), CALLER_SCOPED));
  ok('static: public_api list in the migration equals the tested list', eqSet(arr('public_api'), PUBLIC_API));
  ok('static: no function appears in two lists', new Set([...SERVER_ONLY, ...SESSION_HELPERS, ...INTERNAL_ADMIN_CHECK, ...CALLER_SCOPED, ...PUBLIC_API]).size === SERVER_ONLY.length + SESSION_HELPERS.length + INTERNAL_ADMIN_CHECK.length + CALLER_SCOPED.length + PUBLIC_API.length);
  ok('static: server-only functions keep service_role EXECUTE only', /p\.proname = ANY \(server_only\)[\s\S]*?REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated[\s\S]*?GRANT EXECUTE ON FUNCTION %s TO service_role'/.test(sql));
  ok('static: session helpers, internal-admin-check functions and caller-scoped functions lose PUBLIC and anon but keep authenticated and service_role', /p\.proname = ANY \(session_helpers \|\| internal_admin_check \|\| caller_scoped\)[\s\S]*?REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon'[\s\S]*?GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role'/.test(sql));
  const gen = (name: string) => (sql.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\(\\)[\\s\\S]*?\\n\\$\\$;')) ?? [''])[0];
  const inv = gen('generate_invoice_number');
  const rcp = gen('generate_receipt_number');
  ok('static: both generators reject non-admin callers BEFORE reading or consuming anything', inv.indexOf('public.is_admin()') > 0 && inv.indexOf('public.is_admin()') < inv.indexOf('year_prefix :=') && rcp.indexOf('public.is_admin()') > 0 && rcp.indexOf('public.is_admin()') < rcp.indexOf('nextval'));
  ok('static: the generators allow only Admin / Master, the service role and the database superusers', [inv, rcp].every((f) => /public\.is_admin\(\)/.test(f) && /= 'service_role'/.test(f) && /session_user IN \('postgres', 'supabase_admin'\)/.test(f) && /ERRCODE = '42501'/.test(f)));
  ok('static: the database-superuser allowance applies only when the request carries no API role claim (an API caller cannot use it)', [inv, rcp].every((f) => /= ''\s+AND session_user IN \('postgres', 'supabase_admin'\)/.test(f)));
  ok('static: invoice number format and numbering rule are unchanged', /'INV-' \|\| TO_CHAR\(CURRENT_DATE, 'YYYY'\) \|\| '-'/.test(inv) && /COALESCE\(MAX\(CAST\(SUBSTRING\(invoice_number FROM '\\d\+\$'\) AS integer\)\), 0\) \+ 1/.test(inv) && /LPAD\(next_num::text, 4, '0'\)/.test(inv) && /SET search_path = ''/.test(inv) && !/SECURITY DEFINER/.test(inv));
  ok('static: receipt number format and sequence are unchanged', /nextval\('receipt_number_seq'\)/.test(rcp) && /'RCP-' \|\| to_char\(CURRENT_DATE, 'YYYYMMDD'\) \|\| '-' \|\| LPAD\(next_num::text, 5, '0'\)/.test(rcp) && /SECURITY DEFINER/.test(rcp) && /SET search_path = public/.test(rcp));
  ok('static: public API functions keep anon, authenticated and service_role', /p\.proname = ANY \(public_api\)[\s\S]*?REVOKE ALL ON FUNCTION %s FROM PUBLIC'[\s\S]*?GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role'/.test(sql));
  ok('static: every trigger function loses PUBLIC / anon / authenticated EXECUTE', /prorettype = 'trigger'::regtype[\s\S]*?REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/.test(sql));
  ok('static: get_unresolved_failures_count becomes SECURITY INVOKER', /proname = 'get_unresolved_failures_count'[\s\S]*?ALTER FUNCTION %s SECURITY INVOKER/.test(sql));
  ok('static: stripe_webhook_events loses write policies and anon / authenticated write privileges', /to_regclass\('public\.stripe_webhook_events'\)[\s\S]*?cmd IN \('INSERT', 'UPDATE', 'DELETE', 'ALL'\)[\s\S]*?DROP POLICY %I ON public\.stripe_webhook_events[\s\S]*?REVOKE ALL ON TABLE public\.stripe_webhook_events FROM anon[\s\S]*?REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public\.stripe_webhook_events FROM authenticated/.test(sql));
  ok('static: billing_addresses loses write policies and anon / authenticated write privileges, guarded by to_regclass', /to_regclass\('public\.billing_addresses'\)[\s\S]*?DROP POLICY %I ON public\.billing_addresses[\s\S]*?REVOKE ALL ON TABLE public\.billing_addresses FROM anon[\s\S]*?REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public\.billing_addresses FROM authenticated/.test(sql));
  ok('static: the Admin read policies are not dropped (only INSERT / UPDATE / DELETE / ALL policies)', !/cmd IN \([^)]*'SELECT'/.test(sql));
}

// ---------------------------------------------------------------------------------------------------------------
// SOURCE - caller trace
// ---------------------------------------------------------------------------------------------------------------
{
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = dir + '/' + e.name;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f, out); }
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(f);
    }
    return out;
  };
  const isTestish = (f: string) => /\.test\.ts$|Scenarios\.ts$|database\.types\.ts$/.test(f);
  const browser = walk('src').filter((f) => !isTestish(f));
  const edge = walk('supabase/functions').filter((f) => !isTestish(f));
  const rpcRe = (name: string) => new RegExp('\\.rpc\\(\\s*[\'"`]' + name + '[\'"`]');
  const withRpc = (files: string[], name: string) => files.filter((f) => rpcRe(name).test(read(f)));

  for (const f of SERVER_ONLY) {
    ok(`source: no browser code calls the server-only function ${f}`, withRpc(browser, f).length === 0);
  }
  const SERVER_CALLERS = ['supabase/functions/send-email/index.ts', 'supabase/functions/send-sms-notification/index.ts', 'supabase/functions/submit-contact-inquiry/index.ts', 'supabase/functions/_shared/rate-limit.ts'];
  ok('source: server-only functions are called only from the send-email, send-sms-notification, submit-contact-inquiry and rate-limit modules', SERVER_ONLY.every((f) => withRpc(edge, f).every((p) => SERVER_CALLERS.includes(p))));
  for (const file of SERVER_CALLERS) {
    const t = read(file);
    ok(`source: ${file} calls its server-only RPCs only through a service-role client (never the anon key or a forwarded user token)`, /SUPABASE_SERVICE_ROLE_KEY/.test(t) && !/SUPABASE_ANON_KEY/.test(t) && !/global:\s*\{\s*headers/.test(t));
  }
  ok('source: the Admin notification screen is the only caller of get_unresolved_failures_count (through the notification module)', withRpc(browser, 'get_unresolved_failures_count').join() === 'src/lib/notifications/notificationFailures.ts' && browser.filter((f) => /notificationFailures'/.test(read(f))).join() === 'src/components/admin/settings/NotificationFailuresAlert.tsx');
  ok('source: the browser notification module no longer records failures or successes', !/\.rpc\(\s*['"`]record_notification_(failure|success)/.test(read('src/lib/notifications/notificationFailures.ts')));

  const staff = /^src\/(components\/admin\/|hooks\/admin\/useAdminAnalytics|lib\/orders\/orderApprovalService|lib\/queries\/products|components\/admin\/content\/photos\/)/;
  for (const [fn, who] of [['get_all_role_users', staff], ['assign_role_by_email', staff], ['get_booking_source_analytics', staff], ['get_delivery_timing_analytics', staff], ['save_inventory_product_v2', staff], ['save_product_bundle_v2', staff], ['generate_invoice_number', staff]] as Array<[string, RegExp]>) {
    const callers = withRpc(browser, fn);
    ok(`source: ${fn} is called only from Admin / staff screens (${callers.length} caller${callers.length === 1 ? '' : 's'})`, callers.length >= 1 && callers.every((c) => who.test(c)));
  }
  ok('source: the public availability and settings functions are called from the public site', withRpc(browser, 'check_date_blackout').includes('src/lib/booking/availability.ts') && /rpc as any\)\(\s*['"`]get_public_business_settings/.test(read('src/lib/core/adminSettingsCache.ts')) && withRpc(browser, 'get_public_nav_menu_groups').length === 1);
  ok('source: no application code calls the receipt-number or receipt-group generators as an RPC (number is a column default; the group id is crypto.randomUUID())', withRpc([...browser, ...edge], 'generate_receipt_number').length === 0 && withRpc([...browser, ...edge], 'generate_receipt_group_id').length === 0);
  // The deposit / tip receipts are now written by the server (post-payment completion). The browser service that used to write them is no
  // longer imported by any screen; it must stay confined to that one file and never be wired back into approval code.
  ok('source: the browser writes transaction_receipts only through transactionReceiptService, which no screen or service imports any more (the server writes the receipts)', browser.filter((f) => /\.from\(\s*['"`]transaction_receipts['"`]/.test(read(f))).join() === 'src/lib/payments/transactionReceiptService.ts' && browser.filter((f) => /transactionReceiptService'/.test(read(f))).length === 0);
  ok('source: the invoice-number RPC is called from the Admin invoice list in the browser and, for approved deposits, only by the server-side post-payment completion', withRpc(browser, 'generate_invoice_number').every((f) => f === 'src/components/admin/invoices/InvoicesList.tsx') && withRpc(edge, 'generate_invoice_number').join() === 'supabase/functions/_shared/payments/post-payment.ts');
  ok('source: the order-prefix lookup is called only from the Admin single-order view', withRpc(browser, 'find_order_id_by_prefix').join() === 'src/components/admin/orders/SingleOrderView.tsx');
  ok('source: get_user_role is never called from the browser, and every Edge caller passes the caller\'s own id', withRpc(browser, 'get_user_role').length === 0 && ['promote-media', 'upload-physical-waiver'].every((fn) => /get_user_role[\s\S]{0,80}user_id_input:\s*(user\.id|userData\.user\.id|uploaderUserId)/.test(read(`supabase/functions/${fn}/index.ts`))));
  ok('source: nothing calls the unused role-mutation functions', withRpc([...browser, ...edge], 'assign_user_role').length === 0 && withRpc([...browser, ...edge], 'remove_user_role').length === 0);
  ok('source: nothing calls user_has_role / get_user_highest_role', withRpc([...browser, ...edge], 'user_has_role').length === 0 && withRpc([...browser, ...edge], 'get_user_highest_role').length === 0);

  // Tables
  const billing = ['billing', 'addresses'].join('_');
  const refs = (name: string) => [...browser, ...edge].filter((f) => read(f).includes(name));
  ok('source: no application code reads or writes the billing addresses table', refs(billing).length === 0);
  const migrationsMentioningBilling = fs.readdirSync('supabase/migrations').filter((f: string) => read('supabase/migrations/' + f).includes(billing) && f !== '20261013120000_restrict_remaining_public_database_access.sql');
  // Recovered migration 20260501173826 (Production history, recovered in Step 2) is the ONLY file that creates the table; 20261013 restricts it.
  const BILLING_CREATOR = '20260501173826_add_billing_addresses_table.sql';
  ok('source: exactly one earlier migration (the recovered one) creates the billing addresses table, and no other migration but the restriction mentions it', JSON.stringify(migrationsMentioningBilling) === JSON.stringify([BILLING_CREATOR]) && /CREATE TABLE IF NOT EXISTS (public\.)?billing_addresses|CREATE TABLE (public\.)?billing_addresses/i.test(read('supabase/migrations/' + BILLING_CREATOR)));
  ok('source: the restriction migration drops the anonymous and authenticated write policies on the billing addresses table', /billing_addresses/.test(read('supabase/migrations/20261013120000_restrict_remaining_public_database_access.sql')));
  const hook = ['stripe', 'webhook', 'events'].join('_');
  ok('source: the Stripe webhook event table is touched only by the webhook idempotency module', refs(hook).join() === 'supabase/functions/_shared/payments/webhook-idempotency.ts');
  const wh = read('supabase/functions/stripe-webhook/index.ts');
  ok('source: the webhook handler passes a service-role client to the idempotency module', /createClient\(\s*Deno\.env\.get\(["']SUPABASE_URL["']\)[^)]*SUPABASE_SERVICE_ROLE_KEY/.test(wh) && /beginWebhookProcessing\(\s*supabaseClient/.test(wh) && /await stripe\.webhooks\.constructEventAsync\([^)]*createSubtleCryptoProvider\(\)\)/.test(wh) && !/webhooks\.constructEvent\(/.test(wh));
  ok('source: the idempotency module skips an event whose stored status is succeeded (why anonymous inserts had to go)', /existing\.status === 'succeeded'[\s\S]*?shouldProcess: false/.test(read('supabase/functions/_shared/payments/webhook-idempotency.ts')));
}

// ---------------------------------------------------------------------------------------------------------------
// EXECUTED
// ---------------------------------------------------------------------------------------------------------------
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
    if (process.env.CORE_DB_REQUIRE) ok('executed: a scratch database with the repository migrations replayed (and without the new migration) is available (CORE_DB_REQUIRE is set)', false);
    else console.log('EXECUTED layer SKIPPED: no scratch PostgreSQL database with the repository migrations replayed was reachable (see the header of this file).');
  } else {
    const scenarios = buildRemainingScenarios();
    const r = spawnSync(psql, [...args, '-v', 'ON_ERROR_STOP=1'], { input: buildRemainingScript(scenarios, raw), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 120000 });
    const results: Record<number, string> = {};
    for (const m of ((r.stderr ?? '') + (r.stdout ?? '')).matchAll(/R\|(\d+)\|(.*)/g)) results[Number(m[1])] = m[2].trim();
    ok(`executed: the scenario script ran to completion in database "${db}" (${Object.keys(results).length}/${scenarios.length} results)`, Object.keys(results).length === scenarios.length);
    if (Object.keys(results).length !== scenarios.length) console.error((r.stderr ?? '').split('\n').filter((l: string) => /ERROR|LINE|DETAIL/.test(l)).slice(0, 6).join('\n'));
    scenarios.forEach((sc, i) => {
      const got = results[i];
      const good = typeof sc.expect === 'string' ? got === sc.expect : sc.expect(got);
      ok(`executed: ${sc.name} (got ${got})`, good);
    });
  }
}

console.log(`Remaining public database access tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} remaining public database access test(s) failed`);
