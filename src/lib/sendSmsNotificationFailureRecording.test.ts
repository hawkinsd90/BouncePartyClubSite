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

import { authorizeRelayCaller, checkSmsPayload, relayDenied } from '../../supabase/functions/_shared/auth';

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
  new Function('Deno', 'createClient', 'formatOrderId', 'authorizeRelayCaller', 'checkSmsPayload', 'relayDenied', 'fetch', js)(Deno, createClientFake, (id: string) => `#${String(id).slice(0, 8)}`, authorizeRelayCaller, checkSmsPayload, relayDenied, fetchFake);
  if (!handler) throw new Error('handler not registered');
  return handler as (req: Request) => Promise<Response>;
}

interface Scenario {
  body: any;
  rawBody?: string;
  // Twilio behavior
  twilio?: 'ok' | 'non-ok' | 'throws' | 'non-ok-bad-json' | 'ok-bad-json';
  // record_notification_success behavior
  successRpc?: 'ok' | 'returns-error' | 'throws';
  // sms_conversations insert behavior
  conversationInsert?: 'ok' | 'returns-error' | 'throws';
  // record_notification_failure behavior
  failureRpc?: 'ok' | 'returns-error' | 'throws';
  settings?: Array<{ key: string; value: string }>;
  template?: any;
  order?: any;
  adminEmail?: string | null;
  adminPhone?: string | null;
  // The admin fallback email request (a fetch to send-email) rejects.
  fallbackFetch?: 'throws';
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
        insert: (payload: any) => {
          if (table === 'sms_conversations') {
            conversationInserts.push(payload);
            if (sc.conversationInsert === 'throws') return Promise.reject(new Error('db unavailable'));
            if (sc.conversationInsert === 'returns-error') return Promise.resolve({ error: { message: 'insert rejected' } });
          }
          return Promise.resolve({ error: null });
        },
        then: (res: any, rej: any) => Promise.resolve({ data: tableData(table, 'list'), error: null }).then(res, rej),
      };
      return b;
    },
    rpc(name: string, args: any) {
      rpcCalls.push({ name, args });
      if (name === 'record_notification_success') {
        if (sc.successRpc === 'throws') return Promise.reject(new Error('success rpc unreachable'));
        if (sc.successRpc === 'returns-error') return Promise.resolve({ data: null, error: { message: 'success rpc rejected' } });
      }
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
      if (sc.twilio === 'ok-bad-json') return { ok: true, status: 201, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } };
      return { ok: true, status: 201, json: async () => ({ sid: 'SM123', status: 'queued' }) };
    }
    fallbackCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (sc.fallbackFetch === 'throws') throw new TypeError('fallback endpoint down');
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const handler = loadHandler({ SUPABASE_URL: 'https://x.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' }, () => supabaseFake, fetchFake);
  const realErr = console.error; const realWarn = console.warn; const realLog = console.log;
  const consoleErrors: any[][] = [];
  console.error = (...a: any[]) => { consoleErrors.push(a); }; console.warn = () => {}; console.log = () => {};
  let status = 0; let body: any = null; let threw: any = null;
  try {
    // The relay only serves the backend: these scenarios are failure recording for an authorized (service-role) caller.
    const res = await handler(new Request('https://x.test/fn', { method: 'POST', headers: { Authorization: 'Bearer svc' }, body: sc.rawBody ?? JSON.stringify(sc.body) }));
    status = res.status; body = await res.json();
  } catch (e) { threw = e; } finally { console.error = realErr; console.warn = realWarn; console.log = realLog; }
  const failureCalls = rpcCalls.filter(c => c.name === 'record_notification_failure');
  const successCalls = rpcCalls.filter(c => c.name === 'record_notification_success');
  return { status, body, threw, rpcCalls, failureCalls, successCalls, twilioCalls, fallbackCalls, conversationInserts, consoleErrors };
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
    eq('success: success RPC argument', r.successCalls[0]?.args, { p_type: 'sms' });
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
    // One failed SMS attempt sends exactly one admin fallback email (previously the inner provider-error branch
    // and the outer catch each sent one).
    eq('non-OK: EXACTLY ONE admin fallback email for one failed SMS attempt', r.fallbackCalls.length, 1);
    eq('non-OK: failure RPC count stays one alongside the single fallback', [r.failureCalls.length, r.fallbackCalls.length], [1, 1]);
    eq('non-OK: the fallback email request', [r.fallbackCalls[0].url, r.fallbackCalls[0].body.to, r.fallbackCalls[0].body.subject, r.fallbackCalls[0].body.skipFallback], ['https://x.supabase.test/functions/v1/send-email', 'admin@example.test', '[SMS SYSTEM FAILURE] Action Required', true]);
    eq('non-OK: the fallback names the normalized recipient and the Twilio error', [r.fallbackCalls[0].body.html.includes('+15555550123'), r.fallbackCalls[0].body.html.includes("Twilio API error (21211): Invalid 'To' Phone Number")], [true, true]);
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
    eq('template non-OK: exactly one admin fallback (the inner branch; the outer catch has no explicit recipient)', r.fallbackCalls.length, 1);
    eq('template non-OK: fallback uses the order phone and rendered message', [r.fallbackCalls[0].body.html.includes('+15555550199'), r.fallbackCalls[0].body.html.includes('Thanks Ann')], [true, true]);
    const rt = await run({ body: { ...TEMPLATE, skipFallback: true }, twilio: 'non-ok', ...templateData });
    eq('template non-OK + skipFallback: one failure RPC, no fallback', [rt.failureCalls.length, rt.fallbackCalls.length], [1, 0]);
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
    eq('fetch throws: exactly one admin fallback (from the outer catch)', r.fallbackCalls.length, 1);
    eq('fetch throws: the fallback uses the raw request recipient and the network error', [r.fallbackCalls[0].body.html.includes('5555550123'), r.fallbackCalls[0].body.html.includes('network down')], [true, true]);
    const rs = await run({ body: { ...EXPLICIT, skipFallback: true }, twilio: 'throws' });
    eq('fetch throws + skipFallback: one failure RPC, no fallback', [rs.failureCalls.length, rs.fallbackCalls.length], [1, 0]);
  }
  {
    const r = await run({ body: TEMPLATE, twilio: 'throws', ...templateData });
    // A template send that reached the Twilio attempt gets the same observability as an explicit send, using the
    // recipient and message the function actually resolved and sent to Twilio.
    eq('fetch throws via template: Twilio attempted once', r.twilioCalls.length, 1);
    eq('fetch throws via template: EXACTLY ONE failure RPC', r.failureCalls.length, 1);
    eq('fetch throws via template: failure RPC payload uses the resolved recipient and rendered message', r.failureCalls[0]?.args, {
      p_type: 'sms', p_recipient: '+15555550199', p_subject: null, p_message_preview: 'Thanks Ann', p_error: 'network down', p_context: { orderId: 'ord-1' },
    });
    eq('fetch throws via template: EXACTLY ONE admin fallback', r.fallbackCalls.length, 1);
    eq('fetch throws via template: the fallback names the resolved recipient, message and error', [r.fallbackCalls[0]?.body.html.includes('+15555550199'), r.fallbackCalls[0]?.body.html.includes('Thanks Ann'), r.fallbackCalls[0]?.body.html.includes('network down')], [true, true, true]);
    eq('fetch throws via template: response preserved', [r.status, r.body], [500, { error: 'network down' }]);
    const rs2 = await run({ body: { ...TEMPLATE, skipFallback: true }, twilio: 'throws', ...templateData });
    eq('fetch throws via template + skipFallback: one failure RPC, no fallback, same response', [rs2.failureCalls.length, rs2.fallbackCalls.length, rs2.status, rs2.body], [1, 0, 500, { error: 'network down' }]);
    const rf = await run({ body: TEMPLATE, twilio: 'throws', failureRpc: 'returns-error', ...templateData });
    eq('fetch throws via template + failure RPC error: still one attempt, one fallback, primary error preserved', [rf.failureCalls.length, rf.fallbackCalls.length, rf.status, rf.body], [1, 1, 500, { error: 'network down' }]);
    const rg = await run({ body: TEMPLATE, twilio: 'throws', fallbackFetch: 'throws', ...templateData });
    eq('fetch throws via template + fallback request rejects: one attempt each, primary error preserved', [rg.failureCalls.length, rg.fallbackCalls.length, rg.status, rg.body], [1, 1, 500, { error: 'network down' }]);
    // When a request supplies BOTH a template and explicit to/message, the raw values keep precedence in the outer catch (existing behavior).
    const rb = await run({ body: { ...TEMPLATE, to: '5555550123', message: 'Raw message' }, twilio: 'throws', ...templateData });
    eq('template + explicit to/message: raw values keep precedence', [rb.failureCalls.length, rb.failureCalls[0]?.args.p_recipient, rb.failureCalls[0]?.args.p_message_preview], [1, '5555550123', 'Raw message']);
    // Explicit requests keep using the raw request recipient (unchanged), even when the same attempt context exists.
    const re = await run({ body: EXPLICIT, twilio: 'throws' });
    eq('fetch throws explicit: still the raw recipient and one failure RPC and one fallback', [re.failureCalls[0].args.p_recipient, re.failureCalls.length, re.fallbackCalls.length], ['5555550123', 1, 1]);
  }

  // ---- Twilio non-OK with an unreadable error body ----
  {
    const r = await run({ body: EXPLICIT, twilio: 'non-ok-bad-json' });
    eq('non-OK with unreadable body: exactly one failure RPC (outer catch)', r.failureCalls.length, 1);
    eq('non-OK with unreadable body: response', [r.status, r.body], [500, { error: 'Unexpected token <' }]);
    eq('non-OK with unreadable body: exactly one admin fallback (outer catch; the inner branch never ran)', r.fallbackCalls.length, 1);
    // The same body problem on a template send must be observable too (no Twilio error code can be invented).
    const rt = await run({ body: TEMPLATE, twilio: 'non-ok-bad-json', ...templateData });
    eq('template non-OK with unreadable body: Twilio attempted once', rt.twilioCalls.length, 1);
    eq('template non-OK with unreadable body: EXACTLY ONE failure RPC with the resolved recipient and message', rt.failureCalls.map((c: any) => c.args), [{
      p_type: 'sms', p_recipient: '+15555550199', p_subject: null, p_message_preview: 'Thanks Ann', p_error: 'Unexpected token <', p_context: { orderId: 'ord-1' },
    }]);
    eq('template non-OK with unreadable body: no invented twilioCode in the context', 'twilioCode' in (rt.failureCalls[0]?.args.p_context ?? {}), false);
    eq('template non-OK with unreadable body: exactly one fallback and the existing response', [rt.fallbackCalls.length, rt.status, rt.body], [1, 500, { error: 'Unexpected token <' }]);
    const rts = await run({ body: { ...TEMPLATE, skipFallback: true }, twilio: 'non-ok-bad-json', ...templateData });
    eq('template non-OK with unreadable body + skipFallback: one failure RPC, no fallback', [rts.failureCalls.length, rts.fallbackCalls.length], [1, 0]);
  }

  // ---- Failure recording itself fails ----
  {
    const r = await run({ body: EXPLICIT, twilio: 'non-ok', failureRpc: 'returns-error' });
    eq('RPC returns an error: still exactly one attempt (no retry in the outer layer)', r.failureCalls.length, 1);
    eq('RPC returns an error: the Twilio failure remains the primary response', [r.status, r.body], [500, { error: "Twilio API error (21211): Invalid 'To' Phone Number" }]);
    eq('RPC returns an error: still exactly one fallback', r.fallbackCalls.length, 1);
  }

  // ---- The fallback email request itself fails: best effort, never retried, never changes the response ----
  {
    const r = await run({ body: EXPLICIT, twilio: 'non-ok', fallbackFetch: 'throws' });
    eq('fallback request rejects: one attempt, no retry from the outer catch', r.fallbackCalls.length, 1);
    eq('fallback request rejects: Twilio failure remains the primary response', [r.status, r.body], [500, { error: "Twilio API error (21211): Invalid 'To' Phone Number" }]);
    eq('fallback request rejects: still one failure RPC', r.failureCalls.length, 1);
    const r2 = await run({ body: EXPLICIT, twilio: 'throws', fallbackFetch: 'throws' });
    eq('network error + fallback rejects: one attempt and the network error response', [r2.fallbackCalls.length, r2.status, r2.body], [1, 500, { error: 'network down' }]);
  }

  // ---- Pre-send failures (behavior pinned) ----
  {
    const r = await run({ body: EXPLICIT, settings: [] });
    eq('missing Twilio config: one failure RPC, 400, no Twilio call', [r.failureCalls.length, r.status, r.twilioCalls.length], [1, 400, 0]);
    eq('missing Twilio config: exactly one admin fallback', r.fallbackCalls.length, 1);
    eq('missing Twilio config: payload', [r.failureCalls[0].args.p_error, r.failureCalls[0].args.p_context], ['Twilio not configured. Please add credentials in Admin > Settings.', { orderId: 'ord-1' }]);
    const r2 = await run({ body: EXPLICIT, settings: [{ key: 'twilio_account_sid', value: 'AC' }, { key: 'twilio_auth_token', value: '  ' }, { key: 'twilio_from_number', value: '+1555' }] });
    eq('incomplete Twilio config: one failure RPC, 400', [r2.failureCalls.length, r2.status, r2.body.error], [1, 400, 'Incomplete Twilio configuration. Please check Admin > Settings.']);
    eq('incomplete Twilio config: exactly one admin fallback', r2.fallbackCalls.length, 1);
    const r2s = await run({ body: { ...EXPLICIT, skipFallback: true }, settings: [] });
    eq('missing config + skipFallback: one failure RPC, 400, no fallback', [r2s.failureCalls.length, r2s.status, r2s.fallbackCalls.length], [1, 400, 0]);
    const r2t = await run({ body: { ...EXPLICIT, skipFallback: true }, settings: [{ key: 'twilio_account_sid', value: 'AC' }, { key: 'twilio_auth_token', value: '  ' }, { key: 'twilio_from_number', value: '+1555' }] });
    eq('incomplete config + skipFallback: no fallback', r2t.fallbackCalls.length, 0);
    const r3 = await run({ body: { orderId: 'ord-1' } });
    eq('missing to/message: 400 and no failure RPC', [r3.status, r3.failureCalls.length], [400, 0]);
    const r4 = await run({ body: TEMPLATE, template: null, order: null });
    eq('template not found: 500 and no failure RPC (no explicit recipient)', [r4.status, r4.failureCalls.length, r4.body.error], [500, 0, "Template 'pickup_thanks_sms' not found"]);
    const r5 = await run({ body: null as any, rawBody: 'not json' });
    eq('malformed JSON: 500 and no failure RPC', [r5.status, r5.failureCalls.length], [500, 0]);
    const r6 = await run({ body: { ...TEMPLATE, templateKey: 'booking_received_admin' }, ...templateData, adminPhone: null });
    eq('admin phone not configured: 500 and no failure RPC', [r6.status, r6.failureCalls.length], [500, 0]);
    // Template PREPARATION failures happen before a send attempt exists: no provider-failure record, no fallback, no Twilio call.
    const prep: Array<[string, any]> = [
      ['template not found', { body: TEMPLATE, template: null, order: null }],
      ['order not found', { body: TEMPLATE, template: { message_template: 'Hi' }, order: null }],
      ['admin phone not configured', { body: { ...TEMPLATE, templateKey: 'booking_received_admin' }, ...templateData, adminPhone: null }],
      ['customer phone missing (no final recipient)', { body: TEMPLATE, template: templateData.template, order: { ...templateData.order, customers: { first_name: 'Ann', last_name: 'Lee' } } }],
    ];
    for (const [name, sc] of prep) {
      const rp = await run({ ...sc, twilio: 'throws' });
      eq('template preparation failure (' + name + '): no Twilio call, no failure RPC, no fallback', [rp.twilioCalls.length, rp.failureCalls.length, rp.fallbackCalls.length], [0, 0, 0]);
      const rps = await run({ ...sc, body: { ...sc.body, skipFallback: true }, twilio: 'throws' });
      eq('template preparation failure (' + name + ') + skipFallback: still nothing recorded', [rps.twilioCalls.length, rps.failureCalls.length, rps.fallbackCalls.length], [0, 0, 0]);
    }
    const rm = await run({ body: TEMPLATE, template: templateData.template, order: { ...templateData.order, customers: { first_name: 'Ann', last_name: 'Lee' } }, twilio: 'throws' });
    eq('template missing final recipient: 400 missing-field response, as before', [rm.status, rm.body], [400, { error: "Missing 'to' or 'message' parameter" }]);
    // Template accepted by Twilio stays a plain success with no failure observability.
    const ra = await run({ body: TEMPLATE, twilio: 'ok', ...templateData });
    eq('template accepted: success, zero failure RPCs, zero fallbacks', [ra.status, ra.failureCalls.length, ra.fallbackCalls.length], [200, 0, 0]);
    // Missing and incomplete config on a template send are unchanged: one failure RPC (config branch), one fallback, 400.
    const rc = await run({ body: TEMPLATE, settings: [], ...templateData });
    eq('template + missing config: one failure RPC, one fallback, 400 (config branch, not the transport catch)', [rc.failureCalls.length, rc.fallbackCalls.length, rc.status], [1, 1, 400]);
  }

  // ---- Post-acceptance bookkeeping: once Twilio returns 2xx the SMS is accepted ----
  // Twilio non-2xx = SMS failure; Twilio 2xx = SMS accepted; anything failing afterward is local bookkeeping
  // and must never be reported as an SMS failure.
  const ACCEPTED_BODY = { success: true, messageSid: 'SM123', status: 'queued' };
  const NULL_SID_BODY = { success: true, messageSid: null, status: null };
  const accepted = (r: any, label: string, expectBody: any) => {
    eq(label + ': HTTP 200 success', [r.status, r.body], [200, expectBody]);
    eq(label + ': Twilio called exactly once (no resend)', r.twilioCalls.length, 1);
    eq(label + ': zero failure RPCs', r.failureCalls.length, 0);
    eq(label + ': zero admin fallback emails', r.fallbackCalls.length, 0);
  };
  const loggedWith = (r: any, text: string) => r.consoleErrors.some((e: any[]) => String(e[0]).includes(text));
  const bookkeepingLogs = (r: any) => r.consoleErrors.filter((e: any[]) => String(e[0]).includes('[send-sms-notification]')).length;
  for (const variant of ['explicit', 'template'] as const) {
    const base: any = variant === 'explicit' ? { body: EXPLICIT } : { body: TEMPLATE, ...templateData };
    const tag = 'accepted (' + variant + ')';
    // A. normal accepted SMS
    {
      const r = await run({ ...base, twilio: 'ok' });
      accepted(r, tag + ' normal', ACCEPTED_BODY);
      eq(tag + ' normal: success RPC once and one conversation row', [r.successCalls.length, r.conversationInserts.length], [1, 1]);
      eq(tag + ' normal: success RPC argument', r.successCalls[0]?.args, { p_type: 'sms' });
      eq(tag + ' normal: conversation row keeps the real SID and status', [r.conversationInserts[0]?.twilio_message_sid, r.conversationInserts[0]?.status], ['SM123', 'queued']);
      eq(tag + ' normal: nothing logged as an error', r.consoleErrors.length, 0);
    }
    // B. malformed Twilio success body
    {
      const r = await run({ ...base, twilio: 'ok-bad-json' });
      accepted(r, tag + ' malformed body', NULL_SID_BODY);
      eq(tag + ' malformed body: success RPC still attempted once', r.successCalls.length, 1);
      eq(tag + ' malformed body: conversation insert still attempted with null SID and status', [r.conversationInserts.length, r.conversationInserts[0]?.twilio_message_sid, r.conversationInserts[0]?.status], [1, null, null]);
      eq(tag + ' malformed body: same payload otherwise', [r.conversationInserts[0]?.direction, r.conversationInserts[0]?.from_phone, r.conversationInserts[0]?.order_id], ['outbound', '+15550001111', 'ord-1']);
      eq(tag + ' malformed body: parsing problem console-logged', bookkeepingLogs(r), 1);
    }
    // C. success RPC returns {error}
    {
      const r = await run({ ...base, twilio: 'ok', successRpc: 'returns-error' });
      accepted(r, tag + ' success RPC returns error', ACCEPTED_BODY);
      eq(tag + ' success RPC returns error: conversation still written', r.conversationInserts.length, 1);
      eq(tag + ' success RPC returns error: logged as a returned error', [bookkeepingLogs(r), loggedWith(r, 'record_notification_success failed after')], [1, true]);
    }
    // D. success RPC rejects
    {
      const r = await run({ ...base, twilio: 'ok', successRpc: 'throws' });
      accepted(r, tag + ' success RPC rejects', ACCEPTED_BODY);
      eq(tag + ' success RPC rejects: conversation still written', r.conversationInserts.length, 1);
      eq(tag + ' success RPC rejects: logged as a thrown error', [bookkeepingLogs(r), loggedWith(r, 'record_notification_success threw after')], [1, true]);
    }
    // E. conversation insert returns {error}
    {
      const r = await run({ ...base, twilio: 'ok', conversationInsert: 'returns-error' });
      accepted(r, tag + ' conversation returns error', ACCEPTED_BODY);
      eq(tag + ' conversation returns error: success RPC still ran', r.successCalls.length, 1);
      eq(tag + ' conversation returns error: logged as a returned error', [bookkeepingLogs(r), loggedWith(r, 'sms_conversations insert failed after')], [1, true]);
    }
    // F. conversation insert rejects
    {
      const r = await run({ ...base, twilio: 'ok', conversationInsert: 'throws' });
      accepted(r, tag + ' conversation rejects', ACCEPTED_BODY);
      eq(tag + ' conversation rejects: success RPC still ran', r.successCalls.length, 1);
      eq(tag + ' conversation rejects: logged as a thrown error', [bookkeepingLogs(r), loggedWith(r, 'sms_conversations insert threw after')], [1, true]);
    }
    // G. several bookkeeping failures together
    {
      const r = await run({ ...base, twilio: 'ok', successRpc: 'throws', conversationInsert: 'throws' });
      accepted(r, tag + ' both bookkeeping steps reject', ACCEPTED_BODY);
      eq(tag + ' both bookkeeping steps reject: both attempted', [r.successCalls.length, r.conversationInserts.length], [1, 1]);
      eq(tag + ' both bookkeeping steps reject: both logged', bookkeepingLogs(r), 2);
      const r2 = await run({ ...base, twilio: 'ok-bad-json', successRpc: 'throws', conversationInsert: 'returns-error' });
      accepted(r2, tag + ' bad body + success RPC rejects + conversation error', NULL_SID_BODY);
      eq(tag + ' everything degraded: all steps still attempted and logged', [r2.successCalls.length, r2.conversationInserts.length, bookkeepingLogs(r2)], [1, 1, 3]);
      const r3 = await run({ ...base, body: { ...base.body, skipFallback: true }, twilio: 'ok', successRpc: 'throws', conversationInsert: 'throws' });
      accepted(r3, tag + ' with skipFallback', ACCEPTED_BODY);
    }
  }

  console.log(`send-sms-notification failure recording tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} send-sms-notification test(s) failed`);
})();
