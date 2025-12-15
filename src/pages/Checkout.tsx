import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '../lib/pricing';
import { RentalTerms } from '../components/RentalTerms';
import { createOrderBeforePayment } from '../lib/orderCreation';
import { useAuth } from '../contexts/AuthContext';
import { useCheckoutData } from '../hooks/useCheckoutData';
import { getPaymentAmountCents, getTipAmountCents, buildOrderSummary } from '../lib/checkoutUtils';
import { ContactInformationForm } from '../components/checkout/ContactInformationForm';
import { BillingAddressForm } from '../components/checkout/BillingAddressForm';
import { PaymentAmountSelector } from '../components/checkout/PaymentAmountSelector';
import { TipSection } from '../components/checkout/TipSection';
import { ConsentSection } from '../components/checkout/ConsentSection';
import { CheckoutSummary } from '../components/checkout/CheckoutSummary';
import { InvoicePreviewModal } from '../components/checkout/InvoicePreviewModal';

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
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);


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

    const paymentCents = getPaymentAmountCents(paymentAmount, customAmount, priceBreakdown);
    if (paymentAmount === 'custom' && paymentCents < priceBreakdown.deposit_due_cents) {
      alert(`Minimum payment is ${formatCurrency(priceBreakdown.deposit_due_cents)}`);
      return;
    }

    setProcessing(true);

    try {
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

        console.log('🔵 [CHECKOUT] Stripe session response:', data);
        console.log('🔵 [CHECKOUT] Success URL from server:', data.successUrl);

        if (!response.ok || !data.url) {
          throw new Error(data.error || 'Failed to create checkout session');
        }

        console.log('🔵 [CHECKOUT] Opening Stripe with URL:', data.url);

        window.location.href = data.url;
      } catch (err: any) {
        console.error('Stripe checkout error:', err);
        alert(err.message || 'Failed to initialize payment');
        setProcessing(false);
      }

      return;
    } catch (error: any) {
      console.error('Error creating order:', error);
      const errorMessage = error?.message || 'Unknown error';
      alert(
        `There was an error processing your order: ${errorMessage}\n\nPlease try again or contact us at (313) 889-3860 for assistance.`
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-bold text-slate-900 mb-8">Complete Your Booking</h1>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
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
            onViewInvoice={() => setShowInvoiceModal(true)}
          />
        </div>
      </form>

      {showInvoiceModal && (
        <InvoicePreviewModal
          quoteData={quoteData}
          priceBreakdown={priceBreakdown}
          cart={cart}
          contactData={contactData}
          onClose={() => setShowInvoiceModal(false)}
        />
      )}
    </div>
  );
}
