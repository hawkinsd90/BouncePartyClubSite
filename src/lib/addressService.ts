import { supabase } from './supabase';

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
 */
async function geocodeAddressString(
  line1: string,
  city: string,
  state: string,
  zip: string
): Promise<{ lat: number; lng: number } | null> {
  if (typeof window === 'undefined') return null;
  const g = (window as any).google;
  if (!g?.maps?.Geocoder) return null;

  return new Promise((resolve) => {
    const geocoder = new g.maps.Geocoder();
    const address = `${line1}, ${city}, ${state} ${zip}`;
    geocoder.geocode(
      { address, componentRestrictions: { country: 'us' } },
      (results: any[], status: string) => {
        if (status === 'OK' && results?.[0]?.geometry?.location) {
          resolve({
            lat: results[0].geometry.location.lat(),
            lng: results[0].geometry.location.lng(),
          });
        } else {
          resolve(null);
        }
      }
    );
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

export async function upsertCanonicalAddress(params: UpsertAddressParams): Promise<{ id: string }> {
  let { customer_id, line1, line2, city, state, zip, lat, lng } = params;
  const key = buildAddressKey(line1, city, state, zip);

  // Auto-geocode when the caller didn't supply coordinates.
  if (!lat || !lng) {
    const coords = await geocodeAddressString(line1, city, state, zip);
    if (coords) {
      lat = coords.lat;
      lng = coords.lng;
    }
  }

  const { data: upserted, error: upsertError } = await supabase
    .from('addresses')
    .upsert(
      {
        customer_id,
        line1: line1.trim(),
        line2: line2 ?? null,
        city: city.trim(),
        state: state.trim(),
        zip: normalizeZip(zip),
        lat: lat ?? null,
        lng: lng ?? null,
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
