import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.14.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-10-28.acacia",
});

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
        console.error(\`Error retrieving payment intent \${payment.stripe_payment_intent_id}:\`, err);
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
  } catch (error: any) {
    console.error("Stripe refund error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to process refund" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
