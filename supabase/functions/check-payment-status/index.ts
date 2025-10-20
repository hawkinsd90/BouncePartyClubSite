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

    // Get order with payment info
    const { data: order } = await supabaseClient
      .from("orders")
      .select("stripe_payment_status, stripe_customer_id")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // If already marked as paid, return immediately
    if (order.stripe_payment_status === "paid") {
      return new Response(
        JSON.stringify({ status: "paid" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check Stripe for recent successful checkout sessions
    if (order.stripe_customer_id) {
      const sessions = await stripe.checkout.sessions.list({
        customer: order.stripe_customer_id,
        limit: 10,
      });

      // Find a completed session for this order
      const completedSession = sessions.data.find(
        (s) => s.metadata?.order_id === orderId && s.payment_status === "paid"
      );

      if (completedSession) {
        console.log("Found completed session, updating order:", completedSession.id);
        
        // Update order status
        await supabaseClient
          .from("orders")
          .update({
            stripe_payment_status: "paid",
            stripe_payment_method_id: completedSession.payment_method_configuration as string,
            deposit_paid_cents: completedSession.amount_total || 0,
            status: "pending",
          })
          .eq("id", orderId);

        // Send SMS notification
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
          await fetch(`${supabaseUrl}/functions/v1/send-sms-notification`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              orderId: orderId,
              templateKey: "booking_received_admin",
            }),
          });
        } catch (smsError) {
          console.error("Failed to send SMS notification:", smsError);
        }

        return new Response(
          JSON.stringify({ status: "paid" }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    return new Response(
      JSON.stringify({ status: order.stripe_payment_status || "unpaid" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Check payment status error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});