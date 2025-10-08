import { useState, useEffect } from 'react';
import { loadStripe, Stripe, StripeElementsOptions } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Loader2 } from 'lucide-react';

let stripePromise: Promise<Stripe | null> | null = null;

async function getStripeInstance(): Promise<Stripe | null> {
  if (!stripePromise) {
    console.log('[getStripeInstance] Creating new Stripe promise');
    stripePromise = (async () => {
      try {
        console.log('[getStripeInstance] Fetching publishable key...');
        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-stripe-publishable-key`;
        const response = await fetch(apiUrl, {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
        });
        const data = await response.json();
        console.log('[getStripeInstance] Received publishable key response');

        if (data.publishableKey) {
          console.log('[getStripeInstance] Loading Stripe with publishable key...');
          const stripeInstance = await loadStripe(data.publishableKey);
          console.log('[getStripeInstance] Stripe loaded:', !!stripeInstance);
          return stripeInstance;
        } else {
          console.error('[getStripeInstance] No publishable key in response');
          throw new Error('No publishable key configured');
        }
      } catch (error) {
        console.error('[getStripeInstance] Error loading Stripe:', error);
        return null;
      }
    })();
  } else {
    console.log('[getStripeInstance] Reusing existing Stripe promise');
  }
  return stripePromise;
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    console.log('[CheckoutForm] Component mounted, stripe:', !!stripe, 'elements:', !!elements);
    setMounted(true);
    return () => {
      console.log('[CheckoutForm] Component unmounted');
      setMounted(false);
    };
  }, []);

  const handleReady = () => {
    console.log('[CheckoutForm] ✓ PaymentElement is ready and can accept input');
    setIsReady(true);
  };

  const handleLoadError = (event: any) => {
    console.error('[CheckoutForm] ✗ PaymentElement loader error:', event);
    console.error('[CheckoutForm] Error details:', JSON.stringify(event, null, 2));
    onError('Failed to load payment form. Please refresh and try again.');
  };

  const handleChange = (event: any) => {
    console.log('[CheckoutForm] PaymentElement changed:', event);
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

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin + '/checkout',
        },
        redirect: 'if_required',
      });

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

  if (!stripe || !elements || !mounted) {
    console.log('[CheckoutForm] Waiting - stripe:', !!stripe, 'elements:', !!elements, 'mounted:', mounted);
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-slate-600">Loading payment form...</span>
      </div>
    );
  }

  console.log('[CheckoutForm] >>> Rendering PaymentElement now. isReady:', isReady, 'mounted:', mounted);

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-6">
        <PaymentElement
          onReady={handleReady}
          onLoadError={handleLoadError}
          onChange={handleChange}
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
  const [options, setOptions] = useState<StripeElementsOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      setLoading(true);
      setOptions(null);
      setInitError(null);

      try {
        console.log('[StripeCheckoutForm] Creating payment intent for order:', orderId);

        const paymentResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`,
          {
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
          }
        );

        if (!mounted) return;

        if (!paymentResponse.ok) {
          const errorData = await paymentResponse.json();
          throw new Error(errorData.error || 'Failed to create payment intent');
        }

        const data = await paymentResponse.json();
        console.log('[StripeCheckoutForm] Payment intent created, clientSecret:', !!data.clientSecret);

        if (!data.clientSecret) {
          throw new Error('No client secret returned from server');
        }

        if (mounted) {
          console.log('[StripeCheckoutForm] Setting options with clientSecret');
          setOptions({
            clientSecret: data.clientSecret,
            appearance: {
              theme: 'stripe',
              variables: {
                colorPrimary: '#2563eb',
              },
            },
          });
        }
      } catch (err: any) {
        console.error('[StripeCheckoutForm] Payment initialization error:', err);
        if (mounted) {
          setInitError(err.message || 'Failed to initialize payment');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
    };
  }, [orderId, depositCents, customerEmail, customerName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (initError || !options) {
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
    <StripeElementsWrapper
      options={options}
      onSuccess={onSuccess}
      onError={onError}
    />
  );
}

interface StripeElementsWrapperProps {
  options: StripeElementsOptions;
  onSuccess: () => void;
  onError: (error: string) => void;
}

function StripeElementsWrapper({ options, onSuccess, onError }: StripeElementsWrapperProps) {
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let mounted = true;
    console.log('[StripeElementsWrapper] Starting Stripe initialization...');

    getStripeInstance()
      .then((stripeInstance) => {
        if (!mounted) {
          console.log('[StripeElementsWrapper] Component unmounted, ignoring Stripe instance');
          return;
        }
        if (stripeInstance) {
          console.log('[StripeElementsWrapper] Stripe instance loaded successfully');
          setStripe(stripeInstance);
          setTimeout(() => {
            if (mounted) {
              console.log('[StripeElementsWrapper] Marking as initialized after delay');
              setInitialized(true);
            }
          }, 100);
        } else {
          console.error('[StripeElementsWrapper] Stripe instance is null');
          setError('Failed to load Stripe');
        }
      })
      .catch((err) => {
        if (!mounted) return;
        console.error('[StripeElementsWrapper] Error loading Stripe:', err);
        setError(err.message || 'Failed to load Stripe');
      });

    return () => {
      console.log('[StripeElementsWrapper] Cleanup - component unmounting');
      mounted = false;
    };
  }, []);

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-blue-600 hover:underline"
        >
          Reload page to try again
        </button>
      </div>
    );
  }

  if (!stripe || !initialized) {
    console.log('[StripeElementsWrapper] Waiting for Stripe instance. stripe:', !!stripe, 'initialized:', initialized);
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-slate-600">Loading Stripe...</span>
      </div>
    );
  }

  console.log('[StripeElementsWrapper] >>> Creating Elements component with:', {
    hasStripe: !!stripe,
    hasClientSecret: !!options.clientSecret,
    clientSecretPrefix: options.clientSecret?.substring(0, 20) + '...',
    appearance: options.appearance
  });

  return (
    <Elements
      stripe={stripe}
      options={options}
      key={options.clientSecret}
    >
      <CheckoutForm onSuccess={onSuccess} onError={onError} />
    </Elements>
  );
}
