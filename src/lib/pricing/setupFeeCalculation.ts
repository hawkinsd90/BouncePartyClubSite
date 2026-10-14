// Stage E5 — Event Essentials-only Setup Fee calculation.
//
// Single source of truth for the EE-only Setup Fee across Quote, Checkout,
// Admin Invoice, and Admin Edit.
//
// Business rule:
// - If hasInflatables === true: setupFeeCents = 0
// - If eventEssentialsSubtotalCents <= 0: setupFeeCents = 0
// - Otherwise: setupFeeCents = max(0, setupMinimumCents - eventEssentialsSubtotalCents)
//
// The threshold is the pre-discount EE equipment subtotal target, configurable
// via pricing_rules.event_essentials_setup_minimum_cents.
// Discounts do NOT cause the Setup Fee to increase.
// The Setup Fee is NOT included in the EE-only deposit basis.

export const EVENT_ESSENTIALS_SETUP_MINIMUM_CENTS = 15000;

export function calculateEventEssentialsSetupFeeCents(input: {
  hasInflatables: boolean;
  eventEssentialsSubtotalCents: number;
  setupMinimumCents?: number;
}): number {
  if (input.hasInflatables) return 0;
  if (!Number.isFinite(input.eventEssentialsSubtotalCents) || input.eventEssentialsSubtotalCents <= 0) return 0;
  const minimum = Number.isFinite(input.setupMinimumCents) && input.setupMinimumCents! >= 0
    ? Math.trunc(input.setupMinimumCents!)
    : EVENT_ESSENTIALS_SETUP_MINIMUM_CENTS;
  return Math.max(0, minimum - Math.trunc(input.eventEssentialsSubtotalCents));
}
