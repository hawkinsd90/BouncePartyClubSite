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
    // Admin endpoint - authenticate first
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
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: userRole } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (!userRole || (userRole.role !== "ADMIN" && userRole.role !== "MASTER")) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Rate limit using authenticated user ID + IP
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
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    const { orderId, amountCents, reason }: RefundRequest = await req.json();

    if (!orderId || !amountCents || amountCents <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid request. orderId and positive amountCents required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get order and find successful payments
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
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Find the most recent payment intent with sufficient funds
    let paymentIntent: Stripe.PaymentIntent | null = null;
    let selectedPayment = null;

    for (const payment of payments) {
      try {
        const pi = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);
        if (pi.status === "succeeded" && pi.amount >= amountCents) {
          paymentIntent = pi;
          selectedPayment = payment;
          break;
        }
      } catch (err) {
        console.error(`Error retrieving payment intent ${payment.stripe_payment_intent_id}:`, err);
      }
    }

    if (!paymentIntent || !selectedPayment) {
      return new Response(
        JSON.stringify({ error: "No eligible payment found to refund" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create the refund
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntent.id,
      amount: amountCents,
      reason: reason === "duplicate" ? "duplicate" : reason === "fraudulent" ? "fraudulent" : "requested_by_customer",
      metadata: {
        order_id: orderId,
        refunded_by: user.id,
      },
    });

    // Record the refund in database
    const { data: refundRecord, error: refundError } = await supabaseClient
      .from("order_refunds")
      .insert({
        order_id: orderId,
        amount_cents: amountCents,
        reason: reason || "Admin refund",
        stripe_refund_id: refund.id,
        refunded_by: user.id,
        status: refund.status === "succeeded" ? "succeeded" : "pending",
      })
      .select()
      .single();

    if (refundError) {
      console.error("Error recording refund:", refundError);
    }

    // Update order's total_refunded_cents
    const { data: order } = await supabaseClient
      .from("orders")
      .select("total_refunded_cents")
      .eq("id", orderId)
      .single();

    if (order) {
      await supabaseClient
        .from("orders")
        .update({
          total_refunded_cents: (order.total_refunded_cents || 0) + amountCents,
        })
        .eq("id", orderId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        refund: {
          id: refund.id,
          amount: refund.amount,
          status: refund.status,
        },
        refundRecord,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Stripe refund error:", error);
    const message = error instanceof Error ? error.message : "Failed to process refund";
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
