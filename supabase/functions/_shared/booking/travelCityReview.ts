// WP-18: an Admin-visible record of a travel-fee city review, using only the EXISTING order_changelog table (no new schema).
//
// When the city a customer typed is on the free-delivery list but the server could not confirm it from the address (or the address is
// really in another city), the booking is priced with the distance fee. That outcome used to be written to the function log only. It is now
// also recorded as one order_changelog row (change_type 'travel_city_review'), which:
//   - shows in the order's Change History,
//   - drives a warning on the pending booking card and in the order detail,
//   - is added to the "new booking request" alert the Admin already receives (order-lifecycle).
// The Admin can waive the travel fee with the existing reason-required waiver if the city is in fact correct. This is NOT the durable
// review-status architecture (DR-8, deferred): there is no "resolved" state; the row is history, and a later address change that no longer
// needs review does not delete it.

import type { TrustedTravelCity } from "./addressVerification.ts";

export const TRAVEL_CITY_REVIEW_CHANGE_TYPE = "travel_city_review";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type TravelCityReviewCode = NonNullable<TrustedTravelCity["review"]>;

/** The sentence the Admin reads. `typedCity` is customer text: callers that put it in HTML must escape it. */
export function travelCityReviewNote(review: TravelCityReviewCode, typedCity: string, verifiedCity: string | null): string {
  const typed = typedCity.trim() || "(blank)";
  if (review === "typed_free_city_contradicted") {
    return `The customer entered "${typed}", which is on the free-delivery list, but the address is in ${verifiedCity ? `"${verifiedCity}"` : "another city"}. The distance-based travel fee was applied. Check the address; if free delivery is correct, waive the travel fee with a reason.`;
  }
  return `The customer entered "${typed}", which is on the free-delivery list, but the city could not be confirmed from the street address. The distance-based travel fee was applied. Check the address; if the city is correct, waive the travel fee with a reason.`;
}

export interface RecordTravelCityReviewInput {
  orderId: string;
  travelCity: Pick<TrustedTravelCity, "review" | "city" | "status">;
  typedCity: string;
  /** The staff member who saved the order, or null for a customer booking. */
  userId: string | null;
}

/**
 * Records the review (best effort, idempotent per order + outcome). Returns true when a row exists afterwards, false when nothing needed
 * recording or the write failed. It NEVER throws and never blocks a booking or a save: a failed write is logged and the money outcome
 * (the distance fee) is unchanged.
 */
export async function recordTravelCityReview(db: Db, input: RecordTravelCityReviewInput): Promise<boolean> {
  const review = input.travelCity.review;
  if (!review || !input.orderId) return false;
  try {
    const existing = await db
      .from("order_changelog")
      .select("id")
      .eq("order_id", input.orderId)
      .eq("change_type", TRAVEL_CITY_REVIEW_CHANGE_TYPE)
      .eq("new_value", review)
      .eq("old_value", input.typedCity.trim())
      .limit(1);
    if (!existing.error && Array.isArray(existing.data) && existing.data.length > 0) return true;
    const { error } = await db.from("order_changelog").insert({
      order_id: input.orderId,
      user_id: input.userId,
      change_type: TRAVEL_CITY_REVIEW_CHANGE_TYPE,
      field_changed: "travel_city",
      old_value: input.typedCity.trim(),
      new_value: review,
      notes: travelCityReviewNote(review, input.typedCity, input.travelCity.status === "verified_mismatch" ? input.travelCity.city : null),
    });
    if (error) {
      console.error(`[travel-city-review] could not record the review for order ${input.orderId}: ${error.message ?? error}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[travel-city-review] could not record the review for order ${input.orderId}:`, err);
    return false;
  }
}

/** The review notes already recorded for an order (service role), newest first; [] on any failure. */
export async function loadTravelCityReviewNotes(db: Db, orderId: string): Promise<string[]> {
  try {
    const { data, error } = await db
      .from("order_changelog")
      .select("notes, created_at")
      .eq("order_id", orderId)
      .eq("change_type", TRAVEL_CITY_REVIEW_CHANGE_TYPE)
      .order("created_at", { ascending: false });
    if (error || !Array.isArray(data)) return [];
    return data.map((r: { notes?: string | null }) => String(r.notes ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

/** The note contains customer-typed text, so it is escaped before it goes into an HTML email. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const TRAVEL_CITY_REVIEW_SMS_SUFFIX = " TRAVEL FEE REVIEW: free city not verified, distance fee applied.";
