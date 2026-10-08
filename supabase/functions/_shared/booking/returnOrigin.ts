// Stripe return-origin allowlist (Payment Safety A2.3).
//
// stripe-checkout used to build success/cancel URLs from the request's Origin header or a body field, so a caller
// could point the Stripe redirect (and the {CHECKOUT_SESSION_ID} it carries) at any site. The origin is now chosen from
// a fixed allowlist: the production site, the configured SITE_URL, any origins listed in RETURN_ORIGINS, and loopback
// development hosts. Anything else falls back to the production origin; it never errors, so a legitimate customer on an
// unexpected host still completes checkout.

export const DEFAULT_RETURN_ORIGIN = "https://bouncepartyclub.com";
const BUILT_IN_ORIGINS = ["https://bouncepartyclub.com", "https://www.bouncepartyclub.com"];

function toOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function isLoopback(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function resolveReturnOrigin(candidates: unknown[], configured: unknown[] = []): string {
  const allowed = new Set<string>(BUILT_IN_ORIGINS);
  for (const c of configured) {
    for (const part of typeof c === "string" ? c.split(",") : []) {
      const o = toOrigin(part.trim());
      if (o && o.startsWith("https://")) allowed.add(o);
    }
  }
  for (const candidate of candidates) {
    const o = toOrigin(candidate);
    if (o && (allowed.has(o) || isLoopback(o))) return o;
  }
  const fallback = toOrigin(configured[0]);
  return fallback && fallback.startsWith("https://") ? fallback : DEFAULT_RETURN_ORIGIN;
}
