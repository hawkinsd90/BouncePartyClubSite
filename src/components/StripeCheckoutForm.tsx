import { useState, useEffect } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Loader2 } from 'lucide-react';

let stripePromise: Promise<Stripe | null> | null = null;

async function getStripePromise() {
  if (stripePromise) return stripePromise;

  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-stripe-publishable-key`;
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();

    if (data.publishableKey) {
      stripePromise = loadStripe(data.publishableKey);
    } else {
      throw new Error('No publishable key configured');
    }

    return stripePromise;
  } catch (error) {
    console.error('Error loading Stripe:', error);
    return null;
  }
}

interface CheckoutFormProps {
  onSuccess: () => void;
  onError: (error: string) => void;
}

function CheckoutForm({ onSuccess, onError }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [canRender, setCanRender] = useState(false);

  useEffect(() => {
    if (!stripe || !elements) {
      console.log('Stripe or Elements not ready yet');
      setCanRender(false);
      return;
    }
    console.log('Stripe and Elements are ready');

    // Use requestAnimationFrame for better timing with DOM readiness
    let cancelled = false;
    requestAnimationFrame(() => {
      if (!cancelled) {
        // Additional delay to ensure Stripe's iframe is fully ready
        setTimeout(() => {
          if (!cancelled) {
            setCanRender(true);
            console.log('PaymentElement can now render');
          }
        }, 500);
      }
    });

    return () => {
      cancelled = true;
      setCanRender(false);
    };
  }, [stripe, elements]);

  const handleReady = () => {
    console.log('PaymentElement is ready');
    setIsReady(true);
  };

  const handleLoadError = (event: any) => {
    console.error('PaymentElement loader error:', event);
    onError('Failed to load payment form. Please refresh and try again.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      onError('Payment system not ready. Please refresh and try again.');
      return;
    }

    setProcessing(true);

    try {
      console.log('Starting payment confirmation...');

      // Add timeout to prevent infinite loading
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Payment request timed out. Please try again.')), 30000)
      );

      const paymentPromise = stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin + '/checkout',
        },
        redirect: 'if_required',
      });

      const { error, paymentIntent } = await Promise.race([paymentPromise, timeoutPromise]) as any;

      console.log('Payment confirmation result:', { error, paymentIntent });

      if (error) {
        console.error('Payment error:', error);
        onError(error.message || 'Payment failed');
      } else {
        console.log('Payment successful:', paymentIntent);
        onSuccess();
      }
    } catch (err: any) {
      console.error('Payment exception:', err);
      onError(err.message || 'Payment failed. Please check your payment details and try again.');
    } finally {
      setProcessing(false);
    }
  };

  if (!stripe || !elements || !canRender) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-600">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Initializing payment form...
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-6">
        <PaymentElement
          onReady={handleReady}
          onLoadError={handleLoadError}
          options={{
            layout: 'tabs',
          }}
        />
      </div>
      {!isReady && (
        <div className="flex items-center justify-center py-4 text-slate-600">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Loading payment form...
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || !isReady || processing}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center"
      >
        {processing ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Processing Payment...
          </>
        ) : (
          'Pay Now'
        )}
      </button>
    </form>
  );
}

interface StripeCheckoutFormProps {
  orderId: string;
  depositCents: number;
  customerEmail: string;
  customerName: string;
  onSuccess: () => void;
  onError: (error: string) => void;
}

export function StripeCheckoutForm({
  orderId,
  depositCents,
  customerEmail,
  customerName,
  onSuccess,
  onError,
}: StripeCheckoutFormProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const initializePayment = async () => {
      // Reset state
      setLoading(true);
      setClientSecret(null);
      setStripe(null);
      setInitError(null);

      try {
        console.log('Initializing Stripe payment...');
        const stripeInstance = await getStripePromise();
        if (!mounted) return;

        if (!stripeInstance) {
          throw new Error('Failed to load Stripe. Please check configuration.');
        }
        console.log('Stripe instance loaded');

        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`;
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orderId,
            depositCents,
            customerEmail,
            customerName,
          }),
        });

        if (!mounted) return;

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to create payment intent');
        }

        const data = await response.json();
        console.log('Payment intent created', { hasClientSecret: !!data.clientSecret });

        if (!data.clientSecret) {
          throw new Error('No client secret returned from server');
        }

        // Set both at the same time to ensure Elements has everything it needs
        if (mounted) {
          console.log('Setting stripe and clientSecret');
          setStripe(stripeInstance);
          setClientSecret(data.clientSecret);
          console.log('State updated, Elements should mount now');
        }
      } catch (err: any) {
        console.error('Payment initialization error:', err);
        if (mounted) {
          setInitError(err.message || 'Failed to initialize payment');
          setLoading(false);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initializePayment();

    return () => {
      mounted = false;
    };
  }, [orderId, depositCents, customerEmail, customerName, onError]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (initError || !clientSecret || !stripe) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 mb-4">{initError || 'Failed to initialize payment'}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-blue-600 hover:underline"
        >
          Reload page to try again
        </button>
      </div>
    );
  }

  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#2563eb',
          },
        },
      }}
    >
      <CheckoutForm
        onSuccess={onSuccess}
        onError={onError}
      />
    </Elements>
  );
}
