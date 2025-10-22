import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function PaymentComplete() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const updateOrder = async () => {
      console.log('💳 [PAYMENT-COMPLETE] Component mounted');

      const orderId = searchParams.get('orderId');
      const sessionId = searchParams.get('session_id');

      console.log('💳 [PAYMENT-COMPLETE] Order ID:', orderId);
      console.log('💳 [PAYMENT-COMPLETE] Session ID:', sessionId);

      if (!orderId) {
        console.error('❌ [PAYMENT-COMPLETE] No order ID in URL');
        setError('No order ID provided');
        setStatus('error');
        return;
      }

      try {
        console.log('📝 [PAYMENT-COMPLETE] Calling edge function to update order...');

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/stripe-checkout?action=webhook&orderId=${orderId}&session_id=${sessionId}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ [PAYMENT-COMPLETE] Edge function error:', errorText);
          setError('Failed to update order');
          setStatus('error');
          return;
        }

        const result = await response.json();
        console.log('✅ [PAYMENT-COMPLETE] Edge function response:', result);
        setStatus('success');

        setTimeout(() => {
          console.log('🔒 [PAYMENT-COMPLETE] Closing window...');
          window.close();
        }, 1500);
      } catch (err: any) {
        console.error('❌ [PAYMENT-COMPLETE] Error:', err);
        setError(err.message);
        setStatus('error');
      }
    };

    updateOrder();
  }, [searchParams]);

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-red-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-600 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Update Error</h2>
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-scale-in">
          <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Payment Complete!</h1>
        <p className="text-slate-600">This window will close automatically...</p>
      </div>
    </div>
  );
}
