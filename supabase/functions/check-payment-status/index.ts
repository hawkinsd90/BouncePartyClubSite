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
    console.log("[check-payment-status] Checking payment for order:", orderId);

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
      console.error("[check-payment-status] Stripe key error:", keyError);
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
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("stripe_payment_status, stripe_customer_id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      console.error("[check-payment-status] Order fetch error:", orderError);
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[check-payment-status] Current order status:", {
      stripe_payment_status: order.stripe_payment_status,
      stripe_customer_id: order.stripe_customer_id,
    });

    // If already marked as paid, return immediately
    if (order.stripe_payment_status === "paid") {
      console.log("[check-payment-status] Order already marked as paid");
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
      console.log("[check-payment-status] Checking Stripe for customer:", order.stripe_customer_id);
      const sessions = await stripe.checkout.sessions.list({
        customer: order.stripe_customer_id,
        limit: 10,
      });

      console.log("[check-payment-status] Found", sessions.data.length, "sessions");

      // Find a completed session for this order
      const completedSession = sessions.data.find(
        (s) => s.metadata?.order_id === orderId && s.payment_status === "paid"
      );

      if (completedSession) {
        console.log("[check-payment-status] Found completed session:", completedSession.id);
        
        // Update order status
        const { error: updateError } = await supabaseClient
          .from("orders")
          .update({
            stripe_payment_status: "paid",
            stripe_payment_method_id: completedSession.payment_method as string,
            deposit_paid_cents: completedSession.amount_total || 0,
            status: "pending_review",
          })
          .eq("id", orderId);

        if (updateError) {
          console.error("[check-payment-status] Failed to update order:", updateError);
        } else {
          console.log("[check-payment-status] Order updated successfully");
        }

        // Send SMS notification
        try {
          console.log("[check-payment-status] Sending SMS notification");
          const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
          const smsResponse = await fetch(`${supabaseUrl}/functions/v1/send-sms-notification`, {
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

          if (!smsResponse.ok) {
            const errorText = await smsResponse.text();
            console.error("[check-payment-status] SMS failed:", errorText);
          } else {
            console.log("[check-payment-status] SMS sent successfully");
          }
        } catch (smsError) {
          console.error("[check-payment-status] SMS error:", smsError);
        }

        return new Response(
          JSON.stringify({ status: "paid" }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      } else {
        console.log("[check-payment-status] No completed session found for this order");
      }
    } else {
      console.log("[check-payment-status] No stripe_customer_id set");
    }

    return new Response(
      JSON.stringify({ status: order.stripe_payment_status || "unpaid" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[check-payment-status] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});