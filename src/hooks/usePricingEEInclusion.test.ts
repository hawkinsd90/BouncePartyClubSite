// Tests importing actual production helpers from generatorUnified.ts
// jiti runner, no React/Supabase.

import { aggregateOrderEquipment } from '../lib/generatorUnified';

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean): void {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

function test(name: string, fn: () => void): void {
  try { fn(); } catch (err) { failed++; console.error(`FAIL: ${name}:`, err); }
}

const generatorProductId = 'gen-abc';

test('should preserve unrelated EE items after a package containing Generator', () => {
  const orderItems = [
    { unit_id: 'unit-1', units: { name: 'Castle Bounce' }, qty: 1, wet_or_dry: 'dry' },
    { item_name: 'Party Package', product_id: 'pkg-1', qty: 1, component_snapshot: { components: [{ product_id: generatorProductId, quantity_per_bundle: 1 }] } },
    { item_name: 'Tables (6)', product_id: 'tables-1', qty: 1 },
  ];
  const result = aggregateOrderEquipment(orderItems as any, generatorProductId, 0);
  ok('package generator qty = 1', result.packageGeneratorQty === 1);
  ok('ee generator qty = 0', result.eeGeneratorQty === 0);
  ok('tables preserved', result.genericItems.includes('Tables (6)'));
});

test('should not double-count direct EE Generator + package Generator', () => {
  const orderItems = [
    { item_name: 'Party Package', product_id: 'pkg-1', qty: 1, component_snapshot: { components: [{ product_id: generatorProductId, quantity_per_bundle: 1 }] } },
    { item_name: 'Generator', product_id: generatorProductId, qty: 2 },
  ];
  const result = aggregateOrderEquipment(orderItems as any, generatorProductId, 0);
  ok('package generator qty = 1', result.packageGeneratorQty === 1);
  ok('ee generator qty = 2', result.eeGeneratorQty === 2);
  ok('generator not in generic items', !result.genericItems.includes('Generator'));
});

test('should handle items without component_snapshot as generic items', () => {
  const orderItems = [{ item_name: 'Chairs (10)', product_id: 'chairs-1', qty: 2 }];
  const result = aggregateOrderEquipment(orderItems as any, generatorProductId, 0);
  ok('chairs in generic items', result.genericItems.includes('Chairs (10)'));
  ok('ee generator qty = 0', result.eeGeneratorQty === 0);
  ok('package generator qty = 0', result.packageGeneratorQty === 0);
});

test('should handle malformed component_snapshot gracefully', () => {
  const orderItems = [{ item_name: 'Broken Package', product_id: 'pkg-broken', qty: 1, component_snapshot: 'not valid json{{' }];
  const result = aggregateOrderEquipment(orderItems as any, generatorProductId, 0);
  ok('broken package in generic items', result.genericItems.includes('Broken Package'));
  ok('package generator qty = 0', result.packageGeneratorQty === 0);
});

test('legacy fallback used only when no new generator quantity exists', () => {
  const orderItems = [{ unit_id: 'unit-1', units: { name: 'Castle' }, qty: 1, wet_or_dry: 'dry' }];
  const result = aggregateOrderEquipment(orderItems as any, generatorProductId, 3);
  ok('legacy generator qty = 3', result.totalGeneratorQty === 3);
});

test('new generator takes precedence over legacy', () => {
  const orderItems = [{ item_name: 'Generator', product_id: generatorProductId, qty: 1 }];
  const result = aggregateOrderEquipment(orderItems as any, generatorProductId, 3);
  ok('new generator wins', result.totalGeneratorQty === 1);
});

console.log('\nuseCalendarTasks aggregation tests (importing production helper):');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }
