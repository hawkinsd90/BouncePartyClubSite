import { useEffect, useCallback, useState, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Trash2, AlertCircle, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useCustomerProfile } from '../contexts/CustomerProfileContext';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useQuoteForm } from '../hooks/useQuoteForm';
import { useQuotePricing } from '../hooks/useQuotePricing';
import { useQuotePrefill } from '../hooks/useQuotePrefill';
import { useDataFetch } from '../hooks/useDataFetch';
import { supabase } from '../lib/supabase';
import { validateQuote } from '../lib/quoteValidation';
import type { PricingRules } from '../lib/pricing';
import { trackEvent } from '../lib/siteEvents';
import { CartSection } from '../components/quote/CartSection';
import { AddressSection } from '../components/quote/AddressSection';
import { EventDetailsSection } from '../components/quote/EventDetailsSection';
import { SetupDetailsSection } from '../components/quote/SetupDetailsSection';
import { QuoteSummarySection } from '../components/quote/QuoteSummarySection';
import { SimpleConfirmModal } from '../components/common/SimpleConfirmModal';
import { ValidationErrorBanner } from '../components/quote/ValidationErrorBanner';

// Build version for cache verification
const APP_VERSION = '2.1.0';

interface DebugInfo {
  timestamp: string;
  validationFailed: boolean;
  errorSection: string | null;
  scrollAttempted: boolean;
  refFound: boolean;
  scrollTop: number | null;
  elementTop: number | null;
}

export function Quote() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { sessionData } = useCustomerProfile();
  const [searchParams] = useSearchParams();
  const [showClearModal, setShowClearModal] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationErrorFieldId, setValidationErrorFieldId] = useState<string | null>(null);
  const [showBottomToast, setShowBottomToast] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  // Debug mode enabled via ?debug=1
  const debugMode = searchParams.get('debug') === '1' || import.meta.env.DEV;

  // Refs for scrolling to sections
  const cartRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLDivElement>(null);
  const eventRef = useRef<HTMLDivElement>(null);
  const setupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    trackEvent('quote_started');
  }, []);

  const { cart, updateCartItem, removeFromCart, clearCart, checkCartAvailability } = useQuoteCart();
  const { formData, setFormData, updateFormData, addressInput, setAddressInput, saveFormData, clearForm } =
    useQuoteForm();

  const fetchPricingRules = useCallback(async () => {
    const { data, error } = await supabase
      .from('pricing_rules')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('No pricing rules found');

    return {
      base_radius_miles: Number(data.base_radius_miles ?? 0),
      included_city_list_json: (data.included_city_list_json as string[]) ?? [],
      included_cities: (data.included_city_list_json as string[]) ?? [],
      per_mile_after_base_cents: data.per_mile_after_base_cents ?? 0,
      zone_overrides_json: (data.zone_overrides_json as any[]) ?? [],
      surface_sandbag_fee_cents: data.surface_sandbag_fee_cents ?? 0,
      residential_multiplier: Number(data.residential_multiplier ?? 1),
      commercial_multiplier: Number(data.commercial_multiplier ?? 1),
      same_day_matrix_json: (data.same_day_matrix_json as any[]) ?? [],
      overnight_holiday_only: data.overnight_holiday_only ?? false,
      extra_day_pct: Number(data.extra_day_pct ?? 0),
      generator_price_cents: Number(data.generator_price_cents ?? 0),
      deposit_per_unit_cents: Number((data as any).deposit_per_unit_cents ?? 5000),
      same_day_pickup_fee_cents: Number(data.same_day_pickup_fee_cents ?? 0),
      generator_fee_single_cents: Number((data as any).generator_fee_single_cents ?? data.generator_price_cents ?? 10000),
      generator_fee_multiple_cents: Number((data as any).generator_fee_multiple_cents ?? data.generator_price_cents ?? 7500),
      apply_taxes_by_default: (data as any).apply_taxes_by_default ?? true,
    };
  }, []);

  const { data: pricingRules } = useDataFetch<PricingRules>(
    fetchPricingRules,
    { showErrorNotification: false }
  );

  const { priceBreakdown, savePriceBreakdown } = useQuotePricing(cart, formData, pricingRules);

  useQuotePrefill(user, formData, { setAddressInput, updateFormData }, sessionData);

  useEffect(() => {
    if (cart.length > 0 && formData.event_date && formData.event_end_date) {
      const timer = setTimeout(() => {
        checkCartAvailability(formData.event_date, formData.event_end_date);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [formData.event_date, formData.event_end_date, cart.length]);

  const handleClearAll = () => {
    clearCart();
    clearForm();

    // Clear contact information only if user is not logged in
    if (!user) {
      localStorage.removeItem('bpc_contact_data');
    }

    setShowClearModal(false);
  };

  const scrollToField = (fieldId: string) => {
    const element = document.getElementById(fieldId);

    const debug: Partial<DebugInfo> = {
      scrollAttempted: true,
      refFound: !!element,
      scrollTop: null,
      elementTop: null,
    };

    if (!element) {
      if (debugMode) {
        setDebugInfo((prev) => ({ ...prev!, ...debug }));
      }
      return;
    }

    try {
      // Calculate absolute position accounting for sticky header
      const elementRect = element.getBoundingClientRect();
      const absoluteTop = elementRect.top + window.scrollY;
      const headerOffset = 100; // 80px header + 20px padding
      const targetScrollTop = absoluteTop - headerOffset;

      debug.elementTop = absoluteTop;
      debug.scrollTop = targetScrollTop;

      // Use window.scrollTo for most reliable iOS behavior
      window.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth',
      });

      // Optional: Focus the field after scroll (with delay for smooth scroll)
      setTimeout(() => {
        element.focus({ preventScroll: true });
      }, 500);

      if (debugMode) {
        setDebugInfo((prev) => ({ ...prev!, ...debug }));
      }
    } catch (error) {
      // Emergency fallback: instant scroll
      const rect = element.getBoundingClientRect();
      const fallbackTop = rect.top + window.scrollY - 100;
      window.scrollTo({
        top: fallbackTop,
        behavior: 'auto',
      });

      if (debugMode) {
        setDebugInfo((prev) => ({ ...prev!, ...debug, scrollTop: fallbackTop }));
      }
    }
  };

  const scrollToSection = (section: 'cart' | 'address' | 'event' | 'setup') => {
    const refs = {
      cart: cartRef,
      address: addressRef,
      event: eventRef,
      setup: setupRef,
    };

    const sectionIds = {
      cart: 'section-cart',
      address: 'section-address',
      event: 'section-event',
      setup: 'section-setup',
    };

    // Try ref first, then getElementById as fallback
    let element = refs[section].current;
    if (!element) {
      element = document.getElementById(sectionIds[section]);
    }

    const debug: Partial<DebugInfo> = {
      scrollAttempted: true,
      refFound: !!element,
      scrollTop: null,
      elementTop: null,
    };

    if (!element) {
      if (debugMode) {
        setDebugInfo((prev) => ({ ...prev!, ...debug }));
      }
      return;
    }

    try {
      // Calculate absolute position accounting for sticky header
      const elementRect = element.getBoundingClientRect();
      const absoluteTop = elementRect.top + window.scrollY;
      const headerOffset = 100; // 80px header + 20px padding
      const targetScrollTop = absoluteTop - headerOffset;

      debug.elementTop = absoluteTop;
      debug.scrollTop = targetScrollTop;

      // Use window.scrollTo for most reliable iOS behavior
      window.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth',
      });

      if (debugMode) {
        setDebugInfo((prev) => ({ ...prev!, ...debug }));
      }
    } catch (error) {
      // Emergency fallback: instant scroll
      const rect = element.getBoundingClientRect();
      const fallbackTop = rect.top + window.scrollY - 100;
      window.scrollTo({
        top: fallbackTop,
        behavior: 'auto',
      });

      if (debugMode) {
        setDebugInfo((prev) => ({ ...prev!, ...debug, scrollTop: fallbackTop }));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const validation = validateQuote(cart, formData);
    if (!validation.isValid) {
      const errorMessage = validation.errorMessage || 'Please fix the errors below';

      // Use flushSync to update state synchronously within user gesture
      // This ensures scroll happens in the same event loop tick
      flushSync(() => {
        setValidationError(errorMessage);
        setValidationErrorFieldId(validation.errorFieldId || null);
        setShowBottomToast(true);

        if (debugMode) {
          setDebugInfo({
            timestamp: new Date().toISOString(),
            validationFailed: true,
            errorSection: validation.errorSection || null,
            scrollAttempted: false,
            refFound: false,
            scrollTop: null,
            elementTop: null,
          });
        }
      });

      // Scroll to exact field if errorFieldId is provided, otherwise scroll to section
      if (validation.errorFieldId) {
        scrollToField(validation.errorFieldId);
      } else if (validation.errorSection) {
        scrollToSection(validation.errorSection);
      }

      // NO AUTO-DISMISS - user must fix error or manually dismiss

      return;
    }

    await checkCartAvailability(formData.event_date, formData.event_end_date);

    const stillUnavailable = cart.filter((item) => item.isAvailable === false);
    if (stillUnavailable.length > 0) {
      const unavailableNames = stillUnavailable.map((item) => item.unit_name).join(', ');
      const errorMessage = `Sorry, the following inflatables were just booked: ${unavailableNames}. Please choose different dates or remove these items.`;

      flushSync(() => {
        setValidationError(errorMessage);
        setValidationErrorFieldId(null);
        setShowBottomToast(true);

        if (debugMode) {
          setDebugInfo({
            timestamp: new Date().toISOString(),
            validationFailed: true,
            errorSection: 'cart',
            scrollAttempted: false,
            refFound: false,
            scrollTop: null,
            elementTop: null,
          });
        }
      });

      scrollToSection('cart');

      // NO AUTO-DISMISS - user must fix error or manually dismiss

      return;
    }

    saveFormData();
    savePriceBreakdown();
    trackEvent('quote_submitted');
    navigate('/checkout');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 lg:py-16">
        {validationError && (
          <ValidationErrorBanner
            message={validationError}
            onDismiss={() => {
              setValidationError(null);
              setValidationErrorFieldId(null);
              setShowBottomToast(false);
            }}
          />
        )}

        {/* Bottom Toast Fallback for iPhone */}
        {showBottomToast && validationError && (
          <div className="fixed bottom-4 left-4 right-4 z-[9998] bg-red-600 text-white rounded-lg shadow-2xl p-4 flex items-start gap-3 animate-slide-up">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold break-words">{validationError}</p>
            </div>
            <button
              onClick={() => {
                setShowBottomToast(false);
                setValidationError(null);
                setValidationErrorFieldId(null);
              }}
              className="text-white hover:bg-red-700 rounded-lg p-1.5 transition-colors flex-shrink-0"
              aria-label="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Debug Info Panel - Only visible with ?debug=1 */}
        {debugMode && (
          <div className="fixed bottom-4 left-4 z-[9999] bg-yellow-100 border-2 border-yellow-600 rounded-lg p-3 text-xs font-mono max-w-xs shadow-2xl">
            <div className="font-bold text-yellow-900 mb-2">DEBUG MODE (v{APP_VERSION})</div>
            {debugInfo ? (
              <div className="space-y-1 text-yellow-900">
                <div>Time: {new Date(debugInfo.timestamp).toLocaleTimeString()}</div>
                <div>Validation Failed: {debugInfo.validationFailed ? '✓ YES' : '✗ NO'}</div>
                <div>Error Section: {debugInfo.errorSection || 'none'}</div>
                <div>Error Field ID: {validationErrorFieldId || 'none'}</div>
                <div>Banner Mounted: {validationError ? '✓ YES' : '✗ NO'}</div>
                <div>Toast Mounted: {showBottomToast ? '✓ YES' : '✗ NO'}</div>
                <div>Scroll Attempted: {debugInfo.scrollAttempted ? '✓ YES' : '✗ NO'}</div>
                <div>Ref Found: {debugInfo.refFound ? '✓ YES' : '✗ NO'}</div>
                <div>Element Top: {debugInfo.elementTop ?? 'null'}px</div>
                <div>Scroll Target: {debugInfo.scrollTop ?? 'null'}px</div>
              </div>
            ) : (
              <div className="text-yellow-700">Waiting for validation...</div>
            )}
          </div>
        )}
        <div className="mb-10 sm:mb-12 flex items-start justify-between">
          <div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 mb-3 sm:mb-4 tracking-tight">
              Your Cart & Quote
            </h1>
            <p className="text-slate-600 text-base sm:text-lg lg:text-xl leading-relaxed max-w-2xl">
              Review your selections and complete your event details
            </p>
          </div>
          {(cart.length > 0 || formData.address_line1) && (
            <button
              type="button"
              onClick={() => setShowClearModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors duration-200 font-medium"
            >
              <Trash2 className="w-5 h-5" />
              <span className="hidden sm:inline">Clear All</span>
            </button>
          )}
        </div>

        <form noValidate onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-10">
            <div className="lg:col-span-2 space-y-8">
              <div ref={cartRef} id="section-cart" style={{ scrollMarginTop: '100px' }}>
                <CartSection
                  cart={cart}
                  eventDate={formData.event_date}
                  onUpdateItem={updateCartItem}
                  onRemoveItem={removeFromCart}
                />
              </div>

              <div ref={addressRef} id="section-address" style={{ scrollMarginTop: '100px' }}>
                <AddressSection
                  formData={formData}
                  addressInput={addressInput}
                  onAddressInputChange={setAddressInput}
                  onFormDataChange={(updates) => setFormData({ ...formData, ...updates })}
                />
              </div>

              <div ref={eventRef} id="section-event" style={{ scrollMarginTop: '100px' }}>
                <EventDetailsSection
                  formData={formData}
                  onFormDataChange={(updates) => setFormData({ ...formData, ...updates })}
                  validationErrorFieldId={validationErrorFieldId}
                />
              </div>

              <div ref={setupRef} id="section-setup" style={{ scrollMarginTop: '100px' }}>
                <SetupDetailsSection
                  formData={formData}
                  onFormDataChange={(updates) => setFormData({ ...formData, ...updates })}
                />
              </div>
            </div>

            <div className="lg:col-span-1">
              <QuoteSummarySection cart={cart} priceBreakdown={priceBreakdown} />
            </div>
          </div>
        </form>

        <SimpleConfirmModal
          isOpen={showClearModal}
          onClose={() => setShowClearModal(false)}
          onConfirm={handleClearAll}
          title="Clear Cart & Form"
          message="Are you sure you want to clear your cart and all form information?"
          confirmText="Clear All"
          variant="danger"
        />
      </div>
    </div>
  );
}
