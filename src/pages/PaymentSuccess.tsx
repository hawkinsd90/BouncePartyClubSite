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
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-12 text-center max-w-md w-full">
        {processing ? (
          <>
            <Loader2 className="w-16 h-16 text-green-500 mx-auto mb-6 animate-spin" />
            <h1 className="text-3xl font-bold text-gray-900 mb-3">Processing Payment...</h1>
            <p className="text-gray-600 text-lg">Please wait while we confirm your payment.</p>
          </>
        ) : (
          <>
            <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center mx-auto mb-6 animate-[scale-in_0.3s_ease-out]">
              <CheckCircle className="w-12 h-12 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">Payment Complete!</h1>
            <p className="text-gray-600 text-lg mb-6">
              Your payment has been processed successfully. We'll send you a confirmation email shortly.
            </p>
            {orderId && (
              <p className="text-sm text-gray-500 mb-8">
                Order ID: {orderId.slice(0, 8).toUpperCase()}
              </p>
            )}
            <button
              onClick={handleContinue}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors text-lg"
            >
              Return to Home
            </button>
          </>
        )}
      </div>
    </div>
  );
}
