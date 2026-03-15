import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

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
    const { sessionId, orderId } = await req.json();

    if (!sessionId || !orderId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
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

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    console.log(`[SAVE-PM] Session mode: ${session.mode}, status: ${session.status}`);

    let paymentMethodId = null;

    // For setup mode, get payment method from SetupIntent
    if (session.mode === "setup" && session.setup_intent) {
      const setupIntentId = typeof session.setup_intent === "string"
        ? session.setup_intent
        : session.setup_intent.id;

      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

      paymentMethodId = typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id || null;

      console.log(`[SAVE-PM] Retrieved payment method from SetupIntent: ${paymentMethodId}`);
    }
    // For payment mode, get from session directly
    else if (session.payment_method) {
      paymentMethodId = typeof session.payment_method === "string"
        ? session.payment_method
        : session.payment_method.id || null;

      console.log(`[SAVE-PM] Retrieved payment method from session: ${paymentMethodId}`);
    }

    if (!paymentMethodId) {
      console.warn(`[SAVE-PM] No payment method found for session ${sessionId}`);
      return new Response(
        JSON.stringify({ success: false, error: "No payment method found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Retrieve brand + last4 so the approval modal can display them before any charge
    let cardBrand: string | null = null;
    let cardLast4: string | null = null;
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      cardBrand = pm.card?.brand || null;
      cardLast4 = pm.card?.last4 || null;
    } catch (err) {
      console.error(`[SAVE-PM] Failed to retrieve payment method ${paymentMethodId}:`, err);
    }

    // Save payment method to order
    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({
        stripe_payment_method_id: paymentMethodId,
        ...(cardBrand ? { payment_method_brand: cardBrand } : {}),
        ...(cardLast4 ? { payment_method_last_four: cardLast4 } : {}),
      })
      .eq("id", orderId);

    if (updateError) {
      console.error(`[SAVE-PM] Error updating order:`, updateError);
      return new Response(
        JSON.stringify({ success: false, error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[SAVE-PM] Successfully saved payment method ${paymentMethodId} to order ${orderId}`);

    return new Response(
      JSON.stringify({ success: true, paymentMethodId }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("[SAVE-PM] Error:", error);
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
