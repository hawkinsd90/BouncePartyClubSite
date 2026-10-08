import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import Stripe from "npm:stripe@20.0.0";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import { resolveCaller, proveOrderAccess, authFailureResponse, type AuthClient } from "../_shared/auth.ts";

// Post-Stripe completion data for the public booking flow (Payment Safety A2.3).
//
// After Stripe returns the customer to /payment-complete the browser used to read orders, customers, addresses, order
// items and invoice_links straight from the database and flip booking_confirmation_sent itself. It now asks this
// function, which first requires the same proof the other completion endpoints require: a COMPLETED Stripe Checkout
// session whose metadata.order_id is exactly this order (the session id is only ever delivered in the customer's own
// Stripe redirect). A raw order id proves nothing.
//
//   action "details"                -> a narrow projection of the order for the confirmation page (the secure portal link is
//                                      obtained separately from portal-link with the same Stripe session proof)
//   action "mark_confirmation_sent" -> sets booking_confirmation_sent (false -> true only)
//
// This function never charges, never changes status or payment columns, and never returns Stripe or admin fields.
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

const ORDER_PROJECTION = `
  id, status, event_date, start_window, end_window, location_type, surface, special_details,
  subtotal_cents, travel_fee_cents, surface_fee_cents, same_day_pickup_fee_cents, tax_cents, tip_cents,
  deposit_due_cents, balance_due_cents, customer_selected_payment_cents, travel_total_miles, booking_confirmation_sent,
  customer:customers!customer_id ( first_name, last_name, email, phone ),
  addresses ( line1, city, state, zip ),
  order_items (
    qty, wet_or_dry, unit_price_cents, unit_id, product_id, bundle_id, item_name, pricing_context, component_snapshot,
    units ( name )
  )
`;

async function retrieveCheckoutSession(supabase: AuthClient, sessionId: string) {
  const { data: keyData } = await supabase.from("admin_settings").select("value").eq("key", "stripe_secret_key").maybeSingle();
  if (!keyData?.value) return null;
  const stripe = new Stripe(keyData.value, { apiVersion: "2024-10-28.acacia" });
  return await stripe.checkout.sessions.retrieve(sessionId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { success: false, error: "Method not allowed" });

  try {
    const ip = getIdentifier(req);
    const rate = await checkRateLimit("complete-booking", buildRateLimitKey(ip, undefined, "complete-booking"), undefined, true);
    if (!rate.allowed) {
      if (rate.reason === "missing_identifier") return respond(400, { success: false, error: "Invalid request: unable to identify client" });
      return createRateLimitResponse(rate, corsHeaders);
    }

    let body: { orderId?: unknown; sessionId?: unknown; action?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return respond(400, { success: false, error: "Invalid request" });
    }
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const action = body.action === "mark_confirmation_sent" ? "mark_confirmation_sent" : "details";
    if (!orderId || !sessionId) return respond(400, { success: false, error: "Missing order or session" });

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const caller = await resolveCaller(supabase, req.headers.get("Authorization"), serviceKey);

    const proof = await proveOrderAccess(supabase, {
      orderId,
      caller,
      sessionId,
      accept: ["stripe_session"],
      retrieveCheckoutSession: (id: string) => retrieveCheckoutSession(supabase, id),
      sessionModes: ["setup", "payment"],
    });
    if (!proof) {
      console.warn(`[complete-booking] rejected: caller=${caller.kind} reason=no_order_proof`);
      return authFailureResponse(
        { ok: false, status: caller.kind === "anonymous" ? 401 : 403, error: "Not authorized for this order." },
        corsHeaders,
      );
    }

    if (action === "mark_confirmation_sent") {
      const { error } = await supabase
        .from("orders")
        .update({ booking_confirmation_sent: true })
        .eq("id", orderId)
        .eq("booking_confirmation_sent", false)
        .neq("status", "draft");
      return respond(error ? 500 : 200, { success: !error });
    }

    const { data: order, error: orderError } = await supabase.from("orders").select(ORDER_PROJECTION).eq("id", orderId).maybeSingle();
    if (orderError || !order) return respond(404, { success: false, error: "Order not found" });

    const { data: invoiceLink } = await supabase
      .from("invoice_links")
      .select("id")
      .eq("order_id", orderId)
      .eq("link_type", "invoice")
      .limit(1);
    const isAdminInvoice = Array.isArray(invoiceLink) && invoiceLink.length > 0;

    // The tip the customer chose is a fact of the order; the Stripe session metadata only repeats it.
    const tipCents = typeof order.tip_cents === "number" ? order.tip_cents : 0;

    return respond(200, { success: true, order, isAdminInvoice, tipCents });
  } catch {
    console.error("[complete-booking] failed");
    return respond(500, { success: false, error: "Could not load your booking." });
  }
});
