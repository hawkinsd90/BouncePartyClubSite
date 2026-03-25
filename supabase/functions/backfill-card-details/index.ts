import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, { apiVersion: "2024-10-28.acacia" });

    const { data: orders, error: ordersError } = await supabaseClient
      .from("orders")
      .select("id, stripe_payment_method_id, payment_method_brand, payment_method_last_four")
      .not("stripe_payment_method_id", "is", null)
      .or("payment_method_brand.is.null,payment_method_last_four.is.null");

    if (ordersError) {
      return new Response(
        JSON.stringify({ error: ordersError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const order of (orders || [])) {
      try {
        const pm = await stripe.paymentMethods.retrieve(order.stripe_payment_method_id);
        const brand = pm.card?.brand || null;
        const last4 = pm.card?.last4 || null;

        if (!brand && !last4) {
          failed++;
          continue;
        }

        const updateFields: Record<string, string> = {};
        if (brand && !order.payment_method_brand) updateFields.payment_method_brand = brand;
        if (last4 && !order.payment_method_last_four) updateFields.payment_method_last_four = last4;

        if (Object.keys(updateFields).length === 0) continue;

        const { error: updateError } = await supabaseClient
          .from("orders")
          .update(updateFields)
          .eq("id", order.id);

        if (updateError) {
          failed++;
          errors.push(`${order.id}: ${updateError.message}`);
        } else {
          updated++;
        }
      } catch (err: any) {
        failed++;
        errors.push(`${order.id}: ${err.message}`);
      }
    }

    return new Response(
      JSON.stringify({ total: orders?.length ?? 0, updated, failed, errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
