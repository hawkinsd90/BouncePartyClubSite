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

    // ── 4. RACE-SAFE + REPAIR-SAFE: Insert payment row FIRST ──────────────────
    // The unique constraint on stripe_payment_intent_id is our distributed mutex.
    //
    // order_financials_applied starts FALSE. The winner sets it TRUE only after
    // the order UPDATE succeeds. On 23505, the caller reads the flag:
    //   TRUE  → financial work is complete; skip safely (idempotent)
    //   FALSE → prior winner partially failed (order UPDATE crashed); this caller
    //            performs the repair, then marks the flag TRUE.
    //
    // This guarantees: even after a partial failure, the next retry (reconcile or
    // webhook) automatically repairs stale order totals — without double-writing.
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
        order_financials_applied: false,
      })
      .select("id")
      .maybeSingle();

    if (paymentInsertError) {
      if (paymentInsertError.code === "23505") {
        // Another writer already inserted this PI's payment row (webhook or a prior reconcile).
        // Call the same atomic RPC — it will lock the row, check the applied flag, and apply
        // financials exactly once if not yet done. Identical to the winner path below.
        console.warn("[reconcile-balance-payment] 23505 on insert — delegating to RPC", { orderId, piId });
        const { data: repairRows, error: repairErr } = await supabaseClient
          .rpc("apply_balance_payment_financials", {
            p_pi_id: piId,
            p_order_id: orderId,
            p_balance_cents: balanceOnly,
            p_tip_cents: safeTipCents,
            p_pm_id: expandedPmId || null,
            p_customer_id: stripeCustomerId || null,
          });
        if (repairErr) {
          console.error("[reconcile-balance-payment] apply_balance_payment_financials failed on 23505 path", { orderId, piId, repairErr });
        } else {
          const r = Array.isArray(repairRows) ? repairRows[0] : repairRows;
          console.log("[reconcile-balance-payment] 23505 RPC result", { orderId, piId, applied: r?.applied, payment_row_found: r?.payment_row_found });
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

    // ── 5. We inserted the row — apply order financials through the atomic RPC ─
    // The RPC locks the payment row we just inserted, verifies applied=false,
    // reads+updates order totals, and marks applied=true — all in one transaction.
    // This prevents any concurrent caller (pi.succeeded, a second reconcile) from
    // racing with us: they will block on the row lock until we commit, then see
    // applied=true and skip.
    const { data: applyRows, error: applyErr } = await supabaseClient
      .rpc("apply_balance_payment_financials", {
        p_pi_id: piId,
        p_order_id: orderId,
        p_balance_cents: balanceOnly,
        p_tip_cents: safeTipCents,
        p_pm_id: expandedPmId || null,
        p_customer_id: stripeCustomerId || null,
      });

    if (applyErr) {
      console.error("[reconcile-balance-payment] apply_balance_payment_financials failed", { orderId, piId, applyErr });
      // Payment row is committed with order_financials_applied=FALSE.
      // Next retry (reconcile or webhook pi.succeeded) will call the RPC and repair.
      return new Response(
        JSON.stringify({ error: "Order financial update failed after payment insert" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const applyResult = Array.isArray(applyRows) ? applyRows[0] : applyRows;
    console.log("[reconcile-balance-payment] RPC applied financials", { orderId, piId, applied: applyResult?.applied });

    // Fetch customer_id for receipt logging (order already updated by RPC)
    const { data: currentOrder } = await supabaseClient
      .from("orders")
      .select("customer_id")
      .eq("id", orderId)
      .maybeSingle();

    // ── 6. Log transaction receipt (idempotent via unique PI id constraint) ────
    if (paymentRecord && currentOrder?.customer_id) {
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
