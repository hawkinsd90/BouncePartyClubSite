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
import { formatCurrency } from "../_shared/fmt.ts";
import { buildPortalUrl } from "../_shared/portal-link.ts";
import { receiptOrderFigures, receiptExtraFeeRowsHtml } from "../_shared/payments/receipt-order-totals.ts";
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
        .select("unit_id")
        .eq("order_id", orderId);

      if (orderItemRows && orderItemRows.length > 0) {
        const BLOCKED_STATUSES = [
          "pending_review",
          "awaiting_customer_approval",
          "approved",
          "confirmed",
          "in_progress",
          "completed",
        ];

        for (const item of orderItemRows as { unit_id: string }[]) {
          const { data: conflicts } = await supabaseClient
            .from("order_items")
            .select("order_id, orders!inner(id, event_date, event_end_date, status)")
            .eq("unit_id", item.unit_id)
            .neq("order_id", orderId)
            .in("orders.status", BLOCKED_STATUSES);

          const eventStart = new Date(order.event_date ?? "");
          const eventEnd = new Date(order.event_end_date ?? order.event_date ?? "");

          const hasConflict = (conflicts ?? []).some((c: any) => {
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
    const fin = result.finalize;
    const details = result.details;

    // Whoever applied the payment (this request or the webhook) is the one that notifies; the other stays quiet.
    if (fin.applied && !isBalance) {
      try {
        const { data: lcData, error: lcError } = await supabaseClient.functions.invoke("order-lifecycle", {
          body: {
            action: "enter_confirmed",
            orderId,
            source: "charge_deposit",
            paymentOutcome: "charged_now",
            oldStatusHint: order.status,
          },
        });
        if (lcError) {
          console.error("[charge-deposit] order-lifecycle transport error (charged_now):", lcError);
        } else if (lcData && !lcData.success && !lcData.alreadySent) {
          console.error("[charge-deposit] order-lifecycle returned success=false (charged_now):", lcData.error);
        }
      } catch (lifecycleErr) {
        console.error("[charge-deposit] order-lifecycle invoke threw (non-fatal):", lifecycleErr);
      }

      await sendDepositConfirmationEmail(supabaseClient, {
        orderId,
        principalCents: op.principalCents,
        grossCents: op.grossCents,
        paymentMethod: details.paymentMethod,
        paymentBrand: details.paymentBrand,
        paymentLast4: details.paymentLast4,
      });
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
async function sendDepositConfirmationEmail(
  supabaseClient: Any,
  p: { orderId: string; principalCents: number; grossCents: number; paymentMethod: string | null; paymentBrand: string | null; paymentLast4: string | null },
): Promise<void> {
  const { orderId, grossCents: chargeAmountCents, paymentMethod, paymentBrand, paymentLast4 } = p;
  const paymentAmountCents = p.principalCents;

  let discountRows: Array<{ amount_cents: number; percentage: number }> = [];
  try {
    const { data: orderDiscounts } = await supabaseClient
      .from("order_discounts")
      .select("amount_cents, percentage")
      .eq("order_id", orderId);
    discountRows = orderDiscounts || [];
  } catch (discountQueryErr) {
    console.error("[charge-deposit] Discounts query failed (non-fatal):", discountQueryErr);
  }

  try {
        const { data: fullOrder } = await supabaseClient
          .from("orders")
          .select(`
            *,
            customers(first_name, last_name, email),
            order_items(qty, wet_or_dry, unit_price_cents, units(name)),
            addresses(line1, city, state, zip),
            order_custom_fees(id, name, amount_cents)
          `)
          .eq("id", orderId)
          .maybeSingle();

        if (fullOrder && fullOrder.customers?.email) {
          const { data: businessSettings } = await supabaseClient
            .from("admin_settings")
            .select("key, value")
            .in("key", ["business_name", "business_phone", "business_email", "logo_url"]);

          const biz: Record<string, string> = {};
          businessSettings?.forEach((s: { key: string; value: string | null }) => {
            if (s.value) biz[s.key] = s.value;
          });

          const fmt = formatCurrency;
          const firstName = fullOrder.customers.first_name || "";
          const addr = fullOrder.addresses;
          const addressStr = addr
            ? `${addr.line1}, ${addr.city}, ${addr.state}`
            : (fullOrder.event_address_line1 || "");

          const eventDate = fullOrder.event_date
            ? new Date(fullOrder.event_date + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })
            : "";

          const timeWindow = `${fullOrder.start_window || ""} - ${fullOrder.end_window || ""}`;
          const shortId = orderId.replace(/-/g, "").toUpperCase().slice(0, 8);
          const portalUrl = (await buildPortalUrl(supabaseClient, orderId, "https://bouncepartyclub.com")) ?? "https://bouncepartyclub.com";

          const itemsHtml = (fullOrder.order_items || [])
            .map(
              (item: {
                qty: number;
                units: { name: string };
                wet_or_dry: string;
                unit_price_cents: number;
              }) => `
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#374151;">
              ${item.qty}x ${item.units?.name || ""} (${item.wet_or_dry === "water" ? "Wet" : "Dry"})
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">
              ${fmt(item.unit_price_cents * item.qty)}
            </td>
          </tr>`
            )
            .join("");

          const emailCustomFees: Array<{ id: string; name: string; amount_cents: number }> = fullOrder.order_custom_fees || [];
          const figures = receiptOrderFigures(fullOrder, discountRows, emailCustomFees);
          const { subtotal, travelFee, surfaceFee, sameDayFee, generatorFee, tax, total } = figures;
          const discount = figures.discountsTotal;
          const tip = fullOrder.tip_cents || 0;


          const depositPaid = paymentAmountCents;
          const balanceRemaining = Math.max(0, typeof fullOrder.balance_due_cents === "number" ? fullOrder.balance_due_cents : total - depositPaid);

          const customFeeRowsHtml = emailCustomFees
            .map((f: { name: string; amount_cents: number }) =>
              f.amount_cents > 0
                ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">${
                    f.name || "Custom Fee"
                  }</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(
                    f.amount_cents
                  )}</td></tr>`
                : ""
            )
            .join("");

          const feeRowsHtml = [
            travelFee > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Travel Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(travelFee)}</td></tr>`
              : "",
            surfaceFee > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Surface Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(surfaceFee)}</td></tr>`
              : "",
            sameDayFee > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Same Day Pickup</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(sameDayFee)}</td></tr>`
              : "",
            generatorFee > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Generator Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(generatorFee)}</td></tr>`
              : "",
            receiptExtraFeeRowsHtml(figures, fmt),
            customFeeRowsHtml,
            discount > 0
              ? `<tr><td style="padding:4px 0;color:#059669;font-size:14px;">Discount</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">-${fmt(discount)}</td></tr>`
              : "",
            tax > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tax)}</td></tr>`
              : "",
            tip > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tip</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tip)}</td></tr>`
              : "",
          ].join("");

          const paymentMethodStr =
            paymentBrand && paymentLast4
              ? `${paymentBrand} •••• ${paymentLast4}`
              : paymentMethod || "Card";

          const paymentDate = new Date().toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });

          const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #d1fae5;">
  <tr>
    <td align="center" style="padding:24px 40px 16px;border-bottom:2px solid #d1fae5;">
      ${
        biz.logo_url
          ? `<img src="${biz.logo_url}" alt="${biz.business_name || "Bounce Party Club"}" style="height:60px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
          : ""
      }
      <h1 style="margin:0;color:#059669;font-size:26px;font-weight:bold;">Booking Confirmed!</h1>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 40px 8px;">
      <p style="margin:0 0 6px;color:#374151;font-size:15px;">Hi ${firstName},</p>
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">Great news! Your booking is confirmed and your deposit has been processed.</p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Event Details</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:40%;">Order #:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${shortId}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${eventDate}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Time:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${timeWindow}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${addressStr}</td></tr>
            ${
              fullOrder.location_type
                ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location Type:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${fullOrder.location_type}</td></tr>`
                : ""
            }
            ${
              fullOrder.surface
                ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Surface:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${fullOrder.surface}</td></tr>`
                : ""
            }
            ${
              fullOrder.special_details
                ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Special Details:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fullOrder.special_details}</td></tr>`
                : ""
            }
          </table>
        </td></tr>
      </table>

      <p style="margin:0 0 10px;font-weight:bold;color:#111827;font-size:15px;">Order Items</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        ${itemsHtml}
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td colspan="2" style="padding:0 0 8px;font-weight:bold;color:#111827;font-size:15px;">Payment Summary</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Subtotal:</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(subtotal)}</td></tr>
        ${feeRowsHtml}
        <tr style="border-top:2px solid #e5e7eb;"><td style="padding:10px 0 4px;font-weight:bold;color:#111827;">Total:</td><td style="padding:10px 0 4px;text-align:right;font-weight:bold;color:#111827;">${fmt(total)}</td></tr>
        ${
          tip > 0
            ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tip:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">${fmt(tip)}</td></tr>`
            : ""
        }
        <tr><td style="padding:4px 0;color:#059669;font-size:14px;font-weight:600;">Deposit Paid:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;font-weight:600;">${fmt(depositPaid)}</td></tr>
        <tr><td style="padding:4px 0;color:#374151;font-weight:600;">Balance Due:</td><td style="padding:4px 0;text-align:right;color:#374151;font-weight:600;">${fmt(balanceRemaining)}</td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Payment Receipt</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Method:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${paymentMethodStr}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Amount Paid:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fmt(chargeAmountCents)}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${paymentDate}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Transaction ID:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${shortId}</td></tr>
          </table>
        </td></tr>
      </table>

      <div style="text-align:center;margin-bottom:24px;">
        <a href="${portalUrl}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 32px;border-radius:6px;">Track Your Order</a>
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 8px;font-weight:bold;color:#1e40af;font-size:14px;">What's Next?</p>
          <ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;line-height:1.7;">
            <li>We will contact you closer to your event date to confirm details</li>
            <li>The remaining balance is due on or before your event date</li>
            <li>Reply to this email or call us at ${biz.business_phone || "(313) 889-3860"} with questions</li>
          </ul>
        </td></tr>
      </table>

      <p style="margin:0 0 28px;color:#6b7280;font-size:14px;text-align:center;">Thank you for choosing ${biz.business_name || "Bounce Party Club"}!</p>
    </td>
  </tr>
  <tr>
    <td style="padding:16px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px;text-align:center;">
      <p style="margin:0;color:#6b7280;font-size:13px;">${biz.business_name || "Bounce Party Club"} | ${biz.business_phone || "(313) 889-3860"}</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;

          await supabaseClient.functions.invoke("send-email", {
            body: {
              to: fullOrder.customers.email,
              subject: `Booking Confirmed - Receipt for Order #${shortId}`,
              html: emailHtml,
            },
          });
        }
  } catch (emailError) {
    console.error("Failed to send booking confirmation email:", emailError);
  }
}
