/**
 * RECONCILE BALANCE PAYMENT - Supabase Edge Function
 *
 * Called after a customer returns from Stripe Checkout (Path B balance payment).
 * Verifies the session directly with Stripe and idempotently writes any DB state
 * that the webhook may not have written yet.
 *
 * Convergence model:
 * ───────────────────
 * The Checkout Session was created for a payment OPERATION (customer-balance-payment) and names it in its metadata.
 * The stripe-webhook, the charging request and this function all apply a paid session through the SAME database function
 * (finalize_payment_operation), which applies it exactly once. Whichever caller gets there first applies it and sends the
 * receipt; every other caller is told it is already applied and changes nothing. A session that names no operation is never
 * turned into a payment from its raw amount.
 *
 * This function has no caller authentication of its own: its authority is the Stripe session retrieved by id (a paid payment
 * mode session whose metadata names this order and one of this application's operations), and the amount and the principal /
 * tip split come from the operation, never from the request.
 */

import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { buildPortalUrl } from "../_shared/portal-link.ts";
import { receiptOrderFigures, receiptDiscountAmount, receiptExtraFeeRowsHtml } from "../_shared/payments/receipt-order-totals.ts";
import { finalizeOperation } from "../_shared/payments/payment-operations.ts";
import { formatCurrency, formatPaymentMethodLabel } from "../_shared/fmt.ts";
import { orderItemName, ORDER_ITEM_COLUMNS } from "../_shared/payments/order-item-label.ts";
import { getSiteOrigin } from "../_shared/siteOrigin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ReconcileRequest {
  sessionId: string;
  orderId: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const body: ReconcileRequest = await req.json();
    const { sessionId, orderId } = body;

    if (!sessionId || !orderId) {
      return new Response(
        JSON.stringify({ error: "sessionId and orderId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: stripeKeyData } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (!stripeKeyData?.value) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    // ── 1. Verify session with Stripe ──────────────────────────────────────────
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent", "payment_intent.payment_method"],
      });
    } catch (err) {
      console.error("[reconcile-balance-payment] Failed to retrieve session:", err);
      return new Response(
        JSON.stringify({ error: "Failed to retrieve Stripe session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Validate session is authoritative paid balance for this order ───────
    if (session.mode !== "payment") {
      return new Response(
        JSON.stringify({ error: "Session is not a payment mode session" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (session.payment_status !== "paid") {
      return new Response(
        JSON.stringify({ success: false, reason: "payment_not_complete", payment_status: session.payment_status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sessionOrderId = session.metadata?.order_id;
    const paymentType = session.metadata?.payment_type;

    if (sessionOrderId !== orderId) {
      console.error(`[reconcile-balance-payment] Order ID mismatch: session=${sessionOrderId} request=${orderId}`);
      return new Response(
        JSON.stringify({ error: "Order ID mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (paymentType !== "balance") {
      return new Response(
        JSON.stringify({ error: "Session is not a balance payment" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Extract PaymentIntent details ──────────────────────────────────────
    const pi = session.payment_intent as Stripe.PaymentIntent | null;
    if (!pi || typeof pi !== "object") {
      return new Response(
        JSON.stringify({ error: "No PaymentIntent on session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const piId = pi.id;
    const amountPaid = session.amount_total || 0;

    const stripeCustomerId =
      typeof session.customer === "string"
        ? session.customer
        : (session.customer as any)?.id || null;

    // Extract payment method details from expanded PI
    let paymentMethodType: string | null = null;
    let paymentBrand: string | null = null;
    let paymentLast4: string | null = null;
    let expandedPmId: string | null = null;

    const pmObj = pi.payment_method;
    if (pmObj && typeof pmObj === "object") {
      paymentMethodType = (pmObj as any).type || null;
      expandedPmId = (pmObj as any).id || null;
      if ((pmObj as any).card) {
        paymentBrand = (pmObj as any).card.brand || null;
        paymentLast4 = (pmObj as any).card.last4 || null;
      }
    }

    // Fetch fee details from charge
    let stripeFee = 0;
    let stripeNet = amountPaid;
    let latestChargeId: string | null = null;

    try {
      const latestCharge = pi.latest_charge;
      latestChargeId = typeof latestCharge === "string"
        ? latestCharge
        : (latestCharge as any)?.id || null;

      if (latestChargeId) {
        const charge = await stripe.charges.retrieve(latestChargeId, {
          expand: ["balance_transaction"],
        });
        const balanceTx = charge.balance_transaction;
        if (balanceTx && typeof balanceTx === "object") {
          stripeFee = (balanceTx as any).fee || 0;
          stripeNet = (balanceTx as any).net || amountPaid;
        }
      }
    } catch (err) {
      console.warn("[reconcile-balance-payment] Could not fetch charge fee details:", err);
    }

    // ── 4. Finalize the payment operation ─────────────────────────────────────
    // The Checkout Session was created for a payment operation (see customer-balance-payment) and names it in its metadata.
    // The webhook, the charging request and this reconciler all apply a payment through the SAME database function, which
    // applies it exactly once: whichever caller gets there first applies it and notifies, the others are told it is already
    // applied. A session with no operation is never turned into a payment from its raw amount.
    const operationKey = session.metadata?.payment_operation_key;
    const operationPaymentId = session.metadata?.payment_id;
    if (!operationKey || !operationPaymentId) {
      return new Response(
        JSON.stringify({ error: "This payment is not linked to a payment operation and needs manual reconciliation", code: "PAYMENT_OPERATION_MISSING" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fin = await finalizeOperation(supabaseClient, {
      paymentId: operationPaymentId,
      operationKey,
      paymentIntentId: piId,
      checkoutSessionId: session.id,
      amountReceivedCents: amountPaid,
      paymentMethod: paymentMethodType,
      paymentBrand,
      paymentLast4,
      feeCents: stripeFee,
      netCents: stripeNet,
      paymentMethodId: expandedPmId,
      stripeCustomerId,
    });

    if (fin.outcome === "error") {
      console.error("[reconcile-balance-payment] finalize failed", { orderId, piId });
      // Nothing was applied; the webhook or the next reconcile retries.
      return new Response(
        JSON.stringify({ error: "Order financial update failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!fin.ok) {
      console.error("[reconcile-balance-payment] payment could not be applied:", fin.outcome);
      return new Response(
        JSON.stringify({ error: "Payment could not be applied and needs manual reconciliation", code: fin.outcome }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!fin.applied) {
      return new Response(
        JSON.stringify({ success: true, alreadyReconciled: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const safeTipCents = fin.tipCents;
    const balanceOnly = Math.max(0, amountPaid - safeTipCents);

    // Fetch full order data for receipt logging and email
    const { data: currentOrder } = await supabaseClient
      .from("orders")
      .select(`
        customer_id, event_date,
        subtotal_cents, travel_fee_cents, surface_fee_cents,
        same_day_pickup_fee_cents, same_day_weekday_delivery_fee_cents, generator_fee_cents, setup_fee_cents, tax_cents,
        travel_fee_waived, surface_fee_waived, same_day_pickup_fee_waived,
        generator_fee_waived, tax_waived,
        deposit_paid_cents, balance_due_cents,
        addresses(line1, city, state, zip),
        order_items(${ORDER_ITEM_COLUMNS}),
        customers(email, first_name, last_name)
      `)
      .eq("id", orderId)
      .maybeSingle();

    // ── 6. Log transaction receipt (idempotent via unique PI id constraint) ────
    if (currentOrder?.customer_id) {
      try {
        await supabaseClient
          .from("transaction_receipts")
          .insert({
            transaction_type: "balance",
            order_id: orderId,
            customer_id: currentOrder.customer_id,
            payment_id: operationPaymentId,
            amount_cents: amountPaid,
            payment_method: paymentMethodType,
            payment_method_brand: paymentBrand,
            stripe_charge_id: latestChargeId,
            stripe_payment_intent_id: piId,
            notes: safeTipCents > 0
              ? `Balance payment ($${(balanceOnly / 100).toFixed(2)}) + tip ($${(safeTipCents / 100).toFixed(2)}) via Stripe Checkout`
              : "Customer portal balance payment via Stripe Checkout",
          });
      } catch (receiptErr: any) {
        // 23505 means webhook already inserted receipt — non-fatal; payment row is committed
        if (receiptErr?.code !== "23505") {
          console.warn("[reconcile-balance-payment] Failed to insert transaction receipt:", receiptErr);
        }
      }
    }

    // ── 7. Send receipt email to customer ─────────────────────────────────────
    try {
      const customer = Array.isArray(currentOrder?.customers) ? currentOrder.customers[0] : currentOrder?.customers;
      if (customer?.email) {
        const { data: bizSettings } = await supabaseClient
          .from("admin_settings")
          .select("key, value")
          .in("key", ["business_name", "business_phone", "logo_url"]);
        const biz: Record<string, string> = {};
        bizSettings?.forEach((s: { key: string; value: string | null }) => {
          if (s.value) biz[s.key] = s.value;
        });

        const shortId = orderId.substring(0, 8).toUpperCase();
        const fmt = formatCurrency;
        const businessName = biz.business_name || "Bounce Party Club";
        const businessPhone = biz.business_phone || "(313) 889-3860";
        const logoHtml = biz.logo_url
          ? `<img src="${biz.logo_url}" alt="${businessName}" style="height:60px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
          : "";
        const contactName = customer.first_name
          ? `${customer.first_name} ${customer.last_name || ""}`.trim()
          : "Customer";
        const cardText = formatPaymentMethodLabel(paymentMethodType, paymentBrand, paymentLast4);

        const eventDateStr = currentOrder?.event_date
          ? new Date(currentOrder.event_date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long", month: "long", day: "numeric", year: "numeric",
            })
          : "";
        const addr = Array.isArray(currentOrder?.addresses) ? currentOrder.addresses[0] : currentOrder?.addresses;
        const addressStr = addr ? `${addr.line1}, ${addr.city}, ${addr.state}` : "";

        const items: any[] = Array.isArray(currentOrder?.order_items) ? currentOrder.order_items : [];
        const itemsHtml = items.map((item: any) => {
          const unitName = orderItemName(item);
          const qty = item.qty || 1;
          const price = item.unit_price_cents || 0;
          return `<tr><td style="padding:4px 0;color:#374151;font-size:14px;">${qty}x ${unitName}</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(price * qty)}</td></tr>`;
        }).join("");

        const { data: customFees } = await supabaseClient
          .from("order_custom_fees")
          .select("name, amount_cents")
          .eq("order_id", orderId);
        const { data: discounts } = await supabaseClient
          .from("order_discounts")
          .select("name, amount_cents, percentage")
          .eq("order_id", orderId);

        const customFeesArr: Array<{ name: string; amount_cents: number }> = customFees || [];
        const discountsArr: Array<{ name: string; amount_cents: number | null; percentage: number | null }> = discounts || [];

        const figures = receiptOrderFigures(currentOrder, discountsArr, customFeesArr);
        const { subtotal, travelFee, surfaceFee, sameDayFee, generatorFee, tax, total } = figures;
        const depositPaid = currentOrder?.deposit_paid_cents || 0;
        const newBalanceDue = currentOrder?.balance_due_cents ?? 0;

        const feeRowsHtml = [
          travelFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Travel Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(travelFee)}</td></tr>` : "",
          surfaceFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Surface Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(surfaceFee)}</td></tr>` : "",
          sameDayFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Same-Day Pickup Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(sameDayFee)}</td></tr>` : "",
          generatorFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Generator Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(generatorFee)}</td></tr>` : "",
          receiptExtraFeeRowsHtml(figures, fmt),
          tax > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tax)}</td></tr>` : "",
          ...customFeesArr.map(f => f.amount_cents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">${f.name}</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(f.amount_cents)}</td></tr>` : ""),
          ...discountsArr.map(d => {
            const amt = receiptDiscountAmount(d, subtotal);
            return amt > 0 ? `<tr><td style="padding:4px 0;color:#059669;font-size:14px;">${d.name} (discount)</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">-${fmt(amt)}</td></tr>` : "";
          }),
        ].join("");

        const paymentDate = new Date().toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
        });
        const siteOrigin = getSiteOrigin();
        const portalUrl = (await buildPortalUrl(supabaseClient, orderId, siteOrigin)) ?? siteOrigin;

        const receiptHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #d1fae5;">
  <tr>
    <td align="center" style="padding:24px 40px 16px;border-bottom:2px solid #d1fae5;">
      ${logoHtml}
      <h1 style="margin:0;color:#059669;font-size:26px;font-weight:bold;">Payment Received!</h1>
      <p style="margin:6px 0 0;color:#6b7280;font-size:14px;">Order #${shortId}</p>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 40px 8px;">
      <p style="margin:0 0 6px;color:#374151;font-size:15px;">Hi ${contactName},</p>
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">Your payment has been processed successfully. Here's your receipt.</p>
      ${eventDateStr || addressStr ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Event Details</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:40%;">Order #:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${shortId}</td></tr>
            ${eventDateStr ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${eventDateStr}</td></tr>` : ""}
            ${addressStr ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${addressStr}</td></tr>` : ""}
          </table>
        </td></tr>
      </table>` : ""}
      ${itemsHtml ? `
      <p style="margin:0 0 10px;font-weight:bold;color:#111827;font-size:15px;">Order Items</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">${itemsHtml}</table>` : ""}
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td colspan="2" style="padding:0 0 8px;font-weight:bold;color:#111827;font-size:15px;">Payment Summary</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Subtotal:</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(subtotal)}</td></tr>
        ${feeRowsHtml}
        <tr style="border-top:2px solid #e5e7eb;"><td style="padding:10px 0 4px;font-weight:bold;color:#111827;">Total:</td><td style="padding:10px 0 4px;text-align:right;font-weight:bold;color:#111827;">${fmt(total)}</td></tr>
        ${safeTipCents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Crew Tip:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">${fmt(safeTipCents)}</td></tr>` : ""}
        ${depositPaid > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Deposit Paid:</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(depositPaid)}</td></tr>` : ""}
        <tr><td style="padding:4px 0;color:#059669;font-size:14px;font-weight:600;">Balance Payment:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;font-weight:600;">${fmt(balanceOnly)}</td></tr>
        <tr><td style="padding:4px 0;color:#374151;font-weight:600;">Remaining Balance:</td><td style="padding:4px 0;text-align:right;color:#374151;font-weight:600;">${fmt(newBalanceDue)}</td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Payment Receipt</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Method:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${cardText}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Amount Paid:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fmt(amountPaid)}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${paymentDate}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Transaction ID:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${shortId}</td></tr>
          </table>
        </td></tr>
      </table>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${portalUrl}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 32px;border-radius:6px;">Track Your Order</a>
      </div>
      <p style="margin:0 0 28px;color:#6b7280;font-size:14px;text-align:center;">Thank you for choosing ${businessName}!</p>
    </td>
  </tr>
  <tr>
    <td style="padding:16px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px;text-align:center;">
      <p style="margin:0;color:#6b7280;font-size:13px;">${businessName} | ${businessPhone}</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;

        const emailResp = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Apikey": Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            },
            body: JSON.stringify({
              to: customer.email,
              subject: `Payment Received - Order #${shortId}`,
              html: receiptHtml,
            }),
          }
        );
        if (!emailResp.ok) {
          const errText = await emailResp.text().catch(() => "");
          console.warn("[reconcile-balance-payment] send-email returned error (non-fatal):", emailResp.status, errText);
        }
      }
    } catch (emailErr) {
      console.warn("[reconcile-balance-payment] Failed to send receipt email:", emailErr);
    }

    // console.log(`[reconcile-balance-payment] Reconciled payment for order ${orderId}, PI ${piId}`);

    return new Response(
      JSON.stringify({ success: true, alreadyReconciled: false }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[reconcile-balance-payment] Fatal error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
