import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";

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
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const { orderId, depositCents, tipCents = 0, customerEmail, customerName, setupMode = false, invoiceMode = false, paymentState = null } = await req.json();

    const ip = getIdentifier(req);
    const identifier = buildRateLimitKey(ip, orderId, 'checkout');

    if (!ip && !orderId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request: unable to identify client' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rateLimitResult = await checkRateLimit('stripe-checkout', identifier, undefined, true);

    if (!rateLimitResult.allowed) {
      if (rateLimitResult.reason === 'missing_identifier') {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid request: unable to identify client' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    if (!orderId || (!depositCents && !setupMode)) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
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

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, stripe_customer_id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create or retrieve Stripe customer
    let customerId = order.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        metadata: {
          order_id: orderId,
        },
      });
      customerId = customer.id;

      // Save customer ID to order
      await supabaseClient
        .from("orders")
        .update({ stripe_customer_id: customerId })
        .eq("id", orderId);
    }

    // Use setup mode to save card on file (no charge yet)
    // If setupMode (card update), redirect back to customer portal with approval modal trigger
    // Encode payment state in URL so it survives the Stripe redirect
    let successUrl: string;
    if (setupMode) {
      let params: URLSearchParams;
      if (invoiceMode) {
        params = new URLSearchParams({ invoice_card_saved: 'true', session_id: '{CHECKOUT_SESSION_ID}' });
      } else {
        params = new URLSearchParams({ card_updated: 'true', session_id: '{CHECKOUT_SESSION_ID}' });
        if (paymentState) {
          if (paymentState.paymentAmount) params.set('pa', paymentState.paymentAmount);
          if (paymentState.customPaymentAmount) params.set('cpa', paymentState.customPaymentAmount);
          if (typeof paymentState.newTipCents === 'number') params.set('tip', String(paymentState.newTipCents));
          if (typeof paymentState.keepOriginalPayment === 'boolean') params.set('kop', paymentState.keepOriginalPayment ? '1' : '0');
          if (typeof paymentState.selectedPaymentBaseCents === 'number') params.set('spb', String(paymentState.selectedPaymentBaseCents));
        }
      }
      successUrl = `${req.headers.get("origin")}/customer-portal/${orderId}?${params.toString()}`;
    } else {
      successUrl = `${req.headers.get("origin")}/payment-complete?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`;
    }
    const cancelUrl = setupMode
      ? `${req.headers.get("origin")}/customer-portal/${orderId}?card_update_canceled=true`
      : `${req.headers.get("origin")}/payment-canceled?order_id=${orderId}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "setup",
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        order_id: orderId,
        payment_type: setupMode ? "card_update" : "deposit",
        deposit_amount: depositCents ? depositCents.toString() : "0",
        tip_cents: tipCents.toString(),
      },
    });

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("stripe-checkout error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
