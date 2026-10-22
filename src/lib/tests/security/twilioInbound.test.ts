// NI-09 (B14): the inbound SMS webhook against a mocked database (no Twilio, no Supabase contact; signature checking is covered in
// edgeFunctionHardening.test.ts, so it is stubbed to "valid" here and only the message handling is exercised).
// PASS - LOCAL MOCKED. Real Twilio traffic and the console opt-out settings are REQUIRES HOSTED DEV VERIFICATION (K-13 area; owner reads the Twilio console).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');
import * as inbound from '../../../../supabase/functions/_shared/sms/inbound';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
function eq(label: string, got: unknown, want: unknown) {
  ok(`${label} (got ${JSON.stringify(got)}, expected ${JSON.stringify(want)})`, JSON.stringify(got) === JSON.stringify(want));
}

// ---- pure rules --------------------------------------------------------------------------------------------------------------
eq('digits10 of common formats', ['(313) 889-3860', '313-889-3860', '+1 313 889 3860', '13138893860', '3138893860'].map(inbound.digits10), Array(5).fill('3138893860'));
eq('digits10 of junk', [inbound.digits10('12345'), inbound.digits10(null), inbound.digits10('')], ['', '', '']);
eq('like pattern', inbound.phoneLikePattern('3138893860'), '%313%889%3860%');
eq('like pattern needs ten digits', inbound.phoneLikePattern('313'), '');
ok('samePhone ignores formatting and country code', inbound.samePhone('(313) 889-3860', '+13138893860') && !inbound.samePhone('(313) 889-3860', '(313) 889-3861') && !inbound.samePhone('', ''));
for (const w of ['STOP', 'stop', ' Stop. ', 'STOPALL', 'UNSUBSCRIBE', 'Cancel', 'END', 'quit']) eq(`"${w}" is an opt-out`, inbound.classifyInbound(w), 'stop');
for (const w of ['START', 'yes', 'UNSTOP']) eq(`"${w}" is a resubscribe`, inbound.classifyInbound(w), 'start');
for (const w of ['HELP', 'info']) eq(`"${w}" is help`, inbound.classifyInbound(w), 'help');
for (const w of ["Please don't cancel my party", 'stop by at 5', 'Hello', '', 'STOP PLEASE']) eq(`"${w}" is an ordinary message`, inbound.classifyInbound(w), 'message');
ok('twiml escapes the message and the empty reply has no Message', /<Message>a &amp; b &lt;c&gt;<\/Message>/.test(inbound.twiml('a & b <c>')) && !/<Message>/.test(inbound.twiml()));

// ---- mocked database + the real handler ------------------------------------------------------------------------------------------
type Row = Record<string, any>;
function likeToRegex(pattern: string): RegExp {
  return new RegExp('^' + pattern.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
}
function makeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { customers: [], orders: [], sms_conversations: [], admin_settings: [], ...JSON.parse(JSON.stringify(seed)) };
  const writes: Array<{ table: string; op: string; payload: any; filters: Array<[string, string, any]> }> = [];
  let insertError: any = null;
  const client = {
    from(table: string) {
      const filters: Array<[string, string, any]> = [];
      let mode: 'select' | 'insert' | 'update' = 'select';
      let payload: any;
      let orderCol: string | null = null;
      let desc = false;
      let limitN: number | null = null;
      const rows = () => {
        let r = (tables[table] ?? []).filter((row) => filters.every(([op, c, v]) => (op === 'eq' ? row[c] === v : op === 'in' ? (v as any[]).includes(row[c]) : op === 'ilike' ? likeToRegex(v).test(String(row[c] ?? '')) : true)));
        if (orderCol) r = [...r].sort((a, b) => (String(a[orderCol!]) < String(b[orderCol!]) ? -1 : 1) * (desc ? -1 : 1));
        return limitN !== null ? r.slice(0, limitN) : r;
      };
      const api: any = {
        select: () => api,
        eq: (c: string, v: any) => (filters.push(['eq', c, v]), api),
        in: (c: string, v: any[]) => (filters.push(['in', c, v]), api),
        ilike: (c: string, v: string) => (filters.push(['ilike', c, v]), api),
        order: (c: string, o?: { ascending?: boolean }) => ((orderCol = c), (desc = o?.ascending === false), api),
        limit: (n: number) => ((limitN = n), api),
        insert: (p: any) => ((mode = 'insert'), (payload = p), api),
        update: (p: any) => ((mode = 'update'), (payload = p), api),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then(resolve: any, reject: any) {
          if (mode === 'insert') {
            writes.push({ table, op: 'insert', payload, filters: [...filters] });
            if (insertError) return Promise.resolve({ error: insertError }).then(resolve, reject);
            (tables[table] ??= []).push({ id: `${table}-${(tables[table]?.length ?? 0) + 1}`, ...payload });
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          if (mode === 'update') {
            writes.push({ table, op: 'update', payload, filters: [...filters] });
            for (const r of rows()) Object.assign(r, payload);
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: rows().map((r) => ({ ...r })), error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
  return { client, tables, writes, failNextInsertWith: (e: any) => { insertError = e; } };
}

const SRC: string = fs.readFileSync('supabase/functions/twilio-webhook/index.ts', 'utf8');
const JS: string = ts.transpileModule(SRC.replace(/^import[^;]*;/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
function loadHandler(client: any): (req: Request) => Promise<Response> {
  let captured: any = null;
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' } as any)[k] }, serve: (h: any) => { captured = h; } },
    createClient: () => client,
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    formParams: () => ({}),
    twilioCandidateUrls: () => [],
    verifyTwilioRequest: async () => ({ ok: true }),
    ...inbound,
  };
  const names = Object.keys(scope);
  new Function(...names, JS)(...names.map((n) => scope[n]));
  return captured;
}
async function receive(db: ReturnType<typeof makeDb>, params: Record<string, string>) {
  const handler = loadHandler(db.client);
  const res = await handler(new Request('https://x.supabase.co/functions/v1/twilio-webhook', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() }));
  return { status: res.status, text: await res.text() };
}
const msg = (over: Record<string, string> = {}) => ({ MessageSid: 'SM100', From: '+13138893860', To: '+15559990000', Body: 'Is the castle coming at 9?', SmsStatus: 'received', ...over });
const seed = () => ({
  customers: [
    { id: 'c-formatted', phone: '(313) 889-3860' },
    { id: 'c-dashes', phone: '555-123-0001' },
    { id: 'c-other', phone: '(313) 889-9999' },
  ],
  orders: [
    { id: 'o-old', customer_id: 'c-formatted', status: 'completed', created_at: '2026-01-01', sms_consent: true },
    { id: 'o-live', customer_id: 'c-formatted', status: 'confirmed', created_at: '2026-10-01', sms_consent: true },
    { id: 'o-draft-other', customer_id: 'c-other', status: 'draft', created_at: '2026-10-02', sms_consent: true },
  ],
});

async function main() {
  // matching a formatted stored phone (the defect: ILIKE '%3138893860%' cannot match "(313) 889-3860")
  {
    const db = makeDb(seed());
    const r = await receive(db, msg());
    const inboundRow = db.tables.sms_conversations.find((x) => x.direction === 'inbound');
    ok('a number stored as "(313) 889-3860" matches an inbound from +13138893860 (and takes the live order, not the old one)', r.status === 200 && inboundRow?.order_id === 'o-live');
    ok('the stored inbound row keeps the real MessageSid and the original numbers', inboundRow?.twilio_message_sid === 'SM100' && inboundRow?.from_phone === '+13138893860' && inboundRow?.to_phone === '+15559990000');
    ok('an ordinary message is answered with the auto-reply in the response', /<Message>Thank you for your message/.test(r.text));
    ok('NO outbound row is invented for the auto-reply (it used to be written with no SID)', db.tables.sms_conversations.filter((x) => x.direction === 'outbound').length === 0 && db.writes.filter((w) => w.table === 'sms_conversations' && w.op === 'insert').length === 1);
  }
  {
    const db = makeDb(seed());
    await receive(db, msg({ From: '5551230001' }));
    ok('a number stored with dashes matches a bare ten-digit sender (no live order for that customer: stored without an order)', db.tables.sms_conversations[0]?.order_id === null || db.tables.sms_conversations[0]?.order_id === undefined);
  }
  {
    const db = makeDb(seed());
    await receive(db, msg({ From: '+13138899999' }));
    ok('a different customer\'s number never takes this customer\'s order', db.tables.sms_conversations[0]?.order_id === 'o-draft-other');
  }
  {
    const db = makeDb(seed());
    await receive(db, msg({ From: '+13130000000' }));
    ok('an unknown sender is stored with no order', db.tables.sms_conversations[0]?.order_id === null);
  }
  // conversation continuity: an earlier outbound to this number on a given order
  {
    const s = seed();
    (s as any).sms_conversations = [{ id: 'prev', order_id: 'o-old', direction: 'outbound', from_phone: '+15559990000', to_phone: '(313) 889-3860', created_at: '2026-10-05' }];
    const db = makeDb(s);
    await receive(db, msg());
    ok('a reply continues the conversation of the last outbound message to that number (formatted number matched)', db.tables.sms_conversations.find((x) => x.direction === 'inbound')?.order_id === 'o-old');
  }
  // dedupe
  {
    const db = makeDb(seed());
    await receive(db, msg());
    const second = await receive(db, msg());
    ok('Twilio redelivering the same MessageSid is stored once and not answered twice', db.tables.sms_conversations.filter((x) => x.twilio_message_sid === 'SM100').length === 1 && second.status === 200 && !/<Message>/.test(second.text));
  }
  {
    const db = makeDb(seed());
    db.failNextInsertWith({ code: '23505', message: 'duplicate key' });
    const r = await receive(db, msg({ MessageSid: 'SM777' }));
    ok('a concurrent duplicate (unique violation) is treated as already handled, not an error', r.status === 200 && !/<Message>/.test(r.text));
  }
  // STOP
  {
    const db = makeDb(seed());
    const r = await receive(db, msg({ Body: 'STOP' }));
    ok('STOP records the opt-out on every order of the matched customer only', db.tables.orders.filter((o) => o.customer_id === 'c-formatted').every((o) => o.sms_consent === false) && db.tables.orders.find((o) => o.id === 'o-draft-other')?.sms_consent === true);
    ok('STOP gets no auto-reply from us (the carrier confirmation is Twilio\'s) and the message is stored', !/<Message>/.test(r.text) && db.tables.sms_conversations.some((x) => x.message_body === 'STOP' && x.direction === 'inbound'));
  }
  {
    const db = makeDb(seed());
    await receive(db, msg({ Body: 'please do not cancel my order' }));
    ok('a sentence containing a keyword does not opt anyone out', db.tables.orders.every((o) => o.sms_consent === true));
  }
  {
    const db = makeDb(seed());
    await receive(db, msg({ Body: 'STOP', From: '+13130000000' }));
    ok('STOP from an unknown number changes no order', db.tables.orders.every((o) => o.sms_consent === true) && !db.writes.some((w) => w.table === 'orders'));
  }
  // HELP and START
  {
    const db = makeDb(seed());
    const r = await receive(db, msg({ Body: 'HELP' }));
    ok('HELP is answered with contact details and the STOP instruction', /\(313\) 889-3860/.test(r.text) && /STOP/.test(r.text));
    const s = await receive(db, msg({ MessageSid: 'SM101', Body: 'START' }));
    ok('START changes no consent by itself and is not auto-replied', !/<Message>/.test(s.text) && db.tables.orders.every((o) => o.sms_consent === true));
  }
  // incomplete request
  {
    const db = makeDb(seed());
    const r = await receive(db, { MessageSid: 'SM1', From: '+13138893860', To: '+15559990000' });
    ok('a request with no Body is ignored with an empty response', r.status === 200 && !/<Message>/.test(r.text) && db.writes.length === 0);
  }
  ok('the function source no longer writes an outbound auto-reply row', !/direction: "outbound"/.test(SRC) && !/twilio_message_sid: null/.test(SRC));
  ok('the function matches on digits, not ILIKE %digits%', /phoneLikePattern\(from10\)/.test(SRC) && !/ilike\("phone", `%\$\{normalizedFrom\}%`\)/.test(SRC));

  console.log(`twilioInbound: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} inbound SMS test(s) failed`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
