import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";

// RETIRED (Step 3B, SEC-024). It returned the card brand and last four digits of ANY Stripe payment method id to any caller holding the public anon key (verify_jwt = true only checks the signature, which the anon key passes). No application code, database object or backend function calls it.
//
// It now answers 410 to every request and never reaches Stripe, the database or any other service.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({ success: false, code: "ENDPOINT_RETIRED", error: "This endpoint is no longer available." }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
