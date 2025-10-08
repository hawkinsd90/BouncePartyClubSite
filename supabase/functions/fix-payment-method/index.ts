import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.14.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { orderId } = await req.json();
    console.log("[fix-payment-method] Fixing payment method for order:", orderId);

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: "Missing orderId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Get Stripe secret key
    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      console.error("[fix-payment-method] Stripe key error:", keyError);
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

    // Get order
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("stripe_customer_id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      console.error("[fix-payment-method] Order fetch error:", orderError);
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!order.stripe_customer_id) {
      return new Response(
        JSON.stringify({ error: "No Stripe customer ID on order" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[fix-payment-method] Looking for sessions for customer:", order.stripe_customer_id);

    // Get all sessions for this customer
    const sessions = await stripe.checkout.sessions.list({
      customer: order.stripe_customer_id,
      limit: 20,
    });

    console.log("[fix-payment-method] Found", sessions.data.length, "sessions");

    // Find the session for this order
    const orderSession = sessions.data.find(
      (s) => s.metadata?.order_id === orderId
    );

    if (!orderSession) {
      return new Response(
        JSON.stringify({ error: "No checkout session found for this order" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[fix-payment-method] Found session:", orderSession.id);

    // Retrieve full session with payment method
    const fullSession = await stripe.checkout.sessions.retrieve(orderSession.id, {
      expand: ['payment_intent', 'payment_intent.payment_method'],
    });

    console.log("[fix-payment-method] Full session payment_intent:", fullSession.payment_intent);

    let paymentMethodId: string | null = null;

    // Try to get payment method from the session
    if (typeof fullSession.payment_method === 'string') {
      paymentMethodId = fullSession.payment_method;
    } else if (fullSession.payment_method?.id) {
      paymentMethodId = fullSession.payment_method.id;
    }

    // If not found, try from payment intent
    if (!paymentMethodId && fullSession.payment_intent) {
      const paymentIntent = fullSession.payment_intent;
      if (typeof paymentIntent === 'object' && paymentIntent.payment_method) {
        if (typeof paymentIntent.payment_method === 'string') {
          paymentMethodId = paymentIntent.payment_method;
        } else if (paymentIntent.payment_method.id) {
          paymentMethodId = paymentIntent.payment_method.id;
        }
      }
    }

    console.log("[fix-payment-method] Extracted payment method ID:", paymentMethodId);

    if (!paymentMethodId) {
      return new Response(
        JSON.stringify({ error: "Could not extract payment method from session" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update the order
    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({
        stripe_payment_method_id: paymentMethodId,
      })
      .eq("id", orderId);

    if (updateError) {
      console.error("[fix-payment-method] Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update order" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[fix-payment-method] Successfully updated payment method");

    return new Response(
      JSON.stringify({ 
        success: true, 
        paymentMethodId: paymentMethodId 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[fix-payment-method] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});