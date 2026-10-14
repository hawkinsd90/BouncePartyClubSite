// The shared money rules (orderMoney.ts): tax, discounts, custom fees, the order total, the remaining deposit and principal.
// Pure; no database, no network.
// Run: node node_modules/jiti/bin/jiti.js src/lib/orderMoney.test.ts

import {
  SALES_TAX_RATE,
  calculateSalesTaxCents,
  composeOrderTotal,
  effectiveDiscountAmounts,
  effectiveDiscountCents,
  effectiveTaxEnabled,
  isWholeCents,
  remainingDepositCents,
  remainingPrincipalCents,
  storedOrderTotalCents,
  sumCustomFeesCents,
  sumEffectiveDiscountsCents,
  wholeCentsOrZero,
} from '../../pricing/orderMoney';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label} (got ${a}, expected ${e})`);
  }
}

// ---- tax rate and rounding
eq('the Michigan rate is 6%', SALES_TAX_RATE, 0.06);
eq('tax: 6% of $100.00', calculateSalesTaxCents(10000), 600);
eq('tax: 6% of 8333 cents = 499.98 rounds to 500', calculateSalesTaxCents(8333), 500);
eq('tax: 6% of 8332 cents = 499.92 rounds to 500', calculateSalesTaxCents(8332), 500);
eq('tax: 6% of 8325 cents = 499.5 rounds to 500 (half rounds up)', calculateSalesTaxCents(8325), 500);
eq('tax: 6% of 8324 cents = 499.44 rounds to 499', calculateSalesTaxCents(8324), 499);
eq('tax: nothing taxable owes nothing', calculateSalesTaxCents(0), 0);
eq('tax: a negative taxable amount owes nothing', calculateSalesTaxCents(-500), 0);
eq('tax: NaN owes nothing', calculateSalesTaxCents(Number.NaN), 0);
eq('tax: one rounding, not two (two pieces round differently than their sum)', [calculateSalesTaxCents(1250) + calculateSalesTaxCents(1250), calculateSalesTaxCents(2500)], [150, 150]);
eq('tax: the sum of separately rounded pieces can differ from one rounding', [calculateSalesTaxCents(825) + calculateSalesTaxCents(825), calculateSalesTaxCents(1650)], [100, 99]);

// ---- when tax applies
eq('tax policy: default on, not waived -> applies', effectiveTaxEnabled({ applyTaxesByDefault: true, taxWaived: false }), true);
eq('tax policy: default on, waived -> does not apply', effectiveTaxEnabled({ applyTaxesByDefault: true, taxWaived: true }), false);
eq('tax policy: default off, toggle off -> does not apply (the historical configuration)', effectiveTaxEnabled({ applyTaxesByDefault: false, taxWaived: false }), false);
eq('tax policy: default off, toggle on -> applies (the toggle inverts)', effectiveTaxEnabled({ applyTaxesByDefault: false, taxWaived: true }), true);
eq('tax policy: default unset is treated as on', effectiveTaxEnabled({ taxWaived: false }), true);
eq('tax policy: nothing set -> applies by default', effectiveTaxEnabled({}), true);
eq('tax policy: null toggle is not waived', effectiveTaxEnabled({ applyTaxesByDefault: true, taxWaived: null }), true);

// ---- discounts
eq('discount: fixed', effectiveDiscountCents({ amount_cents: 2500 }, 25000), 2500);
eq('discount: percentage', effectiveDiscountCents({ percentage: 10 }, 25000), 2500);
eq('discount: both fields -> the fixed amount wins, never added', effectiveDiscountCents({ amount_cents: 1000, percentage: 20 }, 25000), 1000);
eq('discount: amount 0 with a percentage -> the percentage', effectiveDiscountCents({ amount_cents: 0, percentage: 20 }, 25000), 5000);
eq('discount: zero', effectiveDiscountCents({ amount_cents: 0, percentage: 0 }, 25000), 0);
eq('discount: negative fixed amount is nothing', effectiveDiscountCents({ amount_cents: -500 }, 25000), 0);
eq('discount: negative percentage is nothing', effectiveDiscountCents({ percentage: -10 }, 25000), 0);
eq('discount: NaN is nothing', effectiveDiscountCents({ amount_cents: Number.NaN, percentage: Number.NaN }, 25000), 0);
eq('discount: missing fields are nothing', effectiveDiscountCents({}, 25000), 0);
eq('discount: a fractional-cent percentage rounds once (12.5% of 8333 = 1041.625)', effectiveDiscountCents({ percentage: 12.5 }, 8333), 1042);
eq('discount: 33.333% of 10000 rounds once', effectiveDiscountCents({ percentage: 33.333 }, 10000), 3333);
eq('discount: per-line amounts', effectiveDiscountAmounts([{ amount_cents: 1000, percentage: 50 }, { percentage: 10 }], 20000), [1000, 2000]);
eq('discounts together are capped at what there is to discount', sumEffectiveDiscountsCents([{ amount_cents: 999999 }], 25000, 30000), 30000);
eq('discounts equal to the whole eligible amount are allowed', sumEffectiveDiscountsCents([{ amount_cents: 30000 }], 25000, 30000), 30000);
eq('discounts together never go below zero', sumEffectiveDiscountsCents([{ amount_cents: -5 }], 25000, 30000), 0);
eq('a 100% discount on the subtotal does not reduce fees', sumEffectiveDiscountsCents([{ percentage: 100 }], 25000, 30000), 25000);
eq('a 150% discount is clamped to the eligible amount', sumEffectiveDiscountsCents([{ percentage: 150 }], 25000, 30000), 30000);

// ---- custom fees
eq('custom fee: whole cents are kept', sumCustomFeesCents([{ amount_cents: 1500 }]), 1500);
eq('custom fees: several add up', sumCustomFeesCents([{ amount_cents: 1500 }, { amount_cents: 700 }, { amount_cents: 0 }]), 2200);
eq('custom fee: negative is ignored (not a hidden discount)', sumCustomFeesCents([{ amount_cents: -300 }, { amount_cents: 400 }]), 400);
eq('custom fee: NaN is ignored', sumCustomFeesCents([{ amount_cents: Number.NaN }, { amount_cents: 400 }]), 400);
eq('custom fee: fractional cents are ignored', sumCustomFeesCents([{ amount_cents: 12.5 }, { amount_cents: 400 }]), 400);
eq('custom fee: a string is ignored', sumCustomFeesCents([{ amount_cents: '500' }, { amount_cents: 400 }]), 400);
eq('custom fee: a missing amount is ignored', sumCustomFeesCents([{}, { amount_cents: 400 }]), 400);
eq('custom fee: a missing row is ignored', sumCustomFeesCents([null as unknown as { amount_cents: number }, { amount_cents: 400 }]), 400);
eq('custom fee: infinity is ignored', sumCustomFeesCents([{ amount_cents: Number.POSITIVE_INFINITY }]), 0);
ok('whole cents helper', isWholeCents(0) && isWholeCents(5) && !isWholeCents(-1) && !isWholeCents(1.5) && !isWholeCents(Number.NaN) && !isWholeCents('5') && wholeCentsOrZero(-1) === 0);

// ---- the order total
const C = {
  subtotal_cents: 25000,
  travel_fee_cents: 2000,
  surface_fee_cents: 3500,
  generator_fee_cents: 10000,
  setup_fee_cents: 0,
  same_day_pickup_fee_cents: 10500,
  same_day_weekday_delivery_fee_cents: 2500,
};
{
  const b = composeOrderTotal(C, [], [], 0);
  eq('total: subtotal + every fee', b.totalCents, 25000 + 2000 + 3500 + 10000 + 10500 + 2500);
  eq('taxable: same-day pickup and weekday delivery are not taxed', b.taxableBeforeDiscountCents, 25000 + 2000 + 3500 + 10000);
}
{
  const withTax = composeOrderTotal(C, [], [], 2400);
  eq('total: tax is added once', withTax.totalCents, 25000 + 2000 + 3500 + 10000 + 10500 + 2500 + 2400);
}
{
  const b = composeOrderTotal({ ...C, setup_fee_cents: 5500 }, [], [], 0);
  eq('setup fee is in the total', b.totalCents - composeOrderTotal(C, [], [], 0).totalCents, 5500);
  eq('setup fee is in the taxable amount', b.taxableBeforeDiscountCents - composeOrderTotal(C, [], [], 0).taxableBeforeDiscountCents, 5500);
}
{
  const b = composeOrderTotal(C, [{ amount_cents: 1000, percentage: 20 }], [{ amount_cents: 500 }], 0);
  eq('total: fixed discount wins over a percentage on the same row, custom fee added', b.totalCents, 25000 + 2000 + 3500 + 10000 + 10500 + 2500 + 500 - 1000);
  eq('taxable after discount includes the custom fee', b.taxableAfterDiscountCents, 25000 + 2000 + 3500 + 10000 + 500 - 1000);
}
{
  const b = composeOrderTotal(C, [{ amount_cents: 99999999 }], [], 0);
  eq('total never goes below zero (discount clamped)', b.totalCents, 0);
  eq('taxable never goes below zero', b.taxableAfterDiscountCents, 0);
}
eq('stored total uses the STORED tax', storedOrderTotalCents({ ...C, tax_cents: 2400 }, [], []), 25000 + 2000 + 3500 + 10000 + 10500 + 2500 + 2400);
eq('stored total: percentage discount on the stored subtotal', storedOrderTotalCents({ subtotal_cents: 20000 }, [{ percentage: 10 }], []), 18000);
eq('stored total: null fields count as zero', storedOrderTotalCents({ subtotal_cents: null, tax_cents: undefined }, [], []), 0);
eq('a tip is not part of any total', storedOrderTotalCents({ subtotal_cents: 10000, tip_cents: 5000 } as never, [], []), 10000);

// ---- remaining deposit and principal
eq('remaining deposit: nothing paid', remainingDepositCents(5000, 0), 5000);
eq('remaining deposit: part paid', remainingDepositCents(8000, 5000), 3000);
eq('remaining deposit: exactly paid', remainingDepositCents(5000, 5000), 0);
eq('remaining deposit: a lowered deposit is never negative', remainingDepositCents(3000, 5000), 0);
eq('remaining deposit: explicit zero deposit owes nothing', remainingDepositCents(0, 0), 0);
eq('remaining deposit: NaN inputs owe nothing', remainingDepositCents(Number.NaN, 0), 0);
eq('remaining principal: unpaid deposit + balance due', remainingPrincipalCents(8000, 5000, 7000), 10000);
eq('remaining principal: deposit paid, balance due only', remainingPrincipalCents(5000, 5000, 10000), 10000);
eq('remaining principal: fully paid', remainingPrincipalCents(5000, 5000, 0), 0);
eq('remaining principal: a tip is never part of it (it is not an input)', remainingPrincipalCents(5000, 5000, 0), 0);

console.log(`Order money tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} order money test(s) failed`);
