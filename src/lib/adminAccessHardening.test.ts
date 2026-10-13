// Administrative access hardening tests: user_roles exposure, administrative SECURITY DEFINER RPC exposure, /setup removal and
// create-admin-user authorization.
//
// - create-admin-user is a Deno module, so its CURRENT source is loaded, its imports stripped, transpiled, and run
//   with fakes (Deno, createClient) plus the real shared auth helpers. Nothing touches a network or a database.
// - The migration is checked statically: the REVOKE/GRANT statements are parsed and applied to a worst-case "before"
//   privilege set (every role can execute), then the resulting EXECUTE set per function is asserted. The wrapper's
//   role list is parsed out of the SQL, so changing the SQL changes the test outcome.
// - The user_roles policy model is replayed from every migration in filename order.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');

import * as authHelpers from '../../supabase/functions/_shared/auth';

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
const MIGRATION = 'supabase/migrations/20261008120000_restrict_role_and_admin_rpc_exposure.sql';

// ---------------------------------------------------------------------------------------------------------------
// create-admin-user handler harness
// ---------------------------------------------------------------------------------------------------------------
function makeWorld() {
  return {
    roles: {
      'u-master': ['master'],
      'u-admin': ['admin'],
      'u-crew': ['crew'],
      'u-cust': ['customer'],
      'u-upper': ['MASTER'],
      'u-norole': [] as string[],
    } as Record<string, string[]>,
    tokens: { 'jwt-master': 'u-master', 'jwt-admin': 'u-admin', 'jwt-crew': 'u-crew', 'jwt-cust': 'u-cust', 'jwt-upper': 'u-upper', 'jwt-norole': 'u-norole' } as Record<string, string>,
    createdUsers: [] as any[],
    deletedUsers: [] as string[],
    roleInserts: [] as any[],
    settingsUpdates: [] as any[],
    rpcCalls: [] as string[],
    failRoleInsert: false,
    logs: [] as string[],
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
      admin: {
        createUser: async (params: any) => {
          w.createdUsers.push(params);
          return { data: { user: { id: 'new-user-id', email: params.email } }, error: null };
        },
        deleteUser: async (id: string) => {
          w.deletedUsers.push(id);
          return { error: null };
        },
      },
    },
    rpc: async (name: string) => {
      w.rpcCalls.push(name);
      return { data: [], error: null };
    },
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const api: any = {
        select: () => api,
        eq: (c: string, v: unknown) => (filters.push([c, v]), api),
        insert: async (payload: any) => {
          if (table === 'user_roles') {
            w.roleInserts.push(payload);
            if (w.failRoleInsert) return { error: { message: 'insert failed' } };
          }
          return { error: null };
        },
        update: (payload: any) => ({
          eq: async (c: string, v: unknown) => {
            w.settingsUpdates.push({ table, payload, c, v });
            return { error: null };
          },
        }),
        then: (resolve: any, reject: any) => {
          let rows: any[] = [];
          if (table === 'user_roles') {
            const uid = filters.find(([c]) => c === 'user_id')?.[1] as string;
            rows = (w.roles[uid] ?? []).map((role) => ({ role }));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

function loadHandler(w: World): (req: Request) => Promise<Response> {
  const src: string = fs.readFileSync('supabase/functions/create-admin-user/index.ts', 'utf8');
  const js: string = ts.transpileModule(src.replace(/^import[^;]*;/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  let captured: any = null;
  const env: Record<string, string> = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => env[k] }, serve: (h: any) => { captured = h; } },
    createClient: () => makeClient(w),
    console: { log: () => {}, info: () => {}, debug: () => {}, warn: (...a: unknown[]) => w.logs.push(a.map(String).join(' ')), error: (...a: unknown[]) => w.logs.push(a.map(String).join(' ')) },
    resolveCaller: authHelpers.resolveCaller,
    requireRoles: authHelpers.requireRoles,
    authFailureResponse: authHelpers.authFailureResponse,
  };
  const names = Object.keys(scope);
  new Function(...names, js)(...names.map((n) => scope[n]));
  if (!captured) throw new Error('Deno.serve not called');
  return captured;
}

async function callCreateAdmin(opts: { bearer: string | null; body: Record<string, unknown> | string; mutate?: (w: World) => void }) {
  const w = makeWorld();
  opts.mutate?.(w);
  const handler = loadHandler(w);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer !== null) headers.Authorization = `Bearer ${opts.bearer}`;
  const res = await handler(new Request('https://fake.functions/create-admin-user', { method: 'POST', headers, body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }));
  let json: any = null;
  try {
    json = await res.clone().json();
  } catch {
    json = null;
  }
  return { status: res.status, json, w };
}
const valid = { email: 'new.admin@example.com', password: 'a-long-password' };
const untouched = (w: World) => w.createdUsers.length === 0 && w.roleInserts.length === 0 && w.settingsUpdates.length === 0 && w.deletedUsers.length === 0;

// ---------------------------------------------------------------------------------------------------------------
// Static helpers for the migration
// ---------------------------------------------------------------------------------------------------------------
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
const migSql = stripSql(fs.readFileSync(MIGRATION, 'utf8'));
const GRANTEES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
function applyPrivileges(sql: string): Record<string, Set<string>> {
  // Worst case before-state: every grantee can execute every function (PUBLIC default and explicit grants).
  const st: Record<string, Set<string>> = {};
  const touch = (name: string) => (st[name] ??= new Set(GRANTEES));
  // Strip the DO blocks (rename guard) so only top-level REVOKE/GRANT are modelled, in statement order.
  const stmts = sql.match(/(REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.(\w+)\([^)]*\)\s+FROM\s+[^;]+;|GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.(\w+)\([^)]*\)\s+TO\s+[^;]+;)/g) ?? [];
  for (const s of stmts) {
    const rev = s.match(/^REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.(\w+)\([^)]*\)\s+FROM\s+([^;]+);/);
    const gr = s.match(/^GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.(\w+)\([^)]*\)\s+TO\s+([^;]+);/);
    if (rev) {
      const set = touch(rev[1]);
      for (const g of rev[2].split(',').map((x) => x.trim())) set.delete(g);
    } else if (gr) {
      const set = touch(gr[1]);
      for (const g of gr[2].split(',').map((x) => x.trim())) set.add(g);
    }
  }
  return st;
}

(async () => {
  // =============================================================================================================
  // create-admin-user
  // =============================================================================================================
  let r = await callCreateAdmin({ bearer: ANON_KEY, body: valid });
  ok('create-admin-user: the public anon key is denied (401), nothing created', r.status === 401 && untouched(r.w));
  r = await callCreateAdmin({ bearer: null, body: valid });
  ok('create-admin-user: no Authorization header is denied (401)', r.status === 401 && untouched(r.w));
  r = await callCreateAdmin({ bearer: 'jwt-cust', body: valid });
  ok('create-admin-user: a valid customer JWT is NOT enough (403)', r.status === 403 && untouched(r.w));
  r = await callCreateAdmin({ bearer: 'jwt-crew', body: valid });
  ok('create-admin-user: crew is denied (403)', r.status === 403 && untouched(r.w));
  r = await callCreateAdmin({ bearer: 'jwt-admin', body: valid });
  ok('create-admin-user: admin is denied (403): only master may grant admin roles', r.status === 403 && untouched(r.w));
  r = await callCreateAdmin({ bearer: 'jwt-norole', body: valid });
  ok('create-admin-user: an authenticated user with no role row is denied (403)', r.status === 403 && untouched(r.w));
  r = await callCreateAdmin({ bearer: 'jwt-cust', body: { ...valid, twilioAccountSid: 'AC1', twilioAuthToken: 't', twilioFromNumber: '+1' } });
  ok('create-admin-user: a denied caller cannot overwrite Twilio settings', r.status === 403 && r.w.settingsUpdates.length === 0);
  r = await callCreateAdmin({ bearer: ANON_KEY, body: {} });
  ok('create-admin-user: authorization runs before body validation (anon + empty body is 401, not 400)', r.status === 401);
  r = await callCreateAdmin({ bearer: ANON_KEY, body: 'not json' });
  ok('create-admin-user: authorization runs before parsing (anon + bad json is 401)', r.status === 401);

  r = await callCreateAdmin({ bearer: 'jwt-master', body: valid });
  ok('create-admin-user: master is allowed (200)', r.status === 200 && r.json?.success === true && r.w.createdUsers.length === 1);
  ok('create-admin-user: the stored role is the canonical lowercase "admin"', r.w.roleInserts.length === 1 && r.w.roleInserts[0].role === 'admin' && r.w.roleInserts[0].user_id === 'new-user-id');
  ok('create-admin-user: the auth metadata role is lowercase too', r.w.createdUsers[0].user_metadata.role === 'admin');
  ok('create-admin-user: no uppercase role is ever written', !JSON.stringify(r.w.roleInserts).includes('ADMIN') && !JSON.stringify(r.w.createdUsers).includes('ADMIN'));
  ok('create-admin-user: the old "admin already exists" bootstrap guard (get_admin_users) is gone', !r.w.rpcCalls.includes('get_admin_users'));
  r = await callCreateAdmin({ bearer: 'jwt-upper', body: valid });
  ok('create-admin-user: an uppercase MASTER role row is still recognized (lowercase-safe)', r.status === 200);
  r = await callCreateAdmin({ bearer: SERVICE_KEY, body: valid });
  ok('create-admin-user: the service role is allowed (200)', r.status === 200 && r.w.roleInserts[0]?.role === 'admin');
  r = await callCreateAdmin({ bearer: SERVICE_KEY, body: { ...valid, twilioAccountSid: 'AC1', twilioAuthToken: 't', twilioFromNumber: '+1555' } });
  ok('create-admin-user: Twilio settings are applied only for an authorized caller', r.status === 200 && r.w.settingsUpdates.length === 3);

  r = await callCreateAdmin({ bearer: 'jwt-master', body: { email: 'x@example.com' } });
  ok('create-admin-user: master with a missing password gets 400 and creates nothing', r.status === 400 && untouched(r.w));
  r = await callCreateAdmin({ bearer: 'jwt-master', body: { email: 'x@example.com', password: '123' } });
  ok('create-admin-user: master with a short password gets 400 and creates nothing', r.status === 400 && untouched(r.w));
  r = await callCreateAdmin({ bearer: 'jwt-master', body: valid, mutate: (w) => { w.failRoleInsert = true; } });
  ok('create-admin-user: a failed role insert removes the new login and returns an error', r.status === 500 && r.w.deletedUsers.length === 1 && r.w.deletedUsers[0] === 'new-user-id');
  const allLogs = [r.w.logs.join('\n')].join('\n');
  ok('create-admin-user: logs carry no secrets', !allLogs.includes(SERVICE_KEY) && !allLogs.includes(valid.password));

  // =============================================================================================================
  // Migration: privilege model for the administrative RPCs
  // =============================================================================================================
  const priv = applyPrivileges(migSql);
  const only = (name: string, roles: string[]) => {
    const got = [...(priv[name] ?? [])].sort();
    eq(`${name}: effective EXECUTE after the migration`, got, [...roles].sort());
  };
  only('get_admin_users', ['service_role']);
  only('check_expiring_cards', ['service_role']);
  only('get_user_creation_logs', ['service_role']);
  only('cleanup_old_rate_limits', ['service_role']);
  only('get_admin_analytics_impl', ['service_role']);
  only('get_admin_analytics', ['authenticated', 'service_role']);
  for (const fn of ['get_admin_users', 'check_expiring_cards', 'get_user_creation_logs', 'cleanup_old_rate_limits', 'get_admin_analytics_impl', 'get_admin_analytics']) {
    const set = priv[fn] ?? new Set<string>();
    ok(`${fn}: not executable by PUBLIC or anon (revoking anon alone would leave PUBLIC)`, !set.has('PUBLIC') && !set.has('anon'));
  }
  for (const fn of ['get_admin_users', 'check_expiring_cards', 'get_user_creation_logs', 'cleanup_old_rate_limits', 'get_admin_analytics_impl']) {
    ok(`${fn}: not executable by generic authenticated users`, !(priv[fn] ?? new Set()).has('authenticated'));
  }
  // Every function the migration grants must be revoked from PUBLIC explicitly (a grant-only statement would not).
  for (const m of migSql.matchAll(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.(\w+)\([^)]*\)\s+FROM\s+([^;]+);/g)) {
    ok(`${m[1]}: the revoke list includes PUBLIC`, /PUBLIC/.test(m[2]));
  }

  // The get_admin_analytics wrapper: parse the allowed roles out of the SQL and evaluate actors against them.
  const wrapper = (migSql.match(/CREATE OR REPLACE FUNCTION public\.get_admin_analytics\([\s\S]*?\$\$;/) ?? [''])[0];
  const wrapperRoles = ((wrapper.match(/lower\(ur\.role\)\s+IN\s*\(([^)]*)\)/) ?? ['', ''])[1].match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
  eq('get_admin_analytics wrapper: allowed roles parsed from the SQL', wrapperRoles, ['admin', 'master']);
  ok('get_admin_analytics wrapper: SECURITY DEFINER with a pinned search_path', /SECURITY DEFINER/.test(wrapper) && /SET search_path = public, pg_temp/.test(wrapper));
  ok('get_admin_analytics wrapper: binds the caller via auth.uid() and allows service_role via auth.role()', /ur\.user_id = auth\.uid\(\)/.test(wrapper) && /auth\.role\(\)/.test(wrapper) && /'service_role'/.test(wrapper));
  ok('get_admin_analytics wrapper: raises insufficient_privilege (42501) for everyone else', /RAISE EXCEPTION[^;]*42501/.test(wrapper));
  ok('get_admin_analytics wrapper: delegates to the preserved implementation unchanged', /RETURN public\.get_admin_analytics_impl\(p_start, p_end\);/.test(wrapper));
  ok('get_admin_analytics wrapper: does not depend on is_admin() (independent of the payment RPC authorization migration)', !/is_admin\(/.test(wrapper));
  const gate = (actor: { role: string | null; service?: boolean; hasJwt?: boolean }) => !!actor.service || (!!actor.role && wrapperRoles.includes(actor.role.toLowerCase()));
  ok('analytics gate: anonymous (no role) is denied', !gate({ role: null }));
  ok('analytics gate: a valid authenticated JWT with no admin role is denied', !gate({ role: null, hasJwt: true }));
  ok('analytics gate: customer is denied', !gate({ role: 'customer' }));
  ok('analytics gate: crew is denied', !gate({ role: 'crew' }));
  ok('analytics gate: admin is allowed', gate({ role: 'admin' }));
  ok('analytics gate: master is allowed', gate({ role: 'master' }));
  ok('analytics gate: an uppercase MASTER row is allowed (lowercase-safe)', gate({ role: 'MASTER' }));
  ok('analytics gate: service role is allowed', gate({ role: null, service: true }));

  ok('migration preserves the original analytics body by renaming it once (idempotent guard)', /to_regprocedure\('public\.get_admin_analytics_impl\(timestamptz,timestamptz\)'\) IS NULL/.test(migSql) && /RENAME TO get_admin_analytics_impl/.test(migSql));
  ok('migration pins search_path on the touched definer functions', /ALTER FUNCTION public\.check_expiring_cards\(\) SET search_path = public, pg_temp/.test(migSql) && /ALTER FUNCTION public\.cleanup_old_rate_limits\(\) SET search_path = public, pg_temp/.test(migSql) && /ALTER FUNCTION public\.get_admin_analytics_impl\(timestamptz, timestamptz\) SET search_path = public, pg_temp/.test(migSql));

  // user_roles statements in the migration
  ok('migration drops the open user_roles policy idempotently', /DROP POLICY IF EXISTS "Service role full access to user_roles" ON public\.user_roles;/.test(migSql));
  ok('migration removes all anon privileges on user_roles', /REVOKE ALL ON TABLE public\.user_roles FROM anon;/.test(migSql));
  ok('migration does not create any user_roles policy (restrictive policies already exist in both environments)', !/CREATE\s+POLICY/i.test(migSql));
  ok('migration does not touch customer / order / invoice objects or payment RPC authorization objects', !/\b(orders|order_items|invoice_links|customers|payments|record_cash_payment|record_check_payment|apply_balance_payment_financials|increment_order_refunded_cents|approve_order_changes|stripe|checkout)\b/i.test(migSql));
  ok('migration does not redefine is_admin (independent of the payment RPC authorization migration)', !/FUNCTION public\.is_admin/.test(migSql));

  // =============================================================================================================
  // user_roles policy model replayed from every migration
  // =============================================================================================================
  const files = fs.readdirSync('supabase/migrations').filter((f: string) => f.endsWith('.sql')).sort();
  const policies = new Map<string, { roles: string[]; unconditional: boolean; cmd: string }>();
  for (const f of files) {
    const sql = stripSql(fs.readFileSync(`supabase/migrations/${f}`, 'utf8'));
    for (const m of sql.matchAll(/(CREATE\s+POLICY|DROP\s+POLICY(?:\s+IF\s+EXISTS)?)\s+"([^"]+)"\s+ON\s+(?:public\.)?user_roles\b([^;]*);/gi)) {
      const name = m[2];
      if (/^DROP/i.test(m[1])) {
        policies.delete(name);
      } else {
        const body = m[3];
        const to = body.match(/\bTO\s+([\w\s,]+?)(?=\s+(?:USING|WITH)\b|$)/i);
        const roles = to ? to[1].split(',').map((x) => x.trim().toLowerCase()) : ['public'];
        const using = body.match(/\bUSING\s*\(\s*([\s\S]*?)\s*\)\s*(?:WITH|$)/i);
        const check = body.match(/\bWITH\s+CHECK\s*\(\s*([\s\S]*?)\s*\)\s*$/i);
        const trueUsing = !!using && /^true$/i.test(using[1].trim());
        const trueCheck = !!check && /^true$/i.test(check[1].trim());
        const cmd = (body.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i) ?? ['', 'ALL'])[1].toUpperCase();
        policies.set(name, { roles, unconditional: trueUsing || (trueCheck && !using), cmd });
      }
    }
  }
  const openOnes = [...policies.entries()].filter(([, p]) => p.unconditional && (p.roles.includes('public') || p.roles.includes('anon')));
  eq('user_roles replay: no unconditional public/anon policy remains', openOnes.map(([n]) => n), []);
  const names = [...policies.keys()];
  ok('user_roles replay: an own-row read policy remains (AuthContext needs it)', names.some((n) => /own role/i.test(n)));
  ok('user_roles replay: admin/master can read all roles', names.some((n) => /read all roles/i.test(n)));
  ok('user_roles replay: master and crew-only admin management policies remain', names.some((n) => /Master can insert/i.test(n)) && names.some((n) => /Admin can insert crew/i.test(n)));
  ok('user_roles replay: no policy lets customers or crew write roles (no policy to public/anon/authenticated without a role check)',
    [...policies.values()].every((p) => !(p.unconditional && (p.roles.includes('authenticated') || p.roles.includes('public') || p.roles.includes('anon')))));

  // Role administration used by the app is unchanged
  const perms: string = fs.readFileSync('src/components/admin/PermissionsTab.tsx', 'utf8');
  ok('Admin/Master role management still uses the same RPCs and table paths', /assign_role_by_email/.test(perms) && /get_all_role_users/.test(perms) && /from\('user_roles'\)/.test(perms));

  // =============================================================================================================
  // /setup removal and caller searches
  // =============================================================================================================
  const app: string = fs.readFileSync('src/App.tsx', 'utf8');
  ok('/setup route is gone', !/path="\/setup"/.test(app));
  ok('Setup page import is gone', !/pages\/Setup/.test(app) && !/\bSetup\b/.test(app.replace(/Setup[A-Z]\w*/g, '')));
  ok('src/pages/Setup.tsx is deleted', !fs.existsSync('src/pages/Setup.tsx'));
  const srcFiles: string[] = (fs.readdirSync('src', { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
  const srcText = (pat: RegExp) => srcFiles.filter((f) => pat.test(fs.readFileSync(`src/${f}`, 'utf8')));
  eq('no browser code calls get_admin_users', srcText(/get_admin_users/).filter((f) => !/database\.types/.test(f)), []);
  eq('no browser code calls check_expiring_cards', srcText(/check_expiring_cards/).filter((f) => !/database\.types/.test(f)), []);
  eq('no browser code calls get_user_creation_logs', srcText(/get_user_creation_logs/).filter((f) => !/database\.types/.test(f)), []);
  eq('no browser code calls cleanup_old_rate_limits', srcText(/cleanup_old_rate_limits/).filter((f) => !/database\.types/.test(f)), []);
  eq('no browser code invokes create-admin-user', srcText(/create-admin-user/), []);
  eq('the analytics RPC is called only by the admin analytics hook', srcText(/rpc\(\s*'get_admin_analytics'/), ['hooks/useAdminAnalytics.ts']);
  const fnDirs: string[] = fs.readdirSync('supabase/functions');
  const backendCallers: string[] = [];
  for (const d of fnDirs) {
    const p = `supabase/functions/${d}/index.ts`;
    if (!fs.existsSync(p)) continue;
    const s: string = fs.readFileSync(p, 'utf8');
    for (const rpc of ['get_admin_users', 'check_expiring_cards', 'get_user_creation_logs', 'cleanup_old_rate_limits']) if (s.includes(`"${rpc}"`) || s.includes(`'${rpc}'`)) backendCallers.push(`${d}:${rpc}`);
  }
  eq('no Edge Function still calls the restricted RPCs (create-admin-user no longer needs get_admin_users)', backendCallers, []);
  const cau: string = fs.readFileSync('supabase/functions/create-admin-user/index.ts', 'utf8');
  ok('create-admin-user has explicit server-side authorization', /resolveCaller\(/.test(cau) && /requireRoles\(/.test(cau) && /ADMIN_CREATOR_ROLES = \["master"\]/.test(cau));
  ok('create-admin-user writes the canonical lowercase role', /const ADMIN_ROLE = "admin"/.test(cau) && !/role: 'ADMIN'/.test(cau) && !/role: "ADMIN"/.test(cau));

  console.log(`Admin exposure hotfix tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} admin exposure hotfix test(s) failed`);
})();
