// The Event Essentials-only Setup Fee rule (setupFeeCalculation.ts): the fee tops an Event Essentials-only order up to the $150
// minimum; it is zero with an inflatable, with nothing in the cart, or at and above the minimum.
// Pure; no database, no network.
// Run: node node_modules/jiti/bin/jiti.js src/lib/setupFeeCalculation.test.ts

import { calculateEventEssentialsSetupFeeCents, EVENT_ESSENTIALS_SETUP_MINIMUM_CENTS } from '../../pricing/setupFeeCalculation';

let passed = 0;
let failed = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label} (got ${a}, expected ${e})`);
  }
}

const fee = (eventEssentialsSubtotalCents: number, hasInflatables = false) =>
  calculateEventEssentialsSetupFeeCents({ hasInflatables, eventEssentialsSubtotalCents });

eq('0 when there is nothing in the cart (EE subtotal 0)', fee(0), 0);
eq('$55 for a $95 Generator, no inflatable', fee(9500), 5500);
eq('$50 for $100 of Event Essentials, no inflatable', fee(10000), 5000);
eq('$0 for exactly $150, no inflatable', fee(15000), 0);
eq('$0 for $151, no inflatable', fee(15100), 0);
eq('$0 when an inflatable is present, even with only $95 of Event Essentials', fee(9500, true), 0);
eq('$0 for a package at $150', fee(15000), 0);
eq('$50 for a package at $100', fee(10000), 5000);
eq('the minimum is $150', EVENT_ESSENTIALS_SETUP_MINIMUM_CENTS, 15000);
eq('a negative EE subtotal is safe (0)', fee(-100), 0);
eq('NaN is safe (0)', fee(NaN), 0);
eq('fractional cents are truncated: 9999.99 -> 9999 -> 5001', fee(9999.99), 5001);
eq('a custom minimum is honored', calculateEventEssentialsSetupFeeCents({ hasInflatables: false, eventEssentialsSubtotalCents: 9500, setupMinimumCents: 20000 }), 10500);

console.log(`Setup fee tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} setup fee test(s) failed`);
