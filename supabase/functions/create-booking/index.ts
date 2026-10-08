import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import { resolveCaller } from "../_shared/auth.ts";
import { createBookingRequest } from "../_shared/booking/createBooking.ts";
import { supabaseAvailabilityPort } from "../_shared/booking/bookingAvailability.ts";

// Public booking creation (Payment Safety A2.3).
//
// The browser sends what the customer CHOSE (contact, address, dates, item ids and quantities, consent booleans). This
// function owns everything else: customer resolution, address, item identity and prices, tax, setup fee, required
// deposit, availability, the order's status and payment columns, and the booking proof that later authorizes the Stripe
// card-SAVE session. It never talks to Stripe and never charges anyone.
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
    const rate = await checkRateLimit("create-booking", buildRateLimitKey(ip, undefined, "create-booking"), undefined, true);
    if (!rate.allowed) {
      if (rate.reason === "missing_identifier") return respond(400, { success: false, error: "Invalid request: unable to identify client" });
      return createRateLimitResponse(rate, corsHeaders);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return respond(400, { success: false, error: "Invalid request", code: "INVALID_REQUEST" });
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const caller = await resolveCaller(db, req.headers.get("Authorization"), serviceKey);

    const result = await createBookingRequest(
      {
        db,
        availability: supabaseAvailabilityPort(db),
        callerUserId: caller.kind === "user" ? caller.userId : null,
        meta: { ip_address: ip || null, user_agent: req.headers.get("user-agent") },
      },
      body,
    );
    return respond(result.status, result.body);
  } catch {
    console.error("[create-booking] failed");
    return respond(500, { success: false, error: "We could not create your booking. Please try again.", code: "CREATE_FAILED" });
  }
});
