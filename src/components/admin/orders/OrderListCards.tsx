import { format } from 'date-fns';
import { Calendar, MapPin, User, Archive } from 'lucide-react';
import { PhoneLink } from '../../shared/PhoneLink';
import { OrderStatusBadge } from '../../dashboard/OrderStatusBadge';
import { formatOrderId } from '../../../lib/utils';
import type { Order } from '../../../types/orders';

// The list query also returns archived_at, which the shared Order type does not declare.
type ListedOrder = Order & { archived_at?: string | null };

interface Props {
  orders: ListedOrder[];
  contactsMap: Map<string, { business_name?: string | null }>;
  onOpen: (orderId: string) => void;
}

// The orders list below the md breakpoint. The 1000px-wide table needs sideways scrolling on a phone, so each order is a card instead:
// the order number is a 44px button that opens the order, and the phone number stays its own control.
export function OrderListCards({ orders, contactsMap, onOpen }: Props) {
  return (
    <ul className="space-y-3 md:hidden" aria-label="Orders">
      {orders.map((order) => {
        const business = contactsMap.get(order.customers?.email ?? '')?.business_name;
        return (
          <li key={order.id} className="bg-white rounded-lg shadow p-4">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => onOpen(order.id)}
                className="text-left min-h-[44px] font-mono font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                aria-label={`Open order ${formatOrderId(order.id).toUpperCase()}`}
              >
                {formatOrderId(order.id).toUpperCase()}
              </button>
              <div className="flex flex-col items-end gap-1 min-w-0">
                <OrderStatusBadge order={order} />
                {order.archived_at && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-500">
                    <Archive className="w-3 h-3" />
                    Archived
                  </span>
                )}
              </div>
            </div>
            <div className="mt-2 flex items-start gap-2 text-sm text-slate-900 min-w-0">
              <User className="w-4 h-4 mt-0.5 text-slate-400 flex-shrink-0" />
              <div className="min-w-0 break-words">
                {business && <div className="font-bold">{business}</div>}
                <div className="font-medium">{order.customers?.first_name} {order.customers?.last_name}</div>
                <div className="text-xs text-slate-500 mt-1"><PhoneLink phone={order.customers?.phone} /></div>
              </div>
            </div>
            <div className="mt-2 flex items-start gap-2 text-sm text-slate-900">
              <Calendar className="w-4 h-4 mt-0.5 text-slate-400 flex-shrink-0" />
              <div>
                {format(new Date(order.event_date + 'T12:00:00'), 'MMM d, yyyy')}
                <span className="text-xs text-slate-500 ml-2">{order.start_window} - {order.end_window}</span>
              </div>
            </div>
            <div className="mt-2 flex items-start gap-2 text-sm text-slate-900">
              <MapPin className="w-4 h-4 mt-0.5 text-slate-400 flex-shrink-0" />
              <div>
                {order.addresses?.city}, {order.addresses?.state}
                <span className="text-xs text-slate-500 capitalize ml-2">{order.location_type}</span>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
              <span>{order.created_at ? `Created ${format(new Date(order.created_at), 'MMM d, yyyy h:mm a')}` : ''}</span>
              <span className="px-2 py-1 font-semibold rounded-full bg-slate-100 text-slate-800 capitalize">
                {order.workflow_status?.replace(/_/g, ' ') || 'pending'}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
