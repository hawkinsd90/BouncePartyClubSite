// Stage E1 — Event Essentials Qualifying-Subtotal, Price-Resolution, and
// Package-Prerequisite Engine.
//
// Pure deterministic domain engine. No React, no Supabase, no browser APIs,
// no localStorage, no side effects, no I/O. Integer cents only.
//
// Approved business rules (see implementation prompt):
//   1. NULL threshold != 0. NULL is incomplete (missing); 0 is explicit (valid).
//      Negative/non-integer/unsafe numeric config is INVALID, not missing.
//   2. Qualifying subtotal uses eligible lines' standalone equipment values.
//   3. Only direct product and direct inflatable lines contribute. Packages,
//      decomposed components, taxes, fees, tips, deposits, refunds never do.
//   4. Product qualification excludes the candidate, its own category, and
//      all package lines; includes other-category products and inflatables.
//   5. Package qualification excludes the candidate, all packages, and the
//      package's excluded categories; includes other products and inflatables.
//   6. Package inflatable prerequisite is separate from pricing and blocks
//      selectability when failed. Only VALID direct inflatable lines may
//      satisfy it. A package's own included components never satisfy it.
//   7-10. See price-path and configuration-error rules below.

import type {
  ConfigurationWarningCode,
  InflatableEligibilityMode,
  InvalidConfigCode,
  MessageCode,
  NumericConfigStatus,
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
// Safe-integer helpers. All currency and quantity math uses Number.isSafeInteger.
// ---------------------------------------------------------------------------

/** True for a positive safe integer (qty > 0). Candidate quantities must pass this. */
function isPositiveSafeInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
}

/** True for a non-negative safe integer (>= 0). Prices and thresholds use this. */
function isNonNegativeSafeInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

/**
 * Classify a configured numeric value (price or threshold).
 * - null/undefined      -> 'missing'  (incomplete configuration)
 * - non-negative safe int -> 'valid'
 * - anything else       -> 'invalid'  (negative, non-integer, or unsafe)
 */
function classifyNumeric(n: number | null | undefined): NumericConfigStatus {
  if (n === null || n === undefined) return 'missing';
  return isNonNegativeSafeInt(n) ? 'valid' : 'invalid';
}

/**
 * Safe multiplication of two non-negative safe integers. Returns null if the
 * product is not a safe integer (overflow guard).
 */
function safeMul(a: number, b: number): number | null {
  if (!isNonNegativeSafeInt(a) || !isNonNegativeSafeInt(b)) return null;
  const product = a * b;
  return Number.isSafeInteger(product) ? product : null;
}

/** Safe addition to an accumulated subtotal. Returns null on overflow. */
function safeAdd(acc: number, addend: number): number | null {
  if (!isNonNegativeSafeInt(acc) || !isNonNegativeSafeInt(addend)) return null;
  const sum = acc + addend;
  return Number.isSafeInteger(sum) ? sum : null;
}

function max0(n: number): number {
  return n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// Configuration lookups with map-key identity checks (Rule 6).
// ---------------------------------------------------------------------------

function lookupProduct(
  productId: string | undefined,
  input: ResolverInput,
): ResolverProductConfig | undefined {
  if (!productId) return undefined;
  const cfg = input.productConfigs[productId];
  if (!cfg) return undefined;
  if (cfg.id !== productId) return undefined; // key/id mismatch
  return cfg;
}

function lookupBundle(
  bundleId: string | undefined,
  input: ResolverInput,
): ResolverBundleConfig | undefined {
  if (!bundleId) return undefined;
  const cfg = input.bundleConfigs[bundleId];
  if (!cfg) return undefined;
  if (cfg.id !== bundleId) return undefined; // key/id mismatch
  return cfg;
}

// Reference lookupBundle so type-only consumers don't strip it; the function is
// kept for symmetry with the other lookups and for future use.
void lookupBundle;

function lookupCategory(categoryId: string | undefined, input: ResolverInput) {
  if (!categoryId) return undefined;
  const cfg = input.categories[categoryId];
  if (!cfg) return undefined;
  if (cfg.id !== categoryId) return undefined; // key/id mismatch
  return cfg;
}

function lookupUnit(unitId: string | undefined, input: ResolverInput) {
  if (!unitId) return undefined;
  const cfg = input.units[unitId];
  if (!cfg) return undefined;
  if (cfg.id !== unitId) return undefined; // key/id mismatch
  return cfg;
}

// ---------------------------------------------------------------------------
// Direct inflatable validation (Rule 1).
// ---------------------------------------------------------------------------

export type InflatableValidityCode =
  | 'VALID'
  | 'INVALID_QUANTITY'
  | 'INFLATABLE_UNIT_MISSING'
  | 'INFLATABLE_UNIT_UNKNOWN'
  | 'INFLATABLE_UNIT_INACTIVE'
  | 'INFLATABLE_PRICE_INVALID'
  | 'INFLATABLE_MODE_MISSING';

export interface InflatableValidity {
  valid: boolean;
  code: InflatableValidityCode;
  /** Present and valid only when valid. */
  contribution: number | null;
}

/**
 * A direct inflatable is valid only when ALL of:
 *   - qty is a positive safe integer
 *   - unitId is present
 *   - unit exists in input.units
 *   - unit.id matches unitId
 *   - unit is active
 *   - selectedUnitPriceCents is a non-negative safe integer
 *   - wetOrDry is 'dry' or 'water'
 *
 * A valid inflatable's contribution is selectedUnitPriceCents * qty, with
 * overflow guarding. Malformed inflatables contribute 0 and satisfy no
 * prerequisite.
 */
function validateInflatable(line: ResolverInputLine, input: ResolverInput): InflatableValidity {
  if (!isPositiveSafeInt(line.qty)) {
    return { valid: false, code: 'INVALID_QUANTITY', contribution: null };
  }
  if (!line.unitId) {
    return { valid: false, code: 'INFLATABLE_UNIT_MISSING', contribution: null };
  }
  const u = lookupUnit(line.unitId, input);
  if (!u) {
    return { valid: false, code: 'INFLATABLE_UNIT_UNKNOWN', contribution: null };
  }
  if (!u.active) {
    return { valid: false, code: 'INFLATABLE_UNIT_INACTIVE', contribution: null };
  }
  if (!isNonNegativeSafeInt(line.selectedUnitPriceCents)) {
    return { valid: false, code: 'INFLATABLE_PRICE_INVALID', contribution: null };
  }
  if (line.wetOrDry !== 'dry' && line.wetOrDry !== 'water') {
    return { valid: false, code: 'INFLATABLE_MODE_MISSING', contribution: null };
  }
  const contribution = safeMul(line.selectedUnitPriceCents, line.qty);
  if (contribution === null) {
    return { valid: false, code: 'INFLATABLE_PRICE_INVALID', contribution: null };
  }
  return { valid: true, code: 'VALID', contribution };
}

// ---------------------------------------------------------------------------
// Product contributor validation (Rule 5).
// ---------------------------------------------------------------------------

/**
 * Contribution of a direct PRODUCT line toward another candidate's qualifying
 * subtotal. Returns the safe contribution in cents, or null when the
 * contributor is malformed (missing/mismatched config, missing/mismatched
 * category, invalid price, invalid qty, or overflow).
 */
function productContribution(
  line: ResolverInputLine,
  input: ResolverInput,
): number | null {
  if (line.itemType !== 'event_essential_product') return null;
  if (!isPositiveSafeInt(line.qty)) return null;
  const cfg = lookupProduct(line.productId, input);
  if (!cfg) return null;
  // Contributor's own category must resolve.
  const category = lookupCategory(cfg.categoryId, input);
  if (!category) return null;
  if (classifyNumeric(cfg.standalonePriceCents) !== 'valid') return null;
  return safeMul(cfg.standalonePriceCents as number, line.qty);
}

/**
 * Contribution of a direct INFLATABLE line toward another candidate's
 * qualifying subtotal. Returns the safe contribution, or null when the
 * inflatable is malformed or overflows.
 */
function inflatableContribution(line: ResolverInputLine, input: ResolverInput): number | null {
  if (line.itemType !== 'inflatable') return null;
  const v = validateInflatable(line, input);
  return v.valid ? v.contribution : null;
}

// ---------------------------------------------------------------------------
// APPROVED RULE 4 — Product qualifying subtotal.
// ---------------------------------------------------------------------------

/**
 * Exclude:
 *   - the candidate line itself (by array position, NOT resolverKey)
 *   - every direct product line in the candidate product's own category
 *   - every package line
 * Include:
 *   - direct product lines in OTHER categories (validated)
 *   - direct inflatable contributions (validated)
 * Overflow-safe accumulation. Returns null if the running total overflows.
 */
function productQualifyingSubtotal(
  candidateIndex: number,
  candidateCfg: ResolverProductConfig,
  input: ResolverInput,
): number | null {
  const ownCategoryId = candidateCfg.categoryId;
  let total = 0;
  for (let i = 0; i < input.lines.length; i++) {
    if (i === candidateIndex) continue; // self by position
    const line = input.lines[i];
    if (line.itemType === 'event_essential_bundle') continue; // packages never qualify products
    if (line.itemType === 'event_essential_product') {
      const cfg = lookupProduct(line.productId, input);
      if (!cfg) continue;
      if (cfg.categoryId === ownCategoryId) continue; // own category excluded
      const c = productContribution(line, input);
      if (c === null) continue;
      const next = safeAdd(total, c);
      if (next === null) return null; // overflow -> null sentinel
      total = next;
    } else if (line.itemType === 'inflatable') {
      const c = inflatableContribution(line, input);
      if (c === null) continue;
      const next = safeAdd(total, c);
      if (next === null) return null;
      total = next;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// APPROVED RULE 5 — Package qualifying subtotal.
// ---------------------------------------------------------------------------

function packageQualifyingSubtotal(
  candidateIndex: number,
  candidateCfg: ResolverBundleConfig,
  input: ResolverInput,
): number | null {
  const excluded = new Set(candidateCfg.excludedCategoryIds);
  let total = 0;
  for (let i = 0; i < input.lines.length; i++) {
    if (i === candidateIndex) continue; // self by position
    const line = input.lines[i];
    if (line.itemType === 'event_essential_bundle') continue; // packages never qualify packages
    if (line.itemType === 'event_essential_product') {
      const cfg = lookupProduct(line.productId, input);
      if (!cfg) continue;
      if (excluded.has(cfg.categoryId)) continue; // package excluded category
      const c = productContribution(line, input);
      if (c === null) continue;
      const next = safeAdd(total, c);
      if (next === null) return null;
      total = next;
    } else if (line.itemType === 'inflatable') {
      const c = inflatableContribution(line, input);
      if (c === null) continue;
      const next = safeAdd(total, c);
      if (next === null) return null;
      total = next;
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
 * Only VALID direct inflatable cart lines (outside any package) may satisfy
 * the prerequisite. A package's own included inflatable components never
 * satisfy its prerequisite. Self-exclusion is by array position.
 */
function evaluatePrerequisite(
  candidateIndex: number,
  cfg: ResolverBundleConfig,
  input: ResolverInput,
): PrerequisiteResult {
  const mode: InflatableEligibilityMode = cfg.inflatableEligibilityMode;

  if (mode === 'none') {
    return { met: true, failureReason: null, warning: null };
  }

  // Collect VALID direct inflatables (excluding the candidate by position).
  const validInflatables: ResolverInputLine[] = [];
  for (let i = 0; i < input.lines.length; i++) {
    if (i === candidateIndex) continue;
    const line = input.lines[i];
    if (line.itemType !== 'inflatable') continue;
    if (validateInflatable(line, input).valid) {
      validInflatables.push(line);
    }
  }

  if (mode === 'any') {
    if (validInflatables.length > 0) {
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
    if (!unit || unit.id !== id) {
      sawUnknown = true;
      continue;
    }
    if (!unit.active) continue;
    const hasMatch = validInflatables.some((l) => l.unitId === id);
    if (hasMatch) {
      matchedActive = true;
      break;
    }
  }

  if (matchedActive) {
    return { met: true, failureReason: null, warning: null };
  }

  let matchedInactive = false;
  for (const id of eligibleIds) {
    const unit = units[id];
    if (unit && unit.id === id && !unit.active) {
      const hasMatch = validInflatables.some((l) => l.unitId === id);
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
  if (validInflatables.length === 0) {
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
  /** Fatal reason making the line unselectable. */
  invalidReason: InvalidConfigCode | null;
  /** Non-fatal warning when standalone fallback is used. */
  warning: ConfigurationWarningCode | null;
  /** selectableReason mirrors invalidReason when unselectable. */
  selectableReason: SelectableCode;
}

/**
 * Resolve pricing for a product or package.
 *
 * Missing-vs-invalid distinction (Rule 9):
 *   - NULL price/threshold -> 'missing' (incomplete config)
 *   - negative/non-integer/unsafe -> 'invalid' (malformed)
 * Both block the add-on path. Missing uses *_MISSING codes; invalid uses
 * *_INVALID codes. Standalone fallback applies when the standalone path is
 * valid and the add-on path is blocked for any reason.
 */
function resolvePricePath(params: {
  standaloneEnabled: boolean;
  standalonePriceCents: number | null;
  addonEnabled: boolean;
  addonPriceCents: number | null;
  addonQualifyingThresholdCents: number | null;
  qualifyingSubtotal: number; // null-sentinel for overflow handled by caller
}): PricePathResult {
  const {
    standaloneEnabled,
    standalonePriceCents,
    addonEnabled,
    addonPriceCents,
    addonQualifyingThresholdCents,
    qualifyingSubtotal,
  } = params;

  const standaloneStatus = classifyNumeric(standalonePriceCents);
  const addonPriceStatus = classifyNumeric(addonPriceCents);
  const thresholdStatus = classifyNumeric(addonQualifyingThresholdCents);

  const standaloneValid =
    standaloneEnabled && standaloneStatus === 'valid' && standalonePriceCents !== null;

  // Standalone enabled but price malformed -> standalone path invalid (not just missing).
  if (standaloneEnabled && standaloneStatus === 'invalid') {
    return {
      addonQualified: false,
      resolvedContext: null,
      resolvedPrice: null,
      remainingAmountCents: null,
      invalidReason: 'STANDALONE_PRICE_INVALID',
      warning: null,
      selectableReason: 'STANDALONE_PRICE_INVALID',
    };
  }

  // Determine add-on path status.
  // addonConfigured = add-on enabled AND price valid AND threshold valid (0 ok).
  const addonPriceOk = addonEnabled && addonPriceStatus === 'valid' && addonPriceCents !== null;
  const thresholdOk = addonEnabled && thresholdStatus === 'valid' && addonQualifyingThresholdCents !== null;

  // A. Add-on fully configured and threshold met -> add-on.
  if (addonPriceOk && thresholdOk) {
    const threshold = addonQualifyingThresholdCents as number;
    if (qualifyingSubtotal >= threshold) {
      return {
        addonQualified: true,
        resolvedContext: 'addon',
        resolvedPrice: addonPriceCents as number,
        remainingAmountCents: 0,
        invalidReason: null,
        warning: null,
        selectableReason: 'OK',
      };
    }
    const remaining = max0(threshold - qualifyingSubtotal);
    if (standaloneValid) {
      return {
        addonQualified: false,
        resolvedContext: 'standalone',
        resolvedPrice: standalonePriceCents as number,
        remainingAmountCents: remaining,
        invalidReason: null,
        warning: null,
        selectableReason: 'OK',
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
      selectableReason: 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED',
    };
  }

  // Add-on enabled but configuration incomplete or invalid.
  if (addonEnabled) {
    const thresholdMissing = thresholdStatus === 'missing';
    const thresholdInvalid = thresholdStatus === 'invalid';
    const priceMissing = addonPriceStatus === 'missing';
    const priceInvalid = addonPriceStatus === 'invalid';

    const warnCode: ConfigurationWarningCode | null = thresholdMissing
      ? 'ADDON_THRESHOLD_MISSING'
      : thresholdInvalid
        ? 'ADDON_THRESHOLD_INVALID'
        : priceMissing
          ? 'ADDON_PRICE_MISSING'
          : priceInvalid
            ? 'ADDON_PRICE_INVALID'
            : null;

    const fatalCode: InvalidConfigCode | null = thresholdMissing
      ? 'ADDON_THRESHOLD_MISSING_NO_STANDALONE'
      : thresholdInvalid
        ? 'ADDON_THRESHOLD_INVALID_NO_STANDALONE'
        : priceMissing
          ? 'ADDON_PRICE_MISSING_NO_STANDALONE'
          : priceInvalid
            ? 'ADDON_PRICE_INVALID_NO_STANDALONE'
            : null;

    if (standaloneValid) {
      return {
        addonQualified: false,
        resolvedContext: 'standalone',
        resolvedPrice: standalonePriceCents as number,
        remainingAmountCents: null,
        invalidReason: null,
        warning: warnCode,
        selectableReason: 'OK',
      };
    }
    // No standalone path -> fatal.
    return {
      addonQualified: false,
      resolvedContext: null,
      resolvedPrice: null,
      remainingAmountCents: null,
      invalidReason: fatalCode ?? 'NO_PURCHASE_PATH',
      warning: null,
      selectableReason: (fatalCode ?? 'NO_PURCHASE_PATH') as SelectableCode,
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
      selectableReason: 'OK',
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
    selectableReason: 'NO_PURCHASE_PATH',
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
  for (let i = 0; i < input.lines.length; i++) {
    out.push(resolveLine(i, input.lines[i], input));
  }
  return { lines: out };
}

function resolveLine(index: number, line: ResolverInputLine, input: ResolverInput): ResolverOutputLine {
  // Candidate quantity validation: positive safe integer required (Rule 3).
  if (!isPositiveSafeInt(line.qty)) {
    return invalidLine(line.resolverKey, 'INVALID_QUANTITY', 'INVALID_QUANTITY', 'NOT_AVAILABLE');
  }

  if (line.itemType === 'inflatable') {
    return resolveInflatableLine(line, input);
  }

  if (line.itemType === 'event_essential_product') {
    return resolveProductLine(index, line, input);
  }

  if (line.itemType === 'event_essential_bundle') {
    return resolveBundleLine(index, line, input);
  }

  return invalidLine(line.resolverKey, 'UNKNOWN_ITEM_TYPE', 'UNKNOWN_ITEM_TYPE', 'NOT_AVAILABLE');
}

// ---------------------------------------------------------------------------
// Inflatable lines: validated, but never candidates for pricing/prereq.
// ---------------------------------------------------------------------------

function resolveInflatableLine(line: ResolverInputLine, input: ResolverInput): ResolverOutputLine {
  const v = validateInflatable(line, input);
  if (v.valid) {
    return {
      resolverKey: line.resolverKey,
      selectable: true,
      selectableReason: 'OK',
      prerequisiteMet: true,
      prerequisiteFailureReason: 'NOT_APPLICABLE',
      addonQualified: false,
      resolvedPricingContext: null,
      resolvedUnitPriceCents: line.selectedUnitPriceCents ?? null,
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
  // Map inflatable validity code to a SelectableCode / InvalidConfigCode.
  const reasonMap: Record<Exclude<InflatableValidityCode, 'VALID'>, { selectableReason: SelectableCode; invalidReason: InvalidConfigCode }> = {
    INVALID_QUANTITY: { selectableReason: 'INVALID_QUANTITY', invalidReason: 'INVALID_QUANTITY' },
    INFLATABLE_UNIT_MISSING: { selectableReason: 'INFLATABLE_UNIT_MISSING', invalidReason: 'INFLATABLE_UNIT_MISSING' },
    INFLATABLE_UNIT_UNKNOWN: { selectableReason: 'INFLATABLE_UNIT_UNKNOWN', invalidReason: 'INFLATABLE_UNIT_UNKNOWN' },
    INFLATABLE_UNIT_INACTIVE: { selectableReason: 'INFLATABLE_UNIT_INACTIVE', invalidReason: 'INFLATABLE_UNIT_INACTIVE' },
    INFLATABLE_PRICE_INVALID: { selectableReason: 'INFLATABLE_PRICE_INVALID', invalidReason: 'INFLATABLE_PRICE_INVALID' },
    INFLATABLE_MODE_MISSING: { selectableReason: 'INFLATABLE_MODE_MISSING', invalidReason: 'INFLATABLE_MODE_MISSING' },
  };
  const mapped = reasonMap[v.code as Exclude<InflatableValidityCode, 'VALID'>];
  return {
    resolverKey: line.resolverKey,
    selectable: false,
    selectableReason: mapped.selectableReason,
    prerequisiteMet: true,
    prerequisiteFailureReason: 'NOT_APPLICABLE',
    addonQualified: false,
    resolvedPricingContext: null,
    resolvedUnitPriceCents: null,
    standalonePriceCents: null,
    addonPriceCents: null,
    qualifyingSubtotalCents: null,
    qualifyingThresholdCents: null,
    remainingAmountCents: null,
    invalidReason: mapped.invalidReason,
    configurationWarning: null,
    requiresCustomerChoice: false,
    customerMessageCode: 'NOT_AVAILABLE',
  };
}

// ---------------------------------------------------------------------------
// Product lines.
// ---------------------------------------------------------------------------

function resolveProductLine(index: number, line: ResolverInputLine, input: ResolverInput): ResolverOutputLine {
  const productId = line.productId;
  if (!productId) {
    return invalidLine(line.resolverKey, 'PRODUCT_CONFIG_MISSING', 'PRODUCT_CONFIG_MISSING', 'NOT_AVAILABLE');
  }
  const cfg = input.productConfigs[productId];
  if (!cfg) {
    return invalidLine(line.resolverKey, 'PRODUCT_CONFIG_MISSING', 'PRODUCT_CONFIG_MISSING', 'NOT_AVAILABLE');
  }
  if (cfg.id !== productId) {
    return invalidLine(line.resolverKey, 'PRODUCT_CONFIG_ID_MISMATCH', 'PRODUCT_CONFIG_ID_MISMATCH', 'NOT_AVAILABLE');
  }
  // Distinguish category-missing from category-id-mismatch.
  if (!input.categories[cfg.categoryId]) {
    return invalidLine(line.resolverKey, 'CATEGORY_MISSING', 'CATEGORY_MISSING', 'NOT_AVAILABLE');
  }
  if (input.categories[cfg.categoryId].id !== cfg.categoryId) {
    return invalidLine(line.resolverKey, 'CATEGORY_ID_MISMATCH', 'CATEGORY_ID_MISMATCH', 'NOT_AVAILABLE');
  }

  const sub = productQualifyingSubtotal(index, cfg, input);
  // Overflow sentinel -> treat as 0 contribution but mark invalid via NO_PURCHASE_PATH? No:
  // an overflowed subtotal means we cannot safely compute. Treat as 0 (conservative) but
  // the resolver still proceeds; the candidate simply cannot prove qualification.
  const qualifyingSubtotal = sub === null ? 0 : sub;

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
    : pricePath.warning === 'ADDON_THRESHOLD_MISSING' ||
        pricePath.warning === 'ADDON_PRICE_MISSING' ||
        pricePath.warning === 'ADDON_THRESHOLD_INVALID' ||
        pricePath.warning === 'ADDON_PRICE_INVALID'
      ? 'STANDALONE_ONLY_ADDON_UNCONFIGURED'
      : pricePath.resolvedContext === 'standalone' &&
          pricePath.remainingAmountCents !== null &&
          pricePath.remainingAmountCents > 0
        ? 'ADD_REMAINING_TO_QUALIFY'
        : 'NONE';

  return {
    resolverKey: line.resolverKey,
    selectable: !invalid,
    selectableReason: pricePath.selectableReason,
    prerequisiteMet: true,
    prerequisiteFailureReason: 'NOT_APPLICABLE',
    addonQualified: pricePath.addonQualified,
    resolvedPricingContext: pricePath.resolvedContext,
    resolvedUnitPriceCents: pricePath.resolvedPrice,
    standalonePriceCents: cfg.standalonePriceCents,
    addonPriceCents: cfg.addonPriceCents,
    qualifyingSubtotalCents: qualifyingSubtotal,
    qualifyingThresholdCents:
      classifyNumeric(cfg.addonQualifyingThresholdCents) === 'valid'
        ? cfg.addonQualifyingThresholdCents
        : null,
    remainingAmountCents: pricePath.remainingAmountCents,
    invalidReason: pricePath.invalidReason,
    configurationWarning: pricePath.warning,
    requiresCustomerChoice: false,
    customerMessageCode: message,
  };
}

// ---------------------------------------------------------------------------
// Bundle lines.
// ---------------------------------------------------------------------------

function resolveBundleLine(index: number, line: ResolverInputLine, input: ResolverInput): ResolverOutputLine {
  const bundleId = line.bundleId;
  if (!bundleId) {
    return invalidLine(line.resolverKey, 'BUNDLE_CONFIG_MISSING', 'BUNDLE_CONFIG_MISSING', 'NOT_AVAILABLE');
  }
  const cfg = input.bundleConfigs[bundleId];
  if (!cfg) {
    return invalidLine(line.resolverKey, 'BUNDLE_CONFIG_MISSING', 'BUNDLE_CONFIG_MISSING', 'NOT_AVAILABLE');
  }
  if (cfg.id !== bundleId) {
    return invalidLine(line.resolverKey, 'BUNDLE_CONFIG_ID_MISMATCH', 'BUNDLE_CONFIG_ID_MISMATCH', 'NOT_AVAILABLE');
  }

  const requiresCustomerChoice = bundleRequiresCustomerChoice(cfg);

  // Prerequisite first — failure blocks selectability regardless of pricing.
  const prereq = evaluatePrerequisite(index, cfg, input);
  if (!prereq.met) {
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
      configurationWarning: prereq.warning,
      requiresCustomerChoice,
      customerMessageCode: 'PACKAGE_REQUIRES_INFLATABLE',
    };
  }

  const sub = packageQualifyingSubtotal(index, cfg, input);
  const qualifyingSubtotal = sub === null ? 0 : sub;

  const pricePath = resolvePricePath({
    standaloneEnabled: cfg.standaloneEnabled,
    standalonePriceCents: cfg.standalonePriceCents,
    addonEnabled: cfg.addonEnabled,
    addonPriceCents: cfg.addonPriceCents,
    addonQualifyingThresholdCents: cfg.addonQualifyingThresholdCents,
    qualifyingSubtotal,
  });

  const invalid = pricePath.invalidReason !== null;
  let message: MessageCode = 'NONE';
  if (invalid) {
    message = 'NOT_AVAILABLE';
  } else if (requiresCustomerChoice) {
    message = 'CUSTOMER_CHOICE_REQUIRED';
  } else if (
    pricePath.warning === 'ADDON_THRESHOLD_MISSING' ||
    pricePath.warning === 'ADDON_PRICE_MISSING' ||
    pricePath.warning === 'ADDON_THRESHOLD_INVALID' ||
    pricePath.warning === 'ADDON_PRICE_INVALID'
  ) {
    message = 'STANDALONE_ONLY_ADDON_UNCONFIGURED';
  } else if (
    pricePath.resolvedContext === 'standalone' &&
    pricePath.remainingAmountCents !== null &&
    pricePath.remainingAmountCents > 0
  ) {
    message = 'ADD_REMAINING_TO_QUALIFY';
  }

  return {
    resolverKey: line.resolverKey,
    selectable: !invalid,
    selectableReason: pricePath.selectableReason,
    prerequisiteMet: true,
    prerequisiteFailureReason: null,
    addonQualified: pricePath.addonQualified,
    resolvedPricingContext: pricePath.resolvedContext,
    resolvedUnitPriceCents: pricePath.resolvedPrice,
    standalonePriceCents: cfg.standalonePriceCents,
    addonPriceCents: cfg.addonPriceCents,
    qualifyingSubtotalCents: qualifyingSubtotal,
    qualifyingThresholdCents:
      classifyNumeric(cfg.addonQualifyingThresholdCents) === 'valid'
        ? cfg.addonQualifyingThresholdCents
        : null,
    remainingAmountCents: pricePath.remainingAmountCents,
    invalidReason: pricePath.invalidReason,
    configurationWarning: pricePath.warning,
    requiresCustomerChoice,
    customerMessageCode: message,
  };
}
