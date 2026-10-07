import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { resolveCaller, authorizePortalOrder, hasCurrentInvoiceLink } from "../_shared/auth.ts";
import {
  validateAction,
  paymentSelectionIsValid,
  approvalSelectionIsValid,
  approvalTipIsValid,
  orderTotalCents,
  INVOICE_ONLY_ACTIONS,
  MAX_LOT_PICTURES,
} from "../_shared/portal-actions.ts";

// Customer Portal write boundary (Payment Safety A2.2).
//
// Only customer mutations that used to be direct browser table writes live here. Money movement (charging, refunds,
// balance payments, cancellation) stays in the existing hardened functions (charge-deposit, customer-balance-payment,
// stripe-checkout, customer-cancel-order, order-lifecycle).
//
// NOTHING HERE CONFIRMS AN ORDER. A valid token proves the customer may act on the order; it does not prove a deposit
// was collected or a card is on file. Approving changes and accepting a no-card invoice only RECORD the customer's
// inputs (payment selection, tip, consents, responsibility). The transition to "confirmed" is owned by order-lifecycle
// (and charge-deposit for a charged deposit), which validates the payment outcome. The one status write in this file is
// the customer's explicit rejection (-> cancelled), which claims no payment.
//
// Invoice-only actions (invoice_accept_details, invoice_select_payment, invoice_confirm_no_card) additionally require an
// Admin Invoice context: an invoice-type token, or (owner / backend) a current invoice-type link on the order. A normal
// portal token never authorizes them.
//
// Every call is { orderId, token?, action, payload }. The action is a name from a fixed list with an exact payload
// shape (see _shared/portal-actions.ts); the caller cannot pick a table, column or filter. Proof of the exact order is
// required: a valid portal/invoice token bound to the order, or the signed-in owner (or the backend). Anything else is a
// uniform 403, so the endpoint cannot be used to probe for orders.
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
const badRequest = () => json({ success: false, error: "invalid_request" }, 400);
const wrongStatus = () => json({ success: false, error: "invalid_status" }, 409);

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const BLOCKED_STATUSES = ["pending_review", "awaiting_customer_approval", "approved", "confirmed", "in_progress", "completed"];

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return denied();

  try {
    let body: { orderId?: unknown; token?: unknown; action?: unknown; payload?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return denied();
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const db: Db = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const caller = await resolveCaller(db, req.headers.get("Authorization"), serviceKey);
    const proof = await authorizePortalOrder(db, { orderId: body.orderId, token: body.token, caller });
    if (!proof) return denied();
    const orderId = body.orderId as string;

    const action = validateAction(body.action, body.payload, orderId);
    if (!action) return badRequest();

    const { data: order, error: orderError } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (orderError || !order) return denied();

    if (INVOICE_ONLY_ACTIONS.includes(action.name) && !(await hasInvoiceContext(db, proof, orderId))) {
      return denied();
    }
    const nowIso = new Date().toISOString();

    switch (action.name) {
      case "invoice_accept_details": {
        if (order.status !== "draft") return wrongStatus();
        const p = action.payload as {
          customer?: { first_name: string; last_name: string; email: string; phone: string; business_name: string | null };
          cardOnFileConsent: boolean;
          smsConsent: boolean;
          referralSource?: string;
          referralSourceDetail?: string;
          tipCents?: number;
        };
        const update: Record<string, unknown> = {
          card_on_file_consent: p.cardOnFileConsent,
          sms_consent: p.smsConsent,
          invoice_accepted_at: nowIso,
        };

        if (p.customer) {
          // Only this order's own customer record may be edited. A caller-chosen email can never redirect the order to
          // (or overwrite) somebody else's customer record.
          if (order.customer_id) {
            const customerUpdate: Record<string, unknown> = {
              first_name: p.customer.first_name,
              last_name: p.customer.last_name,
              phone: p.customer.phone,
              ...(p.customer.business_name ? { business_name: p.customer.business_name } : {}),
            };
            const { data: clash } = await db
              .from("customers")
              .select("id")
              .eq("email", p.customer.email)
              .neq("id", order.customer_id)
              .maybeSingle();
            if (!clash) customerUpdate.email = p.customer.email;
            const { error } = await db.from("customers").update(customerUpdate).eq("id", order.customer_id);
            if (error) return json({ success: false, error: "save_failed" }, 500);
          } else {
            const { data: existing } = await db.from("customers").select("id").eq("email", p.customer.email).maybeSingle();
            if (existing) {
              update.customer_id = existing.id;
            } else {
              const { data: created, error } = await db
                .from("customers")
                .insert({
                  first_name: p.customer.first_name,
                  last_name: p.customer.last_name,
                  email: p.customer.email,
                  phone: p.customer.phone,
                  ...(p.customer.business_name ? { business_name: p.customer.business_name } : {}),
                })
                .select("id")
                .single();
              if (error || !created) return json({ success: false, error: "save_failed" }, 500);
              update.customer_id = created.id;
            }
          }
        }

        if (p.referralSource && !order.referral_source) {
          update.referral_source = p.referralSource;
          update.referral_source_detail = p.referralSourceDetail ?? null;
        }
        if (typeof p.tipCents === "number" && p.tipCents > 0) update.tip_cents = p.tipCents;

        const { error: orderUpdateError } = await db.from("orders").update(update).eq("id", orderId);
        if (orderUpdateError) return json({ success: false, error: "save_failed" }, 500);

        if (p.customer) {
          // The invoice link this visit came through (token proof) or the order's own invoice link (owner proof).
          let linkId: string | null = null;
          if (proof.kind === "token" && proof.link.link_type === "invoice") linkId = proof.link.id;
          else if (proof.kind !== "token") {
            const { data: rows } = await db
              .from("invoice_links")
              .select("id")
              .eq("order_id", orderId)
              .eq("link_type", "invoice")
              .is("revoked_at", null)
              .order("created_at", { ascending: false })
              .limit(1);
            linkId = rows?.[0]?.id ?? null;
          }
          if (linkId) await db.from("invoice_links").update({ customer_filled: true }).eq("id", linkId).eq("order_id", orderId);
        }
        return json({ success: true });
      }

      case "invoice_select_payment": {
        if (order.status !== "draft") return wrongStatus();
        const p = action.payload as { amountCents: number; type: string };
        if (!paymentSelectionIsValid(p, order)) return badRequest();
        const { error } = await db
          .from("orders")
          .update({ customer_selected_payment_cents: p.amountCents, customer_selected_payment_type: p.type })
          .eq("id", orderId);
        return error ? json({ success: false, error: "save_failed" }, 500) : json({ success: true });
      }

      case "invoice_confirm_no_card": {
        if (order.status !== "draft") return wrongStatus();
        // Only an invoice that really needs no card and no deposit may use the no-card path.
        if (order.require_card_on_file !== false || (order.deposit_due_cents ?? 0) !== 0) return wrongStatus();
        // Record the customer's acceptance and responsibility agreement. The order stays a draft: order-lifecycle
        // confirms it (outcome "waived") after this succeeds.
        const field = order.pickup_preference === "next_day" ? "overnight_responsibility_accepted" : "same_day_responsibility_accepted";
        const { error } = await db
          .from("orders")
          .update({ [field]: true, invoice_accepted_at: nowIso })
          .eq("id", orderId)
          .eq("status", "draft");
        return error ? json({ success: false, error: "save_failed" }, 500) : json({ success: true });
      }

      case "approve_changes": {
        if (order.status !== "awaiting_customer_approval") return wrongStatus();
        const p = action.payload as { selectedPaymentCents: number; selectedPaymentType: string; tipCents?: number };

        const [discountsRes, feesRes] = await Promise.all([
          db.from("order_discounts").select("amount_cents, percentage").eq("order_id", orderId),
          db.from("order_custom_fees").select("amount_cents").eq("order_id", orderId),
        ]);
        const total = orderTotalCents(order, discountsRes.data ?? [], feesRes.data ?? []);
        if (!approvalSelectionIsValid(p, order, total) || !approvalTipIsValid(p.tipCents, total)) {
          return json({ success: false, error: "invalid_selection" }, 400);
        }

        // A $0 deposit is only acceptable with a card on file for the final payment (the screen enforces this too).
        const alreadyPaid = order.stripe_payment_status === "paid" || (order.deposit_paid_cents ?? 0) > 0;
        if (p.selectedPaymentCents <= 0 && !alreadyPaid && !(order.stripe_customer_id && order.stripe_payment_method_id)) {
          return json({ success: false, error: "card_required" }, 409);
        }

        // Record the customer's inputs only. The order stays awaiting approval until order-lifecycle (or charge-deposit)
        // has established the payment outcome and confirms it.
        const update: Record<string, unknown> = {
          customer_selected_payment_cents: p.selectedPaymentCents,
          customer_selected_payment_type: p.selectedPaymentType,
        };
        if (typeof p.tipCents === "number") update.tip_cents = p.tipCents;
        const { error } = await db.from("orders").update(update).eq("id", orderId).eq("status", "awaiting_customer_approval");
        return error ? json({ success: false, error: "save_failed" }, 500) : json({ success: true });
      }

      case "reject_changes": {
        if (order.status !== "awaiting_customer_approval") return wrongStatus();
        const reason = (action.payload as { reason: string | null }).reason;
        const { error } = await db
          .from("orders")
          .update({ status: "cancelled", cancellation_reason: reason })
          .eq("id", orderId)
          .eq("status", "awaiting_customer_approval");
        if (error) return json({ success: false, error: "save_failed" }, 500);
        const { error: logError } = await db.from("order_changelog").insert({
          order_id: orderId,
          user_id: null,
          change_type: "status_change",
          field_changed: "status",
          old_value: order.status,
          new_value: reason ? `cancelled - ${reason}` : "cancelled",
          notes: null,
        });
        if (logError) console.error("[customer-portal-action] changelog insert failed");
        return json({ success: true });
      }

      case "register_lot_pictures": {
        const files = (action.payload as { files: { path: string; name: string }[] }).files;
        const { data: existing } = await db.from("order_lot_pictures").select("id").eq("order_id", orderId);
        if ((existing?.length ?? 0) + files.length > MAX_LOT_PICTURES) return badRequest();
        const { error } = await db
          .from("order_lot_pictures")
          .insert(files.map((f) => ({ order_id: orderId, file_path: f.path, file_name: f.name })));
        if (error) return json({ success: false, error: "save_failed" }, 500);
        if (order.lot_pictures_requested) await notifyAdminOfLotPictures(db, supabaseUrl, serviceKey, order, files.length);
        return json({ success: true });
      }

      case "delete_lot_picture": {
        // Same rule the screen applies: pictures can be removed only before the order is approved.
        if (!["pending_review", "awaiting_customer_approval"].includes(order.status)) return wrongStatus();
        const pictureId = (action.payload as { pictureId: string }).pictureId;
        const { data: picture } = await db
          .from("order_lot_pictures")
          .select("id, file_path")
          .eq("id", pictureId)
          .eq("order_id", orderId)
          .maybeSingle();
        if (!picture) return json({ success: false, error: "not_found" }, 404);
        const { error: storageError } = await db.storage.from("lot-pictures").remove([picture.file_path]);
        if (storageError) return json({ success: false, error: "delete_failed" }, 500);
        const { error } = await db.from("order_lot_pictures").delete().eq("id", pictureId).eq("order_id", orderId);
        return error ? json({ success: false, error: "delete_failed" }, 500) : json({ success: true });
      }

      case "register_order_pictures": {
        const p = action.payload as { files: { path: string; name: string; size: number; mimeType: string }[]; notes: string | null };
        const { error } = await db.from("order_pictures").insert(
          p.files.map((f) => ({
            order_id: orderId,
            file_path: f.path,
            file_name: f.name,
            file_size: f.size,
            mime_type: f.mimeType,
            notes: p.notes,
            uploaded_by: null,
          })),
        );
        return error ? json({ success: false, error: "save_failed" }, 500) : json({ success: true });
      }

      case "check_unit_availability": {
        return json({ success: true, available: await unitsAvailable(db, order) });
      }
    }
    return badRequest();
  } catch {
    console.error("[customer-portal-action] failed");
    return json({ success: false, error: "unavailable" }, 500);
  }
});

// An Admin Invoice context: the visit came through an invoice-type token, or (signed-in owner / backend) the order has a
// current invoice-type link that is unexpired and unrevoked. Ownership alone never turns an ordinary draft booking into
// an invoice.
async function hasInvoiceContext(
  db: Db,
  proof: { kind: string; link?: { link_type: string } },
  orderId: string,
): Promise<boolean> {
  if (proof.kind === "token") return proof.link?.link_type === "invoice";
  if (proof.kind !== "owner" && proof.kind !== "service") return false;
  return await hasCurrentInvoiceLink(db, orderId);
}

// Same inflatable availability rule the browser used, run against this order's OWN items and dates. Any failure to
// verify counts as "not available", exactly as before.
async function unitsAvailable(db: Db, order: { id: string; event_date: string; event_end_date: string | null }): Promise<boolean> {
  const { data: items, error } = await db.from("order_items").select("unit_id").eq("order_id", order.id);
  if (error) return false;
  const unitIds: string[] = Array.from(new Set((items ?? []).map((i: { unit_id: string | null }) => i.unit_id).filter(Boolean) as string[]));
  if (unitIds.length === 0) return true;

  const start = order.event_date;
  const end = order.event_end_date || order.event_date;
  const { data: blackout } = await db.rpc("check_date_blackout", { p_start: start.substring(0, 10), p_end: end.substring(0, 10) }).maybeSingle();
  if (blackout?.is_full_blocked) return false;

  for (const unitId of unitIds) {
    const { data: rows, error: queryError } = await db
      .from("order_items")
      .select("order_id, orders!inner(id, event_date, event_end_date, status)")
      .eq("unit_id", unitId)
      .in("orders.status", BLOCKED_STATUSES)
      .neq("order_id", order.id);
    if (queryError) return false;
    const checkStart = new Date(start);
    const checkEnd = new Date(end);
    const conflict = (rows ?? []).some((row: { orders: { event_date: string; event_end_date: string | null } | null }) => {
      const o = row.orders;
      if (!o) return false;
      const orderStart = new Date(o.event_date);
      const orderEnd = new Date(o.event_end_date as string);
      return (
        (checkStart >= orderStart && checkStart <= orderEnd) ||
        (checkEnd >= orderStart && checkEnd <= orderEnd) ||
        (checkStart <= orderStart && checkEnd >= orderEnd)
      );
    });
    if (conflict) return false;
  }
  return true;
}

// Admin heads-up when the customer uploads the lot pictures the admin asked for. Sent from the server so the browser
// no longer reads admin settings or calls the notification relays itself.
async function notifyAdminOfLotPictures(
  db: Db,
  supabaseUrl: string,
  serviceKey: string,
  order: { id: string; event_date: string | null; customer_id: string | null; address_id: string | null },
  count: number,
) {
  try {
    const [customerRes, addressRes, settingRes] = await Promise.all([
      order.customer_id ? db.from("customers").select("first_name, last_name").eq("id", order.customer_id).maybeSingle() : Promise.resolve({ data: null }),
      order.address_id ? db.from("addresses").select("line1, city, state").eq("id", order.address_id).maybeSingle() : Promise.resolve({ data: null }),
      db.from("admin_settings").select("value").eq("key", "admin_email").maybeSingle(),
    ]);
    const headers = { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const shortId = order.id.replace(/-/g, "").toUpperCase().slice(0, 8);
    const customerName = escapeHtml(`${customerRes.data?.first_name || ""} ${customerRes.data?.last_name || ""}`.trim());
    const a = addressRes.data;

    await fetch(`${supabaseUrl}/functions/v1/send-sms-notification`, {
      method: "POST",
      headers,
      body: JSON.stringify({ orderId: order.id, templateKey: "lot_pictures_uploaded_admin" }),
    }).catch(() => undefined);

    const adminEmail = settingRes.data?.value;
    if (adminEmail) {
      await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          to: adminEmail,
          subject: `Lot Pictures Uploaded - Order ${shortId}`,
          html: `<h2>Lot Pictures Uploaded</h2><p><strong>${customerName}</strong> has uploaded <strong>${count}</strong> picture${count > 1 ? "s" : ""} of the event location.</p><ul><li>Order ID: ${shortId}</li><li>Customer: ${customerName}</li><li>Event Date: ${escapeHtml(String(order.event_date ?? ""))}</li><li>Location: ${escapeHtml(a ? `${a.line1}, ${a.city}, ${a.state}` : "")}</li></ul>`,
        }),
      }).catch(() => undefined);
    }
  } catch {
    console.error("[customer-portal-action] admin notification failed");
  }
}
