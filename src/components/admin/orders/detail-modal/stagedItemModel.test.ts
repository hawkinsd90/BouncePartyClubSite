// Differential characterization tests for stagedItemModel.
//
// The oracle functions below are verbatim copies of the code that lived inline in
// OrderDetailModal before the extraction (the persisted-row mapping inside the
// initialization effect, stageAddItem, stageRemoveItem, handleAddEEProduct,
// handleAddEEBundle and handleUpdateQuantity). They never call the helpers. The
// only adaptations: the state updater bodies take `prev` as an argument, and the
// inline `Date.now()` / `Math.random()` ID templates are replaced by an injected
// factory so the tests are deterministic and can count calls.
//
// These tests pin CURRENT behavior, including oddities (see stagedItemModel.ts):
// they are not a statement of desired behavior.

import {
  buildStagedItemsFromOrderItems,
  buildNewInflatableItem,
  removeStagedItem,
  addEEProductToStagedItems,
  addEEBundleToStagedItems,
  updateStagedItemQuantity,
} from './stagedItemModel';
import type { StagedItem, BundleComponentSnapshot, PersistedOrderItem, StageableUnit } from './stagedItemModel';

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

// Deterministic client ID factory that counts its calls.
function idFactory(prefix: string) {
  let n = 0;
  const make = () => `${prefix}-${++n}`;
  return { make, calls: () => n };
}

// ---------------------------------------------------------------------------
// ORACLE: verbatim copies of the pre-extraction inline code.
// ---------------------------------------------------------------------------

function oracleMap(orderItems: PersistedOrderItem[]): unknown[] {
  const staged = orderItems.map(item => {
    if (item.unit_id && item.units?.name) {
      return {
        id: item.id,
        unit_id: item.unit_id,
        unit_name: item.units.name,
        qty: item.qty,
        wet_or_dry: item.wet_or_dry,
        unit_price_cents: item.unit_price_cents,
        created_at: item.created_at,
        is_new: false,
        is_deleted: false,
      };
    }
    // EE product or package item
    return {
      id: item.id,
      product_id: item.product_id,
      bundle_id: item.bundle_id,
      product_name: item.item_name || item.product_name || 'Event Essential',
      item_name: item.item_name,
      qty: item.qty,
      unit_price_cents: item.unit_price_cents,
      pricing_context: item.pricing_context,
      component_snapshot: item.component_snapshot ?? null,
      created_at: item.created_at,
      is_new: false,
      is_deleted: false,
    };
  });
  return staged;
}

function oracleStageAdd(unit: StageableUnit, mode: 'dry' | 'water', makeId: () => string): StagedItem {
  const price = mode === 'water' && unit.price_water_cents ? unit.price_water_cents : unit.price_dry_cents;

  const newItem: StagedItem = {
    client_id: makeId(),
    unit_id: unit.id,
    unit_name: unit.name,
    qty: 1,
    wet_or_dry: mode,
    unit_price_cents: price,
    is_new: true,
    is_deleted: false,
  };

  return newItem;
}

function oracleRemove(prev: StagedItem[], itemToRemove: StagedItem): StagedItem[] {
  return prev.map(item => {
    const isMatch = item.id
      ? item.id === itemToRemove.id
      : item.client_id
        ? item.client_id === itemToRemove.client_id
        : item.unit_id
          ? item.unit_id === itemToRemove.unit_id && item.wet_or_dry === itemToRemove.wet_or_dry
          : item === itemToRemove;

    if (isMatch) {
      if (item.is_new) {
        // Don't include new items (filter them out)
        return null;
      } else {
        // Mark existing items as deleted
        return { ...item, is_deleted: true };
      }
    }
    return item;
  }).filter((item): item is StagedItem => item !== null);
}

function oracleAddProduct(prev: StagedItem[], item: StagedItem, makeId: () => string): StagedItem[] {
  const exactMatch = prev.find((existing: StagedItem) =>
    !existing.is_deleted &&
    existing.product_id === item.product_id &&
    !existing.bundle_id &&
    existing.unit_price_cents === item.unit_price_cents &&
    (existing.pricing_context || 'standalone') === (item.pricing_context || 'standalone')
  );
  if (exactMatch) {
    return prev.map((existing: StagedItem) =>
      existing === exactMatch
        ? { ...existing, qty: existing.qty + item.qty, is_updated: true }
        : existing
    );
  }
  return [...prev, { ...item, client_id: item.client_id || makeId() }];
}

function oracleAddBundle(prev: StagedItem[], item: StagedItem, makeId: () => string): StagedItem[] {
  const exactMatch = prev.find((existing: StagedItem) =>
    !existing.is_deleted &&
    existing.bundle_id === item.bundle_id &&
    existing.unit_price_cents === item.unit_price_cents &&
    (existing.pricing_context || 'standalone') === (item.pricing_context || 'standalone') &&
    JSON.stringify(existing.component_snapshot || null) === JSON.stringify(item.component_snapshot || null)
  );
  if (exactMatch) {
    return prev.map((existing: StagedItem) =>
      existing === exactMatch
        ? { ...existing, qty: existing.qty + item.qty, is_updated: true }
        : existing
    );
  }
  return [...prev, { ...item, client_id: item.client_id || makeId() }];
}

function oracleQuantity(prev: StagedItem[], itemToUpdate: StagedItem, qty: number): StagedItem[] {
  return prev.map(item => {
    const matches = item.id ? item.id === itemToUpdate.id : item.client_id === itemToUpdate.client_id;
    return matches ? { ...item, qty: Math.max(1, qty), is_updated: true } : item;
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function row(over: Record<string, unknown> = {}): PersistedOrderItem {
  return { qty: 1, unit_price_cents: 100, ...over } as unknown as PersistedOrderItem;
}

function st(over: Record<string, unknown> = {}): StagedItem {
  return { qty: 1, unit_price_cents: 500, ...over } as unknown as StagedItem;
}

function snap(name: string, extra: Record<string, unknown> = {}): BundleComponentSnapshot {
  return { bundle_name: name, bundle_description: null, components: [{ product_id: 'p1', product_name: 'Chair', quantity_per_bundle: 4 }], ...extra } as BundleComponentSnapshot;
}

// ---------------------------------------------------------------------------
// buildStagedItemsFromOrderItems
// ---------------------------------------------------------------------------

function checkMap(label: string, rows: PersistedOrderItem[]): StagedItem[] {
  const actual = buildStagedItemsFromOrderItems(rows);
  ok(`${label} [matches oracle]`, same(actual, oracleMap(rows)));
  return actual;
}

// Persisted inflatable: exact literal, and extras are not copied.
const inflatableRow = row({
  id: 'oi1', unit_id: 'u1', units: { name: 'Castle' }, qty: 2, wet_or_dry: 'water', unit_price_cents: 20000,
  created_at: '2026-01-01T00:00:00Z', order_id: 'o1', product_id: 'ignored', item_name: 'ignored', pricing_context: 'addon',
});
const mappedInflatable = checkMap('inflatable', [inflatableRow])[0];
ok('inflatable maps to the expected literal', same(mappedInflatable, {
  id: 'oi1', unit_id: 'u1', unit_name: 'Castle', qty: 2, wet_or_dry: 'water', unit_price_cents: 20000,
  created_at: '2026-01-01T00:00:00Z', is_new: false, is_deleted: false,
}));
ok('inflatable branch has exactly 9 keys and no EE fields',
  Object.keys(mappedInflatable).length === 9 && !('product_id' in mappedInflatable) && !('item_name' in mappedInflatable) && !('pricing_context' in mappedInflatable));

// Persisted EE product.
const productRow = row({
  id: 'oi2', unit_id: null, product_id: 'p1', bundle_id: null, item_name: 'Chair', qty: 4, unit_price_cents: 150,
  pricing_context: 'addon', created_at: '2026-01-02T00:00:00Z', units: { name: 'ignored-unit' }, order_id: 'o1',
});
const mappedProduct = checkMap('ee product', [productRow])[0];
ok('EE product maps to the expected literal (bundle_id null passes through)', same(mappedProduct, {
  id: 'oi2', product_id: 'p1', bundle_id: null, product_name: 'Chair', item_name: 'Chair', qty: 4, unit_price_cents: 150,
  pricing_context: 'addon', component_snapshot: null, created_at: '2026-01-02T00:00:00Z', is_new: false, is_deleted: false,
}));
ok('EE branch has exactly 12 keys, no unit_id/unit_name/wet_or_dry',
  Object.keys(mappedProduct).length === 12 && !('unit_id' in mappedProduct) && !('unit_name' in mappedProduct) && !('wet_or_dry' in mappedProduct));

// Persisted bundle: snapshot kept by reference.
const bundleSnap = snap('Party Pack');
const bundleRow = row({ id: 'oi3', bundle_id: 'b1', item_name: 'Party Pack', qty: 1, unit_price_cents: 9000, pricing_context: 'standalone', component_snapshot: bundleSnap });
const mappedBundle = checkMap('bundle', [bundleRow])[0];
ok('bundle keeps its component_snapshot by reference', mappedBundle.component_snapshot === bundleSnap);
ok('bundle bundle_id passes through', mappedBundle.bundle_id === 'b1');

// component_snapshot undefined -> null.
ok('undefined component_snapshot becomes null',
  checkMap('snapshot undefined', [row({ product_id: 'p1', item_name: 'X', component_snapshot: undefined })])[0].component_snapshot === null);
ok('null component_snapshot stays null',
  checkMap('snapshot null', [row({ product_id: 'p1', item_name: 'X', component_snapshot: null })])[0].component_snapshot === null);

// Quirk: truthy unit_id with missing/empty units.name goes through the EE branch.
const quirkMissing = checkMap('unit_id, no units', [row({ id: 'q1', unit_id: 'u9', qty: 3, wet_or_dry: 'dry', unit_price_cents: 700 })])[0];
ok('unit_id with no units object falls into the EE branch and loses unit_id', !('unit_id' in quirkMissing) && quirkMissing.product_name === 'Event Essential');
const quirkNullUnits = checkMap('unit_id, null units', [row({ id: 'q2', unit_id: 'u9', units: null })])[0];
ok('unit_id with null units falls into the EE branch', !('unit_id' in quirkNullUnits));
const quirkEmpty = checkMap('unit_id, empty name', [row({ id: 'q3', unit_id: 'u9', units: { name: '' } })])[0];
ok('unit_id with an empty units.name falls into the EE branch', !('unit_id' in quirkEmpty) && !('unit_name' in quirkEmpty));
const noUnitId = checkMap('units without unit_id', [row({ id: 'q4', units: { name: 'Castle' } })])[0];
ok('units.name without a unit_id falls into the EE branch', !('unit_name' in noUnitId));

// product_name fallback chain.
ok('product_name prefers item_name', checkMap('name 1', [row({ item_name: 'A', product_name: 'B' })])[0].product_name === 'A');
ok('product_name falls back to product_name', checkMap('name 2', [row({ item_name: '', product_name: 'B' })])[0].product_name === 'B');
ok('product_name falls back to product_name when item_name is missing', checkMap('name 3', [row({ product_name: 'B' })])[0].product_name === 'B');
ok('product_name falls back to Event Essential', checkMap('name 4', [row({})])[0].product_name === 'Event Essential');
ok('item_name is kept raw (empty string) even when product_name is used',
  checkMap('name 5', [row({ item_name: '', product_name: 'B' })])[0].item_name === '');

// Order preserved, empty list, and length.
const mixed = [inflatableRow, productRow, bundleRow, row({ id: 'z', unit_id: 'u2', units: { name: 'Slide' } })];
const mappedMixed = checkMap('mixed', mixed);
ok('mapping preserves input order and length', mappedMixed.length === 4 && mappedMixed.map(m => m.id).join(',') === 'oi1,oi2,oi3,z');
ok('empty list maps to an empty list', same(checkMap('empty', []), []));

// ---------------------------------------------------------------------------
// buildNewInflatableItem
// ---------------------------------------------------------------------------

function checkAdd(label: string, unit: StageableUnit, mode: 'dry' | 'water'): StagedItem {
  const a = idFactory('new-inflatable');
  const o = idFactory('new-inflatable');
  const actual = buildNewInflatableItem(unit, mode, a.make);
  ok(`${label} [matches oracle]`, same(actual, oracleStageAdd(unit, mode, o.make)));
  ok(`${label} [ID factory called exactly once]`, a.calls() === 1 && o.calls() === 1);
  return actual;
}

const unit = (over: Record<string, unknown> = {}): StageableUnit =>
  ({ id: 'u1', name: 'Castle', price_dry_cents: 10000, price_water_cents: 15000, ...over }) as unknown as StageableUnit;

const dry = checkAdd('dry', unit(), 'dry');
ok('dry add uses the dry price', dry.unit_price_cents === 10000 && dry.wet_or_dry === 'dry');
ok('dry add builds the expected literal', same(dry, {
  client_id: 'new-inflatable-1', unit_id: 'u1', unit_name: 'Castle', qty: 1, wet_or_dry: 'dry',
  unit_price_cents: 10000, is_new: true, is_deleted: false,
}));
ok('dry add has exactly 8 keys', Object.keys(dry).length === 8);
ok('water add uses the water price', checkAdd('water', unit(), 'water').unit_price_cents === 15000);
ok('water add with a 0 water price falls back to the dry price', checkAdd('water 0', unit({ price_water_cents: 0 }), 'water').unit_price_cents === 10000);
ok('water add with a null water price falls back to the dry price', checkAdd('water null', unit({ price_water_cents: null }), 'water').unit_price_cents === 10000);
ok('water add with an undefined water price falls back to the dry price', checkAdd('water undef', unit({ price_water_cents: undefined }), 'water').unit_price_cents === 10000);
ok('dry mode ignores the water price', checkAdd('dry ignores', unit({ price_water_cents: 99999 }), 'dry').unit_price_cents === 10000);
ok('water mode keeps wet_or_dry as water even when the price falls back', checkAdd('water label', unit({ price_water_cents: 0 }), 'water').wet_or_dry === 'water');

// ---------------------------------------------------------------------------
// removeStagedItem
// ---------------------------------------------------------------------------

function checkRemove(label: string, prev: StagedItem[], target: StagedItem): StagedItem[] {
  const actual = removeStagedItem(prev, target);
  ok(`${label} [matches oracle]`, same(actual, oracleRemove(prev, target)));
  return actual;
}

// id precedence
const persistedA = st({ id: 'A', unit_id: 'u1', wet_or_dry: 'dry', is_new: false });
const persistedB = st({ id: 'B', unit_id: 'u1', wet_or_dry: 'dry', is_new: false });
let r = checkRemove('id match', [persistedA, persistedB], st({ id: 'A' }));
ok('id match marks the persisted row deleted', r[0].is_deleted === true && r[0] !== persistedA && r[0].id === 'A');
ok('id match keeps the unmatched row by reference and order', r[1] === persistedB && r.length === 2);
// id non-match does NOT fall through to client_id: candidate has id, target has a matching client_id but different id
const withBoth = st({ id: 'A', client_id: 'c1', is_new: false });
r = checkRemove('id non-match', [withBoth], st({ id: 'other', client_id: 'c1' }));
ok('a candidate with an id never falls through to client_id', r[0] === withBoth);
// client_id
const newC1 = st({ client_id: 'c1', unit_id: 'u1', wet_or_dry: 'dry', is_new: true });
const newC2 = st({ client_id: 'c2', unit_id: 'u1', wet_or_dry: 'dry', is_new: true });
r = checkRemove('client_id match', [newC1, newC2], st({ client_id: 'c1' }));
ok('client_id match on a NEW row removes it from the array', r.length === 1 && r[0] === newC2);
// client_id non-match does not fall through to unit_id
r = checkRemove('client_id non-match', [newC1], st({ client_id: 'other', unit_id: 'u1', wet_or_dry: 'dry' }));
ok('a candidate with a client_id never falls through to unit_id', r.length === 1 && r[0] === newC1);
// unit_id + wet_or_dry
const bare1 = st({ unit_id: 'u5', wet_or_dry: 'dry', is_new: false });
const bare2 = st({ unit_id: 'u5', wet_or_dry: 'water', is_new: false });
r = checkRemove('unit+mode match', [bare1, bare2], st({ unit_id: 'u5', wet_or_dry: 'dry' }));
ok('unit_id + wet_or_dry match marks only that row deleted', r[0].is_deleted === true && r[1] === bare2);
r = checkRemove('same unit different mode', [bare1], st({ unit_id: 'u5', wet_or_dry: 'water' }));
ok('same unit_id with a different wet_or_dry does not match', r[0] === bare1);
r = checkRemove('different unit', [bare1], st({ unit_id: 'u6', wet_or_dry: 'dry' }));
ok('a different unit_id does not match', r[0] === bare1);
// two identical bare rows both match
const bare1b = st({ unit_id: 'u5', wet_or_dry: 'dry', is_new: false });
r = checkRemove('duplicate bare rows', [bare1, bare1b], st({ unit_id: 'u5', wet_or_dry: 'dry' }));
ok('every row matching unit_id + wet_or_dry is affected', r[0].is_deleted === true && r[1].is_deleted === true);
// identity fallback
const eeRow = st({ product_id: 'p1', is_new: false });
r = checkRemove('identity match', [eeRow], eeRow);
ok('identity fallback matches the very same object', r[0].is_deleted === true && r[0] !== eeRow);
const eeClone = { ...eeRow };
r = checkRemove('identity clone', [eeRow], eeClone);
ok('a structurally identical clone does not identity-match', r[0] === eeRow);
// new vs persisted on identity path
const eeNew = st({ product_id: 'p1', is_new: true });
r = checkRemove('identity new', [eeNew], eeNew);
ok('a new row matched by identity is removed', r.length === 0);
// new vs persisted by id
const newWithId = st({ id: 'N', is_new: true });
r = checkRemove('new with id', [newWithId, persistedA], st({ id: 'N' }));
ok('a new row matched by id is removed entirely', r.length === 1 && r[0] === persistedA);
// already deleted persisted stays deleted (new object)
const alreadyDeleted = st({ id: 'D', is_deleted: true, is_new: false });
r = checkRemove('already deleted', [alreadyDeleted], st({ id: 'D' }));
ok('removing an already-deleted persisted row yields a new deleted object', r[0].is_deleted === true && r[0] !== alreadyDeleted);
ok('removal does not mutate the input row', persistedA.is_deleted === undefined);
// empty and ordering
ok('removal from an empty list is empty', same(checkRemove('empty', [], st({ id: 'x' })), []));
r = checkRemove('ordering', [persistedA, newC1, persistedB, newC2], st({ client_id: 'c1' }));
ok('ordering of the remaining rows is preserved', r.length === 3 && r[0] === persistedA && r[1] === persistedB && r[2] === newC2);

// ---------------------------------------------------------------------------
// addEEProductToStagedItems / addEEBundleToStagedItems
// ---------------------------------------------------------------------------

interface EERun { result: StagedItem[]; calls: number }

function checkAddEE(
  label: string,
  kind: 'product' | 'bundle',
  prev: StagedItem[],
  item: StagedItem,
): EERun {
  const a = idFactory('new-ee');
  const o = idFactory('new-ee');
  const actual = kind === 'product' ? addEEProductToStagedItems(prev, item, a.make) : addEEBundleToStagedItems(prev, item, a.make);
  const expected = kind === 'product' ? oracleAddProduct(prev, item, o.make) : oracleAddBundle(prev, item, o.make);
  ok(`${label} [matches oracle]`, same(actual, expected));
  ok(`${label} [factory calls match oracle]`, a.calls() === o.calls());
  return { result: actual, calls: a.calls() };
}

// --- product ---
const prod = (over: Record<string, unknown> = {}) =>
  st({ id: 'pr1', product_id: 'p1', qty: 2, unit_price_cents: 500, pricing_context: 'standalone', is_new: false, is_deleted: false, ...over });
const incomingProd = (over: Record<string, unknown> = {}) =>
  st({ product_id: 'p1', qty: 3, unit_price_cents: 500, pricing_context: 'standalone', is_new: true, is_deleted: false, ...over });

const pRow = prod();
let e = checkAddEE('product exact match', 'product', [pRow], incomingProd());
ok('product exact match merges quantity', e.result.length === 1 && e.result[0].qty === 5);
ok('product merge sets is_updated true and keeps the row identity fields', e.result[0].is_updated === true && e.result[0].id === 'pr1');
ok('product merge does not call the ID factory', e.calls === 0);
ok('product merge returns a new row and does not mutate the original', e.result[0] !== pRow && pRow.qty === 2 && pRow.is_updated === undefined);

e = checkAddEE('product merge into a NEW row', 'product', [prod({ id: undefined, client_id: 'n1', is_new: true })], incomingProd());
ok('merging into a new row still sets is_updated true', e.result[0].is_updated === true && e.result[0].qty === 5);

e = checkAddEE('product price mismatch', 'product', [pRow], incomingProd({ unit_price_cents: 600 }));
ok('product price mismatch appends a separate row', e.result.length === 2 && e.result[0] === pRow);
ok('product append without client_id calls the factory exactly once', e.calls === 1 && e.result[1].client_id === 'new-ee-1');

e = checkAddEE('product context mismatch', 'product', [pRow], incomingProd({ pricing_context: 'addon' }));
ok('product pricing-context mismatch appends a separate row', e.result.length === 2);

e = checkAddEE('product missing contexts', 'product', [prod({ pricing_context: undefined })], incomingProd({ pricing_context: null }));
ok("missing/null contexts both compare as 'standalone' and merge", e.result.length === 1 && e.result[0].qty === 5);
e = checkAddEE('product standalone vs missing', 'product', [prod({ pricing_context: undefined })], incomingProd({ pricing_context: 'standalone' }));
ok("a missing context equals an explicit 'standalone'", e.result.length === 1);

e = checkAddEE('product existing has bundle_id', 'product', [prod({ bundle_id: 'b1' })], incomingProd());
ok('an existing row with a bundle_id cannot match a product add', e.result.length === 2);
e = checkAddEE('product deleted row', 'product', [prod({ is_deleted: true })], incomingProd());
ok('a deleted row is ignored and a new row is appended', e.result.length === 2 && e.result[1].qty === 3);
e = checkAddEE('product different product_id', 'product', [pRow], incomingProd({ product_id: 'p2' }));
ok('a different product_id appends', e.result.length === 2);

const first = prod({ id: 'first', qty: 1 });
const second = prod({ id: 'second', qty: 1 });
e = checkAddEE('product two matches', 'product', [first, second], incomingProd({ qty: 2 }));
ok('only the first matching product row is merged', e.result[0].qty === 3 && e.result[1] === second && e.result[1].qty === 1);

e = checkAddEE('product with supplied client_id', 'product', [pRow], incomingProd({ unit_price_cents: 600, client_id: 'given' }));
ok('append with a supplied client_id does not call the factory and keeps it', e.calls === 0 && e.result[1].client_id === 'given');
e = checkAddEE('product with empty client_id', 'product', [pRow], incomingProd({ unit_price_cents: 600, client_id: '' }));
ok('an empty client_id is falsy, so the factory is called once', e.calls === 1 && e.result[1].client_id === 'new-ee-1');
ok('append copies the incoming item fields', e.result[1].qty === 3 && e.result[1].is_new === true && e.result[1].product_id === 'p1');
e = checkAddEE('product into empty', 'product', [], incomingProd());
ok('adding to an empty list appends one row and calls the factory once', e.result.length === 1 && e.calls === 1);

// Quirk: undefined === undefined. An inflatable row (no product_id, no bundle_id) matches an incoming
// product item that omits product_id when price and context also match.
const inflatableRowForQuirk = st({ id: 'inf', unit_id: 'u1', wet_or_dry: 'dry', qty: 1, unit_price_cents: 500, is_new: false });
e = checkAddEE('product undefined-id quirk', 'product', [inflatableRowForQuirk], st({ qty: 2, unit_price_cents: 500, is_new: true }));
ok('QUIRK: an incoming product item with no product_id merges into an unrelated row of the same price',
  e.result.length === 1 && e.result[0].qty === 3 && e.result[0].is_updated === true);

// --- bundle ---
const snapA = snap('Party Pack');
const bun = (over: Record<string, unknown> = {}) =>
  st({ id: 'bu1', bundle_id: 'b1', qty: 1, unit_price_cents: 9000, pricing_context: 'standalone', component_snapshot: snapA, is_new: false, is_deleted: false, ...over });
const incomingBun = (over: Record<string, unknown> = {}) =>
  st({ bundle_id: 'b1', qty: 2, unit_price_cents: 9000, pricing_context: 'standalone', component_snapshot: snap('Party Pack'), is_new: true, is_deleted: false, ...over });

const bRow = bun();
e = checkAddEE('bundle exact match', 'bundle', [bRow], incomingBun());
ok('bundle exact match merges quantity and sets is_updated', e.result.length === 1 && e.result[0].qty === 3 && e.result[0].is_updated === true);
ok('bundle merge does not call the ID factory', e.calls === 0);
ok('bundle merge does not mutate the original', bRow.qty === 1 && bRow.is_updated === undefined);

e = checkAddEE('bundle price mismatch', 'bundle', [bRow], incomingBun({ unit_price_cents: 8000 }));
ok('bundle price mismatch appends', e.result.length === 2 && e.calls === 1 && e.result[1].client_id === 'new-ee-1');
e = checkAddEE('bundle context mismatch', 'bundle', [bRow], incomingBun({ pricing_context: 'addon' }));
ok('bundle pricing-context mismatch appends', e.result.length === 2);
e = checkAddEE('bundle missing contexts', 'bundle', [bun({ pricing_context: undefined })], incomingBun({ pricing_context: null }));
ok("bundle missing/null contexts compare as 'standalone' and merge", e.result.length === 1);
e = checkAddEE('bundle different bundle_id', 'bundle', [bRow], incomingBun({ bundle_id: 'b2' }));
ok('a different bundle_id appends', e.result.length === 2);

e = checkAddEE('bundle snapshot mismatch', 'bundle', [bRow], incomingBun({ component_snapshot: snap('Party Pack', { components: [{ product_id: 'p1', product_name: 'Chair', quantity_per_bundle: 6 }] }) }));
ok('a different component snapshot appends a separate row', e.result.length === 2);

const reordered = { components: [{ product_id: 'p1', product_name: 'Chair', quantity_per_bundle: 4 }], bundle_description: null, bundle_name: 'Party Pack' } as BundleComponentSnapshot;
e = checkAddEE('bundle key order', 'bundle', [bRow], incomingBun({ component_snapshot: reordered }));
ok('QUIRK: the same snapshot with a different key order is a mismatch (JSON.stringify comparison)', e.result.length === 2);

e = checkAddEE('bundle null vs undefined snapshot', 'bundle', [bun({ component_snapshot: undefined })], incomingBun({ component_snapshot: null }));
ok('undefined and null snapshots are equivalent through || null', e.result.length === 1 && e.result[0].qty === 3);

e = checkAddEE('bundle existing deleted', 'bundle', [bun({ is_deleted: true })], incomingBun());
ok('a deleted bundle row is ignored', e.result.length === 2);

const b1 = bun({ id: 'first', qty: 1 });
const b2 = bun({ id: 'second', qty: 1 });
e = checkAddEE('bundle two matches', 'bundle', [b1, b2], incomingBun());
ok('only the first matching bundle row is merged', e.result[0].qty === 3 && e.result[1] === b2);

e = checkAddEE('bundle supplied client_id', 'bundle', [bRow], incomingBun({ unit_price_cents: 8000, client_id: 'given' }));
ok('bundle append with a supplied client_id calls the factory zero times', e.calls === 0 && e.result[1].client_id === 'given');
e = checkAddEE('bundle into empty', 'bundle', [], incomingBun());
ok('adding a bundle to an empty list appends once and calls the factory once', e.result.length === 1 && e.calls === 1);

// Quirk: a product row (no bundle_id, null snapshot) matches an incoming item with no bundle_id and null snapshot.
const productForBundleQuirk = st({ id: 'pq', product_id: 'p1', qty: 1, unit_price_cents: 9000, component_snapshot: null, is_new: false });
e = checkAddEE('bundle undefined-id quirk', 'bundle', [productForBundleQuirk], st({ qty: 2, unit_price_cents: 9000, component_snapshot: null, is_new: true }));
ok('QUIRK: an incoming bundle item with no bundle_id merges into an unrelated row with the same price and null snapshot',
  e.result.length === 1 && e.result[0].qty === 3);

// ---------------------------------------------------------------------------
// updateStagedItemQuantity
// ---------------------------------------------------------------------------

function checkQty(label: string, prev: StagedItem[], target: StagedItem, qty: number): StagedItem[] {
  const actual = updateStagedItemQuantity(prev, target, qty);
  ok(`${label} [matches oracle]`, same(actual, oracleQuantity(prev, target, qty)));
  return actual;
}

const qA = st({ id: 'A', qty: 2 });
const qB = st({ id: 'B', qty: 2 });
const qNew = st({ client_id: 'c1', qty: 2, is_new: true });
let q = checkQty('id match', [qA, qB], st({ id: 'A' }), 5);
ok('persisted id match updates qty and sets is_updated', q[0].qty === 5 && q[0].is_updated === true);
ok('unmatched rows keep their reference and order', q[1] === qB && q.length === 2);
ok('the original row is not mutated', qA.qty === 2 && qA.is_updated === undefined);
q = checkQty('client_id fallback', [qNew], st({ client_id: 'c1' }), 4);
ok('client_id fallback updates a new row and sets is_updated', q[0].qty === 4 && q[0].is_updated === true && q[0].is_new === true);
q = checkQty('id row ignores client_id', [st({ id: 'A', client_id: 'c1', qty: 2 })], st({ id: 'other', client_id: 'c1' }), 9);
ok('a row with an id never falls back to client_id', q[0].qty === 2);
ok('qty 0 becomes 1', checkQty('qty 0', [qA], st({ id: 'A' }), 0)[0].qty === 1);
ok('negative qty becomes 1', checkQty('qty -3', [qA], st({ id: 'A' }), -3)[0].qty === 1);
ok('positive qty is kept', checkQty('qty 7', [qA], st({ id: 'A' }), 7)[0].qty === 7);
ok('fractional qty stays fractional', checkQty('qty 2.5', [qA], st({ id: 'A' }), 2.5)[0].qty === 2.5);
ok('NaN qty stays NaN (Math.max(1, NaN))', Number.isNaN(checkQty('qty NaN', [qA], st({ id: 'A' }), NaN)[0].qty));
ok('Infinity qty is kept', checkQty('qty Infinity', [qA], st({ id: 'A' }), Infinity)[0].qty === Infinity);

// Quirk: rows with neither id nor client_id all match (undefined === undefined).
const anon1 = st({ unit_id: 'u1', qty: 1 });
const anon2 = st({ unit_id: 'u2', qty: 1 });
q = checkQty('anonymous rows', [anon1, anon2], st({ unit_id: 'zzz' }), 6);
ok('QUIRK: rows with neither id nor client_id all match a target that also has neither',
  q[0].qty === 6 && q[1].qty === 6 && q[0].is_updated === true && q[1].is_updated === true);
q = checkQty('no match', [qA], st({ id: 'nope' }), 3);
ok('a non-matching target leaves every row untouched', q[0] === qA);
ok('quantity update on an empty list is empty', same(checkQty('empty', [], st({ id: 'x' }), 3), []));

// ---------------------------------------------------------------------------
// The comparison helper itself
// ---------------------------------------------------------------------------

ok('same() treats { a: undefined } and {} as different', !same({ a: undefined }, {}));
ok('same() treats NaN as equal to NaN', same(NaN, NaN));
ok('same() treats different values as different', !same({ a: 1 }, { a: 2 }));

console.log(`\nStaged item model tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} staged item model test(s) failed`);
