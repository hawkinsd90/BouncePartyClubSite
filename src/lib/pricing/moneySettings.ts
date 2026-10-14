// Stage E4 — Shared production money-settings parser.
//
// Used by Admin PricingRulesTab to validate money inputs before saving.
// Rejects blank, NaN, Infinity, negative, non-numeric, and >2 decimal places.
// Does NOT convert blank or malformed input to zero.

export interface MoneyParseResult {
  ok: boolean;
  cents: number | null;
  error?: string;
}

export function parseMoneyInput(input: string): MoneyParseResult {
  if (input === null || input === undefined || input.trim() === '') {
    return { ok: false, cents: null, error: 'Value is required' };
  }

  const cleaned = input.trim().replace(/[$,]/g, '');

  if (cleaned === '') {
    return { ok: false, cents: null, error: 'Value is required' };
  }

  const num = Number(cleaned);

  if (!Number.isFinite(num)) {
    return { ok: false, cents: null, error: 'Value must be a finite number' };
  }

  if (num < 0) {
    return { ok: false, cents: null, error: 'Value must not be negative' };
  }

  // Check max 2 decimal places
  const dotIndex = cleaned.indexOf('.');
  if (dotIndex >= 0 && cleaned.length - dotIndex - 1 > 2) {
    return { ok: false, cents: null, error: 'Maximum two decimal places' };
  }

  const cents = Math.round(num * 100);

  if (!Number.isSafeInteger(cents)) {
    return { ok: false, cents: null, error: 'Value is too large' };
  }

  return { ok: true, cents };
}

export interface EEDepositSettingsValidation {
  ok: boolean;
  errors: Record<string, string>;
  settings: {
    ee_only_deposit_base_threshold_cents: number;
    ee_only_deposit_base_cents: number;
    ee_only_deposit_subtotal_step_cents: number;
    ee_only_deposit_step_cents: number;
  } | null;
}

export function validateEEDepositSettingsInput(input: {
  eeBaseThreshold: string;
  eeBaseDeposit: string;
  eeStepSize: string;
  eeStepDeposit: string;
}): EEDepositSettingsValidation {
  const fields = [
    { key: 'eeBaseThreshold', col: 'ee_only_deposit_base_threshold_cents', label: 'Base Threshold', value: input.eeBaseThreshold },
    { key: 'eeBaseDeposit', col: 'ee_only_deposit_base_cents', label: 'Base Deposit', value: input.eeBaseDeposit },
    { key: 'eeStepSize', col: 'ee_only_deposit_subtotal_step_cents', label: 'Step Size', value: input.eeStepSize },
    { key: 'eeStepDeposit', col: 'ee_only_deposit_step_cents', label: 'Step Deposit', value: input.eeStepDeposit },
  ];

  const errors: Record<string, string> = {};
  const parsed: Record<string, number> = {};

  for (const field of fields) {
    const result = parseMoneyInput(field.value);
    if (!result.ok || result.cents === null) {
      errors[field.key] = `${field.label}: ${result.error}`;
    } else if (result.cents <= 0) {
      errors[field.key] = `${field.label}: must be greater than zero`;
    } else {
      parsed[field.col] = result.cents;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, settings: null };
  }

  return {
    ok: true,
    errors: {},
    settings: {
      ee_only_deposit_base_threshold_cents: parsed['ee_only_deposit_base_threshold_cents'],
      ee_only_deposit_base_cents: parsed['ee_only_deposit_base_cents'],
      ee_only_deposit_subtotal_step_cents: parsed['ee_only_deposit_subtotal_step_cents'],
      ee_only_deposit_step_cents: parsed['ee_only_deposit_step_cents'],
    },
  };
}
