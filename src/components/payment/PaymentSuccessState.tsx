import { useNavigate, useSearchParams } from 'react-router-dom';
import { Home, ArrowRight } from 'lucide-react';
import { formatOrderId } from '../../lib/utils';

interface OrderDetails {
  id: string;
  event_date: string;
  deposit_due_cents: number;
  balance_due_cents: number;
  customer_selected_payment_cents?: number;
  subtotal_cents: number;
  travel_fee_cents: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  tax_cents: number;
  tip_cents: number;
  customer?: {
    email: string;
  };
}

interface PaymentSuccessStateProps {
  orderDetails: OrderDetails | null;
  sessionTipCents?: number;
}

export function PaymentSuccessState({ orderDetails, sessionTipCents = 0 }: PaymentSuccessStateProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('order_id') || orderDetails?.id;

  const displayTipCents = orderDetails?.tip_cents || sessionTipCents;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-8">
      <div className="bg-white max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <button onClick={() => navigate('/')} className="focus:outline-none">
              <img
                src="/bounce party club logo.png"
                alt="Bounce Party Club"
                className="h-24 w-auto hover:opacity-80 transition-opacity cursor-pointer"
              />
            </button>
          </div>

          <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold text-slate-900 mb-4">Request Received!</h1>

          <p className="text-slate-600 mb-4">
            Thank you for choosing Bounce Party Club. Your booking request has been submitted and is now pending admin review.
          </p>

          <div className="flex items-start gap-3 bg-green-50 border border-green-300 rounded-lg p-4 mb-6 text-left">
            <svg className="w-5 h-5 text-green-700 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-green-900">Your card has not been charged</p>
              <p className="text-xs text-green-800 mt-0.5">
                Your payment information has been saved securely. No charge will be made until admin reviews and approves your order — typically within 24 hours.
              </p>
            </div>
          </div>
        </div>

        {orderDetails && (
          <div className="space-y-6 mb-8">
            <div className="grid grid-cols-2 gap-4 p-6 bg-slate-50 rounded-lg">
              <div>
                <p className="text-sm text-slate-600 mb-1">Order ID:</p>
                <p className="font-semibold text-slate-900">
                  {formatOrderId(orderDetails.id)}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Event Date:</p>
                <p className="font-semibold text-slate-900">
                  {new Date(orderDetails.event_date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Deposit Amount:</p>
                <p className="font-semibold text-green-600">
                  ${((orderDetails.customer_selected_payment_cents || orderDetails.deposit_due_cents) / 100).toFixed(2)}
                </p>
              </div>
              {displayTipCents > 0 && (
                <div>
                  <p className="text-sm text-slate-600 mb-1">Crew Tip:</p>
                  <p className="font-semibold text-green-600">
                    ${(displayTipCents / 100).toFixed(2)}
                  </p>
                </div>
              )}
              {displayTipCents > 0 && (
                <div className="col-span-2">
                  <p className="text-sm text-slate-600 mb-1">Total After Approval (including tip):</p>
                  <p className="font-semibold text-green-600 text-lg">
                    ${(((orderDetails.customer_selected_payment_cents || orderDetails.deposit_due_cents) + displayTipCents) / 100).toFixed(2)}
                  </p>
                </div>
              )}
              <div className={displayTipCents > 0 ? 'col-span-2' : ''}>
                <p className="text-sm text-slate-600 mb-1">Balance Due Day of Event:</p>
                <p className="font-semibold text-slate-900">
                  ${(Math.max(0, (orderDetails.subtotal_cents + orderDetails.travel_fee_cents + orderDetails.surface_fee_cents + (orderDetails.same_day_pickup_fee_cents || 0) + orderDetails.tax_cents - (orderDetails.customer_selected_payment_cents || orderDetails.deposit_due_cents))) / 100).toFixed(2)}
                </p>
              </div>
            </div>

            <div className="p-6 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-sm text-blue-900 leading-relaxed">
                A confirmation email has been queued for{' '}
                <span className="font-semibold">{orderDetails.customer?.email}</span>. Please allow a
                few minutes for it to arrive.
              </p>
            </div>

            <div className="p-6 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-700 leading-relaxed mb-3">
                Our admin team will review your booking request and contact you within 24 hours to
                confirm your delivery time window and finalize your reservation details.
              </p>
              <p className="text-sm text-slate-600">
                If you have any questions, contact us at{' '}
                <span className="font-semibold">(313) 889-3860</span>.
              </p>
            </div>
          </div>
        )}

        <div className="text-center">
          <p className="text-lg font-semibold text-slate-900 mb-6">Thank You!</p>
          <p className="text-sm text-slate-500 italic">
            Thank you for choosing Bounce Party Club to bring energy and excitement to your event.
            If you have any questions, contact us at (313) 889-3860.
          </p>
        </div>

        {orderId && (
          <div className="mt-6 border border-green-200 bg-green-50 rounded-lg p-5">
            <h3 className="font-semibold text-slate-900 mb-1">Track Your Order</h3>
            <p className="text-sm text-slate-600 mb-4">
              View live updates, check order status, and manage your booking through your customer portal:
            </p>
            <button
              onClick={() => navigate(`/customer-portal/${orderId}`)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
            >
              View Customer Portal
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors"
          >
            <Home className="w-5 h-5" />
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
