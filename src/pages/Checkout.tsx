import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { CreditCard, Shield, CheckCircle, Loader2, User, MapPin, DollarSign, FileText, Printer, X } from 'lucide-react';
import { RentalTerms } from '../components/RentalTerms';
import { PrintableInvoice } from '../components/PrintableInvoice';
import { createOrderBeforePayment, completeOrderAfterPayment } from '../lib/orderCreation';
import { checkMultipleUnitsAvailability } from '../lib/availability';

export function Checkout() {
  const navigate = useNavigate();
  const { orderId: urlOrderId } = useParams<{ orderId: string }>();
  const [quoteData, setQuoteData] = useState<any>(null);
  const [priceBreakdown, setPriceBreakdown] = useState<any>(null);
  const [cart, setCart] = useState<any[]>([]);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [cardOnFileConsent, setCardOnFileConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [billingSameAsEvent, setBillingSameAsEvent] = useState(true);
  const [paymentAmount, setPaymentAmount] = useState<'deposit' | 'full' | 'custom'>('deposit');
  const [customAmount, setCustomAmount] = useState('');
  const [tipAmount, setTipAmount] = useState('');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const [paymentCheckInterval, setPaymentCheckInterval] = useState<NodeJS.Timeout | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [stripePopupWindow, setStripePopupWindow] = useState<Window | null>(null);

  const [contactData, setContactData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
  });

  const [billingAddress, setBillingAddress] = useState({
    line1: '',
    line2: '',
    city: '',
    state: '',
    zip: '',
  });

  useEffect(() => {
    if (urlOrderId) {
      loadExistingOrder(urlOrderId);
    } else {
      loadNewCheckout();
    }
  }, [navigate, urlOrderId]);

  // Listen for messages from the payment popup window
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      console.log('Received message from popup:', event.data);

      if (event.data?.type === 'PAYMENT_SUCCESS') {
        console.log('Payment success message received from popup!');
        // Trigger immediate payment check
        if (orderId) {
          checkPaymentStatus(orderId);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [orderId]);

  // Helper function to check payment status
  const checkPaymentStatus = async (checkOrderId: string) => {
    console.log('Checking payment status for order:', checkOrderId);

    try {
      // Call edge function to check Stripe directly
      const statusResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-payment-status`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ orderId: checkOrderId }),
        }
      );

      const statusData = await statusResponse.json();
      console.log('Payment status from Stripe check:', statusData);

      // Also check database to get latest order data
      const { data: order } = await supabase
        .from('orders')
        .select('stripe_payment_status, status, id')
        .eq('id', checkOrderId)
        .maybeSingle();

      console.log('Order from DB:', order);

      if (order?.stripe_payment_status === 'paid' || statusData?.status === 'paid') {
        console.log('Payment detected as paid! Closing popup and showing success...');

        // Clear polling interval
        if (paymentCheckInterval) {
          clearInterval(paymentCheckInterval);
          setPaymentCheckInterval(null);
        }

        // Close the Stripe popup if still open
        if (stripePopupWindow && !stripePopupWindow.closed) {
          stripePopupWindow.close();
        }

        // Load order details for success screen
        const { data: fullOrder } = await supabase
          .from('orders')
          .select('*, order_items(*, units(name, category))')
          .eq('id', checkOrderId)
          .maybeSingle();

        if (fullOrder) {
          setQuoteData({
            event_date: fullOrder.event_start_date,
            event_end_date: fullOrder.event_end_date,
            address_line1: fullOrder.event_address_line1,
            address_line2: fullOrder.event_address_line2,
            city: fullOrder.event_city,
            state: fullOrder.event_state,
            zip: fullOrder.event_zip,
          });
          setPriceBreakdown({
            subtotal_cents: fullOrder.subtotal_cents,
            travel_fee_cents: fullOrder.travel_fee_cents,
            same_day_pickup_fee_cents: fullOrder.same_day_pickup_fee_cents,
            generator_fee_cents: fullOrder.generator_fee_cents || 0,
            tax_cents: fullOrder.tax_cents,
            total_cents: fullOrder.total_cents,
            deposit_due_cents: fullOrder.deposit_paid_cents,
            balance_due_cents: fullOrder.balance_due_cents,
          });
          setCart(fullOrder.order_items);
        }

        setAwaitingPayment(false);
        setSuccess(true);
        localStorage.removeItem('bpc_cart');
        localStorage.removeItem('bpc_quote_form');
        localStorage.removeItem('bpc_price_breakdown');

        // Close the popup if it's still open
        if (stripePopupWindow && !stripePopupWindow.closed) {
          stripePopupWindow.close();
        }

        return true; // Payment found
      }
    } catch (error) {
      console.error('Error checking payment status:', error);
    }

    return false; // Payment not found yet
  };

  async function loadExistingOrder(id: string) {
    setCheckingAvailability(true);
    try {
      const { data: order, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (*),
          addresses (*),
          order_items (*, units(*))
        `)
        .eq('id', id)
        .maybeSingle();

      if (error || !order) {
        alert('Order not found');
        navigate('/');
        return;
      }

      if (order.status === 'void') {
        alert('This order has been voided and is no longer valid.');
        window.close();
        return;
      }

      if (order.status !== 'draft') {
        alert('This order has already been processed.');
        window.close();
        return;
      }

      const unitIds = order.order_items.map((item: any) => item.unit_id);
      const { data: availabilityCheck, error: availError } = await supabase.rpc('check_unit_availability', {
        p_unit_ids: unitIds,
        p_start_date: order.start_date || order.event_date,
        p_end_date: order.end_date || order.event_date,
      });

      if (availError) throw availError;

      const allAvailable = availabilityCheck?.every((check: any) => check.is_available) || false;

      if (!allAvailable) {
        await supabase
          .from('orders')
          .update({ status: 'void' })
          .eq('id', id);

        alert('Sorry, one or more items in this order are no longer available. This order has been voided.');
        window.close();
        return;
      }

      setOrderId(id);
      setCart(order.order_items);
      setContactData({
        first_name: order.customers.first_name,
        last_name: order.customers.last_name,
        email: order.customers.email,
        phone: order.customers.phone,
      });

      const formData = {
        event_date: order.event_date,
        start_window: order.start_window,
        end_window: order.end_window,
        address_line1: order.addresses.line1,
        address_line2: order.addresses.line2,
        city: order.addresses.city,
        state: order.addresses.state,
        zip: order.addresses.zip,
        surface: order.surface,
        setup_location: order.setup_location,
        generator_required: order.generator_required,
        has_pets: order.has_pets,
        special_details: order.special_details,
      };

      setQuoteData(formData);
      setPriceBreakdown({
        subtotal_cents: order.subtotal_cents,
        travel_fee_cents: order.travel_fee_cents,
        surface_fee_cents: order.surface_fee_cents,
        same_day_pickup_fee_cents: order.same_day_pickup_fee_cents,
        tax_cents: order.tax_cents,
        total_cents: order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents,
        deposit_due_cents: order.deposit_due_cents,
        balance_due_cents: order.balance_due_cents,
      });

      setBillingAddress({
        line1: order.addresses.line1,
        line2: order.addresses.line2 || '',
        city: order.addresses.city,
        state: order.addresses.state,
        zip: order.addresses.zip,
      });
    } catch (error) {
      console.error('Error loading order:', error);
      alert('Error loading order. Please try again.');
      navigate('/');
    } finally {
      setCheckingAvailability(false);
    }
  }

  async function loadNewCheckout() {
    const savedForm = localStorage.getItem('bpc_quote_form');
    const savedBreakdown = localStorage.getItem('bpc_price_breakdown');
    const savedCart = localStorage.getItem('bpc_cart');

    if (!savedForm || !savedBreakdown || !savedCart) {
      navigate('/quote');
      return;
    }

    const formData = JSON.parse(savedForm);
    const parsedCart = JSON.parse(savedCart);

    // Validate cart unit IDs exist in database (handles migration from old DB)
    if (parsedCart.length > 0) {
      const unitIds = parsedCart.map((item: any) => item.unit_id);
      const { data: validUnits, error } = await supabase
        .from('units')
        .select('id')
        .in('id', unitIds);

      if (error || !validUnits || validUnits.length !== unitIds.length) {
        // Cart contains invalid unit IDs - clear it and redirect
        console.warn('Cart contains invalid unit IDs from old database. Clearing cart.');
        localStorage.removeItem('bpc_cart');
        localStorage.removeItem('bpc_quote_form');
        localStorage.removeItem('bpc_price_breakdown');
        alert('Your cart has been cleared due to a database update. Please add items again.');
        navigate('/catalog');
        return;
      }
    }

    setQuoteData(formData);
    setPriceBreakdown(JSON.parse(savedBreakdown));
    setCart(parsedCart);

    setBillingAddress({
      line1: formData.address_line1 || '',
      line2: formData.address_line2 || '',
      city: formData.city || '',
      state: formData.state || '',
      zip: formData.zip || '',
    });
  }

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (paymentCheckInterval) {
        clearInterval(paymentCheckInterval);
      }
    };
  }, [paymentCheckInterval]);

  const getPaymentAmountCents = () => {
    if (paymentAmount === 'full') {
      return priceBreakdown.total_cents;
    } else if (paymentAmount === 'custom') {
      const customCents = Math.round(parseFloat(customAmount || '0') * 100);
      return Math.max(priceBreakdown.deposit_due_cents, Math.min(customCents, priceBreakdown.total_cents));
    }
    return priceBreakdown.deposit_due_cents;
  };

  const getTipCents = () => {
    return Math.round(parseFloat(tipAmount || '0') * 100);
  };

  const handlePrintInvoice = () => {
    window.print();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!cardOnFileConsent) {
      alert('Please consent to card-on-file authorization.');
      return;
    }

    if (!smsConsent) {
      alert('Please consent to SMS notifications.');
      return;
    }

    const paymentCents = getPaymentAmountCents();
    if (paymentAmount === 'custom' && paymentCents < priceBreakdown.deposit_due_cents) {
      alert(`Minimum payment is ${formatCurrency(priceBreakdown.deposit_due_cents)}`);
      return;
    }

    // Check availability BEFORE showing payment form
    setCheckingAvailability(true);

    try {
      const checks = cart.map(item => ({
        unitId: item.unit_id,
        eventStartDate: quoteData.event_date,
        eventEndDate: quoteData.event_end_date || quoteData.event_date,
      }));

      const results = await checkMultipleUnitsAvailability(checks);

      const unavailableUnits = results.filter(r => !r.isAvailable);
      if (unavailableUnits.length > 0) {
        const unitNames = unavailableUnits
          .map((r) => {
            const cartItem = cart.find(c => c.unit_id === r.unitId);
            return cartItem?.unit_name || 'Unknown Inflatable';
          })
          .join(', ');

        alert(
          `Sorry, these inflatables are no longer available for your selected dates: ${unitNames}\n\nAnother customer may have just booked them. Please go back to the quote page and select different inflatables or dates.`
        );
        setCheckingAvailability(false);
        return;
      }

      // All available - create draft order and show payment form
      const createdOrderId = await createOrderBeforePayment({
        contactData,
        quoteData,
        priceBreakdown,
        cart,
        billingAddress,
        billingSameAsEvent,
        smsConsent,
      });

      // Open Stripe Checkout in new tab and wait for payment
      setCheckingAvailability(false);
      setAwaitingPayment(true);
      setOrderId(createdOrderId);

      // Get the app base URL for Stripe redirects
      const appBaseUrl = window.location.origin;
      console.log('Using app base URL for Stripe redirects:', appBaseUrl);

      // Store env vars in window so the popup can access them
      (window as any).__SUPABASE_URL__ = import.meta.env.VITE_SUPABASE_URL;
      (window as any).__SUPABASE_ANON_KEY__ = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            orderId: createdOrderId,
            depositCents: paymentCents,
            tipCents: getTipCents(),
            customerEmail: contactData.email,
            customerName: `${contactData.first_name} ${contactData.last_name}`,
            appBaseUrl,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Open Stripe in a popup window
      const stripeWindow = window.open(
        data.url,
        'stripe-checkout',
        'width=600,height=800,left=200,top=100'
      );

      setStripePopupWindow(stripeWindow);

      // Poll the payment status by calling our edge function
      console.log('Starting payment polling for order:', createdOrderId);
      const checkInterval = setInterval(async () => {
        console.log('Polling payment status...');

        try {
          // Check if user closed the popup without paying
          if (stripeWindow && stripeWindow.closed) {
            console.log('Popup closed - checking if payment was completed');

            // Do one final check
            const paid = await checkPaymentStatus(createdOrderId);

            if (!paid) {
              console.log('Popup closed without payment');
              clearInterval(checkInterval);
              setPaymentCheckInterval(null);
              setAwaitingPayment(false);
              alert('Payment window was closed. Your order has been saved as a draft. You can contact us to complete the payment.');
            }
          } else {
            // Popup still open, check payment status
            await checkPaymentStatus(createdOrderId);
          }
        } catch (pollError) {
          console.error('Error during polling:', pollError);
        }
      }, 2000); // Check every 2 seconds

      setPaymentCheckInterval(checkInterval);
    } catch (error: any) {
      console.error('Error checking availability or creating order:', error);
      alert(
        `Unable to process booking: ${error.message}\n\nPlease try again or contact us at (313) 889-3860.`
      );
      setCheckingAvailability(false);
      setAwaitingPayment(false);
      if (paymentCheckInterval) {
        clearInterval(paymentCheckInterval);
      }
    }
  };

  if (success) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">
            Payment Successful!
          </h1>
          <p className="text-lg text-slate-600 mb-6">
            Thank you for choosing Bounce Party Club. Your deposit has been paid and your booking is now pending admin review for final confirmation.
          </p>
          <div className="bg-slate-50 rounded-lg p-6 mb-6 text-left">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-600">Order ID:</span>
                <p className="font-mono font-semibold text-slate-900">
                  {orderId?.slice(0, 8).toUpperCase()}
                </p>
              </div>
              <div>
                <span className="text-slate-600">Event Date:</span>
                <p className="font-semibold text-slate-900">{quoteData.event_date}</p>
              </div>
              <div>
                <span className="text-slate-600">Deposit Paid:</span>
                <p className="font-semibold text-green-600">
                  {formatCurrency(priceBreakdown.deposit_due_cents)}
                </p>
              </div>
              <div>
                <span className="text-slate-600">Balance Due:</span>
                <p className="font-semibold text-slate-900">
                  {formatCurrency(priceBreakdown.balance_due_cents)}
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-4 text-sm text-slate-600 mb-8">
            <p>
              A confirmation email has been sent to{' '}
              <span className="font-semibold text-slate-900">{contactData.email}</span>.
            </p>
            <p>
              Our admin team will review your booking request and contact you within 24 hours to confirm your delivery time window and finalize your reservation details.
            </p>
          </div>
          <div className="border-t border-slate-200 pt-6 bg-blue-50 -mx-8 -mb-8 px-8 py-6 rounded-b-xl">
            <h3 className="font-semibold text-blue-900 mb-2">Thank You!</h3>
            <p className="text-blue-800 leading-relaxed mb-2">
              Thank you for choosing Bounce Party Club to bring energy and excitement to your event! We're honored to help make your celebration unforgettable.
            </p>
            <p className="text-blue-800 mb-4">
              If you have any questions, contact us at <strong>(313) 889-3860</strong> or visit us at <strong>4426 Woodward St, Wayne, MI 48184</strong>.
            </p>
            <button
              onClick={() => navigate('/')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (awaitingPayment) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            Waiting for Payment
          </h2>
          <p className="text-slate-600 mb-6 text-lg">
            Please complete your payment in the Stripe checkout window that just opened.
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
            <p className="text-blue-900 font-medium mb-2">
              Don't see the payment window?
            </p>
            <p className="text-blue-800 text-sm">
              Check if your browser blocked the popup, or click below to try again.
            </p>
          </div>
          <div className="flex gap-4 justify-center">
            <button
              onClick={() => {
                if (paymentCheckInterval) {
                  clearInterval(paymentCheckInterval);
                }
                setAwaitingPayment(false);
              }}
              className="px-6 py-3 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel Payment
            </button>
          </div>
          <p className="text-slate-500 text-sm mt-6">
            This page will automatically update once your payment is complete.
          </p>
        </div>
      </div>
    );
  }

  if (checkingAvailability) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-lg text-slate-700">Checking availability...</p>
        </div>
      </div>
    );
  }

  if (!quoteData || !priceBreakdown) {
    return null;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-bold text-slate-900 mb-8">Complete Your Booking</h1>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <RentalTerms />

          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
              <User className="w-6 h-6 mr-2 text-blue-600" />
              Contact Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  First Name *
                </label>
                <input
                  type="text"
                  required
                  value={contactData.first_name}
                  onChange={(e) =>
                    setContactData({ ...contactData, first_name: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Last Name *
                </label>
                <input
                  type="text"
                  required
                  value={contactData.last_name}
                  onChange={(e) =>
                    setContactData({ ...contactData, last_name: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={contactData.email}
                  onChange={(e) =>
                    setContactData({ ...contactData, email: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Phone *
                </label>
                <input
                  type="tel"
                  required
                  value={contactData.phone}
                  onChange={(e) =>
                    setContactData({ ...contactData, phone: e.target.value })
                  }
                  placeholder="(313) 555-0123"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
              <MapPin className="w-6 h-6 mr-2 text-blue-600" />
              Billing Address
            </h2>

            <label className="flex items-center mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={billingSameAsEvent}
                onChange={(e) => {
                  setBillingSameAsEvent(e.target.checked);
                  if (e.target.checked) {
                    setBillingAddress({
                      line1: quoteData.address_line1 || '',
                      line2: quoteData.address_line2 || '',
                      city: quoteData.city || '',
                      state: quoteData.state || '',
                      zip: quoteData.zip || '',
                    });
                  }
                }}
                className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mr-3"
              />
              <span className="text-sm text-slate-700">
                Billing address is the same as event address
              </span>
            </label>

            {!billingSameAsEvent && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Street Address *
                  </label>
                  <input
                    type="text"
                    required
                    value={billingAddress.line1}
                    onChange={(e) =>
                      setBillingAddress({ ...billingAddress, line1: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Apt/Suite (Optional)
                  </label>
                  <input
                    type="text"
                    value={billingAddress.line2}
                    onChange={(e) =>
                      setBillingAddress({ ...billingAddress, line2: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-1">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      City *
                    </label>
                    <input
                      type="text"
                      required
                      value={billingAddress.city}
                      onChange={(e) =>
                        setBillingAddress({ ...billingAddress, city: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      State *
                    </label>
                    <input
                      type="text"
                      required
                      value={billingAddress.state}
                      onChange={(e) =>
                        setBillingAddress({ ...billingAddress, state: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      ZIP *
                    </label>
                    <input
                      type="text"
                      required
                      value={billingAddress.zip}
                      onChange={(e) =>
                        setBillingAddress({ ...billingAddress, zip: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                    />
                  </div>
                </div>
              </div>
            )}

            {billingSameAsEvent && (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-sm text-slate-700">
                  <strong>Event Address:</strong>
                </p>
                <p className="text-sm text-slate-600 mt-1">
                  {quoteData.address_line1}
                  {quoteData.address_line2 && `, ${quoteData.address_line2}`}
                </p>
                <p className="text-sm text-slate-600">
                  {quoteData.city}, {quoteData.state} {quoteData.zip}
                </p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
              <DollarSign className="w-6 h-6 mr-2 text-green-600" />
              Payment Amount
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  paymentAmount === 'deposit' ? 'border-blue-600 bg-blue-50' : 'border-slate-300 hover:border-blue-400'
                }`}>
                  <input
                    type="radio"
                    name="paymentAmount"
                    value="deposit"
                    checked={paymentAmount === 'deposit'}
                    onChange={(e) => setPaymentAmount(e.target.value as any)}
                    className="sr-only"
                  />
                  <span className="font-semibold text-slate-900">Minimum Deposit</span>
                  <span className="text-lg font-bold text-blue-600 mt-1">
                    {formatCurrency(priceBreakdown.deposit_due_cents)}
                  </span>
                  <span className="text-xs text-slate-600 mt-1">Pay balance at event</span>
                </label>

                <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  paymentAmount === 'full' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
                }`}>
                  <input
                    type="radio"
                    name="paymentAmount"
                    value="full"
                    checked={paymentAmount === 'full'}
                    onChange={(e) => setPaymentAmount(e.target.value as any)}
                    className="sr-only"
                  />
                  <span className="font-semibold text-slate-900">Full Payment</span>
                  <span className="text-lg font-bold text-green-600 mt-1">
                    {formatCurrency(priceBreakdown.total_cents)}
                  </span>
                  <span className="text-xs text-slate-600 mt-1">Nothing due at event</span>
                </label>

                <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  paymentAmount === 'custom' ? 'border-purple-600 bg-purple-50' : 'border-slate-300 hover:border-purple-400'
                }`}>
                  <input
                    type="radio"
                    name="paymentAmount"
                    value="custom"
                    checked={paymentAmount === 'custom'}
                    onChange={(e) => setPaymentAmount(e.target.value as any)}
                    className="sr-only"
                  />
                  <span className="font-semibold text-slate-900">Custom Amount</span>
                  <span className="text-sm text-slate-600 mt-1">Choose your amount</span>
                </label>
              </div>

              {paymentAmount === 'custom' && (
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Payment Amount * (Minimum: {formatCurrency(priceBreakdown.deposit_due_cents)})
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-600">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min={(priceBreakdown.deposit_due_cents / 100).toFixed(2)}
                      max={(priceBreakdown.total_cents / 100).toFixed(2)}
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      placeholder={(priceBreakdown.deposit_due_cents / 100).toFixed(2)}
                      className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      required={paymentAmount === 'custom'}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Enter any amount between the minimum deposit and the full total
                  </p>
                </div>
              )}

              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Add a Tip (Optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-600">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={tipAmount}
                    onChange={(e) => setTipAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Show your appreciation for our crew! Tips do not reduce your remaining balance.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900 font-medium mb-1">
                  {paymentAmount === 'deposit' && `Pay ${formatCurrency(priceBreakdown.deposit_due_cents)}${tipAmount ? ` + $${tipAmount} tip` : ''} now, ${formatCurrency(priceBreakdown.balance_due_cents)} at event`}
                  {paymentAmount === 'full' && `Pay ${formatCurrency(priceBreakdown.total_cents)}${tipAmount ? ` + $${tipAmount} tip` : ''} now, nothing at event`}
                  {paymentAmount === 'custom' && customAmount && `Pay $${customAmount}${tipAmount ? ` + $${tipAmount} tip` : ''} now, ${formatCurrency(priceBreakdown.total_cents - Math.round(parseFloat(customAmount) * 100))} at event`}
                  {paymentAmount === 'custom' && !customAmount && 'Enter amount to see payment breakdown'}
                </p>
                <p className="text-xs text-blue-700">
                  All bookings require admin approval before payment is processed
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-4 flex items-center">
              <CreditCard className="w-6 h-6 mr-2 text-blue-600" />
              Secure Payment
            </h2>
            <p className="text-slate-600 mb-6">
              Your payment will be processed securely through Stripe. Payment information will be entered after your order is created.
            </p>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="font-semibold text-green-900 mb-2 flex items-center">
                <Shield className="w-5 h-5 mr-2" />
                Stripe Payment Integration Active
              </h3>
              <p className="text-sm text-green-800">
                Your payment information is processed by Stripe and never stored on our servers. Your card will be securely saved for any post-event charges (damages, late fees, etc.).
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-4 flex items-center">
              <Shield className="w-6 h-6 mr-2 text-green-600" />
              Card-on-File Authorization
            </h2>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-slate-700 leading-relaxed">
                I authorize Bounce Party Club LLC to securely store my payment method and
                charge it for incidentals including damage, excess cleaning, or late fees as
                itemized in a receipt. I understand that any charges will be accompanied by
                photographic evidence and a detailed explanation.
              </p>
            </div>
            <label className="flex items-start cursor-pointer mb-6">
              <input
                type="checkbox"
                checked={cardOnFileConsent}
                onChange={(e) => setCardOnFileConsent(e.target.checked)}
                className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                required
              />
              <span className="ml-3 text-sm text-slate-700">
                I have read and agree to the card-on-file authorization terms above. *
              </span>
            </label>

            <h3 className="font-bold text-slate-900 mb-3 text-lg">SMS Notifications Consent</h3>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-slate-700 leading-relaxed">
                By providing my phone number and checking the box below, I consent to receive
                transactional SMS text messages from Bounce Party Club LLC at the phone number
                provided. These messages may include order confirmations, delivery updates,
                and service-related notifications about my booking. Message frequency varies.
                Message and data rates may apply. You can reply STOP to opt-out at any time.
              </p>
            </div>
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={smsConsent}
                onChange={(e) => setSmsConsent(e.target.checked)}
                className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                required
              />
              <span className="ml-3 text-sm text-slate-700">
                I consent to receive SMS notifications about my booking and agree to the terms above. *
              </span>
            </label>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl shadow-md p-6 sticky top-24">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Order Summary</h2>

            <div className="space-y-4 mb-6">
              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Event Details</h4>
                <p className="text-sm text-slate-600">
                  {quoteData.event_date} at {quoteData.start_window}
                </p>
                <p className="text-sm text-slate-600">
                  {quoteData.address_line1}, {quoteData.city}, {quoteData.state}{' '}
                  {quoteData.zip}
                </p>
                <p className="text-sm text-slate-600 capitalize">
                  {quoteData.location_type}
                </p>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <h4 className="font-semibold text-slate-900 mb-2">Cart Items</h4>
                {cart.map((item: any, index: number) => (
                  <div key={index} className="flex justify-between text-sm mb-2">
                    <span className="text-slate-600">
                      {item.unit_name} ({item.wet_or_dry === 'water' ? 'Water' : 'Dry'})
                    </span>
                    <span className="text-slate-900 font-medium">
                      {formatCurrency(item.unit_price_cents)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Subtotal:</span>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(priceBreakdown.subtotal_cents)}
                  </span>
                </div>
                {priceBreakdown.travel_fee_cents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Travel Fee:</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(priceBreakdown.travel_fee_cents)}
                    </span>
                  </div>
                )}
                {priceBreakdown.surface_fee_cents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Sandbag Fee:</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(priceBreakdown.surface_fee_cents)}
                    </span>
                  </div>
                )}
                {priceBreakdown.same_day_pickup_fee_cents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Same-Day Pickup:</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(priceBreakdown.same_day_pickup_fee_cents)}
                    </span>
                  </div>
                )}
                {priceBreakdown.generator_fee_cents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Generator Rental:</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(priceBreakdown.generator_fee_cents)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Tax (6%):</span>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(priceBreakdown.tax_cents)}
                  </span>
                </div>
                <div className="border-t border-slate-200 pt-2 flex justify-between text-lg font-bold">
                  <span className="text-slate-900">Total:</span>
                  <span className="text-slate-900">
                    {formatCurrency(priceBreakdown.total_cents)}
                  </span>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-semibold text-blue-900">Due Today:</span>
                  <span className="text-lg font-bold text-blue-900">
                    {formatCurrency(priceBreakdown.deposit_due_cents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-blue-700">Due at Event:</span>
                  <span className="text-sm font-semibold text-blue-700">
                    {formatCurrency(priceBreakdown.balance_due_cents)}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowInvoiceModal(true)}
              className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center mb-3"
            >
              <FileText className="w-5 h-5 mr-2" />
              View as Invoice
            </button>

            <button
              type="submit"
              disabled={checkingAvailability || awaitingPayment || !cardOnFileConsent || !smsConsent}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center"
            >
              {checkingAvailability ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Checking Availability...
                </>
              ) : awaitingPayment ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Opening Payment...
                </>
              ) : (
                <>
                  <Shield className="w-5 h-5 mr-2" />
                  Proceed to Payment
                </>
              )}
            </button>

            <p className="text-xs text-slate-500 text-center mt-4">
              Your payment information is secured with industry-standard encryption
            </p>
          </div>
        </div>
      </form>

{showInvoiceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-slate-200 p-4 flex justify-between items-center z-10 no-print">
              <h2 className="text-2xl font-bold text-slate-900">Invoice Preview</h2>
              <div className="flex gap-2">
                <button
                  onClick={handlePrintInvoice}
                  className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  <Printer className="w-4 h-4 mr-2" />
                  Print / Save PDF
                </button>
                <button
                  onClick={() => setShowInvoiceModal(false)}
                  className="flex items-center bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 mr-2" />
                  Close
                </button>
              </div>
            </div>
            <div className="p-4">
              <PrintableInvoice
                quoteData={quoteData}
                priceBreakdown={priceBreakdown}
                cart={cart}
                contactData={contactData}
                invoiceNumber={`QUOTE-${Date.now().toString().slice(-8)}`}
                isPaid={false}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
