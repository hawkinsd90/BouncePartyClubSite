// Authorization of the outbound notification relays (send-email, send-sms-notification) and the customer confirmation actions.
//
// Layers, labelled so nobody mistakes one for another:
//   HANDLER   the CURRENT Edge Function source is loaded (imports stripped, TypeScript transpiled) and run against an in-memory
//             database, with the REAL shared helpers (auth.ts, portal-actions.ts, customer-notice.ts). Every provider call
//             (Resend, Twilio) is a recording fake: nothing here can reach a network, so LIVE EMAILS SENT = 0 and LIVE SMS SENT = 0.
//   CALLERS   scans the source for every call site of the relays and states, per caller, how it authenticates now.
//   CONFIG    supabase/config.toml.
// Run: node node_modules/jiti/bin/jiti.js src/lib/notificationRelayAuthorization.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');

import * as authHelpers from '../../../../supabase/functions/_shared/auth';
import * as portalActions from '../../../../supabase/functions/_shared/portal-actions';
import * as customerNotice from '../../../../supabase/functions/_shared/customer-notice';
import { confirmationSettled } from '../../booking/confirmationRetry';

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

const SERVICE_KEY = 'svc-key-0123456789abcdef';
const ANON_KEY = 'anon-key-0123456789abcdef';
const ORDER = '11111111-1111-4111-8111-111111111111';
const OTHER_ORDER = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_PHONE = '(555) 555-0101';
const SESSION = 'cs_test_complete';

// ---------------------------------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------------------------------
type Row = Record<string, any>;
interface World {
  tables: Record<string, Row[]>;
  reads: string[];
  writes: Array<{ table: string; op: string; payload?: unknown }>;
  rpcs: Array<{ name: string; args: any }>;
  fetches: Array<{ url: string; init: any }>;
  provider: { resend: number; twilio: number };
  // The clock the modelled claim functions use (milliseconds).
  now: number;
  // Injected database failures for the modelled claim functions: a resolved { error }, a resolved false, or a thrown exception.
  rpcFail?: Record<string, 'error' | 'error_true' | 'false' | 'throw'>;
}

const TOKENS: Record<string, string> = {
  'jwt-customer': 'u-customer',
  'jwt-crew': 'u-crew',
  'jwt-admin': 'u-admin',
  'jwt-master': 'u-master',
  'jwt-norole': 'u-norole',
  'jwt-owner': 'u-owner',
};

function makeWorld(): World {
  return {
    tables: {
      user_roles: [
        { user_id: 'u-customer', role: 'customer' },
        { user_id: 'u-owner', role: 'customer' },
        { user_id: 'u-crew', role: 'crew' },
        { user_id: 'u-admin', role: 'admin' },
        { user_id: 'u-master', role: 'master' },
      ],
      customers: [{ id: 'c1', first_name: 'Ann', last_name: 'Lee', email: 'ann@example.test', phone: CUSTOMER_PHONE, user_id: 'u-owner' }],
      orders: [
        { id: ORDER, customer_id: 'c1', status: 'confirmed', event_date: '2030-06-01', event_address_line1: '1 Main St', has_pets: false, booking_confirmation_sent: false },
        { id: OTHER_ORDER, customer_id: 'c1', status: 'draft', event_date: '2030-07-01', event_address_line1: '2 Main St', has_pets: false, booking_confirmation_sent: false },
      ],
      admin_settings: [
        { key: 'resend_api_key', value: 're_test_key' },
        { key: 'business_name', value: 'Bounce Party Club' },
        { key: 'business_email', value: 'info@example.test' },
        { key: 'twilio_account_sid', value: 'ACtest' },
        { key: 'twilio_auth_token', value: 'tok' },
        { key: 'twilio_from_number', value: '+15550001111' },
        { key: 'admin_phone', value: '+15557770000' },
        { key: 'admin_notification_phone', value: '+15557770001' },
        { key: 'admin_email', value: 'admin@example.test' },
        { key: 'stripe_secret_key', value: 'sk_test_x' },
      ],
      email_templates: [{ template_name: 'pickup_complete', subject: 'Thanks {customer_first_name}', content_template: '<p>Hi {customer_first_name}</p>', header_title: 'Thanks' }],
      sms_message_templates: [
        { template_key: 'pickup_thanks_sms', message_template: 'Thanks {name}' },
        { template_key: 'booking_received_admin', message_template: 'New booking {order_id}' },
        { template_key: 'lot_pictures_uploaded_admin', message_template: 'Lot pictures for {order_id}' },
        { template_key: 'order_cancellation_admin', message_template: 'Cancelled {order_id}' },
      ],
      sms_conversations: [],
      invoice_links: [],
    },
    reads: [],
    writes: [],
    rpcs: [],
    fetches: [],
    provider: { resend: 0, twilio: 0 },
    now: 1_800_000_000_000,
  };
}

function makeClient(w: World): any {
  return {
    auth: {
      getUser: async (token?: string) => {
        const id = token ? TOKENS[token] : undefined;
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
      },
    },
    rpc: async (name: string, args: any) => {
      w.rpcs.push({ name, args });
      const injected = w.rpcFail?.[name];
      if (injected === 'throw') throw new Error('database unavailable');
      if (injected === 'error') return { data: null, error: { message: 'database unavailable', code: '57P01' } };
      // A defensive case: an error that arrives together with a truthy data value must still not count as success.
      if (injected === 'error_true') return { data: true, error: { message: 'database unavailable', code: '57P01' } };
      if (injected === 'false') return { data: false, error: null };
      // A model of the three booking-confirmation claim functions (the real ones are executed against Postgres in
      // bookingConfirmationClaim.test.ts). Atomic: each call runs to completion before another starts.
      const order = w.tables.orders.find((o) => o.id === args?.p_order_id);
      if (name === 'claim_booking_confirmation') {
        if (!order || order.status === 'draft') return { data: 'invalid', error: null };
        if (order.booking_confirmation_sent) return { data: 'already_sent', error: null };
        const stale = order.booking_confirmation_claimed_at == null || order.booking_confirmation_claimed_at < w.now - args.p_stale_seconds * 1000;
        if (order.booking_confirmation_claim_id == null || stale) {
          order.booking_confirmation_claim_id = args.p_claim_id;
          order.booking_confirmation_claimed_at = w.now;
          return { data: 'claimed', error: null };
        }
        return { data: 'busy', error: null };
      }
      if (name === 'finalize_booking_confirmation' || name === 'release_booking_confirmation') {
        if (!order || order.booking_confirmation_sent || order.booking_confirmation_claim_id !== args.p_claim_id) return { data: false, error: null };
        if (name === 'finalize_booking_confirmation') order.booking_confirmation_sent = true;
        order.booking_confirmation_claim_id = null;
        order.booking_confirmation_claimed_at = null;
        return { data: true, error: null };
      }
      return { data: 'id', error: null };
    },
    from(table: string) {
      w.reads.push(table);
      const filters: Array<[string, string, unknown]> = [];
      let wantRows = false;
      let mode: 'select' | 'insert' | 'update' = 'select';
      let payload: any = null;
      let selectStr = '*';
      const rows = (): Row[] =>
        (w.tables[table] ?? [])
          .filter((r) => filters.every(([op, c, v]) => (op === 'eq' ? r[c] === v : op === 'neq' ? r[c] !== v : (v as unknown[]).includes(r[c]))))
          .map((r) => (table === 'orders' && /customers\(/.test(selectStr) ? { ...r, customers: w.tables.customers.find((c) => c.id === r.customer_id) ?? null } : r));
      const q: any = {
        select(s?: string) {
          if (s) selectStr = s;
          if (mode === 'update') wantRows = true;
          return q;
        },
        neq: (c: string, v: unknown) => (filters.push(['neq', c, v]), q),
        eq: (c: string, v: unknown) => (filters.push(['eq', c, v]), q),
        in: (c: string, v: unknown[]) => (filters.push(['in', c, v]), q),
        insert: (p: unknown) => ((mode = 'insert'), (payload = p), q),
        update: (p: unknown) => ((mode = 'update'), (payload = p), q),
        async maybeSingle() {
          return { data: rows()[0] ?? null, error: null };
        },
        then(resolve: any, reject: any) {
          if (mode === 'insert') {
            w.writes.push({ table, op: 'insert', payload });
            (w.tables[table] ??= []).push(...(Array.isArray(payload) ? payload : [payload]));
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          if (mode === 'update') {
            w.writes.push({ table, op: 'update', payload });
            const touched = rows();
            for (const r of touched) Object.assign(r, payload);
            return Promise.resolve(wantRows ? { data: touched.map((r) => ({ id: r.id })), error: null } : { error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

function loadFn(fnDir: string, w: World, extra: Record<string, unknown> = {}): (req: Request) => Promise<Response> {
  const src: string = read(`supabase/functions/${fnDir}/index.ts`);
  const js: string = ts.transpileModule(src.replace(/^import[^;]*;/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  let captured: any = null;
  const env: Record<string, string> = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY };
  const quiet = { log: () => {}, info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => env[k] }, serve: (fn: any) => { captured = fn; } },
    createClient: () => makeClient(w),
    console: quiet,
    fetch: async (url: string, init: any) => {
      w.fetches.push({ url, init });
      if (String(url).includes('api.resend.com')) {
        w.provider.resend++;
        return { ok: true, status: 200, json: async () => ({ id: 're_1' }), text: async () => '' };
      }
      if (String(url).includes('api.twilio.com')) {
        w.provider.twilio++;
        return { ok: true, status: 201, json: async () => ({ sid: 'SM1', status: 'queued' }), text: async () => '' };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, emailSent: true }), text: async () => '' };
    },
    formatOrderId: (id: string) => `#${String(id).slice(0, 8)}`,
    checkRateLimit: async () => ({ allowed: true }),
    createRateLimitResponse: () => new Response('rate limited', { status: 429 }),
    getIdentifier: () => '203.0.113.9',
    buildRateLimitKey: (...a: unknown[]) => a.join(':'),
    Stripe: class {
      checkout = {
        sessions: {
          retrieve: async (id: string) => (id === SESSION ? { id, status: 'complete', mode: 'payment', payment_status: 'paid', metadata: { order_id: ORDER } } : null),
        },
      };
    },
    ...authHelpers,
    ...portalActions,
    ...customerNotice,
    ...extra,
  };
  const imported = new Set<string>();
  for (const m of src.matchAll(/^import([^;]*);/gm)) {
    for (const id of m[1].replace(/from\s+['"][^'"]*['"]/, '').match(/[A-Za-z_$][\w$]*/g) ?? []) imported.add(id);
  }
  const names = Object.keys(scope).filter((n) => ['Deno', 'console', 'fetch'].includes(n) || imported.has(n));
  new Function(...names, js)(...names.map((n) => scope[n]));
  if (!captured) throw new Error(`${fnDir}: Deno.serve was not called`);
  return captured;
}

async function call(fnDir: string, bearer: string | null, body: unknown, w: World = makeWorld()) {
  const handler = loadFn(fnDir, w);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer !== null) headers.Authorization = `Bearer ${bearer}`;
  const res = await handler(new Request('https://fake.functions/x', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  let json: any = null;
  try {
    json = await res.clone().json();
  } catch {
    json = null;
  }
  return { status: res.status, json, w };
}

// Everything that proves a request did something: a provider request, a stored message, a success/failure log, a secondary call.
const sideEffects = (w: World) => ({
  provider: w.provider.resend + w.provider.twilio,
  rpcs: w.rpcs.length,
  writes: w.writes.length,
  fetches: w.fetches.length,
  settingsReads: w.reads.filter((t) => t === 'admin_settings' || t === 'email_templates' || t === 'sms_message_templates').length,
});
const NONE = { provider: 0, rpcs: 0, writes: 0, fetches: 0, settingsReads: 0 };

(async () => {
  // =====================================================================================================================
  // HANDLER: the two relays
  // =====================================================================================================================
  const EMAIL_ARBITRARY = { to: 'victim@elsewhere.test', subject: 'Your account', html: '<p>Click here</p>' };
  const EMAIL_TEMPLATE = { templateName: 'pickup_complete', orderId: ORDER };
  const SMS_ARBITRARY = { to: '+15559998888', message: 'Pay at evil.test' };
  const SMS_TEMPLATE = { templateKey: 'pickup_thanks_sms', orderId: ORDER };
  const SMS_CUSTOMER = { to: '555-555-0101', message: 'We are on the way', orderId: ORDER };

  const relays = [
    { name: 'send-email', arbitrary: EMAIL_ARBITRARY, template: EMAIL_TEMPLATE, provider: 'resend' as const },
    { name: 'send-sms-notification', arbitrary: SMS_ARBITRARY, template: SMS_TEMPLATE, provider: 'twilio' as const },
  ];

  for (const relay of relays) {
    // ---- denied before any side effect ----
    const denied: Array<[string, string | null, number]> = [
      ['no Authorization header', null, 401],
      ['the public anon key only', ANON_KEY, 401],
      ['a made-up bearer token', 'made-up-token', 401],
      ['an invalid / expired JWT', 'eyJhbGciOiJIUzI1NiJ9.expired.signature', 401],
      ['an empty bearer', '', 401],
      ['an ordinary customer', 'jwt-customer', 403],
      ['a signed-in user with no role row', 'jwt-norole', 403],
      ['the owner of the order (a customer)', 'jwt-owner', 403],
      ['Crew sending to an outside recipient', 'jwt-crew', 403],
    ];
    for (const [label, bearer, status] of denied) {
      const r = await call(relay.name, bearer, relay.arbitrary);
      eq(`${relay.name}: ${label} is refused (${status})`, r.status, status);
      eq(`${relay.name}: ${label} causes no provider call, message, log, downstream call or settings read`, sideEffects(r.w), NONE);
      ok(`${relay.name}: ${label} gets no provider details back`, !/re_|SM1|queued|messageId|messageSid/.test(JSON.stringify(r.json)));
    }

    // Customers and the anon key cannot send a stored template for a real order either.
    for (const bearer of [ANON_KEY, 'jwt-customer', 'jwt-owner', null]) {
      const r = await call(relay.name, bearer, relay.template);
      ok(`${relay.name}: a template request from ${bearer ?? 'nobody'} (not staff / backend) is refused and sends nothing`, (r.status === 401 || r.status === 403) && JSON.stringify(sideEffects(r.w)) === JSON.stringify(NONE));
    }

    // A request body cannot grant itself access.
    for (const claim of [{ role: 'admin' }, { admin: true }, { service: true }, { role: 'service_role' }, { userId: 'u-admin' }, { user: { role: 'master' } }]) {
      const r = await call(relay.name, ANON_KEY, { ...relay.arbitrary, ...claim });
      ok(`${relay.name}: a claim in the body (${JSON.stringify(claim)}) does not authorize the anon key`, r.status === 401 && JSON.stringify(sideEffects(r.w)) === JSON.stringify(NONE));
    }
    // A signed-in user without a staff role cannot promote themselves with a claim in the body either.
    for (const bearer of ['jwt-customer', 'jwt-owner', 'jwt-crew']) {
      for (const claim of [{ role: 'admin' }, { admin: true }, { service: true }, { role: 'master' }, { isAdmin: true }]) {
        const r = await call(relay.name, bearer, { ...relay.arbitrary, ...claim });
        ok(`${relay.name}: ${bearer} cannot become staff or the backend by claiming ${JSON.stringify(claim)}`, r.status === 403 && r.w.provider.resend + r.w.provider.twilio === 0 && r.w.rpcs.length === 0);
      }
    }
    // A token that merely LOOKS like the service key is not the service key.
    for (const bearer of [SERVICE_KEY + 'x', SERVICE_KEY.slice(0, -1), SERVICE_KEY.toUpperCase()]) {
      const r = await call(relay.name, bearer, relay.arbitrary);
      ok(`${relay.name}: a near-miss of the service key is refused`, r.status === 401 && JSON.stringify(sideEffects(r.w)) === JSON.stringify(NONE));
    }
    // Malformed bodies from an unauthorized caller stay side-effect free as well.
    {
      const r = await call(relay.name, ANON_KEY, '{not json');
      ok(`${relay.name}: unparsable JSON from the anon key sends nothing and logs nothing`, JSON.stringify(sideEffects(r.w)) === JSON.stringify(NONE));
      const r2 = await call(relay.name, null, 'null');
      ok(`${relay.name}: a null body from nobody sends nothing and logs nothing`, JSON.stringify(sideEffects(r2.w)) === JSON.stringify(NONE));
    }

    // ---- allowed ----
    for (const [label, bearer] of [['the service role (trusted backend)', SERVICE_KEY], ['an Admin', 'jwt-admin'], ['a Master', 'jwt-master']] as Array<[string, string]>) {
      for (const [shape, body] of [['an arbitrary recipient', relay.arbitrary], ['a stored template for an order', relay.template]] as Array<[string, any]>) {
        const r = await call(relay.name, bearer, body);
        const s = sideEffects(r.w);
        ok(`${relay.name}: ${label} may send ${shape} (200, one provider call, success recorded)`, r.status === 200 && s.provider === 1 && r.w.rpcs.filter((x) => x.name === 'record_notification_success').length === 1);
      }
    }
    // Crew: only an order's own customer.
    {
      const r = await call(relay.name, 'jwt-crew', relay.template);
      ok(`${relay.name}: Crew may send a stored template for an existing order`, r.status === 200 && r.w.provider[relay.provider] === 1);
      const r2 = await call(relay.name, 'jwt-crew', { ...relay.template, orderId: '33333333-3333-4333-8333-333333333333' });
      ok(`${relay.name}: Crew cannot use a template for an order that does not exist`, r2.status === 403 && JSON.stringify(sideEffects(r2.w)) === JSON.stringify({ ...NONE }));
      const r3 = await call(relay.name, 'jwt-crew', { ...relay.template, orderId: 'not-a-uuid' });
      ok(`${relay.name}: Crew cannot use a malformed order id`, r3.status === 403 && r3.w.provider.resend + r3.w.provider.twilio === 0);
      const r4 = await call(relay.name, 'jwt-crew', { ...relay.arbitrary, orderId: ORDER });
      ok(`${relay.name}: Crew cannot send an arbitrary recipient even with a real order id`, r4.status === 403 && r4.w.provider.resend + r4.w.provider.twilio === 0 && r4.w.rpcs.length === 0);
    }
    // Staff roles are read from the database, not from the token's own claims.
    {
      const w = makeWorld();
      w.tables.user_roles = w.tables.user_roles.filter((x) => x.user_id !== 'u-admin');
      const r = await call(relay.name, 'jwt-admin', relay.arbitrary, w);
      ok(`${relay.name}: a user whose Admin role row is gone is refused (the role is a database fact)`, r.status === 403 && r.w.provider.resend + r.w.provider.twilio === 0);
      const w2 = makeWorld();
      w2.tables.user_roles.find((x) => x.user_id === 'u-customer')!.role = 'ADMIN';
      const r2 = await call(relay.name, 'jwt-customer', relay.arbitrary, w2);
      ok(`${relay.name}: a role stored in another casing is still honoured (roles are lower-cased)`, r2.status === 200);
    }
  }

  // ---- Crew SMS in detail ----
  {
    const r = await call('send-sms-notification', 'jwt-crew', SMS_CUSTOMER);
    ok('send-sms-notification: Crew may text the customer of the order (the En Route / Arrived / Drop-off message)', r.status === 200 && r.w.provider.twilio === 1);
    eq('send-sms-notification: ... and the number texted is the order\'s customer', r.w.fetches.find((f) => String(f.url).includes('twilio'))!.init.body.includes('To=%2B15555550101'), true);
    for (const [label, body] of [
      ['a different number', { ...SMS_CUSTOMER, to: '+15559998888' }],
      ['a number that shares the area code and exchange', { ...SMS_CUSTOMER, to: '555-555-0199' }],
      ['a number that differs only in its first digits', { ...SMS_CUSTOMER, to: '999-555-0101' }],
      ['too short a number', { ...SMS_CUSTOMER, to: '0101' }],
      ['no order id', { to: '555-555-0101', message: 'hi' }],
      ['an empty message', { ...SMS_CUSTOMER, message: '   ' }],
      ['media attachments', { ...SMS_CUSTOMER, mediaUrls: ['https://example.test/a.png'] }],
      ['an unknown extra field', { ...SMS_CUSTOMER, from: '+15550000000' }],
      ['a template plus a recipient', { ...SMS_TEMPLATE, to: '+15559998888' }],
    ] as Array<[string, any]>) {
      const r2 = await call('send-sms-notification', 'jwt-crew', body);
      ok(`send-sms-notification: Crew is refused ${label}`, r2.status === 403 && r2.w.provider.twilio === 0 && r2.w.rpcs.length === 0);
    }
    const emptyMedia = await call('send-sms-notification', 'jwt-crew', { ...SMS_CUSTOMER, mediaUrls: [] });
    ok('send-sms-notification: Crew may send the drop-off message with an empty media list', emptyMedia.status === 200 && emptyMedia.w.provider.twilio === 1);
  }

  // ---- Crew email in detail ----
  {
    for (const [label, body] of [
      ['a raw recipient', { ...EMAIL_TEMPLATE, to: 'victim@elsewhere.test' }],
      ['raw html', { ...EMAIL_TEMPLATE, html: '<p>x</p>' }],
      ['a custom sender', { ...EMAIL_TEMPLATE, from: 'ceo@bouncepartyclub.com' }],
      ['a reply-to', { ...EMAIL_TEMPLATE, replyTo: 'attacker@example.test' }],
      ['attachments', { ...EMAIL_TEMPLATE, attachments: [{ filename: 'a.pdf', content: 'AAA' }] }],
      ['no template', { orderId: ORDER }],
    ] as Array<[string, any]>) {
      const r = await call('send-email', 'jwt-crew', body);
      ok(`send-email: Crew is refused ${label}`, r.status === 403 && r.w.provider.resend === 0 && r.w.rpcs.length === 0);
    }
  }

  // ---- payload checks run after authorization and before the provider ----
  {
    const badEmails: Array<[string, any]> = [
      ['a recipient with a line break', { ...EMAIL_ARBITRARY, to: 'a@b.test\nbcc: x@y.test' }],
      ['a subject with a line break', { ...EMAIL_ARBITRARY, subject: 'hi\r\nbcc: x@y.test' }],
      ['an oversized recipient', { ...EMAIL_ARBITRARY, to: 'a'.repeat(400) + '@b.test' }],
      ['a non-string recipient', { ...EMAIL_ARBITRARY, to: ['a@b.test', 'c@d.test'] }],
      ['too many attachments', { ...EMAIL_ARBITRARY, attachments: Array.from({ length: 6 }, () => ({ filename: 'a', content: 'b' })) }],
      ['a malformed attachment', { ...EMAIL_ARBITRARY, attachments: [{ filename: 5, content: 'b' }] }],
    ];
    for (const [label, body] of badEmails) {
      const r = await call('send-email', SERVICE_KEY, body);
      ok(`send-email: an authorized caller sending ${label} gets 400 and no provider call`, r.status === 400 && r.w.provider.resend === 0 && r.w.rpcs.length === 0);
    }
    const badSms: Array<[string, any]> = [
      ['a non-string recipient', { to: 5551234567, message: 'x' }],
      ['an oversized message', { to: '+15559998888', message: 'x'.repeat(1601) }],
      ['plain-http media', { to: '+15559998888', message: 'x', mediaUrls: ['http://example.test/a.png'] }],
      ['too much media', { to: '+15559998888', message: 'x', mediaUrls: Array.from({ length: 11 }, () => 'https://example.test/a.png') }],
      ['non-string media', { to: '+15559998888', message: 'x', mediaUrls: [5] }],
    ];
    for (const [label, body] of badSms) {
      const r = await call('send-sms-notification', SERVICE_KEY, body);
      ok(`send-sms-notification: an authorized caller sending ${label} gets 400 and no Twilio call`, r.status === 400 && r.w.provider.twilio === 0 && r.w.rpcs.length === 0);
    }
    const good = await call('send-email', SERVICE_KEY, { ...EMAIL_ARBITRARY, replyTo: 'cust@example.test', attachments: [{ filename: 'waiver.pdf', content: 'AAAA' }] });
    ok('send-email: a normal backend email with a reply-to and an attachment still goes out', good.status === 200 && good.w.provider.resend === 1);
    const goodSms = await call('send-sms-notification', SERVICE_KEY, { to: '+15559998888', message: 'x', mediaUrls: ['https://example.test/a.png'] });
    ok('send-sms-notification: a normal backend text with media still goes out', goodSms.status === 200 && goodSms.w.provider.twilio === 1);
  }

  // ---- error handling: only an authorized request may record failures or trigger the admin fallback ----
  {
    const w = makeWorld();
    w.tables.admin_settings = w.tables.admin_settings.filter((s) => s.key !== 'resend_api_key');
    const authorized = await call('send-email', SERVICE_KEY, EMAIL_ARBITRARY, w);
    ok('send-email: an authorized request that fails (no provider key) is still recorded as a failure', authorized.status === 500 && authorized.w.rpcs.some((x) => x.name === 'record_notification_failure'));
    const w2 = makeWorld();
    w2.tables.admin_settings = w2.tables.admin_settings.filter((s) => s.key !== 'resend_api_key');
    const refused = await call('send-email', ANON_KEY, EMAIL_ARBITRARY, w2);
    ok('send-email: the same request from the anon key records nothing and sends no fallback', refused.status === 401 && refused.w.rpcs.length === 0 && refused.w.fetches.length === 0);
    const w3 = makeWorld();
    w3.tables.admin_settings = w3.tables.admin_settings.filter((s) => !s.key.startsWith('twilio'));
    const smsAuthorized = await call('send-sms-notification', SERVICE_KEY, SMS_ARBITRARY, w3);
    ok('send-sms-notification: an authorized request with no Twilio config is still recorded as a failure', smsAuthorized.w.rpcs.some((x) => x.name === 'record_notification_failure'));
    const w4 = makeWorld();
    w4.tables.admin_settings = w4.tables.admin_settings.filter((s) => !s.key.startsWith('twilio'));
    const smsRefused = await call('send-sms-notification', ANON_KEY, SMS_ARBITRARY, w4);
    ok('send-sms-notification: the same request from the anon key records nothing and sends no fallback email', smsRefused.status === 401 && smsRefused.w.rpcs.length === 0 && smsRefused.w.fetches.length === 0);
  }

  // ---- Crew stored templates: only the two the task flow uses ----
  {
    const nothing = (r: { w: World }) => r.w.provider.resend + r.w.provider.twilio === 0 && r.w.writes.length === 0 && r.w.rpcs.length === 0 && r.w.fetches.length === 0;
    const ok200 = (r: { status: number; w: World }, provider: 'resend' | 'twilio') => r.status === 200 && r.w.provider[provider] === 1;
    ok('crew: pickup_thanks_sms for a real order is allowed', ok200(await call('send-sms-notification', 'jwt-crew', { templateKey: 'pickup_thanks_sms', orderId: ORDER }), 'twilio'));
    ok('crew: pickup_complete for a real order is allowed', ok200(await call('send-email', 'jwt-crew', { templateName: 'pickup_complete', orderId: ORDER }), 'resend'));
    ok("crew: a raw text to the order customer's phone is allowed", ok200(await call('send-sms-notification', 'jwt-crew', SMS_CUSTOMER), 'twilio'));
    for (const key of ['booking_received_admin', 'lot_pictures_uploaded_admin', 'order_cancellation_admin']) {
      const r = await call('send-sms-notification', 'jwt-crew', { templateKey: key, orderId: ORDER });
      ok(`crew: the Admin template ${key} is denied with no provider call, write, RPC or secondary call`, r.status === 403 && nothing(r));
    }
    for (const key of ['pickup_reminder_sms', 'on_the_way_sms', 'PICKUP_THANKS_SMS', 'pickup_thanks_sms ', '', 'pickup_thanks_sms,booking_received_admin']) {
      const r = await call('send-sms-notification', 'jwt-crew', { templateKey: key, orderId: ORDER });
      ok(`crew: the SMS template ${JSON.stringify(key)} is denied`, r.status === 403 && nothing(r));
    }
    for (const key of [['array', ['pickup_thanks_sms']], ['number', 5], ['null', null]] as Array<[string, any]>) {
      const r = await call('send-sms-notification', 'jwt-crew', { templateKey: key[1], orderId: ORDER });
      ok(`crew: a non-string SMS template (${key[0]}) is denied`, r.status === 403 && nothing(r));
    }
    for (const name of ['booking_confirmation', 'order_cancelled', 'PICKUP_COMPLETE', 'pickup_complete ', '', 'invoice_ready']) {
      const r = await call('send-email', 'jwt-crew', { templateName: name, orderId: ORDER });
      ok(`crew: the email template ${JSON.stringify(name)} is denied`, r.status === 403 && nothing(r));
    }
    for (const odd of [['array', ['booking_received_admin']], ['number', 5], ['null', null], ['object', { a: 1 }], ['true', true]] as Array<[string, any]>) {
      const r = await call('send-sms-notification', 'jwt-crew', { ...SMS_CUSTOMER, templateKey: odd[1] });
      ok(`crew: a valid raw text that also carries a non-string templateKey (${odd[0]}) is denied`, r.status === 403 && nothing(r));
    }
    const rawEmail = await call('send-email', 'jwt-crew', { to: 'ann@example.test', subject: 'x', html: '<p>x</p>', orderId: ORDER });
    ok('crew: a raw email is denied', rawEmail.status === 403 && nothing(rawEmail));
    const media = await call('send-sms-notification', 'jwt-crew', { ...SMS_CUSTOMER, mediaUrls: ['https://example.test/a.png'] });
    ok('crew: a media attachment is denied', media.status === 403 && nothing(media));
    const outside = await call('send-sms-notification', 'jwt-crew', { ...SMS_CUSTOMER, to: '+15559998888' });
    ok('crew: a raw text to an outside phone is denied', outside.status === 403 && nothing(outside));
    // Admin / Master / service keep every template.
    for (const bearer of ['jwt-admin', 'jwt-master', SERVICE_KEY]) {
      const who = bearer === SERVICE_KEY ? 'service' : bearer;
      for (const key of ['booking_received_admin', 'lot_pictures_uploaded_admin', 'order_cancellation_admin', 'pickup_thanks_sms']) {
        ok(`staff / backend (${who}) may still use the template ${key}`, ok200(await call('send-sms-notification', bearer, { templateKey: key, orderId: ORDER }), 'twilio'));
      }
      ok(`staff / backend (${who}) may still use the email template`, ok200(await call('send-email', bearer, { templateName: 'pickup_complete', orderId: ORDER }), 'resend'));
    }
  }

  // ---- an unexpected error before the caller is authorized must not be recorded or trigger the admin fallback ----
  for (const [name, body] of [['send-email', EMAIL_ARBITRARY], ['send-sms-notification', SMS_ARBITRARY]] as Array<[string, any]>) {
    const w = makeWorld();
    const handler = loadFn(name, w, { authorizeRelayCaller: async () => { throw new Error('authorization backend unavailable'); } });
    const res = await handler(new Request('https://fake.functions/x', { method: 'POST', headers: { Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    ok(`${name}: if the authorization check itself fails, the request fails closed with no provider call, no failure row and no admin fallback`, res.status === 500 && w.provider.resend + w.provider.twilio === 0 && w.rpcs.length === 0 && w.fetches.length === 0);
  }

  // ---- OPTIONS preflight is unchanged ----
  for (const name of ['send-email', 'send-sms-notification']) {
    const handler = loadFn(name, makeWorld());
    const res = await handler(new Request('https://fake.functions/x', { method: 'OPTIONS' }));
    eq(`${name}: the CORS preflight still answers 200 without credentials`, res.status, 200);
  }

  // =====================================================================================================================
  // HANDLER: customer confirmation actions (the replacement for browser-side relay calls)
  // =====================================================================================================================
  const NOTICE = { emailSubject: 'Booking Confirmed', emailHtml: '<p>Thanks</p>', smsMessage: 'Confirmed!' };
  const relayCalls = (w: World) => w.fetches.filter((f) => /functions\/v1\/send-(email|sms-notification)/.test(String(f.url)));
  {
    // complete-booking: send_confirmation
    const body = (extra: Record<string, unknown> = {}) => ({ orderId: ORDER, sessionId: SESSION, action: 'send_confirmation', notice: NOTICE, ...extra });
    const r = await call('complete-booking', ANON_KEY, body());
    ok('complete-booking: with the completed Stripe session the confirmation is sent', r.status === 200 && r.json?.success === true);
    const calls = relayCalls(r.w);
    eq('complete-booking: one email and one text are requested from the relays', calls.map((c) => c.url.split('/').pop()).sort(), ['send-email', 'send-sms-notification']);
    const emailCall = calls.find((c) => c.url.endsWith('send-email'))!;
    const emailBody = JSON.parse(emailCall.init.body);
    eq('complete-booking: the email goes to the customer ON THE ORDER', emailBody.to, 'ann@example.test');
    eq('complete-booking: the relay is called as the backend (service-role key)', emailCall.init.headers.Authorization, `Bearer ${SERVICE_KEY}`);
    eq('complete-booking: the text goes to the customer\'s phone on the order', JSON.parse(calls.find((c) => c.url.endsWith('send-sms-notification'))!.init.body).to, CUSTOMER_PHONE);
    // The browser cannot choose the recipient.
    const spoof = await call('complete-booking', ANON_KEY, body({ notice: { ...NOTICE, to: 'victim@elsewhere.test' } }));
    ok('complete-booking: a notice carrying a recipient is rejected and sends nothing', spoof.status === 400 && relayCalls(spoof.w).length === 0);
    const spoof2 = await call('complete-booking', ANON_KEY, body({ to: 'victim@elsewhere.test', email: 'victim@elsewhere.test' }));
    ok('complete-booking: top-level recipient fields are ignored (still the order\'s customer)', JSON.parse(relayCalls(spoof2.w).find((c) => c.url.endsWith('send-email'))!.init.body).to === 'ann@example.test');
    for (const [label, bearer, order, session] of [
      ['no Stripe session', ANON_KEY, ORDER, undefined],
      ['another order\'s session', ANON_KEY, OTHER_ORDER, SESSION],
      ['an unknown session', ANON_KEY, ORDER, 'cs_nope'],
    ] as Array<[string, string, string, string | undefined]>) {
      const bad = await call('complete-booking', bearer, { orderId: order, ...(session ? { sessionId: session } : {}), action: 'send_confirmation', notice: NOTICE });
      ok(`complete-booking: ${label} is not proof, so nothing is sent`, bad.status >= 400 && relayCalls(bad.w).length === 0);
    }
    const invalid = await call('complete-booking', ANON_KEY, body({ notice: { emailSubject: 'x' } }));
    ok('complete-booking: an email without a body is rejected', invalid.status === 400 && relayCalls(invalid.w).length === 0);
    const w = makeWorld();
    w.tables.orders.find((o) => o.id === ORDER)!.booking_confirmation_sent = true;
    const already = await call('complete-booking', ANON_KEY, body(), w);
    ok('complete-booking: once the confirmation is marked sent nothing more is sent (no repeat spam)', already.status === 200 && already.json?.alreadySent === true && relayCalls(already.w).length === 0);
    // ---- the claim model: unsent -> in progress -> delivered / released ----
    {
      const row = (w: World) => w.tables.orders.find((o) => o.id === ORDER)!;
      const state = (w: World) => ({ sent: row(w).booking_confirmation_sent, claimed: row(w).booking_confirmation_claim_id != null });
      const gateFetch = (w: World, gate: Promise<void>, mode: 'email-fails' | 'ok') => async (url: string, init?: any) => {
        w.fetches.push({ url, init });
        await gate;
        if (mode === 'email-fails' && String(url).endsWith('send-email')) return { ok: false, status: 502, json: async () => ({}), text: async () => '' };
        return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '' };
      };
      const request = async (w: World, fetchImpl?: any, notice: unknown = NOTICE, bearer = ANON_KEY, session = SESSION) => {
        const handler = loadFn('complete-booking', w, fetchImpl ? { fetch: fetchImpl } : {});
        const res = await handler(new Request('https://x/y', { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: ORDER, sessionId: session, action: 'send_confirmation', notice }) }));
        return { status: res.status, json: await res.json() };
      };
      const sends = (w: World) => relayCalls(w).length;

      // fresh unsent order
      const w0 = makeWorld();
      ok('claim: the world starts unsent and unclaimed', JSON.stringify(state(w0)) === JSON.stringify({ sent: false, claimed: false }));
      const first = await request(w0);
      ok('claim: the first request acquires the claim, sends the email and the text, and finalizes', first.status === 200 && first.json.emailSent === true && sends(w0) === 2 && JSON.stringify(state(w0)) === JSON.stringify({ sent: true, claimed: false }));
      ok('claim: the claim id the server generated is a random UUID and was used to claim and then to finalize', (() => {
        const claim = w0.rpcs.find((r) => r.name === 'claim_booking_confirmation')!;
        const fin = w0.rpcs.find((r) => r.name === 'finalize_booking_confirmation')!;
        return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claim.args.p_claim_id) && fin.args.p_claim_id === claim.args.p_claim_id && claim.args.p_stale_seconds === 600;
      })());
      const again = await request(w0);
      ok('claim: a sequential replay gets alreadySent with zero additional provider calls', again.json.alreadySent === true && sends(w0) === 2);
      for (let i = 0; i < 3; i++) await request(w0);
      eq('claim: four replays later there is still exactly one email and one text', relayCalls(w0).map((c) => c.url.split('/').pop()).sort(), ['send-email', 'send-sms-notification']);

      // five concurrent calls: one owner, the others busy, none falsely sent
      const wc = makeWorld();
      let open!: () => void;
      const gate = new Promise<void>((r) => { open = r; });
      const results = Promise.all([1, 2, 3, 4, 5].map(() => request(wc, gateFetch(wc, gate, 'ok'))));
      await new Promise((r) => setTimeout(r, 20));
      ok('claim: while the owner is still sending, the order is in progress and NOT marked sent', JSON.stringify(state(wc)) === JSON.stringify({ sent: false, claimed: true }));
      open();
      const all = await results;
      const owners = all.filter((r) => r.json.emailSent === true && r.json.alreadySent !== true);
      const busy = all.filter((r) => r.json.busy === true);
      ok('claim: five concurrent calls produce exactly one owner and four busy answers', owners.length === 1 && busy.length === 4);
      ok('claim: every busy answer is not "sent" and not "alreadySent"', busy.every((r) => r.json.emailSent === false && r.json.alreadySent === false));
      eq('claim: five concurrent calls send one email and one text in total', relayCalls(wc).map((c) => c.url.split('/').pop()).sort(), ['send-email', 'send-sms-notification']);
      ok('claim: afterwards the order is delivered and unclaimed', JSON.stringify(state(wc)) === JSON.stringify({ sent: true, claimed: false }));

      // concurrent failure: A fails while B arrives
      const wf = makeWorld();
      let openA!: () => void;
      const gateA = new Promise<void>((r) => { openA = r; });
      const aPromise = request(wf, gateFetch(wf, gateA, 'email-fails'));
      await new Promise((r) => setTimeout(r, 20));
      const sendsBeforeB = sends(wf);
      const b = await request(wf);
      ok('failure: B arrives while A is in progress and is told busy - never emailSent / alreadySent - and sends nothing itself', b.json.busy === true && b.json.emailSent === false && b.json.alreadySent === false && sends(wf) === sendsBeforeB);
      openA();
      const a = await aPromise;
      ok('failure: A\'s provider failure is reported and its claim is released (not sent, no claim)', a.json.emailSent === false && JSON.stringify(state(wf)) === JSON.stringify({ sent: false, claimed: false }));
      const retried = await request(wf);
      ok('failure: a later retry succeeds and finalizes', retried.json.emailSent === true && JSON.stringify(state(wf)) === JSON.stringify({ sent: true, claimed: false }));

      ok('claim ids: every request generates its own fresh id (the failed attempt and its retry never share one)', (() => { const ids = wf.rpcs.filter((r) => r.name === 'claim_booking_confirmation').map((r) => r.args.p_claim_id); return ids.length === 3 && new Set(ids).size === 3; })());
      {
        const wi = makeWorld();
        const forged = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
        const handler = loadFn('complete-booking', wi);
        await handler(new Request('https://x/y', { method: 'POST', headers: { Authorization: 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: ORDER, sessionId: SESSION, action: 'send_confirmation', notice: NOTICE, claimId: forged, p_claim_id: forged }) }));
        const used = wi.rpcs.filter((r) => String(r.name).endsWith('_booking_confirmation')).map((r) => r.args.p_claim_id);
        ok('claim ids: a claim id supplied by the browser is ignored (the server generates it)', used.length === 2 && !used.includes(forged) && used[0] === used[1]);
      }

      // ---- the database result of finalize / release is checked, not just the absence of an exception ----
      {
        const rec = async (w: World, fetchImpl?: any, notice: unknown = NOTICE) => {
          const handler = loadFn('complete-booking', w, fetchImpl ? { fetch: fetchImpl } : {});
          const res = await handler(new Request('https://x/y', { method: 'POST', headers: { Authorization: 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: ORDER, sessionId: SESSION, action: 'send_confirmation', notice }) }));
          return { status: res.status, json: await res.json() };
        };
        const emailFails = async (url: string) => (String(url).endsWith('send-email') ? { ok: false, status: 502, json: async () => ({}), text: async () => '' } : { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '' });
        const emails = (w: World) => relayCalls(w).filter((c) => c.url.endsWith('send-email')).length;

        // 1. delivered + finalize recorded
        const w1 = makeWorld();
        const r1 = await rec(w1);
        ok('result: no response ever carries a claim id', w1.rpcs.filter((x) => x.args?.p_claim_id).every((x) => !JSON.stringify(r1.json).includes(x.args.p_claim_id)));
        ok('result: delivered + finalize recorded: sent, claim cleared, normal success, state recorded', r1.json.emailSent === true && r1.json.stateRecorded === true && JSON.stringify(state(w1)) === JSON.stringify({ sent: true, claimed: false }) && emails(w1) === 1);

        // 2 / 3. delivered, finalize fails ({ error }) or returns false
        for (const mode of ['error', 'error_true', 'false'] as const) {
          const w = makeWorld();
          w.rpcFail = { finalize_booking_confirmation: mode };
          const r = await rec(w);
          ok(`result: delivered but finalize ${mode === 'error' ? 'returned { error }' : mode === 'error_true' ? 'returned { data: true, error }' : 'returned false'}: still truthfully reported as delivered, NOT as recorded, not alreadySent`, r.status === 200 && r.json.emailSent === true && r.json.stateRecorded === false && r.json.alreadySent !== true && r.json.busy !== true);
          ok(`result: ... exactly one email in that request (no automatic second send)`, emails(w) === 1 && w.rpcs.filter((x) => x.name === 'finalize_booking_confirmation').length === 1);
          ok(`result: ... the order is not falsely marked sent and the claim remains for stale recovery`, JSON.stringify(state(w)) === JSON.stringify({ sent: false, claimed: true }));
          ok(`result: ... the failure detail never reaches the customer`, !/database unavailable|57P01|claim|p_claim_id|finalize/i.test(JSON.stringify(r.json)) && w.rpcs.filter((x) => x.args?.p_claim_id).every((x) => !JSON.stringify(r.json).includes(x.args.p_claim_id)));
          const again = await rec(w);
          ok(`result: ... a retry before the stale timeout is busy and does not send again`, again.json.busy === true && again.json.emailSent === false && emails(w) === 1);
          w.now += 601_000;
          w.rpcFail = undefined;
          const later = await rec(w);
          ok(`result: ... after the stale timeout the claim is recoverable (the documented provider-accepted-but-unrecorded window)`, later.json.emailSent === true && later.json.stateRecorded === true && state(w).sent === true);
        }

        // 4. failed delivery + release recorded
        const w4 = makeWorld();
        const r4 = await rec(w4, emailFails);
        ok('result: failed delivery + release recorded: unsent, claim cleared, state recorded, retryable', r4.json.emailSent === false && r4.json.stateRecorded === true && JSON.stringify(state(w4)) === JSON.stringify({ sent: false, claimed: false }) && confirmationSettled(false, r4.json) === false);
        ok('result: ... and the retry then succeeds', (await rec(w4)).json.emailSent === true && state(w4).sent === true);

        // 5 / 6. failed delivery, release fails
        for (const mode of ['error', 'error_true', 'false'] as const) {
          const w = makeWorld();
          w.rpcFail = { release_booking_confirmation: mode };
          const r = await rec(w, emailFails);
          ok(`result: failed delivery but release ${mode === 'error' ? 'returned { error }' : mode === 'error_true' ? 'returned { data: true, error }' : 'returned false'}: reported as not sent and NOT as recorded`, r.status === 200 && r.json.emailSent === false && r.json.stateRecorded === false && r.json.alreadySent !== true);
          ok(`result: ... the browser does not treat it as settled (processed key stays unset)`, confirmationSettled(false, r.json) === false);
          ok(`result: ... the claim remains until stale recovery: not sent, still claimed`, JSON.stringify(state(w)) === JSON.stringify({ sent: false, claimed: true }));
          const busyAgain = await rec(w);
          ok(`result: ... an immediate retry is busy (it is not claimed to be immediately retryable)`, busyAgain.json.busy === true && busyAgain.json.emailSent === false);
          w.now += 601_000;
          w.rpcFail = undefined;
          ok(`result: ... after the stale timeout the retry succeeds`, (await rec(w)).json.emailSent === true && state(w).sent === true);
        }

        // 7. thrown finalize / release
        {
          const w = makeWorld();
          w.rpcFail = { finalize_booking_confirmation: 'throw' };
          const r = await rec(w);
          ok('result: a thrown finalize is handled safely (delivered, not recorded, one email, claim kept)', r.status === 200 && r.json.emailSent === true && r.json.stateRecorded === false && emails(w) === 1 && JSON.stringify(state(w)) === JSON.stringify({ sent: false, claimed: true }));
          const w2 = makeWorld();
          w2.rpcFail = { release_booking_confirmation: 'throw' };
          const r2 = await rec(w2, emailFails);
          ok('result: a thrown release is handled safely (not sent, not recorded, claim kept for stale recovery)', r2.status === 200 && r2.json.emailSent === false && r2.json.stateRecorded === false && JSON.stringify(state(w2)) === JSON.stringify({ sent: false, claimed: true }));
        }
      }

      // thrown network exception
      const wt = makeWorld();
      const thrown = await request(wt, async () => { throw new TypeError('network down'); });
      ok('failure: a thrown network error releases the exact claim and leaves it unsent', thrown.json.emailSent === false && JSON.stringify(state(wt)) === JSON.stringify({ sent: false, claimed: false }));
      ok('failure: ... and the retry succeeds', (await request(wt)).json.emailSent === true && state(wt).sent === true);

      // hard crash: the claim is taken and never finalized or released
      const wh = makeWorld();
      const crashedClaim = '99999999-9999-4999-8999-999999999999';
      await makeClient(wh).rpc('claim_booking_confirmation', { p_order_id: ORDER, p_claim_id: crashedClaim, p_stale_seconds: 600 });
      ok('crash: the crashed request left a claim and the order is still NOT sent', JSON.stringify(state(wh)) === JSON.stringify({ sent: false, claimed: true }));
      wh.now += 599_000;
      const notYet = await request(wh);
      ok('crash: a retry before the stale timeout is busy, sends nothing and does not claim sent', notYet.json.busy === true && notYet.json.emailSent === false && sends(wh) === 0 && state(wh).sent === false);
      wh.now += 2_000;
      const recovered = await request(wh);
      ok('crash: after the stale timeout a retry reclaims it, sends and finalizes', recovered.json.emailSent === true && sends(wh) === 2 && JSON.stringify(state(wh)) === JSON.stringify({ sent: true, claimed: false }));
      const rpcOld = makeClient(wh);
      eq('crash: the crashed request\'s old claim id can no longer finalize', (await rpcOld.rpc('finalize_booking_confirmation', { p_order_id: ORDER, p_claim_id: crashedClaim })).data, false);
      eq('crash: ... or release', (await rpcOld.rpc('release_booking_confirmation', { p_order_id: ORDER, p_claim_id: crashedClaim })).data, false);
      ok('crash: ... and the delivered state is untouched', JSON.stringify(state(wh)) === JSON.stringify({ sent: true, claimed: false }));

      // email succeeds, optional text fails
      const ws = makeWorld();
      const smsFails = await request(ws, async (url: string) => (String(url).endsWith('send-sms-notification') ? { ok: false, status: 502, json: async () => ({}), text: async () => '' } : { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '' }));
      ok('meaning: a delivered email with a failed optional text still counts as sent (existing meaning)', smsFails.json.emailSent === true && JSON.stringify(state(ws)) === JSON.stringify({ sent: true, claimed: false }));

      // no email on file / no provider attempt
      const wn = makeWorld();
      wn.tables.customers[0].email = null;
      const noEmail = await request(wn);
      ok('release: no email on file means no email attempt, the claim is released and a retry stays possible', noEmail.json.emailSent === false && !relayCalls(wn).some((c) => c.url.endsWith('send-email')) && JSON.stringify(state(wn)) === JSON.stringify({ sent: false, claimed: false }));
      wn.tables.customers[0].email = 'ann@example.test';
      ok('release: ... and once an email exists the retry sends', (await request(wn)).json.emailSent === true && state(wn).sent === true);
      const wb = makeWorld();
      const both = await request(wb, async () => ({ ok: false, status: 502, json: async () => ({}), text: async () => '' }));
      ok('release: both channels failing leaves it unsent and unclaimed', both.json.emailSent === false && JSON.stringify(state(wb)) === JSON.stringify({ sent: false, claimed: false }));
      const wo = makeWorld();
      const smsOnlyFailing = await request(wo, async () => ({ ok: false, status: 502, json: async () => ({}), text: async () => '' }), { smsMessage: 'Confirmed!' });
      ok('release: a text-only confirmation whose text fails is released', smsOnlyFailing.json.smsSent === false && JSON.stringify(state(wo)) === JSON.stringify({ sent: false, claimed: false }));

      // proof still required
      const wp = makeWorld();
      const noSession = await call('complete-booking', ANON_KEY, { orderId: ORDER, action: 'send_confirmation', notice: NOTICE }, wp);
      ok('proof: the raw order id alone is not enough (no claim, no send)', noSession.status === 400 && sends(wp) === 0 && !wp.rpcs.some((x) => x.name === 'claim_booking_confirmation'));
      const wrong = await request(wp, undefined, NOTICE, ANON_KEY, 'cs_wrong');
      ok('proof: a wrong Stripe session is not enough (no claim, no send)', wrong.status >= 400 && sends(wp) === 0 && !wp.rpcs.some((x) => x.name === 'claim_booking_confirmation'));
      const otherOrder = await call('complete-booking', ANON_KEY, { orderId: OTHER_ORDER, sessionId: SESSION, action: 'send_confirmation', notice: NOTICE }, wp);
      ok('proof: another order\'s session cannot claim this order or the other one', otherOrder.status >= 400 && sends(wp) === 0 && !wp.rpcs.some((x) => x.name === 'claim_booking_confirmation'));
      {
        const wz = makeWorld();
        const failingClaim = () => ({ ...makeClient(wz), rpc: async () => ({ data: null, error: { message: 'boom' } }) });
        const res = await loadFn('complete-booking', wz, { createClient: failingClaim })(new Request('https://x/y', { method: 'POST', headers: { Authorization: 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: ORDER, sessionId: SESSION, action: 'send_confirmation', notice: NOTICE }) }));
        ok('claim: if the claim function cannot be called the request fails closed with no send', res.status === 500 && sends(wz) === 0);
      }
    }
    const w2 = makeWorld();
    w2.tables.orders.find((o) => o.id === ORDER)!.status = 'draft';
    const draft = await call('complete-booking', ANON_KEY, body(), w2);
    ok('complete-booking: a draft order cannot trigger a confirmation', draft.status === 409 && relayCalls(draft.w).length === 0);
  }

  // customer-portal-action: send_confirmation (portal / invoice token proof)
  {
    const TOKEN = 't'.repeat(64);
    const linkWorld = (status = 'confirmed') => {
      const w = makeWorld();
      w.tables.orders.find((o) => o.id === ORDER)!.status = status;
      w.tables.invoice_links.push({ id: 'l1', order_id: ORDER, link_type: 'portal', link_token: TOKEN, expires_at: '2999-01-01T00:00:00Z', revoked_at: null });
      return w;
    };
    const act = (extra: Record<string, unknown> = {}) => ({ orderId: ORDER, token: TOKEN, action: 'send_confirmation', payload: NOTICE, ...extra });
    const r = await call('customer-portal-action', ANON_KEY, act(), linkWorld());
    ok('customer-portal-action: a valid order token may send the booking confirmation', r.status === 200 && r.json?.success === true && relayCalls(r.w).length === 2);
    eq('customer-portal-action: the email is addressed to the customer on the order', JSON.parse(relayCalls(r.w).find((c) => c.url.endsWith('send-email'))!.init.body).to, 'ann@example.test');
    eq('customer-portal-action: the relay is called as the backend', relayCalls(r.w)[0].init.headers.Authorization, `Bearer ${SERVICE_KEY}`);
    const noProof = await call('customer-portal-action', ANON_KEY, act({ token: undefined }), linkWorld());
    ok('customer-portal-action: no proof, no confirmation', noProof.status === 403 && relayCalls(noProof.w).length === 0);
    const wrongToken = await call('customer-portal-action', ANON_KEY, act({ token: 'x'.repeat(64) }), linkWorld());
    ok('customer-portal-action: a wrong token sends nothing', wrongToken.status === 403 && relayCalls(wrongToken.w).length === 0);
    const otherOrder = await call('customer-portal-action', ANON_KEY, act({ orderId: OTHER_ORDER }), linkWorld());
    ok('customer-portal-action: the token for one order cannot send for another', otherOrder.status === 403 && relayCalls(otherOrder.w).length === 0);
    const spoof = await call('customer-portal-action', ANON_KEY, act({ payload: { ...NOTICE, to: 'victim@elsewhere.test' } }), linkWorld());
    ok('customer-portal-action: a payload carrying a recipient is rejected', spoof.status === 400 && relayCalls(spoof.w).length === 0);
    for (const status of ['draft', 'cancelled', 'completed']) {
      const wrong = await call('customer-portal-action', ANON_KEY, act(), linkWorld(status));
      ok(`customer-portal-action: an order in status "${status}" cannot trigger a confirmation`, wrong.status === 409 && relayCalls(wrong.w).length === 0);
    }
    const handler = loadFn('customer-portal-action', linkWorld(), { checkRateLimit: async () => ({ allowed: false }) });
    const limited = await handler(new Request('https://x/y', { method: 'POST', headers: { Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(act()) }));
    eq('customer-portal-action: a rate-limited order gets 429', limited.status, 429);
  }

  // The shared helpers on their own.
  {
    const { validateCustomerNotice } = portalActions;
    ok('notice: email + sms is valid', validateCustomerNotice(NOTICE) !== null);
    ok('notice: sms only is valid', validateCustomerNotice({ smsMessage: 'x' }) !== null);
    ok('notice: nothing to send is invalid', validateCustomerNotice({}) === null);
    ok('notice: an unknown key (a recipient) is invalid', validateCustomerNotice({ ...NOTICE, to: 'a@b.test' }) === null && validateCustomerNotice({ ...NOTICE, phone: '1' }) === null && validateCustomerNotice({ ...NOTICE, cc: 'a@b.test' }) === null);
    ok('notice: a subject with a line break is invalid', validateCustomerNotice({ emailSubject: 'a\nb', emailHtml: '<p/>' }) === null);
    ok('notice: an oversized body is invalid', validateCustomerNotice({ emailSubject: 'a', emailHtml: 'x'.repeat(200_001) }) === null && validateCustomerNotice({ smsMessage: 'x'.repeat(1001) }) === null);
    ok('notice: non-objects are invalid', [null, 'x', 5, [], undefined].every((v) => validateCustomerNotice(v) === null));
    ok('portal actions: send_confirmation is a named action with the exact payload shape', portalActions.PORTAL_ACTION_NAMES.includes('send_confirmation' as any) && portalActions.validateAction('send_confirmation', NOTICE, ORDER) !== null && portalActions.validateAction('send_confirmation', { ...NOTICE, to: 'a@b.test' }, ORDER) === null);
    const sent: any[] = [];
    const fakeDb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: ORDER, customers: { email: 'ann@example.test', phone: CUSTOMER_PHONE } } }) }) }) }) };
    const result = await customerNotice.sendOrderCustomerNotice(fakeDb, { supabaseUrl: 'https://x', serviceKey: 'k' }, ORDER, { emailSubject: 's', emailHtml: 'h' }, (async (url: string, init: any) => (sent.push({ url, init }), { ok: false, status: 500 })) as any);
    ok('notice: a relay failure is reported, not hidden', result.emailSent === false && /500/.test(result.emailError ?? ''));
    const sentWithExtras: any[] = [];
    await customerNotice.sendOrderCustomerNotice(fakeDb, { supabaseUrl: 'https://x', serviceKey: 'k' }, ORDER, { ...NOTICE, to: 'victim@elsewhere.test', phone: '+15559998888', email: 'victim@elsewhere.test' } as any, (async (url: string, init: any) => (sentWithExtras.push({ url, body: JSON.parse(init.body) }), { ok: true, status: 200 })) as any);
    ok('notice: extra recipient fields handed to the helper are ignored (customer on the order only)', sentWithExtras.find((c) => c.url.endsWith('send-email'))!.body.to === 'ann@example.test' && sentWithExtras.find((c) => c.url.endsWith('send-sms-notification'))!.body.to === CUSTOMER_PHONE);
    const noEmailDb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: ORDER, customers: { email: null, phone: null } } }) }) }) }) };
    const none = await customerNotice.sendOrderCustomerNotice(noEmailDb, { supabaseUrl: 'https://x', serviceKey: 'k' }, ORDER, NOTICE, (async () => ({ ok: true })) as any);
    ok('notice: no email and no phone on file sends nothing', none.emailSent === false && none.smsSent === false);
  }

  // =====================================================================================================================
  // CALLERS: every call site of the relays and how it authenticates
  // =====================================================================================================================
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !/Scenarios\.ts$/.test(e.name)) files.push(p);
    }
  };
  walk('src');
  walk('supabase/functions');
  const text = new Map<string, string>(files.map((f) => [f, read(f)]));

  const RELAY_REF = /send-email|send-sms-notification/;
  // call sites = files that reach the relays by URL or functions.invoke (the relays themselves and the shared header comments excluded)
  const callSites = [...text.entries()].filter(([f, s]) => /functions\/v1\/send-(email|sms-notification)|invoke\(\s*['"]send-(email|sms-notification)['"]/.test(s) && !/^supabase\/functions\/(send-email|send-sms-notification)\//.test(f)).map(([f]) => f).sort();

  // Server callers: every one authenticates with the service-role key.
  const SERVER_CALLERS: Record<string, string> = {
    'supabase/functions/charge-deposit/index.ts': 'service-role client (functions.invoke)',
    'supabase/functions/customer-balance-payment/index.ts': 'service-role key header',
    'supabase/functions/customer-cancel-order/index.ts': 'service-role key header',
    'supabase/functions/customer-portal-action/index.ts': 'service-role key header (admin notice) and customer notice helper',
    'supabase/functions/order-lifecycle/index.ts': 'service-role client (functions.invoke)',
    'supabase/functions/reconcile-balance-payment/index.ts': 'service-role key header',
    'supabase/functions/record-cash-payment/index.ts': 'service-role client (functions.invoke)',
    'supabase/functions/record-check-payment/index.ts': 'service-role client (functions.invoke)',
    'supabase/functions/request-portal-link/index.ts': 'service-role key header',
    'supabase/functions/save-signature/index.ts': 'service-role key header',
    'supabase/functions/send-invoice/index.ts': 'service-role key header',
    'supabase/functions/stripe-webhook/emails.ts': 'service-role key header',
    'supabase/functions/submit-contact-inquiry/index.ts': 'service-role key header',
    'supabase/functions/_shared/transaction-logger.ts': 'caller-supplied service-role client (functions.invoke)',
    'supabase/functions/_shared/customer-notice.ts': 'service-role key header (customer confirmation helper)',
  };
  const BROWSER_STAFF: Record<string, string> = {
    'src/components/admin/PermissionsTab.tsx': 'signed-in Admin / Master session token (permission-change notice to the admin address)',
    'src/components/admin/TaskDetailModal.tsx': 'signed-in Crew / Admin session token (task flow messages for the task\'s own order)',
    'src/components/admin/task-detail/taskEdgeRequests.ts': 'signed-in Crew / Admin session token (task flow SMS to the order\'s customer)',
    'src/lib/notifications/notificationService.ts': 'signed-in Admin session token (approval, rejection, edit and admin notices)',
    'src/lib/payments/transactionReceiptService.ts': 'signed-in Admin session (functions.invoke attaches the session token)',
  };
  const CUSTOMER_SCREENS = ['src/components/customer-portal/CustomerApprovalModal.tsx', 'src/components/customer-portal/InvoiceAcceptanceView.tsx', 'src/hooks/useBookingReturnConfirmation.ts', 'src/lib/notifications/orderNotificationService.ts'];
  const FOUND_RELAYS_COMMENT_ONLY = ['src/components/admin/PendingOrderCard.tsx', 'src/lib/notifications/notificationFailures.ts', 'supabase/functions/auth-email-hook/index.ts'];

  const accounted = new Set([...Object.keys(SERVER_CALLERS), ...Object.keys(BROWSER_STAFF)]);
  eq('callers: UNCLASSIFIED CALL SITES (relay call sites not in the server / staff tables)', callSites.filter((f) => !accounted.has(f)), []);
  eq('callers: every listed caller still exists and still reaches a relay', [...accounted].filter((f) => !callSites.includes(f)), []);
  ok('callers: files that only mention the relays in comments make no call', FOUND_RELAYS_COMMENT_ONLY.every((f) => !callSites.includes(f) && RELAY_REF.test(text.get(f) ?? read(f))));

  for (const file of Object.keys(SERVER_CALLERS)) {
    const s = text.get(file)!;
    // The transaction logger receives its client from the caller (checked below).
    const receivesClient = file.endsWith('transaction-logger.ts');
    ok(`callers: ${file} authenticates with the service-role key or a service-role client`, receivesClient || /SUPABASE_SERVICE_ROLE_KEY|serviceKey/.test(s) &&!/SUPABASE_ANON_KEY\}`?\s*[,}]?[^\n]{0,40}send-(email|sms)/.test(s));
  }
  // functions.invoke callers: the client they use is a service-role client
  for (const file of ['supabase/functions/charge-deposit/index.ts', 'supabase/functions/order-lifecycle/index.ts', 'supabase/functions/record-cash-payment/index.ts', 'supabase/functions/record-check-payment/index.ts']) {
    const s = text.get(file)!;
    ok(`callers: ${file} creates the client it invokes the relays with from the service-role key`, /createClient\(\s*Deno\.env\.get\("SUPABASE_URL"\)[^)]*Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/.test(s));
  }
  ok('callers: the transaction logger is only ever given service-role clients', ['customer-balance-payment/index.ts', 'record-cash-payment/index.ts', 'record-check-payment/index.ts', 'stripe-webhook/index.ts'].every((f) => {
    const s = read(`supabase/functions/${f}`);
    return /createClient\(\s*Deno\.env\.get\("SUPABASE_URL"\)[^)]*Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/.test(s);
  }));
  // No browser file reaches a relay with the public anon key.
  for (const [file, s] of text) {
    if (!file.startsWith('src/')) continue;
    const idx = [...s.matchAll(/functions\/v1\/send-(email|sms-notification)/g)].map((m) => m.index as number);
    for (const i of idx) {
      const near = s.slice(Math.max(0, i - 400), i + 500);
      ok(`callers: ${file} does not call a relay with the public anon key`, !/VITE_SUPABASE_ANON_KEY|anonKey/.test(near));
    }
  }
  for (const file of Object.keys(BROWSER_STAFF)) {
    const s = text.get(file)!;
    ok(`callers: ${file} (${BROWSER_STAFF[file]}) uses the signed-in session`, /getSession|access_token|accessToken|currentAccessToken|functions\.invoke/.test(s));
  }
  // Customer-facing screens never call a relay; they use the order-bound server actions.
  for (const file of CUSTOMER_SCREENS) {
    const s = text.get(file)!;
    ok(`callers: ${file} (customer-facing) no longer reaches a relay directly`, !/functions\/v1\/send-(email|sms-notification)|invoke\(\s*['"]send-(email|sms-notification)['"]/.test(s));
  }
  ok('callers: Approval and Invoice screens send their confirmation through the portal action', /portalAction\(order\.id, invoiceLinkToken, 'send_confirmation'/.test(text.get(CUSTOMER_SCREENS[0])!) && /portalAction\(order\.id, invoiceToken, 'send_confirmation'/.test(text.get(CUSTOMER_SCREENS[1])!));
  ok('callers: the payment-complete flow sends its confirmation through complete-booking with the Stripe session', /sendCustomerBookingConfirmationNotifications\(order, sessionId!\)/.test(text.get(CUSTOMER_SCREENS[2])!) && /action: 'send_confirmation'/.test(text.get('src/lib/booking/bookingApi.ts')!));
  ok('callers: the payment-complete flow no longer depends on a second, cooperative mark_confirmation_sent call', !/markBookingConfirmationSent|mark_confirmation_sent/.test(text.get(CUSTOMER_SCREENS[2])! + text.get('src/lib/booking/bookingApi.ts')!));
  ok('callers: complete-booking claims through the database function BEFORE it sends, finalizes only a delivered confirmation and releases otherwise, and never writes the sent flag itself', (() => {
    const cb = text.get('supabase/functions/complete-booking/index.ts')!;
    const blk = cb.slice(cb.indexOf('if (action === "send_confirmation")'), cb.indexOf('const { data: order, error: orderError }'));
    const claim = blk.indexOf('rpc("claim_booking_confirmation"'); const send = blk.indexOf('sendOrderCustomerNotice('); const decide = blk.indexOf('delivered ? "finalize_booking_confirmation" : "release_booking_confirmation"');
    return claim > 0 && claim < send && send < decide && blk.includes('p_claim_id: claimId') && !blk.includes('booking_confirmation_sent');
  })());
  ok('callers: the Crew template allowlists are exactly the two task-flow templates', JSON.stringify(authHelpers.CREW_SMS_TEMPLATES) === JSON.stringify(['pickup_thanks_sms']) && JSON.stringify(authHelpers.CREW_EMAIL_TEMPLATES) === JSON.stringify(['pickup_complete']));
  ok('callers: the only direct Crew template callers are the two in TaskDetailModal (UNCLASSIFIED DIRECT CREW TEMPLATE CALLERS: 0)', (() => { const hits = [...text.entries()].filter(([f, s]) => f.startsWith('src/') && /templateKey|templateName/.test(s) && !/notificationRelay/.test(f)).map(([f]) => f); return JSON.stringify(hits) === JSON.stringify(['src/components/admin/TaskDetailModal.tsx']); })() && /templateKey: 'pickup_thanks_sms'/.test(text.get('src/components/admin/TaskDetailModal.tsx')!) && /templateName: 'pickup_complete'/.test(text.get('src/components/admin/TaskDetailModal.tsx')!));
  // ---- browser: a recoverable failure must stay retryable through the real customer flow ----
  {
    ok('browser: an unsent order with a failed email is NOT settled (the processed key must not be set)', confirmationSettled(false, { emailSent: false }) === false);
    ok('browser: an unsent order whose request was busy (emailSent false) is NOT settled', confirmationSettled(false, { emailSent: false }) === false);
    ok('browser: no result at all is NOT settled', confirmationSettled(false, null) === false && confirmationSettled(false, undefined) === false);
    ok('browser: a delivered email IS settled', confirmationSettled(false, { emailSent: true }) === true);
    ok('browser: an order already marked sent IS settled', confirmationSettled(true, null) === true && confirmationSettled(true, { emailSent: false }) === true);
    const hook = text.get('src/hooks/useBookingReturnConfirmation.ts')!;
    ok('browser: the payment-complete page sets payment_processed_<order> only when the confirmation is settled', /const settled = await sendNotificationsIfNeeded\(order\);\s*if \(settled\) SafeStorage\.setItem\(processedKey, 'true'\);/.test(hook) && (hook.match(/SafeStorage\.setItem\(processedKey/g) ?? []).length === 1);
    ok('browser: the settled decision comes from the shared helper for both the already-sent and the just-sent result', hook.includes('return confirmationSettled(true, null);') && hook.includes('return confirmationSettled(false, result);'));
    ok('browser: the rest of the completion flow is intact (clear cart storage, success status, first-visit flag)', hook.includes("SafeStorage.removeItem('bpc_cart')") && hook.includes("setStatus('success')") && hook.includes('setIsFirstVisit(true)') && hook.includes('const alreadyProcessed = SafeStorage.getItem(processedKey);'));
    const api = text.get('src/lib/booking/bookingApi.ts')!;
    ok('browser: a busy answer is reported as not sent (emailSent only when the server says true)', api.includes('emailSent: data.emailSent === true'));
  }
  ok('callers: the browser customer helpers carry no recipient in the request', !/to:\s*order\.customer\.email|to:\s*customer\.email/.test(text.get(CUSTOMER_SCREENS[0])! + text.get(CUSTOMER_SCREENS[1])!));
  ok('callers: the browser notification helper refuses to send without a signed-in session', /You must be signed in to send email/.test(text.get('src/lib/notifications/notificationService.ts')!) && /You must be signed in to send SMS/.test(text.get('src/lib/notifications/notificationService.ts')!));
  // Handlers that do the customer-notice work call the helper after proof and status checks.
  {
    const cb = text.get('supabase/functions/complete-booking/index.ts')!;
    ok('callers: complete-booking sends the confirmation only after the order proof', cb.indexOf('proveOrderAccess(') < cb.indexOf('sendOrderCustomerNotice('));
    const pa = text.get('supabase/functions/customer-portal-action/index.ts')!;
    ok('callers: customer-portal-action sends the confirmation only after the order proof and a status check', pa.indexOf('authorizePortalOrder(') < pa.indexOf('sendOrderCustomerNotice(') && /\["pending_review", "confirmed"\]\.includes\(order\.status\)/.test(pa));
  }

  // ---- the relays authorize before anything else ----
  for (const [fn, kind] of [['send-email', 'email'], ['send-sms-notification', 'sms']] as Array<[string, string]>) {
    const s = text.get(`supabase/functions/${fn}/index.ts`)!;
    const authAt = s.indexOf('authorizeRelayCaller(');
    const authCall = s.slice(authAt, s.indexOf(';', authAt));
    ok(`relay: ${fn} authorizes through the shared helper (kind "${kind}", its own service key)`, authAt > 0 && new RegExp(`['"]${kind}['"]`).test(authCall) && /ServiceKey|serviceKey/.test(authCall));
    const before = s.slice(0, authAt);
    ok(`relay: ${fn} makes no provider request, log write or secondary call before authorizing`, !/api\.(resend|twilio)\.com|record_notification|functions\/v1\/|\.insert\(|admin_settings|email_templates|sms_message_templates/.test(before.slice(before.indexOf('Deno.serve'))));
    ok(`relay: ${fn} returns the refusal right after the check`, /if \(!authorization\.ok\) return relayDenied\(authorization, corsHeaders\);/.test(s));
    ok(`relay: ${fn} records failures only for authorized requests`, /relayAuthorized = true;/.test(s) && /if \(relayAuthorized && /.test(s));
    ok(`relay: ${fn} does not read a role, admin flag or service flag from the request body`, !/body\.(role|admin|isAdmin|service|userId)|requestBody\.(role|admin|isAdmin|service|userId)/.test(s));
  }

  // =====================================================================================================================
  // CONFIG
  // =====================================================================================================================
  {
    const cfg = read('supabase/config.toml');
    const section = (name: string) => cfg.slice(cfg.indexOf(`[functions.${name}]`)).split('\n').slice(0, 3).join('\n');
    ok('config: send-email keeps verify_jwt = true (rejects garbage tokens at the gateway; authorization is in the function)', /verify_jwt = true/.test(section('send-email')));
    ok('config: send-sms-notification keeps verify_jwt = true (rejects garbage tokens at the gateway; authorization is in the function)', /verify_jwt = true/.test(section('send-sms-notification')));
  }

  // The inbound Twilio functions and the contact form flow are untouched by this change.
  for (const f of ['twilio-webhook', 'twilio-status-callback']) {
    ok(`scope: ${f} does not use the relay authorization helpers`, !/authorizeRelayCaller|relayDenied/.test(read(`supabase/functions/${f}/index.ts`)));
  }
  ok('scope: submit-contact-inquiry still calls send-email as the backend', /functions\/v1\/send-email/.test(text.get('supabase/functions/submit-contact-inquiry/index.ts')!) && /SUPABASE_SERVICE_ROLE_KEY/.test(text.get('supabase/functions/submit-contact-inquiry/index.ts')!));

  console.log(`Notification relay authorization tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} notification relay authorization test(s) failed`);
})();
