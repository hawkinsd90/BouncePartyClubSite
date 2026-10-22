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

// Historical accounts: customers.user_id was never filled in, ownership is auth user -> customer_profiles.contact_id ->
// contacts.customer_id. This is the same second branch current_customer_ids() uses in the database, so the dashboard, the
// database policies and waiver access agree on who owns an order. No email, phone or name is ever compared.
export async function userOwnsOrderViaProfile(client: AuthClient, userId: string, orderId: string): Promise<boolean> {
  if (!userId || !orderId) return false;
  try {
    const { data: order, error: orderError } = await client
      .from("orders")
      .select("customer_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order?.customer_id) return false;
    const { data: profiles, error: profileError } = await client
      .from("customer_profiles")
      .select("contact_id")
      .eq("user_id", userId);
    if (profileError || !Array.isArray(profiles)) return false;
    const contactIds = profiles.map((p: { contact_id?: string | null }) => p?.contact_id).filter((id: unknown): id is string => typeof id === "string" && !!id);
    if (contactIds.length === 0) return false;
    const { data: contacts, error: contactError } = await client
      .from("contacts")
      .select("customer_id")
      .in("id", contactIds);
    if (contactError || !Array.isArray(contacts)) return false;
    return contacts.some((c: { customer_id?: string | null }) => c?.customer_id === order.customer_id);
  } catch {
    return false;
  }
}

// Owner under either ownership model (direct customers.user_id, or the historical profile / contact link).
export async function userOwnsOrderCanonical(client: AuthClient, userId: string, orderId: string): Promise<boolean> {
  return (await userOwnsOrder(client, userId, orderId)) || (await userOwnsOrderViaProfile(client, userId, orderId));
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
    // Canonical ownership: the same two relationships My Orders uses, so an order the dashboard lists always opens.
    if (await userOwnsOrderCanonical(client, caller.userId, input.orderId)) return { kind: "owner", userId: caller.userId };
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

// ---------------------------------------------------------------------------
// Outbound notification relays (send-email, send-sms-notification)
// ---------------------------------------------------------------------------
//
// The relays spend Bounce Party Club's email and SMS capacity under the business identity, so they must not be reachable
// with only the public anon key (it ships in the website bundle and passes `verify_jwt = true`). A request is accepted only
// from one of:
//   - the service-role key: trusted Edge Functions (payments, lifecycle, invoices, contact form, webhooks). Matched by value
//     against the function's own environment key, never by decoding a JWT.
//   - a signed-in Admin or Master (database-backed user_roles check): manual messages, approval/rejection notices, edit
//     notices, permission-change notices. Their recipients are not restricted.
//   - a signed-in Crew member, order-bound only: the task flow (En Route / Arrived / Drop-off / Pickup) texts or emails the
//     customer of the order the task belongs to. Crew may use a stored template for an order, or send a message to that
//     order's own customer phone. Crew can never choose another recipient, send raw email, attach media, or relay for
//     anything that is not an existing order.
// Everything else (no Authorization, the anon key, an unresolvable token, an ordinary customer) is rejected before any
// provider request, message persistence, success/failure logging or secondary function call.
//
// Customer-triggered confirmations do not use the relay directly: they go through an order-bound server action
// (complete-booking / customer-portal-action) that looks up the customer's own address and calls the relay as the backend.
//

export type RelayKind = "email" | "sms";

export type RelayAuthorization =
  | { ok: true; actor: "service" | "staff" | "crew"; userId?: string }
  | { ok: false; status: 401 | 403; error: string };

const RELAY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SMS_KEYS = ["to", "message", "orderId", "templateKey", "mediaUrls", "skipFallback"];
const EMAIL_KEYS_CREW = ["templateName", "orderId", "skipFallback", "context"];
// The only stored templates the Crew task flow uses (TaskDetailModal, Complete Pickup). Every other template - including the
// Admin-addressed ones (booking_received_admin, lot_pictures_uploaded_admin, order_cancellation_admin) - is backend / staff only.
export const CREW_SMS_TEMPLATES: readonly string[] = ["pickup_thanks_sms"];
export const CREW_EMAIL_TEMPLATES: readonly string[] = ["pickup_complete"];

type RelayObj = Record<string, unknown>;
const isRelayObj = (v: unknown): v is RelayObj => typeof v === "object" && v !== null && !Array.isArray(v);
const relayDigits = (v: unknown): string => (typeof v === "string" ? v.replace(/\D/g, "") : "");
// Compare phone numbers by their last ten digits, the same way a US number is normalised when it is sent.
const relaySameUsPhone = (a: unknown, b: unknown): boolean => {
  const x = relayDigits(a);
  const y = relayDigits(b);
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
};

const relayUnauthorized = (): RelayAuthorization => ({ ok: false, status: 401, error: "Unauthorized" });
const relayForbidden = (): RelayAuthorization => ({ ok: false, status: 403, error: "Forbidden" });

// The customer of an order, read with the backend client. Null when the order does not exist.
async function orderCustomer(client: AuthClient, orderId: unknown): Promise<{ phone: string | null; email: string | null } | null> {
  if (typeof orderId !== "string" || !RELAY_UUID_RE.test(orderId)) return null;
  try {
    const { data, error } = await client.from("orders").select("id, customers(phone, email)").eq("id", orderId).maybeSingle();
    if (error || !data) return null;
    const c = Array.isArray(data.customers) ? data.customers[0] : data.customers;
    return { phone: (c?.phone as string | null) ?? null, email: (c?.email as string | null) ?? null };
  } catch {
    return null;
  }
}

async function crewMayRelay(client: AuthClient, kind: RelayKind, body: unknown): Promise<boolean> {
  if (!isRelayObj(body)) return false;
  const customer = await orderCustomer(client, body.orderId);
  if (!customer) return false;

  if (kind === "email") {
    // Stored template for an order only: the function addresses it to the order's customer. No raw `to`, html, text,
    // attachments, reply-to or sender from Crew (a missing customer email would otherwise fall back to `to`).
    if (!Object.keys(body).every((k) => EMAIL_KEYS_CREW.includes(k))) return false;
    return typeof body.templateName === "string" && CREW_EMAIL_TEMPLATES.includes(body.templateName);
  }

  if (!Object.keys(body).every((k) => SMS_KEYS.includes(k))) return false;
  if (body.templateKey !== undefined) {
    // Template mode: only the pickup thank-you, which the function addresses to the order's customer. No recipient or message of
    // Crew's own, and never an Admin-addressed template.
    return typeof body.templateKey === "string" && CREW_SMS_TEMPLATES.includes(body.templateKey) && body.to === undefined && body.message === undefined;
  }
  if (typeof body.message !== "string" || body.message.trim().length === 0) return false;
  if (Array.isArray(body.mediaUrls) ? body.mediaUrls.length > 0 : body.mediaUrls !== undefined) return false;
  return relaySameUsPhone(body.to, customer.phone);
}

export async function authorizeRelayCaller(
  client: AuthClient,
  authHeader: string | null | undefined,
  serviceRoleKey: string | undefined,
  kind: RelayKind,
  body: unknown,
): Promise<RelayAuthorization> {
  const caller = await resolveCaller(client, authHeader, serviceRoleKey);
  if (caller.kind === "anonymous") return relayUnauthorized();
  if (caller.kind === "service") return { ok: true, actor: "service" };

  const staff = requireRoles(caller, STAFF_ADMIN_ROLES);
  if (staff.ok) return { ok: true, actor: "staff", userId: staff.userId };

  if (callerHasAnyRole(caller, ["crew"]) && (await crewMayRelay(client, kind, body))) {
    return { ok: true, actor: "crew", userId: caller.userId };
  }
  return relayForbidden();
}

// ---------------------------------------------------------------------------------------------------------------------
// Narrow payload checks, applied only AFTER the caller is authorized and BEFORE any provider request.
// ---------------------------------------------------------------------------------------------------------------------
export type PayloadCheck = { ok: true } | { ok: false; error: string };

export function checkEmailPayload(body: RelayObj): PayloadCheck {
  const { to, subject, replyTo, attachments, templateName } = body;
  if (to !== undefined && (typeof to !== "string" || to.length > 320 || /[\r\n]/.test(to))) return { ok: false, error: "Invalid recipient" };
  if (subject !== undefined && (typeof subject !== "string" || subject.length > 998 || /[\r\n]/.test(subject))) return { ok: false, error: "Invalid subject" };
  if (replyTo !== undefined && (typeof replyTo !== "string" || replyTo.length > 320 || /[\r\n]/.test(replyTo))) return { ok: false, error: "Invalid reply-to" };
  if (templateName !== undefined && typeof templateName !== "string") return { ok: false, error: "Invalid template" };
  if (attachments !== undefined) {
    if (!Array.isArray(attachments) || attachments.length > 5) return { ok: false, error: "Invalid attachments" };
    for (const a of attachments) {
      if (!isRelayObj(a) || typeof a.filename !== "string" || typeof a.content !== "string" || a.filename.length > 200) return { ok: false, error: "Invalid attachments" };
    }
  }
  return { ok: true };
}

export function checkSmsPayload(body: RelayObj): PayloadCheck {
  const { to, message, mediaUrls, templateKey } = body;
  if (to !== undefined && (typeof to !== "string" || to.length > 40)) return { ok: false, error: "Invalid recipient" };
  if (message !== undefined && (typeof message !== "string" || message.length > 1600)) return { ok: false, error: "Invalid message" };
  if (templateKey !== undefined && typeof templateKey !== "string") return { ok: false, error: "Invalid template" };
  if (mediaUrls !== undefined) {
    if (!Array.isArray(mediaUrls) || mediaUrls.length > 10 || mediaUrls.some((u) => typeof u !== "string" || !/^https:\/\//i.test(u) || u.length > 2048)) {
      return { ok: false, error: "Invalid media" };
    }
  }
  return { ok: true };
}

export function relayDenied(auth: { status: 401 | 403; error: string }, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: auth.error }), {
    status: auth.status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
