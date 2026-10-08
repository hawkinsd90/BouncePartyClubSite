// Shared caller-authorization helpers for payment- and order-sensitive Edge Functions.
//
// A valid Supabase anon JWT is NOT proof of anything: the anon key ships in the public website bundle, and
// `verify_jwt = true` only checks the JWT signature, so the anon key passes it. Sensitive functions must prove
// the caller server-side, using one of:
//   - the service-role key (trusted internal / backend callers),
//   - a signed-in user whose user_roles row grants a required role (admin / master), or
//   - an order-bound customer proof: an unexpired invoice link token for the exact order, a verified Stripe
//     Checkout session whose metadata.order_id is the exact order, or a signed-in customer who owns the order.
//
// This file deliberately has NO imports (types are structural) so it can be unit-tested outside Deno. Callers
// pass the clients and the Stripe session lookup in.
//
// Roles are compared lowercase-safe. Live role values are lowercase (master, customer, crew), but the
// vocabulary also includes admin; both uppercase and lowercase spellings are accepted everywhere.

export const STAFF_ADMIN_ROLES: readonly string[] = ["admin", "master"];
// Roles allowed to create and send customer invoices. Crew may send invoices; crew may NOT charge saved cards,
// refund, or perform other admin/master-only financial actions (those use STAFF_ADMIN_ROLES).
export const INVOICE_SENDER_ROLES: readonly string[] = ["admin", "master", "crew"];

// Minimal structural shape of a supabase-js client (service role).
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AuthClient = any;

export function normalizeRole(role: unknown): string {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

export function getBearerToken(authHeader: string | null | undefined): string {
  if (!authHeader) return "";
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

// Constant-time string comparison (length difference still short-circuits, which is fine for fixed-length keys).
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type Caller =
  | { kind: "anonymous" } // no bearer, an unresolvable bearer, or only the public anon key
  | { kind: "service" } // the service-role key itself
  | { kind: "user"; userId: string; roles: string[] };

// Resolve who is calling. The service role key is matched by value against the function's own environment key
// (never by decoding JWT claims, which are unverified when verify_jwt is false).
export async function resolveCaller(
  client: AuthClient,
  authHeader: string | null | undefined,
  serviceRoleKey: string | undefined,
): Promise<Caller> {
  const token = getBearerToken(authHeader);
  if (!token) return { kind: "anonymous" };

  if (serviceRoleKey && timingSafeEqualStrings(token, serviceRoleKey)) return { kind: "service" };

  let userId: string | null = null;
  try {
    const { data, error } = await client.auth.getUser(token);
    if (!error && data?.user?.id) userId = data.user.id as string;
  } catch {
    userId = null;
  }
  // The public anon key is a valid JWT but not a user: getUser fails, so the caller stays anonymous.
  if (!userId) return { kind: "anonymous" };

  let roles: string[] = [];
  try {
    const { data, error } = await client.from("user_roles").select("role").eq("user_id", userId);
    if (!error && Array.isArray(data)) {
      roles = data.map((r: { role?: unknown }) => normalizeRole(r?.role)).filter(Boolean);
    }
  } catch {
    roles = [];
  }
  return { kind: "user", userId, roles };
}

export function callerHasAnyRole(caller: Caller, allowed: readonly string[]): boolean {
  if (caller.kind !== "user") return false;
  const wanted = new Set(allowed.map(normalizeRole));
  return caller.roles.some((r) => wanted.has(r));
}

export function isStaffAdmin(caller: Caller): boolean {
  return callerHasAnyRole(caller, STAFF_ADMIN_ROLES);
}

export interface AuthFailure {
  ok: false;
  status: 401 | 403;
  error: string;
}

// Require a signed-in user holding one of the allowed roles. 401 = no valid identity, 403 = identity but forbidden.
export function requireRoles(
  caller: Caller,
  allowed: readonly string[],
  messages: { unauthorized?: string; forbidden?: string } = {},
): { ok: true; userId: string } | AuthFailure {
  if (caller.kind === "anonymous") {
    return { ok: false, status: 401, error: messages.unauthorized ?? "Unauthorized" };
  }
  if (caller.kind === "service") {
    // Service role is a backend identity, not a user; callers that need a user id must not accept it.
    return { ok: false, status: 403, error: messages.forbidden ?? "Forbidden" };
  }
  if (!callerHasAnyRole(caller, allowed)) {
    return { ok: false, status: 403, error: messages.forbidden ?? "Forbidden" };
  }
  return { ok: true, userId: caller.userId };
}

// ---------------------------------------------------------------------------
// Order-bound customer proofs
// ---------------------------------------------------------------------------

// A token is valid for an order only if an invoice_links row has that exact token AND that exact order_id AND a
// non-null expires_at in the future AND no revoked_at AND an accepted link_type. Accepted types are the canonical
// customer 'portal' link and the admin 'invoice' link; legacy types (e.g. 'portal_shortlink') are never proof.
// The service-role client reads the table, so this does not depend on any anon policy.
export const ORDER_PROOF_LINK_TYPES: readonly string[] = ["portal", "invoice"];

export interface OrderLinkRow {
  id: string;
  order_id: string;
  link_type: string;
  expires_at: string | null;
  revoked_at: string | null;
  customer_filled?: boolean | null;
  deposit_cents?: number | null;
}

// The link row that proves this order for this token, or null. Rules: exact token AND exact order AND accepted link
// type AND not revoked AND a non-null, future expiry.
export async function findValidOrderLink(
  client: AuthClient,
  orderId: string,
  token: unknown,
  now: Date = new Date(),
): Promise<OrderLinkRow | null> {
  if (typeof token !== "string" || token.length < 16 || !orderId) return null;
  try {
    const { data, error } = await client
      .from("invoice_links")
      .select("id, order_id, link_type, expires_at, revoked_at, customer_filled, deposit_cents")
      .eq("link_token", token)
      .eq("order_id", orderId)
      .maybeSingle();
    if (error || !data) return null;
    if (data.revoked_at) return null;
    if (!ORDER_PROOF_LINK_TYPES.includes(data.link_type)) return null;
    if (!data.expires_at) return null;
    return new Date(data.expires_at).getTime() > now.getTime() ? (data as OrderLinkRow) : null;
  } catch {
    return null;
  }
}

// An Admin Invoice is current for an order when it has an invoice-type link that is unexpired and unrevoked. Signed-in
// ownership and a Stripe session prove access to the order, but only this (or an invoice-type token) makes it an invoice.
export async function hasCurrentInvoiceLink(client: AuthClient, orderId: string, now: Date = new Date()): Promise<boolean> {
  if (!orderId) return false;
  try {
    const { data, error } = await client
      .from("invoice_links")
      .select("id, expires_at, revoked_at")
      .eq("order_id", orderId)
      .eq("link_type", "invoice")
      .is("revoked_at", null);
    if (error || !Array.isArray(data)) return false;
    return data.some((r: { expires_at: string | null }) => !!r.expires_at && new Date(r.expires_at).getTime() > now.getTime());
  } catch {
    return false;
  }
}

export async function validateOrderToken(
  client: AuthClient,
  orderId: string,
  token: unknown,
  now: Date = new Date(),
): Promise<boolean> {
  return (await findValidOrderLink(client, orderId, token, now)) !== null;
}

// A signed-in customer owns an order when customers.user_id = their auth id and orders.customer_id = that customer.
export async function userOwnsOrder(client: AuthClient, userId: string, orderId: string): Promise<boolean> {
  if (!userId || !orderId) return false;
  try {
    const { data: order, error: orderError } = await client
      .from("orders")
      .select("customer_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order?.customer_id) return false;
    const { data: customer, error: customerError } = await client
      .from("customers")
      .select("id")
      .eq("id", order.customer_id)
      .eq("user_id", userId)
      .maybeSingle();
    return !customerError && !!customer;
  } catch {
    return false;
  }
}

export interface CheckoutSessionLike {
  status?: string | null;
  mode?: string | null;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
  customer?: string | { id?: string } | null;
}

// A Stripe Checkout session proves the caller completed a checkout for exactly this order.
export function sessionBoundToOrder(
  session: CheckoutSessionLike | null | undefined,
  orderId: string,
  options: { modes?: readonly string[] } = {},
): boolean {
  if (!session || !orderId) return false;
  const sessionOrderId = session.metadata?.order_id;
  if (!sessionOrderId || sessionOrderId !== orderId) return false;
  if (session.status !== "complete") return false;
  if (options.modes && (!session.mode || !options.modes.includes(session.mode))) return false;
  // A payment-mode session must also be paid; setup sessions carry no payment.
  if (session.mode === "payment" && session.payment_status !== "paid") return false;
  return true;
}

export function sessionCustomerId(session: CheckoutSessionLike | null | undefined): string | null {
  const c = session?.customer;
  if (!c) return null;
  return typeof c === "string" ? c : (c.id ?? null);
}

export type OrderProofKind = "token" | "owner" | "stripe_session";

export interface OrderProofInput {
  orderId: string;
  caller: Caller;
  token?: unknown;
  sessionId?: unknown;
  // Which proof kinds this action accepts. Defaults to all three.
  accept?: readonly OrderProofKind[];
  // Looks up a Checkout session. Required only when stripe_session proof is accepted and supplied.
  retrieveCheckoutSession?: (sessionId: string) => Promise<CheckoutSessionLike | null>;
  sessionModes?: readonly string[];
  now?: Date;
}

// Try the supplied proofs in cheapest-first order. Returns which proof succeeded, or null.
export async function proveOrderAccess(
  client: AuthClient,
  input: OrderProofInput,
): Promise<OrderProofKind | null> {
  const accept = input.accept ?? ["token", "owner", "stripe_session"];

  if (accept.includes("token") && input.token) {
    if (await validateOrderToken(client, input.orderId, input.token, input.now)) return "token";
  }

  if (accept.includes("owner") && input.caller.kind === "user") {
    if (await userOwnsOrder(client, input.caller.userId, input.orderId)) return "owner";
  }

  if (
    accept.includes("stripe_session") &&
    typeof input.sessionId === "string" &&
    input.sessionId &&
    input.retrieveCheckoutSession
  ) {
    try {
      const session = await input.retrieveCheckoutSession(input.sessionId);
      if (sessionBoundToOrder(session, input.orderId, { modes: input.sessionModes })) return "stripe_session";
    } catch {
      // An unknown or unreadable session is simply not proof.
    }
  }

  return null;
}

// Customer Portal access (Payment Safety A2.2). Who may read or act on an order through the portal endpoints:
//   - token:   an unexpired, unrevoked portal/invoice token bound to THIS order;
//   - owner:   the signed-in customer who owns THIS order;
//   - service: the backend;
//   - staff:   admin/master, only when the endpoint allows read-only support access.
// A raw order id, an email, a phone number, a name, the public anon key or a short code are never proof.
export type PortalProof =
  | { kind: "token"; link: OrderLinkRow }
  | { kind: "owner"; userId: string }
  | { kind: "service" }
  | { kind: "staff"; userId: string };

export async function authorizePortalOrder(
  client: AuthClient,
  input: { orderId: unknown; token?: unknown; caller: Caller; allowStaffRead?: boolean; now?: Date },
): Promise<PortalProof | null> {
  const { caller } = input;
  if (typeof input.orderId !== "string" || !input.orderId) return null;
  if (caller.kind === "service") return { kind: "service" };

  const link = await findValidOrderLink(client, input.orderId, input.token, input.now);
  if (link) return { kind: "token", link };

  if (caller.kind === "user") {
    if (await userOwnsOrder(client, caller.userId, input.orderId)) return { kind: "owner", userId: caller.userId };
    if (input.allowStaffRead && isStaffAdmin(caller)) return { kind: "staff", userId: caller.userId };
  }
  return null;
}

// Standard JSON failure response. `shape` lets each function keep its existing error shape.
export function authFailureResponse(
  failure: AuthFailure,
  corsHeaders: Record<string, string>,
  shape: "success-flag" | "error-only" = "success-flag",
): Response {
  const body = shape === "success-flag"
    ? { success: false, error: failure.error }
    : { error: failure.error };
  return new Response(JSON.stringify(body), {
    status: failure.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
