// Pure builder for the "current order summary" shown in the Order Detail modal.
//
// Moved out of OrderDetailModal's current-summary effect, where the same
// OrderSummaryData was constructed twice (the normal path and the fallback in
// the .catch). The parent still owns the effect, the legacy driving-distance
// lookup and its Supabase write, formatOrderSummary and the state setter; it
// passes in the two values that differ between the two paths.
//
// Type-only imports keep this module loadable from Node-based tests.

import { storedOrderTotalCents } from '../../../../lib/pricing/orderMoney';
import type { OrderSummaryData, OrderDiscount, OrderCustomFee } from '../../../../lib/orders/orderSummaryLoader';

// Only the stored order fields this builder reads.
export interface CurrentOrderSummarySource {
  subtotal_cents?: number | null;
  travel_fee_cents?: number | null;
  surface_fee_cents?: number | null;
  same_day_pickup_fee_cents?: number | null;
  same_day_weekday_delivery_fee_cents?: number | null;
  same_day_weekday_delivery_fee_waived?: boolean | null;
  generator_fee_cents?: number | null;
  setup_fee_cents?: number | null;
  generator_qty?: number | null;
  tax_cents?: number | null;
  tip_cents?: number | null;
  deposit_due_cents: OrderSummaryData['deposit_due_cents'];
  deposit_paid_cents?: number | null;
  balance_due_cents: OrderSummaryData['balance_due_cents'];
  custom_deposit_cents: OrderSummaryData['custom_deposit_cents'];
  pickup_preference: OrderSummaryData['pickup_preference'];
  event_date: OrderSummaryData['event_date'];
  event_end_date: OrderSummaryData['event_end_date'];
}

export interface BuildCurrentOrderSummaryDataInput {
  order: CurrentOrderSummarySource;
  orderItems: OrderSummaryData['items'];
  discounts: Array<OrderDiscount & { is_new?: boolean }>;
  customFees: Array<OrderCustomFee & { is_new?: boolean }>;
  // Written to subtotal_cents unchanged. OrderSummaryData declares this as
  // `number`, but the caller's order is untyped, so the stored value can be
  // null/undefined at runtime. The normal path passes it raw and the fallback
  // passes `order.subtotal_cents || 0`; this builder does not normalize it.
  // total_cents always uses `order.subtotal_cents || 0` regardless.
  subtotalCents: number | null | undefined;
  // Written to travel_total_miles unchanged (no parsing or normalization here).
  travelMiles: number;
}

export function buildCurrentOrderSummaryData({
  order,
  orderItems,
  discounts,
  customFees,
  travelMiles,
  subtotalCents,
}: BuildCurrentOrderSummaryDataInput): OrderSummaryData {
  const existingDiscounts = discounts.filter((d) => !d.is_new);
  const existingCustomFees = customFees.filter((f) => !f.is_new);


  return {
    items: orderItems,
    discounts: existingDiscounts,
    customFees: existingCustomFees,
    // Assertion: preserves the existing raw pass-through of a possibly
    // nullish stored subtotal into a field OrderSummaryData types as `number`.
    subtotal_cents: subtotalCents as number,
    travel_fee_cents: order.travel_fee_cents || 0,
    travel_total_miles: travelMiles,
    surface_fee_cents: order.surface_fee_cents || 0,
    same_day_pickup_fee_cents: order.same_day_pickup_fee_cents || 0,
    same_day_weekday_delivery_fee_cents: order.same_day_weekday_delivery_fee_cents || 0,
    same_day_weekday_delivery_fee_waived: order.same_day_weekday_delivery_fee_waived || false,
    generator_fee_cents: order.generator_fee_cents || 0,
    setup_fee_cents: order.setup_fee_cents || 0,
    generator_qty: order.generator_qty || 0,
    tax_cents: order.tax_cents || 0,
    tip_cents: order.tip_cents || 0,
    // The one total formula (orderMoney): stored components + stored tax - discounts + custom fees.
    total_cents: storedOrderTotalCents(order, existingDiscounts, existingCustomFees),
    deposit_due_cents: order.deposit_due_cents,
    deposit_paid_cents: order.deposit_paid_cents || 0,
    balance_due_cents: order.balance_due_cents,
    custom_deposit_cents: order.custom_deposit_cents,
    pickup_preference: order.pickup_preference,
    event_date: order.event_date,
    event_end_date: order.event_end_date,
  };
}
