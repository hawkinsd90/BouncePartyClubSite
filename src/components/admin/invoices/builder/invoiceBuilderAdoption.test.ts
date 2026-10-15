// Differential tests for InvoiceBuilder's adoption of the existing tested modules:
//   - stagedItemModel              (Event Essentials add / bundle / remove / quantity)
//   - generatorStagedItems         (Generator decrease ordering/reduction, EE candidate apply)
//   - decideAdminGeneratorDecrease (Generator decrease decision)
//
// The oracles below are VERBATIM copies of the code that lived inline in
// InvoiceBuilder before the adoption. They never call the shared modules.
//
// Reachable-state assumption (verified against InvoiceBuilder's source): rows enter
// InvoiceBuilder's staged Event Essentials state ONLY through
//   (a) AddEventEssentialsSection.onAddProduct / onAddBundle payloads, which always carry
//       is_new: true, is_deleted: false, never an `id`, and no client_id (one is assigned), and
//   (b) the Generator EE-candidate append, which builds is_new: true rows with a client_id.
// Nothing ever sets is_new false, is_deleted true, or an `id`, and nothing outside
// orderSaveService (not used by InvoiceBuilder) reads `is_updated`. Every consumer of the
// rows (pricing input, availability request, invoice payload, ItemsEditor, the Add
// section) projects explicit fields.
//
// On that reachable state the shared helpers produce the same rows EXCEPT that they also
// stamp an `is_updated` property (true on quantity merges/reductions/updates, false on a
// Generator candidate merge into a new row). That property is unread in this flow, and
// these tests assert it is the ONLY difference. The final section pins what happens
// outside the reachable state (is_new false, missing is_new, `id` present) so the
// assumption is explicit: the helpers diverge there, which is why the adoption relies on it.
//
// decideAdminGeneratorDecrease lives in a module that imports the Supabase client and
// cannot be loaded under Node, so `decideDecrease` below is a verbatim copy of it.

import {
  addEEProductToStagedItems,
  addEEBundleToStagedItems,
  removeStagedItem,
  updateStagedItemQuantity,
} from '../../orders/detail-modal/stagedItemModel';
import type { StagedItem } from '../../orders/detail-modal/stagedItemModel';
import {
  sortDirectGeneratorItemsNewestFirst,
  reduceDirectGeneratorItems,
  applyGeneratorEeCandidate,
} from '../../orders/detail-modal/generatorStagedItems';

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

// Deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ======================================================================
// The catalog-transform differential that used to live here (InvoiceBuilder's old inline
// copy vs the shared admin builder) proved the Batch 1 adoption. It is superseded by
// src/lib/eventEssentialsResolverConfig.test.ts, which compares the old admin builder (and
// the old customer and AddEventEssentialsSection builders) against the single canonical
// builder, including the intentional all-or-nothing contained-category change.
// ======================================================================
/* eslint-disable @typescript-eslint/no-explicit-any */

// ======================================================================
// Oracles 2: InvoiceBuilder's old inline staged Event Essentials handlers (verbatim)
// ======================================================================
function oracleAddProduct(prev: any[], item: any, makeId: () => string) {
  const exactMatch = prev.find((existing) =>
    !existing.is_deleted &&
    existing.product_id === item.product_id &&
    !existing.bundle_id &&
    existing.unit_price_cents === item.unit_price_cents &&
    (existing.pricing_context || 'standalone') === (item.pricing_context || 'standalone')
  );
  if (exactMatch) {
    return prev.map((existing) =>
      existing === exactMatch
        ? { ...existing, qty: existing.qty + item.qty }
        : existing
    );
  }
  return [...prev, { ...item, client_id: item.client_id || makeId() }];
}

function oracleAddBundle(prev: any[], item: any, makeId: () => string) {
  const exactMatch = prev.find((existing) =>
    !existing.is_deleted &&
    existing.bundle_id === item.bundle_id &&
    existing.unit_price_cents === item.unit_price_cents &&
    (existing.pricing_context || 'standalone') === (item.pricing_context || 'standalone') &&
    JSON.stringify(existing.component_snapshot || null) === JSON.stringify(item.component_snapshot || null)
  );
  if (exactMatch) {
    return prev.map((existing) =>
      existing === exactMatch
        ? { ...existing, qty: existing.qty + item.qty }
        : existing
    );
  }
  return [...prev, { ...item, client_id: item.client_id || makeId() }];
}

function oracleRemove(prev: any[], item: any) {
  return prev.filter((i) => i.client_id !== item.client_id);
}

function oracleUpdateQty(prev: any[], item: any, qty: number) {
  return prev.map((i) =>
    i.client_id === item.client_id ? { ...i, qty: Math.max(1, qty) } : i
  );
}

// Adopted forms (exactly the calls InvoiceBuilder now makes)
const adoptedAddProduct = (prev: any[], item: any, makeId: () => string) => addEEProductToStagedItems(prev as StagedItem[], item, makeId);
const adoptedAddBundle = (prev: any[], item: any, makeId: () => string) => addEEBundleToStagedItems(prev as StagedItem[], item, makeId);
const adoptedRemove = (prev: any[], item: any) => removeStagedItem(prev as StagedItem[], item);
const adoptedUpdateQty = (prev: any[], item: any, qty: number) => updateStagedItemQuantity(prev as StagedItem[], item, qty);

const stripIsUpdated = (rows: any[]) => rows.map((row) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'is_updated')));

function idFactory() {
  let n = 0;
  return { make: () => `id-${++n}`, calls: () => n };
}

// A row exactly as it can exist in InvoiceBuilder state.
function reachableRow(kind: 'product' | 'bundle', n: number, over: Record<string, unknown> = {}) {
  return {
    client_id: `row-${n}`,
    ...(kind === 'product' ? { product_id: `prod-${n}` } : { bundle_id: `bun-${n}` }),
    item_name: `Item ${n}`,
    product_name: `Item ${n}`,
    qty: 1 + (n % 3),
    unit_price_cents: 1000 * (n + 1),
    pricing_context: 'standalone',
    component_snapshot: kind === 'bundle' ? { bundle_name: `B${n}`, bundle_description: null, components: [{ product_id: 'x', product_name: 'X', quantity_per_bundle: 1 }] } : null,
    is_new: true,
    is_deleted: false,
    ...over,
  };
}

// The exact payloads AddEventEssentialsSection emits (no client_id, is_new true).
function payload(kind: 'product' | 'bundle', productOrBundleId: string, over: Record<string, unknown> = {}) {
  return {
    ...(kind === 'product' ? { product_id: productOrBundleId, component_snapshot: null } : { bundle_id: productOrBundleId }),
    product_name: 'Name',
    item_name: 'Name',
    qty: 2,
    unit_price_cents: 5000,
    pricing_context: 'standalone',
    is_new: true,
    is_deleted: false,
    ...(kind === 'bundle' ? { component_snapshot: { bundle_name: 'B', bundle_description: null, components: [{ product_id: 'x', product_name: 'X', quantity_per_bundle: 1 }] } } : {}),
    ...over,
  };
}

function compareAdd(label: string, kind: 'product' | 'bundle', prev: any[], item: any) {
  const snap = JSON.stringify([prev, item]);
  const f1 = idFactory(); const f2 = idFactory();
  const o = kind === 'product' ? oracleAddProduct(prev, item, f1.make) : oracleAddBundle(prev, item, f1.make);
  const a = kind === 'product' ? adoptedAddProduct(prev, item, f2.make) : adoptedAddBundle(prev, item, f2.make);
  eq(`add ${kind} ${label}: rows equal ignoring is_updated`, stripIsUpdated(a), stripIsUpdated(o));
  eq(`add ${kind} ${label}: id factory call count`, f2.calls(), f1.calls());
  eq(`add ${kind} ${label}: inputs untouched`, JSON.stringify([prev, item]), snap);
  // Only difference allowed: is_updated is set true on the merged row, nowhere else.
  const oracleHasIsUpdated = o.some((row: any) => 'is_updated' in row);
  ok(`add ${kind} ${label}: oracle never carries is_updated`, !oracleHasIsUpdated);
  const stamped = a.filter((row: any) => 'is_updated' in row);
  ok(`add ${kind} ${label}: is_updated only ever true, on at most one merged row`, stamped.length <= 1 && stamped.every((row: any) => row.is_updated === true));
  ok(`add ${kind} ${label}: array is new`, a !== prev);
  return { o, a };
}

// ---- Product add cases (payloads as AEES emits them)
{
  compareAdd('first row', 'product', [], payload('product', 'pA'));
  const base = [reachableRow('product', 0, { product_id: 'pA', unit_price_cents: 5000 })];
  compareAdd('exact match merges', 'product', base, payload('product', 'pA'));
  compareAdd('same product, different price appends', 'product', base, payload('product', 'pA', { unit_price_cents: 4000 }));
  compareAdd('same product, different pricing context appends', 'product', base, payload('product', 'pA', { pricing_context: 'addon' }));
  compareAdd('missing pricing_context treated as standalone (both sides)', 'product', base, payload('product', 'pA', { pricing_context: undefined }));
  compareAdd('existing row with no pricing_context', 'product', [reachableRow('product', 0, { product_id: 'pA', unit_price_cents: 5000, pricing_context: undefined })], payload('product', 'pA'));
  compareAdd('payload already has client_id', 'product', [], payload('product', 'pA', { client_id: 'given' }));
  compareAdd('bundle row with same product_id is not merged', 'product', [reachableRow('bundle', 0, { product_id: 'pA', unit_price_cents: 5000 })], payload('product', 'pA'));
  compareAdd('deleted row is skipped', 'product', [reachableRow('product', 0, { product_id: 'pA', unit_price_cents: 5000, is_deleted: true })], payload('product', 'pA'));
  compareAdd('several rows, merge the first match only', 'product', [reachableRow('product', 0, { product_id: 'pA', unit_price_cents: 5000 }), reachableRow('product', 1, { product_id: 'pA', unit_price_cents: 5000 })], payload('product', 'pA'));
}

// ---- Bundle add cases
{
  const snapA = { bundle_name: 'B', bundle_description: null, components: [{ product_id: 'x', product_name: 'X', quantity_per_bundle: 1 }] };
  const snapB = { bundle_name: 'B', bundle_description: null, components: [{ product_id: 'x', product_name: 'X', quantity_per_bundle: 2 }] };
  const base = [reachableRow('bundle', 0, { bundle_id: 'bA', unit_price_cents: 5000, component_snapshot: snapA })];
  compareAdd('first row', 'bundle', [], payload('bundle', 'bA'));
  compareAdd('same bundle, identical snapshot merges', 'bundle', base, payload('bundle', 'bA', { component_snapshot: snapA }));
  compareAdd('same bundle, changed snapshot appends', 'bundle', base, payload('bundle', 'bA', { component_snapshot: snapB }));
  compareAdd('null snapshot vs undefined snapshot merge', 'bundle',
    [reachableRow('bundle', 0, { bundle_id: 'bA', unit_price_cents: 5000, component_snapshot: null })],
    payload('bundle', 'bA', { component_snapshot: undefined }));
  compareAdd('different price appends', 'bundle', base, payload('bundle', 'bA', { component_snapshot: snapA, unit_price_cents: 1 }));
  compareAdd('different context appends', 'bundle', base, payload('bundle', 'bA', { component_snapshot: snapA, pricing_context: 'addon' }));
  compareAdd('snapshot key order matters (JSON.stringify)', 'bundle', base,
    payload('bundle', 'bA', { component_snapshot: { components: snapA.components, bundle_description: null, bundle_name: 'B' } }));
}

// ---- Remove / quantity
{
  const rows = [reachableRow('product', 0), reachableRow('bundle', 1), reachableRow('product', 2)];
  for (const target of rows) {
    const o = oracleRemove(rows, target);
    const a = adoptedRemove(rows, target);
    eq(`remove ${target.client_id}: rows equal`, a, o);
    ok(`remove ${target.client_id}: is_updated absent`, a.every((row) => !('is_updated' in row)));
    ok(`remove ${target.client_id}: array is new`, a !== rows);
  }
  // Item as passed by ItemsEditor: the same row object
  eq('remove unknown row leaves all rows', adoptedRemove(rows, reachableRow('product', 9)), oracleRemove(rows, reachableRow('product', 9)));
  eq('remove from empty', adoptedRemove([], rows[0]), oracleRemove([], rows[0]));

  for (const qty of [-5, 0, 1, 2, 7, 100, 2.5]) {
    for (const target of rows) {
      const o = oracleUpdateQty(rows, target, qty);
      const a = adoptedUpdateQty(rows, target, qty);
      eq(`qty ${qty} on ${target.client_id}: rows equal ignoring is_updated`, stripIsUpdated(a), stripIsUpdated(o));
      const stamped = a.filter((row) => 'is_updated' in row);
      ok(`qty ${qty} on ${target.client_id}: is_updated true only on the updated row`, stamped.length === 1 && stamped[0].client_id === target.client_id && stamped[0].is_updated === true);
    }
  }
  ok('qty NaN: NaN stays NaN in both', Number.isNaN(adoptedUpdateQty(rows, rows[0], NaN)[0].qty) && Number.isNaN(oracleUpdateQty(rows, rows[0], NaN)[0].qty));
}

// ---- Seeded random operation sequences on reachable state
{
  const r = rng(777);
  for (let round = 0; round < 80; round++) {
    let stateO: any[] = [];
    let stateA: any[] = [];
    const fO = idFactory(); const fA = idFactory();
    const prices = [1000, 2000];
    const ctxs = ['standalone', 'addon', undefined];
    for (let step = 0; step < 14; step++) {
      const op = Math.floor(r() * 5);
      if (op <= 1) {
        const pid = `p${Math.floor(r() * 3)}`;
        const item = payload('product', pid, { unit_price_cents: prices[Math.floor(r() * 2)], pricing_context: ctxs[Math.floor(r() * 3)], qty: 1 + Math.floor(r() * 3) });
        stateO = oracleAddProduct(stateO, item, fO.make);
        stateA = adoptedAddProduct(stateA, item, fA.make);
      } else if (op === 2) {
        const bid = `b${Math.floor(r() * 2)}`;
        const item = payload('bundle', bid, { unit_price_cents: prices[Math.floor(r() * 2)], qty: 1 + Math.floor(r() * 3) });
        stateO = oracleAddBundle(stateO, item, fO.make);
        stateA = adoptedAddBundle(stateA, item, fA.make);
      } else if (stateO.length > 0) {
        const idx = Math.floor(r() * stateO.length);
        if (op === 3) {
          stateO = oracleRemove(stateO, stateO[idx]);
          stateA = adoptedRemove(stateA, stateA[idx]);
        } else {
          const q = Math.floor(r() * 6) - 1;
          stateO = oracleUpdateQty(stateO, stateO[idx], q);
          stateA = adoptedUpdateQty(stateA, stateA[idx], q);
        }
      }
      if (JSON.stringify(stripIsUpdated(stateA)) !== JSON.stringify(stripIsUpdated(stateO))) {
        failed++; console.error(`FAIL random op sequence ${round}/${step}: states diverged`); break;
      } else { passed++; }
    }
  }
}

// ======================================================================
// Oracle 3: InvoiceBuilder's old inline Generator decrease + candidate apply (verbatim)
// ======================================================================
type Row = Record<string, any>;

function decideDecrease(input: { current: { legacyQty: number; directEeQty: number }; requestedTotal: number }) {
  // Verbatim copy of decideAdminGeneratorDecrease (src/lib/adminGeneratorResolution.ts).
  const { current, requestedTotal } = input;

  const existingStandalone = current.legacyQty + current.directEeQty;
  const removeQty = Math.max(0, existingStandalone - requestedTotal);

  if (removeQty <= 0) {
    return {
      removeQty: 0,
      target: 'none',
      newDirectEeQty: current.directEeQty,
      newLegacyQty: current.legacyQty,
    };
  }

  // Decrease direct EE first (most recently added), then legacy.
  const eeDecrease = Math.min(removeQty, current.directEeQty);
  const remaining = removeQty - eeDecrease;
  const legacyDecrease = Math.min(remaining, current.legacyQty);

  return {
    removeQty,
    target: eeDecrease > 0 ? 'ee' : legacyDecrease > 0 ? 'legacy' : 'none',
    newDirectEeQty: current.directEeQty - eeDecrease,
    newLegacyQty: current.legacyQty - legacyDecrease,
  };
}

// Old inline decrease. Returns the state updater (with its closure-held mutable budget,
// as in the original) and the values the handler passed to updateEventDetails.
function oracleDecrease(stagedEEItems: Row[], genIds: Set<string>, legacyQty: number, requestedQty: number) {
  const directItems = stagedEEItems.filter((item) => !item.is_deleted && !!item.product_id && genIds.has(item.product_id));
  const directQty = directItems.reduce((sum, item) => sum + item.qty, 0);
  const currentTotal = legacyQty + directQty;
  if (requestedQty >= currentTotal) return null;

  const removeQty = currentTotal - requestedQty;
  let remainingDirectReduction = Math.min(removeQty, directQty);
  const directByNewest = [...directItems].sort((a, b) => {
    const aIdx = stagedEEItems.indexOf(a);
    const bIdx = stagedEEItems.indexOf(b);
    return bIdx - aIdx;
  });

  const updater = (previous: Row[]) => {
    const orderedKeys = directByNewest.map((item) => item.client_id).filter((k): k is string => !!k);
    const keySet = new Set(orderedKeys);
    const reductionByKey = new Map<string, number>();
    for (const key of orderedKeys) {
      if (remainingDirectReduction <= 0) break;
      const item = previous.find((i) => i.client_id === key && keySet.has(key));
      if (!item) continue;
      const reduction = Math.min(item.qty, remainingDirectReduction);
      remainingDirectReduction -= reduction;
      reductionByKey.set(key, reduction);
    }

    return previous.map((item) => {
      if (!item.client_id || !reductionByKey.has(item.client_id)) return item;
      const reduction = reductionByKey.get(item.client_id)!;
      const nextQty = item.qty - reduction;
      if (nextQty > 0) return { ...item, qty: nextQty };
      return null;
    }).filter((item): item is Row => item !== null);
  };

  const newLegacyQty = Math.max(0, legacyQty - Math.max(0, removeQty - directQty));
  return { updater, newLegacyQty, clearWaiver: newLegacyQty === 0 };
}

// Adopted decrease: the calls InvoiceBuilder now makes.
function adoptedDecrease(stagedEEItems: Row[], genIds: Set<string>, legacyQty: number, requestedQty: number) {
  const directItems = stagedEEItems.filter((item) => !item.is_deleted && !!item.product_id && genIds.has(item.product_id));
  const directQty = directItems.reduce((sum, item) => sum + item.qty, 0);
  const currentTotal = legacyQty + directQty;
  if (requestedQty >= currentTotal) return null;

  const decision = decideDecrease({
    current: { legacyQty, directEeQty: directQty },
    requestedTotal: requestedQty,
  });
  const directByNewest = sortDirectGeneratorItemsNewestFirst(directItems as StagedItem[], stagedEEItems as StagedItem[]);
  let remainingDirectReduction = Math.min(decision.removeQty, directQty);

  const updater = (previous: Row[]) => {
    const reduced = reduceDirectGeneratorItems(previous as StagedItem[], directByNewest, remainingDirectReduction);
    remainingDirectReduction = reduced.remainingBudget;
    return reduced.next as Row[];
  };

  return { updater, newLegacyQty: decision.newLegacyQty, clearWaiver: decision.newLegacyQty === 0 };
}

function genRow(n: number, productId: string, qty: number, over: Row = {}): Row {
  return {
    client_id: `g-${n}`, product_id: productId, product_name: 'Generator', item_name: 'Generator',
    qty, unit_price_cents: 10000, pricing_context: 'standalone', is_new: true, is_deleted: false, ...over,
  };
}

function compareDecrease(label: string, rows: Row[], legacy: number, requested: number, options: { repeat?: boolean } = {}) {
  const genIds = new Set(['gen']);
  const snap = JSON.stringify(rows);
  const o = oracleDecrease(rows, genIds, legacy, requested);
  const a = adoptedDecrease(rows, genIds, legacy, requested);
  if (o === null || a === null) { ok(`decrease ${label}: both are no-decrease`, o === null && a === null); return; }
  eq(`decrease ${label}: legacy qty`, a.newLegacyQty, o.newLegacyQty);
  ok(`decrease ${label}: waiver clear flag`, a.clearWaiver === o.clearWaiver);
  const oNext = o.updater(rows);
  const aNext = a.updater(rows);
  eq(`decrease ${label}: rows equal ignoring is_updated`, stripIsUpdated(aNext), stripIsUpdated(oNext));
  if (options.repeat) {
    // A repeated updater call sees the already-consumed budget in both implementations.
    eq(`decrease ${label}: repeated updater call (consumed budget)`, stripIsUpdated(a.updater(rows)), stripIsUpdated(o.updater(rows)));
  }
  eq(`decrease ${label}: inputs untouched`, JSON.stringify(rows), snap);
  // Only difference: rows the helper reduced are stamped is_updated: true.
  const reduced = aNext.filter((row) => 'is_updated' in row);
  ok(`decrease ${label}: is_updated only true, only on rows that lost quantity`, reduced.every((row) => row.is_updated === true));
}

{
  compareDecrease('no Generator rows, legacy only', [], 3, 1);
  compareDecrease('legacy only, to zero', [], 3, 0);
  compareDecrease('one direct row, partial', [genRow(0, 'gen', 3)], 0, 1);
  compareDecrease('one direct row, to zero', [genRow(0, 'gen', 3)], 0, 0);
  compareDecrease('legacy plus direct: direct first, then legacy', [genRow(0, 'gen', 2)], 2, 1);
  compareDecrease('legacy plus direct: spans into legacy', [genRow(0, 'gen', 2)], 2, 1, { repeat: true });
  compareDecrease('multiple direct rows, newest first', [genRow(0, 'gen', 2), genRow(1, 'gen', 2), genRow(2, 'gen', 2)], 0, 5, { repeat: true });
  compareDecrease('decrease removes one row exactly', [genRow(0, 'gen', 2), genRow(1, 'gen', 2)], 0, 2);
  compareDecrease('decrease spans multiple rows', [genRow(0, 'gen', 2), genRow(1, 'gen', 2), genRow(2, 'gen', 2)], 0, 1);
  compareDecrease('non-Generator rows untouched', [genRow(0, 'other', 5), genRow(1, 'gen', 2), reachableRow('bundle', 5)], 0, 0);
  compareDecrease('requested zero with everything', [genRow(0, 'gen', 1), genRow(1, 'gen', 4)], 3, 0);
  compareDecrease('requested equals current: no decrease', [genRow(0, 'gen', 2)], 1, 3);
  compareDecrease('requested above current: no decrease', [genRow(0, 'gen', 2)], 1, 9);
  compareDecrease('mixed order of Generator and other rows', [genRow(0, 'gen', 1), reachableRow('product', 7), genRow(1, 'gen', 1), reachableRow('bundle', 8), genRow(2, 'gen', 1)], 0, 1, { repeat: true });
  compareDecrease('fractional/odd legacy values', [genRow(0, 'gen', 2)], 1.5, 1);
  compareDecrease('negative legacy value', [genRow(0, 'gen', 2)], -1, 0);
  compareDecrease('duplicate client_id keys (both implementations handle identically)', [genRow(0, 'gen', 2, { client_id: 'dup' }), genRow(1, 'gen', 2, { client_id: 'dup' })], 0, 1, { repeat: true });
  compareDecrease('deleted Generator row is not direct', [genRow(0, 'gen', 2, { is_deleted: true }), genRow(1, 'gen', 1)], 1, 0);

  // Exhaustive-ish grid on reachable state
  const r = rng(4242);
  for (let round = 0; round < 250; round++) {
    const count = Math.floor(r() * 5);
    const rows: Row[] = [];
    for (let i = 0; i < count; i++) {
      rows.push(r() > 0.3 ? genRow(i, 'gen', 1 + Math.floor(r() * 4), { unit_price_cents: r() > 0.5 ? 10000 : 7500 }) : reachableRow(r() > 0.5 ? 'product' : 'bundle', 20 + i));
    }
    const legacy = Math.floor(r() * 4);
    const total = legacy + rows.filter((x) => x.product_id === 'gen').reduce((s, x) => s + x.qty, 0);
    compareDecrease(`grid ${round}`, rows, legacy, Math.floor(r() * (total + 2)), { repeat: r() > 0.5 });
  }
}

// ---- Generator EE candidate apply
function oracleApply(previous: Row[], product: { product_id: string; product_name: string }, resolvedUnitPriceCents: number, resolvedPricingContext: string, additionalQty: number, makeId: () => string) {
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
        ? { ...item, qty: item.qty + additionalQty }
        : item,
    );
  }

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

function compareApply(label: string, previous: Row[], price: number, ctx: string, qty: number) {
  const snap = JSON.stringify(previous);
  const product = { product_id: 'gen', product_name: 'Generator' };
  const f1 = idFactory(); const f2 = idFactory();
  const o = oracleApply(previous, product, price, ctx, qty, f1.make);
  const a = applyGeneratorEeCandidate(previous as StagedItem[], product, price, ctx, qty, f2.make) as Row[];
  eq(`apply ${label}: rows equal ignoring is_updated`, stripIsUpdated(a), stripIsUpdated(o));
  eq(`apply ${label}: id factory call count`, f2.calls(), f1.calls());
  eq(`apply ${label}: inputs untouched`, JSON.stringify(previous), snap);
  // For reachable (is_new true) rows the helper stamps is_updated: false on the merged row.
  const stamped = a.filter((row) => 'is_updated' in row);
  ok(`apply ${label}: is_updated only ever false on a merged new row`, stamped.length <= 1 && stamped.every((row) => row.is_updated === false));
}

{
  compareApply('empty appends', [], 10000, 'standalone', 2);
  compareApply('exact match merges', [genRow(0, 'gen', 2)], 10000, 'standalone', 3);
  compareApply('different price appends (historical row kept)', [genRow(0, 'gen', 2)], 7500, 'standalone', 1);
  compareApply('different context appends', [genRow(0, 'gen', 2)], 10000, 'addon', 1);
  compareApply('existing row without context matches standalone', [genRow(0, 'gen', 2, { pricing_context: undefined })], 10000, 'standalone', 1);
  compareApply('resolved context has no standalone fallback: addon vs undefined does not match', [genRow(0, 'gen', 2, { pricing_context: undefined })], 10000, 'addon', 1);
  compareApply('bundle row with the same product id is not matched', [genRow(0, 'gen', 2, { bundle_id: 'b' })], 10000, 'standalone', 1);
  compareApply('deleted row not matched', [genRow(0, 'gen', 2, { is_deleted: true })], 10000, 'standalone', 1);
  compareApply('first match wins', [genRow(0, 'gen', 2), genRow(1, 'gen', 2)], 10000, 'standalone', 1);
  compareApply('other products present', [reachableRow('product', 3), genRow(0, 'gen', 1)], 10000, 'standalone', 4);
}

// ======================================================================
// Boundary pins: OUTSIDE the reachable state the helpers differ. These document why the
// adoption relies on the reachable-state assumption; they are not desired behavior.
// ======================================================================
{
  // Remove: a row that is not is_new is marked deleted by the helper, dropped by the old code.
  const persisted = [reachableRow('product', 0, { is_new: false })];
  ok('boundary: remove of an is_new:false row differs', JSON.stringify(adoptedRemove(persisted, persisted[0])) !== JSON.stringify(oracleRemove(persisted, persisted[0])));
  // Remove: a row with an id is matched by id, not client_id.
  const withId = [reachableRow('product', 0, { id: 'abc' }), reachableRow('product', 1, { id: 'def', client_id: 'row-0' })];
  ok('boundary: remove with an id present matches by id, not client_id', JSON.stringify(adoptedRemove(withId, withId[0])) !== JSON.stringify(oracleRemove(withId, withId[0])));
  // Sort: rows missing is_new are ordered oldest-first by the helper (comparator ties), newest-first by the old code.
  const noFlag = [genRow(0, 'gen', 1, { is_new: undefined }), genRow(1, 'gen', 1, { is_new: undefined })];
  const oNext = oracleDecrease(noFlag, new Set(['gen']), 0, 1)!.updater(noFlag);
  const aNext = adoptedDecrease(noFlag, new Set(['gen']), 0, 1)!.updater(noFlag);
  ok('boundary: decrease on rows without is_new picks a different row', JSON.stringify(stripIsUpdated(oNext)) !== JSON.stringify(stripIsUpdated(aNext)));
  // Reduction to zero on a persisted row: helper marks deleted, old code drops the row.
  const persistedGen = [genRow(0, 'gen', 1, { is_new: false })];
  const oZero = oracleDecrease(persistedGen, new Set(['gen']), 0, 0)!.updater(persistedGen);
  const aZero = adoptedDecrease(persistedGen, new Set(['gen']), 0, 0)!.updater(persistedGen);
  ok('boundary: reducing a non-new row to zero differs (deleted flag vs dropped)', JSON.stringify(oZero) !== JSON.stringify(aZero));
}

console.log(`InvoiceBuilder adoption differential tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} InvoiceBuilder adoption test(s) failed`);
