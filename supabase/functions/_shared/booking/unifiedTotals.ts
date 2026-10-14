// GENERATED COPY of src/lib/pricing/unifiedTotals.ts. Do not edit here.
// Edit the source and run: node node_modules/jiti/bin/jiti.js src/lib/tooling/bookingSharedCopy.ts --write
// A test fails if this file differs from its source. Used by create-booking so the server prices exactly like the Quote.

// Stage E4 — Pure additive unified total composer.
//
// Composes the Event Essentials subtotal and the Setup Fee BESIDE the existing
// inflatable price breakdown without feeding EE lines into the inflatable
// calculatePrice engine.
//
// unifiedTaxCents   = 6% of (inflatable subtotal + travel + surface + generator + EE + Setup Fee), rounded once
// unifiedTotalCents = inflatableBreakdown.total_cents - inflatableBreakdown.tax_cents + eeSubtotal + Setup Fee + unifiedTaxCents
//
// Deposit is derived from inflatables only (unchanged).

import type { PriceBreakdown } from './pricing.ts';
import { calculateEventEssentialsSubtotalCents } from './eventEssentialsMoney.ts';
import { calculateRequiredDepositCents, type EEOnlyDepositSettings } from './depositCalculation.ts';
import { calculateEventEssentialsSetupFeeCents } from './setupFeeCalculation.ts';
import { calculateSalesTaxCents } from './orderMoney.ts';
import { isInflatableCartItem } from './unifiedCartGuards.ts';
import type { UnifiedCartItem } from './types.ts';

export interface UnifiedQuoteTotals {
  inflatableSubtotalCents: number;
  eventEssentialsSubtotalCents: number;
  equipmentSubtotalCents: number;
  travelFeeCents: number;
  surfaceFeeCents: number;
  sameDayPickupFeeCents: number;
  sameDayWeekdayDeliveryFeeCents: number;
  generatorFeeCents: number;
  setupFeeCents: number;
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
  setupMinimumCents?: number;
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

  const inflatableCount = input.cart.filter(isInflatableCartItem).reduce((sum, item) => sum + item.qty, 0);
  const hasInflatables = inflatableCount > 0;
  const setupFeeCents = calculateEventEssentialsSetupFeeCents({
    hasInflatables,
    eventEssentialsSubtotalCents,
    setupMinimumCents: input.setupMinimumCents,
  });

  // The taxable amount: equipment (inflatable + Event Essentials) + travel + surface + generator + Setup Fee. Same-day pickup and
  // weekday-delivery fees are not taxed. The tax is one 6% calculation, rounded once, on that whole amount (the same as the order
  // pricing engine), not the sum of two separately rounded pieces.
  const taxableSubtotalCents =
    bd.subtotal_cents + travelFeeCents + surfaceFeeCents + generatorFeeCents + eventEssentialsSubtotalCents + setupFeeCents;
  const taxCents = input.taxApplied ? calculateSalesTaxCents(taxableSubtotalCents) : 0;

  // The inflatable breakdown total without its own tax, plus Event Essentials, Setup Fee and the one tax.
  const totalCents = bd.total_cents - bd.tax_cents + eventEssentialsSubtotalCents + setupFeeCents + taxCents;

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
      setupFeeCents,
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
    setupFeeCents,
    taxableSubtotalCents,
    taxCents,
    totalCents,
    depositCents,
    balanceDueCents,
  };
}
