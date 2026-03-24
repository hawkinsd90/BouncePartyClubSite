/**
 * CUSTOMER BALANCE PAYMENT - Supabase Edge Function
 *
 * Charges the remaining balance (and optional tip) for a confirmed order.
 *
 * Path A – Card on file:
 *   Creates a PaymentIntent with off_session=true + confirm=true.
 *   On success: writes balance_paid_cents and tip_cents to orders,
 *   inserts one payment row (type=balance), logs a transaction receipt,
 *   and returns { success: true }.
 *   The stripe-webhook payment_intent.succeeded handler is intentionally
 *   written to skip the order-write if payment row already exists for that PI
 *   to prevent double-writes.
 *
 * Path B – No card / card invalid:
 *   Creates a Stripe Checkout session.
 *   Returns { url } for redirect.
 *   The webhook owns all DB writes for that path (checkout.session.completed).
 */

import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { validatePaymentMethod } from "../_shared/payment-validation.ts";
import { formatOrderId } from "../_shared/format-order-id.ts";
import { logTransaction } from "../_shared/transaction-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BalancePaymentRequest {
  orderId: string;
  amountCents: number;
  tipCents?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const body: BalancePaymentRequest = await req.json();
    const { orderId, amountCents, tipCents: rawTipCents = 0 } = body;

    const tipCents = Math.max(0, Math.round(Number(rawTipCents) || 0));
    const balanceCents = Math.max(0, Math.round(Number(amountCents) || 0));
    const totalChargeAmount = balanceCents + tipCents;

    if (!orderId || totalChargeAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid request: orderId required and total must be > 0." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Load Stripe secret key from admin_settings
    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    // Load order with contact details for notifications
    // balance_paid_cents is read here so we can ACCUMULATE on top of it (not overwrite)
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select(`
        id, subtotal_cents, balance_due_cents, balance_paid_cents, deposit_paid_cents,
        tip_cents, stripe_customer_id, stripe_payment_method_id,
        payment_method_brand, payment_method_last_four, customer_id, event_date,
        travel_fee_cents, surface_fee_cents, same_day_pickup_fee_cents, generator_fee_cents, tax_cents,
        addresses(address_line1, city, state, zip),
        customers(email, first_name, last_name),
        order_items(quantity, unit_price_cents, units(name))
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine origin for Stripe Checkout redirect URLs
    const headerOrigin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    let siteOrigin = headerOrigin;
    if (!siteOrigin && referer) {
      try { siteOrigin = new URL(referer).origin; } catch { /* ignore */ }
    }
    siteOrigin = siteOrigin || "https://bouncepartyclub.com";

    const paymentMethodId = order.stripe_payment_method_id;
    const stripeCustomerId = order.stripe_customer_id;

    // ─── PATH A: Card on file ────────────────────────────────────────────────
    if (paymentMethodId && stripeCustomerId) {
      const validation = await validatePaymentMethod(paymentMethodId, stripe);

      if (validation.valid) {
        // BPC-SECURITY-HARDENING: COMMENTED OUT FOR PRODUCTION.
        // Restore only after a true dev/staging environment and explicit safe gating are in place.
        // Previously logged a Stripe payment method ID (pm_xxx) — sensitive payment token.
        // console.log("[customer-balance-payment] Charging card on file:", paymentMethodId);

        let paymentIntent: Stripe.PaymentIntent;
        try {
          paymentIntent = await stripe.paymentIntents.create({
            amount: totalChargeAmount,
            currency: "usd",
            customer: stripeCustomerId,
            payment_method: paymentMethodId,
            off_session: true,
            confirm: true,
            metadata: {
              order_id: orderId,
              payment_type: "balance",
              tip_cents: String(tipCents),
              // Signal to webhook that edge fn already wrote DB so it can skip
              source: "customer_balance_payment_edge_fn",
            },
            description: `Balance payment for Order #${formatOrderId(orderId)}`,
          });
        } catch (stripeErr: any) {
          // Card declined / authentication required — fall through to Checkout
          console.warn("[customer-balance-payment] Off-session charge failed, falling back to Checkout:", stripeErr?.message);
          return await createCheckoutSession(
            stripe, supabaseClient, order, stripeCustomerId, balanceCents, tipCents, orderId, siteOrigin, corsHeaders
          );
        }

        if (paymentIntent.status !== "succeeded") {
          // Requires action — fall through to Checkout
          console.warn("[customer-balance-payment] PaymentIntent status:", paymentIntent.status, "— falling back to Checkout");
          // Cancel the intent so it doesn't sit open
          try { await stripe.paymentIntents.cancel(paymentIntent.id); } catch { /* ignore */ }
          return await createCheckoutSession(
            stripe, supabaseClient, order, stripeCustomerId, balanceCents, tipCents, orderId, siteOrigin, corsHeaders
          );
        }

        // Charge succeeded — write DB (one authoritative write, webhook will skip)
        // ACCUMULATE: add new payment on top of any prior balance_paid_cents
        const existingTip = order.tip_cents || 0;
        const existingBalancePaid = order.balance_paid_cents || 0;
        const existingBalanceDue = order.balance_due_cents || 0;
        const newBalanceDue = Math.max(0, existingBalanceDue - balanceCents);

        await supabaseClient
          .from("orders")
          .update({
            balance_paid_cents: existingBalancePaid + balanceCents,
            balance_due_cents: newBalanceDue,
            ...(tipCents > 0 ? { tip_cents: existingTip + tipCents } : {}),
          })
          .eq("id", orderId);

        // Retrieve card details from PaymentIntent for the receipt
        let paymentMethodType: string | null = "card";
        let paymentBrand: string | null = order.payment_method_brand || null;
        let paymentLast4: string | null = order.payment_method_last_four || null;
        let latestChargeId: string | null = null;
        let stripeFee = 0;
        let stripeNet = totalChargeAmount;

        try {
          const expandedPI = await stripe.paymentIntents.retrieve(paymentIntent.id, {
            expand: ["payment_method", "latest_charge"],
          });
          latestChargeId = typeof expandedPI.latest_charge === "string"
            ? expandedPI.latest_charge
            : (expandedPI.latest_charge as any)?.id || null;

          const pm = expandedPI.payment_method;
          if (pm && typeof pm === "object") {
            paymentMethodType = (pm as any).type || "card";
            if ((pm as any).card) {
              paymentBrand = (pm as any).card.brand || paymentBrand;
              paymentLast4 = (pm as any).card.last4 || paymentLast4;
            }
          }

          if (latestChargeId) {
            const charge = await stripe.charges.retrieve(latestChargeId, {
              expand: ["balance_transaction"],
            });
            const balanceTx = charge.balance_transaction;
            if (balanceTx && typeof balanceTx === "object") {
              stripeFee = (balanceTx as any).fee || 0;
              stripeNet = (balanceTx as any).net || totalChargeAmount;
            }
          }
        } catch (expandErr) {
          console.warn("[customer-balance-payment] Failed to expand PI details:", expandErr);
        }

        // Insert payment record — tagged with the PI id so webhook can detect duplicate
        const { data: paymentRecord } = await supabaseClient
          .from("payments")
          .insert({
            order_id: orderId,
            stripe_payment_intent_id: paymentIntent.id,
            amount_cents: totalChargeAmount,
            type: "balance",
            status: "succeeded",
            paid_at: new Date().toISOString(),
            payment_method: paymentMethodType,
            payment_brand: paymentBrand,
            payment_last4: paymentLast4,
            stripe_fee_amount: stripeFee,
            stripe_net_amount: stripeNet,
            currency: "usd",
          })
          .select("id")
          .maybeSingle();

        // Log transaction receipt
        if (paymentRecord && order.customer_id) {
          await logTransaction(supabaseClient, {
            transactionType: "balance",
            orderId,
            customerId: order.customer_id,
            paymentId: paymentRecord.id,
            amountCents: totalChargeAmount,
            paymentMethod: paymentMethodType,
            paymentMethodBrand: paymentBrand,
            stripeChargeId: latestChargeId,
            stripePaymentIntentId: paymentIntent.id,
            notes: tipCents > 0
              ? `Balance payment ($${(balanceCents / 100).toFixed(2)}) + tip ($${(tipCents / 100).toFixed(2)})`
              : "Customer portal balance payment",
          });
        }

        // Send customer receipt email
        try {
          const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
          if (customer?.email) {
            const { data: bizSettings } = await supabaseClient
              .from("admin_settings")
              .select("key, value")
              .in("key", ["business_name", "business_phone", "logo_url"]);
            const biz: Record<string, string> = {};
            bizSettings?.forEach((s: { key: string; value: string | null }) => {
              if (s.value) biz[s.key] = s.value;
            });

            await supabaseClient.functions.invoke("send-email", {
              body: {
                to: customer.email,
                subject: `Payment Received - Order #${formatOrderId(orderId)}`,
                html: buildReceiptEmail({
                  contactName: customer.first_name ? `${customer.first_name} ${customer.last_name || ""}`.trim() : "Customer",
                  orderId,
                  balanceCents,
                  tipCents,
                  totalChargeAmount,
                  cardBrand: paymentBrand,
                  cardLast4: paymentLast4,
                  eventDate: order.event_date,
                  order,
                  biz,
                }),
              },
            });
          }
        } catch (emailErr) {
          // Non-fatal — log and continue
          console.warn("[customer-balance-payment] Failed to send receipt email:", emailErr);
        }

        // BPC-SECURITY-HARDENING: COMMENTED OUT FOR PRODUCTION.
        // Restore only after a true dev/staging environment and explicit safe gating are in place.
        // Previously logged a Stripe PaymentIntent ID (pi_xxx) — sensitive payment token.
        // console.log("[customer-balance-payment] COF charge succeeded:", paymentIntent.id);

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.warn("[customer-balance-payment] Card on file invalid:", validation.reason, "— falling back to Checkout");
    }

    // ─── PATH B: No valid card — Stripe Checkout ─────────────────────────────
    let customerId = stripeCustomerId;
    if (!customerId) {
      const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
      const newCustomer = await stripe.customers.create({
        email: customer?.email,
        name: customer?.first_name ? `${customer.first_name} ${customer.last_name || ""}`.trim() : undefined,
        metadata: { order_id: orderId },
      });
      customerId = newCustomer.id;
      await supabaseClient
        .from("orders")
        .update({ stripe_customer_id: customerId })
        .eq("id", orderId);
    }

    return await createCheckoutSession(
      stripe, supabaseClient, order, customerId!, balanceCents, tipCents, orderId, siteOrigin, corsHeaders
    );
  } catch (error: unknown) {
    console.error("[customer-balance-payment] Fatal error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function createCheckoutSession(
  stripe: Stripe,
  supabaseClient: any,
  order: any,
  customerId: string,
  balanceCents: number,
  tipCents: number,
  orderId: string,
  siteOrigin: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

  if (balanceCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: "Order Balance Payment",
          description: `Order #${formatOrderId(orderId)}`,
        },
        unit_amount: balanceCents,
      },
      quantity: 1,
    });
  }

  if (tipCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: "Crew Tip",
          description: "Thank you for tipping the crew!",
        },
        unit_amount: tipCents,
      },
      quantity: 1,
    });
  }

  // success_url: go to portal with ?payment=success
  // cancel_url: go back to payment tab so tip state is NOT lost via URL param
  const success_url = `${siteOrigin}/customer-portal/${orderId}?payment=success`;
  const cancel_url = `${siteOrigin}/customer-portal/${orderId}?tab=payment&tip=${tipCents}`;

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    payment_method_types: ["card"],
    line_items: lineItems,
    success_url,
    cancel_url,
    metadata: {
      order_id: orderId,
      payment_type: "balance",
      tip_cents: String(tipCents),
    },
  });

  // BPC-SECURITY-HARDENING: COMMENTED OUT FOR PRODUCTION.
  // Restore only after a true dev/staging environment and explicit safe gating are in place.
  // Previously logged a Stripe Checkout Session ID (cs_xxx) — sensitive payment token.
  // console.log("[customer-balance-payment] Checkout session created:", session.id);

  return new Response(
    JSON.stringify({ url: session.url }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function buildReceiptEmail(opts: {
  contactName: string;
  orderId: string;
  balanceCents: number;
  tipCents: number;
  totalChargeAmount: number;
  cardBrand: string | null;
  cardLast4: string | null;
  eventDate: string | null;
  order: any;
  biz: Record<string, string>;
}): string {
  const { contactName, orderId, balanceCents, tipCents, totalChargeAmount, cardBrand, cardLast4, eventDate, order, biz } = opts;
  const orderNum = formatOrderId(orderId);
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const businessName = biz.business_name || "Bounce Party Club";
  const businessPhone = biz.business_phone || "(313) 889-3860";

  const cardText = cardBrand && cardLast4
    ? `${cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1)} \u2022\u2022\u2022\u2022 ${cardLast4}`
    : cardLast4
    ? `Card \u2022\u2022\u2022\u2022 ${cardLast4}`
    : "Card on file";

  const eventDateStr = eventDate
    ? new Date(eventDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";

  const addr = Array.isArray(order.addresses) ? order.addresses[0] : order.addresses;
  const addressStr = addr
    ? `${addr.address_line1}, ${addr.city}, ${addr.state}`
    : "";

  const items: any[] = Array.isArray(order.order_items) ? order.order_items : [];
  const itemsHtml = items.map((item: any) => {
    const unitName = item.units?.name || "Item";
    const qty = item.quantity || 1;
    const price = item.unit_price_cents || 0;
    return `<tr><td style="padding:4px 0;color:#374151;font-size:14px;">${qty}x ${unitName}</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(price * qty)}</td></tr>`;
  }).join("");

  const subtotal = order.subtotal_cents || 0;
  const travelFee = order.travel_fee_cents || 0;
  const surfaceFee = order.surface_fee_cents || 0;
  const sameDayFee = order.same_day_pickup_fee_cents || 0;
  const generatorFee = order.generator_fee_cents || 0;
  const tax = order.tax_cents || 0;
  const total = subtotal + travelFee + surfaceFee + sameDayFee + generatorFee + tax;
  const depositPaid = order.deposit_paid_cents || 0;
  const newBalanceDue = Math.max(0, (order.balance_due_cents || 0) - balanceCents);

  const feeRowsHtml = [
    travelFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Travel Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(travelFee)}</td></tr>` : "",
    surfaceFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Surface Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(surfaceFee)}</td></tr>` : "",
    sameDayFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Same-Day Pickup Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(sameDayFee)}</td></tr>` : "",
    generatorFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Generator Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(generatorFee)}</td></tr>` : "",
    tax > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tax)}</td></tr>` : "",
  ].join("");

  const paymentDate = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });

  const portalUrl = `https://bouncepartyclub.com/customer-portal/${orderId}`;

  const logoHtml = biz.logo_url
    ? `<img src="${biz.logo_url}" alt="${businessName}" style="height:60px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
    : "";

  return `<!DOCTYPE html>
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
      <p style="margin:6px 0 0;color:#6b7280;font-size:14px;">Order #${orderNum}</p>
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
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:40%;">Order #:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${orderNum}</td></tr>
            ${eventDateStr ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${eventDateStr}</td></tr>` : ""}
            ${addressStr ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${addressStr}</td></tr>` : ""}
          </table>
        </td></tr>
      </table>` : ""}

      ${itemsHtml ? `
      <p style="margin:0 0 10px;font-weight:bold;color:#111827;font-size:15px;">Order Items</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        ${itemsHtml}
      </table>` : ""}

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td colspan="2" style="padding:0 0 8px;font-weight:bold;color:#111827;font-size:15px;">Payment Summary</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Subtotal:</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(subtotal)}</td></tr>
        ${feeRowsHtml}
        <tr style="border-top:2px solid #e5e7eb;"><td style="padding:10px 0 4px;font-weight:bold;color:#111827;">Total:</td><td style="padding:10px 0 4px;text-align:right;font-weight:bold;color:#111827;">${fmt(total)}</td></tr>
        ${tipCents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Crew Tip:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">${fmt(tipCents)}</td></tr>` : ""}
        ${depositPaid > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Deposit Paid:</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(depositPaid)}</td></tr>` : ""}
        <tr><td style="padding:4px 0;color:#059669;font-size:14px;font-weight:600;">Balance Payment:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;font-weight:600;">${fmt(balanceCents)}</td></tr>
        <tr><td style="padding:4px 0;color:#374151;font-weight:600;">Remaining Balance:</td><td style="padding:4px 0;text-align:right;color:#374151;font-weight:600;">${fmt(newBalanceDue)}</td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Payment Receipt</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Method:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${cardText}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Amount Paid:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fmt(totalChargeAmount)}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${paymentDate}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Transaction ID:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${orderNum}</td></tr>
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
}
