// The order figures a payment receipt / confirmation email shows, derived from the STORED order with the same arithmetic the
// app uses everywhere else (orderMoney, a generated copy of src/lib/orderMoney.ts). Receipts used to re-derive the total
// themselves, each slightly differently (some missed the Setup Fee or the weekday delivery fee, some added fixed and percentage
// discounts the wrong way round, and a stored tax was hidden when the tax toggle was "on"). Stored fees are already effective:
// a waived fee is stored as 0 and the stored tax is the tax that applies.
import { composeOrderTotal, effectiveDiscountCents, type DiscountLike } from "../booking/orderMoney.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface ReceiptOrderFigures {
  subtotal: number;
  travelFee: number;
  surfaceFee: number;
  sameDayFee: number;
  weekdayDeliveryFee: number;
  generatorFee: number;
  setupFee: number;
  tax: number;
  customFeesTotal: number;
  discountsTotal: number;
  total: number;
}

export function receiptOrderFigures(
  order: Any,
  discounts: DiscountLike[] | null | undefined,
  customFees: Array<{ amount_cents?: unknown }> | null | undefined,
): ReceiptOrderFigures {
  const o = order ?? {};
  const b = composeOrderTotal(o, discounts ?? [], customFees ?? [], o.tax_cents || 0);
  return {
    subtotal: o.subtotal_cents || 0,
    travelFee: o.travel_fee_cents || 0,
    surfaceFee: o.surface_fee_cents || 0,
    sameDayFee: o.same_day_pickup_fee_cents || 0,
    weekdayDeliveryFee: o.same_day_weekday_delivery_fee_cents || 0,
    generatorFee: o.generator_fee_cents || 0,
    setupFee: o.setup_fee_cents || 0,
    tax: b.taxCents,
    customFeesTotal: b.customFeesCents,
    discountsTotal: b.discountCents,
    total: b.totalCents,
  };
}

// One discount line's amount (fixed amount when > 0, else the percentage of the equipment subtotal).
export function receiptDiscountAmount(d: DiscountLike, subtotal: number): number {
  return effectiveDiscountCents(d, subtotal);
}

// The two fee rows the receipts used to leave out although the total included them.
export function receiptExtraFeeRowsHtml(f: ReceiptOrderFigures, fmt: (cents: number) => string): string {
  const row = (label: string, cents: number) =>
    cents > 0
      ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">${label}</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:14px;">${fmt(cents)}</td></tr>`
      : "";
  return row("Same-Day Delivery Fee", f.weekdayDeliveryFee) + row("Setup Fee", f.setupFee);
}
