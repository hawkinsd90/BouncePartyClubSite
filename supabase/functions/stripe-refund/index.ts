import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RefundRequest {
  orderId: string;
  amountCents: number;
  reason: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: userRole } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (!userRole || (userRole.role !== "admin" && userRole.role !== "master")) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ip = getIdentifier(req);
    const identifier = buildRateLimitKey(ip, user.id, 'refund');
    const rateLimitResult = await checkRateLimit('stripe-refund', identifier);

    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

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

    const { orderId, amountCents, reason }: RefundRequest = await req.json();

    if (!orderId || !amountCents || amountCents <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid request. orderId and positive amountCents required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate order exists
    const { data: orderData, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, status")
      .eq("id", orderId)
      .single();

    if (orderError || !orderData) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (orderData.status !== "cancelled") {
      console.warn(`Refund issued for non-cancelled order ${orderId}, status: ${orderData.status}`);
    }

    // Server-side over-refund prevention: treat both succeeded AND pending refunds as consumed
    const { data: existingRefunds } = await supabaseClient
      .from("order_refunds")
      .select("amount_cents")
      .eq("order_id", orderId)
      .in("status", ["succeeded", "pending"]);

    const alreadyReservedCents = (existingRefunds ?? []).reduce(
      (sum: number, r: { amount_cents: number }) => sum + r.amount_cents,
      0
    );

    // Get succeeded Stripe payments for this order (newest first for allocation)
    const { data: payments, error: paymentsError } = await supabaseClient
      .from("payments")
      .select("*")
      .eq("order_id", orderId)
      .eq("status", "succeeded")
      .not("stripe_payment_intent_id", "is", null)
      .order("created_at", { ascending: false });

    if (paymentsError || !payments || payments.length === 0) {
      return new Response(
        JSON.stringify({ error: "No successful Stripe payments found for this order" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const totalCapturedCents = payments.reduce(
      (sum: number, p: { amount_cents: number }) => sum + p.amount_cents,
      0
    );
    const maxRefundableCents = totalCapturedCents - alreadyReservedCents;

    if (amountCents > maxRefundableCents) {
      return new Response(
        JSON.stringify({
          error: `Refund amount exceeds maximum refundable amount. Max: ${maxRefundableCents} cents`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripeReason =
      reason === "duplicate" ? "duplicate"
      : reason === "fraudulent" ? "fraudulent"
      : "requested_by_customer";

    // Multi-payment allocation: allocate the refund across payments newest-first.
    // For each PI, query Stripe's refunds API directly to get accurately how much
    // has already been refunded (avoids relying on charge.amount_refunded which
    // requires expanding charges, deprecated in newer API versions).
    let remainingToRefund = amountCents;
    const createdRefunds: Stripe.Refund[] = [];

    for (const payment of payments) {
      if (remainingToRefund <= 0) break;

      let pi: Stripe.PaymentIntent;
      try {
        pi = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);
      } catch (err) {
        console.error(`Error retrieving PI ${payment.stripe_payment_intent_id}:`, err);
        continue;
      }

      if (pi.status !== "succeeded") continue;

      // Get all non-failed/non-canceled refunds on this PI from Stripe directly.
      let piAlreadyRefunded = 0;
      try {
        const stripeRefundsList = await stripe.refunds.list({
          payment_intent: pi.id,
          limit: 100,
        });
        piAlreadyRefunded = stripeRefundsList.data
          .filter((r: Stripe.Refund) => r.status !== "failed" && r.status !== "canceled")
          .reduce((sum: number, r: Stripe.Refund) => sum + r.amount, 0);
      } catch (err) {
        console.error(`Error listing refunds for PI ${pi.id}:`, err);
        // Do not assume 0 — skip this PI if we cannot verify its refundable amount.
        continue;
      }

      const piRefundable = pi.amount - piAlreadyRefunded;
      if (piRefundable <= 0) continue;

      const refundThisPI = Math.min(remainingToRefund, piRefundable);

      const refund = await stripe.refunds.create({
        payment_intent: pi.id,
        amount: refundThisPI,
        reason: stripeReason,
        metadata: {
          order_id: orderId,
          refunded_by: user.id,
        },
      });

      createdRefunds.push(refund);
      remainingToRefund -= refundThisPI;
    }

    if (createdRefunds.length === 0) {
      return new Response(
        JSON.stringify({ error: "No eligible payment found to refund" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert one order_refunds row per Stripe refund object created.
    // If this insert fails, the Stripe refunds already exist — return a specific
    // error so the caller knows manual reconciliation is required. Never silently
    // report success when the DB record is missing.
    const refundRows = createdRefunds.map(r => ({
      order_id: orderId,
      amount_cents: r.amount,
      reason: reason || "Admin refund",
      stripe_refund_id: r.id,
      refunded_by: user.id,
      status: r.status === "succeeded" ? "succeeded" : "pending",
    }));

    const { data: refundRecords, error: refundError } = await supabaseClient
      .from("order_refunds")
      .insert(refundRows)
      .select();

    if (refundError || !refundRecords?.length) {
      console.error("CRITICAL: Stripe refunds created but DB recording failed:", refundError);
      return new Response(
        JSON.stringify({
          success: false,
          stripeRefundsCreated: createdRefunds.map(r => ({ id: r.id, amount: r.amount, status: r.status })),
          error: "Stripe refund(s) were processed but could not be recorded in the database. Manual reconciliation required.",
        }),
        { status: 207, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only update order total after successful DB insert.
    const actualRefunded = amountCents - remainingToRefund;
    const { error: rpcError } = await supabaseClient.rpc("increment_order_refunded_cents", {
      p_order_id: orderId,
      p_amount_cents: actualRefunded,
    });

    if (rpcError) {
      console.error("Warning: refund recorded but order total update failed:", rpcError);
      return new Response(
        JSON.stringify({
          success: true,
          warning: "Refund processed and recorded, but order total_refunded_cents could not be updated. Totals may be temporarily out of sync.",
          refunds: createdRefunds.map(r => ({ id: r.id, amount: r.amount, status: r.status })),
          refundRecords,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        refunds: createdRefunds.map(r => ({ id: r.id, amount: r.amount, status: r.status })),
        refundRecords,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Stripe refund error:", error);
    const message = error instanceof Error ? error.message : "Failed to process refund";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
