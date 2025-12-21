import { useState, useEffect } from 'react';
import { MapPin, Calculator, DollarSign, Info } from 'lucide-react';
import { AddressAutocomplete } from '../order/AddressAutocomplete';
import { loadGoogleMapsAPI } from '../../lib/googleMaps';
import { HOME_BASE } from '../../lib/constants';
import { formatCurrency } from '../../lib/pricing';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/notifications';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface PricingRules {
  base_radius_miles: number;
  per_mile_after_base_cents: number;
  zone_overrides?: Array<{
    zone_name: string;
    flat_cents: number;
  }> | null;
  included_cities?: string[] | null;
}

interface TravelFeeResult {
  distance_miles: number;
  chargeable_miles: number;
  travel_fee_cents: number;
  is_flat_fee: boolean;
  zone_name?: string;
  is_included_city: boolean;
  city_name?: string;
}

export function TravelCalculator() {
  const [address, setAddress] = useState('');
  const [selectedAddress, setSelectedAddress] = useState<any>(null);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<TravelFeeResult | null>(null);
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
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function calculateTravelFee() {
    if (!selectedAddress || !pricingRules) {
      notify('Please select a valid address', 'error');
      return;
    }

    setCalculating(true);
    try {
      await loadGoogleMapsAPI();

      const service = new google.maps.DistanceMatrixService();
      const response = await new Promise<google.maps.DistanceMatrixResponse>((resolve, reject) => {
        service.getDistanceMatrix(
          {
            origins: [{ lat: HOME_BASE.lat, lng: HOME_BASE.lng }],
            destinations: [selectedAddress.formatted_address],
            travelMode: google.maps.TravelMode.DRIVING,
            unitSystem: google.maps.UnitSystem.IMPERIAL,
          },
          (result, status) => {
            if (status === 'OK') {
              resolve(result!);
            } else {
              reject(new Error(`Distance calculation failed: ${status}`));
            }
          }
        );
      });

      const element = response.rows[0]?.elements[0];
      if (!element || element.status !== 'OK') {
        throw new Error('Unable to calculate distance');
      }

      const distance_miles = element.distance.value / 1609.34;

      const city = selectedAddress.city?.toLowerCase() || '';
      const is_included_city = pricingRules.included_cities?.some(
        (includedCity) => city.includes(includedCity.toLowerCase())
      ) || false;

      const zone = pricingRules.zone_overrides?.find((z) =>
        city.includes(z.zone_name.toLowerCase())
      );

      let travel_fee_cents = 0;
      let chargeable_miles = 0;
      let is_flat_fee = false;
      let zone_name = undefined;

      if (zone) {
        travel_fee_cents = zone.flat_cents;
        is_flat_fee = true;
        zone_name = zone.zone_name;
      } else if (is_included_city) {
        travel_fee_cents = 0;
      } else if (distance_miles > pricingRules.base_radius_miles) {
        chargeable_miles = distance_miles - pricingRules.base_radius_miles;
        travel_fee_cents = Math.round(chargeable_miles * pricingRules.per_mile_after_base_cents);
      }

      setResult({
        distance_miles,
        chargeable_miles,
        travel_fee_cents,
        is_flat_fee,
        zone_name,
        is_included_city,
        city_name: city,
      });
    } catch (error: any) {
      notify(error.message, 'error');
    } finally {
      setCalculating(false);
    }
  }

  function handleAddressChange(addr: string) {
    setAddress(addr);
    setResult(null);
  }

  function handleAddressSelect(addr: any) {
    setSelectedAddress(addr);
    setResult(null);
  }

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
              <li>Base radius: <strong>{pricingRules.base_radius_miles} miles</strong> from {HOME_BASE.address}</li>
              <li>Per mile rate: <strong>{formatCurrency(pricingRules.per_mile_after_base_cents)}/mile</strong> beyond base radius</li>
              {pricingRules.included_cities && pricingRules.included_cities.length > 0 && (
                <li>Included cities (FREE): <strong>{pricingRules.included_cities.join(', ')}</strong></li>
              )}
              {pricingRules.zone_overrides && pricingRules.zone_overrides.length > 0 && (
                <li>
                  Special zones: {pricingRules.zone_overrides.map(z =>
                    `${z.zone_name} (${formatCurrency(z.flat_cents)})`
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
        </div>

        <button
          onClick={calculateTravelFee}
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
        <div className="border-2 border-green-200 bg-green-50 rounded-xl p-6">
          <h3 className="text-xl font-bold text-green-900 mb-4 flex items-center">
            <DollarSign className="w-6 h-6 mr-2" />
            Travel Fee Breakdown
          </h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-green-200">
              <span className="text-slate-700">Total Distance from Home Base:</span>
              <span className="font-bold text-slate-900">{result.distance_miles.toFixed(1)} miles</span>
            </div>

            {result.is_included_city && (
              <div className="bg-green-100 border-2 border-green-300 rounded-lg p-4">
                <p className="font-bold text-green-900 text-lg">FREE DELIVERY</p>
                <p className="text-sm text-green-800 mt-1">
                  This address is in an included city zone.
                </p>
              </div>
            )}

            {result.is_flat_fee && result.zone_name && (
              <div className="bg-amber-100 border-2 border-amber-300 rounded-lg p-4">
                <p className="font-bold text-amber-900">SPECIAL ZONE: {result.zone_name}</p>
                <p className="text-sm text-amber-800 mt-1">
                  Flat rate zone pricing applies.
                </p>
              </div>
            )}

            {!result.is_included_city && !result.is_flat_fee && (
              <>
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-700">Base Radius (Free):</span>
                  <span className="font-bold text-slate-900">{pricingRules.base_radius_miles} miles</span>
                </div>

                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-700">Miles Beyond Base:</span>
                  <span className="font-bold text-slate-900">{result.chargeable_miles.toFixed(1)} miles</span>
                </div>

                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-700">Rate Per Mile:</span>
                  <span className="font-bold text-slate-900">{formatCurrency(pricingRules.per_mile_after_base_cents)}</span>
                </div>
              </>
            )}

            <div className="flex items-center justify-between py-3 border-t-2 border-green-300 mt-3">
              <span className="text-lg font-bold text-slate-900">TRAVEL FEE:</span>
              <span className="text-2xl font-bold text-green-700">
                {formatCurrency(result.travel_fee_cents)}
              </span>
            </div>

            {result.travel_fee_cents === 0 && !result.is_included_city && (
              <p className="text-sm text-slate-600 italic">
                This address is within the free delivery radius.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
