import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';

export function PaymentComplete() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const orderId = searchParams.get('orderId');
    const sessionId = searchParams.get('session_id');

    console.log('💳 [PAYMENT-COMPLETE] Page loaded');
    console.log('💳 [PAYMENT-COMPLETE] Order ID:', orderId);
    console.log('💳 [PAYMENT-COMPLETE] Session ID:', sessionId);
    console.log('💳 [PAYMENT-COMPLETE] Main window polling will handle order update');

    setTimeout(() => {
      console.log('🔒 [PAYMENT-COMPLETE] Attempting to close window...');
      window.close();

      setTimeout(() => {
        if (!window.closed) {
          console.log('⚠️ [PAYMENT-COMPLETE] Window did not close - user can manually close');
        }
      }, 500);
    }, 2000);
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-8 text-center max-w-md animate-[scale-in_0.3s_ease-out]">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500 mb-6">
          <CheckCircle className="w-12 h-12 text-white" strokeWidth={2.5} />
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-3">Payment Successful!</h1>

        <p className="text-gray-600 text-base mb-2">
          Your payment has been processed.
        </p>

        <p className="text-gray-500 text-sm">
          You can close this tab now.
        </p>
      </div>
    </div>
  );
}
