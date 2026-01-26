import { useState, useEffect, useCallback } from 'react';
import { MapPin, Calculator, Info } from 'lucide-react';
import { AddressAutocomplete } from '../order/AddressAutocomplete';
import { TravelFeeBreakdown } from '../shared/TravelFeeBreakdown';
import { calculateTravelFee, type TravelFeeCalculationResult } from '../../lib/travelFeeCalculator';
import { loadGoogleMapsAPI } from '../../lib/googleMaps';
import { HOME_BASE } from '../../lib/constants';
import { formatCurrency } from '../../lib/pricing';
import { supabase } from '../../lib/supabase';
import { notifyError } from '../../lib/notifications';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface PricingRules {
  base_radius_miles: number;
  per_mile_after_base_cents: number;
  zone_overrides_json?: Array<{
    zip: string;
    flat_cents: number;
  }> | null;
  included_city_list_json?: string[] | null;
  included_cities?: string[] | null;
}

export function TravelCalculator() {
  const [address, setAddress] = useState('');
  const [selectedAddress, setSelectedAddress] = useState<any>(null);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<TravelFeeCalculationResult | null>(null);
  const [pricingRules, setPricingRules] = useState<PricingRules | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPricingRules();
    loadGoogleMapsAPI();
  }, []);

  async function loadPricingRules() {
    try {
      const { data, error } = await supabase
        .from('pricing_rules')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('Pricing rules not found');

      setPricingRules(data);
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function calculateTravelFeeForAddress() {
    if (!selectedAddress || !pricingRules) {
      notifyError('Please select a valid address');
      return;
    }

    if (!selectedAddress.lat || !selectedAddress.lng) {
      notifyError('Selected address does not have coordinates');
      return;
    }

    setCalculating(true);
    try {
      const includedCities = pricingRules.included_cities || pricingRules.included_city_list_json || [];
      const zoneOverrides = pricingRules.zone_overrides_json || [];

      const travelFeeResult = await calculateTravelFee({
        city: selectedAddress.city || '',
        zip: selectedAddress.zip || '',
        lat: selectedAddress.lat,
        lng: selectedAddress.lng,
        baseRadiusMiles: pricingRules.base_radius_miles,
        perMileAfterBaseCents: pricingRules.per_mile_after_base_cents,
        includedCities,
        zoneOverrides,
      });

      setResult(travelFeeResult);
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setCalculating(false);
    }
  }

  const handleAddressChange = useCallback((addr: string) => {
    console.log('[TravelCalculator] Address changed (user typing):', addr);
    // Clear the address string, keep selectedAddress for now
    setAddress(addr);
    // If user types something, we'll clear selectedAddress in the next effect
    // But we need to check if they actually changed the value vs autocomplete setting it
    setResult(null);
  }, []);

  const handleAddressSelect = useCallback((addr: any) => {
    console.log('[TravelCalculator] Address selected with full data:', addr);
    // Update both address and selectedAddress
    setAddress(addr.formatted_address);
    setSelectedAddress(addr);
    setResult(null);
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <LoadingSpinner />
      </div>
    );
  }

  if (!pricingRules) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <p className="text-red-600">Unable to load pricing rules. Please check your settings.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 flex items-center">
          <Calculator className="w-7 h-7 mr-3 text-blue-600" />
          Travel Fee Calculator
        </h2>
        <p className="text-slate-600 mt-2">
          Calculate travel fees for phone estimates by entering a customer address.
        </p>
      </div>

      <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-900">
            <p className="font-bold mb-2">Current Pricing Rules:</p>
            <ul className="space-y-1">
              <li>Base radius: <strong>{pricingRules.base_radius_miles} miles</strong> from home base</li>
              <li>Per mile rate: <strong>{formatCurrency(pricingRules.per_mile_after_base_cents)}/mile</strong> beyond base radius</li>
              {(pricingRules.included_cities || pricingRules.included_city_list_json) &&
               (pricingRules.included_cities || pricingRules.included_city_list_json || []).length > 0 && (
                <li>Included cities (FREE): <strong>{(pricingRules.included_cities || pricingRules.included_city_list_json || []).join(', ')}</strong></li>
              )}
              {pricingRules.zone_overrides_json && pricingRules.zone_overrides_json.length > 0 && (
                <li>
                  Flat rate zones: {pricingRules.zone_overrides_json.map(z =>
                    `ZIP ${z.zip} (${formatCurrency(z.flat_cents)})`
                  ).join(', ')}
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-slate-50 rounded-xl p-6 mb-6">
        <div className="mb-4">
          <label className="block text-sm font-bold text-slate-900 mb-2">
            <MapPin className="w-4 h-4 inline mr-1" />
            Customer Address
          </label>
          <AddressAutocomplete
            value={address}
            onChange={handleAddressChange}
            onSelect={handleAddressSelect}
            placeholder="Enter full address to calculate travel fee..."
          />
          {selectedAddress && (
            <div className="mt-2 p-2 bg-green-100 border border-green-300 rounded text-xs text-green-800">
              ✓ Address selected: {selectedAddress.formatted_address}
            </div>
          )}
          {!selectedAddress && address && (
            <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800">
              ⚠ Please select an address from the dropdown
            </div>
          )}
        </div>

        <button
          onClick={calculateTravelFeeForAddress}
          disabled={!selectedAddress || calculating}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl"
        >
          {calculating ? (
            <span className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
              Calculating...
            </span>
          ) : (
            <span className="flex items-center justify-center">
              <Calculator className="w-5 h-5 mr-2" />
              Calculate Travel Fee
            </span>
          )}
        </button>
      </div>

      {result && (
        <TravelFeeBreakdown
          distanceMiles={result.distance_miles}
          baseRadiusMiles={result.base_radius_miles}
          chargeableMiles={result.chargeable_miles}
          ratePerMileCents={result.per_mile_cents}
          travelFeeCents={result.travel_fee_cents}
          showDetailedBreakdown={true}
          isIncludedCity={result.is_included_city}
          isFlatFee={result.is_flat_fee}
          zoneName={result.zone_name}
          displayName={result.display_name}
        />
      )}
    </div>
  );
}
