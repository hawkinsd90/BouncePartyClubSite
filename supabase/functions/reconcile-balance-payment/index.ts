import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { logTransaction } from "../_shared/transaction-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-10-28.acacia",
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { sessionId, orderId } = await req.json();

    if (!sessionId || !orderId) {
      return new Response(
        JSON.stringify({ error: "Missing sessionId or orderId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Retrieve session from Stripe with expanded payment_intent
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "payment_intent.payment_method", "payment_intent.latest_charge"],
    });

    // Verify this session belongs to the claimed order
    if (session.metadata?.order_id !== orderId) {
      return new Response(
        JSON.stringify({ reconciled: false, reason: "session_order_mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only act if Stripe confirms the payment succeeded
    if (session.payment_status !== "paid") {
      return new Response(
        JSON.stringify({ reconciled: false, reason: "payment_not_complete", payment_status: session.payment_status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pi = session.payment_intent as Stripe.PaymentIntent | null;
    const piId = pi?.id ?? null;

    // Idempotency: skip if a payment row already exists for this PaymentIntent
    if (piId) {
      const { data: existing } = await supabaseClient
        .from("payments")
        .select("id")
        .eq("stripe_payment_intent_id", piId)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ reconciled: false, reason: "already_processed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Extract payment method details
    const pm = pi?.payment_method as Stripe.PaymentMethod | null;
    const paymentMethodType = pm?.type ?? null;
    const paymentBrand = pm?.card?.brand ?? null;
    const paymentLast4 = pm?.card?.last4 ?? null;
    const paymentMethodId = typeof pi?.payment_method === "string" ? pi.payment_method : pm?.id ?? null;

    // Extract charge and Stripe fee
    const latestCharge = pi?.latest_charge as Stripe.Charge | null;
    const latestChargeId = latestCharge?.id ?? null;
    const currency = latestCharge?.currency ?? "usd";
    let stripeFee = 0;
    let stripeNet = session.amount_total ?? 0;

    if (latestChargeId) {
      try {
        const charge = await stripe.charges.retrieve(latestChargeId, {
          expand: ["balance_transaction"],
        });
        const bt = charge.balance_transaction;
        if (bt && typeof bt === "object") {
          stripeFee = (bt as Stripe.BalanceTransaction).fee ?? 0;
          stripeNet = (bt as Stripe.BalanceTransaction).net ?? stripeNet;
        }
      } catch (_) {}
    }

    const amountPaid = session.amount_total ?? 0;
    const rawTip = parseInt(session.metadata?.tip_cents ?? "0", 10);
    const safeTipCents = Number.isFinite(rawTip) ? rawTip : 0;
    const balanceOnly = Math.max(0, amountPaid - safeTipCents);

    const stripeCustomerId =
      typeof session.customer === "string" ? session.customer : (session.customer as Stripe.Customer | null)?.id ?? null;

    // Fetch current order fields needed for accumulation
    const { data: order } = await supabaseClient
      .from("orders")
      .select("customer_id, tip_cents, balance_paid_cents, balance_due_cents")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const existingTip = order.tip_cents ?? 0;
    const existingBalancePaid = order.balance_paid_cents ?? 0;
    const existingBalanceDue = order.balance_due_cents ?? 0;
    const newBalanceDue = Math.max(0, existingBalanceDue - balanceOnly);

    // Update order
    await supabaseClient
      .from("orders")
      .update({
        ...(paymentMethodId ? { stripe_payment_method_id: paymentMethodId } : {}),
        ...(stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : {}),
        balance_paid_cents: existingBalancePaid + balanceOnly,
        balance_due_cents: newBalanceDue,
        ...(safeTipCents > 0 ? { tip_cents: existingTip + safeTipCents } : {}),
      })
      .eq("id", orderId);

    // Insert payment record
    let paymentRecordId: string | null = null;
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
        currency,
      })
      .select("id")
      .single();

    paymentRecordId = paymentRecord?.id ?? null;

    // Log transaction receipt
    if (paymentRecordId) {
      await logTransaction(supabaseClient, {
        transactionType: "balance",
        orderId,
        customerId: order.customer_id,
        paymentId: paymentRecordId,
        amountCents: amountPaid,
        paymentMethod: paymentMethodType,
        paymentMethodBrand: paymentBrand,
        stripeChargeId: latestChargeId,
        stripePaymentIntentId: piId,
        notes: "Balance payment reconciled on portal return (webhook fallback)",
      });
    }

    return new Response(
      JSON.stringify({ reconciled: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[reconcile-balance-payment] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
