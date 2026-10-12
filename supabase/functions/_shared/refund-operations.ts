// Refund operations (Step 3C-A), server side.
//
// One refund REQUEST is one operation, identified by an operation key the caller keeps across retries. The database reserves the
// request atomically (reserve_refund_operation: under the order row lock, before any Stripe call) as one or more `pending`
// order_refunds rows, each with a stable Stripe idempotency key. This module then performs the provider request(s) and records
// the results:
//
//   - the same operation key never creates a second refund: the rows already exist, a row whose provider result is unknown is
//     looked up at Stripe (by the id of the row we put in the refund's metadata) before anything is created again, and the Stripe
//     request carries the row's idempotency key;
//   - a provider result that cannot be recorded locally leaves the row `pending` with its reservation; the webhook (which finds the
//     row through the same metadata) or a retry settles it;
//   - a definitive Stripe rejection marks the row `failed`, which releases its reservation; an unknown outcome (timeout, 5xx) never
//     does;
//   - the webhook records any refund (ours or one made in the Stripe dashboard) through apply_provider_refund_event, one event per
//     individual refund, never from the cumulative amount of a charge.
//
// Recovery rules (Step 3C-A, final correction):
//   - a provider request is never sent unless the durable "a request may have started" marker is written (or already was);
//   - "no such refund at Stripe" is only believed when the WHOLE list of the payment's refunds was read (every page, an explicit
//     has_more=false); an incomplete, truncated or failed lookup proves nothing, and outside Stripe's replay window it stops the retry;
//   - an operation with any unfinished portion keeps its identity, and another operation on the same order cannot be started until it
//     is settled (the answer names it so the caller can resume it).
//
// Pure of Deno globals so the same code runs in the Edge Functions and in the tests.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface RefundDeps {
  db: Any;
  stripe: Any;
  nowMs?: () => number;
}

export interface RefundRequest {
  orderId: unknown;
  operationKey: unknown;
  amountCents: unknown;
  reason: unknown;
  actorId: string;
}

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

const json = (status: number, body: Record<string, unknown>): HttpResult => ({ status, body });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OPERATION_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_AMOUNT_CENTS = 99_999_999;
// Stripe replays an idempotent request for 24 hours; a request older than this is never re-sent blind (it is looked up first).
const IDEMPOTENCY_SAFE_MS = 20 * 60 * 60 * 1000;

export function stripeRefundReason(reason: unknown): "duplicate" | "fraudulent" | "requested_by_customer" {
  return reason === "duplicate" ? "duplicate" : reason === "fraudulent" ? "fraudulent" : "requested_by_customer";
}

// Stripe rejected the request: no refund was created. Anything else (connection error, 5xx, rate limit, an unknown error) leaves the
// outcome unknown.
export function isDefinitiveRefundFailure(err: Any): boolean {
  const t = err?.type;
  return t === "StripeInvalidRequestError" || t === "StripeAuthenticationError" || t === "StripePermissionError";
}

interface RefundRow {
  id: string;
  operation_index?: number;
  payment_id?: string | null;
  stripe_payment_intent_id: string | null;
  amount_cents: number;
  status: string;
  stripe_refund_id: string | null;
  provider_idempotency_key: string;
  provider_attempted_at?: string | null;
  failure_reason?: string | null;
  created_at?: string;
  // Set when this process could not settle the row.
  unresolved?: boolean;
  // Set when no provider request was made for it in this attempt (the durable marker could not be written).
  notSent?: boolean;
}

const MAX_LOOKUP_PAGES = 20;

// Finds our refund among the refunds of a PaymentIntent by the row id we put in its metadata. `complete` is true only when the whole
// list was read: the last page said has_more=false. A failed page, a body without a data array, a missing has_more flag, an empty page
// that claims more, or too many pages all leave `complete` false: absence is then NOT established.
export async function lookupRefundByRow(stripe: Any, paymentIntentId: string | null, rowId: string): Promise<{ found: Any | null; complete: boolean }> {
  if (!paymentIntentId) return { found: null, complete: false };
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_LOOKUP_PAGES; page++) {
    let list: Any;
    try {
      list = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    } catch {
      return { found: null, complete: false };
    }
    const data = Array.isArray(list?.data) ? list.data : null;
    if (!data) return { found: null, complete: false };
    const found = data.find((r: Any) => r?.metadata?.bpc_refund_id === rowId);
    if (found) return { found, complete: true };
    if (list.has_more === false) return { found: null, complete: true };
    if (list.has_more !== true || data.length === 0) return { found: null, complete: false };
    startingAfter = data[data.length - 1]?.id;
    if (typeof startingAfter !== "string" || !startingAfter) return { found: null, complete: false };
  }
  return { found: null, complete: false };
}

async function record(db: Any, rowId: string, refund: Any): Promise<{ ok: boolean; data?: Any }> {
  const res = await db.rpc("record_refund_provider_result", {
    p_refund_id: rowId,
    p_stripe_refund_id: refund?.id ?? null,
    p_stripe_status: refund?.status ?? "pending",
    p_failure_reason: refund?.failure_reason ?? null,
  });
  if (res?.error || !res?.data) return { ok: false };
  const o = res.data.outcome;
  return { ok: o === "succeeded" || o === "failed" || o === "unchanged", data: res.data };
}

async function settleRow(deps: RefundDeps, row: RefundRow, ctx: { orderId: string; operationKey: string; actorId: string; reason: unknown }): Promise<{ row: RefundRow; halt: boolean }> {
  const { db, stripe } = deps;
  const now = deps.nowMs ?? (() => Date.now());
  if (row.status !== "pending") return { row, halt: false };

  // The provider id is known: only the status can have changed.
  if (row.stripe_refund_id) {
    try {
      const rf = await stripe.refunds.retrieve(row.stripe_refund_id);
      const rec = await record(db, row.id, rf);
      if (rec.ok) return { row: { ...row, status: rec.data.status }, halt: false };
    } catch { /* unknown: the row stays pending */ }
    return { row: { ...row, unresolved: true }, halt: false };
  }

  // A provider request may already have been made for this row (an earlier attempt of this same operation).
  if (row.provider_attempted_at) {
    const look = await lookupRefundByRow(stripe, row.stripe_payment_intent_id, row.id);
    if (look.found) {
      const rec = await record(db, row.id, look.found);
      if (rec.ok) return { row: { ...row, status: rec.data.status, stripe_refund_id: look.found.id }, halt: false };
      return { row: { ...row, stripe_refund_id: look.found.id, unresolved: true }, halt: false };
    }
    // Inside Stripe's replay window the stable idempotency key makes re-sending safe even when the lookup proved nothing. Outside it,
    // only a COMPLETE lookup that found nothing allows a new request; anything less could be a refund the listing simply did not show.
    const age = row.created_at ? now() - Date.parse(row.created_at) : 0;
    if (!look.complete && age > IDEMPOTENCY_SAFE_MS) return { row: { ...row, unresolved: true }, halt: true };
  }

  // The durable marker comes first: "a provider request may have started" must be on record before one is made. Without it (the write
  // failed, threw, or the row is no longer a pending, unsent one) nothing is sent and the reservation is kept for a retry.
  let marked = false;
  let markerFailed = false;
  try {
    const res = await db.rpc("mark_refund_provider_attempt", { p_refund_id: row.id });
    if (res?.error) markerFailed = true;
    else marked = res?.data === true;
  } catch {
    markerFailed = true;
  }
  const alreadyMarked = !!row.provider_attempted_at;
  if (!(marked || (markerFailed && alreadyMarked))) return { row: { ...row, unresolved: true, notSent: true }, halt: true };

  let refund: Any;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: row.stripe_payment_intent_id,
        amount: row.amount_cents,
        reason: stripeRefundReason(ctx.reason),
        metadata: { bpc_refund_id: row.id, order_id: ctx.orderId, operation_key: ctx.operationKey, refunded_by: ctx.actorId },
      },
      { idempotencyKey: row.provider_idempotency_key },
    );
  } catch (err) {
    if (isDefinitiveRefundFailure(err)) {
      const rec = await record(db, row.id, { id: null, status: "failed", failure_reason: String((err as Any)?.message ?? "Stripe rejected the refund").slice(0, 300) });
      if (rec.ok) return { row: { ...row, status: "failed", failure_reason: "rejected" }, halt: false };
    }
    // The provider may or may not have issued it: keep the reservation, stop, and let the same key settle it.
    return { row: { ...row, unresolved: true }, halt: true };
  }

  const rec = await record(db, row.id, refund);
  if (rec.ok) return { row: { ...row, status: rec.data.status, stripe_refund_id: refund.id }, halt: false };
  // Stripe issued it but it could not be written down here: the row stays pending (reserved); the webhook finds it by metadata.
  return { row: { ...row, stripe_refund_id: refund?.id ?? null, unresolved: true }, halt: false };
}

export async function runRefundOperation(deps: RefundDeps, req: RefundRequest): Promise<HttpResult> {
  const { db } = deps;
  const orderId = typeof req.orderId === "string" && UUID_RE.test(req.orderId) ? req.orderId : null;
  const operationKey = typeof req.operationKey === "string" && OPERATION_KEY_RE.test(req.operationKey) ? req.operationKey : null;
  const amount = typeof req.amountCents === "number" && Number.isSafeInteger(req.amountCents) && req.amountCents > 0 && req.amountCents <= MAX_AMOUNT_CENTS ? req.amountCents : null;
  const reason = typeof req.reason === "string" ? req.reason.slice(0, 500) : "";
  if (!orderId) return json(400, { success: false, code: "INVALID_REQUEST", error: "A valid orderId is required." });
  if (!operationKey) return json(400, { success: false, code: "OPERATION_KEY_REQUIRED", error: "A refund request needs an operationKey (8-64 letters, digits, - or _) that stays the same when the request is retried." });
  if (amount === null) return json(400, { success: false, code: "INVALID_REQUEST", error: "A positive whole-cent amount is required." });

  const reserved = await db.rpc("reserve_refund_operation", {
    p_order_id: orderId, p_operation_key: operationKey, p_amount_cents: amount, p_reason: reason, p_actor: req.actorId,
  });
  if (reserved?.error) {
    const msg = String(reserved.error.message ?? "");
    if (msg.includes("refund_allocation_incomplete")) {
      return json(409, { success: false, code: "REFUND_ALLOCATION_INCOMPLETE", error: "The refundable amount could not be matched to the payments on this order. It needs manual review." });
    }
    return json(500, { success: false, code: "REFUND_RESERVATION_FAILED", error: "The refund could not be started. Nothing was refunded." });
  }
  const r = reserved?.data ?? {};
  switch (r.outcome) {
    case "order_not_found": return json(404, { success: false, code: "ORDER_NOT_FOUND", error: "Order not found." });
    case "no_refundable_payment": return json(404, { success: false, code: "NO_REFUNDABLE_PAYMENT", error: "No successful Stripe payments found for this order." });
    case "exceeds_refundable": return json(400, { success: false, code: "EXCEEDS_REFUNDABLE", error: `Refund amount exceeds maximum refundable amount. Max: ${r.max_refundable_cents} cents`, maxRefundableCents: r.max_refundable_cents });
    case "unsettled_operation": return json(409, { success: false, code: "UNSETTLED_REFUND_EXISTS", error: "An earlier refund request for this order has not been settled yet. Resume it (send its operation key again) before starting another refund; resuming never refunds twice.", resumeOperationKey: r.operation_key, resumeAmountCents: r.request_amount_cents });
    case "allocation_ambiguous": return json(409, { success: false, code: "REFUND_ALLOCATION_AMBIGUOUS", error: "This order has refunds recorded before refunds were linked to a payment, so a new refund cannot be matched to the right payment automatically. Issue it in Stripe; it will be recorded here." });
    case "key_conflict": return json(409, { success: false, code: "OPERATION_KEY_REUSED", error: "That operation key was already used for a different refund request." });
    case "invalid_request": return json(400, { success: false, code: "INVALID_REQUEST", error: "Invalid refund request." });
    case "reserved":
    case "existing":
      break;
    default:
      return json(500, { success: false, code: "REFUND_RESERVATION_FAILED", error: "The refund could not be started. Nothing was refunded." });
  }

  const rows: RefundRow[] = Array.isArray(r.refunds) ? r.refunds : [];
  const settled: RefundRow[] = [];
  let halted = false;
  for (const row of rows) {
    if (halted) { settled.push(row.status === "pending" ? { ...row, unresolved: true } : row); continue; }
    const out = await settleRow(deps, row, { orderId, operationKey, actorId: req.actorId, reason });
    settled.push(out.row);
    if (out.halt) halted = true;
  }

  const sum = (pred: (x: RefundRow) => boolean) => settled.filter(pred).reduce((a, x) => a + x.amount_cents, 0);
  const succeededCents = sum((x) => x.status === "succeeded");
  const failedCents = sum((x) => x.status === "failed");
  const unresolvedCents = sum((x) => x.status === "pending" && !!x.unresolved);
  const pendingCents = sum((x) => x.status === "pending" && !x.unresolved);
  const notSent = settled.some((x) => x.notSent === true);
  // FINAL: every portion is either succeeded or failed. Anything else (pending at Stripe, or unknown) is unfinished, and an unfinished
  // operation keeps its identity: the caller must send the same operation key again, never start a new request for the rest.
  const final = pendingCents === 0 && unresolvedCents === 0;
  const refunds = settled.map((x) => ({ id: x.id, amount: x.amount_cents, status: x.status, stripeRefundId: x.stripe_refund_id ?? null, unresolved: x.unresolved === true }));
  const base = { operationKey, existing: r.outcome === "existing", requestedCents: amount, succeededCents, pendingCents, failedCents, unresolvedCents, final, refunds };

  if (!final && (unresolvedCents > 0 || failedCents > 0)) {
    const where = notSent ? "A refund could not be started safely (nothing was sent to Stripe for that part)." : "The result of part of this refund is not known yet.";
    return json(202, { success: failedCents === 0, code: "REFUND_UNRESOLVED", status: "unresolved", warning: `${where} ${failedCents > 0 ? "Another part was rejected by Stripe. " : ""}Send the same request again to settle it; nothing is refunded twice.`, ...base });
  }
  if (!final) return json(200, { success: true, status: "pending", ...base });
  if (failedCents === amount) return json(422, { success: false, code: "REFUND_FAILED", status: "failed", error: "Stripe rejected the refund.", ...base });
  if (failedCents > 0) return json(207, { success: false, code: "REFUND_PARTIAL", status: "partial", error: "Part of the refund was rejected by Stripe; the rest is recorded.", ...base });
  return json(200, { success: true, status: "succeeded", ...base });
}

// ---------------------------------------------------------------------------------------------------------------------
// Webhook side
// ---------------------------------------------------------------------------------------------------------------------
export interface ApplyRefundOutcome {
  outcome: string;
  appliedNow?: boolean;
  orderId?: string | null;
  ledgerPaymentId?: string | null;
  paymentId?: string | null;
  refundRowId?: string | null;
  amountCents?: number;
}

// One individual Stripe Refund object (from refund.* / charge.refund.updated events, or from refunds.list for charge.refunded).
export async function applyProviderRefund(db: Any, refund: Any): Promise<ApplyRefundOutcome> {
  const pi = typeof refund?.payment_intent === "string" ? refund.payment_intent : refund?.payment_intent?.id ?? null;
  const amount = typeof refund?.amount === "number" ? refund.amount : 0;
  const res = await db.rpc("apply_provider_refund_event", {
    p_stripe_refund_id: refund?.id ?? null,
    p_payment_intent_id: pi,
    p_amount_cents: amount,
    p_stripe_status: refund?.status ?? "pending",
    p_failure_reason: refund?.failure_reason ?? null,
    p_reason: refund?.reason ?? null,
    p_bpc_refund_id: refund?.metadata?.bpc_refund_id ?? null,
  });
  if (res?.error) throw new Error(`apply_provider_refund_event failed: ${res.error.message}`);
  const d = res?.data ?? {};
  return { outcome: d.outcome ?? "unknown", appliedNow: d.applied_now === true, orderId: d.order_id ?? null, ledgerPaymentId: d.ledger_payment_id ?? null, paymentId: d.payment_id ?? null, refundRowId: d.refund_id ?? null, amountCents: amount };
}
