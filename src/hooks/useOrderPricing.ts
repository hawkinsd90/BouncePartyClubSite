import { useState, useCallback } from 'react';
import { calculatePrice, calculateDrivingDistance, type PricingRules } from '../lib/pricing';
import { formatOrderSummary, type OrderSummaryData } from '../lib/orderSummary';
import { HOME_BASE } from '../lib/constants';

interface RecalculatePricingParams {
  order: any;
  editedOrder: any;
  stagedItems: any[];
  discounts: any[];
  customFees: any[];
  customDepositCents: number | null;
  pricingRules: any;
  taxWaived?: boolean;
  travelFeeWaived?: boolean;
  sameDayPickupFeeWaived?: boolean;
  surfaceFeeWaived?: boolean;
  generatorFeeWaived?: boolean;
}

export function useOrderPricing() {
  const [updatedOrderSummary, setUpdatedOrderSummary] = useState<any>(null);
  const [calculatedPricing, setCalculatedPricing] = useState<any>(null);

  const recalculatePricing = useCallback(async ({
    order,
    editedOrder,
    stagedItems,
    discounts,
    customFees,
    customDepositCents,
    pricingRules,
    taxWaived = false,
    travelFeeWaived = false,
    sameDayPickupFeeWaived = false,
    surfaceFeeWaived = false,
    generatorFeeWaived = false,
  }: RecalculatePricingParams) => {
    if (!pricingRules) return;

    try {
      // calculateDrivingDistance will load Google Maps internally
      const addressChanged =
        editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
        editedOrder.address_city !== (order.addresses?.city || '') ||
        editedOrder.address_state !== (order.addresses?.state || '') ||
        editedOrder.address_zip !== (order.addresses?.zip || '');

      // Check if factors affecting same-day pickup fee have changed
      const locationTypeChanged = editedOrder.location_type !== order.location_type;
      const pickupPreferenceChanged = editedOrder.pickup_preference !== order.pickup_preference;
      const sameDayFeeFactorsChanged = locationTypeChanged || pickupPreferenceChanged;

      let distance_miles = 0;
      let useSavedTravelFee = false;
      let useSavedSameDayFee = false;

      if (!addressChanged && order.travel_fee_cents > 0) {
        distance_miles = parseFloat(order.travel_total_miles) || 0;
        useSavedTravelFee = true;
      } else {
        let lat = 0;
        let lng = 0;

        if (editedOrder.address_line1 && editedOrder.address_city && window.google?.maps) {
          try {
            const geocoder = new google.maps.Geocoder();
            const destination = `${editedOrder.address_line1}, ${editedOrder.address_city}, ${editedOrder.address_state} ${editedOrder.address_zip}`;
            const result = await geocoder.geocode({ address: destination });
            if (result.results && result.results[0]) {
              const location = result.results[0].geometry.location;
              lat = location.lat();
              lng = location.lng();
            }
          } catch (error) {
            console.error('Geocoding error:', error);
            lat = parseFloat(order.addresses?.lat) || 0;
            lng = parseFloat(order.addresses?.lng) || 0;
          }
        } else {
          lat = parseFloat(order.addresses?.lat) || 0;
          lng = parseFloat(order.addresses?.lng) || 0;
        }

        if (lat !== 0 && lng !== 0) {
          distance_miles = await calculateDrivingDistance(
            HOME_BASE.lat,
            HOME_BASE.lng,
            lat,
            lng
          );
        }

        if (distance_miles === 0 && order.travel_total_miles) {
          distance_miles = parseFloat(order.travel_total_miles) || 0;
        }
      }

      // Determine if we should use saved same-day fee (when relevant factors haven't changed)
      if (!sameDayFeeFactorsChanged && order.same_day_pickup_fee_cents !== null && order.same_day_pickup_fee_cents !== undefined) {
        useSavedSameDayFee = true;
      }

      const activeItems = stagedItems.filter(item => !item.is_deleted);
      const items = activeItems.map(item => ({
        unit_id: item.unit_id,
        qty: item.qty,
        wet_or_dry: item.wet_or_dry,
        unit_price_cents: item.unit_price_cents,
      }));

      const eventStartDate = new Date(editedOrder.event_date);
      const eventEndDate = new Date(editedOrder.event_end_date || editedOrder.event_date);
      const diffTime = Math.abs(eventEndDate.getTime() - eventStartDate.getTime());
      const numDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

      const rules: PricingRules = {
        base_radius_miles: parseFloat(pricingRules.base_radius_miles) || 20,
        included_city_list_json: pricingRules.included_city_list_json || [],
        per_mile_after_base_cents: pricingRules.per_mile_after_base_cents || 500,
        zone_overrides_json: pricingRules.zone_overrides_json || [],
        surface_sandbag_fee_cents: pricingRules.surface_sandbag_fee_cents || 0,
        residential_multiplier: parseFloat(pricingRules.residential_multiplier) || 1,
        commercial_multiplier: parseFloat(pricingRules.commercial_multiplier) || 1,
        same_day_pickup_fee_cents: pricingRules.same_day_pickup_fee_cents || 0,
        overnight_holiday_only: pricingRules.overnight_holiday_only || false,
        extra_day_pct: parseFloat(pricingRules.extra_day_pct) || 0,
        generator_price_cents: pricingRules.generator_price_cents || 0,
        generator_fee_single_cents: pricingRules.generator_fee_single_cents,
        generator_fee_multiple_cents: pricingRules.generator_fee_multiple_cents,
        deposit_per_unit_cents: pricingRules.deposit_per_unit_cents,
      };

      const priceBreakdown = calculatePrice({
        items,
        location_type: editedOrder.location_type as 'residential' | 'commercial',
        surface: editedOrder.surface as 'grass' | 'cement',
        can_use_stakes: editedOrder.surface === 'grass',
        overnight_allowed: editedOrder.pickup_preference === 'next_day',
        num_days: numDays,
        distance_miles,
        city: editedOrder.address_city,
        zip: editedOrder.address_zip,
        has_generator: (editedOrder.generator_qty || 0) > 0,
        generator_qty: editedOrder.generator_qty || 0,
        rules,
      });

      const activeItemsForDisplay = activeItems.map(item => ({
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

      // Store original amounts before waivers
      let originalTravelFeeCents = useSavedTravelFee ? order.travel_fee_cents : priceBreakdown.travel_fee_cents;
      const finalTravelMiles = useSavedTravelFee ? (parseFloat(order.travel_total_miles) || 0) : (priceBreakdown.travel_total_miles || 0);
      const originalSurfaceFeeCents = priceBreakdown.surface_fee_cents;
      const originalSameDayPickupFeeCents = useSavedSameDayFee ? (order.same_day_pickup_fee_cents || 0) : priceBreakdown.same_day_pickup_fee_cents;
      const originalGeneratorFeeCents = priceBreakdown.generator_fee_cents;

      // Calculate amounts for total (applying waivers)
      const finalTravelFeeCents = travelFeeWaived ? 0 : originalTravelFeeCents;
      const finalSurfaceFeeCents = surfaceFeeWaived ? 0 : originalSurfaceFeeCents;
      const finalSameDayPickupFeeCents = sameDayPickupFeeWaived ? 0 : originalSameDayPickupFeeCents;
      const finalGeneratorFeeCents = generatorFeeWaived ? 0 : originalGeneratorFeeCents;

      // Calculate tax based on waived fees
      const taxableAmount = priceBreakdown.subtotal_cents + finalTravelFeeCents + finalSurfaceFeeCents + finalGeneratorFeeCents;
      let finalTaxCents = Math.round(taxableAmount * 0.06);
      const originalTaxCents = finalTaxCents;

      if (taxWaived) {
        finalTaxCents = 0;
      }

      // Calculate total with all waivers applied
      let finalTotalCents = priceBreakdown.subtotal_cents + finalTravelFeeCents + finalSurfaceFeeCents + finalSameDayPickupFeeCents + finalGeneratorFeeCents + finalTaxCents;

      // Pass ORIGINAL amounts for display (so they show in fee list), total will be calculated correctly
      const updatedOrderData: OrderSummaryData = {
        items: activeItemsForDisplay,
        discounts,
        customFees,
        subtotal_cents: priceBreakdown.subtotal_cents,
        travel_fee_cents: originalTravelFeeCents,
        travel_total_miles: finalTravelMiles,
        surface_fee_cents: originalSurfaceFeeCents,
        same_day_pickup_fee_cents: originalSameDayPickupFeeCents,
        generator_fee_cents: originalGeneratorFeeCents,
        generator_qty: editedOrder.generator_qty || 0,
        tax_cents: originalTaxCents,
        tip_cents: order.tip_cents || 0,
        total_cents: finalTotalCents,
        deposit_due_cents: customDepositCents !== null ? customDepositCents : priceBreakdown.deposit_due_cents,
        deposit_paid_cents: order.deposit_paid_cents || 0,
        balance_due_cents: customDepositCents !== null ? finalTotalCents - customDepositCents : (finalTotalCents - priceBreakdown.deposit_due_cents),
        custom_deposit_cents: customDepositCents,
        pickup_preference: editedOrder.pickup_preference,
        event_date: editedOrder.event_date,
        event_end_date: editedOrder.event_end_date,
      };

      const summary = formatOrderSummary(updatedOrderData);

      setUpdatedOrderSummary(summary);

      setCalculatedPricing({
        subtotal_cents: priceBreakdown.subtotal_cents,
        generator_fee_cents: finalGeneratorFeeCents,
        travel_fee_cents: finalTravelFeeCents,
        travel_total_miles: finalTravelMiles,
        travel_base_radius_miles: priceBreakdown.travel_base_radius_miles,
        travel_chargeable_miles: priceBreakdown.travel_chargeable_miles,
        travel_per_mile_cents: priceBreakdown.travel_per_mile_cents,
        travel_is_flat_fee: priceBreakdown.travel_is_flat_fee,
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
      console.error('Error recalculating pricing:', error);
    }
  }, []);

  return {
    updatedOrderSummary,
    calculatedPricing,
    recalculatePricing,
  };
}
