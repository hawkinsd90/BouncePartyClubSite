import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.14.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import { validatePaymentMethod } from "../_shared/payment-validation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ChargeRequest {
  orderId: string;
  amountCents: number;
  paymentType: "balance" | "damage";
  description: string;
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

    if (!userRole || userRole.role !== "ADMIN") {
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
    const identifier = buildRateLimitKey(ip, user.id, 'charge');
    const rateLimitResult = await checkRateLimit('stripe-charge', identifier);

    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    const { orderId, amountCents, paymentType, description }: ChargeRequest =
      await req.json();

    if (!orderId || !amountCents || !paymentType) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
      return new Response(
        JSON.stringify({ error: "No payment method on file" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
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

    const validation = await validatePaymentMethod(order.stripe_payment_method_id, stripe);

    if (!validation.valid) {
      return new Response(
        JSON.stringify({
          error: validation.reason,
          needsNewCard: validation.needsNewCard
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (validation.expMonth && validation.expYear && validation.last4) {
      await supabaseClient
        .from("orders")
        .update({
          payment_method_validated_at: new Date().toISOString(),
          payment_method_exp_month: validation.expMonth,
          payment_method_exp_year: validation.expYear,
          payment_method_last_four: validation.last4,
        })
        .eq("id", orderId);
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: order.stripe_customer_id,
      payment_method: order.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      description: description || `${paymentType} charge for order ${orderId}`,
      metadata: {
        order_id: orderId,
        payment_type: paymentType,
      },
    });

    // Extract payment method details
    let paymentMethodType: string | null = null;
    let paymentBrand: string | null = null;
    let paymentLast4: string | null = null;

    if (order.stripe_payment_method_id) {
      try {
        const pm = await stripe.paymentMethods.retrieve(order.stripe_payment_method_id);
        paymentMethodType = pm.type || null;
        if (pm.card) {
          paymentBrand = pm.card.brand || null;
          paymentLast4 = pm.card.last4 || null;
        }
      } catch (err) {
        console.error("Error retrieving payment method:", err);
      }
    }

    const { data: payment } = await supabaseClient.from("payments").insert({
      order_id: orderId,
      stripe_payment_intent_id: paymentIntent.id,
      stripe_payment_method_id: order.stripe_payment_method_id,
      amount_cents: amountCents,
      payment_type: paymentType,
      status: paymentIntent.status === "succeeded" ? "succeeded" : "pending",
      description: description || `${paymentType} charge`,
      payment_method: paymentMethodType,
      payment_brand: paymentBrand,
      payment_last4: paymentLast4,
    }).select().single();

    if (paymentIntent.status === "succeeded") {
      const updateField = paymentType === "balance" ? "balance_paid_cents" : "damage_charged_cents";
      await supabaseClient
        .from("orders")
        .update({ [updateField]: (order[updateField] || 0) + amountCents })
        .eq("id", orderId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        payment,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Stripe charge error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});