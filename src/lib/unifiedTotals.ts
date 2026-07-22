// Stage E4 — Pure additive unified total composer.
//
// Composes the Event Essentials subtotal BESIDE the existing inflatable
// price breakdown without mutating it or feeding EE lines into the inflatable
// calculatePrice engine. The inflatable breakdown's tax_cents and total_cents
// are preserved exactly; only the EE effect is added.
//
// unifiedTotalCents = inflatableBreakdown.total_cents + eeSubtotal + eeTaxCents
// unifiedTaxCents   = inflatableBreakdown.tax_cents + eeTaxCents
//
// Deposit is derived from inflatables only (unchanged).

import type { PriceBreakdown } from './pricing';
import { calculateEventEssentialsSubtotalCents } from './eventEssentialsMoney';
import { calculateRequiredDepositCents, type EEOnlyDepositSettings } from './depositCalculation';
import { isInflatableCartItem } from './unifiedCart';
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
  depositError?: string;
}

export interface ComposeUnifiedQuoteTotalsInput {
  inflatableBreakdown: PriceBreakdown;
  cart: UnifiedCartItem[];
  taxApplied: boolean;
  eeOnlyDepositSettings: EEOnlyDepositSettings;
  inflatableDepositPerUnitCents: number;
}

const TAX_RATE = 0.06;

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

  // EE tax: same convention as inflatable engine — EE equipment is taxable.
  // Same-day pickup fee is NOT taxable (matches inflatable engine behavior).
  const eeTaxCents = input.taxApplied
    ? Math.round(eventEssentialsSubtotalCents * TAX_RATE)
    : 0;

  const taxCents = bd.tax_cents + eeTaxCents;

  // Preserve the inflatable breakdown total exactly, then add EE subtotal + EE tax.
  const totalCents = bd.total_cents + eventEssentialsSubtotalCents + eeTaxCents;

  // For reporting: the taxable base that includes EE.
  const existingTaxableBase =
    bd.subtotal_cents + travelFeeCents + surfaceFeeCents + generatorFeeCents;
  const taxableSubtotalCents = existingTaxableBase + eventEssentialsSubtotalCents;

  const inflatableCount = input.cart.filter(isInflatableCartItem).reduce((sum, item) => sum + item.qty, 0);
  const depositResult = calculateRequiredDepositCents({
    inflatableQuantity: inflatableCount,
    eventEssentialsSubtotalCents,
    orderTotalCents: totalCents,
    inflatableDepositPerUnitCents: input.inflatableDepositPerUnitCents,
    eeOnlyDepositSettings: input.eeOnlyDepositSettings,
  });
  if (depositResult.status !== 'calculated') {
    // Fail closed — return zero deposit so callers can detect the failure
    // via the depositError field and block before persisting.
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
      depositCents: 0,
      balanceDueCents: totalCents,
      depositError: depositResult.error,
    };
  }
  const depositCents = depositResult.depositCents;
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
