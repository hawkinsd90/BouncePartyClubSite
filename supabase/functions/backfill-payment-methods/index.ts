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

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get Stripe secret key from database
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

    // Get all payments that have a stripe_payment_intent_id but no payment_method
    const { data: payments, error: fetchError } = await supabaseClient
      .from("payments")
      .select("id, stripe_payment_intent_id")
      .not("stripe_payment_intent_id", "is", null)
      .is("payment_method", null);

    if (fetchError) {
      throw new Error(`Failed to fetch payments: ${fetchError.message}`);
    }

    if (!payments || payments.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No payments to backfill",
          updated: 0
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Found ${payments.length} payments to backfill`);

    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (const payment of payments) {
      try {
        // Retrieve payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(
          payment.stripe_payment_intent_id,
          {
            expand: ["payment_method"],
          }
        );

        let paymentMethodType: string | null = null;
        let paymentBrand: string | null = null;
        let paymentLast4: string | null = null;

        // Extract payment method details
        if (paymentIntent.payment_method) {
          const pm = paymentIntent.payment_method as unknown as { type?: string; card?: { brand?: string; last4?: string } };
          paymentMethodType = pm.type || null;

          if (pm.card) {
            paymentBrand = pm.card.brand || null;
            paymentLast4 = pm.card.last4 || null;
          } else if (pm.wallet && typeof pm.wallet === 'object') {
            // Handle wallet payments (Apple Pay, Google Pay, etc.)
            if ('type' in pm.wallet) {
              paymentMethodType = pm.wallet.type || paymentMethodType;
            }
            // If it's a wallet payment with card details
            if (pm.type === 'card' && pm.card) {
              paymentBrand = pm.card.brand || null;
              paymentLast4 = pm.card.last4 || null;
            }
          }
        }

        // Update the payment record
        const { error: updateError } = await supabaseClient
          .from("payments")
          .update({
            payment_method: paymentMethodType,
            payment_brand: paymentBrand,
            payment_last4: paymentLast4,
          })
          .eq("id", payment.id);

        if (updateError) {
          throw new Error(`Failed to update payment ${payment.id}: ${updateError.message}`);
        }

        successCount++;
        console.log(`✅ Updated payment ${payment.id} with method: ${paymentMethodType}`);
      } catch (err: unknown) {
        failCount++;
        const message = err instanceof Error ? err.message : String(err);
        const errorMsg = `Payment ${payment.id}: ${message}`;
        errors.push(errorMsg);
        console.error(`❌ ${errorMsg}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Backfill complete`,
        total: payments.length,
        updated: successCount,
        failed: failCount,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("❌ [BACKFILL] Error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({
        success: false,
        error: message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});