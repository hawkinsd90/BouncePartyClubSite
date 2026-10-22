// Staff order pricing saves (Admin Edit and Admin / Crew Invoice creation), server side.
//
// The staff browser sends INTENT: which order, what the Admin changed (dates, address, items, discounts, custom fees, waivers, an
// explicit deposit or Setup Fee override, the message) and the state it was looking at. Nothing it sends is a price. This module:
//
//   1. loads the stored order, its items, discounts, fees, the catalog and the pricing rules (service role);
//   2. refuses the save if the order moved since the browser loaded it (a stale save never overwrites newer pricing);
//   3. prices it with the SAME pure engine the Quote, the booking and the editor preview use (generated copies of src/lib), keeping
//      the stored snapshot of every component whose basis did not change;
//   4. hands the derived rows to a database function that writes them in one transaction (service role only).
//
// The browser's own calculation is never read. A request that carries a price (subtotal, tax, total, deposit, balance, a fee amount)
// is refused outright.
//
// Authorization is the caller's: this module trusts only `deps.actingUserId`, which the Edge Function resolved from the verified JWT.

import { calculateOrderPricing, shouldReuseSavedTravel, type CalculatePricingParams } from "../booking/orderPricingCalculation.ts";
import { planOrderChanges, finalizeOrderPlan, hasAddressChanged } from "../booking/orderChangePlanning.ts";
import { storedOrderTotalCents, isWholeCents } from "../booking/orderMoney.ts";
import { isSameDayWeekdayDelivery } from "../booking/pricing.ts";
import { orderPricingState, sameOrderPricingState, type OrderPricingState } from "../booking/orderPricingState.ts";
import { ORDER_STATUS } from "../booking/orderStatuses.ts";
import { loadBookingCatalog } from "../booking/createBooking.ts";
import { createGoogleAddressVerifier, resolveTrustedTravelCity, type AddressVerifier, type CityVerification } from "../booking/addressVerification.ts";
import { repriceEventEssentialsCart, hasBlockingIssues } from "../booking/eventEssentialsCartRepricing.ts";
import {
  buildProductConfigMap,
  buildBundleConfigMap,
  buildCategoryMap,
  buildUnitMap,
} from "../booking/eventEssentialsCatalogResolver.ts";
import type { BookingCatalog } from "../booking/bookingBuild.ts";
import { HOME_BASE, includedCitiesOf } from "../booking/bookingBuild.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Db = Any;

export interface StaffSaveDeps {
  db: Db;
  actingUserId: string;
  // Derived by the Edge Function from the verified caller's roles (never from the request body). Admin / Master may override
  // prices (adjusted line prices, discounts, custom fees, waivers, a deposit or Setup Fee override, optional card on file); Crew may
  // not. Absent means NOT allowed.
  canOverridePricing?: boolean;
  // Driving miles from the shop to a street address, measured on the server. Defaults to the Google Distance Matrix lookup the
  // calculate-route-mileage function already uses (GOOGLE_MAPS_API_KEY). Returns null when the distance cannot be determined.
  drivingMiles?: (destination: string) => Promise<number | null>;
  // Server check of the address city for the free-delivery list (WP-18). Defaults to Google Geocoding with the same GOOGLE_MAPS_API_KEY.
  verifyAddress?: AddressVerifier;
}

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

const json = (status: number, body: Record<string, unknown>): HttpResult => ({ status, body });
const forbiddenField = (detail: string): HttpResult => json(403, { success: false, code: "FIELD_NOT_PERMITTED", error: "Your role cannot set that on an invoice.", detail });
const bad = (detail: string): HttpResult => json(400, { success: false, code: "INVALID_REQUEST", error: "Invalid request.", detail });

const MAX_LINE_CENTS = 10_000_000;
// Per-kind limits, the same as a customer booking (bookingInput.ts: MAX_INFLATABLE_QTY / MAX_BUNDLE_QTY / MAX_PRODUCT_QTY) and the staff
// screens (src/lib/orders/quantityLimits.ts); a test keeps the three in step.
const MAX_INFLATABLE_QTY = 50;
const MAX_BUNDLE_QTY = 99;
const MAX_PRODUCT_QTY = 500;
const MAX_DISTANCE_MILES = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObj = (v: unknown): v is Record<string, Any> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);
const wholeCents = (v: unknown, max = MAX_LINE_CENTS): number | null => (isWholeCents(v) && v <= max ? v : null);

function onlyKeys(obj: Record<string, Any>, allowed: readonly string[]): string | null {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) return k;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Request validation (allowlists everywhere: an unknown field, especially a price, is refused)
// ---------------------------------------------------------------------------------------------------------------------
const WAIVER_KEYS = ["tax", "travel", "surface", "generator", "same_day_pickup", "same_day_weekday_delivery"] as const;
type WaiverKey = (typeof WAIVER_KEYS)[number];

interface Waiver { waived: boolean; reason: string }

function parseWaivers(raw: unknown): Record<WaiverKey, Waiver> | string {
  const out = {} as Record<WaiverKey, Waiver>;
  const src = raw === undefined ? {} : raw;
  if (!isObj(src)) return "waivers";
  const extra = onlyKeys(src, WAIVER_KEYS);
  if (extra) return `waivers.${extra}`;
  for (const k of WAIVER_KEYS) {
    const w = src[k];
    if (w === undefined) { out[k] = { waived: false, reason: "" }; continue; }
    if (!isObj(w) || onlyKeys(w, ["waived", "reason"]) || typeof w.waived !== "boolean") return `waivers.${k}`;
    const reason = w.reason === undefined || w.reason === null ? "" : str(w.reason, 500);
    if (reason === null) return `waivers.${k}.reason`;
    out[k] = { waived: w.waived, reason };
  }
  return out;
}

function parseDiscounts(raw: unknown): Array<{ id?: string; name: string; amount_cents: number; percentage: number }> | string {
  if (!Array.isArray(raw) || raw.length > 50) return "discounts";
  const out = [];
  for (const d of raw) {
    if (!isObj(d) || onlyKeys(d, ["id", "name", "amount_cents", "percentage"])) return "discounts[]";
    const name = str(d.name, 200);
    const amount = d.amount_cents === undefined || d.amount_cents === null ? 0 : wholeCents(d.amount_cents);
    const pct = d.percentage === undefined || d.percentage === null ? 0 : d.percentage;
    if (!name || name.trim() === "" || amount === null || typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) return "discounts[]";
    if (d.id !== undefined && d.id !== null && (typeof d.id !== "string" || !UUID_RE.test(d.id))) return "discounts[].id";
    out.push({ ...(typeof d.id === "string" ? { id: d.id } : {}), name: name.trim(), amount_cents: amount, percentage: pct });
  }
  return out;
}

function parseFees(raw: unknown): Array<{ id?: string; name: string; amount_cents: number }> | string {
  if (!Array.isArray(raw) || raw.length > 50) return "customFees";
  const out = [];
  for (const f of raw) {
    if (!isObj(f) || onlyKeys(f, ["id", "name", "amount_cents"])) return "customFees[]";
    const name = str(f.name, 200);
    const amount = wholeCents(f.amount_cents);
    if (!name || name.trim() === "" || amount === null) return "customFees[]";
    if (f.id !== undefined && f.id !== null && (typeof f.id !== "string" || !UUID_RE.test(f.id))) return "customFees[].id";
    out.push({ ...(typeof f.id === "string" ? { id: f.id } : {}), name: name.trim(), amount_cents: amount });
  }
  return out;
}

interface EventFields {
  location_type: "residential" | "commercial";
  surface: "grass" | "cement";
  generator_qty: number;
  start_window: string;
  end_window: string;
  event_date: string;
  event_end_date: string;
  pickup_preference: "next_day" | "same_day";
  address_line1: string;
  address_line2: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  address_lat: number | null;
  address_lng: number | null;
}

function parseEvent(e: unknown): EventFields | string {
  if (!isObj(e)) return "edited";
  const bad_ = onlyKeys(e, ["location_type", "surface", "generator_qty", "start_window", "end_window", "event_date", "event_end_date", "pickup_preference", "address_line1", "address_line2", "address_city", "address_state", "address_zip", "address_lat", "address_lng"]);
  if (bad_) return `edited.${bad_}`;
  if (e.location_type !== "residential" && e.location_type !== "commercial") return "edited.location_type";
  if (e.surface !== "grass" && e.surface !== "cement" && e.surface !== null && e.surface !== undefined) return "edited.surface";
  if (!isWholeCents(e.generator_qty) || (e.generator_qty as number) > 20) return "edited.generator_qty";
  if (typeof e.event_date !== "string" || !DATE_RE.test(e.event_date.slice(0, 10))) return "edited.event_date";
  const end = typeof e.event_end_date === "string" && e.event_end_date ? e.event_end_date.slice(0, 10) : e.event_date.slice(0, 10);
  if (!DATE_RE.test(end)) return "edited.event_end_date";
  if (end < e.event_date.slice(0, 10)) return "edited.event_end_date";
  if (typeof e.start_window !== "string" || !TIME_RE.test(e.start_window) || typeof e.end_window !== "string" || !TIME_RE.test(e.end_window)) return "edited.window";
  if (e.pickup_preference !== "next_day" && e.pickup_preference !== "same_day") return "edited.pickup_preference";
  const line1 = str(e.address_line1, 300), city = str(e.address_city, 120), state = str(e.address_state, 40), zip = str(e.address_zip, 20);
  const line2 = e.address_line2 === undefined || e.address_line2 === null ? "" : str(e.address_line2, 120);
  if (line1 === null || city === null || state === null || zip === null || line2 === null) return "edited.address";
  const lat = e.address_lat === undefined || e.address_lat === null ? null : e.address_lat;
  const lng = e.address_lng === undefined || e.address_lng === null ? null : e.address_lng;
  if ((lat !== null && (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90)) || (lng !== null && (typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180))) return "edited.address_lat";
  return {
    location_type: e.location_type, surface: (e.surface ?? "grass") as "grass" | "cement", generator_qty: e.generator_qty as number,
    start_window: e.start_window, end_window: e.end_window, event_date: e.event_date.slice(0, 10), event_end_date: end,
    pickup_preference: e.pickup_preference, address_line1: line1, address_line2: line2, address_city: city, address_state: state, address_zip: zip,
    address_lat: lat as number | null, address_lng: lng as number | null,
  };
}

interface ItemIntent {
  id?: string;
  kind: "inflatable" | "product" | "bundle";
  unit_id?: string;
  wet_or_dry?: "dry" | "water";
  product_id?: string;
  bundle_id?: string;
  qty: number;
  is_deleted: boolean;
  is_updated: boolean;
  // Explicit staff line price for an inflatable on a NEW invoice (adjusted price). Ignored on an edit: a stored line keeps its price.
  unit_price_cents?: number;
}

function parseItems(raw: unknown, allowPrice: boolean): ItemIntent[] | string {
  if (!Array.isArray(raw) || raw.length > 100) return "items";
  const out: ItemIntent[] = [];
  for (const it of raw) {
    if (!isObj(it) || onlyKeys(it, ["id", "kind", "unit_id", "wet_or_dry", "product_id", "bundle_id", "qty", "is_deleted", "is_updated", "unit_price_cents"])) return "items[]";
    if (it.kind !== "inflatable" && it.kind !== "product" && it.kind !== "bundle") return "items[].kind";
    if (typeof it.qty !== "number" || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > (it.kind === "inflatable" ? MAX_INFLATABLE_QTY : it.kind === "bundle" ? MAX_BUNDLE_QTY : MAX_PRODUCT_QTY)) return "items[].qty";
    if (it.id !== undefined && (typeof it.id !== "string" || !UUID_RE.test(it.id))) return "items[].id";
    for (const k of ["unit_id", "product_id", "bundle_id"]) if (it[k] !== undefined && (typeof it[k] !== "string" || !UUID_RE.test(it[k] as string))) return `items[].${k}`;
    if (it.kind === "inflatable" && !it.id && (!it.unit_id || (it.wet_or_dry !== "dry" && it.wet_or_dry !== "water"))) return "items[].unit";
    if (it.kind === "product" && !it.id && !it.product_id) return "items[].product_id";
    if (it.kind === "bundle" && !it.id && !it.bundle_id) return "items[].bundle_id";
    if (it.unit_price_cents !== undefined) {
      if (!allowPrice || wholeCents(it.unit_price_cents) === null) return "items[].unit_price_cents";
    }
    out.push({
      ...(typeof it.id === "string" ? { id: it.id } : {}), kind: it.kind, ...(it.unit_id ? { unit_id: it.unit_id as string } : {}),
      ...(it.wet_or_dry ? { wet_or_dry: it.wet_or_dry as "dry" | "water" } : {}), ...(it.product_id ? { product_id: it.product_id as string } : {}),
      ...(it.bundle_id ? { bundle_id: it.bundle_id as string } : {}), qty: it.qty, is_deleted: it.is_deleted === true, is_updated: it.is_updated === true,
      ...(it.unit_price_cents !== undefined ? { unit_price_cents: it.unit_price_cents as number } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Catalog pricing of items (identity and price come from the catalog / the stored line, never from the request)
// ---------------------------------------------------------------------------------------------------------------------
interface PricedLine {
  id?: string;
  client_id?: string;
  unit_id?: string;
  unit_name?: string;
  wet_or_dry?: "dry" | "water";
  product_id?: string | null;
  bundle_id?: string | null;
  item_name?: string | null;
  product_name?: string;
  qty: number;
  unit_price_cents: number;
  pricing_context?: string | null;
  component_snapshot?: Any;
  is_new: boolean;
  is_deleted: boolean;
  is_updated: boolean;
}

function unifiedLine(line: PricedLine): Any {
  if (line.unit_id) {
    return { item_type: "inflatable", unit_id: line.unit_id, unit_name: line.unit_name ?? "", wet_or_dry: line.wet_or_dry ?? "dry", unit_price_cents: line.unit_price_cents, price_dry_cents: line.unit_price_cents, qty: line.qty };
  }
  if (line.bundle_id) {
    return { item_type: "event_essential_bundle", bundle_id: line.bundle_id, bundle_name: line.item_name ?? line.product_name ?? "Package", unit_price_cents: line.unit_price_cents, qty: line.qty, pricing_context: line.pricing_context ?? "standalone", component_snapshot: line.component_snapshot ?? null };
  }
  return { item_type: "event_essential_product", product_id: line.product_id, product_name: line.item_name ?? line.product_name ?? "Event Essential", unit_price_cents: line.unit_price_cents, qty: line.qty, pricing_context: line.pricing_context ?? "standalone" };
}

// New Event Essentials lines get their price and context from the resolver (the same one the booking uses), seeing the whole cart.
// Lines already on the order keep their stored price: they are history.
function priceNewEventEssentials(lines: PricedLine[], catalog: BookingCatalog): { ok: true } | { ok: false } {
  const newIdx = lines.map((l, i) => (l.is_new && !l.is_deleted && !l.unit_id ? i : -1)).filter((i) => i >= 0);
  if (newIdx.length === 0) return { ok: true };
  const live = lines.map((l, i) => ({ l, i })).filter(({ l }) => !l.is_deleted);
  const cart = live.map(({ l }) => unifiedLine(l));
  const repriced = repriceEventEssentialsCart({
    cart,
    productConfigs: buildProductConfigMap(catalog.products, catalog.pricing),
    bundleConfigs: buildBundleConfigMap(catalog.bundles),
    categories: buildCategoryMap(catalog.categories),
    units: buildUnitMap(catalog.units),
  });
  if (hasBlockingIssues(repriced.issues)) return { ok: false };
  live.forEach(({ l, i }, k) => {
    if (!newIdx.includes(i)) return;
    const priced = repriced.cart[k] as Any;
    l.unit_price_cents = priced.unit_price_cents;
    l.pricing_context = priced.pricing_context ?? "standalone";
  });
  return { ok: true };
}

function newLine(it: ItemIntent, catalog: BookingCatalog, clientId: string): PricedLine | null {
  if (it.kind === "inflatable") {
    const unit = catalog.units.find((u) => u.id === it.unit_id);
    if (!unit || unit.active !== true) return null;
    const catalogPrice = it.wet_or_dry === "water" && typeof unit.price_water_cents === "number" && unit.price_water_cents > 0 ? unit.price_water_cents : unit.price_dry_cents;
    if (!isWholeCents(catalogPrice)) return null;
    return { client_id: clientId, unit_id: unit.id, unit_name: unit.name, wet_or_dry: it.wet_or_dry, qty: it.qty, unit_price_cents: it.unit_price_cents ?? catalogPrice, is_new: true, is_deleted: false, is_updated: false };
  }
  if (it.kind === "product") {
    const product = catalog.products.find((p) => p.id === it.product_id);
    if (!product || product.active !== true) return null;
    return { client_id: clientId, product_id: product.id, product_name: product.name, item_name: product.name, qty: it.qty, unit_price_cents: 0, pricing_context: "standalone", is_new: true, is_deleted: false, is_updated: false };
  }
  const bundle = catalog.bundles.find((b) => b.id === it.bundle_id);
  const components = bundle?.product_bundle_components ?? [];
  if (!bundle || bundle.active !== true || components.length === 0) return null;
  return {
    client_id: clientId, bundle_id: bundle.id, product_name: bundle.name, item_name: bundle.name, qty: it.qty, unit_price_cents: 0, pricing_context: "standalone",
    component_snapshot: {
      bundle_name: bundle.name,
      bundle_description: bundle.description ?? null,
      components: components.map((c) => ({ product_id: c.product_id, product_name: c.inventory_products?.name ?? "Unknown Product", quantity_per_bundle: c.quantity_per_bundle })),
    },
    is_new: true, is_deleted: false, is_updated: false,
  };
}

function stagedForEngine(lines: PricedLine[]): { items: Any[]; eeProductItems: Any[] } {
  const items = lines.filter((l) => l.unit_id && !l.product_id).map((l) => ({ unit_id: l.unit_id!, unit_name: l.unit_name ?? "Unknown", qty: l.qty, wet_or_dry: l.wet_or_dry ?? "dry", unit_price_cents: l.unit_price_cents, is_new: l.is_new, is_deleted: l.is_deleted }));
  const eeProductItems = lines.filter((l) => !l.unit_id && !l.is_deleted && (l.product_id || l.bundle_id)).map((l) => ({
    product_id: l.product_id ?? "", bundle_id: l.bundle_id ?? undefined, product_name: l.product_name ?? l.item_name ?? "Event Essential", item_name: l.item_name ?? undefined,
    qty: l.qty, unit_price_cents: l.unit_price_cents, pricing_context: l.pricing_context ?? undefined, component_snapshot: l.component_snapshot ?? null, is_new: l.is_new, is_deleted: l.is_deleted,
  }));
  return { items, eeProductItems };
}

// ---------------------------------------------------------------------------------------------------------------------
// Distance: measured by the server. Nothing the browser sends (miles, coordinates) is a source of the travel fee.
// ---------------------------------------------------------------------------------------------------------------------
const METERS_PER_MILE = 1609.34;

// The Google Distance Matrix lookup (the same REST service and the same GOOGLE_MAPS_API_KEY secret calculate-route-mileage uses).
// The shop is the origin (the same HOME_BASE the Quote, the booking and the editor price from); the destination is the street
// address TEXT, which Google geocodes itself, so coordinates sent by a browser cannot steer the result.
export function createGoogleDrivingMiles(opts: { apiKey: string; fetchImpl?: typeof fetch }): (destination: string) => Promise<number | null> {
  return async (destination: string) => {
    if (!opts.apiKey || !destination.trim()) return null;
    const f = opts.fetchImpl ?? fetch;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(`${HOME_BASE.lat},${HOME_BASE.lng}`)}&destinations=${encodeURIComponent(destination)}&mode=driving&units=imperial&key=${encodeURIComponent(opts.apiKey)}`;
    try {
      const resp = await f(url);
      if (!resp.ok) return null;
      const data = await resp.json();
      const element = data?.status === "OK" ? data?.rows?.[0]?.elements?.[0] : null;
      const meters = element?.status === "OK" ? element?.distance?.value : null;
      return typeof meters === "number" && Number.isFinite(meters) && meters >= 0 ? meters / METERS_PER_MILE : null;
    } catch {
      return null;
    }
  };
}

function defaultDrivingMiles(): (destination: string) => Promise<number | null> {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const denoEnv = (globalThis as any).Deno?.env;
  const apiKey = typeof denoEnv?.get === "function" ? denoEnv.get("GOOGLE_MAPS_API_KEY") ?? "" : "";
  return createGoogleDrivingMiles({ apiKey });
}

const sameAddressText = (e: EventFields, stored: Any): boolean =>
  !!stored && e.address_line1 === (stored.line1 || "") && e.address_city === (stored.city || "") && e.address_state === (stored.state || "") && e.address_zip === (stored.zip || "");

function defaultAddressVerifier(): AddressVerifier {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const denoEnv = (globalThis as any).Deno?.env;
  const apiKey = typeof denoEnv?.get === "function" ? denoEnv.get("GOOGLE_MAPS_API_KEY") ?? "" : "";
  return createGoogleAddressVerifier({ apiKey });
}

// The city that may decide a FREE delivery for this save. Only a NEW or CHANGED address is verified; an unchanged address keeps its stored
// travel snapshot and is never re-verified (so historical orders are not silently re-priced). undefined = typed city, as before.
async function resolveVerifiedTravelCity(
  deps: StaffSaveDeps,
  rules: Any,
  e: EventFields,
  existing: Any,
  orderRef: string,
): Promise<string | undefined> {
  const includedCities = includedCitiesOf(rules ?? {});
  if (includedCities.length === 0) return undefined;
  if (existing && sameAddressText(e, existing.addresses)) return undefined;
  const verify = deps.verifyAddress ?? defaultAddressVerifier();
  let verification: CityVerification | null = null;
  try {
    verification = await verify({ line1: e.address_line1, city: e.address_city, state: e.address_state, zip: e.address_zip, lat: null, lng: null }, includedCities);
  } catch {
    verification = null;
  }
  const trusted = resolveTrustedTravelCity(verification, e.address_city, includedCities);
  if (trusted.review) {
    console.warn(`[staff-order-save] travel_city_review order=${orderRef} review=${trusted.review} verification=${trusted.status}`);
  }
  return trusted.city;
}

async function resolveDistance(
  deps: StaffSaveDeps,
  params: Pick<CalculatePricingParams, "eventDetails" | "existingOrder">,
  e: EventFields,
): Promise<{ ok: true; miles: number } | { ok: false }> {
  const existing = params.existingOrder;
  // Same address as the stored order: the stored travel snapshot stands (this includes a legacy order whose miles were never
  // recorded; nothing is re-measured, and nothing the browser sends can change it).
  if (existing && (shouldReuseSavedTravel(params.eventDetails, existing) || sameAddressText(e, existing.addresses))) {
    return { ok: true, miles: parseFloat(String(existing.travel_total_miles)) || 0 };
  }
  const destination = [e.address_line1, e.address_city, `${e.address_state} ${e.address_zip}`.trim()].map((x) => x.trim()).filter(Boolean).join(", ");
  const measure = deps.drivingMiles ?? defaultDrivingMiles();
  let miles: number | null = null;
  try {
    miles = await measure(destination);
  } catch {
    miles = null;
  }
  if (miles === null || !Number.isFinite(miles) || miles < 0 || miles > MAX_DISTANCE_MILES) return { ok: false };
  return { ok: true, miles: Math.round(miles * 100) / 100 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------------------------------------------------
const normalizeZip = (zip: string) => zip.replace(/\s+/g, "").trim();
const addressKey = (line1: string, city: string, state: string, zip: string) =>
  `${line1.toLowerCase().trim()}|${city.toLowerCase().trim()}|${state.toUpperCase().trim()}|${normalizeZip(zip)}`;

async function upsertAddress(db: Db, customerId: string | null, e: EventFields): Promise<string | null> {
  const key = addressKey(e.address_line1, e.address_city, e.address_state, e.address_zip);
  for (let attempt = 0; attempt < 2; attempt++) {
    const found = await db.from("addresses").select("id, lat, lng").eq("address_key", key).maybeSingle();
    if (found.error) return null;
    if (found.data?.id) {
      if ((found.data.lat == null || found.data.lng == null) && e.address_lat !== null && e.address_lng !== null) {
        await db.from("addresses").update({ lat: e.address_lat, lng: e.address_lng }).eq("id", found.data.id);
      }
      return found.data.id as string;
    }
    const ins = await db.from("addresses").insert({
      customer_id: customerId, line1: e.address_line1.trim(), line2: e.address_line2 || null, city: e.address_city.trim(), state: e.address_state.trim(),
      zip: normalizeZip(e.address_zip), lat: e.address_lat, lng: e.address_lng, address_key: key,
    }).select("id").single();
    if (!ins.error && ins.data?.id) return ins.data.id as string;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reconciliation of discounts / custom fees against what is stored
// ---------------------------------------------------------------------------------------------------------------------
function reconcile<T extends { id?: string; name: string }>(stored: Array<T & { id: string }>, desired: T[], same: (a: T, b: T) => boolean) {
  const ops: Any[] = [];
  const logs: Array<{ field: string; old: string; new: string; change_type: string }> = [];
  let deleted = 0, updated = 0;
  const keptIds = new Set(desired.filter((d) => d.id).map((d) => d.id as string));
  for (const row of stored) {
    if (!keptIds.has(row.id)) { ops.push({ kind: "delete", id: row.id }); deleted++; logs.push({ field: "", old: row.name, new: "", change_type: "remove" }); }
  }
  for (const d of desired) {
    if (!d.id) { ops.push({ kind: "insert", ...d }); logs.push({ field: "", old: "", new: d.name, change_type: "add" }); continue; }
    const before = stored.find((r) => r.id === d.id);
    if (!before) return { error: "unknown_row" as const };
    if (!same(before as unknown as T, d)) { ops.push({ kind: "update", ...d }); updated++; logs.push({ field: "", old: before.name, new: d.name, change_type: "edit" }); }
  }
  return { ops, logs, deleted, updated };
}

// ---------------------------------------------------------------------------------------------------------------------
// Admin Edit
// ---------------------------------------------------------------------------------------------------------------------
const SAVE_KEYS = ["orderId", "expectedState", "edited", "items", "discounts", "customFees", "waivers", "customDepositCents", "customSetupFeeCents", "adminMessage", "adminOverrideApproval", "depositCatchupMode", "requireCardOnFile", "parks", "clientPricing"] as const;

export async function saveStaffOrderChanges(deps: StaffSaveDeps, raw: unknown): Promise<HttpResult> {
  if (!isObj(raw)) return bad("body");
  // Editing an existing order's pricing is an Admin / Master action (the Edge Function also gates the route on the role).
  if (deps.canOverridePricing !== true) return json(403, { success: false, code: "FORBIDDEN", error: "Forbidden: staff access required." });
  const extra = onlyKeys(raw, SAVE_KEYS);
  if (extra) return bad(`unknown field: ${extra}`);

  const orderId = typeof raw.orderId === "string" && UUID_RE.test(raw.orderId) ? raw.orderId : null;
  if (!orderId) return bad("orderId");
  if (!isObj(raw.expectedState) || !isObj(raw.expectedState.columns) || !isObj(raw.expectedState.children)) return bad("expectedState");
  const edited = parseEvent(raw.edited);
  if (typeof edited === "string") return bad(edited);
  const itemIntents = parseItems(raw.items, false);
  if (typeof itemIntents === "string") return bad(itemIntents);
  const discountsIn = parseDiscounts(raw.discounts ?? []);
  if (typeof discountsIn === "string") return bad(discountsIn);
  const feesIn = parseFees(raw.customFees ?? []);
  if (typeof feesIn === "string") return bad(feesIn);
  const waivers = parseWaivers(raw.waivers);
  if (typeof waivers === "string") return bad(waivers);
  if (waivers.same_day_weekday_delivery.waived && waivers.same_day_weekday_delivery.reason.trim() === "") return json(400, { success: false, code: "WAIVER_REASON_REQUIRED", error: "A reason is required to waive the Same-Day Weekday Delivery Fee." });
  const customDeposit = raw.customDepositCents === null || raw.customDepositCents === undefined ? null : wholeCents(raw.customDepositCents, 99_999_999);
  if (raw.customDepositCents !== null && raw.customDepositCents !== undefined && customDeposit === null) return bad("customDepositCents");
  const customSetup = raw.customSetupFeeCents === null || raw.customSetupFeeCents === undefined ? null : wholeCents(raw.customSetupFeeCents, 99_999_999);
  if (raw.customSetupFeeCents !== null && raw.customSetupFeeCents !== undefined && customSetup === null) return bad("customSetupFeeCents");
  const adminMessage = raw.adminMessage === undefined ? "" : str(raw.adminMessage, 4000);
  if (adminMessage === null) return bad("adminMessage");
  if (raw.depositCatchupMode !== undefined && raw.depositCatchupMode !== "require" && raw.depositCatchupMode !== "waive") return bad("depositCatchupMode");
  const parks = raw.parks === undefined ? { required: undefined, county: undefined } : raw.parks;
  if (!isObj(parks) || onlyKeys(parks, ["required", "county"])) return bad("parks");

  const { db } = deps;
  // ---- load the stored state ---------------------------------------------------------------------------------------
  const orderRes = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (orderRes.error || !orderRes.data) return json(404, { success: false, code: "ORDER_NOT_FOUND", error: "Order not found." });
  const order = orderRes.data;
  const [addrRes, itemsRes, discRes, feeRes, catalog] = await Promise.all([
    order.address_id ? db.from("addresses").select("*").eq("id", order.address_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("order_items").select("*").eq("order_id", orderId),
    db.from("order_discounts").select("*").eq("order_id", orderId),
    db.from("order_custom_fees").select("*").eq("order_id", orderId),
    loadBookingCatalog(db),
  ]);
  if (addrRes.error || itemsRes.error || discRes.error || feeRes.error) return json(500, { success: false, code: "LOAD_FAILED", error: "The order could not be loaded." });
  if (!catalog) return json(503, { success: false, code: "PRICING_UNAVAILABLE", error: "Pricing is temporarily unavailable." });
  const storedItems: Any[] = itemsRes.data ?? [];
  const storedDiscounts: Any[] = discRes.data ?? [];
  const storedFees: Any[] = feeRes.data ?? [];
  const orderWithAddress = { ...order, addresses: addrRes.data ?? null };

  // ---- a stale save never overwrites newer pricing -----------------------------------------------------------------
  const currentState = orderPricingState(order, storedItems, storedDiscounts, storedFees);
  if (!sameOrderPricingState(raw.expectedState as unknown as OrderPricingState, currentState)) {
    return json(409, { success: false, code: "STALE_ORDER", error: "This order changed since you opened it. Reload it and make your changes again." });
  }

  // ---- the lines: stored lines keep their stored prices; new lines are priced from the catalog -----------------------------
  const unitName = (id: string) => catalog.units.find((u) => u.id === id)?.name ?? "Unknown";
  const lines: PricedLine[] = storedItems.map((r) => ({
    id: r.id, unit_id: r.unit_id ?? undefined, unit_name: r.unit_id ? unitName(r.unit_id) : undefined, wet_or_dry: r.wet_or_dry ?? undefined,
    product_id: r.product_id ?? null, bundle_id: r.bundle_id ?? null, item_name: r.item_name ?? null,
    product_name: r.item_name ?? undefined, qty: r.qty, unit_price_cents: r.unit_price_cents, pricing_context: r.pricing_context ?? null,
    component_snapshot: r.component_snapshot ?? null, is_new: false, is_deleted: false, is_updated: false,
  }));
  let newCounter = 0;
  for (const it of itemIntents) {
    if (it.id) {
      const line = lines.find((l) => l.id === it.id);
      if (!line) return bad("items[].id is not on this order");
      if (it.is_deleted) line.is_deleted = true;
      else if (it.is_updated && it.qty !== line.qty) { line.qty = it.qty; line.is_updated = true; }
      continue;
    }
    if (it.is_deleted) continue;
    const created = newLine(it, catalog, `new-${++newCounter}`);
    if (!created) return json(409, { success: false, code: "ITEM_UNAVAILABLE", error: "One of the selected items is not available." });
    lines.push(created);
  }
  const eeResult = priceNewEventEssentials(lines, catalog);
  if (!eeResult.ok) return json(409, { success: false, code: "ITEM_UNAVAILABLE", error: "One of the selected items is not available." });
  const activeLines = lines.filter((l) => !l.is_deleted);
  if (activeLines.length === 0) return json(409, { success: false, code: "ORDER_EMPTY", error: "An order needs at least one item." });
  const { items: engineItems, eeProductItems } = stagedForEngine(lines);
  const equipmentBasisChanged = lines.some((l) => l.is_new || l.is_deleted || l.is_updated);

  // ---- discounts and custom fees against what is stored -------------------------------------------------------------------
  const dRec = reconcile(storedDiscounts, discountsIn, (a: Any, b: Any) => a.name === b.name && (a.amount_cents || 0) === (b.amount_cents || 0) && Number(a.percentage || 0) === Number(b.percentage || 0));
  if ("error" in dRec) return bad("discounts[].id is not on this order");
  const fRec = reconcile(storedFees, feesIn, (a: Any, b: Any) => a.name === b.name && (a.amount_cents || 0) === (b.amount_cents || 0));
  if ("error" in fRec) return bad("customFees[].id is not on this order");
  const discountsForPricing = discountsIn.map((d) => ({ ...d, is_new: !d.id }));
  const feesForPricing = feesIn.map((f) => ({ ...f, is_new: !f.id }));

  // ---- the Setup Fee basis, as the editor defines it ----------------------------------------------------------------------
  const basis = (ls: PricedLine[]) => {
    const active = ls.filter((l) => !l.is_deleted);
    return JSON.stringify({ hasInflatables: active.some((l) => l.unit_id), eeSubtotal: active.filter((l) => !l.unit_id && (l.product_id || l.bundle_id)).reduce((s, l) => s + l.unit_price_cents * l.qty, 0) });
  };
  const originalLines: PricedLine[] = storedItems.map((r) => ({ unit_id: r.unit_id ?? undefined, product_id: r.product_id, bundle_id: r.bundle_id, qty: r.qty, unit_price_cents: r.unit_price_cents, is_new: false, is_deleted: false, is_updated: false }));
  const setupFeeBasisChanged = basis(originalLines) !== basis(lines);

  // ---- price it ---------------------------------------------------------------------------------------------------------
  const existingOrder = { ...orderWithAddress, event_date: order.event_date, same_day_weekday_delivery_fee_cents: order.same_day_weekday_delivery_fee_cents ?? 0 };
  const hasInflatables = activeLines.some((l) => l.unit_id);
  const eventDetails = {
    event_date: edited.event_date, event_end_date: edited.event_end_date, location_type: edited.location_type,
    surface: (hasInflatables ? edited.surface : "grass") as "grass" | "cement", pickup_preference: edited.pickup_preference, generator_qty: edited.generator_qty,
    address_line1: edited.address_line1, address_city: edited.address_city, address_state: edited.address_state, address_zip: edited.address_zip,
  };
  const params: CalculatePricingParams = {
    items: engineItems, eeProductItems, eventDetails, discounts: discountsForPricing, customFees: feesForPricing,
    customDepositCents: customDeposit, customSetupFeeCents: customSetup, storedSetupFeeCents: order.setup_fee_cents ?? 0, setupFeeBasisChanged,
    equipmentBasisChanged, pricingRules: catalog.pricingRulesRow as Any,
    feeWaivers: {
      taxWaived: waivers.tax.waived, travelFeeWaived: waivers.travel.waived, sameDayPickupFeeWaived: waivers.same_day_pickup.waived,
      surfaceFeeWaived: waivers.surface.waived, generatorFeeWaived: waivers.generator.waived, sameDayWeekdayDeliveryFeeWaived: waivers.same_day_weekday_delivery.waived,
    },
    existingOrder: existingOrder as Any,
  };
  const distance = await resolveDistance(deps, params, edited);
  if (!distance.ok) return json(503, { success: false, code: "DISTANCE_UNAVAILABLE", error: "The delivery distance for this address could not be determined. Try again shortly." });
  const verifiedTravelCity = await resolveVerifiedTravelCity(deps, catalog.pricingRulesRow, edited, params.existingOrder, String(order.id ?? "unknown"));
  const priced = calculateOrderPricing(params, { distanceMiles: distance.miles, isSameDayWeekdayDelivery, verifiedTravelCity });
  if (priced.status !== "ok") return json(503, { success: false, code: "PRICING_UNAVAILABLE", error: "Pricing is temporarily unavailable." });
  const calculatedPricing = priced.calculatedPricing;

  // ---- the address -----------------------------------------------------------------------------------------------------------
  const editedOrder = { ...edited };
  let canonicalAddressId: string | undefined;
  if (hasAddressChanged(orderWithAddress, editedOrder)) {
    const id = await upsertAddress(db, order.customer_id ?? null, edited);
    if (!id) return json(500, { success: false, code: "ADDRESS_FAILED", error: "The address could not be saved." });
    canonicalAddressId = id;
  }

  // ---- plan the writes (the same planner the editor used, now with server-derived pricing) ---------------------------------
  const stagedForPlan = lines.map((l) => ({ ...l, product_name: l.product_name ?? l.item_name ?? undefined }));
  const plan = planOrderChanges({
    order: orderWithAddress, editedOrder, stagedItems: stagedForPlan, discounts: discountsForPricing, customFees: feesForPricing, calculatedPricing,
    customDepositCents: customDeposit, customSetupFeeCents: customSetup, adminMessage, canonicalAddressId,
    taxWaived: waivers.tax.waived, taxWaiveReason: waivers.tax.reason, travelFeeWaived: waivers.travel.waived, travelFeeWaiveReason: waivers.travel.reason,
    sameDayPickupFeeWaived: waivers.same_day_pickup.waived, sameDayPickupFeeWaiveReason: waivers.same_day_pickup.reason,
    surfaceFeeWaived: waivers.surface.waived, surfaceFeeWaiveReason: waivers.surface.reason, generatorFeeWaived: waivers.generator.waived, generatorFeeWaiveReason: waivers.generator.reason,
    sameDayWeekdayDeliveryFeeWaived: waivers.same_day_weekday_delivery.waived, sameDayWeekdayDeliveryFeeWaiveReason: waivers.same_day_weekday_delivery.reason,
    parksAcknowledgmentRequired: (parks as Any).required, parksAcknowledgmentCounty: (parks as Any).county,
    depositCatchupMode: raw.depositCatchupMode as "require" | "waive" | undefined, requireCardOnFile: raw.requireCardOnFile === undefined ? undefined : raw.requireCardOnFile === true,
  } as Any, { calculateTotal: storedOrderTotalCents });

  // The amounts of the fees that are waived are kept with the order; an unrecorded legacy amount stays unrecorded.
  const keptWaived = Object.keys(calculatedPricing.waived_fee_amounts_cents ?? {}).length > 0 ? calculatedPricing.waived_fee_amounts_cents : null;
  const storedWaived = order.waived_fee_amounts_cents && Object.keys(order.waived_fee_amounts_cents).length > 0 ? order.waived_fee_amounts_cents : null;
  if (JSON.stringify(keptWaived) !== JSON.stringify(storedWaived)) plan.changes.waived_fee_amounts_cents = keptWaived;

  const finalized = finalizeOrderPlan(plan, { deletedDiscountCount: dRec.deleted, updatedDiscountCount: dRec.updated, deletedFeeCount: fRec.deleted, updatedFeeCount: fRec.updated }, {
    adminOverrideApproval: order.status === ORDER_STATUS.DRAFT ? false : raw.adminOverrideApproval === true,
    nowIso: () => new Date().toISOString(),
  });

  const logs = [
    ...plan.itemOperations.map((op) => ({ field: op.log.field, old: String(op.log.oldValue ?? ""), new: String(op.log.newValue ?? ""), change_type: op.log.action === "update" ? "edit" : op.log.action })),
    ...dRec.logs.map((l) => ({ ...l, field: "discounts" })),
    ...fRec.logs.map((l) => ({ ...l, field: "custom_fees" })),
    ...finalized.logs.map(([field, o, n]) => ({ field, old: o === null || o === undefined ? "" : String(o), new: n === null || n === undefined ? "" : String(n), change_type: "edit" })),
  ];

  if (!finalized.shouldCommit) {
    return json(200, { success: true, saved: false, hasTrackedChanges: false, hasCustomerVisibleChanges: false, preserveCurrentStatus: finalized.preserveCurrentStatus, oldStatus: order.status });
  }

  const rpc = await db.rpc("apply_staff_order_save", {
    p_order_id: orderId,
    p_acting_user_id: deps.actingUserId,
    p_expected_state: currentState,
    p_order_changes: finalized.changes,
    p_item_ops: plan.itemOperations.map((op) => (op.kind === "delete" ? { kind: "delete", itemId: op.itemId } : op.kind === "update" ? { kind: "update", itemId: op.itemId, payload: op.payload } : { kind: "insert", payload: op.payload })),
    p_discount_ops: dRec.ops,
    p_fee_ops: fRec.ops,
    p_logs: logs,
  });
  if (rpc.error) {
    if (String(rpc.error.code ?? "") === "55000" || /payment is in progress/i.test(String(rpc.error.message ?? ""))) {
      return json(409, { success: false, code: "PAYMENT_IN_PROGRESS", error: "A payment is in progress for this order. Try again in a moment." });
    }
    console.error("[staff-order-save] apply_staff_order_save failed:", rpc.error.message);
    return json(500, { success: false, code: "SAVE_FAILED", error: "The changes could not be saved." });
  }
  if (rpc.data?.outcome === "stale") return json(409, { success: false, code: "STALE_ORDER", error: "This order changed since you opened it. Reload it and make your changes again." });
  if (rpc.data?.outcome !== "saved") return json(500, { success: false, code: "SAVE_FAILED", error: "The changes could not be saved." });

  return json(200, {
    success: true, saved: true,
    hasTrackedChanges: finalized.hasTrackedChanges, hasCustomerVisibleChanges: finalized.hasCustomerVisibleChanges, preserveCurrentStatus: finalized.preserveCurrentStatus,
    oldStatus: order.status, newStatus: (finalized.changes as Any).status ?? order.status,
    adminOverrideApproval: order.status === ORDER_STATUS.DRAFT ? false : raw.adminOverrideApproval === true,
    pricing: { total_cents: calculatedPricing.total_cents, deposit_due_cents: (finalized.changes as Any).deposit_due_cents ?? order.deposit_due_cents, balance_due_cents: (finalized.changes as Any).balance_due_cents ?? order.balance_due_cents },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Admin / Crew Invoice creation
// ---------------------------------------------------------------------------------------------------------------------
const INVOICE_KEYS = ["customerId", "items", "eventDetails", "discounts", "customFees", "waivers", "customDepositCents", "customSetupFeeCents", "adminMessage", "requireCardOnFile", "clientPricing"] as const;
const INVOICE_EVENT_KEYS = ["event_date", "event_end_date", "start_window", "end_window", "until_end_of_day", "location_type", "surface", "generator_qty", "pickup_preference", "same_day_responsibility_accepted", "overnight_responsibility_accepted", "address_line1", "address_line2", "city", "state", "zip", "lat", "lng"] as const;

export async function createStaffInvoiceOrder(deps: StaffSaveDeps, raw: unknown): Promise<HttpResult> {
  if (!isObj(raw)) return bad("body");
  const extra = onlyKeys(raw, INVOICE_KEYS);
  if (extra) return bad(`unknown field: ${extra}`);
  if (!isObj(raw.eventDetails) || onlyKeys(raw.eventDetails, INVOICE_EVENT_KEYS)) return bad("eventDetails");
  const ev = raw.eventDetails;
  const parsedEvent = parseEvent({
    location_type: ev.location_type, surface: ev.surface, generator_qty: ev.generator_qty ?? 0, start_window: ev.start_window, end_window: ev.end_window,
    event_date: ev.event_date, event_end_date: ev.event_end_date, pickup_preference: ev.pickup_preference, address_line1: ev.address_line1, address_line2: ev.address_line2,
    address_city: ev.city, address_state: ev.state, address_zip: ev.zip, address_lat: ev.lat, address_lng: ev.lng,
  });
  if (typeof parsedEvent === "string") return bad(parsedEvent);
  const customerId = raw.customerId === null || raw.customerId === undefined ? null : (typeof raw.customerId === "string" && UUID_RE.test(raw.customerId) ? raw.customerId : "bad");
  if (customerId === "bad") return bad("customerId");
  const itemIntents = parseItems(raw.items, true);
  if (typeof itemIntents === "string") return bad(itemIntents);
  if (itemIntents.length === 0 || itemIntents.some((i) => i.id)) return bad("items");
  const discountsIn = parseDiscounts(raw.discounts ?? []);
  if (typeof discountsIn === "string") return bad(discountsIn);
  const feesIn = parseFees(raw.customFees ?? []);
  if (typeof feesIn === "string") return bad(feesIn);
  const waivers = parseWaivers(raw.waivers);
  if (typeof waivers === "string") return bad(waivers);
  if (waivers.same_day_weekday_delivery.waived && waivers.same_day_weekday_delivery.reason.trim() === "") return json(400, { success: false, code: "WAIVER_REASON_REQUIRED", error: "A reason is required to waive the Same-Day Weekday Delivery Fee." });
  const customDeposit = raw.customDepositCents === null || raw.customDepositCents === undefined ? null : wholeCents(raw.customDepositCents, 99_999_999);
  if (raw.customDepositCents !== null && raw.customDepositCents !== undefined && customDeposit === null) return bad("customDepositCents");
  const customSetup = raw.customSetupFeeCents === null || raw.customSetupFeeCents === undefined ? null : wholeCents(raw.customSetupFeeCents, 99_999_999);
  if (raw.customSetupFeeCents !== null && raw.customSetupFeeCents !== undefined && customSetup === null) return bad("customSetupFeeCents");
  const adminMessage = raw.adminMessage === undefined ? "" : str(raw.adminMessage, 4000);
  if (adminMessage === null) return bad("adminMessage");

  // What a caller without the price-override capability may NOT supply. The capability comes from the verified role (deps), never
  // from this body. Crew builds a catalog-priced invoice: customer, items, event details, address and a message.
  const canOverride = deps.canOverridePricing === true;
  if (!canOverride) {
    if (discountsIn.length > 0) return forbiddenField("discounts");
    if (feesIn.length > 0) return forbiddenField("customFees");
    for (const k of WAIVER_KEYS) if (waivers[k].waived || waivers[k].reason.trim() !== "") return forbiddenField(`waivers.${k}`);
    if (customDeposit !== null) return forbiddenField("customDepositCents");
    if (customSetup !== null) return forbiddenField("customSetupFeeCents");
    if (raw.requireCardOnFile === false) return forbiddenField("requireCardOnFile");
  }

  const { db } = deps;
  const catalog = await loadBookingCatalog(db);
  if (!catalog) return json(503, { success: false, code: "PRICING_UNAVAILABLE", error: "Pricing is temporarily unavailable." });

  const lines: PricedLine[] = [];
  let n = 0;
  for (const it of itemIntents) {
    // Without the override capability a line is priced from the catalog; a request price is only accepted when it IS the catalog price.
    const { unit_price_cents: requestedPrice, ...withoutPrice } = it;
    const created = newLine(canOverride ? it : withoutPrice, catalog, `new-${++n}`);
    if (!created) return json(409, { success: false, code: "ITEM_UNAVAILABLE", error: "One of the selected items is not available." });
    if (!canOverride && requestedPrice !== undefined && requestedPrice !== created.unit_price_cents) return forbiddenField("items[].unit_price_cents");
    lines.push(created);
  }
  if (!priceNewEventEssentials(lines, catalog).ok) return json(409, { success: false, code: "ITEM_UNAVAILABLE", error: "One of the selected items is not available." });
  const { items: engineItems, eeProductItems } = stagedForEngine(lines);
  const hasInflatables = lines.some((l) => l.unit_id);

  const eventDetails = {
    event_date: parsedEvent.event_date, event_end_date: parsedEvent.event_end_date, location_type: parsedEvent.location_type,
    surface: (hasInflatables ? parsedEvent.surface : "grass") as "grass" | "cement", pickup_preference: parsedEvent.pickup_preference, generator_qty: parsedEvent.generator_qty,
    address_line1: parsedEvent.address_line1, address_city: parsedEvent.address_city, address_state: parsedEvent.address_state, address_zip: parsedEvent.address_zip,
  };
  const params: CalculatePricingParams = {
    items: engineItems, eeProductItems, eventDetails, discounts: discountsIn, customFees: feesIn, customDepositCents: customDeposit, customSetupFeeCents: customSetup,
    pricingRules: catalog.pricingRulesRow as Any,
    feeWaivers: {
      taxWaived: waivers.tax.waived, travelFeeWaived: waivers.travel.waived, sameDayPickupFeeWaived: waivers.same_day_pickup.waived,
      surfaceFeeWaived: waivers.surface.waived, generatorFeeWaived: waivers.generator.waived, sameDayWeekdayDeliveryFeeWaived: waivers.same_day_weekday_delivery.waived,
    },
  };
  const distance = await resolveDistance(deps, params, parsedEvent);
  if (!distance.ok) return json(503, { success: false, code: "DISTANCE_UNAVAILABLE", error: "The delivery distance for this address could not be determined. Try again shortly." });
  const verifiedTravelCity = await resolveVerifiedTravelCity(deps, catalog.pricingRulesRow, parsedEvent, undefined, "new");
  const priced = calculateOrderPricing(params, { distanceMiles: distance.miles, isSameDayWeekdayDelivery, verifiedTravelCity });
  if (priced.status !== "ok") return json(503, { success: false, code: "PRICING_UNAVAILABLE", error: "Pricing is temporarily unavailable." });
  const p = priced.calculatedPricing;

  const addressId = await upsertAddress(db, null, parsedEvent);
  if (!addressId) return json(500, { success: false, code: "ADDRESS_FAILED", error: "The address could not be saved." });

  const order: Record<string, Any> = {
    status: ORDER_STATUS.DRAFT,
    customer_id: customerId, address_id: addressId, event_address_line2: parsedEvent.address_line2.trim(),
    event_date: parsedEvent.event_date, event_end_date: parsedEvent.event_end_date, start_window: parsedEvent.start_window, end_window: parsedEvent.end_window,
    until_end_of_day: ev.until_end_of_day === true, location_type: parsedEvent.location_type, surface: hasInflatables ? parsedEvent.surface : null,
    generator_qty: parsedEvent.generator_qty, pickup_preference: parsedEvent.pickup_preference,
    same_day_responsibility_accepted: ev.same_day_responsibility_accepted === true, overnight_responsibility_accepted: ev.overnight_responsibility_accepted === true,
    subtotal_cents: p.subtotal_cents, travel_fee_cents: p.travel_fee_cents, travel_total_miles: p.travel_total_miles, travel_base_radius_miles: p.travel_base_radius_miles ?? 0,
    travel_chargeable_miles: p.travel_chargeable_miles ?? 0, travel_per_mile_cents: p.travel_per_mile_cents ?? 0, travel_is_flat_fee: p.travel_is_flat_fee ?? false,
    surface_fee_cents: hasInflatables ? p.surface_fee_cents : 0, same_day_pickup_fee_cents: p.same_day_pickup_fee_cents,
    same_day_weekday_delivery_fee_cents: p.same_day_weekday_delivery_fee_cents, generator_fee_cents: p.generator_fee_cents, setup_fee_cents: p.setup_fee_cents,
    event_essentials_subtotal_cents: p.event_essentials_subtotal_cents, tax_cents: p.tax_cents,
    tax_waived: waivers.tax.waived, tax_waive_reason: waivers.tax.waived ? waivers.tax.reason || null : null,
    travel_fee_waived: waivers.travel.waived, travel_fee_waive_reason: waivers.travel.waived ? waivers.travel.reason || null : null,
    same_day_pickup_fee_waived: waivers.same_day_pickup.waived, same_day_pickup_fee_waive_reason: waivers.same_day_pickup.waived ? waivers.same_day_pickup.reason || null : null,
    surface_fee_waived: waivers.surface.waived, surface_fee_waive_reason: waivers.surface.waived ? waivers.surface.reason || null : null,
    generator_fee_waived: waivers.generator.waived, generator_fee_waive_reason: waivers.generator.waived ? waivers.generator.reason || null : null,
    same_day_weekday_delivery_fee_waived: waivers.same_day_weekday_delivery.waived, same_day_weekday_delivery_fee_waive_reason: waivers.same_day_weekday_delivery.waived ? waivers.same_day_weekday_delivery.reason || null : null,
    deposit_due_cents: p.deposit_due_cents, deposit_required: p.deposit_due_cents > 0, balance_due_cents: p.balance_due_cents, custom_deposit_cents: customDeposit,
    tip_cents: 0, deposit_paid_cents: 0, booking_confirmation_sent: false, cancellation_reason: null, card_on_file_consent: false, sms_consent: false,
    admin_message: adminMessage || null, require_card_on_file: p.deposit_due_cents > 0 || !canOverride ? true : raw.requireCardOnFile !== false,
    waived_fee_amounts_cents: Object.keys(p.waived_fee_amounts_cents ?? {}).length > 0 ? p.waived_fee_amounts_cents : null,
  };

  const items = lines.map((l) => ({
    unit_id: l.unit_id ?? null, product_id: l.product_id ?? null, bundle_id: l.bundle_id ?? null, item_name: l.unit_id ? null : (l.item_name ?? l.product_name ?? null),
    qty: l.qty, unit_price_cents: l.unit_price_cents, wet_or_dry: l.unit_id ? l.wet_or_dry ?? "dry" : null, pricing_context: l.unit_id ? null : l.pricing_context ?? "standalone",
    component_snapshot: l.component_snapshot ?? null,
  }));
  const rpc = await db.rpc("create_staff_invoice_order", { p_order: order, p_items: items, p_discounts: discountsIn.map((d) => ({ name: d.name, amount_cents: d.amount_cents, percentage: d.percentage })), p_fees: feesIn.map((f) => ({ name: f.name, amount_cents: f.amount_cents })) });
  if (rpc.error || rpc.data?.outcome !== "created") return json(500, { success: false, code: "SAVE_FAILED", error: "The invoice could not be created." });
  return json(200, { success: true, orderId: rpc.data.order_id, pricing: { total_cents: p.total_cents, deposit_due_cents: p.deposit_due_cents, balance_due_cents: p.balance_due_cents } });
}
