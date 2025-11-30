/**
 * STRIPE CHECKOUT - Supabase Edge Function
 * Stores card on file (no charge) using Stripe Checkout setup mode.
 * POST  → creates checkout session (setup mode)
 * GET   → verifies checkout result, saves card + updates order
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.14.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CheckoutRequest {
  orderId: string;
  depositCents: number;
  tipCents?: number;
  customerEmail: string;
  customerName: string;
  origin?: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    // =====================================================
    // GET — Payment Verification (Bridge / Polling)
    // =====================================================
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

            const session = await stripe.checkout.sessions.retrieve(sessionId, {
              expand: ["setup_intent"],
            });

            const setupIntent =
              session.setup_intent as Stripe.SetupIntent | null;

            if (setupIntent && setupIntent.status === "succeeded") {
              const paymentMethodId =
                typeof setupIntent.payment_method === "string"
                  ? setupIntent.payment_method
                  : (setupIntent.payment_method as any)?.id;

              const stripeCustomerId =
                typeof session.customer === "string"
                  ? session.customer
                  : (session.customer as any)?.id;

              // Update order with card on file
              await supabaseClient
                .from("orders")
                .update({
                  stripe_payment_status: "card_on_file",
                  stripe_payment_method_id: paymentMethodId,
                  stripe_customer_id: stripeCustomerId,
                  status: "pending_review",
                })
                .eq("id", orderId);

              console.log(
                `[stripe-checkout] Stored card for order ${orderId}`
              );
            }
          }
        } catch (err) {
          console.error("[stripe-checkout] Error in GET webhook:", err);
        }
      }

      return new Response(
        JSON.stringify({ success: true, orderId }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // =====================================================
    // POST — Create Checkout Session (Store card only)
    // =====================================================

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
        JSON.stringify({ error: "Stripe not configured." }),
        { status: 500, headers: corsHeaders }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    const body: CheckoutRequest = await req.json();
    const {
      orderId,
      depositCents,
      tipCents = 0,
      customerEmail,
      customerName,
      origin,
    } = body;

    if (!orderId || !depositCents || !customerEmail) {
      return new Response(
        JSON.stringify({ error: "Missing required fields." }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Determine redirect origin
    const headerOrigin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    let siteOrigin = origin || headerOrigin;
    if (!siteOrigin && referer) {
      try {
        siteOrigin = new URL(referer).origin;
      } catch {}
    }
    siteOrigin = siteOrigin || "http://localhost:5173";

    // Find or create Stripe customer
    const { data: orderRow } = await supabaseClient
      .from("orders")
      .select("stripe_customer_id")
      .eq("id", orderId)
      .maybeSingle();

    let customerId = orderRow?.stripe_customer_id;

    if (!customerId) {
      const newCustomer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        metadata: { order_id: orderId },
      });
      customerId = newCustomer.id;

      await supabaseClient
        .from("orders")
        .update({ stripe_customer_id: customerId })
        .eq("id", orderId);
    }

    // Save intended deposit & tip
    await supabaseClient
      .from("orders")
      .update({
        deposit_due_cents: depositCents,
        tip_cents: tipCents,
      })
      .eq("id", orderId);

    // Build success/cancel URLs
    const success_url = `${siteOrigin}/checkout/payment-complete?orderId=${orderId}&session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url = `${siteOrigin}/checkout/payment-canceled?orderId=${orderId}`;

    // Create the Setup Session
    // Note: Apple Pay and Google Pay are automatically available when enabled in Stripe Dashboard
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "setup",
      payment_method_types: ["card"],
      success_url,
      cancel_url,
      metadata: {
        order_id: orderId,
        tip_cents: String(tipCents),
      },
    });

    console.log("[stripe-checkout] Setup session created:", session.id);

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
        customerId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("[stripe-checkout] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Unknown error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
