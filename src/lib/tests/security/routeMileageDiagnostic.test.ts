// WP-13: regression tests for supabase/functions/calculate-route-mileage/index.ts, running the REAL handler against fixtures (fake database, fake Google).
// Corrected here (source-confirmed, independent of the hosted failure): failed task/mileage/role queries are reported as failed reads; a drop-off and a
// pick-up of one order on one day are two stops; the requested date is the only date searched; a start reading of 0 is a reading; Google's own
// error message is shown (key removed). NOT claimed: the hosted cause (Google key restriction, quota, Production data) - that stays REQUIRES HOSTED DEV
// VERIFICATION (P0-C: the toast text from End Day auto-calculate on Dev). PASS - LOCAL AUTOMATED / MOCKED.
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
  tasks?: Record<string, Array<{ order_id: string; task_type?: string; sort_order: number | null; status: string; line1?: string; lat?: number; lng?: number }>>;
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
                  order_id: t.order_id, task_type: t.task_type,
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
  // 2. CORRECTED (was the order-id de-dupe): the same order twice on the same day (a drop-off and a pick-up) is TWO stops.
  {
    const h = makeHandler({ tasks: { [D]: [{ ...stop('a', 1), task_type: 'drop-off' }, { ...stop('a', 2), task_type: 'pick-up' }] } });
    const r = await h.call({ date: D });
    eq('same order, drop-off and pick-up the same day -> TWO stops and four legs (home, a, a, home)', [r.status, r.json.stopCount, r.json.segments?.length], [200, 2, 3]);
    eq('...labelled by visit', [r.json.segments?.[1]?.from, r.json.segments?.[1]?.to], ['x, Detroit, MI (drop-off)', 'x, Detroit, MI (pick-up)']);
    const two = await makeHandler({ tasks: { [D]: [stop('a', 1), stop('a', 2), stop('b', 3)] } }).call({ date: D });
    eq('three task rows are three stops, whatever the orders', two.json.stopCount, 3);
  }
  // 3. FACT: a cancelled order is excluded from the stops but its row still counts in the diagnostic text.
  {
    const h = makeHandler({ tasks: { [D]: [stop('a', 1, 'cancelled')] } });
    const r = await h.call({ date: D });
    ok('FACT: only a cancelled order that day -> 422 naming the statuses found', r.status === 422 && /1 task\(s\) on 2026-07-10 but none qualify — statuses found: cancelled/.test(r.json.error));
  }
  // 4. CORRECTED: a failed task query is reported as a failed read (500, TASKS_LOAD_FAILED), never as "No tasks scheduled".
  {
    const r = await makeHandler({ taskError: true }).call({ date: D });
    ok('a database error is reported as a failed task load, naming the date and the database message', r.status === 500 && r.json.code === 'TASKS_LOAD_FAILED' && /Could not load the tasks for 2026-07-10: relation error/.test(r.json.error) && !/No tasks scheduled/.test(r.json.error));
  }
  // 5. CORRECTED: the requested date and no other; tasks on a neighbouring day are a different day's route.
  {
    for (const near of ['2026-07-12', '2026-07-09', '2026-07-11', '2026-07-13']) {
      const h = makeHandler({ tasks: { [near]: [stop('a', 1)] } });
      const r = await h.call({ date: D });
      ok(`tasks only on ${near} -> 422 NO_QUALIFYING_TASKS (no silent neighbouring-day search) and no Google request`, r.status === 422 && r.json.code === 'NO_QUALIFYING_TASKS' && /No tasks scheduled on 2026-07-10\./.test(r.json.error) && h.googleCalls() === 0);
    }
    const ok1 = await makeHandler({ tasks: { [D]: [stop('a', 1)] } }).call({ date: D });
    eq('the requested date is always the resolved date', [ok1.json.resolvedDate, ok1.json.usedNearbyDate], [D, false]);
  }
  // 6. start-of-day reading: only a MISSING reading is missing; 0 is a reading; a failed lookup is a failed lookup.
  {
    const missing = await makeHandler({ startMileage: null, tasks: { [D]: [stop('a', 1)] } }).call({ date: D });
    ok('no reading -> 422 START_MILEAGE_MISSING', missing.status === 422 && missing.json.code === 'START_MILEAGE_MISSING' && /Start of day mileage must be recorded/.test(missing.json.error));
    const zero = await makeHandler({ startMileage: 0, tasks: { [D]: [stop('a', 1)] } }).call({ date: D });
    eq('a start reading of 0 is accepted: end = 0 + 2 miles (one stop, two legs)', [zero.status, zero.json.startMileage, zero.json.calculatedEndMileage], [200, 0, 2]);
    const lookup = await makeHandler({ mileageError: true, tasks: { [D]: [stop('a', 1)] } }).call({ date: D });
    ok('a failed mileage lookup is reported as such (500 MILEAGE_LOOKUP_FAILED), not as a missing reading', lookup.status === 500 && lookup.json.code === 'MILEAGE_LOOKUP_FAILED' && !/must be recorded/.test(lookup.json.error));
  }
  // 7. roles.
  {
    eq('crew is allowed', (await makeHandler({ role: 'crew', tasks: { [D]: [stop('a', 1)] } }).call({ date: D })).status, 200);
    eq('customer is refused', (await makeHandler({ role: 'customer' }).call({ date: D })).status, 403);
    eq('no role row is refused', (await makeHandler({ role: null }).call({ date: D })).status, 403);
    const roleFail = await makeHandler({ roleError: true }).call({ date: D });
    ok('a failed role lookup is reported as such (500 ROLE_LOOKUP_FAILED), not as "forbidden"', roleFail.status === 500 && roleFail.json.code === 'ROLE_LOOKUP_FAILED' && /Could not verify your role/.test(roleFail.json.error));
    eq('missing date is a 400', (await makeHandler({}).call({})).status, 400);
    eq('missing bearer token is a 401', (await makeHandler({}).call({ date: D }, '')).status, 401);
  }
  // 8. what the owner would SEE for the hosted failures that cannot be reproduced here (this is the text P0-C needs).
  {
    const denied = makeHandler({ tasks: { [D]: [stop('a', 1)] }, google: () => ({ ok: true, body: { status: 'REQUEST_DENIED', error_message: 'API key restricted', rows: [] } }) });
    const r = await denied.call({ date: D });
    ok('a denied Google key shows the status AND Google\'s own explanation, and exposes both as fields', r.status === 422 && /API status: REQUEST_DENIED, Element status: unknown/.test(r.json.error) && /Google says: API key restricted/.test(r.json.error) && r.json.providerStatus === 'REQUEST_DENIED' && r.json.providerMessage === 'API key restricted');
    const echo = await makeHandler({ tasks: { [D]: [stop('a', 1)] }, key: 'SECRETKEY123', google: () => ({ ok: true, body: { status: 'REQUEST_DENIED', error_message: 'The key SECRETKEY123 is invalid', rows: [] } }) }).call({ date: D });
    ok('the server key is never echoed back, even if the provider includes it', echo.status === 422 && !JSON.stringify(echo.json).includes('SECRETKEY123') && /\[key\] is invalid/.test(echo.json.error));
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
