// WP-16 (B10): saved discount templates. The table stores `amount_cents` (a fixed discount, 0 when percentage based) and
// `percentage` (0 when amount based). The screen used to read `discount_type` / `discount_value`, which do not exist, so applying a
// saved template always produced a $0 discount.

export interface DiscountTemplateRow {
  id: string;
  name: string;
  amount_cents: number | null;
  percentage: number | null;
}

export interface AppliedDiscountValues {
  amount_cents: number;
  percentage: number;
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
};

export function templateToDiscount(t: Pick<DiscountTemplateRow, 'amount_cents' | 'percentage'>): AppliedDiscountValues {
  const amount = Math.round(num(t.amount_cents));
  const pct = num(t.percentage);
  // A template is one or the other. If a row somehow holds both, the fixed amount wins (as it is applied first when a discount is built).
  return amount > 0 ? { amount_cents: amount, percentage: 0 } : { amount_cents: 0, percentage: pct };
}

export function describeTemplateValue(t: Pick<DiscountTemplateRow, 'amount_cents' | 'percentage'>): string {
  const v = templateToDiscount(t);
  if (v.amount_cents > 0) return `$${(v.amount_cents / 100).toFixed(2)}`;
  if (v.percentage > 0) return `${v.percentage}%`;
  return '$0.00';
}
