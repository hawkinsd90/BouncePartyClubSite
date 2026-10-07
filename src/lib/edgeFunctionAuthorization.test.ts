// Handler-level authorization tests for the Payment Safety A1 Edge Functions.
//
// The Edge Functions are Deno modules (npm:/jsr: imports, Deno.serve), so each test loads the CURRENT source text,
// strips its import lines, transpiles the TypeScript, and runs it with fakes for Deno, createClient, Stripe and the
// shared helpers. The real shared auth helpers (supabase/functions/_shared/auth.ts and lifecycle-outcome.ts) are
// injected, so these tests exercise the actual authorization code paths. Nothing here touches a network, a database
// or real Stripe: the fake Supabase client is an in-memory table store that records every write, and the fake Stripe
// records every call.
//
// Actors: anonymous (public anon key only), customer owner (signed in), other customer, crew, admin, master,
// service role. Proofs: invoice link token (per order), Stripe Checkout session (per order).

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');

import * as authHelpers from '../../supabase/functions/_shared/auth';
import * as portalLinkHelpers from '../../supabase/functions/_shared/portal-link';
import * as outcomeHelpers from '../../supabase/functions/_shared/lifecycle-outcome';

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

const SERVICE_KEY = 'svc-key-0123456789abcdef';
const ANON_KEY = 'anon-key-0123456789abcdef';
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();
const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);
const TOKEN_EXPIRED = 'e'.repeat(64);
const TOKEN_INV = 'c'.repeat(64);
const SECRETS = [SERVICE_KEY, ANON_KEY, TOKEN_A, TOKEN_B, TOKEN_EXPIRED, 'jwt-master', 'jwt-admin', 'jwt-crew', 'jwt-cust', 'jwt-other'];

// ---------------------------------------------------------------------------------------------------------------
// World: an in-memory database and fake Stripe
// ---------------------------------------------------------------------------------------------------------------
function makeWorld() {
  const order = (id: string, customerId: string, extra: Record<string, unknown> = {}) => ({
    id,
    customer_id: customerId,
    status: 'pending_review',
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    event_date: '2030-06-01',
    deposit_due_cents: 5000,
    deposit_paid_cents: 0,
    balance_due_cents: 10000,
    balance_paid_cents: 0,
    tip_cents: 0,
    stripe_customer_id: null,
    stripe_payment_method_id: null,
    confirmed_admin_alerted: false,
    pending_review_admin_alerted: false,
    subtotal_cents: 15000,
    customers: { first_name: 'Pat', last_name: 'Lee', email: 'pat@example.com', phone: '+15555550100' },
    addresses: { line1: '1 Main', city: 'Town', state: 'MI', zip: '48000' },
    order_items: [],
    order_custom_fees: [],
    order_discounts: [],
    ...extra,
  });
  return {
    tables: {
      user_roles: [
        { user_id: 'u-master', role: 'master' },
        { user_id: 'u-admin', role: 'admin' },
        { user_id: 'u-crew', role: 'crew' },
        { user_id: 'u-cust', role: 'customer' },
        { user_id: 'u-other', role: 'customer' },
      ] as any[],
      orders: [
        order('order-A', 'cust-A'),
        order('order-B', 'cust-B'),
        order('order-paid', 'cust-A', { deposit_paid_cents: 5000 }),
        order('order-draft', 'cust-A', { status: 'draft' }),
        order('order-inprogress', 'cust-A', { status: 'in_progress' }),
        order('order-nocard', 'cust-A', { status: 'confirmed', balance_due_cents: 10000, stripe_payment_method_id: null }),
        // Fresh booking draft (a brand-new booking request: draft, nothing attached, created 10 minutes ago).
        order('order-fresh', 'cust-F', { status: 'draft' }),
        order('order-fresh2', 'cust-F', { status: 'draft' }),
        // Drafts that must NOT qualify as a fresh public booking.
        order('order-stale-draft', 'cust-F', { status: 'draft', created_at: new Date(Date.now() - 3 * 3_600_000).toISOString() }),
        order('order-draft-hascustomer', 'cust-F', { status: 'draft', stripe_customer_id: 'cus_existing' }),
        order('order-draft-haspm', 'cust-F', { status: 'draft', stripe_payment_method_id: 'pm_existing' }),
        order('order-invoice-draft', 'cust-F', { status: 'draft' }),
      ] as any[],
      customers: [
        { id: 'cust-A', user_id: 'u-cust', email: 'pat@example.com' },
        { id: 'cust-B', user_id: 'u-other', email: 'other@example.com' },
        { id: 'cust-F', user_id: null, email: 'fresh@example.com' },
      ] as any[],
      invoice_links: [
        { link_token: TOKEN_A, order_id: 'order-A', link_type: 'invoice', expires_at: FUTURE },
        { link_token: TOKEN_A, order_id: 'order-paid', link_type: 'invoice', expires_at: FUTURE },
        { link_token: TOKEN_A, order_id: 'order-draft', link_type: 'invoice', expires_at: FUTURE },
        { link_token: TOKEN_A, order_id: 'order-inprogress', link_type: 'invoice', expires_at: FUTURE },
        { link_token: TOKEN_A, order_id: 'order-nocard', link_type: 'invoice', expires_at: FUTURE },
        { link_token: TOKEN_B, order_id: 'order-B', link_type: 'invoice', expires_at: FUTURE },
        { link_token: TOKEN_EXPIRED, order_id: 'order-A', link_type: 'invoice', expires_at: PAST },
        { link_token: TOKEN_INV, order_id: 'order-invoice-draft', link_type: 'invoice', expires_at: FUTURE },
      ] as any[],
      admin_settings: [{ key: 'stripe_secret_key', value: 'sk_test_fake' }] as any[],
      order_changelog: [] as any[],
      task_status: [] as any[],
      payments: [] as any[],
    } as Record<string, any[]>,
    users: { 'jwt-master': 'u-master', 'jwt-admin': 'u-admin', 'jwt-crew': 'u-crew', 'jwt-cust': 'u-cust', 'jwt-other': 'u-other' } as Record<string, string>,
    sessions: {
      sess_A: { status: 'complete', mode: 'setup', metadata: { order_id: 'order-A' }, customer: 'cus_A', setup_intent: 'seti_A' },
      sess_B: { status: 'complete', mode: 'setup', metadata: { order_id: 'order-B' }, customer: 'cus_B', setup_intent: 'seti_B' },
      sess_open: { status: 'open', mode: 'setup', metadata: { order_id: 'order-A' }, customer: 'cus_A' },
      sess_A_otherCustomer: { status: 'complete', mode: 'setup', metadata: { order_id: 'order-A' }, customer: 'cus_ATTACKER', setup_intent: 'seti_X' },
    } as Record<string, any>,
    log: [] as any[],
    stripeCalls: [] as Array<{ api: string; args: any }>,
    invokes: [] as any[],
    consoleLines: [] as string[],
  };
}
type World = ReturnType<typeof makeWorld>;

function makeClient(w: World) {
  const from = (table: string) => {
    const q: any = { table, op: 'select', filters: [] as any[], payload: null };
    const rowsFor = () => (w.tables[table] ?? []).filter((r) => q.filters.every(([k, c, v]: any) => (k === 'eq' ? r[c] === v : k === 'in' ? (v as any[]).includes(r[c]) : true)));
    const exec = (single: boolean, required: boolean) => {
      if (q.op === 'select') {
        const rows = rowsFor();
        if (single) return { data: rows[0] ?? null, error: required && !rows[0] ? { message: 'not found' } : null };
        return { data: rows, error: null };
      }
      if (q.op === 'update') {
        w.log.push({ table, op: 'update', payload: q.payload, filters: q.filters.map((f: any) => f.slice(1)) });
        rowsFor().forEach((r) => Object.assign(r, q.payload));
        return { data: null, error: null };
      }
      if (q.op === 'insert') {
        w.log.push({ table, op: 'insert', payload: q.payload });
        (w.tables[table] ??= []).push(q.payload);
        return { data: null, error: null };
      }
      if (q.op === 'delete') {
        w.log.push({ table, op: 'delete', filters: q.filters.map((f: any) => f.slice(1)) });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };
    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => (q.filters.push(['eq', c, v]), api),
      neq: () => api,
      not: () => api,
      in: (c: string, v: unknown[]) => (q.filters.push(['in', c, v]), api),
      is: () => api,
      order: () => api,
      limit: () => api,
      update: (p: unknown) => ((q.op = 'update'), (q.payload = p), api),
      insert: (p: unknown) => ((q.op = 'insert'), (q.payload = p), api),
      delete: () => ((q.op = 'delete'), api),
      single: async () => exec(true, true),
      maybeSingle: async () => exec(true, false),
      then: (resolve: any, reject: any) => Promise.resolve(exec(false, false)).then(resolve, reject),
    };
    return api;
  };
  return {
    from,
    rpc: (name: string, args: unknown) => {
      w.log.push({ op: 'rpc', name, args });
      const res = { data: null, error: null };
      const p: any = Promise.resolve(res);
      p.maybeSingle = async () => res;
      return p;
    },
    functions: {
      invoke: async (name: string, opts: unknown) => {
        w.invokes.push({ name, opts });
        return { data: { success: true }, error: null };
      },
    },
    auth: {
      getUser: async (token: string) => {
        const id = w.users[token];
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid jwt' } };
      },
    },
  };
}

function makeStripeClass(w: World) {
  return class FakeStripe {
    constructor() {
      w.stripeCalls.push({ api: 'constructor', args: null });
    }
    checkout = {
      sessions: {
        retrieve: async (id: string) => {
          w.stripeCalls.push({ api: 'checkout.sessions.retrieve', args: id });
          if (!w.sessions[id]) throw new Error('No such checkout.session');
          return w.sessions[id];
        },
        create: async (params: unknown) => {
          w.stripeCalls.push({ api: 'checkout.sessions.create', args: params });
          const id = `cs_new_${w.stripeCalls.length}`;
          w.sessions[id] = { status: 'open', mode: (params as any).mode, metadata: (params as any).metadata, customer: (params as any).customer };
          return { id, url: 'https://checkout.example/x' };
        },
      },
    };
    paymentIntents = {
      create: async (params: unknown) => {
        w.stripeCalls.push({ api: 'paymentIntents.create', args: params });
        return { id: 'pi_1', status: 'succeeded' };
      },
    };
    customers = {
      create: async (params: unknown) => {
        w.stripeCalls.push({ api: 'customers.create', args: params });
        return { id: 'cus_new' };
      },
    };
    setupIntents = {
      retrieve: async (id: string) => {
        w.stripeCalls.push({ api: 'setupIntents.retrieve', args: id });
        return { payment_method: `pm_for_${id}` };
      },
    };
    paymentMethods = {
      retrieve: async (id: string) => {
        w.stripeCalls.push({ api: 'paymentMethods.retrieve', args: id });
        return { card: { brand: 'visa', last4: '4242' } };
      },
    };
  };
}

// Load an Edge Function's current source and capture its Deno.serve handler.
function loadHandler(fnDir: string, w: World): (req: Request) => Promise<Response> {
  const src: string = fs.readFileSync(`supabase/functions/${fnDir}/index.ts`, 'utf8');
  const stripped = src.replace(/^import[^;]*;/gm, '');
  const js: string = ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;

  let captured: ((req: Request) => Promise<Response>) | null = null;
  const env: Record<string, string> = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => env[k] }, serve: (h: any) => { captured = h; } },
    createClient: () => makeClient(w),
    Stripe: makeStripeClass(w),
    console: {
      log: (...a: unknown[]) => w.consoleLines.push(a.map(String).join(' ')),
      warn: (...a: unknown[]) => w.consoleLines.push(a.map(String).join(' ')),
      error: (...a: unknown[]) => w.consoleLines.push(a.map(String).join(' ')),
      info: () => {},
      debug: () => {},
    },
    fetch: async (url: string, init: any) => {
      w.invokes.push({ name: `fetch:${url}`, opts: init });
      return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '' };
    },
    ...authHelpers,
    ...portalLinkHelpers,
    ...outcomeHelpers,
    corsHeaders: { 'Access-Control-Allow-Origin': '*' },
    checkRateLimit: async () => ({ allowed: true }),
    createRateLimitResponse: () => new Response('rate limited', { status: 429 }),
    getIdentifier: () => '203.0.113.9',
    buildRateLimitKey: (...a: unknown[]) => a.join(':'),
    validatePaymentMethod: async () => ({ valid: true }),
    formatCurrency: (c: number) => `$${((c ?? 0) / 100).toFixed(2)}`,
    formatPaymentMethodLabel: () => 'Visa 4242',
    formatOrderId: (id: string) => String(id).slice(0, 8),
    logTransaction: async () => {},
    DEFAULT_PHONE: '555-0100',
    buildPaymentReceiptEmail: () => '',
  };
  // Bind only the identifiers the function actually imports (plus the runtime globals), so injected names never
  // collide with the function's own top-level declarations (for example its local corsHeaders).
  const imported = new Set<string>();
  for (const m of src.matchAll(/^import([^;]*);/gm)) {
    for (const id of m[1].replace(/from\s+['"][^'"]*['"]/, '').match(/[A-Za-z_$][\w$]*/g) ?? []) imported.add(id);
  }
  const names = Object.keys(scope).filter((n) => ['Deno', 'console', 'fetch'].includes(n) || imported.has(n));
  new Function(...names, js)(...names.map((n) => scope[n]));
  if (!captured) throw new Error(`${fnDir}: Deno.serve was not called`);
  return captured;
}

interface CallOptions {
  bearer?: string | null;
  body: Record<string, unknown>;
  mutate?: (w: World) => void;
  // Run against an existing world (for multi-step flows such as the proof chain).
  world?: World;
}
async function call(fnDir: string, opts: CallOptions) {
  const w = opts.world ?? makeWorld();
  opts.mutate?.(w);
  const handler = loadHandler(fnDir, w);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer !== null) headers.Authorization = `Bearer ${opts.bearer ?? ANON_KEY}`;
  const res = await handler(new Request('https://fake.functions/x', { method: 'POST', headers, body: JSON.stringify(opts.body) }));
  let json: any = null;
  try {
    json = await res.clone().json();
  } catch {
    json = null;
  }
  return { status: res.status, json, w };
}
const wrote = (w: World, table: string, pred: (e: any) => boolean = () => true) => w.log.some((e) => e.table === table && e.op !== 'select' && pred(e));
const stripeUsed = (w: World, api: string) => w.stripeCalls.some((c) => c.api === api);
const isDenied = (status: number) => status === 401 || status === 403;

(async () => {
  const allWorlds: World[] = [];
  const track = <T extends { w: World }>(r: T): T => (allWorlds.push(r.w), r);

  // ===========================================================================================================
  // order-lifecycle
  // ===========================================================================================================
  const LC = 'order-lifecycle';
  const confirm = (orderId: string, extra: Record<string, unknown> = {}) => ({ action: 'enter_confirmed', orderId, source: 'test', paymentOutcome: 'waived', ...extra });

  let r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-A') }));
  eq('lifecycle: anon + UUID + claimed "waived" is rejected (401)', r.status, 401);
  ok('lifecycle: anon rejection wrote nothing', !wrote(r.w, 'orders') && !wrote(r.w, 'order_changelog'));

  r = track(await call(LC, { bearer: null, body: confirm('order-A') }));
  eq('lifecycle: no Authorization header at all is rejected (401)', r.status, 401);

  for (const outcome of ['waived', 'already_paid', 'cash', 'charged_now']) {
    r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-A', { paymentOutcome: outcome }) }));
    ok(`lifecycle: anon cannot confirm by claiming "${outcome}"`, r.status === 401 && !wrote(r.w, 'orders'));
  }

  r = track(await call(LC, { bearer: 'jwt-crew', body: confirm('order-A') }));
  eq('lifecycle: crew with no order proof is rejected (403)', r.status, 403);

  r = track(await call(LC, { bearer: 'jwt-other', body: confirm('order-A') }));
  eq('lifecycle: a different customer is rejected (403)', r.status, 403);

  r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-B', { invoiceToken: TOKEN_A }) }));
  ok('lifecycle: Order A token cannot confirm Order B (cross-order)', r.status === 401 && !wrote(r.w, 'orders'));

  r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-A', { invoiceToken: TOKEN_EXPIRED }) }));
  ok('lifecycle: expired token is rejected', r.status === 401 && !wrote(r.w, 'orders'));

  // Customer proof, unpaid deposit: the claimed "waived" must not confirm the order.
  r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-A', { invoiceToken: TOKEN_A }) }));
  ok('lifecycle: valid token + unpaid deposit + claimed "waived" does NOT confirm', r.status === 400 && r.json?.success === false && /not been collected/.test(r.json?.error ?? ''));
  ok('lifecycle: no status write on the rejected customer confirm', !wrote(r.w, 'orders', (e) => e.payload?.status === 'confirmed'));

  for (const outcome of ['already_paid', 'charged_now', 'cash']) {
    r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-A', { invoiceToken: TOKEN_A, paymentOutcome: outcome }) }));
    ok(`lifecycle: token holder claiming "${outcome}" on an unpaid order does NOT confirm`, r.status === 400 && !wrote(r.w, 'orders', (e) => e.payload?.status === 'confirmed'));
  }

  // Customer proof, deposit genuinely collected: confirmation proceeds and the outcome label comes from state.
  r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-paid', { invoiceToken: TOKEN_A, paymentOutcome: 'waived' }) }));
  ok('lifecycle: token + deposit already collected confirms', r.status === 200 && r.json?.success === true);
  ok('lifecycle: the changelog outcome is derived from state (already_paid), not the claim (waived)', r.w.log.some((e) => e.table === 'order_changelog' && /payment: already_paid/.test(e.payload?.notes ?? '')));

  r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-paid', { invoiceToken: TOKEN_B }) }));
  ok('lifecycle: Order B token cannot confirm Order "paid" either', r.status === 401);

  // Owner proof
  r = track(await call(LC, { bearer: 'jwt-cust', body: confirm('order-paid', { paymentOutcome: 'already_paid' }) }));
  ok('lifecycle: signed-in owner with collected deposit confirms', r.status === 200 && r.json?.success === true);
  r = track(await call(LC, { bearer: 'jwt-cust', body: confirm('order-A', { paymentOutcome: 'waived' }) }));
  ok('lifecycle: signed-in owner cannot self-waive an unpaid deposit', r.status === 400 && !wrote(r.w, 'orders', (e) => e.payload?.status === 'confirmed'));

  // Zero deposit (waived / zero_due_with_card) is allowed with proof
  r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-A', { invoiceToken: TOKEN_A, paymentOutcome: 'waived' }), mutate: (w) => { w.tables.orders.find((o) => o.id === 'order-A').deposit_due_cents = 0; } }));
  ok('lifecycle: token + zero deposit confirms (no-card invoice)', r.status === 200 && r.json?.success === true);

  // Staff and service callers keep choosing the outcome
  r = track(await call(LC, { bearer: 'jwt-master', body: confirm('order-A', { paymentOutcome: 'waived' }) }));
  ok('lifecycle: master can confirm with "waived" (admin zero-deposit / force approve)', r.status === 200 && r.json?.success === true);
  r = track(await call(LC, { bearer: 'jwt-admin', body: confirm('order-A', { paymentOutcome: 'waived' }) }));
  ok('lifecycle: admin role can confirm with "waived"', r.status === 200 && r.json?.success === true);
  r = track(await call(LC, { bearer: SERVICE_KEY, body: confirm('order-A', { paymentOutcome: 'charged_now' }) }));
  ok('lifecycle: the service-role key (charge-deposit, webhook) can confirm', r.status === 200 && r.json?.success === true);

  // enter_pending_review requires a Stripe session proof
  const pending = (orderId: string, extra: Record<string, unknown> = {}) => ({ action: 'enter_pending_review', orderId, source: 'test', ...extra });
  r = track(await call(LC, { bearer: ANON_KEY, body: pending('order-draft') }));
  ok('lifecycle: anon cannot move a draft to pending_review', r.status === 401 && !wrote(r.w, 'orders'));
  r = track(await call(LC, { bearer: ANON_KEY, body: pending('order-draft', { invoiceToken: TOKEN_A }) }));
  ok('lifecycle: an invoice token alone does not authorize pending_review', r.status === 401 && !wrote(r.w, 'orders'));
  r = track(await call(LC, { bearer: ANON_KEY, body: pending('order-draft', { sessionId: 'sess_B' }) }));
  ok('lifecycle: a session for Order B cannot move Order draft (cross-order)', r.status === 401 && !wrote(r.w, 'orders'));
  r = track(await call(LC, { bearer: ANON_KEY, body: pending('order-draft', { sessionId: 'sess_open' }) }));
  ok('lifecycle: an incomplete session is not proof', r.status === 401);
  r = track(await call(LC, { bearer: ANON_KEY, body: pending('order-draft', { sessionId: 'sess_missing' }) }));
  ok('lifecycle: an unknown session is not proof', r.status === 401);
  r = track(await call(LC, {
    bearer: ANON_KEY,
    body: pending('order-draft', { sessionId: 'sess_A' }),
    mutate: (w) => { w.sessions.sess_A.metadata.order_id = 'order-draft'; },
  }));
  ok('lifecycle: a completed session for this order moves draft to pending_review', r.status === 200 && wrote(r.w, 'orders', (e) => e.payload?.status === 'pending_review'));
  r = track(await call(LC, { bearer: 'jwt-master', body: pending('order-draft') }));
  ok('lifecycle: master can enter pending_review without a session', r.status === 200);

  // ===========================================================================================================
  // charge-deposit
  // ===========================================================================================================
  const CD = 'charge-deposit';
  const charge = (orderId: string, extra: Record<string, unknown> = {}) => ({ orderId, ...extra });
  const noCharge = (x: { w: World }) => !stripeUsed(x.w, 'paymentIntents.create') && !wrote(x.w, 'orders') && !wrote(x.w, 'payments');

  r = track(await call(CD, { bearer: ANON_KEY, body: charge('order-A') }));
  ok('charge-deposit: anon key + UUID cannot charge (401), no Stripe call', r.status === 401 && noCharge(r) && !stripeUsed(r.w, 'constructor'));
  r = track(await call(CD, { bearer: null, body: charge('order-A') }));
  eq('charge-deposit: no Authorization header (401)', r.status, 401);
  r = track(await call(CD, { bearer: 'jwt-crew', body: charge('order-A', { paymentAmountCents: 5000, selectedPaymentType: 'balance' }) }));
  ok('charge-deposit: crew cannot charge a card (403)', r.status === 403 && noCharge(r));
  r = track(await call(CD, { bearer: 'jwt-crew', body: charge('order-A') }));
  ok('charge-deposit: crew with no order proof cannot run a deposit charge (403)', r.status === 403 && noCharge(r));
  r = track(await call(CD, { bearer: 'jwt-other', body: charge('order-A') }));
  ok('charge-deposit: another customer cannot charge Order A (403)', r.status === 403 && noCharge(r));
  r = track(await call(CD, { bearer: ANON_KEY, body: charge('order-B', { invoiceToken: TOKEN_A }) }));
  ok('charge-deposit: Order A token cannot charge Order B (cross-order)', isDenied(r.status) && noCharge(r));
  r = track(await call(CD, { bearer: ANON_KEY, body: charge('order-A', { invoiceToken: TOKEN_EXPIRED }) }));
  ok('charge-deposit: expired token cannot charge', isDenied(r.status) && noCharge(r));
  r = track(await call(CD, { bearer: ANON_KEY, body: charge('order-B', { sessionId: 'sess_A' }) }));
  ok('charge-deposit: Order A Stripe session cannot charge Order B (cross-order)', isDenied(r.status) && noCharge(r));
  r = track(await call(CD, { bearer: ANON_KEY, body: charge('order-A', { sessionId: 'sess_open' }) }));
  ok('charge-deposit: an incomplete session cannot charge', isDenied(r.status) && noCharge(r));
  r = track(await call(CD, { bearer: ANON_KEY, body: charge('order-A', { invoiceToken: TOKEN_A, paymentAmountCents: 5000, selectedPaymentType: 'balance' }) }));
  ok('charge-deposit: a token holder cannot run a balance charge', isDenied(r.status) && noCharge(r));

  // Allowed callers pass the gate (the fake world has no usable order row for the rest of the flow, so the
  // handler stops later; reaching the Stripe-key lookup proves the gate allowed the request).
  const passedGate = (x: { status: number; w: World }) => !isDenied(x.status) && !x.w.consoleLines.some((l) => /rejected:/.test(l));
  r = track(await call(CD, { bearer: 'jwt-master', body: charge('order-A') }));
  ok('charge-deposit: master passes the authorization gate', passedGate(r));
  r = track(await call(CD, { bearer: 'jwt-admin', body: charge('order-A') }));
  ok('charge-deposit: admin passes the authorization gate', passedGate(r));
  r = track(await call(CD, { bearer: ANON_KEY, body: charge('order-A', { invoiceToken: TOKEN_A }) }));
  ok('charge-deposit: a valid order token passes the gate', passedGate(r));
  r = track(await call(CD, { bearer: 'jwt-cust', body: charge('order-A') }));
  ok('charge-deposit: the signed-in owner passes the gate', passedGate(r));
  r = track(await call(CD, { bearer: ANON_KEY, body: charge('order-A', { sessionId: 'sess_A' }) }));
  ok('charge-deposit: a completed session for this order passes the gate', passedGate(r));
  r = track(await call(CD, { bearer: 'jwt-master', body: charge('order-A', { paymentAmountCents: 3000, selectedPaymentType: 'balance' }) }));
  ok('charge-deposit: admin balance charge passes the gate', passedGate(r));

  // ===========================================================================================================
  // customer-balance-payment
  // ===========================================================================================================
  const CB = 'customer-balance-payment';
  const pay = (orderId: string, amountCents: number, extra: Record<string, unknown> = {}) => ({ orderId, amountCents, tipCents: 0, ...extra });
  const noPayment = (x: { w: World }) => !stripeUsed(x.w, 'paymentIntents.create') && !stripeUsed(x.w, 'checkout.sessions.create') && !wrote(x.w, 'orders') && !wrote(x.w, 'payments');

  r = track(await call(CB, { bearer: ANON_KEY, body: pay('order-A', 10000) }));
  ok('balance: anon key + UUID cannot charge the saved card (401)', r.status === 401 && noPayment(r));
  r = track(await call(CB, { bearer: null, body: pay('order-A', 10000) }));
  ok('balance: no Authorization header (401)', r.status === 401 && noPayment(r));
  r = track(await call(CB, { bearer: ANON_KEY, body: pay('order-B', 10000, { invoiceToken: TOKEN_A }) }));
  ok('balance: Order A token cannot pay Order B (cross-order)', isDenied(r.status) && noPayment(r));
  r = track(await call(CB, { bearer: ANON_KEY, body: pay('order-A', 10000, { invoiceToken: TOKEN_EXPIRED }) }));
  ok('balance: expired token cannot pay', isDenied(r.status) && noPayment(r));
  r = track(await call(CB, { bearer: 'jwt-other', body: pay('order-A', 10000) }));
  ok('balance: a different signed-in customer cannot pay Order A (403)', r.status === 403 && noPayment(r));
  r = track(await call(CB, { bearer: 'jwt-crew', body: pay('order-A', 10000) }));
  ok('balance: crew cannot pay an order they do not own (403)', r.status === 403 && noPayment(r));
  r = track(await call(CB, { bearer: ANON_KEY, body: pay('order-A', 10000, { sessionId: 'sess_A' }) }));
  ok('balance: a Stripe session is not accepted as proof here', isDenied(r.status) && noPayment(r));

  r = track(await call(CB, { bearer: ANON_KEY, body: pay('order-nocard', 10001, { invoiceToken: TOKEN_A }) }));
  ok('balance: amount above the server-read balance is refused (400), nothing charged', r.status === 400 && /exceeds the balance/.test(r.json?.error ?? '') && noPayment(r));
  r = track(await call(CB, { bearer: ANON_KEY, body: pay('order-nocard', 10000000, { invoiceToken: TOKEN_A }) }));
  ok('balance: an arbitrary large amount is refused', r.status === 400 && noPayment(r));
  r = track(await call(CB, { bearer: ANON_KEY, body: pay('order-nocard', 10000, { invoiceToken: TOKEN_A }) }));
  ok('balance: a valid token with the exact balance proceeds (Checkout session for 10000)', r.status === 200 && r.json?.url === 'https://checkout.example/x'
    && r.w.stripeCalls.some((c) => c.api === 'checkout.sessions.create' && c.args.line_items[0].price_data.unit_amount === 10000));
  r = track(await call(CB, { bearer: ANON_KEY, body: pay('order-nocard', 4000, { invoiceToken: TOKEN_A, tipCents: 700 }) }));
  ok('balance: a partial amount plus a tip proceeds with the tip on top', r.status === 200
    && r.w.stripeCalls.some((c) => c.api === 'checkout.sessions.create' && c.args.line_items.map((l: any) => l.price_data.unit_amount).join(',') === '4000,700'));
  r = track(await call(CB, { bearer: 'jwt-cust', body: pay('order-nocard', 10000) }));
  ok('balance: the signed-in owner proceeds', r.status === 200 && r.json?.url === 'https://checkout.example/x');

  // ===========================================================================================================
  // save-payment-method-from-session
  // ===========================================================================================================
  const SP = 'save-payment-method-from-session';
  const savePm = (sessionId: string, orderId: string) => ({ sessionId, orderId });
  const cardSaved = (x: { w: World }) => wrote(x.w, 'orders', (e) => e.payload?.stripe_payment_method_id);

  r = track(await call(SP, { bearer: ANON_KEY, body: savePm('sess_B', 'order-A') }));
  ok('save-pm: Order B session cannot overwrite Order A card (403)', r.status === 403 && !cardSaved(r));
  r = track(await call(SP, { bearer: ANON_KEY, body: savePm('sess_open', 'order-A') }));
  ok('save-pm: an incomplete session is rejected (403)', r.status === 403 && !cardSaved(r));
  r = track(await call(SP, { bearer: ANON_KEY, body: savePm('sess_missing', 'order-A') }));
  ok('save-pm: an unknown session is rejected (403, no Stripe error leaked)', r.status === 403 && !/No such/.test(JSON.stringify(r.json)) && !cardSaved(r));
  r = track(await call(SP, {
    bearer: ANON_KEY,
    body: savePm('sess_A_otherCustomer', 'order-A'),
    mutate: (w) => { w.tables.orders.find((o) => o.id === 'order-A').stripe_customer_id = 'cus_A'; },
  }));
  ok('save-pm: a session whose Stripe customer differs from the order customer is rejected', r.status === 403 && !cardSaved(r));
  r = track(await call(SP, { bearer: ANON_KEY, body: savePm('sess_A', 'order-A') }));
  ok('save-pm: a completed session for this order saves the card', r.status === 200 && r.json?.success === true
    && wrote(r.w, 'orders', (e) => e.payload?.stripe_payment_method_id === 'pm_for_seti_A' && e.payload?.stripe_customer_id === 'cus_A' && e.filters.some((f: any) => f[0] === 'id' && f[1] === 'order-A')));
  r = track(await call(SP, {
    bearer: ANON_KEY,
    body: savePm('sess_A', 'order-A'),
    mutate: (w) => { w.tables.orders.find((o) => o.id === 'order-A').stripe_customer_id = 'cus_A'; },
  }));
  ok('save-pm: a matching Stripe customer on the order is accepted', r.status === 200);
  r = track(await call(SP, { bearer: ANON_KEY, body: savePm('sess_A', 'order-missing') }));
  ok('save-pm: a session bound to a different order id is rejected for an unknown order', r.status === 403);

  // ===========================================================================================================
  // send-invoice
  // ===========================================================================================================
  const SI = 'send-invoice';
  const inv = (orderId: string) => ({ orderId, depositCents: 5000, customerEmail: 'x@example.com', customerName: 'X' });
  const noInvoice = (x: { w: World }) => !wrote(x.w, 'invoice_links') && !wrote(x.w, 'orders') && !x.w.invokes.some((i) => /send-email|send-sms/.test(i.name));

  r = track(await call(SI, { bearer: ANON_KEY, body: inv('order-A') }));
  ok('send-invoice: anon key cannot send an invoice (401), nothing minted or sent', r.status === 401 && noInvoice(r));
  r = track(await call(SI, { bearer: null, body: inv('order-A') }));
  eq('send-invoice: no Authorization header (401)', r.status, 401);
  r = track(await call(SI, { bearer: 'jwt-cust', body: inv('order-A') }));
  ok('send-invoice: a customer JWT cannot send an invoice (403)', r.status === 403 && noInvoice(r));
  r = track(await call(SI, { bearer: 'jwt-crew', body: inv('order-missing') }));
  ok('send-invoice: crew MAY send invoices (passes the gate, then "Order not found")', r.status === 404);
  r = track(await call(SI, { bearer: 'jwt-other', body: inv('order-A') }));
  ok('send-invoice: a different customer JWT is denied (403)', r.status === 403 && noInvoice(r));
  r = track(await call(SI, { bearer: ANON_KEY, body: inv('order-A') }));
  ok('send-invoice: an invoice token is not a substitute for staff', isDenied(r.status));
  r = track(await call(SI, { bearer: 'jwt-master', body: inv('order-missing') }));
  ok('send-invoice: master passes the gate (then "Order not found")', r.status === 404);
  r = track(await call(SI, { bearer: 'jwt-admin', body: inv('order-missing') }));
  ok('send-invoice: admin passes the gate', r.status === 404);
  r = track(await call(SI, { bearer: SERVICE_KEY, body: inv('order-missing') }));
  ok('send-invoice: the backend (service role) passes the gate', r.status === 404);

  // ===========================================================================================================
  // customer-cancel-order
  // ===========================================================================================================
  const CC = 'customer-cancel-order';
  const cancel = (orderId: string, extra: Record<string, unknown> = {}) => ({ orderId, cancellationReason: 'Schedule changed, need to cancel.', ...extra });
  const cancelledWrite = (x: { w: World }) => wrote(x.w, 'orders', (e) => e.payload?.status === 'cancelled');

  r = track(await call(CC, { bearer: ANON_KEY, body: cancel('order-A') }));
  ok('cancel: anon with no proof cannot cancel (401)', r.status === 401 && !cancelledWrite(r));
  r = track(await call(CC, { bearer: ANON_KEY, body: cancel('order-A', { customerEmail: 'pat@example.com' }) }));
  ok('cancel: the customer email alone is no longer proof (401)', r.status === 401 && !cancelledWrite(r));
  r = track(await call(CC, { bearer: ANON_KEY, body: cancel('order-B', { invoiceLinkToken: TOKEN_A }) }));
  ok('cancel: Order A token cannot cancel Order B (cross-order)', isDenied(r.status) && !cancelledWrite(r));
  r = track(await call(CC, { bearer: ANON_KEY, body: cancel('order-A', { invoiceLinkToken: TOKEN_EXPIRED }) }));
  ok('cancel: an expired token cannot cancel', isDenied(r.status) && !cancelledWrite(r));
  r = track(await call(CC, { bearer: 'jwt-other', body: cancel('order-A') }));
  ok('cancel: any other logged-in customer is no longer treated as admin (403)', r.status === 403 && !cancelledWrite(r));
  r = track(await call(CC, { bearer: 'jwt-crew', body: cancel('order-A') }));
  ok('cancel: crew cannot staff-cancel (403)', r.status === 403 && !cancelledWrite(r));
  r = track(await call(CC, { bearer: ANON_KEY, body: cancel('order-A', { invoiceLinkToken: TOKEN_A, adminOverrideRefund: true }) }));
  ok('cancel: a valid token cancels', r.status === 200 && cancelledWrite(r));
  ok('cancel: a customer cannot record a refund intent or a cancelled_by user',
    wrote(r.w, 'orders', (e) => e.payload?.status === 'cancelled' && e.payload?.refund_requested === false && e.payload?.cancelled_by === null));
  r = track(await call(CC, { bearer: 'jwt-cust', body: cancel('order-A') }));
  ok('cancel: the signed-in owner can cancel', r.status === 200 && cancelledWrite(r));
  ok('cancel: an owner JWT cancel records no cancelled_by user (that field is staff-only)',
    wrote(r.w, 'orders', (e) => e.payload?.status === 'cancelled' && e.payload?.cancelled_by === null));
  r = track(await call(CC, { bearer: ANON_KEY, body: cancel('order-inprogress', { invoiceLinkToken: TOKEN_A }) }));
  ok('cancel: a customer cannot cancel an in-progress order', r.status === 400 && !cancelledWrite(r));
  r = track(await call(CC, { bearer: 'jwt-master', body: cancel('order-inprogress', { adminOverrideRefund: true }) }));
  ok('cancel: master can staff-cancel an in-progress order and record refund intent', r.status === 200
    && wrote(r.w, 'orders', (e) => e.payload?.status === 'cancelled' && e.payload?.refund_requested === true && e.payload?.cancelled_by === 'u-master'));
  r = track(await call(CC, { bearer: 'jwt-admin', body: cancel('order-A') }));
  ok('cancel: the admin role can staff-cancel', r.status === 200 && cancelledWrite(r));
  r = track(await call(CC, { bearer: 'jwt-master', body: cancel('order-missing') }));
  eq('cancel: staff on an unknown order gets 404', r.status, 404);
  r = track(await call(CC, { bearer: ANON_KEY, body: cancel('order-missing', { invoiceLinkToken: TOKEN_A }) }));
  ok('cancel: unauthorized callers learn nothing about unknown orders (401, not 404)', r.status === 401);

  // ===========================================================================================================
  // stripe-checkout: who may create a session for which order (the proof-minting gap)
  // ===========================================================================================================
  const SC = 'stripe-checkout';
  const booking = (orderId: string, extra: Record<string, unknown> = {}) => ({ orderId, depositCents: 5000, tipCents: 0, customerEmail: 'x@example.com', customerName: 'X Y', origin: 'https://site.example', bookingMode: true, ...extra });
  const cardUpdate = (orderId: string, extra: Record<string, unknown> = {}) => ({ orderId, setupMode: true, customerEmail: 'x@example.com', customerName: 'X Y', ...extra });
  const invoiceSetup = (orderId: string, token: string | null, extra: Record<string, unknown> = {}) => ({ orderId, setupMode: true, invoiceMode: true, invoiceLinkToken: token, ...extra });
  const paymentMode = (orderId: string, extra: Record<string, unknown> = {}) => ({ orderId, depositCents: 5000, customerEmail: 'x@example.com', customerName: 'X Y', ...extra });
  const createdSession = (x: { w: World }) => x.w.stripeCalls.some((c) => c.api === 'checkout.sessions.create');
  const noSessionOrCustomer = (x: { w: World }) => !createdSession(x) && !stripeUsed(x.w, 'customers.create') && !wrote(x.w, 'orders');

  // Public NEW booking flow still works anonymously
  r = track(await call(SC, { bearer: ANON_KEY, body: booking('order-fresh') }));
  ok('checkout: an anonymous NEW booking can start its card setup', r.status === 200 && r.json?.url === 'https://checkout.example/x');
  ok('checkout: that session is a no-charge setup session bound to the booking order', r.w.stripeCalls.some((c) => c.api === 'checkout.sessions.create' && c.args.mode === 'setup' && c.args.metadata.order_id === 'order-fresh' && c.args.metadata.payment_type === 'booking_request'));
  r = track(await call(SC, { bearer: 'jwt-cust', body: booking('order-fresh') }));
  ok('checkout: a signed-in customer starting a NEW booking works too', r.status === 200);

  // An anonymous caller cannot target an existing order, whatever the mode
  for (const [label, body] of [
    ['booking mode on an existing pending order', booking('order-A')],
    ['booking mode on a confirmed order', booking('order-nocard')],
    ['booking mode on an order that already has a Stripe customer', booking('order-draft-hascustomer')],
    ['booking mode on a draft that already has a payment method', booking('order-draft-haspm')],
    ['booking mode on a stale draft (older than 2 hours)', booking('order-stale-draft')],
    ['booking mode on an admin-created invoice draft', booking('order-invoice-draft')],
    ['booking mode on an unknown order id', booking('order-missing')],
    ['card-update (setup) mode on an existing order', cardUpdate('order-A')],
    ['invoice setup mode without a token', invoiceSetup('order-A', null)],
    ['payment mode on an existing order', paymentMode('order-A')],
    ['setup mode on a fresh draft (only bookingMode gets the fresh-draft path)', cardUpdate('order-fresh')],
  ] as Array<[string, Record<string, unknown>]>) {
    r = track(await call(SC, { bearer: ANON_KEY, body }));
    ok(`checkout: anonymous cannot create a session: ${label}`, r.status === 401 && noSessionOrCustomer(r));
  }
  r = track(await call(SC, { bearer: null, body: cardUpdate('order-A') }));
  ok('checkout: no Authorization header cannot create a session', r.status === 401 && noSessionOrCustomer(r));

  // A fresh draft is single-use: once setup has been started its customer is attached and the draft no longer qualifies
  {
    const w = makeWorld();
    const first = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh') });
    ok('checkout: first booking setup for a fresh draft succeeds', first.status === 200);
    ok('checkout: that call attached a Stripe customer to the order', w.tables.orders.find((o) => o.id === 'order-fresh').stripe_customer_id === 'cus_new');
    const second = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh') });
    ok('checkout: a second anonymous session for the SAME draft is refused (single use)', second.status === 401);
    allWorlds.push(w);
  }

  // Token-bound proof (invoice, card update, payment)
  r = track(await call(SC, { bearer: ANON_KEY, body: invoiceSetup('order-A', TOKEN_A) }));
  ok('checkout: a valid Order A token creates an invoice setup session for Order A', r.status === 200 && r.w.stripeCalls.some((c) => c.api === 'checkout.sessions.create' && c.args.metadata.order_id === 'order-A'));
  r = track(await call(SC, { bearer: ANON_KEY, body: cardUpdate('order-A', { invoiceLinkToken: TOKEN_A }) }));
  ok('checkout: a valid Order A token creates a card-update session for Order A', r.status === 200);
  r = track(await call(SC, { bearer: ANON_KEY, body: paymentMode('order-A', { invoiceLinkToken: TOKEN_A }) }));
  ok('checkout: a valid Order A token creates a payment session for Order A', r.status === 200);
  r = track(await call(SC, { bearer: ANON_KEY, body: invoiceSetup('order-B', TOKEN_A) }));
  ok('checkout: the Order A token cannot create a session for Order B (cross-order)', r.status === 401 && noSessionOrCustomer(r));
  r = track(await call(SC, { bearer: ANON_KEY, body: cardUpdate('order-B', { invoiceLinkToken: TOKEN_A }) }));
  ok('checkout: the Order A token cannot create a card-update session for Order B', r.status === 401 && noSessionOrCustomer(r));
  r = track(await call(SC, { bearer: ANON_KEY, body: invoiceSetup('order-A', TOKEN_EXPIRED) }));
  ok('checkout: an expired token cannot create a session', r.status === 401 && noSessionOrCustomer(r));
  r = track(await call(SC, { bearer: ANON_KEY, body: booking('order-A', { invoiceLinkToken: TOKEN_B }) }));
  ok('checkout: a token for another order does not turn booking mode into access', r.status === 401 && noSessionOrCustomer(r));

  // Signed-in owner / other customer / crew / staff
  r = track(await call(SC, { bearer: 'jwt-cust', body: cardUpdate('order-A') }));
  ok('checkout: the signed-in owner can create a card-update session for their own order', r.status === 200);
  r = track(await call(SC, { bearer: 'jwt-other', body: cardUpdate('order-A') }));
  ok('checkout: another signed-in customer cannot (403)', r.status === 403 && noSessionOrCustomer(r));
  r = track(await call(SC, { bearer: 'jwt-crew', body: cardUpdate('order-A') }));
  ok('checkout: crew has no special access to create customer sessions (403)', r.status === 403 && noSessionOrCustomer(r));
  r = track(await call(SC, { bearer: 'jwt-master', body: cardUpdate('order-A') }));
  ok('checkout: master can create a session', r.status === 200);
  r = track(await call(SC, { bearer: 'jwt-admin', body: cardUpdate('order-A') }));
  ok('checkout: admin can create a session', r.status === 200);
  r = track(await call(SC, { bearer: SERVICE_KEY, body: cardUpdate('order-A') }));
  ok('checkout: the backend (service role) can create a session', r.status === 200);
  r = track(await call(SC, { bearer: 'jwt-master', body: cardUpdate('order-missing') }));
  eq('checkout: staff still get a normal 404 for an unknown order', r.status, 404);

  // ---- End-to-end proof chain: an attacker cannot manufacture a session proof for someone else's order ----
  {
    const w = makeWorld();
    // 1. The attacker, holding only the public anon key and Order A's UUID, tries to get a session for Order A.
    const attempt = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-A') });
    ok('chain: the attacker cannot create a Stripe session for Order A', attempt.status === 401 && !createdSession({ w }));
    const attempt2 = await call(SC, { world: w, bearer: ANON_KEY, body: cardUpdate('order-A') });
    ok('chain: nor a card-update session for Order A', attempt2.status === 401 && !createdSession({ w }));
    ok('chain: so no session was minted at all to be used as proof', !Object.keys(w.sessions).some((k) => k.startsWith('cs_new_')));

    // 2. The attacker legitimately creates and COMPLETES a session for their OWN fresh booking.
    const own = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh2') });
    const ownSessionId = Object.keys(w.sessions).find((k) => k.startsWith('cs_new_')) as string;
    ok('chain: the attacker can create a session for their own fresh booking', own.status === 200 && !!ownSessionId);
    w.sessions[ownSessionId].status = 'complete';
    w.sessions[ownSessionId].setup_intent = 'seti_own';

    // 3. That session proves control of THEIR order only.
    const useOnA1 = await call(CD, { world: w, bearer: ANON_KEY, body: charge('order-A', { sessionId: ownSessionId }) });
    ok('chain: the attacker session cannot charge Order A', isDenied(useOnA1.status) && !stripeUsed(w, 'paymentIntents.create'));
    const useOnA2 = await call(LC, { world: w, bearer: ANON_KEY, body: confirm('order-A', { sessionId: ownSessionId }) });
    ok('chain: the attacker session cannot confirm Order A', isDenied(useOnA2.status) && !wrote(w, 'orders', (e) => e.payload?.status === 'confirmed'));
    const useOnA3 = await call(SP, { world: w, bearer: ANON_KEY, body: savePm(ownSessionId, 'order-A') });
    ok('chain: the attacker session cannot replace Order A saved card', useOnA3.status === 403 && !cardSaved({ w }));
    const useOnA4 = await call(LC, { world: w, bearer: ANON_KEY, body: pending('order-A', { sessionId: ownSessionId }) });
    ok('chain: the attacker session cannot trigger pending_review on Order A', isDenied(useOnA4.status));

    // 4. The same session DOES complete the attacker's own legitimate booking (the flow works end to end).
    const own2 = await call(SP, { world: w, bearer: ANON_KEY, body: savePm(ownSessionId, 'order-fresh2') });
    ok('chain: the legitimate booking saves its card with its own session', own2.status === 200 && own2.json?.success === true);
    const own3 = await call(LC, { world: w, bearer: ANON_KEY, body: pending('order-fresh2', { sessionId: ownSessionId }) });
    ok('chain: the legitimate booking enters pending_review with its own session', own3.status === 200 && wrote(w, 'orders', (e) => e.payload?.status === 'pending_review'));
    allWorlds.push(w);
  }

  // ===========================================================================================================
  // Static wiring: invoice cancellation token, card-update proof, crew invoice token
  // ===========================================================================================================
  const read = (p: string): string => fs.readFileSync(p, 'utf8');
  for (const file of ['src/components/customer-portal/InvoiceAcceptanceView.tsx', 'src/components/customer-portal/RegularPortalView.tsx']) {
    const s = read(file);
    const usages = s.match(/<CancelOrderModal[\s\S]*?\/>/g) ?? [];
    ok(`${file.split('/').pop()} renders CancelOrderModal with the invoice token (${usages.length} usage)`, usages.length >= 1 && usages.every((u) => /invoiceLinkToken=\{/.test(u)));
  }
  ok('InvoiceAcceptanceView passes the invoice link token exactly', /<CancelOrderModal[\s\S]*?invoiceLinkToken=\{invoiceLink\?\.link_token \?\? null\}[\s\S]*?\/>/.test(read('src/components/customer-portal/InvoiceAcceptanceView.tsx')));
  const modal = read('src/components/customer-portal/CancelOrderModal.tsx');
  ok('CancelOrderModal sends the invoice token and the session-or-anon bearer', /invoiceLinkToken \? \{ invoiceLinkToken \} : \{\}/.test(modal) && /getEdgeAuthToken\(\)/.test(modal));
  ok('CancelOrderModal no longer sends the customer email as proof', !/customerEmail/.test(modal.slice(modal.indexOf('JSON.stringify'), modal.indexOf('JSON.stringify') + 300)));
  ok('card-update from PaymentTab carries the order token', /setupMode: true,\s*\.\.\.\(invoiceLinkToken \? \{ invoiceLinkToken \} : \{\}\)/.test(read('src/components/customer-portal/PaymentTab.tsx')));
  ok('card-update from ApprovalModal carries the order token', /setupMode: true,[\s\S]{0,200}\.\.\.\(invoiceLinkToken \? \{ invoiceLinkToken \} : \{\}\)/.test(read('src/components/customer-portal/ApprovalModal.tsx')));
  ok('invoice setup calls from InvoiceAcceptanceView carry the invoice token', (read('src/components/customer-portal/InvoiceAcceptanceView.tsx').match(/invoiceLinkToken: invoiceLink\?\.link_token \?\? null/g) ?? []).length >= 2);
  ok('public booking checkout still uses bookingMode', /bookingMode: true/.test(read('src/pages/Checkout.tsx')));
  ok('crew invoice send uses the signed-in token (invoiceService)', /Bearer \$\{await getEdgeAuthToken\(\)\}/.test(read('src/lib/invoiceService.ts')));
  ok('CrewInvoiceBuilder sends through generateInvoice (the token-aware sender)', /generateInvoice/.test(read('src/components/crew/CrewInvoiceBuilder.tsx')));
  ok('send-invoice allows crew via the invoice-sender role list and keeps admin/master/crew only', /INVOICE_SENDER_ROLES/.test(read('supabase/functions/send-invoice/index.ts')) && /INVOICE_SENDER_ROLES[^=]*= \["admin", "master", "crew"\]/.test(read('supabase/functions/_shared/auth.ts')));

  // ===========================================================================================================
  // Logging hygiene: no secrets in any captured log line
  // ===========================================================================================================
  const allLogs = allWorlds.flatMap((w) => w.consoleLines).join('\n');
  for (const secret of SECRETS) ok(`logs never contain a secret/token value (${secret.slice(0, 6)}...)`, !allLogs.includes(secret));
  ok('rejection logs carry safe identifiers only', /reason=no_order_proof/.test(allLogs));

  // ===========================================================================================================
  // Static privilege checks: RPC callers and the A1 migration
  // ===========================================================================================================
  const INTERNAL_RPCS = ['record_cash_payment', 'record_check_payment', 'apply_balance_payment_financials', 'claim_balance_payment_financials', 'increment_order_refunded_cents'];
  const fnDirs = fs.readdirSync('supabase/functions').filter((d: string) => fs.existsSync(`supabase/functions/${d}/index.ts`));
  const handlersDir = fs.existsSync('supabase/functions/stripe-webhook/handlers.ts') ? ['stripe-webhook/handlers'] : [];
  for (const rpc of INTERNAL_RPCS) {
    const callers: string[] = [];
    for (const d of [...fnDirs.map((x: string) => `${x}/index`), ...handlersDir]) {
      const p = `supabase/functions/${d}.ts`;
      if (!fs.existsSync(p)) continue;
      const s: string = fs.readFileSync(p, 'utf8');
      if (s.includes(`"${rpc}"`)) callers.push(d);
    }
    // browser code must never call these directly
    const browserCalls = (fs.readdirSync('src', { recursive: true }) as string[])
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|database\.types/.test(f))
      .filter((f) => fs.readFileSync(`src/${f}`, 'utf8').includes(`rpc('${rpc}'`));
    ok(`no browser code calls .rpc('${rpc}')`, browserCalls.length === 0);
    ok(`${rpc} has only backend Edge Function callers (${callers.join(', ') || 'none'})`, callers.every((c) => /^(record-cash-payment|record-check-payment|customer-balance-payment|reconcile-balance-payment|stripe-webhook|stripe-refund)\//.test(c)));
  }
  // The refund function must call the RPC through a client without the caller's forwarded Authorization header.
  const refundSrc: string = fs.readFileSync('supabase/functions/stripe-refund/index.ts', 'utf8');
  ok('stripe-refund calls increment_order_refunded_cents through the plain service-role client', /serviceClient\.rpc\("increment_order_refunded_cents"/.test(refundSrc) && !/supabaseClient\.rpc\("increment_order_refunded_cents"/.test(refundSrc));
  const svcBlock = refundSrc.slice(refundSrc.indexOf('const serviceClient = createClient('), refundSrc.indexOf('const serviceClient = createClient(') + 200);
  ok('that service client forwards no Authorization header', !/global|Authorization/.test(svcBlock));
  // Every function that calls an internal RPC must build that client without a forwarded caller header.
  for (const d of ['record-cash-payment', 'record-check-payment', 'customer-balance-payment', 'reconcile-balance-payment', 'stripe-webhook']) {
    const s: string = fs.readFileSync(`supabase/functions/${d}/index.ts`, 'utf8');
    const m = s.match(/createClient\([^)]*\)/s);
    ok(`${d} builds its Supabase client with the service key and no forwarded header`, !!m && !/global|Authorization/.test(m[0]));
  }

  const mig: string = fs.readFileSync('supabase/migrations/20261007120000_payment_safety_a1_rpc_authorization.sql', 'utf8');
  const sqlOnly = mig.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
  const sigs: Record<string, string> = {
    record_cash_payment: 'uuid, integer, integer, uuid',
    record_check_payment: 'uuid, integer, integer, uuid, text',
    apply_balance_payment_financials: 'text, uuid, integer, integer, text, text',
    claim_balance_payment_financials: 'text',
    increment_order_refunded_cents: 'uuid, integer',
  };
  for (const [fn, sig] of Object.entries(sigs)) {
    ok(`migration revokes ${fn} from PUBLIC, anon, authenticated`, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(${sig.replace(/[()]/g, '\\$&')}\\) FROM PUBLIC, anon, authenticated;`).test(sqlOnly));
    ok(`migration grants ${fn} to service_role only`, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(${sig}\\) TO service_role;`).test(sqlOnly));
  }
  ok('migration makes is_admin() lowercase-safe', /lower\(role\) IN \('admin', 'master'\)/.test(sqlOnly) && !/role IN \('ADMIN'/.test(sqlOnly));
  ok('migration does not touch customer or crew in is_admin()', !/'crew'|'customer'/.test(sqlOnly.slice(sqlOnly.indexOf('is_admin'), sqlOnly.indexOf('REVOKE ALL'))));
  ok('migration changes no table RLS policy', !/\b(CREATE|DROP|ALTER)\s+POLICY\b/i.test(sqlOnly));
  ok('migration changes no table or table grants', !/\bON\s+TABLE\b|\bALTER\s+TABLE\b|\bON\s+public\.(orders|payments|customers)\b/i.test(sqlOnly));
  ok('migration does not touch approve_order_changes', !/approve_order_changes/.test(sqlOnly));
  ok('migration does not touch get_admin_users (deferred)', !/get_admin_users/.test(sqlOnly));
  ok('find_order_id_by_prefix is admin-gated and not executable by anon', /WHERE public\.is_admin\(\)/.test(sqlOnly) && /REVOKE ALL ON FUNCTION public\.find_order_id_by_prefix\(text\) FROM PUBLIC, anon;/.test(sqlOnly));

  console.log(`Edge function authorization tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} edge function authorization test(s) failed`);
})();
