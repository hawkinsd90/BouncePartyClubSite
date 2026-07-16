import { useState, useEffect, useRef } from 'react';
import { calculatePrice, calculateDrivingDistance, isSameDayWeekdayDelivery, type PricingRules } from '../lib/pricing';
import { HOME_BASE } from '../lib/constants';
import { SafeStorage } from '../lib/safeStorage';
import type { QuoteFormData } from './useQuoteForm';
import type { InflatableCartItem } from '../types';

const PRICE_BREAKDOWN_STORAGE_KEY = 'bpc_price_breakdown';

export function useQuotePricing(cart: InflatableCartItem[], formData: QuoteFormData, pricingRules: PricingRules | null) {
  const [priceBreakdown, setPriceBreakdown] = useState<any>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const inflatableCart = cart.filter((item) => {
    const itemType = (item as any).item_type;
    return itemType === undefined || itemType === 'inflatable';
  });

  useEffect(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const hasRequiredPricingInputs =
      inflatableCart.length > 0 &&
      !!pricingRules &&
      !!formData.zip &&
      !!formData.lat &&
      !!formData.lng &&
      !!formData.event_date &&
      !!formData.event_end_date &&
      formData.pickup_preference !== null &&
      formData.can_stake !== null;

    if (hasRequiredPricingInputs) {
      debounceTimerRef.current = setTimeout(() => {
        calculatePricing();
      }, 500);
    } else {
      setPriceBreakdown(null);
      SafeStorage.removeItem(PRICE_BREAKDOWN_STORAGE_KEY);
    }

    // Cleanup on unmount
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [inflatableCart, pricingRules, formData]);

  async function calculatePricing() {
    if (!pricingRules) return;

    // calculateDrivingDistance will load Google Maps internally
    const distance_miles = await calculateDrivingDistance(
      HOME_BASE.lat,
      HOME_BASE.lng,
      formData.lat,
      formData.lng
    );

    const startDate = new Date(formData.event_date);
    const endDate = new Date(formData.event_end_date);
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const num_days = Math.max(1, daysDiff + 1);

    const breakdown = calculatePrice({
      items: inflatableCart,
      location_type: formData.location_type ?? 'residential',
      surface: formData.can_stake === true ? 'grass' : 'cement',
      can_use_stakes: formData.can_stake ?? true,
      overnight_allowed: formData.pickup_preference === 'next_day',
      num_days,
      distance_miles,
      city: formData.city,
      zip: formData.zip,
      has_generator: formData.has_generator || formData.generator_qty > 0,
      generator_qty: formData.generator_qty || 0,
      rules: pricingRules,
      is_same_day_weekday_delivery: isSameDayWeekdayDelivery(formData.event_date),
    });

    setPriceBreakdown(breakdown);
  }

  function savePriceBreakdown() {
    if (priceBreakdown) {
      SafeStorage.setItem(PRICE_BREAKDOWN_STORAGE_KEY, priceBreakdown, { expirationDays: 7 });
    }
  }

  return {
    priceBreakdown,
    savePriceBreakdown,
  };
}
