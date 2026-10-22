// WP-13 (conditional on P0-C): LOCAL DIAGNOSTIC of supabase/functions/calculate-route-mileage/index.ts.
// This test CHARACTERIZES the deployed function's current behavior with fixtures. It changes nothing in production code and does not claim to
// have found the hosted failure: the hosted cause (Google key restriction, quota, a specific Production row) cannot be reproduced locally and
// stays an open diagnostic step (P0-C: the owner runs End Day -> auto-calculate on Dev and sends the toast text).
// PASS - LOCAL AUTOMATED / MOCKED (the real handler source, a fake database and a fake Google Distance Matrix).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');

let passed = 0;
let failed = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}\n  got:      ${g}\n  expected: ${w}`);
  }
}
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}

const SOURCE = 'supabase/functions/calculate-route-mileage/index.ts';

interface World {
  role?: string | null;
  roleError?: boolean;
  startMileage?: number | null;
  mileageError?: boolean;
  taskError?: boolean;
  tasks?: Record<string, Array<{ order_id: string; sort_order: number | null; status: string; line1?: string; lat?: number; lng?: number }>>;
  settings?: Record<string, string>;
  key?: string | null;
  google?: (url: string, n: number) => { ok: boolean; status?: number; body: any };
}

const MILE = 1609.344;

function makeHandler(w: World) {
  const raw = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
  const stripped = raw.split('\n').filter((l: string) => !/^import\s/.test(l)).join('\n');
  const js = ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  let handler: ((req: Request) => Promise<Response>) | null = null;
  const env: Record<string, string | undefined> = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GOOGLE_MAPS_API_KEY: w.key === null ? undefined : (w.key ?? 'g-key') };
  const Deno = { serve: (fn: any) => { handler = fn; }, env: { get: (k: string) => env[k] } };
  let googleCalls = 0;
  const fetchFake = async (url: string) => {
    googleCalls++;
    const r: { ok: boolean; status?: number; body: any } = (w.google ?? (() => ({ ok: true, body: { status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: MILE } }] }] } })))(url, googleCalls);
    return { ok: r.ok, status: r.status ?? 200, json: async () => r.body };
  };
  const createClient = () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    from(table: string) {
      const filters: Record<string, any> = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => { filters[k] = v; return q; },
        in: () => q,
        order: () => q,
        maybeSingle: async () => {
          if (table === 'user_roles') return w.roleError ? { data: null, error: { message: 'multiple rows' } } : { data: w.role === null ? null : { role: w.role ?? 'admin' }, error: null };
          if (table === 'daily_mileage_logs') return w.mileageError ? { data: null, error: { message: 'boom' } } : { data: w.startMileage === null ? null : { start_mileage: w.startMileage ?? 100 }, error: null };
          return { data: null, error: null };
        },
        then: (res: any, rej: any) => {
          let out: any;
          if (table === 'task_status') {
            if (w.taskError) out = { data: null, error: { message: 'relation error' } };
            else {
              const rows = (w.tasks ?? {})[filters.task_date] ?? [];
              out = {
                data: rows.map((t) => ({
                  order_id: t.order_id,
                  sort_order: t.sort_order,
                  orders: { status: t.status, addresses: t.lat != null ? { line1: t.line1 ?? 'x', city: 'Detroit', state: 'MI', zip: '48201', lat: t.lat, lng: t.lng } : { line1: t.line1 ?? '1 Main', city: 'Detroit', state: 'MI', zip: '48201', lat: null, lng: null } },
                })),
                error: null,
              };
            }
          } else if (table === 'admin_settings') {
            out = { data: Object.entries(w.settings ?? {}).map(([key, value]) => ({ key, value })), error: null };
          } else out = { data: [], error: null };
          return Promise.resolve(out).then(res, rej);
        },
      };
      return q;
    },
  });
  new Function('Deno', 'createClient', 'fetch', js)(Deno, createClient, fetchFake);
  if (!handler) throw new Error('handler not registered');
  const call = async (body: any, token = 'tok') => {
    const resp = await (handler as any)(new Request('http://x/f', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: resp.status, json: await resp.json() };
  };
  return { call, googleCalls: () => googleCalls };
}

const D = '2026-07-10';
const stop = (order_id: string, sort_order: number | null, status = 'confirmed') => ({ order_id, sort_order, status, lat: 42.3, lng: -83.0 });

async function main() {
  // 1. healthy: home -> 2 stops -> home = 3 legs of exactly one mile each.
  {
    const h = makeHandler({ tasks: { [D]: [stop('a', 1), stop('b', 2)] } });
    const r = await h.call({ date: D });
    eq('healthy day: 200, 2 stops, 3 legs, 3 miles, end = start + 3', [r.status, r.json.stopCount, r.json.segments?.length, r.json.totalMiles, r.json.calculatedEndMileage, r.json.usedNearbyDate], [200, 2, 3, 3, 103, false]);
    eq('healthy day: one Google request per leg (sequential)', h.googleCalls(), 3);
  }
  // 2. FACT: the same order on the same day (a drop-off and a pick-up) is counted ONCE, contradicting the two-stop rule.
  {
    const h = makeHandler({ tasks: { [D]: [stop('a', 1), stop('a', 2)] } });
    const r = await h.call({ date: D });
    eq('FACT: same order twice the same day -> ONE stop (order-id de-dupe, index.ts:43-52)', [r.status, r.json.stopCount], [200, 1]);
  }
  // 3. FACT: a cancelled order is excluded from the stops but its row still counts in the diagnostic text.
  {
    const h = makeHandler({ tasks: { [D]: [stop('a', 1, 'cancelled')] } });
    const r = await h.call({ date: D });
    ok('FACT: only a cancelled order that day -> 422 naming the statuses found', r.status === 422 && /1 task\(s\) on 2026-07-10 but none qualify — statuses found: cancelled/.test(r.json.error));
  }
  // 4. FACT: a failed task query is swallowed and reported as "No tasks scheduled".
  {
    const r = await makeHandler({ taskError: true }).call({ date: D });
    ok('FACT: a database error reads as "No tasks scheduled" (index.ts:37)', r.status === 422 && /No tasks scheduled on 2026-07-10\./.test(r.json.error));
  }
  // 5. FACT: with no tasks on the date the function silently uses a task up to 3 days away and says so only in the toast suffix.
  {
    const h = makeHandler({ tasks: { '2026-07-12': [stop('a', 1)] } });
    const r = await h.call({ date: D });
    eq('FACT: no tasks on the date, one two days later -> 200 with usedNearbyDate', [r.status, r.json.usedNearbyDate, r.json.resolvedDate], [200, true, '2026-07-12']);
    const far = await makeHandler({ tasks: { '2026-07-14': [stop('a', 1)] } }).call({ date: D });
    eq('four days away is not found', far.status, 422);
  }
  // 6. start-of-day reading: 0, missing and a failed lookup all read "must be recorded".
  for (const [label, w] of [['null', { startMileage: null }], ['zero', { startMileage: 0 }], ['lookup error', { mileageError: true }]] as const) {
    const r = await makeHandler({ ...w, tasks: { [D]: [stop('a', 1)] } }).call({ date: D });
    ok(`FACT: start reading ${label} -> 422 "Start of day mileage must be recorded" (a lookup error is swallowed, index.ts:135-147)`, r.status === 422 && /Start of day mileage must be recorded/.test(r.json.error));
  }
  // 7. roles.
  {
    eq('crew is allowed', (await makeHandler({ role: 'crew', tasks: { [D]: [stop('a', 1)] } }).call({ date: D })).status, 200);
    eq('customer is refused', (await makeHandler({ role: 'customer' }).call({ date: D })).status, 403);
    eq('no role row is refused', (await makeHandler({ role: null }).call({ date: D })).status, 403);
    eq('FACT: a role lookup error (e.g. two role rows) is read as "no role" -> 403 (REFUTED for Production: no duplicate rows)', (await makeHandler({ roleError: true }).call({ date: D })).status, 403);
    eq('missing date is a 400', (await makeHandler({}).call({})).status, 400);
    eq('missing bearer token is a 401', (await makeHandler({}).call({ date: D }, '')).status, 401);
  }
  // 8. what the owner would SEE for the hosted failures that cannot be reproduced here (this is the text P0-C needs).
  {
    const denied = makeHandler({ tasks: { [D]: [stop('a', 1)] }, google: () => ({ ok: true, body: { status: 'REQUEST_DENIED', error_message: 'API key restricted', rows: [] } }) });
    const r = await denied.call({ date: D });
    ok('a restricted or denied Google key reads "API status: REQUEST_DENIED, Element status: unknown" with the waypoints (the error_message itself is NOT shown)', r.status === 422 && /API status: REQUEST_DENIED, Element status: unknown/.test(r.json.error) && !/restricted/.test(r.json.error));
    const http = await makeHandler({ tasks: { [D]: [stop('a', 1)] }, google: () => ({ ok: false, status: 403, body: {} }) }).call({ date: D });
    ok('an HTTP failure from Google reads "HTTP 403" for the segment', http.status === 502 && /segment 1: HTTP 403/.test(http.json.error));
    const zero = await makeHandler({ tasks: { [D]: [stop('a', 1)] }, google: () => ({ ok: true, body: { status: 'OK', rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] } }) }).call({ date: D });
    ok('ZERO_RESULTS (an unroutable stop) reads the element status', zero.status === 422 && /Element status: ZERO_RESULTS/.test(zero.json.error));
    const nokey = await makeHandler({ key: null, tasks: { [D]: [stop('a', 1)] } }).call({ date: D });
    eq('no server key -> 500 "not configured"', [nokey.status, /not configured/.test(nokey.json.error)], [500, true]);
  }
  // 9. address fallback and home base.
  {
    const urls: string[] = [];
    const h = makeHandler({ tasks: { [D]: [{ order_id: 'a', sort_order: 1, status: 'in_progress', line1: '9 Elm' } as any] }, settings: { home_base_address: '1 Home St, Wayne, MI' }, google: (u) => { urls.push(decodeURIComponent(u)); return { ok: true, body: { status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: MILE } }] }] } }; } });
    const r = await h.call({ date: D });
    ok('a stop without coordinates falls back to its street address; home base comes from settings', r.status === 200 && urls[0].includes('origins=1 Home St, Wayne, MI') && urls[0].includes('destinations=9 Elm, Detroit, MI 48201'));
  }
  // 10. what the CLIENT sends: a LOCAL date key (B9) and the signed-in user.
  {
    const modal = fs.readFileSync('src/components/calendar/MileageModal.tsx', 'utf8');
    ok('the client sends localDateKey(date) as the date and no user id (the server uses the caller)', /body: JSON\.stringify\(\{ date: dateStr \}\)/.test(modal) && /const dateStr = localDateKey\(date\);/.test(modal));
  }

  console.log(`routeMileageDiagnostic: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} route mileage diagnostic test(s) failed`);
}
main();
