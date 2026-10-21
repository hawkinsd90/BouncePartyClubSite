// The fee lines that booking/confirmation emails used to leave out although the total included them: the generator fee, the same-day
// delivery fee and the Setup Fee (Event Essentials orders under the setup minimum). Each row only appears when the amount is above zero,
// so emails for orders without these fees are unchanged.

export interface ExtraFeeFields {
  generator_fee_cents?: number | null;
  same_day_weekday_delivery_fee_cents?: number | null;
  setup_fee_cents?: number | null;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function extraFeeRows(order: ExtraFeeFields): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if ((order.generator_fee_cents ?? 0) > 0) rows.push({ label: 'Generator Fee', value: dollars(order.generator_fee_cents as number) });
  if ((order.same_day_weekday_delivery_fee_cents ?? 0) > 0) {
    rows.push({ label: 'Same-Day Delivery Fee', value: dollars(order.same_day_weekday_delivery_fee_cents as number) });
  }
  if ((order.setup_fee_cents ?? 0) > 0) rows.push({ label: 'Setup Fee', value: dollars(order.setup_fee_cents as number) });
  return rows;
}
