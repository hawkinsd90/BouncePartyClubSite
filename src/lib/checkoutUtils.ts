import { OrderSummaryDisplay } from './orderSummary';
import { dollarsToCents } from './utils';

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
    lineTotal: item.unit_price_cents,
  }));

  const fees: Array<{ name: string; amount: number }> = [];
  if (priceBreakdown.travel_fee_cents > 0) {
    fees.push({ name: priceBreakdown.travel_fee_display_name || 'Travel Fee', amount: priceBreakdown.travel_fee_cents });
  }
  if (priceBreakdown.surface_fee_cents > 0) {
    fees.push({ name: 'Surface Fee (Sandbags)', amount: priceBreakdown.surface_fee_cents });
  }
  if (priceBreakdown.same_day_pickup_fee_cents > 0) {
    fees.push({ name: 'Same-Day Pickup Fee', amount: priceBreakdown.same_day_pickup_fee_cents });
  }
  if (priceBreakdown.generator_fee_cents > 0) {
    fees.push({ name: 'Generator Rental', amount: priceBreakdown.generator_fee_cents });
  }

  const totalFees = fees.reduce((sum, fee) => sum + fee.amount, 0);
  const taxableAmount = priceBreakdown.subtotal_cents + totalFees;

  return {
    items,
    fees,
    discounts: [],
    customFees: [],
    subtotal: priceBreakdown.subtotal_cents,
    totalFees,
    totalDiscounts: 0,
    totalCustomFees: 0,
    taxableAmount,
    tax: priceBreakdown.tax_cents,
    tip: tipCents,
    total: priceBreakdown.total_cents,
    depositDue: priceBreakdown.deposit_due_cents,
    depositPaid: 0,
    balanceDue: priceBreakdown.balance_due_cents,
    isMultiDay: false,
    pickupPreference: quoteData?.pickup_preference || 'next_day',
  };
}
