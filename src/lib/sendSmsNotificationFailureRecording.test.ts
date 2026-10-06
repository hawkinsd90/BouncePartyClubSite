// Focused regression tests for supabase/functions/send-sms-notification/index.ts failure recording.
//
// Defect: when Twilio answered non-OK, the function called record_notification_failure in the Twilio
// branch and then threw into the outer catch, which recorded the same failure again, so one failed SMS
// produced two notification_failures rows (and advanced the failure counters twice).
//
// The edge function is a Deno module (jsr:/npm: imports, Deno.serve), so the test loads the CURRENT
// source text, strips its three import lines, transpiles the TypeScript, and runs it with fakes for
// Deno, createClient, formatOrderId and fetch. The fake Supabase client records every rpc() call; the
// fake fetch records Twilio and admin-fallback requests. Nothing here talks to a network.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');

let passed = 0;
let failed = 0;

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

function eq(label: string, actual: unknown, expected: unknown) {
  if (same(actual, expected)) { passed++; } else {
    failed++;
    console.error(`FAIL ${label}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

const SOURCE_PATH = 'supabase/functions/send-sms-notification/index.ts';

function loadHandler(env: Record<string, string>, createClientFake: (url: string, key: string) => any, fetchFake: any) {
  const raw = fs.readFileSync(SOURCE_PATH, 'utf8').replace(/\r\n/g, '\n');
  const stripped = raw.split('\n').filter((l: string) => !/^import\s/.test(l)).join('\n');
  const js = ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  let handler: ((req: Request) => Promise<Response>) | null = null;
  const Deno = { serve: (fn: any) => { handler = fn; }, env: { get: (k: string) => env[k] } };
  new Function('Deno', 'createClient', 'formatOrderId', 'fetch', js)(Deno, createClientFake, (id: string) => `#${String(id).slice(0, 8)}`, fetchFake);
  if (!handler) throw new Error('handler not registered');
  return handler as (req: Request) => Promise<Response>;
}

interface Scenario {
  body: any;
  rawBody?: string;
  // Twilio behavior
  twilio?: 'ok' | 'non-ok' | 'throws' | 'non-ok-bad-json';
  // record_notification_failure behavior
  failureRpc?: 'ok' | 'returns-error' | 'throws';
  settings?: Array<{ key: string; value: string }>;
  template?: any;
  order?: any;
  adminEmail?: string | null;
  adminPhone?: string | null;
}

const TWILIO_SETTINGS = [
  { key: 'twilio_account_sid', value: 'ACtest' }, { key: 'twilio_auth_token', value: 'tok' }, { key: 'twilio_from_number', value: '+15550001111' },
];

async function run(sc: Scenario) {
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const twilioCalls: any[] = [];
  const fallbackCalls: any[] = [];
  const conversationInserts: any[] = [];
  const tableData = (table: string, kind: 'list' | 'single', filter?: any) => {
    if (table === 'admin_settings') {
      if (kind === 'list') return sc.settings ?? TWILIO_SETTINGS;
      if (filter === 'admin_email') return sc.adminEmail === undefined ? { value: 'admin@example.test' } : (sc.adminEmail ? { value: sc.adminEmail } : null);
      if (filter === 'admin_phone') return sc.adminPhone === undefined ? { value: '+15557770000' } : (sc.adminPhone ? { value: sc.adminPhone } : null);
      return null;
    }
    if (table === 'sms_message_templates') return sc.template ?? null;
    if (table === 'orders') return sc.order ?? null;
    return null;
  };
  const supabaseFake = {
    from(table: string) {
      let filter: any;
      const b: any = {
        select: () => b,
        eq: (_k: string, v: any) => { filter = v; return b; },
        in: () => b,
        maybeSingle: () => Promise.resolve({ data: tableData(table, 'single', filter), error: null }),
        insert: (payload: any) => { if (table === 'sms_conversations') conversationInserts.push(payload); return Promise.resolve({ error: null }); },
        then: (res: any, rej: any) => Promise.resolve({ data: tableData(table, 'list'), error: null }).then(res, rej),
      };
      return b;
    },
    rpc(name: string, args: any) {
      rpcCalls.push({ name, args });
      if (name === 'record_notification_failure') {
        if (sc.failureRpc === 'throws') return Promise.reject(new Error('rpc unreachable'));
        if (sc.failureRpc === 'returns-error') return Promise.resolve({ data: null, error: { message: 'rpc rejected' } });
      }
      return Promise.resolve({ data: 'id', error: null });
    },
  };
  const fetchFake = async (url: string, init: any) => {
    if (String(url).includes('api.twilio.com')) {
      twilioCalls.push({ url, init });
      if (sc.twilio === 'throws') throw new TypeError('network down');
      if (sc.twilio === 'non-ok') return { ok: false, status: 400, json: async () => ({ code: 21211, message: "Invalid 'To' Phone Number", more_info: 'x' }) };
      if (sc.twilio === 'non-ok-bad-json') return { ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } };
      return { ok: true, status: 201, json: async () => ({ sid: 'SM123', status: 'queued' }) };
    }
    fallbackCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const handler = loadHandler({ SUPABASE_URL: 'https://x.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' }, () => supabaseFake, fetchFake);
  const realErr = console.error; const realWarn = console.warn; const realLog = console.log;
  console.error = () => {}; console.warn = () => {}; console.log = () => {};
  let status = 0; let body: any = null; let threw: any = null;
  try {
    const res = await handler(new Request('https://x.test/fn', { method: 'POST', body: sc.rawBody ?? JSON.stringify(sc.body) }));
    status = res.status; body = await res.json();
  } catch (e) { threw = e; } finally { console.error = realErr; console.warn = realWarn; console.log = realLog; }
  const failureCalls = rpcCalls.filter(c => c.name === 'record_notification_failure');
  const successCalls = rpcCalls.filter(c => c.name === 'record_notification_success');
  return { status, body, threw, rpcCalls, failureCalls, successCalls, twilioCalls, fallbackCalls, conversationInserts };
}

const EXPLICIT = { to: '5555550123', message: 'Hello there', orderId: 'ord-1' };
const TEMPLATE = { templateKey: 'pickup_thanks_sms', orderId: 'ord-1' };
const templateData = { template: { message_template: 'Thanks {name}' }, order: { id: 'ord-1', customers: { first_name: 'Ann', last_name: 'Lee', phone: '+15555550199' }, has_pets: false, event_date: '2026-07-04' } };

(async () => {
  // ---- Successful Twilio send ----
  {
    const r = await run({ body: EXPLICIT, twilio: 'ok' });
    eq('success: HTTP status and body', [r.status, r.body], [200, { success: true, messageSid: 'SM123', status: 'queued' }]);
    eq('success: Twilio called once', r.twilioCalls.length, 1);
    eq('success: zero failure RPCs', r.failureCalls.length, 0);
    eq('success: record_notification_success exactly once', r.successCalls.length, 1);
    eq('success: success RPC argument', r.successCalls[0].args, { p_type: 'sms' });
    eq('success: sms_conversations persisted once', r.conversationInserts.length, 1);
    eq('success: no admin fallback', r.fallbackCalls.length, 0);
    eq('success: Twilio request normalizes the number and carries the message', String(r.twilioCalls[0].init.body).includes('To=%2B15555550123') && String(r.twilioCalls[0].init.body).includes('Body=Hello+there'), true);
  }

  // ---- Twilio non-OK, explicit to/message: the duplicate path ----
  {
    const r = await run({ body: EXPLICIT, twilio: 'non-ok' });
    eq('non-OK: Twilio called once', r.twilioCalls.length, 1);
    eq('non-OK: EXACTLY ONE failure RPC for one failed SMS attempt', r.failureCalls.length, 1);
    eq('non-OK: failure RPC payload (normalized recipient, Twilio code in context)', r.failureCalls[0].args, {
      p_type: 'sms', p_recipient: '+15555550123', p_subject: null, p_message_preview: 'Hello there',
      p_error: "Twilio API error (21211): Invalid 'To' Phone Number", p_context: { orderId: 'ord-1', twilioCode: 21211 },
    });
    eq('non-OK: HTTP failure response preserved', [r.status, r.body], [500, { error: "Twilio API error (21211): Invalid 'To' Phone Number" }]);
    eq('non-OK: no success tracking', r.successCalls.length, 0);
    eq('non-OK: no sms_conversations row', r.conversationInserts.length, 0);
    // Known, separate issue (not part of this fix): the admin email fallback is still sent from both layers.
    eq('non-OK: admin fallback email behavior unchanged (known separate issue)', r.fallbackCalls.length, 2);
  }
  {
    const r = await run({ body: { ...EXPLICIT, skipFallback: true }, twilio: 'non-ok' });
    eq('non-OK + skipFallback: one failure RPC and no fallback email', [r.failureCalls.length, r.fallbackCalls.length], [1, 0]);
  }

  // ---- Twilio non-OK via template (outer catch cannot record: no explicit to/message) ----
  {
    const r = await run({ body: TEMPLATE, twilio: 'non-ok', ...templateData });
    eq('template non-OK: exactly one failure RPC', r.failureCalls.length, 1);
    eq('template non-OK: payload uses the order phone and rendered message', [r.failureCalls[0].args.p_recipient, r.failureCalls[0].args.p_message_preview, r.failureCalls[0].args.p_context], ['+15555550199', 'Thanks Ann', { orderId: 'ord-1', twilioCode: 21211 }]);
    eq('template non-OK: response', r.status, 500);
  }

  // ---- Twilio fetch throws ----
  {
    const r = await run({ body: EXPLICIT, twilio: 'throws' });
    eq('fetch throws: Twilio attempted once', r.twilioCalls.length, 1);
    eq('fetch throws: exactly one failure RPC', r.failureCalls.length, 1);
    eq('fetch throws: failure RPC payload (raw recipient from the request)', r.failureCalls[0].args, {
      p_type: 'sms', p_recipient: '5555550123', p_subject: null, p_message_preview: 'Hello there', p_error: 'network down', p_context: { orderId: 'ord-1' },
    });
    eq('fetch throws: HTTP response preserved', [r.status, r.body], [500, { error: 'network down' }]);
  }
  {
    const r = await run({ body: TEMPLATE, twilio: 'throws', ...templateData });
    eq('fetch throws via template: no failure RPC (outer catch has no to/message), response preserved', [r.failureCalls.length, r.status, r.body], [0, 500, { error: 'network down' }]);
  }

  // ---- Twilio non-OK with an unreadable error body ----
  {
    const r = await run({ body: EXPLICIT, twilio: 'non-ok-bad-json' });
    eq('non-OK with unreadable body: exactly one failure RPC (outer catch)', r.failureCalls.length, 1);
    eq('non-OK with unreadable body: response', [r.status, r.body], [500, { error: 'Unexpected token <' }]);
  }

  // ---- Failure recording itself fails ----
  {
    const r = await run({ body: EXPLICIT, twilio: 'non-ok', failureRpc: 'returns-error' });
    eq('RPC returns an error: still exactly one attempt (no retry in the outer layer)', r.failureCalls.length, 1);
    eq('RPC returns an error: the Twilio failure remains the primary response', [r.status, r.body], [500, { error: "Twilio API error (21211): Invalid 'To' Phone Number" }]);
  }

  // ---- Pre-send failures (behavior pinned) ----
  {
    const r = await run({ body: EXPLICIT, settings: [] });
    eq('missing Twilio config: one failure RPC, 400, no Twilio call', [r.failureCalls.length, r.status, r.twilioCalls.length], [1, 400, 0]);
    eq('missing Twilio config: payload', [r.failureCalls[0].args.p_error, r.failureCalls[0].args.p_context], ['Twilio not configured. Please add credentials in Admin > Settings.', { orderId: 'ord-1' }]);
    const r2 = await run({ body: EXPLICIT, settings: [{ key: 'twilio_account_sid', value: 'AC' }, { key: 'twilio_auth_token', value: '  ' }, { key: 'twilio_from_number', value: '+1555' }] });
    eq('incomplete Twilio config: one failure RPC, 400', [r2.failureCalls.length, r2.status, r2.body.error], [1, 400, 'Incomplete Twilio configuration. Please check Admin > Settings.']);
    const r3 = await run({ body: { orderId: 'ord-1' } });
    eq('missing to/message: 400 and no failure RPC', [r3.status, r3.failureCalls.length], [400, 0]);
    const r4 = await run({ body: TEMPLATE, template: null, order: null });
    eq('template not found: 500 and no failure RPC (no explicit recipient)', [r4.status, r4.failureCalls.length, r4.body.error], [500, 0, "Template 'pickup_thanks_sms' not found"]);
    const r5 = await run({ body: null as any, rawBody: 'not json' });
    eq('malformed JSON: 500 and no failure RPC', [r5.status, r5.failureCalls.length], [500, 0]);
    const r6 = await run({ body: { ...TEMPLATE, templateKey: 'booking_received_admin' }, ...templateData, adminPhone: null });
    eq('admin phone not configured: 500 and no failure RPC', [r6.status, r6.failureCalls.length], [500, 0]);
  }

  console.log(`send-sms-notification failure recording tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} send-sms-notification test(s) failed`);
})();
