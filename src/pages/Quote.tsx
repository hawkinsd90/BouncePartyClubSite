import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCustomerProfile } from '../contexts/CustomerProfileContext';
import { useQuoteForm } from '../hooks/useQuoteForm';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useQuotePricing } from '../hooks/useQuotePricing';
import { useQuotePrefill } from '../hooks/useQuotePrefill';
import { validateQuote } from '../lib/quoteValidation';
import { SafeStorage } from '../lib/safeStorage';
import { getPricingRules } from '../lib/queries';
import { checkDateBlackout } from '../lib/availability';
import { trackEvent } from '../lib/siteEvents';
import { CartSection } from '../components/quote/CartSection';
import { AddressSection } from '../components/quote/AddressSection';
import { EventDetailsSection } from '../components/quote/EventDetailsSection';
import { SetupDetailsSection } from '../components/quote/SetupDetailsSection';
import { QuoteSummarySection } from '../components/quote/QuoteSummarySection';
import { ValidationErrorBanner } from '../components/quote/ValidationErrorBanner';
import type { PricingRules } from '../lib/pricing';

export function Quote() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { sessionData, loading: profileLoading } = useCustomerProfile();
  const { formData, updateFormData, addressInput, setAddressInput, saveFormData } = useQuoteForm();
  const { cart, updateCartItem, removeFromCart, checkCartAvailability } = useQuoteCart();
  const [pricingRules, setPricingRules] = useState<PricingRules | null>(null);
  const { priceBreakdown, savePriceBreakdown } = useQuotePricing(cart, formData, pricingRules);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationErrorFieldId, setValidationErrorFieldId] = useState<string | null>(null);
  const [sameDayPickupBlocked, setSameDayPickupBlocked] = useState(false);
  const validationBannerRef = useRef<HTMLDivElement>(null);
  const eventDetailsSectionRef = useRef<HTMLDivElement>(null);
  const didScrollToDuplicateRef = useRef(false);

  useQuotePrefill(user, formData, { setAddressInput, updateFormData }, sessionData);

  useEffect(() => {
    trackEvent('quote_started');
  }, []);

  useEffect(() => {
    async function loadPricingRules() {
      const { data } = await getPricingRules();
      if (data) setPricingRules(data as PricingRules);
    }
    loadPricingRules();
  }, []);

  useEffect(() => {
    if (!formData.event_date) return;

    async function checkBlackout() {
      const result = await checkDateBlackout(
        formData.event_date,
        formData.event_end_date || formData.event_date
      );
      setSameDayPickupBlocked(result.is_same_day_pickup_blocked);
    }
    checkBlackout();
  }, [formData.event_date, formData.event_end_date]);

  useEffect(() => {
    if (!formData.event_date || !formData.event_end_date || cart.length === 0) return;
    checkCartAvailability(formData.event_date, formData.event_end_date);
  }, [formData.event_date, formData.event_end_date]);

  useEffect(() => {
    if (
      !didScrollToDuplicateRef.current &&
      eventDetailsSectionRef.current &&
      SafeStorage.getItem<boolean>('bpc_prefill_applied') === true
    ) {
      didScrollToDuplicateRef.current = true;
      setTimeout(() => {
        eventDetailsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 400);
    }
  }, [formData.address_line1]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const result = validateQuote(cart, formData);

    if (!result.isValid) {
      setValidationError(result.errorMessage || 'Please fix the errors above.');
      setValidationErrorFieldId(result.errorFieldId || null);

      setTimeout(() => {
        if (result.errorFieldId) {
          const el = document.getElementById(result.errorFieldId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
        }
        validationBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);

      return;
    }

    setValidationError(null);
    setValidationErrorFieldId(null);

    savePriceBreakdown();
    saveFormData();

    SafeStorage.setItem('bpc_quote_data', {
      event_date: formData.event_date,
      event_end_date: formData.event_end_date,
      start_window: formData.start_window,
      end_window: formData.end_window,
      address_line1: formData.address_line1,
      address_line2: formData.address_line2,
      city: formData.city,
      state: formData.state,
      zip: formData.zip,
      lat: formData.lat,
      lng: formData.lng,
      location_type: formData.location_type,
      pickup_preference: formData.pickup_preference,
      can_stake: formData.can_stake,
      has_generator: formData.has_generator,
      generator_qty: formData.generator_qty,
      has_pets: formData.has_pets,
      special_details: formData.special_details,
      overnight_responsibility_accepted: formData.overnight_responsibility_accepted,
      same_day_responsibility_accepted: formData.same_day_responsibility_accepted,
    }, { expirationDays: 7 });

    trackEvent('quote_submitted');
    navigate('/checkout');
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Request a Quote</h1>
          <p className="text-slate-600 mt-1 text-sm sm:text-base">Fill in your event details to see pricing and continue to checkout.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div ref={validationBannerRef}>
            {validationError && (
              <ValidationErrorBanner
                message={validationError}
                onDismiss={() => {
                  setValidationError(null);
                  setValidationErrorFieldId(null);
                }}
              />
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <CartSection
                cart={cart}
                eventDate={formData.event_date}
                onUpdateItem={updateCartItem}
                onRemoveItem={removeFromCart}
              />

              <AddressSection
                formData={formData}
                addressInput={addressInput}
                onAddressInputChange={setAddressInput}
                onFormDataChange={updateFormData}
              />

              <div ref={eventDetailsSectionRef} id="section-event">
                <EventDetailsSection
                  formData={formData}
                  onFormDataChange={updateFormData}
                  validationErrorFieldId={validationErrorFieldId}
                  sameDayPickupBlocked={sameDayPickupBlocked}
                />
              </div>

              <SetupDetailsSection
                formData={formData}
                onFormDataChange={updateFormData}
              />
            </div>

            <div className="lg:col-span-1">
              <QuoteSummarySection
                cart={cart}
                priceBreakdown={priceBreakdown}
              />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
