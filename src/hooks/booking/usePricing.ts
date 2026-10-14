import { useState, useCallback, useRef } from 'react';
import { calculateDrivingDistance, isSameDayWeekdayDelivery } from '../../lib/pricing';
import { formatOrderSummary } from '../../lib/orders/orderSummaryLoader';
import { HOME_BASE } from '../../lib/core/businessLocation';
import {
  calculateOrderPricing,
  shouldReuseSavedTravel,
  type CalculatedPricing,
  type CalculatePricingParams,
} from '../../lib/pricing/orderPricingCalculation';

export type PricingCalculationResult =
  | { status: 'success' }
  | { status: 'failed' }
  | { status: 'superseded' };

// The deterministic pricing math lives in lib/orderPricingCalculation.ts. This hook owns what is
// not deterministic: React state, the stale-result guard and revision, the Google geocoding and
// driving-distance lookups, and the display formatting.
export function usePricing() {
  const [orderSummary, setOrderSummary] = useState<any>(null);
  const [calculatedPricing, setCalculatedPricing] = useState<CalculatedPricing | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [pricingPending, setPricingPending] = useState(false);
  const [lastPricedRevision, setLastPricedRevision] = useState<string | null>(null);
  const pricingCalculationIdRef = useRef(0);

  const calculatePricing = useCallback(async ({
    items,
    eeProductItems = [],
    eventDetails,
    discounts,
    customFees,
    customDepositCents,
    customSetupFeeCents = null,
    storedSetupFeeCents = null,
    setupFeeBasisChanged = false,
    equipmentBasisChanged = false,
    pricingRules,
    feeWaivers = {},
    existingOrder,
    revision,
  }: CalculatePricingParams & { revision?: string }) => {
    // Clear stale pricing immediately so an old result is never treated as
    // current while a new calculation is in progress.
    const calculationId = ++pricingCalculationIdRef.current;
    const isLatest = () => calculationId === pricingCalculationIdRef.current;
    setCalculatedPricing(null);
    setPricingError(null);
    setPricingPending(true);

    try {
      let distance_miles = 0;

      // Try to use saved travel fee if address hasn't changed
      if (shouldReuseSavedTravel(eventDetails, existingOrder)) {
        distance_miles = parseFloat(String(existingOrder?.travel_total_miles)) || 0;
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

      const calculation = calculateOrderPricing(
        {
          items,
          eeProductItems,
          eventDetails,
          discounts,
          customFees,
          customDepositCents,
          customSetupFeeCents,
          storedSetupFeeCents,
          setupFeeBasisChanged,
          equipmentBasisChanged,
          pricingRules,
          feeWaivers,
          existingOrder,
        },
        { distanceMiles: distance_miles, isSameDayWeekdayDelivery },
      );

      if (calculation.status === 'deposit_config_error') {
        if (isLatest()) {
          setCalculatedPricing(null);
          setPricingError(calculation.error);
          setPricingPending(false);
          return { status: 'failed' } as PricingCalculationResult;
        }
        return { status: 'superseded' } as PricingCalculationResult;
      }
      if (isLatest()) setPricingError(null);
      if (isLatest()) setPricingPending(false);
      if (isLatest() && revision) setLastPricedRevision(revision);

      const summary = formatOrderSummary(calculation.orderData);

      if (isLatest()) {
        setOrderSummary(summary);
        setPricingPending(false);
        if (revision) setLastPricedRevision(revision);

        setCalculatedPricing(calculation.calculatedPricing);
        return { status: 'success' } as PricingCalculationResult;
      }
      return { status: 'superseded' } as PricingCalculationResult;
    } catch (error) {
      console.error('Error calculating pricing:', error);
      if (isLatest()) {
        setCalculatedPricing(null);
        setPricingError('Unable to calculate pricing. Please review the order and try again.');
        setPricingPending(false);
        return { status: 'failed' } as PricingCalculationResult;
      }
      return { status: 'superseded' } as PricingCalculationResult;
    }
  }, []);

  return {
    orderSummary,
    calculatedPricing,
    pricingError,
    pricingPending,
    lastPricedRevision,
    calculatePricing,
  };
}
