// Stage E1 — Event Essentials Qualifying-Subtotal, Price-Resolution, and
// Package-Prerequisite Engine.
//
// Pure deterministic domain engine. No React, no Supabase, no browser APIs,
// no localStorage, no side effects, no I/O. Integer cents only.
//
// Approved business rules (see implementation prompt):
//   1. NULL threshold != 0. NULL is incomplete config; 0 is explicit.
//   2. Qualifying subtotal uses eligible lines' standalone equipment values.
//   3. Only direct product and direct inflatable lines contribute. Packages,
//      decomposed components, taxes, fees, tips, deposits, refunds never do.
//   4. Product qualification excludes the candidate, its own category, and
//      all package lines; includes other-category products and inflatables.
//   5. Package qualification excludes the candidate, all packages, and the
//      package's excluded categories; includes other products and inflatables.
//   6. Package inflatable prerequisite is separate from pricing and blocks
//      selectability when failed. Only direct inflatable lines may satisfy it.
//   7-10. See price-path and configuration-error rules below.

import type {
  ConfigurationWarningCode,
  InflatableEligibilityMode,
  InvalidConfigCode,
  MessageCode,
  PrerequisiteFailureCode,
  ResolverBundleConfig,
  ResolverInput,
  ResolverInputLine,
  ResolverOutputLine,
  ResolverProductConfig,
  ResolverResult,
  ResolverUnitConfig,
  SelectableCode,
} from './eventEssentialsPricingTypes';

// ---------------------------------------------------------------------------
// Predicates / small helpers.
// ---------------------------------------------------------------------------

function isNonNegativeInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

function isValidPrice(cents: number | null | undefined): cents is number {
  return typeof cents === 'number' && Number.isInteger(cents) && cents >= 0;
}

/** Standalone pricing path is valid when enabled and a non-negative price is set. */
function standalonePathValid(cfg: {
  standaloneEnabled: boolean;
  standalonePriceCents: number | null;
}): boolean {
  return cfg.standaloneEnabled && isValidPrice(cfg.standalonePriceCents);
}

/** Add-on pricing path is valid when enabled and a non-negative price is set. */
function addonPriceValid(cfg: {
  addonEnabled: boolean;
  addonPriceCents: number | null;
}): boolean {
  return cfg.addonEnabled && isValidPrice(cfg.addonPriceCents);
}

function max0(n: number): number {
  return n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// APPROVED RULE 2 — Qualifying-subtotal price basis (isolated helper).
// ---------------------------------------------------------------------------

/**
 * The fixed standalone equipment value an eligible direct line contributes
 * toward another candidate's qualifying subtotal.
 *
 * - Direct Event Essential product: configured standalone_price_cents * qty
 *   (never the discounted/add-on value, even when the line currently resolves
 *    to add-on pricing).
 * - Direct inflatable: selectedUnitPriceCents * qty.
 * - Package/bundle lines: never contribute (Rule 3).
 * - Unknown or invalid price or qty: contributes 0.
 *
 * This fixed basis is what makes qualification single-pass deterministic and
 * free of circular discount dependencies.
 */
function directLineStandaloneContribution(
  line: ResolverInputLine,
  productConfigs: Record<string, ResolverProductConfig>,
): number {
  if (!isNonNegativeInt(line.qty) || line.qty === 0) return 0;

  if (line.itemType === 'event_essential_product') {
    const cfg = line.productId ? productConfigs[line.productId] : undefined;
    if (!cfg) return 0;
    if (!isValidPrice(cfg.standalonePriceCents)) return 0;
    return cfg.standalonePriceCents * line.qty;
  }

  if (line.itemType === 'inflatable') {
    if (!isValidPrice(line.selectedUnitPriceCents)) return 0;
    return line.selectedUnitPriceCents * line.qty;
  }

  // event_essential_bundle and anything else: 0.
  return 0;
}

// ---------------------------------------------------------------------------
// APPROVED RULE 4 — Product qualifying subtotal.
// ---------------------------------------------------------------------------

/**
 * Exclude:
 *   - the candidate line itself (a product never qualifies itself)
 *   - every direct product line in the candidate product's own category
 *   - every package line
 * Include:
 *   - direct product lines in OTHER categories
 *   - direct inflatable contributions
 */
function productQualifyingSubtotal(
  candidate: ResolverInputLine,
  candidateCfg: ResolverProductConfig,
  input: ResolverInput,
): number {
  const ownCategoryId = candidateCfg.categoryId;
  let total = 0;
  for (const line of input.lines) {
    if (line.resolverKey === candidate.resolverKey) continue; // self
    if (line.itemType === 'event_essential_bundle') continue; // packages never qualify products
    if (line.itemType === 'event_essential_product') {
      const cfg = line.productId ? input.productConfigs[line.productId] : undefined;
      if (!cfg) continue;
      if (cfg.categoryId === ownCategoryId) continue; // own category excluded
      total += directLineStandaloneContribution(line, input.productConfigs);
    } else if (line.itemType === 'inflatable') {
      total += directLineStandaloneContribution(line, input.productConfigs);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// APPROVED RULE 5 — Package qualifying subtotal.
// ---------------------------------------------------------------------------

/**
 * Exclude:
 *   - the candidate package itself
 *   - all package lines
 *   - direct product lines whose categories appear in the package's
 *     excludedCategoryIds
 * Include:
 *   - direct product lines from non-excluded categories
 *   - direct inflatable contributions
 */
function packageQualifyingSubtotal(
  candidate: ResolverInputLine,
  candidateCfg: ResolverBundleConfig,
  input: ResolverInput,
): number {
  const excluded = new Set(candidateCfg.excludedCategoryIds);
  let total = 0;
  for (const line of input.lines) {
    if (line.resolverKey === candidate.resolverKey) continue; // self
    if (line.itemType === 'event_essential_bundle') continue; // packages never qualify packages
    if (line.itemType === 'event_essential_product') {
      const cfg = line.productId ? input.productConfigs[line.productId] : undefined;
      if (!cfg) continue;
      if (excluded.has(cfg.categoryId)) continue; // package excluded category
      total += directLineStandaloneContribution(line, input.productConfigs);
    } else if (line.itemType === 'inflatable') {
      total += directLineStandaloneContribution(line, input.productConfigs);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// APPROVED RULE 6 — Package inflatable prerequisite.
// ---------------------------------------------------------------------------

interface PrerequisiteResult {
  met: boolean;
  failureReason: PrerequisiteFailureCode | null;
  warning: 'SELECTED_MODE_NO_UNITS' | 'SELECTED_MODE_UNIT_INACTIVE' | 'SELECTED_MODE_UNKNOWN_UNIT' | null;
}

/**
 * A package's own included inflatable components never satisfy its
 * prerequisite. Only DIRECT inflatable cart lines (outside any package) can.
 */
function evaluatePrerequisite(
  candidate: ResolverInputLine,
  cfg: ResolverBundleConfig,
  input: ResolverInput,
): PrerequisiteResult {
  const mode: InflatableEligibilityMode = cfg.inflatableEligibilityMode;

  if (mode === 'none') {
    return { met: true, failureReason: null, warning: null };
  }

  // Direct inflatable lines only. Package lines (even those containing
  // inflatables) are never considered.
  const directInflatables = input.lines.filter(
    (l) =>
      l.resolverKey !== candidate.resolverKey &&
      l.itemType === 'inflatable' &&
      isNonNegativeInt(l.qty) &&
      l.qty > 0,
  );

  if (mode === 'any') {
    if (directInflatables.length > 0) {
      return { met: true, failureReason: null, warning: null };
    }
    return { met: false, failureReason: 'NO_DIRECT_INFLATABLE', warning: null };
  }

  // selected
  const eligibleIds = cfg.eligibleUnitIds;
  if (!eligibleIds || eligibleIds.length === 0) {
    return { met: false, failureReason: 'NO_ELIGIBLE_UNITS_CONFIGURED', warning: 'SELECTED_MODE_NO_UNITS' };
  }

  const units = input.units;
  let matchedActive = false;
  let sawUnknown = false;
  for (const id of eligibleIds) {
    const unit: ResolverUnitConfig | undefined = units[id];
    if (!unit) {
      sawUnknown = true;
      continue;
    }
    if (!unit.active) continue;
    const hasMatch = directInflatables.some((l) => l.unitId === id);
    if (hasMatch) {
      matchedActive = true;
      break;
    }
  }

  if (matchedActive) {
    return { met: true, failureReason: null, warning: null };
  }

  // Did not match. Determine the most useful failure code.
  // Priority: inactive matching unit > unknown eligible unit > no match.
  let matchedInactive = false;
  for (const id of eligibleIds) {
    const unit = units[id];
    if (unit && !unit.active) {
      const hasMatch = directInflatables.some((l) => l.unitId === id);
      if (hasMatch) {
        matchedInactive = true;
        break;
      }
    }
  }
  if (matchedInactive) {
    return { met: false, failureReason: 'UNIT_INACTIVE', warning: 'SELECTED_MODE_UNIT_INACTIVE' };
  }
  if (sawUnknown) {
    return { met: false, failureReason: 'UNKNOWN_ELIGIBLE_UNIT', warning: 'SELECTED_MODE_UNKNOWN_UNIT' };
  }
  if (directInflatables.length === 0) {
    return { met: false, failureReason: 'NO_DIRECT_INFLATABLE', warning: null };
  }
  return { met: false, failureReason: 'NO_MATCHING_UNIT', warning: null };
}

// ---------------------------------------------------------------------------
// APPROVED RULE 10 — customer_choice detection.
// ---------------------------------------------------------------------------

function bundleRequiresCustomerChoice(cfg: ResolverBundleConfig): boolean {
  return cfg.inflatableComponents.some((c) => c.selectionMode === 'customer_choice');
}

// ---------------------------------------------------------------------------
// Price-path resolution.
// ---------------------------------------------------------------------------

interface PricePathResult {
  addonQualified: boolean;
  resolvedContext: 'standalone' | 'addon' | null;
  resolvedPrice: number | null;
  remainingAmountCents: number | null;
  invalidReason: InvalidConfigCode | null;
  warning: ConfigurationWarningCode | null;
}

/**
 * Resolve pricing for a product or package given:
 *   - complete config (standalone/addon enabled flags, prices, threshold)
 *   - the candidate's qualifying subtotal
 *
 * Rules 1, 7, 8 applied here.
 */
function resolvePricePath(params: {
  standaloneEnabled: boolean;
  standalonePriceCents: number | null;
  addonEnabled: boolean;
  addonPriceCents: number | null;
  addonQualifyingThresholdCents: number | null;
  qualifyingSubtotal: number;
}): PricePathResult {
  const {
    standaloneEnabled,
    standalonePriceCents,
    addonEnabled,
    addonPriceCents,
    addonQualifyingThresholdCents,
    qualifyingSubtotal,
  } = params;

  const standaloneValid = standalonePathValid({ standaloneEnabled, standalonePriceCents });
  const addonPriceOk = addonPriceValid({ addonEnabled, addonPriceCents });
  const addonThresholdConfigured =
    addonQualifyingThresholdCents !== null && isNonNegativeInt(addonQualifyingThresholdCents);

  // A. Add-on fully configured and threshold met -> add-on.
  if (addonPriceOk && addonThresholdConfigured) {
    const threshold = addonQualifyingThresholdCents as number;
    if (qualifyingSubtotal >= threshold) {
      return {
        addonQualified: true,
        resolvedContext: 'addon',
        resolvedPrice: addonPriceCents as number,
        remainingAmountCents: 0,
        invalidReason: null,
        warning: null,
      };
    }
    // Threshold not met. Fall through to standalone/invalid logic below,
    // carrying the remaining amount.
    const remaining = max0(threshold - qualifyingSubtotal);
    if (standaloneValid) {
      return {
        addonQualified: false,
        resolvedContext: 'standalone',
        resolvedPrice: standalonePriceCents as number,
        remainingAmountCents: remaining,
        invalidReason: null,
        warning: null,
      };
    }
    // C. Threshold not met and no standalone.
    return {
      addonQualified: false,
      resolvedContext: null,
      resolvedPrice: null,
      remainingAmountCents: remaining,
      invalidReason: 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED',
      warning: null,
    };
  }

  // Add-on enabled but configuration incomplete (Rule 1).
  if (addonEnabled) {
    // Threshold missing (NULL) or addon price missing.
    const thresholdMissing = !addonThresholdConfigured;
    if (standaloneValid) {
      return {
        addonQualified: false,
        resolvedContext: 'standalone',
        resolvedPrice: standalonePriceCents as number,
        remainingAmountCents: null,
        invalidReason: null,
        warning: thresholdMissing ? 'ADDON_THRESHOLD_MISSING' : 'ADDON_PRICE_MISSING',
      };
    }
    // No standalone path.
    return {
      addonQualified: false,
      resolvedContext: null,
      resolvedPrice: null,
      remainingAmountCents: null,
      invalidReason: thresholdMissing
        ? 'ADDON_THRESHOLD_MISSING_NO_STANDALONE'
        : 'ADDON_PRICE_MISSING_NO_STANDALONE',
      warning: null,
    };
  }

  // D. Add-on disabled and standalone valid.
  if (standaloneValid) {
    return {
      addonQualified: false,
      resolvedContext: 'standalone',
      resolvedPrice: standalonePriceCents as number,
      remainingAmountCents: null,
      invalidReason: null,
      warning: null,
    };
  }

  // E. Both paths invalid / disabled.
  return {
    addonQualified: false,
    resolvedContext: null,
    resolvedPrice: null,
    remainingAmountCents: null,
    invalidReason: 'NO_PURCHASE_PATH',
    warning: null,
  };
}

// ---------------------------------------------------------------------------
// Output construction for the invalid-line fast paths.
// ---------------------------------------------------------------------------

function invalidLine(
  resolverKey: string,
  selectableReason: Exclude<SelectableCode, 'OK'>,
  invalidReason: InvalidConfigCode,
  message: MessageCode,
): ResolverOutputLine {
  return {
    resolverKey,
    selectable: false,
    selectableReason,
    prerequisiteMet: true, // not applicable; no prerequisite to fail
    prerequisiteFailureReason: 'NOT_APPLICABLE',
    addonQualified: false,
    resolvedPricingContext: null,
    resolvedUnitPriceCents: null,
    standalonePriceCents: null,
    addonPriceCents: null,
    qualifyingSubtotalCents: null,
    qualifyingThresholdCents: null,
    remainingAmountCents: null,
    invalidReason,
    configurationWarning: null,
    requiresCustomerChoice: false,
    customerMessageCode: message,
  };
}

// ---------------------------------------------------------------------------
// Main resolver.
// ---------------------------------------------------------------------------

export function resolveEventEssentialsPricing(input: ResolverInput): ResolverResult {
  const out: ResolverOutputLine[] = [];
  for (const line of input.lines) {
    out.push(resolveLine(line, input));
  }
  return { lines: out };
}

function resolveLine(line: ResolverInputLine, input: ResolverInput): ResolverOutputLine {
  // Quantity validation.
  if (!isNonNegativeInt(line.qty)) {
    return invalidLine(
      line.resolverKey,
      'INVALID_QUANTITY',
      'INVALID_QUANTITY',
      'NOT_AVAILABLE',
    );
  }

  if (line.itemType === 'inflatable') {
    // Inflatables are inputs to qualification, not candidates. We still
    // return a row so callers can echo keys and detect unknown lines.
    return {
      resolverKey: line.resolverKey,
      selectable: true,
      selectableReason: 'OK',
      prerequisiteMet: true,
      prerequisiteFailureReason: 'NOT_APPLICABLE',
      addonQualified: false,
      resolvedPricingContext: null,
      resolvedUnitPriceCents: isValidPrice(line.selectedUnitPriceCents)
        ? line.selectedUnitPriceCents
        : null,
      standalonePriceCents: null,
      addonPriceCents: null,
      qualifyingSubtotalCents: null,
      qualifyingThresholdCents: null,
      remainingAmountCents: null,
      invalidReason: null,
      configurationWarning: null,
      requiresCustomerChoice: false,
      customerMessageCode: 'NONE',
    };
  }

  if (line.itemType === 'event_essential_product') {
    return resolveProductLine(line, input);
  }

  if (line.itemType === 'event_essential_bundle') {
    return resolveBundleLine(line, input);
  }

  return invalidLine(
    line.resolverKey,
    'UNKNOWN_ITEM_TYPE',
    'UNKNOWN_ITEM_TYPE',
    'NOT_AVAILABLE',
  );
}

function resolveProductLine(line: ResolverInputLine, input: ResolverInput): ResolverOutputLine {
  const productId = line.productId;
  const cfg = productId ? input.productConfigs[productId] : undefined;
  if (!cfg) {
    return invalidLine(line.resolverKey, 'PRODUCT_CONFIG_MISSING', 'PRODUCT_CONFIG_MISSING', 'NOT_AVAILABLE');
  }
  const category = input.categories[cfg.categoryId];
  if (!category) {
    return invalidLine(line.resolverKey, 'CATEGORY_MISSING', 'CATEGORY_MISSING', 'NOT_AVAILABLE');
  }

  const qualifyingSubtotal = productQualifyingSubtotal(line, cfg, input);
  const pricePath = resolvePricePath({
    standaloneEnabled: cfg.standaloneEnabled,
    standalonePriceCents: cfg.standalonePriceCents,
    addonEnabled: cfg.addonEnabled,
    addonPriceCents: cfg.addonPriceCents,
    addonQualifyingThresholdCents: cfg.addonQualifyingThresholdCents,
    qualifyingSubtotal,
  });

  const invalid = pricePath.invalidReason !== null;
  const message: MessageCode = invalid
    ? 'NOT_AVAILABLE'
    : pricePath.warning === 'ADDON_THRESHOLD_MISSING' || pricePath.warning === 'ADDON_PRICE_MISSING'
      ? 'STANDALONE_ONLY_ADDON_UNCONFIGURED'
      : pricePath.resolvedContext === 'standalone' && pricePath.remainingAmountCents !== null && pricePath.remainingAmountCents > 0
        ? 'ADD_REMAINING_TO_QUALIFY'
        : 'NONE';

  return {
    resolverKey: line.resolverKey,
    selectable: !invalid,
    selectableReason: invalid ? ('NO_PURCHASE_PATH' as SelectableCode) : 'OK',
    prerequisiteMet: true,
    prerequisiteFailureReason: 'NOT_APPLICABLE',
    addonQualified: pricePath.addonQualified,
    resolvedPricingContext: pricePath.resolvedContext,
    resolvedUnitPriceCents: pricePath.resolvedPrice,
    standalonePriceCents: cfg.standalonePriceCents,
    addonPriceCents: cfg.addonPriceCents,
    qualifyingSubtotalCents: qualifyingSubtotal,
    qualifyingThresholdCents:
      cfg.addonQualifyingThresholdCents !== null && isNonNegativeInt(cfg.addonQualifyingThresholdCents)
        ? cfg.addonQualifyingThresholdCents
        : null,
    remainingAmountCents: pricePath.remainingAmountCents,
    invalidReason: pricePath.invalidReason,
    configurationWarning: pricePath.warning,
    requiresCustomerChoice: false,
    customerMessageCode: message,
  };
}

function resolveBundleLine(line: ResolverInputLine, input: ResolverInput): ResolverOutputLine {
  const bundleId = line.bundleId;
  const cfg = bundleId ? input.bundleConfigs[bundleId] : undefined;
  if (!cfg) {
    return invalidLine(line.resolverKey, 'BUNDLE_CONFIG_MISSING', 'BUNDLE_CONFIG_MISSING', 'NOT_AVAILABLE');
  }

  // Prerequisite first — failure blocks selectability regardless of pricing.
  const prereq = evaluatePrerequisite(line, cfg, input);
  if (!prereq.met) {
    const warning = prereq.warning;
    return {
      resolverKey: line.resolverKey,
      selectable: false,
      selectableReason: 'PREREQUISITE_NOT_MET',
      prerequisiteMet: false,
      prerequisiteFailureReason: prereq.failureReason,
      addonQualified: false,
      resolvedPricingContext: null,
      resolvedUnitPriceCents: null,
      standalonePriceCents: cfg.standalonePriceCents,
      addonPriceCents: cfg.addonPriceCents,
      qualifyingSubtotalCents: null,
      qualifyingThresholdCents: null,
      remainingAmountCents: null,
      invalidReason: null,
      configurationWarning: warning,
      requiresCustomerChoice: bundleRequiresCustomerChoice(cfg),
      customerMessageCode: 'PACKAGE_REQUIRES_INFLATABLE',
    };
  }

  const qualifyingSubtotal = packageQualifyingSubtotal(line, cfg, input);
  const pricePath = resolvePricePath({
    standaloneEnabled: cfg.standaloneEnabled,
    standalonePriceCents: cfg.standalonePriceCents,
    addonEnabled: cfg.addonEnabled,
    addonPriceCents: cfg.addonPriceCents,
    addonQualifyingThresholdCents: cfg.addonQualifyingThresholdCents,
    qualifyingSubtotal,
  });

  const requiresCustomerChoice = bundleRequiresCustomerChoice(cfg);
  const invalid = pricePath.invalidReason !== null;
  let message: MessageCode = 'NONE';
  if (invalid) {
    message = 'NOT_AVAILABLE';
  } else if (requiresCustomerChoice) {
    message = 'CUSTOMER_CHOICE_REQUIRED';
  } else if (pricePath.warning === 'ADDON_THRESHOLD_MISSING' || pricePath.warning === 'ADDON_PRICE_MISSING') {
    message = 'STANDALONE_ONLY_ADDON_UNCONFIGURED';
  } else if (pricePath.resolvedContext === 'standalone' && pricePath.remainingAmountCents !== null && pricePath.remainingAmountCents > 0) {
    message = 'ADD_REMAINING_TO_QUALIFY';
  }

  return {
    resolverKey: line.resolverKey,
    selectable: !invalid,
    selectableReason: invalid ? ('NO_PURCHASE_PATH' as SelectableCode) : 'OK',
    prerequisiteMet: true,
    prerequisiteFailureReason: null,
    addonQualified: pricePath.addonQualified,
    resolvedPricingContext: pricePath.resolvedContext,
    resolvedUnitPriceCents: pricePath.resolvedPrice,
    standalonePriceCents: cfg.standalonePriceCents,
    addonPriceCents: cfg.addonPriceCents,
    qualifyingSubtotalCents: qualifyingSubtotal,
    qualifyingThresholdCents:
      cfg.addonQualifyingThresholdCents !== null && isNonNegativeInt(cfg.addonQualifyingThresholdCents)
        ? cfg.addonQualifyingThresholdCents
        : null,
    remainingAmountCents: pricePath.remainingAmountCents,
    invalidReason: pricePath.invalidReason,
    configurationWarning: pricePath.warning,
    requiresCustomerChoice,
    customerMessageCode: message,
  };
}
