// Handler-level authorization tests for the fix-payment-method Edge Function.
//
// fix-payment-method reads Stripe checkout sessions and writes orders.stripe_payment_method_id with the service-role key. No
// workflow in the application calls it, so it is a staff-only repair tool. The CURRENT source is loaded, its imports stripped,
// transpiled and run with fakes (Deno, createClient, Stripe) plus the real shared auth helpers. Nothing touches a network, a
// database or real Stripe: the fake database records every read and write and the fake Stripe records every call.
//
// Every rejected call must make ZERO Stripe calls and ZERO database writes (and no admin_settings / orders read either).

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { exit(code: number): never };
const fs = require('fs');
const ts = require('typescript');

import * as authHelpers from '../../../../supabase/functions/_shared/auth';

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
const ORDER_A = '11111111-1111-4111-8111-111111111111';
const FN = 'supabase/functions/fix-payment-method/index.ts';

function makeWorld() {
  return {
    roles: {
      'u-master': ['master'],
      'u-admin': ['admin'],
      'u-upper': ['ADMIN'],
      'u-crew': ['crew'],
      'u-cust-owner': ['customer'],
      'u-cust-other': ['customer'],
      'u-norole': [] as string[],
    } as Record<string, string[]>,
    tokens: {
      'jwt-master': 'u-master',
      'jwt-admin': 'u-admin',
      'jwt-upper': 'u-upper',
      'jwt-crew': 'u-crew',
      'jwt-owner': 'u-cust-owner',
      'jwt-other': 'u-cust-other',
      'jwt-norole': 'u-norole',
    } as Record<string, string>,
    orders: { [ORDER_A]: { stripe_customer_id: 'cus_A', stripe_payment_method_id: 'pm_old', owner: 'u-cust-owner' } } as Record<string, any>,
    reads: [] as string[], // table names read other than user_roles
    writes: [] as any[],
    stripeCalls: [] as string[],
  };
}
type World = ReturnType<typeof makeWorld>;

function makeClient(w: World) {
  return {
    auth: {
      getUser: async (token: string) => {
        const id = w.tokens[token];
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid or expired' } };
      },
    },
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let isUpdate: any = null;
      const api: any = {
        select: () => api,
        update: (payload: any) => {
          isUpdate = payload;
          return api;
        },
        eq: (c: string, v: unknown) => {
          filters.push([c, v]);
          return api;
        },
        maybeSingle: async () => {
          if (table !== 'user_roles') w.reads.push(table);
          if (table === 'admin_settings') return { data: { value: 'sk_test_fake' }, error: null };
          if (table === 'orders') {
            const id = filters.find(([c]) => c === 'id')?.[1] as string;
            const o = w.orders[id];
            return { data: o ? { stripe_customer_id: o.stripe_customer_id } : null, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: any, reject: any) => {
          if (isUpdate) {
            w.writes.push({ table, payload: isUpdate, filters });
            const id = filters.find(([c]) => c === 'id')?.[1] as string;
            if (table === 'orders' && w.orders[id]) Object.assign(w.orders[id], isUpdate);
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

function loadHandler(w: World): (req: Request) => Promise<Response> {
  const src: string = fs.readFileSync(FN, 'utf8');
  const js: string = ts.transpileModule(src.replace(/^import[^;]*;/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let captured: any = null;
  const env: Record<string, string> = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
  class FakeStripe {
    checkout = {
      sessions: {
        list: async (p: any) => {
          w.stripeCalls.push('sessions.list:' + p.customer);
          return { data: [{ id: 'cs_1', metadata: { order_id: ORDER_A } }] };
        },
        retrieve: async (id: string) => {
          w.stripeCalls.push('sessions.retrieve:' + id);
          return { payment_method: 'pm_new', payment_intent: null };
        },
      },
    };
  }
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => env[k] }, serve: (h: any) => { captured = h; } },
    createClient: () => makeClient(w),
    Stripe: FakeStripe,
    console: { log: () => {}, info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    resolveCaller: authHelpers.resolveCaller,
    requireRoles: authHelpers.requireRoles,
    authFailureResponse: authHelpers.authFailureResponse,
    STAFF_ADMIN_ROLES: authHelpers.STAFF_ADMIN_ROLES,
  };
  const names = Object.keys(scope);
  new Function(...names, js)(...names.map((n) => scope[n]));
  if (!captured) throw new Error('Deno.serve not called');
  return captured;
}

async function call(opts: { bearer: string | null; body: unknown | string; method?: string }) {
  const w = makeWorld();
  const handler = loadHandler(w);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer !== null) headers.Authorization = `Bearer ${opts.bearer}`;
  const res = await handler(
    new Request('https://fake.functions/fix-payment-method', {
      method: opts.method ?? 'POST',
      headers,
      body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    }),
  );
  let json: any = null;
  try {
    json = await res.clone().json();
  } catch {
    json = null;
  }
  return { status: res.status, json, w };
}
const untouched = (w: World) => w.stripeCalls.length === 0 && w.writes.length === 0 && w.reads.length === 0;
const body = { orderId: ORDER_A };

(async () => {
  // ---- Rejected callers: 401/403, no Stripe call, no database write, not even an orders/admin_settings read ----
  let r = await call({ bearer: ANON_KEY, body });
  ok('anonymous with only the public anon key: 401, nothing touched', r.status === 401 && untouched(r.w));
  r = await call({ bearer: null, body });
  ok('no Authorization header: 401, nothing touched', r.status === 401 && untouched(r.w));
  r = await call({ bearer: 'jwt-expired-or-garbage', body });
  ok('invalid or expired credential: 401, nothing touched', r.status === 401 && untouched(r.w));
  r = await call({ bearer: SERVICE_KEY, body });
  ok('the service-role key is not a user identity: 403, nothing touched', r.status === 403 && untouched(r.w));
  r = await call({ bearer: 'jwt-owner', body });
  ok('customer acting on THEIR OWN order: 403, nothing touched', r.status === 403 && untouched(r.w));
  r = await call({ bearer: 'jwt-other', body });
  ok("customer acting on ANOTHER customer's order: 403, nothing touched", r.status === 403 && untouched(r.w));
  r = await call({ bearer: 'jwt-crew', body });
  ok('crew: 403, nothing touched', r.status === 403 && untouched(r.w));
  r = await call({ bearer: 'jwt-norole', body });
  ok('signed-in user with no role row: 403, nothing touched', r.status === 403 && untouched(r.w));

  // ---- Authorization precedes validation ----
  r = await call({ bearer: ANON_KEY, body: {} });
  ok('anonymous + missing orderId is 401 (not 400): authorization runs first', r.status === 401 && untouched(r.w));
  r = await call({ bearer: ANON_KEY, body: 'not json' });
  ok('anonymous + malformed body is 401 (not 500): authorization runs first', r.status === 401 && untouched(r.w));
  r = await call({ bearer: 'jwt-owner', body: { orderId: 'nonexistent' } });
  ok('customer + unknown order id is 403 (no order-existence oracle)', r.status === 403 && untouched(r.w));

  // ---- Permitted staff keep the existing behaviour ----
  for (const [who, bearer] of [['master', 'jwt-master'], ['admin', 'jwt-admin'], ['admin with upper-case stored role', 'jwt-upper']] as const) {
    r = await call({ bearer, body });
    ok(`${who}: 200 and the order's payment method is updated from its own checkout session`, r.status === 200 && r.json?.success === true && r.json?.paymentMethodId === 'pm_new');
    ok(`${who}: exactly one update, scoped to that order id, and only stripe_payment_method_id`, r.w.writes.length === 1 && r.w.writes[0].table === 'orders' && JSON.stringify(r.w.writes[0].payload) === JSON.stringify({ stripe_payment_method_id: 'pm_new' }) && r.w.writes[0].filters.some(([c, v]: [string, unknown]) => c === 'id' && v === ORDER_A));
    ok(`${who}: Stripe is only asked about that order's customer`, r.w.stripeCalls[0] === 'sessions.list:cus_A');
  }
  r = await call({ bearer: 'jwt-admin', body: {} });
  ok('admin + missing orderId: 400, no Stripe call, no write', r.status === 400 && r.w.stripeCalls.length === 0 && r.w.writes.length === 0);
  r = await call({ bearer: 'jwt-admin', body: { orderId: 'nonexistent' } });
  ok('admin + unknown order: 404, no Stripe call, no write', r.status === 404 && r.w.stripeCalls.length === 0 && r.w.writes.length === 0);

  // ---- Preflight is unchanged ----
  r = await call({ bearer: null, body: '', method: 'OPTIONS' });
  ok('CORS preflight still answers 200 without credentials', r.status === 200);

  // ---- Static: the gate precedes every privileged operation in the source ----
  const src: string = fs.readFileSync(FN, 'utf8');
  const gateAt = src.indexOf('requireRoles(');
  ok('source: the role gate exists', gateAt > 0);
  for (const marker of ['req.json()', 'admin_settings', '.from("orders")', 'checkout.sessions', 'new Stripe(']) {
    const at = src.indexOf(marker);
    ok(`source: the role gate comes before ${marker}`, at > gateAt);
  }
  ok('source: no second client or ungated service-role use before the gate', (src.match(/createClient\(/g) || []).length === 1);

  // The gateway setting must not be able to fall back to the weaker value on a normal deployment (the CLI follows config.toml).
  const cfg: string = fs.readFileSync('supabase/config.toml', 'utf8');
  const block = cfg.match(/\[functions\.fix-payment-method\]\s*\r?\nverify_jwt\s*=\s*(true|false)/);
  ok('config.toml: fix-payment-method sets verify_jwt = true (gateway JWT required in addition to the role gate)', !!block && block[1] === 'true');
  ok('config.toml: exactly one [functions.fix-payment-method] block', (cfg.match(/\[functions\.fix-payment-method\]/g) || []).length === 1);

  console.log(`fix-payment-method authorization: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
