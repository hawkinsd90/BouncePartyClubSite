import { calculateSalesTaxCents, sumEffectiveDiscountsCents } from './orderMoney';

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function dollarsToCents(dollars: string | number): number {
  return Math.round(parseFloat(String(dollars)) * 100);
}

// Sales tax on a taxable amount (the one BPC rate and rounding live in orderMoney).
export function calculateTax(taxableAmountCents: number): number {
  return calculateSalesTaxCents(taxableAmountCents);
}

export function calculateDiscountTotal(
  discounts: Array<{ amount_cents: number; percentage: number }>,
  subtotalCents: number
): number {
  return sumEffectiveDiscountsCents(discounts, subtotalCents, Number.MAX_SAFE_INTEGER);
}
