/**
 * RECONCILE BALANCE PAYMENT - Supabase Edge Function
 *
 * Called after a customer returns from Stripe Checkout (Path B balance payment).
 * Verifies the session directly with Stripe and idempotently writes any DB state
 * that the webhook may not have written yet.
 *
 * Race-safety model:
 * ─────────────────
 * The payments table has a unique constraint on stripe_payment_intent_id.
 * This function inserts the payment row FIRST (before any order mutation).
 * Whichever concurrent writer (reconcile or webhook) inserts first wins the
 * constraint and proceeds to update order totals and log the receipt.
 * The loser receives a 23505 unique-violation, detects it, and returns
 * { alreadyReconciled: true } without touching order totals.
 *
 * This guarantees:
 * - Exactly one writer increments balance_paid_cents / decrements balance_due_cents
 * - Exactly one payment row exists per PaymentIntent
 * - Exactly one transaction receipt exists per PaymentIntent
 * - Safe to call multiple times; all calls after the first are no-ops
 */

import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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
    const tipCentsStr = session.metadata?.tip_cents || "0";
    const safeTipCents = Math.max(0, parseInt(tipCentsStr, 10) || 0);
    const balanceOnly = Math.max(0, amountPaid - safeTipCents);

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

    // ── 4. RACE-SAFE + REPAIR-SAFE: Insert payment row FIRST ──────────────────
    // The unique constraint on stripe_payment_intent_id is our distributed mutex.
    //
    // order_financials_applied starts FALSE. The winner sets it TRUE only after
    // the order UPDATE succeeds. On 23505, the caller reads the flag:
    //   TRUE  → financial work is complete; skip safely (idempotent)
    //   FALSE → prior winner partially failed (order UPDATE crashed); this caller
    //            performs the repair, then marks the flag TRUE.
    //
    // This guarantees: even after a partial failure, the next retry (reconcile or
    // webhook) automatically repairs stale order totals — without double-writing.
    const { data: paymentRecord, error: paymentInsertError } = await supabaseClient
      .from("payments")
      .insert({
        order_id: orderId,
        stripe_payment_intent_id: piId,
        amount_cents: amountPaid,
        type: "balance",
        status: "succeeded",
        paid_at: new Date().toISOString(),
        payment_method: paymentMethodType,
        payment_brand: paymentBrand,
        payment_last4: paymentLast4,
        stripe_fee_amount: stripeFee,
        stripe_net_amount: stripeNet,
        currency: "usd",
        order_financials_applied: false,
      })
      .select("id")
      .maybeSingle();

    if (paymentInsertError) {
      if (paymentInsertError.code === "23505") {
        // Another writer already inserted this PI's payment row (webhook or a prior reconcile).
        // Call the same atomic RPC — it will lock the row, check the applied flag, and apply
        // financials exactly once if not yet done. Identical to the winner path below.
        console.warn("[reconcile-balance-payment] 23505 on insert — delegating to RPC", { orderId, piId });
        const { data: repairRows, error: repairErr } = await supabaseClient
          .rpc("apply_balance_payment_financials", {
            p_pi_id: piId,
            p_order_id: orderId,
            p_balance_cents: balanceOnly,
            p_tip_cents: safeTipCents,
            p_pm_id: expandedPmId || null,
            p_customer_id: stripeCustomerId || null,
          });
        if (repairErr) {
          console.error("[reconcile-balance-payment] apply_balance_payment_financials failed on 23505 path", { orderId, piId, repairErr });
        } else {
          const _r = Array.isArray(repairRows) ? repairRows[0] : repairRows;
          // console.log("[reconcile-balance-payment] 23505 RPC result", { orderId, piId, applied: _r?.applied, payment_row_found: _r?.payment_row_found });
        }
        return new Response(
          JSON.stringify({ success: true, alreadyReconciled: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.error("[reconcile-balance-payment] Payment insert failed:", paymentInsertError);
      return new Response(
        JSON.stringify({ error: "Failed to insert payment record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 5. We inserted the row — apply order financials through the atomic RPC ─
    // The RPC locks the payment row we just inserted, verifies applied=false,
    // reads+updates order totals, and marks applied=true — all in one transaction.
    // This prevents any concurrent caller (pi.succeeded, a second reconcile) from
    // racing with us: they will block on the row lock until we commit, then see
    // applied=true and skip.
    const { data: applyRows, error: applyErr } = await supabaseClient
      .rpc("apply_balance_payment_financials", {
        p_pi_id: piId,
        p_order_id: orderId,
        p_balance_cents: balanceOnly,
        p_tip_cents: safeTipCents,
        p_pm_id: expandedPmId || null,
        p_customer_id: stripeCustomerId || null,
      });

    if (applyErr) {
      console.error("[reconcile-balance-payment] apply_balance_payment_financials failed", { orderId, piId, applyErr });
      // Payment row is committed with order_financials_applied=FALSE.
      // Next retry (reconcile or webhook pi.succeeded) will call the RPC and repair.
      return new Response(
        JSON.stringify({ error: "Order financial update failed after payment insert" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const _applyResult = Array.isArray(applyRows) ? applyRows[0] : applyRows;
    // console.log("[reconcile-balance-payment] RPC applied financials", { orderId, piId, applied: _applyResult?.applied });

    // Fetch full order data for receipt logging and email
    const { data: currentOrder } = await supabaseClient
      .from("orders")
      .select(`
        customer_id, event_date,
        subtotal_cents, travel_fee_cents, surface_fee_cents,
        same_day_pickup_fee_cents, generator_fee_cents, tax_cents,
        travel_fee_waived, surface_fee_waived, same_day_pickup_fee_waived,
        generator_fee_waived, tax_waived,
        deposit_paid_cents, balance_due_cents,
        addresses(line1, city, state, zip),
        order_items(qty, unit_price_cents, units(name)),
        customers(email, first_name, last_name)
      `)
      .eq("id", orderId)
      .maybeSingle();

    // ── 6. Log transaction receipt (idempotent via unique PI id constraint) ────
    if (paymentRecord && currentOrder?.customer_id) {
      try {
        await supabaseClient
          .from("transaction_receipts")
          .insert({
            transaction_type: "balance",
            order_id: orderId,
            customer_id: currentOrder.customer_id,
            payment_id: paymentRecord.id,
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
        const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
        const businessName = biz.business_name || "Bounce Party Club";
        const businessPhone = biz.business_phone || "(313) 889-3860";
        const logoHtml = biz.logo_url
          ? `<img src="${biz.logo_url}" alt="${businessName}" style="height:60px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
          : "";
        const contactName = customer.first_name
          ? `${customer.first_name} ${customer.last_name || ""}`.trim()
          : "Customer";
        const cardText = paymentBrand && paymentLast4
          ? `${paymentBrand.charAt(0).toUpperCase() + paymentBrand.slice(1)} \u2022\u2022\u2022\u2022 ${paymentLast4}`
          : paymentLast4 ? `Card \u2022\u2022\u2022\u2022 ${paymentLast4}` : "Card on file";

        const eventDateStr = currentOrder?.event_date
          ? new Date(currentOrder.event_date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long", month: "long", day: "numeric", year: "numeric",
            })
          : "";
        const addr = Array.isArray(currentOrder?.addresses) ? currentOrder.addresses[0] : currentOrder?.addresses;
        const addressStr = addr ? `${addr.line1}, ${addr.city}, ${addr.state}` : "";

        const items: any[] = Array.isArray(currentOrder?.order_items) ? currentOrder.order_items : [];
        const itemsHtml = items.map((item: any) => {
          const unitName = item.units?.name || "Item";
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

        const subtotal = currentOrder?.subtotal_cents || 0;
        const travelFee = currentOrder?.travel_fee_waived ? 0 : (currentOrder?.travel_fee_cents || 0);
        const surfaceFee = currentOrder?.surface_fee_waived ? 0 : (currentOrder?.surface_fee_cents || 0);
        const sameDayFee = currentOrder?.same_day_pickup_fee_waived ? 0 : (currentOrder?.same_day_pickup_fee_cents || 0);
        const generatorFee = currentOrder?.generator_fee_waived ? 0 : (currentOrder?.generator_fee_cents || 0);
        const tax = currentOrder?.tax_waived ? 0 : (currentOrder?.tax_cents || 0);
        const customFeesTotal = customFeesArr.reduce((s, f) => s + (f.amount_cents || 0), 0);
        const discountsTotal = discountsArr.reduce((s, d) => {
          if (d.percentage && d.percentage > 0) return s + Math.round(subtotal * (d.percentage / 100));
          return s + (d.amount_cents || 0);
        }, 0);
        const total = subtotal + travelFee + surfaceFee + sameDayFee + generatorFee + tax + customFeesTotal - discountsTotal;
        const depositPaid = currentOrder?.deposit_paid_cents || 0;
        const newBalanceDue = currentOrder?.balance_due_cents ?? 0;

        const feeRowsHtml = [
          travelFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Travel Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(travelFee)}</td></tr>` : "",
          surfaceFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Surface Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(surfaceFee)}</td></tr>` : "",
          sameDayFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Same-Day Pickup Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(sameDayFee)}</td></tr>` : "",
          generatorFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Generator Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(generatorFee)}</td></tr>` : "",
          tax > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tax)}</td></tr>` : "",
          ...customFeesArr.map(f => f.amount_cents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">${f.name}</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(f.amount_cents)}</td></tr>` : ""),
          ...discountsArr.map(d => {
            const amt = d.percentage && d.percentage > 0 ? Math.round(subtotal * (d.percentage / 100)) : (d.amount_cents || 0);
            return amt > 0 ? `<tr><td style="padding:4px 0;color:#059669;font-size:14px;">${d.name} (discount)</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">-${fmt(amt)}</td></tr>` : "";
          }),
        ].join("");

        const paymentDate = new Date().toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
        });
        const portalUrl = `https://bouncepartyclub.com/customer-portal/${orderId}`;

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
