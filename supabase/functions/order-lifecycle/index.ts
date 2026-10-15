import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import Stripe from "npm:stripe@20.0.0";
import { formatCurrency } from "../_shared/fmt.ts";
import { formatOrderId } from "../_shared/format-order-id.ts";
import {
  resolveCaller,
  isStaffAdmin,
  proveOrderAccess,
  findValidOrderLink,
  hasCurrentInvoiceLink,
  authFailureResponse,
  type AuthClient,
} from "../_shared/auth.ts";
import { evaluateCustomerConfirmation } from "../_shared/orders/lifecycle-outcome.ts";
import { storedOrderTotalCents } from "../_shared/booking/orderMoney.ts";
import { getOrCreatePortalLink } from "../_shared/portal-link.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { action, orderId, source, paymentOutcome, oldStatusHint, invoiceToken, sessionId } = body;

    if (!orderId || !action || typeof orderId !== "string") {
      return new Response(JSON.stringify({ error: "Missing required fields: orderId, action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ── Authorization (Payment Safety A1) ───────────────────────────────────
    // The browser sends the public anon key (or a user session token), neither of which proves anything about
    // an order. Trusted callers: the backend (service-role key) and signed-in admin/master users. Everyone else
    // must prove control of THIS order: an unexpired invoice token bound to the order, a signed-in customer who
    // owns it, or a completed Stripe Checkout session whose metadata.order_id is this order. The booking-request
    // transition (enter_pending_review) accepts only the Stripe session proof.
    const caller = await resolveCaller(
      supabase,
      req.headers.get("Authorization"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );
    const trustedCaller = caller.kind === "service" || isStaffAdmin(caller);

    // What kind of proof an untrusted caller holds is kept: for confirmation the lifecycle must know whether it was an
    // invoice-type token, a portal token, the owner's session or a Stripe session (see evaluateCustomerConfirmation).
    let customerProof: CustomerProof | null = null;

    if (!trustedCaller) {
      const tokenLink = action === "enter_pending_review" ? null : await findValidOrderLink(supabase, orderId, invoiceToken);
      let kind: string | null = tokenLink ? "token" : null;

      if (!kind) {
        kind = await proveOrderAccess(supabase, {
          orderId,
          caller,
          token: undefined,
          sessionId,
          accept: action === "enter_pending_review"
            ? ["stripe_session"]
            : ["owner", "stripe_session"],
          retrieveCheckoutSession: (id: string) => retrieveCheckoutSession(supabase, id),
        });
      }

      if (!kind) {
        console.warn(
          `[order-lifecycle] rejected: action=${action} caller=${caller.kind}${caller.kind === "user" ? ` user=${caller.userId}` : ""} reason=no_order_proof`
        );
        return authFailureResponse(
          { ok: false, status: caller.kind === "anonymous" ? 401 : 403, error: "Not authorized for this order." },
          corsHeaders
        );
      }
      customerProof = { kind, linkType: tokenLink?.link_type ?? null };
    }

    if (action === "enter_pending_review") {
      // console.log(`[order-lifecycle] enter_pending_review — orderId=${orderId} source=${source ?? "(none)"}`);
      const result = await enterPendingReview(supabase, orderId, source || "standard_checkout");
      // console.log(`[order-lifecycle] enter_pending_review result — success=${result.success} alreadySent=${result.alreadySent ?? false} error=${result.error ?? "(none)"}`);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "enter_confirmed") {
      // console.log(`[order-lifecycle] enter_confirmed — orderId=${orderId} source=${source ?? "(none)"} paymentOutcome=${paymentOutcome ?? "(none)"}`);
      const result = await enterConfirmed(supabase, orderId, source || "unknown", paymentOutcome || "already_paid", oldStatusHint || null, trustedCaller, customerProof);
      // console.log(`[order-lifecycle] enter_confirmed result — success=${result.success} alreadySent=${result.alreadySent ?? false} error=${result.error ?? "(none)"}`);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[order-lifecycle] Fatal error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Stripe Checkout session lookup for the customer-proof path. Loads the Stripe key lazily from admin_settings.
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

// ============================================================
// AUTHORITATIVE HANDLER A: enterPendingReview
// ============================================================
async function enterPendingReview(
  supabase: any,
  orderId: string,
  source: string
): Promise<{ success: boolean; error?: string; alreadySent?: boolean }> {
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select(`
      id, status, event_date, pending_review_admin_alerted,
      subtotal_cents, travel_fee_cents, surface_fee_cents,
      same_day_pickup_fee_cents, same_day_weekday_delivery_fee_cents, generator_fee_cents, setup_fee_cents, tax_cents,
      deposit_due_cents, balance_due_cents, tip_cents,
      start_window, end_window, location_type, surface,
      travel_total_miles,
      customers(first_name, last_name, email, phone),
      addresses(line1, city, state, zip),
      order_items(qty, wet_or_dry, unit_price_cents, units(name)),
      order_custom_fees(amount_cents),
      order_discounts(amount_cents, percentage)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError || !order) {
    // console.error(`[order-lifecycle] enterPendingReview — order fetch failed: orderId=${orderId} fetchError=${fetchError?.message ?? "(no error, order null)"}`);
    return { success: false, error: fetchError ? `DB fetch error: ${fetchError.message}` : "Order not found" };
  }

  // console.log(`[order-lifecycle] enterPendingReview — order found: status=${order.status} pending_review_admin_alerted=${order.pending_review_admin_alerted}`);

  const allowedFromStatuses = ["draft", "pending_review"];
  if (!allowedFromStatuses.includes(order.status)) {
    // console.error(`[order-lifecycle] enterPendingReview — invalid status transition: ${order.status} -> pending_review`);
    return {
      success: false,
      error: `Cannot enter pending_review from status: ${order.status}`,
    };
  }

  // Write changelog entry on first processing (before alreadySent check),
  // regardless of whether the DB status write was needed. This covers callers
  // that already wrote the status atomically alongside payment fields.
  if (!order.pending_review_admin_alerted) {
    const oldStatus = order.status === "pending_review" ? "draft" : order.status;

    if (order.status === "draft") {
      // console.log(`[order-lifecycle] enterPendingReview — updating status: draft -> pending_review`);
      const { error: updateError } = await supabase
        .from("orders")
        .update({ status: "pending_review" })
        .eq("id", orderId)
        .eq("status", "draft");

      if (updateError) {
        // console.error(`[order-lifecycle] enterPendingReview — status UPDATE failed: ${updateError.message}`);
        return { success: false, error: `Failed to update status: ${updateError.message}` };
      }
      // console.log(`[order-lifecycle] enterPendingReview — status updated to pending_review`);
    }

    // console.log(`[order-lifecycle] enterPendingReview — inserting changelog entry`);
    try {
      await supabase.from("order_changelog").insert({
        order_id: orderId,
        user_id: null,
        change_type: "status_change",
        field_changed: "status",
        old_value: oldStatus,
        new_value: "pending_review",
        notes: `Booking request submitted via ${source}`,
      });
      // console.log(`[order-lifecycle] enterPendingReview — changelog inserted`);
    } catch (e) {
      console.warn("[order-lifecycle] enterPendingReview — changelog insert failed (non-fatal):", e);
    }
  } else {
    // console.log(`[order-lifecycle] enterPendingReview — already alerted, skipping`);
    return { success: true, alreadySent: true };
  }

  // console.log(`[order-lifecycle] enterPendingReview — sending admin alert`);
  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  const address = Array.isArray(order.addresses) ? order.addresses[0] : order.addresses;

  // The booking exists and has passed the Stripe-session proof: issue its canonical portal link now (best effort,
  // one active link per order, reused if it already exists). No customer message depends on this call.
  try { await getOrCreatePortalLink(supabase, orderId); } catch { /* non-fatal */ }

  await sendAdminPendingReviewAlert(supabase, order, customer, address);

  await supabase
    .from("orders")
    .update({ pending_review_admin_alerted: true })
    .eq("id", orderId);

  // console.log(`[order-lifecycle] enterPendingReview — complete, pending_review_admin_alerted set`);
  return { success: true };
}

// ============================================================
// AUTHORITATIVE HANDLER B: enterConfirmed
// ============================================================
interface CustomerProof {
  kind: string;
  // link_type of the token when the proof was a token (invoice vs portal), else null
  linkType: string | null;
}

async function enterConfirmed(
  supabase: any,
  orderId: string,
  source: string,
  requestedOutcome: string,
  oldStatusHint: string | null = null,
  trustedCaller = false,
  customerProof: CustomerProof | null = null
): Promise<{ success: boolean; error?: string; alreadySent?: boolean }> {
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select(`
      id, status, event_date, confirmed_admin_alerted, customer_approved_at,
      stripe_customer_id, stripe_payment_method_id, stripe_payment_status, require_card_on_file,
      subtotal_cents, travel_fee_cents, surface_fee_cents,
      same_day_pickup_fee_cents, same_day_weekday_delivery_fee_cents, generator_fee_cents, setup_fee_cents, tax_cents,
      deposit_due_cents, balance_due_cents, tip_cents,
      deposit_paid_cents, start_window, end_window, location_type, surface,
      travel_total_miles,
      customers(first_name, last_name, email, phone),
      addresses(line1, city, state, zip),
      order_items(qty, wet_or_dry, unit_price_cents, units(name)),
      order_custom_fees(amount_cents),
      order_discounts(amount_cents, percentage)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError || !order) {
    return { success: false, error: "Order not found" };
  }

  // Trusted callers (backend, signed-in admin/master) choose the outcome. An untrusted caller only proved control of the
  // order, which is not permission to confirm it: the confirmation must be one of the known customer pathways and the
  // order's own stored state must satisfy that pathway's prerequisites (state, deposit collected, saved card, invoice
  // context). The requested outcome string is never trusted; the pathway decides it.
  let paymentOutcome: string;
  if (trustedCaller) {
    paymentOutcome = requestedOutcome;
  } else {
    // A portal token never makes an order an invoice; only an invoice-type token, or (owner / Stripe session) a current
    // invoice link on the order does.
    const invoiceContext =
      customerProof?.kind === "token"
        ? customerProof.linkType === "invoice"
        : !!customerProof && (await hasCurrentInvoiceLink(supabase, orderId));
    const verdict = evaluateCustomerConfirmation({ source, order, hasInvoiceContext: invoiceContext });
    if (!verdict.ok) {
      console.warn(`[order-lifecycle] customer confirmation refused: source=${source} reason=${verdict.reason}`);
      return { success: false, error: "This order cannot be confirmed this way." };
    }
    paymentOutcome = verdict.outcome;
  }

  const allowedFromStatuses = ["draft", "pending_review", "awaiting_customer_approval", "confirmed"];

  if (!allowedFromStatuses.includes(order.status)) {
    return {
      success: false,
      error: `Cannot enter confirmed from status: ${order.status}`,
    };
  }

  // Safety guard: never confirm an order that still has an uncollected deposit.
  // Uses the actual deposit_due_cents on the order row as the source of truth so
  // that all admin overrides are respected:
  //   - Admin zeroed out the deposit → deposit_due_cents === 0 → guard skips, confirm proceeds
  //   - Admin set a partial deposit → deposit_due_cents is the partial amount → guard checks that exact amount
  //   - Admin set full payment as deposit → deposit_due_cents equals total → same check
  //   - Standard deposit rule → deposit_due_cents is whatever was computed → same check
  // The guard only fires when deposit_paid_cents is genuinely less than deposit_due_cents.
  // paymentOutcome values that legitimately bypass charging ("waived", "zero_due_with_card",
  // "already_paid") are still allowed through because deposit_paid_cents reflects them:
  //   - "waived": admin explicitly set deposit_due_cents to 0 before calling this
  //   - "zero_due_with_card": deposit_due_cents === 0 by definition
  //   - "already_paid": deposit_paid_cents >= deposit_due_cents already
  const depositDue = order.deposit_due_cents ?? 0;
  const depositPaid = order.deposit_paid_cents ?? 0;
  if (depositDue > 0 && depositPaid < depositDue) {
    const bypassOutcomes = ["waived", "already_paid", "cash", "charged_now"];
    if (!bypassOutcomes.includes(paymentOutcome)) {
      return {
        success: false,
        error: `Cannot confirm: deposit of $${(depositDue / 100).toFixed(2)} has not been collected (paid: $${(depositPaid / 100).toFixed(2)})`,
      };
    }
  }

  // A waived deposit: when a signed-in admin approves an order whose deposit is zero, the deposit obligation is satisfied by that
  // waiver (no Stripe charge occurs). The customer portal reads stripe_payment_status 'paid' as "no payment is required to proceed".
  // This marker used to be written by the admin's browser; payment-state columns are now written by the server only.
  if (trustedCaller && requestedOutcome === "waived" && source === "admin_approve_zero_deposit" && depositDue === 0 && order.stripe_payment_status !== "paid") {
    const { error: waivedMarkError } = await supabase
      .from("orders")
      .update({ stripe_payment_status: "paid" })
      .eq("id", orderId)
      .not("status", "in", '("cancelled","void")');
    if (waivedMarkError) console.warn("[order-lifecycle] waived-deposit marker failed (non-fatal):", waivedMarkError.message);
  }

  // A customer approving an order is stamped when the order actually reaches (or is verified in) the confirmed state,
  // never merely because the customer chose a payment option. The customer-portal-action approval only records the
  // selection; this is where the approval completes.
  const isCustomerApproval = typeof source === "string" && source.startsWith("customer_approval");
  const approvedAtPatch: Record<string, unknown> =
    isCustomerApproval && !order.customer_approved_at ? { customer_approved_at: new Date().toISOString() } : {};
  const alreadyAlerted = !!order.confirmed_admin_alerted;

  // Fully processed before (confirmed and the admin already alerted): idempotent. A customer approval still gets its
  // timestamp once.
  if (alreadyAlerted && order.status === "confirmed") {
    if (Object.keys(approvedAtPatch).length > 0) {
      await supabase.from("orders").update(approvedAtPatch).eq("id", orderId);
    }
    return { success: true, alreadySent: true };
  }

  // Capture old status before any write.
  // When the caller already wrote status="confirmed" atomically with payment fields,
  // order.status is already "confirmed" here. The caller must pass oldStatusHint
  // so the changelog accurately reflects the pre-transition state.
  const oldStatus = (order.status === "confirmed" && oldStatusHint) ? oldStatusHint : order.status;

  if (order.status !== "confirmed") {
    // The deposit guard above has already passed, so this is the one place a customer-initiated confirmation lands.
    // An order that was confirmed before and later edited (admin already alerted once) is confirmed again here too.
    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: "confirmed", ...approvedAtPatch })
      .eq("id", orderId)
      .not("status", "in", '("cancelled","void","completed")');

    if (updateError) {
      return { success: false, error: `Failed to update status: ${updateError.message}` };
    }
  } else if (Object.keys(approvedAtPatch).length > 0) {
    await supabase.from("orders").update(approvedAtPatch).eq("id", orderId);
  }

  try {
    await supabase.from("order_changelog").insert({
      order_id: orderId,
      user_id: null,
      change_type: "status_change",
      field_changed: "status",
      old_value: oldStatus,
      new_value: "confirmed",
      notes: `Order confirmed via ${source} (payment: ${paymentOutcome})`,
    });
  } catch (e) {
    console.warn("[order-lifecycle] Changelog insert failed (non-fatal):", e);
  }

  // Already alerted for an earlier confirmation: the transition above is recorded, but the admin is not alerted twice.
  if (alreadyAlerted) {
    return { success: true, alreadySent: true };
  }

  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  const address = Array.isArray(order.addresses) ? order.addresses[0] : order.addresses;

  await sendAdminConfirmedAlert(supabase, order, customer, address, paymentOutcome);

  await supabase
    .from("orders")
    .update({ confirmed_admin_alerted: true })
    .eq("id", orderId);

  return { success: true };
}

// ============================================================
// SHARED: Admin notification helpers
// ============================================================

const fmt = formatCurrency;

async function getAdminSettings(supabase: any): Promise<{
  phone: string | null;
  email: string | null;
  businessName: string;
  businessPhone: string;
}> {
  const { data } = await supabase
    .from("admin_settings")
    .select("key, value")
    .in("key", ["admin_notification_phone", "admin_email", "business_name", "business_phone"]);

  const settings: Record<string, string> = {};
  (data || []).forEach((row: { key: string; value: string | null }) => {
    if (row.value) settings[row.key] = row.value;
  });

  return {
    phone: settings["admin_notification_phone"] || null,
    email: settings["admin_email"] || null,
    businessName: settings["business_name"] || "Bounce Party Club",
    businessPhone: settings["business_phone"] || "(313) 889-3860",
  };
}

async function sendAdminSmsViaFunction(supabase: any, message: string, orderId: string, adminPhone: string) {
  try {
    await supabase.functions.invoke("send-sms-notification", {
      body: { to: adminPhone, message, orderId },
    });
  } catch (e) {
    console.error("[order-lifecycle] Admin SMS send failed (non-fatal):", e);
  }
}

async function sendAdminEmailViaFunction(supabase: any, to: string, subject: string, html: string) {
  try {
    await supabase.functions.invoke("send-email", {
      body: { to, subject, html },
    });
  } catch (e) {
    console.error("[order-lifecycle] Admin email send failed (non-fatal):", e);
  }
}

async function sendAdminPendingReviewAlert(
  supabase: any,
  order: any,
  customer: any,
  address: any
) {
  const settings = await getAdminSettings(supabase);
  const shortId = formatOrderId(order.id);
  const eventDateStr = order.event_date
    ? new Date(order.event_date + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "Unknown date";

  const customerName = customer
    ? `${customer.first_name} ${customer.last_name}`
    : "Unknown customer";

  if (settings.phone) {
    const smsMessage =
      `NEW BOOKING REQUEST! ${customerName} for ${eventDateStr}. ` +
      `Review in admin panel. Order #${shortId}`;
    await sendAdminSmsViaFunction(supabase, smsMessage, order.id, settings.phone);
  }

  if (settings.email) {
    const customFees: Array<{ amount_cents: number }> = Array.isArray(order.order_custom_fees) ? order.order_custom_fees : [];
    const discounts: Array<{ amount_cents: number; percentage?: number | null }> = Array.isArray(order.order_discounts) ? order.order_discounts : [];
    // The same arithmetic as every other order total (orderMoney): Setup Fee, weekday delivery fee and percentage discounts included.
    const totalCents = storedOrderTotalCents(order, discounts, customFees);

    const addressStr = address
      ? `${address.line1}, ${address.city}, ${address.state}`
      : "Unknown address";

    const portalLink = `https://bouncepartyclub.com/admin?tab=pending`;

    const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #fed7aa;">
  <tr>
    <td align="center" style="padding:24px 40px 16px;border-bottom:2px solid #fed7aa;background-color:#fff7ed;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;color:#c2410c;font-size:24px;font-weight:bold;">New Booking Request</h1>
      <p style="margin:6px 0 0;color:#9a3412;font-size:14px;">Action Required - Pending Review</p>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 40px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:6px;margin-bottom:20px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#c2410c;font-size:15px;">Customer</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:40%;">Name:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${customerName}</td></tr>
            ${customer?.email ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Email:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${customer.email}</td></tr>` : ""}
            ${customer?.phone ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Phone:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${customer.phone}</td></tr>` : ""}
          </table>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;margin-bottom:20px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#1e40af;font-size:15px;">Event Details</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:40%;">Order #:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${shortId}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${eventDateStr}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${addressStr}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Total:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fmt(totalCents)}</td></tr>
          </table>
        </td></tr>
      </table>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${portalLink}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 32px;border-radius:6px;">Review Order in Admin</a>
      </div>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    await sendAdminEmailViaFunction(
      supabase,
      settings.email,
      `New Booking Request - #${shortId}`,
      emailHtml
    );
  }
}

async function sendAdminConfirmedAlert(
  supabase: any,
  order: any,
  customer: any,
  address: any,
  paymentOutcome: string
) {
  const settings = await getAdminSettings(supabase);
  const shortId = formatOrderId(order.id);
  const eventDateStr = order.event_date
    ? new Date(order.event_date + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "Unknown date";

  const customerName = customer
    ? `${customer.first_name} ${customer.last_name}`
    : "Unknown customer";

  const paymentLabel: Record<string, string> = {
    waived: "No payment required",
    already_paid: "Previously paid",
    charged_now: "Charged now",
    zero_due_with_card: "Card on file, $0 due",
    full_paid: "Paid in full",
    custom_paid: "Custom payment",
    cash: "Cash payment",
  };

  const paymentDesc = paymentLabel[paymentOutcome] || paymentOutcome;

  if (settings.phone) {
    const smsMessage =
      `BOOKING CONFIRMED! ${customerName} for ${eventDateStr}. ` +
      `Payment: ${paymentDesc}. Order #${shortId}`;
    await sendAdminSmsViaFunction(supabase, smsMessage, order.id, settings.phone);
  }

  if (settings.email) {
    const customFees: Array<{ amount_cents: number }> = Array.isArray(order.order_custom_fees) ? order.order_custom_fees : [];
    const discounts: Array<{ amount_cents: number; percentage?: number | null }> = Array.isArray(order.order_discounts) ? order.order_discounts : [];
    // The same arithmetic as every other order total (orderMoney): Setup Fee, weekday delivery fee and percentage discounts included.
    const totalCents = storedOrderTotalCents(order, discounts, customFees);

    const depositPaid = order.deposit_paid_cents || 0;
    const balanceDue = order.balance_due_cents || 0;

    const addressStr = address
      ? `${address.line1}, ${address.city}, ${address.state}`
      : "Unknown address";

    const portalLink = `https://bouncepartyclub.com/admin?tab=orders&orderId=${order.id}`;

    const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #d1fae5;">
  <tr>
    <td align="center" style="padding:24px 40px 16px;border-bottom:2px solid #d1fae5;background-color:#ecfdf5;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;color:#065f46;font-size:24px;font-weight:bold;">Booking Confirmed</h1>
      <p style="margin:6px 0 0;color:#047857;font-size:14px;">Order #${shortId} is now confirmed</p>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 40px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ecfdf5;border:1px solid #d1fae5;border-radius:6px;margin-bottom:20px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Customer</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:40%;">Name:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${customerName}</td></tr>
            ${customer?.email ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Email:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${customer.email}</td></tr>` : ""}
            ${customer?.phone ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Phone:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${customer.phone}</td></tr>` : ""}
          </table>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;margin-bottom:20px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#1e40af;font-size:15px;">Event Details</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:40%;">Order #:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${shortId}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${eventDateStr}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${addressStr}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Total:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fmt(totalCents)}</td></tr>
            ${depositPaid > 0 ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Deposit Paid:</td><td style="padding:3px 0;color:#059669;font-size:14px;font-weight:600;text-align:right;">${fmt(depositPaid)}</td></tr>` : ""}
            ${balanceDue > 0 ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Balance Due:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${fmt(balanceDue)}</td></tr>` : ""}
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment:</td><td style="padding:3px 0;color:#059669;font-size:14px;font-weight:600;text-align:right;">${paymentDesc}</td></tr>
          </table>
        </td></tr>
      </table>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${portalLink}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 32px;border-radius:6px;">View Order</a>
      </div>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    await sendAdminEmailViaFunction(
      supabase,
      settings.email,
      `Booking Confirmed - #${shortId}`,
      emailHtml
    );
  }
}
