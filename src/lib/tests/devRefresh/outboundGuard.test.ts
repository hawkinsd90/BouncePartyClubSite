/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
// Environment guard for outbound notifications (supabase/functions/_shared/notifications/outbound-guard.ts) and its use in the two
// provider relays (send-email -> Resend, send-sms-notification -> Twilio).
//
// Layers, labelled so nobody mistakes one for another:
//   PURE      the decision rules, with no environment access at all
//   HANDLER   the CURRENT relay source is loaded (imports stripped, TypeScript transpiled) and run with the REAL authorization
//             helpers against recording fakes. Every provider call is a fake: LIVE EMAILS SENT = 0 and LIVE SMS SENT = 0.
//   STATIC    scans the source for every provider call site and every notification pathway outside the two relays
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/devRefresh/outboundGuard.test.ts

declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');

import * as guard from '../../../../supabase/functions/_shared/notifications/outbound-guard';
import * as stripeMode from '../../../../supabase/functions/_shared/payments/stripe-key-mode';
import { authorizeRelayCaller, checkEmailPayload, checkSmsPayload, relayDenied } from '../../../../supabase/functions/_shared/auth';

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

const PROD = 'https://qaagfafagdpgzcijnfbw.supabase.co';
const DEV = 'https://srxunxiytojjsuhcmzjg.supabase.co';
const APPROVED_EMAILS = ['hawkinsd90@gmail.com', 'deveehawk@gmail.com', 'neverforgetthevibes@gmail.com'];

// ---------------------------------------------------------------------------------------------------------------------
// PURE: identity of the environment
// ---------------------------------------------------------------------------------------------------------------------
eq('Production project ref is the real one', guard.PRODUCTION_PROJECT_REF, 'qaagfafagdpgzcijnfbw');
eq('Development project ref is the real one', guard.DEVELOPMENT_PROJECT_REF, 'srxunxiytojjsuhcmzjg');
eq('SMS test destination', guard.DEV_SMS_RECIPIENT, '+17343588854');
eq('email test destinations', [...guard.DEV_EMAIL_RECIPIENTS], APPROVED_EMAILS);
eq('the shipped test destinations are valid', guard.testDestinationProblems(), []);
eq('projectRefFromUrl production', guard.projectRefFromUrl(PROD), 'qaagfafagdpgzcijnfbw');
eq('projectRefFromUrl trailing slash and path', guard.projectRefFromUrl(`${DEV}/functions/v1/x`), 'srxunxiytojjsuhcmzjg');
for (const bad of [undefined, null, '', 'not a url', 'http://qaagfafagdpgzcijnfbw.supabase.co', 'https://qaagfafagdpgzcijnfbw.supabase.co:8443', 'https://user:pw@qaagfafagdpgzcijnfbw.supabase.co', 'https://qaagfafagdpgzcijnfbw.supabase.co.evil.example', 'https://evil-qaagfafagdpgzcijnfbw.supabase.co', 'https://sub.qaagfafagdpgzcijnfbw.supabase.co', 'https://127.0.0.1:54321', 'http://localhost:54321', 'https://qaagfafagdpgzcijnfbwx.supabase.co', 'https://QAAGFAFAGDPGZCIJNFBW.supabase.co.attacker.test', 42, {}]) {
  eq(`projectRefFromUrl rejects ${JSON.stringify(bad)}`, guard.projectRefFromUrl(bad as any), null);
}

// ---------------------------------------------------------------------------------------------------------------------
// PURE: Production is never redirected
// ---------------------------------------------------------------------------------------------------------------------
for (const channel of ['sms', 'email'] as const) {
  const d = guard.decideOutbound(channel, PROD, channel === 'sms' ? '+15555550123' : 'customer@example.test');
  ok(`production ${channel}: sends`, d.action === 'send');
  ok(`production ${channel}: routing is live`, d.action === 'send' && d.routing === 'live');
  ok(`production ${channel}: recipient is exactly the original`, d.action === 'send' && d.recipient === d.originalRecipient && d.recipient === (channel === 'sms' ? '+15555550123' : 'customer@example.test'));
  ok(`production ${channel}: subject/body are never altered`, guard.redirectedSmsBody(d, 'hello') === 'hello' && guard.redirectedEmailSubject(d, 'subj') === 'subj' && guard.redirectedEmailBanner(d).html === '' && guard.withEmailBanner(d, '<body>x</body>', 'x').html === '<body>x</body>');
}
// An environment variable can not turn redirection on in Production: the decision function reads no environment.
const prodSource = read('supabase/functions/_shared/notifications/outbound-guard.ts');
ok('guard module reads no environment, network or Deno API', !/\bDeno\b|process\.env|import\.meta\.env|\bfetch\(|\bwindow\b|localStorage/.test(prodSource.replace(/\/\/[^\n]*/g, '')));
ok('guard module imports nothing', !/^import\s/m.test(prodSource));
ok('decideOutbound takes only (channel, url, recipient): no mode or flag parameter', /export function decideOutbound\(channel: OutboundChannel, supabaseUrl: unknown, originalRecipient: unknown\)/.test(prodSource));
for (let i = 0; i < 200; i++) {
  const rnd = `person${i}@example.test`;
  const d = guard.decideOutbound('email', PROD, rnd);
  if (!(d.action === 'send' && d.routing === 'live' && d.recipient === rnd)) {
    ok(`production never redirects (${rnd})`, false);
    break;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// PURE: Development only ever reaches the approved destinations
// ---------------------------------------------------------------------------------------------------------------------
const seen = new Set<string>();
let leaked = false;
for (let i = 0; i < 300; i++) {
  const original = `real.customer${i}@example.test`;
  const d = guard.decideOutbound('email', DEV, original);
  if (d.action !== 'send' || d.routing !== 'redirect' || !APPROVED_EMAILS.includes(d.recipient) || d.recipient === original) leaked = true;
  if (d.action === 'send') seen.add(d.recipient);
  const again = guard.decideOutbound('email', DEV, original.toUpperCase());
  if (again.action !== 'send' || again.recipient !== (d as any).recipient) leaked = true; // deterministic and case-insensitive
}
ok('development email: every message goes to an approved inbox and never to the original', !leaked);
eq('development email: all three inboxes are used (even distribution)', [...seen].sort(), [...APPROVED_EMAILS].sort());
for (const phone of ['+15555550123', '5555550123', '(555) 555-0123', '+13135550100', '']) {
  const d = guard.decideOutbound('sms', DEV, phone);
  ok(`development sms (${JSON.stringify(phone)}): redirected to the approved phone only`, d.action === 'send' && d.routing === 'redirect' && d.recipient === '+17343588854');
}
const dd = guard.decideOutbound('sms', DEV, '+15555550123');
eq('development sms body prefix keeps the original recipient visible', guard.redirectedSmsBody(dd, 'Hi'), '[DEV -> +15555550123] Hi');
eq('development subject prefix', guard.redirectedEmailSubject(guard.decideOutbound('email', DEV, 'a@example.test'), 'Receipt'), '[DEV -> a@example.test] Receipt');
const bannered = guard.withEmailBanner(guard.decideOutbound('email', DEV, 'a@example.test'), '<html><body style="x"><p>Hi</p></body></html>', 'Hi');
ok('email banner is inserted after <body> and names the original recipient', /<body style="x"><div[^>]*>DEVELOPMENT TEST MESSAGE[\s\S]*a@example\.test[\s\S]*<\/div><p>Hi<\/p>/.test(bannered.html) && /^DEVELOPMENT TEST MESSAGE/.test(bannered.text));
ok('email banner escapes hostile recipient text', !/<script/.test(guard.redirectedEmailBanner(guard.decideOutbound('email', DEV, '<script>alert(1)</script>@x.test')).html));
ok('a recipient with line breaks cannot forge extra lines in the prefix', !/\n/.test(guard.redirectedSmsBody(guard.decideOutbound('sms', DEV, '+1555\nFAKE'), 'x')));

// ---------------------------------------------------------------------------------------------------------------------
// PURE: everything else fails closed
// ---------------------------------------------------------------------------------------------------------------------
for (const url of [undefined, null, '', 'garbage', 'http://127.0.0.1:54321', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', 'https://qaagfafagdpgzcijnfbw.supabase.co.evil.example', 'http://qaagfafagdpgzcijnfbw.supabase.co']) {
  for (const channel of ['sms', 'email'] as const) {
    const d = guard.decideOutbound(channel, url as any, 'x@example.test');
    ok(`unknown environment ${JSON.stringify(url)} (${channel}): blocked, nothing sent`, d.action === 'block' && !('recipient' in d));
  }
}
ok('unknown channel is blocked', guard.decideOutbound('fax' as any, PROD, 'x').action === 'block');
ok('invalid test destinations are reported', guard.testDestinationProblems('12345', ['not-an-email']).length === 2 && guard.testDestinationProblems('+17343588854', []).length === 1 && guard.testDestinationProblems('+17343588854', ['a@x.test', 'A@x.test']).length === 1);

// ---------------------------------------------------------------------------------------------------------------------
// PURE: Stripe key mode (Development keeps Stripe TEST mode; only a live key outside Production is a problem)
// ---------------------------------------------------------------------------------------------------------------------
eq('mode of sk_test', stripeMode.stripeKeyMode('sk_test_abc'), 'test');
eq('mode of rk_live', stripeMode.stripeKeyMode('rk_live_abc'), 'live');
eq('mode of pk_test', stripeMode.stripeKeyMode('pk_test_abc'), 'test');
eq('mode of junk', stripeMode.stripeKeyMode('whsec_abc'), 'unknown');
eq('development + test key: allowed (test charges, refunds and saved test cards keep working)', stripeMode.stripeKeyProblem(DEV, 'sk_test_abc'), null);
ok('development + live key: refused', /LIVE Stripe key/.test(stripeMode.stripeKeyProblem(DEV, 'sk_live_abc') as string));
ok('unknown environment + live key: refused', !!stripeMode.stripeKeyProblem('http://localhost', 'sk_live_abc'));
eq('production + live key: allowed', stripeMode.stripeKeyProblem(PROD, 'sk_live_abc'), null);
ok('the problem text never contains the key', !/sk_live_abc/.test(stripeMode.stripeKeyProblem(DEV, 'sk_live_abc') as string));

// ---------------------------------------------------------------------------------------------------------------------
// HANDLER: the real relays
// ---------------------------------------------------------------------------------------------------------------------
const SERVICE_KEY = 'svc-key-0123456789abcdef';

function loadRelay(file: string, env: Record<string, string>, fakes: any) {
  const src = read(file);
  const js = ts.transpileModule(src.replace(/^import[^;]*;/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  let captured: any = null;
  const quiet = { log() {}, info() {}, debug() {}, warn() {}, error() {} };
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => env[k] }, serve: (fn: any) => { captured = fn; } },
    console: quiet,
    createClient: () => fakes.client,
    fetch: fakes.fetch,
    formatOrderId: (id: string) => `#${String(id).slice(0, 8)}`,
    authorizeRelayCaller,
    checkEmailPayload,
    checkSmsPayload,
    relayDenied,
    ...guard,
  };
  new Function(...Object.keys(scope), js)(...Object.values(scope));
  return captured as (req: Request) => Promise<Response>;
}

function world() {
  const w: any = { resend: [] as any[], twilio: [] as any[], fallback: [] as any[], conversations: [] as any[], rpc: [] as any[] };
  const settings = [
    { key: 'resend_api_key', value: 're_test' }, { key: 'business_name', value: 'Bounce Party Club' }, { key: 'business_email', value: 'biz@example.test' },
    { key: 'twilio_account_sid', value: 'ACtest' }, { key: 'twilio_auth_token', value: 'tok' }, { key: 'twilio_from_number', value: '+15550001111' },
  ];
  w.client = {
    auth: { getUser: async () => ({ data: null, error: new Error('no') }) },
    from(table: string) {
      let key: any;
      const b: any = {
        select: () => b,
        eq: (_k: string, v: any) => { key = v; return b; },
        in: (_k: string, keys: string[]) => { key = keys; return b; },
        maybeSingle: async () => {
          if (table === 'admin_settings') return { data: settings.find((s) => s.key === key) ?? null, error: null };
          if (table === 'email_templates') return { data: { template_name: key, subject: 'Order {order_id}', header_title: 'Hi', content_template: 'Hello {customer_first_name}' }, error: null };
          if (table === 'orders') return { data: { id: 'abcd1234-0000-0000-0000-000000000000', event_date: '2026-06-01', event_address_line1: '1 Test St', customers: { email: 'real.customer@example.test', first_name: 'Real', last_name: 'Customer' } }, error: null };
          return { data: null, error: null };
        },
        insert: async (row: any) => { if (table === 'sms_conversations') w.conversations.push(row); return { error: null }; },
        then: (res: any, rej: any) => Promise.resolve({ data: table === 'admin_settings' ? settings.filter((s) => (key || []).includes(s.key)) : [], error: null }).then(res, rej),
      };
      return b;
    },
    rpc: async (name: string, args: any) => { w.rpc.push({ name, args }); return { data: 'id', error: null }; },
  };
  w.fetch = async (url: string, init: any) => {
    if (String(url).includes('api.resend.com')) { w.resend.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 're_1' }) }; }
    if (String(url).includes('api.twilio.com')) { w.twilio.push(Object.fromEntries(new URLSearchParams(init.body))); return { ok: true, status: 201, json: async () => ({ sid: 'SM1', status: 'queued' }) }; }
    w.fallback.push(url);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return w;
}

const post = (handler: any, body: any) => handler(new Request('https://x.test/fn', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` }, body: JSON.stringify(body) }));

async function handlerTests() {
  for (const [label, url, expectation] of [['production', PROD, 'live'], ['development', DEV, 'redirect'], ['unknown project', 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co', 'block'], ['no URL', '', 'block']] as const) {
    // ---- email ----
    {
      const w = world();
      const h = loadRelay('supabase/functions/send-email/index.ts', { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, w);
      const res = await post(h, { to: 'real.customer@example.test', subject: 'Your booking', html: '<html><body><p>Hello</p></body></html>' });
      if (expectation === 'live') {
        ok(`${label} email: delivered to the real recipient`, res.status === 200 && w.resend.length === 1 && JSON.stringify(w.resend[0].to) === JSON.stringify(['real.customer@example.test']));
        ok(`${label} email: subject and body untouched`, w.resend[0].subject === 'Your booking' && w.resend[0].html === '<html><body><p>Hello</p></body></html>');
      } else if (expectation === 'redirect') {
        ok(`${label} email: delivered to exactly one approved inbox`, res.status === 200 && w.resend.length === 1 && w.resend[0].to.length === 1 && APPROVED_EMAILS.includes(w.resend[0].to[0]));
        ok(`${label} email: the real recipient appears nowhere in the provider payload except the labelled prefix and banner`, !JSON.stringify(w.resend[0].to).includes('real.customer') && w.resend[0].subject.startsWith('[DEV -> real.customer@example.test]') && /DEVELOPMENT TEST MESSAGE/.test(w.resend[0].html) && !('cc' in w.resend[0]) && !('bcc' in w.resend[0]));
      } else {
        ok(`${label} email: blocked, provider never called`, res.status === 503 && w.resend.length === 0);
      }
    }
    // ---- email via template (recipient derived from the order AFTER authorization) ----
    {
      const w = world();
      const h = loadRelay('supabase/functions/send-email/index.ts', { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, w);
      const res = await post(h, { templateName: 'order_thanks', orderId: 'abcd1234-0000-0000-0000-000000000000', to: 'ignored@example.test' });
      if (expectation === 'live') ok(`${label} template email: real customer`, res.status === 200 && JSON.stringify(w.resend[0].to) === JSON.stringify(['real.customer@example.test']));
      else if (expectation === 'redirect') ok(`${label} template email: derived recipient is redirected`, res.status === 200 && w.resend.length === 1 && APPROVED_EMAILS.includes(w.resend[0].to[0]));
      else ok(`${label} template email: blocked`, res.status === 503 && w.resend.length === 0);
    }
    // ---- sms ----
    {
      const w = world();
      const h = loadRelay('supabase/functions/send-sms-notification/index.ts', { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, w);
      const res = await post(h, { to: '+15555550123', message: 'Your delivery is on the way', orderId: 'abcd1234-0000-0000-0000-000000000000' });
      if (expectation === 'live') {
        ok(`${label} sms: sent to the real recipient unchanged`, res.status === 200 && w.twilio.length === 1 && w.twilio[0].To === '+15555550123' && w.twilio[0].Body === 'Your delivery is on the way');
      } else if (expectation === 'redirect') {
        ok(`${label} sms: sent only to the approved phone`, res.status === 200 && w.twilio.length === 1 && w.twilio[0].To === '+17343588854' && w.twilio[0].Body.startsWith('[DEV -> +15555550123] '));
        ok(`${label} sms: the conversation log keeps the ORIGINAL recipient and message`, w.conversations.length === 1 && w.conversations[0].to_phone === '+15555550123' && w.conversations[0].message_body === 'Your delivery is on the way');
      } else {
        ok(`${label} sms: blocked, provider never called`, res.status === 503 && w.twilio.length === 0);
      }
    }
  }

  // The guard does not weaken authorization: an unauthorized caller is refused BEFORE any decision, lookup or provider call.
  {
    const w = world();
    const h = loadRelay('supabase/functions/send-email/index.ts', { SUPABASE_URL: DEV, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, w);
    const res = await h(new Request('https://x.test/fn', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer some-anon-key' }, body: JSON.stringify({ to: 'a@example.test', subject: 's', html: 'h' }) }));
    ok('an unauthorized caller is still refused in development (401/403) and nothing is sent', (res.status === 401 || res.status === 403) && w.resend.length === 0 && w.rpc.length === 0);
    const sms = loadRelay('supabase/functions/send-sms-notification/index.ts', { SUPABASE_URL: DEV, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, w);
    const res2 = await sms(new Request('https://x.test/fn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: '+15555550123', message: 'x' }) }));
    ok('an anonymous sms caller is refused and nothing is sent', (res2.status === 401 || res2.status === 403) && w.twilio.length === 0);
  }
  // Admin-style alerts take the same path: a failing email sends an admin SMS fallback through the SAME relay, which redirects it.
  {
    const w = world();
    w.fetch = async (url: string, init: any) => {
      if (String(url).includes('api.resend.com')) { w.resend.push(JSON.parse(init.body)); return { ok: false, status: 422, json: async () => ({ message: 'boom' }) }; }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const h = loadRelay('supabase/functions/send-email/index.ts', { SUPABASE_URL: DEV, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, w);
    await post(h, { to: 'a@example.test', subject: 's', html: 'h' });
    ok('a provider failure in development only ever attempted an approved inbox', w.resend.length === 1 && APPROVED_EMAILS.includes(w.resend[0].to[0]));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// STATIC: wiring and pathway inventory
// ---------------------------------------------------------------------------------------------------------------------
function listFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) listFiles(p, out);
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(e.name) && !/\.test\./.test(e.name) && !p.includes('/tests/')) out.push(p);
  }
  return out;
}
const sources = [...listFiles('supabase/functions'), ...listFiles('src'), ...listFiles('scripts')];
const resendCallers = sources.filter((f) => /api\.resend\.com/.test(read(f)));
const twilioCallers = sources.filter((f) => /api\.twilio\.com/.test(read(f)));
eq('only send-email talks to Resend', resendCallers, ['supabase/functions/send-email/index.ts']);
eq('only send-sms-notification talks to Twilio', twilioCallers, ['supabase/functions/send-sms-notification/index.ts']);
for (const [file, host, call] of [['supabase/functions/send-email/index.ts', 'api.resend.com', 'decideOutbound(\'email\''], ['supabase/functions/send-sms-notification/index.ts', 'api.twilio.com', 'decideOutbound("sms"']] as const) {
  const s = read(file);
  const iAuth = s.indexOf('authorizeRelayCaller(supabase');
  const iGuard = s.indexOf(call);
  const iFetch = s.indexOf(host);
  ok(`${file}: authorization runs first, then the environment guard, then the provider`, iAuth > 0 && iGuard > iAuth && iFetch > iGuard);
  ok(`${file}: the guard module is imported from _shared/notifications`, /from ['"]\.\.\/_shared\/notifications\/outbound-guard\.ts['"]/.test(s));
  ok(`${file}: a blocked decision returns before the provider is reached`, new RegExp(`${call.replace(/[()'"]/g, '.')}[\\s\\S]{0,1200}block[\\s\\S]{0,600}return new Response`).test(s));
}
ok('send-email hands the provider only the guard-approved recipient', /to: \[delivery\.recipient\]/.test(read('supabase/functions/send-email/index.ts')) && !/to: \[emailTo\]/.test(read('supabase/functions/send-email/index.ts')));
ok('send-sms-notification hands the provider only the guard-approved recipient', /formData\.append\("To", delivery\.recipient\)/.test(read('supabase/functions/send-sms-notification/index.ts')) && !/formData\.append\("To", toPhone\)/.test(read('supabase/functions/send-sms-notification/index.ts')));

// Every other notification pathway, named. A new one must be reviewed (and added here) before this test passes again.
const viaRelays = sources.filter((f) => /functions\/v1\/send-(email|sms-notification)|invoke\(['"]send-(email|sms-notification)/.test(read(f)) && !/send-email\/index|send-sms-notification\/index/.test(f));
ok('there are callers of the relays (they all inherit the guard)', viaRelays.length >= 10);
const directSenders = sources.filter((f) => /(inviteUserByEmail|resetPasswordForEmail|generateLink|auth\.signUp|auth\.resend|signInWithOtp)/.test(read(f)));
eq(
  'notification pathways OUTSIDE the two relays (Supabase Auth e-mail, sent by the Auth service, not by this code) - reviewed list',
  directSenders.sort(),
  ['src/contexts/AuthContext.tsx', 'src/pages/ForgotPassword.tsx', 'src/pages/Login.tsx', 'src/pages/SignUp.tsx'],
);
const errNotify = read('supabase/functions/send-error-notification/index.ts');
ok('send-error-notification has no provider call of its own (it invokes a "resend" function that does not exist in this repository, so it fails closed)', !/api\.resend\.com|api\.twilio\.com/.test(errNotify) && /functions\.invoke\(\s*'resend'/.test(errNotify) && !fs.existsSync('supabase/functions/resend'));
ok('the deprecated auth-email-hook sends nothing', !/fetch\(/.test(read('supabase/functions/auth-email-hook/index.ts').replace(/\/\*[\s\S]*?\*\//, '')));

(async () => {
  await handlerTests();
  console.log(`outbound guard tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} outbound guard test(s) failed`);
})();
