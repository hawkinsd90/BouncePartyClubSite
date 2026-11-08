// WP-P1-06: the one sentence (and the delivery-fee delta) the price-changed review shows, so the customer is told WHY the price moved.
// Pure and display-only: the server stays the authority for every amount.

import type { ServerTotals } from './bookingApi';

export interface PriceChangeExplanation {
  /** One explanatory sentence, or null when the delivery fee is not the (known) cause. */
  sentence: string | null;
  /** Delivery-fee change in cents (updated minus shown), or null when either side is unknown. */
  travelFeeDeltaCents: number | null;
}

export function explainPriceChange(previous: ServerTotals, updated: ServerTotals, formatMoney: (cents: number) => string): PriceChangeExplanation {
  const before = previous.travelFeeCents;
  const after = updated.travelFeeCents;
  if (typeof before !== 'number' || typeof after !== 'number') return { sentence: null, travelFeeDeltaCents: null };
  const delta = after - before;
  if (delta === 0) return { sentence: null, travelFeeDeltaCents: 0 };
  if (delta < 0) {
    return { sentence: `The delivery fee is ${formatMoney(-delta)} lower than the quote showed.`, travelFeeDeltaCents: delta };
  }
  const amount = formatMoney(delta);
  if (updated.travelCityStatus === 'unverified') {
    return {
      sentence: `The delivery fee is ${amount} higher than the quote showed because we could not automatically confirm from your street address that it is in a free-delivery city, so the distance-based fee applies. If you believe your address qualifies for free delivery, please contact us before or after booking and we will review it.`,
      travelFeeDeltaCents: delta,
    };
  }
  if (updated.travelCityStatus === 'verified_mismatch') {
    return {
      sentence: `The delivery fee is ${amount} higher than the quote showed because your street address is outside the free-delivery cities, so the distance-based fee applies.`,
      travelFeeDeltaCents: delta,
    };
  }
  return { sentence: `The delivery fee is ${amount} higher than the quote showed.`, travelFeeDeltaCents: delta };
}
