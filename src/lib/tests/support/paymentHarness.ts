// Test harness for the payment Edge Functions (charge-deposit, customer-balance-payment, stripe-webhook handlers,
// reconcile-balance-payment, stripe-checkout, stripe-charge).
//
// The functions are Deno modules, so each test loads the CURRENT source text, strips its import lines, transpiles it and runs
// it with fakes for Deno, createClient and Stripe. What makes this harness stronger than a pure in-memory fake is that the
// MONEY STATE is real: the `orders`, `payments`, `invoice_links` and `order_changelog` tables, and every `rpc()`, run against a
// SCRATCH PostgreSQL database (the one the migration tests use) through a pool of persistent psql sessions. The real
// claim / finalize / release functions, the real unique indexes and the real row locks therefore decide every outcome, and
// several requests in flight at once really are several database connections. Everything else (admin_settings, user_roles,
// customers, ...) is an in-memory table. Nothing here touches a Supabase project, the network, or real Stripe: the fake Stripe
// records every call and enforces Stripe's idempotency-key rule.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const ts = require('typescript');
const { spawn, spawnSync } = require('child_process');

// ---------------------------------------------------------------------------------------------------------------
// Persistent psql sessions
// ---------------------------------------------------------------------------------------------------------------
const PORT = process.env.ROLE_DB_PORT || process.env.CORE_DB_PORT || '54329';
const HOST = process.env.ROLE_DB_HOST || process.env.CORE_DB_HOST || '127.0.0.1';
export const PSQL_CANDIDATES = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
export const psqlArgs = (db: string) => ['-h', HOST, '-p', PORT, '-U', 'postgres', '-d', db, '-At', '-X', '-q'];

export function findPsql(db: string, probe = "SELECT to_regprocedure('public.finalize_payment_operation(uuid,uuid,text,text,text,integer,text,text,text,integer,integer,text,text)') IS NOT NULL"): string | null {
  for (const c of PSQL_CANDIDATES) {
    const p = spawnSync(c, [...psqlArgs(db), '-c', probe], { encoding: 'utf8', timeout: 15000 });
    if (p.status === 0 && p.stdout.trim() === 't') return c;
  }
  return null;
}

const SESSION_INIT = `
CREATE FUNCTION pg_temp.q(stmt text) RETURNS text LANGUAGE plpgsql AS $q$
DECLARE rec record; acc jsonb := '[]'::jsonb;
BEGIN
  FOR rec IN EXECUTE stmt LOOP acc := acc || jsonb_build_array(to_jsonb(rec)); END LOOP;
  RETURN acc::text;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('__error', SQLERRM, '__code', SQLSTATE)::text;
END $q$;
CREATE FUNCTION pg_temp.qs(stmt text) RETURNS text LANGUAGE plpgsql AS $q$
DECLARE rec record; acc jsonb := '[]'::jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  FOR rec IN EXECUTE stmt LOOP acc := acc || jsonb_build_array(to_jsonb(rec)); END LOOP;
  RETURN acc::text;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('__error', SQLERRM, '__code', SQLSTATE)::text;
END $q$;
`;

class PgSession {
  child: any;
  buffer = '';
  waiter: ((lines: string[]) => void) | null = null;
  sentinel = '';
  busy = false;
  constructor(psql: string, db: string) {
    this.child = spawn(psql, [...psqlArgs(db), '-v', 'ON_ERROR_STOP=0'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (d: any) => this.onData(d.toString()));
    this.child.stderr.on('data', (d: any) => { this.buffer += `\nSTDERR ${d.toString()}`; });
    this.child.stdin.write(SESSION_INIT);
  }
  onData(chunk: string) {
    this.buffer += chunk;
    if (!this.waiter) return;
    const idx = this.buffer.indexOf(this.sentinel);
    if (idx < 0) return;
    const before = this.buffer.slice(0, idx);
    this.buffer = this.buffer.slice(idx + this.sentinel.length);
    const w = this.waiter;
    this.waiter = null;
    w(before.split('\n').map((l) => l.trimEnd()).filter((l) => l !== ''));
  }
  run(sqlText: string): Promise<string[]> {
    return new Promise((resolve) => {
      this.sentinel = `@@END${Math.random().toString(36).slice(2)}@@`;
      this.waiter = resolve;
      this.child.stdin.write(`${sqlText}\nSELECT '${this.sentinel}';\n`);
    });
  }
  close() { try { this.child.stdin.end(); } catch { /* already closed */ } }
}

export class PgPool {
  free: PgSession[] = [];
  all: PgSession[] = [];
  waiting: Array<(s: PgSession) => void> = [];
  constructor(public psql: string, public db: string, size = 8) {
    for (let i = 0; i < size; i++) {
      const s = new PgSession(psql, db);
      this.all.push(s);
      this.free.push(s);
    }
  }
  private acquire(): Promise<PgSession> {
    const s = this.free.pop();
    if (s) return Promise.resolve(s);
    return new Promise((res) => this.waiting.push(res));
  }
  private release(s: PgSession) {
    const next = this.waiting.shift();
    if (next) next(s);
    else this.free.push(s);
  }
  // Runs one statement through pg_temp.q (as the connecting superuser) or pg_temp.qs (as service_role) and returns its rows.
  async query(statement: string, asServiceRole = false): Promise<any> {
    const s = await this.acquire();
    try {
      const lines = await s.run(`SELECT pg_temp.${asServiceRole ? 'qs' : 'q'}($bpcq$${statement}$bpcq$);`);
      const line = lines.filter((l) => l.startsWith('[') || l.startsWith('{')).pop() ?? '[]';
      return JSON.parse(line);
    } finally {
      this.release(s);
    }
  }
  async exec(statements: string): Promise<void> {
    const s = await this.acquire();
    try {
      await s.run(statements);
    } finally {
      this.release(s);
    }
  }
  close() { this.all.forEach((s) => s.close()); }
}

// ---------------------------------------------------------------------------------------------------------------
// SQL literals
// ---------------------------------------------------------------------------------------------------------------
export function lit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

// ---------------------------------------------------------------------------------------------------------------
// The Supabase client fake
// ---------------------------------------------------------------------------------------------------------------
export const PG_TABLES = new Set(['orders', 'payments', 'invoice_links', 'order_changelog']);

export interface WorldLogEntry { table: string; op: string; payload?: any; filters?: any[] }

export interface World {
  pg: PgPool;
  tables: Record<string, any[]>;
  // Related rows attached to a PostgREST embed such as customers(...) on an `orders` select.
  embeds: Record<string, Record<string, any>>;
  users: Record<string, string>;
  log: WorldLogEntry[];
  invokes: Array<{ name: string; body: any }>;
  rpcCalls: Array<{ name: string; args: any }>;
  fetches: Array<{ url: string; init: any }>;
  consoleLines: string[];
  invokeHandlers: Record<string, (body: any) => any>;
  // Failure injection: a function called with the name of an rpc or table operation that should fail.
  failRpc: Record<string, { error: any; times?: number }>;
  failTable: Array<{ table: string; op: string; error: any; times?: number }>;
  // Called right before an rpc is sent to the database (lets a test interleave another request at an exact moment).
  beforeRpc: Record<string, () => Promise<void> | void>;
  afterRpc: Record<string, () => Promise<void> | void>;
  stripe: FakeStripe;
  // Tables that run against the scratch database for THIS world (default: PG_TABLES).
  pgTables?: Set<string>;
}

type Filter = { kind: 'eq' | 'neq' | 'in' | 'is' | 'gte' | 'lte' | 'not'; col: string; val: any };

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function pickColumns(row: any, cols: string, embedFor: (name: string) => any): any {
  if (!row) return row;
  const parts = splitTopLevel(cols);
  if (parts.length === 0 || parts.includes('*') && parts.length === 1) return { ...row };
  const out: any = {};
  for (const p of parts) {
    const m = p.match(/^(?:(\w+):)?(\w+)(?:!\w+)?\(/);
    if (p === '*') Object.assign(out, row);
    else if (m) out[m[1] ?? m[2]] = embedFor(m[2]);
    else out[p.trim()] = row[p.trim()];
  }
  return out;
}

function filterSql(filters: Filter[], alias: string): string {
  if (filters.length === 0) return 'TRUE';
  return filters.map((f) => {
    const c = `${alias}.${ident(f.col.replace(/^.*\./, ''))}`;
    switch (f.kind) {
      case 'eq': return f.val === null ? `${c} IS NULL` : `${c}::text = ${lit(String(f.val))}`;
      case 'neq': return `${c}::text IS DISTINCT FROM ${lit(String(f.val))}`;
      case 'in': return f.val.length ? `${c}::text IN (${f.val.map((x: any) => lit(String(x))).join(', ')})` : 'FALSE';
      case 'is': return f.val === null ? `${c} IS NULL` : `${c} IS ${f.val ? 'TRUE' : 'FALSE'}`;
      case 'gte': return `${c} >= ${lit(f.val)}`;
      case 'lte': return `${c} <= ${lit(f.val)}`;
      case 'not': return f.val === null ? `${c} IS NOT NULL` : `${c}::text IS DISTINCT FROM ${lit(String(f.val))}`;
    }
  }).join(' AND ');
}

function matchesMemory(row: any, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.col.replace(/^.*\./, '')];
    switch (f.kind) {
      case 'eq': return f.val === null ? v === null || v === undefined : String(v) === String(f.val);
      case 'neq': return String(v) !== String(f.val);
      case 'in': return f.val.map(String).includes(String(v));
      case 'is': return f.val === null ? v === null || v === undefined : v === f.val;
      case 'gte': return v >= f.val;
      case 'lte': return v <= f.val;
      case 'not': return f.val === null ? v !== null && v !== undefined : String(v) !== String(f.val);
    }
  });
}

class QueryBuilder {
  op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  cols = '*';
  returning: string | null = null;
  payload: any = null;
  filters: Filter[] = [];
  orderBy: { col: string; asc: boolean } | null = null;
  limitN: number | null = null;
  mode: 'many' | 'single' | 'maybe' = 'many';
  constructor(private w: World, private table: string) {}

  select(cols = '*') { if (this.op === 'select') this.cols = cols; else this.returning = cols; return this; }
  insert(p: any) { this.op = 'insert'; this.payload = p; return this; }
  update(p: any) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col: string, val: any) { this.filters.push({ kind: 'eq', col, val }); return this; }
  neq(col: string, val: any) { this.filters.push({ kind: 'neq', col, val }); return this; }
  in(col: string, val: any[]) { this.filters.push({ kind: 'in', col, val }); return this; }
  is(col: string, val: any) { this.filters.push({ kind: 'is', col, val }); return this; }
  gte(col: string, val: any) { this.filters.push({ kind: 'gte', col, val }); return this; }
  lte(col: string, val: any) { this.filters.push({ kind: 'lte', col, val }); return this; }
  not(col: string, _op: string, val: any) { this.filters.push({ kind: 'not', col, val }); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.orderBy = { col, asc: o.ascending !== false }; return this; }
  limit(n: number) { this.limitN = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(res: any, rej: any) { return this.exec().then(res, rej); }

  private embedFor(row: any) {
    return (name: string) => {
      const e = this.w.embeds[this.table]?.[name];
      return typeof e === 'function' ? e(row) : e ?? null;
    };
  }

  private shape(rows: any[], cols: string | null): { data: any; error: any } {
    const picked = rows.map((r) => (cols ? pickColumns(r, cols, this.embedFor(r)) : r));
    if (this.mode === 'single') {
      if (picked.length !== 1) return { data: null, error: { code: 'PGRST116', message: `JSON object requested, multiple (or no) rows returned (${picked.length})` } };
      return { data: picked[0], error: null };
    }
    if (this.mode === 'maybe') {
      if (picked.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } };
      return { data: picked[0] ?? null, error: null };
    }
    return { data: picked, error: null };
  }

  async exec(): Promise<{ data: any; error: any }> {
    this.w.log.push({ table: this.table, op: this.op, payload: this.payload, filters: this.filters });
    const injected = this.w.failTable.find((f) => f.table === this.table && f.op === this.op && (f.times === undefined || f.times > 0));
    if (injected) {
      if (injected.times !== undefined) injected.times--;
      return { data: null, error: injected.error };
    }
    if (!(this.w.pgTables ?? PG_TABLES).has(this.table)) return this.execMemory();
    return this.execPg();
  }

  private execMemory(): { data: any; error: any } {
    const rows = (this.w.tables[this.table] ??= []);
    if (this.op === 'insert') {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const it of items) rows.push({ ...it });
      return this.returning ? this.shape(items.map((x: any) => ({ ...x })), this.returning) : { data: null, error: null };
    }
    const hit = rows.filter((r) => matchesMemory(r, this.filters));
    if (this.op === 'update') {
      hit.forEach((r) => Object.assign(r, this.payload));
      return this.returning ? this.shape(hit.map((r) => ({ ...r })), this.returning) : { data: null, error: null };
    }
    if (this.op === 'delete') {
      this.w.tables[this.table] = rows.filter((r) => !hit.includes(r));
      return { data: null, error: null };
    }
    let out = hit.map((r) => ({ ...r }));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return this.shape(out, this.cols);
  }

  private async execPg(): Promise<{ data: any; error: any }> {
    const t = `public.${ident(this.table)}`;
    let stmt: string;
    if (this.op === 'select') {
      stmt = `SELECT to_jsonb(t) AS j FROM ${t} t WHERE ${filterSql(this.filters, 't')}`;
      if (this.orderBy) stmt += ` ORDER BY t.${ident(this.orderBy.col)} ${this.orderBy.asc ? 'ASC' : 'DESC'}`;
      if (this.limitN !== null) stmt += ` LIMIT ${this.limitN}`;
    } else if (this.op === 'insert') {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload];
      const keys = Object.keys(items[0] ?? {});
      stmt = `INSERT INTO ${t} AS t (${keys.map(ident).join(', ')}) SELECT ${keys.map((k) => `r.${ident(k)}`).join(', ')} FROM jsonb_populate_recordset(null::${t}, ${lit(items)}) r RETURNING to_jsonb(t) AS j`;
    } else if (this.op === 'update') {
      const keys = Object.keys(this.payload ?? {});
      stmt = `UPDATE ${t} AS t SET ${keys.map((k) => `${ident(k)} = r.${ident(k)}`).join(', ')} FROM jsonb_populate_record(null::${t}, ${lit(this.payload)}) r WHERE ${filterSql(this.filters, 't')} RETURNING to_jsonb(t) AS j`;
    } else {
      stmt = `DELETE FROM ${t} AS t WHERE ${filterSql(this.filters, 't')} RETURNING to_jsonb(t) AS j`;
    }
    const rows = await this.w.pg.query(stmt);
    if (rows && rows.__error) return { data: null, error: { message: rows.__error, code: rows.__code } };
    const objs = (rows as any[]).map((r) => r.j);
    if (this.op === 'select') return this.shape(objs, this.cols);
    return this.returning ? this.shape(objs, this.returning) : { data: null, error: null };
  }
}

export function makeClient(w: World) {
  return {
    from: (table: string) => new QueryBuilder(w, table),
    rpc: (name: string, args: Record<string, any> = {}) => {
      const run = async (): Promise<{ data: any; error: any }> => {
      w.rpcCalls.push({ name, args });
      await w.beforeRpc[name]?.();
      const inj = w.failRpc[name];
      if (inj && (inj.times === undefined || inj.times > 0)) {
        if (inj.times !== undefined) inj.times--;
        return { data: null, error: inj.error };
      }
      const argList = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
      const rows = await w.pg.query(`SELECT public.${name}(${argList}) AS j`, true);
      await w.afterRpc[name]?.();
      if (rows && rows.__error) return { data: null, error: { message: rows.__error, code: rows.__code } };
      const first = (rows as any[])[0]?.j;
      return { data: first === undefined ? null : first, error: null };
      };
      const out: any = { then: (res: any, rej: any) => run().then(res, rej), maybeSingle: () => run(), single: () => run() };
      return out;
    },
    functions: {
      invoke: async (name: string, opts: { body?: any } = {}) => {
        w.invokes.push({ name, body: opts.body });
        const h = w.invokeHandlers[name];
        return h ? h(opts.body) : { data: { success: true }, error: null };
      },
    },
    auth: {
      getUser: async (token: string) => {
        const id = w.users[token];
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Fake Stripe: records every call, enforces the idempotency-key rule, and can fail in the ways Stripe fails.
// ---------------------------------------------------------------------------------------------------------------
export type CreateBehavior =
  | 'succeed'
  | 'decline'
  | 'requires_action'
  | 'processing'
  // Stripe accepts and charges the card, but the response never reaches us (timeout / dropped connection).
  | 'succeed_then_connection_error'
  // The request never reaches Stripe.
  | 'connection_error_before'
  | 'api_error_500'
  | 'invalid_request';

export type RefundBehavior =
  | 'succeed'
  | 'pending'
  // Stripe creates the refund but the response never reaches us.
  | 'succeed_then_connection_error'
  // The request never reaches Stripe.
  | 'connection_error_before'
  // Stripe rejects the request (nothing is created).
  | 'invalid_request'
  | 'api_error_500';

export interface StripeCall { api: string; params?: any; key?: string }

function stripeError(type: string, message: string, extra: Record<string, any> = {}) {
  const e: any = new Error(message);
  e.type = type;
  Object.assign(e, extra);
  return e;
}

// Ids must not repeat across fake accounts: the database really enforces one original payment per PaymentIntent.
let GLOBAL_SEQ = 0;
const RUN = Math.random().toString(36).slice(2, 8);

export class FakeStripe {
  // How paymentIntents.search answers: normally from the PaymentIntents that exist; or a forced miss / failure / malformed body.
  searchMode: 'normal' | 'miss' | 'throw' | 'malformed' = 'normal';
  calls: StripeCall[] = [];
  paymentIntents_: Record<string, any> = {};
  idem: Record<string, { fp: string; result: any }> = {};
  sessions_: Record<string, any> = {};
  behaviors: CreateBehavior[] = [];
  defaultBehavior: CreateBehavior = 'succeed';
  nextIntentStatusOnRetrieve: Record<string, string> = {};
  seq = 0;
  paymentMethod = { id: 'pm_card', type: 'card', customer: 'cus_1', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2099 } };
  sessionBehavior: 'ok' | 'error' = 'ok';

  count(api: string) { return this.calls.filter((c) => c.api === api).length; }
  get charged(): number { return Object.values(this.paymentIntents_).filter((p: any) => p.status === 'succeeded').reduce((a: number, p: any) => a + p.amount, 0); }
  get succeededCount(): number { return Object.values(this.paymentIntents_).filter((p: any) => p.status === 'succeeded').length; }
  get createdCount(): number { return Object.keys(this.paymentIntents_).length; }

  private nextBehavior(): CreateBehavior { return this.behaviors.shift() ?? this.defaultBehavior; }

  private make(params: any, status: string) {
    const id = `pi_fake_${RUN}_${++GLOBAL_SEQ}`;
    const pi = {
      id,
      object: 'payment_intent',
      amount: params.amount,
      amount_received: status === 'succeeded' ? params.amount : 0,
      currency: params.currency,
      customer: params.customer,
      payment_method: params.payment_method,
      metadata: { ...(params.metadata ?? {}) },
      status,
      latest_charge: status === 'succeeded' ? `ch_fake_${RUN}_${GLOBAL_SEQ}` : null,
    };
    this.paymentIntents_[id] = pi;
    return pi;
  }

  paymentIntents = {
    create: async (params: any, opts?: { idempotencyKey?: string }) => {
      const key = opts?.idempotencyKey;
      this.calls.push({ api: 'paymentIntents.create', params, key });
      if (key) {
        const prior = this.idem[key];
        if (prior) {
          if (prior.fp !== JSON.stringify(params)) throw stripeError('StripeIdempotencyError', 'Keys for idempotent requests can only be used with the same parameters they were first used with.', { code: 'idempotency_key_in_use' });
          this.calls[this.calls.length - 1].api = 'paymentIntents.create(replay)';
          if (prior.result.__throws) throw prior.result.__throws;
          return prior.result.value;
        }
      }
      const behavior = this.nextBehavior();
      let value: any;
      // What Stripe stores for the key (and replays), and what THIS caller sees. They differ when the response is lost.
      let saved: { value?: any; __throws?: any } | null = null;
      let thrown: any = null;
      switch (behavior) {
        case 'succeed': value = this.make(params, 'succeeded'); saved = { value }; break;
        case 'decline': {
          const pi = this.make(params, 'requires_payment_method');
          thrown = stripeError('StripeCardError', 'Your card was declined.', { code: 'card_declined', payment_intent: pi });
          saved = { __throws: thrown };
          break;
        }
        case 'requires_action': value = this.make(params, 'requires_action'); saved = { value }; break;
        case 'processing': value = this.make(params, 'processing'); saved = { value }; break;
        case 'succeed_then_connection_error':
          value = this.make(params, 'succeeded');
          saved = { value };
          thrown = stripeError('StripeConnectionError', 'An error occurred with our connection to Stripe.');
          break;
        case 'connection_error_before': thrown = stripeError('StripeConnectionError', 'An error occurred with our connection to Stripe.'); break;
        case 'api_error_500': thrown = stripeError('StripeAPIError', 'Internal error'); saved = { __throws: thrown }; break;
        case 'invalid_request': thrown = stripeError('StripeInvalidRequestError', 'Invalid request', { code: 'parameter_invalid_integer' }); break;
      }
      if (key && saved) this.idem[key] = { fp: JSON.stringify(params), result: saved };
      if (thrown) throw thrown;
      return value;
    },
    retrieve: async (id: string) => {
      this.calls.push({ api: 'paymentIntents.retrieve', params: { id } });
      const pi = this.paymentIntents_[id];
      if (!pi) throw stripeError('StripeInvalidRequestError', 'No such payment_intent', { code: 'resource_missing' });
      return { ...pi, status: this.nextIntentStatusOnRetrieve[id] ?? pi.status };
    },
    cancel: async (id: string) => {
      this.calls.push({ api: 'paymentIntents.cancel', params: { id } });
      const pi = this.paymentIntents_[id];
      if (pi && pi.status !== 'succeeded') pi.status = 'canceled';
      return pi;
    },
    search: async (params: any) => {
      this.calls.push({ api: 'paymentIntents.search', params });
      if (this.searchMode === 'throw') throw stripeError('StripeConnectionError', 'An error occurred with our connection to Stripe.');
      if (this.searchMode === 'malformed') return {} as any;
      if (this.searchMode === 'miss') return { data: [] };
      const key = String(params.query).match(/'([^']+)'\s*$/)?.[1];
      return { data: Object.values(this.paymentIntents_).filter((p: any) => p.metadata?.payment_operation_key === key) };
    },
  };

  // ------------------------------------------------------------------------------------------------------------
  // Refunds
  // ------------------------------------------------------------------------------------------------------------
  refunds_: Record<string, any> = {};
  refundBehaviors: RefundBehavior[] = [];
  defaultRefundBehavior: RefundBehavior = 'succeed';
  // How refunds.list answers: normally (paged like Stripe: newest first, limit, starting_after, has_more); failing; or with a body that
  // never says whether there is more (a truncated / malformed answer); or failing only from the Nth page on (a mid-listing failure).
  refundListMode: 'normal' | 'throw' | 'no_has_more' = 'normal';
  refundListFailFromPage: number | null = null;

  // A succeeded PaymentIntent that exists at Stripe (a customer payment made earlier).
  addSucceededPaymentIntent(amount: number, metadata: Record<string, string> = {}) {
    return this.make({ amount, currency: 'usd', customer: 'cus_1', payment_method: 'pm_card', metadata }, 'succeeded');
  }

  private refundTotalOn(piId: string): number {
    return Object.values(this.refunds_).filter((r: any) => r.payment_intent === piId && r.status !== 'failed' && r.status !== 'canceled').reduce((a: number, r: any) => a + r.amount, 0);
  }

  private makeRefund(params: any, status: string) {
    const id = `re_fake_${RUN}_${++GLOBAL_SEQ}`;
    const pi = this.paymentIntents_[params.payment_intent];
    const refund = { id, object: 'refund', amount: params.amount, currency: 'usd', status, payment_intent: params.payment_intent, charge: pi?.latest_charge ?? null, reason: params.reason ?? null, metadata: { ...(params.metadata ?? {}) }, failure_reason: undefined as string | undefined };
    this.refunds_[id] = refund;
    return refund;
  }

  // A refund made in the Stripe dashboard (no application metadata).
  externalRefund(piId: string, amount: number, status = 'succeeded') {
    return this.makeRefund({ payment_intent: piId, amount, reason: 'requested_by_customer', metadata: {} }, status);
  }

  setRefundStatus(id: string, status: string, failure_reason?: string) {
    this.refunds_[id].status = status;
    if (failure_reason) this.refunds_[id].failure_reason = failure_reason;
    return { ...this.refunds_[id] };
  }

  get refundCreatedCount(): number { return Object.keys(this.refunds_).length; }
  get refundedTotal(): number { return Object.values(this.refunds_).filter((r: any) => r.status === 'succeeded' || r.status === 'pending').reduce((a: number, r: any) => a + r.amount, 0); }

  refunds = {
    create: async (params: any, opts?: { idempotencyKey?: string }) => {
      const key = opts?.idempotencyKey;
      this.calls.push({ api: 'refunds.create', params, key });
      if (key && this.idem[key]) {
        const prior = this.idem[key];
        if (prior.fp !== JSON.stringify(params)) throw stripeError('StripeIdempotencyError', 'Keys for idempotent requests can only be used with the same parameters they were first used with.', { code: 'idempotency_key_in_use' });
        this.calls[this.calls.length - 1].api = 'refunds.create(replay)';
        if (prior.result.__throws) throw prior.result.__throws;
        return prior.result.value;
      }
      const behavior = this.refundBehaviors.shift() ?? this.defaultRefundBehavior;
      const pi = this.paymentIntents_[params.payment_intent];
      if (behavior === 'connection_error_before') throw stripeError('StripeConnectionError', 'An error occurred with our connection to Stripe.');
      if (behavior === 'api_error_500') { const e = stripeError('StripeAPIError', 'Internal error'); if (key) this.idem[key] = { fp: JSON.stringify(params), result: { __throws: e } }; throw e; }
      if (behavior === 'invalid_request' || !pi || this.refundTotalOn(params.payment_intent) + params.amount > pi.amount) {
        // Stripe stores the key against a rejected request too and replays the rejection.
        const e = stripeError('StripeInvalidRequestError', !pi ? 'No such payment_intent' : 'Refund amount is greater than unrefunded amount on charge', { code: !pi ? 'resource_missing' : 'charge_already_refunded' });
        if (key) this.idem[key] = { fp: JSON.stringify(params), result: { __throws: e } };
        throw e;
      }
      const refund = this.makeRefund(params, behavior === 'pending' ? 'pending' : 'succeeded');
      if (key) this.idem[key] = { fp: JSON.stringify(params), result: { value: refund } };
      if (behavior === 'succeed_then_connection_error') throw stripeError('StripeConnectionError', 'An error occurred with our connection to Stripe.');
      return { ...refund };
    },
    retrieve: async (id: string) => {
      this.calls.push({ api: 'refunds.retrieve', params: { id } });
      const r = this.refunds_[id];
      if (!r) throw stripeError('StripeInvalidRequestError', 'No such refund', { code: 'resource_missing' });
      return { ...r };
    },
    list: async (params: any) => {
      this.calls.push({ api: 'refunds.list', params });
      if (this.refundListMode === 'throw') throw stripeError('StripeConnectionError', 'An error occurred with our connection to Stripe.');
      const page = params.starting_after ? (this.calls.filter((c) => c.api === 'refunds.list' && c.params?.starting_after).length) : 0;
      if (this.refundListFailFromPage !== null && page >= this.refundListFailFromPage) throw stripeError('StripeConnectionError', 'An error occurred with our connection to Stripe.');
      const all = (Object.values(this.refunds_) as any[])
        .filter((r) => (params.payment_intent ? r.payment_intent === params.payment_intent : true) && (params.charge ? r.charge === params.charge : true))
        .map((r) => ({ ...r }))
        .reverse(); // newest first
      let start = 0;
      if (params.starting_after) {
        const at = all.findIndex((r) => r.id === params.starting_after);
        start = at < 0 ? all.length : at + 1;
      }
      const limit = Math.min(params.limit ?? 10, 100);
      const data = all.slice(start, start + limit);
      if (this.refundListMode === 'no_has_more') return { data };
      return { data, has_more: start + limit < all.length };
    },
  };

  paymentMethods = {
    retrieve: async (id: string) => { this.calls.push({ api: 'paymentMethods.retrieve', params: { id } }); return { ...this.paymentMethod, id }; },
    list: async (params: any) => { this.calls.push({ api: 'paymentMethods.list', params }); return { data: [this.paymentMethod] }; },
  };

  charges = {
    retrieve: async (id: string) => { this.calls.push({ api: 'charges.retrieve', params: { id } }); return { id, balance_transaction: { fee: 100, net: 0 } }; },
  };

  customers = {
    create: async (params: any, opts?: { idempotencyKey?: string }) => { this.calls.push({ api: 'customers.create', params, key: opts?.idempotencyKey }); return { id: `cus_new_${RUN}_${++GLOBAL_SEQ}` }; },
  };

  setupIntents = {
    retrieve: async (id: string) => { this.calls.push({ api: 'setupIntents.retrieve', params: { id } }); return { id, payment_method: 'pm_card' }; },
  };

  checkout = {
    sessions: {
      create: async (params: any, opts?: { idempotencyKey?: string }) => {
        const key = opts?.idempotencyKey;
        this.calls.push({ api: 'checkout.sessions.create', params, key });
        if (this.sessionBehavior === 'error') throw stripeError('StripeAPIError', 'Internal error');
        if (key && this.idem[key]) {
          if (this.idem[key].fp !== JSON.stringify(params)) throw stripeError('StripeIdempotencyError', 'Keys for idempotent requests can only be used with the same parameters they were first used with.', { code: 'idempotency_key_in_use' });
          this.calls[this.calls.length - 1].api = 'checkout.sessions.create(replay)';
          return this.idem[key].result.value;
        }
        const id = `cs_fake_${RUN}_${++GLOBAL_SEQ}`;
        const total = (params.line_items ?? []).reduce((a: number, li: any) => a + (li.price_data?.unit_amount ?? 0) * (li.quantity ?? 1), 0);
        const session = { id, mode: params.mode, status: 'open', payment_status: 'unpaid', url: `https://checkout.fake/${id}`, amount_total: total, metadata: { ...(params.metadata ?? {}) }, customer: params.customer, payment_intent: null, expires_at: params.expires_at };
        this.sessions_[id] = session;
        if (key) this.idem[key] = { fp: JSON.stringify(params), result: { value: session } };
        return session;
      },
      retrieve: async (id: string, opts?: { expand?: string[] }) => {
        this.calls.push({ api: 'checkout.sessions.retrieve', params: { id, expand: opts?.expand } });
        const s = this.sessions_[id];
        if (!s) throw stripeError('StripeInvalidRequestError', 'No such checkout.session', { code: 'resource_missing' });
        const out: any = { ...s };
        if (opts?.expand?.includes('payment_intent') && s.payment_intent) {
          const pi = { ...this.paymentIntents_[s.payment_intent] };
          if (opts.expand.includes('payment_intent.payment_method')) pi.payment_method = { ...this.paymentMethod };
          out.payment_intent = pi;
        }
        return out;
      },
      expire: async (id: string) => {
        this.calls.push({ api: 'checkout.sessions.expire', params: { id } });
        const s = this.sessions_[id];
        if (!s) throw stripeError('StripeInvalidRequestError', 'No such checkout.session', { code: 'resource_missing' });
        if (s.status !== 'open') throw stripeError('StripeInvalidRequestError', 'Only open sessions can be expired', { code: 'checkout_session_not_open' });
        s.status = 'expired';
        return { ...s };
      },
    },
  };

  // The customer pays an open Checkout Session on Stripe's page.
  paySession(id: string): { session: any; paymentIntent: any } {
    const s = this.sessions_[id];
    const pi = this.make({ amount: s.amount_total, currency: 'usd', customer: s.customer, payment_method: 'pm_card', metadata: s.metadata }, 'succeeded');
    s.status = 'complete';
    s.payment_status = 'paid';
    s.payment_intent = pi.id;
    return { session: { ...s }, paymentIntent: pi };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------------------------------------------
export const SERVICE_KEY = 'svc-key-0123456789abcdef';
export const ANON_KEY = 'anon-key-0123456789abcdef';

export function makeWorld(pg: PgPool): World {
  return {
    pg,
    tables: {
      admin_settings: [{ key: 'stripe_secret_key', value: 'sk_test_fake' }],
      user_roles: [
        { user_id: 'u-master', role: 'master' },
        { user_id: 'u-admin', role: 'admin' },
        { user_id: 'u-crew', role: 'crew' },
        { user_id: 'u-cust', role: 'customer' },
      ],
      customers: [],
      order_items: [],
      order_discounts: [],
      order_custom_fees: [],
      transaction_receipts: [],
    },
    embeds: {},
    users: { 'jwt-master': 'u-master', 'jwt-admin': 'u-admin', 'jwt-crew': 'u-crew', 'jwt-cust': 'u-cust' },
    log: [],
    invokes: [],
    rpcCalls: [],
    fetches: [],
    consoleLines: [],
    invokeHandlers: {},
    failRpc: {},
    failTable: [],
    beforeRpc: {},
    afterRpc: {},
    stripe: new FakeStripe(),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Loading Edge Function source
// ---------------------------------------------------------------------------------------------------------------
function transpile(src: string): string {
  const stripped = src.replace(/^import[^;]*;/gm, '');
  return ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
}

function importedNames(src: string): Set<string> {
  const imported = new Set<string>();
  for (const m of src.matchAll(/^import([^;]*);/gm)) {
    for (const id of m[1].replace(/from\s+['"][^'"]*['"]/, '').match(/[A-Za-z_$][\w$]*/g) ?? []) imported.add(id);
  }
  return imported;
}

// The REAL pure money modules (not stand-ins): the receipt figures must be exactly what the app computes.
let realMoney: Record<string, unknown> | null = null;
function realMoneyScope(): Record<string, unknown> {
  if (realMoney) return realMoney;
  const run = (path: string, scope: Record<string, unknown>): Record<string, any> => {
    const src: string = fs.readFileSync(path, 'utf8');
    const imported = importedNames(src);
    const names = Object.keys(scope).filter((n) => imported.has(n));
    const mod: any = { exports: {} };
    new Function('exports', 'module', ...names, transpile(src))(mod.exports, mod, ...names.map((n) => scope[n]));
    return mod.exports;
  };
  const money = run('src/lib/pricing/orderMoney.ts', {});
  const receipts = run('supabase/functions/_shared/payments/receipt-order-totals.ts', money);
  realMoney = { ...money, ...receipts };
  return realMoney;
}

// Real shared helpers (item labels, site origin), run through the same transpile-and-scope loader as the money helpers above.
let sharedHelpers: Record<string, any> | null = null;
function realSharedHelpers(): Record<string, any> {
  if (sharedHelpers) return sharedHelpers;
  const run = (path: string, scope: Record<string, unknown>): Record<string, any> => {
    const src: string = fs.readFileSync(path, 'utf8');
    const imported = importedNames(src);
    const names = Object.keys(scope).filter((n) => imported.has(n));
    const mod: any = { exports: {} };
    new Function('exports', 'module', ...names, transpile(src))(mod.exports, mod, ...names.map((n) => scope[n]));
    return mod.exports;
  };
  const labels = run('supabase/functions/_shared/payments/order-item-label.ts', {});
  const returnOrigin = run('supabase/functions/_shared/booking/returnOrigin.ts', {});
  const siteOrigin = run('supabase/functions/_shared/siteOrigin.ts', returnOrigin);
  sharedHelpers = { labels, returnOrigin, siteOrigin };
  return sharedHelpers;
}

export function baseScope(w: World, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const env: Record<string, string> = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY, STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake' };
  const FakeStripeCtor = function () { return w.stripe; } as any;
  return {
    Deno: { env: { get: (k: string) => env[k] }, serve: () => {} },
    createClient: () => makeClient(w),
    Stripe: FakeStripeCtor,
    crypto: (globalThis as any).crypto,
    console: {
      log: (...a: unknown[]) => w.consoleLines.push(a.map(String).join(' ')),
      warn: (...a: unknown[]) => w.consoleLines.push(a.map(String).join(' ')),
      error: (...a: unknown[]) => w.consoleLines.push(a.map(String).join(' ')),
      info: () => {},
      debug: () => {},
    },
    fetch: async (url: string, init: any) => {
      w.fetches.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '' };
    },
    corsHeaders: { 'Access-Control-Allow-Origin': '*' },
    checkRateLimit: async () => ({ allowed: true }),
    createRateLimitResponse: () => new Response('rate limited', { status: 429 }),
    getIdentifier: () => '203.0.113.9',
    buildRateLimitKey: (...a: unknown[]) => a.join(':'),
    validatePaymentMethod: async (id: string, stripe: any) => {
      const pm = await stripe.paymentMethods.retrieve(id);
      return pm?.customer ? { valid: true, expMonth: pm.card.exp_month, expYear: pm.card.exp_year, last4: pm.card.last4 } : { valid: false, reason: 'Payment method no longer attached to customer', needsNewCard: true };
    },
    formatCurrency: (c: number) => `$${((c ?? 0) / 100).toFixed(2)}`,
    formatPaymentMethodLabel: () => 'Visa 4242',
    formatOrderId: (id: string) => String(id).slice(0, 8),
    logTransaction: async (_c: any, data: any) => { w.tables.transaction_receipts.push(data); return 'R-1'; },
    buildPortalUrl: async () => 'https://portal.fake/x',
    portalTokenFragment: (t: string | undefined) => (t ? `#t=${t}` : ''),
    DEFAULT_PHONE: '555-0100',
    ...realSharedHelpers().labels,
    getSiteOrigin: () => realSharedHelpers().siteOrigin.getSiteOrigin({ get: (k: string) => env[k] }),
    configuredOrigins: () => realSharedHelpers().siteOrigin.configuredOrigins({ get: (k: string) => env[k] }),
    ...realMoneyScope(),
    ...extra,
  };
}

export function loadHandler(fnDir: string, w: World, extra: Record<string, unknown> = {}): (req: Request) => Promise<Response> {
  const src: string = fs.readFileSync(`supabase/functions/${fnDir}/index.ts`, 'utf8');
  const js = transpile(src);
  let captured: ((req: Request) => Promise<Response>) | null = null;
  const scope = baseScope(w, extra);
  (scope.Deno as any).serve = (h: any) => { captured = h; };
  const imported = importedNames(src);
  const names = Object.keys(scope).filter((n) => ['Deno', 'console', 'fetch', 'crypto'].includes(n) || imported.has(n));
  new Function(...names, js)(...names.map((n) => scope[n]));
  if (!captured) throw new Error(`${fnDir}: Deno.serve was not called`);
  return captured;
}

// A module that exports plain functions (the webhook handlers).
export function loadModule(path: string, w: World, extra: Record<string, unknown> = {}): Record<string, any> {
  const src: string = fs.readFileSync(path, 'utf8');
  const js = transpile(src);
  const scope = baseScope(w, extra);
  const imported = importedNames(src);
  const names = Object.keys(scope).filter((n) => ['console', 'fetch', 'crypto'].includes(n) || imported.has(n));
  const mod: any = { exports: {} };
  new Function('exports', 'module', ...names, js)(mod.exports, mod, ...names.map((n) => scope[n]));
  return mod.exports;
}

export async function callHandler(handler: (req: Request) => Promise<Response>, body: Record<string, unknown>, bearer: string | null = ANON_KEY) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', origin: 'https://site.fake' };
  if (bearer !== null) headers.Authorization = `Bearer ${bearer}`;
  const res = await handler(new Request('https://fake.functions/x', { method: 'POST', headers, body: JSON.stringify(body) }));
  let json: any = null;
  try { json = await res.clone().json(); } catch { json = null; }
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------------------------------------------
// The scratch database that already holds the payment operation migration
// ---------------------------------------------------------------------------------------------------------------
export const PAY_MIGRATION = 'supabase/migrations/20261019120000_add_payment_operations_and_single_financial_application.sql';
// Applied after it, like a real deployment: deposit catch-up and the cash/check payment functions.
export const PAY_MIGRATION_2 = 'supabase/migrations/20261020120000_deposit_catch_up_and_offline_payment_parity.sql';
// ...and the server-authoritative staff order saves.
export const PAY_MIGRATION_3 = 'supabase/migrations/20261021120000_server_authoritative_order_pricing_saves.sql';
// ...and refund safety / financial write authority.
export const PAY_MIGRATION_4 = 'supabase/migrations/20261022120000_refund_safety_and_financial_write_authority.sql';
// ...and the refund component allocation columns and the read-only net financials function.
export const PAY_MIGRATION_5 = 'supabase/migrations/20261023120000_refund_allocation_schema.sql';
// ...and the allocation-aware refund reservation.
export const PAY_MIGRATION_6 = 'supabase/migrations/20261024120000_refund_allocation_reservation.sql';
// ...and the read-only refund overview the Admin refund screen uses.
export const PAY_MIGRATION_7 = 'supabase/migrations/20261025120000_refund_overview_for_admin.sql';

// Returns a working psql for a scratch database that holds this repository's payment migration (created from the base replay
// when absent; the migration text is idempotent and is re-applied on every run), or null when no database is reachable.
export function ensurePayDatabase(): { psql: string; db: string } | null {
  const dbBase = process.env.PAY_DB_BASE || 'role_full';
  const dbFull = process.env.PAY_DB_FULL || 'pay_full';
  const probeAny = "SELECT to_regclass('public.payments') IS NOT NULL";
  let basePsql: string | null = null;
  for (const c of PSQL_CANDIDATES) {
    const p = spawnSync(c, [...psqlArgs(dbBase), '-c', probeAny], { encoding: 'utf8', timeout: 15000 });
    if (p.status === 0 && p.stdout.trim() === 't') { basePsql = c; break; }
  }
  if (!basePsql) return null;
  let psql: string | null = null;
  for (const c of PSQL_CANDIDATES) {
    const p = spawnSync(c, [...psqlArgs(dbFull), '-c', probeAny], { encoding: 'utf8', timeout: 15000 });
    if (p.status === 0 && p.stdout.trim() === 't') { psql = c; break; }
  }
  if (!psql) {
    spawnSync(basePsql, [...psqlArgs('postgres'), '-c', `CREATE DATABASE ${dbFull} TEMPLATE ${dbBase}`], { encoding: 'utf8' });
    for (const c of PSQL_CANDIDATES) {
      const p = spawnSync(c, [...psqlArgs(dbFull), '-c', probeAny], { encoding: 'utf8', timeout: 15000 });
      if (p.status === 0 && p.stdout.trim() === 't') { psql = c; break; }
    }
  }
  if (!psql) return null;
  const applied = spawnSync(psql, [...psqlArgs(dbFull), '-v', 'ON_ERROR_STOP=1'], { input: fs.readFileSync(PAY_MIGRATION, 'utf8') + '\n' + fs.readFileSync(PAY_MIGRATION_2, 'utf8') + '\n' + fs.readFileSync(PAY_MIGRATION_3, 'utf8') + '\n' + fs.readFileSync(PAY_MIGRATION_4, 'utf8') + '\n' + fs.readFileSync(PAY_MIGRATION_5, 'utf8') + '\n' + fs.readFileSync(PAY_MIGRATION_6, 'utf8') + '\n' + fs.readFileSync(PAY_MIGRATION_7, 'utf8'), encoding: 'utf8' });
  return applied.status === 0 ? { psql, db: dbFull } : null;
}
