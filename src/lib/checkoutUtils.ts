import { OrderSummaryDisplay } from './orderSummary';
import { dollarsToCents } from './utils';
import { buildOrderSummaryDisplay } from './orderSummaryHelpers';

export function getPaymentAmountCents(
  paymentAmount: 'deposit' | 'full' | 'custom',
  customAmount: string,
  priceBreakdown: any
): number {
  if (paymentAmount === 'full') {
    return priceBreakdown.total_cents;
  } else if (paymentAmount === 'custom') {
    const customCents = dollarsToCents(customAmount || '0');
    return Math.max(priceBreakdown.deposit_due_cents, Math.min(customCents, priceBreakdown.total_cents));
  }
  return priceBreakdown.deposit_due_cents;
}

export function getTipAmountCents(
  tipAmount: 'none' | '10' | '15' | '20' | 'custom',
  customTip: string,
  totalCents: number
): number {
  if (tipAmount === 'none') return 0;
  if (tipAmount === 'custom') {
    return dollarsToCents(customTip || '0');
  }
  const percentage = parseInt(tipAmount);
  return Math.round((totalCents * percentage) / 100);
}

export function buildOrderSummary(
  priceBreakdown: any,
  cart: any[],
  quoteData: any,
  tipCents: number
): OrderSummaryDisplay | null {
  if (!priceBreakdown || !cart) return null;

  const items = cart.map(item => ({
    name: item.unit_name,
    mode: item.wet_or_dry === 'water' ? 'Water' : 'Dry',
    price: item.unit_price_cents,
    qty: 1,
  }));

  return buildOrderSummaryDisplay({
    items,
    fees: {
      travel_fee_cents: priceBreakdown.travel_fee_cents,
      travel_fee_display_name: priceBreakdown.travel_fee_display_name,
      surface_fee_cents: priceBreakdown.surface_fee_cents,
      same_day_pickup_fee_cents: priceBreakdown.same_day_pickup_fee_cents,
      generator_fee_cents: priceBreakdown.generator_fee_cents,
    },
    discounts: [],
    customFees: [],
    subtotal_cents: priceBreakdown.subtotal_cents,
    tax_cents: priceBreakdown.tax_cents,
    tip_cents: tipCents,
    total_cents: priceBreakdown.total_cents,
    deposit_due_cents: priceBreakdown.deposit_due_cents,
    deposit_paid_cents: 0,
    balance_due_cents: priceBreakdown.balance_due_cents,
    pickup_preference: quoteData?.pickup_preference || 'next_day',
  });
}
