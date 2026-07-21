// usePricing/useInvoicePricing EE product inclusion tests.
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

function calculateTotals(
  inflatableItems: Array<{ unit_price_cents: number; qty: number; is_deleted?: boolean }>,
  eeProductItems: Array<{ unit_price_cents: number; qty: number; is_deleted?: boolean }>,
): { subtotal: number; eeSubtotal: number; subtotalWithEE: number } {
  const activeItems = inflatableItems.filter(item => !item.is_deleted);
  const activeEEItems = eeProductItems.filter(item => !item.is_deleted);
  const subtotal = activeItems.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);
  const eeSubtotal = activeEEItems.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);
  const subtotalWithEE = subtotal + eeSubtotal;
  return { subtotal, eeSubtotal, subtotalWithEE };
}

function calculateInvoiceSubtotal(
  cartItems: Array<{ adjusted_price_cents: number; qty: number }>,
  eeProductItems: Array<{ unit_price_cents: number; qty: number; is_deleted?: boolean }>,
): number {
  return (
    cartItems.reduce((sum, item) => sum + item.adjusted_price_cents * item.qty, 0) +
    eeProductItems
      .filter(i => !i.is_deleted)
      .reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0)
  );
}

// --- usePricing tests ---

test('should include EE products in subtotal', () => {
  const inflatables = [{ unit_price_cents: 25000, qty: 1 }];
  const eeProducts = [{ unit_price_cents: 7500, qty: 2 }];
  const result = calculateTotals(inflatables, eeProducts);
  ok('inflatable subtotal', result.subtotal === 25000);
  ok('ee subtotal', result.eeSubtotal === 15000);
  ok('total with EE', result.subtotalWithEE === 40000);
});

test('should exclude deleted EE products from subtotal', () => {
  const inflatables = [{ unit_price_cents: 25000, qty: 1 }];
  const eeProducts = [
    { unit_price_cents: 7500, qty: 2 },
    { unit_price_cents: 5000, qty: 1, is_deleted: true },
  ];
  const result = calculateTotals(inflatables, eeProducts);
  ok('deleted EE excluded', result.eeSubtotal === 15000);
  ok('subtotal with EE', result.subtotalWithEE === 40000);
});

test('should handle empty EE products', () => {
  const inflatables = [{ unit_price_cents: 25000, qty: 1 }];
  const result = calculateTotals(inflatables, []);
  ok('subtotal with no EE', result.subtotalWithEE === 25000);
  ok('ee subtotal is 0', result.eeSubtotal === 0);
});

test('should handle empty inflatables with only EE products', () => {
  const eeProducts = [{ unit_price_cents: 7500, qty: 3 }];
  const result = calculateTotals([], eeProducts);
  ok('inflatable subtotal is 0', result.subtotal === 0);
  ok('ee subtotal', result.eeSubtotal === 22500);
  ok('total with EE', result.subtotalWithEE === 22500);
});

// --- useInvoicePricing tests ---

test('should include EE products in invoice subtotal', () => {
  const cartItems = [{ adjusted_price_cents: 30000, qty: 1 }];
  const eeProducts = [{ unit_price_cents: 7500, qty: 1 }];
  ok('invoice subtotal includes EE', calculateInvoiceSubtotal(cartItems, eeProducts) === 37500);
});

test('should exclude deleted EE products from invoice subtotal', () => {
  const cartItems = [{ adjusted_price_cents: 30000, qty: 1 }];
  const eeProducts = [
    { unit_price_cents: 7500, qty: 1 },
    { unit_price_cents: 5000, qty: 1, is_deleted: true },
  ];
  ok('deleted EE excluded from invoice', calculateInvoiceSubtotal(cartItems, eeProducts) === 37500);
});

// --- Runner ---

console.log('\nusePricing/useInvoicePricing EE inclusion tests:');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
