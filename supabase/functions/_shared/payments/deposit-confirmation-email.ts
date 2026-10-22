// The "Booking Confirmed" email a customer receives after a deposit payment was applied (moved verbatim from charge-deposit so the
// post-payment completion, which may run from the charge request or from the webhook, sends the same message). It never throws: a
// failure to send is logged (send-email records the delivery failure itself) and reported to the caller as `false`.
import { formatCurrency } from "../fmt.ts";
import { buildPortalUrl } from "../portal-link.ts";
import { orderItemLabel, ORDER_ITEM_COLUMNS, type LabelledOrderItem } from "./order-item-label.ts";
import { getSiteOrigin } from "../siteOrigin.ts";
import { receiptOrderFigures, receiptExtraFeeRowsHtml } from "./receipt-order-totals.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export async function sendDepositConfirmationEmail(
  supabaseClient: Any,
  p: { orderId: string; principalCents: number; grossCents: number; paymentMethod: string | null; paymentBrand: string | null; paymentLast4: string | null },
): Promise<boolean> {
  const { orderId, grossCents: chargeAmountCents, paymentMethod, paymentBrand, paymentLast4 } = p;
  const paymentAmountCents = p.principalCents;
  // true = sent, or there was nobody to send it to; false = an attempt failed (the caller may retry the whole completion).
  let delivered = true;

  let discountRows: Array<{ amount_cents: number; percentage: number }> = [];
  try {
    const { data: orderDiscounts } = await supabaseClient
      .from("order_discounts")
      .select("amount_cents, percentage")
      .eq("order_id", orderId);
    discountRows = orderDiscounts || [];
  } catch (discountQueryErr) {
    console.error("[charge-deposit] Discounts query failed (non-fatal):", discountQueryErr);
  }

  try {
        const { data: fullOrder } = await supabaseClient
          .from("orders")
          .select(`
            *,
            customers(first_name, last_name, email),
            order_items(${ORDER_ITEM_COLUMNS}),
            addresses(line1, city, state, zip),
            order_custom_fees(id, name, amount_cents)
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

          const fmt = formatCurrency;
          const firstName = fullOrder.customers.first_name || "";
          const addr = fullOrder.addresses;
          const addressStr = addr
            ? `${addr.line1}, ${addr.city}, ${addr.state}`
            : (fullOrder.event_address_line1 || "");

          const eventDate = fullOrder.event_date
            ? new Date(fullOrder.event_date + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })
            : "";

          const timeWindow = `${fullOrder.start_window || ""} - ${fullOrder.end_window || ""}`;
          const shortId = orderId.replace(/-/g, "").toUpperCase().slice(0, 8);
          const siteOrigin = getSiteOrigin();
          const portalUrl = (await buildPortalUrl(supabaseClient, orderId, siteOrigin)) ?? siteOrigin;

          const itemsHtml = (fullOrder.order_items || [])
            .map(
              (item: LabelledOrderItem & { qty: number; unit_price_cents: number }) => `
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#374151;">
              ${orderItemLabel(item)}
            </td>
            <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">
              ${fmt(item.unit_price_cents * item.qty)}
            </td>
          </tr>`
            )
            .join("");

          const emailCustomFees: Array<{ id: string; name: string; amount_cents: number }> = fullOrder.order_custom_fees || [];
          const figures = receiptOrderFigures(fullOrder, discountRows, emailCustomFees);
          const { subtotal, travelFee, surfaceFee, sameDayFee, generatorFee, tax, total } = figures;
          const discount = figures.discountsTotal;
          const tip = fullOrder.tip_cents || 0;


          const depositPaid = paymentAmountCents;
          const balanceRemaining = Math.max(0, typeof fullOrder.balance_due_cents === "number" ? fullOrder.balance_due_cents : total - depositPaid);

          const customFeeRowsHtml = emailCustomFees
            .map((f: { name: string; amount_cents: number }) =>
              f.amount_cents > 0
                ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">${
                    f.name || "Custom Fee"
                  }</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(
                    f.amount_cents
                  )}</td></tr>`
                : ""
            )
            .join("");

          const feeRowsHtml = [
            travelFee > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Travel Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(travelFee)}</td></tr>`
              : "",
            surfaceFee > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Surface Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(surfaceFee)}</td></tr>`
              : "",
            sameDayFee > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Same Day Pickup</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(sameDayFee)}</td></tr>`
              : "",
            generatorFee > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Generator Fee</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(generatorFee)}</td></tr>`
              : "",
            receiptExtraFeeRowsHtml(figures, fmt),
            customFeeRowsHtml,
            discount > 0
              ? `<tr><td style="padding:4px 0;color:#059669;font-size:14px;">Discount</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">-${fmt(discount)}</td></tr>`
              : "",
            tax > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tax</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tax)}</td></tr>`
              : "",
            tip > 0
              ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tip</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(tip)}</td></tr>`
              : "",
          ].join("");

          const paymentMethodStr =
            paymentBrand && paymentLast4
              ? `${paymentBrand} •••• ${paymentLast4}`
              : paymentMethod || "Card";

          const paymentDate = new Date().toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });

          const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #d1fae5;">
  <tr>
    <td align="center" style="padding:24px 40px 16px;border-bottom:2px solid #d1fae5;">
      ${
        biz.logo_url
          ? `<img src="${biz.logo_url}" alt="${biz.business_name || "Bounce Party Club"}" style="height:60px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
          : ""
      }
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
            ${
              fullOrder.location_type
                ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Location Type:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${fullOrder.location_type}</td></tr>`
                : ""
            }
            ${
              fullOrder.surface
                ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Surface:</td><td style="padding:3px 0;color:#111827;font-size:14px;text-align:right;">${fullOrder.surface}</td></tr>`
                : ""
            }
            ${
              fullOrder.special_details
                ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:14px;">Special Details:</td><td style="padding:3px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${fullOrder.special_details}</td></tr>`
                : ""
            }
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
        ${
          tip > 0
            ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Tip:</td><td style="padding:4px 0;text-align:right;color:#059669;font-size:14px;">${fmt(tip)}</td></tr>`
            : ""
        }
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

          const { error: sendError } = await supabaseClient.functions.invoke("send-email", {
            body: {
              to: fullOrder.customers.email,
              subject: `Booking Confirmed - Receipt for Order #${shortId}`,
              html: emailHtml,
            },
          });
          if (sendError) throw sendError;
        }
  } catch (emailError) {
    delivered = false;
    console.error("Failed to send booking confirmation email:", emailError);
  }
  return delivered;
}
