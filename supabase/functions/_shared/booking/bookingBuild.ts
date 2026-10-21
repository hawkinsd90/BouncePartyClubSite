// Server-side booking builder (Payment Safety A2.3).
//
// Pure: validated customer intent + a server-loaded catalog snapshot  ->  the complete set of rows to persist.
// Nothing the browser sends decides identity, price, deposit, tax, status, payment or consent state:
//   * item identity, name, unit price and Event Essentials snapshots come from the catalog snapshot;
//   * the price breakdown, setup fee, tax, total and required deposit come from the SAME pure rules the Quote and
//     Checkout use (generated copies of src/lib: calculatePrice, repriceEventEssentialsCart, composeUnifiedQuoteTotals);
//   * every workflow / payment / refund / alert column is forced to its safe initial value (see FORCED_ORDER_DEFAULTS).
//
// The only client-measured number that still feeds money is `distance_miles` (the travel fee); it is range-checked and
// bounded below by the great-circle distance from the shop, so it cannot be understated.

import { calculatePrice, isSameDayWeekdayDelivery, type PricingRules } from "./pricing.ts";
import { composeUnifiedQuoteTotals } from "./unifiedTotals.ts";
import { parseBookingDepositSettings } from "./depositCalculation.ts";
import { calculateEventEssentialsSubtotalCents } from "./eventEssentialsMoney.ts";
import { mapCartToOrderItems, type OrderItemInsert } from "./eventEssentialsOrderItems.ts";
import { repriceEventEssentialsCart, hasBlockingIssues } from "./eventEssentialsCartRepricing.ts";
import {
  buildProductConfigMap,
  buildBundleConfigMap,
  buildCategoryMap,
  buildUnitMap,
  type CatalogBundleRow,
  type CatalogCategoryRow,
  type CatalogPricingRow,
} from "./eventEssentialsCatalogResolver.ts";
import { isInflatableCartItem } from "./unifiedCartGuards.ts";
import type { UnifiedCartItem, InflatableCartItem, EventEssentialProductCartItem, EventEssentialBundleCartItem } from "./types.ts";
import { daysBetween, type BookingInput } from "./bookingInput.ts";
import { resolveTrustedTravelCity, type CityVerification, type TrustedTravelCity } from "./addressVerification.ts";

export const HOME_BASE = { lat: 42.2808, lng: -83.3863 };

export const SMS_CONSENT_TEXT =
  "I consent to receive transactional SMS messages from Bounce Party Club LLC regarding my booking, including order confirmations, delivery updates, and service notifications. Message frequency varies. Message and data rates may apply. Reply STOP to opt-out.";
export const CARD_ON_FILE_CONSENT_TEXT =
  "I authorize Bounce Party Club LLC to securely store my payment method and charge it for incidentals including damage, excess cleaning, or late fees as itemized in a receipt.";
export const CONSENT_VERSION = "1.0";

export interface CatalogUnit {
  id: string;
  name: string;
  price_dry_cents: number;
  price_water_cents: number | null;
  active: boolean;
}
export interface CatalogProduct {
  id: string;
  name: string;
  category_id: string | null;
  active: boolean;
  public_visible: boolean;
}
export interface CatalogBundle extends CatalogBundleRow {
  name: string;
  description?: string | null;
  active: boolean;
  public_visible: boolean;
  product_bundle_components?: Array<{
    product_id: string;
    quantity_per_bundle: number;
    inventory_products?: { name?: string | null; category_id?: string | null } | null;
  }> | null;
}
export interface BookingCatalog {
  pricingRulesRow: Record<string, unknown>;
  units: CatalogUnit[];
  products: CatalogProduct[];
  pricing: CatalogPricingRow[];
  categories: CatalogCategoryRow[];
  bundles: CatalogBundle[];
}

export type BuildErrorCode =
  | "item_unavailable"
  | "invalid_request"
  | "consent_required"
  | "pricing_unavailable"
  | "date_in_past"
  | "distance_invalid"
  | "payment_selection_invalid";

export interface BookingConsentRow {
  consent_type: "sms" | "card_on_file";
  consented: true;
  consent_text: string;
  consent_version: string;
}

export interface BookingPlan {
  contact: BookingInput["contact"];
  address: { line1: string; line2: string | null; city: string; state: string; zip: string; lat: number | null; lng: number | null; address_key: string };
  // Money / schedule / flags the RPC copies into the order row. Never contains status, payment, refund or alert fields.
  order: Record<string, unknown>;
  items: OrderItemInsert[];
  consents: BookingConsentRow[];
  inflatableUnitIds: string[];
  eventEssentialsCart: Array<EventEssentialProductCartItem | EventEssentialBundleCartItem>;
  hasInflatables: boolean;
  totals: {
    totalCents: number;
    depositCents: number;
    taxCents: number;
    equipmentSubtotalCents: number;
    setupFeeCents: number;
  };
  isSameDayOrder: boolean;
  startDate: string;
  endDate: string;
  // How the free-delivery city was decided (WP-18). `review` is non-null when a human should look at the address.
  travelCity: TrustedTravelCity;
}

export type BuildResult = { ok: true; plan: BookingPlan } | { ok: false; code: BuildErrorCode; error: string };

const fail = (code: BuildErrorCode, error: string): BuildResult => ({ ok: false, code, error });

export function normalizeZip(zip: string): string {
  return zip.replace(/\s+/g, "").trim();
}
export function buildAddressKey(line1: string, city: string, state: string, zip: string): string {
  return `${line1.toLowerCase().trim()}|${city.toLowerCase().trim()}|${state.toUpperCase().trim()}|${normalizeZip(zip)}`;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function detroitToday(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Detroit" });
}

export function includedCitiesOf(rules: { included_cities?: string[] | null; included_city_list_json?: string[] | null }): string[] {
  return (rules.included_cities || rules.included_city_list_json || []) as string[];
}

// `verification` is the server's own check of the address city (addressVerification.ts). When the free-city list is not empty and no
// verification is supplied, no free-city grant is made from the typed city.
export function buildBooking(input: BookingInput, catalog: BookingCatalog, now: Date = new Date(), verification?: CityVerification | null): BuildResult {
  const { event } = input;

  if (event.event_date < detroitToday(now)) return fail("date_in_past", "The selected event date has passed.");

  // ---- distance: client-measured, but never below the straight-line distance from the shop -------------------------
  if (event.address.lat === null || event.address.lng === null) return fail("distance_invalid", "A geocoded event address is required.");
  const straightLine = haversineMiles(HOME_BASE.lat, HOME_BASE.lng, event.address.lat, event.address.lng);
  if (event.distance_miles < straightLine * 0.97 - 0.5) return fail("distance_invalid", "The delivery distance is invalid for this address.");

  // ---- cart: identity and prices from the catalog only -------------------------------------------------------------
  const unitsById = new Map(catalog.units.map((u) => [u.id, u]));
  const productsById = new Map(catalog.products.map((p) => [p.id, p]));
  const bundlesById = new Map(catalog.bundles.map((b) => [b.id, b]));

  const cart: UnifiedCartItem[] = [];
  for (const it of input.items) {
    if (it.type === "inflatable") {
      const unit = unitsById.get(it.unit_id);
      if (!unit || unit.active !== true) return fail("item_unavailable", "One of the selected items is not available.");
      const price = it.wet_or_dry === "water" ? unit.price_water_cents : unit.price_dry_cents;
      if (typeof price !== "number" || !Number.isSafeInteger(price) || price < 0) return fail("item_unavailable", "One of the selected items is not available.");
      const line: InflatableCartItem = {
        item_type: "inflatable",
        unit_id: unit.id,
        unit_name: unit.name,
        wet_or_dry: it.wet_or_dry,
        unit_price_cents: price,
        price_dry_cents: unit.price_dry_cents,
        ...(typeof unit.price_water_cents === "number" ? { price_water_cents: unit.price_water_cents } : {}),
        qty: it.qty,
      };
      cart.push(line);
    } else if (it.type === "product") {
      const product = productsById.get(it.product_id);
      if (!product || product.active !== true || product.public_visible !== true) return fail("item_unavailable", "One of the selected items is not available.");
      // Price/context are placeholders; the Event Essentials resolver below is the only source of the real values.
      cart.push({ item_type: "event_essential_product", product_id: product.id, product_name: product.name, unit_price_cents: 0, qty: it.qty, pricing_context: "standalone" });
    } else {
      const bundle = bundlesById.get(it.bundle_id);
      if (!bundle || bundle.active !== true || bundle.public_visible !== true) return fail("item_unavailable", "One of the selected items is not available.");
      const components = bundle.product_bundle_components ?? [];
      if (components.length === 0) return fail("item_unavailable", "One of the selected items is not available.");
      cart.push({
        item_type: "event_essential_bundle",
        bundle_id: bundle.id,
        bundle_name: bundle.name,
        unit_price_cents: 0,
        qty: it.qty,
        pricing_context: "standalone",
        component_snapshot: {
          bundle_name: bundle.name,
          bundle_description: bundle.description ?? null,
          components: components.map((c) => ({
            product_id: c.product_id,
            product_name: c.inventory_products?.name ?? "Unknown Product",
            quantity_per_bundle: c.quantity_per_bundle,
          })),
        },
      });
    }
  }

  const inflatableLines = cart.filter(isInflatableCartItem) as InflatableCartItem[];
  const hasInflatables = inflatableLines.length > 0;
  if (hasInflatables && event.can_stake === null) return fail("invalid_request", "Please answer the staking question.");

  // ---- Event Essentials prices: the resolver is the sole authority --------------------------------------------------
  const repriced = repriceEventEssentialsCart({
    cart,
    productConfigs: buildProductConfigMap(catalog.products, catalog.pricing),
    bundleConfigs: buildBundleConfigMap(catalog.bundles),
    categories: buildCategoryMap(catalog.categories),
    units: buildUnitMap(catalog.units),
  });
  if (hasBlockingIssues(repriced.issues)) return fail("item_unavailable", "One of the selected items is not available.");
  const pricedCart = repriced.cart;

  // ---- inflatable price breakdown (same call the Quote makes) -----------------------------------------------------------
  const rules = catalog.pricingRulesRow as unknown as PricingRules;
  const travelCity = resolveTrustedTravelCity(verification, event.address.city, includedCitiesOf(rules));
  const numDays = Math.max(1, daysBetween(event.event_date, event.event_end_date) + 1);
  const breakdown = calculatePrice({
    items: inflatableLines.map((i) => ({ unit_id: i.unit_id, wet_or_dry: i.wet_or_dry, unit_price_cents: i.unit_price_cents, qty: i.qty })),
    location_type: event.location_type,
    surface: hasInflatables ? (event.can_stake === true ? "grass" : "cement") : "grass",
    can_use_stakes: hasInflatables ? (event.can_stake ?? true) : true,
    overnight_allowed: event.pickup_preference === "next_day",
    num_days: numDays,
    distance_miles: event.distance_miles,
    city: travelCity.city,
    zip: event.address.zip,
    has_generator: false,
    generator_qty: 0,
    rules,
    is_same_day_weekday_delivery: isSameDayWeekdayDelivery(event.event_date, rules.same_day_delivery_fee_days),
  });

  const deposit = parseBookingDepositSettings(catalog.pricingRulesRow);
  if (deposit.status !== "ready") return fail("pricing_unavailable", "Pricing is temporarily unavailable.");
  const taxApplied = breakdown.tax_applied ?? true;
  const totals = composeUnifiedQuoteTotals({
    inflatableBreakdown: breakdown,
    cart: pricedCart,
    taxApplied,
    eeOnlyDepositSettings: deposit.eventEssentialsDepositSettings,
    inflatableDepositPerUnitCents: deposit.inflatableDepositPerUnitCents,
    setupMinimumCents: deposit.setupMinimumCents,
  });
  if (totals.depositError) return fail("pricing_unavailable", "Pricing is temporarily unavailable.");

  const orderItems = mapCartToOrderItems(pricedCart);
  if (orderItems.length === 0 || orderItems.length !== pricedCart.length) return fail("item_unavailable", "One of the selected items is not available.");

  const depositCents = totals.depositCents;
  const totalCents = totals.totalCents;

  // ---- payment selection (informational) and tip -----------------------------------------------------------------------
  let selectedCents = depositCents;
  if (input.payment.selection_type === "full") selectedCents = totalCents;
  else if (input.payment.selection_type === "custom") {
    // Same clamp the Checkout page applies; the value is a label only and never authorizes or triggers a charge.
    selectedCents = Math.max(depositCents, Math.min(input.payment.selection_cents ?? 0, totalCents));
  }
  if (input.payment.tip_cents > totalCents) return fail("payment_selection_invalid", "The tip amount is invalid.");

  if (!input.consents.card_on_file || !input.consents.sms) return fail("consent_required", "Required consents were not given.");
  const consents: BookingConsentRow[] = [
    { consent_type: "sms", consented: true, consent_text: SMS_CONSENT_TEXT, consent_version: CONSENT_VERSION },
    { consent_type: "card_on_file", consented: true, consent_text: CARD_ON_FILE_CONSENT_TEXT, consent_version: CONSENT_VERSION },
  ];

  const isSameDayOrder = event.pickup_preference === "same_day" || event.location_type === "commercial";
  const billing = input.billing.same_as_event ? null : input.billing.address;

  const order: Record<string, unknown> = {
    location_type: event.location_type,
    surface: hasInflatables ? (event.can_stake === true ? "grass" : "cement") : null,
    event_date: event.event_date,
    event_end_date: event.event_end_date,
    pickup_preference: event.pickup_preference,
    start_window: event.start_window,
    end_window: event.end_window,
    until_end_of_day: event.until_end_of_day,
    same_day_responsibility_accepted: event.same_day_responsibility_accepted,
    overnight_responsibility_accepted: event.overnight_responsibility_accepted,
    billing_address_line1: billing?.line1 ?? null,
    billing_address_line2: billing?.line2 ?? null,
    billing_city: billing?.city ?? null,
    billing_state: billing?.state ?? null,
    billing_zip: billing?.zip ?? null,
    subtotal_cents: totals.equipmentSubtotalCents,
    event_essentials_subtotal_cents: calculateEventEssentialsSubtotalCents(pricedCart),
    travel_fee_cents: breakdown.travel_fee_cents,
    travel_total_miles: breakdown.travel_total_miles,
    travel_base_radius_miles: breakdown.travel_base_radius_miles,
    travel_chargeable_miles: breakdown.travel_chargeable_miles,
    travel_per_mile_cents: breakdown.travel_per_mile_cents,
    travel_is_flat_fee: breakdown.travel_is_flat_fee,
    surface_fee_cents: hasInflatables ? breakdown.surface_fee_cents : 0,
    same_day_pickup_fee_cents: breakdown.same_day_pickup_fee_cents || 0,
    same_day_weekday_delivery_fee_cents: breakdown.same_day_weekday_delivery_fee_cents || 0,
    setup_fee_cents: totals.setupFeeCents,
    tax_cents: taxApplied ? totals.taxCents : 0,
    tip_cents: input.payment.tip_cents,
    deposit_due_cents: depositCents,
    balance_due_cents: Math.max(0, totalCents - depositCents),
    customer_selected_payment_cents: selectedCents || depositCents,
    customer_selected_payment_type: input.payment.selection_type,
    card_on_file_consent: true,
    sms_consent: true,
    sms_consent_text: SMS_CONSENT_TEXT,
    special_details: event.special_details,
    referral_source: input.referral.source,
    referral_source_detail: input.referral.detail,
  };

  return {
    ok: true,
    plan: {
      contact: input.contact,
      address: {
        line1: event.address.line1.trim(),
        line2: event.address.line2,
        city: event.address.city.trim(),
        state: event.address.state.trim(),
        zip: normalizeZip(event.address.zip),
        lat: event.address.lat,
        lng: event.address.lng,
        address_key: buildAddressKey(event.address.line1, event.address.city, event.address.state, event.address.zip),
      },
      order,
      items: orderItems,
      consents,
      inflatableUnitIds: inflatableLines.map((i) => i.unit_id),
      eventEssentialsCart: pricedCart.filter((l) => !isInflatableCartItem(l)) as Array<EventEssentialProductCartItem | EventEssentialBundleCartItem>,
      hasInflatables,
      totals: {
        totalCents,
        depositCents,
        taxCents: totals.taxCents,
        equipmentSubtotalCents: totals.equipmentSubtotalCents,
        setupFeeCents: totals.setupFeeCents,
      },
      isSameDayOrder,
      startDate: event.event_date,
      endDate: event.event_end_date,
      travelCity,
    },
  };
}
