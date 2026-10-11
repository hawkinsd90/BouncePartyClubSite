// GENERATED COPY of src/lib/eventAddress.ts. Do not edit here.
// Edit the source and run: node node_modules/jiti/bin/jiti.js src/lib/bookingSharedCopy.ts --write
// A test fails if this file differs from its source. Used by create-booking so the server prices exactly like the Quote.

// Order-specific event/delivery unit (address line 2).
//
// The canonical `addresses` row is shared by every order whose line1 + city + state + zip match, so the apartment/unit
// cannot live there: two bookings at "123 Main St" for "Apt 2A" and "Apt 8C" are different delivery locations. Each order
// therefore stores its own unit in `orders.event_address_line2`.
//
//   - NULL    = a legacy order created before the column existed: fall back to the shared address row's line2.
//   - ''      = the customer/admin entered no unit for THIS order: show none (never inherit another order's unit).
//   - 'Apt 2A' = the exact trimmed text entered for this order.
//
// Always test with `typeof === 'string'` / `??`, never `||`, so an empty string stays "no unit" and does not fall through
// to the shared row. Pure and import-free (the same rule is mirrored in supabase/functions/_shared/portal-projection.ts).

type OrderWithAddress = {
  event_address_line2?: string | null;
  addresses?: { line2?: string | null } | null;
} | null | undefined;

// Trimmed text; null / undefined / blank become ''.
export function normalizeUnit(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// The unit to show for an order: its own value when present (even ''), else the legacy shared value.
export function eventAddressLine2(order: OrderWithAddress): string {
  if (!order) return '';
  if (typeof order.event_address_line2 === 'string') return normalizeUnit(order.event_address_line2);
  return normalizeUnit(order.addresses?.line2);
}

// A copy of an order's address object whose line2 is the order-specific unit, for components that read `addresses.line2`.
export function addressWithOrderUnit<A extends { line2?: string | null }>(
  order: { event_address_line2?: string | null; addresses?: A | null } | null | undefined,
): (A & { line2: string }) | null {
  if (!order?.addresses) return null;
  return { ...order.addresses, line2: eventAddressLine2(order as OrderWithAddress) };
}

// "123 Main St, Apt 2A" with no stray separators when there is no unit.
export function formatStreetWithUnit(line1: string | null | undefined, line2: string | null | undefined): string {
  const street = normalizeUnit(line1);
  const unit = normalizeUnit(line2);
  return unit ? `${street}, ${unit}` : street;
}
