import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import { validatePaymentMethod } from "../_shared/payment-validation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    // Parse body early for rate limiting
    const { orderId } = await req.json();

    const ip = getIdentifier(req);
    const identifier = buildRateLimitKey(ip, orderId, 'deposit');

    if (!ip && !orderId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request: unable to identify client' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rateLimitResult = await checkRateLimit('charge-deposit', identifier, undefined, true);

    if (!rateLimitResult.allowed) {
      if (rateLimitResult.reason === 'missing_identifier') {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid request: unable to identify client' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    if (!orderId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing orderId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get Stripe secret key
    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      return new Response(
        JSON.stringify({ success: false, error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    // Load the order
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select(
        "id, stripe_customer_id, stripe_payment_method_id, deposit_due_cents, tip_cents, deposit_paid_cents, status, customer_selected_payment_cents, subtotal_cents, travel_fee_cents, surface_fee_cents, same_day_pickup_fee_cents, generator_fee_cents, tax_cents, discount_cents"
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!order.stripe_customer_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No payment method on file for this order",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If order doesn't have a payment method ID, try to find one from the Stripe customer
    let resolvedPaymentMethodId = order.stripe_payment_method_id;
    if (!resolvedPaymentMethodId) {
      try {
        const paymentMethods = await stripe.paymentMethods.list({
          customer: order.stripe_customer_id,
          type: "card",
          limit: 1,
        });
        if (paymentMethods.data.length > 0) {
          resolvedPaymentMethodId = paymentMethods.data[0].id;
          // Save it back to the order for future use
          await supabaseClient
            .from("orders")
            .update({ stripe_payment_method_id: resolvedPaymentMethodId })
            .eq("id", orderId);
          console.log(`[charge-deposit] Resolved missing payment method from Stripe customer: ${resolvedPaymentMethodId}`);
        }
      } catch (pmLookupError) {
        console.error("[charge-deposit] Failed to look up payment methods:", pmLookupError);
      }
    }

    if (!resolvedPaymentMethodId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No payment method on file for this order",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use customer_selected_payment_cents if available (for approval flow), otherwise deposit_due_cents
    const paymentAmountCents = order.customer_selected_payment_cents || order.deposit_due_cents;

    if (!paymentAmountCents || paymentAmountCents <= 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No deposit amount configured for this order",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If already paid, just update status to confirmed (avoid double charge)
    if (order.deposit_paid_cents && order.deposit_paid_cents >= paymentAmountCents) {
      // Still need to update status if it's not confirmed yet
      if (order.status !== 'confirmed') {
        const { error: updateError } = await supabaseClient
          .from("orders")
          .update({ status: "confirmed" })
          .eq("id", orderId);

        if (updateError) {
          console.error("Failed to update order status:", updateError);
          return new Response(
            JSON.stringify({ success: false, error: `Failed to update order: ${updateError.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          alreadyCharged: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validation = await validatePaymentMethod(resolvedPaymentMethodId, stripe);

    if (!validation.valid) {
      return new Response(
        JSON.stringify({
          success: false,
          error: validation.reason,
          needsNewCard: validation.needsNewCard
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (validation.expMonth && validation.expYear && validation.last4) {
      await supabaseClient
        .from("orders")
        .update({
          payment_method_validated_at: new Date().toISOString(),
          payment_method_exp_month: validation.expMonth,
          payment_method_exp_year: validation.expYear,
          payment_method_last_four: validation.last4,
        })
        .eq("id", orderId);
    }

    // Charge the payment amount + tip
    // IMPORTANT: Tip is ONLY added to the charge amount, NOT to deposit_paid_cents
    const chargeAmountCents = paymentAmountCents + (order.tip_cents ?? 0);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargeAmountCents,
      currency: "usd",
      customer: order.stripe_customer_id,
      payment_method: resolvedPaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        order_id: orderId,
        payment_type: "deposit",
      },
    });

    if (paymentIntent.status !== "succeeded") {
      return new Response(
        JSON.stringify({
          success: false,
          error: `PaymentIntent status is ${paymentIntent.status}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the customer approval to changelog (service role bypasses RLS)
    await supabaseClient.from("order_changelog").insert({
      order_id: orderId,
      user_id: null,
      change_type: "customer_approval",
      field_changed: "status",
      old_value: "awaiting_customer_approval",
      new_value: "confirmed",
    });

    // Recalculate balance_due_cents based on current order totals minus what was just paid.
    // tip and discount are both excluded from the base order total:
    //   - tip is tracked separately in tip_cents
    //   - discount reduces the total the customer owes
    const orderTotal =
      (order.subtotal_cents || 0) +
      (order.travel_fee_cents || 0) +
      (order.surface_fee_cents || 0) +
      (order.same_day_pickup_fee_cents || 0) +
      (order.generator_fee_cents || 0) +
      (order.tax_cents || 0) -
      (order.discount_cents || 0);
    const newBalanceDue = Math.max(0, orderTotal - paymentAmountCents);

    // Update order as paid & confirmed
    // IMPORTANT: deposit_paid_cents should NOT include tip
    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({
        status: "confirmed",
        deposit_paid_cents: paymentAmountCents,
        stripe_payment_status: "paid",
        balance_due_cents: newBalanceDue,
      })
      .eq("id", orderId);

    if (updateError) {
      console.error("Failed to update order status:", updateError);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to update order: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get payment method details and Stripe fees
    let paymentMethod = null;
    let paymentBrand = null;
    let paymentLast4 = null;
    let stripeFee = 0;
    let stripeNet = chargeAmountCents;

    if (paymentIntent.payment_method) {
      const pmId = typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : paymentIntent.payment_method.id;

      try {
        const pm = await stripe.paymentMethods.retrieve(pmId);

        if (pm.type === "card" && pm.card) {
          paymentMethod = "card";
          paymentBrand = pm.card.brand;
          paymentLast4 = pm.card.last4;
        } else if (pm.type === "us_bank_account") {
          paymentMethod = "bank_account";
          paymentLast4 = pm.us_bank_account?.last4;
        } else {
          paymentMethod = pm.type;
        }
      } catch (pmError) {
        console.error("Failed to retrieve payment method details:", pmError);
      }
    }

    // Retrieve Stripe fees from the charge (with balance_transaction expansion)
    if (paymentIntent.latest_charge) {
      try {
        const chargeId = typeof paymentIntent.latest_charge === "string"
          ? paymentIntent.latest_charge
          : paymentIntent.latest_charge.id;

        // IMPORTANT: Expand balance_transaction to get fee/net as object
        const charge = await stripe.charges.retrieve(chargeId, {
          expand: ['balance_transaction']
        });

        const balanceTx = charge.balance_transaction;

        // After expansion, balance_transaction should be an object
        if (balanceTx && typeof balanceTx === 'object') {
          stripeFee = balanceTx.fee || 0;
          stripeNet = balanceTx.net || chargeAmountCents;
          console.log(`[Fees] Stripe fee: ${stripeFee}, Net: ${stripeNet}, Currency: ${charge.currency}`);
        } else {
          console.warn('[Fees] balance_transaction not expanded, fees will be 0');
        }
      } catch (feeError) {
        console.error("Failed to retrieve Stripe fee data:", feeError);
      }
    }

    // Record payment with the full charge amount (including tip) and Stripe fees
    const { error: paymentError } = await supabaseClient.from("payments").insert({
      order_id: orderId,
      stripe_payment_intent_id: paymentIntent.id,
      amount_cents: chargeAmountCents,
      type: "deposit",
      status: "succeeded",
      paid_at: new Date().toISOString(),
      payment_method: paymentMethod,
      payment_brand: paymentBrand,
      payment_last4: paymentLast4,
      stripe_fee_amount: stripeFee,
      stripe_net_amount: stripeNet,
      currency: 'usd',
    });

    if (paymentError) {
      console.error("Failed to record payment:", paymentError);
      // Don't fail the whole request since charge succeeded, just log it
    }

    // Build and send rich booking confirmation + receipt email
    try {
      const { data: fullOrder } = await supabaseClient
        .from("orders")
        .select(`
          *,
          customers(first_name, last_name, email),
          order_items(qty, wet_or_dry, unit_price_cents, units(name)),
          addresses(line1, city, state, zip)
        `)
        .eq("id", orderId)
        .maybeSingle();

      if (fullOrder && fullOrder.customers?.email) {
        const { data: businessSettings } = await supabaseClient
          .from("admin_settings")
          .select("key, value")
          .in("key", ["business_name", "business_phone", "business_email", "logo_url"]);

        const biz: Record<string, string> = {};
        businessSettings?.forEach((s: { key: string; value: string | null }) => {
          if (s.value) biz[s.key] = s.value;
        });

        const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
        const firstName = fullOrder.customers.first_name || "";
        const addr = fullOrder.addresses;
        const addressStr = addr ? `${addr.line1}, ${addr.city}, ${addr.state}` : (fullOrder.event_address_line1 || "");

        const eventDate = fullOrder.event_date
          ? new Date(fullOrder.event_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
          : "";
        const timeWindow = `${fullOrder.start_window || ""} - ${fullOrder.end_window || ""}`;

        const shortId = orderId.replace(/-/g, "").toUpperCase().slice(0, 8);
        const portalUrl = `${Deno.env.get("SUPABASE_URL")?.replace("supabase.co", "bouncepartyclub.com").replace(/\/.*$/, "") || "https://bouncepartyclub.com"}/customer-portal/${orderId}`;

        const itemsHtml = (fullOrder.order_items || []).map((item: { qty: number; units: { name: string }; wet_or_dry: string; unit_price_cents: number }) =>
          `<tr>
            <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#374151;">
              ${item.qty}x ${item.units?.name || ""} (${item.wet_or_dry === "water" ? "Wet" : "Dry"})
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">
              ${fmt(item.unit_price_cents * item.qty)}
            </td>
          </tr>`
        ).join("");

        const subtotal = fullOrder.subtotal_cents || 0;
        const travelFee = fullOrder.travel_fee_cents || 0;
        const surfaceFee = fullOrder.surface_fee_cents || 0;
        const sameDayFee = fullOrder.same_day_pickup_fee_cents || 0;
        const tax = fullOrder.tax_cents || 0;
        const tip = fullOrder.tip_cents || 0;
        const total = subtotal + travelFee + surfaceFee + sameDayFee + tax;
        const depositPaid = paymentAmountCents;
        const balanceRemaining = Math.max(0, total - depositPaid);

        const feeRowsHtml = [
          travelFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Travel Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(travelFee)}</td></tr>` : "",
          surfaceFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Surface Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(surfaceFee)}</td></tr>` : "",
          sameDayFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Same Day Pickup</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(sameDayFee)}</td></tr>` : "",
          tax > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tax)}</td></tr>` : "",
          tip > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tip</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tip)}</td></tr>` : "",
        ].join("");

        const paymentMethodStr = paymentBrand && paymentLast4
          ? `${paymentBrand} •••• ${paymentLast4}`
          : paymentMethod || "Card";

        const paymentDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

        const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #d1fae5;">
  <tr>
    <td align="center" style="padding:24px 40px 16px;border-bottom:2px solid #d1fae5;">
      ${biz.logo_url ? `<img src="${biz.logo_url}" alt="${biz.business_name || "Bounce Party Club"}" style="height:60px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">` : ""}
      <h1 style="margin:0;color:#059669;font-size:26px;font-weight:bold;">Booking Confirmed!</h1>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 40px 8px;">
      <p style="margin:0 0 6px;color:#374151;font-size:15px;">Hi ${firstName},</p>
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">Great news! Your booking is confirmed and your deposit has been processed.</p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Event Details</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;width:40%;">Order #:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${shortId}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${eventDate}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Time:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${timeWindow}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${addressStr}</td></tr>
            ${fullOrder.location_type ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location Type:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${fullOrder.location_type}</td></tr>` : ""}
            ${fullOrder.surface ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Surface:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${fullOrder.surface}</td></tr>` : ""}
            ${fullOrder.special_details ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Special Details:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fullOrder.special_details}</td></tr>` : ""}
          </table>
        </td></tr>
      </table>

      <p style="margin:0 0 10px;font-weight:bold;color:#111827;font-size:15px;">Order Items</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        ${itemsHtml}
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td colspan="2" style="padding:0 0 8px;font-weight:bold;color:#111827;font-size:15px;">Payment Summary</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Subtotal:</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(subtotal)}</td></tr>
        ${feeRowsHtml}
        <tr style="border-top:2px solid #e5e7eb;"><td style="padding:10px 0 4px;font-weight:bold;color:#111827;">Total:</td><td style="padding:10px 0 4px;text-align:right;font-weight:bold;color:#111827;">${fmt(total)}</td></tr>
        ${tip > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tip:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">${fmt(tip)}</td></tr>` : ""}
        <tr><td style="padding:4px 0;color:#059669;font-size:14px;font-weight:600;">Deposit Paid:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;font-weight:600;">${fmt(depositPaid)}</td></tr>
        <tr><td style="padding:4px 0;color:#374151;font-weight:600;">Balance Due:</td><td style="padding:4px 0;text-align:right;color:#374151;font-weight:600;">${fmt(balanceRemaining)}</td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-weight:bold;color:#065f46;font-size:15px;">Payment Receipt</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Method:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${paymentMethodStr}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Amount Paid:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fmt(chargeAmountCents)}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Payment Date:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${paymentDate}</td></tr>
            <tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Transaction ID:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${shortId}</td></tr>
          </table>
        </td></tr>
      </table>

      <div style="text-align:center;margin-bottom:24px;">
        <a href="${portalUrl}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 32px;border-radius:6px;">Track Your Order</a>
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;margin-bottom:24px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 8px;font-weight:bold;color:#1e40af;font-size:14px;">What's Next?</p>
          <ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;line-height:1.7;">
            <li>We will contact you closer to your event date to confirm details</li>
            <li>The remaining balance is due on or before your event date</li>
            <li>Reply to this email or call us at ${biz.business_phone || "(313) 889-3860"} with questions</li>
          </ul>
        </td></tr>
      </table>

      <p style="margin:0 0 28px;color:#6b7280;font-size:14px;text-align:center;">Thank you for choosing ${biz.business_name || "Bounce Party Club"}!</p>
    </td>
  </tr>
  <tr>
    <td style="padding:16px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px;text-align:center;">
      <p style="margin:0;color:#6b7280;font-size:13px;">${biz.business_name || "Bounce Party Club"} | ${biz.business_phone || "(313) 889-3860"}</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;

        await supabaseClient.functions.invoke("send-email", {
          body: {
            to: fullOrder.customers.email,
            subject: `Booking Confirmed - Receipt for Order #${shortId}`,
            html: emailHtml,
          },
        });
        console.log("[charge-deposit] Rich booking confirmation email sent");
      }
    } catch (emailError) {
      console.error("Failed to send booking confirmation email:", emailError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        paymentDetails: {
          paymentIntentId: paymentIntent.id,
          chargeId: paymentIntent.latest_charge,
          amountCents: chargeAmountCents,
          paymentMethod,
          paymentBrand,
          paymentLast4,
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("charge-deposit error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
