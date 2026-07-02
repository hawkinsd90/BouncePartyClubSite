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
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
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

    // DB stores roles lowercase: "admin", "master"
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

    // Server-side over-refund prevention: compute already-refunded amount
    const { data: existingRefunds } = await supabaseClient
      .from("order_refunds")
      .select("amount_cents")
      .eq("order_id", orderId)
      .eq("status", "succeeded");

    const alreadyRefundedCents = (existingRefunds ?? []).reduce(
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
    const maxRefundableCents = totalCapturedCents - alreadyRefundedCents;

    if (amountCents > maxRefundableCents) {
      return new Response(
        JSON.stringify({
          error: `Refund amount exceeds maximum refundable amount. Max: ${maxRefundableCents} cents`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Multi-payment allocation: allocate the refund across payments newest-first.
    // For each payment intent, refund up to what remains on that PI.
    const stripeReason =
      reason === "duplicate" ? "duplicate"
      : reason === "fraudulent" ? "fraudulent"
      : "requested_by_customer";

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

      // How much has already been refunded on this specific PI via Stripe?
      const piAlreadyRefunded = pi.charges?.data?.[0]?.amount_refunded ?? 0;
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

    // Insert one order_refunds row per Stripe refund object
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

    if (refundError) {
      console.error("Error recording refunds:", refundError);
    }

    // Safely update total_refunded_cents using actual DB value to avoid race conditions
    const actualRefunded = amountCents - remainingToRefund;
    await supabaseClient.rpc("increment_order_refunded_cents", {
      p_order_id: orderId,
      p_amount_cents: actualRefunded,
    });

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
