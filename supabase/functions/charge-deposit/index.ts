import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing orderId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      return new Response(
        JSON.stringify({ success: false, error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, { apiVersion: "2024-10-28.acacia" });

    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, stripe_customer_id, deposit_due_cents, balance_due_cents, customer_selected_payment_cents, tip_cents, status")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!order.stripe_customer_id) {
      return new Response(
        JSON.stringify({ success: false, error: "No payment method on file. Customer must complete checkout first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Retrieve the default payment method for this customer
    const customer = await stripe.customers.retrieve(order.stripe_customer_id) as Stripe.Customer;
    const paymentMethodId =
      (customer as any).invoice_settings?.default_payment_method ||
      (customer as any).default_source;

    if (!paymentMethodId) {
      // Try to find a payment method attached to this customer
      const paymentMethods = await stripe.paymentMethods.list({
        customer: order.stripe_customer_id,
        type: "card",
      });

      if (!paymentMethods.data.length) {
        return new Response(
          JSON.stringify({ success: false, error: "No payment method found for customer" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Determine the charge amount
    const tipCents = order.tip_cents ?? 0;
    const depositCents = order.deposit_due_cents ?? 0;
    const balanceCents = order.balance_due_cents ?? 0;
    const totalCents = depositCents + balanceCents;

    let chargeCents: number;
    if (order.customer_selected_payment_cents != null && order.customer_selected_payment_cents > 0) {
      chargeCents = order.customer_selected_payment_cents + tipCents;
    } else {
      chargeCents = depositCents + tipCents;
    }

    if (chargeCents <= 0) {
      // No charge needed — just confirm the order
      const { error: updateError } = await supabaseClient
        .from("orders")
        .update({ status: "confirmed" })
        .eq("id", orderId);

      if (updateError) {
        return new Response(
          JSON.stringify({ success: false, error: "Failed to confirm order: " + updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, paymentDetails: { amountCents: 0 } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the payment method to use
    const paymentMethods = await stripe.paymentMethods.list({
      customer: order.stripe_customer_id,
      type: "card",
    });

    if (!paymentMethods.data.length) {
      return new Response(
        JSON.stringify({ success: false, error: "No payment method found for customer" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pm = paymentMethods.data[0];

    // Create a PaymentIntent and confirm it immediately
    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargeCents,
      currency: "usd",
      customer: order.stripe_customer_id,
      payment_method: pm.id,
      confirm: true,
      off_session: true,
      metadata: {
        order_id: orderId,
        payment_type: "deposit",
      },
    });

    if (paymentIntent.status !== "succeeded") {
      return new Response(
        JSON.stringify({
          success: false,
          chargeSucceeded: false,
          error: `Payment failed with status: ${paymentIntent.status}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine balance remaining after this payment
    const paidNonTip = chargeCents - tipCents;
    const remainingBalance = Math.max(0, totalCents - paidNonTip);
    const newStatus = remainingBalance <= 0 ? "confirmed" : "confirmed";

    // Update order status to confirmed
    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId);

    if (updateError) {
      console.error("Order update failed after successful charge:", updateError);
      return new Response(
        JSON.stringify({
          success: false,
          chargeSucceeded: true,
          error: "Payment was processed but order update failed. Please contact support.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Record the payment
    const latestCharge = paymentIntent.latest_charge as string | null;
    let chargeObj: Stripe.Charge | null = null;
    if (latestCharge) {
      chargeObj = await stripe.charges.retrieve(latestCharge);
    }

    const { error: paymentInsertError } = await supabaseClient.from("payments").insert({
      order_id: orderId,
      stripe_payment_intent_id: paymentIntent.id,
      amount_cents: chargeCents,
      status: "succeeded",
      type: "deposit",
      paid_at: new Date().toISOString(),
      payment_method: pm.card?.brand ? `${pm.card.brand} ending in ${pm.card.last4}` : "card",
      payment_method_brand: pm.card?.brand ?? null,
    });

    if (paymentInsertError) {
      console.error("Failed to record payment:", paymentInsertError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        paymentDetails: {
          paymentIntentId: paymentIntent.id,
          amountCents: chargeCents,
          chargeId: latestCharge ?? null,
          paymentMethod: pm.card?.brand ? `${pm.card.brand} ending in ${pm.card.last4}` : "card",
          paymentBrand: pm.card?.brand ?? null,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("charge-deposit error:", error);
    const stripeError = error as any;

    // Handle card decline specifically
    if (stripeError?.type === "StripeCardError" || stripeError?.code) {
      return new Response(
        JSON.stringify({
          success: false,
          chargeSucceeded: false,
          error: stripeError.message || "Card was declined",
          declineCode: stripeError.decline_code,
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
