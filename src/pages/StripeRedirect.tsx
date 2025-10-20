import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';

export function StripeRedirect() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initiateCheckout = async () => {
      try {
        const orderId = searchParams.get('orderId');
        const depositCents = parseInt(searchParams.get('depositCents') || '0');
        const tipCents = parseInt(searchParams.get('tipCents') || '0');
        const customerEmail = searchParams.get('email');
        const customerName = searchParams.get('name');

        if (!orderId || !depositCents || !customerEmail || !customerName) {
          throw new Error('Missing required parameters');
        }

        const appBaseUrl = window.location.origin;

        console.log('Creating Stripe checkout session...');

        // Call edge function to create checkout session
        const { data, error: invokeError } = await supabase.functions.invoke('stripe-checkout', {
          body: {
            orderId,
            depositCents,
            tipCents,
            customerEmail,
            customerName,
            appBaseUrl,
          },
        });

        if (invokeError || !data?.url) {
          throw new Error(data?.error || invokeError?.message || 'Failed to create checkout session');
        }

        console.log('Redirecting to Stripe...');
        // Redirect to Stripe checkout
        window.location.href = data.url;
      } catch (err: any) {
        console.error('Error creating checkout:', err);
        setError(err.message || 'Failed to initiate payment');
      }
    };

    initiateCheckout();
  }, [searchParams]);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-600 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Payment Error</h2>
          <p className="text-slate-600 mb-6">{error}</p>
          <button
            onClick={() => window.history.back()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
        <Loader2 className="w-16 h-16 text-blue-600 animate-spin mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Preparing Payment</h2>
        <p className="text-slate-600">Please wait while we redirect you to secure payment...</p>
      </div>
    </div>
  );
}
