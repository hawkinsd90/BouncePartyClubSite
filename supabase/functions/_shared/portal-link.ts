// Canonical customer portal links (Payment Safety A2.1).
//
// One link system: public.invoice_links. A normal customer portal link has link_type = 'portal'. This module is the
// ONLY place that mints one. It runs with a trusted (service-role) client, generates the token and the short code on
// the server, and never returns or logs anything the caller did not need:
//   - getOrCreatePortalLink(...)  -> the link (token included) for server code that must build a full URL or a proof
//   - buildPortalUrl(...)         -> the customer-facing short URL "<origin>/i/<shortCode>" only
//
// Authorization of the CALLER is the calling function's job (this module only requires that an order exists).
// Kept import-free so it can be loaded unchanged by the Node test harness, like _shared/auth.ts.

export const PORTAL_LINK_TYPE = "portal";
export const INVOICE_LINK_TYPE = "invoice";
// Link types that count as order-bound customer proof for normal customer capabilities. Legacy types
// ('portal_shortlink') are NOT proof: their tokens were never meant to be handed to customers.
export const PROOF_LINK_TYPES: readonly string[] = [PORTAL_LINK_TYPE, INVOICE_LINK_TYPE];
// Short codes resolve for these types (portal_shortlink resolves to an order id only, with no token).
export const RESOLVABLE_LINK_TYPES: readonly string[] = [PORTAL_LINK_TYPE, INVOICE_LINK_TYPE, "portal_shortlink"];

export const PORTAL_RETENTION_DAYS = 60;
export const PORTAL_FALLBACK_DAYS = 60;

// 56 unambiguous characters (no 0 O o 1 l I): 12 characters ~ 69.7 bits.
export const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
export const SHORT_CODE_LENGTH = 12;
export const TOKEN_BYTES = 32;
const MAX_INSERT_ATTEMPTS = 8;

export type RandomBytes = (length: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (length) => {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
};

// 64 lowercase hex characters from 32 CSPRNG bytes (same shape as the table default).
export function generatePortalToken(random: RandomBytes = defaultRandomBytes): string {
  return Array.from(random(TOKEN_BYTES), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Rejection sampling keeps every character equally likely (no modulo bias).
export function generateShortCode(random: RandomBytes = defaultRandomBytes): string {
  const n = SHORT_CODE_ALPHABET.length;
  const limit = Math.floor(256 / n) * n;
  let out = "";
  while (out.length < SHORT_CODE_LENGTH) {
    for (const b of random(SHORT_CODE_LENGTH * 2)) {
      if (b < limit) {
        out += SHORT_CODE_ALPHABET[b % n];
        if (out.length === SHORT_CODE_LENGTH) break;
      }
    }
  }
  return out;
}

// Mirrors public.portal_link_expires_at: start of the day after (event end date, else event date) + 60 days.
// With no date at all, issuance time + 60 days.
export function portalLinkExpiresAt(
  order: { event_end_date?: string | null; event_date?: string | null },
  now: Date = new Date(),
): Date {
  const raw = order.event_end_date || order.event_date;
  const m = typeof raw === "string" ? raw.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + PORTAL_RETENTION_DAYS + 1));
  }
  return new Date(now.getTime() + PORTAL_FALLBACK_DAYS * 24 * 60 * 60 * 1000);
}

export interface PortalLinkClient {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export interface PortalLink {
  orderId: string;
  token: string;
  shortCode: string;
  expiresAt: string;
}

export type PortalLinkResult =
  | { ok: true; link: PortalLink; created: boolean }
  | { ok: false; error: "order_not_found" | "link_failed" };

interface LinkRow {
  id: string;
  order_id: string;
  link_token: string;
  short_code: string | null;
  expires_at: string | null;
  link_type?: string;
}

function isActive(row: LinkRow, now: Date): boolean {
  return !!row.expires_at && new Date(row.expires_at).getTime() > now.getTime();
}

function toLink(row: LinkRow): PortalLink {
  return { orderId: row.order_id, token: row.link_token, shortCode: row.short_code as string, expiresAt: row.expires_at as string };
}

async function readActiveRow(client: PortalLinkClient, orderId: string): Promise<LinkRow | null> {
  const { data, error } = await client
    .from("invoice_links")
    .select("id, order_id, link_token, short_code, expires_at")
    .eq("order_id", orderId)
    .eq("link_type", PORTAL_LINK_TYPE)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error("portal link lookup failed");
  return (data as LinkRow | null) ?? null;
}

// Get or create the single active portal link for an order.
//   - an active, unrevoked portal link is reused (no new token);
//   - an expired one is retired (revoked_at) and replaced;
//   - a revoked one never counts as active, so a fresh link is minted.
export async function getOrCreatePortalLink(
  client: PortalLinkClient,
  orderId: string,
  options: { now?: Date; random?: RandomBytes } = {},
): Promise<PortalLinkResult> {
  const now = options.now ?? new Date();
  const random = options.random ?? defaultRandomBytes;
  if (typeof orderId !== "string" || !orderId) return { ok: false, error: "order_not_found" };

  try {
    const { data: order, error: orderError } = await client
      .from("orders")
      .select("id, event_date, event_end_date")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) return { ok: false, error: "link_failed" };
    if (!order) return { ok: false, error: "order_not_found" };

    const existing = await readActiveRow(client, orderId);
    if (existing) {
      if (isActive(existing, now) && existing.short_code) return { ok: true, link: toLink(existing), created: false };
      // Expired (or, defensively, missing its short code): retire it so the unique slot frees up.
      const { error: retireError } = await client
        .from("invoice_links")
        .update({ revoked_at: now.toISOString() })
        .eq("id", existing.id);
      if (retireError) return { ok: false, error: "link_failed" };
    }

    const expiresAt = portalLinkExpiresAt(order, now).toISOString();

    for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
      const row = {
        order_id: orderId,
        link_type: PORTAL_LINK_TYPE,
        link_token: generatePortalToken(random),
        short_code: generateShortCode(random),
        expires_at: expiresAt,
        deposit_cents: 0,
      };
      const { data: inserted, error: insertError } = await client
        .from("invoice_links")
        .insert(row)
        .select("id, order_id, link_token, short_code, expires_at")
        .maybeSingle();
      if (!insertError && inserted) return { ok: true, link: toLink(inserted as LinkRow), created: true };

      // A concurrent request may have created the order's single active link: use it.
      const winner = await readActiveRow(client, orderId);
      if (winner && isActive(winner, now) && winner.short_code) return { ok: true, link: toLink(winner), created: false };
      // Otherwise this was a short-code (or token) collision: retry with fresh randomness.
    }
    return { ok: false, error: "link_failed" };
  } catch {
    return { ok: false, error: "link_failed" };
  }
}

export function shortPortalUrl(origin: string, shortCode: string): string {
  return `${origin.replace(/\/+$/, "")}/i/${shortCode}`;
}

// The customer-facing short URL for an order, or null when no link could be issued (callers must then omit the link
// or fall back to a non-credential page; they must never fall back to a UUID-only portal URL).
export async function buildPortalUrl(
  client: PortalLinkClient,
  orderId: string,
  origin: string,
  options: { now?: Date; random?: RandomBytes } = {},
): Promise<string | null> {
  const result = await getOrCreatePortalLink(client, orderId, options);
  return result.ok ? shortPortalUrl(origin, result.link.shortCode) : null;
}

// Retire every active portal link of an order (explicit admin revocation).
export async function revokePortalLinks(
  client: PortalLinkClient,
  orderId: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const { error } = await client
      .from("invoice_links")
      .update({ revoked_at: now.toISOString() })
      .eq("order_id", orderId)
      .eq("link_type", PORTAL_LINK_TYPE)
      .is("revoked_at", null);
    return !error;
  } catch {
    return false;
  }
}

// Short codes are bearer credentials: only a plausible code is ever looked up.
export function isPlausibleShortCode(code: unknown): code is string {
  return typeof code === "string" && /^[A-Za-z0-9]{8,16}$/.test(code);
}

export interface ResolvedLink {
  orderId: string;
  // Present only for link types that are order-bound proof; legacy portal_shortlink resolves without one.
  token: string | null;
}

// Resolve a short code with a trusted client. Unknown, malformed, expired and revoked codes all return null: the
// caller cannot tell them apart.
export async function resolveShortCode(
  client: PortalLinkClient,
  code: unknown,
  now: Date = new Date(),
): Promise<ResolvedLink | null> {
  if (!isPlausibleShortCode(code)) return null;
  try {
    const { data, error } = await client
      .from("invoice_links")
      .select("order_id, link_token, link_type, expires_at, revoked_at")
      .eq("short_code", code)
      .maybeSingle();
    if (error || !data) return null;
    if (data.revoked_at) return null;
    if (!data.expires_at || new Date(data.expires_at).getTime() <= now.getTime()) return null;
    if (!RESOLVABLE_LINK_TYPES.includes(data.link_type)) return null;
    return {
      orderId: data.order_id,
      token: PROOF_LINK_TYPES.includes(data.link_type) ? data.link_token : null,
    };
  } catch {
    return null;
  }
}

// Return-URL token placement. The secret rides in the URL fragment (#t=...), which browsers never send in the
// request line or Referer, so servers, proxies and analytics do not see it. Anything that is not a plausible token
// is dropped rather than echoed into a URL.
export function portalTokenFragment(token: unknown): string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(token) ? `#t=${token}` : "";
}
