// Differential characterization tests for generatorStagedItems.
//
// The oracle functions below are verbatim copies of the code that lived inline in
// OrderDetailModal.handleGeneratorQtyChange before the extraction: the
// directByNewest sort, the decrease updater (INCLUDING its mutable
// `remainingDirectReduction` closure variable, modeled the way the parent holds
// it) and the resolution.status === 'ee' updater. They never call the helpers.
// The only adaptation: the inline `Date.now()` / `Math.random()` ID template is
// replaced by an injected factory so the tests are deterministic and can count calls.
//
// These tests pin CURRENT behavior, including oddities (see generatorStagedItems.ts):
// a repeated updater call sees an already-consumed budget, keyless rows never
// receive a reduction, NaN comparators skip the id tie-break, and so on. They are
// not a statement of desired behavior.

import {
  sortDirectGeneratorItemsNewestFirst,
  reduceDirectGeneratorItems,
  applyGeneratorEeCandidate,
} from './generatorStagedItems';
import type { GeneratorCandidateProduct } from './generatorStagedItems';
import type { StagedItem } from './stagedItemModel';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

// Strict structural equality: NaN equals NaN, and an own property whose value
// is undefined is different from a missing property.
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

function idFactory(prefix: string) {
  let n = 0;
  const make = () => `${prefix}-${++n}`;
  return { make, calls: () => n };
}

// ---------------------------------------------------------------------------
// ORACLE: verbatim copies of the pre-extraction inline code.
// ---------------------------------------------------------------------------

function oracleSort(directItems: StagedItem[], stagedItems: StagedItem[]): StagedItem[] {
  const directByNewest = [...directItems].sort((a, b) => {
    const aNew = a.is_new ? 1 : 0;
    const bNew = b.is_new ? 1 : 0;
    if (aNew !== bNew) return bNew - aNew;
    if (aNew && bNew) {
      // Both unsaved: higher stagedItems index is newer.
      // directItems is filtered from stagedItems so preserves relative order.
      const aIdx = stagedItems.indexOf(a);
      const bIdx = stagedItems.indexOf(b);
      return bIdx - aIdx;
    }
    // Both persisted: created_at descending, then id descending.
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return (b.id || '').localeCompare(a.id || '');
  });
  return directByNewest;
}

// Models the parent: `let remainingDirectReduction` lives OUTSIDE the updater and is
// mutated inside it. `run` is the updater passed to setStagedItems.
function oracleUpdater(directByNewest: StagedItem[], budget: number) {
  let remainingDirectReduction = budget;
  const run = (previous: StagedItem[]): StagedItem[] => {
    const orderedKeys = directByNewest.map((item) => item.id || item.client_id).filter((k): k is string => !!k);
    const keySet = new Set(orderedKeys);
    const reductionByKey = new Map<string, number>();
    for (const key of orderedKeys) {
      if (remainingDirectReduction <= 0) break;
      const item = previous.find((i) => (i.id || i.client_id) === key && keySet.has(key));
      if (!item) continue;
      const reduction = Math.min(item.qty, remainingDirectReduction);
      remainingDirectReduction -= reduction;
      reductionByKey.set(key, reduction);
    }

    return previous.map((item) => {
      const key = item.id || item.client_id;
      if (!key || !reductionByKey.has(key)) return item;
      const reduction = reductionByKey.get(key)!;
      const nextQty = item.qty - reduction;
      if (nextQty > 0) {
        return { ...item, qty: nextQty, is_updated: true };
      }
      // Persisted row → mark deleted; new unsaved row → remove from staged state.
      if (item.is_new) return null;
      return { ...item, qty: 0, is_deleted: true, is_updated: true };
    }).filter((item): item is StagedItem => item !== null);
  };
  return { run, remaining: () => remainingDirectReduction };
}

function oracleEe(
  previous: StagedItem[],
  product: GeneratorCandidateProduct,
  resolvedUnitPriceCents: number,
  resolvedPricingContext: string,
  additionalQty: number,
  makeId: () => string,
): StagedItem[] {
  // CASE A: same product_id, same resolved price, same resolved context → increase existing row.
  const exactMatch = previous.find(
    (item) =>
      !item.is_deleted &&
      item.product_id === product.product_id &&
      !item.bundle_id &&
      item.unit_price_cents === resolvedUnitPriceCents &&
      (item.pricing_context || 'standalone') === resolvedPricingContext,
  );

  if (exactMatch) {
    return previous.map((item) =>
      item === exactMatch
        ? { ...item, qty: item.qty + additionalQty, is_updated: !item.is_new }
        : item,
    );
  }

  // CASE B: same product_id but different price/context → new staged row (historical frozen).
  return [...previous, {
    client_id: makeId(),
    product_id: product.product_id,
    product_name: product.product_name,
    item_name: product.product_name,
    qty: additionalQty,
    unit_price_cents: resolvedUnitPriceCents,
    pricing_context: resolvedPricingContext,
    is_new: true,
    is_deleted: false,
  }];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function st(over: Record<string, unknown> = {}): StagedItem {
  return { product_id: 'gen1', qty: 1, unit_price_cents: 5000, ...over } as unknown as StagedItem;
}
function persisted(id: string, created: string | undefined, qty = 1, over: Record<string, unknown> = {}): StagedItem {
  return st({ id, created_at: created, qty, is_new: false, is_deleted: false, ...over });
}
function unsaved(clientId: string, qty = 1, over: Record<string, unknown> = {}): StagedItem {
  return st({ client_id: clientId, qty, is_new: true, is_deleted: false, ...over });
}
const clone = (list: StagedItem[]) => list.map((i) => ({ ...i }));
const ids = (list: StagedItem[]) => list.map((i) => i.id || i.client_id);

const T1 = '2026-01-01T00:00:00Z';
const T2 = '2026-01-02T00:00:00Z';
const T3 = '2026-01-03T00:00:00Z';

// ---------------------------------------------------------------------------
// 1. Newest-first ordering
// ---------------------------------------------------------------------------

function checkSort(label: string, direct: StagedItem[], staged: StagedItem[]): StagedItem[] {
  const before = [...direct];
  const actual = sortDirectGeneratorItemsNewestFirst(direct, staged);
  ok(`${label} [matches oracle]`, same(actual, oracleSort(direct, staged)));
  ok(`${label} [same references as the oracle order]`, actual.every((x, i) => x === oracleSort(direct, staged)[i]));
  ok(`${label} [input array not mutated]`, direct.length === before.length && direct.every((x, i) => x === before[i]));
  return actual;
}

{
  const pMid = persisted('b', T2);
  const n1 = unsaved('n1');
  const r = checkSort('unsaved before persisted', [pMid, n1], [pMid, n1]);
  ok('an unsaved row sorts before a persisted row', ids(r).join() === 'n1,b');

  const pOldest = persisted('a', T1);
  const pNewest = persisted('c', T3);
  const r2 = checkSort('unsaved before newer persisted', [pNewest, n1], [pNewest, n1]);
  ok('unsaved rows come first even when a persisted row has a newer date', ids(r2).join() === 'n1,c');

  const u1 = unsaved('u1'), u2 = unsaved('u2'), u3 = unsaved('u3');
  const r3 = checkSort('multiple unsaved', [u1, pOldest, u2, u3], [u1, pOldest, u2, u3]);
  ok('unsaved rows sort by higher original staged index first', ids(r3).join() === 'u3,u2,u1,a');

  const r4 = checkSort('persisted by created_at', [pOldest, pNewest, pMid], [pOldest, pNewest, pMid]);
  ok('persisted rows sort by created_at descending', ids(r4).join() === 'c,b,a');

  const e1 = persisted('a1', T1), e2 = persisted('c3', T1), e3 = persisted('b2', T1);
  const r5 = checkSort('equal timestamps', [e1, e2, e3], [e1, e2, e3]);
  ok('equal timestamps fall back to id descending', ids(r5).join() === 'c3,b2,a1');

  const noDate = persisted('z', undefined);
  const r6 = checkSort('missing created_at', [noDate, pOldest], [noDate, pOldest]);
  ok('a missing created_at counts as 0 and sorts after dated rows', ids(r6).join() === 'a,z');
  const noDate2 = persisted('y', undefined);
  const r7 = checkSort('two missing created_at', [noDate, noDate2], [noDate, noDate2]);
  ok('two missing created_at rows tie-break by id descending', ids(r7).join() === 'z,y');
  const emptyDate = persisted('e', '');
  const r7b = checkSort('empty created_at', [emptyDate, pOldest], [emptyDate, pOldest]);
  ok('an empty created_at is falsy and counts as 0', ids(r7b).join() === 'a,e');

  const withId = persisted('x', T1), noId = persisted('', T1, 1, { id: undefined });
  const r8 = checkSort('missing id', [noId, withId], [noId, withId]);
  ok('a missing id counts as lowest, so it sorts last on a tie', r8[0] === withId && r8[1] === noId);

  // Invalid dates: only compared against the oracle (comparator returns NaN).
  const badA = persisted('bad-a', 'not-a-date'), badB = persisted('bad-b', 'also-bad');
  checkSort('two invalid dates', [badA, badB], [badA, badB]);
  checkSort('two invalid dates reversed', [badB, badA], [badB, badA]);
  checkSort('invalid vs valid dates', [badA, pOldest, pNewest], [badA, pOldest, pNewest]);
  checkSort('valid vs invalid dates', [pNewest, badA, pOldest, badB], [pNewest, badA, pOldest, badB]);

  // Reference-based indexOf: a clone that is not in stagedItems has index -1.
  const inStaged = unsaved('in');
  const outOfStaged = unsaved('out');
  checkSort('clone not in staged', [outOfStaged, inStaged], [inStaged]);
  checkSort('clone not in staged reversed', [inStaged, outOfStaged], [inStaged]);
  const dup = { ...inStaged };
  checkSort('structural duplicate of a staged row', [dup, inStaged], [inStaged, unsaved('other')]);

  // Empty and single.
  ok('empty input sorts to an empty array', same(checkSort('empty', [], []), []));
  const lone = unsaved('lone');
  ok('a single row is returned as a new array with the same row',
    (() => { const s = checkSort('single', [lone], [lone]); return s.length === 1 && s[0] === lone; })());
  const directArr = [pMid, n1];
  ok('the result is a new array, not the input', sortDirectGeneratorItemsNewestFirst(directArr, directArr) !== directArr);
}

// ---------------------------------------------------------------------------
// 2. Decrease reduction (parent-shaped mutable budget)
// ---------------------------------------------------------------------------

interface SeqResult { helper: StagedItem[][]; oracle: StagedItem[][]; helperRemaining: number[]; oracleRemaining: number[] }

// Runs the helper (wrapped exactly like the parent) and the oracle through the SAME sequence
// of updater invocations, comparing every result and the remaining budget after each call.
function sequence(label: string, staged: StagedItem[], removeQty: number, previousPerCall: StagedItem[][]): SeqResult {
  const direct = staged.filter((i) => !i.is_deleted && !!i.product_id);
  const directQty = direct.reduce((sum, item) => sum + item.qty, 0);
  const budget = Math.min(removeQty, directQty);

  const helperOrdered = sortDirectGeneratorItemsNewestFirst(direct, staged);
  let remainingDirectReduction = budget; // <-- the parent's mutable variable
  const helperRun = (previous: StagedItem[]): StagedItem[] => {
    const reduced = reduceDirectGeneratorItems(previous, helperOrdered, remainingDirectReduction);
    remainingDirectReduction = reduced.remainingBudget;
    return reduced.next;
  };

  const oracle = oracleUpdater(oracleSort(direct, staged), budget);
  const out: SeqResult = { helper: [], oracle: [], helperRemaining: [], oracleRemaining: [] };
  previousPerCall.forEach((previous, i) => {
    const h = helperRun(previous);
    const o = oracle.run(previous);
    out.helper.push(h); out.oracle.push(o);
    out.helperRemaining.push(remainingDirectReduction); out.oracleRemaining.push(oracle.remaining());
    ok(`${label} [call ${i + 1} result matches oracle]`, same(h, o));
    ok(
      `${label} [call ${i + 1} untouched rows keep the same reference as the oracle's, changed rows are new objects]`,
      h.length === o.length && h.every((x, k) => (previous.includes(o[k]) ? x === o[k] : !previous.includes(x))),
    );
    ok(`${label} [call ${i + 1} remaining budget matches oracle]`, Object.is(remainingDirectReduction, oracle.remaining()));
  });
  return out;
}

const single = (label: string, staged: StagedItem[], removeQty: number) => sequence(label, staged, removeQty, [staged]);

// Partial persisted reduction.
{
  const p = persisted('A', T1, 5);
  const r = single('partial persisted', [p], 2).helper[0];
  ok('partial persisted: qty reduced and is_updated set', r.length === 1 && r[0].qty === 3 && r[0].is_updated === true && r[0].is_deleted === false);
  ok('partial persisted: a new row object, original untouched', r[0] !== p && p.qty === 5 && p.is_updated === undefined);
}
// Exact-row reduction of a persisted row.
{
  const p = persisted('A', T1, 5);
  const r = single('exact persisted', [p], 5).helper[0];
  ok('fully reduced persisted row: qty 0, deleted, updated', r.length === 1 && r[0].qty === 0 && r[0].is_deleted === true && r[0].is_updated === true);
}
// New row fully consumed -> removed; partial new row.
{
  const n = unsaved('N', 3);
  ok('fully reduced new row disappears', single('new full', [n], 3).helper[0].length === 0);
  const r = single('new partial', [n], 1).helper[0];
  ok('partially reduced new row keeps is_new and gets is_updated', r.length === 1 && r[0].qty === 2 && r[0].is_new === true && r[0].is_updated === true);
}
// Reduction spanning multiple rows, newest first: new row first, then newest persisted, then older.
{
  const pOld = persisted('P0', T1, 4);
  const pNew = persisted('P1', T2, 3);
  const nw = unsaved('N1', 2);
  const staged = [pOld, pNew, nw];
  const r = single('spanning rows', staged, 6).helper[0];
  ok('spanning: the new row is consumed first and removed', !r.some((x) => x.client_id === 'N1'));
  ok('spanning: the newest persisted row is consumed next and deleted', r.find((x) => x.id === 'P1')!.is_deleted === true && r.find((x) => x.id === 'P1')!.qty === 0);
  ok('spanning: the older persisted row gets the remainder (4 - 1 = 3)', r.find((x) => x.id === 'P0')!.qty === 3 && r.find((x) => x.id === 'P0')!.is_updated === true);
  ok('spanning: previous order preserved for surviving rows', ids(r).join() === 'P0,P1');
}
// Multiple new rows: higher staged index is consumed first.
{
  const a = unsaved('A', 2), b = unsaved('B', 2), c = unsaved('C', 2);
  const r = single('multiple new', [a, b, c], 3).helper[0];
  ok('multiple new rows: the last-added row is removed, the next is reduced, the first untouched',
    !r.some((x) => x.client_id === 'C') && r.find((x) => x.client_id === 'B')!.qty === 1 && r.find((x) => x.client_id === 'A') === a);
}
// Unaffected references preserved.
{
  const other = st({ product_id: 'not-generator', id: 'OTHER', qty: 9 });
  const p = persisted('A', T1, 2);
  const r = single('unaffected refs', [other, p], 1).helper[0];
  ok('rows that receive no reduction keep their reference and position', r[0] === other && r[1] !== p);
}
// Keys: id, client_id, both, empty id.
{
  const withBoth = persisted('IDWINS', T1, 3, { client_id: 'ignored-client' });
  const r = single('id wins', [withBoth], 1).helper[0];
  ok('a row with both id and client_id is keyed by id and reduced', r[0].qty === 2);
  const emptyId = st({ id: '', client_id: 'CLIENT', qty: 3, is_new: true, is_deleted: false });
  const r2 = single('empty id falls to client_id', [emptyId], 1).helper[0];
  ok('an empty id falls through to client_id', r2[0].qty === 2);
  const emptyBoth = st({ id: '', client_id: '', qty: 3, is_new: true, is_deleted: false });
  const s = single('empty id and client_id', [emptyBoth], 2);
  ok('a row whose id and client_id are both empty is keyless: never reduced', s.helper[0][0] === emptyBoth);
  ok('the keyless row does not consume any budget', s.helperRemaining[0] === 2);
}
// Keyless row.
{
  const keyless = st({ qty: 3, is_new: true, is_deleted: false });
  const s = single('keyless', [keyless], 2);
  ok('a keyless direct row is never reduced (same reference kept)', s.helper[0][0] === keyless && s.helper[0].length === 1);
  ok('the budget is left unconsumed for a keyless row', s.helperRemaining[0] === 2);
}
// Duplicate keys.
{
  const d1 = persisted('D', T1, 2), d2 = persisted('D', T2, 2);
  const s = single('duplicate keys', [d1, d2], 4);
  const r = s.helper[0];
  ok('duplicate keys: every row sharing the key receives the (same) recorded reduction', r.every((x) => x.is_deleted === true));
  ok('duplicate keys: the budget is consumed once per occurrence', s.helperRemaining[0] === 0);
  const s2 = single('duplicate keys, small budget', [d1, d2], 1);
  ok('duplicate keys: with a small budget both rows still share the recorded reduction',
    s2.helper[0].every((x) => x.qty === 1 && x.is_updated === true));
}
// removeQty larger than the direct quantity.
{
  const p = persisted('A', T1, 2), n = unsaved('N', 1);
  const s = single('remove more than direct', [p, n], 99);
  ok('removeQty > directQty: budget is capped at the direct quantity and everything is consumed',
    s.helper[0].length === 1 && s.helper[0][0].is_deleted === true && s.helperRemaining[0] === 0);
}
// Zero and initial-zero budget.
{
  const p = persisted('A', T1, 2);
  const s = single('zero budget', [p], 0);
  ok('a zero budget still returns a NEW array containing the same row reference', s.helper[0] !== undefined && s.helper[0].length === 1 && s.helper[0][0] === p);
}
// Malformed quantities.
{
  // A zero-qty row is only reached if it sorts before the row that exhausts the budget.
  const zero = persisted('Z', T2, 0);
  const rz = single('qty 0 row', [zero, persisted('Y', T1, 3)], 1).helper[0];
  ok('a persisted row with qty 0 is reached with a reduction of 0 and is marked deleted',
    rz.find((x) => x.id === 'Z')!.is_deleted === true && rz.find((x) => x.id === 'Z')!.qty === 0);
  ok('the next row still receives the reduction (3 -> 2)', rz.find((x) => x.id === 'Y')!.qty === 2);
  const alone = single('qty 0 alone', [persisted('Z', T1, 0)], 1);
  ok('a lone qty 0 row has a zero budget, so nothing is reduced', alone.helper[0][0].qty === 0 && alone.helper[0][0].is_deleted === false && alone.helperRemaining[0] === 0);
  const zeroNew = unsaved('ZN', 0);
  const rzn = single('qty 0 new', [unsaved('X', 1), zeroNew], 1).helper[0];
  ok('a new row with qty 0 that is reached (higher staged index) is removed', rzn.every((x) => x.client_id !== 'ZN'));
  ok('the other new row still receives the reduction and disappears', rzn.every((x) => x.client_id !== 'X'));
  const neg = persisted('NEG', T1, -2);
  single('negative qty row', [neg, persisted('B', T2, 3)], 2);
  const nan = persisted('NAN', T1, NaN);
  single('NaN qty row', [nan, persisted('B', T2, 3)], 2);
  single('NaN qty alone', [nan], 1);
  single('negative qty alone', [neg], 1);
}
// Retry semantics: parent-shaped mutable budget.
{
  const p = persisted('A', T1, 5), q = persisted('B', T2, 2);
  const staged = [p, q];
  const s = sequence('retry: same previous', staged, 3, [staged, staged]);
  ok('first invocation applies the reduction (newest B deleted, A reduced by 1)',
    s.helper[0].find((x) => x.id === 'B')!.is_deleted === true && s.helper[0].find((x) => x.id === 'A')!.qty === 4);
  ok('the parent-held budget is consumed after the first invocation', s.helperRemaining[0] === 0);
  ok('second invocation with the same previous applies NO reduction', s.helper[1].every((x, i) => x === staged[i]));
  ok('second invocation still returns a NEW array (not the input)', s.helper[1] !== staged && s.helper[1].length === staged.length);
  ok('second invocation is not the same as the first', !same(s.helper[0], s.helper[1]));

  const fresh = clone(staged);
  const s2 = sequence('retry: fresh equivalent previous', staged, 3, [staged, fresh]);
  ok('second invocation with a fresh equivalent previous also applies NO reduction', s2.helper[1].every((x, i) => x === fresh[i]));
  ok('the fresh-previous second call returns a new array', s2.helper[1] !== fresh);
}
// Leftover budget preserved for a later invocation.
{
  const a = persisted('A', T2, 2), b = persisted('B', T1, 1);
  const staged = [a, b];               // newest first: A (T2), then B (T1); budget = min(4, 3) = 3
  const onlyB = [b];                   // first invocation cannot find A
  const s = sequence('leftover budget', staged, 4, [onlyB, staged]);
  ok('when a planned key is missing from previous, the unspent budget is preserved (3 - 1 = 2)', s.helperRemaining[0] === 2);
  ok('the first invocation still reduces the rows it can find (B fully consumed)', s.helper[0].length === 1 && s.helper[0][0].qty === 0 && s.helper[0][0].is_deleted === true);
  ok('a later invocation consumes the leftover budget on the rows it finds (A fully consumed)',
    s.helperRemaining[1] === 0 && s.helper[1].find((x) => x.id === 'A')!.qty === 0 && s.helper[1].find((x) => x.id === 'A')!.is_deleted === true);
  ok('the later invocation stops once the budget is spent (B untouched in that call)', s.helper[1].find((x) => x.id === 'B') === b);
}

// ---------------------------------------------------------------------------
// 3. Generator EE candidate application
// ---------------------------------------------------------------------------

const GEN: GeneratorCandidateProduct = { product_id: 'gen1', product_name: 'Generator' };

interface EeRun { result: StagedItem[]; calls: number }
function checkEe(
  label: string,
  previous: StagedItem[],
  price: number,
  context: string,
  qty: number,
  product: GeneratorCandidateProduct = GEN,
): EeRun {
  const a = idFactory('new-generator');
  const o = idFactory('new-generator');
  const actual = applyGeneratorEeCandidate(previous, product, price, context, qty, a.make);
  const expected = oracleEe(previous, product, price, context, qty, o.make);
  ok(`${label} [matches oracle]`, same(actual, expected));
  ok(`${label} [factory calls match oracle]`, a.calls() === o.calls());
  return { result: actual, calls: a.calls() };
}

{
  const pRow = persisted('r1', T1, 2, { pricing_context: 'standalone' });
  let e = checkEe('persisted exact match', [pRow], 5000, 'standalone', 3);
  ok('persisted match: qty added and is_updated true', e.result.length === 1 && e.result[0].qty === 5 && e.result[0].is_updated === true);
  ok('merge does not call the ID factory', e.calls === 0);
  ok('merge returns a new row and does not mutate the original', e.result[0] !== pRow && pRow.qty === 2 && pRow.is_updated === undefined);

  const nRow = unsaved('n1', 2, { pricing_context: 'standalone' });
  e = checkEe('new exact match', [nRow], 5000, 'standalone', 3);
  ok('new-row match: qty added and is_updated FALSE', e.result[0].qty === 5 && e.result[0].is_updated === false);
  const nUpdated = unsaved('n2', 2, { pricing_context: 'standalone', is_updated: true });
  e = checkEe('new row previously updated', [nUpdated], 5000, 'standalone', 1);
  ok('a new row that had is_updated true is reset to false by this merge', e.result[0].is_updated === false);

  e = checkEe('deleted row excluded', [persisted('d', T1, 2, { is_deleted: true, pricing_context: 'standalone' })], 5000, 'standalone', 1);
  ok('a deleted matching row is ignored and a new row is appended', e.result.length === 2 && e.result[1].qty === 1);
  e = checkEe('bundle row excluded', [persisted('b', T1, 2, { bundle_id: 'bund', pricing_context: 'standalone' })], 5000, 'standalone', 1);
  ok('a row with a bundle_id cannot match', e.result.length === 2);
  e = checkEe('different product', [persisted('o', T1, 2, { product_id: 'other', pricing_context: 'standalone' })], 5000, 'standalone', 1);
  ok('a different product_id appends', e.result.length === 2);
  e = checkEe('price mismatch', [pRow], 6000, 'standalone', 1);
  ok('a different resolved price appends a separate row', e.result.length === 2 && e.result[0] === pRow && e.result[1].unit_price_cents === 6000);
  e = checkEe('context mismatch', [pRow], 5000, 'addon', 1);
  ok('a different resolved context appends a separate row', e.result.length === 2 && e.result[1].pricing_context === 'addon');

  // Right side is NOT normalized.
  const noCtx = persisted('nc', T1, 2);
  e = checkEe('missing existing context + standalone', [noCtx], 5000, 'standalone', 1);
  ok("a row with no context matches a resolved 'standalone' context", e.result.length === 1 && e.result[0].qty === 3);
  e = checkEe('missing existing context + addon', [noCtx], 5000, 'addon', 1);
  ok("a row with no context does NOT match a resolved 'addon' context", e.result.length === 2);
  e = checkEe('resolved context undefined', [noCtx], 5000, undefined as unknown as string, 1);
  ok('QUIRK: an undefined resolved context is never normalized, so it never matches and appends',
    e.result.length === 2 && e.result[1].pricing_context === undefined && Object.keys(e.result[1]).includes('pricing_context'));
  e = checkEe('resolved context empty', [noCtx], 5000, '', 1);
  ok('an empty resolved context never matches a row with no context', e.result.length === 2);

  // First match only, refs/order preserved.
  const first = persisted('f1', T1, 1, { pricing_context: 'standalone' });
  const second = persisted('f2', T2, 1, { pricing_context: 'standalone' });
  const other = st({ product_id: 'other', id: 'oth', qty: 7 });
  e = checkEe('two matches', [other, first, second], 5000, 'standalone', 2);
  ok('only the first matching row is merged', e.result[1].qty === 3 && e.result[2] === second && e.result[0] === other);

  // Append shape.
  e = checkEe('append', [], 5000, 'standalone', 4);
  ok('append builds the exact nine-key row', same(e.result[0], {
    client_id: 'new-generator-1', product_id: 'gen1', product_name: 'Generator', item_name: 'Generator',
    qty: 4, unit_price_cents: 5000, pricing_context: 'standalone', is_new: true, is_deleted: false,
  }));
  ok('append has exactly 9 keys (no is_updated, created_at, id, bundle_id or component_snapshot)', Object.keys(e.result[0]).length === 9);
  ok('append calls the ID factory exactly once', e.calls === 1);
  e = checkEe('append with distinct name', [pRow], 6000, 'addon', 2, { product_id: 'gen2', product_name: 'Big Generator' });
  ok('product_name is copied to both product_name and item_name', e.result[1].product_name === 'Big Generator' && e.result[1].item_name === 'Big Generator');
  ok('the additional qty is used as the new row qty', e.result[1].qty === 2);
  ok('append keeps the previous rows first, by reference', e.result[0] === pRow && e.result.length === 2);
  const inputArr = [pRow];
  applyGeneratorEeCandidate(inputArr, GEN, 9000, 'standalone', 1, idFactory('x').make);
  ok('append does not mutate the input array', inputArr.length === 1 && inputArr[0] === pRow);
}

// ---------------------------------------------------------------------------
// The comparison helper itself
// ---------------------------------------------------------------------------

ok('same() treats { a: undefined } and {} as different', !same({ a: undefined }, {}));
ok('same() treats NaN as equal to NaN', same(NaN, NaN));
ok('same() treats different values as different', !same({ a: 1 }, { a: 2 }));

console.log(`\nGenerator staged item tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} generator staged item test(s) failed`);
