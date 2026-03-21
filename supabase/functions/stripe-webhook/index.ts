import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { logTransaction } from "../_shared/transaction-logger.ts";
import { beginWebhookProcessing, finalizeWebhookSuccess, finalizeWebhookFailure } from "../_shared/webhook-idempotency.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-10-28.acacia",
});

Deno.serve(async (req: Request) => {
  console.log("🧲 [WEBHOOK] Received request:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.text();
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const signature = req.headers.get("stripe-signature");

    console.log("🔐 [WEBHOOK] Has webhook secret:", !!webhookSecret);
    console.log("🖊️ [WEBHOOK] Has signature:", !!signature);

    let event: Stripe.Event;

    if (webhookSecret && signature) {
      try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        console.log("✅ [WEBHOOK] Signature verified");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("❌ [WEBHOOK] Signature verification failed:", message);
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      event = JSON.parse(body);
      console.log("⚠️ [WEBHOOK] No signature verification (dev mode)");
    }

    console.log("📨 [WEBHOOK] Event type:", event.type);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Begin webhook processing with safe idempotency
    const { shouldProcess, alreadyProcessed, alreadyProcessing } = await beginWebhookProcessing(
      supabaseClient,
      event.id,
      event.type,
      event
    );

    if (alreadyProcessed) {
      console.log(`✅ [WEBHOOK] Event already succeeded: ${event.id}`);
      return new Response(JSON.stringify({ received: true, skipped: true, reason: 'already_processed' }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (alreadyProcessing) {
      console.log(`⏳ [WEBHOOK] Event currently processing: ${event.id}`);
      return new Response(JSON.stringify({ received: true, skipped: true, reason: 'currently_processing' }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!shouldProcess) {
      console.error(`❌ [WEBHOOK] Cannot process event: ${event.id}`);
      return new Response(JSON.stringify({ error: "Failed to begin processing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Wrap processing in try-catch for proper error handling
    try {
      await processWebhookEvent(event, supabaseClient, stripe);

      // Mark as succeeded
      await finalizeWebhookSuccess(supabaseClient, event.id);

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (processingError: unknown) {
      const errorMessage = processingError instanceof Error ? processingError.message : "Unknown error";
      console.error(`❌ [WEBHOOK] Processing error for ${event.id}:`, errorMessage);

      // Mark as failed
      await finalizeWebhookFailure(supabaseClient, event.id, errorMessage);

      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("❌ [WEBHOOK] Fatal error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Process webhook event (extracted for error handling)
 */
async function processWebhookEvent(
  event: Stripe.Event,
  supabaseClient: any,
  stripe: Stripe
): Promise<void> {
  switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id || null;
        const paymentType = session.metadata?.payment_type || "deposit";

        // Safely pull customer + PI
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

        const amountPaid = session.amount_total || 0;

        if (!orderId) {
          console.warn("[WEBHOOK] No order_id in session metadata, skipping");
          break;
        }

        // Handle setup mode (card saved, no charge yet)
        if (session.mode === "setup" && setupIntentId) {
          console.log(`🔐 [WEBHOOK] Setup session completed for order ${orderId}`);

          // CRITICAL: Retrieve the SetupIntent to get the payment_method
          // In setup mode, payment_method is NOT on the session, it's on the SetupIntent
          let actualPaymentMethodId = paymentMethodId;
          try {
            const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
            actualPaymentMethodId = typeof setupIntent.payment_method === "string"
              ? setupIntent.payment_method
              : setupIntent.payment_method?.id || null;
            console.log(`[WEBHOOK] Retrieved payment method from SetupIntent: ${actualPaymentMethodId}`);
          } catch (err) {
            console.error(`[WEBHOOK] Failed to retrieve SetupIntent ${setupIntentId}:`, err);
          }

          const tipCents = parseInt(session.metadata?.tip_cents || "0", 10);

          // Retrieve brand + last4 so the approval modal can display them before any charge
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

          // Check if this is an admin invoice
          const { data: invoiceLink } = await supabaseClient
            .from("invoice_links")
            .select("id")
            .eq("order_id", orderId)
            .maybeSingle();

          const isAdminInvoice = !!invoiceLink;
          const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

          const { error: updateError } = await supabaseClient
            .from("orders")
            .update({
              stripe_payment_method_id: actualPaymentMethodId,
              stripe_customer_id: stripeCustomerId,
              tip_cents: tipCents,
              status: newStatus,
              ...(setupCardBrand ? { payment_method_brand: setupCardBrand } : {}),
              ...(setupCardLast4 ? { payment_method_last_four: setupCardLast4 } : {}),
            })
            .eq("id", orderId);

          if (updateError) {
            console.error(`[WEBHOOK] Error updating order ${orderId}:`, updateError);
          } else {
            console.log(`[WEBHOOK] Setup completed - order ${orderId} updated to ${newStatus} with payment method: ${actualPaymentMethodId}, tip: $${(tipCents/100).toFixed(2)}`);
          }
          break;
        }

        console.log(`💰 [WEBHOOK] Payment completed: ${paymentType} for order ${orderId}`);

        if (paymentType === "balance") {
          // Extract payment method details and latest_charge from expanded PaymentIntent
          const piId = paymentIntentId;
          let latestChargeId: string | null = null;
          let paymentMethodType: string | null = null;
          let paymentBrand: string | null = null;
          let paymentLast4: string | null = null;

          if (piId) {
            try {
              // IMPORTANT: expand payment_method and latest_charge for reliable payment details
              const pi = await stripe.paymentIntents.retrieve(piId, {
                expand: ['payment_method', 'latest_charge'],
              });

              // Extract latest_charge ID
              latestChargeId =
                typeof pi.latest_charge === "string"
                  ? pi.latest_charge
                  : pi.latest_charge?.id || null;

              // Extract payment method details from expanded payment_method
              const pm = pi.payment_method;
              if (pm && typeof pm === 'object') {
                // @ts-ignore (pm is expanded PaymentMethod)
                paymentMethodType = pm.type || null;
                // @ts-ignore
                if (pm.card) {
                  // @ts-ignore
                  paymentBrand = pm.card.brand || null;
                  // @ts-ignore
                  paymentLast4 = pm.card.last4 || null;
                }
              }
            } catch (err) {
              console.error("[WEBHOOK] Failed to retrieve PI with expansions:", err);
            }
          }

          // Retrieve charge details for fee information
          let stripeFee = 0;
          let stripeNet = amountPaid;
          let currency = 'usd';

          if (latestChargeId) {
            try {
              // IMPORTANT: expand balance_transaction so fee/net are available
              const charge = await stripe.charges.retrieve(latestChargeId, {
                expand: ['balance_transaction'],
              });

              currency = charge.currency || 'usd';

              const balanceTx = charge.balance_transaction;
              if (balanceTx && typeof balanceTx === 'object') {
                // balanceTx is Stripe.BalanceTransaction when expanded
                // @ts-ignore (Stripe types may vary in edge runtime)
                stripeFee = balanceTx.fee || 0;
                // @ts-ignore
                stripeNet = balanceTx.net || amountPaid;
              } else {
                console.warn('[WEBHOOK] balance_transaction was not expanded; fee tracking may be inaccurate', {
                  latestChargeId,
                  balance_transaction: charge.balance_transaction,
                });
              }
            } catch (err) {
              console.error('[WEBHOOK] Failed to retrieve charge fee data:', err);
            }
          }

          // Separate tip from balance amount (tip_cents stored in session metadata)
          const balanceTipCents = parseInt(session.metadata?.tip_cents || "0", 10);
          const safeTipCents = Number.isFinite(balanceTipCents) ? balanceTipCents : 0;
          const balanceOnly = Math.max(0, amountPaid - safeTipCents);

          // Fetch existing balance_paid_cents AND tip before updating so we can ACCUMULATE
          const { data: balanceOrder } = await supabaseClient
            .from("orders")
            .select("tip_cents, balance_paid_cents")
            .eq("id", orderId)
            .maybeSingle();
          const existingTip = balanceOrder?.tip_cents || 0;
          const existingBalancePaid = balanceOrder?.balance_paid_cents || 0;

          // Update order with balance payment, accumulating both balance_paid_cents and tip_cents
          await supabaseClient
            .from("orders")
            .update({
              stripe_payment_method_id: paymentMethodId,
              stripe_customer_id: stripeCustomerId,
              balance_paid_cents: existingBalancePaid + balanceOnly,
              ...(safeTipCents > 0 ? { tip_cents: existingTip + safeTipCents } : {}),
            })
            .eq("id", orderId);

          // Insert balance payment record with fee tracking
          if (piId) {
            const { data: paymentRecord } = await supabaseClient
              .from("payments")
              .insert({
                order_id: orderId,
                stripe_payment_intent_id: piId,
                amount_cents: amountPaid,
                type: "balance",
                status: "succeeded",
                paid_at: new Date().toISOString(),
                payment_method: paymentMethodType,
                payment_brand: paymentBrand,
                payment_last4: paymentLast4,
                stripe_fee_amount: stripeFee,
                stripe_net_amount: stripeNet,
                currency: currency,
              })
              .select('id')
              .single();

            // Get order details for transaction logging and receipt email
            const { data: order } = await supabaseClient
              .from("orders")
              .select("customer_id, event_date, contacts!inner(email, full_name)")
              .eq("id", orderId)
              .maybeSingle();

            // Log balance payment transaction (with idempotency via unique stripe_charge_id)
            if (order && paymentRecord) {
              await logTransaction(supabaseClient, {
                transactionType: 'balance',
                orderId,
                customerId: order.customer_id,
                paymentId: paymentRecord.id,
                amountCents: amountPaid,
                paymentMethod: paymentMethodType,
                paymentMethodBrand: paymentBrand,
                stripeChargeId: latestChargeId,
                stripePaymentIntentId: piId,
                notes: 'Customer portal balance payment',
              });
            }

            // Send receipt email for Checkout-path balance payment
            try {
              const contact = Array.isArray(order?.contacts) ? order.contacts[0] : order?.contacts;
              if (contact?.email) {
                const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
                const cardText = paymentBrand && paymentLast4
                  ? `${paymentBrand.charAt(0).toUpperCase() + paymentBrand.slice(1)} ending in ${paymentLast4}`
                  : paymentLast4 ? `Card ending in ${paymentLast4}` : "Card";
                const eventLine = order?.event_date
                  ? `<p style="margin:0;color:#64748b;font-size:14px;">Event Date: ${new Date(order.event_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>`
                  : "";
                const tipLine = safeTipCents > 0
                  ? `<tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Crew Tip</td><td style="padding:8px 0;text-align:right;color:#16a34a;font-size:14px;font-weight:600;">+${fmt(safeTipCents)}</td></tr>`
                  : "";
                const receiptHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f8fafc;margin:0;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
  <div style="background:linear-gradient(135deg,#0ea5e9,#0284c7);padding:32px;text-align:center;">
    <h1 style="margin:0;color:white;font-size:22px;font-weight:700;">Payment Received</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,.85);font-size:14px;">Order #${orderId.substring(0, 8).toUpperCase()}</p>
  </div>
  <div style="padding:32px;">
    <p style="margin:0 0 24px;font-size:16px;color:#1e293b;">Hi ${contact.full_name || "Customer"},</p>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Your payment has been processed successfully. Here's your receipt:</p>
    ${eventLine}
    <table style="width:100%;border-collapse:collapse;margin:24px 0;">
      ${balanceOnly > 0 ? `<tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Balance Payment</td><td style="padding:8px 0;text-align:right;font-size:14px;font-weight:600;color:#1e293b;">${fmt(balanceOnly)}</td></tr>` : ""}
      ${tipLine}
      <tr style="border-top:2px solid #e2e8f0;">
        <td style="padding:12px 0;font-weight:700;font-size:15px;color:#1e293b;">Total Charged</td>
        <td style="padding:12px 0;text-align:right;font-weight:700;font-size:18px;color:#0ea5e9;">${fmt(amountPaid)}</td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Payment method: ${cardText}</p>
    <p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">Thank you for choosing Bounce Party Club!</p>
  </div>
</div>
</body></html>`;
                await supabaseClient.functions.invoke("send-email", {
                  body: {
                    to: contact.email,
                    subject: `Payment Received - Order #${orderId.substring(0, 8).toUpperCase()}`,
                    html: receiptHtml,
                  },
                });
              }
            } catch (emailErr) {
              console.warn("[WEBHOOK] Failed to send checkout balance receipt email:", emailErr);
            }
          }
        } else {
          // Handle deposit payment
          const tipCents = parseInt(session.metadata?.tip_cents || "0", 10);
          const depositOnly = Math.max(
            0,
            amountPaid - (Number.isFinite(tipCents) ? tipCents : 0)
          );

          const { data: invoiceLink } = await supabaseClient
            .from("invoice_links")
            .select("id")
            .eq("order_id", orderId)
            .maybeSingle();

          const isAdminInvoice = !!invoiceLink;
          const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

          console.log(`[WEBHOOK] Updating order ${orderId}:`, {
            depositOnly,
            tipCents,
            newStatus,
            isAdminInvoice,
          });

          const { error: updateError } = await supabaseClient
            .from("orders")
            .update({
              stripe_payment_status: "paid",
              stripe_payment_method_id: paymentMethodId,
              stripe_customer_id: stripeCustomerId,
              deposit_paid_cents: depositOnly,
              tip_cents: tipCents,
              status: newStatus,
            })
            .eq("id", orderId);

          if (updateError) {
            console.error(`[WEBHOOK] Error updating order ${orderId}:`, updateError);
          } else {
            console.log(`[WEBHOOK] Successfully updated order ${orderId} to status: ${newStatus}`);
          }

          if (paymentIntentId) {
            await supabaseClient
              .from("payments")
              .update({
                status: "succeeded",
                paid_at: new Date().toISOString(),
              })
              .eq("stripe_payment_intent_id", paymentIntentId);
          }
        }
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const orderId = paymentIntent.metadata?.order_id || null;
        const paymentType = paymentIntent.metadata?.payment_type || null;

        // Extract payment method details
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

        // Mark the payment row as succeeded
        await supabaseClient
          .from("payments")
          .update({
            status: "succeeded",
            paid_at: new Date().toISOString(),
            payment_method: paymentMethodType,
            payment_brand: paymentBrand,
            payment_last4: paymentLast4
          })
          .eq("stripe_payment_intent_id", paymentIntent.id);

        if (orderId) {
          const paymentMethodId =
            typeof paymentIntent.payment_method === "string"
              ? paymentIntent.payment_method
              : paymentIntent.payment_method?.id || null;

          const stripeCustomerId =
            typeof paymentIntent.customer === "string"
              ? paymentIntent.customer
              : paymentIntent.customer?.id || null;

          const amountReceived = paymentIntent.amount_received || 0;

          if (paymentType === "balance") {
            // Guard: if the customer-balance-payment edge fn already inserted a
            // payment row for this PI (COF path), it has already written
            // balance_paid_cents and tip_cents to the order authoritatively.
            // Skip the order write here to prevent a double-write / tip pollution.
            const { data: existingPaymentRow } = await supabaseClient
              .from("payments")
              .select("id")
              .eq("stripe_payment_intent_id", paymentIntent.id)
              .maybeSingle();

            if (existingPaymentRow) {
              // Edge fn already handled all DB writes — only update payment method
              // fields on the order in case they're missing.
              await supabaseClient
                .from("orders")
                .update({
                  stripe_payment_method_id: paymentMethodId,
                  stripe_customer_id: stripeCustomerId,
                })
                .eq("id", orderId);
            } else {
            // No existing payment row — this PI came through Stripe Checkout.
            // The checkout.session.completed handler is responsible for writing
            // balance_paid_cents and tip_cents. This branch handles the rare case
            // where checkout.session.completed did not fire first.
            // ACCUMULATE: read existing values before writing.
            const tipCentsFromMeta = parseInt(paymentIntent.metadata?.tip_cents || "0", 10) || 0;
            const balanceOnlyAmount = Math.max(0, amountReceived - tipCentsFromMeta);

            const { data: existingOrderPi } = await supabaseClient
              .from("orders")
              .select("balance_paid_cents, tip_cents")
              .eq("id", orderId)
              .maybeSingle();
            const existingBalancePi = existingOrderPi?.balance_paid_cents || 0;
            const existingTipPi = existingOrderPi?.tip_cents || 0;

            await supabaseClient
              .from("orders")
              .update({
                stripe_payment_method_id: paymentMethodId,
                stripe_customer_id: stripeCustomerId,
                balance_paid_cents: existingBalancePi + balanceOnlyAmount,
                ...(tipCentsFromMeta > 0 ? { tip_cents: existingTipPi + tipCentsFromMeta } : {}),
              })
              .eq("id", orderId);
            }
          } else if (paymentType === "deposit") {
            // Handle deposit payment.
            // amountReceived is the FULL charged amount (base + tip).
            // deposit_paid_cents must store BASE ONLY, never tip.
            // checkout.session.completed fires before payment_intent.succeeded and
            // already writes deposit_paid_cents using tip_cents from session metadata
            // (the authoritative source). If it already did so, skip the deposit
            // amount write to avoid a race condition where tip_cents may not yet be
            // persisted on the order row when this handler runs.
            const { data: depositOrder } = await supabaseClient
              .from("orders")
              .select("tip_cents, deposit_paid_cents, stripe_payment_status")
              .eq("id", orderId)
              .maybeSingle();

            const { data: invoiceLink } = await supabaseClient
              .from("invoice_links")
              .select("id")
              .eq("order_id", orderId)
              .maybeSingle();

            const isAdminInvoice = !!invoiceLink;
            const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

            const alreadyRecordedByCheckout =
              depositOrder?.stripe_payment_status === "paid" &&
              (depositOrder?.deposit_paid_cents || 0) > 0;

            if (!alreadyRecordedByCheckout) {
              const storedTipCents = depositOrder?.tip_cents || 0;
              const depositOnlyFromPI = Math.max(0, amountReceived - storedTipCents);

              await supabaseClient
                .from("orders")
                .update({
                  stripe_payment_status: "paid",
                  stripe_payment_method_id: paymentMethodId,
                  stripe_customer_id: stripeCustomerId,
                  deposit_paid_cents: depositOnlyFromPI,
                  status: newStatus,
                })
                .eq("id", orderId);
            } else {
              // checkout.session.completed already wrote deposit_paid_cents correctly;
              // only update payment method fields and status.
              await supabaseClient
                .from("orders")
                .update({
                  stripe_payment_method_id: paymentMethodId,
                  stripe_customer_id: stripeCustomerId,
                  status: newStatus,
                })
                .eq("id", orderId);
            }
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await supabaseClient
          .from("payments")
          .update({
            status: "failed",
            failed_at: new Date().toISOString()
          })
          .eq("stripe_payment_intent_id", paymentIntent.id);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = charge.payment_intent as string;

        // Find the original payment
        const { data: originalPayment } = await supabaseClient
          .from("payments")
          .select("id, order_id, payment_method, payment_brand")
          .eq("stripe_payment_intent_id", paymentIntentId)
          .maybeSingle();

        if (originalPayment?.order_id) {
          const refundAmountCents = charge.amount_refunded || 0;
          // Store refunds as negative amounts for correct ledger math
          const refundAmountSigned = -Math.abs(refundAmountCents);
          const refundId = (charge.refunds?.data?.[0]?.id as string) || null;

          // Get order and customer details
          const { data: order } = await supabaseClient
            .from("orders")
            .select("customer_id")
            .eq("id", originalPayment.order_id)
            .single();

          // Create refund payment record with negative amount
          const { data: refundPayment } = await supabaseClient
            .from("payments")
            .insert({
              order_id: originalPayment.order_id,
              stripe_payment_intent_id: paymentIntentId,
              amount_cents: refundAmountSigned,
              type: "refund",
              status: "succeeded",
              paid_at: new Date().toISOString(),
              payment_method: originalPayment.payment_method,
              payment_brand: originalPayment.payment_brand,
              refunded_payment_id: originalPayment.id,
              stripe_fee_amount: 0,
              stripe_net_amount: refundAmountSigned,
              currency: 'usd',
            })
            .select('id')
            .single();

          // Create transaction receipt for refund with negative amount
          if (order && refundPayment) {
            await logTransaction(supabaseClient, {
              transactionType: 'refund',
              orderId: originalPayment.order_id,
              customerId: order.customer_id,
              paymentId: refundPayment.id,
              amountCents: refundAmountSigned,
              paymentMethod: originalPayment.payment_method,
              paymentMethodBrand: originalPayment.payment_brand,
              stripeChargeId: charge.id,
              stripePaymentIntentId: paymentIntentId,
              notes: `Refund for charge ${charge.id}${charge.refund_reason ? ` - ${charge.refund_reason}` : ''}`,
            });
          }

          // Keep existing order_refunds insert for backwards compatibility (positive amount)
          await supabaseClient.from("order_refunds").insert({
            order_id: originalPayment.order_id,
            amount_cents: refundAmountCents,
            reason: charge.refund_reason || "refund",
            stripe_refund_id: refundId,
            refunded_by: null,
            status: charge.refunded ? "succeeded" : "pending",
          });

          console.log(`✅ [WEBHOOK] Refund processed: -$${(refundAmountCents / 100).toFixed(2)} for order ${originalPayment.order_id}`);
        }
        break;
      }

      case "setup_intent.succeeded": {
        const setupIntent = event.data.object as Stripe.SetupIntent;
        const orderId = setupIntent.metadata?.order_id || null;

        if (!orderId) {
          console.warn("[WEBHOOK] No order_id in setup_intent metadata, skipping");
          break;
        }

        console.log(`🔐 [WEBHOOK] SetupIntent succeeded for order ${orderId}`);

        const paymentMethodId =
          typeof setupIntent.payment_method === "string"
            ? setupIntent.payment_method
            : setupIntent.payment_method?.id || null;

        const stripeCustomerId =
          typeof setupIntent.customer === "string"
            ? setupIntent.customer
            : setupIntent.customer?.id || null;

        // Retrieve brand + last4 so the approval modal can display them before any charge
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

        // Check if this is an admin invoice
        const { data: invoiceLink } = await supabaseClient
          .from("invoice_links")
          .select("id")
          .eq("order_id", orderId)
          .maybeSingle();

        const isAdminInvoice = !!invoiceLink;
        const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

        // Update order with payment method and set to pending_review (or confirmed for admin invoices)
        const { error: updateError } = await supabaseClient
          .from("orders")
          .update({
            stripe_payment_method_id: paymentMethodId,
            stripe_customer_id: stripeCustomerId,
            status: newStatus,
            ...(siCardBrand ? { payment_method_brand: siCardBrand } : {}),
            ...(siCardLast4 ? { payment_method_last_four: siCardLast4 } : {}),
          })
          .eq("id", orderId);

        if (updateError) {
          console.error(`[WEBHOOK] Error updating order ${orderId}:`, updateError);
        } else {
          console.log(`[WEBHOOK] Successfully updated order ${orderId} to status: ${newStatus}`);
        }
        break;
      }

      default:
        console.log(`ℹ️ [WEBHOOK] Unhandled event type: ${event.type}`);
    }
}
