// What an order SHOWS for each fee, from what is stored with it.
//
// A fee that was waived is stored as 0 (it is not charged). The amount it was waived at is shown only if it was stored with the
// order (orders.waived_fee_amounts_cents). It is NEVER rebuilt from today's pricing rules: an old order must not show a waived
// Travel Fee of $80 because today's rule says $80. A waived fee whose amount was not stored is reported as unknown, and displays say
// "Waived" without a dollar figure. Pure: no network, no pricing rules.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ShownFee = 'travel' | 'surface' | 'same_day_pickup' | 'same_day_weekday_delivery' | 'generator';

export interface StoredFeeAmounts {
  travel_fee_cents: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  same_day_weekday_delivery_fee_cents: number;
  generator_fee_cents: number;
  tax_cents: number;
  waived_amount_unknown: ShownFee[];
}

export function storedFeeAmounts(order: any): StoredFeeAmounts {
  const stored = (order?.waived_fee_amounts_cents ?? null) as Record<string, number> | null;
  const unknown: ShownFee[] = [];
  const shown = (key: ShownFee, cents: number | null | undefined, waived: boolean | null | undefined): number => {
    const charged = cents || 0;
    if (!waived || charged > 0) return charged;
    const kept = stored?.[key];
    if (typeof kept === 'number' && Number.isSafeInteger(kept) && kept >= 0) return kept;
    unknown.push(key);
    return 0;
  };
  return {
    travel_fee_cents: shown('travel', order?.travel_fee_cents, order?.travel_fee_waived),
    surface_fee_cents: shown('surface', order?.surface_fee_cents, order?.surface_fee_waived),
    same_day_pickup_fee_cents: shown('same_day_pickup', order?.same_day_pickup_fee_cents, order?.same_day_pickup_fee_waived),
    same_day_weekday_delivery_fee_cents: shown('same_day_weekday_delivery', order?.same_day_weekday_delivery_fee_cents, order?.same_day_weekday_delivery_fee_waived),
    generator_fee_cents: shown('generator', order?.generator_fee_cents, order?.generator_fee_waived),
    // Tax is shown as stored; a waived tax is stored as 0 and displays as "Waived".
    tax_cents: order?.tax_cents || 0,
    waived_amount_unknown: unknown,
  };
}
