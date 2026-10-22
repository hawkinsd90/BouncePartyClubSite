// WP-22 (B14): addresses for display and for maps.

export interface AddressParts {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// "123 Main St, Apt 4, Detroit, MI 48201" - the unit (line 2) is included, and missing pieces leave no stray commas.
export function formatAddress(a: AddressParts): string {
  const cityState = [clean(a.city), [clean(a.state), clean(a.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [clean(a.line1), clean(a.line2), cityState].filter(Boolean).join(', ');
}

// Coordinates are used only when they are real: finite, in range and not the (0, 0) a missing geocode is stored as.
export function reliableCoordinates(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

// Google Maps directions to the place: the verified coordinates when there are some, otherwise the fully encoded address.
export function mapsDirectionsUrl(a: AddressParts): string | null {
  const coords = reliableCoordinates(a.lat, a.lng);
  const destination = coords ? `${coords.lat},${coords.lng}` : formatAddress(a);
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
