import { useState, useEffect, useMemo } from 'react';
import { calculatePrice, calculateDrivingDistance, type PricingRules, type PriceBreakdown } from '../lib/pricing';
import { HOME_BASE } from '../lib/constants';

interface CartItem {
  unit_id: string;
  mode: 'dry' | 'water';
  adjusted_price_cents: number;
  qty: number;
}

interface EventDetails {
  event_date: string;
  event_end_date: string;
  location_type: string;
  surface: string;
  generator_qty: number;
  pickup_preference: string;
  city: string;
  zip: string;
  lat: number;
  lng: number;
}

interface Discount {
  name: string;
  amount_cents: number;
  percentage: number;
}

interface CustomFee {
  name: string;
  amount_cents: number;
}

export function useInvoicePricing(
  cartItems: CartItem[],
  eventDetails: EventDetails,
  pricingRules: PricingRules | null,
  discounts: Discount[],
  customFees: CustomFee[]
) {
  const [priceBreakdown, setPriceBreakdown] = useState<PriceBreakdown | null>(null);

  useEffect(() => {
    if (
      cartItems.length > 0 &&
      pricingRules &&
      eventDetails.zip &&
      eventDetails.lat &&
      eventDetails.lng &&
      eventDetails.event_date &&
      eventDetails.event_end_date
    ) {
      calculatePricing();
    }
  }, [cartItems, pricingRules, eventDetails, discounts, customFees]);

  async function calculatePricing() {
    if (!pricingRules) return;

    try {
      // calculateDrivingDistance will load Google Maps internally
      const distance = await calculateDrivingDistance(
        HOME_BASE.lat,
        HOME_BASE.lng,
        eventDetails.lat,
        eventDetails.lng
      );

      const eventStartDate = new Date(eventDetails.event_date);
      const eventEndDate = new Date(eventDetails.event_end_date);
      const diffTime = Math.abs(eventEndDate.getTime() - eventStartDate.getTime());
      const numDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

      const items = cartItems.map(item => ({
        unit_id: item.unit_id,
        wet_or_dry: item.mode,
        unit_price_cents: item.adjusted_price_cents,
        qty: item.qty,
      }));

      const breakdown = calculatePrice({
        items,
        location_type: eventDetails.location_type as 'residential' | 'commercial',
        surface: eventDetails.surface as 'grass' | 'cement',
        can_use_stakes: eventDetails.surface === 'grass',
        overnight_allowed: eventDetails.pickup_preference === 'next_day',
        num_days: numDays,
        distance_miles: distance,
        city: eventDetails.city,
        zip: eventDetails.zip,
        has_generator: eventDetails.generator_qty > 0,
        generator_qty: eventDetails.generator_qty,
        rules: pricingRules,
      });

      setPriceBreakdown(breakdown);
    } catch (error) {
      console.error('Error calculating pricing:', error);
    }
  }

  const subtotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.adjusted_price_cents * item.qty, 0),
    [cartItems]
  );

  const discountTotal = useMemo(
    () =>
      discounts.reduce((sum, d) => {
        if (d.amount_cents > 0) {
          return sum + d.amount_cents;
        } else if (d.percentage > 0) {
          return sum + Math.round(subtotal * (d.percentage / 100));
        }
        return sum;
      }, 0),
    [discounts, subtotal]
  );

  const customFeesTotal = useMemo(
    () => customFees.reduce((sum, f) => sum + f.amount_cents, 0),
    [customFees]
  );

  const automaticFees = useMemo(() => {
    const travelFee = priceBreakdown?.travel_fee_cents || 0;
    const surfaceFee = priceBreakdown?.surface_fee_cents || 0;
    const sameDayPickupFee = priceBreakdown?.same_day_pickup_fee_cents || 0;
    const generatorFee = priceBreakdown?.generator_fee_cents || 0;
    return travelFee + surfaceFee + sameDayPickupFee + generatorFee;
  }, [priceBreakdown]);

  const actualSubtotal = useMemo(
    () => priceBreakdown?.subtotal_cents || subtotal,
    [priceBreakdown, subtotal]
  );

  const taxableAmount = useMemo(
    () => Math.max(0, actualSubtotal + automaticFees - discountTotal + customFeesTotal),
    [actualSubtotal, automaticFees, discountTotal, customFeesTotal]
  );

  const taxCents = useMemo(() => Math.round(taxableAmount * 0.06), [taxableAmount]);

  const totalCents = useMemo(
    () => actualSubtotal + automaticFees - discountTotal + customFeesTotal + taxCents,
    [actualSubtotal, automaticFees, discountTotal, customFeesTotal, taxCents]
  );

  const defaultDeposit = useMemo(
    () => {
      const depositPerUnit = pricingRules?.deposit_per_unit_cents || 5000;
      return cartItems.reduce((sum, item) => sum + item.qty * depositPerUnit, 0);
    },
    [cartItems, pricingRules]
  );

  return {
    priceBreakdown,
    subtotal,
    discountTotal,
    customFeesTotal,
    automaticFees,
    actualSubtotal,
    taxableAmount,
    taxCents,
    totalCents,
    defaultDeposit,
  };
}
