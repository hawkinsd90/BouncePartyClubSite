import Stripe from "npm:stripe@20.0.0";
import { logTransaction } from "../_shared/transaction-logger.ts";
import { collectPaymentDetails, finalizeOperation } from "../_shared/payments/payment-operations.ts";
import { applyProviderRefund } from "../_shared/payments/refund-operations.ts";
import { sendCheckoutBalanceReceiptEmail, sendDepositReceiptEmail } from "./emails.ts";

export async function invokeLifecycle(
  supabaseClient: any,
  action: string,
  orderId: string,
  source: string,
  paymentOutcome?: string,
  oldStatusHint?: string
): Promise<void> {
  try {
    const { data, error } = await supabaseClient.functions.invoke("order-lifecycle", {
      body: { action, orderId, source, paymentOutcome, ...(oldStatusHint ? { oldStatusHint } : {}) },
    });
    if (error) {
      console.error(`[WEBHOOK] order-lifecycle transport error: action=${action} orderId=${orderId}`, error);
    } else if (data && !data.alreadySent && data && !data.success) {
      console.error(`[WEBHOOK] order-lifecycle returned success=false: action=${action} orderId=${orderId} error=${data.error}`);
    }
  } catch (err) {
    console.error(`[WEBHOOK] order-lifecycle invoke threw (non-fatal): action=${action} orderId=${orderId}`, err);
  }
}

// A Stripe event can only change an order's money through a payment OPERATION that this application created before the
// provider was called. Money that arrives without one is recorded for a person to reconcile; it is never guessed into a
// deposit, a balance or a tip.
async function reportUnmatchedPayment(
  supabaseClient: any,
  orderId: string | null,
  reference: string,
  note: string
): Promise<void> {
  console.error(`[WEBHOOK] payment needs reconciliation: ${note} (${reference})`);
  if (!orderId) return;
  try {
    await supabaseClient.from("order_changelog").insert({
      order_id: orderId,
      user_id: null,
      change_type: "payment_error",
      field_changed: "payment_operation",
      old_value: null,
      new_value: reference,
      notes: `PAYMENT_NEEDS_RECONCILIATION: ${note}`,
    });
  } catch (err) {
    console.error("[WEBHOOK] could not record the reconciliation note:", err);
  }
}

async function loadOrderForReceipt(supabaseClient: any, orderId: string): Promise<any> {
  const { data } = await supabaseClient
    .from("orders")
    .select(`
      customer_id, event_date,
      subtotal_cents, travel_fee_cents, surface_fee_cents,
      same_day_pickup_fee_cents, generator_fee_cents, tax_cents,
      travel_fee_waived, surface_fee_waived, same_day_pickup_fee_waived,
      generator_fee_waived, tax_waived,
      deposit_paid_cents, balance_due_cents,
      addresses(line1, city, state, zip),
      order_items(qty, unit_price_cents, units(name)),
      customers(email, first_name, last_name)
    `)
    .eq("id", orderId)
    .maybeSingle();
  return data;
}

async function loadBusinessSettings(supabaseClient: any): Promise<Record<string, string>> {
  const { data } = await supabaseClient
    .from("admin_settings")
    .select("key, value")
    .in("key", ["business_name", "business_phone", "logo_url"]);
  const biz: Record<string, string> = {};
  data?.forEach((s: { key: string; value: string | null }) => { if (s.value) biz[s.key] = s.value; });
  return biz;
}

export interface ProviderPayment {
  orderId: string;
  metadata: Record<string, string> | null | undefined;
  paymentIntent: Stripe.PaymentIntent | null;
  paymentIntentId: string | null;
  checkoutSessionId: string | null;
  amountReceivedCents: number;
  stripeCustomerId: string | null;
  source: string;
}

// The one way a Stripe event applies a payment: find the operation the metadata names, then finalize it through the same
// database function the charging request uses. Applying twice is impossible (the function reports already_applied), and
// whichever caller applied first is the one that notifies.
export async function applyProviderPayment(
  supabaseClient: any,
  stripe: Stripe,
  p: ProviderPayment
): Promise<"applied" | "already_applied" | "unmatched" | "refused"> {
  const operationKey = p.metadata?.payment_operation_key || null;
  const paymentId = p.metadata?.payment_id || null;
  const reference = p.paymentIntentId || p.checkoutSessionId || "unknown";

  if (!operationKey || !paymentId) {
    await reportUnmatchedPayment(supabaseClient, p.orderId, reference, `a successful ${p.source} payment of ${p.amountReceivedCents} cents has no payment operation`);
    return "unmatched";
  }

  let pi = p.paymentIntent;
  if (!pi && p.paymentIntentId) {
    try {
      pi = await stripe.paymentIntents.retrieve(p.paymentIntentId, { expand: ["payment_method", "latest_charge"] });
    } catch (err) {
      console.error("[WEBHOOK] Failed to retrieve PI with expansions:", err);
    }
  }
  const details = pi ? await collectPaymentDetails(stripe, pi) : null;

  const fin = await finalizeOperation(supabaseClient, {
    paymentId,
    operationKey,
    paymentIntentId: p.paymentIntentId,
    checkoutSessionId: p.checkoutSessionId,
    amountReceivedCents: p.amountReceivedCents,
    paymentMethod: details?.paymentMethod,
    paymentBrand: details?.paymentBrand,
    paymentLast4: details?.paymentLast4,
    feeCents: details?.feeCents,
    netCents: details?.netCents,
    paymentMethodId: details?.paymentMethodId,
    stripeCustomerId: p.stripeCustomerId,
  });

  if (fin.outcome === "error") {
    // A transient database failure: let Stripe deliver the event again.
    throw new Error(`finalize_payment_operation failed: ${String(fin.detail?.message ?? "unknown")}`);
  }
  if (!fin.ok) {
    await reportUnmatchedPayment(supabaseClient, p.orderId, reference, `a successful ${p.source} payment could not be applied (${fin.outcome})`);
    return "refused";
  }
  if (!fin.applied) return "already_applied";

  // This delivery applied the payment, so it also notifies.
  try {
    if (fin.paymentType === "deposit") {
      if (fin.statusChanged) {
        await invokeLifecycle(supabaseClient, "enter_confirmed", p.orderId, `webhook_${p.source}_deposit`, "charged_now", fin.previousStatus ?? undefined);
      }
      const order = await loadOrderForReceipt(supabaseClient, p.orderId);
      const customer = Array.isArray(order?.customers) ? order.customers[0] : order?.customers;
      if (customer?.email) {
        const biz = await loadBusinessSettings(supabaseClient);
        await sendDepositReceiptEmail(
          supabaseClient, p.orderId, order, customer, biz,
          p.amountReceivedCents, p.amountReceivedCents - fin.tipCents, fin.tipCents, details?.paymentBrand ?? null, details?.paymentLast4 ?? null
        );
      }
    } else {
      const order = await loadOrderForReceipt(supabaseClient, p.orderId);
      if (order?.customer_id) {
        await logTransaction(supabaseClient, {
          transactionType: "balance",
          orderId: p.orderId,
          customerId: order.customer_id,
          paymentId,
          amountCents: p.amountReceivedCents,
          paymentMethod: details?.paymentMethod,
          paymentMethodBrand: details?.paymentBrand,
          stripeChargeId: details?.chargeId,
          stripePaymentIntentId: p.paymentIntentId,
          notes: "Customer portal balance payment",
        });
      }
      const customer = Array.isArray(order?.customers) ? order.customers[0] : order?.customers;
      if (customer?.email) {
        const biz = await loadBusinessSettings(supabaseClient);
        await sendCheckoutBalanceReceiptEmail(
          supabaseClient, p.orderId, order, customer, biz,
          p.amountReceivedCents, p.amountReceivedCents - fin.tipCents, fin.tipCents, details?.paymentBrand ?? null, details?.paymentLast4 ?? null
        );
      }
    }
  } catch (notifyErr) {
    console.warn("[WEBHOOK] Failed to send payment notifications (non-fatal):", notifyErr);
  }
  return "applied";
}

// An Admin Invoice is confirmed by a successful payment. Saving a card is not a payment: while any required principal is
// still unpaid the order stays as it is, and the charge that follows the card save decides. Only an invoice with nothing to
// collect (an explicit $0 deposit, or a deposit already paid) is confirmed by the card save.
async function setupConfirmation(
  supabaseClient: any,
  orderId: string
): Promise<{ isAdminInvoice: boolean; principalOutstanding: boolean; currentStatus: string; depositDue: number }> {
  const { data: invoiceLinks } = await supabaseClient
    .from("invoice_links")
    .select("id")
    .eq("order_id", orderId)
    .eq("link_type", "invoice")
    .limit(1);

  const { data: current } = await supabaseClient
    .from("orders")
    .select("status, deposit_due_cents, deposit_paid_cents")
    .eq("id", orderId)
    .maybeSingle();

  const due = current?.deposit_due_cents || 0;
  const paid = current?.deposit_paid_cents || 0;
  return {
    isAdminInvoice: Array.isArray(invoiceLinks) && invoiceLinks.length > 0,
    principalOutstanding: due > 0 && paid < due,
    currentStatus: current?.status || "",
    depositDue: due,
  };
}

export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  supabaseClient: any,
  stripe: Stripe
): Promise<void> {
  const orderId = session.metadata?.order_id || null;

  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

  const setupIntentId =
    typeof session.setup_intent === "string"
      ? session.setup_intent
      : session.setup_intent?.id || null;

  const paymentMethodId =
    typeof session.payment_method === "string"
      ? session.payment_method
      : null;

  if (!orderId) {
    console.warn("[WEBHOOK] No order_id in session metadata, skipping");
    return;
  }

  if (session.mode === "setup" && setupIntentId) {
    let actualPaymentMethodId = paymentMethodId;
    try {
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      actualPaymentMethodId = typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id || null;
    } catch (err) {
      console.error(`[WEBHOOK] Failed to retrieve SetupIntent ${setupIntentId}:`, err);
    }

    const tipCents = parseInt(session.metadata?.tip_cents || "0", 10);

    let setupCardBrand: string | null = null;
    let setupCardLast4: string | null = null;
    if (actualPaymentMethodId) {
      try {
        const pm = await stripe.paymentMethods.retrieve(actualPaymentMethodId);
        setupCardBrand = pm.card?.brand || null;
        setupCardLast4 = pm.card?.last4 || null;
      } catch (err) {
        console.error(`[WEBHOOK] Failed to retrieve payment method ${actualPaymentMethodId}:`, err);
      }
    }

    const { isAdminInvoice, principalOutstanding, currentStatus, depositDue } = await setupConfirmation(supabaseClient, orderId);
    // A booking request goes to review. An Admin Invoice is confirmed only when no principal is left to collect.
    const newStatus = isAdminInvoice ? (principalOutstanding ? null : "confirmed") : "pending_review";
    const setupSafeToAdvance = newStatus !== null && ["draft", "quote", "pending_review"].includes(currentStatus);

    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({
        ...(setupSafeToAdvance ? { status: newStatus } : {}),
        stripe_payment_method_id: actualPaymentMethodId,
        stripe_customer_id: stripeCustomerId,
        ...(tipCents > 0 ? { tip_cents: tipCents } : {}),
        ...(setupCardBrand ? { payment_method_brand: setupCardBrand } : {}),
        ...(setupCardLast4 ? { payment_method_last_four: setupCardLast4 } : {}),
      })
      .eq("id", orderId);

    if (updateError) {
      console.error(`[WEBHOOK] Error updating order ${orderId}:`, updateError);
    } else if (setupSafeToAdvance) {
      if (isAdminInvoice) {
        await invokeLifecycle(supabaseClient, "enter_confirmed", orderId, "webhook_setup_session_admin_invoice", depositDue > 0 ? "charged_now" : "zero_due_with_card", "draft");
      } else {
        await invokeLifecycle(supabaseClient, "enter_pending_review", orderId, "webhook_setup_session_checkout", undefined, "draft");
      }
    }
    return;
  }

  if (session.mode === "payment") {
    if (session.payment_status !== "paid") {
      // Not paid yet (or an unsupported delayed method): nothing is applied until the provider says the money arrived.
      return;
    }
    await applyProviderPayment(supabaseClient, stripe, {
      orderId,
      metadata: session.metadata as Record<string, string> | null,
      paymentIntent: null,
      paymentIntentId,
      checkoutSessionId: session.id,
      amountReceivedCents: session.amount_total || 0,
      stripeCustomerId,
      source: "checkout",
    });
  }
}

export async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  supabaseClient: any,
  stripe: Stripe
): Promise<void> {
  const orderId = paymentIntent.metadata?.order_id || null;
  const paymentType = paymentIntent.metadata?.payment_type || null;

  const stripeCustomerId =
    typeof paymentIntent.customer === "string"
      ? paymentIntent.customer
      : paymentIntent.customer?.id || null;

  // Operations created by this application name themselves in the metadata.
  if (paymentIntent.metadata?.payment_operation_key) {
    if (!orderId) return;
    await applyProviderPayment(supabaseClient, stripe, {
      orderId,
      metadata: paymentIntent.metadata as Record<string, string>,
      paymentIntent,
      paymentIntentId: paymentIntent.id,
      checkoutSessionId: null,
      amountReceivedCents: paymentIntent.amount_received || 0,
      stripeCustomerId,
      source: "payment_intent",
    });
    return;
  }

  // A PaymentIntent from before payment operations existed: its own request wrote its ledger row. Only that row's
  // provider details are refreshed; no order financials are applied from a raw Stripe amount.
  let paymentMethodType: string | null = null;
  let paymentBrand: string | null = null;
  let paymentLast4: string | null = null;

  if (paymentIntent.payment_method) {
    const pm = await stripe.paymentMethods.retrieve(
      typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : paymentIntent.payment_method.id
    );
    paymentMethodType = pm.type || null;
    if (pm.card) {
      paymentBrand = pm.card.brand || null;
      paymentLast4 = pm.card.last4 || null;
    }
  }

  const { data: legacyRows } = await supabaseClient
    .from("payments")
    .update({
      status: "succeeded",
      paid_at: new Date().toISOString(),
      payment_method: paymentMethodType,
      payment_brand: paymentBrand,
      payment_last4: paymentLast4
    })
    .eq("stripe_payment_intent_id", paymentIntent.id)
    .is("operation_key", null)
    .select("id");

  if ((paymentType === "balance" || paymentType === "deposit") && (!legacyRows || legacyRows.length === 0)) {
    await reportUnmatchedPayment(supabaseClient, orderId, paymentIntent.id, `a successful ${paymentType} payment of ${paymentIntent.amount_received || 0} cents has no payment operation and no ledger row`);
  }
}

export async function handlePaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent,
  supabaseClient: any
): Promise<void> {
  // Only a payment that is still open can fail. A Checkout payment may be retried by the customer on Stripe's page, so a
  // failed attempt there does not close its operation.
  await supabaseClient
    .from("payments")
    .update({
      status: "failed",
      failed_at: new Date().toISOString()
    })
    .eq("stripe_payment_intent_id", paymentIntent.id)
    .eq("status", "pending")
    .is("stripe_checkout_session_id", null);
}

// Refunds. Each INDIVIDUAL Stripe refund is recorded on its own through apply_provider_refund_event (one order_refunds row per
// refund, one status transition, one ledger row). Nothing here reads the cumulative amount of a charge, the embedded
// `charge.refunds` list (absent unless expanded) or an amount sum.
async function recordProviderRefund(refund: Stripe.Refund, supabaseClient: any): Promise<void> {
  const result = await applyProviderRefund(supabaseClient, refund);

  if (result.outcome === "no_original_payment") {
    console.warn(`[WEBHOOK] refund ${refund.id}: no successful payment found for its PaymentIntent; not recorded`);
    return;
  }
  if (result.outcome === "invalid_request") {
    console.warn(`[WEBHOOK] refund ${refund.id}: not a recordable refund event (missing amount or id)`);
    return;
  }

  // A transaction receipt is written once, when the refund is first counted as returned.
  if (result.appliedNow && result.orderId) {
    const { data: order } = await supabaseClient.from("orders").select("customer_id").eq("id", result.orderId).maybeSingle();
    const { data: original } = result.paymentId
      ? await supabaseClient.from("payments").select("payment_method, payment_brand, stripe_payment_intent_id").eq("id", result.paymentId).maybeSingle()
      : { data: null };
    if (order) {
      await logTransaction(supabaseClient, {
        transactionType: "refund",
        orderId: result.orderId,
        customerId: order.customer_id,
        paymentId: result.ledgerPaymentId ?? undefined,
        amountCents: -Math.abs(refund.amount),
        paymentMethod: original?.payment_method ?? null,
        paymentMethodBrand: original?.payment_brand ?? null,
        stripeChargeId: typeof refund.charge === "string" ? refund.charge : refund.charge?.id,
        stripePaymentIntentId: original?.stripe_payment_intent_id ?? (typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id),
        notes: `Refund ${refund.id}${refund.reason ? ` - ${refund.reason}` : ""}`,
      });
    }
  }
}

// refund.created / refund.updated / refund.failed / charge.refund.updated carry the Refund object itself.
export async function handleRefundEvent(refund: Stripe.Refund, supabaseClient: any): Promise<void> {
  await recordProviderRefund(refund, supabaseClient);
}

// charge.refunded carries the Charge. The refunds of the charge are read from Stripe one by one; the Charge's own amount_refunded
// (a running total) and its embedded refund list are never used.
export async function handleChargeRefunded(
  charge: Stripe.Charge,
  supabaseClient: any,
  stripe: Stripe
): Promise<void> {
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  for (const refund of refunds.data) {
    await recordProviderRefund(refund, supabaseClient);
  }
}

export async function handleSetupIntentSucceeded(
  setupIntent: Stripe.SetupIntent,
  supabaseClient: any,
  stripe: Stripe
): Promise<void> {
  const orderId = setupIntent.metadata?.order_id || null;

  if (!orderId) {
    console.warn("[WEBHOOK] No order_id in setup_intent metadata, skipping");
    return;
  }

  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id || null;

  const stripeCustomerId =
    typeof setupIntent.customer === "string"
      ? setupIntent.customer
      : setupIntent.customer?.id || null;

  let siCardBrand: string | null = null;
  let siCardLast4: string | null = null;
  if (paymentMethodId) {
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      siCardBrand = pm.card?.brand || null;
      siCardLast4 = pm.card?.last4 || null;
    } catch (err) {
      console.error(`[WEBHOOK] Failed to retrieve payment method ${paymentMethodId}:`, err);
    }
  }

  const { isAdminInvoice, principalOutstanding, currentStatus, depositDue } = await setupConfirmation(supabaseClient, orderId);
  // A booking request goes to review. An Admin Invoice is confirmed only when no principal is left to collect.
  const newStatus = isAdminInvoice ? (principalOutstanding ? null : "confirmed") : "pending_review";
  const siSafeToAdvance = newStatus !== null && ["draft", "quote", "pending_review"].includes(currentStatus);

  const { error: updateError } = await supabaseClient
    .from("orders")
    .update({
      ...(siSafeToAdvance ? { status: newStatus } : {}),
      stripe_payment_method_id: paymentMethodId,
      stripe_customer_id: stripeCustomerId,
      ...(siCardBrand ? { payment_method_brand: siCardBrand } : {}),
      ...(siCardLast4 ? { payment_method_last_four: siCardLast4 } : {}),
    })
    .eq("id", orderId);

  if (updateError) {
    console.error(`[WEBHOOK] Error updating order ${orderId}:`, updateError);
  } else if (siSafeToAdvance) {
    if (isAdminInvoice) {
      await invokeLifecycle(supabaseClient, "enter_confirmed", orderId, "webhook_setup_intent_admin_invoice", depositDue > 0 ? "charged_now" : "zero_due_with_card", "draft");
    } else {
      await invokeLifecycle(supabaseClient, "enter_pending_review", orderId, "webhook_setup_intent_standard", undefined, "draft");
    }
  }
}
