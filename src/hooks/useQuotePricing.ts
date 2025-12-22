import { useState, useEffect } from 'react';
import { calculatePrice, calculateDrivingDistance, type PricingRules } from '../lib/pricing';
import { HOME_BASE } from '../lib/constants';
import type { QuoteFormData } from './useQuoteForm';

interface CartItem {
  unit_id: string;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  qty: number;
}

const PRICE_BREAKDOWN_STORAGE_KEY = 'bpc_price_breakdown';

export function useQuotePricing(cart: CartItem[], formData: QuoteFormData, pricingRules: PricingRules | null) {
  const [priceBreakdown, setPriceBreakdown] = useState<any>(null);

  useEffect(() => {
    if (cart.length > 0 && pricingRules && formData.zip && formData.lat && formData.lng) {
      calculatePricing();
    }
  }, [cart, pricingRules, formData]);

  async function calculatePricing() {
    if (!pricingRules) return;

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
      location_type: formData.location_type,
      surface: formData.can_stake ? 'grass' : 'cement',
      can_use_stakes: formData.can_stake,
      overnight_allowed: formData.pickup_preference === 'next_day',
      num_days,
      distance_miles,
      city: formData.city,
      zip: formData.zip,
      has_generator: formData.has_generator || formData.generator_qty > 0,
      generator_qty: formData.generator_qty || 0,
      rules: pricingRules,
    });

    setPriceBreakdown(breakdown);
  }

  function savePriceBreakdown() {
    if (priceBreakdown) {
      localStorage.setItem(PRICE_BREAKDOWN_STORAGE_KEY, JSON.stringify(priceBreakdown));
    }
  }

  return {
    priceBreakdown,
    savePriceBreakdown,
  };
}
