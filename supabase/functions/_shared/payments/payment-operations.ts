// Payment operations: the server-side half of every Stripe charge this application creates.
//
// A payment OPERATION is one `payments` row that exists BEFORE the provider is called. The database (migration
// 20261019120000_add_payment_operations_and_single_financial_application.sql) decides the permitted amounts from the order
// row, owns the lease, and is the single place that applies a successful payment to an order. This module is the thin,
// shared orchestration around it:
//
//   claimPaymentOperation   ask the database for the operation (a customer or admin only ever supplies a SELECTION)
//   chargeSavedCard         run the provider charge for an operation with a stable idempotency key
//   finalizeOperation       apply the payment (idempotent; the webhook and the reconciler call the same function)
//   releaseOperation        give the lease back, optionally closing the operation as failed or cancelled
//   resolveCheckoutOperation  decide what a still-open Checkout operation means (paid, reusable, or superseded)
//
// No imports (structural types only) so it can be unit-tested outside Deno. The Stripe and Supabase clients are passed in.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

// An Edge Function request is cut off well before this; a request still working cannot have its lease taken over, and a
// crashed request only delays a retry by five minutes.
export const PAYMENT_LEASE_SECONDS = 300;
// Stripe's largest amount in cents.
export const MAX_PAYMENT_CENTS = 99_999_999;
// Stripe replays an idempotency key for 24 hours. Past this age a pending operation that never learned its PaymentIntent
// is looked up by metadata instead of being created again.
export const IDEMPOTENCY_REPLAY_SECONDS = 12 * 3600;
// A Checkout Session offered to a customer stays payable this long.
export const CHECKOUT_SESSION_SECONDS = 3600;

export function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_PAYMENT_CENTS;
}

export type PaymentPurpose = "deposit" | "balance";

export interface PaymentOperation {
  paymentId: string;
  operationKey: string;
  claimId: string;
  paymentType: PaymentPurpose;
  principalCents: number;
  // What the principal pays: deposit_paid_cents and balance_paid_cents respectively. They always add up to principalCents.
  depositPrincipalCents: number;
  balancePrincipalCents: number;
  tipCents: number;
  grossCents: number;
  providerPaymentIntentId: string | null;
  checkoutSessionId: string | null;
  orderStatus: string | null;
  resumed: boolean;
  // When a money-moving provider request for this operation was first started (written BEFORE the request). NULL means none ever
  // was. It is not the operation's age: the operation may have been created long before the first request.
  providerAttemptedAt: string | null;
  // The order no longer authorizes this operation (see claimPaymentOperation). It must never start a new provider charge.
  stale: boolean;
  createdAt: string | null;
}

export type ClaimResult =
  | { ok: true; op: PaymentOperation }
  | { ok: false; outcome: string; detail: Record<string, unknown> };

export interface ClaimParams {
  orderId: string;
  purpose: PaymentPurpose;
  actor: "staff" | "customer";
  claimId: string;
  useSelection?: boolean;
  requestedPrincipalCents?: number | null;
  requestedTipCents?: number | null;
  expectedDepositDueCents?: number | null;
}

// Why a stale operation was refused, in the vocabulary the callers already map to responses.
const STALE_REASON_OUTCOME: Record<string, string> = {
  already_paid: "order_changed",
  no_deposit_due: "order_changed",
};

function operationFromClaim(r: Record<string, Any>, claimId: string, resumed: boolean, stale: boolean): PaymentOperation {
  return {
    paymentId: r.payment_id,
    operationKey: r.operation_key,
    claimId,
    paymentType: r.payment_type,
    principalCents: r.principal_cents,
    depositPrincipalCents: r.deposit_principal_cents,
    balancePrincipalCents: r.balance_principal_cents,
    tipCents: r.tip_cents,
    grossCents: r.gross_cents,
    providerPaymentIntentId: r.provider_payment_intent_id ?? null,
    checkoutSessionId: r.checkout_session_id ?? null,
    orderStatus: r.order_status ?? null,
    resumed,
    providerAttemptedAt: r.provider_attempted_at ?? null,
    stale,
    createdAt: r.created_at ?? null,
  };
}

// Claims (or resumes) the order's single open payment operation. The database re-derives what the order authorizes NOW. An
// operation that is already open is handed back for charging only if the order still authorizes exactly it. If it does not,
// it is STALE: this function never lets a stale operation make a new provider charge. Either
//   - a provider charge already exists (or is found by the operation key): the operation is returned so that charge can be
//     read and reconciled (nothing new is created), or
//   - no provider request was EVER started for it (provider_attempted_at is NULL): it is closed and the current-state error is
//     returned; or
//   - a request was started but its outcome is not known: the operation stays open, the lease is given back and the caller is
//     told PAYMENT_STATUS_UNKNOWN. A lookup that finds nothing, a lookup that fails and the passing of time are all NOT proof that
//     the provider took no money.
// `stripe` is needed for the provider lookup; without it a stale operation can only be refused or reconciled by its session.
export async function claimPaymentOperation(db: Any, p: ClaimParams, stripe?: Any): Promise<ClaimResult> {
  const { data, error } = await db.rpc("claim_payment_operation", {
    p_order_id: p.orderId,
    p_purpose: p.purpose,
    p_actor: p.actor,
    p_claim_id: p.claimId,
    p_use_selection: p.useSelection === true,
    p_requested_principal_cents: p.requestedPrincipalCents ?? null,
    p_requested_tip_cents: p.requestedTipCents ?? null,
    p_expected_deposit_due_cents: p.expectedDepositDueCents ?? null,
    p_stale_seconds: PAYMENT_LEASE_SECONDS,
  });
  if (error || !data || typeof data !== "object") {
    return { ok: false, outcome: "error", detail: { message: error?.message ?? "no result" } };
  }
  const r = data as Record<string, Any>;

  if (r.outcome === "claimed" || r.outcome === "resumed") {
    return { ok: true, op: operationFromClaim(r, p.claimId, r.outcome === "resumed", false) };
  }

  if (r.outcome === "stale_operation") {
    const reason = String(r.reason ?? "order_changed");
    const refusal = STALE_REASON_OUTCOME[reason] ?? reason;
    const op = operationFromClaim(r, p.claimId, true, true);
    // An open Checkout Session is settled by the caller (paid: applied; otherwise closed), never reused.
    if (op.checkoutSessionId) return { ok: true, op };
    // No money-moving provider request was ever started for this operation: nothing can have been charged, so it is safe to close.
    if (!op.providerAttemptedAt) {
      await releaseOperation(db, op, "cancelled");
      return { ok: false, outcome: refusal, detail: { stale: true, reason } };
    }
    // A request WAS started but no PaymentIntent id is recorded (a lost response). Only the provider can say what happened.
    const lookup: ProviderLookup = stripe ? await adoptProviderPaymentIntent(db, stripe, op) : { kind: "unknown", reason: "no_provider_client" };
    if (lookup.kind === "found") return { ok: true, op };
    await releaseOperation(db, op, null);
    return { ok: false, outcome: "payment_status_unknown", detail: { stale: true, reason, lookup: lookup.kind } };
  }

  return { ok: false, outcome: String(r.outcome ?? "error"), detail: r };
}

export async function recordProvider(
  db: Any,
  op: PaymentOperation,
  ids: { paymentIntentId?: string | null; checkoutSessionId?: string | null },
): Promise<boolean> {
  if (!ids.paymentIntentId && !ids.checkoutSessionId) return true;
  const { data, error } = await db.rpc("record_payment_operation_provider", {
    p_payment_id: op.paymentId,
    p_claim_id: op.claimId,
    p_payment_intent_id: ids.paymentIntentId ?? null,
    p_checkout_session_id: ids.checkoutSessionId ?? null,
  });
  if (error) return false;
  if (data === true) {
    if (ids.paymentIntentId) op.providerPaymentIntentId = ids.paymentIntentId;
    if (ids.checkoutSessionId) op.checkoutSessionId = ids.checkoutSessionId;
  }
  return data === true;
}

export async function releaseOperation(db: Any, op: PaymentOperation, finalStatus: "failed" | "cancelled" | null): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("release_payment_operation", {
      p_payment_id: op.paymentId,
      p_claim_id: op.claimId,
      p_final_status: finalStatus,
    });
    if (error) {
      console.error("[payment-operations] release failed:", error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error("[payment-operations] release threw:", e instanceof Error ? e.message : "unknown");
    return false;
  }
}

export interface FinalizeInput {
  paymentId: string;
  // Exactly one of these identifies the caller: the lease owner, or a provider-authoritative caller holding the key.
  claimId?: string | null;
  operationKey?: string | null;
  paymentIntentId?: string | null;
  checkoutSessionId?: string | null;
  amountReceivedCents: number;
  paymentMethod?: string | null;
  paymentBrand?: string | null;
  paymentLast4?: string | null;
  feeCents?: number | null;
  netCents?: number | null;
  paymentMethodId?: string | null;
  stripeCustomerId?: string | null;
}

export interface FinalizeResult {
  ok: boolean;
  outcome: string;
  applied: boolean;
  statusChanged: boolean;
  orderStatus: string | null;
  previousStatus: string | null;
  appliedPrincipalCents: number;
  excessPrincipalCents: number;
  tipCents: number;
  paymentType: string | null;
  detail: Record<string, unknown>;
}

export async function finalizeOperation(db: Any, f: FinalizeInput): Promise<FinalizeResult> {
  const { data, error } = await db.rpc("finalize_payment_operation", {
    p_payment_id: f.paymentId,
    p_claim_id: f.claimId ?? null,
    p_operation_key: f.operationKey ?? null,
    p_provider_payment_intent_id: f.paymentIntentId ?? null,
    p_checkout_session_id: f.checkoutSessionId ?? null,
    p_amount_received: f.amountReceivedCents,
    p_payment_method: f.paymentMethod ?? null,
    p_payment_brand: f.paymentBrand ?? null,
    p_payment_last4: f.paymentLast4 ?? null,
    p_fee: f.feeCents ?? null,
    p_net: f.netCents ?? null,
    p_pm_id: f.paymentMethodId ?? null,
    p_customer_id: f.stripeCustomerId ?? null,
  });
  if (error || !data || typeof data !== "object") {
    return { ok: false, outcome: "error", applied: false, statusChanged: false, orderStatus: null, previousStatus: null, appliedPrincipalCents: 0, excessPrincipalCents: 0, tipCents: 0, paymentType: null, detail: { message: error?.message ?? "no result" } };
  }
  const r = data as Record<string, Any>;
  const outcome = String(r.outcome ?? "error");
  return {
    ok: outcome === "applied" || outcome === "already_applied",
    outcome,
    applied: r.applied === true,
    statusChanged: r.status_changed === true,
    orderStatus: r.order_status ?? null,
    previousStatus: r.previous_status ?? null,
    appliedPrincipalCents: r.applied_principal_cents ?? 0,
    excessPrincipalCents: r.excess_principal_cents ?? 0,
    tipCents: r.tip_cents ?? 0,
    paymentType: r.payment_type ?? null,
    detail: r,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Provider errors
// ---------------------------------------------------------------------------------------------------------------

export type StripeErrorClass = "declined" | "invalid" | "unknown";

// declined  the card was refused: the PaymentIntent (if any) did not take money, the operation is over
// invalid   the request was rejected before anything was created
// unknown   we do not know whether Stripe took the money (network, 5xx, rate limit, idempotency conflict, anything else)
export function classifyStripeError(err: Any): StripeErrorClass {
  const type = String(err?.type ?? err?.rawType ?? "");
  const code = String(err?.code ?? "");
  if (type === "StripeCardError" || type === "card_error" || code === "card_declined" || code === "authentication_required") return "declined";
  const piStatus = err?.payment_intent?.status ?? err?.raw?.payment_intent?.status;
  if (piStatus === "requires_payment_method" && (type === "StripeCardError" || type === "card_error")) return "declined";
  if ((type === "StripeInvalidRequestError" || type === "invalid_request_error") && code !== "idempotency_key_in_use") return "invalid";
  return "unknown";
}

export function operationIdempotencyKey(op: { operationKey: string }, scope: "pi" | "cs" | "customer"): string {
  return `${op.operationKey}:${scope}`;
}

export function ageSeconds(createdAt: string | null): number {
  if (!createdAt) return 0;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 1000) : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Card on file
// ---------------------------------------------------------------------------------------------------------------

// What a lookup of an operation's PaymentIntent at the provider established. These are three different facts and must never be
// merged:
//   found      the exact PaymentIntent exists
//   not_found  the provider answered successfully and has no such PaymentIntent
//   unknown    the lookup failed, was malformed, or the found id could not be saved locally: absence is NOT proven
export type ProviderLookup =
  | { kind: "found"; paymentIntent: Any }
  | { kind: "not_found" }
  | { kind: "unknown"; reason: string };

export async function lookupProviderPaymentIntent(stripe: Any, op: PaymentOperation): Promise<ProviderLookup> {
  try {
    const res = await stripe.paymentIntents.search({ query: `metadata['payment_operation_key']:'${op.operationKey}'`, limit: 1 });
    if (!res || !Array.isArray(res.data)) return { kind: "unknown", reason: "malformed_response" };
    if (res.data.length === 0) return { kind: "not_found" };
    const pi = res.data[0];
    if (!pi || typeof pi.id !== "string" || pi.metadata?.payment_operation_key !== op.operationKey) return { kind: "unknown", reason: "malformed_match" };
    return { kind: "found", paymentIntent: pi };
  } catch (e) {
    console.error("[payment-operations] provider lookup failed:", e instanceof Error ? e.message : "unknown");
    return { kind: "unknown", reason: "lookup_failed" };
  }
}

// An earlier request for this operation may have reached Stripe and never learned the PaymentIntent id (a lost response). Look the
// PaymentIntent up by the operation key it was created with and remember it on the operation. Only a PaymentIntent that is both
// found AND saved counts as found; a failure to save it leaves the answer unknown (the charge exists but is not yet ours to use).
export async function adoptProviderPaymentIntent(db: Any, stripe: Any, op: PaymentOperation): Promise<ProviderLookup> {
  if (op.providerPaymentIntentId) return { kind: "found", paymentIntent: null };
  const look = await lookupProviderPaymentIntent(stripe, op);
  if (look.kind !== "found") return look;
  const saved = await recordProvider(db, op, { paymentIntentId: look.paymentIntent.id });
  return saved ? look : { kind: "unknown", reason: "could_not_save_provider_id" };
}

// Durably note that a money-moving provider request is about to start (see mark_payment_operation_provider_attempt).
export async function markProviderAttempt(db: Any, op: PaymentOperation): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("mark_payment_operation_provider_attempt", { p_payment_id: op.paymentId, p_claim_id: op.claimId });
    if (error || data !== true) return false;
    op.providerAttemptedAt = op.providerAttemptedAt ?? new Date().toISOString();
    return true;
  } catch {
    return false;
  }
}

export type ChargeResult =
  | { kind: "succeeded"; paymentIntent: Any; finalize: FinalizeResult; details: PaymentDetails }
  // The provider refused the money. The operation is closed (failed).
  | { kind: "declined"; message: string; needsAction: boolean; paymentIntentId: string | null }
  // We cannot tell yet whether the money moved. The operation stays open and keeps its identity; a retry resumes it.
  | { kind: "unconfirmed"; code: "PAYMENT_STATUS_UNKNOWN" | "PAYMENT_PROCESSING"; paymentIntentId: string | null }
  // The provider took the money but the database could not apply it. Nothing is charged again; the webhook or a retry applies it.
  | { kind: "finalize_failed"; paymentIntentId: string; detail: Record<string, unknown> }
  // The request itself was invalid (nothing was created at the provider); the operation is closed.
  | { kind: "invalid"; message: string };

export interface PaymentDetails {
  paymentMethod: string | null;
  paymentBrand: string | null;
  paymentLast4: string | null;
  feeCents: number | null;
  netCents: number | null;
  chargeId: string | null;
  paymentMethodId: string | null;
}

export async function collectPaymentDetails(stripe: Any, pi: Any): Promise<PaymentDetails> {
  const out: PaymentDetails = { paymentMethod: null, paymentBrand: null, paymentLast4: null, feeCents: null, netCents: null, chargeId: null, paymentMethodId: null };
  try {
    const pmRef = pi?.payment_method;
    const pmId = typeof pmRef === "string" ? pmRef : pmRef?.id ?? null;
    out.paymentMethodId = pmId;
    if (pmId) {
      const pm = await stripe.paymentMethods.retrieve(pmId);
      if (pm?.type === "card" && pm.card) {
        out.paymentMethod = "card";
        out.paymentBrand = pm.card.brand ?? null;
        out.paymentLast4 = pm.card.last4 ?? null;
      } else if (pm?.type === "us_bank_account") {
        out.paymentMethod = "bank_account";
        out.paymentLast4 = pm.us_bank_account?.last4 ?? null;
      } else {
        out.paymentMethod = pm?.type ?? null;
      }
    }
  } catch (e) {
    console.error("[payment-operations] payment method details unavailable:", e instanceof Error ? e.message : "unknown");
  }
  try {
    const chargeRef = pi?.latest_charge;
    const chargeId = typeof chargeRef === "string" ? chargeRef : chargeRef?.id ?? null;
    out.chargeId = chargeId;
    if (chargeId) {
      const charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
      const bt = charge?.balance_transaction;
      if (bt && typeof bt === "object") {
        out.feeCents = typeof bt.fee === "number" ? bt.fee : null;
        out.netCents = typeof bt.net === "number" ? bt.net : null;
      }
    }
  } catch (e) {
    console.error("[payment-operations] fee details unavailable:", e instanceof Error ? e.message : "unknown");
  }
  return out;
}

export interface ChargeSavedCardInput {
  db: Any;
  stripe: Any;
  op: PaymentOperation;
  orderId: string;
  stripeCustomerId: string;
  paymentMethodId: string;
  description?: string;
}

// Charge the saved card for an operation the caller already owns. The same operation always uses the same idempotency
// key, so a repeated call can only ever observe the one PaymentIntent.
export async function chargeSavedCard(input: ChargeSavedCardInput): Promise<ChargeResult> {
  const { db, stripe, op } = input;
  let pi: Any = null;

  // The last line of defense: an operation the order no longer authorizes never creates a provider charge. It can only be used
  // to read a charge that already exists.
  if (op.stale && !op.providerPaymentIntentId) {
    await releaseOperation(db, op, null);
    return { kind: "invalid", message: "This payment is no longer valid for the order. Please refresh and try again." };
  }

  try {
    if (op.providerPaymentIntentId) {
      pi = await stripe.paymentIntents.retrieve(op.providerPaymentIntentId);
    } else if (op.providerAttemptedAt && ageSeconds(op.providerAttemptedAt) > IDEMPOTENCY_REPLAY_SECONDS) {
      // The provider's idempotency window for the FIRST request is over (it is counted from that request, not from the operation's
      // creation): a blind create could now duplicate a charge that did reach Stripe. Only the provider can say; a miss or a failed
      // lookup is not an answer, so the operation stays open.
      const look = await adoptProviderPaymentIntent(db, stripe, op);
      if (look.kind !== "found") {
        await releaseOperation(db, op, null);
        return { kind: "unconfirmed", code: "PAYMENT_STATUS_UNKNOWN", paymentIntentId: null };
      }
      pi = await stripe.paymentIntents.retrieve(op.providerPaymentIntentId as string);
    } else {
      // Record, durably and before the request, that a money-moving request is starting. If that cannot be recorded nothing has been
      // sent, so the operation simply stays open for a retry.
      if (!op.providerAttemptedAt && !(await markProviderAttempt(db, op))) {
        await releaseOperation(db, op, null);
        return { kind: "unconfirmed", code: "PAYMENT_STATUS_UNKNOWN", paymentIntentId: null };
      }
      pi = await stripe.paymentIntents.create(
        {
          amount: op.grossCents,
          currency: "usd",
          customer: input.stripeCustomerId,
          payment_method: input.paymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            order_id: input.orderId,
            payment_type: op.paymentType,
            payment_operation_key: op.operationKey,
            payment_id: op.paymentId,
            principal_cents: String(op.principalCents),
            deposit_principal_cents: String(op.depositPrincipalCents),
            balance_principal_cents: String(op.balancePrincipalCents),
            tip_cents: String(op.tipCents),
          },
          ...(input.description ? { description: input.description } : {}),
        },
        { idempotencyKey: operationIdempotencyKey(op, "pi") },
      );
    }
  } catch (err: Any) {
    const cls = classifyStripeError(err);
    if (cls === "declined") {
      await releaseOperation(db, op, "failed");
      return { kind: "declined", message: typeof err?.message === "string" ? err.message : "Your card was declined.", needsAction: err?.code === "authentication_required", paymentIntentId: err?.payment_intent?.id ?? null };
    }
    if (cls === "invalid") {
      await releaseOperation(db, op, "failed");
      return { kind: "invalid", message: "The payment request could not be created." };
    }
    // Unknown: keep the operation (and its key) so the retry resumes it instead of creating a second charge.
    await releaseOperation(db, op, null);
    return { kind: "unconfirmed", code: "PAYMENT_STATUS_UNKNOWN", paymentIntentId: null };
  }

  if (pi?.id && !op.providerPaymentIntentId) {
    const recorded = await recordProvider(db, op, { paymentIntentId: pi.id });
    if (!recorded) console.error("[payment-operations] could not record the PaymentIntent id on the operation");
  }

  if (pi?.status === "succeeded") {
    const details = await collectPaymentDetails(stripe, pi);
    const fin = await finalizeOperation(db, {
      paymentId: op.paymentId,
      claimId: op.claimId,
      paymentIntentId: pi.id,
      amountReceivedCents: typeof pi.amount_received === "number" ? pi.amount_received : pi.amount,
      paymentMethod: details.paymentMethod,
      paymentBrand: details.paymentBrand,
      paymentLast4: details.paymentLast4,
      feeCents: details.feeCents,
      netCents: details.netCents,
      paymentMethodId: details.paymentMethodId,
      stripeCustomerId: input.stripeCustomerId,
    });
    if (!fin.ok) {
      // The money moved but is not applied yet. Keep the operation open; the webhook (or the retry) applies it.
      await releaseOperation(db, op, null);
      return { kind: "finalize_failed", paymentIntentId: pi.id, detail: fin.detail };
    }
    return { kind: "succeeded", paymentIntent: pi, finalize: fin, details };
  }

  if (pi?.status === "processing") {
    await releaseOperation(db, op, null);
    return { kind: "unconfirmed", code: "PAYMENT_PROCESSING", paymentIntentId: pi.id };
  }

  // requires_action / requires_payment_method / canceled ...: an off-session charge cannot proceed. Close it.
  if (pi?.id && pi.status !== "canceled") {
    try { await stripe.paymentIntents.cancel(pi.id); } catch { /* the PaymentIntent may already be final */ }
  }
  await releaseOperation(db, op, "failed");
  return { kind: "declined", message: `Payment could not be completed (status: ${pi?.status ?? "unknown"}).`, needsAction: pi?.status === "requires_action", paymentIntentId: pi?.id ?? null };
}

// ---------------------------------------------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------------------------------------------

export type CheckoutResolution =
  // The customer already paid: the operation is applied (or was).
  | { kind: "paid"; finalize: FinalizeResult }
  // The open session is still payable and is exactly what the caller wants.
  | { kind: "reusable"; url: string; sessionId: string }
  // The operation was closed (cancelled); the caller may claim a new one.
  | { kind: "superseded" }
  // The session state is unknown or cannot be closed right now; do not start another payment.
  | { kind: "busy" };

// An operation that already has a Checkout Session and is open again. The provider is the authority on what happened to it.
export async function resolveCheckoutOperation(
  db: Any,
  stripe: Any,
  op: PaymentOperation,
  wanted: { principalCents: number; tipCents: number } | null,
): Promise<CheckoutResolution> {
  if (!op.checkoutSessionId) return { kind: "busy" };
  let session: Any;
  try {
    session = await stripe.checkout.sessions.retrieve(op.checkoutSessionId, { expand: ["payment_intent"] });
  } catch {
    await releaseOperation(db, op, null);
    return { kind: "busy" };
  }

  if (session?.payment_status === "paid") {
    const pi = session.payment_intent && typeof session.payment_intent === "object" ? session.payment_intent : null;
    const details = pi ? await collectPaymentDetails(stripe, pi) : null;
    const fin = await finalizeOperation(db, {
      paymentId: op.paymentId,
      claimId: op.claimId,
      paymentIntentId: pi?.id ?? (typeof session.payment_intent === "string" ? session.payment_intent : null),
      checkoutSessionId: session.id,
      amountReceivedCents: session.amount_total ?? 0,
      paymentMethod: details?.paymentMethod,
      paymentBrand: details?.paymentBrand,
      paymentLast4: details?.paymentLast4,
      feeCents: details?.feeCents,
      netCents: details?.netCents,
      paymentMethodId: details?.paymentMethodId,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
    });
    if (!fin.ok) {
      await releaseOperation(db, op, null);
      return { kind: "busy" };
    }
    return { kind: "paid", finalize: fin };
  }

  if (session?.status === "complete") {
    // Completed but not (yet) paid: the provider may still settle it. Never start another payment meanwhile.
    await releaseOperation(db, op, null);
    return { kind: "busy" };
  }

  const sameWanted = !op.stale && wanted !== null && wanted.principalCents === op.principalCents && wanted.tipCents === op.tipCents;
  if (session?.status === "open" && sameWanted && session.url) {
    await releaseOperation(db, op, null);
    return { kind: "reusable", url: session.url, sessionId: session.id };
  }

  if (session?.status === "open") {
    try {
      await stripe.checkout.sessions.expire(op.checkoutSessionId);
    } catch {
      // It may have just been paid or expired; look again before deciding.
      try { session = await stripe.checkout.sessions.retrieve(op.checkoutSessionId); } catch { /* fall through */ }
      if (session?.payment_status === "paid") {
        await releaseOperation(db, op, null);
        return { kind: "busy" };
      }
    }
  }
  const closed = await releaseOperation(db, op, "cancelled");
  return closed ? { kind: "superseded" } : { kind: "busy" };
}
