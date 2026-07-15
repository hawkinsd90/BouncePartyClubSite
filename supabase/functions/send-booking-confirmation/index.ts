import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
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
    const { orderId, source, invoiceToken } = await req.json();

    if (!orderId) {
      return new Response(JSON.stringify({ success: false, error: "Missing orderId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Atomic claim: only one caller proceeds to send notifications
    const { data: claimResult, error: claimError } = await supabase.rpc("claim_booking_confirmation", {
      p_order_id: orderId,
      p_source: source || "unknown",
    });

    if (claimError) {
      console.error("[send-booking-confirmation] claim RPC error:", claimError.message);
      return new Response(JSON.stringify({ success: false, error: "Claim failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claimData = claimResult as any;
    if (!claimData?.claimed) {
      // Another caller already claimed or already sent
      return new Response(JSON.stringify({ success: true, alreadySent: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load order with relations
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        id, status, event_date, event_end_date, start_window, end_window,
        subtotal_cents, travel_fee_cents, surface_fee_cents,
        same_day_pickup_fee_cents, generator_fee_cents, tax_cents,
        deposit_due_cents, deposit_paid_cents, balance_due_cents,
        tip_cents, sms_consent, location_type, surface,
        customers (id, first_name, last_name, email, phone),
        addresses (line1, line2, city, state, zip),
        order_items (id, qty, wet_or_dry, unit_price_cents, units (id, name)),
        order_custom_fees (id, label, amount_cents),
        order_discounts (id, label, amount_cents)
      `)
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      console.error("[send-booking-confirmation] order fetch failed:", orderError?.message || "not found");
      await supabase.from("orders").update({ booking_confirmation_status: "failed" }).eq("id", orderId);
      return new Response(JSON.stringify({ success: false, error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
    const address = Array.isArray(order.addresses) ? order.addresses[0] : order.addresses;
    const items = Array.isArray(order.order_items) ? order.order_items : [];
    const customFees = Array.isArray(order.order_custom_fees) ? order.order_custom_fees : [];
    const discounts = Array.isArray(order.order_discounts) ? order.order_discounts : [];

    if (!customer) {
      console.error("[send-booking-confirmation] no customer for order:", orderId);
      await supabase.from("orders").update({ booking_confirmation_status: "failed" }).eq("id", orderId);
      return new Response(JSON.stringify({ success: false, error: "No customer" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create or reuse secure portal short link
    let portalUrl: string | null = null;

    if (invoiceToken) {
      const { data: shortLinkResult, error: shortLinkError } = await supabase.rpc("create_portal_short_link", {
        p_invoice_token: invoiceToken,
      });

      if (!shortLinkError && shortLinkResult?.success && shortLinkResult?.short_code) {
        portalUrl = `${supabaseUrl.replace("supabase.co", "bouncepartyclub.com")}/i/${shortLinkResult.short_code}`;
      }
    }

    if (!portalUrl) {
      const origin = Deno.env.get("SITE_URL") || "https://bouncepartyclub.com";
      portalUrl = `${origin}/customer-portal/${orderId}`;
      console.warn("[send-booking-confirmation] using fallback URL for order:", orderId);
    }

    const shortId = formatOrderId(orderId);
    const firstName = customer.first_name || "";
    const eventDateStr = order.event_date
      ? new Date(order.event_date + "T12:00:00").toLocaleDateString("en-US", {
          weekday: "long", month: "long", day: "numeric", year: "numeric",
        })
      : "";

    // Generate SMS
    const smsMessage = `Hi ${firstName}, your booking for ${eventDateStr} is confirmed! Order #${shortId}. Track your order: ${portalUrl}. We'll contact you closer to your event date.`;

    // Generate email HTML
    const itemsHtml = items.map((item: any) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#374151;">
          ${item.qty}x ${item.units?.name || ""} (${item.wet_or_dry === "water" ? "Wet" : "Dry"})
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">
          $${((item.unit_price_cents * item.qty) / 100).toFixed(2)}
        </td>
      </tr>`).join("");

    const feesHtml = customFees.map((fee: any) => `
      <tr>
        <td style="padding:4px 0;color:#374151;">${fee.label}</td>
        <td style="padding:4px 0;text-align:right;color:#374151;">$${((fee.amount_cents || 0) / 100).toFixed(2)}</td>
      </tr>`).join("");

    const discountsHtml = discounts.map((disc: any) => `
      <tr>
        <td style="padding:4px 0;color:#059669;">${disc.label}</td>
        <td style="padding:4px 0;text-align:right;color:#059669;">-$${((disc.amount_cents || 0) / 100).toFixed(2)}</td>
      </tr>`).join("");

    const addressStr = address
      ? `${address.line1}${address.line2 ? ", " + address.line2 : ""}, ${address.city}, ${address.state} ${address.zip}`
      : "";

    const totalCents =
      (order.subtotal_cents || 0) +
      (order.travel_fee_cents || 0) +
      (order.surface_fee_cents || 0) +
      (order.same_day_pickup_fee_cents || 0) +
      (order.generator_fee_cents || 0) +
      (order.tax_cents || 0) +
      customFees.reduce((sum: number, f: any) => sum + (f.amount_cents || 0), 0) -
      discounts.reduce((sum: number, d: any) => sum + (d.amount_cents || 0), 0);

    const emailHtml = `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">
        <h1 style="color:#059669;font-size:24px;margin-bottom:16px;">Booking Confirmed!</h1>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;">Great news! Your booking is confirmed. Here are your order details:</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Order #</td><td style="padding:4px 0;color:#111827;font-weight:bold;">${shortId}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Event Date</td><td style="padding:4px 0;color:#111827;">${eventDateStr}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Time Window</td><td style="padding:4px 0;color:#111827;">${order.start_window || ""} - ${order.end_window || ""}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Delivery Address</td><td style="padding:4px 0;color:#111827;">${addressStr}</td></tr>
        </table>
        <h2 style="font-size:18px;color:#111827;margin-bottom:12px;">Items</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">${itemsHtml}</table>
        ${(feesHtml || discountsHtml) ? `
        <h2 style="font-size:18px;color:#111827;margin-bottom:12px;">Fees & Discounts</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">${feesHtml}${discountsHtml}</table>` : ""}
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <tr style="border-top:2px solid #e5e7eb;">
            <td style="padding:12px 0;font-weight:bold;color:#111827;">Total</td>
            <td style="padding:12px 0;text-align:right;font-weight:bold;color:#111827;">$${(totalCents / 100).toFixed(2)}</td>
          </tr>
        </table>
        <a href="${portalUrl}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 32px;border-radius:6px;">Track Your Order</a>
      </div>`;

    let smsSent = false;
    let emailSent = false;

    // Send SMS if consent + phone
    if (order.sms_consent && customer.phone) {
      try {
        const { error: smsError } = await supabase.functions.invoke("send-sms-notification", {
          body: { to: customer.phone, message: smsMessage, orderId, templateKey: "booking_confirmed" },
        });
        if (smsError) {
          console.error("[send-booking-confirmation] SMS send error:", smsError.message);
        } else {
          smsSent = true;
        }
      } catch (smsErr) {
        console.error("[send-booking-confirmation] SMS send threw:", smsErr instanceof Error ? smsErr.message : "unknown");
      }
    }

    // Send email if email exists
    if (customer.email) {
      try {
        const { error: emailError } = await supabase.functions.invoke("send-email", {
          body: {
            to: customer.email,
            subject: `Booking Confirmed - Receipt for Order #${shortId}`,
            html: emailHtml,
            orderId,
          },
        });
        if (emailError) {
          console.error("[send-booking-confirmation] email send error:", emailError.message);
        } else {
          emailSent = true;
        }
      } catch (emailErr) {
        console.error("[send-booking-confirmation] email send threw:", emailErr instanceof Error ? emailErr.message : "unknown");
      }
    }

    // Mark as sent only if at least one notification was delivered
    if (smsSent || emailSent) {
      const { error: markError } = await supabase
        .from("orders")
        .update({ booking_confirmation_sent: true, booking_confirmation_status: "sent" })
        .eq("id", orderId);

      if (markError) {
        console.error("[send-booking-confirmation] failed to mark as sent:", markError.message);
      }
    } else {
      const { error: failError } = await supabase
        .from("orders")
        .update({ booking_confirmation_status: "failed" })
        .eq("id", orderId);

      if (failError) {
        console.error("[send-booking-confirmation] failed to mark as failed:", failError.message);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      smsSent,
      emailSent,
      alreadySent: false,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("[send-booking-confirmation] fatal error:", error instanceof Error ? error.message : "unknown");
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
