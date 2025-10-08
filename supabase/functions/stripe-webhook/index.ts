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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.text();
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const signature = req.headers.get("stripe-signature");

    let event: Stripe.Event;

    if (webhookSecret && signature) {
      try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      } catch (err) {
        console.error("Webhook signature verification failed:", err.message);
        return new Response(
          JSON.stringify({ error: "Invalid signature" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      event = JSON.parse(body);
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id;

        if (orderId) {
          await supabaseClient
            .from("orders")
            .update({
              stripe_payment_status: "paid",
              stripe_payment_method_id: session.payment_method as string,
              deposit_paid_cents: session.amount_total || 0,
              status: "pending",
            })
            .eq("id", orderId);

          // Send SMS notification to admin
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
            // Don't fail the webhook if SMS fails
          }
        }

        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const orderId = paymentIntent.metadata.order_id;
        const paymentType = paymentIntent.metadata.payment_type;

        await supabaseClient
          .from("payments")
          .update({ status: "succeeded" })
          .eq("stripe_payment_intent_id", paymentIntent.id);

        if (orderId && paymentType === "deposit") {
          const paymentMethodId = paymentIntent.payment_method as string;

          await supabaseClient
            .from("orders")
            .update({
              stripe_payment_method_id: paymentMethodId,
              deposit_paid_cents: paymentIntent.amount,
              stripe_payment_status: "paid",
            })
            .eq("id", orderId);
        }

        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;

        await supabaseClient
          .from("payments")
          .update({ status: "failed" })
          .eq("stripe_payment_intent_id", paymentIntent.id);

        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = charge.payment_intent as string;

        const { data: payment } = await supabaseClient
          .from("payments")
          .select("*")
          .eq("stripe_payment_intent_id", paymentIntentId)
          .single();

        if (payment) {
          await supabaseClient.from("payments").insert({
            order_id: payment.order_id,
            stripe_payment_intent_id: paymentIntentId,
            amount_cents: -charge.amount_refunded,
            payment_type: "refund",
            status: "succeeded",
            description: `Refund for ${payment.payment_type}`,
          });

          const { data: order } = await supabaseClient
            .from("orders")
            .select("total_refunded_cents")
            .eq("id", payment.order_id)
            .single();

          if (order) {
            await supabaseClient
              .from("orders")
              .update({
                total_refunded_cents: (order.total_refunded_cents || 0) + charge.amount_refunded,
              })
              .eq("id", payment.order_id);
          }
        }

        break;
      }
    }

    return new Response(
      JSON.stringify({ received: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});