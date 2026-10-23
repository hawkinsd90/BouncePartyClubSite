// Future bookings of an inflatable unit, as the delete / deactivate warnings look them up (order_items joined to orders and customers).
//
// The lookup used to select orders.order_number and orders.customer_name, which are not columns, and to exclude the spellings "voided" and
// "canceled" (the real statuses are 'void' and 'cancelled'). The query therefore failed on every call, the failure was logged and an empty
// list returned, so the warning never appeared. Everything here is built from columns that exist: orders.id / event_date / event_end_date /
// status, and the customer's first_name / last_name through orders.customer_id.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORDER_STATUS } from '../constants/statuses';
import { formatOrderId } from '../utils';

export interface FutureBooking {
  order_id: string;
  orders: {
    id: string;
    event_date: string;
    event_end_date: string | null;
    status: string;
    customers: { first_name: string | null; last_name: string | null } | null;
  };
}

export const FUTURE_BOOKING_SELECT = `
  order_id,
  orders!inner(
    id,
    event_date,
    event_end_date,
    status,
    customers(first_name, last_name)
  )
`;

// Orders that no longer hold the unit.
export const NON_BOOKING_ORDER_STATUSES = [ORDER_STATUS.CANCELLED, ORDER_STATUS.VOID] as const;

export async function fetchFutureBookings(client: SupabaseClient, unitId: string, today: string): Promise<FutureBooking[]> {
  const { data: bookings, error } = await client
    .from('order_items')
    .select(FUTURE_BOOKING_SELECT)
    .eq('unit_id', unitId)
    .not('orders.status', 'in', `(${NON_BOOKING_ORDER_STATUSES.join(',')})`)
    .or(`event_date.gte.${today},event_end_date.gte.${today}`, { referencedTable: 'orders' });

  if (error) {
    console.error('Error checking bookings:', error);
    return [];
  }

  // The embed is not modelled in database.types.ts (it carries no relationships for orders / customers).
  return (bookings || []) as unknown as FutureBooking[];
}

// "• Order #1A2B3C4D - Jane Smith on 2026-07-10" - the order is shown by its short id, never by a column that does not exist.
export function describeFutureBooking(booking: FutureBooking): string {
  const order = booking.orders;
  const customer = order.customers;
  const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Unknown customer';
  return `• Order #${formatOrderId(order.id)} - ${name} on ${order.event_date}`;
}
