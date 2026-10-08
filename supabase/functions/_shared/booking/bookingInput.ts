// Public booking intent contract (Payment Safety A2.3).
//
// The browser sends WHAT the customer chose. It does not send, and the server never accepts, any value that decides
// money, identity or workflow state. Every field below is allowlisted and validated; an unexpected field anywhere is an
// error (a smuggled status, deposit_paid_cents, customer_id, address_id, stripe_* or refund field rejects the whole
// request). The only tolerated extras are three documented NON-AUTHORITATIVE legacy claims (item unit_price_cents and
// payment.claimed_*_cents): they are parsed, then ignored, so an older browser build or a tampered one cannot change a
// price or the required deposit.
//
// Import-free. Pure functions, no I/O.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export type BookingValidation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface BookingContact {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  business_name: string | null;
}

export interface BookingAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
}

export type BookingItemInput =
  | { type: "inflatable"; unit_id: string; wet_or_dry: "dry" | "water"; qty: number }
  | { type: "product"; product_id: string; qty: number }
  | { type: "bundle"; bundle_id: string; qty: number };

export interface BookingInput {
  contact: BookingContact;
  event: {
    event_date: string;
    event_end_date: string;
    start_window: string;
    end_window: string;
    until_end_of_day: boolean;
    location_type: "residential" | "commercial";
    pickup_preference: "next_day" | "same_day";
    // true = grass (stakes ok), false = cement, null = not asked (Event Essentials-only carts)
    can_stake: boolean | null;
    special_details: string | null;
    same_day_responsibility_accepted: boolean;
    overnight_responsibility_accepted: boolean;
    // The one client-measured number (Google driving distance). Range-checked; it only feeds the travel fee.
    distance_miles: number;
    address: BookingAddress;
  };
  billing: { same_as_event: boolean; address: Omit<BookingAddress, "lat" | "lng"> | null };
  items: BookingItemInput[];
  consents: { sms: boolean; card_on_file: boolean };
  payment: { selection_type: "deposit" | "full" | "custom"; selection_cents: number | null; tip_cents: number };
  referral: { source: string | null; detail: string | null };
}

export const MAX_BOOKING_ITEMS = 40;
export const MAX_ITEM_QTY = 50;
export const MAX_BOOKING_DAYS = 14;
export const MAX_DISTANCE_MILES = 500;
export const REFERRAL_SOURCES = ["social_media", "google", "physical_marketing", "referral", "returning_customer", "other"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function onlyKeys(o: Obj, allowed: readonly string[], where: string): string | null {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) return `unexpected_field:${where}.${k}`;
  return null;
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;
}
function optStr(v: unknown, max: number): string | null | undefined {
  // Blank (including whitespace-only) optional text means "not provided", e.g. an empty apartment/unit.
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return null;
  return str(v, max) ?? undefined; // undefined = invalid
}
function wholeCents(v: unknown, max = 100_000_000): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
}
function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function validDate(v: unknown): string | null {
  if (typeof v !== "string" || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

export function daysBetween(startYmd: string, endYmd: string): number {
  return Math.round((Date.parse(`${endYmd}T00:00:00Z`) - Date.parse(`${startYmd}T00:00:00Z`)) / 86_400_000);
}

function parseAddress(raw: unknown, where: string, withCoords: boolean): BookingValidation<BookingAddress> {
  if (!isObj(raw)) return { ok: false, error: `invalid:${where}` };
  const extra = onlyKeys(raw, withCoords ? ["line1", "line2", "city", "state", "zip", "lat", "lng"] : ["line1", "line2", "city", "state", "zip"], where);
  if (extra) return { ok: false, error: extra };
  const line1 = str(raw.line1, 200);
  const city = str(raw.city, 100);
  const state = str(raw.state, 50);
  const zip = str(raw.zip, 20);
  const line2 = optStr(raw.line2, 200);
  if (!line1 || !city || !state || !zip || line2 === undefined) return { ok: false, error: `invalid:${where}` };
  let lat: number | null = null;
  let lng: number | null = null;
  if (withCoords && raw.lat !== undefined && raw.lat !== null) {
    lat = finiteNumber(raw.lat);
    lng = finiteNumber(raw.lng);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok: false, error: `invalid:${where}.coordinates` };
  }
  return { ok: true, value: { line1, line2, city, state, zip, lat, lng } };
}

export function validateBookingInput(raw: unknown): BookingValidation<BookingInput> {
  if (!isObj(raw)) return { ok: false, error: "invalid_body" };
  const top = onlyKeys(raw, ["contact", "event", "billing", "items", "consents", "payment", "referral"], "request");
  if (top) return { ok: false, error: top };

  // contact
  if (!isObj(raw.contact)) return { ok: false, error: "invalid:contact" };
  const cx = onlyKeys(raw.contact, ["first_name", "last_name", "email", "phone", "business_name"], "contact");
  if (cx) return { ok: false, error: cx };
  const first = str(raw.contact.first_name, 100);
  const last = str(raw.contact.last_name, 100);
  const email = str(raw.contact.email, 254)?.toLowerCase() ?? null;
  const phone = str(raw.contact.phone, 40);
  const business = optStr(raw.contact.business_name, 150);
  if (!first || !last || !email || !EMAIL_RE.test(email) || !phone || business === undefined) return { ok: false, error: "invalid:contact" };

  // event
  if (!isObj(raw.event)) return { ok: false, error: "invalid:event" };
  const ev = raw.event;
  const ex = onlyKeys(ev, ["event_date", "event_end_date", "start_window", "end_window", "until_end_of_day", "location_type", "pickup_preference", "can_stake", "special_details", "same_day_responsibility_accepted", "overnight_responsibility_accepted", "distance_miles", "address"], "event");
  if (ex) return { ok: false, error: ex };
  const eventDate = validDate(ev.event_date);
  const eventEnd = validDate(ev.event_end_date ?? ev.event_date);
  if (!eventDate || !eventEnd) return { ok: false, error: "invalid:event.dates" };
  const span = daysBetween(eventDate, eventEnd);
  if (span < 0 || span + 1 > MAX_BOOKING_DAYS) return { ok: false, error: "invalid:event.date_range" };
  const startWindow = typeof ev.start_window === "string" && TIME_RE.test(ev.start_window) ? ev.start_window : null;
  const endWindow = typeof ev.end_window === "string" && TIME_RE.test(ev.end_window) ? ev.end_window : null;
  if (!startWindow || !endWindow) return { ok: false, error: "invalid:event.windows" };
  if (ev.location_type !== "residential" && ev.location_type !== "commercial") return { ok: false, error: "invalid:event.location_type" };
  if (ev.pickup_preference !== "next_day" && ev.pickup_preference !== "same_day") return { ok: false, error: "invalid:event.pickup_preference" };
  const canStake = ev.can_stake === true ? true : ev.can_stake === false ? false : ev.can_stake === null || ev.can_stake === undefined ? null : undefined;
  if (canStake === undefined) return { ok: false, error: "invalid:event.can_stake" };
  const special = optStr(ev.special_details, 2000);
  if (special === undefined) return { ok: false, error: "invalid:event.special_details" };
  for (const k of ["until_end_of_day", "same_day_responsibility_accepted", "overnight_responsibility_accepted"] as const) {
    if (ev[k] !== undefined && typeof ev[k] !== "boolean") return { ok: false, error: `invalid:event.${k}` };
  }
  const distance = finiteNumber(ev.distance_miles);
  if (distance === null || distance < 0 || distance > MAX_DISTANCE_MILES) return { ok: false, error: "invalid:event.distance_miles" };
  const addr = parseAddress(ev.address, "event.address", true);
  if (!addr.ok) return addr;

  // billing
  const billingRaw = raw.billing ?? { same_as_event: true };
  if (!isObj(billingRaw)) return { ok: false, error: "invalid:billing" };
  const bx = onlyKeys(billingRaw, ["same_as_event", "address"], "billing");
  if (bx) return { ok: false, error: bx };
  if (typeof billingRaw.same_as_event !== "boolean") return { ok: false, error: "invalid:billing.same_as_event" };
  let billingAddress: BookingInput["billing"]["address"] = null;
  if (!billingRaw.same_as_event) {
    const b = parseAddress(billingRaw.address, "billing.address", false);
    if (!b.ok) return b;
    billingAddress = { line1: b.value.line1, line2: b.value.line2, city: b.value.city, state: b.value.state, zip: b.value.zip };
  }

  // items
  if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > MAX_BOOKING_ITEMS) return { ok: false, error: "invalid:items" };
  const items: BookingItemInput[] = [];
  for (const [i, it] of raw.items.entries()) {
    if (!isObj(it)) return { ok: false, error: `invalid:items[${i}]` };
    const qty = it.qty;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QTY) return { ok: false, error: `invalid:items[${i}].qty` };
    // unit_price_cents is a legacy NON-AUTHORITATIVE claim: tolerated, never used.
    if (it.type === "inflatable") {
      const x = onlyKeys(it, ["type", "unit_id", "wet_or_dry", "qty", "unit_price_cents"], `items[${i}]`);
      if (x) return { ok: false, error: x };
      if (typeof it.unit_id !== "string" || !UUID_RE.test(it.unit_id) || (it.wet_or_dry !== "dry" && it.wet_or_dry !== "water")) return { ok: false, error: `invalid:items[${i}]` };
      items.push({ type: "inflatable", unit_id: it.unit_id, wet_or_dry: it.wet_or_dry, qty });
    } else if (it.type === "product") {
      const x = onlyKeys(it, ["type", "product_id", "qty", "unit_price_cents"], `items[${i}]`);
      if (x) return { ok: false, error: x };
      if (typeof it.product_id !== "string" || !UUID_RE.test(it.product_id)) return { ok: false, error: `invalid:items[${i}]` };
      items.push({ type: "product", product_id: it.product_id, qty });
    } else if (it.type === "bundle") {
      const x = onlyKeys(it, ["type", "bundle_id", "qty", "unit_price_cents"], `items[${i}]`);
      if (x) return { ok: false, error: x };
      if (typeof it.bundle_id !== "string" || !UUID_RE.test(it.bundle_id)) return { ok: false, error: `invalid:items[${i}]` };
      items.push({ type: "bundle", bundle_id: it.bundle_id, qty });
    } else {
      return { ok: false, error: `invalid:items[${i}].type` };
    }
  }

  // consents: real booleans only, never inferred
  if (!isObj(raw.consents)) return { ok: false, error: "invalid:consents" };
  const kx = onlyKeys(raw.consents, ["sms", "card_on_file"], "consents");
  if (kx) return { ok: false, error: kx };
  if (typeof raw.consents.sms !== "boolean" || typeof raw.consents.card_on_file !== "boolean") return { ok: false, error: "invalid:consents" };

  // payment: the customer's CHOICE (not an amount the server relies on for the deposit)
  const payRaw = raw.payment ?? { selection_type: "deposit" };
  if (!isObj(payRaw)) return { ok: false, error: "invalid:payment" };
  const px = onlyKeys(payRaw, ["selection_type", "selection_cents", "tip_cents", "claimed_deposit_cents", "claimed_total_cents", "claimed_subtotal_cents"], "payment");
  if (px) return { ok: false, error: px };
  const selType = payRaw.selection_type;
  if (selType !== "deposit" && selType !== "full" && selType !== "custom") return { ok: false, error: "invalid:payment.selection_type" };
  let selCents: number | null = null;
  if (selType === "custom") {
    selCents = wholeCents(payRaw.selection_cents);
    if (selCents === null) return { ok: false, error: "invalid:payment.selection_cents" };
  }
  const tip = payRaw.tip_cents === undefined || payRaw.tip_cents === null ? 0 : wholeCents(payRaw.tip_cents);
  if (tip === null) return { ok: false, error: "invalid:payment.tip_cents" };

  // referral
  const refRaw = raw.referral ?? {};
  if (!isObj(refRaw)) return { ok: false, error: "invalid:referral" };
  const rx = onlyKeys(refRaw, ["source", "detail"], "referral");
  if (rx) return { ok: false, error: rx };
  let source: string | null = null;
  if (refRaw.source !== undefined && refRaw.source !== null && refRaw.source !== "") {
    if (typeof refRaw.source !== "string" || !REFERRAL_SOURCES.includes(refRaw.source)) return { ok: false, error: "invalid:referral.source" };
    source = refRaw.source;
  }
  const detail = optStr(refRaw.detail, 200);
  if (detail === undefined) return { ok: false, error: "invalid:referral.detail" };

  return {
    ok: true,
    value: {
      contact: { first_name: first, last_name: last, email, phone, business_name: business },
      event: {
        event_date: eventDate,
        event_end_date: eventEnd,
        start_window: startWindow,
        end_window: endWindow,
        until_end_of_day: ev.until_end_of_day === true,
        location_type: ev.location_type,
        pickup_preference: ev.pickup_preference,
        can_stake: canStake,
        special_details: special,
        same_day_responsibility_accepted: ev.same_day_responsibility_accepted === true,
        overnight_responsibility_accepted: ev.overnight_responsibility_accepted === true,
        distance_miles: distance,
        address: addr.value,
      },
      billing: { same_as_event: billingRaw.same_as_event, address: billingAddress },
      items,
      consents: { sms: raw.consents.sms, card_on_file: raw.consents.card_on_file },
      payment: { selection_type: selType, selection_cents: selCents, tip_cents: tip },
      referral: { source, detail },
    },
  };
}
