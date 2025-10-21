import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CheckCircle, Loader2 } from 'lucide-react';

export function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(true);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    const orderIdFromUrl = searchParams.get('orderId');
    const sessionId = searchParams.get('session_id');

    if (!orderIdFromUrl || !sessionId) {
      console.error('Missing orderId or session_id');
      setProcessing(false);
      return;
    }

    setOrderId(orderIdFromUrl);

    const verifyPayment = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout?action=webhook&orderId=${orderIdFromUrl}&session_id=${sessionId}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
          }
        );

        if (response.ok) {
          console.log('Payment verified successfully');
        }
      } catch (error) {
        console.error('Error verifying payment:', error);
      } finally {
        setProcessing(false);
      }
    };

    verifyPayment();
  }, [searchParams]);

  const handleContinue = () => {
    localStorage.removeItem('bpc_cart');
    localStorage.removeItem('bpc_quote_form');
    localStorage.removeItem('bpc_price_breakdown');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 text-center max-w-md">
        {processing ? (
          <>
            <Loader2 className="w-16 h-16 text-blue-500 mx-auto mb-4 animate-spin" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Processing Payment...</h1>
            <p className="text-gray-600">Please wait while we confirm your payment.</p>
          </>
        ) : (
          <>
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Complete!</h1>
            <p className="text-gray-600 mb-4">
              Your payment has been processed successfully. We'll send you a confirmation email shortly.
            </p>
            {orderId && (
              <p className="text-sm text-gray-500 mb-6">
                Order ID: {orderId.slice(0, 8).toUpperCase()}
              </p>
            )}
            <button
              onClick={handleContinue}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
            >
              Return to Home
            </button>
          </>
        )}
      </div>
    </div>
  );
}
