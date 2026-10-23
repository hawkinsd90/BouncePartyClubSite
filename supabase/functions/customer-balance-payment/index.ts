/**
 * CUSTOMER BALANCE PAYMENT - Supabase Edge Function
 *
 * Charges (part of) the remaining balance and an optional tip for a confirmed order.
 *
 * The browser sends a SELECTION: how much of the balance to pay now and an optional tip. The amounts that are actually
 * charged come from the payment operation the database creates (claim_payment_operation): principal is bounded by the order's
 * current balance_due_cents under the order's row lock, the tip is validated separately and never increases the principal, and
 * the operation exists before Stripe is called. Every Stripe request for an operation uses that operation's stable
 * idempotency key, so a double click, a retry or a crash can never create a second charge. The financial application
 * (finalize_payment_operation) is shared with the webhook and the reconciler and happens exactly once.
 *
 * Path A – Card on file:
 *   Charges the saved card for the operation. On success the payment is applied once and a receipt is sent.
 *
 * Path B – No card / card declined:
 *   Creates a Stripe Checkout session for a NEW operation. The webhook (or reconcile-balance-payment) applies it
 *   when the customer pays; either one finds the operation through the session and finalizes it.
 */

import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { validatePaymentMethod } from "../_shared/payments/payment-validation.ts";
import { formatOrderId } from "../_shared/format-order-id.ts";
import { orderItemName, ORDER_ITEM_COLUMNS, type LabelledOrderItem } from "../_shared/payments/order-item-label.ts";
import { configuredOrigins, getSiteOrigin } from "../_shared/siteOrigin.ts";
import { resolveReturnOrigin } from "../_shared/booking/returnOrigin.ts";
import { logTransaction } from "../_shared/transaction-logger.ts";
import { formatCurrency, formatPaymentMethodLabel } from "../_shared/fmt.ts";
import { resolveCaller, proveOrderAccess, authFailureResponse } from "../_shared/auth.ts";
import { buildPortalUrl, portalTokenFragment } from "../_shared/portal-link.ts";
import { receiptOrderFigures, receiptDiscountAmount, receiptExtraFeeRowsHtml, type ReceiptOrder } from "../_shared/payments/receipt-order-totals.ts";
import {
  claimPaymentOperation,
  chargeSavedCard,
  resolveCheckoutOperation,
  adoptProviderPaymentIntent,
  recordProvider,
  releaseOperation,
  operationIdempotencyKey,
  isCents,
  CHECKOUT_SESSION_SECONDS,
  type PaymentOperation,
} from "../_shared/payments/payment-operations.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BalancePaymentRequest {
  orderId: string;
  // How much of the balance to pay now (a selection: the server bounds it by the balance it reads itself).
  amountCents: number;
  tipCents?: number;
  // Order-bound customer proof (an unexpired invoice/portal link token for this order).
  invoiceToken?: string;
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// How each refusal from the payment operation claim is reported. Nothing here has touched Stripe.
const CLAIM_REFUSALS: Record<string, { status: number; code: string; error: string }> = {
  busy: { status: 409, code: "PAYMENT_IN_PROGRESS", error: "A payment for this order is already in progress. Please wait a moment and refresh." },
  invalid_status: { status: 409, code: "ORDER_STATUS_NOT_PAYABLE", error: "This order cannot take a balance payment right now." },
  over_balance: { status: 400, code: "OVER_BALANCE", error: "Payment amount exceeds the balance due on this order." },
  invalid_amount: { status: 400, code: "INVALID_AMOUNT", error: "Invalid request: orderId required and total must be > 0." },
  not_found: { status: 404, code: "ORDER_NOT_FOUND", error: "Order not found." },
  invalid_request: { status: 400, code: "INVALID_REQUEST", error: "Invalid request." },
  order_changed: { status: 409, code: "ORDER_CHANGED", error: "This order changed. Please refresh and try again." },
  payment_status_unknown: { status: 202, code: "PAYMENT_STATUS_UNKNOWN", error: "We could not confirm whether an earlier attempt at this payment went through yet. Please wait a moment and try again; it will not be charged twice." },
  error: { status: 500, code: "PAYMENT_UNAVAILABLE", error: "The payment could not be started. No charge was made. Please try again." },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  let ownedOp: PaymentOperation | null = null;
  let supabaseForRelease: Any = null;

  try {
    const body: BalancePaymentRequest = await req.json();
    const { orderId, amountCents, tipCents: rawTipCents = 0, invoiceToken } = body;

    // Whole, non-negative cents only. Nothing is rounded or clamped into shape: a malformed amount is refused before any
    // lookup, and so before Stripe.
    if (!orderId || typeof orderId !== "string" || !isCents(amountCents) || !isCents(rawTipCents)) {
      return reply(400, { error: "Invalid request: orderId required and total must be > 0.", code: "INVALID_AMOUNT" });
    }
    const balanceCents: number = amountCents;
    const tipCents: number = rawTipCents;
    if (balanceCents + tipCents <= 0) {
      return reply(400, { error: "Invalid request: orderId required and total must be > 0.", code: "INVALID_AMOUNT" });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    supabaseForRelease = supabaseClient;

    // ── Authorization ────────────────────────────────────────────────────────
    // This charges the order's saved card, so an order UUID alone is not enough. The caller must prove control of
    // THIS order: an unexpired invoice/portal link token bound to it, or a signed-in customer who owns it.
    const caller = await resolveCaller(
      supabaseClient,
      req.headers.get("Authorization"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );
    const proof = await proveOrderAccess(supabaseClient, {
      orderId,
      caller,
      token: invoiceToken,
      accept: ["token", "owner"],
    });
    if (!proof) {
      console.warn(`[customer-balance-payment] rejected: caller=${caller.kind}${caller.kind === "user" ? ` user=${caller.userId}` : ""} reason=no_order_proof`);
      return authFailureResponse(
        { ok: false, status: caller.kind === "anonymous" ? 401 : 403, error: "Not authorized to pay this order." },
        corsHeaders,
        "error-only"
      );
    }

    // Load Stripe secret key from admin_settings
    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      return reply(500, { error: "Stripe not configured." });
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia" as unknown as Stripe.LatestApiVersion,
    });

    // Load the order with contact details for the receipt. The amounts charged do NOT come from this read.
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select(`
        id, subtotal_cents, balance_due_cents, balance_paid_cents, deposit_paid_cents,
        tip_cents, stripe_customer_id, stripe_payment_method_id,
        payment_method_brand, payment_method_last_four, customer_id, event_date,
        travel_fee_cents, surface_fee_cents, same_day_pickup_fee_cents, same_day_weekday_delivery_fee_cents, generator_fee_cents, setup_fee_cents, tax_cents,
        travel_fee_waived, surface_fee_waived, same_day_pickup_fee_waived, generator_fee_waived, tax_waived,
        addresses(line1, city, state, zip),
        customers(email, first_name, last_name),
        order_items(${ORDER_ITEM_COLUMNS})
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      console.error("[customer-balance-payment] Order query failed:", JSON.stringify(orderError), "orderId:", orderId);
      return reply(404, { error: "Order not found.", detail: orderError?.message });
    }

    // Origin for the Stripe Checkout return URLs. The request's Origin/Referer is only a CLAIM: it wins only when it is on the allow-list
    // (the production site, SITE_URL, RETURN_ORIGINS, local development); anything else falls back to the configured site.
    const headerOrigin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    let refererOrigin: string | null = null;
    if (referer) {
      try { refererOrigin = new URL(referer).origin; } catch { /* ignore */ }
    }
    const siteOrigin = resolveReturnOrigin([headerOrigin, refererOrigin], configuredOrigins());

    const claimParams = () => ({
      orderId,
      purpose: "balance" as const,
      actor: "customer" as const,
      claimId: crypto.randomUUID(),
      requestedPrincipalCents: balanceCents,
      requestedTipCents: tipCents,
    });

    // ── The payment operation ────────────────────────────────────────────────
    let claim = await claimPaymentOperation(supabaseClient, claimParams(), stripe);

    // A Checkout Session that is still open for this order is settled before anything new starts: the customer may have
    // paid it, or it may be reused as is, or it is closed so a second session can never be paid on top of it.
    if (claim.ok && claim.op.checkoutSessionId) {
      const resolution = await resolveCheckoutOperation(supabaseClient, stripe, claim.op, { principalCents: balanceCents, tipCents });
      if (resolution.kind === "paid") {
        return reply(200, { success: true, alreadyPaid: true });
      }
      if (resolution.kind === "reusable") {
        return reply(200, { url: resolution.url });
      }
      if (resolution.kind === "busy") {
        const refusal = CLAIM_REFUSALS.busy;
        return reply(refusal.status, { error: refusal.error, code: refusal.code });
      }
      claim = await claimPaymentOperation(supabaseClient, claimParams(), stripe);
    }

    if (!claim.ok) {
      const refusal = CLAIM_REFUSALS[claim.outcome] ?? CLAIM_REFUSALS.error;
      if (claim.outcome === "error") console.error("[customer-balance-payment] claim failed:", claim.detail?.message);
      return reply(refusal.status, { error: refusal.error, code: refusal.code });
    }

    let op = claim.op;
    ownedOp = op;

    const paymentMethodId = order.stripe_payment_method_id;
    const stripeCustomerId = order.stripe_customer_id;

    // An earlier request for this very operation may have charged the card without learning the result. Find out before anything
    // else is offered, so the customer can never be asked to pay twice for one balance.
    const cardAttemptPossible = op.resumed && !op.checkoutSessionId;
    if (cardAttemptPossible && op.providerAttemptedAt && !op.providerPaymentIntentId) {
      await adoptProviderPaymentIntent(supabaseClient, stripe, op);
    }

    // ─── PATH A: Card on file ────────────────────────────────────────────────
    if (((paymentMethodId && stripeCustomerId) || op.providerPaymentIntentId) && !op.checkoutSessionId) {
      const validation = op.providerPaymentIntentId ? { valid: true } : await validatePaymentMethod(paymentMethodId as string, stripe);

      if (validation.valid) {
        const result = await chargeSavedCard({
          db: supabaseClient,
          stripe,
          op,
          orderId,
          stripeCustomerId: stripeCustomerId ?? '',
          paymentMethodId: paymentMethodId ?? '',
          description: `Balance payment for Order #${formatOrderId(orderId)}`,
        });
        ownedOp = null;

        if (result.kind === "unconfirmed") {
          return reply(202, {
            success: false,
            code: result.code,
            retrySafe: true,
            error: "We could not confirm whether this payment went through yet. It is safe to try again: the same payment will be resumed, never charged twice.",
          });
        }
        if (result.kind === "finalize_failed") {
          console.error("[customer-balance-payment] charge succeeded but could not be applied; the webhook or a retry will apply it");
          return reply(200, {
            success: false,
            chargeSucceeded: true,
            code: "FINALIZATION_PENDING",
            error: "Your payment was processed. Your balance may take a moment to update.",
          });
        }

        if (result.kind === "succeeded") {
          const { details, finalize: fin } = result;

          // Save card brand/last4 to orders (non-financial)
          const brand = details.paymentBrand || order.payment_method_brand || null;
          const last4 = details.paymentLast4 || order.payment_method_last_four || null;
          if (details.paymentBrand || details.paymentLast4) {
            await supabaseClient
              .from("orders")
              .update({
                ...(details.paymentBrand ? { payment_method_brand: details.paymentBrand } : {}),
                ...(details.paymentLast4 ? { payment_method_last_four: details.paymentLast4 } : {}),
              })
              .eq("id", orderId);
          }

          // The receipt and the email are sent by whoever applied the payment (this request or the webhook), never both.
          if (fin.applied) {
            if (order.customer_id) {
              await logTransaction(supabaseClient, {
                transactionType: "balance",
                orderId,
                customerId: order.customer_id,
                paymentId: op.paymentId,
                amountCents: op.grossCents,
                paymentMethod: details.paymentMethod,
                paymentMethodBrand: details.paymentBrand,
                stripeChargeId: details.chargeId,
                stripePaymentIntentId: result.paymentIntent.id,
                notes: op.tipCents > 0
                  ? `Balance payment ($${(op.principalCents / 100).toFixed(2)}) + tip ($${(op.tipCents / 100).toFixed(2)})`
                  : "Customer portal balance payment",
              });
            }
            await sendBalanceReceipt(supabaseClient, order, orderId, op, brand, last4);
          }

          return reply(200, { success: true });
        }

        // The card was declined or needs authentication: fall through to Checkout with a NEW operation.
        console.warn("[customer-balance-payment] Off-session charge not completed, falling back to Checkout");
        const next = await claimPaymentOperation(supabaseClient, claimParams(), stripe);
        if (!next.ok) {
          const refusal = CLAIM_REFUSALS[next.outcome] ?? CLAIM_REFUSALS.error;
          return reply(refusal.status, { error: refusal.error, code: refusal.code });
        }
        op = next.op;
        ownedOp = op;
      } else {
        console.warn("[customer-balance-payment] Card on file invalid:", (validation as Any).reason, "— falling back to Checkout");
      }
    }

    // ─── PATH B: No valid card — Stripe Checkout ─────────────────────────────
    if (cardAttemptPossible) {
      // The card path was tried for this operation and cannot be repeated now (no usable card). If a provider request was ever
      // started for it, only the provider can say what happened (never a timer): the operation stays open and nothing new is offered.
      // One that never started a request cannot have charged anything and is closed, and Checkout then gets a new operation.
      if (op.providerPaymentIntentId || op.providerAttemptedAt) {
        await releaseOperation(supabaseClient, op, null);
        ownedOp = null;
        const refusal = CLAIM_REFUSALS.payment_status_unknown;
        return reply(refusal.status, { error: refusal.error, code: refusal.code });
      }
      await releaseOperation(supabaseClient, op, 'cancelled');
      ownedOp = null;
      const next = await claimPaymentOperation(supabaseClient, claimParams(), stripe);
      if (!next.ok) {
        const refusal = CLAIM_REFUSALS[next.outcome] ?? CLAIM_REFUSALS.error;
        return reply(refusal.status, { error: refusal.error, code: refusal.code });
      }
      op = next.op;
      ownedOp = op;
    }
    let customerId = stripeCustomerId;
    if (!customerId) {
      const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
      const newCustomer = await stripe.customers.create({
        email: customer?.email,
        name: customer?.first_name ? `${customer.first_name} ${customer.last_name || ""}`.trim() : undefined,
        metadata: { order_id: orderId },
      }, { idempotencyKey: operationIdempotencyKey(op, "customer") });
      customerId = newCustomer.id;
      await supabaseClient
        .from("orders")
        .update({ stripe_customer_id: customerId })
        .eq("id", orderId);
    }

    const url = await createCheckoutSession(
      stripe, supabaseClient, op, customerId!, orderId, siteOrigin, portalTokenFragment(invoiceToken)
    );
    ownedOp = null;
    return reply(200, { url });
  } catch (error: unknown) {
    console.error("[customer-balance-payment] Fatal error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    // Give the lease back but keep the operation open: a retry resumes it with the same Stripe idempotency key.
    if (ownedOp && supabaseForRelease) {
      await releaseOperation(supabaseForRelease, ownedOp, null);
    }
    return reply(500, { error: message });
  }
});

// Customer receipt for a card-on-file balance payment. Notification only: nothing here changes money.
async function sendBalanceReceipt(
  supabaseClient: Any,
  order: Any,
  orderId: string,
  op: PaymentOperation,
  paymentBrand: string | null,
  paymentLast4: string | null,
): Promise<void> {
  try {
    const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
    if (customer?.email) {
      const { data: bizSettings } = await supabaseClient
        .from("admin_settings")
        .select("key, value")
        .in("key", ["business_name", "business_phone", "logo_url"]);
      const biz: Record<string, string> = {};
      bizSettings?.forEach((s: { key: string; value: string | null }) => {
        if (s.value) biz[s.key] = s.value;
      });

      const { data: emailCustomFees } = await supabaseClient
        .from("order_custom_fees")
        .select("name, amount_cents")
        .eq("order_id", orderId);

      const { data: emailDiscounts } = await supabaseClient
        .from("order_discounts")
        .select("name, amount_cents, percentage")
        .eq("order_id", orderId);

      const emailPayload = {
        to: customer.email,
        subject: `Payment Received - Order #${formatOrderId(orderId)}`,
        html: buildReceiptEmail({
          portalUrl: (await buildPortalUrl(supabaseClient, orderId, getSiteOrigin())) ?? getSiteOrigin(),
          contactName: customer.first_name ? `${customer.first_name} ${customer.last_name || ""}`.trim() : "Customer",
          orderId,
          balanceCents: op.principalCents,
          tipCents: op.tipCents,
          totalChargeAmount: op.grossCents,
          cardBrand: paymentBrand,
          cardLast4: paymentLast4,
          eventDate: order.event_date,
          order,
          biz,
          customFees: emailCustomFees || [],
          discounts: emailDiscounts || [],
        }),
      };

      const emailResp = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Apikey": Deno.env.get("SUPABASE_ANON_KEY") ?? "",
          },
          body: JSON.stringify(emailPayload),
        }
      );
      if (!emailResp.ok) {
        const emailErrText = await emailResp.text().catch(() => "");
        console.warn("[customer-balance-payment] send-email returned error (non-fatal):", emailResp.status, emailErrText);
      }
    }
  } catch (emailErr) {
    // Non-fatal — log and continue
    console.warn("[customer-balance-payment] Failed to send receipt email:", emailErr);
  }
}

// Creates the Stripe Checkout Session for an operation the caller owns. The amounts are the operation's, the idempotency key
// is the operation's, and the session is recorded on the operation so the webhook and the reconciler can find it.
async function createCheckoutSession(
  stripe: Stripe,
  supabaseClient: Any,
  op: PaymentOperation,
  customerId: string,
  orderId: string,
  siteOrigin: string,
  returnFragment = ""
): Promise<string | null> {
  const balanceCents = op.principalCents;
  const tipCents = op.tipCents;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

  if (balanceCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: "Order Balance Payment",
          description: `Order #${formatOrderId(orderId)}`,
        },
        unit_amount: balanceCents,
      },
      quantity: 1,
    });
  }

  if (tipCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: "Crew Tip",
          description: "Thank you for tipping the crew!",
        },
        unit_amount: tipCents,
      },
      quantity: 1,
    });
  }

  // success_url: go to portal with ?payment=success&session_id=... (Stripe substitutes {CHECKOUT_SESSION_ID})
  // cancel_url: go back to payment tab so tip state is NOT lost via URL param
  const success_url = `${siteOrigin}/customer-portal/${orderId}?payment=success&session_id={CHECKOUT_SESSION_ID}${returnFragment}`;
  const cancel_url = `${siteOrigin}/customer-portal/${orderId}?tab=payment&tip=${tipCents}${returnFragment}`;

  const metadata = {
    order_id: orderId,
    payment_type: "balance",
    tip_cents: String(tipCents),
    principal_cents: String(balanceCents),
    payment_operation_key: op.operationKey,
    payment_id: op.paymentId,
  };

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    payment_method_types: ["card"],
    line_items: lineItems,
    success_url,
    cancel_url,
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_SECONDS,
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata,
    },
    metadata,
  }, { idempotencyKey: operationIdempotencyKey(op, "cs") });

  const recorded = await recordProvider(supabaseClient, op, { checkoutSessionId: session.id });
  if (!recorded) console.error("[customer-balance-payment] could not record the Checkout Session on the operation");
  // The customer now pays on Stripe's page. The operation stays open (nobody holds the lease) until it is paid or closed.
  await releaseOperation(supabaseClient, op, null);

  return session.url;
}

function buildReceiptEmail(opts: {
  portalUrl: string;
  contactName: string;
  orderId: string;
  balanceCents: number;
  tipCents: number;
  totalChargeAmount: number;
  cardBrand: string | null;
  cardLast4: string | null;
  eventDate: string | null;
  order: ReceiptOrder;
  biz: Record<string, string>;
  customFees: Array<{ name: string; amount_cents: number }>;
  discounts: Array<{ name: string; amount_cents: number | null; percentage: number | null }>;
}): string {
  const { contactName, orderId, balanceCents, tipCents, totalChargeAmount, cardBrand, cardLast4, eventDate, order, biz, customFees, discounts, portalUrl } = opts;
  const orderNum = formatOrderId(orderId);
  const fmt = formatCurrency;

  const businessName = biz.business_name || "Bounce Party Club";
  const businessPhone = biz.business_phone || "(313) 889-3860";

  const cardText = formatPaymentMethodLabel(cardBrand || cardLast4 ? "card" : null, cardBrand, cardLast4);

  const eventDateStr = eventDate
    ? new Date(eventDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";

  const addr = Array.isArray(order.addresses) ? order.addresses[0] : order.addresses;
  const addressStr = addr
    ? `${addr.line1}, ${addr.city}, ${addr.state}`
    : "";

  const items: LabelledOrderItem[] = Array.isArray(order.order_items) ? order.order_items : [];
  const itemsHtml = items.map((item) => {
    const unitName = orderItemName(item);
    const qty = item.qty || 1;
    const price = item.unit_price_cents || 0;
    return `<tr><td style="padding:4px 0;color:#374151;font-size:14px;">${qty}x ${unitName}</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(price * qty)}</td></tr>`;
  }).join("");

  const figures = receiptOrderFigures(order, discounts, customFees);
  const { subtotal, travelFee, surfaceFee, sameDayFee, generatorFee, tax, total } = figures;
  const depositPaid = order.deposit_paid_cents || 0;
  const newBalanceDue = Math.max(0, (order.balance_due_cents || 0) - balanceCents);

  const feeRowsHtml = [
    travelFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Travel Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(travelFee)}</td></tr>` : "",
    surfaceFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Surface Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(surfaceFee)}</td></tr>` : "",
    sameDayFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Same-Day Pickup Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(sameDayFee)}</td></tr>` : "",
    generatorFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Generator Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(generatorFee)}</td></tr>` : "",
    receiptExtraFeeRowsHtml(figures, fmt),
    tax > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tax)}</td></tr>` : "",
    ...customFees.map(f => f.amount_cents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">${f.name}</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(f.amount_cents)}</td></tr>` : ""),
    ...discounts.map(d => {
      const amt = receiptDiscountAmount(d, subtotal);
      return amt > 0 ? `<tr><td style="padding:4px 0;color:#059669;font-size:14px;">${d.name} (discount)</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">-${fmt(amt)}</td></tr>` : "";
    }),
  ].join("");

  const paymentDate = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });


  const logoHtml = biz.logo_url
    ? `<img src="${biz.logo_url}" alt="${businessName}" style="height:60px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #d1fae5;">
  <tr>
    <td align="center" style="padding:24px 40px 16px;border-bottom:2px solid #d1fae5;">
      ${logoHtml}
      <h1 style="margin:0;color:#059669;font-size:26px;font-weight:bold;">Payment Received!</h1>
      <p style="margin:6px 0 0;color:#6b7280;font-size:14px;">Order #${orderNum}</p>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 40px 8px;">
      <p style="margin:0 0 6px;color:#374151;font-size:15px;">Hi ${contactName},</p>
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">Your payment has been processed successfully. Here's your receipt.</p>

      ${eventDateStr || addressStr ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Event Details</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:40%;">Order #:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${orderNum}</td></tr>
            ${eventDateStr ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${eventDateStr}</td></tr>` : ""}
            ${addressStr ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${addressStr}</td></tr>` : ""}
          </table>
        </td></tr>
      </table>` : ""}

      ${itemsHtml ? `
      <p style="margin:0 0 10px;font-weight:bold;color:#111827;font-size:15px;">Order Items</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        ${itemsHtml}
      </table>` : ""}

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td colspan="2" style="padding:0 0 8px;font-weight:bold;color:#111827;font-size:15px;">Payment Summary</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Subtotal:</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(subtotal)}</td></tr>
        ${feeRowsHtml}
        <tr style="border-top:2px solid #e5e7eb;"><td style="padding:10px 0 4px;font-weight:bold;color:#111827;">Total:</td><td style="padding:10px 0 4px;text-align:right;font-weight:bold;color:#111827;">${fmt(total)}</td></tr>
        ${tipCents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Crew Tip:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">${fmt(tipCents)}</td></tr>` : ""}
        ${depositPaid > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Deposit Paid:</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(depositPaid)}</td></tr>` : ""}
        <tr><td style="padding:4px 0;color:#059669;font-size:14px;font-weight:600;">Balance Payment:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;font-weight:600;">${fmt(balanceCents)}</td></tr>
        <tr><td style="padding:4px 0;color:#374151;font-weight:600;">Remaining Balance:</td><td style="padding:4px 0;text-align:right;color:#374151;font-weight:600;">${fmt(newBalanceDue)}</td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Payment Receipt</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Method:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${cardText}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Amount Paid:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fmt(totalChargeAmount)}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${paymentDate}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Transaction ID:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${orderNum}</td></tr>
          </table>
        </td></tr>
      </table>

      <div style="text-align:center;margin-bottom:24px;">
        <a href="${portalUrl}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 32px;border-radius:6px;">Track Your Order</a>
      </div>

      <p style="margin:0 0 28px;color:#6b7280;font-size:14px;text-align:center;">Thank you for choosing ${businessName}!</p>
    </td>
  </tr>
  <tr>
    <td style="padding:16px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px;text-align:center;">
      <p style="margin:0;color:#6b7280;font-size:13px;">${businessName} | ${businessPhone}</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
