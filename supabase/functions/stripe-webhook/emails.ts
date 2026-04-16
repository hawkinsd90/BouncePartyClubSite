import { formatCurrency, DEFAULT_PHONE } from "../_shared/fmt.ts";

export async function sendCheckoutBalanceReceiptEmail(
  supabaseClient: any,
  orderId: string,
  order: any,
  customer: any,
  biz: Record<string, string>,
  amountPaid: number,
  balanceOnly: number,
  tipCents: number,
  paymentBrand: string | null,
  paymentLast4: string | null,
): Promise<void> {
  const shortId = orderId.substring(0, 8).toUpperCase();
  const fmt = formatCurrency;
  const businessName = biz.business_name || "Bounce Party Club";
  const businessPhone = biz.business_phone || DEFAULT_PHONE;
  const logoHtml = biz.logo_url
    ? `<img src="${biz.logo_url}" alt="${businessName}" style="height:60px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
    : "";
  const contactName = customer.first_name ? `${customer.first_name} ${customer.last_name || ""}`.trim() : "Customer";
  const cardText = paymentBrand && paymentLast4
    ? `${paymentBrand.charAt(0).toUpperCase() + paymentBrand.slice(1)} \u2022\u2022\u2022\u2022 ${paymentLast4}`
    : paymentLast4 ? `Card \u2022\u2022\u2022\u2022 ${paymentLast4}` : "Card on file";

  const eventDateStr = order?.event_date
    ? new Date(order.event_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";
  const addr = Array.isArray(order?.addresses) ? order.addresses[0] : order?.addresses;
  const addressStr = addr ? `${addr.line1}, ${addr.city}, ${addr.state}` : "";

  const items: any[] = Array.isArray(order?.order_items) ? order.order_items : [];
  const itemsHtml = items.map((item: any) => {
    const unitName = item.units?.name || "Item";
    const qty = item.qty || 1;
    const price = item.unit_price_cents || 0;
    return `<tr><td style="padding:4px 0;color:#374151;font-size:14px;">${qty}x ${unitName}</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(price * qty)}</td></tr>`;
  }).join("");

  const { data: webhookCustomFees } = await supabaseClient
    .from("order_custom_fees")
    .select("name, amount_cents")
    .eq("order_id", orderId);

  const { data: webhookDiscounts } = await supabaseClient
    .from("order_discounts")
    .select("name, amount_cents, percentage")
    .eq("order_id", orderId);

  const customFees: Array<{ name: string; amount_cents: number }> = webhookCustomFees || [];
  const discounts: Array<{ name: string; amount_cents: number | null; percentage: number | null }> = webhookDiscounts || [];

  const subtotal = order?.subtotal_cents || 0;
  const travelFee = order?.travel_fee_waived ? 0 : (order?.travel_fee_cents || 0);
  const surfaceFee = order?.surface_fee_waived ? 0 : (order?.surface_fee_cents || 0);
  const sameDayFee = order?.same_day_pickup_fee_waived ? 0 : (order?.same_day_pickup_fee_cents || 0);
  const generatorFee = order?.generator_fee_waived ? 0 : (order?.generator_fee_cents || 0);
  const tax = order?.tax_waived ? 0 : (order?.tax_cents || 0);
  const customFeesTotal = customFees.reduce((s, f) => s + (f.amount_cents || 0), 0);
  const discountsTotal = discounts.reduce((s, d) => {
    if (d.percentage && d.percentage > 0) return s + Math.round(subtotal * (d.percentage / 100));
    return s + (d.amount_cents || 0);
  }, 0);
  const total = subtotal + travelFee + surfaceFee + sameDayFee + generatorFee + tax + customFeesTotal - discountsTotal;
  const depositPaid = order?.deposit_paid_cents || 0;
  const newBalanceDue = order?.balance_due_cents ?? 0;

  const feeRowsHtml = [
    travelFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Travel Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(travelFee)}</td></tr>` : "",
    surfaceFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Surface Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(surfaceFee)}</td></tr>` : "",
    sameDayFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Same-Day Pickup Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(sameDayFee)}</td></tr>` : "",
    generatorFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Generator Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(generatorFee)}</td></tr>` : "",
    tax > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tax)}</td></tr>` : "",
    ...customFees.map(f => f.amount_cents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">${f.name}</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(f.amount_cents)}</td></tr>` : ""),
    ...discounts.map(d => {
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
        ${tipCents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Crew Tip:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">${fmt(tipCents)}</td></tr>` : ""}
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
    console.warn("[WEBHOOK] send-email returned error (non-fatal):", emailResp.status, errText);
  }
}

export async function sendDepositReceiptEmail(
  supabaseClient: any,
  orderId: string,
  order: any,
  customer: any,
  biz: Record<string, string>,
  amountPaid: number,
  depositOnly: number,
  tipCents: number,
  cardBrand: string | null,
  cardLast4: string | null,
): Promise<void> {
  const shortId = orderId.substring(0, 8).toUpperCase();
  const fmt = formatCurrency;
  const businessName = biz.business_name || "Bounce Party Club";
  const businessPhone = biz.business_phone || DEFAULT_PHONE;
  const logoHtml = biz.logo_url
    ? `<img src="${biz.logo_url}" alt="${businessName}" style="height:60px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
    : "";
  const contactName = customer.first_name ? `${customer.first_name} ${customer.last_name || ""}`.trim() : "Customer";
  const cardText = cardBrand && cardLast4
    ? `${cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1)} \u2022\u2022\u2022\u2022 ${cardLast4}`
    : cardLast4 ? `Card \u2022\u2022\u2022\u2022 ${cardLast4}` : "Card on file";

  const eventDateStr = order?.event_date
    ? new Date(order.event_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";
  const addr = Array.isArray(order?.addresses) ? order.addresses[0] : order?.addresses;
  const addressStr = addr ? `${addr.line1}, ${addr.city}, ${addr.state}` : "";

  const items: any[] = Array.isArray(order?.order_items) ? order.order_items : [];
  const itemsHtml = items.map((item: any) => {
    const unitName = item.units?.name || "Item";
    const qty = item.qty || 1;
    const price = item.unit_price_cents || 0;
    return `<tr><td style="padding:4px 0;color:#374151;font-size:14px;">${qty}x ${unitName}</td><td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${fmt(price * qty)}</td></tr>`;
  }).join("");

  const { data: depositCustomFees } = await supabaseClient
    .from("order_custom_fees").select("name, amount_cents").eq("order_id", orderId);
  const { data: depositDiscounts } = await supabaseClient
    .from("order_discounts").select("name, amount_cents, percentage").eq("order_id", orderId);
  const customFees: Array<{ name: string; amount_cents: number }> = depositCustomFees || [];
  const discounts: Array<{ name: string; amount_cents: number | null; percentage: number | null }> = depositDiscounts || [];

  const subtotal = order?.subtotal_cents || 0;
  const travelFee = order?.travel_fee_waived ? 0 : (order?.travel_fee_cents || 0);
  const surfaceFee = order?.surface_fee_waived ? 0 : (order?.surface_fee_cents || 0);
  const sameDayFee = order?.same_day_pickup_fee_waived ? 0 : (order?.same_day_pickup_fee_cents || 0);
  const generatorFee = order?.generator_fee_waived ? 0 : (order?.generator_fee_cents || 0);
  const tax = order?.tax_waived ? 0 : (order?.tax_cents || 0);
  const customFeesTotal = customFees.reduce((s, f) => s + (f.amount_cents || 0), 0);
  const discountsTotal = discounts.reduce((s, d) => {
    if (d.percentage && d.percentage > 0) return s + Math.round(subtotal * (d.percentage / 100));
    return s + (d.amount_cents || 0);
  }, 0);
  const total = subtotal + travelFee + surfaceFee + sameDayFee + generatorFee + tax + customFeesTotal - discountsTotal;
  const balanceDueAfter = order?.balance_due_cents ?? 0;

  const feeRowsHtml = [
    travelFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Travel Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(travelFee)}</td></tr>` : "",
    surfaceFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Surface Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(surfaceFee)}</td></tr>` : "",
    sameDayFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Same-Day Pickup Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(sameDayFee)}</td></tr>` : "",
    generatorFee > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Generator Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(generatorFee)}</td></tr>` : "",
    tax > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tax)}</td></tr>` : "",
    ...customFees.map(f => f.amount_cents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">${f.name}</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(f.amount_cents)}</td></tr>` : ""),
    ...discounts.map(d => {
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
      <h1 style="margin:0;color:#059669;font-size:26px;font-weight:bold;">Deposit Received!</h1>
      <p style="margin:6px 0 0;color:#6b7280;font-size:14px;">Order #${shortId}</p>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 40px 8px;">
      <p style="margin:0 0 6px;color:#374151;font-size:15px;">Hi ${contactName},</p>
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">Your deposit has been received. Here's your receipt.</p>
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
        ${tipCents > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Crew Tip:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">${fmt(tipCents)}</td></tr>` : ""}
        <tr><td style="padding:4px 0;color:#059669;font-size:14px;font-weight:600;">Deposit Paid:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;font-weight:600;">${fmt(depositOnly)}</td></tr>
        <tr><td style="padding:4px 0;color:#374151;font-weight:600;">Remaining Balance:</td><td style="padding:4px 0;text-align:right;color:#374151;font-weight:600;">${fmt(balanceDueAfter)}</td></tr>
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

  const depositEmailResp = await fetch(
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
        subject: `Deposit Received - Order #${shortId}`,
        html: receiptHtml,
      }),
    }
  );
  if (!depositEmailResp.ok) {
    const errText = await depositEmailResp.text().catch(() => "");
    console.warn("[WEBHOOK] send-deposit-email returned error (non-fatal):", depositEmailResp.status, errText);
  }
}
