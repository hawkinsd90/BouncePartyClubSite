import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { formatCurrency } from "../_shared/fmt.ts";
import { formatOrderId } from "../_shared/format-order-id.ts";

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
    const { action, orderId, source, paymentOutcome, oldStatusHint } = body;

    if (!orderId || !action) {
      return new Response(JSON.stringify({ error: "Missing required fields: orderId, action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (action === "enter_pending_review") {
      const result = await enterPendingReview(supabase, orderId, source || "standard_checkout");
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "enter_confirmed") {
      const result = await enterConfirmed(supabase, orderId, source || "unknown", paymentOutcome || "already_paid", oldStatusHint || null);
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
      same_day_pickup_fee_cents, generator_fee_cents, tax_cents,
      deposit_due_cents, balance_due_cents, tip_cents,
      start_window, end_window, location_type, surface,
      travel_total_miles,
      customers(first_name, last_name, email, phone),
      addresses(line1, city, state, zip),
      order_items(qty, wet_or_dry, unit_price_cents, units(name)),
      order_custom_fees(amount_cents),
      order_discounts(amount_cents, discount_type, percentage)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError || !order) {
    return { success: false, error: "Order not found" };
  }

  const allowedFromStatuses = ["draft", "pending_review"];
  if (!allowedFromStatuses.includes(order.status)) {
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
      const { error: updateError } = await supabase
        .from("orders")
        .update({ status: "pending_review" })
        .eq("id", orderId)
        .eq("status", "draft");

      if (updateError) {
        return { success: false, error: `Failed to update status: ${updateError.message}` };
      }
    }

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
    } catch (e) {
      console.warn("[order-lifecycle] Changelog insert failed (non-fatal):", e);
    }
  } else {
    return { success: true, alreadySent: true };
  }

  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  const address = Array.isArray(order.addresses) ? order.addresses[0] : order.addresses;

  await sendAdminPendingReviewAlert(supabase, order, customer, address);

  await supabase
    .from("orders")
    .update({ pending_review_admin_alerted: true })
    .eq("id", orderId);

  return { success: true };
}

// ============================================================
// AUTHORITATIVE HANDLER B: enterConfirmed
// ============================================================
async function enterConfirmed(
  supabase: any,
  orderId: string,
  source: string,
  paymentOutcome: string,
  oldStatusHint: string | null = null
): Promise<{ success: boolean; error?: string; alreadySent?: boolean }> {
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select(`
      id, status, event_date, confirmed_admin_alerted,
      subtotal_cents, travel_fee_cents, surface_fee_cents,
      same_day_pickup_fee_cents, generator_fee_cents, tax_cents,
      deposit_due_cents, balance_due_cents, tip_cents,
      deposit_paid_cents, start_window, end_window, location_type, surface,
      travel_total_miles,
      customers(first_name, last_name, email, phone),
      addresses(line1, city, state, zip),
      order_items(qty, wet_or_dry, unit_price_cents, units(name)),
      order_custom_fees(amount_cents),
      order_discounts(amount_cents, discount_type, percentage)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError || !order) {
    return { success: false, error: "Order not found" };
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

  // Short-circuit only when the admin has already been alerted — full idempotency.
  if (order.confirmed_admin_alerted) {
    return { success: true, alreadySent: true };
  }

  // Capture old status before any write.
  // When the caller already wrote status="confirmed" atomically with payment fields,
  // order.status is already "confirmed" here. The caller must pass oldStatusHint
  // so the changelog accurately reflects the pre-transition state.
  const oldStatus = (order.status === "confirmed" && oldStatusHint) ? oldStatusHint : order.status;

  if (order.status !== "confirmed") {
    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: "confirmed" })
      .eq("id", orderId)
      .not("status", "in", '("cancelled","void","completed")');

    if (updateError) {
      return { success: false, error: `Failed to update status: ${updateError.message}` };
    }
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
    const discounts: Array<{ amount_cents: number; discount_type: string; percentage: number }> = Array.isArray(order.order_discounts) ? order.order_discounts : [];
    const customFeesTotal = customFees.reduce((sum: number, f: { amount_cents: number }) => sum + (f.amount_cents || 0), 0);
    const discountsTotal = discounts.reduce((sum: number, d: { amount_cents: number; discount_type: string; percentage: number }) => {
      if (d.discount_type === 'percentage') return sum + Math.round((order.subtotal_cents || 0) * ((d.percentage || 0) / 100));
      return sum + (d.amount_cents || 0);
    }, 0);
    const totalCents =
      (order.subtotal_cents || 0) +
      (order.travel_fee_cents || 0) +
      (order.surface_fee_cents || 0) +
      (order.same_day_pickup_fee_cents || 0) +
      (order.generator_fee_cents || 0) +
      customFeesTotal -
      discountsTotal +
      (order.tax_cents || 0);

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
    const discounts: Array<{ amount_cents: number; discount_type: string; percentage: number }> = Array.isArray(order.order_discounts) ? order.order_discounts : [];
    const customFeesTotal = customFees.reduce((sum: number, f: { amount_cents: number }) => sum + (f.amount_cents || 0), 0);
    const discountsTotal = discounts.reduce((sum: number, d: { amount_cents: number; discount_type: string; percentage: number }) => {
      if (d.discount_type === 'percentage') return sum + Math.round((order.subtotal_cents || 0) * ((d.percentage || 0) / 100));
      return sum + (d.amount_cents || 0);
    }, 0);
    const totalCents =
      (order.subtotal_cents || 0) +
      (order.travel_fee_cents || 0) +
      (order.surface_fee_cents || 0) +
      (order.same_day_pickup_fee_cents || 0) +
      (order.generator_fee_cents || 0) +
      customFeesTotal -
      discountsTotal +
      (order.tax_cents || 0);

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
