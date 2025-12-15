import { format } from 'date-fns';
import { X } from 'lucide-react';
import { Order, Payment } from '../../types/orders';
import { OrderSummary } from '../order/OrderSummary';
import { OrderSummaryDisplay } from '../../lib/orderSummary';
import { formatCurrency } from '../../lib/pricing';
import { calculateOrderTotal, formatTime } from '../../lib/orderUtils';

interface ReceiptModalProps {
  order: Order;
  payment: Payment;
  summary: OrderSummaryDisplay | null;
  loading: boolean;
  onClose: () => void;
}

export function ReceiptModal({ order, payment, summary, loading, onClose }: ReceiptModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-lg max-w-4xl w-full my-8">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Payment Receipt</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {loading ? (
            <div className="py-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600">Loading receipt details...</p>
            </div>
          ) : (
            <div className="space-y-6 max-h-[calc(90vh-200px)] overflow-y-auto">
              <div className="text-center pb-6 border-b border-gray-200">
                <img
                  src="/bounce%20party%20club%20logo.png"
                  alt="Bounce Party Club"
                  className="h-20 mx-auto mb-3 object-contain"
                />
                <h3 className="text-xl font-bold text-gray-900">Bounce Party Club</h3>
                <p className="text-gray-600 mt-1">(313) 889-3860</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm bg-blue-50 p-4 rounded-lg">
                <div>
                  <p className="text-gray-600">Payment Received</p>
                  <p className="font-semibold text-gray-900">
                    {format(new Date(payment.paid_at || payment.created_at), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">Order ID</p>
                  <p className="font-semibold text-gray-900 text-xs">
                    #{order.id.slice(0, 8)}
                  </p>
                </div>
              </div>

              <div className="bg-green-50 p-4 rounded-lg border-2 border-green-200">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold text-gray-900">Amount Paid</span>
                  <span className="text-2xl font-bold text-green-600">
                    {formatCurrency(payment.amount_cents)}
                  </span>
                </div>
                {payment.payment_method && (
                  <div className="mt-3 pt-3 border-t border-green-200">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">Payment Method:</span>
                      <span className="font-medium text-gray-900">
                        {(() => {
                          const method = payment.payment_method;
                          const brand = payment.payment_brand;
                          const lastFour = payment.payment_last4;

                          if (method === 'card' && brand) {
                            const brandName = brand.charAt(0).toUpperCase() + brand.slice(1);
                            return lastFour ? `${brandName} ****${lastFour}` : brandName;
                          }
                          if (method === 'apple_pay') return 'Apple Pay';
                          if (method === 'google_pay') return 'Google Pay';
                          if (method === 'link') return 'Link';
                          if (method === 'us_bank_account') return 'Bank Account';
                          if (method === 'cash') return 'Cash';
                          if (method === 'check') return 'Check';
                          return method.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                        })()}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-3">Customer Information</h4>
                <div className="text-sm space-y-2">
                  <p>
                    <span className="text-gray-600">Name: </span>
                    <span className="font-medium text-gray-900">
                      {order.customers.first_name} {order.customers.last_name}
                    </span>
                  </p>
                  <p>
                    <span className="text-gray-600">Email: </span>
                    <span className="font-medium text-gray-900">{order.customers.email}</span>
                  </p>
                  <p>
                    <span className="text-gray-600">Phone: </span>
                    <span className="font-medium text-gray-900">{order.customers.phone}</span>
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-3">Event Information</h4>
                <div className="text-sm space-y-2">
                  <p>
                    <span className="text-gray-600">Date: </span>
                    <span className="font-medium text-gray-900">
                      {format(new Date(order.event_date), 'MMMM d, yyyy')}
                      {order.event_end_date && order.event_end_date !== order.event_date && (
                        <> - {format(new Date(order.event_end_date), 'MMMM d, yyyy')}</>
                      )}
                    </span>
                  </p>
                  {(order.start_window || order.end_window || order.event_start_time || order.event_end_time) && (
                    <p>
                      <span className="text-gray-600">Time: </span>
                      <span className="font-medium text-gray-900">
                        {(order.start_window || order.event_start_time) && formatTime(order.start_window || order.event_start_time)}
                        {(order.start_window || order.event_start_time) && (order.end_window || order.event_end_time) && ' - '}
                        {(order.end_window || order.event_end_time) && formatTime(order.end_window || order.event_end_time)}
                      </span>
                    </p>
                  )}
                  {order.addresses && (
                    <p>
                      <span className="text-gray-600">Location: </span>
                      <span className="font-medium text-gray-900">
                        {order.addresses.line1}, {order.addresses.city}, {order.addresses.state} {order.addresses.zip}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {summary && (
                <div className="pt-4 border-t-2 border-gray-300">
                  <OrderSummary
                    summary={summary}
                    title="Complete Order Details"
                    showDeposit={false}
                    showTip={true}
                  />
                </div>
              )}

              <div className="pt-4 border-t-2 border-gray-300">
                <h4 className="font-semibold text-gray-900 mb-3">Payment Status</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-700">Deposit Paid:</span>
                    <span className="font-medium text-green-600">{formatCurrency(order.deposit_paid_cents)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-700">Balance Paid:</span>
                    <span className="font-medium text-green-600">{formatCurrency(order.balance_paid_cents)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-200 font-semibold text-lg">
                    <span className="text-gray-900">Remaining Balance:</span>
                    <span className="text-blue-700">
                      {summary
                        ? formatCurrency(summary.total - order.deposit_paid_cents - order.balance_paid_cents)
                        : formatCurrency(calculateOrderTotal(order) - order.deposit_paid_cents - order.balance_paid_cents)
                      }
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-gray-200 text-center text-sm text-gray-600">
                <p>Thank you for your business!</p>
                <p className="mt-2">Questions? Contact us at (313) 889-3860</p>
              </div>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-gray-200 flex gap-3">
            <button
              onClick={() => window.print()}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              disabled={loading}
            >
              Print Receipt
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
