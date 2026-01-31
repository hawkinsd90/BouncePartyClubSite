import { useState, useCallback } from 'react';
import { calculatePrice, calculateDrivingDistance, type PricingRules } from '../lib/pricing';
import { formatOrderSummary, type OrderSummaryData } from '../lib/orderSummary';
import { HOME_BASE } from '../lib/constants';

interface PricingItem {
  unit_id: string;
  unit_name: string;
  qty: number;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  is_new?: boolean;
  is_deleted?: boolean;
}

interface FeeWaivers {
  taxWaived?: boolean;
  travelFeeWaived?: boolean;
  sameDayPickupFeeWaived?: boolean;
  surfaceFeeWaived?: boolean;
  generatorFeeWaived?: boolean;
}

interface CalculatePricingParams {
  items: PricingItem[];
  eventDetails: {
    event_date: string;
    event_end_date: string;
    location_type: 'residential' | 'commercial';
    surface: 'grass' | 'cement';
    pickup_preference: string;
    generator_qty: number;
    address_line1: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    lat?: number;
    lng?: number;
  };
  discounts: any[];
  customFees: any[];
  customDepositCents: number | null;
  pricingRules: PricingRules;
  feeWaivers?: FeeWaivers;
  existingOrder?: {
    travel_fee_cents?: number;
    travel_total_miles?: number;
    same_day_pickup_fee_cents?: number;
    location_type?: string;
    pickup_preference?: string;
    addresses?: {
      line1: string;
      city: string;
      state: string;
      zip: string;
      lat?: string;
      lng?: string;
    };
    tip_cents?: number;
    deposit_paid_cents?: number;
  };
}

interface CalculatedPricing {
  subtotal_cents: number;
  generator_fee_cents: number;
  travel_fee_cents: number;
  travel_total_miles: number;
  travel_base_radius_miles?: number;
  travel_chargeable_miles?: number;
  travel_per_mile_cents?: number;
  travel_is_flat_fee?: boolean;
  travel_fee_display_name?: string;
  distance_miles: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  custom_fees_total_cents: number;
  discount_total_cents: number;
  tax_cents: number;
  total_cents: number;
  deposit_due_cents: number;
  balance_due_cents: number;
}

export function usePricing() {
  const [orderSummary, setOrderSummary] = useState<any>(null);
  const [calculatedPricing, setCalculatedPricing] = useState<CalculatedPricing | null>(null);

  const calculatePricing = useCallback(async ({
    items,
    eventDetails,
    discounts,
    customFees,
    customDepositCents,
    pricingRules,
    feeWaivers = {},
    existingOrder,
  }: CalculatePricingParams) => {
    const {
      taxWaived = false,
      travelFeeWaived = false,
      sameDayPickupFeeWaived = false,
      surfaceFeeWaived = false,
      generatorFeeWaived = false,
    } = feeWaivers;

    try {
      // Check if address has changed (for order edits)
      const addressChanged = existingOrder
        ? eventDetails.address_line1 !== (existingOrder.addresses?.line1 || '') ||
          eventDetails.address_city !== (existingOrder.addresses?.city || '') ||
          eventDetails.address_state !== (existingOrder.addresses?.state || '') ||
          eventDetails.address_zip !== (existingOrder.addresses?.zip || '')
        : true;

      // Check if factors affecting same-day pickup fee have changed
      const locationTypeChanged = existingOrder
        ? eventDetails.location_type !== existingOrder.location_type
        : false;
      const pickupPreferenceChanged = existingOrder
        ? eventDetails.pickup_preference !== existingOrder.pickup_preference
        : false;
      const sameDayFeeFactorsChanged = locationTypeChanged || pickupPreferenceChanged;

      let distance_miles = 0;
      let useSavedTravelFee = false;
      let useSavedSameDayFee = false;

      // Try to use saved travel fee if address hasn't changed
      if (existingOrder && !addressChanged && existingOrder.travel_fee_cents && existingOrder.travel_fee_cents > 0) {
        distance_miles = parseFloat(String(existingOrder.travel_total_miles)) || 0;
        useSavedTravelFee = true;
      } else {
        // Calculate distance from coordinates or geocode
        let lat = eventDetails.lat || 0;
        let lng = eventDetails.lng || 0;

        if ((!lat || !lng) && eventDetails.address_line1 && eventDetails.address_city && window.google?.maps) {
          try {
            const geocoder = new google.maps.Geocoder();
            const destination = `${eventDetails.address_line1}, ${eventDetails.address_city}, ${eventDetails.address_state} ${eventDetails.address_zip}`;
            const result = await geocoder.geocode({ address: destination });
            if (result.results && result.results[0]) {
              const location = result.results[0].geometry.location;
              lat = location.lat();
              lng = location.lng();
            }
          } catch (error) {
            console.error('Geocoding error:', error);
            if (existingOrder?.addresses) {
              lat = parseFloat(existingOrder.addresses.lat || '0') || 0;
              lng = parseFloat(existingOrder.addresses.lng || '0') || 0;
            }
          }
        }

        if (lat !== 0 && lng !== 0) {
          distance_miles = await calculateDrivingDistance(
            HOME_BASE.lat,
            HOME_BASE.lng,
            lat,
            lng
          );
        }

        // Fall back to existing order's distance if calculation fails
        if (distance_miles === 0 && existingOrder?.travel_total_miles) {
          distance_miles = parseFloat(String(existingOrder.travel_total_miles)) || 0;
        }
      }

      // Determine if we should use saved same-day fee
      if (existingOrder && !sameDayFeeFactorsChanged && existingOrder.same_day_pickup_fee_cents !== null && existingOrder.same_day_pickup_fee_cents !== undefined) {
        useSavedSameDayFee = true;
      }

      // Filter out deleted items for existing orders
      const activeItems = items.filter(item => !item.is_deleted);

      const pricingItems = activeItems.map(item => ({
        unit_id: item.unit_id,
        qty: item.qty,
        wet_or_dry: item.wet_or_dry,
        unit_price_cents: item.unit_price_cents,
      }));

      // Calculate number of days
      const eventStartDate = new Date(eventDetails.event_date);
      const eventEndDate = new Date(eventDetails.event_end_date || eventDetails.event_date);
      const diffTime = Math.abs(eventEndDate.getTime() - eventStartDate.getTime());
      const numDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

      // Calculate pricing
      const priceBreakdown = calculatePrice({
        items: pricingItems,
        location_type: eventDetails.location_type,
        surface: eventDetails.surface,
        can_use_stakes: eventDetails.surface === 'grass',
        overnight_allowed: eventDetails.pickup_preference === 'next_day',
        num_days: numDays,
        distance_miles,
        city: eventDetails.address_city,
        zip: eventDetails.address_zip,
        has_generator: (eventDetails.generator_qty || 0) > 0,
        generator_qty: eventDetails.generator_qty || 0,
        rules: pricingRules,
      });

      // Prepare items for display
      const displayItems = activeItems.map(item => ({
        unit_id: item.unit_id,
        qty: item.qty,
        wet_or_dry: item.wet_or_dry,
        unit_price_cents: item.unit_price_cents,
        is_new: item.is_new || false,
        units: {
          name: item.unit_name,
          price_dry_cents: item.wet_or_dry === 'dry' ? item.unit_price_cents : 0,
          price_water_cents: item.wet_or_dry === 'water' ? item.unit_price_cents : 0,
        }
      }));

      // Store original amounts before waivers (for display)
      const originalTravelFeeCents = useSavedTravelFee && existingOrder?.travel_fee_cents
        ? existingOrder.travel_fee_cents
        : priceBreakdown.travel_fee_cents;
      const finalTravelMiles = useSavedTravelFee && existingOrder?.travel_total_miles
        ? parseFloat(String(existingOrder.travel_total_miles)) || 0
        : priceBreakdown.travel_total_miles || 0;
      const originalSurfaceFeeCents = priceBreakdown.surface_fee_cents;
      const originalSameDayPickupFeeCents = useSavedSameDayFee && existingOrder?.same_day_pickup_fee_cents
        ? existingOrder.same_day_pickup_fee_cents
        : priceBreakdown.same_day_pickup_fee_cents;
      const originalGeneratorFeeCents = priceBreakdown.generator_fee_cents;

      // Apply waivers for total calculation
      const finalTravelFeeCents = travelFeeWaived ? 0 : originalTravelFeeCents;
      const finalSurfaceFeeCents = surfaceFeeWaived ? 0 : originalSurfaceFeeCents;
      const finalSameDayPickupFeeCents = sameDayPickupFeeWaived ? 0 : originalSameDayPickupFeeCents;
      const finalGeneratorFeeCents = generatorFeeWaived ? 0 : originalGeneratorFeeCents;

      // Calculate tax based on waived fees and apply_taxes_by_default setting
      const shouldApplyTaxesByDefault = pricingRules.apply_taxes_by_default ?? true;
      const taxableAmount = priceBreakdown.subtotal_cents + finalTravelFeeCents + finalSurfaceFeeCents + finalGeneratorFeeCents;

      // Calculate the potential tax amount (always calculated for display purposes)
      const calculatedTaxCents = Math.round(taxableAmount * 0.06);

      // Determine final tax based on default setting and per-order override
      // The tax_waived flag acts as an override toggle:
      // - When apply_taxes_by_default is TRUE: taxWaived=false means apply (default), taxWaived=true means waive (override)
      // - When apply_taxes_by_default is FALSE: taxWaived=false means don't apply (default), taxWaived=true means apply (override)
      let finalTaxCents: number;
      if (shouldApplyTaxesByDefault) {
        // Taxes applied by default - taxWaived=true removes them
        finalTaxCents = taxWaived ? 0 : calculatedTaxCents;
      } else {
        // Taxes NOT applied by default - taxWaived=true adds them (acts as override to apply)
        finalTaxCents = taxWaived ? calculatedTaxCents : 0;
      }

      // Store calculated tax for display
      const originalTaxCents = calculatedTaxCents;

      // Calculate total with all waivers applied
      const finalTotalCents = priceBreakdown.subtotal_cents + finalTravelFeeCents + finalSurfaceFeeCents + finalSameDayPickupFeeCents + finalGeneratorFeeCents + finalTaxCents;

      // Calculate deposit
      const depositDueCents = customDepositCents !== null ? customDepositCents : priceBreakdown.deposit_due_cents;
      const balanceDueCents = finalTotalCents - depositDueCents;

      // Build order summary data (with ORIGINAL amounts for display)
      const orderData: OrderSummaryData = {
        items: displayItems,
        discounts,
        customFees,
        subtotal_cents: priceBreakdown.subtotal_cents,
        travel_fee_cents: originalTravelFeeCents,
        travel_total_miles: finalTravelMiles,
        surface_fee_cents: originalSurfaceFeeCents,
        same_day_pickup_fee_cents: originalSameDayPickupFeeCents,
        generator_fee_cents: originalGeneratorFeeCents,
        generator_qty: eventDetails.generator_qty || 0,
        tax_cents: originalTaxCents,
        tip_cents: existingOrder?.tip_cents || 0,
        total_cents: finalTotalCents,
        deposit_due_cents: depositDueCents,
        deposit_paid_cents: existingOrder?.deposit_paid_cents || 0,
        balance_due_cents: balanceDueCents,
        custom_deposit_cents: customDepositCents,
        pickup_preference: eventDetails.pickup_preference,
        event_date: eventDetails.event_date,
        event_end_date: eventDetails.event_end_date,
      };

      const summary = formatOrderSummary(orderData);

      setOrderSummary(summary);

      setCalculatedPricing({
        subtotal_cents: priceBreakdown.subtotal_cents,
        generator_fee_cents: finalGeneratorFeeCents,
        travel_fee_cents: finalTravelFeeCents,
        travel_total_miles: finalTravelMiles,
        travel_base_radius_miles: priceBreakdown.travel_base_radius_miles,
        travel_chargeable_miles: priceBreakdown.travel_chargeable_miles,
        travel_per_mile_cents: priceBreakdown.travel_per_mile_cents,
        travel_is_flat_fee: priceBreakdown.travel_is_flat_fee,
        travel_fee_display_name: priceBreakdown.travel_fee_display_name,
        distance_miles: finalTravelMiles,
        surface_fee_cents: finalSurfaceFeeCents,
        same_day_pickup_fee_cents: finalSameDayPickupFeeCents,
        custom_fees_total_cents: summary.customFees.reduce((sum, f) => sum + f.amount, 0),
        discount_total_cents: summary.discounts.reduce((sum, d) => sum + d.amount, 0),
        tax_cents: finalTaxCents,
        total_cents: summary.total,
        deposit_due_cents: summary.depositDue,
        balance_due_cents: summary.balanceDue,
      });
    } catch (error) {
      console.error('Error calculating pricing:', error);
    }
  }, []);

  return {
    orderSummary,
    calculatedPricing,
    calculatePricing,
  };
}
