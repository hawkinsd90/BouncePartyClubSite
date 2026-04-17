import { format } from 'date-fns';
import { Calendar, MapPin, User, Hash, CreditCard as Edit } from 'lucide-react';
import { formatOrderId } from '../../lib/utils';
import { ORDER_STATUS } from '../../lib/constants/statuses';

interface AdminFloatingOrderHeaderProps {
  order: any | null;
  isVisible: boolean;
  onEditClick?: () => void;
}

export function AdminFloatingOrderHeader({ order, isVisible, onEditClick }: AdminFloatingOrderHeaderProps) {
  if (!isVisible || !order) {
    return null;
  }

  return (
    <div className="fixed top-16 left-0 right-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-b from-blue-50 to-blue-100 border-b-4 border-blue-400 shadow-lg rounded-b-xl animate-slide-down">
          <div className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-blue-600" />
                <span className="font-mono font-bold text-blue-700">
                  {formatOrderId(order.id).toUpperCase()}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-600" />
                <span className="font-semibold text-slate-900">
                  {order.customers?.first_name} {order.customers?.last_name}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-600" />
                <span className="text-slate-700">
                  {format(new Date(order.event_date + 'T12:00:00'), 'MMM d, yyyy')}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-slate-600" />
                <span className="text-slate-700">
                  {order.addresses?.city}, {order.addresses?.state}
                </span>
              </div>

              <div className="ml-auto flex items-center gap-3">
                {onEditClick && (
                  <button
                    onClick={onEditClick}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-blue-50 text-blue-700 font-semibold rounded-lg border-2 border-blue-400 transition-colors"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>Edit Order</span>
                  </button>
                )}
                <span className={`inline-flex px-3 py-1 text-xs font-bold rounded-full ${
                  order.status === ORDER_STATUS.PENDING
                    ? 'bg-orange-600 text-white'
                    : order.status === ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL
                    ? 'bg-amber-600 text-white'
                    : order.status === ORDER_STATUS.DRAFT
                    ? 'bg-orange-600 text-white'
                    : order.status === ORDER_STATUS.CONFIRMED
                    ? 'bg-green-600 text-white'
                    : order.status === ORDER_STATUS.IN_PROGRESS
                    ? 'bg-blue-600 text-white'
                    : order.status === ORDER_STATUS.COMPLETED
                    ? 'bg-green-700 text-white'
                    : order.status === ORDER_STATUS.CANCELLED
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-500 text-white'
                }`}>
                  {order.status.replace(/_/g, ' ').toUpperCase()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
