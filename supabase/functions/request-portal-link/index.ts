import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { getOrCreatePortalLink, shortPortalUrl } from "../_shared/portal-link.ts";
import { checkRateLimit, getIdentifier } from "../_shared/rate-limit.ts";

// "Send me a secure link" for customers holding an old UUID-only link.
//
//   - Anonymous and public. The caller supplies only an order id.
//   - The recipient is ALWAYS taken from the stored order -> customer record. A destination can never be supplied.
//   - SMS is sent only when the order recorded SMS consent (orders.sms_consent === true); email needs no such flag.
//   - Whether or not the order exists, is eligible, is rate-limited, or the send worked, the response is the same
//     generic success, so this endpoint cannot be used to learn whether an order exists.
//   - Rate limited per caller IP and per order (a customer cannot be spammed by repeating the request).
//   - The link is the canonical portal link (reused when active); the message contains only the short URL.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GENERIC_MESSAGE = "If we found your order, we sent a secure access link to the contact information on file.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Orders that are not customer-facing yet never receive a portal link through this endpoint.
const INELIGIBLE_STATUSES = ["draft", "void"];

function generic(): Response {
  return new Response(JSON.stringify({ success: true, message: GENERIC_MESSAGE }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return generic();
  }

  try {
    let orderId = "";
    try {
      const body = await req.json();
      orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
    } catch {
      return generic();
    }
    if (!UUID_RE.test(orderId)) return generic();

    const ipLimit = await checkRateLimit("request-portal-link", getIdentifier(req));
    if (!ipLimit.allowed) return generic();
    const orderLimit = await checkRateLimit("request-portal-link-order", orderId, { maxRequests: 2, windowSeconds: 3600 });
    if (!orderLimit.allowed) return generic();

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: order } = await supabase
      .from("orders")
      .select("id, status, sms_consent, customers(first_name, email, phone)")
      .eq("id", orderId)
      .maybeSingle();
    if (!order || INELIGIBLE_STATUSES.includes(order.status)) return generic();

    const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
    const email = typeof customer?.email === "string" ? customer.email.trim() : "";
    const phone = typeof customer?.phone === "string" ? customer.phone.trim() : "";
    // Email may use the stored address. SMS needs the order's recorded consent: a stored phone number alone is not consent.
    const smsAllowed = !!phone && order.sms_consent === true;
    if (!email && !smsAllowed) return generic();

    const link = await getOrCreatePortalLink(supabase, orderId);
    if (!link.ok) return generic();

    const origin = Deno.env.get("SITE_URL") || "https://bouncepartyclub.com";
    const url = shortPortalUrl(origin, link.link.shortCode);
    const headers = { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

    const tasks: Promise<unknown>[] = [];
    if (email) {
      tasks.push(
        fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            to: email,
            subject: "Your secure Bounce Party Club order link",
            html: `<p>Hi ${customer?.first_name || "there"},</p><p>Use the secure link below to view your order, make payments and manage your booking.</p><p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;">Open My Order</a></p><p>Questions? Call us at (313) 889-3860</p>`,
          }),
        }).catch(() => undefined),
      );
    }
    if (smsAllowed) {
      tasks.push(
        fetch(`${supabaseUrl}/functions/v1/send-sms-notification`, {
          method: "POST",
          headers,
          body: JSON.stringify({ to: phone, message: `Your secure Bounce Party Club order link: ${url}` }),
        }).catch(() => undefined),
      );
    }
    await Promise.all(tasks);
    return generic();
  } catch {
    return generic();
  }
});
