// Stage E4 — Pure additive unified total composer.
//
// Composes the Event Essentials subtotal BESIDE the existing inflatable
// price breakdown without mutating it or feeding EE lines into the inflatable
// calculatePrice engine. EE is added to the taxable equipment base exactly
// once. Deposit is derived from inflatables only (unchanged).

import type { PriceBreakdown } from './pricing';
import { calculateEventEssentialsSubtotalCents } from './eventEssentialsMoney';
import type { UnifiedCartItem } from '../types';

export interface UnifiedQuoteTotals {
  inflatableSubtotalCents: number;
  eventEssentialsSubtotalCents: number;
  equipmentSubtotalCents: number;
  travelFeeCents: number;
  surfaceFeeCents: number;
  sameDayPickupFeeCents: number;
  sameDayWeekdayDeliveryFeeCents: number;
  generatorFeeCents: number;
  taxableSubtotalCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  balanceDueCents: number;
}

export interface ComposeUnifiedQuoteTotalsInput {
  inflatableBreakdown: PriceBreakdown;
  cart: UnifiedCartItem[];
  applyTaxes: boolean;
}

export function composeUnifiedQuoteTotals(
  input: ComposeUnifiedQuoteTotalsInput,
): UnifiedQuoteTotals {
  const bd = input.inflatableBreakdown;
  const eventEssentialsSubtotalCents = calculateEventEssentialsSubtotalCents(input.cart);
  const equipmentSubtotalCents = bd.subtotal_cents + eventEssentialsSubtotalCents;

  const travelFeeCents = bd.travel_fee_cents;
  const surfaceFeeCents = bd.surface_fee_cents;
  const sameDayPickupFeeCents = bd.same_day_pickup_fee_cents;
  const sameDayWeekdayDeliveryFeeCents = bd.same_day_weekday_delivery_fee_cents;
  const generatorFeeCents = bd.generator_fee_cents;

  // Existing inflatable tax base: subtotal + travel + surface + generator.
  // EE equipment is added to the taxable equipment base once.
  const existingTaxableBase =
    bd.subtotal_cents + travelFeeCents + surfaceFeeCents + generatorFeeCents;
  const taxableSubtotalCents = existingTaxableBase + eventEssentialsSubtotalCents;

  const taxCents = input.applyTaxes
    ? Math.round(taxableSubtotalCents * 0.06)
    : 0;

  const totalCents =
    equipmentSubtotalCents +
    travelFeeCents +
    surfaceFeeCents +
    sameDayPickupFeeCents +
    sameDayWeekdayDeliveryFeeCents +
    generatorFeeCents +
    taxCents;

  // Deposit unchanged: inflatable-only breakdown deposit.
  const depositCents = bd.deposit_due_cents;
  const balanceDueCents = Math.max(0, totalCents - depositCents);

  return {
    inflatableSubtotalCents: bd.subtotal_cents,
    eventEssentialsSubtotalCents,
    equipmentSubtotalCents,
    travelFeeCents,
    surfaceFeeCents,
    sameDayPickupFeeCents,
    sameDayWeekdayDeliveryFeeCents,
    generatorFeeCents,
    taxableSubtotalCents,
    taxCents,
    totalCents,
    depositCents,
    balanceDueCents,
  };
}
