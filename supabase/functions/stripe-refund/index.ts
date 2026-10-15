import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import { resolveCaller, requireRoles, authFailureResponse, STAFF_ADMIN_ROLES } from "../_shared/auth.ts";
import { runRefundOperation } from "../_shared/payments/refund-operations.ts";

// STRIPE REFUND - the only way staff money goes back to a customer's card.
//
// A refund request carries an `operationKey` that the caller keeps when it retries (a double click, a timeout, a reload). The
// request is reserved in the database under the order lock BEFORE Stripe is called, each Stripe request carries a stable
// idempotency key, and a retry with the same key settles the same refund instead of creating another (see
// _shared/payments/refund-operations.ts). Admin / Master only; there is no customer or anonymous access.
//
// Everything is written through the service role: the browser has no write access to the refund or payment tables.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const caller = await resolveCaller(db, req.headers.get("Authorization"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const gate = requireRoles(caller, STAFF_ADMIN_ROLES, { unauthorized: "Unauthorized", forbidden: "Admin access required" });
    if (!gate.ok) {
      return authFailureResponse(gate, corsHeaders, "error-only");
    }

    const ip = getIdentifier(req);
    const identifier = buildRateLimitKey(ip, gate.userId, "refund");
    const rateLimitResult = await checkRateLimit("stripe-refund", identifier);
    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return respond(400, { success: false, code: "INVALID_REQUEST", error: "Invalid request." });
    }

    const { data: stripeKeyData } = await db.from("admin_settings").select("value").eq("key", "stripe_secret_key").maybeSingle();
    if (!stripeKeyData?.value) {
      return respond(500, { success: false, error: "Stripe not configured" });
    }
    const stripe = new Stripe(stripeKeyData.value, { apiVersion: "2024-10-28.acacia" });

    const result = await runRefundOperation(
      { db, stripe },
      {
        orderId: body.orderId, operationKey: body.operationKey, amountCents: body.amountCents, reason: body.reason, actorId: gate.userId,
        // Present only for an allocation-aware request; the actor is always the verified caller, never a value from the body.
        ...(Object.prototype.hasOwnProperty.call(body, "allocations") ? { allocations: body.allocations } : {}),
      },
    );
    return respond(result.status, result.body);
  } catch (error: unknown) {
    console.error("Stripe refund error:", error instanceof Error ? error.message : "unknown");
    return respond(500, { success: false, error: "Failed to process refund. If a refund may have been started, retry the same request; it will not be refunded twice." });
  }
});
