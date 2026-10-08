// create-booking orchestration (Payment Safety A2.3). The Edge Function is a thin HTTP shell around this module so the
// whole flow is testable with an in-memory database.
//
//   raw request -> validateBookingInput (allowlist) -> load catalog (service role) -> buildBooking (server prices)
//   -> verifyBookingAvailability -> mint booking proof -> create_booking_request RPC (one transaction)
//
// Creating a booking request NEVER charges the customer: nothing in this flow talks to Stripe, creates a PaymentIntent,
// writes a payment or ledger row, or changes deposit_paid_cents. The only credential it hands back is the booking proof
// that later authorizes the card-SAVE (setup-mode) session.

import { validateBookingInput } from "./bookingInput.ts";
import { buildBooking, type BookingCatalog } from "./bookingBuild.ts";
import { verifyBookingAvailability, type AvailabilityPort } from "./bookingAvailability.ts";
import { generateBookingToken, hashBookingToken, bookingProofExpiry } from "./bookingProof.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface CreateBookingDeps {
  db: Db;
  availability: AvailabilityPort;
  // Signed-in customer's user id when the caller is authenticated; null for guests. Never taken from the body.
  callerUserId: string | null;
  meta: { ip_address: string | null; user_agent: string | null };
  now?: Date;
}

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

const BUNDLE_SELECT =
  "*, product_bundle_components(product_id, quantity_per_bundle, inventory_products(id, name, category_id)), " +
  "package_inflatable_components(selection_mode), product_bundle_excluded_categories(category_id), package_inflatable_eligibility(unit_id)";

export async function loadBookingCatalog(db: Db): Promise<BookingCatalog | null> {
  const [rules, units, products, pricing, categories, bundles] = await Promise.all([
    db.from("pricing_rules").select("*"),
    db.from("units").select("id, name, price_dry_cents, price_water_cents, active"),
    db.from("inventory_products").select("id, name, category_id, active, public_visible"),
    db.from("product_pricing").select("*"),
    db.from("product_categories").select("id"),
    db.from("product_bundles").select(BUNDLE_SELECT),
  ]);
  for (const r of [rules, units, products, pricing, categories, bundles]) {
    if (r.error || !Array.isArray(r.data)) return null;
  }
  // Exactly one pricing configuration row, as the Checkout requires.
  if (rules.data.length !== 1) return null;
  return {
    pricingRulesRow: rules.data[0],
    units: units.data,
    products: products.data,
    pricing: pricing.data,
    categories: categories.data,
    bundles: bundles.data,
  };
}

const json = (status: number, body: Record<string, unknown>): HttpResult => ({ status, body });

export async function createBookingRequest(deps: CreateBookingDeps, rawBody: unknown): Promise<HttpResult> {
  const now = deps.now ?? new Date();

  const parsed = validateBookingInput(rawBody);
  if (!parsed.ok) return json(400, { success: false, error: "Invalid booking request.", code: "INVALID_REQUEST", detail: parsed.error });

  const catalog = await loadBookingCatalog(deps.db);
  if (!catalog) return json(503, { success: false, error: "Booking is temporarily unavailable. Please try again.", code: "CATALOG_UNAVAILABLE" });

  const built = buildBooking(parsed.value, catalog, now);
  if (!built.ok) {
    const status = built.code === "pricing_unavailable" ? 503 : 400;
    return json(status, { success: false, error: built.error, code: built.code.toUpperCase() });
  }
  const plan = built.plan;

  // Server availability verification: units, blackout, same-day pickup, Event Essentials stock.
  const verdict = await verifyBookingAvailability(deps.availability, {
    unitIds: plan.inflatableUnitIds,
    eeItems: plan.items.filter((i) => !i.unit_id),
    startDate: plan.startDate,
    endDate: plan.endDate,
    sameDayOrder: plan.isSameDayOrder,
  });
  if (!verdict.ok) {
    switch (verdict.reason) {
      case "blackout":
        return json(409, { success: false, error: "This date is not available for booking. Please contact us or choose a different date.", code: "DATE_BLACKED_OUT" });
      case "same_day_blocked":
        return json(409, { success: false, error: "Same-day pickups are not available for this date. Please choose next-day pickup or select a different date.", code: "SAME_DAY_PICKUP_BLACKED_OUT" });
      case "unit_unavailable":
        return json(409, { success: false, error: "One or more selected units are no longer available for the selected dates.", code: "UNITS_UNAVAILABLE", unitIds: verdict.unitIds ?? [] });
      case "ee_unavailable":
        return json(409, { success: false, error: "One or more Event Essentials items are no longer available for the selected dates.", code: "ITEMS_UNAVAILABLE" });
      default:
        return json(503, { success: false, error: "Unable to verify availability. Please try again.", code: "AVAILABILITY_UNVERIFIABLE" });
    }
  }

  // Booking proof: random, stored as a hash, bound to the order by the RPC in the same transaction.
  const token = generateBookingToken();
  const proofHash = await hashBookingToken(token);
  const expiresAt = bookingProofExpiry(now);

  const { data, error } = await deps.db.rpc("create_booking_request", {
    p_payload: {
      contact: plan.contact,
      address: plan.address,
      order: plan.order,
      items: plan.items,
      consents: plan.consents,
      request_meta: deps.meta,
    },
    p_proof_hash: proofHash,
    p_proof_expires_at: expiresAt,
    p_caller_user_id: deps.callerUserId,
  });
  // The database is the authority on the account boundary: a registered customer's email can only be used by that
  // signed-in customer. Nothing about the account (id, name, phone) is echoed back.
  if (error && /account_sign_in_required/.test(String(error.message ?? ""))) {
    return json(403, {
      success: false,
      error: "This email is linked to an existing account. Please sign in to continue your booking.",
      code: "ACCOUNT_SIGN_IN_REQUIRED",
    });
  }
  if (error || !data || typeof data.order_id !== "string") {
    return json(500, { success: false, error: "We could not create your booking. Please try again.", code: "CREATE_FAILED" });
  }

  return json(200, { success: true, orderId: data.order_id, bookingToken: token, expiresAt });
}
