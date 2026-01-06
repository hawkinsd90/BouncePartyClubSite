import type { OrderSummaryDisplay } from './orderSummary';
import type { PriceBreakdown } from './pricing';
import { buildOrderSummaryDisplay } from './orderSummaryHelpers';

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
  travelFeeWaived?: boolean;
  sameDayPickupFeeWaived?: boolean;
  surfaceFeeWaived?: boolean;
  generatorFeeWaived?: boolean;
}

export function buildInvoiceSummary(params: BuildSummaryParams): OrderSummaryDisplay | null {
  if (params.cartItems.length === 0) return null;

  const items = params.cartItems.map(item => ({
    name: item.unit_name,
    mode: item.mode === 'water' ? 'Water' : 'Dry',
    price: item.adjusted_price_cents,
    qty: item.qty,
  }));

  return buildOrderSummaryDisplay({
    items,
    fees: {
      travel_fee_cents: params.priceBreakdown?.travel_fee_cents,
      travel_fee_display_name: params.priceBreakdown?.travel_fee_display_name,
      surface_fee_cents: params.priceBreakdown?.surface_fee_cents,
      same_day_pickup_fee_cents: params.priceBreakdown?.same_day_pickup_fee_cents,
      generator_fee_cents: params.priceBreakdown?.generator_fee_cents,
      generator_qty: params.eventDetails.generator_qty,
    },
    discounts: params.discounts,
    customFees: params.customFees,
    subtotal_cents: params.priceBreakdown?.subtotal_cents || params.subtotal,
    tax_cents: params.taxCents,
    tip_cents: 0,
    total_cents: params.totalCents,
    deposit_due_cents: params.depositRequired,
    deposit_paid_cents: 0,
    balance_due_cents: params.totalCents - params.depositRequired,
    event_date: params.eventDetails.event_date,
    event_end_date: params.eventDetails.event_end_date,
    pickup_preference: params.eventDetails.pickup_preference,
  });
}
