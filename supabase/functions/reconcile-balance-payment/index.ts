/**
 * RECONCILE BALANCE PAYMENT - Supabase Edge Function
 *
 * Called after a customer returns from Stripe Checkout (Path B balance payment).
 * Verifies the session directly with Stripe and idempotently writes any DB state
 * that the webhook may not have written yet.
 *
 * Race-safety model:
 * ─────────────────
 * The payments table has a unique constraint on stripe_payment_intent_id.
 * This function inserts the payment row FIRST (before any order mutation).
 * Whichever concurrent writer (reconcile or webhook) inserts first wins the
 * constraint and proceeds to update order totals and log the receipt.
 * The loser receives a 23505 unique-violation, detects it, and returns
 * { alreadyReconciled: true } without touching order totals.
 *
 * This guarantees:
 * - Exactly one writer increments balance_paid_cents / decrements balance_due_cents
 * - Exactly one payment row exists per PaymentIntent
 * - Exactly one transaction receipt exists per PaymentIntent
 * - Safe to call multiple times; all calls after the first are no-ops
 */

import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ReconcileRequest {
  sessionId: string;
  orderId: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const body: ReconcileRequest = await req.json();
    const { sessionId, orderId } = body;

    if (!sessionId || !orderId) {
      return new Response(
        JSON.stringify({ error: "sessionId and orderId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: stripeKeyData } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (!stripeKeyData?.value) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    // ── 1. Verify session with Stripe ──────────────────────────────────────────
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent", "payment_intent.payment_method"],
      });
    } catch (err) {
      console.error("[reconcile-balance-payment] Failed to retrieve session:", err);
      return new Response(
        JSON.stringify({ error: "Failed to retrieve Stripe session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Validate session is authoritative paid balance for this order ───────
    if (session.mode !== "payment") {
      return new Response(
        JSON.stringify({ error: "Session is not a payment mode session" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (session.payment_status !== "paid") {
      return new Response(
        JSON.stringify({ success: false, reason: "payment_not_complete", payment_status: session.payment_status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sessionOrderId = session.metadata?.order_id;
    const paymentType = session.metadata?.payment_type;

    if (sessionOrderId !== orderId) {
      console.error(`[reconcile-balance-payment] Order ID mismatch: session=${sessionOrderId} request=${orderId}`);
      return new Response(
        JSON.stringify({ error: "Order ID mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (paymentType !== "balance") {
      return new Response(
        JSON.stringify({ error: "Session is not a balance payment" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Extract PaymentIntent details ──────────────────────────────────────
    const pi = session.payment_intent as Stripe.PaymentIntent | null;
    if (!pi || typeof pi !== "object") {
      return new Response(
        JSON.stringify({ error: "No PaymentIntent on session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const piId = pi.id;
    const amountPaid = session.amount_total || 0;
    const tipCentsStr = session.metadata?.tip_cents || "0";
    const safeTipCents = Math.max(0, parseInt(tipCentsStr, 10) || 0);
    const balanceOnly = Math.max(0, amountPaid - safeTipCents);

    const stripeCustomerId =
      typeof session.customer === "string"
        ? session.customer
        : (session.customer as any)?.id || null;

    // Extract payment method details from expanded PI
    let paymentMethodType: string | null = null;
    let paymentBrand: string | null = null;
    let paymentLast4: string | null = null;
    let expandedPmId: string | null = null;

    const pmObj = pi.payment_method;
    if (pmObj && typeof pmObj === "object") {
      paymentMethodType = (pmObj as any).type || null;
      expandedPmId = (pmObj as any).id || null;
      if ((pmObj as any).card) {
        paymentBrand = (pmObj as any).card.brand || null;
        paymentLast4 = (pmObj as any).card.last4 || null;
      }
    }

    // Fetch fee details from charge
    let stripeFee = 0;
    let stripeNet = amountPaid;
    let latestChargeId: string | null = null;

    try {
      const latestCharge = pi.latest_charge;
      latestChargeId = typeof latestCharge === "string"
        ? latestCharge
        : (latestCharge as any)?.id || null;

      if (latestChargeId) {
        const charge = await stripe.charges.retrieve(latestChargeId, {
          expand: ["balance_transaction"],
        });
        const balanceTx = charge.balance_transaction;
        if (balanceTx && typeof balanceTx === "object") {
          stripeFee = (balanceTx as any).fee || 0;
          stripeNet = (balanceTx as any).net || amountPaid;
        }
      }
    } catch (err) {
      console.warn("[reconcile-balance-payment] Could not fetch charge fee details:", err);
    }

    // ── 4. RACE-SAFE: Insert payment row FIRST ─────────────────────────────────
    // The unique constraint on stripe_payment_intent_id is our mutex.
    // If this insert succeeds → we won the race and own all subsequent writes.
    // If it fails with 23505 (unique violation) → webhook or prior call already
    //   won; return alreadyReconciled without touching order totals.
    // Any other insert error → propagate as 500.
    const { data: paymentRecord, error: paymentInsertError } = await supabaseClient
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
        currency: "usd",
      })
      .select("id")
      .maybeSingle();

    if (paymentInsertError) {
      // 23505 = unique_violation: another writer (webhook or prior reconcile call) already owns this PI.
      // Do NOT update order totals — they were (or will be) written by the winner.
      if (paymentInsertError.code === "23505") {
        // Patch non-financial fields only (safe because they are idempotent)
        if (expandedPmId || stripeCustomerId) {
          await supabaseClient
            .from("orders")
            .update({
              ...(expandedPmId ? { stripe_payment_method_id: expandedPmId } : {}),
              ...(stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : {}),
            })
            .eq("id", orderId);
        }
        return new Response(
          JSON.stringify({ success: true, alreadyReconciled: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.error("[reconcile-balance-payment] Payment insert failed:", paymentInsertError);
      return new Response(
        JSON.stringify({ error: "Failed to insert payment record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 5. We won the race — now safely update order totals ───────────────────
    // Read current values immediately after winning the insert so we accumulate correctly.
    const { data: currentOrder } = await supabaseClient
      .from("orders")
      .select("balance_paid_cents, balance_due_cents, tip_cents, customer_id")
      .eq("id", orderId)
      .maybeSingle();

    if (!currentOrder) {
      console.error("[reconcile-balance-payment] Order not found after winning payment insert:", orderId);
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const existingBalancePaid = currentOrder.balance_paid_cents || 0;
    const existingBalanceDue = currentOrder.balance_due_cents || 0;
    const existingTip = currentOrder.tip_cents || 0;
    const newBalancePaid = existingBalancePaid + balanceOnly;
    const newBalanceDue = Math.max(0, existingBalanceDue - balanceOnly);

    const { error: orderUpdateError } = await supabaseClient
      .from("orders")
      .update({
        balance_paid_cents: newBalancePaid,
        balance_due_cents: newBalanceDue,
        ...(safeTipCents > 0 ? { tip_cents: existingTip + safeTipCents } : {}),
        ...(expandedPmId ? { stripe_payment_method_id: expandedPmId } : {}),
        ...(stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : {}),
      })
      .eq("id", orderId);

    if (orderUpdateError) {
      console.error("[reconcile-balance-payment] Failed to update order:", orderUpdateError);
      // Payment row is already committed — return partial success so the
      // webhook (which will see the existing payment row and skip) does not
      // inadvertently overwrite with stale data.
      return new Response(
        JSON.stringify({ error: "Order update failed after payment insert" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 6. Log transaction receipt (idempotent via unique PI id constraint) ────
    if (paymentRecord && currentOrder.customer_id) {
      try {
        await supabaseClient
          .from("transaction_receipts")
          .insert({
            transaction_type: "balance",
            order_id: orderId,
            customer_id: currentOrder.customer_id,
            payment_id: paymentRecord.id,
            amount_cents: amountPaid,
            payment_method: paymentMethodType,
            payment_method_brand: paymentBrand,
            stripe_charge_id: latestChargeId,
            stripe_payment_intent_id: piId,
            notes: safeTipCents > 0
              ? `Balance payment ($${(balanceOnly / 100).toFixed(2)}) + tip ($${(safeTipCents / 100).toFixed(2)}) via Stripe Checkout`
              : "Customer portal balance payment via Stripe Checkout",
          });
      } catch (receiptErr: any) {
        // 23505 means webhook already inserted receipt — non-fatal; payment row is committed
        if (receiptErr?.code !== "23505") {
          console.warn("[reconcile-balance-payment] Failed to insert transaction receipt:", receiptErr);
        }
      }
    }

    console.log(`[reconcile-balance-payment] Reconciled payment for order ${orderId}, PI ${piId}`);

    return new Response(
      JSON.stringify({ success: true, alreadyReconciled: false }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[reconcile-balance-payment] Fatal error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
