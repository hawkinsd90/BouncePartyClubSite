import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import Stripe from "npm:stripe@20.0.0";
import {
  resolveCaller,
  requireRoles,
  isStaffAdmin,
  proveOrderAccess,
  authFailureResponse,
  INVOICE_SENDER_ROLES,
  type AuthClient,
} from "../_shared/auth.ts";
import { getOrCreatePortalLink, revokePortalLinks } from "../_shared/portal-link.ts";

// Issues (or reuses) the canonical customer portal short link for an order.
//
// Who may ask:
//   - the backend (service role) and signed-in admin / master / crew. Crew may create and share the customer's secure
//     link (that is all this endpoint gives them; it grants no card, refund or cancel capability);
//   - a customer who already proves control of THIS order: a valid unexpired, unrevoked order token, the signed-in
//     owner, or the completed Stripe Checkout session of the booking they just submitted (that is how a guest who
//     just booked is handed their first secure link). A raw order UUID proves nothing and is denied.
// "revoke" is limited to admin / master / service.
//
// The response carries the short code only. The token itself is never returned to the browser by this endpoint.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Stripe Checkout session lookup (key loaded lazily from admin_settings, like order-lifecycle).
async function retrieveCheckoutSession(supabase: AuthClient, sessionId: string) {
  const { data: keyData } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", "stripe_secret_key")
    .maybeSingle();
  if (!keyData?.value) return null;
  const stripe = new Stripe(keyData.value, { apiVersion: "2024-10-28.acacia" });
  return await stripe.checkout.sessions.retrieve(sessionId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const caller = await resolveCaller(supabase, req.headers.get("Authorization"), supabaseServiceKey);

    let body: { orderId?: unknown; action?: unknown; token?: unknown; sessionId?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error: "Invalid request" }, 400);
    }
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const action = body.action === "revoke" ? "revoke" : "get";
    if (!orderId) return json({ success: false, error: "Missing order ID" }, 400);

    const isStaff = caller.kind === "service" || requireRoles(caller, INVOICE_SENDER_ROLES).ok;

    if (action === "revoke") {
      if (caller.kind !== "service" && !isStaffAdmin(caller)) {
        return authFailureResponse(
          { ok: false, status: caller.kind === "anonymous" ? 401 : 403, error: "Not authorized." },
          corsHeaders,
        );
      }
      const revoked = await revokePortalLinks(supabase, orderId);
      return json({ success: revoked }, revoked ? 200 : 500);
    }

    if (!isStaff) {
      const proof = await proveOrderAccess(supabase, {
        orderId,
        caller,
        token: body.token,
        sessionId: body.sessionId,
        accept: ["token", "owner", "stripe_session"],
        retrieveCheckoutSession: (id: string) => retrieveCheckoutSession(supabase, id),
        sessionModes: ["setup", "payment"],
      });
      if (!proof) {
        console.warn(
          `[portal-link] rejected: caller=${caller.kind}${caller.kind === "user" ? ` user=${caller.userId}` : ""} reason=no_order_proof`,
        );
        return authFailureResponse(
          { ok: false, status: caller.kind === "anonymous" ? 401 : 403, error: "Not authorized for this order." },
          corsHeaders,
        );
      }
    }

    const result = await getOrCreatePortalLink(supabase, orderId);
    if (!result.ok) {
      return json({ success: false, error: "Could not create the link." }, result.error === "order_not_found" ? 404 : 500);
    }
    return json({ success: true, shortCode: result.link.shortCode });
  } catch {
    console.error("[portal-link] failed");
    return json({ success: false, error: "Could not create the link." }, 500);
  }
});
