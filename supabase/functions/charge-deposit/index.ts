import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import { validatePaymentMethod } from "../_shared/payment-validation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    // Parse body early for rate limiting
    const { orderId } = await req.json();

    const ip = getIdentifier(req);
    const identifier = buildRateLimitKey(ip, orderId, 'deposit');

    if (!ip && !orderId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request: unable to identify client' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rateLimitResult = await checkRateLimit('charge-deposit', identifier, undefined, true);

    if (!rateLimitResult.allowed) {
      if (rateLimitResult.reason === 'missing_identifier') {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid request: unable to identify client' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

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

    // Get Stripe secret key
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

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    // Load the order
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select(
        "id, stripe_customer_id, stripe_payment_method_id, deposit_due_cents, tip_cents, deposit_paid_cents, status"
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No payment method on file for this order",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!order.deposit_due_cents || order.deposit_due_cents <= 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No deposit amount configured for this order",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If already paid, just update status to confirmed (avoid double charge)
    if (order.deposit_paid_cents && order.deposit_paid_cents >= order.deposit_due_cents) {
      // Still need to update status if it's not confirmed yet
      if (order.status !== 'confirmed') {
        const { error: updateError } = await supabaseClient
          .from("orders")
          .update({ status: "confirmed" })
          .eq("id", orderId);

        if (updateError) {
          console.error("Failed to update order status:", updateError);
          return new Response(
            JSON.stringify({ success: false, error: `Failed to update order: ${updateError.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          alreadyCharged: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validation = await validatePaymentMethod(order.stripe_payment_method_id, stripe);

    if (!validation.valid) {
      return new Response(
        JSON.stringify({
          success: false,
          error: validation.reason,
          needsNewCard: validation.needsNewCard
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (validation.expMonth && validation.expYear && validation.last4) {
      await supabaseClient
        .from("orders")
        .update({
          payment_method_validated_at: new Date().toISOString(),
          payment_method_exp_month: validation.expMonth,
          payment_method_exp_year: validation.expYear,
          payment_method_last_four: validation.last4,
        })
        .eq("id", orderId);
    }

    const amountCents =
      order.deposit_due_cents + (order.tip_cents ?? 0);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: order.stripe_customer_id,
      payment_method: order.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      metadata: {
        order_id: orderId,
        payment_type: "deposit",
      },
    });

    if (paymentIntent.status !== "succeeded") {
      return new Response(
        JSON.stringify({
          success: false,
          error: `PaymentIntent status is ${paymentIntent.status}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update order as paid & confirmed
    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({
        status: "confirmed",
        deposit_paid_cents: amountCents,
        stripe_payment_status: "paid",
      })
      .eq("id", orderId);

    if (updateError) {
      console.error("Failed to update order status:", updateError);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to update order: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get payment method details
    let paymentMethod = null;
    let paymentBrand = null;
    let paymentLast4 = null;

    if (paymentIntent.payment_method) {
      const pmId = typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : paymentIntent.payment_method.id;

      try {
        const pm = await stripe.paymentMethods.retrieve(pmId);

        if (pm.type === "card" && pm.card) {
          paymentMethod = "card";
          paymentBrand = pm.card.brand;
          paymentLast4 = pm.card.last4;
        } else if (pm.type === "us_bank_account") {
          paymentMethod = "bank_account";
          paymentLast4 = pm.us_bank_account?.last4;
        } else {
          paymentMethod = pm.type;
        }
      } catch (pmError) {
        console.error("Failed to retrieve payment method details:", pmError);
      }
    }

    // Record payment
    const { error: paymentError } = await supabaseClient.from("payments").insert({
      order_id: orderId,
      stripe_payment_intent_id: paymentIntent.id,
      amount_cents: amountCents,
      type: "deposit",
      status: "succeeded",
      paid_at: new Date().toISOString(),
      payment_method: paymentMethod,
      payment_brand: paymentBrand,
      payment_last4: paymentLast4,
    });

    if (paymentError) {
      console.error("Failed to record payment:", paymentError);
      // Don't fail the whole request since charge succeeded, just log it
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("charge-deposit error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
