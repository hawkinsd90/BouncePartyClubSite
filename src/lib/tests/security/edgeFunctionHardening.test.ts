// Handler-level tests for the Step 3B Edge Function corrections: Twilio webhook authentication (SEC-025, SEC-026), retired endpoints
// (SEC-023, SEC-024, SEC-032), Google Calendar sync authorization (SEC-027), crash-report input safety (SEC-028) and the Stripe return
// bridge (SEC-029).
//
// The CURRENT function sources are loaded, their imports stripped, transpiled and run with fakes (Deno, createClient, rate limiter) plus
// the REAL shared helpers. Nothing touches a network, a database, Twilio, Stripe or an email provider: the fake database records every
// read and write, and a rejected request must leave it untouched.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');

import * as authHelpers from '../../../../supabase/functions/_shared/auth';
import * as twilioSig from '../../../../supabase/functions/_shared/twilio-signature';
import * as returnOrigin from '../../../../supabase/functions/_shared/booking/returnOrigin';
import * as smsInbound from '../../../../supabase/functions/_shared/sms/inbound';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}

const SERVICE_KEY = 'svc-key-0123456789abcdef';
const ANON_KEY = 'anon-key-0123456789abcdef';
const SUPA = 'https://fake.supabase.co';
const TWILIO_TOKEN = 'twilio-token-for-tests';

function makeWorld(settings: Record<string, string> = {}) {
  return {
    roles: { 'u-master': ['master'], 'u-admin': ['admin'], 'u-crew': ['crew'], 'u-cust': ['customer'], 'u-norole': [] as string[] } as Record<string, string[]>,
    tokens: { 'jwt-master': 'u-master', 'jwt-admin': 'u-admin', 'jwt-crew': 'u-crew', 'jwt-cust': 'u-cust', 'jwt-norole': 'u-norole' } as Record<string, string>,
    settings,
    reads: [] as string[],
    writes: [] as Array<{ table: string; op: string; payload: any }>,
    invokes: [] as Array<{ fn: string; body: any }>,
    fetches: [] as string[], // every outbound HTTP request the function tried to make (Stripe, Twilio, Google, e-mail provider ...)
    rateCalls: [] as string[],
    rateDeny: '' as string, // '' = allow; 'all' = deny every bucket; otherwise the one endpoint bucket to deny
  };
}
type World = ReturnType<typeof makeWorld>;

function makeClient(w: World) {
  return {
    auth: {
      getUser: async (token: string) => {
        const id = w.tokens[token];
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
      },
    },
    functions: {
      invoke: async (fn: string, opts: any) => {
        w.invokes.push({ fn, body: opts?.body });
        return { data: {}, error: null };
      },
    },
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let op = 'select';
      let payload: any = null;
      const api: any = {
        select: () => api,
        insert: (p: any) => { op = 'insert'; payload = p; return api; },
        update: (p: any) => { op = 'update'; payload = p; return api; },
        upsert: (p: any) => { op = 'upsert'; payload = p; return api; },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
        in: () => api,
        ilike: () => api,
        is: () => api,
        order: () => api,
        limit: () => api,
        maybeSingle: async () => {
          if (table !== 'user_roles') w.reads.push(table);
          if (table === 'admin_settings') {
            const key = filters.find(([c]) => c === 'key')?.[1] as string;
            return { data: key in w.settings ? { value: w.settings[key] } : null, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: any, reject: any) => {
          if (op !== 'select') {
            w.writes.push({ table, op, payload });
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          let rows: any[] = [];
          if (table === 'user_roles') {
            const uid = filters.find(([c]) => c === 'user_id')?.[1] as string;
            rows = (w.roles[uid] ?? []).map((role) => ({ role }));
          } else {
            w.reads.push(table);
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

function loadHandler(fnPath: string, w: World, env: Record<string, string> = {}): (req: Request) => Promise<Response> {
  const src: string = fs.readFileSync(fnPath, 'utf8');
  const js: string = ts.transpileModule(src.replace(/^import[^;]*;/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let captured: any = null;
  const environment: Record<string, string> = { SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ...env };
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => environment[k] }, serve: (h: any) => { captured = h; } },
    createClient: () => makeClient(w),
    console: { log: () => {}, info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    fetch: async (url: unknown) => { w.fetches.push(String(url)); return new Response('{}', { status: 200 }); },
    resolveCaller: authHelpers.resolveCaller,
    requireRoles: authHelpers.requireRoles,
    authFailureResponse: authHelpers.authFailureResponse,
    STAFF_ADMIN_ROLES: authHelpers.STAFF_ADMIN_ROLES,
    formParams: twilioSig.formParams,
    twilioCandidateUrls: twilioSig.twilioCandidateUrls,
    verifyTwilioRequest: twilioSig.verifyTwilioRequest,
    resolveReturnOrigin: returnOrigin.resolveReturnOrigin,
    ...smsInbound,
    getIdentifier: () => '203.0.113.7',
    buildRateLimitKey: (ip: string, _s?: string, prefix?: string) => `${prefix}|ip:${ip}`,
    checkRateLimit: async (endpoint: string) => {
      w.rateCalls.push(endpoint);
      return w.rateDeny === 'all' || w.rateDeny === endpoint ? { allowed: false, reason: 'rate_limited', retry_after: 30 } : { allowed: true };
    },
    createRateLimitResponse: (r: any, cors: Record<string, string>) => new Response(JSON.stringify({ error: 'Too many requests', reason: r.reason }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } }),
  };
  const names = Object.keys(scope);
  new Function(...names, js)(...names.map((n) => scope[n]));
  if (!captured) throw new Error('Deno.serve not called for ' + fnPath);
  return captured;
}

async function textOf(res: Response): Promise<string> {
  try { return await res.clone().text(); } catch { return ''; }
}

(async () => {
  // ---------------------------------------------------------------------------------------------------------------
  // Twilio signature algorithm: known vector from Twilio's published documentation
  // ---------------------------------------------------------------------------------------------------------------
  const vector = await twilioSig.computeTwilioSignature(
    'https://mycompany.com/myapp.php?foo=1&bar=2',
    { Digits: '1234', To: '+18005551212', From: '+14158675310', Caller: '+14158675310', CallSid: 'CA1234567890ABCDE' },
    '12345',
  );
  ok('twilio signature: matches the documentation vector (value also reproduced with an independent HMAC-SHA1 implementation)', vector === 'GvWf1cFY/Q7PnoempGyD5oXAezc=');
  ok('twilio signature: a different parameter order gives the same signature (parameters are sorted)',
    (await twilioSig.computeTwilioSignature('https://x.test/a', { b: '2', a: '1' }, 't')) === (await twilioSig.computeTwilioSignature('https://x.test/a', { a: '1', b: '2' }, 't')));
  ok('twilio signature: changing one value changes the signature',
    (await twilioSig.computeTwilioSignature('https://x.test/a', { a: '1' }, 't')) !== (await twilioSig.computeTwilioSignature('https://x.test/a', { a: '2' }, 't')));

  // ---------------------------------------------------------------------------------------------------------------
  // twilio-webhook and twilio-status-callback
  // ---------------------------------------------------------------------------------------------------------------
  const webhookUrl = `${SUPA}/functions/v1/twilio-webhook`;
  const statusUrl = `${SUPA}/functions/v1/twilio-status-callback`;
  const inbound = { MessageSid: 'SM1', From: '+15551230001', To: '+15559990000', Body: 'Hello', SmsStatus: 'received' };
  const statusParams = { MessageSid: 'SM1', MessageStatus: 'delivered' };

  async function twilioCall(fn: string, url: string, params: Record<string, string>, opts: { signature?: string | 'valid' | null; settings?: Record<string, string>; method?: string; env?: Record<string, string> }) {
    const w = makeWorld(opts.settings ?? { twilio_auth_token: TWILIO_TOKEN });
    const handler = loadHandler(`supabase/functions/${fn}/index.ts`, w, opts.env);
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (opts.signature === 'valid') headers['X-Twilio-Signature'] = await twilioSig.computeTwilioSignature(url, params, TWILIO_TOKEN);
    else if (typeof opts.signature === 'string') headers['X-Twilio-Signature'] = opts.signature;
    const method = opts.method ?? 'POST';
    const res = await handler(new Request(url, { method, headers, body: method === 'POST' ? new URLSearchParams(params).toString() : undefined }));
    return { res, w, text: await textOf(res) };
  }
  const onlyTokenRead = (w: World) => w.writes.length === 0 && w.fetches.length === 0 && w.invokes.length === 0 && w.reads.every((t) => t === 'admin_settings');

  for (const [fn, url, params, label] of [['twilio-webhook', webhookUrl, inbound, 'inbound webhook'], ['twilio-status-callback', statusUrl, statusParams, 'status callback']] as const) {
    let r = await twilioCall(fn, url, params, { signature: null });
    ok(`${label}: no signature header is rejected 403 and writes nothing`, r.res.status === 403 && onlyTokenRead(r.w));
    r = await twilioCall(fn, url, params, { signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
    ok(`${label}: a wrong signature is rejected 403 and writes nothing`, r.res.status === 403 && onlyTokenRead(r.w));
    r = await twilioCall(fn, url, params, { signature: await twilioSig.computeTwilioSignature(url, params, 'some-other-token') });
    ok(`${label}: a signature made with another token is rejected 403`, r.res.status === 403 && onlyTokenRead(r.w));
    r = await twilioCall(fn, url, { ...params, Body: 'tampered', MessageStatus: 'failed' }, { signature: await twilioSig.computeTwilioSignature(url, params, TWILIO_TOKEN) });
    ok(`${label}: a valid signature over DIFFERENT parameters (tampered body) is rejected 403`, r.res.status === 403 && onlyTokenRead(r.w));
    r = await twilioCall(fn, url, params, { signature: 'valid', settings: {} });
    ok(`${label}: with no Twilio token configured every request is rejected (fail closed)`, r.res.status === 403 && onlyTokenRead(r.w));
    r = await twilioCall(fn, url, params, { signature: 'valid', settings: { twilio_auth_token: '   ' } });
    ok(`${label}: a blank Twilio token is rejected (fail closed)`, r.res.status === 403 && onlyTokenRead(r.w));
    r = await twilioCall(fn, url, params, { signature: ANON_KEY });
    ok(`${label}: the public anon key in the signature header is just a wrong signature`, r.res.status === 403 && onlyTokenRead(r.w));
    r = await twilioCall(fn, url, params, { signature: 'valid' });
    ok(`${label}: a correctly signed request is accepted (${r.res.status}) and makes no outbound provider call`, r.res.status === 200 && r.w.writes.length >= 1 && r.w.fetches.length === 0);
    r = await twilioCall(fn, url.replace('https://', 'http://'), params, { signature: await twilioSig.computeTwilioSignature(url, params, TWILIO_TOKEN) });
    ok(`${label}: a request seen as http but signed for the https URL is accepted`, r.res.status === 200 && r.w.writes.length >= 1);
    r = await twilioCall(fn, url, params, { signature: await twilioSig.computeTwilioSignature('https://other.example/f', params, TWILIO_TOKEN) });
    ok(`${label}: a signature made for a different URL (a replayed request) is rejected`, r.res.status === 403 && onlyTokenRead(r.w));
    r = await twilioCall(fn, 'https://custom.example/hook', params, { signature: await twilioSig.computeTwilioSignature('https://custom.example/hook', params, TWILIO_TOKEN), env: { [fn === 'twilio-webhook' ? 'TWILIO_WEBHOOK_URL' : 'TWILIO_STATUS_CALLBACK_URL']: 'https://custom.example/hook' } });
    ok(`${label}: the configured public URL override is honoured`, r.res.status === 200 && r.w.writes.length >= 1);
  }
  {
    const r = await twilioCall('twilio-webhook', webhookUrl, {}, { signature: null, method: 'GET' });
    ok('twilio-webhook: the GET health check still answers without a signature and touches nothing', r.res.status === 200 && r.w.reads.length === 0 && r.w.writes.length === 0);
    const ok1 = await twilioCall('twilio-webhook', webhookUrl, inbound, { signature: 'valid' });
    ok('twilio-webhook: a signed inbound message stores the conversation and answers with the auto-reply TwiML', ok1.res.status === 200 && /<Message>/.test(ok1.text) && ok1.w.writes.some((x) => x.table === 'sms_conversations' && x.op === 'insert' && x.payload.direction === 'inbound'));
    const ok2 = await twilioCall('twilio-status-callback', statusUrl, statusParams, { signature: 'valid' });
    ok('twilio-status-callback: a signed status updates only the matching message', ok2.res.status === 200 && ok2.w.writes.length === 1 && ok2.w.writes[0].table === 'sms_conversations' && ok2.w.writes[0].op === 'update' && ok2.w.writes[0].payload.status === 'delivered');
  }
  {
    const cfg = fs.readFileSync('supabase/config.toml', 'utf8').replace(/\r\n/g, '\n');
    const setting = (fn: string) => new RegExp(`\\[functions\\.${fn}\\]\\nverify_jwt = (true|false)`).exec(cfg)?.[1];
    ok('config: twilio-status-callback does not require a Supabase JWT (Twilio cannot send one; the signature is the proof)', setting('twilio-status-callback') === 'false');
    ok('config: twilio-webhook does not require a Supabase JWT', setting('twilio-webhook') === 'false');
    const dirs = fs.readdirSync('supabase/functions', { withFileTypes: true }).filter((d: any) => d.isDirectory() && d.name !== '_shared' && d.name !== 'node_modules' && fs.existsSync(`supabase/functions/${d.name}/index.ts`)).map((d: any) => d.name);
    const missing = dirs.filter((d: string) => setting(d) === undefined);
    ok(`config: every function directory has an explicit verify_jwt block (missing: ${missing.join(', ') || 'none'})`, missing.length === 0);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Retired endpoints
  // ---------------------------------------------------------------------------------------------------------------
  for (const fn of ['get-session-metadata', 'get-payment-method', 'create-order-short-link']) {
    const src = fs.readFileSync(`supabase/functions/${fn}/index.ts`, 'utf8');
    ok(`${fn}: the retired source imports nothing that could reach Stripe, the database or a provider`, !/createClient|Stripe|stripe|supabase-js|SERVICE_ROLE|admin_settings|\.rpc\(/.test(src.replace(/\/\/[^\n]*/g, '')));
    for (const method of ['POST', 'GET']) {
      const w = makeWorld();
      const handler = loadHandler(`supabase/functions/${fn}/index.ts`, w);
      const res = await handler(new Request(`${SUPA}/functions/v1/${fn}`, { method, headers: { Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ sessionId: 'cs_x', paymentMethodId: 'pm_x', orderId: 'o' }) : undefined }));
      const j = JSON.parse(await textOf(res));
      ok(`${fn}: ${method} answers 410 ENDPOINT_RETIRED and touches nothing`, res.status === 410 && j.code === 'ENDPOINT_RETIRED' && w.reads.length === 0 && w.writes.length === 0 && w.invokes.length === 0 && w.fetches.length === 0);
    }
    const pre = await loadHandler(`supabase/functions/${fn}/index.ts`, makeWorld())(new Request(`${SUPA}/f`, { method: 'OPTIONS' }));
    ok(`${fn}: the CORS preflight still answers 200`, pre.status === 200);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // sync-google-calendar
  // ---------------------------------------------------------------------------------------------------------------
  async function gcal(bearer: string | null) {
    const w = makeWorld();
    const handler = loadHandler('supabase/functions/sync-google-calendar/index.ts', w);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearer !== null) headers.Authorization = `Bearer ${bearer}`;
    const res = await handler(new Request(`${SUPA}/functions/v1/sync-google-calendar`, { method: 'POST', headers, body: JSON.stringify({ dates: ['2030-06-01'], reconcile: true }) }));
    return { res, w, text: await textOf(res) };
  }
  const untouched = (w: World) => w.reads.length === 0 && w.writes.length === 0 && w.fetches.length === 0 && w.invokes.length === 0;
  let g = await gcal(ANON_KEY);
  ok('sync-google-calendar: only the public anon key is 401 and touches nothing (no credentials read, no queue write)', g.res.status === 401 && untouched(g.w));
  g = await gcal(null);
  ok('sync-google-calendar: no Authorization header is 401', g.res.status === 401 && untouched(g.w));
  g = await gcal('jwt-cust');
  ok('sync-google-calendar: a signed-in customer is 403', g.res.status === 403 && untouched(g.w));
  g = await gcal('jwt-crew');
  ok('sync-google-calendar: crew is 403', g.res.status === 403 && untouched(g.w));
  g = await gcal('jwt-norole');
  ok('sync-google-calendar: a signed-in user with no role is 403', g.res.status === 403 && untouched(g.w));
  g = await gcal('jwt-admin');
  ok('sync-google-calendar: an admin passes the gate (the function then reports unconfigured credentials and calls no provider)', g.res.status !== 401 && g.res.status !== 403 && g.w.reads.includes('admin_settings') && g.w.fetches.length === 0);
  g = await gcal('jwt-master');
  ok('sync-google-calendar: a master passes the gate', g.res.status !== 401 && g.res.status !== 403);
  g = await gcal(SERVICE_KEY);
  ok('sync-google-calendar: the service-role key (the database trigger) passes the gate', g.res.status !== 401 && g.res.status !== 403 && g.w.reads.includes('admin_settings'));

  // ---------------------------------------------------------------------------------------------------------------
  // send-error-notification
  // ---------------------------------------------------------------------------------------------------------------
  async function report(body: unknown, opts: { deny?: string; raw?: string } = {}) {
    const w = makeWorld({ admin_email: 'owner@example.test' });
    w.rateDeny = opts.deny ?? '';
    const handler = loadHandler('supabase/functions/send-error-notification/index.ts', w);
    const res = await handler(new Request(`${SUPA}/functions/v1/send-error-notification`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}` }, body: opts.raw ?? JSON.stringify(body) }));
    return { res, w, json: JSON.parse((await textOf(res)) || 'null') };
  }
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)><a href="https://evil.example">click</a>';
  let e = await report({ message: evil, stack: evil, componentStack: evil, url: evil, userAgent: evil, userId: evil, additionalInfo: { note: evil }, timestamp: evil });
  const html: string = e.w.invokes[0]?.body?.html ?? '';
  ok('send-error-notification: a report is relayed once to the configured admin address', e.res.status === 200 && e.w.invokes.length === 1 && e.w.invokes[0].fn === 'send-email' && e.w.invokes[0].body.to === 'owner@example.test' && e.w.invokes[0].body.skipFallback === true);
  ok('send-error-notification: no raw HTML from the caller survives in the email body', html.length > 0 && !/<script>|<img src=x|<a href="https:\/\/evil/.test(html) && /&lt;script&gt;/.test(html));
  const ts1 = await report({ message: 'boom', timestamp: '1999-01-01T00:00:00Z' });
  ok('send-error-notification: the caller-supplied timestamp is ignored (server time is used)', !(ts1.w.invokes[0]?.body?.html ?? '').includes('1999-01-01') && /20\d\d-\d\d-\d\dT/.test(ts1.w.invokes[0]?.body?.html ?? ''));
  e = await report({ message: 'x'.repeat(100000), stack: 'y'.repeat(500000), additionalInfo: { big: 'z'.repeat(500000) } });
  const big: string = e.w.invokes[0]?.body?.html ?? '';
  ok('send-error-notification: oversized fields are capped (the email stays small)', e.res.status === 200 && big.length < 40000 && !/x{600}/.test(big));
  e = await report({ message: 'line1\r\nBcc: attacker@example.test' });
  ok('send-error-notification: line breaks cannot reach the subject header', !/[\r\n]/.test(e.w.invokes[0]?.body?.subject ?? 'x'));
  ok('send-error-notification (NI-08): the report goes to the guarded send-email relay, not to a function that does not exist', !/invoke\(\s*'resend'/.test(fs.readFileSync('supabase/functions/send-error-notification/index.ts', 'utf8')) && fs.existsSync('supabase/functions/send-email/index.ts') && !fs.existsSync('supabase/functions/resend'));
  e = await report({});
  ok('send-error-notification: a report without a message is 400 and sends nothing', e.res.status === 400 && e.w.invokes.length === 0);
  e = await report(null, { raw: 'not json' });
  ok('send-error-notification: a malformed body is 400 (not a 500 with details) and sends nothing', e.res.status === 400 && e.w.invokes.length === 0);
  e = await report({ message: 'boom' }, { deny: 'all' });
  ok('send-error-notification: a rate-limited caller gets 429 and nothing is read or sent', e.res.status === 429 && e.w.invokes.length === 0 && e.w.reads.length === 0 && e.w.fetches.length === 0);
  e = await report({ message: 'boom' }, { deny: 'send-error-notification' });
  ok('send-error-notification: the per-address limit alone is enough to refuse (429, nothing sent)', e.res.status === 429 && e.w.invokes.length === 0);
  e = await report({ message: 'boom' }, { deny: 'send-error-notification-global' });
  ok('send-error-notification: the global ceiling alone is enough to refuse (429, nothing sent)', e.res.status === 429 && e.w.invokes.length === 0);
  ok('send-error-notification: both the per-address and the global limiter are consulted', (await report({ message: 'boom' })).w.rateCalls.join() === 'send-error-notification,send-error-notification-global');
  {
    const w = makeWorld({ admin_email: 'owner@example.test' });
    const orig = makeClient(w);
    (orig.functions as any).invoke = async () => ({ data: null, error: { message: 'SECRET internal failure detail' } });
    const handler = loadHandler('supabase/functions/send-error-notification/index.ts', w);
    // The fake world cannot swap the client per call, so check the source: failure responses never echo provider errors.
    void handler;
    const src = fs.readFileSync('supabase/functions/send-error-notification/index.ts', 'utf8');
    ok('send-error-notification: failure responses carry no provider error details or exception messages', !/details:\s*sendEmailError/.test(src) && !/message:\s*message/.test(src));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // checkout-bridge
  // ---------------------------------------------------------------------------------------------------------------
  async function bridge(qs: string, env: Record<string, string> = {}) {
    const w = makeWorld();
    const handler = loadHandler('supabase/functions/checkout-bridge/index.ts', w, env);
    const res = await handler(new Request(`${SUPA}/functions/v1/checkout-bridge?${qs}`));
    return { res, html: await textOf(res) };
  }
  const targetOf = (html: string) => /window\.opener\.postMessage\(msg, ("[^"]*")\)/.exec(html)?.[1];
  let b = await bridge('orderId=o1&session_id=cs_1&origin=https%3A%2F%2Fevil.example');
  ok('checkout-bridge: a foreign origin is replaced by the production origin, never echoed or "*"', targetOf(b.html) === '"https://bouncepartyclub.com"');
  b = await bridge('orderId=o1&session_id=cs_1');
  ok('checkout-bridge: no origin parameter no longer means the wildcard "*"', targetOf(b.html) === '"https://bouncepartyclub.com"');
  b = await bridge('orderId=o1&session_id=cs_1&origin=https%3A%2F%2Fwww.bouncepartyclub.com');
  ok('checkout-bridge: an allowlisted origin is honoured', targetOf(b.html) === '"https://www.bouncepartyclub.com"');
  b = await bridge('orderId=o1&session_id=cs_1&origin=https%3A%2F%2Fdev.example.test', { SITE_URL: 'https://dev.example.test' });
  ok('checkout-bridge: the configured SITE_URL origin is honoured', targetOf(b.html) === '"https://dev.example.test"');
  b = await bridge('orderId=o1&session_id=cs_1&origin=http%3A%2F%2Flocalhost%3A5173');
  ok('checkout-bridge: a loopback development origin is honoured', targetOf(b.html) === '"http://localhost:5173"');
  b = await bridge('orderId=%3C%2Fscript%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E&session_id=%3C!--');
  ok('checkout-bridge: markup in the parameters cannot close the inline script', (b.html.match(/<\/script>/g) ?? []).length === 1 && !/<script>alert/.test(b.html) && !b.html.includes('<!--'));
  b = await bridge('orderId=o1&session_id=cs_1&origin=https%3A%2F%2Fbouncepartyclub.com');
  ok('checkout-bridge: the legitimate return still carries both identifiers to the opener', /BPC_CHECKOUT_COMPLETE/.test(b.html) && b.html.includes('"o1"') && b.html.includes('"cs_1"') && b.res.headers.get('cache-control') === 'no-store');

  // ---------------------------------------------------------------------------------------------------------------
  // SEC-031: the hosted-only booking-confirmation function has no remaining caller in the repository
  // ---------------------------------------------------------------------------------------------------------------
  {
    const hits: string[] = [];
    const NL = String.fromCharCode(10);
    const code = (text: string) => text.split(NL).filter((ln) => !ln.trim().startsWith('//')).join(NL);
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = d + '/' + e.name;
        if (e.isDirectory()) {
          if (e.name !== 'node_modules' && e.name !== 'tests') walk(p);
        } else if ((e.name.endsWith('.ts') || e.name.endsWith('.tsx')) && !e.name.includes('.test.') && code(fs.readFileSync(p, 'utf8')).includes('send-booking-confirmation')) {
          hits.push(p);
        }
      }
    };
    walk('src'); walk('supabase/functions');
    ok(`SEC-031: no application or Edge Function code invokes send-booking-confirmation (callers: ${hits.join(', ') || 'none'})`, hits.length === 0);
    const cb = fs.readFileSync('supabase/functions/complete-booking/index.ts', 'utf8');
    ok('SEC-031: complete-booking claims, then finalizes or releases, the confirmation itself', /claim_booking_confirmation/.test(cb) && /finalize_booking_confirmation/.test(cb) && /release_booking_confirmation/.test(cb));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Deployment register: every changed function is listed with its JWT model, and no function source is accidentally empty
  // ---------------------------------------------------------------------------------------------------------------
  {
    const doc = fs.readFileSync('audit/security/step3-step4-deployment-dependencies.md', 'utf8');
    const NL2 = String.fromCharCode(10);
    const cfgText = fs.readFileSync('supabase/config.toml', 'utf8').split(String.fromCharCode(13)).join('');
    const jwtIs = (fn: string, want: string) => cfgText.includes('[functions.' + fn + ']' + NL2 + 'verify_jwt = ' + want);
    const CHANGED: Record<string, string> = {
      'twilio-webhook': 'false', 'twilio-status-callback': 'false', 'get-session-metadata': 'true', 'get-payment-method': 'true', 'create-order-short-link': 'true',
      'sync-google-calendar': 'true', 'send-error-notification': 'false', 'checkout-bridge': 'false', 'record-consent': 'true',
    };
    for (const [fn, want] of Object.entries(CHANGED)) {
      ok(`deployment register: ${fn} is listed in the Step 4 plan and config.toml sets verify_jwt = ${want}`, doc.includes('`' + fn + '`') && jwtIs(fn, want));
    }
    const importers = ['charge-deposit', 'check-availability', 'complete-booking', 'create-booking', 'customer-portal-action', 'record-site-event', 'request-portal-link', 'resolve-link', 'send-error-notification', 'stripe-checkout', 'stripe-refund', 'submit-contact-inquiry'];
    ok('deployment register: every importer of the shared rate limiter is named, and the list matches the source tree', importers.every((f) => doc.includes(f)) && importers.every((f) => fs.readdirSync('supabase/functions/' + f).some((n: string) => n.endsWith('.ts') && fs.readFileSync('supabase/functions/' + f + '/' + n, 'utf8').includes('rate-limit'))));
    const tiny = fs.readdirSync('supabase/functions', { withFileTypes: true }).filter((d: any) => d.isDirectory() && d.name !== 'node_modules' && d.name !== '_shared' && fs.existsSync('supabase/functions/' + d.name + '/index.ts')).filter((d: any) => fs.statSync('supabase/functions/' + d.name + '/index.ts').size < 500).map((d: any) => d.name);
    ok(`no function source is empty or near-empty (an empty index.ts would be deployed as a function that does nothing): ${tiny.join(', ') || 'none'}`, tiny.length === 0);
  }

  console.log(`Edge Function hardening tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} edge function hardening test(s) failed`);
})();
