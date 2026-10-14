// Differential tests for the shared task_status get-or-create service (taskStatusService.ts).
//
// `oracleModal` and `oracleRoute` are verbatim copies of the old database algorithm in
// TaskDetailModal.ensureTaskStatus and RouteManagementModal.handleOptimize (the callers' own
// short-circuit guards are caller-side and are not part of the oracle). Both run against a fake
// client that RECORDS every builder call, so the exact query sequence is compared, not just results.
// The oracles never call the new service. `routeProjection` below is a copy of the projection that
// stays in RouteManagementModal, used to compare the Route oracle's final task shape.

import { getOrCreateTaskStatusRow } from '../../tasks/taskStatusService';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

function eq(label: string, actual: unknown, expected: unknown) {
  if (same(actual, expected)) { passed++; } else {
    failed++;
    console.error(`FAIL ${label}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

// Fake client: every builder call is appended to `ops`; each terminal call (maybeSingle / single)
// consumes the next scripted response.
type Resp = { data: any; error: any };
function fakeClient(script: Resp[]) {
  const ops: any[] = [];
  let i = 0;
  const next = (): Resp => {
    if (i >= script.length) throw new Error('script exhausted (unexpected extra query)');
    return script[i++];
  };
  const builder: any = {
    select(cols: string) { ops.push(['select', cols]); return builder; },
    eq(k: string, v: any) { ops.push(['eq', k, v]); return builder; },
    insert(payload: any) { ops.push(['insert', payload]); return builder; },
    maybeSingle() { ops.push(['maybeSingle']); return Promise.resolve(next()); },
    single() { ops.push(['single']); return Promise.resolve(next()); },
  };
  const client = { from(table: string) { ops.push(['from', table]); return builder; } };
  return { client, ops, remaining: () => script.length - i };
}

// ---- ORACLES (verbatim old algorithm; caller guards and Task mapping excluded) ----
async function oracleModal(client: any, task: any, dateStr: string): Promise<string> {
  const { data: existing, error: selectError } = await client
    .from('task_status')
    .select('id')
    .eq('order_id', task.orderId)
    .eq('task_type', task.type)
    .eq('task_date', dateStr)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing.id;

  const { data: inserted, error: insertError } = await client
    .from('task_status')
    .insert({
      order_id: task.orderId,
      task_type: task.type,
      task_date: dateStr,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: raceWinner, error: raceSelectError } = await client
        .from('task_status')
        .select('id')
        .eq('order_id', task.orderId)
        .eq('task_type', task.type)
        .eq('task_date', dateStr)
        .single();
      if (raceSelectError) throw raceSelectError;
      return raceWinner.id;
    }
    throw insertError;
  }

  return inserted.id;
}

const ROUTE_COLS = 'id, status, sort_order, completed_time, delivery_images, damage_images, eta_sent';

async function oracleRoute(client: any, task: any, dateStr: string, logged: any[]): Promise<any> {
  const { data: existing, error: selectError } = await client
    .from('task_status')
    .select('id, status, sort_order, completed_time, delivery_images, damage_images, eta_sent')
    .eq('order_id', task.orderId)
    .eq('task_type', task.type)
    .eq('task_date', dateStr)
    .maybeSingle();

  if (selectError) throw selectError;

  if (existing) {
    return {
      ...task,
      taskStatus: {
        id: existing.id,
        status: existing.status,
        sortOrder: existing.sort_order ?? null,
        completedTime: existing.completed_time ?? null,
        deliveryImages: (existing.delivery_images as any) || [],
        damageImages: (existing.damage_images as any) || [],
        etaSent: existing.eta_sent || false,
      },
    };
  }

  const { data: inserted, error: insertError } = await client
    .from('task_status')
    .insert({
      order_id: task.orderId,
      task_type: task.type,
      task_date: dateStr,
      status: 'pending',
    })
    .select('id, status, sort_order, completed_time, delivery_images, damage_images, eta_sent')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: raceWinner, error: raceSelectError } = await client
        .from('task_status')
        .select('id, status, sort_order, completed_time, delivery_images, damage_images, eta_sent')
        .eq('order_id', task.orderId)
        .eq('task_type', task.type)
        .eq('task_date', dateStr)
        .single();
      if (raceSelectError) throw raceSelectError;
      return {
        ...task,
        taskStatus: {
          id: raceWinner.id,
          status: raceWinner.status,
          sortOrder: raceWinner.sort_order ?? null,
          completedTime: raceWinner.completed_time ?? null,
          deliveryImages: (raceWinner.delivery_images as any) || [],
          damageImages: (raceWinner.damage_images as any) || [],
          etaSent: raceWinner.eta_sent || false,
        },
      };
    }
    logged.push(['Error creating task status:', insertError]);
    throw insertError;
  }

  return {
    ...task,
    taskStatus: {
      id: inserted.id,
      status: inserted.status,
      sortOrder: inserted.sort_order ?? null,
      completedTime: null,
      deliveryImages: [] as string[],
      damageImages: [] as string[],
      etaSent: false,
    },
  };
}

// Copy of the Route-side projection that remains in RouteManagementModal after the extraction.
async function newRoute(client: any, task: any, dateStr: string, logged: any[]): Promise<any> {
  const { row, created } = await getOrCreateTaskStatusRow(client, {
    orderId: task.orderId,
    taskType: task.type,
    taskDate: dateStr,
    select: ROUTE_COLS,
    onInsertError: (insertError) => logged.push(['Error creating task status:', insertError]),
  });
  if (created) {
    return {
      ...task,
      taskStatus: {
        id: row.id,
        status: row.status,
        sortOrder: row.sort_order ?? null,
        completedTime: null,
        deliveryImages: [] as string[],
        damageImages: [] as string[],
        etaSent: false,
      },
    };
  }
  return {
    ...task,
    taskStatus: {
      id: row.id,
      status: row.status,
      sortOrder: row.sort_order ?? null,
      completedTime: row.completed_time ?? null,
      deliveryImages: (row.delivery_images as any) || [],
      damageImages: (row.damage_images as any) || [],
      etaSent: row.eta_sent || false,
    },
  };
}

async function settle<T>(p: Promise<T>): Promise<{ v?: T; e?: any }> {
  try { return { v: await p }; } catch (e) { return { e }; }
}

const task = { orderId: 'ord-1', type: 'drop-off', id: 't1', customerName: 'A' };
const DATE = '2026-07-04';
const full = (over: any = {}) => ({ id: 'ts-1', status: 'pending', sort_order: 3, completed_time: '2026-07-04T10:00:00Z', delivery_images: ['a'], damage_images: ['b'], eta_sent: true, ...over });
const idOnly = (id = 'ts-1') => ({ id });
const E = (code?: string, message = 'boom') => ({ code, message });

interface Scenario { name: string; modal: Resp[]; route: Resp[] }
const scenarios: Scenario[] = [
  { name: 'existing row', modal: [{ data: idOnly(), error: null }], route: [{ data: full(), error: null }] },
  { name: 'existing row with null optional columns', modal: [{ data: idOnly(), error: null }], route: [{ data: full({ sort_order: null, completed_time: null, delivery_images: null, damage_images: null, eta_sent: null }), error: null }] },
  { name: 'new row', modal: [{ data: null, error: null }, { data: idOnly('new-1'), error: null }], route: [{ data: null, error: null }, { data: full({ id: 'new-1', sort_order: null }), error: null }] },
  { name: 'new row, insert returns extra values (route ignores them)', modal: [{ data: null, error: null }, { data: idOnly('new-2'), error: null }], route: [{ data: null, error: null }, { data: full({ id: 'new-2', completed_time: 'x', delivery_images: ['z'], eta_sent: true }), error: null }] },
  { name: 'race (23505) then winner', modal: [{ data: null, error: null }, { data: null, error: E('23505') }, { data: idOnly('win-1'), error: null }], route: [{ data: null, error: null }, { data: null, error: E('23505') }, { data: full({ id: 'win-1', status: 'en_route' }), error: null }] },
  { name: 'initial select error', modal: [{ data: null, error: E('XX000', 'sel') }], route: [{ data: null, error: E('XX000', 'sel') }] },
  { name: 'non-23505 insert error', modal: [{ data: null, error: null }, { data: null, error: E('23502', 'ins') }], route: [{ data: null, error: null }, { data: null, error: E('23502', 'ins') }] },
  { name: 'insert error without a code', modal: [{ data: null, error: null }, { data: null, error: E(undefined, 'ins2') }], route: [{ data: null, error: null }, { data: null, error: E(undefined, 'ins2') }] },
  { name: 'race select error', modal: [{ data: null, error: null }, { data: null, error: E('23505') }, { data: null, error: E('PGRST116', 'race') }], route: [{ data: null, error: null }, { data: null, error: E('23505') }, { data: null, error: E('PGRST116', 'race') }] },
];

(async () => {
  for (const sc of scenarios) {
    for (const type of ['drop-off', 'pick-up']) {
      const t = { ...task, type };
      // Modal projection
      {
        const o = fakeClient(sc.modal); const n = fakeClient(sc.modal);
        const ro = await settle(oracleModal(o.client, t, DATE));
        const rn = await settle((async () => (await getOrCreateTaskStatusRow(n.client, { orderId: t.orderId, taskType: t.type, taskDate: DATE, select: 'id' })).row.id)());
        ok(`modal ${sc.name} (${type}): identical query sequence`, same(o.ops, n.ops));
        ok(`modal ${sc.name} (${type}): same result or same thrown error`, same(ro.v, rn.v) && ro.e === rn.e || (ro.e && rn.e && ro.e.message === rn.e.message && ro.e.code === rn.e.code));
        ok(`modal ${sc.name} (${type}): all scripted responses consumed identically`, o.remaining() === n.remaining());
      }
      // Route projection
      {
        const o = fakeClient(sc.route); const n = fakeClient(sc.route);
        const lo: any[] = []; const ln: any[] = [];
        const ro = await settle(oracleRoute(o.client, t, DATE, lo));
        const rn = await settle(newRoute(n.client, t, DATE, ln));
        ok(`route ${sc.name} (${type}): identical query sequence`, same(o.ops, n.ops));
        ok(`route ${sc.name} (${type}): identical task projection`, same(ro.v, rn.v));
        ok(`route ${sc.name} (${type}): same thrown error`, (!ro.e && !rn.e) || (ro.e && rn.e && ro.e.message === rn.e.message && ro.e.code === rn.e.code));
        ok(`route ${sc.name} (${type}): same caller-level log`, same(lo, ln));
      }
    }
  }

  // ---- Explicit contract pins ----
  {
    const f = fakeClient([{ data: { id: 'x', status: 'completed' }, error: null }]);
    const r = await getOrCreateTaskStatusRow(f.client, { orderId: 'o', taskType: 'pick-up', taskDate: '2026-01-02', select: 'id, status' });
    eq('existing: exact queries', f.ops, [
      ['from', 'task_status'], ['select', 'id, status'], ['eq', 'order_id', 'o'], ['eq', 'task_type', 'pick-up'], ['eq', 'task_date', '2026-01-02'], ['maybeSingle'],
    ]);
    eq('existing: raw row returned, not created', r, { row: { id: 'x', status: 'completed' }, created: false });
  }
  {
    const f = fakeClient([{ data: null, error: null }, { data: { id: 'n' }, error: null }]);
    const r = await getOrCreateTaskStatusRow(f.client, { orderId: 'o', taskType: 'drop-off', taskDate: '2026-01-02', select: 'id' });
    eq('new: exact queries', f.ops, [
      ['from', 'task_status'], ['select', 'id'], ['eq', 'order_id', 'o'], ['eq', 'task_type', 'drop-off'], ['eq', 'task_date', '2026-01-02'], ['maybeSingle'],
      ['from', 'task_status'], ['insert', { order_id: 'o', task_type: 'drop-off', task_date: '2026-01-02', status: 'pending' }], ['select', 'id'], ['single'],
    ]);
    eq('new: row returned and flagged created', r, { row: { id: 'n' }, created: true });
  }
  {
    const f = fakeClient([{ data: null, error: null }, { data: null, error: E('23505') }, { data: { id: 'w' }, error: null }]);
    const r = await getOrCreateTaskStatusRow(f.client, { orderId: 'o', taskType: 'drop-off', taskDate: '2026-01-02', select: 'id, eta_sent' });
    eq('race: re-select uses same projection and identity filters with .single()', f.ops.slice(10), [
      ['from', 'task_status'], ['select', 'id, eta_sent'], ['eq', 'order_id', 'o'], ['eq', 'task_type', 'drop-off'], ['eq', 'task_date', '2026-01-02'], ['single'],
    ]);
    eq('race: winner returned, not flagged created', r, { row: { id: 'w' }, created: false });
  }
  {
    const calls: any[] = [];
    const f = fakeClient([{ data: null, error: null }, { data: null, error: E('23505') }, { data: { id: 'w' }, error: null }]);
    await getOrCreateTaskStatusRow(f.client, { orderId: 'o', taskType: 't', taskDate: 'd', select: 'id', onInsertError: (e) => calls.push(e) });
    eq('onInsertError is not called for a 23505 race', calls, []);
    const f2 = fakeClient([{ data: null, error: null }, { data: null, error: E('23502', 'ins') }]);
    const r2 = await settle(getOrCreateTaskStatusRow(f2.client, { orderId: 'o', taskType: 't', taskDate: 'd', select: 'id', onInsertError: (e) => calls.push(e) }));
    ok('non-23505 insert error throws the raw error', r2.e && r2.e.code === '23502');
    eq('onInsertError called once with the raw error', calls, [E('23502', 'ins')]);
    const f3 = fakeClient([{ data: null, error: E('X', 'sel') }]);
    const calls3: any[] = [];
    const r3 = await settle(getOrCreateTaskStatusRow(f3.client, { orderId: 'o', taskType: 't', taskDate: 'd', select: 'id', onInsertError: (e) => calls3.push(e) }));
    ok('select error throws', r3.e && r3.e.message === 'sel');
    eq('onInsertError not called for select error', calls3, []);
    const f4 = fakeClient([{ data: null, error: null }, { data: null, error: E('23505') }, { data: null, error: E('P', 'race') }]);
    const calls4: any[] = [];
    const r4 = await settle(getOrCreateTaskStatusRow(f4.client, { orderId: 'o', taskType: 't', taskDate: 'd', select: 'id', onInsertError: (e) => calls4.push(e) }));
    ok('race select error throws', r4.e && r4.e.message === 'race');
    eq('onInsertError not called for race select error', calls4, []);
  }

  console.log(`Task status service differential tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} task status service test(s) failed`);
})();
