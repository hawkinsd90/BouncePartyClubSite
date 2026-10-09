// Test-only harness for the Customer Portal Edge Functions (Payment Safety A2.2).
//
// Loads an Edge Function's CURRENT source text, strips its imports, transpiles it, and runs it with an in-memory
// database plus the REAL shared helpers. Nothing here touches a network or a real database. It models only the query
// features the portal functions use (eq / neq / is / in filters, joins to orders, order, limit, insert, update, delete).

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');
const ts = require('typescript');

import * as authHelpers from '../../supabase/functions/_shared/auth';
import * as projection from '../../supabase/functions/_shared/portal-projection';
import * as actions from '../../supabase/functions/_shared/portal-actions';
import * as portalLink from '../../supabase/functions/_shared/portal-link';
import * as lifecycleOutcome from '../../supabase/functions/_shared/lifecycle-outcome';
import * as mediaPaths from '../../supabase/functions/_shared/media-paths';
import * as evidenceMedia from '../../supabase/functions/_shared/evidence-media';

export type Row = Record<string, any>;

export interface Write {
  op: 'insert' | 'update' | 'delete';
  table: string;
  payload?: Row;
  filters?: Array<[string, string, unknown]>;
}

export interface Db {
  tables: Record<string, Row[]>;
  writes: Write[];
  storageRemoved: string[];
  // Signed URLs the fake Storage handed out, as "bucket:path" (a path is signed only when asked for).
  storageSigned: string[];
  // Objects the fake Storage accepted, as "bucket:path".
  storageUploads: string[];
  // Objects the fake Storage handed out for download, as "bucket:path".
  storageDownloads: string[];
  // Upload authorizations the fake Storage issued, as "bucket:path", and the objects that currently exist, as "bucket:path".
  storageUploadGrants: string[];
  storageObjects: string[];
  // Buckets that are private: a client that is not the service role cannot read or sign their objects.
  privateBuckets: string[];
  rpcResults: Record<string, any>;
  invokes: Array<{ name: string; opts: any }>;
  seq: number;
}

export const SERVICE_KEY = 'svc-key-0123456789abcdef';
export const ANON_KEY = 'anon-key-0123456789abcdef';
export const NOW = new Date('2026-10-09T12:00:00Z');
export const FUTURE = '2027-06-01T00:00:00Z';
export const PAST = '2026-01-01T00:00:00Z';

export const USERS: Record<string, string> = {
  'jwt-A': 'u-cust-A',
  'jwt-B': 'u-cust-B',
  'jwt-none': 'u-none',
  'jwt-admin': 'u-admin',
  'jwt-master': 'u-master',
  'jwt-crew': 'u-crew',
};

export const tokenFor = (id: string) => (`tok-${id}-`.replace(/[^A-Za-z0-9-]/g, 'x') + 'z'.repeat(64)).slice(0, 64);

export function newDb(): Db {
  return {
    tables: {
      orders: [],
      customers: [
        { id: 'cust-A', first_name: 'Ann', last_name: 'Adams', email: 'ann@example.test', phone: '+15555550101', business_name: null, user_id: 'u-cust-A', oauth_profile_data: { secret: 'oauth-secret' }, default_address_id: 'addr-A' },
        { id: 'cust-B', first_name: 'Bo', last_name: 'Burns', email: 'bo@example.test', phone: '+15555550102', business_name: null, user_id: 'u-cust-B', oauth_profile_data: null, default_address_id: null },
      ],
      addresses: [
        { id: 'addr-A', line1: '1 Main St', line2: null, city: 'Detroit', state: 'MI', zip: '48201', lat: 42.3, lng: -83.0, customer_id: 'cust-A', internal_note: 'gate code 1234' },
        { id: 'addr-B', line1: '2 Oak St', line2: null, city: 'Troy', state: 'MI', zip: '48083', lat: 42.6, lng: -83.1, customer_id: 'cust-B', internal_note: 'dog' },
      ],
      payments: [],
      order_items: [],
      order_discounts: [],
      order_custom_fees: [],
      order_changelog: [],
      order_lot_pictures: [],
      order_pictures: [],
      order_signatures: [],
      task_status: [],
      invoice_links: [],
      pricing_rules: [{ id: 'pr-1', base_radius_miles: 10, per_mile_after_base_cents: 250, same_day_pickup_fee_cents: 10500, generator_price_cents: 9500, surface_sandbag_fee_cents: 3500, same_day_weekday_delivery_fee_cents: 0 }],
      admin_settings: [{ key: 'admin_email', value: 'admin@example.test' }, { key: 'stripe_secret_key', value: 'sk_test_x' }],
      user_roles: [
        { user_id: 'u-admin', role: 'admin' },
        { user_id: 'u-master', role: 'master' },
        { user_id: 'u-crew', role: 'crew' },
        { user_id: 'u-cust-A', role: 'customer' },
        { user_id: 'u-cust-B', role: 'customer' },
      ],
    },
    writes: [],
    storageRemoved: [],
    storageSigned: [],
    storageUploads: [],
    storageDownloads: [],
    storageUploadGrants: [],
    storageObjects: [],
    privateBuckets: [],
    invokes: [],
    rpcResults: { check_date_blackout: { is_full_blocked: false, is_same_day_pickup_blocked: false } },
    seq: 0,
  };
}

function valueAt(row: Row, col: string): any {
  return col.split('.').reduce((acc: any, part) => (acc == null ? undefined : acc[part]), row);
}

function matches(row: Row, filters: Array<[string, string, unknown]>): boolean {
  return filters.every(([op, col, val]) => {
    const v = valueAt(row, col);
    if (op === 'eq') return v === val;
    if (op === 'neq') return v !== val;
    if (op === 'is') return (v ?? null) === val;
    if (op === 'in') return (val as unknown[]).includes(v);
    if (op === 'nin') return !(val as unknown[]).includes(v);
    return false;
  });
}

export interface ClientContext {
  // Authorization header the client was created with (a caller-scoped client), and the key it was created with.
  bearer?: string | null;
  key?: string;
}

export function makeClient(db: Db, ctx: ClientContext = {}): any {
  // A private bucket answers only the service role; a caller-scoped client has no Storage access to it.
  const mayRead = (bucket: string) => !db.privateBuckets.includes(bucket) || ctx.key === undefined || ctx.key === SERVICE_KEY;
  const notAllowed = { data: null, error: { message: 'Object not found' } };
  return {
    auth: {
      getUser: async (token?: string) => {
        const id = USERS[token ?? String(ctx.bearer ?? '').replace(/^Bearer\s+/i, '')];
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
      },
    },
    functions: {
      invoke: async (name: string, opts: any) => {
        db.invokes.push({ name, opts });
        return { data: {}, error: null };
      },
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          db.storageRemoved.push(...paths.map((p) => `${bucket}:${p}`));
          db.storageObjects = db.storageObjects.filter((o) => !paths.some((p) => o === `${bucket}:${p}`));
          return { error: null };
        },
        createSignedUploadUrl: async (path: string) => {
          db.storageUploadGrants.push(`${bucket}:${path}`);
          return { data: { signedUrl: `https://fake.supabase.co/storage/v1/object/upload/sign/${bucket}/${path}?token=UP`, token: `UP:${bucket}:${path}`, path }, error: null };
        },
        list: async (folder: string, opts?: { limit?: number }) => {
          const prefix = `${bucket}:${folder}/`;
          const names = db.storageObjects.filter((o) => o.startsWith(prefix) && !o.slice(prefix.length).includes('/')).map((o) => ({ name: o.slice(prefix.length) }));
          return { data: opts?.limit ? names.slice(0, opts.limit) : names, error: null };
        },
        upload: async (path: string) => {
          db.storageUploads.push(`${bucket}:${path}`);
          return { data: { path }, error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        download: async (path: string) => {
          if (!mayRead(bucket)) return notAllowed;
          db.storageDownloads.push(`${bucket}:${path}`);
          return { data: { arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }, error: null };
        },
        createSignedUrl: async (path: string, expiresIn: number) => {
          if (!mayRead(bucket)) return notAllowed;
          db.storageSigned.push(`${bucket}:${path}`);
          return { data: { signedUrl: `https://fake.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=T&ttl=${expiresIn}` }, error: null };
        },
      }),
    },
    rpc: (name: string) => {
      const result = { data: db.rpcResults[name] ?? null, error: null };
      return { maybeSingle: async () => result, then: (res: any, rej: any) => Promise.resolve(result).then(res, rej) };
    },
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let mode: 'select' | 'update' | 'insert' | 'delete' = 'select';
      let payload: Row | Row[] = {};
      let selectStr = '*';
      let orderCol: string | null = null;
      let ascending = true;
      let limitN: number | null = null;
      let insertThenSelect = false;

      const base = (): Row[] => {
        let rows = (db.tables[table] ?? []).filter((r) => matches(withJoin(r), filters));
        if (orderCol) {
          const col = orderCol;
          rows = [...rows].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : 1) * (ascending ? 1 : -1));
        }
        return limitN !== null ? rows.slice(0, limitN) : rows;
      };
      const withJoin = (r: Row): Row => (selectStr.includes('orders!inner') ? { ...r, orders: db.tables.orders.find((o) => o.id === r.order_id) ?? null } : r);

      const q: any = {
        select(s?: string) {
          if (mode === 'insert') insertThenSelect = true;
          else if (s) selectStr = s;
          return q;
        },
        eq: (c: string, v: unknown) => (filters.push(['eq', c, v]), q),
        neq: (c: string, v: unknown) => (filters.push(['neq', c, v]), q),
        is: (c: string, v: unknown) => (filters.push(['is', c, v]), q),
        in: (c: string, v: unknown[]) => (filters.push(['in', c, v]), q),
        not: (c: string, op: string, v: string) => (filters.push([op === 'in' ? 'nin' : 'neq', c, op === 'in' ? String(v).replace(/[()"]/g, '').split(',') : v]), q),
        order: (c: string, o?: { ascending?: boolean }) => ((orderCol = c), (ascending = o?.ascending !== false), q),
        limit: (n: number) => ((limitN = n), q),
        update: (p: Row) => ((mode = 'update'), (payload = p), q),
        insert: (p: Row | Row[]) => ((mode = 'insert'), (payload = p), q),
        delete: () => ((mode = 'delete'), q),
        async maybeSingle() {
          return q.single();
        },
        async single() {
          if (mode === 'insert') {
            const inserted = doInsert();
            return { data: insertThenSelect ? inserted[0] : null, error: null };
          }
          const rows = base().map(withJoin);
          // A read is a snapshot: later writes must not change what the caller already holds.
          return { data: rows[0] ? { ...rows[0] } : null, error: null };
        },
        then(resolve: any, reject: any) {
          let result: any;
          if (mode === 'update') {
            db.writes.push({ op: 'update', table, payload: payload as Row, filters: [...filters] });
            for (const r of base()) Object.assign(r, payload);
            result = { error: null };
          } else if (mode === 'delete') {
            db.writes.push({ op: 'delete', table, filters: [...filters] });
            const doomed = base();
            db.tables[table] = (db.tables[table] ?? []).filter((r) => !doomed.includes(r));
            result = { error: null };
          } else if (mode === 'insert') {
            doInsert();
            result = { error: null };
          } else {
            result = { data: base().map(withJoin), error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };

      function doInsert(): Row[] {
        const list = Array.isArray(payload) ? payload : [payload];
        const created = list.map((r) => ({ id: `row-${++db.seq}`, ...r }));
        db.writes.push({ op: 'insert', table, payload: list.length === 1 ? list[0] : (list as any) });
        (db.tables[table] ??= []).push(...created);
        return created;
      }
      return q;
    },
  };
}

export interface Harness {
  db: Db;
  logs: string[];
  fetches: Array<{ url: string; init: any }>;
  stripeSessions: Record<string, any>;
  // Background work an Edge Function hands to EdgeRuntime.waitUntil.
  pending: Array<Promise<unknown>>;
}

export const makeHarness = (db: Db = newDb()): Harness => ({ db, logs: [], fetches: [], stripeSessions: {}, pending: [] });

// Transpiling an Edge Function is the slow part of loading it, and handler tests load the same function once per request, so the
// output is cached by source text (a changed file is a different key, so a mutated source is never served a stale result).
const transpiled = new Map<string, string>();

export function loadFunction(fnDir: string, h: Harness): (req: Request) => Promise<Response> {
  const src: string = fs.readFileSync(`supabase/functions/${fnDir}/index.ts`, 'utf8');
  let js = transpiled.get(src);
  if (js === undefined) {
    js = ts.transpileModule(src.replace(/^import[^;]*;/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText as string;
    transpiled.set(src, js);
  }
  let captured: any = null;
  const env: Record<string, string> = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY };
  const scope: Record<string, unknown> = {
    Deno: { env: { get: (k: string) => env[k] }, serve: (fn: any) => { captured = fn; } },
    createClient: (_url: string, key: string, opts?: any) => makeClient(h.db, { bearer: opts?.global?.headers?.Authorization, key }),
    corsHeaders: {},
    handleCorsPreflightSync: (req: Request) => (req.method === 'OPTIONS' ? new Response(null, { status: 200 }) : null),
    EdgeRuntime: { waitUntil: (p: Promise<unknown>) => { h.pending.push(p); } },
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
    ...projection,
    ...actions,
    ...portalLink,
    ...lifecycleOutcome,
    ...mediaPaths,
    ...evidenceMedia,
    formatCurrency: (c: number) => `$${((c ?? 0) / 100).toFixed(2)}`,
    formatOrderId: (id: string) => String(id).slice(0, 8),
    Stripe: class {},
  };
  const imported = new Set<string>();
  for (const m of src.matchAll(/^import([^;]*);/gm)) {
    for (const id of m[1].replace(/from\s+['"][^'"]*['"]/, '').match(/[A-Za-z_$][\w$]*/g) ?? []) imported.add(id);
  }
  const names = Object.keys(scope).filter((n) => ['Deno', 'console', 'fetch', 'EdgeRuntime'].includes(n) || imported.has(n));
  new Function(...names, js)(...names.map((n) => scope[n]));
  if (!captured) throw new Error(`${fnDir}: Deno.serve was not called`);
  return captured;
}

export async function callFunction(handler: (r: Request) => Promise<Response>, bearer: string | null, body: unknown, method = 'POST') {
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

// An order in the fixture, with a portal link, an expired link and a revoked link (all bound to this order).
export function addOrder(db: Db, spec: { id: string; customer: 'cust-A' | 'cust-B'; address?: string; status: string } & Row): Row {
  const { id, customer, status, address, ...rest } = spec;
  const order: Row = {
    id,
    customer_id: customer,
    address_id: address ?? (customer === 'cust-A' ? 'addr-A' : 'addr-B'),
    status,
    event_date: '2026-11-10',
    event_end_date: '2026-11-10',
    start_window: '10:00',
    end_window: '12:00',
    subtotal_cents: 20000,
    deposit_due_cents: 5000,
    balance_due_cents: 15000,
    deposit_paid_cents: 0,
    balance_paid_cents: 0,
    tax_cents: 0,
    tip_cents: 0,
    pickup_preference: 'same_day',
    require_card_on_file: true,
    stripe_customer_id: 'cus_secret_123',
    stripe_payment_method_id: 'pm_secret_123',
    payment_method_id: 'pm_internal',
    payment_lock: 'lock-1',
    waiver_signature_data: 'data:image/png;base64,SECRETSIG',
    signed_waiver_url: 'https://storage/signed.pdf',
    edit_summary: 'staff edit note',
    tax_waive_reason: 'staff reason',
    pending_review_admin_alerted: true,
    billing_address_line1: '9 Billing Rd',
    cancelled_by: 'u-admin',
    current_eta: '10:05',
    total_refunded_cents: 0,
    damage_charged_cents: 0,
    ...rest,
  };
  db.tables.orders.push(order);
  const mk = (suffix: string, type: string, expires: string, revoked: string | null) =>
    db.tables.invoice_links.push({ id: `link-${suffix}-${id}`, order_id: id, link_type: type, link_token: tokenFor(`${suffix}-${id}`), short_code: `SC${suffix}${id}`.slice(0, 12), expires_at: expires, revoked_at: revoked, customer_filled: false, deposit_cents: 0 });
  mk('p', 'portal', FUTURE, null);
  mk('e', 'portal', PAST, null);
  mk('r', 'portal', FUTURE, PAST);
  return order;
}
