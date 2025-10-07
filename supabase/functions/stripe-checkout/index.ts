import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.14.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CheckoutRequest {
  orderId: string;
  depositCents: number;
  customerEmail: string;
  customerName: string;
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
    );

    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured. Please add your Stripe secret key in Admin Settings." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    const { orderId, depositCents, customerEmail, customerName }: CheckoutRequest =
      await req.json();

    if (!depositCents || !customerEmail) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if this is a real order or a temporary one
    const isRealOrder = orderId && !orderId.startsWith('temp_');
    let customerId: string | null = null;

    if (isRealOrder) {
      // Look up existing order to get customer ID if available
      const { data: order } = await supabaseClient
        .from("orders")
        .select("stripe_customer_id")
        .eq("id", orderId)
        .maybeSingle();

      customerId = order?.stripe_customer_id || null;
    }

    // Create or reuse Stripe customer
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        metadata: isRealOrder ? { order_id: orderId } : {},
      });
      customerId = customer.id;

      // If real order, update it with customer ID
      if (isRealOrder) {
        await supabaseClient
          .from("orders")
          .update({ stripe_customer_id: customerId })
          .eq("id", orderId);
      }
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: depositCents,
      currency: "usd",
      customer: customerId,
      description: isRealOrder ? `Deposit for order ${orderId}` : "Bounce Party Club deposit",
      setup_future_usage: "off_session",
      metadata: isRealOrder ? {
        order_id: orderId,
        payment_type: "deposit",
      } : {
        payment_type: "deposit",
        customer_email: customerEmail,
      },
    });

    // Only create payment record if we have a real order
    if (isRealOrder) {
      await supabaseClient.from("payments").insert({
        order_id: orderId,
        stripe_payment_intent_id: paymentIntent.id,
        amount_cents: depositCents,
        payment_type: "deposit",
        status: "pending",
        description: `Deposit payment for order ${orderId}`,
      });
    }

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        customerId: customerId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});