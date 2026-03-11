import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-11-20.acacia",
});

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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { sessionId, orderId } = await req.json();

    if (!sessionId || !orderId) {
      return new Response(
        JSON.stringify({ error: "Missing sessionId or orderId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[VERIFY-PAYMENT] Verifying payment for order ${orderId}, session ${sessionId}`);

    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Payment not completed",
          paymentStatus: session.payment_status
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Payment was successful, check if webhook already processed it
    const { data: order } = await supabaseClient
      .from("orders")
      .select("status, tip_cents, stripe_payment_status")
      .eq("id", orderId)
      .single();

    if (!order) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If webhook already processed, return success
    if (order.status !== "draft" || order.tip_cents > 0) {
      console.log(`[VERIFY-PAYMENT] Webhook already processed order ${orderId}`);
      return new Response(
        JSON.stringify({
          success: true,
          message: "Payment already processed by webhook",
          alreadyProcessed: true
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Webhook hasn't processed yet, manually update the order
    console.log(`[VERIFY-PAYMENT] Webhook hasn't processed, manually updating order ${orderId}`);

    const tipCents = parseInt(session.metadata?.tip_cents || "0", 10);
    const depositCents = parseInt(session.metadata?.deposit_amount || "0", 10);

    const { data: invoiceLink } = await supabaseClient
      .from("invoice_links")
      .select("id")
      .eq("order_id", orderId)
      .maybeSingle();

    const isAdminInvoice = !!invoiceLink;
    const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

    const paymentMethodId = typeof session.payment_method === "string"
      ? session.payment_method
      : null;

    const stripeCustomerId = typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

    // Update order
    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({
        stripe_payment_status: "paid",
        stripe_payment_method_id: paymentMethodId,
        stripe_customer_id: stripeCustomerId,
        deposit_paid_cents: depositCents,
        tip_cents: tipCents,
        status: newStatus,
      })
      .eq("id", orderId);

    if (updateError) {
      console.error(`[VERIFY-PAYMENT] Error updating order:`, updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update order", details: updateError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update payment record if exists
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

    if (paymentIntentId) {
      await supabaseClient
        .from("payments")
        .update({
          status: "succeeded",
          paid_at: new Date().toISOString(),
        })
        .eq("stripe_payment_intent_id", paymentIntentId);
    }

    console.log(`[VERIFY-PAYMENT] Successfully updated order ${orderId} to status: ${newStatus}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Payment verified and order updated",
        status: newStatus,
        tipCents,
        manuallyProcessed: true
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[VERIFY-PAYMENT] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
