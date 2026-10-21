// Pure helpers for address edits. Typing in an address box after choosing a suggestion must discard the old street, latitude and
// longitude, otherwise the form submits text that no longer matches the coordinates used for pricing.

export interface QuoteAddressFields {
  address_line1: string;
  lat: number;
  lng: number;
}

/** Fields cleared on the Quote form when the customer edits the address text. City, state and ZIP stay editable. */
// picked_locality is the city Google reported for the chosen suggestion ('' for townships, null when no suggestion was chosen).
export const QUOTE_ADDRESS_EDIT_RESET: QuoteAddressFields & { picked_locality: string | null } = { address_line1: '', lat: 0, lng: 0, picked_locality: null };

/** Admin order editor: coordinates and county captured from a previous selection are dropped when the street text is typed over. */
export const ADMIN_ADDRESS_EDIT_RESET = { address_lat: null, address_lng: null, address_county: null } as const;

/** True only when the address was chosen from a suggestion (or geocoded from the full street address): street plus both coordinates. */
export function hasSelectedAddress(fields: Pick<QuoteAddressFields, 'address_line1' | 'lat' | 'lng'>): boolean {
  return (
    !!fields.address_line1 &&
    fields.address_line1.trim() !== '' &&
    Number.isFinite(fields.lat) &&
    Number.isFinite(fields.lng) &&
    fields.lat !== 0 &&
    fields.lng !== 0
  );
}

export interface GeocodeResultLike {
  partial_match?: boolean;
  geometry?: { location_type?: string };
}

/**
 * Accept a geocode of a saved profile address only when Google matched the whole street address precisely. City or ZIP centroids
 * (APPROXIMATE / GEOMETRIC_CENTER) and partial matches are rejected so the customer reselects the address instead of being priced
 * from the middle of a city.
 */
export function isPreciseGeocode(result: GeocodeResultLike | null | undefined): boolean {
  if (!result || result.partial_match) return false;
  const type = result.geometry?.location_type;
  return type === 'ROOFTOP' || type === 'RANGE_INTERPOLATED';
}

export const SELECT_ADDRESS_MESSAGE = 'Please choose your event address from the suggestions list so we can confirm the location.';
