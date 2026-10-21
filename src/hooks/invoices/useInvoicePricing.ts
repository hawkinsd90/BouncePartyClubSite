import { useState, useEffect, useMemo } from 'react';
import { calculatePrice, calculateDrivingDistance, isSameDayWeekdayDelivery, type PricingRules, type PriceBreakdown } from '../../lib/pricing';
import { HOME_BASE } from '../../lib/core/businessLocation';
import { calculateSalesTaxCents, composeOrderTotal, effectiveTaxEnabled } from '../../lib/pricing/orderMoney';

interface CartItem {
  unit_id: string;
  mode: 'dry' | 'water';
  adjusted_price_cents: number;
  qty: number;
}

interface EEProductItem {
  product_id: string;
  product_name: string;
  qty: number;
  unit_price_cents: number;
  is_new?: boolean;
  is_deleted?: boolean;
}

interface EventDetails {
  event_date: string;
  event_end_date: string;
  location_type: string;
  surface: string;
  can_stake: boolean;
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
  customFees: CustomFee[],
  taxWaived: boolean = false,
  eeProductItems: EEProductItem[] = [],
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
  }, [
    cartItems,
    pricingRules,
    eventDetails.event_date,
    eventDetails.event_end_date,
    eventDetails.location_type,
    eventDetails.surface,
    eventDetails.can_stake,
    eventDetails.generator_qty,
    eventDetails.pickup_preference,
    eventDetails.city,
    eventDetails.zip,
    eventDetails.lat,
    eventDetails.lng,
    discounts,
    customFees,
    eeProductItems,
  ]);

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
        can_use_stakes: eventDetails.can_stake,
        overnight_allowed: eventDetails.pickup_preference === 'next_day',
        num_days: numDays,
        distance_miles: distance,
        city: eventDetails.city,
        zip: eventDetails.zip,
        has_generator: false,
        generator_qty: 0,
        rules: pricingRules,
        is_same_day_weekday_delivery: isSameDayWeekdayDelivery(eventDetails.event_date, pricingRules.same_day_delivery_fee_days),
      });

      setPriceBreakdown(breakdown);
    } catch (error) {
      console.error('Error calculating pricing:', error);
    }
  }

  const subtotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.adjusted_price_cents * item.qty, 0)
      + eeProductItems.filter(i => !i.is_deleted).reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0),
    [cartItems, eeProductItems]
  );


  const automaticFees = useMemo(() => {
    const travelFee = priceBreakdown?.travel_fee_cents || 0;
    const surfaceFee = priceBreakdown?.surface_fee_cents || 0;
    const sameDayPickupFee = priceBreakdown?.same_day_pickup_fee_cents || 0;
    const sameDayWeekdayDeliveryFee = priceBreakdown?.same_day_weekday_delivery_fee_cents || 0;
    const generatorFee = priceBreakdown?.generator_fee_cents || 0;
    return travelFee + surfaceFee + sameDayPickupFee + sameDayWeekdayDeliveryFee + generatorFee;
  }, [priceBreakdown]);

  const actualSubtotal = useMemo(
    () => {
      const inflatableSubtotal = priceBreakdown?.subtotal_cents ?? 0;
      const eeSubtotal = eeProductItems
        .filter(i => !i.is_deleted)
        .reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);
      return inflatableSubtotal + eeSubtotal;
    },
    [priceBreakdown, eeProductItems]
  );

  // The order's money, by the one set of rules every screen uses (orderMoney): discount -> taxable amount -> tax (6%, rounded
  // once, same-day pickup and delivery fees not taxed) -> total.
  const money = useMemo(() => {
    const components = {
      subtotal_cents: actualSubtotal,
      travel_fee_cents: priceBreakdown?.travel_fee_cents,
      surface_fee_cents: priceBreakdown?.surface_fee_cents,
      same_day_pickup_fee_cents: priceBreakdown?.same_day_pickup_fee_cents,
      same_day_weekday_delivery_fee_cents: priceBreakdown?.same_day_weekday_delivery_fee_cents,
      generator_fee_cents: priceBreakdown?.generator_fee_cents,
    };
    const beforeTax = composeOrderTotal(components, discounts, customFees, 0);
    const enabled = effectiveTaxEnabled({ applyTaxesByDefault: pricingRules?.apply_taxes_by_default, taxWaived });
    const tax = enabled ? calculateSalesTaxCents(beforeTax.taxableAfterDiscountCents) : 0;
    return { beforeTax, tax, total: composeOrderTotal(components, discounts, customFees, tax).totalCents };
  }, [actualSubtotal, priceBreakdown, discounts, customFees, pricingRules, taxWaived]);

  const discountTotal = money.beforeTax.discountCents;
  const customFeesTotal = money.beforeTax.customFeesCents;
  const taxableAmount = money.beforeTax.taxableAfterDiscountCents;
  const taxCents = money.tax;
  const totalCents = money.total;

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
