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

// The three things a lookup can tell us. A failed lookup is NOT 'none': it means the bookings are unknown, and callers must not delete or
// deactivate the unit on that basis.
export type FutureBookingCheck =
  | { status: 'none' }
  | { status: 'found'; bookings: FutureBooking[] }
  | { status: 'unknown'; error: string };

export const FUTURE_BOOKING_LOOKUP_TIMEOUT_MS = 15000;

function failureText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string' && (err as { message: string }).message) {
    return (err as { message: string }).message;
  }
  return typeof err === 'string' && err ? err : 'the lookup failed';
}

export async function checkFutureBookings(
  client: SupabaseClient,
  unitId: string,
  today: string,
  options: { timeoutMs?: number } = {},
): Promise<FutureBookingCheck> {
  const timeoutMs = options.timeoutMs ?? FUTURE_BOOKING_LOOKUP_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const lookup = Promise.resolve(
      client
        .from('order_items')
        .select(FUTURE_BOOKING_SELECT)
        .eq('unit_id', unitId)
        .not('orders.status', 'in', `(${NON_BOOKING_ORDER_STATUSES.join(',')})`)
        .or(`event_date.gte.${today},event_end_date.gte.${today}`, { referencedTable: 'orders' }),
    );
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('the lookup timed out')), timeoutMs);
    });
    const { data: bookings, error } = await Promise.race([lookup, timeout]);
    if (error) {
      console.error('Error checking bookings:', error);
      return { status: 'unknown', error: failureText(error) };
    }
    // A successful answer must be an array; anything else is not proof that there are no bookings.
    if (!Array.isArray(bookings)) return { status: 'unknown', error: 'the lookup returned an unexpected answer' };
    // The embed is not modelled in database.types.ts (it carries no relationships for orders / customers).
    const rows = bookings as unknown as FutureBooking[];
    return rows.length === 0 ? { status: 'none' } : { status: 'found', bookings: rows };
  } catch (err) {
    console.error('Error checking bookings:', err);
    return { status: 'unknown', error: failureText(err) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// "• Order #1A2B3C4D - Jane Smith on 2026-07-10" - the order is shown by its short id, never by a column that does not exist.
export function describeFutureBooking(booking: FutureBooking): string {
  const order = booking.orders;
  const customer = order.customers;
  const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Unknown customer';
  return `• Order #${formatOrderId(order.id)} - ${name} on ${order.event_date}`;
}
