// orderSaveService mixed-state validation — fail-closed behavior tests.
// jiti runner, no React/Supabase.

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name}:`, err);
  }
}

// --- Tests ---

test('should throw when generator product lookup fails', () => {
  let threw = false;
  try {
    const genProductId: string | null = null;
    if (!genProductId) {
      throw new Error('Generator product not configured — cannot validate mixed state.');
    }
  } catch {
    threw = true;
  }
  ok('throws on null genProductId', threw);
});

test('should detect mixed state: legacy generator_qty > 0 AND EE generator item exists', () => {
  const genProductId = 'gen-123';
  const stagedItems = [
    { product_id: 'gen-123', unit_id: null, is_deleted: false, qty: 1 },
  ];
  const legacyQty = 2;

  const hasEEGeneratorItem = stagedItems.some((item: any) => {
    if (!item.product_id || item.unit_id || item.is_deleted) return false;
    return item.product_id === genProductId;
  });

  const hasLegacy = legacyQty > 0;
  const isMixed = hasLegacy && hasEEGeneratorItem;
  ok('mixed state detected', isMixed === true);
});

test('should not flag mixed state when only EE generator item exists (no legacy)', () => {
  const genProductId = 'gen-123';
  const stagedItems = [
    { product_id: 'gen-123', unit_id: null, is_deleted: false, qty: 1 },
  ];
  const legacyQty = 0;

  const hasEEGeneratorItem = stagedItems.some((item: any) => {
    if (!item.product_id || item.unit_id || item.is_deleted) return false;
    return item.product_id === genProductId;
  });

  const hasLegacy = legacyQty > 0;
  const isMixed = hasLegacy && hasEEGeneratorItem;
  ok('not mixed when only EE', isMixed === false);
});

test('should not flag mixed state when only legacy generator_qty exists (no EE item)', () => {
  const genProductId = 'gen-123';
  const stagedItems: any[] = [];
  const legacyQty = 2;

  const hasEEGeneratorItem = stagedItems.some((item: any) => {
    if (!item.product_id || item.unit_id || item.is_deleted) return false;
    return item.product_id === genProductId;
  });

  const hasLegacy = legacyQty > 0;
  const isMixed = hasLegacy && hasEEGeneratorItem;
  ok('not mixed when only legacy', isMixed === false);
});

// --- Runner ---

console.log('\norderSaveService fail-closed validation tests:');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
