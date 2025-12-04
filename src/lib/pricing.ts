export interface PricingRules {
  base_radius_miles: number;
  included_city_list_json: string[];
  per_mile_after_base_cents: number;
  zone_overrides_json: Array<{ zip: string; flat_cents: number }>;
  surface_sandbag_fee_cents: number;
  residential_multiplier: number;
  commercial_multiplier: number;
  same_day_matrix_json: Array<{
    units: number;
    generator: boolean;
    subtotal_ge_cents: number;
    fee_cents: number;
  }>;
  overnight_holiday_only: boolean;
  extra_day_pct: number;
  generator_price_cents: number;
}

export interface CartItem {
  unit_id: string;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  qty: number;
}

export interface PriceCalculationInput {
  items: CartItem[];
  location_type: 'residential' | 'commercial';
  surface: 'grass' | 'cement';
  can_use_stakes: boolean;
  overnight_allowed: boolean;
  num_days: number;
  distance_miles: number;
  city: string;
  zip: string;
  has_generator: boolean;
  generator_qty?: number;
  rules: PricingRules;
}

export interface PriceBreakdown {
  subtotal_cents: number;
  travel_fee_cents: number;
  travel_total_miles: number;
  travel_base_radius_miles: number;
  travel_chargeable_miles: number;
  travel_per_mile_cents: number;
  travel_is_flat_fee: boolean;
  travel_fee_display_name: string;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  generator_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  deposit_due_cents: number;
  balance_due_cents: number;
}

export function calculatePrice(input: PriceCalculationInput): PriceBreakdown {
  const {
    items,
    location_type,
    surface,
    can_use_stakes,
    overnight_allowed,
    num_days,
    distance_miles,
    city,
    zip,
    has_generator,
    generator_qty = 0,
    rules,
  } = input;

  let day_1_subtotal = items.reduce((sum, item) => {
    return sum + item.unit_price_cents * item.qty;
  }, 0);

  const location_multiplier =
    location_type === 'residential'
      ? rules.residential_multiplier
      : rules.commercial_multiplier;
  day_1_subtotal = Math.round(day_1_subtotal * location_multiplier);

  let subtotal_cents = day_1_subtotal;
  if (num_days > 1) {
    const extra_days = num_days - 1;
    const extra_day_rate = rules.extra_day_pct / 100;
    subtotal_cents += Math.round(day_1_subtotal * extra_day_rate * extra_days);
  }

  let travel_fee_cents = 0;
  let travel_total_miles = distance_miles;
  let travel_base_radius_miles = rules.base_radius_miles;
  let travel_chargeable_miles = 0;
  let travel_per_mile_cents = rules.per_mile_after_base_cents;
  let travel_is_flat_fee = false;

  const included_cities = rules.included_city_list_json || [];
  const is_included_city = included_cities.some(
    (c) => c.toLowerCase() === city.toLowerCase()
  );

  const zone_override = rules.zone_overrides_json?.find((z) => z.zip === zip);
  if (zone_override) {
    travel_fee_cents = zone_override.flat_cents;
    travel_is_flat_fee = true;
  } else if (is_included_city) {
    travel_fee_cents = 0;
  } else if (distance_miles > rules.base_radius_miles) {
    const excess_miles = distance_miles - rules.base_radius_miles;
    travel_chargeable_miles = excess_miles;
    travel_fee_cents = Math.round(excess_miles * rules.per_mile_after_base_cents);
  }

  let surface_fee_cents = 0;
  if (surface === 'cement' || (surface === 'grass' && !can_use_stakes)) {
    surface_fee_cents = rules.surface_sandbag_fee_cents;
  }

  const total_units = items.reduce((sum, item) => sum + item.qty, 0);
  let same_day_pickup_fee_cents = 0;

  const needs_same_day_fee =
    location_type === 'commercial' || !overnight_allowed;

  if (needs_same_day_fee) {
    const applicable_rules = rules.same_day_matrix_json
      ?.filter((rule) => {
        if (rule.units > total_units) return false;
        if (rule.generator && !has_generator) return false;
        if (rule.subtotal_ge_cents > subtotal_cents) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.units !== b.units) return b.units - a.units;
        if (a.generator !== b.generator) return a.generator ? -1 : 1;
        return b.subtotal_ge_cents - a.subtotal_ge_cents;
      });

    if (applicable_rules && applicable_rules.length > 0) {
      same_day_pickup_fee_cents = applicable_rules[0].fee_cents;
    }
  }

  let generator_fee_cents = 0;
  const actual_generator_qty = generator_qty > 0 ? generator_qty : (has_generator ? 1 : 0);
  if (actual_generator_qty > 0) {
    generator_fee_cents = rules.generator_price_cents * actual_generator_qty;
  }

  const tax_cents = Math.round((subtotal_cents + travel_fee_cents + surface_fee_cents + generator_fee_cents) * 0.06);

  const total_cents =
    subtotal_cents +
    travel_fee_cents +
    surface_fee_cents +
    same_day_pickup_fee_cents +
    generator_fee_cents +
    tax_cents;

  const deposit_due_cents = total_units * 5000;

  const balance_due_cents = total_cents - deposit_due_cents;

  // Build display-friendly travel fee name
  let travel_fee_display_name = 'Travel Fee';
  if (travel_fee_cents > 0) {
    if (travel_is_flat_fee) {
      travel_fee_display_name = `Travel Fee (${travel_total_miles.toFixed(1)} mi)`;
    } else if (travel_chargeable_miles > 0) {
      const perMileDollars = (travel_per_mile_cents / 100).toFixed(2);
      travel_fee_display_name = `Travel Fee (${travel_chargeable_miles.toFixed(1)} mi × $${perMileDollars}/mi)`;
    }
  }

  return {
    subtotal_cents,
    travel_fee_cents,
    travel_total_miles,
    travel_base_radius_miles,
    travel_chargeable_miles,
    travel_per_mile_cents,
    travel_is_flat_fee,
    travel_fee_display_name,
    surface_fee_cents,
    same_day_pickup_fee_cents,
    generator_fee_cents,
    tax_cents,
    total_cents,
    deposit_due_cents,
    balance_due_cents,
  };
}

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function calculateDrivingDistance(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<number> {
  // Use straight-line distance × 1.4 as fallback (approximates driving distance)
  const fallbackDistance = calculateDistance(originLat, originLng, destLat, destLng) * 1.4;

  // Check if Google Maps is available (loaded by AddressAutocomplete component)
  if (!window.google?.maps?.DistanceMatrixService) {
    console.log('Google Maps not loaded, using straight-line distance approximation');
    return fallbackDistance;
  }

  try {
    const service = new google.maps.DistanceMatrixService();
    const origin = new google.maps.LatLng(originLat, originLng);
    const destination = new google.maps.LatLng(destLat, destLng);

    return new Promise((resolve) => {
      service.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.IMPERIAL,
        },
        (response, status) => {
          if (status === 'OK' && response?.rows?.[0]?.elements?.[0]?.status === 'OK') {
            const distanceMeters = response.rows[0].elements[0].distance?.value;
            if (distanceMeters) {
              // Convert meters to miles
              const distanceMiles = distanceMeters / 1609.34;
              console.log(`Driving distance: ${distanceMiles.toFixed(2)} miles`);
              resolve(distanceMiles);
              return;
            }
          }

          console.warn('Distance Matrix API failed, using straight-line approximation:', status);
          resolve(fallbackDistance);
        }
      );
    });
  } catch (error) {
    console.error('Error calculating driving distance:', error);
    return fallbackDistance;
  }
}
