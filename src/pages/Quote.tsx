import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useQuoteForm } from '../hooks/useQuoteForm';
import { useQuotePricing } from '../hooks/useQuotePricing';
import { useQuotePrefill } from '../hooks/useQuotePrefill';
import { useDataFetch } from '../hooks/useDataFetch';
import { supabase } from '../lib/supabase';
import { validateQuote } from '../lib/quoteValidation';
import type { PricingRules } from '../lib/pricing';
import { CartSection } from '../components/quote/CartSection';
import { AddressSection } from '../components/quote/AddressSection';
import { EventDetailsSection } from '../components/quote/EventDetailsSection';
import { SetupDetailsSection } from '../components/quote/SetupDetailsSection';
import { QuoteSummarySection } from '../components/quote/QuoteSummarySection';

export function Quote() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { cart, updateCartItem, removeFromCart, checkCartAvailability } = useQuoteCart();
  const { formData, setFormData, updateFormData, addressInput, setAddressInput, saveFormData } =
    useQuoteForm();

  const { data: pricingRules, refetch: refetchPricing } = useDataFetch<PricingRules>(
    async () => {
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
        included_cities: (data.included_cities as string[]) ?? (data.included_city_list_json as string[]) ?? [],
        per_mile_after_base_cents: data.per_mile_after_base_cents ?? 0,
        zone_overrides_json: (data.zone_overrides_json as any[]) ?? [],
        surface_sandbag_fee_cents: data.surface_sandbag_fee_cents ?? 0,
        residential_multiplier: Number(data.residential_multiplier ?? 1),
        commercial_multiplier: Number(data.commercial_multiplier ?? 1),
        same_day_matrix_json: (data.same_day_matrix_json as any[]) ?? [],
        overnight_holiday_only: data.overnight_holiday_only ?? false,
        extra_day_pct: Number(data.extra_day_pct ?? 0),
        generator_price_cents: Number(data.generator_price_cents ?? 0),
        deposit_per_unit_cents: Number(data.deposit_per_unit_cents ?? 5000),
        same_day_pickup_fee_cents: Number(data.same_day_pickup_fee_cents ?? 0),
        generator_fee_single_cents: Number(data.generator_fee_single_cents ?? data.generator_price_cents ?? 10000),
        generator_fee_multiple_cents: Number(data.generator_fee_multiple_cents ?? data.generator_price_cents ?? 7500),
      };
    },
    { showErrorNotification: false }
  );

  const { priceBreakdown, savePriceBreakdown } = useQuotePricing(cart, formData, pricingRules);

  useQuotePrefill(user, { setAddressInput, updateFormData });

  // Listen for pricing updates from Admin panel
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'pricing_rules_updated') {
        refetchPricing();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [refetchPricing]);

  useEffect(() => {
    if (cart.length > 0 && formData.event_date && formData.event_end_date) {
      const timer = setTimeout(() => {
        checkCartAvailability(formData.event_date, formData.event_end_date);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [formData.event_date, formData.event_end_date, cart.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = validateQuote(cart, formData);
    if (!validation.isValid) {
      alert(validation.errorMessage);
      return;
    }

    await checkCartAvailability(formData.event_date, formData.event_end_date);

    const stillUnavailable = cart.filter((item) => item.isAvailable === false);
    if (stillUnavailable.length > 0) {
      const unavailableNames = stillUnavailable.map((item) => item.unit_name).join(', ');
      alert(
        `Sorry, the following inflatables were just booked by another customer: ${unavailableNames}. Please choose different dates or remove these items.`
      );
      return;
    }

    saveFormData();
    savePriceBreakdown();
    navigate('/checkout');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 lg:py-16">
        <div className="mb-10 sm:mb-12">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 mb-3 sm:mb-4 tracking-tight">
            Your Cart & Quote
          </h1>
          <p className="text-slate-600 text-base sm:text-lg lg:text-xl leading-relaxed max-w-2xl">
            Review your selections and complete your event details
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-10">
            <div className="lg:col-span-2 space-y-8">
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
                onFormDataChange={(updates) => setFormData({ ...formData, ...updates })}
              />

              <EventDetailsSection
                formData={formData}
                onFormDataChange={(updates) => setFormData({ ...formData, ...updates })}
              />

              <SetupDetailsSection
                formData={formData}
                onFormDataChange={(updates) => setFormData({ ...formData, ...updates })}
              />
            </div>

            <div className="lg:col-span-1">
              <QuoteSummarySection cart={cart} priceBreakdown={priceBreakdown} />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
