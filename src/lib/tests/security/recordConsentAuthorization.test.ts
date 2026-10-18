// Handler-level tests for the record-consent Edge Function (SEC-049).
//
// The repository copy of this function was emptied by commit 8d4701f ("Updated index.ts") although signup (SignUp.tsx) and the pending-consent
// drain (AuthContext.tsx) call it. Deploying the empty file would silently stop consent logging. The source was restored byte for byte from
// 8d4701f^ and these tests pin the security properties it must keep: only a signed-in user is served, every row written or read is scoped to
// that user's own id, invalid consent data writes nothing, duplicates are idempotent, and nothing is sent to an outside provider.
//
// The CURRENT source is loaded, its imports stripped, transpiled and run with fakes (Deno, createClient). No network, no database.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}

const FN = 'supabase/functions/record-consent/index.ts';
const SERVICE_KEY = 'svc-key-0123456789abcdef';
const ANON_KEY = 'anon-key-0123456789abcdef';
const ME = 'user-me';
const OTHER = 'user-other';
const BATCH = '11111111-2222-4333-8444-555555555555';
const GOOD = [
  { type: 'terms_of_service', version: '1.0', consented: true },
  { type: 'privacy_policy', version: '1.0', consented: true },
  { type: 'marketing_email', version: '1.0', consented: false },
  { type: 'marketing_sms', version: '1.0', consented: false },
];

function makeWorld() {
  return {
    tokens: { 'jwt-me': ME, 'jwt-other': OTHER } as Record<string, string>,
    pending: { [ME]: { batch_id: BATCH, consents: GOOD, source: 'signup', user_agent_hint: 'ua' }, [OTHER]: { batch_id: BATCH, consents: GOOD, source: 'signup', user_agent_hint: 'other' } } as Record<string, any>,
    customers: { [ME]: { id: 'cust-me' }, [OTHER]: { id: 'cust-other' } } as Record<string, any>,
    inserted: [] as any[],
    seen: new Set<string>(),
    deletes: [] as any[],
    reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
    fetches: [] as string[],
    pendingOverride: undefined as any,
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
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let op = 'select';
      let payload: any = null;
      const api: any = {
        select: () => api,
        insert: (p: any) => { op = 'insert'; payload = p; return api; },
        delete: () => { op = 'delete'; return api; },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
        maybeSingle: async () => {
          w.reads.push({ table, filters: [...filters] });
          const uid = filters.find(([c]) => c === 'user_id')?.[1] as string;
          if (table === 'pending_signups_consent') return { data: w.pendingOverride !== undefined ? w.pendingOverride : (w.pending[uid] ?? null), error: null };
          if (table === 'customers') return { data: w.customers[uid] ?? null, error: null };
          return { data: null, error: null };
        },
        then: (resolve: any, reject: any) => {
          let error: any = null;
          if (op === 'insert') {
            const rows = Array.isArray(payload) ? payload : [payload];
            for (const r of rows) {
              const key = `${r.user_id}|${r.consent_batch_id}|${r.consent_type}`;
              if (r.consent_batch_id && w.seen.has(key)) error = { code: '23505', message: 'duplicate key value violates unique constraint' };
              else { w.seen.add(key); w.inserted.push(r); }
            }
          }
          if (op === 'delete') w.deletes.push({ table, filters: [...filters] });
          return Promise.resolve({ data: null, error }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

function loadHandler(w: World): (req: Request) => Promise<Response> {
  const src: string = fs.readFileSync(FN, 'utf8');
  const js: string = ts.transpileModule(src.replace(/^import[^;]*;/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  let captured: any = null;
  const env: Record<string, string> = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => env[k] }, serve: (h: any) => { captured = h; } },
    createClient: () => makeClient(w),
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    fetch: async (u: unknown) => { w.fetches.push(String(u)); return new Response('{}'); },
  };
  const names = Object.keys(scope);
  new Function(...names, js)(...names.map((n) => scope[n]));
  if (!captured) throw new Error('Deno.serve not called');
  return captured;
}

async function call(opts: { bearer?: string | null; method?: string; query?: string; body?: unknown; world?: World }) {
  const w = opts.world ?? makeWorld();
  const handler = loadHandler(w);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  const method = opts.method ?? 'POST';
  const res = await handler(new Request(`https://fake.functions/record-consent${opts.query ?? ''}`, { method, headers, body: method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined }));
  let json: any = null;
  try { json = await res.clone().json(); } catch { json = null; }
  return { status: res.status, json, w };
}
const untouched = (w: World) => w.inserted.length === 0 && w.deletes.length === 0 && w.reads.length === 0 && w.fetches.length === 0;

(async () => {
  const src = fs.readFileSync(FN, 'utf8');
  ok('the source is no longer empty and serves requests', src.length > 5000 && /Deno\.serve/.test(src));
  const cfg = fs.readFileSync('supabase/config.toml', 'utf8').replace(/\r\n/g, '\n');
  ok('config.toml requires a Supabase JWT for record-consent (callers send the signed-in user token)', /\[functions\.record-consent\]\nverify_jwt = true/.test(cfg));

  let r = await call({ method: 'GET' });
  ok('GET is 405 and touches nothing', r.status === 405 && untouched(r.w));
  r = await call({ bearer: null, body: { consents: GOOD } });
  ok('no Authorization header: 401, nothing touched', r.status === 401 && untouched(r.w));
  r = await call({ bearer: ANON_KEY, body: { consents: GOOD } });
  ok('only the public anon key: 401, nothing written', r.status === 401 && r.w.inserted.length === 0 && r.w.deletes.length === 0);
  r = await call({ bearer: ANON_KEY, query: '?action=drain-pending' });
  ok('drain-pending with only the anon key: 401, nothing read from pending consent and nothing deleted', r.status === 401 && r.w.inserted.length === 0 && r.w.deletes.length === 0 && !r.w.reads.some((x) => x.table === 'pending_signups_consent'));

  // validation
  for (const [label, consents] of [
    ['an empty list', []],
    ['not an array', 'terms_of_service'],
    ['an unknown consent type', [{ type: 'admin_override', version: '1.0', consented: true }]],
    ['a non-boolean consented', [{ type: 'terms_of_service', version: '1.0', consented: 'yes' }]],
    ['a missing version', [{ type: 'terms_of_service', consented: true }]],
  ] as Array<[string, unknown]>) {
    r = await call({ bearer: 'jwt-me', body: { batch_id: BATCH, consents } });
    ok(`${label}: 400 and nothing written`, r.status === 400 && r.w.inserted.length === 0);
  }

  // a normal record
  r = await call({ bearer: 'jwt-me', body: { batch_id: BATCH, consents: GOOD, source: 'signup', user_agent_hint: 'ua', user_id: OTHER, customer_id: 'cust-other' } });
  ok('a signed-in user records their consent: 200, four rows, success flags', r.status === 200 && r.json.success === true && r.json.inserted === 4 && r.json.skipped === 0 && r.json.safe_to_clear_pending === true);
  ok('every row belongs to the CALLER, even though the body tried to name another user and customer', r.w.inserted.length === 4 && r.w.inserted.every((x: any) => x.user_id === ME && x.customer_id === 'cust-me'));
  ok('the customer lookup is scoped to the caller', r.w.reads.filter((x) => x.table === 'customers').every((x) => x.filters.some(([c, v]) => c === 'user_id' && v === ME)));
  ok('only the known columns are written (no caller-supplied extra fields)', r.w.inserted.every((x: any) => Object.keys(x).sort().join() === 'consent_batch_id,consent_type,consented,customer_id,policy_version,source,user_agent_hint,user_id'));
  const again = await call({ bearer: 'jwt-me', body: { batch_id: BATCH, consents: GOOD }, world: r.w });
  ok('repeating the same batch is idempotent: nothing inserted twice, all skipped', again.status === 200 && again.json.inserted === 0 && again.json.skipped === 4 && r.w.inserted.length === 4);
  ok('no outbound request is made', r.w.fetches.length === 0);

  // drain
  const dw = makeWorld();
  r = await call({ bearer: 'jwt-me', query: '?action=drain-pending', world: dw });
  ok('drain-pending moves the CALLER\'s pending consent into the log and removes only that row', r.status === 200 && r.json.inserted === 4 && dw.inserted.every((x: any) => x.user_id === ME));
  ok('drain-pending reads and deletes only rows filtered by the caller id', dw.reads.filter((x) => x.table === 'pending_signups_consent').every((x) => x.filters.some(([c, v]) => c === 'user_id' && v === ME)) && dw.deletes.length === 1 && dw.deletes[0].filters.some(([c, v]: [string, unknown]) => c === 'user_id' && v === ME));
  const nw = makeWorld();
  nw.pendingOverride = null;
  r = await call({ bearer: 'jwt-me', query: '?action=drain-pending', world: nw });
  ok('drain-pending with nothing pending answers already_drained and writes nothing', r.status === 200 && r.json.already_drained === true && nw.inserted.length === 0 && nw.deletes.length === 0);
  const bw = makeWorld();
  bw.pendingOverride = { batch_id: BATCH, consents: [{ type: 'superuser', version: '1', consented: true }], source: 'signup' };
  r = await call({ bearer: 'jwt-me', query: '?action=drain-pending', world: bw });
  ok('corrupt pending data is rejected (400) before anything is written or deleted', r.status === 400 && bw.inserted.length === 0 && bw.deletes.length === 0);

  // the frontend contract
  const signup = fs.readFileSync('src/pages/SignUp.tsx', 'utf8');
  const auth = fs.readFileSync('src/contexts/AuthContext.tsx', 'utf8');
  ok('the callers still use the contract this function implements (POST with the user token; ?action=drain-pending)', /functions\/v1\/record-consent`/.test(signup) && /record-consent\?action=drain-pending/.test(auth) && /Authorization.*Bearer/.test(signup));
  ok('the consent types the signup form sends are exactly the ones the function and the table accept', ['terms_of_service', 'privacy_policy', 'marketing_email', 'marketing_sms'].every((t) => signup.includes(`'${t}'`) && src.includes(`'${t}'`)));

  console.log(`record-consent authorization tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} record-consent authorization test(s) failed`);
})();
