import { isPreciseGeocode, type GeocodeResultLike } from './addressEdit';

// WP-P1-12 (F-40): geocoding a saved profile / carried-over street address so the Quote can be priced. It used to call `new google.maps.Geocoder()`
// at once, with no wait for the Google Maps script and no retry: when the script was not ready yet the call threw, the error was only logged, and the
// effect never ran again (it re-runs only when the address fields change), leaving a street with no coordinates, no price and no message.
// This waits for the Maps loader, retries a failed attempt, and reports one of three outcomes the caller can act on.

export interface GeocodeResultWithLocation extends GeocodeResultLike {
  geometry?: { location_type?: string; location?: { lat(): number; lng(): number } };
}

export interface GeocoderLike {
  geocode(request: { address: string }): Promise<{ results?: GeocodeResultWithLocation[] }>;
}

export interface SavedAddressGeocodeDeps {
  /** Resolves when Google Maps and its geocoding library are usable; rejects when they cannot be loaded. */
  ensureMapsLoaded: () => Promise<void>;
  createGeocoder: () => GeocoderLike;
  wait: (ms: number) => Promise<void>;
  attempts?: number;
  retryDelayMs?: number;
}

export type SavedAddressGeocodeOutcome =
  | { status: 'found'; lat: number; lng: number }
  // Google answered, but not with a precise match for the whole street address (a city / ZIP centre, a partial match, or nothing): never used for pricing.
  | { status: 'imprecise' }
  // Google Maps could not be loaded or the lookup kept failing after the retries.
  | { status: 'failed' };

export async function geocodeSavedAddress(address: string, deps: SavedAddressGeocodeDeps): Promise<SavedAddressGeocodeOutcome> {
  const attempts = Math.max(1, deps.attempts ?? 3);
  const delay = deps.retryDelayMs ?? 1500;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await deps.ensureMapsLoaded();
      const response = await deps.createGeocoder().geocode({ address });
      const first = response.results?.[0];
      const location = first?.geometry?.location;
      if (first && location && isPreciseGeocode(first)) {
        const lat = location.lat();
        const lng = location.lng();
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) return { status: 'found', lat, lng };
      }
      return { status: 'imprecise' };
    } catch {
      if (attempt < attempts) await deps.wait(delay);
    }
  }
  return { status: 'failed' };
}
