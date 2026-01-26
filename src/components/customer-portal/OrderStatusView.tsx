import { format } from 'date-fns';
import { formatCurrency } from '../../lib/pricing';

interface OrderStatusViewProps {
  order: any;
}

export function OrderStatusView({ order }: OrderStatusViewProps) {
  const statusMessages = {
    draft: {
      title: 'Invoice Pending',
      message:
        'This invoice is awaiting your acceptance. Please check your email for the invoice link.',
    },
    pending_review: {
      title: 'Order Under Review',
      message:
        "Thank you! Your booking is currently being reviewed by our team. If you already approved recent changes, we've received your approval and will finalize your booking shortly. You'll receive an email with next steps once your order is confirmed.",
    },
    cancelled: {
      title: 'Order Cancelled',
      message:
        'This order has been cancelled. If you have questions, please contact us.',
    },
    void: {
      title: 'Order Voided',
      message:
        'This order is no longer valid. Please contact us if you need assistance.',
    },
  };

  const statusInfo =
    statusMessages[order.status as keyof typeof statusMessages] ||
    statusMessages.draft;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-2xl w-full bg-white rounded-xl shadow-lg overflow-hidden border-2 border-slate-300">
        <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-8 py-6 text-center">
          <img
            src="/bounce party club logo.png"
            alt="Bounce Party Club"
            className="h-20 w-auto mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold text-white">Order Status</h1>
          <p className="text-blue-100 mt-2">
            Order #{formatOrderId(order.id)}
          </p>
        </div>

        <div className="px-8 py-8 text-center">
          <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-blue-900 mb-3">
              {statusInfo.title}
            </h2>
            <p className="text-slate-700 mb-4">{statusInfo.message}</p>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between py-3 border-b border-slate-200">
              <span className="text-slate-600 font-medium">Customer:</span>
              <span className="text-slate-900">
                {order.customers?.first_name || 'Pending'}{' '}
                {order.customers?.last_name || ''}
              </span>
            </div>
            <div className="flex justify-between py-3 border-b border-slate-200">
              <span className="text-slate-600 font-medium">Event Date:</span>
              <span className="text-slate-900">
                {format(new Date(order.event_date), 'MMMM d, yyyy')}
              </span>
            </div>
            <div className="flex justify-between py-3 border-b border-slate-200">
              <span className="text-slate-600 font-medium">Total:</span>
              <span className="text-slate-900 font-semibold">
                {formatCurrency(order.deposit_due_cents + order.balance_due_cents)}
              </span>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-200">
            <p className="text-slate-600 text-sm mb-4">Questions about your order?</p>
            <a
              href="tel:+13138893860"
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              Call (313) 889-3860
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
