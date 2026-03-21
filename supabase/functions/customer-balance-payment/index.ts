/**
 * CUSTOMER BALANCE PAYMENT - Supabase Edge Function
 * Charges the remaining balance (and optional tip) for a confirmed order.
 * - If a card is on file, charges it directly via PaymentIntent (off-session).
 * - Otherwise creates a Stripe Checkout session and returns the URL.
 */

import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import { validatePaymentMethod } from "../_shared/payment-validation.ts";
import { formatOrderId } from "../_shared/format-order-id.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BalancePaymentRequest {
  orderId: string;
  amountCents: number;
  tipCents?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const body: BalancePaymentRequest = await req.json();
    const { orderId, amountCents, tipCents: rawTipCents = 0 } = body;
    const tipCents = Math.max(0, Math.round(rawTipCents));
    const totalChargeAmount = amountCents + tipCents;

    const ip = getIdentifier(req);
    const identifier = buildRateLimitKey(ip, orderId, "balance");

    if (!ip && !orderId) {
      return new Response(
        JSON.stringify({ error: "Invalid request: unable to identify client" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rateLimitResult = await checkRateLimit("customer-balance-payment", identifier, undefined, true);
    if (!rateLimitResult.allowed) {
      if (rateLimitResult.reason === "missing_identifier") {
        return new Response(
          JSON.stringify({ error: "Invalid request: unable to identify client" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    if (!orderId || totalChargeAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid request parameters." }),
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
        JSON.stringify({ error: "Stripe not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("*, contacts!inner(email, full_name)")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headerOrigin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    let siteOrigin = headerOrigin;
    if (!siteOrigin && referer) {
      try {
        siteOrigin = new URL(referer).origin;
      } catch {
        // ignore invalid referer
      }
    }
    siteOrigin = siteOrigin || "http://localhost:5173";

    const paymentMethodId = order.stripe_payment_method_id;
    const stripeCustomerId = order.stripe_customer_id;

    // --- Card-on-file path ---
    if (paymentMethodId && stripeCustomerId) {
      const validation = await validatePaymentMethod(paymentMethodId, stripe);

      if (validation.valid) {
        console.log("[customer-balance-payment] Charging card on file:", paymentMethodId);

        const paymentIntent = await stripe.paymentIntents.create({
          amount: totalChargeAmount,
          currency: "usd",
          customer: stripeCustomerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            order_id: orderId,
            payment_type: "balance",
            tip_cents: String(tipCents),
          },
          description: `Balance payment for Order #${formatOrderId(orderId)}`,
        });

        if (paymentIntent.status === "succeeded") {
          const { data: existingOrder } = await supabaseClient
            .from("orders")
            .select("tip_cents")
            .eq("id", orderId)
            .maybeSingle();
          const existingTip = existingOrder?.tip_cents || 0;

          await supabaseClient
            .from("orders")
            .update({
              balance_paid_cents: amountCents,
              ...(tipCents > 0 ? { tip_cents: existingTip + tipCents } : {}),
            })
            .eq("id", orderId);

          const charge = paymentIntent.latest_charge as string | null;

          await supabaseClient.from("payments").insert({
            order_id: orderId,
            stripe_payment_intent_id: paymentIntent.id,
            amount_cents: totalChargeAmount,
            type: "balance",
            status: "succeeded",
            paid_at: new Date().toISOString(),
            payment_method: "card",
          });

          console.log("[customer-balance-payment] Card charge succeeded:", paymentIntent.id, "charge:", charge);

          return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.warn("[customer-balance-payment] PaymentIntent not immediately succeeded, falling through to Checkout:", paymentIntent.status);
      } else {
        console.warn("[customer-balance-payment] Card on file invalid, falling through to Checkout:", validation.reason);
      }
    }

    // --- Stripe Checkout fallback (no card on file, or card failed validation) ---
    let customerId = stripeCustomerId;
    if (!customerId) {
      const newCustomer = await stripe.customers.create({
        email: order.contacts[0].email,
        name: order.contacts[0].full_name,
        metadata: { order_id: orderId },
      });
      customerId = newCustomer.id;
      await supabaseClient
        .from("orders")
        .update({ stripe_customer_id: customerId })
        .eq("id", orderId);
    }

    const success_url = `${siteOrigin}/customer-portal/${orderId}?payment=success`;
    const cancel_url = `${siteOrigin}/customer-portal/${orderId}?payment=canceled`;

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    if (amountCents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: "Order Balance Payment",
            description: `Order #${formatOrderId(orderId)}`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      });
    }

    if (tipCents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: "Crew Tip",
            description: "Thank you for tipping the crew!",
          },
          unit_amount: tipCents,
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url,
      cancel_url,
      metadata: {
        order_id: orderId,
        payment_type: "balance",
        tip_cents: String(tipCents),
      },
    });

    console.log("[customer-balance-payment] Checkout session created:", session.id);

    return new Response(
      JSON.stringify({ sessionId: session.id, url: session.url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[customer-balance-payment] Fatal error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
