// Server-side verification of the CITY of an event address (WP-18, Patch A).
//
// The free-delivery city list used to be tested against the city the customer TYPED. A customer (or an admin editing a draft) could type a
// free city next to any street and ZIP. The city that decides a free delivery is now the one Google reports for the street address, and a
// result that is not trustworthy never grants the free delivery: the distance fee applies instead (fail closed for the business, visible to
// the customer through the price review, waivable by an admin with a reason).
//
//   verified_match     Google placed the address in a free city        -> free
//   verified_mismatch  Google placed it in another city                -> distance fee
//   unverified         timeout, error, partial/approximate match, no city (townships), other state,
//                      or the browser's coordinates are far from Google's -> distance fee (never a free grant)
//
// The ZIP code is only compared and reported; it never decides. Nothing here talks to the database.

import { matchesIncludedCity, normalizeCityName } from "./travelFeeFromDistance.ts";

export type CityVerification =
  | { status: "verified_match"; city: string }
  | { status: "verified_mismatch"; city: string }
  | { status: "unverified"; reason: string };

export interface AddressToVerify {
  line1: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
}

export type AddressVerifier = (address: AddressToVerify, includedCities: readonly string[]) => Promise<CityVerification | null>;

/** Browser coordinates farther than this from Google's own geocode of the street address are not trusted. */
export const MAX_CLIENT_COORDINATE_DRIFT_MILES = 0.5;
const GEOCODE_TIMEOUT_MS = 4000;
const PRECISE_LOCATION_TYPES = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

interface GeocodeComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}
interface GeocodeResult {
  address_components?: GeocodeComponent[];
  partial_match?: boolean;
  geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
}

function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const component = (r: GeocodeResult, type: string): GeocodeComponent | undefined => r.address_components?.find((c) => c.types?.includes(type));

/**
 * Pure: turns a Google Geocoding API response into a verdict. `includedCities` is the admin's free list.
 * Every doubtful case is `unverified`; only a precise, same-state, same-place, city-bearing result can match or mismatch.
 */
export function interpretGeocode(
  response: { status?: string; results?: GeocodeResult[] } | null | undefined,
  address: AddressToVerify,
  includedCities: readonly string[],
): CityVerification {
  if (!response || response.status !== "OK" || !Array.isArray(response.results) || response.results.length === 0) {
    return { status: "unverified", reason: `geocoder status ${response?.status ?? "none"}` };
  }
  const first = response.results[0];
  if (first.partial_match === true) return { status: "unverified", reason: "partial match" };
  const locationType = first.geometry?.location_type;
  if (!locationType || !PRECISE_LOCATION_TYPES.has(locationType)) return { status: "unverified", reason: `imprecise location (${locationType ?? "unknown"})` };

  const state = component(first, "administrative_area_level_1")?.short_name;
  if (!state || state.trim().toUpperCase() !== address.state.trim().toUpperCase()) return { status: "unverified", reason: "state differs from the address" };

  const geoLat = first.geometry?.location?.lat;
  const geoLng = first.geometry?.location?.lng;
  if (typeof geoLat !== "number" || typeof geoLng !== "number") return { status: "unverified", reason: "no coordinates in the result" };
  // The public booking always carries the browser's coordinates and they must agree with Google's; the admin editors send the street text
  // only, so there is nothing to compare there.
  if (address.lat !== null && address.lng !== null && milesBetween(address.lat, address.lng, geoLat, geoLng) > MAX_CLIENT_COORDINATE_DRIFT_MILES) {
    return { status: "unverified", reason: "browser coordinates differ from the geocoded address" };
  }

  // Townships and some unincorporated places have no `locality`; that is "cannot tell", never a match.
  const city = component(first, "locality")?.long_name?.trim();
  if (!city) return { status: "unverified", reason: "no city (locality) in the result" };

  return matchesIncludedCity(city, includedCities) ? { status: "verified_match", city } : { status: "verified_mismatch", city };
}

/** Google Geocoding REST. The city is deliberately NOT part of the query, so the typed city cannot steer the answer. */
export function createGoogleAddressVerifier(opts: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): AddressVerifier {
  return async (address, includedCities) => {
    if (!opts.apiKey) return { status: "unverified", reason: "no geocoding key configured" };
    const query = [address.line1.trim(), `${address.state.trim()} ${address.zip.trim()}`.trim()].filter(Boolean).join(", ");
    if (!query) return { status: "unverified", reason: "empty address" };
    const f = opts.fetchImpl ?? fetch;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=${encodeURIComponent("country:US")}&key=${encodeURIComponent(opts.apiKey)}`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? GEOCODE_TIMEOUT_MS) : null;
    try {
      const resp = await f(url, controller ? { signal: controller.signal } : undefined);
      if (!resp.ok) return { status: "unverified", reason: `geocoder HTTP ${resp.status}` };
      return interpretGeocode(await resp.json(), address, includedCities);
    } catch (error) {
      return { status: "unverified", reason: error instanceof Error && error.name === "AbortError" ? "geocoder timeout" : "geocoder request failed" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export interface TrustedTravelCity {
  /** The value to use as the "city" of the free-delivery test. Empty means "no free grant". */
  city: string;
  /** `null` when nothing needs attention; otherwise why a human should look. */
  review: null | "typed_free_city_not_verified" | "typed_free_city_contradicted";
  status: CityVerification["status"] | "not_checked";
}

/**
 * The city that may decide a free delivery, given a verification result.
 * `verification === undefined` means "no verification was run" (the free list is empty, so nothing can be granted): the typed city is
 * returned only in that case. With a non-empty free list and no verifier result, nothing is granted.
 */
export function resolveTrustedTravelCity(
  verification: CityVerification | null | undefined,
  typedCity: string,
  includedCities: readonly string[],
): TrustedTravelCity {
  const typedIsFree = matchesIncludedCity(typedCity, includedCities);
  if (includedCities.length === 0) return { city: typedCity, review: null, status: "not_checked" };
  if (!verification) return { city: "", review: typedIsFree ? "typed_free_city_not_verified" : null, status: "unverified" };
  if (verification.status === "verified_match") return { city: verification.city, review: null, status: "verified_match" };
  if (verification.status === "verified_mismatch") {
    return { city: verification.city, review: typedIsFree ? "typed_free_city_contradicted" : null, status: "verified_mismatch" };
  }
  return { city: "", review: typedIsFree ? "typed_free_city_not_verified" : null, status: "unverified" };
}

export { normalizeCityName };
