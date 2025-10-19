import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');
  const [processing, setProcessing] = useState(true);

  useEffect(() => {
    async function processPayment() {
      if (!orderId) {
        setProcessing(false);
        return;
      }

      try {
        // Notify parent window immediately
        if (window.opener) {
          window.opener.postMessage({ type: 'PAYMENT_SUCCESS', orderId }, '*');
        }

        setProcessing(false);

        // Auto-close after a brief delay
        setTimeout(() => {
          window.close();
        }, 1500);
      } catch (error) {
        console.error('Error processing payment success:', error);
        setProcessing(false);
      }
    }

    processPayment();
  }, [orderId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 text-center max-w-md">
        <div className="text-6xl text-green-500 mb-4">✓</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Complete!</h1>
        <p className="text-gray-600 mb-4">
          {processing ? 'Processing your payment...' : 'Your payment has been processed successfully.'}
        </p>
        <p className="text-sm text-gray-500 mb-4">This window will close automatically...</p>
        <button
          onClick={() => window.close()}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          Close Window
        </button>
      </div>
    </div>
  );
}
