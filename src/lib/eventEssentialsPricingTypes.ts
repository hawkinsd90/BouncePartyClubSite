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
  /** Null means "not configured". */
  standalonePriceCents: number | null;
  /** Null means "not configured". */
  addonPriceCents: number | null;
  standaloneEnabled: boolean;
  addonEnabled: boolean;
  /**
   * NULL = threshold not configured (incomplete add-on configuration).
   * 0     = explicitly configured zero-dollar threshold.
   * >0    = configured qualifying threshold.
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
  /** Same NULL/0/positive semantics as the product threshold. */
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
   * The resolver must never construct identity from pricing context and
   * must never merge input lines.
   */
  resolverKey: string;
  itemType: ResolverItemType;
  /** Integer units. Negative or non-integer values are invalid. */
  qty: number;
  /** Required when itemType === 'inflatable'. */
  unitId?: string;
  /** Required when itemType === 'event_essential_product'. */
  productId?: string;
  /** Required when itemType === 'event_essential_bundle'. */
  bundleId?: string;
  /**
   * For direct inflatable lines: the line's selected dry/water unit price
   * in cents. The contribution of a direct inflatable line is
   * `selectedUnitPriceCents * qty`. Unknown or invalid prices do not
   * contribute.
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
// Output.
// ---------------------------------------------------------------------------

export type SelectableCode =
  | 'OK'
  | 'INVALID'
  | 'NO_PURCHASE_PATH'
  | 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED'
  | 'ADDON_THRESHOLD_MISSING_NO_STANDALONE'
  | 'ADDON_PRICE_MISSING_NO_STANDALONE'
  | 'PREREQUISITE_NOT_MET'
  | 'INVALID_QUANTITY'
  | 'UNKNOWN_ITEM_TYPE'
  | 'PRODUCT_CONFIG_MISSING'
  | 'BUNDLE_CONFIG_MISSING'
  | 'CATEGORY_MISSING';

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
  | 'PRODUCT_CONFIG_MISSING'
  | 'BUNDLE_CONFIG_MISSING'
  | 'CATEGORY_MISSING'
  | 'INVALID_QUANTITY'
  | 'UNKNOWN_ITEM_TYPE';

export type ConfigurationWarningCode =
  | 'ADDON_THRESHOLD_MISSING'
  | 'ADDON_PRICE_MISSING'
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
