import { useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react';

interface OrderDetails {
  id: string;
  event_date: string;
  deposit_due_cents: number;
  balance_due_cents: number;
  customer?: {
    email: string;
  };
}

interface PaymentSuccessStateProps {
  orderDetails: OrderDetails | null;
  isAdminInvoice: boolean;
}

export function PaymentSuccessState({ orderDetails, isAdminInvoice }: PaymentSuccessStateProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-8">
      <div className="bg-white max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <img
              src="/bounce party club logo.png"
              alt="Bounce Party Club"
              className="h-24 w-auto"
            />
          </div>

          <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold text-slate-900 mb-4">
            {isAdminInvoice ? 'Booking Confirmed!' : 'Request Received!'}
          </h1>

          <p className="text-slate-600 mb-6">
            {isAdminInvoice ? (
              <>
                Thank you for choosing Bounce Party Club. Your order has been placed successfully!
                We'll confirm your drop-off time shortly.
              </>
            ) : (
              <>
                Thank you for choosing Bounce Party Club. Your booking request has been submitted and is now
                pending admin review for final confirmation. Your deposit will be processed once your
                booking is approved.
              </>
            )}
          </p>
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
                <p className="text-sm text-slate-600 mb-1">Deposit:</p>
                <p className="font-semibold text-green-600">
                  ${(orderDetails.deposit_due_cents / 100).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Balance Due:</p>
                <p className="font-semibold text-slate-900">
                  ${(orderDetails.balance_due_cents / 100).toFixed(2)}
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
                {isAdminInvoice ? (
                  <>
                    Your order is confirmed and we're preparing for your event. We'll contact you to confirm
                    the drop-off time.
                  </>
                ) : (
                  <>
                    Our admin team will review your booking request and contact you within 24 hours to
                    confirm your delivery time window and finalize your reservation details.
                  </>
                )}
              </p>
              <p className="text-sm text-slate-600">
                If you have any questions, contact us at{' '}
                <span className="font-semibold">(313) 889-3860</span> or visit us at{' '}
                <span className="font-semibold">4426 Woodward Ave, Wayne, MI 48184</span>.
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

        <div className="mt-8 text-center">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            <Home className="w-5 h-5" />
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
