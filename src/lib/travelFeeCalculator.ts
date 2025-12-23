import { calculateDrivingDistance } from './distanceCalculator';
import { HOME_BASE } from './constants';

export interface TravelFeeCalculationInput {
  city: string;
  zip: string;
  lat: number;
  lng: number;
  baseRadiusMiles: number;
  perMileAfterBaseCents: number;
  includedCities: string[];
  zoneOverrides: Array<{ zip: string; flat_cents: number }>;
}

export interface TravelFeeCalculationResult {
  distance_miles: number;
  chargeable_miles: number;
  travel_fee_cents: number;
  is_flat_fee: boolean;
  zone_name?: string;
  is_included_city: boolean;
  base_radius_miles: number;
  per_mile_cents: number;
  display_name: string;
}

export interface TravelFeeFromDistanceInput {
  distance_miles: number;
  city: string;
  zip: string;
  baseRadiusMiles: number;
  perMileAfterBaseCents: number;
  includedCities: string[];
  zoneOverrides: Array<{ zip: string; flat_cents: number }>;
}

export function calculateTravelFeeFromDistance(
  input: TravelFeeFromDistanceInput
): {
  travel_fee_cents: number;
  chargeable_miles: number;
  is_flat_fee: boolean;
  zone_name?: string;
  is_included_city: boolean;
  display_name: string;
} {
  const {
    distance_miles,
    city,
    zip,
    baseRadiusMiles,
    perMileAfterBaseCents,
    includedCities,
    zoneOverrides,
  } = input;

  // Check if city is in included (free) cities
  const is_included_city = includedCities.some(
    (c) => c.toLowerCase() === city.toLowerCase()
  );

  // Check if ZIP has a flat fee zone override
  const zone_override = zoneOverrides.find((z) => z.zip === zip);

  let travel_fee_cents = 0;
  let chargeable_miles = 0;
  let is_flat_fee = false;
  let zone_name: string | undefined = undefined;
  let display_name = '';

  if (zone_override) {
    // Flat fee zone
    travel_fee_cents = zone_override.flat_cents;
    is_flat_fee = true;
    zone_name = zip;
    display_name = `Travel Fee (${distance_miles.toFixed(1)} mi) - Flat Rate Zone`;
  } else if (is_included_city) {
    // Free delivery city
    travel_fee_cents = 0;
    display_name = `Travel Fee (${distance_miles.toFixed(1)} mi) - FREE`;
  } else if (distance_miles > baseRadiusMiles) {
    // Per-mile calculation beyond base radius
    chargeable_miles = distance_miles - baseRadiusMiles;
    travel_fee_cents = Math.round(chargeable_miles * perMileAfterBaseCents);
    display_name = `Travel Fee (${distance_miles.toFixed(1)} mi)`;
  } else {
    // Within base radius - free
    travel_fee_cents = 0;
    display_name = `Travel Fee (${distance_miles.toFixed(1)} mi) - Within Base`;
  }

  return {
    travel_fee_cents,
    chargeable_miles,
    is_flat_fee,
    zone_name,
    is_included_city,
    display_name,
  };
}

export async function calculateTravelFee(
  input: TravelFeeCalculationInput
): Promise<TravelFeeCalculationResult> {
  const {
    city,
    zip,
    lat,
    lng,
    baseRadiusMiles,
    perMileAfterBaseCents,
    includedCities,
    zoneOverrides,
  } = input;

  // Calculate actual driving distance
  const distance_miles = await calculateDrivingDistance(
    HOME_BASE.lat,
    HOME_BASE.lng,
    lat,
    lng
  );

  // Use shared logic for fee calculation
  const result = calculateTravelFeeFromDistance({
    distance_miles,
    city,
    zip,
    baseRadiusMiles,
    perMileAfterBaseCents,
    includedCities,
    zoneOverrides,
  });

  return {
    distance_miles,
    ...result,
    base_radius_miles: baseRadiusMiles,
    per_mile_cents: perMileAfterBaseCents,
  };
}
