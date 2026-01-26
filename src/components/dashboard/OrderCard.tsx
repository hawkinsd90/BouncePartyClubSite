import { format } from 'date-fns';
import { MapPin, DollarSign, Clock, Package, FileText, CheckCircle, Eye, Copy, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Order, Payment } from '../../types/orders';
import { OrderStatusBadge } from './OrderStatusBadge';
import { OrderPaymentStatus } from './OrderPaymentStatus';
import { formatCurrency } from '../../lib/pricing';
import { calculateOrderTotal, formatTime } from '../../lib/orderUtils';
import { isOrderCancellable } from '../../lib/constants/statuses';

interface OrderCardProps {
  order: Order;
  onViewReceipt: (order: Order, payment: Payment) => void;
  onDuplicateOrder: (orderId: string) => void;
  onCancelOrder: (orderId: string, eventDate: string) => void;
}

export function OrderCard({ order, onViewReceipt, onDuplicateOrder, onCancelOrder }: OrderCardProps) {
  const navigate = useNavigate();
  const eventStartDate = new Date(order.event_date);
  const eventEndDate = order.event_end_date ? new Date(order.event_end_date) : eventStartDate;
  const isMultiDay = eventStartDate.toDateString() !== eventEndDate.toDateString();
  const canCancel = isOrderCancellable(order.status);

  return (
    <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 hover:shadow-lg transition-shadow">
      <div className="mb-4">
        <div className="flex items-start gap-2 mb-2 flex-wrap">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 flex-grow min-w-0">
            {isMultiDay
              ? `${format(eventStartDate, 'MMM d')} - ${format(eventEndDate, 'MMM d, yyyy')}`
              : format(eventStartDate, 'MMMM d, yyyy')}
          </h3>
          <OrderStatusBadge order={order} />
        </div>
        <p className="text-xs sm:text-sm text-gray-500">
          Order #{formatOrderId(order.id)}
        </p>
      </div>

      <div className="space-y-2.5 sm:space-y-3">
        {order.addresses && (
          <div className="flex items-start gap-2 text-xs sm:text-sm text-gray-600">
            <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <div className="break-words">{order.addresses.line1}</div>
              {order.addresses.line2 && <div className="break-words">{order.addresses.line2}</div>}
              <div>{order.addresses.city}, {order.addresses.state} {order.addresses.zip}</div>
            </div>
          </div>
        )}

        {(order.start_window || order.end_window || order.event_start_time || order.event_end_time) && (
          <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600">
            <Clock className="w-4 h-4 flex-shrink-0" />
            <span>
              {(order.start_window || order.event_start_time) && formatTime(order.start_window || order.event_start_time)}
              {(order.start_window || order.event_start_time) && (order.end_window || order.event_end_time) && ' - '}
              {(order.end_window || order.event_end_time) && formatTime(order.end_window || order.event_end_time)}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600">
          <Package className="w-4 h-4 flex-shrink-0" />
          <span className="capitalize">{order.location_type} Event</span>
        </div>

        {order.order_items && order.order_items.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <h4 className="text-xs font-semibold text-gray-700 mb-2">Rental Items:</h4>
            <div className="space-y-1.5">
              {order.order_items.map((item) => (
                <div key={item.id} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-600">
                    {item.qty > 1 && `${item.qty}x `}
                    {item.units.name}
                  </span>
                  <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
                    {item.wet_or_dry === 'water' ? 'Wet' : 'Dry'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 text-xs sm:text-sm text-gray-600">
          <DollarSign className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <div>
              <span className="text-gray-600">Total: </span>
              <span className="font-semibold text-gray-900">
                {formatCurrency(calculateOrderTotal(order))}
              </span>
            </div>
            <span className="text-gray-400 hidden sm:inline">•</span>
            <OrderPaymentStatus order={order} />
          </div>
        </div>

        {Array.isArray(order.payments) && order.payments.filter(p => p.status === 'succeeded').length > 0 && (
          <div className="flex items-start gap-2 text-xs sm:text-sm">
            <FileText className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-400" />
            <div className="flex gap-2 flex-wrap">
              {order.payments
                .filter(p => p.status === 'succeeded')
                .map(payment => (
                  <button
                    key={payment.id}
                    onClick={() => onViewReceipt(order, payment)}
                    className="text-blue-600 hover:text-blue-700 underline"
                  >
                    View {payment.type === 'deposit' ? 'Deposit' : 'Balance'} Receipt
                  </button>
                ))}
            </div>
          </div>
        )}

        {order.waiver_signed_at && (
          <div className="flex items-center gap-2 text-xs sm:text-sm text-green-600">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            <span>Waiver Signed</span>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`/customer-portal/${order.id}`)}
            className="flex-1 px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5 sm:gap-2 text-sm"
          >
            <Eye className="w-4 h-4 flex-shrink-0" />
            <span className="hidden xs:inline">View Details</span>
            <span className="xs:hidden">Details</span>
          </button>
          {order.signed_waiver_url && (
            <button
              onClick={() => window.open(order.signed_waiver_url!, '_blank')}
              className="px-3 sm:px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-1.5 sm:gap-2 text-sm"
            >
              <FileText className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline">Waiver</span>
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onDuplicateOrder(order.id)}
            className="flex-1 px-3 sm:px-4 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors flex items-center justify-center gap-1.5 sm:gap-2 text-sm font-medium"
          >
            <Copy className="w-4 h-4 flex-shrink-0" />
            <span>Duplicate Order</span>
          </button>
          {canCancel && (
            <button
              onClick={() => onCancelOrder(order.id, order.event_date)}
              className="flex-1 px-3 sm:px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors flex items-center justify-center gap-1.5 sm:gap-2 text-sm font-medium"
            >
              <XCircle className="w-4 h-4 flex-shrink-0" />
              <span>Cancel Order</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
