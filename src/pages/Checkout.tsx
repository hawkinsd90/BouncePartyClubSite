import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { CreditCard, Shield, CheckCircle, Loader2, User, MapPin, DollarSign, FileText, Printer, X } from 'lucide-react';
import { RentalTerms } from '../components/RentalTerms';
import { PrintableInvoice } from '../components/PrintableInvoice';

export function Checkout() {
  const navigate = useNavigate();
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
  const [tipAmount, setTipAmount] = useState<'none' | '10' | '15' | '20' | 'custom'>('none');
  const [customTip, setCustomTip] = useState('');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [tempOrderId, setTempOrderId] = useState<string | null>(null);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

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
    const savedForm = localStorage.getItem('bpc_quote_form');
    const savedBreakdown = localStorage.getItem('bpc_price_breakdown');
    const savedCart = localStorage.getItem('bpc_cart');

    if (!savedForm || !savedBreakdown || !savedCart) {
      navigate('/quote');
      return;
    }

    const formData = JSON.parse(savedForm);
    setQuoteData(formData);
    setPriceBreakdown(JSON.parse(savedBreakdown));
    setCart(JSON.parse(savedCart));

    setBillingAddress({
      line1: formData.address_line1 || '',
      line2: formData.address_line2 || '',
      city: formData.city || '',
      state: formData.state || '',
      zip: formData.zip || '',
    });
  }, [navigate]);

  const getPaymentAmountCents = () => {
    if (paymentAmount === 'full') {
      return priceBreakdown.total_cents;
    } else if (paymentAmount === 'custom') {
      const customCents = Math.round(parseFloat(customAmount || '0') * 100);
      return Math.max(priceBreakdown.deposit_due_cents, Math.min(customCents, priceBreakdown.total_cents));
    }
    return priceBreakdown.deposit_due_cents;
  };

  const getTipAmountCents = () => {
    if (tipAmount === 'none') return 0;
    if (tipAmount === 'custom') {
      return Math.round(parseFloat(customTip || '0') * 100);
    }
    const percentage = parseInt(tipAmount);
    return Math.round((priceBreakdown.total_cents * percentage) / 100);
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

    setProcessing(true);

    try {
      let customer;

      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('*')
        .eq('email', contactData.email)
        .maybeSingle();

      if (existingCustomer) {
        const { data: updatedCustomer, error: updateError } = await supabase
          .from('customers')
          .update({
            first_name: contactData.first_name,
            last_name: contactData.last_name,
            phone: contactData.phone,
          })
          .eq('id', existingCustomer.id)
          .select()
          .single();

        if (updateError) throw updateError;
        customer = updatedCustomer;
      } else {
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert({
            first_name: contactData.first_name,
            last_name: contactData.last_name,
            email: contactData.email,
            phone: contactData.phone,
          })
          .select()
          .single();

        if (customerError) throw customerError;
        customer = newCustomer;
      }

      const eventAddressData = billingSameAsEvent ? billingAddress : {
        line1: quoteData.address_line1,
        line2: quoteData.address_line2 || null,
        city: quoteData.city,
        state: quoteData.state,
        zip: quoteData.zip,
      };

      const { data: address, error: addressError } = await supabase
        .from('addresses')
        .insert({
          customer_id: customer.id,
          ...eventAddressData,
        })
        .select()
        .single();

      if (addressError) throw addressError;

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          customer_id: customer.id,
          status: 'draft',
          location_type: quoteData.location_type,
          surface: quoteData.can_stake ? 'grass' : 'cement',
          event_date: quoteData.event_date,
          start_date: quoteData.event_date,
          end_date: quoteData.event_end_date || quoteData.event_date,
          start_window: quoteData.start_window,
          end_window: quoteData.end_window,
          overnight_allowed: quoteData.pickup_preference === 'next_day',
          can_use_stakes: quoteData.can_stake,
          generator_selected: quoteData.has_generator,
          has_pets: quoteData.has_pets || false,
          address_id: address.id,
          subtotal_cents: priceBreakdown.subtotal_cents,
          travel_fee_cents: priceBreakdown.travel_fee_cents,
          travel_total_miles: priceBreakdown.travel_total_miles,
          travel_base_radius_miles: priceBreakdown.travel_base_radius_miles,
          travel_chargeable_miles: priceBreakdown.travel_chargeable_miles,
          travel_per_mile_cents: priceBreakdown.travel_per_mile_cents,
          travel_is_flat_fee: priceBreakdown.travel_is_flat_fee,
          surface_fee_cents: priceBreakdown.surface_fee_cents,
          same_day_pickup_fee_cents: priceBreakdown.same_day_pickup_fee_cents || 0,
          tax_cents: priceBreakdown.tax_cents,
          deposit_due_cents: priceBreakdown.deposit_due_cents,
          deposit_paid_cents: 0,
          balance_due_cents: priceBreakdown.balance_due_cents,
          payment_method_id: 'stripe_pm_mock_' + Date.now(),
          card_on_file_consent_text:
            'I authorize Bounce Party Club LLC to securely store my payment method and charge it for incidentals including damage, excess cleaning, or late fees as itemized in a receipt.',
          card_on_file_consented_at: new Date().toISOString(),
          sms_consent_text:
            'I consent to receive transactional SMS messages from Bounce Party Club LLC regarding my booking, including order confirmations, delivery updates, and service notifications. Message frequency varies. Message and data rates may apply. Reply STOP to opt-out.',
          sms_consented_at: new Date().toISOString(),
          special_details: quoteData.special_details || null,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      for (const item of cart) {
        const { error: itemError } = await supabase.from('order_items').insert({
          order_id: order.id,
          unit_id: item.unit_id,
          wet_or_dry: item.wet_or_dry,
          unit_price_cents: item.unit_price_cents,
          qty: item.qty || 1,
        });

        if (itemError) throw itemError;
      }

      setTempOrderId(order.id);
      setProcessing(false);
      setAwaitingPayment(true);

      const appBaseUrl = window.location.origin;
      const depositCents = getPaymentAmountCents();

      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              orderId: order.id,
              depositCents,
              tipCents: getTipAmountCents(),
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

        window.location.replace(data.url);
      } catch (err: any) {
        console.error('Stripe checkout error:', err);
        setPaymentError(err.message || 'Failed to initialize payment');
        setAwaitingPayment(false);
      }

      return;
    } catch (error: any) {
      console.error('Error creating order:', error);
      const errorMessage = error?.message || 'Unknown error';
      alert(`There was an error processing your order: ${errorMessage}\n\nPlease try again or contact us at (313) 889-3860 for assistance.`);
      setProcessing(false);
    }
  };

  const handlePaymentSuccess = async () => {
    if (!tempOrderId) return;

    try {
      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: 'pending_review' })
        .eq('id', tempOrderId);

      if (updateError) throw updateError;

      const { error: routeDropoffError } = await supabase.from('route_stops').insert({
        order_id: tempOrderId,
        type: 'dropoff',
        checkpoint: 'none',
      });

      if (routeDropoffError) throw routeDropoffError;

      const { error: routePickupError } = await supabase.from('route_stops').insert({
        order_id: tempOrderId,
        type: 'pickup',
        checkpoint: 'none',
      });

      if (routePickupError) throw routePickupError;

      const { error: messageError } = await supabase.from('messages').insert({
        order_id: tempOrderId,
        to_email: contactData.email,
        channel: 'email',
        template_key: 'deposit_receipt',
        payload_json: {
          name: `${contactData.first_name} ${contactData.last_name}`,
          units: cart.map((item) => item.unit_name).join(', '),
          event_date: quoteData.event_date,
          balance: formatCurrency(priceBreakdown.balance_due_cents),
        },
        status: 'pending',
      });

      if (messageError) throw messageError;

      try {
        await supabase.from('contacts').upsert({
          customer_id: contactData.email,
          first_name: contactData.first_name,
          last_name: contactData.last_name,
          email: contactData.email,
          phone: contactData.phone,
          source: 'booking',
          opt_in_email: true,
          opt_in_sms: true,
        }, {
          onConflict: 'email',
        });
      } catch (contactError) {
        console.error('Error adding to contacts:', contactError);
      }

      try {
        const { data: adminSettings } = await supabase
          .from('admin_settings')
          .select('value')
          .eq('key', 'admin_notification_phone')
          .maybeSingle();

        if (adminSettings?.value) {
          const smsMessage = `🎈 NEW BOOKING! ${contactData.first_name} ${contactData.last_name} for ${quoteData.event_date}. Review at: https://yourdomain.com/admin Order #${tempOrderId.slice(0, 8)}`;

          const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
          await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: adminSettings.value,
              message: smsMessage,
              orderId: tempOrderId,
            }),
          });
        }
      } catch (smsError) {
        console.error('Error sending SMS notification:', smsError);
      }

      localStorage.removeItem('bpc_cart');
      localStorage.removeItem('bpc_quote_form');
      localStorage.removeItem('bpc_price_breakdown');

      setOrderId(tempOrderId);
      setSuccess(true);
    } catch (error: any) {
      console.error('Error finalizing order:', error);
      alert('Payment succeeded but there was an error finalizing your order. Please contact us.');
    }
  };

  const handlePaymentError = (error: string) => {
    alert(`Payment failed: ${error}\n\nPlease try again or contact us at (313) 889-3860 for assistance.`);
  };

  if (!quoteData || !priceBreakdown) {
    return null;
  }

  if (awaitingPayment) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">
            Redirecting to Payment
          </h1>
          <p className="text-lg text-slate-600 mb-6">
            Please wait while we redirect you to our secure payment processor...
          </p>
          {paymentError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-red-800 font-semibold mb-2">Payment Error</p>
              <p className="text-red-700 text-sm">{paymentError}</p>
              <button
                onClick={() => {
                  setAwaitingPayment(false);
                  setPaymentError(null);
                }}
                className="mt-4 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                Go Back
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">
            Booking Submitted!
          </h1>
          <p className="text-lg text-slate-600 mb-6">
            Thank you for choosing Bounce Party Club. Your booking request has been submitted and is pending admin review. Payment will be processed once approved.
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
              Our admin team will review your booking request and contact you within 24 hours to confirm availability and process payment. Once approved, you'll receive a confirmation with your delivery time window.
            </p>
          </div>
          <div className="border-t border-slate-200 pt-6 bg-blue-50 -mx-8 -mb-8 px-8 py-6 rounded-b-xl">
            <h3 className="font-semibold text-blue-900 mb-2">Thank You!</h3>
            <p className="text-blue-800 leading-relaxed mb-2">
              Thank you for choosing Bounce Party Club to bring energy and excitement to your event! We're honored to help make your celebration unforgettable.
            </p>
            <p className="text-blue-800">
              If you have any questions, contact us at <strong>(313) 889-3860</strong> or visit us at <strong>4426 Woodward St, Wayne, MI 48184</strong>.
            </p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
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

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900 font-medium mb-1">
                  {paymentAmount === 'deposit' && `Pay ${formatCurrency(priceBreakdown.deposit_due_cents)} now, ${formatCurrency(priceBreakdown.balance_due_cents)} at event`}
                  {paymentAmount === 'full' && `Pay ${formatCurrency(priceBreakdown.total_cents)} now, nothing at event`}
                  {paymentAmount === 'custom' && customAmount && `Pay $${customAmount} now, ${formatCurrency(priceBreakdown.total_cents - Math.round(parseFloat(customAmount) * 100))} at event`}
                  {paymentAmount === 'custom' && !customAmount && 'Enter amount to see payment breakdown'}
                </p>
                <p className="text-xs text-blue-700">
                  All bookings require admin approval before payment is processed
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
              <DollarSign className="w-6 h-6 mr-2 text-green-600" />
              Add Tip for Crew
            </h2>
            <p className="text-slate-600 mb-4 text-sm">
              Show your appreciation for our crew! Tips are optional but greatly appreciated.
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  tipAmount === 'none' ? 'border-slate-600 bg-slate-50' : 'border-slate-300 hover:border-slate-400'
                }`}>
                  <input
                    type="radio"
                    name="tipAmount"
                    value="none"
                    checked={tipAmount === 'none'}
                    onChange={(e) => setTipAmount(e.target.value as any)}
                    className="sr-only"
                  />
                  <span className="font-semibold text-slate-900">No Tip</span>
                  <span className="text-sm text-slate-600 mt-1">$0.00</span>
                </label>

                <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  tipAmount === '10' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
                }`}>
                  <input
                    type="radio"
                    name="tipAmount"
                    value="10"
                    checked={tipAmount === '10'}
                    onChange={(e) => setTipAmount(e.target.value as any)}
                    className="sr-only"
                  />
                  <span className="font-semibold text-slate-900">10%</span>
                  <span className="text-sm text-green-600 mt-1">
                    {formatCurrency(Math.round(priceBreakdown.total_cents * 0.1))}
                  </span>
                </label>

                <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  tipAmount === '15' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
                }`}>
                  <input
                    type="radio"
                    name="tipAmount"
                    value="15"
                    checked={tipAmount === '15'}
                    onChange={(e) => setTipAmount(e.target.value as any)}
                    className="sr-only"
                  />
                  <span className="font-semibold text-slate-900">15%</span>
                  <span className="text-sm text-green-600 mt-1">
                    {formatCurrency(Math.round(priceBreakdown.total_cents * 0.15))}
                  </span>
                </label>

                <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  tipAmount === '20' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
                }`}>
                  <input
                    type="radio"
                    name="tipAmount"
                    value="20"
                    checked={tipAmount === '20'}
                    onChange={(e) => setTipAmount(e.target.value as any)}
                    className="sr-only"
                  />
                  <span className="font-semibold text-slate-900">20%</span>
                  <span className="text-sm text-green-600 mt-1">
                    {formatCurrency(Math.round(priceBreakdown.total_cents * 0.2))}
                  </span>
                </label>
              </div>

              <label className={`relative flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
                tipAmount === 'custom' ? 'border-purple-600 bg-purple-50' : 'border-slate-300 hover:border-purple-400'
              }`}>
                <input
                  type="radio"
                  name="tipAmount"
                  value="custom"
                  checked={tipAmount === 'custom'}
                  onChange={(e) => setTipAmount(e.target.value as any)}
                  className="sr-only"
                />
                <span className="font-semibold text-slate-900 flex-grow">Custom Amount</span>
                {tipAmount === 'custom' && (
                  <div className="relative ml-4">
                    <span className="absolute left-3 top-2 text-slate-600">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={customTip}
                      onChange={(e) => setCustomTip(e.target.value)}
                      placeholder="0.00"
                      className="w-32 pl-8 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                )}
              </label>

              {getTipAmountCents() > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-sm text-green-900">
                    Thank you for tipping {formatCurrency(getTipAmountCents())}! Your crew will greatly appreciate it.
                  </p>
                </div>
              )}
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
              disabled={processing || !cardOnFileConsent || !smsConsent}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center"
            >
              {processing ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Shield className="w-5 h-5 mr-2" />
                  Complete Booking
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
