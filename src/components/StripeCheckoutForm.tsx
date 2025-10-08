import { useState, useEffect, useRef } from 'react';
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
  const [canRender, setCanRender] = useState(false);
  const mountTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const now = Date.now();
    mountTimeRef.current = now;
    console.log('[CheckoutForm] Component mounted at', now, ', stripe:', !!stripe, 'elements:', !!elements);

    if (stripe && elements) {
      console.log('[CheckoutForm] Stripe and Elements available, rendering PaymentElement');
      setCanRender(true);
    } else {
      console.log('[CheckoutForm] Waiting for Stripe (', !!stripe, ') and Elements (', !!elements, ')');
      setCanRender(false);
    }

    return () => {
      console.log('[CheckoutForm] Component unmounting (was mounted at', now, ')');
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [stripe, elements]);

  const handleLoaderStart = () => {
    const timeSinceMount = Date.now() - mountTimeRef.current;
    console.log('[CheckoutForm] ⟳ PaymentElement loader started (', timeSinceMount, 'ms since mount)');
    console.log('[CheckoutForm] Current stripe:', !!stripe, 'elements:', !!elements, 'canRender:', canRender);
  };

  const handleReady = () => {
    const timeSinceMount = Date.now() - mountTimeRef.current;
    console.log('[CheckoutForm] ✓ PaymentElement is ready and can accept input (', timeSinceMount, 'ms since mount)');
    console.log('[CheckoutForm] Setting isReady to true');
    setIsReady(true);
  };

  const handleLoadError = (event: any) => {
    const timeSinceMount = Date.now() - mountTimeRef.current;
    console.error('[CheckoutForm] ✗ PaymentElement loader error after', timeSinceMount, 'ms:', event);
    console.error('[CheckoutForm] Error details:', JSON.stringify(event, null, 2));
    console.error('[CheckoutForm] Error elementType:', event?.elementType);
    console.error('[CheckoutForm] Current state - mountTime:', mountTimeRef.current, 'canRender:', canRender, 'stripe:', !!stripe, 'elements:', !!elements);
    onError('Failed to load payment form. Please refresh and try again.');
  };

  const handleChange = (event: any) => {
    console.log('[CheckoutForm] PaymentElement changed:', event.elementType, 'complete:', event.complete);
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

  if (!stripe || !elements || !canRender) {
    console.log('[CheckoutForm] Waiting - stripe:', !!stripe, 'elements:', !!elements, 'canRender:', canRender, 'mountTime:', mountTimeRef.current);
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-slate-600">Loading payment form...</span>
      </div>
    );
  }

  console.log('[CheckoutForm] >>> Rendering PaymentElement now. isReady:', isReady, 'canRender:', canRender, 'mountTime:', mountTimeRef.current);

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-6">
        <PaymentElement
          onLoaderStart={handleLoaderStart}
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
  const [readyToRender, setReadyToRender] = useState(false);
  const mountCountRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    mountCountRef.current += 1;
    const currentMount = mountCountRef.current;
    console.log('[StripeCheckoutForm] Mount #', currentMount, '- Component mounting');

    const initialize = async () => {
      console.log('[StripeCheckoutForm] Mount #', currentMount, '- Starting initialization');
      setLoading(true);
      setOptions(null);
      setInitError(null);
      setReadyToRender(false);

      try {
        console.log('[StripeCheckoutForm] Mount #', currentMount, '- Creating payment intent for order:', orderId);

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

        if (!mounted || currentMount !== mountCountRef.current) {
          console.log('[StripeCheckoutForm] Mount #', currentMount, '- Ignoring response (unmounted or stale)');
          return;
        }

        if (!paymentResponse.ok) {
          const errorData = await paymentResponse.json();
          throw new Error(errorData.error || 'Failed to create payment intent');
        }

        const data = await paymentResponse.json();
        console.log('[StripeCheckoutForm] Payment intent created, clientSecret:', !!data.clientSecret);

        if (!data.clientSecret) {
          throw new Error('No client secret returned from server');
        }

        if (mounted && currentMount === mountCountRef.current) {
          console.log('[StripeCheckoutForm] Mount #', currentMount, '- Setting options with clientSecret');
          setOptions({
            clientSecret: data.clientSecret,
          });

          console.log('[StripeCheckoutForm] Mount #', currentMount, '- Ready to render Stripe components');
          setReadyToRender(true);
        }
      } catch (err: any) {
        console.error('[StripeCheckoutForm] Mount #', currentMount, '- Payment initialization error:', err);
        if (mounted && currentMount === mountCountRef.current) {
          setInitError(err.message || 'Failed to initialize payment');
        }
      } finally {
        if (mounted && currentMount === mountCountRef.current) {
          setLoading(false);
        }
      }
    };

    initialize();

    return () => {
      console.log('[StripeCheckoutForm] Mount #', currentMount, '- Cleanup, unmounting');
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

  if (!readyToRender || !options) {
    if (!loading) {
      console.log('[StripeCheckoutForm] Waiting to render - options:', !!options, 'readyToRender:', readyToRender, 'initError:', !!initError, 'currentMount:', mountCountRef.current);
    }

    if (initError) {
      return (
        <div className="text-center py-8">
          <p className="text-red-600 mb-4">{initError}</p>
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
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-slate-600">Preparing payment...</span>
      </div>
    );
  }

  console.log('[StripeCheckoutForm] Mount #', mountCountRef.current, '- Rendering StripeElementsWrapper with clientSecret');
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
  const mountCountRef = useRef(0);
  const initializationTimeRef = useRef<number>(0);

  useEffect(() => {
    let mounted = true;
    mountCountRef.current += 1;
    const currentMount = mountCountRef.current;
    console.log('[StripeElementsWrapper] Starting Stripe initialization (mount #', currentMount, ')...');

    getStripeInstance()
      .then((stripeInstance) => {
        if (!mounted) {
          console.log('[StripeElementsWrapper] Mount #', currentMount, '- Component unmounted, ignoring Stripe instance');
          return;
        }
        if (currentMount !== mountCountRef.current) {
          console.log('[StripeElementsWrapper] Mount #', currentMount, '- Stale mount (now at', mountCountRef.current, '), ignoring');
          return;
        }
        if (stripeInstance) {
          console.log('[StripeElementsWrapper] Mount #', currentMount, '- Stripe instance loaded successfully');
          setStripe(stripeInstance);
          setInitialized(true);
          console.log('[StripeElementsWrapper] Mount #', currentMount, '- Marked as initialized');
        } else {
          console.error('[StripeElementsWrapper] Mount #', currentMount, '- Stripe instance is null');
          setError('Failed to load Stripe');
        }
      })
      .catch((err) => {
        if (!mounted || currentMount !== mountCountRef.current) return;
        console.error('[StripeElementsWrapper] Mount #', currentMount, '- Error loading Stripe:', err);
        setError(err.message || 'Failed to load Stripe');
      });

    return () => {
      console.log('[StripeElementsWrapper] Mount #', currentMount, '- Cleanup, component unmounting');
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
