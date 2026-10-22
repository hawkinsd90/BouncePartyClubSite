// Secure customer portal link tests: canonical order-bound portal links.
//
// Nothing here touches a network or a database. Edge Function source is loaded as text, its imports are stripped, and it
// is run with in-memory fakes plus the REAL shared helpers (_shared/auth.ts, _shared/portal-link.ts). The migration is
// checked statically. The in-memory invoice_links fake models only the database rules the portal links rely on (unique
// short_code and link_token, the partial unique index of one active portal link per order, sticky revocation that
// implies expiry); those rules are asserted against the migration text separately.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');

import * as authHelpers from '../../../../supabase/functions/_shared/auth';
import * as pl from '../../../../supabase/functions/_shared/portal-link';
import * as tokenLib from '../../portal/portalToken';
import * as siteOriginHelpers from '../../../../supabase/functions/_shared/siteOrigin';
import * as returnOriginHelpers from '../../../../supabase/functions/_shared/booking/returnOrigin';

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
const NOW = new Date('2026-10-09T12:00:00Z');
const FUTURE = '2027-01-01T00:00:00Z';
const PAST = '2026-01-01T00:00:00Z';
const MIGRATION = 'supabase/migrations/20261009120000_secure_customer_portal_links.sql';

// ---------------------------------------------------------------------------------------------------------------
// In-memory database
// ---------------------------------------------------------------------------------------------------------------
type Row = Record<string, any>;
interface Db {
  tables: Record<string, Row[]>;
  inserts: Array<{ table: string; row: Row }>;
  updates: Array<{ table: string; payload: Row; filters: Array<[string, string, unknown]> }>;
  failInsertWith?: { code: string } | null;
  seq: number;
}

function newDb(): Db {
  return {
    tables: {
      orders: [
        { id: 'order-A', status: 'confirmed', event_date: '2026-11-10', event_end_date: null, customer_id: 'cust-A', customers: { first_name: 'Ann', email: 'ann@example.test', phone: '+15555550101' } },
        { id: 'order-B', status: 'confirmed', event_date: '2026-11-12', event_end_date: '2026-11-13', customer_id: 'cust-B', customers: { first_name: 'Bo', email: 'bo@example.test', phone: '+15555550102' } },
        { id: 'order-draft', status: 'draft', event_date: '2026-11-12', event_end_date: null, customer_id: 'cust-A', customers: { first_name: 'Ann', email: 'ann@example.test', phone: '+15555550101' } },
        { id: 'order-nodate', status: 'confirmed', event_date: null, event_end_date: null, customer_id: 'cust-A', customers: null },
      ],
      customers: [{ id: 'cust-A', user_id: 'u-cust-A' }, { id: 'cust-B', user_id: 'u-cust-B' }],
      user_roles: [
        { user_id: 'u-admin', role: 'admin' },
        { user_id: 'u-master', role: 'master' },
        { user_id: 'u-crew', role: 'crew' },
        { user_id: 'u-cust-A', role: 'customer' },
        { user_id: 'u-cust-B', role: 'customer' },
        { user_id: 'u-norole', role: 'x' },
      ],
      invoice_links: [],
      admin_settings: [{ key: 'stripe_secret_key', value: 'sk_test_x' }],
    },
    inserts: [],
    updates: [],
    seq: 0,
  };
}

const matches = (row: Row, filters: Array<[string, string, unknown]>) =>
  filters.every(([op, col, val]) => (op === 'eq' ? row[col] === val : op === 'is' ? (row[col] ?? null) === val : false));

// Mirrors the database rules in the portal links migration for invoice_links.
function violatesUnique(db: Db, row: Row, ignore?: Row): boolean {
  return db.tables.invoice_links.some((r) => {
    if (r === ignore) return false;
    if (r.link_token === row.link_token) return true;
    if (row.short_code && r.short_code === row.short_code) return true;
    if (row.link_type === 'portal' && !row.revoked_at && r.link_type === 'portal' && !r.revoked_at && r.order_id === row.order_id) return true;
    return false;
  });
}
function enforceRevocation(prev: Row | null, next: Row) {
  if (prev?.revoked_at) next.revoked_at = prev.revoked_at;
  if (next.revoked_at && (!next.expires_at || new Date(next.expires_at) > new Date(next.revoked_at))) next.expires_at = next.revoked_at;
}

function makeClient(db: Db, users: Record<string, string> = {}) {
  const client: any = {
    auth: {
      getUser: async (token: string) => {
        const id = users[token];
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
      },
    },
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let mode: 'select' | 'update' | 'insert' = 'select';
      let payload: Row = {};
      let afterInsertSelect = false;
      const rows = () => (db.tables[table] ?? []).filter((r) => matches(r, filters));
      const q: any = {
        select() {
          if (mode === 'insert') afterInsertSelect = true;
          return q;
        },
        eq(col: string, val: unknown) {
          filters.push(['eq', col, val]);
          return q;
        },
        is(col: string, val: unknown) {
          filters.push(['is', col, val]);
          return q;
        },
        update(p: Row) {
          mode = 'update';
          payload = p;
          return q;
        },
        insert(p: Row) {
          mode = 'insert';
          payload = p;
          return q;
        },
        async maybeSingle() {
          if (mode === 'insert') {
            db.inserts.push({ table, row: payload });
            if (db.failInsertWith) return { data: null, error: { ...db.failInsertWith, message: 'insert failed' } };
            const row: Row = { id: `row-${++db.seq}`, created_at: NOW.toISOString(), revoked_at: null, short_code: null, ...payload };
            if (table === 'invoice_links') {
              enforceRevocation(null, row);
              if (violatesUnique(db, row)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
            db.tables[table].push(row);
            return { data: afterInsertSelect ? row : null, error: null };
          }
          const found = rows();
          if (found.length > 1) return { data: null, error: { message: 'multiple rows' } };
          return { data: found[0] ?? null, error: null };
        },
        then(resolve: any, reject: any) {
          let result: any;
          if (mode === 'update') {
            db.updates.push({ table, payload, filters: [...filters] });
            for (const r of rows()) {
              const next = { ...r, ...payload };
              if (table === 'invoice_links') enforceRevocation(r, next);
              Object.assign(r, next);
            }
            result = { error: null };
          } else {
            result = { data: rows(), error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return client;
}

function link(over: Row): Row {
  return { id: `l-${Math.random().toString(36).slice(2, 8)}`, order_id: 'order-A', link_type: 'portal', link_token: 'T'.repeat(64), short_code: 'abcDEF234567', expires_at: FUTURE, revoked_at: null, ...over };
}
const tok = (c: string) => c.repeat(64);

// Deterministic randomness: a queue of byte arrays (falls back to a counter-based stream).
function seededRandom(seed = 1) {
  let n = seed;
  return (length: number) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      n = (n * 1103515245 + 12345) & 0x7fffffff;
      out[i] = (n >> 8) & 0xff;
    }
    return out;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Edge Function harness
// ---------------------------------------------------------------------------------------------------------------
interface Harness {
  db: Db;
  logs: string[];
  fetches: Array<{ url: string; init: any }>;
  rateCalls: Array<{ endpoint: string; id: string; cfg?: any }>;
  stripeSessions: Record<string, any>;
}
function load(fnDir: string, h: Harness, over: Record<string, unknown> = {}, rate: { allowed: boolean; only?: string } = { allowed: true }, users: Record<string, string> = {}): (req: Request) => Promise<Response> {
  const src: string = fs.readFileSync(`supabase/functions/${fnDir}/index.ts`, 'utf8');
  const js: string = ts.transpileModule(src.replace(/^import[^;]*;/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  let captured: any = null;
  const env: Record<string, string> = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
  class FakeStripe {
    checkout = { sessions: { retrieve: async (id: string) => { if (!h.stripeSessions[id]) throw new Error('no such session'); return h.stripeSessions[id]; } } };
  }
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => env[k] }, serve: (fn: any) => { captured = fn; } },
    createClient: () => makeClient(h.db, users),
    Stripe: FakeStripe,
    console: {
      log: (...a: unknown[]) => h.logs.push(a.map(String).join(' ')),
      info: (...a: unknown[]) => h.logs.push(a.map(String).join(' ')),
      debug: () => {},
      warn: (...a: unknown[]) => h.logs.push(a.map(String).join(' ')),
      error: (...a: unknown[]) => h.logs.push(a.map(String).join(' ')),
    },
    fetch: async (url: string, init: any) => {
      h.fetches.push({ url, init });
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    },
    ...authHelpers,
    ...pl,
    // The shared site-origin helpers, bound to the harness environment (a stand-in for Deno.env).
    getSiteOrigin: () => siteOriginHelpers.getSiteOrigin({ get: (k: string) => env[k] }),
    configuredOrigins: () => siteOriginHelpers.configuredOrigins({ get: (k: string) => env[k] }),
    resolveReturnOrigin: returnOriginHelpers.resolveReturnOrigin,
    checkRateLimit: async (endpoint: string, id: string, cfg?: any) => {
      h.rateCalls.push({ endpoint, id, cfg });
      const denied = !rate.allowed && (!rate.only || rate.only === endpoint);
      return denied ? { allowed: false, reason: 'rate_limit_exceeded', retry_after: 30 } : { allowed: true };
    },
    createRateLimitResponse: () => new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), { status: 429, headers: { 'Content-Type': 'application/json' } }),
    getIdentifier: () => '203.0.113.9',
    ...over,
  };
  const imported = new Set<string>();
  for (const m of src.matchAll(/^import([^;]*);/gm)) {
    for (const id of m[1].replace(/from\s+['"][^'"]*['"]/, '').match(/[A-Za-z_$][\w$]*/g) ?? []) imported.add(id);
  }
  const names = Object.keys(scope).filter((n) => ['Deno', 'console', 'fetch'].includes(n) || imported.has(n));
  new Function(...names, js)(...names.map((n) => scope[n]));
  if (!captured) throw new Error(`${fnDir}: Deno.serve was not called`);
  return captured;
}
const harness = (db = newDb()): Harness => ({ db, logs: [], fetches: [], rateCalls: [], stripeSessions: {} });
const USERS = { 'jwt-admin': 'u-admin', 'jwt-master': 'u-master', 'jwt-crew': 'u-crew', 'jwt-cust-A': 'u-cust-A', 'jwt-cust-B': 'u-cust-B', 'jwt-norole': 'u-norole' };

async function call(handler: (r: Request) => Promise<Response>, bearer: string | null, body: unknown, method = 'POST') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await handler(new Request('https://fake.functions/x', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined }));
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

(async () => {
  // =============================================================================================================
  // TOKEN / SHORT-CODE GENERATION (shape and source, not statistics)
  // =============================================================================================================
  const rnd = seededRandom(7);
  const token = pl.generatePortalToken(rnd);
  ok('token: 64 lowercase hex characters (32 bytes)', /^[0-9a-f]{64}$/.test(token));
  ok('token: not derived from an order id, email, phone or short code', !/order|@|\+1/.test(token));
  ok('token: two consecutive tokens differ', pl.generatePortalToken(rnd) !== pl.generatePortalToken(rnd));
  ok('token: the default generator uses crypto.getRandomValues (no Math.random)', /crypto\.getRandomValues/.test(fs.readFileSync('supabase/functions/_shared/portal-link.ts', 'utf8')) && !/Math\.random/.test(fs.readFileSync('supabase/functions/_shared/portal-link.ts', 'utf8')));
  const code = pl.generateShortCode(rnd);
  eq('short code: 12 characters', code.length, 12);
  ok('short code: only the unambiguous alphabet', [...code].every((c) => pl.SHORT_CODE_ALPHABET.includes(c)));
  ok('short code: alphabet has no 0 O o 1 l I', !/[0Oo1lI]/.test(pl.SHORT_CODE_ALPHABET));
  eq('short code: alphabet size gives at least ~69 bits over 12 characters', Math.floor(Math.log2(pl.SHORT_CODE_ALPHABET.length) * 12) >= 69, true);
  ok('short code: bytes at or above the rejection limit are skipped (no modulo bias)', (() => {
    const n = pl.SHORT_CODE_ALPHABET.length;
    const limit = Math.floor(256 / n) * n;
    const stream = [limit, 255, ...Array(40).fill(0)];
    return pl.generateShortCode(() => Uint8Array.from(stream)) === pl.SHORT_CODE_ALPHABET[0].repeat(12);
  })());
  ok('short code: shape check accepts new 12-char and legacy 8-char codes only', pl.isPlausibleShortCode('abcDEF234567') && pl.isPlausibleShortCode('a1b2c3d4') && !pl.isPlausibleShortCode('short') && !pl.isPlausibleShortCode('a'.repeat(40)) && !pl.isPlausibleShortCode('abc-DEF_2345') && !pl.isPlausibleShortCode(null));

  // Expiry rule
  eq('expiry: event end date + 60 days (through the whole 60th day)', pl.portalLinkExpiresAt({ event_end_date: '2026-11-13', event_date: '2026-11-12' }, NOW).toISOString(), '2027-01-13T00:00:00.000Z');
  eq('expiry: falls back to the event date', pl.portalLinkExpiresAt({ event_end_date: null, event_date: '2026-11-10' }, NOW).toISOString(), '2027-01-10T00:00:00.000Z');
  eq('expiry: with no date at all, issuance time + 60 days (never permanent)', pl.portalLinkExpiresAt({}, NOW).toISOString(), '2026-12-08T12:00:00.000Z');
  const sql: string = fs.readFileSync(MIGRATION, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
  ok('expiry: the SQL rule matches the helper (COALESCE(end, date) + 61 days, UTC midnight)', /COALESCE\(p_event_end_date, p_event_date\) \+ 61\)::timestamp AT TIME ZONE 'UTC'/.test(sql));

  // =============================================================================================================
  // getOrCreatePortalLink
  // =============================================================================================================
  {
    const db = newDb();
    const c = makeClient(db);
    const r1 = await pl.getOrCreatePortalLink(c, 'order-A', { now: NOW, random: seededRandom(1) });
    ok('create: a first link is minted for an order with no link', r1.ok && r1.created);
    const row = db.tables.invoice_links[0];
    ok('create: stored as link_type portal, bound to the order, with a 64-hex token and 12-char short code', row.link_type === 'portal' && row.order_id === 'order-A' && /^[0-9a-f]{64}$/.test(row.link_token) && row.short_code.length === 12);
    ok('create: expiry is the portal rule, never null', row.expires_at === '2027-01-10T00:00:00.000Z');
    ok('create: no deposit amount is attached', row.deposit_cents === 0);
    const r2 = await pl.getOrCreatePortalLink(c, 'order-A', { now: NOW, random: seededRandom(2) });
    ok('reuse: an active link is reused (same token, same short code, nothing new inserted)', r2.ok && !r2.created && r2.link.token === row.link_token && db.tables.invoice_links.length === 1);
    const other = await pl.getOrCreatePortalLink(c, 'order-B', { now: NOW, random: seededRandom(3) });
    ok('binding: a different order gets a different token bound to that order', other.ok && other.link.token !== row.link_token && db.tables.invoice_links.find((l) => l.order_id === 'order-B')?.link_token === (other.ok ? other.link.token : ''));
    eq('binding: end date drives order B expiry', other.ok ? other.link.expiresAt : '', '2027-01-13T00:00:00.000Z');
    eq('binding: still exactly one active portal link per order', db.tables.invoice_links.filter((l) => l.link_type === 'portal' && !l.revoked_at).map((l) => l.order_id).sort(), ['order-A', 'order-B']);
  }
  {
    const db = newDb();
    db.tables.invoice_links.push(link({ id: 'old', order_id: 'order-A', link_token: tok('a'), short_code: 'oldOLD234567', expires_at: PAST }));
    const r = await pl.getOrCreatePortalLink(makeClient(db), 'order-A', { now: NOW, random: seededRandom(4) });
    ok('expired: an expired portal link is retired (revoked) and replaced by a new one', r.ok && r.created && r.link.token !== tok('a'));
    ok('expired: the old row is revoked, not deleted', db.tables.invoice_links.find((l) => l.id === 'old')?.revoked_at === NOW.toISOString());
    eq('expired: exactly one active portal link remains', db.tables.invoice_links.filter((l) => l.link_type === 'portal' && !l.revoked_at).length, 1);
  }
  {
    const db = newDb();
    db.tables.invoice_links.push(link({ id: 'rev', order_id: 'order-A', link_token: tok('b'), short_code: 'revREV234567', revoked_at: PAST, expires_at: PAST }));
    const r = await pl.getOrCreatePortalLink(makeClient(db), 'order-A', { now: NOW, random: seededRandom(5) });
    ok('revoked: a revoked link is never reused; a fresh one is minted', r.ok && r.created && r.link.token !== tok('b') && r.link.shortCode !== 'revREV234567');
  }
  {
    // an admin invoice link and a legacy shortlink do not count as, and are not touched by, the portal link
    const db = newDb();
    db.tables.invoice_links.push(link({ id: 'inv', order_id: 'order-A', link_type: 'invoice', link_token: tok('c'), short_code: 'invINV234567' }));
    db.tables.invoice_links.push(link({ id: 'legacy', order_id: 'order-A', link_type: 'portal_shortlink', link_token: tok('d'), short_code: 'legacy11', expires_at: PAST }));
    const r = await pl.getOrCreatePortalLink(makeClient(db), 'order-A', { now: NOW, random: seededRandom(6) });
    ok('coexistence: a portal link is minted next to an invoice link without touching it', r.ok && r.created && db.tables.invoice_links.find((l) => l.id === 'inv')?.revoked_at === null && db.tables.invoice_links.find((l) => l.id === 'legacy')?.revoked_at === null);
  }
  {
    const db = newDb();
    const c = makeClient(db);
    const both = await Promise.all([pl.getOrCreatePortalLink(c, 'order-A', { now: NOW, random: seededRandom(8) }), pl.getOrCreatePortalLink(c, 'order-A', { now: NOW, random: seededRandom(9) })]);
    ok('concurrency: two simultaneous requests end with ONE active portal link for the order', db.tables.invoice_links.filter((l) => l.link_type === 'portal' && !l.revoked_at).length === 1 && both.every((x) => x.ok));
    ok('concurrency: both callers receive the same link', both[0].ok && both[1].ok && both[0].link.token === both[1].link.token);
  }
  {
    // short-code collision retry: the first generated codes already exist (in another order's link)
    const db = newDb();
    const fixed = pl.generateShortCode(seededRandom(11));
    db.tables.invoice_links.push(link({ id: 'x', order_id: 'order-B', link_token: tok('e'), short_code: fixed, link_type: 'invoice' }));
    let first = true;
    const random = (length: number) => {
      // first call -> token bytes, second -> colliding code bytes, then fresh randomness
      const base = seededRandom(11)(length);
      if (first && length === 64) {
        first = false;
        return base;
      }
      return seededRandom(99)(length);
    };
    const r = await pl.getOrCreatePortalLink(makeClient(db), 'order-A', { now: NOW, random: (n) => (n === pl.TOKEN_BYTES ? seededRandom(21)(n) : random(n)) });
    ok('collision: a colliding short code is retried until a unique one is stored', r.ok && r.link.shortCode.length === 12);
    ok('collision: unique short codes remain unique across all rows', new Set(db.tables.invoice_links.map((l) => l.short_code)).size === db.tables.invoice_links.length);
  }
  {
    const db = newDb();
    db.failInsertWith = { code: '23505' };
    const r = await pl.getOrCreatePortalLink(makeClient(db), 'order-A', { now: NOW, random: seededRandom(12) });
    ok('collision: persistent failure stops after a bounded number of attempts', !r.ok && r.error === 'link_failed' && db.inserts.length === 8);
  }
  ok('unknown order: no link is created', await (async () => {
    const db = newDb();
    const r = await pl.getOrCreatePortalLink(makeClient(db), 'order-missing', { now: NOW });
    return !r.ok && r.error === 'order_not_found' && db.tables.invoice_links.length === 0;
  })());
  ok('order with no dates still gets a bounded (60-day) link', await (async () => {
    const db = newDb();
    const r = await pl.getOrCreatePortalLink(makeClient(db), 'order-nodate', { now: NOW, random: seededRandom(13) });
    return r.ok && r.link.expiresAt === '2026-12-08T12:00:00.000Z';
  })());
  {
    const db = newDb();
    const url = await pl.buildPortalUrl(makeClient(db), 'order-A', 'https://bouncepartyclub.com/', { now: NOW, random: seededRandom(14) });
    ok('buildPortalUrl: returns the short URL /i/<12 chars>', /^https:\/\/bouncepartyclub\.com\/i\/[A-Za-z0-9]{12}$/.test(url ?? ''));
    ok('buildPortalUrl: the URL contains neither the order id nor the token', !!url && !url.includes('order-A') && !url.includes(db.tables.invoice_links[0].link_token));
    eq('buildPortalUrl: null (never a UUID URL) for an unknown order', await pl.buildPortalUrl(makeClient(newDb()), 'nope', 'https://x.test'), null);
  }

  // Revoke
  {
    const db = newDb();
    const c = makeClient(db);
    await pl.getOrCreatePortalLink(c, 'order-A', { now: NOW, random: seededRandom(15) });
    ok('revoke: explicit revocation retires the active portal link', await pl.revokePortalLinks(c, 'order-A', NOW));
    const row = db.tables.invoice_links[0];
    ok('revoke: revoked_at set and the link now reads as expired', row.revoked_at === NOW.toISOString() && new Date(row.expires_at).getTime() <= NOW.getTime());
    ok('revoke: a revoked row cannot be un-revoked (sticky)', (() => { Object.assign(row, { revoked_at: null }); enforceRevocation({ ...row, revoked_at: NOW.toISOString() }, row); return row.revoked_at === NOW.toISOString(); })());
  }

  // =============================================================================================================
  // Short-code resolution
  // =============================================================================================================
  {
    const db = newDb();
    db.tables.invoice_links.push(
      link({ order_id: 'order-A', link_token: tok('a'), short_code: 'AAAAaaaa2222', link_type: 'portal' }),
      link({ order_id: 'order-B', link_token: tok('b'), short_code: 'BBBBbbbb3333', link_type: 'portal' }),
      link({ order_id: 'order-A', link_token: tok('i'), short_code: 'a1b2c3d4', link_type: 'invoice' }),
      link({ order_id: 'order-A', link_token: tok('l'), short_code: 'legacy88', link_type: 'portal_shortlink' }),
      link({ order_id: 'order-A', link_token: tok('e'), short_code: 'EEEEeeee4444', expires_at: PAST }),
      link({ order_id: 'order-A', link_token: tok('r'), short_code: 'RRRRrrrr5555', revoked_at: PAST, expires_at: PAST }),
      link({ order_id: 'order-A', link_token: tok('r'), short_code: 'RRRRrrrr6666', revoked_at: NOW.toISOString(), expires_at: FUTURE }),
      link({ order_id: 'order-A', link_token: tok('x'), short_code: 'XXXXxxxx7777', link_type: 'mystery' }),
    );
    const c = makeClient(db);
    const A = await pl.resolveShortCode(c, 'AAAAaaaa2222', NOW);
    eq('resolve: order A code resolves to order A and its own token', A, { orderId: 'order-A', token: tok('a') });
    const B = await pl.resolveShortCode(c, 'BBBBbbbb3333', NOW);
    eq('resolve: order B code resolves to order B and its own token only', B, { orderId: 'order-B', token: tok('b') });
    ok('resolve: Order A short link never yields Order B or its token', A?.orderId === 'order-A' && A.token !== tok('b'));
    eq('resolve: a legacy 8-char invoice short code still resolves (with its token)', await pl.resolveShortCode(c, 'a1b2c3d4', NOW), { orderId: 'order-A', token: tok('i') });
    eq('resolve: a legacy portal_shortlink resolves to the order id only, with no token', await pl.resolveShortCode(c, 'legacy88', NOW), { orderId: 'order-A', token: null });
    eq('resolve: an expired code is not found', await pl.resolveShortCode(c, 'EEEEeeee4444', NOW), null);
    eq('resolve: a revoked code is not found', await pl.resolveShortCode(c, 'RRRRrrrr5555', NOW), null);
    eq('resolve: a revoked code is not found even if expires_at still looks valid', await pl.resolveShortCode(c, 'RRRRrrrr6666', NOW), null);
    eq('resolve: an unknown link type is not found', await pl.resolveShortCode(c, 'XXXXxxxx7777', NOW), null);
    eq('resolve: an unknown code is not found', await pl.resolveShortCode(c, 'ZZZZzzzz9999', NOW), null);
    eq('resolve: a malformed code never reaches the database', await pl.resolveShortCode({ from() { throw new Error('should not query'); } } as any, "x' or 1=1 --", NOW), null);
  }

  // =============================================================================================================
  // Token validation (the real _shared/auth.ts)
  // =============================================================================================================
  {
    const db = newDb();
    db.tables.invoice_links.push(
      link({ order_id: 'order-A', link_token: tok('a'), link_type: 'portal' }),
      link({ order_id: 'order-B', link_token: tok('b'), link_type: 'portal' }),
      link({ order_id: 'order-A', link_token: tok('i'), link_type: 'invoice' }),
      link({ order_id: 'order-A', link_token: tok('e'), link_type: 'portal', expires_at: PAST }),
      link({ order_id: 'order-A', link_token: tok('r'), link_type: 'portal', revoked_at: PAST }),
      link({ order_id: 'order-A', link_token: tok('s'), link_type: 'portal', revoked_at: NOW.toISOString(), expires_at: FUTURE }),
      link({ order_id: 'order-A', link_token: tok('l'), link_type: 'portal_shortlink' }),
      link({ order_id: 'order-A', link_token: tok('n'), link_type: 'portal', expires_at: null }),
    );
    const c = makeClient(db);
    const v = (order: string, t: string) => authHelpers.validateOrderToken(c, order, t, NOW);
    ok('validate: Order A portal token proves Order A', await v('order-A', tok('a')));
    ok('validate: Order A portal token does NOT prove Order B', !(await v('order-B', tok('a'))));
    ok('validate: Order B portal token does NOT prove Order A', !(await v('order-A', tok('b'))));
    ok('validate: an invoice token still proves its order', await v('order-A', tok('i')));
    ok('validate: an expired token is denied', !(await v('order-A', tok('e'))));
    ok('validate: a revoked token is denied', !(await v('order-A', tok('r'))));
    ok('validate: a revoked token is denied even when expires_at was left in the future', !(await v('order-A', tok('s'))));
    ok('validate: a legacy portal_shortlink token is never proof', !(await v('order-A', tok('l'))));
    ok('validate: a token with no expiry is denied', !(await v('order-A', tok('n'))));
    ok('validate: a token that does not exist is denied', !(await v('order-A', tok('z'))));
    ok('validate: a raw order id / short token is denied', !(await v('order-A', 'order-A')) && !(await v('order-A', 'short')));
    eq('validate: accepted proof link types are exactly portal and invoice (same list in both helpers)', [authHelpers.ORDER_PROOF_LINK_TYPES, pl.PROOF_LINK_TYPES], [['portal', 'invoice'], ['portal', 'invoice']]);
  }

  // =============================================================================================================
  // resolve-link Edge Function
  // =============================================================================================================
  {
    const h = harness();
    h.db.tables.invoice_links.push(
      link({ order_id: 'order-A', link_token: tok('a'), short_code: 'AAAAaaaa2222' }),
      link({ order_id: 'order-A', link_token: tok('e'), short_code: 'EEEEeeee4444', expires_at: PAST }),
      link({ order_id: 'order-A', link_token: tok('r'), short_code: 'RRRRrrrr5555', revoked_at: PAST, expires_at: PAST }),
      link({ order_id: 'order-A', link_token: tok('i'), short_code: 'a1b2c3d4', link_type: 'invoice' }),
    );
    const fn = load('resolve-link', h);
    let r = await call(fn, ANON_KEY, { code: 'AAAAaaaa2222' });
    eq('resolve-link: a valid code returns exactly {found, orderId, token}', [r.status, Object.keys(r.json).sort(), r.json.orderId, r.json.token], [200, ['found', 'orderId', 'token'], 'order-A', tok('a')]);
    ok('resolve-link: the response carries no customer, payment, expiry or link-list data', !/email|phone|expires|customer|payment|link_type|id"/i.test(r.text.replace('orderId', '')));
    r = await call(fn, ANON_KEY, { code: 'a1b2c3d4' });
    ok('resolve-link: an old 8-char invoice code still resolves', r.json?.found === true && r.json.token === tok('i'));
    const unknown = await call(fn, ANON_KEY, { code: 'ZZZZzzzz9999' });
    const expired = await call(fn, ANON_KEY, { code: 'EEEEeeee4444' });
    const revoked = await call(fn, ANON_KEY, { code: 'RRRRrrrr5555' });
    const malformed = await call(fn, ANON_KEY, { code: 'no way!' });
    const missing = await call(fn, ANON_KEY, {});
    ok('resolve-link: unknown, expired, revoked, malformed and missing codes are byte-identical (no probing signal)', [expired, revoked, malformed, missing].every((x) => x.text === unknown.text && x.status === unknown.status) && unknown.json.found === false);
    eq('resolve-link: the not-found body has no reason or detail', Object.keys(unknown.json), ['found']);
    ok('resolve-link: no Authorization header is needed or required', (await call(fn, null, { code: 'AAAAaaaa2222' })).json?.found === true);
    ok('resolve-link: GET is refused', (await call(fn, ANON_KEY, null, 'GET')).status === 405);
    ok('resolve-link: rate limiting is keyed by the caller IP and this endpoint, before any lookup', h.rateCalls.length > 0 && h.rateCalls.every((c) => c.endpoint === 'resolve-link' && c.id === '203.0.113.9'));
    ok('resolve-link: Cache-Control no-store', (await fn(new Request('https://x.test', { method: 'POST', body: JSON.stringify({ code: 'AAAAaaaa2222' }) }))).headers.get('Cache-Control') === 'no-store');
    ok('resolve-link: nothing sensitive is logged (no code, no token)', !h.logs.join('\n').match(/AAAAaaaa2222|a{64}|a1b2c3d4/));
    const limited = harness();
    limited.db.tables.invoice_links.push(link({ order_id: 'order-A', link_token: tok('a'), short_code: 'AAAAaaaa2222' }));
    const lfn = load('resolve-link', limited, {}, { allowed: false });
    r = await call(lfn, ANON_KEY, { code: 'AAAAaaaa2222' });
    ok('resolve-link: when rate limited it answers 429 and does not even read the table', r.status === 429 && !r.text.includes(tok('a')) && !r.text.includes('order-A'));
    ok('resolve-link: the rate-limit config is defined and conservative (<= 30/min per IP)', /'resolve-link': \{ maxRequests: (\d+), windowSeconds: 60 \}/.test(fs.readFileSync('supabase/functions/_shared/rate-limit.ts', 'utf8')) && Number(RegExp.$1) <= 30);
  }

  // =============================================================================================================
  // portal-link Edge Function: who may mint / obtain a portal link
  // =============================================================================================================
  {
    const fresh = () => {
      const h = harness();
      h.db.tables.invoice_links.push(
        link({ order_id: 'order-A', link_token: tok('a'), short_code: 'AAAAaaaa2222' }),
        link({ order_id: 'order-B', link_token: tok('b'), short_code: 'BBBBbbbb3333' }),
        link({ order_id: 'order-A', link_token: tok('e'), short_code: 'EEEEeeee4444', expires_at: PAST, link_type: 'invoice' }),
        link({ order_id: 'order-A', link_token: tok('r'), short_code: 'RRRRrrrr5555', revoked_at: PAST, expires_at: PAST, link_type: 'invoice' }),
      );
      return { h, fn: load('portal-link', h, {}, { allowed: true }, USERS) };
    };
    const noNewLink = (h: Harness) => h.db.inserts.length === 0;

    let x = fresh();
    let r = await call(x.fn, ANON_KEY, { orderId: 'order-A' });
    ok('portal-link: anonymous + order UUID only is denied (401) and mints nothing', r.status === 401 && noNewLink(x.h) && !r.text.includes(tok('a')) && !r.text.includes('AAAAaaaa2222'));
    r = await call(x.fn, null, { orderId: 'order-A' });
    ok('portal-link: no Authorization at all is denied (401)', r.status === 401);
    x = fresh();
    r = await call(x.fn, ANON_KEY, { orderId: 'order-A', token: tok('a') });
    ok('portal-link: a valid Order A token obtains Order A\'s short code', r.status === 200 && r.json?.success === true && r.json.shortCode === 'AAAAaaaa2222');
    ok('portal-link: the response never contains the token, only the short code', !r.text.includes(tok('a')) && Object.keys(r.json).sort().join() === 'shortCode,success');
    ok('portal-link: that call reused the existing link (nothing minted)', noNewLink(x.h));
    x = fresh();
    r = await call(x.fn, ANON_KEY, { orderId: 'order-B', token: tok('a') });
    ok('portal-link: an Order A token cannot obtain a link for Order B (cross-order)', r.status === 401 && noNewLink(x.h) && !r.text.includes('BBBBbbbb3333'));
    r = await call(x.fn, ANON_KEY, { orderId: 'order-A', token: tok('e') });
    ok('portal-link: an expired token is denied', r.status === 401);
    r = await call(x.fn, ANON_KEY, { orderId: 'order-A', token: tok('r') });
    ok('portal-link: a revoked token is denied', r.status === 401);
    r = await call(x.fn, ANON_KEY, { orderId: 'order-A', token: 'order-A' });
    ok('portal-link: the order id used as a token is denied', r.status === 401);

    for (const [who, jwt, expectOk] of [['crew', 'jwt-crew', true], ['admin', 'jwt-admin', true], ['master', 'jwt-master', true], ['the service role', SERVICE_KEY, true]] as Array<[string, string, boolean]>) {
      x = fresh();
      r = await call(x.fn, jwt, { orderId: 'order-A' });
      ok(`portal-link: ${who} can obtain the portal link for an operational order`, r.status === 200 && r.json?.success === expectOk && r.json.shortCode === 'AAAAaaaa2222');
      x = fresh();
      r = await call(x.fn, jwt, { orderId: 'order-draft' });
      ok(`portal-link: ${who} mints a new portal link when none exists`, r.status === 200 && x.h.db.inserts.length === 1 && x.h.db.inserts[0].row.link_type === 'portal' && x.h.db.inserts[0].row.order_id === 'order-draft');
    }
    x = fresh();
    r = await call(x.fn, 'jwt-cust-A', { orderId: 'order-A' });
    ok('portal-link: the signed-in owner can obtain their own order\'s link without a token', r.status === 200 && r.json.shortCode === 'AAAAaaaa2222');
    r = await call(x.fn, 'jwt-cust-B', { orderId: 'order-A' });
    ok('portal-link: a different signed-in customer is denied (403)', r.status === 403 && noNewLink(x.h));
    r = await call(x.fn, 'jwt-norole', { orderId: 'order-A' });
    ok('portal-link: a valid authenticated JWT with no relationship to the order is denied', r.status === 403);
    r = await call(x.fn, 'jwt-cust-A', { orderId: 'order-B' });
    ok('portal-link: the owner of Order A cannot obtain Order B\'s link', r.status === 403);

    // Stripe session proof (guest who just booked)
    x = fresh();
    x.h.stripeSessions['cs_ok'] = { status: 'complete', mode: 'setup', metadata: { order_id: 'order-A' } };
    x.h.stripeSessions['cs_other'] = { status: 'complete', mode: 'setup', metadata: { order_id: 'order-B' } };
    x.h.stripeSessions['cs_open'] = { status: 'open', mode: 'setup', metadata: { order_id: 'order-A' } };
    r = await call(x.fn, ANON_KEY, { orderId: 'order-A', sessionId: 'cs_ok' });
    ok('portal-link: a completed Checkout session for the order is proof (guest who just booked)', r.status === 200 && r.json?.shortCode === 'AAAAaaaa2222');
    r = await call(x.fn, ANON_KEY, { orderId: 'order-A', sessionId: 'cs_other' });
    ok('portal-link: a Checkout session for a different order is not proof', r.status === 401);
    r = await call(x.fn, ANON_KEY, { orderId: 'order-A', sessionId: 'cs_open' });
    ok('portal-link: an unfinished Checkout session is not proof', r.status === 401);
    r = await call(x.fn, ANON_KEY, { orderId: 'order-A', sessionId: 'cs_missing' });
    ok('portal-link: an unknown session id is not proof', r.status === 401);

    // Revoke
    x = fresh();
    r = await call(x.fn, 'jwt-crew', { orderId: 'order-A', action: 'revoke' });
    ok('portal-link revoke: crew cannot revoke (403)', r.status === 403 && x.h.db.updates.length === 0);
    r = await call(x.fn, ANON_KEY, { orderId: 'order-A', action: 'revoke', token: tok('a') });
    ok('portal-link revoke: a customer token cannot revoke (401)', r.status === 401 && x.h.db.updates.length === 0);
    r = await call(x.fn, 'jwt-admin', { orderId: 'order-A', action: 'revoke' });
    ok('portal-link revoke: admin can revoke', r.status === 200 && r.json?.success === true && x.h.db.tables.invoice_links.find((l) => l.link_token === tok('a'))?.revoked_at !== null);
    r = await call(x.fn, 'jwt-master', { orderId: 'order-B', action: 'revoke' });
    ok('portal-link revoke: master can revoke', r.status === 200);
    ok('portal-link: a revoked link\'s token no longer proves the order', !(await authHelpers.validateOrderToken(makeClient(x.h.db), 'order-A', tok('a'), NOW)));
    r = await call(x.fn, 'jwt-admin', { orderId: 'order-A' });
    ok('portal-link: after revocation the next request mints a replacement', r.status === 200 && r.json.shortCode !== 'AAAAaaaa2222' && r.json.shortCode.length === 12);

    // Crew is limited to link creation/sharing: nothing in this endpoint grants card, refund or cancel
    const src: string = fs.readFileSync('supabase/functions/portal-link/index.ts', 'utf8');
    ok('portal-link: crew gets no charge / refund / cancel capability from this endpoint', !/stripe\.(paymentIntents|refunds|charges)|cancel/i.test(src.replace(/\/\/.*$/gm, '')));
    ok('portal-link: nothing sensitive is logged', !x.h.logs.join('\n').match(/a{64}|AAAAaaaa2222/));
    r = await call(x.fn, ANON_KEY, {});
    ok('portal-link: a missing order id is a 400 for everyone', r.status === 400 || r.status === 401);
    ok('portal-link: GET is refused', (await call(x.fn, ANON_KEY, null, 'GET')).status === 405);
  }

  // =============================================================================================================
  // request-portal-link: "send me a secure link" for old UUID-only links
  // =============================================================================================================
  {
    const GENERIC = JSON.stringify({ success: true, message: 'If we found your order, we sent a secure access link to the contact information on file.' });
    const UUID_A = '11111111-1111-4111-8111-111111111111';
    const mk = (rate: { allowed: boolean; only?: string } = { allowed: true }) => {
      const h = harness();
      h.db.tables.orders.push(
        { id: UUID_A, status: 'confirmed', sms_consent: true, event_date: '2026-11-10', event_end_date: null, customers: { first_name: 'Ann', email: 'ann@example.test', phone: '+15555550101' } },
        { id: '22222222-2222-4222-8222-222222222222', status: 'draft', event_date: '2026-11-10', event_end_date: null, customers: { first_name: 'Dee', email: 'dee@example.test', phone: '+15555550103' } },
        { id: '33333333-3333-4333-8333-333333333333', status: 'confirmed', event_date: '2026-11-10', event_end_date: null, customers: { first_name: 'No', email: '', phone: '' } },
        { id: 'aaaaaaaa-0000-4000-8000-000000000001', status: 'confirmed', sms_consent: false, event_date: '2026-11-10', event_end_date: null, customers: { first_name: 'Em', email: 'em@example.test', phone: '+15555550111' } },
        { id: 'aaaaaaaa-0000-4000-8000-000000000002', status: 'confirmed', sms_consent: true, event_date: '2026-11-10', event_end_date: null, customers: { first_name: 'Eo', email: 'eo@example.test', phone: '' } },
        { id: 'aaaaaaaa-0000-4000-8000-000000000003', status: 'confirmed', sms_consent: true, event_date: '2026-11-10', event_end_date: null, customers: { first_name: 'Po', email: '', phone: '+15555550112' } },
        { id: 'aaaaaaaa-0000-4000-8000-000000000004', status: 'confirmed', sms_consent: false, event_date: '2026-11-10', event_end_date: null, customers: { first_name: 'Pn', email: '', phone: '+15555550113' } },
        { id: 'aaaaaaaa-0000-4000-8000-000000000005', status: 'confirmed', event_date: '2026-11-10', event_end_date: null, customers: { first_name: 'Nc', email: 'nc@example.test', phone: '+15555550114' } },
        { id: 'aaaaaaaa-0000-4000-8000-000000000006', status: 'void', sms_consent: true, event_date: '2026-11-10', event_end_date: null, customers: { first_name: 'Vo', email: 'vo@example.test', phone: '+15555550115' } },
      );
      return { h, fn: load('request-portal-link', h, {}, rate) };
    };
    let m = mk();
    const real = await call(m.fn, ANON_KEY, { orderId: UUID_A });
    const unknownOrder = await call(m.fn, ANON_KEY, { orderId: '99999999-9999-4999-8999-999999999999' });
    const badId = await call(m.fn, ANON_KEY, { orderId: 'not-a-uuid' });
    const draft = await call(m.fn, ANON_KEY, { orderId: '22222222-2222-4222-8222-222222222222' });
    const noContact = await call(m.fn, ANON_KEY, { orderId: '33333333-3333-4333-8333-333333333333' });
    const empty = await call(m.fn, ANON_KEY, {});
    const limited = mk({ allowed: false });
    const rl = await call(limited.fn, ANON_KEY, { orderId: UUID_A });
    ok('recovery: every outcome returns the same generic success body and status (non-enumerating)', [real, unknownOrder, badId, draft, noContact, empty, rl].every((x) => x.text === GENERIC && x.status === 200));
    ok('recovery: an existing order gets a canonical portal link and the message goes to the contact on file', m.h.db.tables.invoice_links.some((l) => l.order_id === UUID_A && l.link_type === 'portal') && m.h.fetches.some((f) => /send-email$/.test(f.url) && JSON.parse(f.init.body).to === 'ann@example.test') && m.h.fetches.some((f) => /send-sms-notification$/.test(f.init ? f.url : '') && JSON.parse(f.init.body).to === '+15555550101'));
    ok('recovery: the message contains only the short /i/<code> URL (no UUID, no token)', m.h.fetches.every((f) => { const b = f.init.body as string; return /\/i\/[A-Za-z0-9]{12}/.test(b) && !b.includes(UUID_A) && !/[0-9a-f]{64}/.test(b); }));
    ok('recovery: unknown / draft / no-contact / bad-id / rate-limited requests send nothing and mint nothing', m.h.fetches.length === 2 && limited.h.fetches.length === 0 && limited.h.db.inserts.length === 0 && m.h.db.tables.invoice_links.length === 1);
    const orderLimited = mk({ allowed: false, only: 'request-portal-link-order' });
    const ol = await call(orderLimited.fn, ANON_KEY, { orderId: UUID_A });
    ok('recovery: the per-order limit alone stops repeated sends to one customer (same generic answer)', ol.text === GENERIC && orderLimited.h.fetches.length === 0 && orderLimited.h.db.inserts.length === 0);
    // SMS consent / contact matrix: same generic answer for every case; only the sends differ.
    const matrix: Array<[string, string, boolean, boolean]> = [
      ['email + phone + consent true', UUID_A, true, true],
      ['email + phone + consent false', 'aaaaaaaa-0000-4000-8000-000000000001', true, false],
      ['email only', 'aaaaaaaa-0000-4000-8000-000000000002', true, false],
      ['phone only + consent true', 'aaaaaaaa-0000-4000-8000-000000000003', false, true],
      ['phone only + consent false', 'aaaaaaaa-0000-4000-8000-000000000004', false, false],
      ['email + phone, consent unrecorded (null)', 'aaaaaaaa-0000-4000-8000-000000000005', true, false],
      ['void order (email + phone + consent)', 'aaaaaaaa-0000-4000-8000-000000000006', false, false],
      ['draft order', '22222222-2222-4222-8222-222222222222', false, false],
      ['unknown order', '99999999-9999-4999-8999-999999999999', false, false],
      ['no contact on file', '33333333-3333-4333-8333-333333333333', false, false],
    ];
    for (const [label, id, wantEmail, wantSms] of matrix) {
      const x = mk();
      const res = await call(x.fn, ANON_KEY, { orderId: id });
      const sentEmail = x.h.fetches.some((f) => /send-email$/.test(f.url));
      const sentSms = x.h.fetches.some((f) => /send-sms-notification$/.test(f.url));
      ok(`recovery matrix [${label}]: email=${wantEmail} sms=${wantSms}, generic response`, sentEmail === wantEmail && sentSms === wantSms && res.status === 200 && res.text === GENERIC);
      if (!wantEmail && !wantSms) ok(`recovery matrix [${label}]: nothing sent and no link minted`, x.h.fetches.length === 0 && x.h.db.inserts.length === 0);
    }
    ok('recovery: a consent-less phone is never texted, even when a caller supplies a phone or consent', await (async () => {
      const x = mk();
      await call(x.fn, ANON_KEY, { orderId: 'aaaaaaaa-0000-4000-8000-000000000001', phone: '+19999999999', sms_consent: true });
      return !x.h.fetches.some((f) => /send-sms-notification$/.test(f.url));
    })());
    ok('recovery: the consent flag is read from the order record', /sms_consent === true/.test(fs.readFileSync('supabase/functions/request-portal-link/index.ts', 'utf8')) && /select\("id, status, sms_consent,/.test(fs.readFileSync('supabase/functions/request-portal-link/index.ts', 'utf8')));
    m = mk();
    await call(m.fn, ANON_KEY, { orderId: UUID_A, to: 'attacker@evil.test', email: 'attacker@evil.test', phone: '+19999999999', destination: 'attacker@evil.test' });
    ok('recovery: a caller-supplied destination is ignored; the recipient comes from the stored order', m.h.fetches.length === 2 && m.h.fetches.every((f) => !/attacker|9999999999/.test(f.init.body)));
    m = mk();
    await call(m.fn, null, { orderId: UUID_A });
    await call(m.fn, null, { orderId: UUID_A });
    ok('recovery: repeated requests reuse the one portal link (no pile of tokens)', m.h.db.tables.invoice_links.filter((l) => l.order_id === UUID_A).length === 1);
    ok('recovery: rate limited per IP and per order', m.h.rateCalls.some((c) => c.endpoint === 'request-portal-link') && m.h.rateCalls.some((c) => c.endpoint === 'request-portal-link-order' && c.id === UUID_A));
    ok('recovery: needs no account / Authorization', (await call(m.fn, null, { orderId: UUID_A })).status === 200);
    ok('recovery: nothing sensitive is logged', !m.h.logs.join('\n').match(/[0-9a-f]{64}|ann@example/));
    const rsrc: string = fs.readFileSync('supabase/functions/request-portal-link/index.ts', 'utf8');
    ok('recovery: the function never reads a destination from the request body', !/body\??\.(to|email|phone|destination)/.test(rsrc));
  }

  // =============================================================================================================
  // Migration (static)
  // =============================================================================================================
  ok('migration: adds revoked_at idempotently', /ALTER TABLE public\.invoice_links ADD COLUMN IF NOT EXISTS revoked_at timestamptz;/.test(sql));
  ok('migration: one active portal link per order is a partial UNIQUE index', /CREATE UNIQUE INDEX IF NOT EXISTS invoice_links_one_active_portal_per_order\s+ON public\.invoice_links \(order_id\)\s+WHERE link_type = 'portal' AND revoked_at IS NULL;/.test(sql));
  ok('migration: revocation is sticky and forces expiry', /OLD\.revoked_at IS NOT NULL THEN\s+NEW\.revoked_at := OLD\.revoked_at;/.test(sql) && /NEW\.expires_at := NEW\.revoked_at;/.test(sql));
  const syncFn = (sql.match(/CREATE OR REPLACE FUNCTION public\.sync_invoice_links_expires_at[\s\S]*?\$\$;/) ?? [''])[0];
  const portalUpdate = (syncFn.match(/SET expires_at = v_portal_expiry[\s\S]*?;/) ?? [''])[0];
  ok('sync trigger: portal links only follow the rule while active (not revoked, not expired)', /link_type = 'portal'/.test(portalUpdate) && /revoked_at IS NULL/.test(portalUpdate) && /expires_at > now\(\)/.test(portalUpdate));
  const legacyUpdate = (syncFn.match(/SET expires_at = \(NEW\.event_date[\s\S]*?;/) ?? [''])[0];
  ok('sync trigger: invoice/legacy links keep the old +3 day rule but only while active', /link_type <> 'portal'/.test(legacyUpdate) && /revoked_at IS NULL/.test(legacyUpdate) && /expires_at IS NOT NULL/.test(legacyUpdate) && /expires_at > now\(\)/.test(legacyUpdate));
  ok('sync trigger: expired and revoked links can never be revived by a date change (every UPDATE is guarded by expires_at > now())', (syncFn.match(/UPDATE public\.invoice_links/g) ?? []).length === 2 && (syncFn.match(/expires_at > now\(\)/g) ?? []).length === 2);
  ok('sync trigger: also fires when event_end_date changes, and never writes to orders', /AFTER UPDATE OF event_date, event_end_date ON public\.orders/.test(sql) && !/UPDATE public\.orders/.test(sql));
  ok('migration: touches no invoice_links policy, no grants, no revokes', !/\bPOLICY\b/i.test(sql) && !/\b(GRANT|REVOKE)\b[^;]*invoice_links/i.test(sql));
  ok('migration: does not drop or alter orders RLS, customers or order_portal_links', !/DROP\s+(TABLE|POLICY)/i.test(sql) && !/order_portal_links/.test(sql) && !/ROW LEVEL SECURITY/i.test(sql));
  ok('migration: no destructive data statements', !/\bDELETE\s+FROM\b/i.test(sql) && !/\bTRUNCATE\b/i.test(sql) && !/\bDROP\s+COLUMN\b/i.test(sql));
  ok('migration: every create is idempotent', !/CREATE TABLE(?! IF NOT EXISTS)/i.test(sql) && /CREATE OR REPLACE FUNCTION/.test(sql) && /DROP TRIGGER IF EXISTS/.test(sql));
  ok('migration: pins search_path on every function it defines', (sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length === (sql.match(/SET search_path = public, pg_temp/g) ?? []).length);

  // =============================================================================================================
  // Browser helper
  // =============================================================================================================
  const T = 'abcDEF0123456789abcdef0123456789';
  eq('browser token: read from the fragment', tokenLib.parsePortalToken(`#t=${T}`, ''), T);
  eq('browser token: read from a multi-parameter fragment', tokenLib.parsePortalToken(`#x=1&t=${T}`, ''), T);
  eq('browser token: legacy ?t= is still read', tokenLib.parsePortalToken('', `?t=${T}`), T);
  eq('browser token: the fragment wins over the legacy query', tokenLib.parsePortalToken(`#t=${T}`, `?t=${'z'.repeat(32)}`), T);
  eq('browser token: junk / short tokens are ignored', [tokenLib.parsePortalToken('#t=short', ''), tokenLib.parsePortalToken('', '?t=<script>'), tokenLib.parsePortalToken('#access_token=eyJ.abc', '')], [null, null, null]);
  eq('browser path: token goes in the fragment, not the query', tokenLib.buildPortalPath('order-A', { token: T, query: { card_updated: true, session_id: 'cs_1' } }), `/customer-portal/order-A?card_updated=true&session_id=cs_1#t=${T}`);
  eq('browser path: no token, no fragment', tokenLib.buildPortalPath('order-A', { query: { invoice_paid: true } }), '/customer-portal/order-A?invoice_paid=true');
  eq('browser path: an invalid token is dropped rather than echoed', tokenLib.buildPortalPath('order-A', { token: 'x y' }), '/customer-portal/order-A');
  ok('browser path: the URL never uses ?t=', !tokenLib.buildPortalPath('order-A', { token: T }).includes('?t='));
  eq('browser: tokenFragment', [tokenLib.tokenFragment(T), tokenLib.tokenFragment(null), tokenLib.tokenFragment('bad')], [`#t=${T}`, '', '']);
  ok('browser: isPortalTokenHash only matches portal credentials, not auth hashes', tokenLib.isPortalTokenHash(`#t=${T}`) && !tokenLib.isPortalTokenHash('#access_token=abc&type=recovery'));

  // Leakage scrubbing
  const leakyUrl = `https://bouncepartyclub.com/customer-portal/order-A?t=${T}&x=1#t=${T}`;
  ok('redaction: error-report URLs lose the fragment and the ?t= value', !tokenLib.redactCredentialsInUrl(leakyUrl).includes(T) && !tokenLib.redactCredentialsInUrl(leakyUrl).includes('#'));
  ok('redaction: /i/<code> never reaches an error report or analytics', !tokenLib.redactCredentialsInUrl('https://x.test/i/AAAAaaaa2222').includes('AAAAaaaa2222') && tokenLib.redactCredentialsInPath('/i/AAAAaaaa2222') === '/i/[redacted]');
  ok('redaction: ordinary paths are untouched', tokenLib.redactCredentialsInPath('/customer-portal/order-A') === '/customer-portal/order-A');
  const read = (p: string) => fs.readFileSync(p, 'utf8');
  ok('analytics: site events store the redacted path', /redactCredentialsInPath\(window\.location\.pathname\)/.test(read('src/lib/core/siteEvents.ts')));
  ok('error reports: the reported page URL is redacted', /redactCredentialsInUrl\(window\.location\.href\)/.test(read('src/lib/core/errorReporter.ts')));
  ok('ads tag: /i short links are never an ads route', /BLOCKED_PREFIXES = \[[^\]]*'\/i'/.test(read('src/components/common/GoogleAdsTag.tsx')));
  ok('auth: the post-login hash cleanup leaves a portal token fragment alone', /isPortalTokenHash\(window\.location\.hash\)/.test(read('src/contexts/AuthContext.tsx')));

  // =============================================================================================================
  // Server code: URLs, redaction, no UUID credentials
  // =============================================================================================================
  const checkout = read('supabase/functions/stripe-checkout/index.ts');
  ok('stripe-checkout: return URLs carry the token in the fragment', (checkout.match(/\$\{returnFragment\}/g) ?? []).length === 3 && /portalTokenFragment\(invoiceLinkToken\)/.test(checkout));
  ok('stripe-checkout: no return URL puts the token in the query string', !/[?&]t=\$\{/.test(checkout));
  ok('stripe-checkout: the URL log line redacts both ?t= and #t=', /\(\[\?&#\]t=\)\[\^&#\]\+/.test(checkout));
  ok('stripe-checkout: the token redaction regex really removes a fragment token', 'x?a=1#t=SECRET'.replace(/([?&#]t=)[^&#]+/g, '$1[redacted]') === 'x?a=1#t=[redacted]');
  const bal = read('supabase/functions/customer-balance-payment/index.ts');
  ok('balance payment: return URLs carry the token in the fragment when one was used', /portalTokenFragment\(invoiceToken\)/.test(bal) && (bal.match(/\$\{returnFragment\}/g) ?? []).length === 2);
  ok('send-invoice: the long invoice URL uses the fragment, not ?t=', /portalTokenFragment\(invoiceLink\.link_token\)/.test(read('supabase/functions/send-invoice/index.ts')) && !/\?t=\$\{/.test(read('supabase/functions/send-invoice/index.ts')));
  ok('send-invoice: short codes now come from the shared 12-char generator', /generateShortCode\(\)/.test(read('supabase/functions/send-invoice/index.ts')) && !/SHORT_CODE_LENGTH = 8/.test(read('supabase/functions/send-invoice/index.ts')));
  ok('portalTokenFragment helper only emits a plausible token', pl.portalTokenFragment(T) === `#t=${T}` && pl.portalTokenFragment('a b') === '' && pl.portalTokenFragment(undefined) === '' && pl.portalTokenFragment('x'.repeat(200)) === '');

  for (const [file, expectedCalls] of [
    ['supabase/functions/_shared/payments/deposit-confirmation-email.ts', 1],
    ['supabase/functions/customer-balance-payment/index.ts', 1],
    ['supabase/functions/reconcile-balance-payment/index.ts', 1],
    ['supabase/functions/stripe-webhook/emails.ts', 2],
  ] as Array<[string, number]>) {
    const s = read(file);
    ok(`${file}: customer receipt link comes from the shared helper`, (s.match(/buildPortalUrl\(/g) ?? []).length === expectedCalls);
    ok(`${file}: no hard-coded customer-portal/<uuid> credential remains`, !/bouncepartyclub\.com\/customer-portal\/\$\{/.test(s));
    ok(`${file}: if no link can be issued the fallback is the configured site root (shared helper), never a UUID URL`, /\?\? siteOrigin\b/.test(s) || /\?\? getSiteOrigin\(\)/.test(s));
  }
  const lifecycle = read('supabase/functions/order-lifecycle/index.ts');
  ok('order-lifecycle: the canonical portal link is issued when the booking enters pending review (Stripe-session proof required)', /getOrCreatePortalLink\(supabase, orderId\)/.test(lifecycle) && /accept: action === "enter_pending_review"\s*\? \["stripe_session"\]/.test(lifecycle));
  ok('order-lifecycle: link issuance is best effort (cannot block the booking)', /try \{ await getOrCreatePortalLink\(supabase, orderId\); \} catch/.test(lifecycle));

  // Client senders all go through the one helper
  const utils = read('src/lib/portal/portalShortLink.ts');
  ok('client sender helper: asks the portal-link Edge Function, never an rpc or table', /functions\.invoke\('portal-link'/.test(utils) && !/create_portal_short_link|create_order_short_link|\.from\('invoice_links'\)/.test(utils));
  {
    (globalThis as any).window = { location: { origin: 'https://site.test', hash: '', search: '' } };
    const calls: any[] = [];
    const mk = (resp: any) => ({ functions: { invoke: async (name: string, opts: any) => { calls.push({ name, opts }); return resp; } } });
    const U: any = await import('../../portal/portalShortLink');
    const okRes = await U.createShortPortalLink('order-A', mk({ data: { success: true, shortCode: 'AAAAaaaa2222' }, error: null }), null, tok('a'));
    ok('client sender helper: success yields the /i/<code> URL', okRes.success === true && /\/i\/AAAAaaaa2222$/.test(okRes.url) && calls[0].name === 'portal-link' && calls[0].opts.body.orderId === 'order-A' && calls[0].opts.body.token === tok('a'));
    ok('client sender helper: the URL is never a customer-portal/<uuid> or checkout/<uuid> URL', !/customer-portal|checkout/.test(okRes.url));
    const failRes = await U.createShortPortalLink('order-A', mk({ data: null, error: { message: 'denied' } }));
    ok('client sender helper: failure is a typed failure with no URL at all (no UUID fallback)', failRes.success === false && !('url' in failRes));
    const sess = await U.createShortPortalLink('order-A', mk({ data: { success: true, shortCode: 'AAAAaaaa2222' }, error: null }), null, null, 'cs_1');
    ok('client sender helper: a Checkout session id can be offered as proof', calls[calls.length - 1].opts.body.sessionId === 'cs_1' && sess.success === true);
  }

  // Source scan of remaining customer-facing UUID URLs
  const scanFiles: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|database\.types/.test(e.name)) scanFiles.push(p);
    }
  };
  walk('src');
  walk('supabase/functions');
  const hits: string[] = [];
  for (const f of scanFiles) {
    const lines = read(f).split(/\r?\n/);
    lines.forEach((l: string, i: number) => {
      if (/customer-portal\/\$\{|\/checkout\/\$\{/.test(l)) hits.push(`${f.replace(/\\/g, '/')}:${i + 1}`);
    });
  }
  const allowed = [
    'src/components/dashboard/OrderCard.tsx', // signed-in customer dashboard (ownership is the proof)
    'src/lib/portal/portalToken.ts', // the path builder itself
    'supabase/functions/stripe-checkout/index.ts', // Stripe return URLs (token rides in the fragment)
    'supabase/functions/customer-balance-payment/index.ts', // Stripe return URLs (token rides in the fragment)
    'supabase/functions/send-invoice/index.ts', // staff-only response to the sender
  ];
  const unexpected = hits.filter((h) => !allowed.some((a) => h.startsWith(a)));
  eq('source scan: every remaining customer-portal/<id> or checkout/<id> string is an allowed, non-credential use', unexpected, []);
  ok('source scan: nothing generates a portal_shortlink any more', !scanFiles.some((f) => /portal_shortlink/.test(read(f)) && !/_shared\/portal-link\.ts|auth\.ts/.test(f.replace(/\\/g, '/'))));
  ok('source scan: nothing reads the token with searchParams.get(\'t\') any more', !scanFiles.some((f) => /searchParams\.get\(['"]t['"]\)/.test(read(f))));
  ok('source scan: nothing in the browser builds ?t= URLs', !scanFiles.filter((f) => f.replace(/\\/g, '/').startsWith('src/')).some((f) => /\?t=\$\{|[?&]t=\$\{/.test(read(f))));

  // ShortLink page
  const shortLink = read('src/pages/ShortLink.tsx');
  ok('ShortLink: resolves through the server (resolve-link), no direct table or rpc access', /functions\.invoke\('resolve-link'/.test(shortLink) && !/invoice_links|\.rpc\(/.test(shortLink));
  ok('ShortLink: forwards the token in the fragment', /buildPortalPath\(data\.orderId, \{ token: data\.token \?\? null \}\)/.test(shortLink));
  ok('CustomerPortal: reads the credential through the single helper', /parsePortalToken\(location\.hash, location\.search\)/.test(read('src/pages/CustomerPortal.tsx')));
  ok('no component outside the helper parses location.hash for the portal credential', !scanFiles.filter((f) => f.replace(/\\/g, '/').startsWith('src/') && !/portalToken\.ts|authLinkCapture|AuthContext|Catalog|CustomerPortal\.tsx/.test(f)).some((f) => /location\.hash/.test(read(f))));

  // Customer navigation keeps the proof
  const rpv = read('src/components/customer-portal/RegularPortalView.tsx');
  ok('portal tabs: in-portal URL updates keep the #t= fragment (react-router setSearchParams would drop it)', /hash: routerLocation\.hash/.test(rpv) && /const \[searchParams\] = useSearchParams\(\)/.test(rpv) && !/const \[searchParams, setSearchParams\]/.test(rpv));
  ok('portal page: remembers the credential for the visit so a URL rewrite cannot lose the proof', /rememberedToken/.test(read('src/pages/CustomerPortal.tsx')));
  for (const [file, pattern] of [
    ['src/components/customer-portal/ApprovalSuccessView.tsx', /portalPathForCurrentVisitor\(orderId\)/],
    ['src/components/booking-return/BookingConfirmationErrorState.tsx', /portalPathForCurrentVisitor\(orderId\)/],
    ['src/components/booking-return/BookingRequestReceivedView.tsx', /createShortPortalLink\(orderId, supabase, null, null, returnSessionId\)/],
    ['src/pages/StripeCheckoutReturn.tsx', /portalPathForCurrentVisitor\(orderId, \{ invoice_paid: true \}\)/],
    ['src/pages/Sign.tsx', /portalPathForCurrentVisitor\(orderId!, \{ signatureComplete: true \}\)/],
    ['src/components/waiver/WaiverTab.tsx', /tokenFragment\(token\)/],
    ['src/components/customer-portal/RegularPortalView.tsx', /tokenFragment\(invoiceLinkToken\)/],
    ['src/components/customer-portal/InvoiceAcceptanceView.tsx', /portalPathForCurrentVisitor\(order\.id\)/],
  ] as Array<[string, RegExp]>) {
    ok(`${file}: customer navigation keeps the order-bound proof`, pattern.test(read(file)));
  }
  const pending = read('src/components/admin/orders/PendingOrderCard.tsx');
  ok('admin "send payment link": uses the secure portal short link, not /checkout/<uuid>', /createShortPortalLink\(order\.id, supabase, order\.event_date\)/.test(pending) && !/\/checkout\/\$\{/.test(pending));
  ok('admin "send payment link": never sends an empty or unissued link', /secure payment link is not ready yet/.test(pending));

  // Legacy functions are no longer called by the application
  const appText = scanFiles.filter((f) => f.replace(/\\/g, '/').startsWith('src/')).map(read).join('\n');
  ok('legacy RPCs are no longer called by the application', !/create_order_short_link|create_portal_short_link|resolve_portal_short_link/.test(appText));

  // Config
  const cfg = read('supabase/config.toml');
  ok('config: new public endpoints are registered (token/ proof checked inside)', /\[functions\.resolve-link\]\s+verify_jwt = false/.test(cfg) && /\[functions\.portal-link\]\s+verify_jwt = false/.test(cfg) && /\[functions\.request-portal-link\]\s+verify_jwt = false/.test(cfg));

  console.log(`Portal link tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} portal link test(s) failed`);
})();
