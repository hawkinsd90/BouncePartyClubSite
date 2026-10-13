// Handler-level authorization tests for the payment RPC authorization Edge Functions.
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
const nodeCrypto = require('crypto');

import * as authHelpers from '../../supabase/functions/_shared/auth';
import * as portalLinkHelpers from '../../supabase/functions/_shared/portal-link';
import * as outcomeHelpers from '../../supabase/functions/_shared/lifecycle-outcome';
import * as bookingProofHelpers from '../../supabase/functions/_shared/booking/bookingProof';
import * as returnOriginHelpers from '../../supabase/functions/_shared/booking/returnOrigin';
import * as paymentOperationHelpers from '../../supabase/functions/_shared/payment-operations';

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
const sha256 = (v: string) => nodeCrypto.createHash('sha256').update(v).digest('hex');
// Booking proofs: well-formed tokens, stored only as hashes.
const BK_FRESH = 'bk_' + 'F'.repeat(43);
const BK_FRESH2 = 'bk_' + 'G'.repeat(43);
const BK_EXPIRED = 'bk_' + 'X'.repeat(43);
const BK_USED = 'bk_' + 'U'.repeat(43);
const SECRETS = [BK_FRESH, BK_FRESH2, BK_EXPIRED, BK_USED, SERVICE_KEY, ANON_KEY, TOKEN_A, TOKEN_B, TOKEN_EXPIRED, 'jwt-master', 'jwt-admin', 'jwt-crew', 'jwt-cust', 'jwt-other'];

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
        { id: 'cust-F', user_id: null, email: 'fresh@example.com', first_name: 'Fran', last_name: 'Fresh' },
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
      booking_setup_proofs: [
        { id: 'bp-fresh', order_id: 'order-fresh', token_hash: sha256(BK_FRESH), expires_at: FUTURE, claim_id: null, claimed_at: null, consumed_at: null },
        { id: 'bp-fresh2', order_id: 'order-fresh2', token_hash: sha256(BK_FRESH2), expires_at: FUTURE, claim_id: null, claimed_at: null, consumed_at: null },
        { id: 'bp-expired', order_id: 'order-stale-draft', token_hash: sha256(BK_EXPIRED), expires_at: PAST, claim_id: null, claimed_at: null, consumed_at: null },
        { id: 'bp-used', order_id: 'order-draft-haspm', token_hash: sha256(BK_USED), expires_at: FUTURE, claim_id: 'cl-old', claimed_at: PAST, consumed_at: PAST },
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
    failNextSessionCreate: false,
    // Fault injection: the database rejects the booking-proof consume write (after Stripe already succeeded).
    failProofConsume: false,
    failProofConsumeOnce: false,
    // Fake Stripe idempotency: key -> { fingerprint of params, result }, and the Checkout Sessions truly minted.
    idempotency: {} as Record<string, { fingerprint: string; result: any }>,
    mintedSessionIds: [] as string[],
  };
}
type World = ReturnType<typeof makeWorld>;

function makeClient(w: World) {
  const from = (table: string) => {
    const q: any = { table, op: 'select', filters: [] as any[], payload: null, returning: false };
    const rowsFor = () => (w.tables[table] ?? []).filter((r) => q.filters.every(([k, c, v]: any) => (k === 'eq' ? r[c] === v : k === 'neq' ? r[c] !== v : k === 'is' ? (v === null ? r[c] == null : r[c] === v) : k === 'in' ? (v as any[]).includes(r[c]) : true)));
    const exec = (single: boolean, required: boolean) => {
      if (q.op === 'select') {
        const rows = rowsFor();
        if (single) return { data: rows[0] ?? null, error: required && !rows[0] ? { message: 'not found' } : null };
        return { data: rows, error: null };
      }
      if (q.op === 'update') {
        if (table === 'booking_setup_proofs' && w.failProofConsumeOnce && q.payload && 'consumed_at' in q.payload) {
          w.failProofConsumeOnce = false;
          return { data: null, error: { message: 'injected: transient proof consume failure' } };
        }
        if (table === 'booking_setup_proofs' && w.failProofConsume && q.payload && 'consumed_at' in q.payload) {
          return { data: null, error: { message: 'injected: proof consume write failed' } };
        }
        w.log.push({ table, op: 'update', payload: q.payload, filters: q.filters.map((f: any) => f.slice(1)) });
        const hit = rowsFor();
        hit.forEach((r) => Object.assign(r, q.payload));
        return { data: q.returning ? (single ? (hit[0] ?? null) : hit.map((r) => ({ ...r }))) : null, error: null };
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
      select: () => ((q.returning = q.op === 'update'), api),
      eq: (c: string, v: unknown) => (q.filters.push(['eq', c, v]), api),
      neq: (c: string, v: unknown) => (q.filters.push(['neq', c, v]), api),
      not: () => api,
      in: (c: string, v: unknown[]) => (q.filters.push(['in', c, v]), api),
      is: (c: string, v: unknown) => (q.filters.push(['is', c, v]), api),
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
    rpc: (name: string, args: any) => {
      w.log.push({ op: 'rpc', name, args });
      // This file tests WHO may start a payment. The payment operation functions themselves (amount derivation, leases,
      // finalization) are tested against a real database in paymentOperations.test.ts and paymentCharging.test.ts; here a
      // minimal stand-in lets an authorized request reach the provider step.
      let data: any = null;
      if (name === 'claim_payment_operation') {
        const o = w.tables.orders.find((x: any) => x.id === args.p_order_id);
        if (!o) data = { outcome: 'not_found' };
        else if (args.p_purpose === 'balance') {
          const bd = Math.max(0, o.balance_due_cents ?? 0);
          data = args.p_requested_principal_cents > bd
            ? { outcome: 'over_balance', balance_due_cents: bd }
            : { outcome: 'claimed', payment_id: 'pay-1', operation_key: 'bpc-pay-test', payment_type: 'balance', principal_cents: args.p_requested_principal_cents, tip_cents: args.p_requested_tip_cents ?? 0, gross_cents: args.p_requested_principal_cents + (args.p_requested_tip_cents ?? 0), provider_payment_intent_id: null, checkout_session_id: null, order_status: o.status };
        } else {
          data = { outcome: 'claimed', payment_id: 'pay-1', operation_key: 'bpc-pay-test', payment_type: 'deposit', principal_cents: o.deposit_due_cents, tip_cents: args.p_requested_tip_cents ?? 0, gross_cents: o.deposit_due_cents + (args.p_requested_tip_cents ?? 0), provider_payment_intent_id: null, checkout_session_id: null, order_status: o.status };
        }
      } else if (name === 'record_payment_operation_provider' || name === 'release_payment_operation' || name === 'mark_payment_operation_provider_attempt') data = true;
      else if (name === 'finalize_payment_operation') data = { outcome: 'applied', applied: true, payment_type: 'balance', status_changed: false, tip_cents: 0 };
      const res = { data, error: null };
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
        create: async (params: unknown, opts?: { idempotencyKey?: string }) => {
          w.stripeCalls.push({ api: 'checkout.sessions.create', args: params, idempotencyKey: opts?.idempotencyKey } as any);
          if (w.failNextSessionCreate) {
            w.failNextSessionCreate = false;
            throw new Error('stripe unavailable');
          }
          const key = opts?.idempotencyKey ? `session:${opts.idempotencyKey}` : null;
          const fingerprint = JSON.stringify(params);
          if (key && w.idempotency[key]) {
            // Same key: Stripe returns the original result and mints nothing new; different params is an error.
            if (w.idempotency[key].fingerprint !== fingerprint) throw new Error('idempotency_error: keys may only be reused with identical parameters');
            return w.idempotency[key].result;
          }
          const id = `cs_new_${w.mintedSessionIds.length + 1}`;
          w.sessions[id] = { status: 'open', mode: (params as any).mode, metadata: (params as any).metadata, customer: (params as any).customer };
          w.mintedSessionIds.push(id);
          const result = { id, url: 'https://checkout.example/x' };
          if (key) w.idempotency[key] = { fingerprint, result };
          return result;
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
      create: async (params: unknown, opts?: { idempotencyKey?: string }) => {
        w.stripeCalls.push({ api: 'customers.create', args: params, idempotencyKey: opts?.idempotencyKey } as any);
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
    ...bookingProofHelpers,
    ...returnOriginHelpers,
    ...paymentOperationHelpers,
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
  ok('lifecycle: valid token + unpaid deposit + claimed "waived" does NOT confirm', r.status === 400 && r.json?.success === false && /not been collected|cannot be confirmed/.test(r.json?.error ?? ''));
  ok('lifecycle: no status write on the rejected customer confirm', !wrote(r.w, 'orders', (e) => e.payload?.status === 'confirmed'));

  for (const outcome of ['already_paid', 'charged_now', 'cash']) {
    r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-A', { invoiceToken: TOKEN_A, paymentOutcome: outcome }) }));
    ok(`lifecycle: token holder claiming "${outcome}" on an unpaid order does NOT confirm`, r.status === 400 && !wrote(r.w, 'orders', (e) => e.payload?.status === 'confirmed'));
  }

  // Customer proof, deposit genuinely collected: confirmation proceeds and the outcome label comes from state.
  r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-paid', { invoiceToken: TOKEN_A, paymentOutcome: 'waived', source: 'customer_approval_already_paid' }), mutate: (w) => { w.tables.orders.find((o) => o.id === 'order-paid').status = 'awaiting_customer_approval'; } }));
  ok('lifecycle: token + deposit already collected confirms', r.status === 200 && r.json?.success === true);
  ok('lifecycle: the changelog outcome is derived from state (already_paid), not the claim (waived)', r.w.log.some((e) => e.table === 'order_changelog' && /payment: already_paid/.test(e.payload?.notes ?? '')));

  r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-paid', { invoiceToken: TOKEN_B }) }));
  ok('lifecycle: Order B token cannot confirm Order "paid" either', r.status === 401);

  // Owner proof
  r = track(await call(LC, { bearer: 'jwt-cust', body: confirm('order-paid', { paymentOutcome: 'already_paid', source: 'customer_approval_already_paid' }), mutate: (w) => { w.tables.orders.find((o) => o.id === 'order-paid').status = 'awaiting_customer_approval'; } }));
  ok('lifecycle: signed-in owner with collected deposit confirms', r.status === 200 && r.json?.success === true);
  r = track(await call(LC, { bearer: 'jwt-cust', body: confirm('order-A', { paymentOutcome: 'waived' }) }));
  ok('lifecycle: signed-in owner cannot self-waive an unpaid deposit', r.status === 400 && !wrote(r.w, 'orders', (e) => e.payload?.status === 'confirmed'));

  // Zero deposit (waived / zero_due_with_card) is allowed with proof
  r = track(await call(LC, { bearer: ANON_KEY, body: confirm('order-A', { invoiceToken: TOKEN_A, paymentOutcome: 'waived', source: 'invoice_acceptance_no_card' }), mutate: (w) => { Object.assign(w.tables.orders.find((o) => o.id === 'order-A'), { deposit_due_cents: 0, status: 'draft', require_card_on_file: false }); } }));
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
  const booking = (orderId: string, extra: Record<string, unknown> = {}) => ({ orderId, depositCents: 5000, tipCents: 0, customerEmail: 'x@example.com', customerName: 'X Y', origin: 'https://bouncepartyclub.com', bookingMode: true, ...extra });
  const cardUpdate = (orderId: string, extra: Record<string, unknown> = {}) => ({ orderId, setupMode: true, customerEmail: 'x@example.com', customerName: 'X Y', ...extra });
  const invoiceSetup = (orderId: string, token: string | null, extra: Record<string, unknown> = {}) => ({ orderId, setupMode: true, invoiceMode: true, invoiceLinkToken: token, ...extra });
  const paymentMode = (orderId: string, extra: Record<string, unknown> = {}) => ({ orderId, depositCents: 5000, customerEmail: 'x@example.com', customerName: 'X Y', ...extra });
  const createdSession = (x: { w: World }) => x.w.stripeCalls.some((c) => c.api === 'checkout.sessions.create');
  const noSessionOrCustomer = (x: { w: World }) => !createdSession(x) && !stripeUsed(x.w, 'customers.create') && !wrote(x.w, 'orders');

  // Public NEW booking flow: authorized ONLY by the server-minted, order-bound booking proof
  r = track(await call(SC, { bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) }));
  ok('checkout: an anonymous NEW booking with its booking proof can start its card setup', r.status === 200 && r.json?.url === 'https://checkout.example/x');
  ok('checkout: that session is a no-charge setup session bound to the booking order', r.w.stripeCalls.some((c) => c.api === 'checkout.sessions.create' && c.args.mode === 'setup' && c.args.metadata.order_id === 'order-fresh' && c.args.metadata.payment_type === 'booking_request'));
  ok('checkout: the booking session has no line items and no PaymentIntent (nothing is charged)', !r.w.stripeCalls.some((c) => c.api === 'checkout.sessions.create' && (c.args.mode !== 'setup' || c.args.line_items)) && !stripeUsed(r.w, 'paymentIntents.create'));
  ok('checkout: the booking session metadata takes the deposit from the ORDER, not the request body', r.w.stripeCalls.some((c) => c.api === 'checkout.sessions.create' && c.args.metadata.deposit_amount === '5000' && c.args.metadata.tip_cents === '0'));
  ok('checkout: the Stripe customer is created from the ORDER customer, not the request body', r.w.stripeCalls.some((c) => c.api === 'customers.create' && c.args.email === 'fresh@example.com' && c.args.name === 'Fran Fresh'));
  r = track(await call(SC, { bearer: 'jwt-cust', body: booking('order-fresh', { bookingToken: BK_FRESH }) }));
  ok('checkout: a signed-in customer starting a NEW booking works with the proof too', r.status === 200);

  // The order's own state is NOT proof any more (isFreshBookingDraft is gone)
  for (const [label, body] of [
    ['a fresh draft with NO booking proof (state alone is not proof)', booking('order-fresh')],
    ['a fresh draft with a made-up booking proof', booking('order-fresh', { bookingToken: 'bk_' + 'Z'.repeat(43) })],
    ['a fresh draft with a malformed proof', booking('order-fresh', { bookingToken: 'nope' })],
    ['booking mode on an existing pending order', booking('order-A')],
    ['booking mode on a confirmed order', booking('order-nocard')],
    ['booking mode on an order that already has a Stripe customer', booking('order-draft-hascustomer')],
    ['booking mode on a draft that already has a payment method', booking('order-draft-haspm')],
    ['booking mode on a stale draft', booking('order-stale-draft')],
    ['booking mode on an admin-created invoice draft', booking('order-invoice-draft')],
    ['booking mode on an unknown order id', booking('order-missing')],
    ['card-update (setup) mode on an existing order', cardUpdate('order-A')],
    ['invoice setup mode without a token', invoiceSetup('order-A', null)],
    ['payment mode on an existing order', paymentMode('order-A')],
    ['setup mode on a fresh draft', cardUpdate('order-fresh')],
    ['the fresh booking proof used on a DIFFERENT order (Order A)', booking('order-A', { bookingToken: BK_FRESH })],
    ['the fresh booking proof used on another fresh order (Order B proof != Order A)', booking('order-fresh2', { bookingToken: BK_FRESH })],
    ['the fresh booking proof sent as a portal/invoice token for another mode', cardUpdate('order-fresh', { invoiceLinkToken: BK_FRESH })],
    ['an invoice/portal token presented as the booking proof', booking('order-A', { bookingToken: TOKEN_A })],
    ['an invoice token for the same order presented as the booking proof', booking('order-fresh', { bookingToken: TOKEN_INV })],
  ] as Array<[string, Record<string, unknown>]>) {
    r = track(await call(SC, { bearer: ANON_KEY, body }));
    ok(`checkout: anonymous cannot create a session: ${label}`, r.status === 401 && noSessionOrCustomer(r));
  }
  r = track(await call(SC, { bearer: null, body: cardUpdate('order-A') }));
  ok('checkout: no Authorization header cannot create a session', r.status === 401 && noSessionOrCustomer(r));

  // Expired and consumed proofs
  r = track(await call(SC, { bearer: ANON_KEY, body: booking('order-stale-draft', { bookingToken: BK_EXPIRED }) }));
  ok('checkout: an EXPIRED booking proof is refused (410) and creates nothing', r.status === 410 && noSessionOrCustomer(r));
  r = track(await call(SC, { bearer: ANON_KEY, body: booking('order-draft-haspm', { bookingToken: BK_USED }) }));
  ok('checkout: a CONSUMED booking proof is refused (409) and creates nothing', r.status === 409 && noSessionOrCustomer(r));

  // Single use + claim lifecycle
  {
    const w = makeWorld();
    const first = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    ok('checkout: first booking setup with the proof succeeds', first.status === 200);
    ok('checkout: that call attached a Stripe customer to the order', w.tables.orders.find((o) => o.id === 'order-fresh').stripe_customer_id === 'cus_new');
    ok('checkout: the proof is consumed once the session exists', !!w.tables.booking_setup_proofs.find((x) => x.id === 'bp-fresh').consumed_at);
    const sessionsBefore = w.stripeCalls.filter((c) => c.api === 'checkout.sessions.create').length;
    const second = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    ok('checkout: a second session with the SAME proof is refused (single use)', second.status === 409 && w.stripeCalls.filter((c) => c.api === 'checkout.sessions.create').length === sessionsBefore);
    allWorlds.push(w);
  }
  {
    // Stripe failure: the claim is released so the customer can retry with the same proof; nothing is consumed on failure.
    const w = makeWorld();
    w.failNextSessionCreate = true;
    const failed1 = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    const proofAfterFail = w.tables.booking_setup_proofs.find((x) => x.id === 'bp-fresh');
    ok('checkout: a Stripe failure returns an error and does NOT consume the proof', failed1.status === 500 && proofAfterFail.consumed_at === null && proofAfterFail.claim_id === null);
    const retry = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    ok('checkout: after the Stripe failure the SAME proof can retry and succeed', retry.status === 200 && !!w.tables.booking_setup_proofs.find((x) => x.id === 'bp-fresh').consumed_at);
    allWorlds.push(w);
  }
  {
    // Concurrency: two simultaneous requests with one proof mint exactly one session.
    const w = makeWorld();
    const [x1, x2] = await Promise.all([
      call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) }),
      call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) }),
    ]);
    const created = w.stripeCalls.filter((c) => c.api === 'checkout.sessions.create').length;
    ok('checkout: two concurrent requests with one proof create exactly ONE session', created === 1 && [x1.status, x2.status].sort().join(',') === '200,409');
    allWorlds.push(w);
  }

  // Stripe idempotency: one booking proof can only ever yield ONE distinct Checkout Session
  {
    const w = makeWorld();
    const res = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    const sessionCall = w.stripeCalls.find((c: any) => c.api === 'checkout.sessions.create') as any;
    const customerCall = w.stripeCalls.find((c: any) => c.api === 'customers.create') as any;
    ok('idempotency: the booking session is created with a Stripe idempotency key derived from the persisted proof id', res.status === 200 && sessionCall.idempotencyKey === 'booking-session-bp-fresh');
    ok('idempotency: the booking Stripe customer uses a proof-derived key too', customerCall.idempotencyKey === 'booking-customer-bp-fresh');
    ok('idempotency: the key is not derived from the plaintext booking token and the token is never sent to Stripe', !String(sessionCall.idempotencyKey).includes(BK_FRESH) && !JSON.stringify(w.stripeCalls).includes(BK_FRESH));
    ok('idempotency: the key is not placed in Checkout metadata', !JSON.stringify(sessionCall.args.metadata).includes('booking-session'));
    const w2 = makeWorld();
    await call(SC, { world: w2, bearer: ANON_KEY, body: booking('order-fresh2', { bookingToken: BK_FRESH2 }) });
    const key2 = (w2.stripeCalls.find((c: any) => c.api === 'checkout.sessions.create') as any).idempotencyKey;
    ok('idempotency: a different proof / order gets a different key', key2 === 'booking-session-bp-fresh2' && key2 !== sessionCall.idempotencyKey);
    allWorlds.push(w, w2);

    // Non-booking flows are unchanged (no idempotency key added)
    const cu = await call(SC, { bearer: ANON_KEY, body: cardUpdate('order-A', { invoiceLinkToken: TOKEN_A }) });
    ok('idempotency: other payment flows do not get a booking idempotency key', cu.status === 200 && cu.w.stripeCalls.filter((c: any) => c.api === 'checkout.sessions.create').every((c: any) => !c.idempotencyKey));
    allWorlds.push(cu.w);
  }
  {
    // Stripe succeeds, the database consume write FAILS: the same proof must never mint a second distinct session.
    const w = makeWorld();
    w.failProofConsume = true;
    const proofRow = () => w.tables.booking_setup_proofs.find((x) => x.id === 'bp-fresh');
    const first = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    ok('consume-failure: Stripe created session S1 and the caller received it', first.status === 200 && !!first.json?.sessionId && w.mintedSessionIds.length === 1);
    ok('consume-failure: the proof is NOT marked consumed (the write failed) but stays claimed', proofRow().consumed_at === null && proofRow().claim_id !== null);
    const immediate = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    ok('consume-failure: an immediate retry is refused while the claim is held (409) and mints nothing', immediate.status === 409 && w.mintedSessionIds.length === 1);
    proofRow().claimed_at = PAST; // the claim goes stale
    const retry = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    ok('consume-failure: after the claim goes stale the retry resolves to the SAME Checkout Session (S1 == S2)', retry.status === 200 && retry.json?.sessionId === first.json?.sessionId);
    ok('consume-failure: Stripe was invoked twice but only ONE unique session exists', w.stripeCalls.filter((c: any) => c.api === 'checkout.sessions.create').length === 2 && w.mintedSessionIds.length === 1 && Object.keys(w.sessions).filter((k) => k.startsWith('cs_new_')).length === 1);
    w.failProofConsume = false;
    proofRow().claimed_at = PAST;
    const third = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    ok('consume-failure: once the database recovers the same session is returned and the proof is finally consumed', third.status === 200 && third.json?.sessionId === first.json?.sessionId && !!proofRow().consumed_at && w.mintedSessionIds.length === 1);
    const fourth = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    ok('consume-failure: after consumption the proof can never be used again', fourth.status === 409 && w.mintedSessionIds.length === 1);
    ok('consume-failure: still setup-mode only, nothing charged', !stripeUsed(w, 'paymentIntents.create') && w.stripeCalls.filter((c: any) => c.api === 'checkout.sessions.create').every((c: any) => c.args.mode === 'setup'));
    allWorlds.push(w);
  }
  {
    // A single transient database failure while consuming is absorbed by one immediate retry
    const w = makeWorld();
    w.failProofConsumeOnce = true;
    const t = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    ok('consume-failure: one transient consume failure is retried immediately and the proof ends up consumed', t.status === 200 && !!w.tables.booking_setup_proofs.find((x) => x.id === 'bp-fresh').consumed_at && w.mintedSessionIds.length === 1);
    allWorlds.push(w);
  }
  {
    // A real Stripe failure still releases the claim and the same proof retries (no permanent consumption)
    const w = makeWorld();
    w.failNextSessionCreate = true;
    const f = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    const retry = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH }) });
    ok('retry: a real Stripe failure mints nothing, releases the claim, and the same proof then succeeds with exactly one session', f.status === 500 && retry.status === 200 && w.mintedSessionIds.length === 1);
    allWorlds.push(w);
  }

  // Request-body money and identity are ignored in booking mode
  r = track(await call(SC, { bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH, depositCents: 1, tipCents: 99999999, customerEmail: 'attacker@example.com', customerName: 'Mallory' }) }));
  ok('checkout: client depositCents / tipCents / email / name cannot change the booking session', r.status === 200
    && r.w.stripeCalls.some((c) => c.api === 'checkout.sessions.create' && c.args.metadata.deposit_amount === '5000' && c.args.metadata.tip_cents === '0')
    && r.w.stripeCalls.some((c) => c.api === 'customers.create' && c.args.email === 'fresh@example.com'));

  // Return origin allowlist
  const successUrlFor = (x: { w: World }) => x.w.stripeCalls.find((c) => c.api === 'checkout.sessions.create')?.args.success_url as string;
  r = track(await call(SC, { bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH, origin: 'https://evil.example' }) }));
  ok('checkout: an arbitrary body origin falls back to the production origin', r.status === 200 && successUrlFor(r).startsWith('https://bouncepartyclub.com/payment-complete?') && !successUrlFor(r).includes('evil.example'));
  r = track(await call(SC, { bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH, origin: 'https://www.bouncepartyclub.com' }) }));
  ok('checkout: the production www origin is allowed', r.status === 200 && successUrlFor(r).startsWith('https://www.bouncepartyclub.com/payment-complete?'));
  r = track(await call(SC, { bearer: ANON_KEY, body: booking('order-fresh', { bookingToken: BK_FRESH, origin: 'http://localhost:5173' }) }));
  ok('checkout: loopback development origins are allowed', r.status === 200 && successUrlFor(r).startsWith('http://localhost:5173/payment-complete?'));

  // Staff may still create a booking-mode session for an order without a proof (admin tooling / backend)
  r = track(await call(SC, { bearer: 'jwt-admin', body: booking('order-fresh') }));
  ok('checkout: admin can create a booking-mode session without a proof', r.status === 200);

  // Token-bound proof (invoice, card update, payment)
  r = track(await call(SC, { bearer: ANON_KEY, body: invoiceSetup('order-A', TOKEN_A) }));
  ok('checkout: a valid Order A token creates an invoice setup session for Order A', r.status === 200 && r.w.stripeCalls.some((c) => c.api === 'checkout.sessions.create' && c.args.metadata.order_id === 'order-A'));
  r = track(await call(SC, { bearer: ANON_KEY, body: cardUpdate('order-A', { invoiceLinkToken: TOKEN_A }) }));
  ok('checkout: a valid Order A token creates a card-update session for Order A', r.status === 200);
  r = track(await call(SC, { bearer: ANON_KEY, body: paymentMode('order-A', { invoiceLinkToken: TOKEN_A }) }));
  ok('checkout: payment mode is retired: even a valid Order A token gets 410 and no session', r.status === 410 && noSessionOrCustomer(r));
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
    const own = await call(SC, { world: w, bearer: ANON_KEY, body: booking('order-fresh2', { bookingToken: BK_FRESH2 }) });
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
    // 5. End state of a completed public booking request: card stored, status pending_review, deposit still UNPAID, no charge.
    const finalOrder = w.tables.orders.find((o) => o.id === 'order-fresh2');
    ok('chain: the completed booking request has a stored card, is pending_review, and the deposit is still unpaid', !!finalOrder.stripe_payment_method_id && finalOrder.status === 'pending_review' && finalOrder.deposit_paid_cents === 0 && finalOrder.deposit_due_cents > 0);
    ok('chain: nothing was charged along the way (no PaymentIntent, no payment-mode session, no payment row)', !stripeUsed(w, 'paymentIntents.create') && !w.stripeCalls.some((c) => c.api === 'checkout.sessions.create' && c.args.mode !== 'setup') && w.tables.payments.length === 0);
    const detailsOwn = await call('complete-booking', { world: w, bearer: ANON_KEY, body: { orderId: 'order-fresh2', sessionId: ownSessionId, action: 'details' } });
    ok('chain: complete-booking then returns that booking\'s details to the session holder', detailsOwn.status === 200 && detailsOwn.json?.success === true && detailsOwn.json?.order?.id === 'order-fresh2' && detailsOwn.json?.isAdminInvoice === false);
    const detailsOnA = await call('complete-booking', { world: w, bearer: ANON_KEY, body: { orderId: 'order-A', sessionId: ownSessionId, action: 'details' } });
    ok('chain: the attacker session cannot read Order A through complete-booking', isDenied(detailsOnA.status) && !detailsOnA.json?.order);
    allWorlds.push(w);
  }

  // ===========================================================================================================
  // complete-booking: post-Stripe completion data (the browser no longer reads orders / customers directly)
  // ===========================================================================================================
  {
    const CB = 'complete-booking';
    const cb = (orderId: string, sessionId: string | undefined, action = 'details') => ({ orderId, ...(sessionId ? { sessionId } : {}), action });
    r = track(await call(CB, { bearer: ANON_KEY, body: cb('order-A', undefined) }));
    ok('complete-booking: no session id is a 400 and reads nothing', r.status === 400 && !r.json?.order);
    r = track(await call(CB, { bearer: ANON_KEY, body: cb('order-A', 'sess_nope') }));
    ok('complete-booking: an unknown session is not proof (401) and returns no order', r.status === 401 && !r.json?.order);
    r = track(await call(CB, { bearer: ANON_KEY, body: cb('order-A', 'sess_open') }));
    ok('complete-booking: an OPEN (incomplete) session is not proof', r.status === 401 && !r.json?.order);
    r = track(await call(CB, { bearer: ANON_KEY, body: cb('order-B', 'sess_A') }));
    ok('complete-booking: Order A\'s completed session cannot read Order B', r.status === 401 && !r.json?.order);
    r = track(await call(CB, { bearer: ANON_KEY, body: cb('order-A', 'sess_A') }));
    ok('complete-booking: Order A\'s completed session reads Order A', r.status === 200 && r.json?.success === true && r.json?.order?.id === 'order-A');
    ok('complete-booking: a read writes nothing and never touches Stripe charges', !wrote(r.w, 'orders') && !stripeUsed(r.w, 'paymentIntents.create'));
    r = track(await call(CB, { bearer: ANON_KEY, body: cb('order-A', 'sess_A', 'mark_confirmation_sent') }));
    ok('complete-booking: mark_confirmation_sent no longer exists as an action - a valid session gets only a read and nothing is written (the server owns the sent state)', r.status === 200 && !wrote(r.w, 'orders') && !!r.json?.order);
    r = track(await call(CB, { bearer: ANON_KEY, body: cb('order-B', 'sess_A', 'mark_confirmation_sent') }));
    ok('complete-booking: the retired mark_confirmation_sent with another order\'s session is refused and writes nothing', r.status === 401 && !wrote(r.w, 'orders'));
    r = track(await call(CB, { bearer: ANON_KEY, body: { orderId: 'order-A', sessionId: 'sess_A', action: 'set_status', status: 'confirmed' } }));
    ok('complete-booking: unknown actions are treated as a read and cannot change status', r.status === 200 && !wrote(r.w, 'orders'));
    allWorlds.push(r.w);
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
  ok('InvoiceAcceptanceView passes the invoice link token exactly', /<CancelOrderModal[\s\S]*?invoiceLinkToken=\{invoiceToken \?\? null\}[\s\S]*?\/>/.test(read('src/components/customer-portal/InvoiceAcceptanceView.tsx')));
  const modal = read('src/components/customer-portal/CancelOrderModal.tsx');
  ok('CancelOrderModal sends the invoice token and the session-or-anon bearer', /invoiceLinkToken \? \{ invoiceLinkToken \} : \{\}/.test(modal) && /getEdgeAuthToken\(\)/.test(modal));
  ok('CancelOrderModal no longer sends the customer email as proof', !/customerEmail/.test(modal.slice(modal.indexOf('JSON.stringify'), modal.indexOf('JSON.stringify') + 300)));
  ok('card-update from PaymentTab carries the order token', /setupMode: true,\s*\.\.\.\(invoiceLinkToken \? \{ invoiceLinkToken \} : \{\}\)/.test(read('src/components/customer-portal/PaymentTab.tsx')));
  ok('card-update from CustomerApprovalModal carries the order token', /setupMode: true,[\s\S]{0,200}\.\.\.\(invoiceLinkToken \? \{ invoiceLinkToken \} : \{\}\)/.test(read('src/components/customer-portal/CustomerApprovalModal.tsx')));
  ok('invoice setup calls from InvoiceAcceptanceView carry the invoice token', (read('src/components/customer-portal/InvoiceAcceptanceView.tsx').match(/invoiceLinkToken: invoiceToken \?\? null/g) ?? []).length >= 2);
  ok('public booking checkout still uses bookingMode (through the booking API, with the booking proof)', /bookingMode: true/.test(read('src/lib/bookingApi.ts')) && /bookingToken: booking\.bookingToken/.test(read('src/lib/bookingApi.ts')) && /startBookingCardSetup/.test(read('src/pages/Checkout.tsx')));
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
  // Static privilege checks: RPC callers and the payment RPC authorization migration
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
  // The refund function no longer calls the order-total RPC at all: the database refund functions are the only writers.
  const refundSrc: string = fs.readFileSync('supabase/functions/stripe-refund/index.ts', 'utf8');
  ok('stripe-refund no longer calls increment_order_refunded_cents (refund totals are written by the database refund functions)', !/increment_order_refunded_cents/.test(refundSrc));
  const refundClient = refundSrc.match(/createClient\([^)]*\)/s);
  ok('stripe-refund builds one plain service-role client and forwards no caller Authorization header to the database', !!refundClient && !/global|Authorization/.test(refundClient[0]));
  ok('stripe-refund is gated to Admin / Master through the verified caller roles', /requireRoles\(caller, STAFF_ADMIN_ROLES/.test(refundSrc));
  // Every function that calls an internal RPC must build that client without a forwarded caller header.
  for (const d of ['record-cash-payment', 'record-check-payment', 'customer-balance-payment', 'reconcile-balance-payment', 'stripe-webhook']) {
    const s: string = fs.readFileSync(`supabase/functions/${d}/index.ts`, 'utf8');
    const m = s.match(/createClient\([^)]*\)/s);
    ok(`${d} builds its Supabase client with the service key and no forwarded header`, !!m && !/global|Authorization/.test(m[0]));
  }

  const mig: string = fs.readFileSync('supabase/migrations/20261007120000_harden_payment_rpc_authorization.sql', 'utf8');
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
