// Stage E5 — Event Essentials-only Setup Fee calculation.
//
// Single source of truth for the EE-only Setup Fee across Quote, Checkout,
// Admin Invoice, and Admin Edit.
//
// Business rule:
// - If hasInflatables === true: setupFeeCents = 0
// - If eventEssentialsSubtotalCents <= 0: setupFeeCents = 0
// - Otherwise: setupFeeCents = max(0, THRESHOLD - eventEssentialsSubtotalCents)
//
// The threshold is the pre-discount EE equipment subtotal target.
// Discounts do NOT cause the Setup Fee to increase.
// The Setup Fee is NOT included in the EE-only deposit basis.

export const EVENT_ESSENTIALS_SETUP_MINIMUM_CENTS = 15000;

export function calculateEventEssentialsSetupFeeCents(input: {
  hasInflatables: boolean;
  eventEssentialsSubtotalCents: number;
}): number {
  if (input.hasInflatables) return 0;
  if (!Number.isFinite(input.eventEssentialsSubtotalCents) || input.eventEssentialsSubtotalCents <= 0) return 0;
  return Math.max(0, EVENT_ESSENTIALS_SETUP_MINIMUM_CENTS - Math.trunc(input.eventEssentialsSubtotalCents));
}
