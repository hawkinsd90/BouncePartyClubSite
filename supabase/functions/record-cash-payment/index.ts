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
      const { data: customerRow } = await supabaseAdmin
        .from("customers")
        .select("first_name, last_name, email")
        .eq("id", customer_id)
        .maybeSingle();

      if (customerRow?.email) {
        const contactName = customerRow.first_name
          ? `${customerRow.first_name} ${customerRow.last_name ?? ""}`.trim()
          : "Customer";

        await supabaseAdmin.functions.invoke("send-email", {
          body: {
            to: customerRow.email,
            subject: `Payment Received - Order #${formatOrderId(orderId)}`,
            html: buildCashReceiptEmail({
              contactName,
              orderId,
              amountCents,
              tipCents,
              totalCents: amountCents + tipCents,
              paymentType: payment_type,
              newBalanceDue: new_balance_due,
              eventDate: event_date,
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
  contactName: string;
  orderId: string;
  amountCents: number;
  tipCents: number;
  totalCents: number;
  paymentType: "deposit" | "balance";
  newBalanceDue: number;
  eventDate: string | null;
}): string {
  const { contactName, orderId, amountCents, tipCents, totalCents, paymentType, newBalanceDue, eventDate } = opts;
  const orderNum = formatOrderId(orderId);
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const paymentLabel = paymentType === "deposit" ? "Deposit Payment" : "Balance Payment";

  const eventLine = eventDate
    ? `<p style="margin:0 0 16px;color:#64748b;font-size:14px;">Event Date: ${new Date(eventDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>`
    : "";

  const tipLine = tipCents > 0
    ? `<tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Crew Tip</td><td style="padding:8px 0;text-align:right;color:#16a34a;font-size:14px;font-weight:600;">+${fmt(tipCents)}</td></tr>`
    : "";

  const balanceLine = newBalanceDue > 0
    ? `<tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Remaining Balance Due</td><td style="padding:8px 0;text-align:right;font-size:14px;font-weight:600;color:#dc2626;">${fmt(newBalanceDue)}</td></tr>`
    : `<tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Remaining Balance Due</td><td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:#16a34a;">PAID IN FULL</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f8fafc;margin:0;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
  <div style="background:linear-gradient(135deg,#0ea5e9,#0284c7);padding:32px;text-align:center;">
    <h1 style="margin:0;color:white;font-size:22px;font-weight:700;">Payment Received</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,.85);font-size:14px;">Order #${orderNum}</p>
  </div>
  <div style="padding:32px;">
    <p style="margin:0 0 16px;font-size:16px;color:#1e293b;">Hi ${contactName},</p>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">We have received your cash payment. Here is your receipt:</p>
    ${eventLine}
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">
      <tr><td style="padding:8px 0;color:#64748b;font-size:14px;">${paymentLabel}</td><td style="padding:8px 0;text-align:right;font-size:14px;font-weight:600;color:#1e293b;">${fmt(amountCents)}</td></tr>
      ${tipLine}
      <tr style="border-top:2px solid #e2e8f0;">
        <td style="padding:12px 0;font-weight:700;font-size:15px;color:#1e293b;">Total Received</td>
        <td style="padding:12px 0;text-align:right;font-weight:700;font-size:18px;color:#0ea5e9;">${fmt(totalCents)}</td>
      </tr>
      ${balanceLine}
    </table>
    <p style="margin:0;font-size:13px;color:#94a3b8;">Payment method: Cash</p>
    <p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">If you have any questions, please contact us. Thank you for choosing Bounce Party Club!</p>
  </div>
</div>
</body></html>`;
}
