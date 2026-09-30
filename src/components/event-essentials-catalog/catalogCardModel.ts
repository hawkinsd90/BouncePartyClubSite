// Small display-model helpers for the public Event Essentials catalog cards.
//
// Both are extracted verbatim from EventEssentialsCatalog and only describe what
// the card shows. They do NOT decide whether an item can be added (canAdd), and
// they do not touch resolver eligibility, pricing, quantity state, availability
// fetching or the cart.
//
// Dependency-free so it can be loaded from Node-based tests.

// Total quantity in the cart for one product/bundle. The caller supplies the
// matching predicate (item type guard + id comparison), exactly as the inline
// reduce did. Non-matching rows are skipped; matching rows are summed by qty
// with no de-duplication or validation.
export function sumInCartQty<T extends { qty: number }>(
  cart: T[],
  matches: (item: T) => boolean,
): number {
  return cart.reduce<number>((sum, item) => {
    if (matches(item)) {
      return sum + item.qty;
    }
    return sum;
  }, 0);
}

export type AvailabilityStatus =
  | { kind: 'select-dates' }
  | { kind: 'error' }
  | { kind: 'checking' }
  | { kind: 'text'; text: string }
  | { kind: 'none' };

// Which availability line a product card shows, in the same precedence as the
// inline ternary chain: dates missing, then availability error, then a check in
// flight, then (when a result exists) the cart/available text, else nothing.
export function deriveAvailabilityStatus({
  datesValid,
  hasAvailError,
  checkingAvailability,
  hasAvail,
  inCartQty,
  maxAddable,
}: {
  datesValid: boolean;
  hasAvailError: boolean;
  checkingAvailability: boolean;
  hasAvail: boolean;
  inCartQty: number;
  maxAddable: number;
}): AvailabilityStatus {
  if (!datesValid) return { kind: 'select-dates' };
  if (hasAvailError) return { kind: 'error' };
  if (checkingAvailability) return { kind: 'checking' };
  if (hasAvail) {
    return {
      kind: 'text',
      text: inCartQty > 0 && maxAddable > 0
        ? `${inCartQty} in cart · ${maxAddable} more available to add`
        : inCartQty > 0 && maxAddable === 0
          ? `${inCartQty} in cart · No more available for selected dates`
          : maxAddable > 0
            ? `${maxAddable} available to add`
            : 'None available for selected dates',
    };
  }
  return { kind: 'none' };
}
