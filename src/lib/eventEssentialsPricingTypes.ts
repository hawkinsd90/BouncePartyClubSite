// Stage E1 — Event Essentials Qualifying-Subtotal, Price-Resolution,
// and Package-Prerequisite Engine.
//
// Resolver-only types. Pure domain shapes — intentionally independent of
// database row types, cart types, and React/Supabase types so the resolver
// stays a self-contained, deterministic, side-effect-free domain engine.
//
// No imports from database.types.ts, unifiedCart.ts, React, or Supabase.

export type ResolverItemType =
  | 'inflatable'
  | 'event_essential_product'
  | 'event_essential_bundle';

/** How an inflatable component inside a package is selected. */
export type InflatableSelectionMode = 'dry' | 'water' | 'customer_choice';

/** Package inflatable-prerequisite mode (mirrors product_bundles column). */
export type InflatableEligibilityMode = 'none' | 'any' | 'selected';

/** Resolved pricing context for a candidate line. */
export type ResolvedPricingContext = 'standalone' | 'addon' | null;

/**
 * Status of a configured numeric value (price or threshold).
 *
 * - 'missing'  : NULL — not configured (incomplete configuration).
 * - 'valid'    : a non-negative safe integer.
 * - 'invalid'  : present but malformed (negative, non-integer, or unsafe).
 *
 * Never collapse 'missing' and 'valid-with-zero'. A threshold of 0 is 'valid'.
 */
export type NumericConfigStatus = 'missing' | 'valid' | 'invalid';

// ---------------------------------------------------------------------------
// Configuration inputs (normalized at the query boundary by a later stage).
// ---------------------------------------------------------------------------

export interface ResolverCategory {
  id: string;
}

export interface ResolverUnitConfig {
  id: string;
  active: boolean;
}

export interface ResolverProductConfig {
  id: string;
  categoryId: string;
  /** Null means "not configured" (missing). */
  standalonePriceCents: number | null;
  /** Null means "not configured" (missing). */
  addonPriceCents: number | null;
  standaloneEnabled: boolean;
  addonEnabled: boolean;
  /**
   * NULL  = threshold not configured (missing / incomplete add-on configuration).
   * 0     = explicitly configured zero-dollar threshold (valid).
   * >0    = configured qualifying threshold (valid).
   * Negative / non-integer / unsafe = invalid.
   * Never collapse NULL and 0.
   */
  addonQualifyingThresholdCents: number | null;
}

export interface ResolverBundleInflatableComponent {
  selectionMode: InflatableSelectionMode;
}

export interface ResolverBundleConfig {
  id: string;
  standalonePriceCents: number | null;
  addonPriceCents: number | null;
  standaloneEnabled: boolean;
  addonEnabled: boolean;
  /** Same NULL/0/positive/invalid semantics as the product threshold. */
  addonQualifyingThresholdCents: number | null;
  inflatableEligibilityMode: InflatableEligibilityMode;
  /** Category ids this package excludes from its qualifying subtotal. */
  excludedCategoryIds: string[];
  /** Unit ids eligible to satisfy `selected` mode. */
  eligibleUnitIds: string[];
  /** Inflatable components — sufficient to detect customer_choice. */
  inflatableComponents: ResolverBundleInflatableComponent[];
}

// ---------------------------------------------------------------------------
// Input lines.
// ---------------------------------------------------------------------------

export interface ResolverInputLine {
  /**
   * Opaque caller-provided key. The resolver does not assume a persisted
   * cart line id exists; it only echoes this key on the matching result.
   *
   * The resolver identifies the candidate line for self-exclusion by its
   * array position, NOT by resolverKey equality, so that two distinct input
   * lines sharing the same resolverKey are both evaluated correctly.
   *
   * Consumers SHOULD use unique resolverKeys for unambiguous result mapping,
   * but the resolver does not require uniqueness and never merges lines.
   */
  resolverKey: string;
  itemType: ResolverItemType;
  /**
   * Integer units. Candidate quantities must be positive safe integers
   * (qty > 0). Zero and negative quantities are invalid. Inflatable
   * contributor quantities of 0 simply do not contribute.
   */
  qty: number;
  /** Required when itemType === 'inflatable'. */
  unitId?: string;
  /** Required when itemType === 'event_essential_product'. */
  productId?: string;
  /** Required when itemType === 'event_essential_bundle'. */
  bundleId?: string;
  /**
   * For direct inflatable lines: the line's selected dry/water unit price
   * in cents. The contribution of a valid direct inflatable line is
   * `selectedUnitPriceCents * qty`. Invalid prices do not contribute.
   */
  selectedUnitPriceCents?: number;
  /** For direct inflatable lines: which mode the customer selected. */
  wetOrDry?: 'dry' | 'water';
}

export interface ResolverInput {
  lines: ResolverInputLine[];
  productConfigs: Record<string, ResolverProductConfig>;
  bundleConfigs: Record<string, ResolverBundleConfig>;
  categories: Record<string, ResolverCategory>;
  units: Record<string, ResolverUnitConfig>;
}

// ---------------------------------------------------------------------------
// Output codes.
// ---------------------------------------------------------------------------

/**
 * Reason a line is or is not selectable. When a line is unselectable due to
 * a configuration error, selectableReason mirrors the specific invalidReason
 * rather than collapsing every failure to NO_PURCHASE_PATH.
 */
export type SelectableCode =
  | 'OK'
  | 'INVALID'
  | 'NO_PURCHASE_PATH'
  | 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED'
  | 'ADDON_THRESHOLD_MISSING_NO_STANDALONE'
  | 'ADDON_PRICE_MISSING_NO_STANDALONE'
  | 'ADDON_THRESHOLD_INVALID_NO_STANDALONE'
  | 'ADDON_PRICE_INVALID_NO_STANDALONE'
  | 'STANDALONE_PRICE_INVALID'
  | 'QUALIFYING_SUBTOTAL_OVERFLOW'
  | 'PREREQUISITE_NOT_MET'
  | 'INVALID_QUANTITY'
  | 'UNKNOWN_ITEM_TYPE'
  | 'PRODUCT_CONFIG_MISSING'
  | 'PRODUCT_CONFIG_ID_MISMATCH'
  | 'BUNDLE_CONFIG_MISSING'
  | 'BUNDLE_CONFIG_ID_MISMATCH'
  | 'CATEGORY_MISSING'
  | 'CATEGORY_ID_MISMATCH'
  | 'INFLATABLE_UNIT_MISSING'
  | 'INFLATABLE_UNIT_UNKNOWN'
  | 'INFLATABLE_UNIT_INACTIVE'
  | 'INFLATABLE_PRICE_INVALID'
  | 'INFLATABLE_MODE_MISSING';

export type PrerequisiteFailureCode =
  | 'NO_DIRECT_INFLATABLE'
  | 'NO_MATCHING_UNIT'
  | 'UNIT_INACTIVE'
  | 'NO_ELIGIBLE_UNITS_CONFIGURED'
  | 'UNKNOWN_ELIGIBLE_UNIT'
  | 'NOT_APPLICABLE';

export type InvalidConfigCode =
  | 'NO_PURCHASE_PATH'
  | 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED'
  | 'ADDON_THRESHOLD_MISSING_NO_STANDALONE'
  | 'ADDON_PRICE_MISSING_NO_STANDALONE'
  | 'ADDON_THRESHOLD_INVALID_NO_STANDALONE'
  | 'ADDON_PRICE_INVALID_NO_STANDALONE'
  | 'STANDALONE_PRICE_INVALID'
  | 'QUALIFYING_SUBTOTAL_OVERFLOW'
  | 'PRODUCT_CONFIG_MISSING'
  | 'PRODUCT_CONFIG_ID_MISMATCH'
  | 'BUNDLE_CONFIG_MISSING'
  | 'BUNDLE_CONFIG_ID_MISMATCH'
  | 'CATEGORY_MISSING'
  | 'CATEGORY_ID_MISMATCH'
  | 'INVALID_QUANTITY'
  | 'UNKNOWN_ITEM_TYPE'
  | 'INFLATABLE_UNIT_MISSING'
  | 'INFLATABLE_UNIT_UNKNOWN'
  | 'INFLATABLE_UNIT_INACTIVE'
  | 'INFLATABLE_PRICE_INVALID'
  | 'INFLATABLE_MODE_MISSING';

export type ConfigurationWarningCode =
  | 'ADDON_THRESHOLD_MISSING'
  | 'ADDON_PRICE_MISSING'
  | 'ADDON_THRESHOLD_INVALID'
  | 'ADDON_PRICE_INVALID'
  | 'STANDALONE_PRICE_INVALID'
  | 'SELECTED_MODE_NO_UNITS'
  | 'SELECTED_MODE_UNIT_INACTIVE'
  | 'SELECTED_MODE_UNKNOWN_UNIT';

export type MessageCode =
  | 'ADD_REMAINING_TO_QUALIFY'
  | 'STANDALONE_ONLY_ADDON_UNCONFIGURED'
  | 'PACKAGE_REQUIRES_INFLATABLE'
  | 'CUSTOMER_CHOICE_REQUIRED'
  | 'NOT_AVAILABLE'
  | 'NONE';

export interface ResolverOutputLine {
  /** Echoed unchanged from the input line. */
  resolverKey: string;

  // Selectability (can the customer add/retain this line at all?).
  selectable: boolean;
  selectableReason: SelectableCode;

  // Package inflatable prerequisite — separate from add-on qualification.
  prerequisiteMet: boolean;
  prerequisiteFailureReason: PrerequisiteFailureCode | null;

  // Add-on price qualification (threshold-based).
  addonQualified: boolean;

  // Resolved pricing.
  resolvedPricingContext: ResolvedPricingContext;
  resolvedUnitPriceCents: number | null;
  standalonePriceCents: number | null;
  addonPriceCents: number | null;

  // Per-candidate qualification detail (no global subtotal).
  qualifyingSubtotalCents: number | null;
  qualifyingThresholdCents: number | null;
  /** max(0, threshold - qualifyingSubtotal), or null when no threshold applies. */
  remainingAmountCents: number | null;

  // Configuration health.
  invalidReason: InvalidConfigCode | null;
  configurationWarning: ConfigurationWarningCode | null;

  // Metadata for later stages.
  requiresCustomerChoice: boolean;
  customerMessageCode: MessageCode;
}

export interface ResolverResult {
  lines: ResolverOutputLine[];
}
