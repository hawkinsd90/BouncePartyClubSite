// Characterization tests for getRoutePool.
//
// The oracle below is a verbatim copy of the code that lived inline in
// TaskDetailModal before the extraction (both duplicated filters, the fallback and
// the in-place sort). It never calls getRoutePool. The two inline copies of the
// pool filter were compared line by line and were identical, which is why one
// helper covers both. Behavior is pinned as it was, including oddities:
// ties keep input order (stable sort), duplicates are not removed, and nothing is
// validated.

import { getRoutePool } from './taskRoutePool';
import { isTaskActiveRouteStop } from '../../../lib/tasks/calendarUtils';
import type { Task } from '../../../hooks/useCalendarTasks';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; console.error(`FAIL ${label}\n  actual:   ${a}\n  expected: ${e}`); }
}

// ---- Oracle: verbatim pre-extraction code ----
function oracle(task: Task, allTasks: Task[]) {
  const activeRouteStops = allTasks.filter(
    t => t.type === task.type && isTaskActiveRouteStop(t) && t.taskStatus?.sortOrder != null
  );
  const activeStopsCount = activeRouteStops.length > 0
    ? activeRouteStops.length
    : allTasks.filter(t => t.type === task.type && isTaskActiveRouteStop(t)).length;

  const activeRoutePool = allTasks.filter(
    t => t.type === task.type && isTaskActiveRouteStop(t) && t.taskStatus?.sortOrder != null
  );
  const tasksOfSameType = (activeRoutePool.length > 0 ? activeRoutePool : allTasks.filter(
    t => t.type === task.type && isTaskActiveRouteStop(t)
  )).sort((a, b) => (a.taskStatus?.sortOrder ?? 0) - (b.taskStatus?.sortOrder ?? 0));
  return { activeStopsCount, tasksOfSameType };
}

// ---- Fixtures ----
type Opts = {
  type?: 'drop-off' | 'pick-up';
  status?: string;
  ready?: string;
  ts?: 'none' | { status?: string; sortOrder?: number | null };
};

function mk(id: string, o: Opts = {}): Task {
  const type = o.type ?? 'drop-off';
  const t: Record<string, unknown> = {
    id,
    type,
    status: o.status ?? 'confirmed',
    pickupReadiness: 'ready' in o ? o.ready : (type === 'pick-up' ? 'ready' : undefined),
  };
  if (o.ts && o.ts !== 'none') t.taskStatus = { id: 'ts-' + id, status: 'pending', sortOrder: null, ...o.ts };
  return t as unknown as Task;
}

const ids = (ts: Task[]) => ts.map(t => t.id);

function same(label: string, task: Task, all: Task[]) {
  const before = ids(all);
  const expected = oracle(task, all.slice());
  const actual = getRoutePool(task, all);
  eq(`${label}: activeStopsCount`, actual.activeStopsCount, expected.activeStopsCount);
  eq(`${label}: pool ids`, ids(actual.tasksOfSameType), ids(expected.tasksOfSameType));
  eq(`${label}: input array order untouched`, ids(all), before);
}

// 1. Empty input
same('empty', mk('x'), []);
eq('empty result', getRoutePool(mk('x'), []), { activeStopsCount: 0, tasksOfSameType: [] });

// 2. Saved route order: only tasks with a sortOrder form the pool; sorted ascending
{
  const all = [
    mk('a', { ts: { sortOrder: 3 } }),
    mk('b', { ts: { sortOrder: 1 } }),
    mk('c', { ts: { sortOrder: 2 } }),
    mk('d'), // no taskStatus at all -> excluded from the saved-order pool
    mk('e', { ts: { sortOrder: null } }), // null sortOrder -> excluded
  ];
  same('saved order', all[0], all);
  eq('saved order ids', ids(getRoutePool(all[0], all).tasksOfSameType), ['b', 'c', 'a']);
  eq('saved order count', getRoutePool(all[0], all).activeStopsCount, 3);
}

// 3. No saved order: fall back to every active stop of the same type, sorted by (sortOrder ?? 0) => input order
{
  const all = [mk('a'), mk('b', { ts: { sortOrder: null } }), mk('c', { ts: { status: 'en_route', sortOrder: null } })];
  same('fallback', all[0], all);
  eq('fallback ids', ids(getRoutePool(all[0], all).tasksOfSameType), ['a', 'b', 'c']);
  eq('fallback count', getRoutePool(all[0], all).activeStopsCount, 3);
}

// 4. Type filter
{
  const all = [mk('d1', { ts: { sortOrder: 1 } }), mk('p1', { type: 'pick-up', ts: { sortOrder: 1 } }), mk('d2', { ts: { sortOrder: 2 } })];
  same('type drop-off', all[0], all);
  same('type pick-up', all[1], all);
  eq('drop-off ids', ids(getRoutePool(all[0], all).tasksOfSameType), ['d1', 'd2']);
  eq('pick-up ids', ids(getRoutePool(all[1], all).tasksOfSameType), ['p1']);
}

// 5. Status filters (drop-off): completed and pending_review are not active route stops
{
  const all = [
    mk('ok1', { ts: { sortOrder: 2 } }),
    mk('done', { ts: { status: 'completed', sortOrder: 1 } }),
    mk('pending', { status: 'pending_review', ts: { sortOrder: 0 } }),
    mk('ok2', { ts: { sortOrder: 5 } }),
  ];
  same('drop-off status', all[0], all);
  eq('drop-off status ids', ids(getRoutePool(all[0], all).tasksOfSameType), ['ok1', 'ok2']);
}

// 6. Status filters (pick-up): only pickupReadiness === 'ready'
{
  const all = [
    mk('r1', { type: 'pick-up', ready: 'ready', ts: { sortOrder: 2 } }),
    mk('nr', { type: 'pick-up', ready: 'not_ready', ts: { sortOrder: 1 } }),
    mk('r2', { type: 'pick-up', ready: 'ready' }),
    mk('nu', { type: 'pick-up', ready: undefined as unknown as string, ts: { sortOrder: 0 } }),
  ];
  same('pick-up readiness', all[0], all);
  eq('pick-up ids', ids(getRoutePool(all[0], all).tasksOfSameType), ['r1']);
  eq('pick-up count', getRoutePool(all[0], all).activeStopsCount, 1);
}

// 7. Boundary: a completed task is excluded even when it is the only one with an order; falls back
{
  const all = [mk('a', { ts: { status: 'completed', sortOrder: 1 } }), mk('b'), mk('c')];
  same('only ordered is inactive', all[1], all);
  eq('fallback after exclusion', ids(getRoutePool(all[1], all).tasksOfSameType), ['b', 'c']);
}

// 8. sortOrder 0 is a saved order (only null/undefined are excluded, != null)
{
  const all = [mk('a', { ts: { sortOrder: 0 } }), mk('b')];
  same('sortOrder zero', all[0], all);
  eq('sortOrder zero ids', ids(getRoutePool(all[0], all).tasksOfSameType), ['a']);
}

// 9. Ties keep input order (stable sort); duplicates are not removed
{
  const all = [mk('t1', { ts: { sortOrder: 2 } }), mk('t2', { ts: { sortOrder: 2 } }), mk('t3', { ts: { sortOrder: 1 } }), mk('t1', { ts: { sortOrder: 2 } })];
  same('ties and duplicates', all[0], all);
  eq('ties ids', ids(getRoutePool(all[0], all).tasksOfSameType), ['t3', 't1', 't2', 't1']);
  eq('duplicates counted', getRoutePool(all[0], all).activeStopsCount, 4);
}

// 10. The current task itself need not be in the list; only its type is read
{
  const all = [mk('a', { ts: { sortOrder: 1 } })];
  same('task not in list', mk('zzz'), all);
  const r = getRoutePool({ type: 'pick-up' }, all);
  eq('other type empty', r, { activeStopsCount: 0, tasksOfSameType: [] });
}

// 11. The returned pool is a fresh array (never the input array)
{
  const all = [mk('a', { ts: { sortOrder: 1 } })];
  ok('fresh array', getRoutePool(all[0], all).tasksOfSameType !== all);
}

// 12. Mixed everything, differential
{
  const all = [
    mk('d3', { ts: { sortOrder: 3 } }), mk('p2', { type: 'pick-up', ts: { sortOrder: 9 } }),
    mk('d1', { ts: { sortOrder: 1 } }), mk('d0'), mk('dc', { ts: { status: 'completed', sortOrder: 2 } }),
    mk('dp', { status: 'pending_review', ts: { sortOrder: 4 } }), mk('p1', { type: 'pick-up' }),
  ];
  for (const t of all) same('mixed ' + t.id, t, all);
}

console.log(`Task route pool tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} route pool test(s) failed`);
