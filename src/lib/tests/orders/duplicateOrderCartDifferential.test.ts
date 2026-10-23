// "Duplicate order" differential test: buildDuplicateCart / describeOrderLine must behave EXACTLY like the implementation that existed before the
// TypeScript/ESLint cleanup (git 9ce4d7c~1), for every shape of stored line, including the shapes the database cannot produce today.
// The cleanup had introduced runtime defaults (`?? 0`, `?? ''`, `|| 0`, a snapshot-name helper). Those change what reaches the cart:
// a line with NO stored price used to be dropped when the saved cart is reloaded (normalizeCartItems rejects a missing price), and a
// combo without stored prices used to be re-hydrated from the catalog; with a default of 0 the line stays at $0 and is never hydrated.
// PASS - LOCAL AUTOMATED. The ORACLE below is the pre-cleanup code copied verbatim (types loosened to any, which is why this file carries the
// file-level any exception: it is a verbatim copy of legacy code, not a fake client).
/* eslint-disable @typescript-eslint/no-explicit-any -- verbatim copy of the pre-cleanup implementation used as the oracle */
import { buildDuplicateCart, describeOrderLine } from '../../orders/duplicateOrderCart';
import { normalizeCartItems } from '../../eventEssentials/unifiedCart';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}

// ---------------- ORACLE: verbatim from `git show 9ce4d7c~1:src/lib/orders/duplicateOrderCart.ts` ----------------
function oraclePricingContextOf(value: unknown): 'addon' | 'standalone' {
  return value === 'addon' ? 'addon' : 'standalone';
}
function oracleIsUsableSnapshot(value: any): boolean {
  return !!value && typeof value === 'object' && Array.isArray(value.components);
}
function oracleBuildDuplicateCart(items: any[]): { cartItems: any[]; unavailable: string[] } {
  const cartItems: any[] = [];
  const unavailable: string[] = [];

  for (const item of items ?? []) {
    const qty = Number(item?.qty) > 0 ? Number(item.qty) : 1;

    if (item?.unit_id) {
      const unit = item.units;
      if (unit && unit.active !== false) {
        const types: string[] = Array.isArray(unit.types) ? unit.types : [];
        cartItems.push({
          item_type: 'inflatable',
          unit_id: item.unit_id,
          unit_name: unit.name,
          wet_or_dry: item.wet_or_dry === 'water' ? 'water' : 'dry',
          unit_price_cents: item.unit_price_cents,
          price_dry_cents: unit.price_dry_cents ?? item.unit_price_cents,
          price_water_cents: unit.price_water_cents || unit.price_dry_cents || item.unit_price_cents,
          qty,
          is_combo: types.includes('Combo') || types.includes('Water Slide') || unit.is_combo === true,
        });
      } else {
        unavailable.push(unit?.name || item.item_name || 'Inflatable no longer offered');
      }
      continue;
    }

    if (item?.bundle_id) {
      cartItems.push({
        item_type: 'event_essential_bundle',
        bundle_id: item.bundle_id,
        bundle_name: item.item_name || item.component_snapshot?.bundle_name || 'Event Essentials package',
        unit_price_cents: item.unit_price_cents,
        qty,
        pricing_context: oraclePricingContextOf(item.pricing_context),
        component_snapshot: oracleIsUsableSnapshot(item.component_snapshot)
          ? item.component_snapshot
          : { bundle_name: item.item_name ?? '', bundle_description: null, components: [] },
      });
      continue;
    }

    if (item?.product_id) {
      cartItems.push({
        item_type: 'event_essential_product',
        product_id: item.product_id,
        product_name: item.item_name || 'Event Essential',
        unit_price_cents: item.unit_price_cents,
        qty,
        pricing_context: oraclePricingContextOf(item.pricing_context),
      });
      continue;
    }

    unavailable.push(item?.item_name || 'Item');
  }

  return { cartItems, unavailable };
}
function oracleDescribeOrderLine(item: any): { name: string; badge: 'Wet' | 'Dry' | null } {
  const unitName = item?.units?.name;
  if (item?.unit_id && unitName) {
    return { name: unitName, badge: item.wet_or_dry === 'water' ? 'Wet' : 'Dry' };
  }
  return { name: item?.item_name || item?.component_snapshot?.bundle_name || 'Event Essentials item', badge: null };
}
// -------------------------------------------------------------------------------------------------------------------

// Strict deep equality that distinguishes a missing/undefined value from 0, null and ''.
function strictEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => strictEqual((a as any)[k], (b as any)[k]));
}

const snapshot = { bundle_name: 'Party Pack', bundle_description: null, components: [{ product_id: 'p1', product_name: 'Table', quantity_per_bundle: 2 }] };
const goodUnit = { name: 'Castle', active: true, types: ['Bounce House'], is_combo: false, price_dry_cents: 15000, price_water_cents: null };
const comboUnit = { name: 'Splash', active: true, types: ['Combo'], is_combo: true, price_dry_cents: 20000, price_water_cents: 25000 };

// fixtures: [label, stored lines]
const MATRIX: Array<[string, any[] | null | undefined]> = [
  ['null items', null],
  ['undefined items', undefined],
  ['empty items', []],
  ['a normal dry inflatable', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 15000, units: goodUnit }]],
  ['a normal wet combo', [{ unit_id: 'u2', qty: 2, wet_or_dry: 'water', unit_price_cents: 25000, units: comboUnit }]],
  ['combo flag only on the unit', [{ unit_id: 'u2', qty: 1, wet_or_dry: 'dry', unit_price_cents: 1, units: { ...goodUnit, is_combo: true } }]],
  ['Water Slide type', [{ unit_id: 'u3', qty: 1, wet_or_dry: 'water', unit_price_cents: 9, units: { ...goodUnit, types: ['Water Slide'] } }]],
  ['types missing / not an array', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 5, units: { ...goodUnit, types: undefined } }, { unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 5, units: { ...goodUnit, types: 'Combo' } }]],
  ['qty variants', [{ unit_id: 'u1', qty: '3', wet_or_dry: 'dry', unit_price_cents: 5, units: goodUnit }, { unit_id: 'u1', qty: 0, wet_or_dry: 'dry', unit_price_cents: 5, units: goodUnit }, { unit_id: 'u1', qty: -2, wet_or_dry: 'dry', unit_price_cents: 5, units: goodUnit }, { unit_id: 'u1', wet_or_dry: 'dry', unit_price_cents: 5, units: goodUnit }, { unit_id: 'u1', qty: 'x', wet_or_dry: 'dry', unit_price_cents: 5, units: goodUnit }, { unit_id: 'u1', qty: null, wet_or_dry: 'dry', unit_price_cents: 5, units: goodUnit }]],
  ['wet_or_dry variants', [{ unit_id: 'u1', qty: 1, unit_price_cents: 5, units: goodUnit }, { unit_id: 'u1', qty: 1, wet_or_dry: 'wet', unit_price_cents: 5, units: goodUnit }, { unit_id: 'u1', qty: 1, wet_or_dry: null, unit_price_cents: 5, units: goodUnit }]],
  // missing prices
  ['inflatable with NO stored price (key absent)', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', units: goodUnit }]],
  ['inflatable with a null stored price', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: null, units: goodUnit }]],
  ['inflatable with a stored price of 0', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 0, units: goodUnit }]],
  ['unit without dry price AND line without price', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', units: { ...goodUnit, price_dry_cents: undefined } }]],
  ['unit with null dry price and a stored price', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 7000, units: { ...goodUnit, price_dry_cents: null } }]],
  ['combo with no prices anywhere (would be hydrated from the catalog)', [{ unit_id: 'u2', qty: 1, wet_or_dry: 'water', units: { name: 'Splash', active: true, types: ['Combo'], is_combo: true } }]],
  ['water price null / 0 / missing with a dry price', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 5, units: { ...goodUnit, price_water_cents: 0 } }, { unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 5, units: { ...goodUnit, price_water_cents: undefined } }]],
  ['a free unit (all prices 0)', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 0, units: { ...goodUnit, price_dry_cents: 0, price_water_cents: 0 } }]],
  // missing names
  ['unit name null / undefined / blank', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 5, units: { ...goodUnit, name: null } }, { unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 5, units: { ...goodUnit, name: undefined } }, { unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 5, units: { ...goodUnit, name: '' } }]],
  // unavailable / retired
  ['retired unit with a name', [{ unit_id: 'u9', qty: 1, wet_or_dry: 'dry', unit_price_cents: 5, item_name: 'Old Castle', units: { ...goodUnit, active: false } }]],
  ['retired unit, name only on the line', [{ unit_id: 'u9', qty: 1, item_name: 'Line Name', units: { active: false } }]],
  ['retired unit, no names', [{ unit_id: 'u9', qty: 1, units: { active: false } }]],
  ['unit no longer exists (units null)', [{ unit_id: 'u9', qty: 1, item_name: 'Gone', units: null }, { unit_id: 'u9', qty: 1, units: null }, { unit_id: 'u9', qty: 1 }]],
  ['unit.active null is still offered', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 5, units: { ...goodUnit, active: null } }]],
  // Event Essentials products
  ['normal EE product', [{ product_id: 'p1', qty: 3, item_name: 'Table', unit_price_cents: 2500, pricing_context: 'standalone' }]],
  ['EE product add-on context', [{ product_id: 'p1', qty: 1, item_name: 'Chair', unit_price_cents: 300, pricing_context: 'addon' }, { product_id: 'p1', qty: 1, item_name: 'Chair', unit_price_cents: 300, pricing_context: 'weird' }, { product_id: 'p1', qty: 1, item_name: 'Chair', unit_price_cents: 300 }]],
  ['EE product with NO stored price', [{ product_id: 'p1', qty: 1, item_name: 'Table', pricing_context: 'standalone' }]],
  ['EE product with a null stored price', [{ product_id: 'p1', qty: 1, item_name: 'Table', unit_price_cents: null, pricing_context: 'standalone' }]],
  ['EE product with price 0', [{ product_id: 'p1', qty: 1, item_name: 'Table', unit_price_cents: 0, pricing_context: 'standalone' }]],
  ['EE product with blank / missing name', [{ product_id: 'p1', qty: 1, item_name: '', unit_price_cents: 5 }, { product_id: 'p1', qty: 1, unit_price_cents: 5 }, { product_id: 'p1', qty: 1, item_name: null, unit_price_cents: 5 }]],
  ['deleted product (no product, no unit, no bundle)', [{ qty: 1, item_name: 'Removed Tent', is_deleted: true }, { qty: 1, is_deleted: true }, { qty: 1, item_name: '' }]],
  ['deleted flag on a still-listed product', [{ product_id: 'p1', qty: 1, item_name: 'Table', unit_price_cents: 5, is_deleted: true }]],
  // Event Essentials bundles
  ['normal bundle', [{ bundle_id: 'b1', qty: 1, item_name: 'Party Pack', unit_price_cents: 9000, pricing_context: 'standalone', component_snapshot: snapshot }]],
  ['bundle with NO stored price', [{ bundle_id: 'b1', qty: 1, item_name: 'Party Pack', pricing_context: 'standalone', component_snapshot: snapshot }]],
  ['bundle with a null stored price', [{ bundle_id: 'b1', qty: 1, item_name: 'Party Pack', unit_price_cents: null, pricing_context: 'addon', component_snapshot: snapshot }]],
  ['bundle with a blank name, name from the snapshot', [{ bundle_id: 'b1', qty: 1, item_name: '', unit_price_cents: 5, component_snapshot: snapshot }, { bundle_id: 'b1', qty: 1, unit_price_cents: 5, component_snapshot: snapshot }]],
  ['bundle with no usable snapshot', [{ bundle_id: 'b1', qty: 1, item_name: 'Party Pack', unit_price_cents: 5 }, { bundle_id: 'b1', qty: 1, item_name: 'Party Pack', unit_price_cents: 5, component_snapshot: 'nope' }, { bundle_id: 'b1', qty: 1, item_name: 'Party Pack', unit_price_cents: 5, component_snapshot: { bundle_name: 'x' } }, { bundle_id: 'b1', qty: 1, unit_price_cents: 5, component_snapshot: null }]],
  ['bundle whose snapshot name is not a string', [{ bundle_id: 'b1', qty: 1, unit_price_cents: 5, component_snapshot: { bundle_name: 42, bundle_description: null, components: [] } }]],
  ['mixed order', [{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 15000, units: goodUnit }, { product_id: 'p1', qty: 2, item_name: 'Table', unit_price_cents: 2500, pricing_context: 'addon' }, { bundle_id: 'b1', qty: 1, item_name: 'Party Pack', unit_price_cents: 9000, pricing_context: 'standalone', component_snapshot: snapshot }, { unit_id: 'u9', qty: 1, item_name: 'Gone', units: null }]],
];

// the cart as it is stored and reloaded by Quote: JSON round trip, then normalizeCartItems (the real downstream gate)
const reload = (cart: unknown[]) => normalizeCartItems(JSON.parse(JSON.stringify(cart)));

for (const [label, lines] of MATRIX) {
  const oldR = oracleBuildDuplicateCart(lines as any);
  const newR = buildDuplicateCart(lines as any);
  ok(`${label}: the cart items are identical to the pre-cleanup output`, strictEqual(newR.cartItems, oldR.cartItems));
  ok(`${label}: the "no longer available" list is identical`, strictEqual(newR.unavailable, oldR.unavailable));
  ok(`${label}: what Quote ends up with after the stored cart is reloaded is identical (lines kept or dropped, prices, names)`, strictEqual(reload(newR.cartItems), reload(oldR.cartItems)));
  for (const line of lines ?? []) {
    ok(`${label}: describeOrderLine is identical`, strictEqual(describeOrderLine(line as any), oracleDescribeOrderLine(line)));
  }
}
ok('describeOrderLine of null / undefined', strictEqual(describeOrderLine(null), oracleDescribeOrderLine(null)) && strictEqual(describeOrderLine(undefined), oracleDescribeOrderLine(undefined)));

// the specific consequences the defaults had (explicit, so a regression names itself)
{
  const noPrice = reload(buildDuplicateCart([{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', units: goodUnit }] as any).cartItems);
  ok('an inflatable line with no stored price is not turned into a $0 line', noPrice.length === 0);
  const noPriceEE = reload(buildDuplicateCart([{ product_id: 'p1', qty: 1, item_name: 'Table', pricing_context: 'standalone' }] as any).cartItems);
  ok('an Event Essentials line with no stored price is not turned into a $0 line', noPriceEE.length === 0);
  const comboNoPrice = buildDuplicateCart([{ unit_id: 'u2', qty: 1, wet_or_dry: 'water', units: { name: 'Splash', active: true, types: ['Combo'], is_combo: true } }] as any).cartItems[0] as any;
  ok('a combo without any price information keeps its prices undefined so Quote hydrates them from the catalog (not a stored $0)', comboNoPrice.price_dry_cents === undefined && comboNoPrice.price_water_cents === undefined);
  const free = reload(buildDuplicateCart([{ unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 0, units: { ...goodUnit, price_dry_cents: 0, price_water_cents: 0 } }] as any).cartItems);
  ok('a genuinely free unit (stored price 0) is still kept at 0', free.length === 1 && (free[0] as any).unit_price_cents === 0);
}

console.log(`duplicateOrderCartDifferential: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} duplicate-order differential test(s) failed`);
