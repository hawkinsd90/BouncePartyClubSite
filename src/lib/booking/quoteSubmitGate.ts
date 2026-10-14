// Pure Quote submit gate, extracted verbatim from Quote.handleSubmit.
//
// The page used to run a fixed sequence of checks and, on the first failure, set the error banner state,
// scroll somewhere and stop. This module owns only the DECISION: the first failing check wins, in the same
// order, with the same message, field id, scroll target and debug-info flag. The page keeps every side
// effect (flushSync, state setters, scrolling, debug info, the availability request, saving, tracking and
// navigation) and applies the returned failure through one thin helper.
//
// Preserved quirks: debug info is only recorded for the validateQuote failure and for the post-recheck
// "just booked" failure (`debugSection` is present only on those two results).

import { validateQuote } from './quoteValidation';
import { validateCartPackageSnapshots } from '../pricing/packageDisplay';
import { composeUnifiedQuoteTotals } from '../pricing/unifiedTotals';
import { parseBookingDepositSettings } from '../pricing/depositCalculation';
import type { PricingRules, PriceBreakdown } from '../pricing';
import type { QuoteFormData } from '../../hooks/booking/useQuoteForm';
import type { UnifiedCartItem } from '../../types';

export type QuoteSection = 'cart' | 'address' | 'event' | 'setup';

export type QuoteScrollTarget =
  | { kind: 'field'; id: string }
  | { kind: 'section'; section: QuoteSection }
  | null;

export interface QuoteSubmitGateFailure {
  ok: false;
  message: string;
  fieldId: string | null;
  scroll: QuoteScrollTarget;
  // Present only when the page records debug info for this failure (the value is the debug errorSection).
  debugSection?: string | null;
}

export type QuoteSubmitGateResult = { ok: true } | QuoteSubmitGateFailure;

export interface QuoteSubmitGateInput {
  cart: UnifiedCartItem[];
  formData: QuoteFormData;
  dateChangeAvailabilityError: string | null;
  eventEssentialsRepricing: {
    validationPending: boolean;
    validationFailed: boolean;
    hasBlockingIssues: boolean;
  };
  legacyConversionNeeded: boolean;
  pricingRulesLoading: boolean;
  pricingRulesError: unknown;
  pricingRules: PricingRules | null | undefined;
  priceBreakdown: PriceBreakdown | null | undefined;
}

function cartFailure(message: string): QuoteSubmitGateFailure {
  return { ok: false, message, fieldId: null, scroll: { kind: 'section', section: 'cart' } };
}

function noScrollFailure(message: string): QuoteSubmitGateFailure {
  return { ok: false, message, fieldId: null, scroll: null };
}

export function evaluateQuoteSubmitGate(input: QuoteSubmitGateInput): QuoteSubmitGateResult {
  const {
    cart, formData, dateChangeAvailabilityError, eventEssentialsRepricing, legacyConversionNeeded,
    pricingRulesLoading, pricingRulesError, pricingRules, priceBreakdown,
  } = input;

  const validation = validateQuote(cart, formData);
  if (!validation.isValid) {
    const errorMessage = validation.errorMessage || 'Please fix the errors below';
    // Scroll to exact field if errorFieldId is provided, otherwise scroll to section
    const scroll: QuoteScrollTarget = validation.errorFieldId
      ? { kind: 'field', id: validation.errorFieldId }
      : validation.errorSection
        ? { kind: 'section', section: validation.errorSection }
        : null;
    return {
      ok: false,
      message: errorMessage,
      fieldId: validation.errorFieldId || null,
      scroll,
      debugSection: validation.errorSection || null,
    };
  }

  // Block checkout when date-change availability check found unavailable items
  if (dateChangeAvailabilityError) {
    return cartFailure(dateChangeAvailabilityError);
  }

  // Stage E3 — Block checkout while Event Essential validation is pending.
  if (eventEssentialsRepricing.validationPending) {
    return cartFailure('Please wait while your Event Essential items are being verified.');
  }

  // Stage E3 — Block checkout when Event Essential configuration failed.
  if (eventEssentialsRepricing.validationFailed) {
    return cartFailure('Unable to verify your Event Essential items. Please try again.');
  }

  // Stage E3 — Block checkout when Event Essential items have blocking issues.
  if (eventEssentialsRepricing.hasBlockingIssues) {
    return cartFailure('Please resolve the unavailable Event Essential items before continuing.');
  }

  // Stage E4 — Generator unification: legacy browser-storage conversion is handled by useGeneratorCheckbox.
  if (legacyConversionNeeded) {
    return { ok: false, message: 'Your saved Generator selection needs to be reviewed before continuing.', fieldId: null, scroll: { kind: 'section', section: 'setup' } };
  }

  // Stage E4 — Validate package snapshots before navigating to Checkout.
  const packageValidation = validateCartPackageSnapshots(cart);
  if (!packageValidation.ok) {
    return cartFailure('Package details could not be verified. Please remove and re-add the package or contact us.');
  }

  // Stage E4 — Block checkout while pricing settings are loading or failed.
  if (pricingRulesLoading) {
    return noScrollFailure('Loading pricing configuration. Please wait a moment and try again.');
  }

  if (pricingRulesError || !pricingRules) {
    return noScrollFailure('Unable to load pricing configuration. Please refresh the page or contact us for assistance.');
  }

  // Stage E4 — Block checkout on deposit calculation failure.
  if (priceBreakdown && pricingRules) {
    const parsedSettings = parseBookingDepositSettings(pricingRules);
    if (parsedSettings.status !== 'ready') {
      return noScrollFailure(`Unable to calculate deposit: ${parsedSettings.error} Please contact us for assistance.`);
    }
    const preTotals = composeUnifiedQuoteTotals({
      inflatableBreakdown: priceBreakdown,
      cart,
      taxApplied: priceBreakdown.tax_applied ?? true,
      eeOnlyDepositSettings: parsedSettings.eventEssentialsDepositSettings,
      inflatableDepositPerUnitCents: parsedSettings.inflatableDepositPerUnitCents,
      setupMinimumCents: pricingRules.event_essentials_setup_minimum_cents ?? 15000,
    });
    if (preTotals.depositError) {
      return noScrollFailure(`Unable to calculate deposit: ${preTotals.depositError}. Please contact us for assistance.`);
    }
  }

  return { ok: true };
}

// Evaluates the result of the page's final availability recheck (the request itself stays in the page).
export function evaluateAvailabilityRecheck(result: {
  cart: UnifiedCartItem[];
  eventEssentialsCheckFailed: boolean;
}): QuoteSubmitGateResult {
  if (result.eventEssentialsCheckFailed) {
    return cartFailure('Unable to check Event Essentials availability right now. Please try again.');
  }

  const stillUnavailable = result.cart.filter((item) => item.isAvailable === false);
  if (stillUnavailable.length > 0) {
    const unavailableNames = stillUnavailable.map((item) => {
      if (item.item_type === 'event_essential_bundle') return item.bundle_name;
      if (item.item_type === 'event_essential_product') return item.product_name;
      return item.unit_name;
    }).join(', ');
    const errorMessage = `Sorry, the following items were just booked: ${unavailableNames}. Please choose different dates or remove these items.`;

    return { ...cartFailure(errorMessage), debugSection: 'cart' };
  }

  return { ok: true };
}
