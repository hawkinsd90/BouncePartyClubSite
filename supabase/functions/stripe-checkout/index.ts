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
  tipCents?: number;
  customerEmail: string;
  customerName: string;
  appBaseUrl: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const action = url.searchParams.get("action");
      const orderId = url.searchParams.get("orderId");
      const sessionId = url.searchParams.get("session_id");

      if (action === "webhook" && orderId && sessionId) {
        try {
          const supabaseClient = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
          );

          const { data: stripeKeyData } = await supabaseClient
            .from("admin_settings")
            .select("value")
            .eq("key", "stripe_secret_key")
            .maybeSingle();

          if (stripeKeyData?.value) {
            const stripe = new Stripe(stripeKeyData.value, {
              apiVersion: "2024-10-28.acacia",
            });

            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status === "paid" && session.payment_intent) {
              const tipCents = parseInt(session.metadata?.tip_cents || "0", 10);
              const paymentAmountCents = (session.amount_total || 0) - tipCents;

              await supabaseClient
                .from("orders")
                .update({
                  stripe_payment_status: "paid",
                  stripe_payment_method_id: session.payment_method as string,
                  deposit_paid_cents: paymentAmountCents,
                  status: "pending_review",
                })
                .eq("id", orderId);

              if (typeof session.payment_intent === "string") {
                await supabaseClient
                  .from("payments")
                  .update({ status: "succeeded" })
                  .eq("stripe_payment_intent_id", session.payment_intent);
              }

              console.log(`Payment successful for order ${orderId}`);
            }
          }
        } catch (error) {
          console.error("Error updating order:", error);
        }
      }

      return new Response(
        JSON.stringify({ success: true, action, orderId }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      return new Response(JSON.stringify({ error: "Stripe not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    const { orderId, depositCents, tipCents = 0, customerEmail, customerName, appBaseUrl }: CheckoutRequest = await req.json();

    if (!orderId || !depositCents || !customerEmail || !appBaseUrl) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        metadata: { order_id: orderId },
      });
      customerId = customer.id;

      await supabaseClient
        .from("orders")
        .update({ stripe_customer_id: customerId })
        .eq("id", orderId);
    }

    const lineItems = [
      {
        price_data: {
          currency: "usd",
          unit_amount: depositCents,
          product_data: {
            name: `Payment for Order ${orderId.slice(0, 8).toUpperCase()}`,
            description: "Bounce Party Club rental payment",
          },
        },
        quantity: 1,
      },
    ];

    if (tipCents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: tipCents,
          product_data: {
            name: "Tip for Crew",
            description: "Gratuity for service",
          },
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: lineItems,
      mode: "payment",
      payment_intent_data: {
        setup_future_usage: "off_session",
        metadata: {
          order_id: orderId,
          payment_type: "deposit",
          tip_cents: tipCents.toString(),
        },
      },
      success_url: `${appBaseUrl}/payment-success.html?orderId=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl}/checkout/payment-canceled?orderId=${orderId}`,
      metadata: {
        order_id: orderId,
        tip_cents: tipCents.toString(),
      },
    });

    await supabaseClient.from("payments").insert({
      order_id: orderId,
      stripe_payment_intent_id: session.payment_intent as string,
      amount_cents: depositCents,
      payment_type: "deposit",
      status: "pending",
      description: `Payment for order ${orderId}${tipCents > 0 ? ` (includes $${(tipCents / 100).toFixed(2)} tip)` : ""}`,
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
