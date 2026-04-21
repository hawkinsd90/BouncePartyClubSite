import { formatCurrency, LOGO_URL } from "./fmt.ts";

const BORDER = "#10b981";
const ACCENT = "#15803d";
const BG = "#f0fdf4";

export interface OrderRow {
  event_date?: string | null;
  start_window?: string | null;
  end_window?: string | null;
  addresses?: { line1: string; city: string; state: string; zip?: string } | null;
  location_type?: string | null;
  surface?: string | null;
  order_items?: Array<{ qty: number; wet_or_dry: string; unit_price_cents: number; units?: { name: string } | null }>;
  order_custom_fees?: Array<{ name?: string | null; amount_cents: number }>;
  order_discounts?: Array<{ name?: string | null; amount_cents: number; percentage?: number | null }>;
  subtotal_cents?: number | null;
  travel_fee_cents?: number | null;
  surface_fee_cents?: number | null;
  generator_fee_cents?: number | null;
  same_day_pickup_fee_cents?: number | null;
  tax_cents?: number | null;
  deposit_paid_cents?: number | null;
  balance_paid_cents?: number | null;
}

export interface PaymentReceiptEmailOpts {
  firstName: string;
  orderId: string;
  orderNum: string;
  amountCents: number;
  tipCents: number;
  totalCents: number;
  paymentType: "deposit" | "balance";
  newBalanceDue: number;
  order: OrderRow;
  businessPhone: string;
  paymentBanner: string;
  paymentMethodLabel: string;
  logoUrl?: string;
}

export function buildPaymentReceiptEmail(opts: PaymentReceiptEmailOpts): string {
  const {
    firstName, orderNum, amountCents, tipCents, totalCents,
    paymentType, newBalanceDue, order, businessPhone, paymentBanner, paymentMethodLabel,
    logoUrl,
  } = opts;
  const fmt = formatCurrency;
  const resolvedLogoUrl = logoUrl || LOGO_URL;

  const eventDateStr = order.event_date
    ? new Date(order.event_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";
  const timeStr = order.start_window && order.end_window
    ? `${order.start_window} - ${order.end_window}`
    : "";
  const addressStr = order.addresses
    ? `${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state}`
    : "";

  const eventDetailRows = [
    { label: "Order #", value: orderNum },
    ...(eventDateStr ? [{ label: "Date", value: eventDateStr }] : []),
    ...(timeStr ? [{ label: "Time", value: timeStr }] : []),
    ...(addressStr ? [{ label: "Location", value: addressStr }] : []),
    ...(order.location_type ? [{ label: "Location Type", value: order.location_type }] : []),
    ...(order.surface ? [{ label: "Surface", value: order.surface }] : []),
  ].map(r => `
      <tr>
        <td style="color:#64748b;font-size:14px;">${r.label}:</td>
        <td style="color:#1e293b;font-size:14px;font-weight:600;text-align:right;">${r.value}</td>
      </tr>`).join("");

  const eventInfoBox = `
    <div style="background-color:${BG};border:2px solid ${BORDER};border-radius:6px;padding:20px;margin:25px 0;">
      <h3 style="margin:0 0 15px;color:${ACCENT};font-size:16px;font-weight:600;">Event Details</h3>
      <table width="100%" cellpadding="6" cellspacing="0">${eventDetailRows}</table>
    </div>`;

  const items = order.order_items || [];
  const itemRowsHtml = items.map(item => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#1e293b;">
        ${item.qty}x ${item.units?.name} <span style="color:#64748b;font-size:13px;">(${item.wet_or_dry === "water" ? "Wet" : "Dry"})</span>
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#1e293b;">${fmt(item.unit_price_cents * item.qty)}</td>
    </tr>`).join("");

  const itemsSection = items.length > 0 ? `
    <div style="margin:25px 0;">
      <h3 style="margin:0 0 15px;color:#1e293b;font-size:16px;font-weight:600;">Order Items</h3>
      <table width="100%" cellpadding="0" cellspacing="0">${itemRowsHtml}</table>
    </div>` : "";

  const customFees = order.order_custom_fees || [];
  const discounts = order.order_discounts || [];

  type PricingRow = { label: string; value: string; bold?: boolean; highlight?: boolean };
  const pricingRows: PricingRow[] = [
    { label: "Subtotal", value: fmt(order.subtotal_cents || 0) },
  ];
  if ((order.travel_fee_cents || 0) > 0) pricingRows.push({ label: "Travel Fee", value: fmt(order.travel_fee_cents!) });
  if ((order.surface_fee_cents || 0) > 0) pricingRows.push({ label: "Surface Fee", value: fmt(order.surface_fee_cents!) });
  if ((order.generator_fee_cents || 0) > 0) pricingRows.push({ label: "Generator Fee", value: fmt(order.generator_fee_cents!) });
  if ((order.same_day_pickup_fee_cents || 0) > 0) pricingRows.push({ label: "Same Day Pickup", value: fmt(order.same_day_pickup_fee_cents!) });
  customFees.forEach(f => pricingRows.push({ label: f.name || "Additional Fee", value: fmt(f.amount_cents) }));
  discounts.forEach(d => {
    const discountAmt = (d.percentage && d.percentage > 0)
      ? Math.round((order.subtotal_cents || 0) * (d.percentage / 100))
      : (d.amount_cents || 0);
    pricingRows.push({ label: d.name || "Discount", value: `-${fmt(discountAmt)}` });
  });
  if ((order.tax_cents || 0) > 0) pricingRows.push({ label: "Tax", value: fmt(order.tax_cents!) });
  const orderTotal = (order.subtotal_cents || 0) + (order.travel_fee_cents || 0) + (order.surface_fee_cents || 0) +
    (order.generator_fee_cents || 0) + (order.same_day_pickup_fee_cents || 0) + (order.tax_cents || 0) +
    customFees.reduce((s, f) => s + f.amount_cents, 0) -
    discounts.reduce((s, d) => {
      if (d.percentage && d.percentage > 0) return s + Math.round((order.subtotal_cents || 0) * (d.percentage / 100));
      return s + (d.amount_cents || 0);
    }, 0);
  pricingRows.push({ label: "Total", value: fmt(orderTotal), bold: true });
  if ((order.deposit_paid_cents || 0) > 0) pricingRows.push({ label: "Deposit Paid", value: fmt(order.deposit_paid_cents!), highlight: true });
  if ((order.balance_paid_cents || 0) > 0) pricingRows.push({ label: "Balance Paid", value: fmt(order.balance_paid_cents!), highlight: true });

  const pricingRowsHtml = pricingRows.map(r => `
    <tr${r.bold ? ' style="border-top:2px solid #e2e8f0;"' : ''}>
      <td style="color:${r.bold ? "#1e293b" : "#64748b"};font-size:${r.bold ? "15px" : "14px"};font-weight:${r.bold ? "600" : "normal"};${r.bold ? "padding-top:10px;" : ""}">${r.label}:</td>
      <td style="color:${r.highlight ? "#10b981" : "#1e293b"};font-size:${r.bold ? "15px" : "14px"};font-weight:${r.bold ? "700" : "normal"};text-align:right;${r.bold ? "padding-top:10px;" : ""}">${r.value}</td>
    </tr>`).join("");

  const pricingSection = `
    <div style="background-color:#f8fafc;border-radius:6px;padding:20px;margin:25px 0;">
      <h3 style="margin:0 0 15px;color:#1e293b;font-size:16px;font-weight:600;">Payment Summary</h3>
      <table width="100%" cellpadding="6" cellspacing="0">${pricingRowsHtml}</table>
    </div>`;

  const tipRow = tipCents > 0 ? `
      <tr>
        <td style="color:#64748b;font-size:14px;">Crew Tip:</td>
        <td style="color:#16a34a;font-size:14px;font-weight:600;text-align:right;">+${fmt(tipCents)}</td>
      </tr>` : "";

  const balanceRow = newBalanceDue > 0
    ? `<tr style="border-top:2px solid #e2e8f0;"><td style="color:#1e293b;font-size:15px;font-weight:600;padding-top:10px;">Remaining Balance Due:</td><td style="color:#dc2626;font-size:15px;font-weight:700;text-align:right;padding-top:10px;">${fmt(newBalanceDue)}</td></tr>`
    : `<tr style="border-top:2px solid #e2e8f0;"><td style="color:#1e293b;font-size:15px;font-weight:600;padding-top:10px;">Remaining Balance Due:</td><td style="color:#16a34a;font-size:15px;font-weight:700;text-align:right;padding-top:10px;">PAID IN FULL</td></tr>`;

  const paymentReceiptBox = `
    <div style="background-color:${BG};border:2px solid ${BORDER};border-radius:6px;padding:20px;margin:25px 0;">
      <h3 style="margin:0 0 15px;color:${ACCENT};font-size:16px;font-weight:600;">Payment Receipt</h3>
      <table width="100%" cellpadding="6" cellspacing="0">
        <tr>
          <td style="color:#64748b;font-size:14px;">${paymentMethodLabel}:</td>
          <td style="color:#1e293b;font-size:14px;font-weight:600;text-align:right;">${fmt(amountCents)}</td>
        </tr>
        ${tipRow}
        <tr style="border-top:2px solid #d1fae5;">
          <td style="color:${ACCENT};font-size:15px;font-weight:700;padding-top:10px;">Total Received:</td>
          <td style="color:${ACCENT};font-size:18px;font-weight:800;text-align:right;padding-top:10px;">${fmt(totalCents)}</td>
        </tr>
        ${balanceRow}
      </table>
    </div>`;

  const content = `
    <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi ${firstName},</p>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">We've received your payment. Here is your receipt and order summary.</p>
    ${paymentBanner}
    ${eventInfoBox}
    ${itemsSection}
    ${pricingSection}
    ${paymentReceiptBox}
    <p style="margin:25px 0 0;color:#475569;font-size:14px;line-height:1.6;">Questions? Call us at <strong style="color:#1e293b;">${businessPhone}</strong></p>
  `;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Payment Received</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);border:2px solid ${BORDER};">
        <tr>
          <td style="background-color:#ffffff;padding:30px;text-align:center;border-bottom:2px solid ${BORDER};">
            <img src="${resolvedLogoUrl}" alt="Bounce Party Club" style="height:80px;width:auto;" />
            <h1 style="margin:15px 0 0;color:${BORDER};font-size:24px;font-weight:bold;">Payment Received!</h1>
          </td>
        </tr>
        <tr><td style="padding:30px;">${content}</td></tr>
        <tr>
          <td style="background-color:#f8fafc;padding:25px;text-align:center;border-top:2px solid ${BORDER};">
            <p style="margin:0 0 5px;color:#64748b;font-size:13px;">Bounce Party Club | ${businessPhone}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
