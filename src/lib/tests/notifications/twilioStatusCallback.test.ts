// twilio-status-callback: the delivery-status update must name only columns that exist in sms_conversations.
//
// Defect (found by the database contract scanner): the function updated sms_conversations.error_code, a column that no migration ever created.
// Against the real schema that UPDATE fails with 42703, the function answered 500, and Twilio delivery statuses were never recorded. The
// handler tests passed because their fake database accepted any column name.
//
// Layers:
//   HANDLER   the real function source runs with a capturing fake client; the exact update it sends is inspected (and checked against the column list)
//   EXECUTED  that exact update is run as SQL against the real schema in a scratch PostgreSQL database (inside a transaction that is rolled back,
//             synthetic rows only, no SMS is sent); the original shape (with error_code) is shown to fail with 42703
// PASS - LOCAL INTEGRATION when a scratch database is reachable; the EXECUTED layer reports SKIPPED when none is.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; exit: (code: number) => never };
const fs = require('fs');
const ts = require('typescript');
const { spawnSync } = require('child_process');

import * as twilioSig from '../../../../supabase/functions/_shared/twilio-signature';
import { SMS_CONVERSATIONS_COLUMNS, unknownColumns } from '../support/schemaColumns';

let passed = 0;
let failed = 0;
let skipped = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}

const SUPA = 'https://fake.supabase.co';
const TOKEN = 'twilio-token-for-tests';
const URL = `${SUPA}/functions/v1/twilio-status-callback`;

interface Captured { writes: Array<{ table: string; op: string; payload: any; filters: Array<[string, unknown]> }>; logs: string[] }

function loadHandler(world: Captured): (req: Request) => Promise<Response> {
  const src: string = fs.readFileSync('supabase/functions/twilio-status-callback/index.ts', 'utf8');
  const js: string = ts.transpileModule(src.replace(/^import[^;]*;/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  let captured: any = null;
  const env: Record<string, string> = { SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'svc-key-0123456789abcdef' };
  const client = {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let op = 'select';
      let payload: any = null;
      const api: any = {
        select: () => api,
        update: (p: any) => { op = 'update'; payload = p; return api; },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
        maybeSingle: async () => ({ data: table === 'admin_settings' ? { value: TOKEN } : null, error: null }),
        then: (resolve: any, reject: any) => {
          world.writes.push({ table, op, payload, filters });
          const bad = unknownColumns(table, payload);
          const error = bad.length ? { code: '42703', message: `column "${bad[0]}" of relation "${table}" does not exist` } : null;
          return Promise.resolve({ error }).then(resolve, reject);
        },
      };
      return api;
    },
  };
  const log = (...a: unknown[]) => world.logs.push(a.map(String).join(' '));
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => env[k] }, serve: (h: any) => { captured = h; } },
    createClient: () => client,
    console: { log, info: log, debug: log, warn: log, error: log },
    formParams: twilioSig.formParams,
    twilioCandidateUrls: twilioSig.twilioCandidateUrls,
    verifyTwilioRequest: twilioSig.verifyTwilioRequest,
  };
  const names = Object.keys(scope);
  new Function(...names, js)(...names.map((n) => scope[n]));
  if (!captured) throw new Error('Deno.serve not called');
  return captured;
}

async function callWith(params: Record<string, string>) {
  const world: Captured = { writes: [], logs: [] };
  const handler = loadHandler(world);
  const res = await handler(new Request(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': await twilioSig.computeTwilioSignature(URL, params, TOKEN) },
    body: new URLSearchParams(params).toString(),
  }));
  return { res, world, updates: world.writes.filter((w) => w.table === 'sms_conversations' && w.op === 'update') };
}

const lit = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

async function main() {
  // ---- HANDLER layer ----
  const delivered = await callWith({ MessageSid: 'SMT1', MessageStatus: 'delivered' });
  ok('a delivered status answers 200 and writes exactly one update to sms_conversations', delivered.res.status === 200 && delivered.updates.length === 1 && delivered.world.writes.length === 1);
  ok('...naming only the status column (an unknown column would be refused by the database)', Object.keys(delivered.updates[0].payload).join() === 'status' && delivered.updates[0].payload.status === 'delivered');
  ok('...for the matching message only (twilio_message_sid)', JSON.stringify(delivered.updates[0].filters) === JSON.stringify([['twilio_message_sid', 'SMT1']]));
  ok('...and logs nothing about an error code when there is none', !delivered.world.logs.some((l) => /ErrorCode/.test(l)));

  for (const [status, code] of [['failed', '30003'], ['undelivered', '30005'], ['failed', '30008']] as const) {
    const r = await callWith({ MessageSid: 'SMT2', MessageStatus: status, ErrorCode: code });
    ok(`a ${status} status with Twilio ErrorCode ${code} answers 200 (it must not 500)`, r.res.status === 200);
    ok(`...stores the status only (${status}) and no other column`, r.updates.length === 1 && Object.keys(r.updates[0].payload).join() === 'status' && r.updates[0].payload.status === status);
    ok(`...and keeps the code in the function log (message and code)`, r.world.logs.some((l) => l.includes('SMT2') && l.includes(code) && l.includes(status)));
    ok(`...without writing an error_code column`, !('error_code' in r.updates[0].payload));
  }
  const missing = await callWith({ MessageSid: '', MessageStatus: 'delivered' });
  ok('a callback without a MessageSid is a 400 and writes nothing', missing.res.status === 400 && missing.world.writes.length === 0);

  ok('every column the function writes is in the schema column list', unknownColumns('sms_conversations', delivered.updates[0].payload).length === 0);
  ok('the list itself knows the columns send-sms-notification and twilio-webhook store', ['order_id', 'from_phone', 'to_phone', 'message_body', 'direction', 'twilio_message_sid', 'status'].every((c) => (SMS_CONVERSATIONS_COLUMNS as readonly string[]).includes(c)));
  ok('the original shape (status + error_code) is flagged by the check', unknownColumns('sms_conversations', { status: 'failed', error_code: '30003' }).join() === 'error_code');

  // ---- EXECUTED layer ----
  const port = process.env.CORE_DB_PORT || '54339';
  const host = process.env.CORE_DB_HOST || '127.0.0.1';
  const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
  let psql: string | null = null;
  let db = '';
  for (const name of [...new Set([process.env.CORE_DB_NAME, 'bpc_replay_full', 'bpc_replay_oct18'].filter(Boolean) as string[])]) {
    for (const c of candidates) {
      const probe = spawnSync(c, ['-h', host, '-p', port, '-U', 'postgres', '-d', name, '-X', '-q', '-w', '-Atc', "SELECT to_regclass('public.sms_conversations') IS NOT NULL"], { encoding: 'utf8', timeout: 15000 });
      if (probe.status === 0 && probe.stdout.trim() === 't') { psql = c; db = name; break; }
    }
    if (psql) break;
  }
  if (!psql) {
    if (process.env.CORE_DB_REQUIRE) ok('executed: a scratch database with sms_conversations is available (CORE_DB_REQUIRE is set)', false);
    else { skipped++; console.log('EXECUTED layer SKIPPED: no scratch PostgreSQL database with sms_conversations was reachable.'); }
  } else {
    const run = (sql: string) => {
      const r = spawnSync(psql as string, ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-X', '-q', '-w', '-At', '-v', 'VERBOSITY=terse'], { input: sql, encoding: 'utf8', timeout: 60000 });
      return { out: (r.stdout ?? '') + (r.stderr ?? ''), status: r.status };
    };
    // the column list is kept honest against the live catalog
    const cols = run("SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_conversations';").out.trim();
    ok(`executed [${db}]: the schema column list equals the live sms_conversations columns`, cols === (SMS_CONVERSATIONS_COLUMNS as readonly string[]).join(','));
    ok(`executed [${db}]: sms_conversations has no error_code column (storing the code would need a migration - owner decision)`, !cols.split(',').includes('error_code'));

    const updateSql = (payload: Record<string, unknown>) => `UPDATE public.sms_conversations SET ${Object.entries(payload).map(([k, v]) => `"${k}" = ${lit(v)}`).join(', ')} WHERE twilio_message_sid = 'SMTX';`;
    const seed = `INSERT INTO public.sms_conversations (from_phone, to_phone, message_body, direction, twilio_message_sid, status) VALUES ('+15550000001', '+15550000002', 'synthetic', 'outbound', 'SMTX', 'queued');`;
    const probe = (payload: Record<string, unknown>) => run(`BEGIN;\n${seed}\n${updateSql(payload)}\nSELECT 'R|' || status FROM public.sms_conversations WHERE twilio_message_sid = 'SMTX';\nROLLBACK;`);

    const good = probe(delivered.updates[0].payload);
    ok(`executed: the exact update the function sends runs on the real schema and stores the status`, /R\|delivered/.test(good.out) && !/ERROR/.test(good.out));
    const failedRun = await callWith({ MessageSid: 'SMTX', MessageStatus: 'failed', ErrorCode: '30003' });
    const failedSql = probe(failedRun.updates[0].payload);
    ok('executed: a failed delivery with an ErrorCode also runs and stores status "failed"', /R\|failed/.test(failedSql.out) && !/ERROR/.test(failedSql.out));
    const original = probe({ status: 'failed', error_code: '30003' });
    ok('executed: the ORIGINAL shape (status + error_code) is refused by the real schema with 42703 / column does not exist', /does not exist/.test(original.out) && !/R\|/.test(original.out));
    const unrelated = run(`BEGIN;\n${seed}\nINSERT INTO public.sms_conversations (from_phone, to_phone, message_body, direction, twilio_message_sid, status) VALUES ('+15550000003', '+15550000004', 'other', 'outbound', 'SMTY', 'queued');\n${updateSql(delivered.updates[0].payload)}\nSELECT 'R|' || count(*) FILTER (WHERE status = 'queued') || ':' || count(*) FILTER (WHERE status = 'delivered') FROM public.sms_conversations WHERE twilio_message_sid IN ('SMTX', 'SMTY');\nROLLBACK;`);
    ok('executed: only the matching message changes (the other message keeps its status)', /R\|1:1/.test(unrelated.out));
    const left = run("SELECT count(*) FROM public.sms_conversations WHERE twilio_message_sid IN ('SMTX', 'SMTY');").out.trim();
    ok('executed: the synthetic rows were rolled back', left === '0');
  }

  // ---- sender side: the status the callback updates is the one send-sms-notification stores ----
  const sender = fs.readFileSync('supabase/functions/send-sms-notification/index.ts', 'utf8');
  ok('send-sms-notification stores twilio_message_sid and status in sms_conversations (the callback matches on the sid and updates the status)', /twilio_message_sid: data \? data\.sid : null/.test(sender) && /status: data \? data\.status : null/.test(sender));
  const fn = fs.readFileSync('supabase/functions/twilio-status-callback/index.ts', 'utf8');
  ok('the function source no longer names error_code in a write', !/error_code\s*:/.test(fn));

  console.log(`twilioStatusCallback: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
  if (failed > 0) throw new Error(`${failed} twilio status callback test(s) failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
