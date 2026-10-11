// GENERATED COPY of src/lib/orderMoney.ts. Do not edit here.
// Edit the source and run: node node_modules/jiti/bin/jiti.js src/lib/bookingSharedCopy.ts --write
// A test fails if this file differs from its source. Used by create-booking so the server prices exactly like the Quote.

// The one place that defines BPC order money arithmetic that more than one screen or function needs:
// the sales-tax rate and its rounding, when tax applies, custom-fee and discount normalization, the order total from its stored
// components, and the remaining deposit / principal.
//
// Pure: no network, no clock, no Supabase, no React. The server gets a generated copy
// (supabase/functions/_shared/booking/orderMoney.ts, see bookingSharedCopy.ts) so an Edge Function computes exactly what the
// browser computes.
//
// Approved BPC rules this module encodes (do not "fix" without a product decision):
//   - Michigan sales tax is 6%, rounded ONCE, on the taxable amount. It is applied only when the order's effective tax policy says so.
//   - Taxable amount = equipment subtotal + travel + surface + generator + setup fee + custom fees - discount.
//     Same-day pickup and weekday-delivery fees are NOT taxable (existing, pinned behavior).
//   - A discount resolves to ONE amount: amount_cents when it is > 0, otherwise percentage of the equipment subtotal. Fixed and
//     percentage are never added together, and the discounts together never exceed what they are discounting.
//   - A custom fee is a whole, non-negative number of cents; anything else contributes nothing (a negative fee is not a hidden discount).
//   - The tip is not part of any of this.

export const SALES_TAX_RATE = 0.06;


export function isWholeCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

// Whole non-negative cents, or 0 for anything else (null, undefined, NaN, negative, fractional, a string).
export function wholeCentsOrZero(value: unknown): number {
  return isWholeCents(value) ? value : 0;
}

// Sales tax on a taxable amount, rounded exactly once.
export function calculateSalesTaxCents(taxableCents: number): number {
  if (!Number.isFinite(taxableCents) || taxableCents <= 0) return 0;
  return Math.round(taxableCents * SALES_TAX_RATE);
}

// Whether tax applies to an order. `taxWaived` is a per-order toggle whose meaning depends on the business default:
//   apply_taxes_by_default = true  -> tax applies unless the order waives it
//   apply_taxes_by_default = false -> tax does NOT apply unless the order's toggle turns it on
// The stored column name is kept (no rename); this is the single place that reads it.
export function effectiveTaxEnabled(input: { applyTaxesByDefault?: boolean | null; taxWaived?: boolean | null }): boolean {
  const byDefault = input.applyTaxesByDefault ?? true;
  const toggled = input.taxWaived === true;
  return byDefault ? !toggled : toggled;
}

export interface DiscountLike {
  amount_cents?: number | null;
  percentage?: number | null;
}

// One discount as one amount. amount_cents > 0 wins; else percentage of the base; else 0. Never both.
export function effectiveDiscountCents(discount: DiscountLike, baseCents: number): number {
  const amount = discount.amount_cents;
  if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) return Math.round(amount);
  const pct = discount.percentage;
  if (typeof pct === 'number' && Number.isFinite(pct) && pct > 0 && Number.isFinite(baseCents) && baseCents > 0) {
    return Math.round(baseCents * (pct / 100));
  }
  return 0;
}

// The per-discount amounts, each resolved on its own (display lines use these).
export function effectiveDiscountAmounts(discounts: DiscountLike[], baseCents: number): number[] {
  return discounts.map((d) => effectiveDiscountCents(d, baseCents));
}

// All discounts together, never more than `capCents` (what there is to discount).
export function sumEffectiveDiscountsCents(discounts: DiscountLike[], baseCents: number, capCents: number): number {
  const sum = effectiveDiscountAmounts(discounts, baseCents).reduce((a, b) => a + b, 0);
  return Math.max(0, Math.min(sum, Math.max(0, Math.trunc(capCents))));
}

export function sumCustomFeesCents(fees: Array<{ amount_cents?: unknown }>): number {
  return fees.reduce((sum, f) => sum + wholeCentsOrZero(f?.amount_cents), 0);
}

// The stored components of an order (all already effective: a waived fee is stored as 0).
export interface OrderMoneyComponents {
  subtotal_cents?: number | null;
  travel_fee_cents?: number | null;
  surface_fee_cents?: number | null;
  same_day_pickup_fee_cents?: number | null;
  same_day_weekday_delivery_fee_cents?: number | null;
  generator_fee_cents?: number | null;
  setup_fee_cents?: number | null;
  tax_cents?: number | null;
}

export interface OrderMoneyBreakdown {
  equipmentSubtotalCents: number;
  // Everything that is taxed, before the discount.
  taxableBeforeDiscountCents: number;
  // Everything that can be discounted: all fees and the subtotal, taxed or not.
  preDiscountCents: number;
  customFeesCents: number;
  discountCents: number;
  taxableAfterDiscountCents: number;
  taxCents: number;
  totalCents: number;
}

// Total of an order from its components. `taxCents` is passed in because tax is either computed (while pricing) or stored (when
// reading a saved order); this function never decides it.
export function composeOrderTotal(
  components: OrderMoneyComponents,
  discounts: DiscountLike[],
  customFees: Array<{ amount_cents?: unknown }>,
  taxCents: number,
): OrderMoneyBreakdown {
  const subtotal = wholeCentsOrZero(components.subtotal_cents);
  const taxableFees =
    wholeCentsOrZero(components.travel_fee_cents) +
    wholeCentsOrZero(components.surface_fee_cents) +
    wholeCentsOrZero(components.generator_fee_cents) +
    wholeCentsOrZero(components.setup_fee_cents);
  const untaxedFees =
    wholeCentsOrZero(components.same_day_pickup_fee_cents) +
    wholeCentsOrZero(components.same_day_weekday_delivery_fee_cents);
  const customFeesCents = sumCustomFeesCents(customFees);

  const taxableBeforeDiscountCents = subtotal + taxableFees + customFeesCents;
  const preDiscountCents = taxableBeforeDiscountCents + untaxedFees;
  const discountCents = sumEffectiveDiscountsCents(discounts, subtotal, preDiscountCents);
  const tax = wholeCentsOrZero(taxCents);

  return {
    equipmentSubtotalCents: subtotal,
    taxableBeforeDiscountCents,
    preDiscountCents,
    customFeesCents,
    discountCents,
    taxableAfterDiscountCents: Math.max(0, taxableBeforeDiscountCents - discountCents),
    taxCents: tax,
    totalCents: preDiscountCents - discountCents + tax,
  };
}

// The persisted total of a saved order (stored tax, stored components).
export function storedOrderTotalCents(
  order: OrderMoneyComponents,
  discounts: DiscountLike[],
  customFees: Array<{ amount_cents?: unknown }>,
): number {
  return composeOrderTotal(order, discounts, customFees, wholeCentsOrZero(order.tax_cents)).totalCents;
}

// What still has to be collected of a required deposit. A deposit that was lowered below what is already paid owes nothing; it
// never produces a negative amount (and never a refund).
export function remainingDepositCents(requiredDepositCents: number, depositPrincipalPaidCents: number): number {
  const required = Number.isFinite(requiredDepositCents) ? Math.trunc(requiredDepositCents) : 0;
  const paid = Number.isFinite(depositPrincipalPaidCents) ? Math.trunc(depositPrincipalPaidCents) : 0;
  return Math.max(0, required - paid);
}

// Principal still to collect on an order: the unpaid part of the deposit plus the balance that is due after the deposit.
// (orders.balance_due_cents is the balance AFTER the deposit; the tip is never part of either.)
export function remainingPrincipalCents(depositDueCents: number, depositPaidCents: number, balanceDueCents: number): number {
  return remainingDepositCents(depositDueCents, depositPaidCents) + Math.max(0, Math.trunc(Number.isFinite(balanceDueCents) ? balanceDueCents : 0));
}
