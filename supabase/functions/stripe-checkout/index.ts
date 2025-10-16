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
  redirectBaseUrl?: string;
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

    // Get Stripe key from settings
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

    const stripeKey = stripeKeyData.value;

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2024-10-28.acacia",
    });

    const { orderId, depositCents, customerEmail, customerName, redirectBaseUrl }: CheckoutRequest =
      await req.json();

    if (!orderId || !depositCents || !customerEmail) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Received redirectBaseUrl from frontend:", redirectBaseUrl);

    const { data: order } = await supabaseClient
      .from("orders")
      .select("stripe_customer_id")
      .eq("id", orderId)
      .maybeSingle();

    let customerId = order?.stripe_customer_id || null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        metadata: {
          order_id: orderId,
        },
      });
      customerId = customer.id;

      await supabaseClient
        .from("orders")
        .update({ stripe_customer_id: customerId })
        .eq("id", orderId);
    }

    // Use the redirectBaseUrl from the frontend, fallback to referer header
    let baseUrl = redirectBaseUrl;

    if (!baseUrl) {
      const referer = req.headers.get("referer");
      if (referer) {
        try {
          const refererUrl = new URL(referer);
          baseUrl = refererUrl.origin;
        } catch (e) {
          console.error("Failed to parse referer URL:", e);
          baseUrl = "https://bolt.new";
        }
      } else {
        baseUrl = "https://bolt.new";
      }
    }

    console.log("Using base URL for redirects:", baseUrl);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: depositCents,
            product_data: {
              name: `Deposit for Order ${orderId.slice(0, 8).toUpperCase()}`,
              description: "Bounce Party Club rental deposit",
            },
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      payment_intent_data: {
        setup_future_usage: "off_session",
        metadata: {
          order_id: orderId,
          payment_type: "deposit",
        },
      },
      success_url: `${baseUrl}/checkout/payment-success?orderId=${orderId}`,
      cancel_url: `${baseUrl}/checkout/payment-canceled?orderId=${orderId}`,
      metadata: {
        order_id: orderId,
      },
    });

    await supabaseClient.from("payments").insert({
      order_id: orderId,
      stripe_payment_intent_id: session.payment_intent as string,
      amount_cents: depositCents,
      payment_type: "deposit",
      status: "pending",
      description: `Deposit payment for order ${orderId}`,
    });

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
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
