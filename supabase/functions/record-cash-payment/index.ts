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

import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { formatOrderId } from "../_shared/format-order-id.ts";
import { logTransaction } from "../_shared/transaction-logger.ts";
import { formatCurrency, DEFAULT_PHONE } from "../_shared/fmt.ts";
import { buildPaymentReceiptEmail } from "../_shared/payment-receipt-email.ts";

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
      event_date: _event_date,
    } = result;

    // ── 4. Non-critical side effects (best-effort, non-atomic) ──────────────

    // 4a. Log transaction receipt + trigger admin notification email
    let receiptNumber: string | null = null;
    if (payment_id && customer_id) {
      try {
        const notesArr: string[] = ["Cash payment recorded by admin"];
        if (tipCents > 0) notesArr.push(`includes tip ${formatCurrency(tipCents)}`);
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

        const { data: bizSettings } = await supabaseAdmin
          .from("admin_settings")
          .select("key, value")
          .in("key", ["business_phone", "logo_url"]);
        const bizMap: Record<string, string> = {};
        bizSettings?.forEach((s: { key: string; value: string | null }) => { if (s.value) bizMap[s.key] = s.value; });
        const businessPhone = bizMap["business_phone"] || DEFAULT_PHONE;
        const logoUrl = bizMap["logo_url"] || undefined;

        const cashBanner = `
    <div style="background-color:#fef3c7;border:2px solid #f59e0b;border-radius:6px;padding:16px 20px;margin:25px 0;text-align:center;">
      <p style="margin:0;font-size:18px;font-weight:900;color:#92400e;letter-spacing:0.5px;">PAID IN CASH</p>
      <p style="margin:6px 0 0;font-size:13px;color:#b45309;font-weight:600;">Cash payment received and recorded by staff</p>
    </div>`;

        await supabaseAdmin.functions.invoke("send-email", {
          body: {
            to: orderRow.customers.email,
            subject: `Payment Received - Order #${formatOrderId(orderId)}`,
            html: buildPaymentReceiptEmail({
              firstName,
              orderId,
              orderNum: formatOrderId(orderId),
              amountCents,
              tipCents,
              totalCents: amountCents + tipCents,
              paymentType: payment_type,
              newBalanceDue: new_balance_due,
              order: orderRow,
              businessPhone,
              paymentBanner: cashBanner,
              paymentMethodLabel: payment_type === "deposit" ? "Deposit Payment" : "Balance Payment",
              logoUrl,
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
