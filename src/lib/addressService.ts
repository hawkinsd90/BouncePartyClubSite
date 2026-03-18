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
  const { customer_id, line1, line2, city, state, zip, lat, lng } = params;
  const key = buildAddressKey(line1, city, state, zip);

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
