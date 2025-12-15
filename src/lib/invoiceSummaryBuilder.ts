import type { OrderSummaryDisplay } from './orderSummary';
import type { PriceBreakdown } from './pricing';

interface CartItem {
  unit_name: string;
  mode: 'dry' | 'water';
  adjusted_price_cents: number;
  qty: number;
}

interface Discount {
  name: string;
  amount_cents: number;
  percentage: number;
}

interface CustomFee {
  name: string;
  amount_cents: number;
}

interface EventDetails {
  event_date: string;
  event_end_date: string;
  pickup_preference: string;
  generator_qty: number;
}

interface BuildSummaryParams {
  cartItems: CartItem[];
  priceBreakdown: PriceBreakdown | null;
  discounts: Discount[];
  customFees: CustomFee[];
  subtotal: number;
  taxableAmount: number;
  taxCents: number;
  totalCents: number;
  depositRequired: number;
  eventDetails: EventDetails;
}

export function buildInvoiceSummary(params: BuildSummaryParams): OrderSummaryDisplay | null {
  if (params.cartItems.length === 0) return null;

  const items = params.cartItems.map(item => ({
    name: item.unit_name,
    mode: item.mode === 'water' ? 'Water' : 'Dry',
    price: item.adjusted_price_cents,
    qty: item.qty,
    lineTotal: item.adjusted_price_cents * item.qty,
  }));

  const fees: Array<{ name: string; amount: number }> = [];

  if (params.priceBreakdown?.travel_fee_cents && params.priceBreakdown.travel_fee_cents > 0) {
    fees.push({
      name: params.priceBreakdown.travel_fee_display_name || 'Travel Fee',
      amount: params.priceBreakdown.travel_fee_cents,
    });
  }

  if (params.priceBreakdown?.surface_fee_cents && params.priceBreakdown.surface_fee_cents > 0) {
    fees.push({ name: 'Surface Fee (Sandbags)', amount: params.priceBreakdown.surface_fee_cents });
  }

  if (params.priceBreakdown?.same_day_pickup_fee_cents && params.priceBreakdown.same_day_pickup_fee_cents > 0) {
    fees.push({ name: 'Same-Day Pickup Fee', amount: params.priceBreakdown.same_day_pickup_fee_cents });
  }

  if (params.priceBreakdown?.generator_fee_cents && params.priceBreakdown.generator_fee_cents > 0) {
    const generatorLabel =
      params.eventDetails.generator_qty > 1 ? `Generator (${params.eventDetails.generator_qty}x)` : 'Generator';
    fees.push({ name: generatorLabel, amount: params.priceBreakdown.generator_fee_cents });
  }

  const summaryDiscounts = params.discounts.map(discount => {
    let amount = discount.amount_cents;
    if (discount.percentage > 0) {
      amount = Math.round(params.subtotal * (discount.percentage / 100));
    }
    return {
      name: discount.name,
      amount: amount,
    };
  });

  const summaryCustomFees = params.customFees.map(fee => ({
    name: fee.name,
    amount: fee.amount_cents,
  }));

  const totalFees = fees.reduce((sum, fee) => sum + fee.amount, 0);
  const totalDiscounts = summaryDiscounts.reduce((sum, d) => sum + d.amount, 0);
  const totalCustomFees = summaryCustomFees.reduce((sum, f) => sum + f.amount, 0);

  const isMultiDay =
    params.eventDetails.event_end_date && params.eventDetails.event_end_date !== params.eventDetails.event_date;

  return {
    items,
    fees,
    discounts: summaryDiscounts,
    customFees: summaryCustomFees,
    subtotal: params.priceBreakdown?.subtotal_cents || params.subtotal,
    totalFees,
    totalDiscounts,
    totalCustomFees,
    taxableAmount: params.taxableAmount,
    tax: params.taxCents,
    tip: 0,
    total: params.totalCents,
    depositDue: params.depositRequired,
    depositPaid: 0,
    balanceDue: params.totalCents - params.depositRequired,
    isMultiDay: !!isMultiDay,
    pickupPreference: params.eventDetails.pickup_preference,
  };
}
