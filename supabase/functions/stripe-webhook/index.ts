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
  // BPC-SECURITY-HARDENING: verbose dev debug log commented out for production.
  // console.log("🧲 [WEBHOOK] Received request:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.text();
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const signature = req.headers.get("stripe-signature");

    // BPC-SECURITY-HARDENING: verbose dev debug logs commented out for production.
    // console.log("🔐 [WEBHOOK] Has webhook secret:", !!webhookSecret);
    // console.log("🖊️ [WEBHOOK] Has signature:", !!signature);

    let event: Stripe.Event;

    // BPC-SECURITY-HARDENING: The unverified fallback path below has been removed.
    // Production MUST have STRIPE_WEBHOOK_SECRET set. If the secret is missing or the
    // Stripe-Signature header is absent, we now reject with 400 instead of processing
    // an unverified payload. This prevents any caller from forging Stripe events.
    // To restore dev-mode bypass: only after a true dev/staging environment and explicit
    // safe gating (e.g. IS_DEV env var) are in place.
    if (!webhookSecret) {
      console.error("[WEBHOOK] STRIPE_WEBHOOK_SECRET is not configured. Rejecting request.");
      return new Response(JSON.stringify({ error: "Webhook secret not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!signature) {
      console.error("[WEBHOOK] Missing Stripe-Signature header. Rejecting request.");
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("❌ [WEBHOOK] Signature verification failed:", message);
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // BPC-SECURITY-HARDENING: verbose dev debug log commented out for production.
    // console.log("📨 [WEBHOOK] Event type:", event.type);

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
      // BPC-SECURITY-HARDENING: verbose dev debug log commented out for production.
      // console.log(`✅ [WEBHOOK] Event already succeeded: ${event.id}`);
      return new Response(JSON.stringify({ received: true, skipped: true, reason: 'already_processed' }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (alreadyProcessing) {
      // BPC-SECURITY-HARDENING: verbose dev debug log commented out for production.
      // console.log(`⏳ [WEBHOOK] Event currently processing: ${event.id}`);
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
          // BPC-SECURITY-HARDENING: verbose dev debug log commented out for production.
          // console.log(`🔐 [WEBHOOK] Setup session completed for order ${orderId}`);

          // CRITICAL: Retrieve the SetupIntent to get the payment_method
          // In setup mode, payment_method is NOT on the session, it's on the SetupIntent
          let actualPaymentMethodId = paymentMethodId;
          try {
            const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
            actualPaymentMethodId = typeof setupIntent.payment_method === "string"
              ? setupIntent.payment_method
              : setupIntent.payment_method?.id || null;
            // BPC-SECURITY-HARDENING: verbose dev debug log commented out for production.
            // console.log(`[WEBHOOK] Retrieved payment method from SetupIntent: ${actualPaymentMethodId}`);
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

          // Only advance status if the order is still in an initial state.
          // Never downgrade a confirmed/in_progress/completed order.
          const { data: setupCurrentOrder } = await supabaseClient
            .from("orders")
            .select("status")
            .eq("id", orderId)
            .maybeSingle();
          const setupSafeToAdvance = ["draft", "quote", "pending_review"].includes(setupCurrentOrder?.status || "");

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
              await invokeLifecycle(supabaseClient, "enter_confirmed", orderId, "webhook_setup_session_admin_invoice", "charged_now", "draft");
            } else {
              await invokeLifecycle(supabaseClient, "enter_pending_review", orderId, "webhook_setup_session_checkout", undefined, "draft");
            }
          }
          break;
        }

        // BPC-SECURITY-HARDENING: verbose dev debug log commented out for production.
        // console.log(`💰 [WEBHOOK] Payment completed: ${paymentType} for order ${orderId}`);

        if (paymentType === "balance") {
          // Extract payment method details and latest_charge from expanded PaymentIntent
          const piId = paymentIntentId;
          let latestChargeId: string | null = null;
          let paymentMethodType: string | null = null;
          let paymentBrand: string | null = null;
          let paymentLast4: string | null = null;
          let expandedPaymentMethodId: string | null = null;

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
                expandedPaymentMethodId = pm.id || null;
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

          // ── RACE-SAFE: Insert payment row FIRST (same mutex as reconcile-balance-payment) ──
          // The unique constraint on stripe_payment_intent_id is the distributed mutex.
          // Whichever concurrent writer (this webhook or reconcile-balance-payment) inserts
          // first wins the constraint and is exclusively allowed to update order totals.
          // The loser receives a 23505 unique-violation and MUST NOT touch order totals.
          //
          // Race scenario prevented:
          //   reconcile inserts payment row → wins mutex → updates order totals
          //   webhook arrives concurrently → 23505 on insert → skips order totals (patched here)
          //
          // Partial-failure recovery:
          //   If the winner inserts the payment row but the order UPDATE fails, the payment
          //   row exists with correct amount. The next webhook retry (Stripe re-delivers within
          //   hours) will see 23505 on the insert and skip the order update — so the order
          //   totals will remain stale. To repair: the payment_intent.succeeded handler for
          //   balance type already has a "no existing payment row" branch that will NOT fire
          //   (because the row exists), so recovery must be done manually or via a reconcile
          //   call from the customer portal which re-reads Stripe and patches non-financial
          //   fields. For full auto-recovery, a separate DB function that sums payments and
          //   recomputes balance_due_cents can be added in a future migration.
          if (!piId) {
            console.error("[WEBHOOK] Balance payment has no PaymentIntent ID — cannot record safely");
            break;
          }

          const { data: paymentRecord, error: balancePaymentInsertError } = await supabaseClient
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
              order_financials_applied: false,
            })
            .select('id')
            .maybeSingle();

          if (balancePaymentInsertError) {
            if (balancePaymentInsertError.code === "23505") {
              // Another writer already inserted this PI's payment row (reconcile or a prior
              // webhook delivery). Call the same atomic RPC — it will lock the row, check
              // applied flag, and apply financials exactly once if not already done.
              // This is identical to the winner path below; the RPC is idempotent.
              console.warn("[WEBHOOK] 23505 on balance insert — delegating to RPC", { orderId, piId });
              const { data: repairRows, error: repairErr } = await supabaseClient
                .rpc("apply_balance_payment_financials", {
                  p_pi_id: piId,
                  p_order_id: orderId,
                  p_balance_cents: balanceOnly,
                  p_tip_cents: safeTipCents,
                  p_pm_id: expandedPaymentMethodId || null,
                  p_customer_id: stripeCustomerId || null,
                });
              if (repairErr) {
                console.error("[WEBHOOK] apply_balance_payment_financials failed on 23505 path", { orderId, piId, repairErr });
                throw new Error(`apply_balance_payment_financials failed (23505 path): ${repairErr.message}`);
              }
              const r = Array.isArray(repairRows) ? repairRows[0] : repairRows;
              // console.log("[WEBHOOK] 23505 repair RPC result", { orderId, piId, applied: r?.applied, payment_row_found: r?.payment_row_found });
              // Send receipt email — the edge fn wrote the payment but never sends the email
              // (that's only done here in the webhook). Load order data and send now.
              try {
                const { data: order23505 } = await supabaseClient
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
                const customer23505 = Array.isArray(order23505?.customers) ? order23505.customers[0] : order23505?.customers;
                if (customer23505?.email) {
                  const { data: bizSettings23505 } = await supabaseClient
                    .from("admin_settings")
                    .select("key, value")
                    .in("key", ["business_name", "business_phone", "logo_url"]);
                  const biz23505: Record<string, string> = {};
                  bizSettings23505?.forEach((s: { key: string; value: string | null }) => { if (s.value) biz23505[s.key] = s.value; });
                  await sendCheckoutBalanceReceiptEmail(
                    supabaseClient, orderId, order23505, customer23505, biz23505,
                    amountPaid, balanceOnly, safeTipCents, paymentBrand, paymentLast4
                  );
                }
              } catch (emailErr23505) {
                console.warn("[WEBHOOK] Failed to send 23505-path balance receipt email:", emailErr23505);
              }
              break;
            }
            console.error("[WEBHOOK] CRITICAL: Failed to insert balance payment row", { orderId, piId, balancePaymentInsertError });
            throw new Error(`Balance payment insert failed: ${balancePaymentInsertError.message}`);
          }

          // Apply order financials through the atomic RPC — this is the ONLY place
          // balance_paid_cents / tip_cents / balance_due_cents are written for this PI.
          // The RPC holds a row lock on the payment row for the full read-apply-mark
          // sequence, preventing any concurrent repair caller from racing with this winner.
          const { data: applyRows, error: applyErr } = await supabaseClient
            .rpc("apply_balance_payment_financials", {
              p_pi_id: piId,
              p_order_id: orderId,
              p_balance_cents: balanceOnly,
              p_tip_cents: safeTipCents,
              p_pm_id: expandedPaymentMethodId || null,
              p_customer_id: stripeCustomerId || null,
            });
          if (applyErr) {
            // Financial application failed — throw so the outer webhook handler marks this
            // event as failed and Stripe re-delivers. The payment row already exists with
            // order_financials_applied=FALSE, so the next delivery will retry via the RPC.
            console.error("[WEBHOOK] CRITICAL: apply_balance_payment_financials failed", { orderId, piId, applyErr });
            throw new Error(`apply_balance_payment_financials failed: ${applyErr.message}`);
          }

          const applyResult = Array.isArray(applyRows) ? applyRows[0] : applyRows;
          // console.log("[WEBHOOK] apply_balance_payment_financials result", { orderId, piId, applied: applyResult?.applied, payment_row_found: applyResult?.payment_row_found });

          // Save card details to orders so the customer portal shows the correct card
          if (paymentBrand || paymentLast4 || expandedPaymentMethodId) {
            await supabaseClient
              .from("orders")
              .update({
                ...(expandedPaymentMethodId ? { stripe_payment_method_id: expandedPaymentMethodId } : {}),
                ...(paymentBrand ? { payment_method_brand: paymentBrand } : {}),
                ...(paymentLast4 ? { payment_method_last_four: paymentLast4 } : {}),
              })
              .eq("id", orderId);
          }

          // Read the post-apply order state for receipt/email values.
          // This is the authoritative source for balance_due_cents after the RPC committed.
          const { data: order } = await supabaseClient
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

          // Log balance payment transaction (idempotent via unique stripe_charge_id)
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
            const customer = Array.isArray(order?.customers) ? order.customers[0] : order?.customers;
            if (customer?.email) {
              const { data: bizSettings } = await supabaseClient
                .from("admin_settings")
                .select("key, value")
                .in("key", ["business_name", "business_phone", "logo_url"]);
              const biz: Record<string, string> = {};
              bizSettings?.forEach((s: { key: string; value: string | null }) => {
                if (s.value) biz[s.key] = s.value;
              });
              await sendCheckoutBalanceReceiptEmail(
                supabaseClient, orderId, order, customer, biz,
                amountPaid, balanceOnly, safeTipCents, paymentBrand, paymentLast4
              );
            }
          } catch (emailErr) {
            console.warn("[WEBHOOK] Failed to send checkout balance receipt email:", emailErr);
          }
        } else {
          // Handle deposit payment
          const tipCents = parseInt(session.metadata?.tip_cents || "0", 10);
          const depositOnly = Math.max(
            0,
            amountPaid - (Number.isFinite(tipCents) ? tipCents : 0)
          );

          // Retrieve card brand/last4 from the payment method so the portal can show it
          let depositCardBrand: string | null = null;
          let depositCardLast4: string | null = null;
          if (paymentMethodId) {
            try {
              const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
              depositCardBrand = pm.card?.brand || null;
              depositCardLast4 = pm.card?.last4 || null;
            } catch (err) {
              console.error("[WEBHOOK] Failed to retrieve PM for deposit:", err);
            }
          }

          const { data: invoiceLink } = await supabaseClient
            .from("invoice_links")
            .select("id")
            .eq("order_id", orderId)
            .maybeSingle();

          const isAdminInvoice = !!invoiceLink;
          const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

          // Only advance status if the order is still in an initial state.
          // Never downgrade a confirmed/in_progress/completed order.
          const { data: currentOrder } = await supabaseClient
            .from("orders")
            .select("status")
            .eq("id", orderId)
            .maybeSingle();
          const safeToAdvanceStatus = ["draft", "quote", "pending_review"].includes(currentOrder?.status || "");

          const { error: updateError } = await supabaseClient
            .from("orders")
            .update({
              ...(safeToAdvanceStatus ? { status: newStatus } : {}),
              stripe_payment_status: "paid",
              ...(paymentMethodId ? { stripe_payment_method_id: paymentMethodId } : {}),
              ...(stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : {}),
              deposit_paid_cents: depositOnly,
              ...(tipCents > 0 ? { tip_cents: tipCents } : {}),
              ...(depositCardBrand ? { payment_method_brand: depositCardBrand } : {}),
              ...(depositCardLast4 ? { payment_method_last_four: depositCardLast4 } : {}),
            })
            .eq("id", orderId);

          if (updateError) {
            console.error(`[WEBHOOK] Error updating order ${orderId}:`, updateError);
          } else if (safeToAdvanceStatus) {
            if (isAdminInvoice) {
              await invokeLifecycle(supabaseClient, "enter_confirmed", orderId, "webhook_checkout_deposit_admin_invoice", "charged_now", "draft");
            } else {
              await invokeLifecycle(supabaseClient, "enter_pending_review", orderId, "webhook_checkout_deposit_standard", undefined, "draft");
            }
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

          // Send deposit receipt email
          try {
            const { data: depositOrder } = await supabaseClient
              .from("orders")
              .select(`
                customer_id, event_date,
                subtotal_cents, travel_fee_cents, surface_fee_cents,
                same_day_pickup_fee_cents, generator_fee_cents, tax_cents,
                travel_fee_waived, surface_fee_waived, same_day_pickup_fee_waived,
                generator_fee_waived, tax_waived,
                balance_due_cents,
                addresses(line1, city, state, zip),
                order_items(qty, unit_price_cents, units(name)),
                customers(email, first_name, last_name)
              `)
              .eq("id", orderId)
              .maybeSingle();
            const depositCustomer = Array.isArray(depositOrder?.customers) ? depositOrder.customers[0] : depositOrder?.customers;
            if (depositCustomer?.email) {
              const { data: depositBizSettings } = await supabaseClient
                .from("admin_settings")
                .select("key, value")
                .in("key", ["business_name", "business_phone", "logo_url"]);
              const depositBiz: Record<string, string> = {};
              depositBizSettings?.forEach((s: { key: string; value: string | null }) => { if (s.value) depositBiz[s.key] = s.value; });
              await sendDepositReceiptEmail(
                supabaseClient, orderId, depositOrder, depositCustomer, depositBiz,
                amountPaid, depositOnly, tipCents, depositCardBrand, depositCardLast4
              );
            }
          } catch (depositEmailErr) {
            console.warn("[WEBHOOK] Failed to send deposit receipt email:", depositEmailErr);
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
            // All balance financial application goes through apply_balance_payment_financials.
            // The RPC locks the payment row, checks applied flag, applies exactly once, marks done.
            // If no payment row exists yet (pi.succeeded arrived before checkout.session.completed),
            // the RPC returns payment_row_found=false and does nothing — checkout.session.completed
            // or reconcile-balance-payment will insert the row and call the RPC themselves.
            const tipCentsFromMeta = parseInt(paymentIntent.metadata?.tip_cents || "0", 10) || 0;
            const balanceOnlyFromMeta = Math.max(0, amountReceived - tipCentsFromMeta);

            const { data: piApplyRows, error: piApplyErr } = await supabaseClient
              .rpc("apply_balance_payment_financials", {
                p_pi_id: paymentIntent.id,
                p_order_id: orderId,
                p_balance_cents: balanceOnlyFromMeta,
                p_tip_cents: tipCentsFromMeta,
                p_pm_id: paymentMethodId || null,
                p_customer_id: stripeCustomerId || null,
              });

            if (piApplyErr) {
              console.error("[WEBHOOK] pi.succeeded apply_balance_payment_financials failed", { orderId, piId: paymentIntent.id, piApplyErr });
              throw new Error(`apply_balance_payment_financials failed (pi.succeeded): ${piApplyErr.message}`);
            }
            const r = Array.isArray(piApplyRows) ? piApplyRows[0] : piApplyRows;
            if (!r?.payment_row_found) {
              // console.log("[WEBHOOK] pi.succeeded: no payment row yet — checkout.session.completed will apply", { orderId, piId: paymentIntent.id });
            } else {
              // console.log("[WEBHOOK] pi.succeeded RPC result", { orderId, piId: paymentIntent.id, applied: r?.applied });
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
              .select("tip_cents, deposit_paid_cents, stripe_payment_status, status")
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

            const piDepositSafeToAdvance = ["draft", "quote", "pending_review"].includes(depositOrder?.status || "");

            if (!alreadyRecordedByCheckout) {
              const storedTipCents = depositOrder?.tip_cents || 0;
              const depositOnlyFromPI = Math.max(0, amountReceived - storedTipCents);

              const { error: piDepositUpdateError } = await supabaseClient
                .from("orders")
                .update({
                  ...(piDepositSafeToAdvance ? { status: newStatus } : {}),
                  stripe_payment_status: "paid",
                  stripe_payment_method_id: paymentMethodId,
                  stripe_customer_id: stripeCustomerId,
                  deposit_paid_cents: depositOnlyFromPI,
                  ...(paymentBrand ? { payment_method_brand: paymentBrand } : {}),
                  ...(paymentLast4 ? { payment_method_last_four: paymentLast4 } : {}),
                })
                .eq("id", orderId);

              if (piDepositUpdateError) {
                console.error(`[WEBHOOK] Failed to update order ${orderId} for pi deposit:`, piDepositUpdateError);
              } else if (piDepositSafeToAdvance) {
                if (isAdminInvoice) {
                  await invokeLifecycle(supabaseClient, "enter_confirmed", orderId, "webhook_pi_deposit_admin_invoice", "charged_now", "draft");
                } else {
                  await invokeLifecycle(supabaseClient, "enter_pending_review", orderId, "webhook_pi_deposit_standard", undefined, "draft");
                }
              }
            } else {
              // checkout.session.completed already wrote payment/status fields and called lifecycle.
              // Still patch card brand/last4 which the checkout handler does not write.
              if (paymentBrand || paymentLast4) {
                await supabaseClient
                  .from("orders")
                  .update({
                    ...(paymentBrand ? { payment_method_brand: paymentBrand } : {}),
                    ...(paymentLast4 ? { payment_method_last_four: paymentLast4 } : {}),
                  })
                  .eq("id", orderId);
              }
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
            .maybeSingle();

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

          // BPC-SECURITY-HARDENING: verbose dev debug log commented out for production.
          // console.log(`✅ [WEBHOOK] Refund processed: -$${(refundAmountCents / 100).toFixed(2)} for order ${originalPayment.order_id}`);
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

        // BPC-SECURITY-HARDENING: verbose dev debug log commented out for production.
        // console.log(`🔐 [WEBHOOK] SetupIntent succeeded for order ${orderId}`);

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

        // Only advance status if the order is still in an initial state.
        const { data: siCurrentOrder } = await supabaseClient
          .from("orders")
          .select("status")
          .eq("id", orderId)
          .maybeSingle();
        const siSafeToAdvance = ["draft", "quote", "pending_review"].includes(siCurrentOrder?.status || "");

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
            await invokeLifecycle(supabaseClient, "enter_confirmed", orderId, "webhook_setup_intent_admin_invoice", "zero_due_with_card", "draft");
          } else {
            await invokeLifecycle(supabaseClient, "enter_pending_review", orderId, "webhook_setup_intent_standard", undefined, "draft");
          }
        }
        break;
      }

      default:
        // BPC-SECURITY-HARDENING: verbose dev debug log commented out for production.
        // console.log(`ℹ️ [WEBHOOK] Unhandled event type: ${event.type}`);
    }
}

async function sendCheckoutBalanceReceiptEmail(
  supabaseClient: any,
  orderId: string,
  order: any,
  customer: any,
  biz: Record<string, string>,
  amountPaid: number,
  balanceOnly: number,
  tipCents: number,
  paymentBrand: string | null,
  paymentLast4: string | null,
): Promise<void> {
  const shortId = orderId.substring(0, 8).toUpperCase();
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  const businessName = biz.business_name || "Bounce Party Club";
  const businessPhone = biz.business_phone || "(313) 889-3860";
  const logoHtml = biz.logo_url
    ? `<img src="${biz.logo_url}" alt="${businessName}" style="height:60px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
    : "";
  const contactName = customer.first_name ? `${customer.first_name} ${customer.last_name || ""}`.trim() : "Customer";
  const cardText = paymentBrand && paymentLast4
    ? `${paymentBrand.charAt(0).toUpperCase() + paymentBrand.slice(1)} \u2022\u2022\u2022\u2022 ${paymentLast4}`
    : paymentLast4 ? `Card \u2022\u2022\u2022\u2022 ${paymentLast4}` : "Card on file";

  const eventDateStr = order?.event_date
    ? new Date(order.event_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";
  const addr = Array.isArray(order?.addresses) ? order.addresses[0] : order?.addresses;
  const addressStr = addr ? `${addr.line1}, ${addr.city}, ${addr.state}` : "";

  const items: any[] = Array.isArray(order?.order_items) ? order.order_items : [];
  const itemsHtml = items.map((item: any) => {
    const unitName = item.units?.name || "Item";
    const qty = item.qty || 1;
    const price = item.unit_price_cents || 0;
    return `<tr><td style="padding:4px 0;color:#374151;font-size:14px;">${qty}x ${unitName}</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(price * qty)}</td></tr>`;
  }).join("");

  const { data: webhookCustomFees } = await supabaseClient
    .from("order_custom_fees")
    .select("name, amount_cents")
    .eq("order_id", orderId);

  const { data: webhookDiscounts } = await supabaseClient
    .from("order_discounts")
    .select("name, amount_cents, percentage")
    .eq("order_id", orderId);

  const customFees: Array<{ name: string; amount_cents: number }> = webhookCustomFees || [];
  const discounts: Array<{ name: string; amount_cents: number | null; percentage: number | null }> = webhookDiscounts || [];

  const subtotal = order?.subtotal_cents || 0;
  const travelFee = order?.travel_fee_waived ? 0 : (order?.travel_fee_cents || 0);
  const surfaceFee = order?.surface_fee_waived ? 0 : (order?.surface_fee_cents || 0);
  const sameDayFee = order?.same_day_pickup_fee_waived ? 0 : (order?.same_day_pickup_fee_cents || 0);
  const generatorFee = order?.generator_fee_waived ? 0 : (order?.generator_fee_cents || 0);
  const tax = order?.tax_waived ? 0 : (order?.tax_cents || 0);
  const customFeesTotal = customFees.reduce((s, f) => s + (f.amount_cents || 0), 0);
  const discountsTotal = discounts.reduce((s, d) => {
    if (d.percentage && d.percentage > 0) return s + Math.round(subtotal * (d.percentage / 100));
    return s + (d.amount_cents || 0);
  }, 0);
  const total = subtotal + travelFee + surfaceFee + sameDayFee + generatorFee + tax + customFeesTotal - discountsTotal;
  const depositPaid = order?.deposit_paid_cents || 0;
  const newBalanceDue = order?.balance_due_cents ?? 0;

  const feeRowsHtml = [
    travelFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Travel Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(travelFee)}</td></tr>` : "",
    surfaceFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Surface Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(surfaceFee)}</td></tr>` : "",
    sameDayFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Same-Day Pickup Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(sameDayFee)}</td></tr>` : "",
    generatorFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Generator Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(generatorFee)}</td></tr>` : "",
    tax > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tax)}</td></tr>` : "",
    ...customFees.map(f => f.amount_cents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">${f.name}</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(f.amount_cents)}</td></tr>` : ""),
    ...discounts.map(d => {
      const amt = d.percentage && d.percentage > 0 ? Math.round(subtotal * (d.percentage / 100)) : (d.amount_cents || 0);
      return amt > 0 ? `<tr><td style="padding:4px 0;color:#059669;font-size:14px;">${d.name} (discount)</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">-${fmt(amt)}</td></tr>` : "";
    }),
  ].join("");

  const paymentDate = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  const portalUrl = `https://bouncepartyclub.com/customer-portal/${orderId}`;

  const receiptHtml = `<!DOCTYPE html>
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
      <p style="margin:6px 0 0;color:#6b7280;font-size:14px;">Order #${shortId}</p>
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
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:40%;">Order #:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${shortId}</td></tr>
            ${eventDateStr ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${eventDateStr}</td></tr>` : ""}
            ${addressStr ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${addressStr}</td></tr>` : ""}
          </table>
        </td></tr>
      </table>` : ""}
      ${itemsHtml ? `
      <p style="margin:0 0 10px;font-weight:bold;color:#111827;font-size:15px;">Order Items</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">${itemsHtml}</table>` : ""}
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td colspan="2" style="padding:0 0 8px;font-weight:bold;color:#111827;font-size:15px;">Payment Summary</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Subtotal:</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(subtotal)}</td></tr>
        ${feeRowsHtml}
        <tr style="border-top:2px solid #e5e7eb;"><td style="padding:10px 0 4px;font-weight:bold;color:#111827;">Total:</td><td style="padding:10px 0 4px;text-align:right;font-weight:bold;color:#111827;">${fmt(total)}</td></tr>
        ${tipCents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Crew Tip:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">${fmt(tipCents)}</td></tr>` : ""}
        ${depositPaid > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Deposit Paid:</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(depositPaid)}</td></tr>` : ""}
        <tr><td style="padding:4px 0;color:#059669;font-size:14px;font-weight:600;">Balance Payment:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;font-weight:600;">${fmt(balanceOnly)}</td></tr>
        <tr><td style="padding:4px 0;color:#374151;font-weight:600;">Remaining Balance:</td><td style="padding:4px 0;text-align:right;color:#374151;font-weight:600;">${fmt(newBalanceDue)}</td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Payment Receipt</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Method:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${cardText}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Amount Paid:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fmt(amountPaid)}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${paymentDate}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Transaction ID:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${shortId}</td></tr>
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

  const emailResp = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Apikey": Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      },
      body: JSON.stringify({
        to: customer.email,
        subject: `Payment Received - Order #${shortId}`,
        html: receiptHtml,
      }),
    }
  );
  if (!emailResp.ok) {
    const errText = await emailResp.text().catch(() => "");
    console.warn("[WEBHOOK] send-email returned error (non-fatal):", emailResp.status, errText);
  }
}

async function sendDepositReceiptEmail(
  supabaseClient: any,
  orderId: string,
  order: any,
  customer: any,
  biz: Record<string, string>,
  amountPaid: number,
  depositOnly: number,
  tipCents: number,
  cardBrand: string | null,
  cardLast4: string | null,
): Promise<void> {
  const shortId = orderId.substring(0, 8).toUpperCase();
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  const businessName = biz.business_name || "Bounce Party Club";
  const businessPhone = biz.business_phone || "(313) 889-3860";
  const logoHtml = biz.logo_url
    ? `<img src="${biz.logo_url}" alt="${businessName}" style="height:60px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
    : "";
  const contactName = customer.first_name ? `${customer.first_name} ${customer.last_name || ""}`.trim() : "Customer";
  const cardText = cardBrand && cardLast4
    ? `${cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1)} \u2022\u2022\u2022\u2022 ${cardLast4}`
    : cardLast4 ? `Card \u2022\u2022\u2022\u2022 ${cardLast4}` : "Card on file";

  const eventDateStr = order?.event_date
    ? new Date(order.event_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";
  const addr = Array.isArray(order?.addresses) ? order.addresses[0] : order?.addresses;
  const addressStr = addr ? `${addr.line1}, ${addr.city}, ${addr.state}` : "";

  const items: any[] = Array.isArray(order?.order_items) ? order.order_items : [];
  const itemsHtml = items.map((item: any) => {
    const unitName = item.units?.name || "Item";
    const qty = item.qty || 1;
    const price = item.unit_price_cents || 0;
    return `<tr><td style="padding:4px 0;color:#374151;font-size:14px;">${qty}x ${unitName}</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(price * qty)}</td></tr>`;
  }).join("");

  const { data: depositCustomFees } = await supabaseClient
    .from("order_custom_fees").select("name, amount_cents").eq("order_id", orderId);
  const { data: depositDiscounts } = await supabaseClient
    .from("order_discounts").select("name, amount_cents, percentage").eq("order_id", orderId);
  const customFees: Array<{ name: string; amount_cents: number }> = depositCustomFees || [];
  const discounts: Array<{ name: string; amount_cents: number | null; percentage: number | null }> = depositDiscounts || [];

  const subtotal = order?.subtotal_cents || 0;
  const travelFee = order?.travel_fee_waived ? 0 : (order?.travel_fee_cents || 0);
  const surfaceFee = order?.surface_fee_waived ? 0 : (order?.surface_fee_cents || 0);
  const sameDayFee = order?.same_day_pickup_fee_waived ? 0 : (order?.same_day_pickup_fee_cents || 0);
  const generatorFee = order?.generator_fee_waived ? 0 : (order?.generator_fee_cents || 0);
  const tax = order?.tax_waived ? 0 : (order?.tax_cents || 0);
  const customFeesTotal = customFees.reduce((s, f) => s + (f.amount_cents || 0), 0);
  const discountsTotal = discounts.reduce((s, d) => {
    if (d.percentage && d.percentage > 0) return s + Math.round(subtotal * (d.percentage / 100));
    return s + (d.amount_cents || 0);
  }, 0);
  const total = subtotal + travelFee + surfaceFee + sameDayFee + generatorFee + tax + customFeesTotal - discountsTotal;
  const balanceDueAfter = order?.balance_due_cents ?? 0;

  const feeRowsHtml = [
    travelFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Travel Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(travelFee)}</td></tr>` : "",
    surfaceFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Surface Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(surfaceFee)}</td></tr>` : "",
    sameDayFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Same-Day Pickup Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(sameDayFee)}</td></tr>` : "",
    generatorFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Generator Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(generatorFee)}</td></tr>` : "",
    tax > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tax)}</td></tr>` : "",
    ...customFees.map(f => f.amount_cents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">${f.name}</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(f.amount_cents)}</td></tr>` : ""),
    ...discounts.map(d => {
      const amt = d.percentage && d.percentage > 0 ? Math.round(subtotal * (d.percentage / 100)) : (d.amount_cents || 0);
      return amt > 0 ? `<tr><td style="padding:4px 0;color:#059669;font-size:14px;">${d.name} (discount)</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">-${fmt(amt)}</td></tr>` : "";
    }),
  ].join("");

  const paymentDate = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  const portalUrl = `https://bouncepartyclub.com/customer-portal/${orderId}`;

  const receiptHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #d1fae5;">
  <tr>
    <td align="center" style="padding:24px 40px 16px;border-bottom:2px solid #d1fae5;">
      ${logoHtml}
      <h1 style="margin:0;color:#059669;font-size:26px;font-weight:bold;">Deposit Received!</h1>
      <p style="margin:6px 0 0;color:#6b7280;font-size:14px;">Order #${shortId}</p>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 40px 8px;">
      <p style="margin:0 0 6px;color:#374151;font-size:15px;">Hi ${contactName},</p>
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">Your deposit has been received. Here's your receipt.</p>
      ${eventDateStr || addressStr ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Event Details</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:40%;">Order #:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${shortId}</td></tr>
            ${eventDateStr ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${eventDateStr}</td></tr>` : ""}
            ${addressStr ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${addressStr}</td></tr>` : ""}
          </table>
        </td></tr>
      </table>` : ""}
      ${itemsHtml ? `
      <p style="margin:0 0 10px;font-weight:bold;color:#111827;font-size:15px;">Order Items</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">${itemsHtml}</table>` : ""}
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td colspan="2" style="padding:0 0 8px;font-weight:bold;color:#111827;font-size:15px;">Payment Summary</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Subtotal:</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(subtotal)}</td></tr>
        ${feeRowsHtml}
        <tr style="border-top:2px solid #e5e7eb;"><td style="padding:10px 0 4px;font-weight:bold;color:#111827;">Total:</td><td style="padding:10px 0 4px;text-align:right;font-weight:bold;color:#111827;">${fmt(total)}</td></tr>
        ${tipCents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Crew Tip:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">${fmt(tipCents)}</td></tr>` : ""}
        <tr><td style="padding:4px 0;color:#059669;font-size:14px;font-weight:600;">Deposit Paid:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;font-weight:600;">${fmt(depositOnly)}</td></tr>
        <tr><td style="padding:4px 0;color:#374151;font-weight:600;">Remaining Balance:</td><td style="padding:4px 0;text-align:right;color:#374151;font-weight:600;">${fmt(balanceDueAfter)}</td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Payment Receipt</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Method:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${cardText}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Amount Paid:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fmt(amountPaid)}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${paymentDate}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Transaction ID:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${shortId}</td></tr>
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

  const depositEmailResp = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Apikey": Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      },
      body: JSON.stringify({
        to: customer.email,
        subject: `Deposit Received - Order #${shortId}`,
        html: receiptHtml,
      }),
    }
  );
  if (!depositEmailResp.ok) {
    const errText = await depositEmailResp.text().catch(() => "");
    console.warn("[WEBHOOK] send-deposit-email returned error (non-fatal):", depositEmailResp.status, errText);
  }
}

async function invokeLifecycle(
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
    } else if (data && data.alreadySent) {
      // normal idempotent path — no log needed
    } else if (data && !data.success) {
      console.error(`[WEBHOOK] order-lifecycle returned success=false: action=${action} orderId=${orderId} error=${data.error}`);
    }
  } catch (err) {
    console.error(`[WEBHOOK] order-lifecycle invoke threw (non-fatal): action=${action} orderId=${orderId}`, err);
  }
}
