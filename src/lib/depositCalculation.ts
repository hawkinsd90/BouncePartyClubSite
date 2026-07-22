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

  // Validate inflatable quantity — must be a safe integer, not fractional
  if (typeof inflatableQuantity !== 'number' || !Number.isFinite(inflatableQuantity) || inflatableQuantity < 0 || !Number.isSafeInteger(inflatableQuantity)) {
    return { status: 'invalid_input', error: 'Invalid inflatable quantity' };
  }
  const infQty = inflatableQuantity;

  // Validate EE subtotal — must be a safe integer, not fractional
  if (typeof eventEssentialsSubtotalCents !== 'number' || !Number.isFinite(eventEssentialsSubtotalCents) || eventEssentialsSubtotalCents < 0 || !Number.isSafeInteger(eventEssentialsSubtotalCents)) {
    return { status: 'invalid_input', error: 'Invalid Event Essentials subtotal' };
  }
  const eeSubtotal = eventEssentialsSubtotalCents;

  // Validate order total — must be a safe integer, not fractional
  if (typeof orderTotalCents !== 'number' || !Number.isFinite(orderTotalCents) || orderTotalCents < 0 || !Number.isSafeInteger(orderTotalCents)) {
    return { status: 'invalid_input', error: 'Invalid order total' };
  }
  const total = orderTotalCents;

  let deposit = 0;

  if (infQty > 0) {
    // Inflatable-based deposit: existing per-unit × quantity
    if (typeof inflatableDepositPerUnitCents !== 'number' || !Number.isFinite(inflatableDepositPerUnitCents) || inflatableDepositPerUnitCents <= 0 || !Number.isSafeInteger(inflatableDepositPerUnitCents)) {
      return { status: 'invalid_configuration', error: 'Invalid inflatable deposit per-unit setting' };
    }
    const perUnit = inflatableDepositPerUnitCents;
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
): RequiredDepositResult {
  return calculateRequiredDepositCents({
    inflatableQuantity: 0,
    eventEssentialsSubtotalCents,
    orderTotalCents,
    inflatableDepositPerUnitCents: 0,
    eeOnlyDepositSettings: settings ?? DEFAULT_EE_ONLY_DEPOSIT_SETTINGS,
  });
}

// ---------------------------------------------------------------------------
// Stage E4 — Authoritative pricing-settings adapter
//
// Single source of truth for parsing and validating a pricing_rules row into
// the deposit settings used by Quote, Checkout, orderCreation, and Admin
// preview. Runtime invalid data fails closed — no client defaults are
// substituted for null, malformed, zero, or invalid database values.
// ---------------------------------------------------------------------------

export type BookingDepositSettingsResult =
  | {
      status: 'ready';
      inflatableDepositPerUnitCents: number;
      eventEssentialsDepositSettings: EEOnlyDepositSettings;
    }
  | {
      status: 'invalid';
      error: string;
    };

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

export function parseBookingDepositSettings(
  pricingRulesRow: any,
): BookingDepositSettingsResult {
  if (!pricingRulesRow || typeof pricingRulesRow !== 'object') {
    return { status: 'invalid', error: 'No pricing configuration found.' };
  }

  const dpu = pricingRulesRow.deposit_per_unit_cents;
  if (!isPositiveSafeInteger(dpu)) {
    return {
      status: 'invalid',
      error: 'Invalid deposit configuration: deposit per unit must be a positive integer.',
    };
  }

  const threshold = pricingRulesRow.ee_only_deposit_base_threshold_cents;
  if (!isPositiveSafeInteger(threshold)) {
    return {
      status: 'invalid',
      error: 'Invalid deposit configuration: base threshold must be a positive integer.',
    };
  }

  const base = pricingRulesRow.ee_only_deposit_base_cents;
  if (!isPositiveSafeInteger(base)) {
    return {
      status: 'invalid',
      error: 'Invalid deposit configuration: base deposit must be a positive integer.',
    };
  }

  const stepSize = pricingRulesRow.ee_only_deposit_subtotal_step_cents;
  if (!isPositiveSafeInteger(stepSize)) {
    return {
      status: 'invalid',
      error: 'Invalid deposit configuration: step size must be a positive integer.',
    };
  }

  const stepDeposit = pricingRulesRow.ee_only_deposit_step_cents;
  if (!isPositiveSafeInteger(stepDeposit)) {
    return {
      status: 'invalid',
      error: 'Invalid deposit configuration: deposit step must be a positive integer.',
    };
  }

  return {
    status: 'ready',
    inflatableDepositPerUnitCents: dpu,
    eventEssentialsDepositSettings: {
      eeOnlyDepositBaseThresholdCents: threshold,
      eeOnlyDepositBaseCents: base,
      eeOnlyDepositSubtotalStepCents: stepSize,
      eeOnlyDepositStepCents: stepDeposit,
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton pricing-row fetch helper
//
// Fetches all rows from pricing_rules and requires exactly one. Using
// .limit(1).maybeSingle() conceals duplicate rows; this helper surfaces them.
// ---------------------------------------------------------------------------

export async function fetchSingletonPricingRulesRow(): Promise<
  | { status: 'ready'; row: any }
  | { status: 'error'; error: string }
  | { status: 'missing'; error: string }
  | { status: 'duplicate'; error: string }
> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.from('pricing_rules').select('*');

  if (error) {
    return { status: 'error', error: error.message };
  }
  if (!data || data.length === 0) {
    return { status: 'missing', error: 'No pricing configuration found.' };
  }
  if (data.length > 1) {
    return {
      status: 'duplicate',
      error: `Multiple pricing configuration rows found (${data.length}). Please contact an administrator.`,
    };
  }
  return { status: 'ready', row: data[0] };
}
