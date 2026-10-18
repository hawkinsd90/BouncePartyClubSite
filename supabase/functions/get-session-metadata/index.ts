import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";

// RETIRED (Step 3B, SEC-023). It returned the metadata, payment status and amount of ANY Stripe Checkout session to any caller holding the public anon key. No application code, database object or backend function calls it (checked in src/, supabase/functions and supabase/migrations). Booking-return flows use complete-booking, save-payment-method-from-session and reconcile-balance-payment, which verify the session against the order.
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
