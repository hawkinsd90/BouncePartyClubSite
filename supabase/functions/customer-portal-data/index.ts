import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { resolveCaller, authorizePortalOrder } from "../_shared/auth.ts";
import {
  projectOrder,
  projectOrderItem,
  projectDiscount,
  projectCustomFee,
  projectChangelogEntry,
  projectInvoiceLink,
  projectLotPicture,
  projectPicture,
  projectDelivery,
  projectPayment,
  projectPricing,
} from "../_shared/portal-projection.ts";

// Customer Portal read boundary (Payment Safety A2.2).
//
// The browser sends { orderId, token?, sections?, paymentId? }; the server decides who is asking:
//   - a valid, unexpired, unrevoked portal/invoice token bound to THIS order, or
//   - the signed-in customer who owns THIS order, or
//   - the backend, or an admin/master opening the portal read-only for support.
// A raw order id, email, phone, name, the public anon key or a short code is never enough. Every failure (unknown order,
// wrong token, expired, revoked, someone else's order) is the same 403 so the endpoint cannot be used to probe.
//
// The response is a fixed projection (see _shared/portal-projection.ts). It never contains Stripe identifiers, staff
// notes, other customers or orders, token lists, or raw processor data.
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

const denied = () => json({ success: false, error: "access_required" }, 403);

const ALL_SECTIONS = ["core", "summary", "changelog", "invoiceLink", "lotPictures", "pictures", "delivery", "payment"] as const;
const CHANGELOG_STATUSES = ["awaiting_customer_approval", "pending_review"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return denied();

  try {
    let body: { orderId?: unknown; token?: unknown; sections?: unknown; paymentId?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return denied();
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const caller = await resolveCaller(supabase, req.headers.get("Authorization"), serviceKey);
    const proof = await authorizePortalOrder(supabase, {
      orderId: body.orderId,
      token: body.token,
      caller,
      allowStaffRead: true,
    });
    if (!proof) return denied();
    const orderId = body.orderId as string;

    const requested = Array.isArray(body.sections)
      ? (body.sections as unknown[]).filter((s): s is (typeof ALL_SECTIONS)[number] => ALL_SECTIONS.includes(s as never))
      : [...ALL_SECTIONS];
    const want = new Set<string>(requested.length ? requested : ["core"]);

    const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (orderError || !order) return denied();

    const data: Record<string, unknown> = {};

    if (want.has("core")) {
      const [customerRes, addressRes, paymentsRes] = await Promise.all([
        order.customer_id ? supabase.from("customers").select("*").eq("id", order.customer_id).maybeSingle() : Promise.resolve({ data: null }),
        order.address_id ? supabase.from("addresses").select("*").eq("id", order.address_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("payments").select("*").eq("order_id", orderId).order("created_at", { ascending: false }),
      ]);
      data.order = projectOrder(order, {
        customer: customerRes.data,
        address: addressRes.data,
        payments: (paymentsRes.data as Record<string, unknown>[] | null) ?? [],
      });
    }

    if (want.has("summary")) {
      const [itemsRes, discountsRes, feesRes, pricingRes] = await Promise.all([
        supabase.from("order_items").select("*, units(*)").eq("order_id", orderId),
        supabase.from("order_discounts").select("*").eq("order_id", orderId),
        supabase.from("order_custom_fees").select("*").eq("order_id", orderId),
        supabase.from("pricing_rules").select("*").maybeSingle(),
      ]);
      data.orderItems = ((itemsRes.data as Record<string, unknown>[] | null) ?? []).map(projectOrderItem);
      data.discounts = ((discountsRes.data as Record<string, unknown>[] | null) ?? []).map(projectDiscount);
      data.customFees = ((feesRes.data as Record<string, unknown>[] | null) ?? []).map(projectCustomFee);
      data.pricing = projectPricing(pricingRes.data as Record<string, unknown> | null);
    }

    if (want.has("changelog")) {
      let changelog: Record<string, unknown>[] = [];
      if (CHANGELOG_STATUSES.includes(order.status)) {
        const { data: rows } = await supabase
          .from("order_changelog")
          .select("*")
          .eq("order_id", orderId)
          .order("created_at", { ascending: false });
        changelog = ((rows as Record<string, unknown>[] | null) ?? []).map(projectChangelogEntry);
      }
      data.changelog = changelog;
    }

    if (want.has("invoiceLink")) {
      // Only an admin invoice link is exposed as an "invoice" (the portal link is the credential, not an invoice).
      let invoiceLink: Record<string, unknown> | null = null;
      if (proof.kind === "token") {
        invoiceLink = proof.link.link_type === "invoice" ? (proof.link as unknown as Record<string, unknown>) : null;
      } else {
        const { data: rows } = await supabase
          .from("invoice_links")
          .select("id, link_type, customer_filled, deposit_cents, expires_at, revoked_at")
          .eq("order_id", orderId)
          .eq("link_type", "invoice")
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
          .limit(1);
        invoiceLink = ((rows as Record<string, unknown>[] | null) ?? [])[0] ?? null;
      }
      data.invoiceLink = projectInvoiceLink(invoiceLink);
    }

    if (want.has("lotPictures")) {
      const { data: rows } = await supabase
        .from("order_lot_pictures")
        .select("*")
        .eq("order_id", orderId)
        .order("uploaded_at", { ascending: false });
      data.lotPictures = ((rows as Record<string, unknown>[] | null) ?? []).map(projectLotPicture);
    }

    if (want.has("pictures")) {
      const { data: rows } = await supabase
        .from("order_pictures")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });
      data.pictures = ((rows as Record<string, unknown>[] | null) ?? []).map(projectPicture);
    }

    if (want.has("delivery")) {
      const { data: rows } = await supabase
        .from("task_status")
        .select("delivery_images, completed_time, updated_at, status")
        .eq("order_id", orderId)
        .eq("task_type", "drop-off")
        .order("created_at", { ascending: false })
        .limit(1);
      data.delivery = projectDelivery(((rows as Record<string, unknown>[] | null) ?? [])[0] ?? null);
    }

    if (want.has("payment") && typeof body.paymentId === "string") {
      const { data: row } = await supabase
        .from("payments")
        .select("*")
        .eq("id", body.paymentId)
        .eq("order_id", orderId)
        .maybeSingle();
      data.payment = row ? projectPayment(row as Record<string, unknown>) : null;
    }

    return json({ success: true, viewer: proof.kind, data });
  } catch {
    console.error("[customer-portal-data] failed");
    return json({ success: false, error: "unavailable" }, 500);
  }
});
