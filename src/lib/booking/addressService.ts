import { supabase } from '../supabase';

export function normalizeZip(zip: string): string {
  return zip.replace(/\s+/g, '').trim();
}

function buildAddressKey(line1: string, city: string, state: string, zip: string): string {
  return (
    line1.toLowerCase().trim() +
    '|' +
    city.toLowerCase().trim() +
    '|' +
    state.toUpperCase().trim() +
    '|' +
    normalizeZip(zip)
  );
}

export async function findExistingAddressId(fields: {
  line1: string;
  city: string;
  state: string;
  zip: string;
}): Promise<string | null> {
  const key = buildAddressKey(fields.line1, fields.city, fields.state, fields.zip);

  const { data } = await supabase
    .from('addresses')
    .select('id')
    .eq('address_key', key)
    .maybeSingle();

  return data?.id ?? null;
}

/**
 * Geocode a street address using the browser-side Maps Geocoder.
 * Returns null if Maps is unavailable or the address cannot be geocoded.
 * Never throws — address saves must not be blocked by geocoding failures.
 */
async function geocodeAddressString(
  line1: string,
  city: string,
  state: string,
  zip: string
): Promise<{ lat: number; lng: number } | null> {
  if (typeof window === 'undefined') return null;

  const g = (window as Window & { google?: typeof google }).google;
  if (!g?.maps?.Geocoder) {
    console.warn('[addressService] Google Maps Geocoder unavailable — address will save without coordinates.');
    return null;
  }

  const address = `${line1}, ${city}, ${state} ${zip}`;

  return new Promise((resolve) => {
    try {
      const geocoder = new g.maps.Geocoder();
      geocoder.geocode(
        { address, componentRestrictions: { country: 'us' } },
        (results: google.maps.GeocoderResult[] | null, status: string) => {
          if (status === 'OK' && results?.[0]?.geometry?.location) {
            resolve({
              lat: results[0].geometry.location.lat(),
              lng: results[0].geometry.location.lng(),
            });
          } else {
            console.warn(`[addressService] Geocoding failed for "${address}" — status: ${status}. Address will save without coordinates.`);
            resolve(null);
          }
        }
      );
    } catch (err) {
      console.warn('[addressService] Geocoder threw unexpectedly — address will save without coordinates.', err);
      resolve(null);
    }
  });
}

interface UpsertAddressParams {
  customer_id: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Reverse-geocode lat/lng to obtain the county name.
 * Uses the browser-side Google Maps Geocoder (already loaded by the app).
 * Returns the county with any trailing " County" stripped, or null on failure.
 */
export async function reverseGeocodeCounty(lat: number, lng: number): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  const g = (window as Window & { google?: typeof google }).google;
  if (!g?.maps?.Geocoder) {
    console.warn('[addressService] Google Maps Geocoder unavailable for reverse geocode.');
    return null;
  }

  return new Promise((resolve) => {
    try {
      const geocoder = new g.maps.Geocoder();
      geocoder.geocode(
        { location: { lat, lng } },
        (results: google.maps.GeocoderResult[] | null, status: string) => {
          if (status === 'OK' && results?.length) {
            const countyComponent = results[0].address_components?.find(
              (c) => c.types.includes('administrative_area_level_2')
            );
            const countyRaw = countyComponent?.long_name || '';
            const county = countyRaw.replace(/\s+County$/i, '').trim();
            resolve(county || null);
          } else {
            console.warn(`[addressService] Reverse geocode failed — status: ${status}.`);
            resolve(null);
          }
        }
      );
    } catch (err) {
      console.warn('[addressService] Reverse geocoder threw unexpectedly.', err);
      resolve(null);
    }
  });
}

/**
 * Forward-geocode an address string to obtain the county name.
 * Uses the browser-side Google Maps Geocoder.
 * Returns the county with any trailing " County" stripped, or null on failure.
 */
export async function forwardGeocodeCounty(
  line1: string,
  city: string,
  state: string,
  zip: string
): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  const g = (window as Window & { google?: typeof google }).google;
  if (!g?.maps?.Geocoder) {
    console.warn('[addressService] Google Maps Geocoder unavailable for forward geocode.');
    return null;
  }

  const address = `${line1}, ${city}, ${state} ${zip}`;

  return new Promise((resolve) => {
    try {
      const geocoder = new g.maps.Geocoder();
      geocoder.geocode(
        { address, componentRestrictions: { country: 'us' } },
        (results: google.maps.GeocoderResult[] | null, status: string) => {
          if (status === 'OK' && results?.length) {
            const countyComponent = results[0].address_components?.find(
              (c) => c.types.includes('administrative_area_level_2')
            );
            const countyRaw = countyComponent?.long_name || '';
            const county = countyRaw.replace(/\s+County$/i, '').trim();
            resolve(county || null);
          } else {
            console.warn(`[addressService] Forward geocode failed for "${address}" — status: ${status}.`);
            resolve(null);
          }
        }
      );
    } catch (err) {
      console.warn('[addressService] Forward geocoder threw unexpectedly.', err);
      resolve(null);
    }
  });
}

export async function upsertCanonicalAddress(params: UpsertAddressParams): Promise<{ id: string }> {
  const { customer_id, line1, line2, city, state, zip } = params;
  let { lat, lng } = params;
  const key = buildAddressKey(line1, city, state, zip);

  // Auto-geocode when the caller didn't supply coordinates.
  if (lat == null || lng == null) {
    const coords = await geocodeAddressString(line1, city, state, zip);
    if (coords) {
      lat = coords.lat;
      lng = coords.lng;
    }
  }

  // The canonical row is shared by every order at this street address, so a later booking or edit must not rewrite its
  // line2 (that would change what OTHER, legacy orders display). Each order keeps its own unit in
  // orders.event_address_line2; the shared row keeps whatever unit its first writer had.
  const { data: existingRow } = await supabase
    .from('addresses')
    .select('line2')
    .eq('address_key', key)
    .maybeSingle();
  const sharedLine2 = existingRow ? (existingRow.line2 ?? null) : (line2 ?? null);

  const storedCoordinates = (lat != null && lng != null ? { lat, lng } : {}) as { lat: number | null; lng: number | null };
  const { data: upserted, error: upsertError } = await supabase
    .from('addresses')
    .upsert(
      {
        customer_id,
        line1: line1.trim(),
        line2: sharedLine2,
        city: city.trim(),
        state: state.trim(),
        zip: normalizeZip(zip),
        // A failed geocode (null) must never erase coordinates already stored for this address: leave the columns out of the upsert.
        ...storedCoordinates,
        address_key: key,
      },
      { onConflict: 'address_key', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  if (upsertError) {
    throw upsertError;
  }

  return { id: upserted.id };
}
