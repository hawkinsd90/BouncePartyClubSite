/**
 * RECORD CASH PAYMENT - Supabase Edge Function
 *
 * Records an admin-entered cash payment for an order.
 * Provides full parity with card payment bookkeeping:
 *   - Inserts payment row (payment_method = 'cash')
 *   - Accumulates balance_paid_cents or sets deposit_paid_cents on orders
 *   - Recalculates balance_due_cents
 *   - Accumulates tip_cents if provided
 *   - Writes order_changelog audit entry
 *   - Writes transaction_receipts via logTransaction
 *   - Sends admin notification via logTransaction
 *   - Sends customer HTML receipt email
 *
 * Auth: requires admin JWT (verify_jwt = true, called with session access_token)
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

interface CashPaymentRequest {
  orderId: string;
  amountCents: number;
  tipCents?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: CashPaymentRequest = await req.json();
    const { orderId } = body;
    const amountCents = Math.max(0, Math.round(Number(body.amountCents) || 0));
    const tipCents = Math.max(0, Math.round(Number(body.tipCents) || 0));
    const totalCents = amountCents + tipCents;

    if (!orderId || amountCents <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid request: orderId required and amountCents must be > 0." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Load order with all pricing fields needed for balance recalculation
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select(`
        id, status, customer_id,
        subtotal_cents, travel_fee_cents, surface_fee_cents,
        same_day_pickup_fee_cents, generator_fee_cents, tax_cents,
        deposit_paid_cents, balance_paid_cents, balance_due_cents,
        tip_cents, event_date,
        customers(first_name, last_name, email),
        order_custom_fees(amount_cents),
        order_discounts(amount_cents)
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Recalculate order total to accurately set balance_due_cents
    const customFeesCents = (order.order_custom_fees as any[] || [])
      .reduce((sum: number, f: any) => sum + (f.amount_cents || 0), 0);
    const discountCents = (order.order_discounts as any[] || [])
      .reduce((sum: number, d: any) => sum + (d.amount_cents || 0), 0);

    const orderTotal =
      (order.subtotal_cents || 0) +
      (order.travel_fee_cents || 0) +
      (order.surface_fee_cents || 0) +
      (order.same_day_pickup_fee_cents || 0) +
      (order.generator_fee_cents || 0) +
      (order.tax_cents || 0) +
      customFeesCents -
      discountCents;

    // Determine payment type: if no deposit has been paid yet treat as deposit,
    // otherwise treat as balance payment (accumulates balance_paid_cents)
    const isDeposit = (order.deposit_paid_cents || 0) === 0;
    const paymentType: "deposit" | "balance" = isDeposit ? "deposit" : "balance";

    // Calculate updated accounting fields
    const existingBalancePaid = order.balance_paid_cents || 0;
    const existingDepositPaid = order.deposit_paid_cents || 0;
    const existingTip = order.tip_cents || 0;

    const newDepositPaid = isDeposit
      ? existingDepositPaid + amountCents
      : existingDepositPaid;
    const newBalancePaid = !isDeposit
      ? existingBalancePaid + amountCents
      : existingBalancePaid;

    const totalPaidTowardBalance = newDepositPaid + newBalancePaid;
    const newBalanceDue = Math.max(0, orderTotal - totalPaidTowardBalance);
    const newTip = tipCents > 0 ? existingTip + tipCents : existingTip;

    // Determine if order should advance to confirmed
    // Only auto-confirm if currently awaiting_customer_approval or pending_review
    const confirmableStatuses = ["awaiting_customer_approval", "pending_review"];
    const shouldConfirm = confirmableStatuses.includes(order.status);

    // Build orders update payload
    const ordersUpdate: Record<string, any> = {
      balance_due_cents: newBalanceDue,
      ...(isDeposit ? { deposit_paid_cents: newDepositPaid } : { balance_paid_cents: newBalancePaid }),
      ...(tipCents > 0 ? { tip_cents: newTip } : {}),
      ...(shouldConfirm ? { status: "confirmed" } : {}),
    };

    const { error: updateError } = await supabaseClient
      .from("orders")
      .update(ordersUpdate)
      .eq("id", orderId);

    if (updateError) {
      console.error("[record-cash-payment] Order update failed:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update order accounting fields: " + updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Write order_changelog audit entry (non-fatal)
    try {
      const changelogEntries: any[] = [];
      if (shouldConfirm) {
        changelogEntries.push({
          order_id: orderId,
          user_id: null,
          change_type: "cash_payment",
          field_changed: "status",
          old_value: order.status,
          new_value: "confirmed",
        });
      }
      changelogEntries.push({
        order_id: orderId,
        user_id: null,
        change_type: "cash_payment",
        field_changed: "balance_due_cents",
        old_value: String(order.balance_due_cents || 0),
        new_value: String(newBalanceDue),
      });
      await supabaseClient.from("order_changelog").insert(changelogEntries);
    } catch (changelogErr) {
      console.error("[record-cash-payment] Changelog insert failed (non-fatal):", changelogErr);
    }

    // Insert payment row
    const { data: paymentRecord, error: paymentError } = await supabaseClient
      .from("payments")
      .insert({
        order_id: orderId,
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
        amount_cents: totalCents,
        type: paymentType,
        tip_cents: tipCents,
        status: "succeeded",
        paid_at: new Date().toISOString(),
        payment_method: "cash",
        payment_brand: null,
        payment_last4: null,
        stripe_fee_amount: 0,
        stripe_net_amount: totalCents,
        currency: "usd",
      })
      .select("id")
      .maybeSingle();

    if (paymentError) {
      console.error("[record-cash-payment] Payment insert failed:", paymentError);
      return new Response(
        JSON.stringify({ error: "Order updated but payment row failed: " + paymentError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log transaction receipt + trigger admin notification (non-fatal)
    let receiptNumber: string | null = null;
    if (paymentRecord && order.customer_id) {
      try {
        const notesArr: string[] = [];
        if (tipCents > 0) notesArr.push(`includes tip $${(tipCents / 100).toFixed(2)}`);
        notesArr.push("Cash payment recorded by admin");
        receiptNumber = await logTransaction(supabaseClient, {
          transactionType: paymentType,
          orderId,
          customerId: order.customer_id,
          paymentId: paymentRecord.id,
          amountCents: totalCents,
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

    // Send customer HTML receipt email (non-fatal)
    try {
      const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
      if (customer?.email) {
        const contactName = customer.first_name
          ? `${customer.first_name} ${customer.last_name || ""}`.trim()
          : "Customer";
        await supabaseClient.functions.invoke("send-email", {
          body: {
            to: customer.email,
            subject: `Payment Received - Order #${formatOrderId(orderId)}`,
            html: buildCashReceiptEmail({
              contactName,
              orderId,
              amountCents,
              tipCents,
              totalCents,
              paymentType,
              newBalanceDue,
              eventDate: order.event_date,
            }),
          },
        });
      }
    } catch (emailErr) {
      console.error("[record-cash-payment] Customer email failed (non-fatal):", emailErr);
    }

    console.log("[record-cash-payment] Completed:", { orderId, totalCents, paymentType, receiptNumber });

    return new Response(
      JSON.stringify({
        success: true,
        paymentType,
        newBalanceDue,
        receiptNumber,
        statusChanged: shouldConfirm ? "confirmed" : null,
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
