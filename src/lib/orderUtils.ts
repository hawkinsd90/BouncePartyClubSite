import { Order } from '../types/orders';

// Sum of all scalar fee columns stored on the order row, excluding tip and
// relational data (custom fees, discounts). Use this when you need to compare
// "old vs new" totals during a save operation and the relational rows have not
// been fetched, or when you need the base fee total for payment-clearing logic.
// Tip is intentionally excluded — it is an optional add-on collected separately
// and must not affect deposit/balance-clearing decisions.
export function calculateStoredOrderTotal(order: {
  subtotal_cents: number;
  travel_fee_cents: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents?: number | null;
  generator_fee_cents?: number | null;
  tax_cents: number;
}): number {
  return (
    (order.subtotal_cents || 0) +
    (order.travel_fee_cents || 0) +
    (order.surface_fee_cents || 0) +
    (order.same_day_pickup_fee_cents || 0) +
    (order.generator_fee_cents || 0) +
    (order.tax_cents || 0)
  );
}

// Legacy helper kept for existing callers; delegates to calculateStoredOrderTotal
// but also adds tip. Only use this where tip must be included in the sum.
export function calculateOrderTotal(order: Order): number {
  return calculateStoredOrderTotal(order) + (order.tip_cents || 0);
}

export function formatTime(timeString: string | null): string {
  if (!timeString) return '';
  const [hours, minutes] = timeString.split(':');
  const hour = parseInt(hours, 10);
  const minute = parseInt(minutes, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minute.toString().padStart(2, '0')} ${ampm}`;
}
