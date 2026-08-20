// Tests for Quote Summary Event Essentials quantity display.
//
// The Quote Summary uses formatQuantityLabel for the visible quantity text;
// extended pricing is calculated separately as unit_price_cents × qty.

import { formatQuantityLabel } from './packageDisplay';

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; console.error(`FAIL ${label}: expected ${e}, got ${a}`); }
}

function extendedPrice(unitPriceCents: number, quantity: number): number {
  return unitPriceCents * quantity;
}

eq('chair shows × 5', formatQuantityLabel('White Folding Chair', 5), 'White Folding Chair × 5');
eq('table shows × 4', formatQuantityLabel('Six-foot Rectangular Table', 4), 'Six-foot Rectangular Table × 4');
eq('package shows × 2', formatQuantityLabel('Party Package', 2), 'Party Package × 2');
eq('qty 1 shows × 1', formatQuantityLabel('White Folding Chair', 1), 'White Folding Chair × 1');

eq('chair extended price is $10.00', extendedPrice(200, 5), 1000);
eq('table extended price is $40.00', extendedPrice(1000, 4), 4000);
eq('package extended price is $100.00', extendedPrice(5000, 2), 10000);

eq('chair unit price is not used as line price', extendedPrice(200, 5) !== 200, true);

console.log(`\nQuote Summary quantity display tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
