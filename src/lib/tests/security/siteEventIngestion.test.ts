// record-site-event: the only way website analytics reach site_events.
//
// The handler is a Deno module, so the test loads the CURRENT source text, strips its imports, transpiles it and runs it with fakes
// for Deno, createClient and fetch, plus the REAL validator (supabase/functions/_shared/site-events.ts) and the REAL shared rate limiter
// (supabase/functions/_shared/rate-limit.ts, loaded the same way). Only the limiter's database call (the check_rate_limit RPC) is faked,
// and the fake can answer allow, deny, error, throw, or something malformed - so the handler is tested against the helper's actual
// contract and the configured limits are the repository's real numbers. Nothing here reaches a network or a database.
// Run: node node_modules/jiti/bin/jiti.js src/lib/siteEventIngestion.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');

import * as siteEvents from '../../../../supabase/functions/_shared/site-events';

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

const FN = 'supabase/functions/record-site-event/index.ts';
const fnSource = read(FN);

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UNIT = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';

// How the limiter's database call answers. 'count' is a faithful counter that honours the limits the shared helper passes in.
type RateMode = 'count' | 'rpc-error' | 'throw' | 'malformed-undefined' | 'malformed-string' | 'malformed-empty-object' | 'malformed-null' | 'malformed-allowed-string';
interface World {
  inserts: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  counters: Map<string, number>;
  fetches: number;
  rateMode: RateMode;
  // Only this limiter endpoint misbehaves (the other keeps counting); undefined = every limiter call.
  rateModeOnly?: string;
  rateCalls: Array<{ endpoint: string; identifier: string; max: number; window: number }>;
  handler?: (req: Request) => Promise<Response>;
  // Replaces names the handler imports (for example a limiter helper that itself throws or answers with something unusable).
  scopeOverride?: Record<string, unknown>;
  insertError?: (row: Record<string, unknown>, attempt: number) => { code?: string; message?: string } | null;
}
const newWorld = (): World => ({ inserts: [], attempts: [], counters: new Map(), fetches: 0, rateMode: 'count', rateCalls: [] });

// The real shared limiter, with only its database call replaced.
function loadRateLimit(w: World): any {
  const js: string = ts.transpileModule(rateSource.replace(/^import[^;]*;/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const env: Record<string, string> = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-key' };
  const rpc = async (_name: string, args: any) => {
    w.rateCalls.push({ endpoint: args.p_endpoint, identifier: args.p_identifier, max: args.p_max_requests, window: args.p_window_seconds });
    const mode = w.rateModeOnly === undefined || w.rateModeOnly === args.p_endpoint ? w.rateMode : 'count';
    if (mode === 'throw') throw new Error('rate limiter unreachable');
    if (mode === 'rpc-error') return { data: null, error: { message: 'connection refused to db.internal:5432', code: '08006' } };
    if (mode === 'malformed-undefined') return { data: undefined, error: null };
    if (mode === 'malformed-null') return { data: null, error: null };
    if (mode === 'malformed-string') return { data: 'ok', error: null };
    if (mode === 'malformed-empty-object') return { data: {}, error: null };
    if (mode === 'malformed-allowed-string') return { data: { allowed: 'true' }, error: null };
    const key = args.p_endpoint + '::' + args.p_identifier;
    const n = (w.counters.get(key) ?? 0) + 1;
    w.counters.set(key, n);
    return { data: n > args.p_max_requests ? { allowed: false, reason: 'rate_limit_exceeded', retry_after: args.p_window_seconds } : { allowed: true, requests_remaining: args.p_max_requests - n }, error: null };
  };
  const mod: any = { exports: {} };
  new Function('Deno', 'createClient', 'exports', 'console', js)({ env: { get: (k: string) => env[k] } }, () => ({ rpc }), mod.exports, { log: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {} });
  return mod.exports;
}
const rateSource = read('supabase/functions/_shared/rate-limit.ts');
const CONFIG = loadRateLimit(newWorld()).RATE_LIMIT_CONFIGS;
const LIMIT: number = CONFIG['record-site-event'].maxRequests;
const WINDOW: number = CONFIG['record-site-event'].windowSeconds;
const GLOBAL_LIMIT: number = CONFIG['record-site-event-global'].maxRequests;
const GLOBAL_WINDOW: number = CONFIG['record-site-event-global'].windowSeconds;

function loadHandler(w: World): (req: Request) => Promise<Response> {
  const js: string = ts.transpileModule(fnSource.replace(/^import[^;]*;/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  let captured: any = null;
  const env: Record<string, string> = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-key' };
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => env[k] }, serve: (fn: any) => { captured = fn; } },
    createClient: () => ({
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          if (table !== 'site_events') throw new Error('unexpected table ' + table);
          w.attempts.push(row);
          const err = w.insertError ? w.insertError(row, w.attempts.length) : null;
          if (err) return { error: err };
          w.inserts.push(row);
          return { error: null };
        },
      }),
    }),
    ...(() => { const m = loadRateLimit(w); return { getIdentifier: m.getIdentifier, buildRateLimitKey: m.buildRateLimitKey, checkRateLimit: m.checkRateLimit, createRateLimitResponse: m.createRateLimitResponse }; })(),
    fetch: async () => { w.fetches++; throw new Error('no network in tests'); },
    console: { log: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    ...siteEvents,
    ...(w.scopeOverride ?? {}),
  };
  const imported = new Set<string>();
  for (const m of fnSource.matchAll(/^import([^;]*);/gm)) {
    for (const id of m[1].replace(/from\s+['"][^'"]*['"]/, '').match(/[A-Za-z_$][\w$]*/g) ?? []) imported.add(id);
  }
  const names = Object.keys(scope).filter((n) => ['Deno', 'console', 'fetch'].includes(n) || imported.has(n));
  new Function(...names, js)(...names.map((n) => scope[n]));
  if (!captured) throw new Error('Deno.serve was not called');
  return captured;
}

async function send(w: World, body: unknown, opts: { ip?: string; method?: string; auth?: string; raw?: boolean } = {}) {
  const handler = (w.handler ??= loadHandler(w));
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-forwarded-for': opts.ip ?? '203.0.113.7' };
  if (opts.auth) headers.Authorization = opts.auth;
  const res = await handler(new Request('https://fake.functions/record-site-event', { method: opts.method ?? 'POST', headers, body: (opts.method ?? 'POST') === 'POST' ? (opts.raw ? (body as string) : JSON.stringify(body)) : undefined }));
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

const GOOD = { event_name: 'page_view', session_id: SESSION, page_path: '/' };

(async () => {
  // ---- the limit is what the repository says it is ----
  eq('rate limit: configured for record-site-event', [LIMIT, WINDOW], [120, 60]);
  eq('rate limit: the overall ceiling on all analytics', [GLOBAL_LIMIT, GLOBAL_WINDOW], [240, 60]);
  ok('rate limit: a default limit never applies to record-site-event (both buckets are configured explicitly)', LIMIT === 120 && GLOBAL_LIMIT === 240);

  // ---- the validator on its own ----
  {
    const v = siteEvents.validateSiteEvent;
    ok('validator: a minimal valid event is accepted', v({ event_name: 'page_view' }) !== null);
    ok('validator: every event name the site sends is accepted', ['page_view', 'unit_view', 'cart_started', 'cart_submitted', 'checkout_started', 'checkout_completed', 'customer_portal_viewed', 'payment_link_opened', 'waiver_link_opened', 'cart_item_added', 'cart_item_removed', 'cart_address_entered', 'cart_date_selected', 'cart_price_calculated'].every((n) => v({ event_name: n, session_id: SESSION }) !== null));
    ok('validator: the event names the site sends are exactly the allowlist (src/lib/core/siteEvents.ts union)', (() => {
      const src = read('src/lib/core/siteEvents.ts');
      const union = [...src.slice(src.indexOf('export type SiteEventName'), src.indexOf('interface TrackEventOptions')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
      return JSON.stringify(union) === JSON.stringify([...siteEvents.SITE_EVENT_NAMES].sort());
    })());
    ok('validator: a full unit_view event is accepted', v({ event_name: 'unit_view', session_id: SESSION, unit_id: UNIT, order_id: ORDER, page_path: '/units/castle', metadata: { name: 'Castle', slug: 'castle' } }) !== null);
    ok('validator: the cleaned event contains only the six known columns', JSON.stringify(Object.keys(v({ event_name: 'page_view', session_id: SESSION })!).sort()) === JSON.stringify(['event_name', 'metadata', 'order_id', 'page_path', 'session_id', 'unit_id']));
    ok('validator: absent metadata becomes an empty object', JSON.stringify(v({ event_name: 'page_view' })!.metadata) === '{}');
    ok('validator: null optional fields are accepted', v({ event_name: 'page_view', session_id: null, unit_id: null, order_id: null, page_path: null, metadata: null }) !== null);
  }

  // ---- valid events are accepted and written with the backend, exactly the six columns ----
  {
    const w = newWorld();
    const r = await send(w, { event_name: 'unit_view', session_id: SESSION, unit_id: UNIT, page_path: '/units/castle', metadata: { name: 'Castle', slug: 'castle' } });
    ok('valid anonymous event: accepted (200)', r.status === 200 && r.json?.success === true);
    eq('valid anonymous event: exactly the six columns are inserted, no timestamp / id / identity', Object.keys(w.inserts[0]).sort(), ['event_name', 'metadata', 'order_id', 'page_path', 'session_id', 'unit_id']);
    eq('valid anonymous event: the row content', w.inserts[0], { event_name: 'unit_view', session_id: SESSION, unit_id: UNIT, order_id: null, page_path: '/units/castle', metadata: { name: 'Castle', slug: 'castle' } });
    ok('valid anonymous event: no network was used', w.fetches === 0);
  }
  {
    const w = newWorld();
    const r = await send(w, GOOD, { auth: 'Bearer eyJhbGciOiJIUzI1NiJ9.signed-in-customer.sig' });
    ok('valid signed-in event: accepted, and the caller identity is not stored (there is no identity column)', r.status === 200 && Object.keys(w.inserts[0]).every((k) => ['event_name', 'metadata', 'order_id', 'page_path', 'session_id', 'unit_id'].includes(k)));
    const r2 = await send(newWorld(), GOOD, { auth: 'Bearer garbage' });
    ok('an invalid or expired token does not matter (analytics are public)', r2.status === 200);
    const r3 = await send(newWorld(), GOOD, { auth: undefined });
    ok('no Authorization header at all is fine too', r3.status === 200);
  }
  for (const name of siteEvents.SITE_EVENT_NAMES) {
    const w = newWorld();
    const r = await send(w, { event_name: name, session_id: SESSION });
    ok(`event ${name}: accepted and written once`, r.status === 200 && w.inserts.length === 1 && w.inserts[0].event_name === name);
  }

  // ---- normal use is not throttled; abuse is ----
  {
    const w = newWorld();
    let accepted = 0;
    for (let i = 0; i < 40; i++) {
      const r = await send(w, { event_name: i % 3 === 0 ? 'cart_price_calculated' : 'page_view', session_id: SESSION, page_path: '/quote' });
      if (r.status === 200) accepted++;
    }
    ok('normal use: 40 events from one visitor in a minute are all accepted', accepted === 40 && w.inserts.length === 40);
    ok('normal use: a busy quote flow (about a dozen events) is far below the limit', 12 < LIMIT / 5);
  }
  {
    const w = newWorld();
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 30; i++) statuses.push((await send(w, GOOD, { ip: '198.51.100.9' })).status);
    ok(`abuse: exactly ${LIMIT} requests are accepted from one address in the window`, statuses.filter((s) => s === 200).length === LIMIT && w.inserts.length === LIMIT);
    ok('abuse: everything past the limit is a 429 and writes nothing', statuses.slice(LIMIT).every((s) => s === 429) && w.attempts.length === LIMIT);
    const other = await send(w, GOOD, { ip: '198.51.100.10' });
    ok('abuse: another address is not affected by the first one\'s burst', other.status === 200);
    const limited = await send(w, GOOD, { ip: '198.51.100.9' });
    ok('abuse: the throttled answer tells the caller to retry later and reveals nothing else', limited.status === 429 && typeof limited.json?.retry_after === 'number');
  }
  {
    const w = newWorld();
    for (let i = 0; i < LIMIT; i++) await send(w, GOOD, { ip: '198.51.100.20' });
    const bad = await send(w, '{broken', { ip: '198.51.100.20', raw: true });
    ok('rate limit comes before parsing: even junk past the limit is a 429 (it costs no parsing or validation)', bad.status === 429);
  }
  {
    const w = newWorld();
    for (let i = 0; i < LIMIT + 5; i++) await send(w, { event_name: 'nope' }, { ip: '198.51.100.30' });
    ok('rejected junk counts against the limit too, so it cannot be used to avoid it', (await send(w, GOOD, { ip: '198.51.100.30' })).status === 429);
  }
  {
    const w = newWorld();
    for (let i = 0; i < LIMIT; i++) await send(w, GOOD, { ip: '' });
    ok('requests with no usable address share one bucket (still bounded)', (await send(w, GOOD, { ip: '' })).status === 429);
  }

  // ---- the limiter is part of the protection, so it fails CLOSED ----
  {
    const w = newWorld();
    const ok1 = await send(w, GOOD);
    ok('limiter permits: a valid event inserts once', ok1.status === 200 && w.inserts.length === 1);
    ok('limiter permits: both the per-address and the overall bucket were consulted, with the configured limits', w.rateCalls.length === 2 && w.rateCalls[0].endpoint === 'record-site-event' && w.rateCalls[0].max === 120 && w.rateCalls[1].endpoint === 'record-site-event-global' && w.rateCalls[1].max === 240);

    const denied = newWorld();
    denied.counters.set('record-site-event::record-site-event|ip:203.0.113.7', LIMIT);
    const d = await send(denied, GOOD);
    ok('limiter denies: 429 and zero insert', d.status === 429 && denied.attempts.length === 0);

    const modes: Array<[RateMode, string]> = [
      ['rpc-error', 'the check_rate_limit call returns an error'],
      ['throw', 'the check_rate_limit call throws'],
      ['malformed-undefined', 'the limiter answers undefined'],
      ['malformed-null', 'the limiter answers null'],
      ['malformed-string', 'the limiter answers a bare string'],
      ['malformed-empty-object', 'the limiter answers an empty object'],
      ['malformed-allowed-string', 'the limiter answers {allowed: "true"} (not a boolean)'],
    ];
    for (const [mode, label] of modes) {
      const f = newWorld();
      f.rateMode = mode;
      const r = await send(f, GOOD);
      ok(`fail closed: ${label} -> 503 and zero insert`, r.status === 503 && f.attempts.length === 0 && f.inserts.length === 0);
      ok(`fail closed: ${label} -> the answer reveals no limiter or database detail`, r.json?.success === false && r.json?.error === 'Analytics unavailable' && !/5432|refused|rate|limit|db\.internal|08006|rpc/i.test(r.text));
      // the same failure on the overall bucket only
      const g = newWorld();
      g.rateMode = mode;
      g.rateModeOnly = 'record-site-event-global';
      const rg = await send(g, GOOD);
      ok(`fail closed (overall bucket): ${label} -> 503 and zero insert`, rg.status === 503 && g.attempts.length === 0);
    }
    // only the per-address bucket misbehaves (the overall bucket keeps counting): still no insert
    for (const [mode, label] of modes) {
      const f = newWorld();
      f.rateMode = mode;
      f.rateModeOnly = 'record-site-event';
      const r = await send(f, GOOD);
      ok(`fail closed (per-address bucket only): ${label} -> 503 and zero insert`, r.status === 503 && f.attempts.length === 0);
    }
    // the HANDLER itself does not trust a helper that throws or answers with something unusable
    const unusable: Array<[string, () => Promise<unknown>]> = [
      ['throws', async () => { throw new Error('boom'); }],
      ['answers undefined', async () => undefined],
      ['answers null', async () => null],
      ['answers a string', async () => 'allowed'],
      ['answers an empty object', async () => ({})],
      ['answers {allowed: 1}', async () => ({ allowed: 1 })],
      ['answers {allowed: "true"}', async () => ({ allowed: 'true' })],
      ['answers {allowed: false, reason: "limiter_unavailable"}', async () => ({ allowed: false, reason: 'limiter_unavailable' })],
    ];
    for (const [label, impl] of unusable) {
      const f = newWorld();
      f.scopeOverride = { checkRateLimit: impl };
      const r = await send(f, GOOD);
      ok(`fail closed (handler): a rate-limit helper that ${label} -> 503 and zero insert`, r.status === 503 && f.attempts.length === 0 && r.json?.error === 'Analytics unavailable');
      // the same on the second (overall) call only
      const g = newWorld();
      let calls = 0;
      const real = loadRateLimit(g).checkRateLimit;
      g.scopeOverride = { checkRateLimit: async (...a: any[]) => (++calls === 1 ? real(...a) : impl()) };
      const rg = await send(g, GOOD);
      ok(`fail closed (handler, overall call): a rate-limit helper that ${label} -> 503 and zero insert`, rg.status === 503 && g.attempts.length === 0);
    }
    const allowedExplicit = newWorld();
    allowedExplicit.scopeOverride = { checkRateLimit: async () => ({ allowed: true }) };
    ok('handler: an explicit {allowed: true} from the helper lets a valid event through', (await send(allowedExplicit, GOOD)).status === 200 && allowedExplicit.inserts.length === 1);
    const deniedExplicit = newWorld();
    deniedExplicit.scopeOverride = { checkRateLimit: async () => ({ allowed: false, reason: 'rate_limit_exceeded', retry_after: 60 }) };
    const dr = await send(deniedExplicit, GOOD);
    ok('handler: an explicit denial from the helper is a 429, not a 503, and writes nothing', dr.status === 429 && deniedExplicit.attempts.length === 0);

    // invalid input while the limiter is down is still not written (and not echoed)
    const bad = newWorld();
    bad.rateMode = 'rpc-error';
    const rb = await send(bad, { event_name: 'nope' });
    ok('fail closed: a request is refused as unavailable before its body is even read', rb.status === 503 && bad.attempts.length === 0);
    // recovery: once the limiter is healthy again the same visitor records events
    const recover = newWorld();
    recover.rateMode = 'throw';
    await send(recover, GOOD);
    recover.rateMode = 'count';
    const rr = await send(recover, GOOD);
    ok('recovery: when the limiter answers again, events are recorded again', rr.status === 200 && recover.inserts.length === 1);
    // the shared helper's DEFAULT behaviour for every other endpoint is unchanged (fail open)
    const shared = loadRateLimit(Object.assign(newWorld(), { rateMode: 'rpc-error' as RateMode }));
    const openOnError = await shared.checkRateLimit('stripe-charge', 'ip:1.1.1.1');
    ok('shared helper: the default (every other endpoint) still fails OPEN on an RPC error - unchanged', openOnError.allowed === true);
    const throwing = loadRateLimit(Object.assign(newWorld(), { rateMode: 'throw' as RateMode }));
    ok('shared helper: the default still fails OPEN when the check throws - unchanged', (await throwing.checkRateLimit('stripe-charge', 'ip:1.1.1.1')).allowed === true);
    const malformed = loadRateLimit(Object.assign(newWorld(), { rateMode: 'malformed-empty-object' as RateMode }));
    ok('shared helper: the default returns whatever the RPC returned for a malformed result - unchanged', JSON.stringify(await malformed.checkRateLimit('stripe-charge', 'ip:1.1.1.1')) === '{}');
    ok('shared helper: failClosed=true denies on error / throw / malformed with reason limiter_unavailable', (await shared.checkRateLimit('x', 'y', undefined, false, true)).reason === 'limiter_unavailable' && (await throwing.checkRateLimit('x', 'y', undefined, false, true)).allowed === false && (await malformed.checkRateLimit('x', 'y', undefined, false, true)).allowed === false);
    const healthy = loadRateLimit(newWorld());
    ok('shared helper: failClosed=true still allows a healthy allow answer', (await healthy.checkRateLimit('x', 'y', undefined, false, true)).allowed === true);
    ok('shared helper: no other function opts in to failClosed (their behaviour is untouched)', (() => {
      const others = ['charge-deposit', 'check-availability', 'complete-booking', 'create-booking', 'request-portal-link', 'resolve-link', 'stripe-charge', 'stripe-checkout', 'stripe-refund', 'submit-contact-inquiry'];
      return others.every((f) => !/checkRateLimit\([^)]*,\s*true\s*,\s*true\s*\)|failClosed/.test(read(`supabase/functions/${f}/index.ts`)));
    })());
  }

  // ---- the overall ceiling holds even if the apparent address is varied ----
  {
    const w = newWorld();
    let accepted = 0;
    let limited = 0;
    for (let i = 0; i < GLOBAL_LIMIT + 40; i++) {
      const r = await send(w, GOOD, { ip: `203.0.${Math.floor(i / 250)}.${(i % 250) + 1}` });
      if (r.status === 200) accepted++;
      else if (r.status === 429) limited++;
    }
    ok(`ceiling: with a different address on every request (each far below its own allowance) exactly ${GLOBAL_LIMIT} events are recorded`, accepted === GLOBAL_LIMIT && w.inserts.length === GLOBAL_LIMIT);
    ok('ceiling: everything past it is a 429 and writes nothing', limited === 40 && w.attempts.length === GLOBAL_LIMIT);
    ok('ceiling: no single address came near its own limit', ![...w.counters.entries()].some(([k, n]) => k.startsWith('record-site-event::') && n > 2));
    const w2 = newWorld();
    for (let i = 0; i < LIMIT; i++) await send(w2, GOOD, { ip: '198.51.100.99' });
    await send(w2, GOOD, { ip: '198.51.100.99' });
    ok('ceiling: an address that is over its own allowance is refused without spending the overall ceiling', (w2.counters.get('record-site-event-global::record-site-event-global') ?? 0) === LIMIT);
  }

  // ---- everything malformed or unexpected is rejected, and nothing is written ----
  const rejected: Array<[string, unknown, boolean?]> = [
    ['invalid JSON', '{not json', true],
    ['an empty body', '', true],
    ['a JSON array', [GOOD]],
    ['a JSON string', '"page_view"'],
    ['null', null],
    ['a missing event name', { session_id: SESSION }],
    ['a non-string event name', { event_name: 5 }],
    ['an unknown event name', { event_name: 'admin_login' }],
    ['a retired event name', { event_name: 'quote_started' }],
    ['an event name in other case', { event_name: 'PAGE_VIEW' }],
    ['an event name with spaces', { event_name: ' page_view ' }],
    ['an empty event name', { event_name: '' }],
    ['an unknown field', { ...GOOD, extra: 1 }],
    ['a client-supplied timestamp', { ...GOOD, created_at: '2020-01-01T00:00:00Z' }],
    ['a client-supplied id', { ...GOOD, id: '33333333-3333-4333-8333-333333333333' }],
    ['a user id', { ...GOOD, user_id: '33333333-3333-4333-8333-333333333333' }],
    ['a customer id', { ...GOOD, customer_id: '33333333-3333-4333-8333-333333333333' }],
    ['an email', { ...GOOD, email: 'a@b.test' }],
    ['a phone', { ...GOOD, phone: '5551234567' }],
    ['a referrer', { ...GOOD, referrer: 'https://evil.test' }],
    ['an IP address', { ...GOOD, ip: '1.2.3.4' }],
    ['a user agent', { ...GOOD, user_agent: 'x' }],
    ['a role', { ...GOOD, role: 'admin' }],
    ['a session id that is not a UUID', { ...GOOD, session_id: 'not-a-uuid' }],
    ['a very long session id', { ...GOOD, session_id: 'a'.repeat(5000) }],
    ['a unit id that is not a UUID', { ...GOOD, unit_id: '1; DROP TABLE units' }],
    ['an order id that is not a UUID', { ...GOOD, order_id: 'abc' }],
    ['a non-string path', { ...GOOD, page_path: 5 }],
    ['a path that does not start with a slash', { ...GOOD, page_path: 'quote' }],
    ['a path with a query string', { ...GOOD, page_path: '/quote?token=secret' }],
    ['a path with a hash', { ...GOOD, page_path: '/quote#x' }],
    ['a path with a control character', { ...GOOD, page_path: '/quo\u0000te' }],
    ['an oversized path', { ...GOOD, page_path: '/' + 'a'.repeat(400) }],
    ['an empty path', { ...GOOD, page_path: '' }],
    ['metadata that is an array', { ...GOOD, metadata: ['x'] }],
    ['metadata that is an empty array', { ...GOOD, metadata: [] }],
    ['metadata with an unknown key', { ...GOOD, metadata: { email: 'a@b.test' } }],
    ['metadata with a nested object', { ...GOOD, metadata: { name: { deep: 1 } } }],
    ['metadata with a nested array', { ...GOOD, metadata: { name: ['x'] } }],
    ['metadata with a number', { ...GOOD, metadata: { name: 5 } }],
    ['an oversized metadata value', { ...GOOD, metadata: { name: 'n'.repeat(201) } }],
    ['metadata with a control character', { ...GOOD, metadata: { slug: 'a\u0007b' } }],
    ['metadata that is a string', { ...GOOD, metadata: 'x' }],
    ['an oversized body', { ...GOOD, page_path: '/x', padding: 'p'.repeat(3000) }],
    ['an oversized body that is otherwise a valid event (padded with whitespace)', '{"event_name":"page_view"' + ' '.repeat(3000) + '}', true],
  ];
  for (const [label, body, raw] of rejected) {
    const w = newWorld();
    const r = await send(w, body, { raw: !!raw });
    ok(`rejected: ${label} -> 400 and nothing written`, r.status === 400 && w.attempts.length === 0 && w.inserts.length === 0 && r.json?.success === false);
  }
  {
    const w = newWorld();
    const r = await send(w, '{"event_name":"page_view","padding":"' + 'x'.repeat(MAXBODY()) + '"}', { raw: true });
    ok('rejected: a body just over the size limit never reaches the database', r.status === 400 && w.attempts.length === 0);
    function MAXBODY() { return siteEvents.MAX_SITE_EVENT_BODY_CHARS; }
  }
  {
    const w = newWorld();
    await send(w, { event_name: 'page_view', metadata: { name: 'n'.repeat(200), slug: 's'.repeat(200) } });
    ok('boundary: metadata values of exactly the maximum length are accepted', w.inserts.length === 1);
    const w2 = newWorld();
    await send(w2, { event_name: 'page_view', page_path: '/' + 'a'.repeat(siteEvents.MAX_PAGE_PATH_CHARS - 1) });
    ok('boundary: a path of exactly the maximum length is accepted', w2.inserts.length === 1);
  }

  // ---- errors behind the validator ----
  {
    const w = newWorld();
    w.insertError = (row, attempt) => (attempt === 1 && (row.unit_id || row.order_id) ? { code: '23503', message: 'insert or update on table "site_events" violates foreign key constraint' } : null);
    const r = await send(w, { event_name: 'unit_view', session_id: SESSION, unit_id: UNIT, order_id: ORDER });
    ok('an unknown unit / order id is dropped and the event still counts (no way to probe which ids exist)', r.status === 200 && w.attempts.length === 2 && w.inserts.length === 1 && w.inserts[0].unit_id === null && w.inserts[0].order_id === null);
    ok('... and the answer is identical to a normal success', JSON.stringify(r.json) === JSON.stringify({ success: true }));
  }
  {
    const w = newWorld();
    w.insertError = () => ({ code: '42P01', message: 'relation "public.site_events" does not exist at character 13' });
    const r = await send(w, GOOD);
    ok('a database error is a generic 500 that leaks nothing', r.status === 500 && r.json?.error === 'Could not record the event' && !/relation|site_events|42P01|character/.test(r.text));
  }
  {
    const w = newWorld();
    w.insertError = () => ({ code: '23503', message: 'fk' });
    const r = await send(w, { event_name: 'unit_view', unit_id: UNIT });
    ok('a foreign-key failure that persists after the retry is a generic 500', r.status === 500 && w.attempts.length === 2);
  }

  // ---- other methods ----
  {
    const handler = loadHandler(newWorld());
    const options = await handler(new Request('https://fake.functions/x', { method: 'OPTIONS' }));
    ok('OPTIONS preflight answers 200 with CORS headers', options.status === 200 && options.headers.get('Access-Control-Allow-Origin') === '*');
    const get = await handler(new Request('https://fake.functions/x', { method: 'GET' }));
    ok('GET is refused (405) and writes nothing', get.status === 405);
  }

  // ---- source-level guarantees ----
  {
    const iValidate = fnSource.indexOf('validateSiteEvent(');
    const iInsert = fnSource.indexOf('.insert(');
    const iRate = fnSource.indexOf('checkRateLimit(');
    const iParse = fnSource.indexOf('JSON.parse(');
    ok('source: the rate limit is checked before the body is read or parsed', iRate > 0 && iRate < fnSource.indexOf('req.text()') && iRate < iParse);
    ok('source: the event is validated before anything is written', iValidate > 0 && iValidate < iInsert);
    ok('source: both limiter calls opt in to failing closed (the fifth argument) and nothing is written before they decide', /checkRateLimit\(endpoint, key, undefined, false, true\)/.test(fnSource) && fnSource.indexOf('admit("record-site-event-global"') < iInsert && fnSource.indexOf('admit("record-site-event"') < iInsert);
    ok('source: a limiter failure is reported as unavailable (503), never as allowed', /kind: "unavailable"/.test(fnSource) && /respond\(503, \{ success: false, error: "Analytics unavailable" \}\)/.test(fnSource));
    ok('source: the service role writes it (the table no longer accepts the public key)', /SUPABASE_SERVICE_ROLE_KEY/.test(fnSource) && !/SUPABASE_ANON_KEY/.test(fnSource));
    const fnCode = fnSource.split('\n').map((l: string) => l.replace(/\/\/.*$/, '')).join('\n');
    ok('source: no timestamp, identity or header value is added to the row', !/created_at|user_id|customer_id|req\.headers\.get\("(user-agent|referer|referrer|authorization)"\)/i.test(fnCode));
    ok('source: it collects no new identifier (only the shared limiter\'s request address is used)', !/fingerprint|user-agent|cookie/i.test(fnSource));
    ok('source: every failure answer is generic', !/error\.message|error\.details|JSON\.stringify\(error\)/.test(fnSource));
    ok('config: the function is public (visitors are anonymous) and registered', /\[functions\.record-site-event\]\s*verify_jwt = false/.test(read('supabase/config.toml')));
    const browser = read('src/lib/core/siteEvents.ts');
    ok('browser: events go through the ingestion function, never a direct table insert', /functions\.invoke\('record-site-event'/.test(browser) && !/from\('site_events'\)/.test(browser));
    const sent = browser.slice(browser.indexOf("functions.invoke('record-site-event'"), browser.indexOf('} catch', browser.indexOf("functions.invoke('record-site-event'")));
    ok('browser: the browser sends only the six known fields', ['event_name', 'session_id', 'unit_id', 'order_id', 'page_path', 'metadata'].every((k) => sent.includes(k)) && !/created_at|user_id|referrer|email|phone/.test(sent));
    ok('browser: Admin and Master sessions are still not tracked', /isAdminOrMaster\(\)/.test(browser) && /if \(adminOrMaster\) return;/.test(browser));
    ok('browser: failures never break the page', /Tracking failures must never break the user experience/.test(browser));
    const analytics = read('src/components/admin/SiteAnalytics.tsx');
    ok('admin: the Site Analytics screen still only reads site_events', /from\('site_events'\)\.select/.test(analytics) && !/from\('site_events'\)\.insert/.test(analytics));
  }

  console.log(`Site event ingestion tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} site event ingestion test(s) failed`);
})();
