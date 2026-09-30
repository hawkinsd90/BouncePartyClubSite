// Characterization tests for catalogCardModel.
//
// The oracles are verbatim copies of the inline code that lived in the product/bundle
// cards of EventEssentialsCatalog before the extraction (the in-cart reduce and the
// availability-status ternary chain, with the JSX replaced by a plain result). They
// never call the helpers. Current behavior is pinned, not endorsed.

import { sumInCartQty, deriveAvailabilityStatus } from './catalogCardModel';
import type { AvailabilityStatus } from './catalogCardModel';

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

// ---------- in-cart quantity ----------
type Row = { item_type: 'event_essential_product' | 'event_essential_bundle' | 'inflatable'; qty: number; product_id?: string; bundle_id?: string };
const isProduct = (i: Row) => i.item_type === 'event_essential_product';
const isBundle = (i: Row) => i.item_type === 'event_essential_bundle';

// Oracle (verbatim reduce, product variant and bundle variant)
function oracleProduct(cart: Row[], productId: string): number {
  return cart.reduce<number>((sum, item) => {
    if (isProduct(item) && item.product_id === productId) {
      return sum + item.qty;
    }
    return sum;
  }, 0);
}
function oracleBundle(cart: Row[], bundleId: string): number {
  return cart.reduce<number>((sum, item) => {
    if (isBundle(item) && item.bundle_id === bundleId) {
      return sum + item.qty;
    }
    return sum;
  }, 0);
}

function both(label: string, cart: Row[], id: string) {
  const before = JSON.stringify(cart);
  const p = sumInCartQty(cart, (i) => isProduct(i) && i.product_id === id);
  const b = sumInCartQty(cart, (i) => isBundle(i) && i.bundle_id === id);
  eq(`${label}: product`, p, oracleProduct(cart, id));
  eq(`${label}: bundle`, b, oracleBundle(cart, id));
  eq(`${label}: input untouched`, JSON.stringify(cart), before);
  return { p, b };
}

eq('empty', both('empty', [], 'x'), { p: 0, b: 0 });
{
  const cart: Row[] = [
    { item_type: 'event_essential_product', product_id: 'a', qty: 2 },
    { item_type: 'event_essential_product', product_id: 'b', qty: 5 },
    { item_type: 'event_essential_bundle', bundle_id: 'a', qty: 7 },
    { item_type: 'inflatable', qty: 9 },
    { item_type: 'event_essential_product', product_id: 'a', qty: 3 },
  ];
  eq('product a sums matching rows only', both('mixed a', cart, 'a'), { p: 5, b: 7 });
  eq('product b', both('mixed b', cart, 'b'), { p: 5, b: 0 });
  eq('no match', both('mixed z', cart, 'z'), { p: 0, b: 0 });
}
// product vs bundle: same id string in both id fields never cross-matches
{
  const cart: Row[] = [
    { item_type: 'event_essential_product', product_id: 'same', bundle_id: 'same', qty: 1 },
    { item_type: 'event_essential_bundle', product_id: 'same', bundle_id: 'same', qty: 10 },
  ];
  eq('type guard separates product and bundle', both('cross', cart, 'same'), { p: 1, b: 10 });
}
// zero, negative, duplicate rows and missing ids are summed / skipped exactly as before
{
  const cart: Row[] = [
    { item_type: 'event_essential_product', product_id: 'a', qty: 0 },
    { item_type: 'event_essential_product', product_id: 'a', qty: -2 },
    { item_type: 'event_essential_product', product_id: 'a', qty: 4 },
    { item_type: 'event_essential_product', product_id: 'a', qty: 4 },
    { item_type: 'event_essential_product', qty: 100 },
  ];
  eq('zero/negative/duplicates', both('odd', cart, 'a').p, 6);
  eq('undefined id never matches a real id', both('undef', cart, 'undefined').p, 0);
  eq('undefined id matches undefined (oracle agrees)', [sumInCartQty(cart, (i) => isProduct(i) && i.product_id === undefined), oracleProduct(cart, undefined as unknown as string)], [100, 100]);
}
// The predicate is only called once per row, in order
{
  const cart: Row[] = [{ item_type: 'inflatable', qty: 1 }, { item_type: 'inflatable', qty: 2 }, { item_type: 'inflatable', qty: 3 }];
  const seen: number[] = [];
  sumInCartQty(cart, (i) => { seen.push(i.qty); return false; });
  eq('predicate order and count', seen, [1, 2, 3]);
}

// ---------- availability status ----------
type In = { datesValid: boolean; hasAvailError: boolean; checkingAvailability: boolean; hasAvail: boolean; inCartQty: number; maxAddable: number };

// Oracle (verbatim ternary chain from the product card; JSX -> plain result)
function oracleStatus(i: In): AvailabilityStatus {
  return !i.datesValid ? { kind: 'select-dates' }
    : i.hasAvailError ? { kind: 'error' }
    : i.checkingAvailability ? { kind: 'checking' }
    : i.hasAvail ? {
      kind: 'text',
      text: i.inCartQty > 0 && i.maxAddable > 0
        ? `${i.inCartQty} in cart · ${i.maxAddable} more available to add`
        : i.inCartQty > 0 && i.maxAddable === 0
          ? `${i.inCartQty} in cart · No more available for selected dates`
          : i.maxAddable > 0
            ? `${i.maxAddable} available to add`
            : 'None available for selected dates',
    }
    : { kind: 'none' };
}

// Exhaustive over the boolean gates and a spread of quantities (including negative / zero / fractional)
{
  const bools = [false, true];
  const nums = [-1, 0, 1, 2, 5, 0.5];
  let count = 0;
  for (const datesValid of bools) for (const hasAvailError of bools) for (const checkingAvailability of bools) for (const hasAvail of bools)
    for (const inCartQty of nums) for (const maxAddable of nums) {
      const input = { datesValid, hasAvailError, checkingAvailability, hasAvail, inCartQty, maxAddable };
      const actual = deriveAvailabilityStatus(input);
      const expected = oracleStatus(input);
      if (JSON.stringify(actual) === JSON.stringify(expected)) passed++; else { failed++; console.error('FAIL status', JSON.stringify(input)); }
      count++;
    }
  ok('exhaustive grid ran', count === 2 * 2 * 2 * 2 * 6 * 6);
}

// Literal pins for every text-affecting branch
{
  const base = { datesValid: true, hasAvailError: false, checkingAvailability: false, hasAvail: true };
  eq('dates missing wins over everything', deriveAvailabilityStatus({ ...base, datesValid: false, hasAvailError: true, checkingAvailability: true, inCartQty: 1, maxAddable: 1 }), { kind: 'select-dates' });
  eq('error beats checking', deriveAvailabilityStatus({ ...base, hasAvailError: true, checkingAvailability: true, inCartQty: 1, maxAddable: 1 }), { kind: 'error' });
  eq('checking beats result', deriveAvailabilityStatus({ ...base, checkingAvailability: true, inCartQty: 1, maxAddable: 1 }), { kind: 'checking' });
  eq('no result -> none', deriveAvailabilityStatus({ ...base, hasAvail: false, inCartQty: 1, maxAddable: 1 }), { kind: 'none' });
  eq('in cart + more', deriveAvailabilityStatus({ ...base, inCartQty: 2, maxAddable: 3 }), { kind: 'text', text: '2 in cart · 3 more available to add' });
  eq('in cart + none more', deriveAvailabilityStatus({ ...base, inCartQty: 2, maxAddable: 0 }), { kind: 'text', text: '2 in cart · No more available for selected dates' });
  eq('available only', deriveAvailabilityStatus({ ...base, inCartQty: 0, maxAddable: 4 }), { kind: 'text', text: '4 available to add' });
  eq('none available', deriveAvailabilityStatus({ ...base, inCartQty: 0, maxAddable: 0 }), { kind: 'text', text: 'None available for selected dates' });
  // odd current behavior, pinned: negative maxAddable with items in cart falls through to the last text
  eq('negative maxAddable, in cart', deriveAvailabilityStatus({ ...base, inCartQty: 2, maxAddable: -1 }), { kind: 'text', text: 'None available for selected dates' });
}

console.log(`Catalog card model tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} catalog card model test(s) failed`);
