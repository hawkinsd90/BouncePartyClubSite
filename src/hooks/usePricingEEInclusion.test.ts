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

// --- 1. Crew retains a package containing Generator ---
test('1. Crew retains a package containing Generator', () => {
  const items = [
    { unit_id: 'unit-1', units: { name: 'Castle' }, qty: 1, wet_or_dry: 'dry' },
    { item_name: 'Celebration Package', product_id: 'pkg-1', qty: 1, component_snapshot: { components: [{ product_id: 'gen-abc', quantity_per_bundle: 1 }] } },
    { item_name: 'Chair', product_id: 'chairs-1', qty: 1 },
  ];
  const result = aggregateOrderEquipment(items as any, 'gen-abc', 0);
  ok('castle in generic items', result.genericItems.some((i: string) => i.includes('Castle')));
  ok('chair in generic items', result.genericItems.includes('Chair'));
  ok('generator in display items', result.displayItems.some((i: string) => i.includes('Generator')));
  ok('numInflatables = 1', result.numInflatables === 1);
  ok('packageGeneratorQty = 1', result.packageGeneratorQty === 1);
});

console.log('\nusePricingEEInclusion tests (importing production helpers):');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }
