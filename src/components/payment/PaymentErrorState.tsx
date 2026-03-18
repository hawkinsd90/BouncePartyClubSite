import { useSearchParams } from 'react-router-dom';

interface PaymentErrorStateProps {
  error: string | null;
}

export function PaymentErrorState({ error }: PaymentErrorStateProps) {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('order_id');

  const isPaymentDecline =
    error?.toLowerCase().includes('declin') ||
    error?.toLowerCase().includes('card') ||
    error?.toLowerCase().includes('payment');

  function handleRetry() {
    if (orderId) {
      window.history.back();
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-red-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="text-red-600 mb-4">
          <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          {isPaymentDecline ? 'Payment Declined' : 'Payment Error'}
        </h2>
        <p className="text-slate-600 mb-6">{error}</p>

        {isPaymentDecline && (
          <>
            <p className="text-sm text-slate-500 mb-4">
              Your card was not charged. Please go back and try a different payment method.
            </p>
            <button
              onClick={handleRetry}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors mb-3"
            >
              Try a Different Card
            </button>
          </>
        )}

        {orderId && (
          <a
            href={`/customer-portal/${orderId}`}
            className="block text-sm text-blue-600 hover:text-blue-700 underline"
          >
            Return to your order
          </a>
        )}
      </div>
    </div>
  );
}
