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
      <div className="bg-white text-center max-w-md w-full">
        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-green-500 mb-8 animate-[scale-in_0.3s_ease-out]">
          <CheckCircle className="w-14 h-14 text-white" strokeWidth={2.5} />
        </div>

        <h1 className="text-4xl font-bold text-gray-900 mb-4">Payment Complete!</h1>

        <p className="text-gray-600 text-lg mb-8 leading-relaxed">
          Your payment has been processed successfully. We'll send you a confirmation email shortly.
        </p>

        <button
          onClick={handleContinue}
          className="inline-block px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors text-base"
        >
          Return to Home
        </button>
      </div>
    </div>
  );
}
