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

          // Update order with balance payment
          await supabaseClient
            .from("orders")
            .update({
              stripe_payment_method_id: paymentMethodId,
              stripe_customer_id: stripeCustomerId,
              balance_paid_cents: amountPaid,
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

            // Get order details for transaction logging
            const { data: order } = await supabaseClient
              .from("orders")
              .select("customer_id")
              .eq("id", orderId)
              .single();

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
            // Handle balance payment
            await supabaseClient
              .from("orders")
              .update({
                stripe_payment_method_id: paymentMethodId,
                stripe_customer_id: stripeCustomerId,
                balance_paid_cents: amountReceived,
              })
              .eq("id", orderId);
          } else if (paymentType === "deposit") {
            // Handle deposit payment
            const { data: invoiceLink } = await supabaseClient
              .from("invoice_links")
              .select("id")
              .eq("order_id", orderId)
              .maybeSingle();

            const isAdminInvoice = !!invoiceLink;
            const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

            await supabaseClient
              .from("orders")
              .update({
                stripe_payment_status: "paid",
                stripe_payment_method_id: paymentMethodId,
                stripe_customer_id: stripeCustomerId,
                deposit_paid_cents: amountReceived,
                status: newStatus,
              })
              .eq("id", orderId);
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
