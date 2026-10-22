// WP-18: the Admin-visible travel-fee city review. The server records it as an order_changelog row (change_type 'travel_city_review', see
// supabase/functions/_shared/booking/travelCityReview.ts); these helpers only read those rows.

export const TRAVEL_CITY_REVIEW_CHANGE_TYPE = 'travel_city_review';

export interface TravelCityReviewRow {
  change_type?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

// The newest review note among an order's changelog rows, or null when there is none.
export function latestTravelCityReviewNote(rows: ReadonlyArray<TravelCityReviewRow> | null | undefined): string | null {
  const mine = (rows ?? []).filter((r) => r?.change_type === TRAVEL_CITY_REVIEW_CHANGE_TYPE);
  if (mine.length === 0) return null;
  mine.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  const note = (mine[0].notes ?? '').trim();
  return note || 'The free-delivery city could not be confirmed, so the distance-based travel fee was applied. Check the address.';
}
