import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import Stripe from "npm:stripe@20.0.0";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import { resolveCaller, proveOrderAccess, authFailureResponse, type AuthClient } from "../_shared/auth.ts";
import { sendOrderCustomerNotice } from "../_shared/customer-notice.ts";
import { validateCustomerNotice } from "../_shared/portal/portal-actions.ts";

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
//   action "send_confirmation"      -> sends the booking confirmation email / text to the customer ON THE ORDER (never to an address the
//                                      browser supplies), through the notification relays as the backend. The sent state belongs to
//                                      the server: the order is CLAIMED atomically before anything is sent (claim_booking_confirmation),
//                                      and only a delivered email finalizes it (booking_confirmation_sent = true). A failed delivery
//                                      releases the claim; a crashed request leaves a claim that goes stale and can be taken over.
//                                      A request that finds a live claim is told "busy", never "sent".
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

// A claim older than this is an abandoned one (its request crashed) and may be taken over. An Edge Function request is cut off
// well before ten minutes, so a live request is never overtaken.
const CONFIRMATION_CLAIM_STALE_SECONDS = 600;

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

    let body: { orderId?: unknown; sessionId?: unknown; action?: unknown; notice?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return respond(400, { success: false, error: "Invalid request" });
    }
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const action = body.action === "send_confirmation" ? "send_confirmation" : "details";
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

    if (action === "send_confirmation") {
      const notice = validateCustomerNotice(body.notice);
      if (!notice) return respond(400, { success: false, error: "Invalid request" });

      // Take the claim first. The claim id is generated here and is the only key that can finalize or release it.
      const claimId = crypto.randomUUID();
      const { data: claim, error: claimError } = await supabase.rpc("claim_booking_confirmation", {
        p_order_id: orderId,
        p_claim_id: claimId,
        p_stale_seconds: CONFIRMATION_CLAIM_STALE_SECONDS,
      });
      if (claimError) return respond(500, { success: false, error: "Could not send your confirmation." });
      if (claim === "invalid") return respond(409, { success: false, error: "Order is not ready for a confirmation" });
      if (claim === "already_sent") return respond(200, { success: true, alreadySent: true, emailSent: true, emailError: null, smsSent: false });
      // Another request is sending it right now: say so. It is not "sent" until that request finalizes it.
      if (claim === "busy") {
        return respond(200, { success: true, busy: true, alreadySent: false, emailSent: false, emailError: "Your confirmation is already being sent.", smsSent: false });
      }
      if (claim !== "claimed") return respond(500, { success: false, error: "Could not send your confirmation." });

      let sent = { emailSent: false, emailError: "Confirmation could not be sent" as string | null, smsSent: false };
      let delivered = false;
      // Whether the database accepted the finalize / release. A resolved RPC is not a successful one: supabase-js reports database
      // failures as { error } without throwing, and the functions return false when this request no longer owns the claim.
      let stateRecorded = false;
      try {
        sent = await sendOrderCustomerNotice(supabase, { supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "", serviceKey }, orderId, notice, fetch);
        // "Sent" keeps its existing meaning: the customer's confirmation email went out (a text alone failing does not matter).
        delivered = notice.emailHtml !== undefined ? sent.emailSent : sent.smsSent;
      } finally {
        // Delivered: finalize with the exact claim. Anything else - including no provider attempt and a thrown error - releases the
        // same claim so the confirmation can be retried. Neither can touch a claim this request does not own.
        try {
          const { data, error } = await supabase.rpc(delivered ? "finalize_booking_confirmation" : "release_booking_confirmation", { p_order_id: orderId, p_claim_id: claimId });
          stateRecorded = !error && data === true;
        } catch {
          stateRecorded = false;
        }
        if (!stateRecorded) {
          // Delivered but not recorded: the email really went out, so it is reported as sent and NOT re-sent in this request; the claim
          // stays until it goes stale. Not delivered and not released: the claim also stays until it goes stale, so a retry in the
          // meantime is told "busy". Nothing about the database failure is shown to the customer.
          console.error(`[complete-booking] could not record the confirmation state (delivered=${delivered})`);
        }
      }
      return respond(200, { success: true, ...sent, stateRecorded });
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
