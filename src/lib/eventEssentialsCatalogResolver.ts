// Stage E2 — Customer Event Essentials catalog → E1 resolver adapter.
//
// Single boundary converting customer-facing query/cart data into the
// resolver-only types from eventEssentialsPricingTypes.ts, and providing a
// pure candidate-evaluation helper so the React page never constructs
// resolver config maps or recreates qualification rules.
//
// Imports both application types and resolver-only types. The resolver itself
// (eventEssentialsPricing.ts) imports none of this and remains unchanged.

import { resolveEventEssentialsPricing } from './eventEssentialsPricing';
import type {
  ResolverBundleConfig,
  ResolverCategory,
  ResolverInput,
  ResolverInputLine,
  ResolverOutputLine,
  ResolverProductConfig,
  ResolverUnitConfig,
} from './eventEssentialsPricingTypes';
import type {
  InflatableCartItem,
  InventoryProduct,
  ProductBundleWithConfiguration,
  ProductCategory,
  ProductPricing,
  UnifiedCartItem,
} from '../types';
import {
  isInflatableCartItem,
  isEventEssentialProductCartItem,
  isEventEssentialBundleCartItem,
} from './unifiedCart';

// ---------------------------------------------------------------------------
// Configuration map builders (pure; from DB query rows).
// ---------------------------------------------------------------------------

export function buildProductConfigMap(
  products: InventoryProduct[],
  pricing: ProductPricing[],
): Record<string, ResolverProductConfig> {
  const pricingByProductId = new Map<string, ProductPricing>();
  for (const p of pricing) pricingByProductId.set(p.product_id, p);

  const map: Record<string, ResolverProductConfig> = {};
  for (const product of products) {
    const p = pricingByProductId.get(product.id);
    if (!p) continue;
    if (typeof product.category_id !== 'string' || !product.category_id) continue;
    map[product.id] = {
      id: product.id,
      categoryId: product.category_id,
      standalonePriceCents: p.standalone_price_cents,
      addonPriceCents: p.addon_price_cents,
      standaloneEnabled: p.standalone_enabled,
      addonEnabled: p.addon_enabled,
      addonQualifyingThresholdCents: p.addon_qualifying_threshold_cents,
    };
  }
  return map;
}

export function buildBundleConfigMap(
  bundles: ProductBundleWithConfiguration[],
): Record<string, ResolverBundleConfig> {
  const map: Record<string, ResolverBundleConfig> = {};
  for (const bundle of bundles) {
    map[bundle.id] = {
      id: bundle.id,
      standalonePriceCents: bundle.standalone_price_cents,
      addonPriceCents: bundle.addon_price_cents,
      standaloneEnabled: bundle.standalone_enabled,
      addonEnabled: bundle.addon_enabled,
      addonQualifyingThresholdCents: bundle.addon_qualifying_threshold_cents,
      inflatableEligibilityMode:
        (bundle.inflatable_eligibility_mode === 'none' ||
          bundle.inflatable_eligibility_mode === 'any' ||
          bundle.inflatable_eligibility_mode === 'selected')
          ? bundle.inflatable_eligibility_mode
          : 'none',
      excludedCategoryIds: (bundle.product_bundle_excluded_categories ?? []).map(
        (c) => c.category_id,
      ),
      eligibleUnitIds: (bundle.package_inflatable_eligibility ?? []).map((e) => e.unit_id),
      inflatableComponents: (bundle.package_inflatable_components ?? []).map((c) => ({
        selectionMode: c.selection_mode,
      })),
    };
  }
  return map;
}

export function buildCategoryMap(
  categories: ProductCategory[],
): Record<string, ResolverCategory> {
  const map: Record<string, ResolverCategory> = {};
  for (const c of categories) map[c.id] = { id: c.id };
  return map;
}

export function buildUnitMap(
  units: { id: string; active: boolean }[],
): Record<string, ResolverUnitConfig> {
  const map: Record<string, ResolverUnitConfig> = {};
  for (const u of units) map[u.id] = { id: u.id, active: u.active };
  return map;
}

// ---------------------------------------------------------------------------
// Cart-line normalization (pure; from current unified cart).
// ---------------------------------------------------------------------------

export function normalizeCartLines(
  cart: UnifiedCartItem[],
  productConfigs: Record<string, ResolverProductConfig>,
  bundleConfigs: Record<string, ResolverBundleConfig>,
): ResolverInputLine[] {
  const lines: ResolverInputLine[] = [];

  for (const item of cart) {
    if (isInflatableCartItem(item)) {
      if (!item.unit_id) continue;
      const selectedUnitPriceCents =
        item.wet_or_dry === 'water'
          ? (item.price_water_cents ?? item.unit_price_cents)
          : (item.price_dry_cents ?? item.unit_price_cents);
      lines.push({
        resolverKey: `cart-inflatable-${item.unit_id}`,
        itemType: 'inflatable',
        qty: item.qty,
        unitId: item.unit_id,
        selectedUnitPriceCents,
        wetOrDry: item.wet_or_dry,
      });
      continue;
    }

    if (isEventEssentialProductCartItem(item)) {
      const cfg = productConfigs[item.product_id];
      if (!cfg) continue;
      lines.push({
        resolverKey: `cart-product-${item.product_id}`,
        itemType: 'event_essential_product',
        qty: item.qty,
        productId: item.product_id,
      });
      continue;
    }

    if (isEventEssentialBundleCartItem(item)) {
      const cfg = bundleConfigs[item.bundle_id];
      if (!cfg) continue;
      lines.push({
        resolverKey: `cart-bundle-${item.bundle_id}`,
        itemType: 'event_essential_bundle',
        qty: item.qty,
        bundleId: item.bundle_id,
      });
      continue;
    }
    // Legacy/unrecognized lines are excluded from contribution (skip).
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Candidate evaluation (pure; one resolver call per catalog item).
// ---------------------------------------------------------------------------

let candidateKeyCounter = 0;

function nextCandidateKey(prefix: string): string {
  candidateKeyCounter += 1;
  return `${prefix}-candidate-${candidateKeyCounter}`;
}

export interface CandidateEvalContext {
  productConfigs: Record<string, ResolverProductConfig>;
  bundleConfigs: Record<string, ResolverBundleConfig>;
  categories: Record<string, ResolverCategory>;
  units: Record<string, ResolverUnitConfig>;
  cartLines: ResolverInputLine[];
}

export interface ProductCandidateRequest {
  productId: string;
  qty: number;
}

export interface BundleCandidateRequest {
  bundleId: string;
  qty: number;
}

export function evaluateProductCandidate(
  ctx: CandidateEvalContext,
  req: ProductCandidateRequest,
): ResolverOutputLine | null {
  const cfg = ctx.productConfigs[req.productId];
  if (!cfg) return null;
  const qty = Math.max(1, req.qty);
  const candidateKey = nextCandidateKey(`product-${req.productId}`);
  const input: ResolverInput = {
    lines: [...ctx.cartLines, { resolverKey: candidateKey, itemType: 'event_essential_product', qty, productId: req.productId }],
    productConfigs: ctx.productConfigs,
    bundleConfigs: ctx.bundleConfigs,
    categories: ctx.categories,
    units: ctx.units,
  };
  const result = resolveEventEssentialsPricing(input);
  const out = result.lines.find((l) => l.resolverKey === candidateKey);
  return out ?? null;
}

export function evaluateBundleCandidate(
  ctx: CandidateEvalContext,
  req: BundleCandidateRequest,
): ResolverOutputLine | null {
  const cfg = ctx.bundleConfigs[req.bundleId];
  if (!cfg) return null;
  const qty = Math.max(1, req.qty);
  const candidateKey = nextCandidateKey(`bundle-${req.bundleId}`);
  const input: ResolverInput = {
    lines: [...ctx.cartLines, { resolverKey: candidateKey, itemType: 'event_essential_bundle', qty, bundleId: req.bundleId }],
    productConfigs: ctx.productConfigs,
    bundleConfigs: ctx.bundleConfigs,
    categories: ctx.categories,
    units: ctx.units,
  };
  const result = resolveEventEssentialsPricing(input);
  const out = result.lines.find((l) => l.resolverKey === candidateKey);
  return out ?? null;
}

// ---------------------------------------------------------------------------
// Customer-facing view model derived purely from a candidate ResolverOutputLine.
// ---------------------------------------------------------------------------

export type CatalogPriceState =
  | 'addon'
  | 'standalone'
  | 'unavailable'
  | 'blocked_addon_only';

export interface CandidateViewModel {
  selectable: boolean;
  resolvedPriceCents: number | null;
  priceState: CatalogPriceState;
  remainingAmountCents: number | null;
  prereqMet: boolean;
  prereqBlocked: boolean;
  prereqRequiresAnyInflatable: boolean;
  prereqRequiresEligibleInflatable: boolean;
  prereqMisconfigured: boolean;
  requiresCustomerChoice: boolean;
}

export function deriveCandidateViewModel(
  out: ResolverOutputLine | null,
  isBundle: boolean,
): CandidateViewModel {
  if (!out) {
    return {
      selectable: false,
      resolvedPriceCents: null,
      priceState: 'unavailable',
      remainingAmountCents: null,
      prereqMet: true,
      prereqBlocked: false,
      prereqRequiresAnyInflatable: false,
      prereqRequiresEligibleInflatable: false,
      prereqMisconfigured: false,
      requiresCustomerChoice: false,
    };
  }

  // Blocked add-on-only: E1 returns resolvedPricingContext=null,
  // resolvedUnitPriceCents=null, invalidReason=NO_STANDALONE_AND_ADDON_NOT_QUALIFIED,
  // remainingAmountCents populated. Detect from invalidReason BEFORE resolved
  // pricing, since the resolved-price branches below are unreachable for this case.
  if (
    out.invalidReason === 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED' &&
    out.remainingAmountCents !== null
  ) {
    return {
      selectable: false,
      resolvedPriceCents: null,
      priceState: 'blocked_addon_only',
      remainingAmountCents: out.remainingAmountCents,
      prereqMet: out.prerequisiteMet,
      prereqBlocked: false,
      prereqRequiresAnyInflatable: false,
      prereqRequiresEligibleInflatable: false,
      prereqMisconfigured: false,
      requiresCustomerChoice: out.requiresCustomerChoice,
    };
  }

  let priceState: CatalogPriceState;
  if (out.resolvedPricingContext === 'addon' && out.resolvedUnitPriceCents !== null) {
    priceState = 'addon';
  } else if (out.resolvedPricingContext === 'standalone' && out.resolvedUnitPriceCents !== null) {
    priceState = 'standalone';
  } else {
    priceState = 'unavailable';
  }

  const prereqBlocked = isBundle && !out.prerequisiteMet;

  // Customer-actionable prerequisite failures vs configuration failures.
  // NO_DIRECT_INFLATABLE / NO_MATCHING_UNIT / UNIT_INACTIVE -> customer action.
  // UNKNOWN_ELIGIBLE_UNIT / NO_ELIGIBLE_UNITS_CONFIGURED -> misconfiguration.
  const prereqMisconfigured =
    isBundle &&
    !out.prerequisiteMet &&
    (out.prerequisiteFailureReason === 'UNKNOWN_ELIGIBLE_UNIT' ||
      out.prerequisiteFailureReason === 'NO_ELIGIBLE_UNITS_CONFIGURED');

  return {
    selectable: out.selectable && !prereqBlocked,
    resolvedPriceCents: out.resolvedUnitPriceCents,
    priceState,
    remainingAmountCents: out.remainingAmountCents,
    prereqMet: out.prerequisiteMet,
    prereqBlocked,
    prereqRequiresAnyInflatable:
      isBundle && !out.prerequisiteMet && out.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE',
    prereqRequiresEligibleInflatable:
      isBundle &&
      !out.prerequisiteMet &&
      !prereqMisconfigured &&
      (out.prerequisiteFailureReason === 'NO_MATCHING_UNIT' ||
        out.prerequisiteFailureReason === 'UNIT_INACTIVE'),
    prereqMisconfigured,
    requiresCustomerChoice: out.requiresCustomerChoice,
  };
}

export { isInflatableCartItem, isEventEssentialProductCartItem, isEventEssentialBundleCartItem };
export type { InflatableCartItem };
