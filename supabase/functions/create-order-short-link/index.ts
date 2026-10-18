import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";

// RETIRED (Step 3B, SEC-032). It called the legacy create_order_short_link RPC, which 20261009/20261012 revoke from every browser role, so the function could only fail. Portal links are created by portal-link and request-portal-link. Nothing calls it.
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
