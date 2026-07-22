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
// Malformed settings fail closed (return invalid_configuration, not 0).

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

export type RequiredDepositResult =
  | { status: 'calculated'; depositCents: number }
  | { status: 'invalid_configuration'; error: string }
  | { status: 'invalid_input'; error: string };

function isSafeCents(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function validateEEOnlyDepositSettings(
  settings: Partial<EEOnlyDepositSettings> | null | undefined,
): EEOnlyDepositSettings | null {
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
}): RequiredDepositResult {
  const { inflatableQuantity, eventEssentialsSubtotalCents, orderTotalCents, inflatableDepositPerUnitCents } = input;

  // Validate inflatable quantity
  if (!Number.isFinite(inflatableQuantity) || inflatableQuantity < 0) {
    return { status: 'invalid_input', error: 'Invalid inflatable quantity' };
  }
  const infQty = Math.trunc(inflatableQuantity) || 0;

  // Validate EE subtotal
  if (!Number.isFinite(eventEssentialsSubtotalCents) || eventEssentialsSubtotalCents < 0) {
    return { status: 'invalid_input', error: 'Invalid Event Essentials subtotal' };
  }
  const eeSubtotal = Math.trunc(eventEssentialsSubtotalCents) || 0;

  // Validate order total
  if (!Number.isFinite(orderTotalCents) || orderTotalCents < 0) {
    return { status: 'invalid_input', error: 'Invalid order total' };
  }
  const total = Math.trunc(orderTotalCents) || 0;

  let deposit = 0;

  if (infQty > 0) {
    // Inflatable-based deposit: existing per-unit × quantity
    if (!Number.isFinite(inflatableDepositPerUnitCents) || inflatableDepositPerUnitCents < 0) {
      return { status: 'invalid_configuration', error: 'Invalid inflatable deposit per-unit setting' };
    }
    const perUnit = Math.trunc(inflatableDepositPerUnitCents) || 0;
    deposit = perUnit * infQty;
  } else if (eeSubtotal > 0) {
    // EE-only tier deposit — must have valid settings
    const settings = validateEEOnlyDepositSettings(input.eeOnlyDepositSettings ?? DEFAULT_EE_ONLY_DEPOSIT_SETTINGS);
    if (!settings) {
      return { status: 'invalid_configuration', error: 'Invalid Event Essentials-only deposit configuration' };
    }

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

  return { status: 'calculated', depositCents: Math.max(0, Math.trunc(deposit)) };
}

export function calculateEEOnlyDepositCents(
  eventEssentialsSubtotalCents: number,
  orderTotalCents: number,
  settings?: Partial<EEOnlyDepositSettings> | null,
): number {
  const result = calculateRequiredDepositCents({
    inflatableQuantity: 0,
    eventEssentialsSubtotalCents,
    orderTotalCents,
    inflatableDepositPerUnitCents: 0,
    eeOnlyDepositSettings: settings ?? DEFAULT_EE_ONLY_DEPOSIT_SETTINGS,
  });
  return result.status === 'calculated' ? result.depositCents : 0;
}
