/**
 * CUSTOMER BALANCE PAYMENT - Supabase Edge Function
 * Creates a Stripe Checkout session for customers to pay their remaining balance
 * POST → creates checkout session in payment mode
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.14.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BalancePaymentRequest {
  orderId: string;
  amountCents: number;
}

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get Stripe secret key
    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    const body: BalancePaymentRequest = await req.json();
    const { orderId, amountCents } = body;

    if (!orderId || !amountCents || amountCents <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid request parameters." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get order details
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("*, contacts!inner(email, full_name)")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine redirect origin
    const headerOrigin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    let siteOrigin = headerOrigin;
    if (!siteOrigin && referer) {
      try {
        siteOrigin = new URL(referer).origin;
      } catch {}
    }
    siteOrigin = siteOrigin || "http://localhost:5173";

    // Find or create Stripe customer
    let customerId = order.stripe_customer_id;

    if (!customerId) {
      const newCustomer = await stripe.customers.create({
        email: order.contacts[0].email,
        name: order.contacts[0].full_name,
        metadata: { order_id: orderId },
      });
      customerId = newCustomer.id;

      await supabaseClient
        .from("orders")
        .update({ stripe_customer_id: customerId })
        .eq("id", orderId);
    }

    // Build success/cancel URLs
    const success_url = `${siteOrigin}/portal/${orderId}?payment=success`;
    const cancel_url = `${siteOrigin}/portal/${orderId}?payment=canceled`;

    // Create Stripe Checkout session in payment mode
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Order Balance Payment`,
              description: `Order #${orderId.slice(0, 8).toUpperCase()}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url,
      cancel_url,
      metadata: {
        order_id: orderId,
        payment_type: "balance",
      },
    });

    console.log("[customer-balance-payment] Session created:", session.id);

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("[customer-balance-payment] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});