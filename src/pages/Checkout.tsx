import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { formatCurrency } from '../lib/pricing';
import { RentalTerms } from '../components/waiver/RentalTerms';
import { createOrderBeforePayment } from '../lib/orderCreation';
import { useAuth } from '../contexts/AuthContext';
import { useCheckoutData } from '../hooks/useCheckoutData';
import { getPaymentAmountCentsFromTotals, getTipAmountCents, buildOrderSummary } from '../lib/checkoutUtils';
import { checkMultipleUnitsAvailability } from '../lib/availability';
import { showToast } from '../lib/notifications';
import { composeUnifiedQuoteTotals } from '../lib/unifiedTotals';
import { validateCartPackageSnapshots } from '../lib/packageDisplay';
import type { EEOnlyDepositSettings } from '../lib/depositCalculation';
import { supabase } from '../lib/supabase';
import { ContactInformationForm } from '../components/checkout/ContactInformationForm';
import { BillingAddressForm } from '../components/checkout/BillingAddressForm';
import { PaymentAmountSelector } from '../components/checkout/PaymentAmountSelector';
import { TipSection } from '../components/checkout/TipSection';
import { ConsentSection } from '../components/checkout/ConsentSection';
import { CheckoutSummary } from '../components/checkout/CheckoutSummary';
import { ReferralSourceSelect } from '../components/shared/ReferralSourceSelect';
import { createLogger } from '../lib/logger';
import { trackEvent } from '../lib/siteEvents';

const log = createLogger('Checkout');

export function Checkout() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    trackEvent('checkout_started');
  }, []);

  const {
    quoteData,
    priceBreakdown,
    cart,
    inflatableCart,
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
    referralSource,
    setReferralSource,
    referralSourceDetail,
    setReferralSourceDetail,
    loading,
  } = useCheckoutData(user?.id);

  const [processing, setProcessing] = useState(false);
  const [referralError, setReferralError] = useState('');
  const [billingSameAsEvent, setBillingSameAsEvent] = useState(true);
  const [paymentAmount, setPaymentAmount] = useState<'deposit' | 'full' | 'custom'>('deposit');
  const [customAmount, setCustomAmount] = useState('');
  const [eeOnlyDepositSettings, setEeOnlyDepositSettings] = useState<EEOnlyDepositSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setSettingsLoading(true);
      setSettingsError(null);
      try {
        const { data, error } = await supabase
          .from('pricing_rules')
          .select('ee_only_deposit_base_threshold_cents, ee_only_deposit_base_cents, ee_only_deposit_subtotal_step_cents, ee_only_deposit_step_cents, deposit_per_unit_cents')
          .limit(1)
          .maybeSingle();
        if (error) {
          setSettingsError(error.message);
          return;
        }
        if (!data) {
          setSettingsError('No pricing configuration found.');
          return;
        }
        setEeOnlyDepositSettings({
          eeOnlyDepositBaseThresholdCents: data.ee_only_deposit_base_threshold_cents ?? 20000,
          eeOnlyDepositBaseCents: data.ee_only_deposit_base_cents ?? 5000,
          eeOnlyDepositSubtotalStepCents: data.ee_only_deposit_subtotal_step_cents ?? 10000,
          eeOnlyDepositStepCents: data.ee_only_deposit_step_cents ?? 5000,
        });
      } catch (err: any) {
        setSettingsError(err?.message || 'Failed to load pricing configuration.');
      } finally {
        setSettingsLoading(false);
      }
    })();
  }, []);

  void cart; // cart used in unifiedTotals computation below

  // Compute unified totals using the inflatable breakdown's tax_applied setting
  const unifiedTotals = priceBreakdown && eeOnlyDepositSettings
    ? composeUnifiedQuoteTotals({
        inflatableBreakdown: priceBreakdown,
        cart,
        taxApplied: priceBreakdown.tax_applied ?? true,
        eeOnlyDepositSettings,
        inflatableDepositPerUnitCents: priceBreakdown.deposit_due_cents > 0
          ? Math.round(priceBreakdown.deposit_due_cents / Math.max(1, inflatableCart.reduce((s, i) => s + i.qty, 0)))
          : 5000,
      })
    : null;

  const handleViewInvoice = () => {
    const invoiceData = {
      quoteData,
      priceBreakdown,
      cart,
      contactData,
    };
    sessionStorage.setItem('invoice-preview-data', JSON.stringify(invoiceData));
    window.open('/invoice-preview', '_blank');
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

    if (!referralSource) {
      setReferralError('Please tell us how you heard about us.');
      showToast('Please tell us how you heard about us.', 'error');
      return;
    }
    setReferralError('');

    // Revalidate pickup_preference
    const validPickup = quoteData.pickup_preference === 'next_day' || quoteData.pickup_preference === 'same_day';
    if (!validPickup) {
      showToast('Please select a pickup preference (Next Morning or Same Day) before submitting.', 'error');
      return;
    }

    if (settingsLoading) {
      showToast('Loading pricing configuration. Please wait a moment.', 'error');
      return;
    }

    if (settingsError || !eeOnlyDepositSettings) {
      showToast('Unable to load pricing configuration. Please refresh the page or contact us for assistance.', 'error');
      return;
    }

    if (!unifiedTotals) {
      showToast('Unable to calculate order totals. Please return to your quote and try again.', 'error');
      return;
    }

    if (unifiedTotals?.depositError) {
      showToast(`Unable to calculate deposit: ${unifiedTotals.depositError}. Please contact us for assistance.`, 'error');
      return;
    }

    // Stage E4 — Validate package snapshots before order creation.
    const packageValidation = validateCartPackageSnapshots(cart as any[]);
    if (!packageValidation.ok) {
      showToast('Package details could not be verified. Please remove and re-add the package or contact us.', 'error');
      return;
    }

    const paymentCents = getPaymentAmountCentsFromTotals(paymentAmount, customAmount, unifiedTotals);
    if (paymentAmount === 'custom' && paymentCents < unifiedTotals.depositCents) {
      showToast(`Minimum payment is ${formatCurrency(unifiedTotals.depositCents)}`, 'error');
      return;
    }

    setProcessing(true);

    try {
      // Re-check inflatable availability before creating order (prevent race conditions)
      const availabilityChecks = inflatableCart.map((item) => ({
        unitId: item.unit_id,
        eventStartDate: quoteData.event_date,
        eventEndDate: quoteData.event_end_date,
      }));

      const availabilityResults = availabilityChecks.length > 0
        ? await checkMultipleUnitsAvailability(availabilityChecks)
        : [];
      const unavailableUnits = availabilityResults.filter((result) => !result.isAvailable);

      if (unavailableUnits.length > 0) {
        const unitNames = unavailableUnits.map((u) => {
          const cartItem = inflatableCart.find((item) => item.unit_id === u.unitId);
          return cartItem?.unit_name || 'Unknown unit';
        }).join(', ');

        showToast(
          `Sorry, the following units are no longer available for your selected dates: ${unitNames}. Please return to the quote page and select different units or dates.`,
          'error'
        );
        setProcessing(false);
        return;
      }

      const tipCents = getTipAmountCents(tipAmount, customTip, unifiedTotals.totalCents);

      const orderId = await createOrderBeforePayment({
        contactData,
        quoteData,
        priceBreakdown,
        cart,
        billingAddress,
        billingSameAsEvent,
        smsConsent,
        cardOnFileConsent,
        customerSelectedPaymentCents: paymentCents,
        customerSelectedPaymentType: paymentAmount,
        tipCents,
        referralSource,
        referralSourceDetail,
      });

      // For bookingMode, Stripe uses Setup Mode (card save only, no charge).
      // depositCents in metadata = the inflatable-only deposit for later admin approval.
      const depositCents = unifiedTotals.depositCents;

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
              tipCents,
              customerEmail: contactData.email,
              customerName: `${contactData.first_name} ${contactData.last_name}`,
              origin: window.location.origin,
              bookingMode: true,
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

  const tipCents = getTipAmountCents(tipAmount, customTip, unifiedTotals!.totalCents);
  const orderSummary = buildOrderSummary(priceBreakdown, cart, quoteData, tipCents, unifiedTotals);
  const paymentAmountCents = getPaymentAmountCentsFromTotals(paymentAmount, customAmount, unifiedTotals!);

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

            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-2">
                <MapPin className="w-6 h-6 text-green-600 shrink-0" />
                Event / Delivery Address
              </h2>
              <p className="text-sm text-slate-500 mb-4">
                This is where we will deliver and set up your inflatable.
              </p>
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-medium text-slate-800">
                  {quoteData.address_line1}
                  {quoteData.address_line2 && `, ${quoteData.address_line2}`}
                </p>
                <p className="text-sm text-slate-700">
                  {quoteData.city}, {quoteData.state} {quoteData.zip}
                </p>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                Need to change this?{' '}
                <a href="/quote" className="text-blue-600 underline hover:text-blue-800">
                  Go back to your cart / quote
                </a>{' '}
                and update the event address before booking.
              </p>
            </div>

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
              depositCents={unifiedTotals!.depositCents}
              totalCents={unifiedTotals!.totalCents}
              onPaymentAmountChange={setPaymentAmount}
              onCustomAmountChange={setCustomAmount}
            />

            <TipSection
              tipAmount={tipAmount}
              customTip={customTip}
              totalCents={unifiedTotals!.totalCents}
              tipCents={tipCents}
              onTipAmountChange={setTipAmount}
              onCustomTipChange={setCustomTip}
            />

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
              <h2 className="text-xl font-bold text-slate-900 mb-1">One Quick Question</h2>
              <p className="text-sm text-slate-500 mb-5">Help us understand how our customers find us.</p>
              <ReferralSourceSelect
                value={referralSource}
                detail={referralSourceDetail}
                onChange={(src, det) => {
                  setReferralSource(src);
                  setReferralSourceDetail(det);
                  if (src) setReferralError('');
                }}
                error={referralError}
              />
            </div>

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
              referralSource={referralSource}
              tipCents={tipCents}
              paymentAmountCents={paymentAmountCents}
              onViewInvoice={handleViewInvoice}
            />
          </div>
        </form>
      </div>
    </div>
  );
}
