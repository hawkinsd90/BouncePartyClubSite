// Server-owned completion after a deposit payment was applied to an order (WP-30 / NI-04).
//
// What follows a successful deposit charge used to depend on the Admin's browser staying open: the transaction receipts, the invoice
// row, the customer's text, and (when the request itself was cut off) the confirmation email. Closing the tab after the card was
// charged left a confirmed order with none of them, and nothing would ever finish the job. This module does that work on the server,
// exactly once per payment:
//
//   claim      claim_post_payment_completion takes a lease on the payment row (post_claim_until); a completed payment, a payment that is
//              not an applied deposit and a payment created before the mechanism existed are refused; a live lease means "busy"
//   stage A    records that must exist: the order is confirmed through order-lifecycle (idempotent), the deposit / tip receipts, the
//              invoice row. Each step checks what already exists, so a retry repeats nothing.
//   stage B    notifications: the customer's confirmation email and text (an admin alert is sent by the receipt and lifecycle steps).
//              They are attempted once; a failure is recorded by the relay (notification_failures) and is not retried. If stage B has to run
//              again (a crash, or the completion marker could not be written), the text is skipped when its sms_conversations row exists, but
//              the email has no durable record and is sent again: delivery is at-least-once for the email, best-effort once for the text.
//   finish     post_completed_at is set; the payment is never worked on again.
//
// If a stage A step fails the lease is released and the result says `incomplete`, so the next trigger retries at once. The triggers are
// the charge request itself and every Stripe webhook delivery that finds the payment applied (Stripe redelivers until the endpoint
// answers 2xx), so a charge whose request died, or whose browser was closed, is completed by the webhook with no button, no cron job and
// no manual step.

import { logTransaction } from "../transaction-logger.ts";
import { buildPortalUrl } from "../portal-link.ts";
import { getSiteOrigin } from "../siteOrigin.ts";
import { formatOrderId } from "../format-order-id.ts";
import { receiptOrderFigures } from "./receipt-order-totals.ts";
import { sendDepositConfirmationEmail } from "./deposit-confirmation-email.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export type PostPaymentStatus = "completed" | "already_completed" | "busy" | "not_applicable" | "not_found" | "incomplete" | "error";

export interface PostPaymentResult {
  status: PostPaymentStatus;
  steps: Record<string, "done" | "skipped" | "failed">;
  errors: string[];
}

export interface PostPaymentOptions {
  // The Stripe charge id when the caller knows it (the payments table does not store it); only used to label receipts.
  chargeId?: string | null;
  // Test seams. Defaults: the database client's own function invoker, the shared email sender, the configured site origin.
  invoke?: (name: string, body: Record<string, unknown>) => Promise<{ data?: Any; error?: Any } | void>;
  sendConfirmationEmail?: typeof sendDepositConfirmationEmail;
  siteOrigin?: string;
  leaseSeconds?: number;
  // Pause between attempts to record completion (test seam).
  finishRetryDelayMs?: number;
}

// The confirmation text is recorded by send-sms-notification in sms_conversations once the provider accepted it. A repeat of stage B (a
// crash or a failed completion marker after the text went out) finds that row and does not text the customer again. This is a
// best-effort guard on top of the single attempt: if the row is missing (the provider accepted but the insert failed) or the lookup fails,
// the text is sent, because a missed confirmation is worse than a repeated one.
export async function confirmationSmsAlreadySent(db: Any, orderId: string, paidAt: string | null): Promise<boolean> {
  try {
    let query = db.from("sms_conversations").select("message_body, created_at").eq("order_id", orderId).eq("direction", "outbound");
    if (paidAt) query = query.gte("created_at", paidAt);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return false;
    const marker = `is confirmed! Order #${formatOrderId(orderId)}`;
    return data.some((row: Any) => typeof row?.message_body === "string" && row.message_body.includes(marker));
  } catch {
    return false;
  }
}

// Recording completion is one idempotent UPDATE; a transient database error is retried here so a blip does not make the next trigger
// repeat the notifications that already went out.
async function recordCompletion(db: Any, paymentId: string, delayMs: number): Promise<{ message: string } | null> {
  let last: { message: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { error } = await db.rpc("finish_post_payment_completion", { p_payment_id: paymentId });
      if (!error) return null;
      last = { message: String(error.message ?? error) };
    } catch (err) {
      last = { message: err instanceof Error ? err.message : String(err) };
    }
    if (attempt < 2 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return last;
}

export function buildConfirmationSms(order: { id: string; event_date: string }, firstName: string, portalUrl: string): string {
  const eventDate = new Date(`${order.event_date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `Hi ${firstName}, your booking for ${eventDate} is confirmed! Order #${formatOrderId(order.id)}. Track your order: ${portalUrl}. We'll contact you closer to your event date.`;
}

export function invoiceStatusFor(paidCents: number, totalCents: number): "paid" | "partial" | "sent" {
  return paidCents >= totalCents ? "paid" : paidCents > 0 ? "partial" : "sent";
}

export async function completePostPayment(db: Any, paymentId: string, options: PostPaymentOptions = {}): Promise<PostPaymentResult> {
  const result: PostPaymentResult = { status: "error", steps: {}, errors: [] };
  const invoke =
    options.invoke ??
    (async (name: string, body: Record<string, unknown>) => await db.functions.invoke(name, { body }));

  // ---- claim ------------------------------------------------------------------------------------------------------------------
  const { data: claim, error: claimError } = await db.rpc("claim_post_payment_completion", {
    p_payment_id: paymentId,
    p_lease_seconds: options.leaseSeconds ?? 300,
  });
  if (claimError || !claim || typeof claim !== "object") {
    result.errors.push(`claim failed: ${claimError?.message ?? "no result"}`);
    return result;
  }
  const outcome = String((claim as Any).outcome ?? "");
  if (outcome === "already_completed" || outcome === "busy" || outcome === "not_applicable" || outcome === "not_found") {
    result.status = outcome as PostPaymentStatus;
    return result;
  }
  if (outcome !== "claimed") {
    result.errors.push(`unexpected claim outcome: ${outcome}`);
    return result;
  }

  const c = claim as Any;
  const orderId: string = c.order_id;
  const grossCents: number = c.amount_cents ?? 0;
  const tipCents: number = c.tip_cents ?? 0;
  const principalCents: number = typeof c.principal_cents === "number" ? c.principal_cents : Math.max(0, grossCents - tipCents);

  const failA = (step: string, message: string) => {
    result.steps[step] = "failed";
    result.errors.push(`${step}: ${message}`);
  };

  try {
    // ---- the order and its customer -----------------------------------------------------------------------------------------
    const { data: order, error: orderError } = await db
      .from("orders")
      .select("*, customers(first_name, last_name, email, phone), order_custom_fees(amount_cents, name), order_discounts(amount_cents, percentage, name)")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) {
      failA("order", orderError?.message ?? "order not found");
      await db.rpc("release_post_payment_claim", { p_payment_id: paymentId });
      result.status = "incomplete";
      return result;
    }
    const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;

    // ---- stage A: records that must exist -----------------------------------------------------------------------------------

    // A1. The order is confirmed and the admin alerted, once (order-lifecycle is idempotent: an already-alerted confirmed order is a no-op).
    try {
      const res = await invoke("order-lifecycle", {
        action: "enter_confirmed",
        orderId,
        source: "post_payment_completion",
        paymentOutcome: "charged_now",
      });
      const error = res && (res as Any).error;
      if (error) {
        failA("lifecycle", String(error.message ?? error));
      } else {
        const data = res && (res as Any).data;
        // A logical refusal (for example the order was cancelled after the payment) cannot be fixed by retrying.
        result.steps.lifecycle = data && data.success === false && !data.alreadySent ? "skipped" : "done";
        if (data && data.success === false && !data.alreadySent) result.errors.push(`lifecycle: ${String(data.error ?? "refused")}`);
      }
    } catch (err) {
      failA("lifecycle", err instanceof Error ? err.message : String(err));
    }

    // A2. Transaction receipts for the deposit and the tip (one group), skipped when a receipt for this payment and type exists.
    if (order.customer_id) {
      try {
        const groupId = crypto.randomUUID();
        const common = {
          orderId,
          customerId: order.customer_id as string,
          paymentId,
          paymentMethod: c.payment_method ?? null,
          paymentMethodBrand: c.payment_brand ?? null,
          stripeChargeId: options.chargeId ?? null,
          stripePaymentIntentId: c.stripe_payment_intent_id ?? null,
          receiptGroupId: groupId,
        };
        const wanted: Array<{ type: "deposit" | "tip"; cents: number; notes: string }> = [
          { type: "deposit", cents: principalCents, notes: `Deposit payment for Order ${formatOrderId(orderId)}` },
        ];
        if (tipCents > 0) wanted.push({ type: "tip", cents: tipCents, notes: `Crew tip for Order ${formatOrderId(orderId)}` });
        let receiptFailed = false;
        for (const w of wanted) {
          const { data: existing, error: lookupError } = await db
            .from("transaction_receipts")
            .select("receipt_number")
            .eq("payment_id", paymentId)
            .eq("transaction_type", w.type)
            .maybeSingle();
          if (lookupError) {
            receiptFailed = true;
            result.errors.push(`receipt lookup (${w.type}): ${lookupError.message}`);
            continue;
          }
          if (existing) continue;
          const number = await logTransaction(db, { ...common, transactionType: w.type, amountCents: w.cents, notes: w.notes });
          if (number === null) {
            // logTransaction returns null for a failed insert AND for a duplicate; look again before calling it a failure.
            const { data: again } = await db.from("transaction_receipts").select("receipt_number").eq("payment_id", paymentId).eq("transaction_type", w.type).maybeSingle();
            if (!again) {
              receiptFailed = true;
              result.errors.push(`receipt (${w.type}) could not be recorded`);
            }
          }
        }
        if (receiptFailed) result.steps.receipts = "failed";
        else result.steps.receipts = "done";
      } catch (err) {
        failA("receipts", err instanceof Error ? err.message : String(err));
      }
    } else {
      result.steps.receipts = "skipped";
    }

    // A3. The invoice row, once per order.
    try {
      const { data: existingInvoice, error: invoiceLookupError } = await db.from("invoices").select("id").eq("order_id", orderId).limit(1).maybeSingle();
      if (invoiceLookupError) {
        failA("invoice", invoiceLookupError.message);
      } else if (existingInvoice) {
        result.steps.invoice = "skipped";
      } else {
        const customFees = Array.isArray(order.order_custom_fees) ? order.order_custom_fees : [];
        const discounts = Array.isArray(order.order_discounts) ? order.order_discounts : [];
        const totalCents = receiptOrderFigures(order, discounts, customFees).total;
        const { data: numberData } = await db.rpc("generate_invoice_number");
        const invoiceNumber = typeof numberData === "string" && numberData ? numberData : `INV-${Date.now()}`;
        const { error: insertError } = await db.from("invoices").insert({
          invoice_number: invoiceNumber,
          order_id: orderId,
          customer_id: order.customer_id,
          due_date: order.event_date,
          status: invoiceStatusFor(principalCents, totalCents),
          subtotal_cents: order.subtotal_cents ?? 0,
          tax_cents: order.tax_cents ?? 0,
          travel_fee_cents: order.travel_fee_cents ?? 0,
          surface_fee_cents: order.surface_fee_cents ?? 0,
          same_day_pickup_fee_cents: order.same_day_pickup_fee_cents ?? 0,
          same_day_weekday_delivery_fee_cents: order.same_day_weekday_delivery_fee_cents ?? 0,
          generator_fee_cents: order.generator_fee_cents ?? 0,
          setup_fee_cents: order.setup_fee_cents ?? 0,
          total_cents: totalCents,
          paid_amount_cents: principalCents,
        });
        if (insertError) failA("invoice", insertError.message);
        else result.steps.invoice = "done";
      }
    } catch (err) {
      failA("invoice", err instanceof Error ? err.message : String(err));
    }

    // Any failed stage A step: give the lease back so the next trigger retries; nothing in stage B has been sent.
    if (Object.values(result.steps).includes("failed") || result.errors.some((e) => e.startsWith("receipt"))) {
      await db.rpc("release_post_payment_claim", { p_payment_id: paymentId });
      result.status = "incomplete";
      return result;
    }

    // ---- stage B: customer notifications (attempted once) ----------------------------------------------------------------
    const sendEmail = options.sendConfirmationEmail ?? sendDepositConfirmationEmail;
    try {
      const delivered = await sendEmail(db, {
        orderId,
        principalCents,
        grossCents,
        paymentMethod: c.payment_method ?? null,
        paymentBrand: c.payment_brand ?? null,
        paymentLast4: c.payment_last4 ?? null,
      });
      result.steps.email = delivered ? "done" : "failed";
      if (!delivered) result.errors.push("email: the confirmation email could not be sent");
    } catch (err) {
      result.steps.email = "failed";
      result.errors.push(`email: ${err instanceof Error ? err.message : String(err)}`);
    }

    const phone = typeof customer?.phone === "string" ? customer.phone.trim() : "";
    if (phone && (await confirmationSmsAlreadySent(db, orderId, typeof c.paid_at === "string" ? c.paid_at : null))) {
      // A repeat of stage B: the customer was already texted for this payment.
      result.steps.sms = "skipped";
    } else if (phone) {
      try {
        const origin = options.siteOrigin ?? getSiteOrigin();
        const portalUrl = (await buildPortalUrl(db, orderId, origin)) ?? origin;
        const message = buildConfirmationSms(order, customer?.first_name || "there", portalUrl);
        const res = await invoke("send-sms-notification", { to: phone, message, orderId });
        const error = res && (res as Any).error;
        result.steps.sms = error ? "failed" : "done";
        if (error) result.errors.push(`sms: ${String(error.message ?? error)}`);
      } catch (err) {
        result.steps.sms = "failed";
        result.errors.push(`sms: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      result.steps.sms = "skipped";
    }

    // ---- finish -------------------------------------------------------------------------------------------------------------
    const finishError = await recordCompletion(db, paymentId, options.finishRetryDelayMs ?? 250);
    if (finishError) {
      // Everything was sent; only the marker failed. A retry would repeat stage B, so say so plainly.
      result.errors.push(`finish: ${finishError.message}`);
      await db.rpc("release_post_payment_claim", { p_payment_id: paymentId });
      result.status = "incomplete";
      return result;
    }
    result.status = "completed";
    return result;
  } catch (err) {
    result.errors.push(`unexpected: ${err instanceof Error ? err.message : String(err)}`);
    try {
      await db.rpc("release_post_payment_claim", { p_payment_id: paymentId });
    } catch {
      // the lease simply runs out
    }
    result.status = "incomplete";
    return result;
  }
}
