import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { formatCurrency } from '../lib/pricing';
import { RentalTerms } from '../components/waiver/RentalTerms';
import { BookingApiError, buildBookingRequest, createBooking, startBookingCardSetup } from '../lib/booking/bookingApi';
import {
  bookingErrorMessage,
  decideAttempt,
  fingerprintBookingRequest,
  loadBookingAttempt,
  missingForSubmit,
  rememberCreatedBooking,
  rememberStripeSession,
} from '../lib/booking/bookingAttempt';
import { useAuth } from '../contexts/AuthContext';
import { useCheckoutData } from '../hooks/booking/useCheckoutData';
import { getPaymentAmountCentsFromTotals, getTipAmountCents, buildOrderSummary } from '../lib/booking/checkoutUtils';
import { showToast } from '../lib/toasts';
import { composeUnifiedQuoteTotals } from '../lib/pricing/unifiedTotals';
import { validateCartPackageSnapshots } from '../lib/pricing/packageDisplay';
import {
  parseBookingDepositSettings,
  fetchSingletonPricingRulesRow,
  type BookingDepositSettingsResult,
} from '../lib/pricing/depositCalculation';
import { ContactInformationForm } from '../components/checkout/ContactInformationForm';
import { BillingAddressForm } from '../components/checkout/BillingAddressForm';
import { PaymentAmountSelector } from '../components/checkout/PaymentAmountSelector';
import { TipSection } from '../components/checkout/TipSection';
import { ConsentSection } from '../components/checkout/ConsentSection';
import { CheckoutSummary } from '../components/checkout/CheckoutSummary';
import { ReferralSourceSelect } from '../components/shared/ReferralSourceSelect';
import { getPublicBusinessSettings } from '../lib/core/adminSettingsCache';
import { createLogger } from '../lib/core/logger';
import { trackEvent } from '../lib/core/siteEvents';

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
  // Blocks a second submit in the same tick (a double click can fire before React re-renders the disabled button).
  const submitInFlightRef = useRef(false);
  const [referralError, setReferralError] = useState('');
  const [billingSameAsEvent, setBillingSameAsEvent] = useState(true);
  const [paymentAmount, setPaymentAmount] = useState<'deposit' | 'full' | 'custom'>('deposit');
  const [customAmount, setCustomAmount] = useState('');
  const [bookingDepositSettings, setBookingDepositSettings] = useState<BookingDepositSettingsResult | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [howDidYouHearEnabled, setHowDidYouHearEnabled] = useState(true);

  useEffect(() => {
    (async () => {
      setSettingsLoading(true);
      setSettingsError(null);
      try {
        const result = await fetchSingletonPricingRulesRow();
        if (result.status !== 'ready') {
          setSettingsError(result.error);
          return;
        }
        const parsed = parseBookingDepositSettings(result.row);
        if (parsed.status !== 'ready') {
          setSettingsError(parsed.error);
          return;
        }
        setBookingDepositSettings(parsed);
      } catch (err: any) {
        setSettingsError(err?.message || 'Failed to load pricing configuration.');
      } finally {
        setSettingsLoading(false);
      }
    })();
  }, []);

  // Coming back with the browser Back button can restore this page from the back/forward cache with "Processing" still showing.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        submitInFlightRef.current = false;
        setProcessing(false);
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  useEffect(() => {
    getPublicBusinessSettings().then(s => setHowDidYouHearEnabled(s.how_did_you_hear_enabled)).catch(() => {});
  }, []);

  void cart; // cart used in unifiedTotals computation below

  // Compute unified totals using the inflatable breakdown's tax_applied setting
  const unifiedTotals = priceBreakdown && bookingDepositSettings?.status === 'ready'
    ? composeUnifiedQuoteTotals({
        inflatableBreakdown: priceBreakdown,
        cart,
        taxApplied: priceBreakdown.tax_applied ?? true,
        eeOnlyDepositSettings: bookingDepositSettings.eventEssentialsDepositSettings,
        inflatableDepositPerUnitCents: bookingDepositSettings.inflatableDepositPerUnitCents,
        setupMinimumCents: bookingDepositSettings.setupMinimumCents,
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
    if (submitInFlightRef.current) return;

    if (!cardOnFileConsent) {
      showToast('Please consent to card-on-file authorization', 'error');
      return;
    }

    if (!smsConsent) {
      showToast('Please consent to SMS notifications', 'error');
      return;
    }

    if (howDidYouHearEnabled && !referralSource) {
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

    if (settingsError || !bookingDepositSettings || bookingDepositSettings.status !== 'ready') {
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

    submitInFlightRef.current = true;
    setProcessing(true);

    try {
      const tipCents = getTipAmountCents(tipAmount, customTip, unifiedTotals.totalCents);

      // The server validates availability, prices the order from the live catalog, creates it atomically and returns a
      // short-lived booking proof. The browser sends only what the customer chose. Nothing is charged.
      const request = buildBookingRequest({
        quoteData,
        priceBreakdown,
        cart,
        contactData,
        billingAddress,
        billingSameAsEvent,
        smsConsent,
        cardOnFileConsent,
        paymentSelection: paymentAmount,
        customPaymentCents: paymentAmount === 'custom' ? paymentCents : null,
        tipCents,
        referralSource: referralSource || null,
        referralSourceDetail: referralSourceDetail || null,
      });
      const fingerprint = fingerprintBookingRequest(request);

      // The same request again (Back from Stripe, a retry, a second tab click) reuses the order already created for it instead of
      // creating another draft: back to the live Stripe session, or the same order when only the Stripe step failed.
      const decision = decideAttempt(loadBookingAttempt(), fingerprint, Date.now());
      if (decision.action === 'redirect') {
        log.info('Reopening the existing Stripe checkout for this booking');
        window.location.href = decision.url;
        return;
      }

      let booking: { orderId: string; bookingToken: string };
      if (decision.action === 'resume') {
        booking = { orderId: decision.orderId, bookingToken: decision.bookingToken };
      } else {
        try {
          const created = await createBooking(request);
          rememberCreatedBooking(fingerprint, created);
          booking = created;
        } catch (error: unknown) {
          console.error('Error creating booking request:', error);
          if (error instanceof BookingApiError && error.code === 'ACCOUNT_SIGN_IN_REQUIRED') {
            // Not an error to retry: this email belongs to a registered account.
            showToast(error.message, 'error');
          } else if (error instanceof BookingApiError) {
            showToast(bookingErrorMessage(error.code, error.message), 'error');
          } else {
            showToast(bookingErrorMessage(null, error instanceof Error ? error.message : null), 'error');
          }
          submitInFlightRef.current = false;
          setProcessing(false);
          return;
        }
      }

      // Stripe Setup Mode: the card is saved for later, nothing is charged. Customer, deposit and tip come from the order.
      try {
        const { url } = await startBookingCardSetup(booking);
        rememberStripeSession(fingerprint, booking.orderId, url, Date.now());
        log.info('Opening Stripe checkout');
        window.location.href = url;
        // The page stays in "Processing" while the browser leaves for Stripe; the pageshow handler resets it if the customer comes back.
      } catch (err: unknown) {
        log.error('Stripe checkout error', err);
        showToast(err instanceof Error && err.message ? err.message : 'Failed to initialize payment', 'error');
        submitInFlightRef.current = false;
        setProcessing(false);
      }
    } catch (error: unknown) {
      console.error('Error creating order:', error);
      showToast(bookingErrorMessage(null, error instanceof Error ? error.message : null), 'error');
      submitInFlightRef.current = false;
      setProcessing(false);
    }
  };

  if (loading || !quoteData || !priceBreakdown) {
    if (!loading && (!quoteData || !priceBreakdown)) {
      navigate('/quote');
      return null;
    }
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mb-4" />
          <p className="text-slate-600 text-lg">Loading your order...</p>
        </div>
      </div>
    );
  }

  // Stage E4 — Explicit render states before unifiedTotals access.
  // Settings loading: controlled loading state, no payment/summary rendering.
  if (settingsLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mb-4" />
          <p className="text-slate-600 text-lg">Loading pricing configuration...</p>
        </div>
      </div>
    );
  }

  // Settings failed, invalid, or unifiedTotals unavailable: controlled error.
  if (settingsError || !bookingDepositSettings || bookingDepositSettings.status !== 'ready' || !unifiedTotals) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-slate-800 text-lg font-semibold mb-2">Unable to load pricing configuration</p>
          <p className="text-slate-600 text-sm mb-6">
            {settingsError || 'Please try again or contact us for assistance.'}
          </p>
          <a
            href="/quote"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            Return to Quote
          </a>
        </div>
      </div>
    );
  }

  const tipCents = getTipAmountCents(tipAmount, customTip, unifiedTotals.totalCents);
  const orderSummary = buildOrderSummary(priceBreakdown, cart, quoteData, tipCents, unifiedTotals);
  const paymentAmountCents = getPaymentAmountCentsFromTotals(paymentAmount, customAmount, unifiedTotals);

  // Determine item-neutral copy for the delivery address section.
  const hasInflatables = inflatableCart.length > 0;

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
                {hasInflatables
                  ? 'This is where we will deliver and set up your inflatable.'
                  : 'This is where we will deliver your rental equipment.'}
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
              depositCents={unifiedTotals.depositCents}
              totalCents={unifiedTotals.totalCents}
              onPaymentAmountChange={setPaymentAmount}
              onCustomAmountChange={setCustomAmount}
            />

            <TipSection
              tipAmount={tipAmount}
              customTip={customTip}
              totalCents={unifiedTotals.totalCents}
              tipCents={tipCents}
              onTipAmountChange={setTipAmount}
              onCustomTipChange={setCustomTip}
            />

            {howDidYouHearEnabled && (
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
            )}

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
              referralRequired={howDidYouHearEnabled}
              missingItems={missingForSubmit({ cardOnFileConsent, smsConsent, howDidYouHearEnabled, referralSource })}
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
