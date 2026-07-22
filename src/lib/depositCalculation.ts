// Stage E4 — Authoritative deposit calculation helper.
//
// Single source of truth for required deposit cents across Quote, Checkout,
// orderCreation, Admin settings preview, and approval flow.
//
// Rules:
// - If inflatableQuantity > 0: use existing inflatable deposit calculation
//   (depositPerUnitCents × inflatableQuantity).
// - If inflatableQuantity === 0 and eventEssentialsSubtotalCents > 0: use
//   configurable EE-only tier deposit.
// - Otherwise: 0.
//
// Result is always capped at orderTotalCents.
// Malformed settings fail closed (return 0).

export interface EEOnlyDepositSettings {
  eeOnlyDepositBaseThresholdCents: number;
  eeOnlyDepositBaseCents: number;
  eeOnlyDepositSubtotalStepCents: number;
  eeOnlyDepositStepCents: number;
}

export const DEFAULT_EE_ONLY_DEPOSIT_SETTINGS: EEOnlyDepositSettings = {
  eeOnlyDepositBaseThresholdCents: 20000,
  eeOnlyDepositBaseCents: 5000,
  eeOnlyDepositSubtotalStepCents: 10000,
  eeOnlyDepositStepCents: 5000,
};

function isSafeCents(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function validateSettings(settings: Partial<EEOnlyDepositSettings> | null | undefined): EEOnlyDepositSettings | null {
  if (!settings) return null;
  const s = { ...DEFAULT_EE_ONLY_DEPOSIT_SETTINGS, ...settings };
  if (
    !isSafeCents(s.eeOnlyDepositBaseThresholdCents) ||
    !isSafeCents(s.eeOnlyDepositBaseCents) ||
    !isSafeCents(s.eeOnlyDepositSubtotalStepCents) ||
    !isSafeCents(s.eeOnlyDepositStepCents)
  ) {
    return null;
  }
  if (
    s.eeOnlyDepositBaseThresholdCents <= 0 ||
    s.eeOnlyDepositBaseCents <= 0 ||
    s.eeOnlyDepositSubtotalStepCents <= 0 ||
    s.eeOnlyDepositStepCents <= 0
  ) {
    return null;
  }
  return s;
}

export function calculateRequiredDepositCents(input: {
  inflatableQuantity: number;
  eventEssentialsSubtotalCents: number;
  orderTotalCents: number;
  inflatableDepositPerUnitCents: number;
  eeOnlyDepositSettings?: Partial<EEOnlyDepositSettings> | null;
}): number {
  const { inflatableQuantity, eventEssentialsSubtotalCents, orderTotalCents, inflatableDepositPerUnitCents } = input;

  // Validate inflatable quantity
  const infQty = Number.isFinite(inflatableQuantity) && inflatableQuantity > 0
    ? Math.trunc(inflatableQuantity)
    : 0;

  // Validate EE subtotal
  const eeSubtotal = Number.isFinite(eventEssentialsSubtotalCents) && eventEssentialsSubtotalCents > 0
    ? Math.trunc(eventEssentialsSubtotalCents)
    : 0;

  // Validate order total
  const total = Number.isFinite(orderTotalCents) && orderTotalCents > 0
    ? Math.trunc(orderTotalCents)
    : 0;

  let deposit = 0;

  if (infQty > 0) {
    // Inflatable-based deposit: existing per-unit × quantity
    const perUnit = Number.isFinite(inflatableDepositPerUnitCents) && inflatableDepositPerUnitCents > 0
      ? Math.trunc(inflatableDepositPerUnitCents)
      : 0;
    deposit = perUnit * infQty;
  } else if (eeSubtotal > 0) {
    // EE-only tier deposit — use defaults if no settings provided
    const settings = validateSettings(input.eeOnlyDepositSettings ?? DEFAULT_EE_ONLY_DEPOSIT_SETTINGS);
    if (!settings) return 0; // fail closed

    if (eeSubtotal <= settings.eeOnlyDepositBaseThresholdCents) {
      deposit = settings.eeOnlyDepositBaseCents;
    } else {
      const additionalTiers = Math.ceil(
        (eeSubtotal - settings.eeOnlyDepositBaseThresholdCents) /
        settings.eeOnlyDepositSubtotalStepCents
      );
      deposit = settings.eeOnlyDepositBaseCents + additionalTiers * settings.eeOnlyDepositStepCents;
    }
  }

  // Cap at order total
  deposit = Math.min(deposit, total);

  return Math.max(0, Math.trunc(deposit));
}

export function calculateEEOnlyDepositCents(
  eventEssentialsSubtotalCents: number,
  orderTotalCents: number,
  settings?: Partial<EEOnlyDepositSettings> | null,
): number {
  return calculateRequiredDepositCents({
    inflatableQuantity: 0,
    eventEssentialsSubtotalCents,
    orderTotalCents,
    inflatableDepositPerUnitCents: 0,
    eeOnlyDepositSettings: settings ?? DEFAULT_EE_ONLY_DEPOSIT_SETTINGS,
  });
}
