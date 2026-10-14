// Stored order item display tests, split out of the former stageE4DefectFixes.test.ts. They call the real production helpers.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { hasGeneratorInOrderItems } from '../../eventEssentials/customerGeneratorCart';
import { buildPackageDisplay, isPackageItem, validatePackageSnapshot } from '../../pricing/packageDisplay';
import { formatStoredOrderItems } from '../../orders/formatStoredOrderItems';
import type { BundleComponentSnapshot } from '../../../types';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean) {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

const GENERATOR_PRODUCT_ID = '82a67261-2b54-4704-a8a0-4d346d0a8e60';

const CELEBRATION_BUNDLE_ID = 'cde247f7-522c-44f8-a6fc-a0bea426acb4';

const celebrationSnapshot: BundleComponentSnapshot = {
  bundle_name: 'Celebration Seating',
  bundle_description: '6 six-foot tables and 50 white folding chairs',
  components: [
    { product_id: '4cb4a96e-f6cf-4faa-917d-3e1d74146aa5', product_name: 'White Folding Chair', quantity_per_bundle: 50 },
    { product_id: 'aeed01e4-73a3-40a0-bb01-82ec2f60ee73', product_name: 'Six-foot Rectangular Table', quantity_per_bundle: 6 },
  ],
};

function makeOrderItem(overrides: Partial<any>): any {
  return {
    id: 'item-id-' + Math.random(),
    order_id: 'order-1',
    unit_id: null,
    product_id: null,
    bundle_id: null,
    item_name: null,
    pricing_context: null,
    component_snapshot: null,
    qty: 1,
    wet_or_dry: null,
    unit_price_cents: 0,
    ...overrides,
  };
}

function makeInflatableItem(name: string, price: number, qty = 1, mode: 'dry' | 'water' = 'dry'): any {
  return makeOrderItem({ unit_id: 'unit-' + name, qty, wet_or_dry: mode, unit_price_cents: price, units: { name } });
}

function makeEEProductItem(name: string, productId: string, price: number, qty = 1, context: 'standalone' | 'addon' = 'standalone'): any {
  return makeOrderItem({ product_id: productId, item_name: name, pricing_context: context, qty, unit_price_cents: price });
}

function makeEEBundleItem(name: string, bundleId: string, price: number, qty = 1, snapshot: BundleComponentSnapshot | null = celebrationSnapshot): any {
  return makeOrderItem({ bundle_id: bundleId, item_name: name, pricing_context: 'standalone', qty, unit_price_cents: price, component_snapshot: snapshot });
}

{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-1 Generator (Add-on)', formatted[0].name === 'Generator (Add-on)');
  ok('fmt-1 no Unknown Unit', !formatted[0].name.includes('Unknown Unit'));
}

{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-2 Event Essential', formatted[0].mode === 'Event Essential');
}

{
  const items = [makeEEBundleItem('Celebration Seating', CELEBRATION_BUNDLE_ID, 15000, 1)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-3 has components', formatted[0].components.length === 2);
  ok('fmt-3 chair', formatted[0].components[0].name === 'White Folding Chair');
  ok('fmt-3 table', formatted[0].components[1].name === 'Six-foot Rectangular Table');
}

{
  const items = [makeEEBundleItem('Celebration Seating', CELEBRATION_BUNDLE_ID, 15000, 3)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-4 chair qty=150', formatted[0].components[0].quantity === 150);
  ok('fmt-4 table qty=18', formatted[0].components[1].quantity === 18);
}

{
  const items = [makeEEBundleItem('Celebration Seating', CELEBRATION_BUNDLE_ID, 15000, 2)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-5 one line', formatted.length === 1);
  ok('fmt-5 price=15000', formatted[0].price === 15000);
  ok('fmt-5 qty=2', formatted[0].qty === 2);
}

{
  const items = [makeEEBundleItem('Old Package', 'old-bundle', 10000, 1, null)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-6 unavailable', formatted[0].packageContentsUnavailable === true);
  ok('fmt-6 no components', formatted[0].components.length === 0);
}

{
  const items = [makeInflatableItem('Tropical Slide', 25000, 1, 'water')];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-7 name', formatted[0].name === 'Tropical Slide');
  ok('fmt-7 Water', formatted[0].mode === 'Water');
}

{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  ok('gen-14 direct generator → Yes', hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 }) === true);
}

{
  const snapshotWithGen: BundleComponentSnapshot = { bundle_name: 'P', bundle_description: '', components: [{ product_id: GENERATOR_PRODUCT_ID, product_name: 'Generator', quantity_per_bundle: 1 }] };
  const items = [makeEEBundleItem('P', 'b', 20000, 1, snapshotWithGen)];
  ok('gen-15 package generator → Yes', hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 }) === true);
}

{
  const items = [makeEEProductItem('Tables', 'other', 5000, 2), makeEEBundleItem('Chair Package', 'b', 10000, 1)];
  ok('gen-16 unrelated → No', hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 }) === false);
}

{ ok('gen-17 legacy → Yes', hasGeneratorInOrderItems({ orderItems: [], generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 2 }) === true); }

{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  const r1 = hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 });
  ok('gen-18 same result', r1 === hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 }));
}

{
  const result = buildPackageDisplay({ bundleName: 'Celebration Seating', bundleQty: 2, unitPriceCents: 15000, componentSnapshot: celebrationSnapshot });
  ok('36 chair qty=100', result.components[0].quantity === 100);
  ok('36 table qty=12', result.components[1].quantity === 12);
}

{
  const result = buildPackageDisplay({ bundleName: 'Old', bundleQty: 1, unitPriceCents: 10000, componentSnapshot: null });
  ok('37 no components', result.components.length === 0);
  ok('37 hasSnapshot=false', result.hasSnapshot === false);
}

{
  ok('38 bundle is package', isPackageItem({ item_type: 'event_essential_bundle', bundle_id: 'b1', unit_id: null }) === true);
  ok('38 product not package', isPackageItem({ item_type: 'event_essential_product', product_id: 'p1', unit_id: null }) === false);
  ok('38 inflatable not package', isPackageItem({ unit_id: 'u1', bundle_id: null }) === false);
}

{
  const result = validatePackageSnapshot({ bundle_id: 'b1', bundle_name: 'Test', unit_price_cents: 10000, qty: 1, component_snapshot: null });
  ok('39 missing snapshot rejected', !result.ok);
}

console.log(`\nStored order item display tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
