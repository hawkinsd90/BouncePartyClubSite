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
  console.log("🧲 [WEBHOOK] Received request:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.text();
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const signature = req.headers.get("stripe-signature");

    console.log("🔐 [WEBHOOK] Has webhook secret:", !!webhookSecret);
    console.log("🖊️ [WEBHOOK] Has signature:", !!signature);

    let event: Stripe.Event;

    if (webhookSecret && signature) {
      try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        console.log("✅ [WEBHOOK] Signature verified");
      } catch (err: any) {
        console.error("❌ [WEBHOOK] Signature verification failed:", err.message);
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      event = JSON.parse(body);
      console.log("⚠️ [WEBHOOK] No signature verification (dev mode)");
    }

    console.log("📨 [WEBHOOK] Event type:", event.type);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id || null;

        // Safely pull customer + PI
        const stripeCustomerId =
          typeof session.customer === "string"
            ? session.customer
            : (session.customer as any)?.id || null;

        const piId = session.payment_intent as string | null;
        let paymentMethodId: string | null = null;
        let amountPaid = session.amount_total || 0;

        let paymentMethodType: string | null = null;
        let paymentBrand: string | null = null;
        let paymentLast4: string | null = null;

        if (piId) {
          const pi = await stripe.paymentIntents.retrieve(piId, {
            expand: ["payment_method"],
          });
          if (typeof pi.payment_method === "string") {
            paymentMethodId = pi.payment_method;
          } else if (pi.payment_method?.id) {
            paymentMethodId = pi.payment_method.id;
            // Extract payment method details
            const pm = pi.payment_method as any;
            paymentMethodType = pm.type || null;
            if (pm.card) {
              paymentBrand = pm.card.brand || null;
              paymentLast4 = pm.card.last4 || null;
            }
          }
          amountPaid = pi.amount_received || session.amount_total || 0;
        }

        // Separate tip for deposit accounting (optional)
        const tipCents = parseInt(session.metadata?.tip_cents || "0", 10);
        const depositOnly = Math.max(
          0,
          amountPaid - (Number.isFinite(tipCents) ? tipCents : 0)
        );

        if (orderId) {
          const { data: existingOrder } = await supabaseClient
            .from("orders")
            .select("invoice_sent_at")
            .eq("id", orderId)
            .single();

          const isAdminInvoice = !!existingOrder?.invoice_sent_at;
          const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

          await supabaseClient
            .from("orders")
            .update({
              stripe_payment_status: "paid",
              stripe_payment_method_id: paymentMethodId,
              stripe_customer_id: stripeCustomerId,
              deposit_paid_cents: depositOnly,
              status: newStatus,
            })
            .eq("id", orderId);

          if (piId) {
            await supabaseClient
              .from("payments")
              .update({
                status: "succeeded",
                paid_at: new Date().toISOString(),
                payment_method: paymentMethodType,
                payment_brand: paymentBrand,
                payment_last4: paymentLast4
              })
              .eq("stripe_payment_intent_id", piId);
          }
        }
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const orderId = paymentIntent.metadata?.order_id || null;
        const paymentType = paymentIntent.metadata?.payment_type || null;

        // Extract payment method details
        let paymentMethodType: string | null = null;
        let paymentBrand: string | null = null;
        let paymentLast4: string | null = null;

        if (paymentIntent.payment_method) {
          const pm = await stripe.paymentMethods.retrieve(
            typeof paymentIntent.payment_method === "string"
              ? paymentIntent.payment_method
              : paymentIntent.payment_method.id
          );
          paymentMethodType = pm.type || null;
          if (pm.card) {
            paymentBrand = pm.card.brand || null;
            paymentLast4 = pm.card.last4 || null;
          }
        }

        // Mark the payment row as succeeded
        await supabaseClient
          .from("payments")
          .update({
            status: "succeeded",
            paid_at: new Date().toISOString(),
            payment_method: paymentMethodType,
            payment_brand: paymentBrand,
            payment_last4: paymentLast4
          })
          .eq("stripe_payment_intent_id", paymentIntent.id);

        if (orderId && paymentType === "deposit") {
          const paymentMethodId =
            typeof paymentIntent.payment_method === "string"
              ? paymentIntent.payment_method
              : (paymentIntent.payment_method as any)?.id || null;

          const stripeCustomerId =
            typeof paymentIntent.customer === "string"
              ? paymentIntent.customer
              : (paymentIntent.customer as any)?.id || null;

          const amountReceived =
            (paymentIntent as any).amount_received ?? paymentIntent.amount ?? 0;

          const { data: existingOrder } = await supabaseClient
            .from("orders")
            .select("invoice_sent_at")
            .eq("id", orderId)
            .single();

          const isAdminInvoice = !!existingOrder?.invoice_sent_at;
          const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

          await supabaseClient
            .from("orders")
            .update({
              stripe_payment_status: "paid",
              stripe_payment_method_id: paymentMethodId,
              stripe_customer_id: stripeCustomerId,
              deposit_paid_cents: amountReceived,
              status: newStatus,
            })
            .eq("id", orderId);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await supabaseClient
          .from("payments")
          .update({
            status: "failed",
            failed_at: new Date().toISOString()
          })
          .eq("stripe_payment_intent_id", paymentIntent.id);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = charge.payment_intent as string;

        // Link refund to order via original payment row
        const { data: payment } = await supabaseClient
          .from("payments")
          .select("order_id")
          .eq("stripe_payment_intent_id", paymentIntentId)
          .single();

        if (payment?.order_id) {
          // Record a refund entry (your schema: order_refunds)
          await supabaseClient.from("order_refunds").insert({
            order_id: payment.order_id,
            amount_cents: charge.amount_refunded || 0,
            reason: charge.reason || "refund",
            stripe_refund_id: (charge.refunds?.data?.[0]?.id as string) || null,
            refunded_by: null,
            status: charge.refunded ? "succeeded" : "pending",
          });
        }
        break;
      }

      default:
        console.log(`ℹ️ [WEBHOOK] Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("❌ [WEBHOOK] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
