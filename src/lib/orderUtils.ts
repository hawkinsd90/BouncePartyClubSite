import { Order } from '../types/orders';

export function calculateOrderTotal(order: Order): number {
  return (
    order.subtotal_cents +
    order.travel_fee_cents +
    order.surface_fee_cents +
    (order.same_day_pickup_fee_cents || 0) +
    (order.generator_fee_cents || 0) +
    order.tax_cents +
    (order.tip_cents || 0)
  );
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
