import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  checkRateLimit,
  createRateLimitResponse,
  getIdentifier,
  buildRateLimitKey,
} from "../_shared/rate-limit.ts";
import { validatePaymentMethod } from "../_shared/payments/payment-validation.ts";
import { completePostPayment } from "../_shared/payments/post-payment.ts";
import { checkEventEssentialsAvailabilityWith } from "../_shared/booking/eeOrderItemAvailability.ts";
import { supabaseAvailabilityPort } from "../_shared/booking/bookingAvailability.ts";
import {
  resolveCaller,
  isStaffAdmin,
  proveOrderAccess,
  authFailureResponse,
  type AuthClient,
} from "../_shared/auth.ts";
import {
  claimPaymentOperation,
  chargeSavedCard,
  resolveCheckoutOperation,
  releaseOperation,
  isCents,
  type PaymentOperation,
} from "../_shared/payments/payment-operations.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Stripe Checkout session lookup for the customer-proof path (loads the Stripe key lazily).
async function retrieveCheckoutSession(supabaseClient: AuthClient, sessionId: string) {
  const { data: keyData } = await supabaseClient
    .from("admin_settings")
    .select("value")
    .eq("key", "stripe_secret_key")
    .maybeSingle();
  if (!keyData?.value) return null;
  const stripe = new Stripe(keyData.value, { apiVersion: "2024-10-28.acacia" });
  return await stripe.checkout.sessions.retrieve(sessionId);
}

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// How each refusal from the payment operation claim is reported. Nothing here has touched Stripe.
const CLAIM_REFUSALS: Record<string, { status: number; code: string; error: string }> = {
  busy: { status: 409, code: "PAYMENT_IN_PROGRESS", error: "This order is already being processed. Please refresh and try again." },
  invalid_status: { status: 409, code: "ORDER_STATUS_NOT_PAYABLE", error: "This order is not in a state where this payment can be taken. Please refresh and try again." },
  order_changed: { status: 409, code: "ORDER_CHANGED", error: "This order changed while you were reviewing it. Please refresh and review the updated amounts." },
  catch_up_unavailable: { status: 409, code: "DEPOSIT_CATCH_UP_REVIEW_REQUIRED", error: "This order's deposit rose after a payment was made, but its earlier payments cannot be matched to the deposit automatically. The remaining deposit cannot be collected here; please contact us." },
  no_deposit_due: { status: 400, code: "NO_DEPOSIT_DUE", error: "No deposit amount configured for this order" },
  selection_invalid: { status: 409, code: "PAYMENT_SELECTION_INVALID", error: "The selected payment amount is no longer valid for this order. Please refresh and choose again." },
  ledger_conflict: { status: 409, code: "PAYMENT_RECORDS_CONFLICT", error: "This order's payment records need review before it can be charged. Please contact us." },
  over_balance: { status: 409, code: "BALANCE_CHANGED", error: "The balance due has changed. Please refresh and try again." },
  invalid_amount: { status: 400, code: "INVALID_AMOUNT", error: "Invalid payment amount." },
  not_found: { status: 404, code: "ORDER_NOT_FOUND", error: "Order not found" },
  invalid_request: { status: 400, code: "INVALID_REQUEST", error: "Invalid request." },
  payment_status_unknown: { status: 202, code: "PAYMENT_STATUS_UNKNOWN", error: "We could not confirm whether an earlier attempt at this payment went through yet. Please wait a moment and try again; it will not be charged twice." },
  error: { status: 500, code: "PAYMENT_UNAVAILABLE", error: "The payment could not be started. No charge was made. Please try again." },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  // The operation this request owns, once it has one. An unexpected failure gives the lease back WITHOUT closing the
  // operation, so a retry resumes the same operation (and the same Stripe idempotency key).
  let ownedOp: PaymentOperation | null = null;
  let supabaseForRelease: Any = null;

  try {
    const body = await req.json();
    const {
      orderId,
      paymentAmountCents: requestPaymentAmountCents,
      tipCents: requestTipCents,
      selectedPaymentType: requestSelectedPaymentType,
      expectedDepositDueCents: requestExpectedDepositDueCents,
      invoiceToken,
      sessionId,
    } = body;

    const ip = getIdentifier(req);
    const identifier = buildRateLimitKey(ip, orderId, "deposit");

    if (!ip && !orderId) {
      return reply(400, { success: false, error: "Invalid request: unable to identify client" });
    }

    const rateLimitResult = await checkRateLimit(
      "charge-deposit",
      identifier,
      undefined,
      true
    );

    if (!rateLimitResult.allowed) {
      if (rateLimitResult.reason === "missing_identifier") {
        return reply(400, { success: false, error: "Invalid request: unable to identify client" });
      }

      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    if (!orderId || typeof orderId !== "string") {
      return reply(400, { success: false, error: "Missing orderId" });
    }

    // A browser may express a SELECTION. Anything that is not a whole, non-negative number of cents is refused before
    // anything else happens (and so before Stripe).
    if (requestTipCents !== undefined && requestTipCents !== null && !isCents(requestTipCents)) {
      return reply(400, { success: false, code: "INVALID_TIP", error: "Invalid tip amount." });
    }
    if (requestPaymentAmountCents !== undefined && requestPaymentAmountCents !== null && !isCents(requestPaymentAmountCents)) {
      return reply(400, { success: false, code: "INVALID_AMOUNT", error: "Invalid payment amount." });
    }
    if (requestExpectedDepositDueCents !== undefined && requestExpectedDepositDueCents !== null && !isCents(requestExpectedDepositDueCents)) {
      return reply(400, { success: false, code: "INVALID_REQUEST", error: "Invalid request." });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    supabaseForRelease = supabaseClient;

    // ── Authorization ────────────────────────────────────────────────────────
    // The public anon key is not proof of anything. A card charge is allowed only for:
    //   - a signed-in admin/master (a deposit approval or a balance charge), or
    //   - a customer proving control of THIS order with an unexpired invoice token bound to it, a signed-in
    //     customer who owns it, or a completed Stripe Checkout session whose metadata.order_id is this order.
    // Crew are not admin and may not charge cards. Customers may not run balance charges here (customer balance
    // payments go through customer-balance-payment).
    const caller = await resolveCaller(
      supabaseClient,
      req.headers.get("Authorization"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );
    const staffCaller = caller.kind === "service" || isStaffAdmin(caller);

    if (!staffCaller) {
      const anonymous = caller.kind === "anonymous";
      if (requestSelectedPaymentType === "balance") {
        console.warn(`[charge-deposit] rejected: caller=${caller.kind}${caller.kind === "user" ? ` user=${caller.userId}` : ""} reason=balance_charge_requires_admin`);
        return authFailureResponse(
          { ok: false, status: anonymous ? 401 : 403, error: "Not authorized to charge this order." },
          corsHeaders
        );
      }

      const proof = await proveOrderAccess(supabaseClient, {
        orderId,
        caller,
        token: invoiceToken,
        sessionId,
        retrieveCheckoutSession: (id: string) => retrieveCheckoutSession(supabaseClient, id),
      });

      if (!proof) {
        console.warn(`[charge-deposit] rejected: caller=${caller.kind}${caller.kind === "user" ? ` user=${caller.userId}` : ""} reason=no_order_proof`);
        return authFailureResponse(
          { ok: false, status: anonymous ? 401 : 403, error: "Not authorized to charge this order." },
          corsHeaders
        );
      }
    }

    const isBalanceCharge = staffCaller && requestSelectedPaymentType === "balance";
    if (isBalanceCharge && !isCents(requestPaymentAmountCents)) {
      return reply(400, { success: false, code: "INVALID_AMOUNT", error: "Invalid payment amount." });
    }

    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      return reply(500, { success: false, error: "Stripe not configured" });
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    // Scalar-only fetch. No amount is read here: the permitted amounts come from the payment operation claim.
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, status, stripe_customer_id, stripe_payment_method_id, event_date, event_end_date")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      console.error("[charge-deposit] Order query error:", orderError);
      return reply(500, { success: false, error: `Order query failed: ${orderError.message}` });
    }

    if (!order) {
      return reply(404, { success: false, error: "Order not found" });
    }

    if (!order.stripe_customer_id) {
      return reply(400, { success: false, error: "No payment method on file for this order" });
    }

    let resolvedPaymentMethodId = order.stripe_payment_method_id;

    if (!resolvedPaymentMethodId) {
      try {
        const paymentMethods = await stripe.paymentMethods.list({
          customer: order.stripe_customer_id,
          type: "card",
          limit: 1,
        });

        if (paymentMethods.data.length > 0) {
          resolvedPaymentMethodId = paymentMethods.data[0].id;

          await supabaseClient
            .from("orders")
            .update({ stripe_payment_method_id: resolvedPaymentMethodId })
            .eq("id", orderId);
        }
      } catch (pmLookupError) {
        console.error("[charge-deposit] Failed to look up payment methods:", pmLookupError);
      }
    }

    if (!resolvedPaymentMethodId) {
      return reply(400, { success: false, error: "No payment method on file for this order" });
    }

    // Server-side availability check before charging — last line of defense
    try {
      const { data: orderItemRows } = await supabaseClient
        .from("order_items")
        .select("unit_id, product_id, bundle_id, qty, item_name, pricing_context, component_snapshot")
        .eq("order_id", orderId);

      // Event Essentials lines have no unit: they are checked against product stock below. Only inflatable lines go through the unit loop.
      const inflatableRows = (orderItemRows ?? []).filter((r: { unit_id: string | null }) => !!r.unit_id);
      const eventEssentialsRows = (orderItemRows ?? []).filter((r: { unit_id: string | null; product_id: string | null; bundle_id: string | null }) => !r.unit_id && (r.product_id || r.bundle_id));

      if (eventEssentialsRows.length > 0) {
        const port = supabaseAvailabilityPort(supabaseClient);
        const eeCheck = await checkEventEssentialsAvailabilityWith(
          (items, start, end, exclude) => port.productAvailability(items, start, end, exclude),
          {
            items: eventEssentialsRows,
            eventDate: String(order.event_date ?? "").substring(0, 10),
            eventEndDate: String(order.event_end_date ?? order.event_date ?? "").substring(0, 10),
            excludeOrderId: orderId,
          },
        );
        if (!eeCheck.ok) {
          // "unavailable" is a real conflict; anything else could not be verified and must not let a charge through.
          return eeCheck.kind === "unavailable"
            ? reply(409, { success: false, code: "ITEMS_UNAVAILABLE", error: "One or more Event Essentials items in this order are no longer available for the event date. Please contact support to reschedule." })
            : reply(503, { success: false, code: "AVAILABILITY_UNVERIFIABLE", error: "Unable to verify item availability. Please try again or contact support." });
        }
      }

      if (inflatableRows.length > 0) {
        const BLOCKED_STATUSES = [
          "pending_review",
          "awaiting_customer_approval",
          "approved",
          "confirmed",
          "in_progress",
          "completed",
        ];

        // A conflicting order line as the select below returns it (order_items.order_id -> orders is many-to-one, inner join).
        interface ConflictRow {
          orders: { event_date: string; event_end_date: string | null } | null;
        }
        for (const item of inflatableRows as { unit_id: string }[]) {
          const { data: conflicts } = await supabaseClient
            .from("order_items")
            .select("order_id, orders!inner(id, event_date, event_end_date, status)")
            .eq("unit_id", item.unit_id)
            .neq("order_id", orderId)
            .in("orders.status", BLOCKED_STATUSES);

          const eventStart = new Date(order.event_date ?? "");
          const eventEnd = new Date(order.event_end_date ?? order.event_date ?? "");

          const hasConflict = ((conflicts ?? []) as unknown as ConflictRow[]).some((c) => {
            const o = c.orders;
            if (!o) return false;
            const oStart = new Date(o.event_date);
            const oEnd = new Date(o.event_end_date ?? o.event_date);
            return (
              (eventStart >= oStart && eventStart <= oEnd) ||
              (eventEnd >= oStart && eventEnd <= oEnd) ||
              (eventStart <= oStart && eventEnd >= oEnd)
            );
          });

          if (hasConflict) {
            return reply(409, {
              success: false,
              error:
                "One or more items in this order are no longer available for the event date. Please contact support to reschedule.",
            });
          }
        }
      }
    } catch (availabilityErr) {
      console.error("[charge-deposit] Availability check error:", availabilityErr);
      return reply(503, {
        success: false,
        error: "Unable to verify item availability. Please try again or contact support.",
      });
    }

    // ── The payment operation ────────────────────────────────────────────────
    // The database derives the permitted principal and tip from the order row under its lock; the request only carries a
    // selection. The operation exists (and owns the order's single open payment) BEFORE Stripe is called.
    const claimId = crypto.randomUUID();
    let claim = await claimPaymentOperation(supabaseClient, {
      orderId,
      purpose: isBalanceCharge ? "balance" : "deposit",
      actor: staffCaller ? "staff" : "customer",
      claimId,
      // A customer's persisted Deposit / Full / Custom selection decides the principal; an admin approval always charges the
      // required deposit.
      useSelection: !staffCaller,
      requestedPrincipalCents: isBalanceCharge ? (requestPaymentAmountCents as number) : null,
      requestedTipCents: isCents(requestTipCents) && (!staffCaller || isBalanceCharge) ? requestTipCents : null,
      expectedDepositDueCents: !staffCaller && isCents(requestExpectedDepositDueCents) ? requestExpectedDepositDueCents : null,
    }, stripe);

    // An open checkout operation (a customer who started paying on Stripe's page) is settled before anything new starts.
    if (claim.ok && claim.op.checkoutSessionId) {
      const resolution = await resolveCheckoutOperation(supabaseClient, stripe, claim.op, null);
      if (resolution.kind === "paid") {
        return reply(200, { success: true, alreadyCharged: true });
      }
      if (resolution.kind !== "superseded") {
        const refusal = CLAIM_REFUSALS.busy;
        return reply(refusal.status, { success: false, code: refusal.code, error: refusal.error });
      }
      claim = await claimPaymentOperation(supabaseClient, {
        orderId,
        purpose: isBalanceCharge ? "balance" : "deposit",
        actor: staffCaller ? "staff" : "customer",
        claimId: crypto.randomUUID(),
        useSelection: !staffCaller,
        requestedPrincipalCents: isBalanceCharge ? (requestPaymentAmountCents as number) : null,
        requestedTipCents: isCents(requestTipCents) && (!staffCaller || isBalanceCharge) ? requestTipCents : null,
        expectedDepositDueCents: !staffCaller && isCents(requestExpectedDepositDueCents) ? requestExpectedDepositDueCents : null,
      }, stripe);
    }

    if (!claim.ok) {
      if (claim.outcome === "already_paid") {
        if (claim.detail.status_changed === true) {
          try {
            const { data: lcData, error: lcError } = await supabaseClient.functions.invoke("order-lifecycle", {
              body: {
                action: "enter_confirmed",
                orderId,
                source: "charge_deposit_already_paid",
                paymentOutcome: "already_paid",
                oldStatusHint: order.status,
              },
            });
            if (lcError) {
              console.error("[charge-deposit] order-lifecycle transport error (already_paid):", lcError);
            } else if (lcData && !lcData.success && !lcData.alreadySent) {
              console.error("[charge-deposit] order-lifecycle returned success=false (already_paid):", lcData.error);
            }
          } catch (lifecycleErr) {
            console.error("[charge-deposit] order-lifecycle invoke threw (non-fatal):", lifecycleErr);
          }
        }
        return reply(200, { success: true, alreadyCharged: true });
      }
      // A stale admin screen asking for a balance that was already paid is not an error.
      if (claim.outcome === "over_balance" && staffCaller && claim.detail.balance_due_cents === 0) {
        return reply(200, { success: true, alreadyCharged: true });
      }
      const refusal = CLAIM_REFUSALS[claim.outcome] ?? CLAIM_REFUSALS.error;
      if (claim.outcome === "error") console.error("[charge-deposit] claim failed:", claim.detail?.message);
      return reply(refusal.status, { success: false, code: refusal.code, error: refusal.error, ...(claim.outcome === "catch_up_unavailable" ? { requiresReview: true, reason: claim.detail?.reason ?? null } : {}) });
    }

    const op = claim.op;
    ownedOp = op;
    const isBalance = op.paymentType === "balance";

    // A fresh operation validates the card before Stripe is asked to charge it; a resumed operation already has its
    // provider charge and must not be blocked by what the card looks like today.
    if (!op.providerPaymentIntentId) {
      const validation = await validatePaymentMethod(resolvedPaymentMethodId, stripe);

      if (!validation.valid) {
        await releaseOperation(supabaseClient, op, "failed");
        ownedOp = null;
        return reply(400, {
          success: false,
          code: "PAYMENT_METHOD_INVALID",
          error: validation.reason,
          needsNewCard: validation.needsNewCard,
        });
      }

      if (validation.expMonth && validation.expYear && validation.last4) {
        await supabaseClient
          .from("orders")
          .update({
            payment_method_validated_at: new Date().toISOString(),
            payment_method_exp_month: validation.expMonth,
            payment_method_exp_year: validation.expYear,
            payment_method_last_four: validation.last4,
          })
          .eq("id", orderId);
      }
    }

    const result = await chargeSavedCard({
      db: supabaseClient,
      stripe,
      op,
      orderId,
      stripeCustomerId: order.stripe_customer_id,
      paymentMethodId: resolvedPaymentMethodId,
    });
    ownedOp = null;

    if (result.kind === "declined") {
      return reply(400, {
        success: false,
        code: "CARD_DECLINED",
        error: `Payment could not be completed: ${result.message}`,
        paymentIntentId: result.paymentIntentId,
      });
    }
    if (result.kind === "invalid") {
      return reply(400, { success: false, code: "PAYMENT_REQUEST_INVALID", error: result.message });
    }
    if (result.kind === "unconfirmed") {
      return reply(202, {
        success: false,
        code: result.code,
        retrySafe: true,
        error: "We could not confirm whether this payment went through yet. It is safe to try again: the same payment will be resumed, never charged twice.",
        paymentIntentId: result.paymentIntentId,
      });
    }
    if (result.kind === "finalize_failed") {
      console.error("[charge-deposit] charge succeeded but could not be applied; the webhook or a retry will apply it", { paymentIntentId: result.paymentIntentId });
      return reply(200, {
        success: false,
        chargeSucceeded: true,
        code: "FINALIZATION_PENDING",
        error: "Payment was processed but the order update is pending. Please contact support if it does not update shortly.",
        paymentIntentId: result.paymentIntentId,
      });
    }

    // ---- The charge succeeded and the payment is applied to the order ----
    const paymentIntent = result.paymentIntent;
    const details = result.details;

    // The payment is applied. What follows (order confirmation and the admin alert, the transaction receipts, the invoice row, the
    // customer email and text) is done by the server-owned completion, exactly once per payment: here, or by the webhook when this
    // request is cut off before it gets this far. Nothing after the charge depends on the Admin's browser.
    if (!isBalance) {
      const completion = await completePostPayment(supabaseClient, op.paymentId, { chargeId: details.chargeId ?? (typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : null) });
      if (completion.status === "incomplete" || completion.status === "error") {
        console.error("[charge-deposit] post-payment completion is pending; the webhook will finish it", { paymentId: op.paymentId, errors: completion.errors });
      }
    }

    return reply(200, {
      success: true,
      operationId: op.paymentId,
      paymentDetails: {
        paymentIntentId: paymentIntent.id,
        chargeId: details.chargeId ?? paymentIntent.latest_charge ?? null,
        amountCents: op.grossCents,
        principalCents: op.principalCents,
        depositPrincipalCents: op.depositPrincipalCents,
        balancePrincipalCents: op.balancePrincipalCents,
        tipCents: op.tipCents,
        paymentMethod: details.paymentMethod,
        paymentBrand: details.paymentBrand,
        paymentLast4: details.paymentLast4,
      },
    });
  } catch (error: unknown) {
    console.error("charge-deposit error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    // Give the lease back but keep the operation open: a retry resumes it with the same Stripe idempotency key.
    if (ownedOp && supabaseForRelease) {
      await releaseOperation(supabaseForRelease, ownedOp, null);
    }

    return reply(500, { success: false, error: message });
  }
});

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

// Customer-facing booking confirmation and receipt for a collected deposit. Notification only: nothing here changes money.
