// Validation of a website analytics event (record-site-event).
//
// The website sends these from the visitor's browser with the public key, so every field is untrusted. The contract mirrors what
// src/lib/siteEvents.ts actually sends: one of a fixed list of event names, an anonymous session id (a random UUID the browser
// makes up), an optional unit and order reference, the page path WITHOUT query or hash (credentials are redacted before it is
// sent), and for unit views the unit's name and slug. Nothing else is accepted: no timestamp (the database stamps it), no user or
// customer identity, no referrer, no free-form data.
// Import-free so the Node test harness can load it unchanged.

export const SITE_EVENT_NAMES: readonly string[] = [
  "page_view",
  "unit_view",
  "cart_started",
  "cart_submitted",
  "checkout_started",
  "checkout_completed",
  "customer_portal_viewed",
  "payment_link_opened",
  "waiver_link_opened",
  "cart_item_added",
  "cart_item_removed",
  "cart_address_entered",
  "cart_date_selected",
  "cart_price_calculated",
];

export const SITE_EVENT_KEYS: readonly string[] = ["event_name", "session_id", "unit_id", "order_id", "page_path", "metadata"];
export const METADATA_KEYS: readonly string[] = ["name", "slug"];
export const MAX_SITE_EVENT_BODY_CHARS = 2000;
export const MAX_PAGE_PATH_CHARS = 300;
export const MAX_METADATA_VALUE_CHARS = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export interface ValidSiteEvent {
  event_name: string;
  session_id: string | null;
  unit_id: string | null;
  order_id: string | null;
  page_path: string | null;
  metadata: Record<string, string>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNil = (v: unknown) => v === undefined || v === null;

export function validateSiteEvent(body: unknown): ValidSiteEvent | null {
  if (!isObj(body)) return null;
  if (!Object.keys(body).every((k) => SITE_EVENT_KEYS.includes(k))) return null;

  const { event_name, session_id, unit_id, order_id, page_path, metadata } = body;
  if (typeof event_name !== "string" || !SITE_EVENT_NAMES.includes(event_name)) return null;

  if (!isNil(session_id) && (typeof session_id !== "string" || !UUID_RE.test(session_id))) return null;
  if (!isNil(unit_id) && (typeof unit_id !== "string" || !UUID_RE.test(unit_id))) return null;
  if (!isNil(order_id) && (typeof order_id !== "string" || !UUID_RE.test(order_id))) return null;

  if (!isNil(page_path)) {
    if (typeof page_path !== "string" || page_path.length === 0 || page_path.length > MAX_PAGE_PATH_CHARS) return null;
    if (!page_path.startsWith("/") || /[?#]/.test(page_path) || CONTROL_RE.test(page_path)) return null;
  }

  const cleanMetadata: Record<string, string> = {};
  if (!isNil(metadata)) {
    if (!isObj(metadata)) return null;
    for (const [k, v] of Object.entries(metadata)) {
      if (!METADATA_KEYS.includes(k)) return null;
      if (typeof v !== "string" || v.length > MAX_METADATA_VALUE_CHARS || CONTROL_RE.test(v)) return null;
      cleanMetadata[k] = v;
    }
  }

  return {
    event_name,
    session_id: (session_id as string | null | undefined) ?? null,
    unit_id: (unit_id as string | null | undefined) ?? null,
    order_id: (order_id as string | null | undefined) ?? null,
    page_path: (page_path as string | null | undefined) ?? null,
    metadata: cleanMetadata,
  };
}
