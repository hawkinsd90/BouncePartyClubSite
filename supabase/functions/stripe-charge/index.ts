import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";

// RETIRED. This endpoint used to create a Stripe charge for any amount an admin's browser sent, without a local payment
// record (its ledger insert wrote columns that do not exist, and nothing checked it). It has no caller in the application:
// the admin "Charge card on file" button uses charge-deposit, whose amounts the server derives and whose charge is a payment
// operation with a stable idempotency key.
//
// It now answers 410 to every request and never reaches Stripe or the database. Admin card charges: charge-deposit.

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
