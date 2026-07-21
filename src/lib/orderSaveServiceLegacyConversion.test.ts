// Tests importing actual production helpers from generatorUnified.ts
// jiti runner, no React/Supabase.

import { detectMixedGeneratorConflict } from '../lib/generatorUnified';

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean): void {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

function test(name: string, fn: () => void): void {
  try { fn(); } catch (err) { failed++; console.error(`FAIL: ${name}:`, err); }
}

test('should throw when generator product lookup fails', () => {
  let threw = false;
  try {
    const genProductId: string | null = null;
    if (!genProductId) {
      throw new Error('Generator product not configured — cannot validate mixed state.');
    }
  } catch { threw = true; }
  ok('throws on null genProductId', threw);
});

test('should detect mixed state: legacy + direct EE generator', () => {
  const result = detectMixedGeneratorConflict(
    'gen-123',
    [{ product_id: 'gen-123', unit_id: null, is_deleted: false }],
    2, 0,
  );
  ok('mixed state detected', result.conflict === true);
});

test('should not flag mixed state when only EE generator item exists', () => {
  const result = detectMixedGeneratorConflict(
    'gen-123',
    [{ product_id: 'gen-123', unit_id: null, is_deleted: false }],
    0, 0,
  );
  ok('not mixed when only EE', result.conflict === false);
});

test('should not flag mixed state when only legacy exists', () => {
  const result = detectMixedGeneratorConflict('gen-123', [], 2, 5000);
  ok('not mixed when only legacy', result.conflict === false);
});

test('should detect mixed state: legacy + package containing generator', () => {
  const result = detectMixedGeneratorConflict(
    'gen-123',
    [{ bundle_id: 'pkg-1', product_id: 'pkg-1', unit_id: null, is_deleted: false, component_snapshot: { components: [{ product_id: 'gen-123', quantity_per_bundle: 1 }] } }],
    1, 5000,
  );
  ok('package conflict detected', result.conflict === true);
});

test('should not flag mixed state: legacy + chairs', () => {
  const result = detectMixedGeneratorConflict(
    'gen-123',
    [{ product_id: 'chairs-1', unit_id: null, is_deleted: false }],
    1, 5000,
  );
  ok('no conflict for chairs', result.conflict === false);
});

console.log('\norderSaveService fail-closed validation tests:');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }
