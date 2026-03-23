/**
 * RECORD CASH PAYMENT - Supabase Edge Function
 *
 * Admin-only. Records a cash payment for an order via a single atomic DB transaction.
 *
 * Authorization:
 *   Validates the bearer JWT and confirms the caller has role master/admin/crew.
 *
 * Atomicity:
 *   All critical accounting writes (payments insert, orders update, order_changelog)
 *   are executed inside a single Postgres transaction via the record_cash_payment RPC.
 *   If any write fails, the entire transaction rolls back — no partial-write inconsistency.
 *
 * After the atomic RPC succeeds, non-critical side effects (transaction_receipts,
 * admin notification email, customer receipt email) are executed as best-effort.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { formatOrderId } from "../_shared/format-order-id.ts";
import { logTransaction } from "../_shared/transaction-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_ROLES = new Set(["master", "admin", "crew"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // ── 1. Validate caller is an authenticated admin/staff user ──────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!callerToken) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: missing bearer token." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service-role client for privileged DB operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Resolve the calling user from the JWT
    const { data: { user: callerUser }, error: userError } = await supabaseAdmin.auth.getUser(callerToken);

    if (userError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: invalid or expired token." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check the caller's role in user_roles
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUser.id)
      .maybeSingle();

    const callerRole = roleRow?.role?.toLowerCase() ?? "";

    if (!ALLOWED_ROLES.has(callerRole)) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin or crew role required." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Parse and validate request body ──────────────────────────────────
    const body = await req.json();
    const orderId: string = body.orderId ?? "";
    const amountCents = Math.max(0, Math.round(Number(body.amountCents) || 0));
    const tipCents = Math.max(0, Math.round(Number(body.tipCents) || 0));

    if (!orderId || amountCents <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid request: orderId required and amountCents must be > 0." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Execute all critical accounting writes atomically via DB RPC ─────
    //   The RPC: locks the order row, validates amount vs balance, inserts
    //   payment, updates orders fields, and inserts order_changelog.
    //   If anything fails inside the RPC, Postgres rolls the whole thing back.
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "record_cash_payment",
      {
        p_order_id:       orderId,
        p_amount_cents:   amountCents,
        p_tip_cents:      tipCents,
        p_acting_user_id: callerUser.id,
      }
    );

    if (rpcError) {
      console.error("[record-cash-payment] RPC failed:", rpcError);
      const msg = rpcError.message ?? "Failed to record payment";
      const isValidation = msg.includes("exceeds effective balance") ||
                           msg.includes("Order not found") ||
                           msg.includes("Cannot record payment");
      return new Response(
        JSON.stringify({ error: msg }),
        {
          status: isValidation ? 422 : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const result = rpcResult as {
      payment_id:    string;
      payment_type:  "deposit" | "balance";
      new_balance_due: number;
      status_changed:  string | null;
      customer_id:   string;
      event_date:    string | null;
      total_cents:   number;
      amount_cents:  number;
      tip_cents:     number;
    };

    const {
      payment_id,
      payment_type,
      new_balance_due,
      status_changed,
      customer_id,
      event_date,
    } = result;

    console.log("[record-cash-payment] RPC succeeded:", {
      orderId, payment_id, payment_type, new_balance_due, caller: callerUser.id,
    });

    // ── 4. Non-critical side effects (best-effort, non-atomic) ──────────────

    // 4a. Log transaction receipt + trigger admin notification email
    let receiptNumber: string | null = null;
    if (payment_id && customer_id) {
      try {
        const notesArr: string[] = ["Cash payment recorded by admin"];
        if (tipCents > 0) notesArr.push(`includes tip $${(tipCents / 100).toFixed(2)}`);
        receiptNumber = await logTransaction(supabaseAdmin, {
          transactionType: payment_type,
          orderId,
          customerId: customer_id,
          paymentId: payment_id,
          amountCents: amountCents + tipCents,
          paymentMethod: "cash",
          paymentMethodBrand: null,
          stripeChargeId: null,
          stripePaymentIntentId: null,
          notes: notesArr.join(" | "),
        });
      } catch (receiptErr) {
        console.error("[record-cash-payment] Transaction receipt failed (non-fatal):", receiptErr);
      }
    }

    // 4b. Send customer HTML receipt email
    try {
      const { data: orderRow } = await supabaseAdmin
        .from("orders")
        .select(`
          *,
          customers (first_name, last_name, email, phone),
          addresses (line1, city, state, zip),
          order_items (qty, wet_or_dry, unit_price_cents, units (name)),
          order_custom_fees (name, amount_cents),
          order_discounts (name, amount_cents)
        `)
        .eq("id", orderId)
        .maybeSingle();

      if (orderRow?.customers?.email) {
        const firstName = orderRow.customers.first_name || "Customer";

        await supabaseAdmin.functions.invoke("send-email", {
          body: {
            to: orderRow.customers.email,
            subject: `Payment Received - Order #${formatOrderId(orderId)}`,
            html: buildCashReceiptEmail({
              firstName,
              orderId,
              amountCents,
              tipCents,
              totalCents: amountCents + tipCents,
              paymentType: payment_type,
              newBalanceDue: new_balance_due,
              order: orderRow,
            }),
          },
        });
      }
    } catch (emailErr) {
      console.error("[record-cash-payment] Customer email failed (non-fatal):", emailErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        paymentType: payment_type,
        newBalanceDue: new_balance_due,
        receiptNumber,
        statusChanged: status_changed ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[record-cash-payment] Fatal error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildCashReceiptEmail(opts: {
  firstName: string;
  orderId: string;
  amountCents: number;
  tipCents: number;
  totalCents: number;
  paymentType: "deposit" | "balance";
  newBalanceDue: number;
  order: any;
}): string {
  const { firstName, orderId, amountCents, tipCents, totalCents, paymentType, newBalanceDue, order } = opts;
  const orderNum = formatOrderId(orderId);
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const LOGO_URL = "https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png";
  const PHONE = "(313) 889-3860";
  // Success theme — matches booking confirmed email exactly
  const BORDER = "#10b981";
  const ACCENT = "#15803d";
  const BG = "#f0fdf4";

  const eventDateStr = order.event_date
    ? new Date(order.event_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";

  const timeStr = order.start_window && order.end_window
    ? `${order.start_window} - ${order.end_window}`
    : "";

  const addressStr = order.addresses
    ? `${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state}`
    : "";

  // ── Event Details info box (matches createInfoBox with success theme) ─────
  const eventDetailRows = [
    { label: "Order #", value: orderNum },
    ...(eventDateStr ? [{ label: "Date", value: eventDateStr }] : []),
    ...(timeStr ? [{ label: "Time", value: timeStr }] : []),
    ...(addressStr ? [{ label: "Location", value: addressStr }] : []),
    ...(order.location_type ? [{ label: "Location Type", value: order.location_type }] : []),
    ...(order.surface ? [{ label: "Surface", value: order.surface }] : []),
  ].map(r => `
      <tr>
        <td style="color:#64748b;font-size:14px;">${r.label}:</td>
        <td style="color:#1e293b;font-size:14px;font-weight:600;text-align:right;">${r.value}</td>
      </tr>`).join("");

  const eventInfoBox = `
    <div style="background-color:${BG};border:2px solid ${BORDER};border-radius:6px;padding:20px;margin:25px 0;">
      <h3 style="margin:0 0 15px;color:${ACCENT};font-size:16px;font-weight:600;">Event Details</h3>
      <table width="100%" cellpadding="6" cellspacing="0">${eventDetailRows}</table>
    </div>`;

  // ── Order Items (matches createItemsTable) ────────────────────────────────
  const items: any[] = order.order_items || [];
  const itemRowsHtml = items.map((item: any) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#1e293b;">
        ${item.qty}x ${item.units?.name} <span style="color:#64748b;font-size:13px;">(${item.wet_or_dry === "water" ? "Wet" : "Dry"})</span>
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#1e293b;">${fmt(item.unit_price_cents * item.qty)}</td>
    </tr>`).join("");

  const itemsSection = items.length > 0 ? `
    <div style="margin:25px 0;">
      <h3 style="margin:0 0 15px;color:#1e293b;font-size:16px;font-weight:600;">Order Items</h3>
      <table width="100%" cellpadding="0" cellspacing="0">${itemRowsHtml}</table>
    </div>` : "";

  // ── Pricing summary (matches createPricingSummary) ────────────────────────
  const customFees: any[] = order.order_custom_fees || [];
  const discounts: any[] = order.order_discounts || [];

  type PricingRow = { label: string; value: string; bold?: boolean; highlight?: boolean };
  const pricingRows: PricingRow[] = [
    { label: "Subtotal", value: fmt(order.subtotal_cents || 0) },
  ];
  if ((order.travel_fee_cents || 0) > 0) pricingRows.push({ label: "Travel Fee", value: fmt(order.travel_fee_cents) });
  if ((order.surface_fee_cents || 0) > 0) pricingRows.push({ label: "Surface Fee", value: fmt(order.surface_fee_cents) });
  if ((order.generator_fee_cents || 0) > 0) pricingRows.push({ label: "Generator Fee", value: fmt(order.generator_fee_cents) });
  if ((order.same_day_pickup_fee_cents || 0) > 0) pricingRows.push({ label: "Same Day Pickup", value: fmt(order.same_day_pickup_fee_cents) });
  customFees.forEach((f: any) => pricingRows.push({ label: f.name || "Additional Fee", value: fmt(f.amount_cents) }));
  discounts.forEach((d: any) => pricingRows.push({ label: d.name || "Discount", value: `-${fmt(d.amount_cents)}` }));
  if ((order.tax_cents || 0) > 0) pricingRows.push({ label: "Tax", value: fmt(order.tax_cents) });
  const orderTotal = (order.subtotal_cents || 0) + (order.travel_fee_cents || 0) + (order.surface_fee_cents || 0) +
    (order.generator_fee_cents || 0) + (order.same_day_pickup_fee_cents || 0) + (order.tax_cents || 0) +
    customFees.reduce((s: number, f: any) => s + f.amount_cents, 0) - discounts.reduce((s: number, d: any) => s + d.amount_cents, 0);
  pricingRows.push({ label: "Total", value: fmt(orderTotal), bold: true });
  if ((order.deposit_paid_cents || 0) > 0) pricingRows.push({ label: "Deposit Paid", value: fmt(order.deposit_paid_cents), highlight: true });
  if ((order.balance_paid_cents || 0) > 0) pricingRows.push({ label: "Balance Paid", value: fmt(order.balance_paid_cents), highlight: true });

  const pricingRowsHtml = pricingRows.map(r => `
    <tr${r.bold ? ' style="border-top:2px solid #e2e8f0;"' : ''}>
      <td style="color:${r.bold ? "#1e293b" : "#64748b"};font-size:${r.bold ? "15px" : "14px"};font-weight:${r.bold ? "600" : "normal"};${r.bold ? "padding-top:10px;" : ""}">${r.label}:</td>
      <td style="color:${r.highlight ? "#10b981" : r.bold ? "#1e293b" : "#1e293b"};font-size:${r.bold ? "15px" : "14px"};font-weight:${r.bold ? "700" : "normal"};text-align:right;${r.bold ? "padding-top:10px;" : ""}">${r.value}</td>
    </tr>`).join("");

  const pricingSection = `
    <div style="background-color:#f8fafc;border-radius:6px;padding:20px;margin:25px 0;">
      <h3 style="margin:0 0 15px;color:#1e293b;font-size:16px;font-weight:600;">Payment Summary</h3>
      <table width="100%" cellpadding="6" cellspacing="0">${pricingRowsHtml}</table>
    </div>`;

  // ── This payment receipt (success info box) ───────────────────────────────
  const paymentLabel = paymentType === "deposit" ? "Deposit Payment" : "Balance Payment";
  const tipRow = tipCents > 0 ? `
      <tr>
        <td style="color:#64748b;font-size:14px;">Crew Tip:</td>
        <td style="color:#16a34a;font-size:14px;font-weight:600;text-align:right;">+${fmt(tipCents)}</td>
      </tr>` : "";
  const balanceRow = newBalanceDue > 0
    ? `<tr style="border-top:2px solid #e2e8f0;"><td style="color:#1e293b;font-size:15px;font-weight:600;padding-top:10px;">Remaining Balance Due:</td><td style="color:#dc2626;font-size:15px;font-weight:700;text-align:right;padding-top:10px;">${fmt(newBalanceDue)}</td></tr>`
    : `<tr style="border-top:2px solid #e2e8f0;"><td style="color:#1e293b;font-size:15px;font-weight:600;padding-top:10px;">Remaining Balance Due:</td><td style="color:#16a34a;font-size:15px;font-weight:700;text-align:right;padding-top:10px;">PAID IN FULL</td></tr>`;

  const paymentReceiptBox = `
    <div style="background-color:${BG};border:2px solid ${BORDER};border-radius:6px;padding:20px;margin:25px 0;">
      <h3 style="margin:0 0 15px;color:${ACCENT};font-size:16px;font-weight:600;">Payment Receipt</h3>
      <table width="100%" cellpadding="6" cellspacing="0">
        <tr>
          <td style="color:#64748b;font-size:14px;">${paymentLabel}:</td>
          <td style="color:#1e293b;font-size:14px;font-weight:600;text-align:right;">${fmt(amountCents)}</td>
        </tr>
        ${tipRow}
        <tr style="border-top:2px solid #d1fae5;">
          <td style="color:${ACCENT};font-size:15px;font-weight:700;padding-top:10px;">Total Received:</td>
          <td style="color:${ACCENT};font-size:18px;font-weight:800;text-align:right;padding-top:10px;">${fmt(totalCents)}</td>
        </tr>
        ${balanceRow}
      </table>
    </div>`;

  // ── CASH PAYMENT bold banner (only for cash payments) ─────────────────────
  const cashBanner = `
    <div style="background-color:#fef3c7;border:2px solid #f59e0b;border-radius:6px;padding:16px 20px;margin:25px 0;text-align:center;">
      <p style="margin:0;font-size:18px;font-weight:900;color:#92400e;letter-spacing:0.5px;">PAID IN CASH</p>
      <p style="margin:6px 0 0;font-size:13px;color:#b45309;font-weight:600;">Cash payment received and recorded by staff</p>
    </div>`;

  const content = `
    <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi ${firstName},</p>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">We've received your payment. Here is your receipt and order summary.</p>
    ${cashBanner}
    ${eventInfoBox}
    ${itemsSection}
    ${pricingSection}
    ${paymentReceiptBox}
    <p style="margin:25px 0 0;color:#475569;font-size:14px;line-height:1.6;">Questions? Call us at <strong style="color:#1e293b;">${PHONE}</strong></p>
  `;

  // Wrap in the same outer shell as emailTemplateBase.createEmailWrapper (success theme)
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Payment Received</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);border:2px solid ${BORDER};">
        <tr>
          <td style="background-color:#ffffff;padding:30px;text-align:center;border-bottom:2px solid ${BORDER};">
            <img src="${LOGO_URL}" alt="Bounce Party Club" style="height:80px;width:auto;" />
            <h1 style="margin:15px 0 0;color:${BORDER};font-size:24px;font-weight:bold;">Payment Received!</h1>
          </td>
        </tr>
        <tr><td style="padding:30px;">${content}</td></tr>
        <tr>
          <td style="background-color:#f8fafc;padding:25px;text-align:center;border-top:2px solid ${BORDER};">
            <p style="margin:0 0 5px;color:#64748b;font-size:13px;">Bounce Party Club | ${PHONE}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
