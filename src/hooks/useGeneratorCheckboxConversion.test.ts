// Tests importing actual production helpers from generatorUnified.ts
// jiti runner, no React/Supabase.

import {
  deriveAdminGeneratorMode,
  detectMixedGeneratorConflict,
  aggregateOrderEquipment,
} from '../lib/generatorUnified';

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean): void {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

function test(name: string, fn: () => void): void {
  try { fn(); } catch (err) { failed++; console.error(`FAIL: ${name}:`, err); }
}

// --- deriveAdminGeneratorMode ---

test('1. deriveAdminGeneratorMode returns none', () => {
  const mode = deriveAdminGeneratorMode({
    generatorProductId: 'gen-123',
    stagedItems: [],
    legacyGeneratorQty: 0,
    legacyGeneratorFeeCents: 0,
  });
  ok('none when no items and no legacy', mode === 'none');
});

test('2. deriveAdminGeneratorMode returns legacy', () => {
  const mode = deriveAdminGeneratorMode({
    generatorProductId: 'gen-123',
    stagedItems: [],
    legacyGeneratorQty: 2,
    legacyGeneratorFeeCents: 5000,
  });
  ok('legacy when qty/fee positive', mode === 'legacy');
});

test('3. deriveAdminGeneratorMode returns event_essential', () => {
  const mode = deriveAdminGeneratorMode({
    generatorProductId: 'gen-123',
    stagedItems: [{ product_id: 'gen-123', unit_id: null, is_deleted: false }],
    legacyGeneratorQty: 0,
    legacyGeneratorFeeCents: 0,
  });
  ok('event_essential when matching staged item', mode === 'event_essential');
});

test('3b. deriveAdminGeneratorMode ignores deleted staged item', () => {
  const mode = deriveAdminGeneratorMode({
    generatorProductId: 'gen-123',
    stagedItems: [{ product_id: 'gen-123', unit_id: null, is_deleted: true }],
    legacyGeneratorQty: 0,
    legacyGeneratorFeeCents: 0,
  });
  ok('none when staged item deleted', mode === 'none');
});

test('3c. deriveAdminGeneratorMode ignores inflatable with matching product_id', () => {
  const mode = deriveAdminGeneratorMode({
    generatorProductId: 'gen-123',
    stagedItems: [{ product_id: 'gen-123', unit_id: 'unit-1', is_deleted: false }],
    legacyGeneratorQty: 0,
    legacyGeneratorFeeCents: 0,
  });
  ok('none when item has unit_id', mode === 'none');
});

// --- detectMixedGeneratorConflict ---

test('15. Package mixed-state conflict blocks', () => {
  const result = detectMixedGeneratorConflict(
    'gen-123',
    [{ bundle_id: 'pkg-1', product_id: 'pkg-1', unit_id: null, is_deleted: false, component_snapshot: { components: [{ product_id: 'gen-123', quantity_per_bundle: 1 }] } }],
    1,
    0,
  );
  ok('package conflict detected', result.conflict === true);
});

test('16. Chair product does not trigger Generator conflict', () => {
  const result = detectMixedGeneratorConflict(
    'gen-123',
    [{ product_id: 'chairs-1', unit_id: null, is_deleted: false }],
    1,
    5000,
  );
  ok('no conflict for chairs', result.conflict === false);
});

test('16b. Direct Generator + legacy blocks', () => {
  const result = detectMixedGeneratorConflict(
    'gen-123',
    [{ product_id: 'gen-123', unit_id: null, is_deleted: false }],
    1,
    5000,
  );
  ok('direct conflict detected', result.conflict === true);
});

test('16c. Null generatorProductId blocks when legacy present', () => {
  const result = detectMixedGeneratorConflict(null, [], 1, 5000);
  ok('null product blocks', result.conflict === true);
});

// --- aggregateOrderEquipment ---

test('20. Crew package and unrelated items remain represented', () => {
  const items = [
    { unit_id: 'unit-1', units: { name: 'Castle' }, qty: 1, wet_or_dry: 'dry' },
    { item_name: 'Party Package', product_id: 'pkg-1', qty: 1, component_snapshot: { components: [{ product_id: 'gen-abc', quantity_per_bundle: 1 }] } },
    { item_name: 'Tables (6)', product_id: 'tables-1', qty: 1 },
  ];
  const result = aggregateOrderEquipment(items as any, 'gen-abc', 0);
  ok('package generator counted', result.packageGeneratorQty === 1);
  ok('tables preserved', result.genericItems.includes('Tables (6)'));
  ok('castle in generic items', result.genericItems.some((i: string) => i.includes('Castle')));
  ok('generator in display items', result.displayItems.some((i: string) => i.includes('Generator')));
});

test('20b. Direct Generator not in generic items', () => {
  const items = [
    { item_name: 'Generator', product_id: 'gen-abc', qty: 2 },
  ];
  const result = aggregateOrderEquipment(items as any, 'gen-abc', 0);
  ok('generator not in generic', !result.genericItems.includes('Generator'));
  ok('ee generator qty = 2', result.eeGeneratorQty === 2);
});

test('20c. Legacy fallback when no new generator', () => {
  const items = [
    { unit_id: 'unit-1', units: { name: 'Castle' }, qty: 1, wet_or_dry: 'dry' },
  ];
  const result = aggregateOrderEquipment(items as any, 'gen-abc', 3);
  ok('legacy generator qty = 3', result.totalGeneratorQty === 3);
});

test('20d. New generator takes precedence over legacy', () => {
  const items = [
    { item_name: 'Generator', product_id: 'gen-abc', qty: 1 },
  ];
  const result = aggregateOrderEquipment(items as any, 'gen-abc', 3);
  ok('new generator wins', result.totalGeneratorQty === 1);
});

// --- Runner ---

console.log('\nGenerator workflow production helper tests:');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }
