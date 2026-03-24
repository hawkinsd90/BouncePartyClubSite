import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
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

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { orderId } = await req.json();

    if (!orderId || typeof orderId !== "string") {
      return new Response(JSON.stringify({ error: "orderId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify the order exists before serving any signature data.
    // This prevents callers who have fabricated a UUID from probing
    // whether a signature row exists without a corresponding order.
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(JSON.stringify({ signed: false, data: null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Return only the columns needed for the customer portal display.
    // Sensitive columns (waiver_text_snapshot, home_address_*, device_info,
    // user_agent, electronic_consent_text, typed_name) are intentionally omitted.
    const { data: sig, error: sigError } = await supabaseClient
      .from("order_signatures")
      .select(
        "signed_at, signer_name, signer_email, waiver_version, ip_address, initials_data, signature_image_url, pdf_url"
      )
      .eq("order_id", orderId)
      .maybeSingle();

    if (sigError) {
      console.error("[get-waiver-status] Signature query error:", sigError.message);
      return new Response(JSON.stringify({ error: "Failed to load waiver status" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ signed: !!sig, data: sig ?? null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[get-waiver-status] Fatal error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
