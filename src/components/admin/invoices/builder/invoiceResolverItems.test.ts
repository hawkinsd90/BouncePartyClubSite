// Differential characterization tests for mapCartToStagedForResolver.
//
// The oracle is a verbatim copy of the cart mapper that lived inline (twice) in
// InvoiceBuilder before the extraction. It never calls the helper. The exact
// output keys, key order and values are pinned, including that nothing is
// normalized, filtered, sorted or defaulted.

import { mapCartToStagedForResolver } from './invoiceResolverItems';

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
type CartLike = { unit_id: string; qty: number; mode: string; adjusted_price_cents: number };
function oracle(cartItems: CartLike[]) {
  return cartItems.map(item => ({
    unit_id: item.unit_id,
    qty: item.qty,
    wet_or_dry: item.mode,
    unit_price_cents: item.adjusted_price_cents,
    is_deleted: false,
  }));
}

function cart(id: string, mode: string, qty: number, price: number, extra: Record<string, unknown> = {}): CartLike {
  return { unit_id: id, qty, mode, adjusted_price_cents: price, ...extra };
}

function same(label: string, items: CartLike[]) {
  const before = JSON.stringify(items);
  const actual = mapCartToStagedForResolver(items);
  const expected = oracle(items);
  eq(`${label}: output`, actual, expected);
  eq(`${label}: key order`, actual.map(o => Object.keys(o)), expected.map(o => Object.keys(o)));
  eq(`${label}: input not mutated`, JSON.stringify(items), before);
}

// Empty
same('empty', []);
eq('empty result', mapCartToStagedForResolver([]), []);

// Normal dry / water items, exact literal
{
  const items = [cart('u1', 'dry', 2, 15000), cart('u2', 'water', 1, 22500)];
  same('normal', items);
  eq('literal', mapCartToStagedForResolver(items), [
    { unit_id: 'u1', qty: 2, wet_or_dry: 'dry', unit_price_cents: 15000, is_deleted: false },
    { unit_id: 'u2', qty: 1, wet_or_dry: 'water', unit_price_cents: 22500, is_deleted: false },
  ]);
  eq('exact keys', Object.keys(mapCartToStagedForResolver(items)[0]), ['unit_id', 'qty', 'wet_or_dry', 'unit_price_cents', 'is_deleted']);
}

// Only adjusted_price_cents is used (not price_cents), and extra cart fields are dropped
{
  const items = [cart('u1', 'dry', 1, 12000, { id: 'c1', unit_name: 'Castle', price_cents: 99999, inventory_qty: 5, wet_or_dry: 'water' })];
  same('extra fields', items);
  const r = mapCartToStagedForResolver(items)[0] as Record<string, unknown>;
  eq('uses adjusted price', r.unit_price_cents, 12000);
  eq('uses mode, not cart wet_or_dry', r.wet_or_dry, 'dry');
  ok('drops id', !('id' in r));
  ok('drops unit_name', !('unit_name' in r));
  ok('drops price_cents', !('price_cents' in r));
  ok('drops inventory_qty', !('inventory_qty' in r));
  ok('no product_id/bundle_id/pricing_context/component_snapshot', !('product_id' in r) && !('bundle_id' in r) && !('pricing_context' in r) && !('component_snapshot' in r));
}

// Quantity and price pass through unchanged (zero, negative, fractional: no normalization)
{
  const items = [cart('u1', 'dry', 0, 0), cart('u2', 'water', -3, -100), cart('u3', 'dry', 1.5, 199.5)];
  same('unnormalized numbers', items);
  eq('numbers pass through', mapCartToStagedForResolver(items).map(o => [o.qty, o.unit_price_cents]), [[0, 0], [-3, -100], [1.5, 199.5]]);
}

// Undefined / null values pass through as-is
{
  const items = [
    { unit_id: undefined as unknown as string, qty: undefined as unknown as number, mode: undefined as unknown as string, adjusted_price_cents: undefined as unknown as number },
    { unit_id: null as unknown as string, qty: null as unknown as number, mode: null as unknown as string, adjusted_price_cents: null as unknown as number },
  ];
  const actual = mapCartToStagedForResolver(items);
  const expected = oracle(items);
  ok('undefined kept as own keys', Object.keys(actual[0]).length === 5 && Object.keys(expected[0]).length === 5);
  eq('undefined item keys', Object.keys(actual[0]), Object.keys(expected[0]));
  ok('undefined values', actual[0].unit_id === undefined && actual[0].qty === undefined && actual[0].wet_or_dry === undefined && actual[0].unit_price_cents === undefined);
  ok('null values', actual[1].unit_id === null && actual[1].qty === null && actual[1].wet_or_dry === null && actual[1].unit_price_cents === null);
  eq('null item', JSON.stringify(actual[1]), JSON.stringify(expected[1]));
}

// Ordering, duplicates, one output per input, is_deleted always literal false
{
  const items = [cart('b', 'dry', 1, 1), cart('a', 'dry', 1, 1), cart('b', 'dry', 1, 1), cart('a', 'water', 2, 2)];
  same('order and duplicates', items);
  eq('order kept', mapCartToStagedForResolver(items).map(o => o.unit_id), ['b', 'a', 'b', 'a']);
  ok('all is_deleted === false', mapCartToStagedForResolver(items).every(o => o.is_deleted === false));
}

// Fresh objects and a fresh array
{
  const items = [cart('u1', 'dry', 1, 1)];
  const r1 = mapCartToStagedForResolver(items);
  const r2 = mapCartToStagedForResolver(items);
  ok('fresh array', r1 !== r2 && r1 !== (items as unknown));
  ok('fresh objects', r1[0] !== r2[0] && (r1[0] as unknown) !== items[0]);
}

console.log(`Invoice resolver item mapper tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} invoice resolver item test(s) failed`);
