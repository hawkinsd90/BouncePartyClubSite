import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '../lib/pricing';
import { RentalTerms } from '../components/waiver/RentalTerms';
import { createOrderBeforePayment } from '../lib/orderCreation';
import { useAuth } from '../contexts/AuthContext';
import { useCheckoutData } from '../hooks/useCheckoutData';
import { getPaymentAmountCents, getTipAmountCents, buildOrderSummary } from '../lib/checkoutUtils';
import { checkMultipleUnitsAvailability } from '../lib/availability';
import { showToast } from '../lib/notifications';
import { ContactInformationForm } from '../components/checkout/ContactInformationForm';
import { BillingAddressForm } from '../components/checkout/BillingAddressForm';
import { PaymentAmountSelector } from '../components/checkout/PaymentAmountSelector';
import { TipSection } from '../components/checkout/TipSection';
import { ConsentSection } from '../components/checkout/ConsentSection';
import { CheckoutSummary } from '../components/checkout/CheckoutSummary';
import { createLogger } from '../lib/logger';

const log = createLogger('Checkout');

export function Checkout() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const {
    quoteData,
    priceBreakdown,
    cart,
    contactData,
    setContactData,
    billingAddress,
    setBillingAddress,
    smsConsent,
    setSmsConsent,
    cardOnFileConsent,
    setCardOnFileConsent,
    tipAmount,
    setTipAmount,
    customTip,
    setCustomTip,
    loading,
  } = useCheckoutData(user?.id);

  const [processing, setProcessing] = useState(false);
  const [billingSameAsEvent, setBillingSameAsEvent] = useState(true);
  const [paymentAmount, setPaymentAmount] = useState<'deposit' | 'full' | 'custom'>('deposit');
  const [customAmount, setCustomAmount] = useState('');

  const handleViewInvoice = () => {
    // Store the invoice data in sessionStorage for the new tab to read
    const invoiceData = {
      quoteData,
      priceBreakdown,
      cart,
      contactData,
    };
    sessionStorage.setItem('invoice-preview-data', JSON.stringify(invoiceData));

    // Store where to return when user clicks Back
    const returnTo = window.location.pathname + window.location.search + window.location.hash;
    sessionStorage.setItem('invoice-preview-return-to', returnTo);

    // Same tab navigation (no new tab)
    navigate('/invoice-preview');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!cardOnFileConsent) {
      showToast('Please consent to card-on-file authorization', 'error');
      return;
    }

    if (!smsConsent) {
      showToast('Please consent to SMS notifications', 'error');
      return;
    }

    const paymentCents = getPaymentAmountCents(paymentAmount, customAmount, priceBreakdown);
    if (paymentAmount === 'custom' && paymentCents < priceBreakdown.deposit_due_cents) {
      showToast(`Minimum payment is ${formatCurrency(priceBreakdown.deposit_due_cents)}`, 'error');
      return;
    }

    setProcessing(true);

    try {
      // Re-check availability before creating order (prevent race conditions)
      const availabilityChecks = cart.map(item => ({
        unitId: item.unit_id,
        eventStartDate: quoteData.event_date,
        eventEndDate: quoteData.event_end_date,
      }));

      const availabilityResults = await checkMultipleUnitsAvailability(availabilityChecks);
      const unavailableUnits = availabilityResults.filter(result => !result.isAvailable);

      if (unavailableUnits.length > 0) {
        const unitNames = unavailableUnits.map(u => {
          const cartItem = cart.find(item => item.unit_id === u.unitId);
          return cartItem?.unit_name || 'Unknown unit';
        }).join(', ');

        showToast(
          `Sorry, the following units are no longer available for your selected dates: ${unitNames}. Please return to the quote page and select different units or dates.`,
          'error'
        );
        setProcessing(false);
        return;
      }

      const orderId = await createOrderBeforePayment({
        contactData,
        quoteData,
        priceBreakdown,
        cart,
        billingAddress,
        billingSameAsEvent,
        smsConsent,
        cardOnFileConsent,
      });

      const depositCents = getPaymentAmountCents(paymentAmount, customAmount, priceBreakdown);

      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              orderId,
              depositCents,
              tipCents: getTipAmountCents(tipAmount, customTip, priceBreakdown.total_cents),
              customerEmail: contactData.email,
              customerName: `${contactData.first_name} ${contactData.last_name}`,
              origin: window.location.origin,
            }),
          }
        );

        const data = await response.json();

        log.debug('Stripe session response', data);
        log.debug('Success URL from server', data.successUrl);

        if (!response.ok || !data.url) {
          throw new Error(data.error || 'Failed to create checkout session');
        }

        log.info('Opening Stripe checkout', { url: data.url });

        window.location.href = data.url;
      } catch (err: any) {
        log.error('Stripe checkout error', err);
        showToast(err.message || 'Failed to initialize payment', 'error');
        setProcessing(false);
      }

      return;
    } catch (error: any) {
      console.error('Error creating order:', error);
      const errorMessage = error?.message || 'Unknown error';
      showToast(
        `There was an error processing your order: ${errorMessage}. Please try again or contact us for assistance.`,
        'error'
      );
      setProcessing(false);
    }
  };

  if (loading || !quoteData || !priceBreakdown) {
    if (!loading && (!quoteData || !priceBreakdown)) {
      navigate('/quote');
      return null;
    }
    return null;
  }

  const tipCents = getTipAmountCents(tipAmount, customTip, priceBreakdown.total_cents);
  const orderSummary = buildOrderSummary(priceBreakdown, cart, quoteData, tipCents);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 lg:py-16">
        <div className="mb-10 sm:mb-12">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 mb-3 sm:mb-4 tracking-tight">
            Complete Your Booking
          </h1>
          <p className="text-slate-600 text-base sm:text-lg lg:text-xl leading-relaxed max-w-2xl">
            Review your order details and complete payment to secure your rental
          </p>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-10">
          <div className="lg:col-span-2 space-y-8">
            <RentalTerms />

            <ContactInformationForm contactData={contactData} onChange={setContactData} />

            <BillingAddressForm
              billingAddress={billingAddress}
              billingSameAsEvent={billingSameAsEvent}
              quoteData={quoteData}
              onBillingAddressChange={setBillingAddress}
              onBillingSameAsEventChange={setBillingSameAsEvent}
            />

            <PaymentAmountSelector
              paymentAmount={paymentAmount}
              customAmount={customAmount}
              priceBreakdown={priceBreakdown}
              onPaymentAmountChange={setPaymentAmount}
              onCustomAmountChange={setCustomAmount}
            />

            <TipSection
              tipAmount={tipAmount}
              customTip={customTip}
              totalCents={priceBreakdown.total_cents}
              tipCents={tipCents}
              onTipAmountChange={setTipAmount}
              onCustomTipChange={setCustomTip}
            />

            <ConsentSection
              cardOnFileConsent={cardOnFileConsent}
              smsConsent={smsConsent}
              onCardOnFileConsentChange={setCardOnFileConsent}
              onSmsConsentChange={setSmsConsent}
            />
          </div>

          <div className="lg:col-span-1">
            <CheckoutSummary
              quoteData={quoteData}
              orderSummary={orderSummary}
              processing={processing}
              cardOnFileConsent={cardOnFileConsent}
              smsConsent={smsConsent}
              tipCents={tipCents}
              onViewInvoice={handleViewInvoice}
            />
          </div>
        </form>
      </div>
    </div>
  );
}
