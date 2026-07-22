import { useState, useEffect, useRef } from 'react';
import { calculatePrice, calculateDrivingDistance, isSameDayWeekdayDelivery, type PricingRules } from '../lib/pricing';
import { HOME_BASE } from '../lib/constants';
import { SafeStorage } from '../lib/safeStorage';
import type { QuoteFormData } from './useQuoteForm';
import type { InflatableCartItem } from '../types';

const PRICE_BREAKDOWN_STORAGE_KEY = 'bpc_price_breakdown';

export interface UseQuotePricingOptions {
  hasAnyCartItems: boolean;
  hasInflatables: boolean;
}

export function useQuotePricing(
  cart: InflatableCartItem[],
  formData: QuoteFormData,
  pricingRules: PricingRules | null,
  options?: UseQuotePricingOptions,
) {
  const [priceBreakdown, setPriceBreakdown] = useState<any>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const hasAnyCartItems = options?.hasAnyCartItems ?? cart.length > 0;
  const hasInflatables = options?.hasInflatables ?? cart.length > 0;

  useEffect(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // can_stake is only required when the cart contains inflatables.
    // Event Essentials-only carts skip the inflatable setup question.
    const canStakeSatisfied = hasInflatables ? formData.can_stake !== null : true;

    const hasRequiredPricingInputs =
      hasAnyCartItems &&
      !!pricingRules &&
      !!formData.zip &&
      !!formData.lat &&
      !!formData.lng &&
      !!formData.event_date &&
      !!formData.event_end_date &&
      formData.pickup_preference !== null &&
      canStakeSatisfied;

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
  }, [cart, pricingRules, formData]);

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
      items: cart,
      location_type: formData.location_type ?? 'residential',
      // EE-only carts have no inflatables — skip surface/staking entirely.
      surface: hasInflatables ? (formData.can_stake === true ? 'grass' : 'cement') : 'grass',
      can_use_stakes: hasInflatables ? (formData.can_stake ?? true) : true,
      overnight_allowed: formData.pickup_preference === 'next_day',
      num_days,
      distance_miles,
      city: formData.city,
      zip: formData.zip,
      // Generator Workflow Unification: the Quote checkbox now controls the
      // EE Generator product in the cart. has_generator/generator_qty must NOT
      // create a separate legacy generator_fee_cents for new customer quotes.
      has_generator: false,
      generator_qty: 0,
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
