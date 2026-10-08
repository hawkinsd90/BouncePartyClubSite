import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import { checkPublicUnitAvailability } from "../_shared/booking/publicAvailability.ts";
import { supabaseAvailabilityPort } from "../_shared/booking/bookingAvailability.ts";

// Public inflatable availability (Payment Safety A2.3). Replaces the browser's direct reads of orders / order_items.
// The answer is a boolean per requested unit. It never returns orders, customers, addresses, statuses or dates of other
// bookings. The rules are the same ones create-booking enforces (shared module).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { success: false, error: "Method not allowed" });

  try {
    const ip = getIdentifier(req);
    const rate = await checkRateLimit("check-availability", buildRateLimitKey(ip, undefined, "availability"), undefined, true);
    if (!rate.allowed) {
      if (rate.reason === "missing_identifier") return respond(400, { success: false, error: "Invalid request: unable to identify client" });
      return createRateLimitResponse(rate, corsHeaders);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return respond(400, { success: false, error: "Invalid request" });
    }

    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const result = await checkPublicUnitAvailability(supabaseAvailabilityPort(db), body);
    return respond(result.status, result.body);
  } catch {
    console.error("[check-availability] failed");
    return respond(500, { success: false, error: "Could not check availability." });
  }
});
