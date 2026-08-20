// Admin Edit Generator automatic hybrid resolution.
//
// Pure decision helpers (no supabase, no React) that compute what should
// happen when the Admin changes the standalone Generator quantity field:
//
//   increase  → resolve the additional physical requirement EE-first,
//               falling back to legacy only when no EE Generator can
//               satisfy the full additional quantity.
//   decrease  → remove the most recently added standalone representation
//               using the smallest deterministic approach that preserves
//               older historical rows/prices.
//
// Config/query failures are NOT inventory exhaustion. The decision helpers
// return a 'fail_closed' outcome rather than silently falling back to legacy.

import type { GeneratorProductConfiguration } from './generatorUnified';
import { lookupAllGeneratorProducts } from './generatorUnified';
import { resolveEventEssentialsPricing } from './eventEssentialsPricing';
import type {
  ResolverInput,
  ResolverInputLine,
  ResolverProductConfig,
  ResolverBundleConfig,
  ResolverCategory,
  ResolverUnitConfig,
  ResolverOutputLine,
} from './eventEssentialsPricingTypes';
import {
  buildEventEssentialAvailabilityRequestFromOrderItems,
  validateAvailabilityResult,
} from './eeOrderItemAvailability';
import { checkProductAvailability } from './queries/products';

export interface CurrentGeneratorRepresentation {
  /** Legacy generator_qty on the order (historical standalone). */
  legacyQty: number;
  /** Direct EE Generator product order-item quantity (historical/new). */
  directEeQty: number;
}

export type GeneratorAvailabilityOutcome =
  | { status: 'available'; product: GeneratorProductConfiguration }
  | { status: 'no_candidate' }
  | { status: 'out_of_stock' }
  | { status: 'fail_closed'; reason: string };

export interface AdminGeneratorIncreaseDecision {
  /** Additional standalone physical generators requested. */
  additionalQty: number;
  /** Where the additional qty should be persisted. */
  representation: 'ee' | 'legacy' | 'none';
  /** The EE product to use, when representation is 'ee'. */
  eeProduct?: GeneratorProductConfiguration;
  /** New legacy generator_qty to persist, when representation is 'legacy'. */
  newLegacyQty?: number;
  /** Reason when no resolution is possible. */
  reason?: string;
}

/**
 * Decide how to resolve an Admin-requested increase in standalone Generator
 * quantity. The caller supplies the already-resolved availability outcome
 * for the additional qty so this helper stays pure and testable.
 *
 * Rules (mirroring the customer Quote checkbox):
 *  1. additionalQty <= 0 → nothing to do.
 *  2. EE candidate available → use EE representation for the full additional qty.
 *  3. No EE candidate (not_found / out_of_stock) → legacy for the full additional qty.
 *  4. Config/query failure → fail_closed; do NOT silently fall back to legacy.
 */
export function decideAdminGeneratorIncrease(input: {
  current: CurrentGeneratorRepresentation;
  requestedTotal: number;
  availability: GeneratorAvailabilityOutcome;
}): AdminGeneratorIncreaseDecision {
  const { current, requestedTotal, availability } = input;

  const existingStandalone = current.legacyQty + current.directEeQty;
  const additionalQty = Math.max(0, requestedTotal - existingStandalone);

  if (additionalQty <= 0) {
    return { additionalQty: 0, representation: 'none' };
  }

  if (availability.status === 'available') {
    return {
      additionalQty,
      representation: 'ee',
      eeProduct: availability.product,
    };
  }

  if (availability.status === 'no_candidate' || availability.status === 'out_of_stock') {
    return {
      additionalQty,
      representation: 'legacy',
      newLegacyQty: current.legacyQty + additionalQty,
    };
  }

  // fail_closed
  return {
    additionalQty,
    representation: 'none',
    reason: availability.reason,
  };
}

export interface AdminGeneratorDecreaseDecision {
  /** Quantity to remove. */
  removeQty: number;
  /** Which representation to decrease first (most recently added). */
  target: 'ee' | 'legacy' | 'none';
  /** New direct EE qty after decrease. */
  newDirectEeQty: number;
  /** New legacy generator_qty after decrease. */
  newLegacyQty: number;
}

/**
 * Decide how to resolve an Admin-requested decrease in standalone Generator
 * quantity. Decrease the most recently added standalone representation
 * first: direct EE before legacy, preserving older historical rows/prices.
 *
 * Package-contained Generators are NOT controlled by this input and are
 * never touched here.
 */
export function decideAdminGeneratorDecrease(input: {
  current: CurrentGeneratorRepresentation;
  requestedTotal: number;
}): AdminGeneratorDecreaseDecision {
  const { current, requestedTotal } = input;

  const existingStandalone = current.legacyQty + current.directEeQty;
  const removeQty = Math.max(0, existingStandalone - requestedTotal);

  if (removeQty <= 0) {
    return {
      removeQty: 0,
      target: 'none',
      newDirectEeQty: current.directEeQty,
      newLegacyQty: current.legacyQty,
    };
  }

  // Decrease direct EE first (most recently added), then legacy.
  const eeDecrease = Math.min(removeQty, current.directEeQty);
  const remaining = removeQty - eeDecrease;
  const legacyDecrease = Math.min(remaining, current.legacyQty);

  return {
    removeQty,
    target: eeDecrease > 0 ? 'ee' : legacyDecrease > 0 ? 'legacy' : 'none',
    newDirectEeQty: current.directEeQty - eeDecrease,
    newLegacyQty: current.legacyQty - legacyDecrease,
  };
}

/**
 * The visible "Generators" quantity the Admin sees should reflect the total
 * standalone physical Generator request: legacy + direct EE. Package-contained
 * generators are part of the package and are NOT shown in this field.
 */
export function computeVisibleGeneratorQty(current: CurrentGeneratorRepresentation): number {
  return current.legacyQty + current.directEeQty;
}

// ---------------------------------------------------------------------------
// Full async increase resolution: candidate discovery + pricing + availability
// ---------------------------------------------------------------------------

export interface GeneratorCandidateResolution {
  product: GeneratorProductConfiguration;
  resolvedUnitPriceCents: number;
  resolvedPricingContext: string;
}

export type GeneratorIncreaseResolution =
  | { status: 'ee'; candidate: GeneratorCandidateResolution }
  | { status: 'legacy' }
  | { status: 'no_candidate' }
  | { status: 'fail_closed'; reason: string };

export interface AdminGeneratorStagedItem {
  product_id?: string;
  bundle_id?: string;
  unit_id?: string;
  qty: number;
  unit_price_cents: number;
  pricing_context?: string;
  wet_or_dry?: 'dry' | 'water';
  component_snapshot?: { components: Array<{ product_id: string; quantity_per_bundle: number }> } | null;
  is_deleted?: boolean;
}

/**
 * Resolve an Admin-requested increase in standalone Generator quantity.
 *
 * 1. Discover ALL active Generator-category products (not just slug='generator').
 * 2. For each candidate, use the existing Event Essentials pricing resolver
 *    with the complete edited-order context (inflatables, direct EE, packages,
 *    saved prices) to resolve the candidate's REAL current price and context
 *    (standalone OR addon).
 * 3. For each successfully-resolved candidate, check the COMPLETE resulting
 *    inventory requirement (all non-deleted direct EE + all package contents
 *    + candidate's additional qty), aggregated, using excludeOrderId = order.id.
 * 4. Select the highest-resolved-price available candidate (product_id asc tie-break).
 * 5. Legacy fallback only when: no active Generator products exist, OR all
 *    valid candidates were loaded+priced+checked and none can satisfy.
 * 6. Technical failures (query/config/pricing/availability errors) fail closed.
 */
export async function resolveAdminGeneratorIncrease(input: {
  current: CurrentGeneratorRepresentation;
  requestedTotal: number;
  stagedItems: AdminGeneratorStagedItem[];
  eventDate: string;
  eventEndDate: string;
  orderId: string;
  productConfigs: Record<string, ResolverProductConfig>;
  bundleConfigs: Record<string, ResolverBundleConfig>;
  categories: Record<string, ResolverCategory>;
  units: Record<string, ResolverUnitConfig>;
}): Promise<GeneratorIncreaseResolution> {
  const { current, requestedTotal, stagedItems, eventDate, eventEndDate, orderId, productConfigs, bundleConfigs, categories, units } = input;

  const existingStandalone = current.legacyQty + current.directEeQty;
  const additionalQty = Math.max(0, requestedTotal - existingStandalone);

  if (additionalQty <= 0) {
    return { status: 'no_candidate' };
  }

  // 1. Discover all active Generator-category products.
  const generatorResult = await lookupAllGeneratorProducts();
  if (generatorResult.status === 'configuration_failed') {
    return { status: 'fail_closed', reason: generatorResult.error };
  }
  if (generatorResult.status === 'not_found') {
    return { status: 'legacy' };
  }

  const generatorProducts = generatorResult.products;

  // 2. Build resolver context lines from staged items (excluding deleted).
  const contextLines: ResolverInputLine[] = stagedItems
    .filter((item) => !item.is_deleted)
    .map((item) => {
      if (item.unit_id) {
        return {
          resolverKey: `staged-unit-${item.unit_id}`,
          itemType: 'inflatable' as const,
          qty: item.qty,
          unitId: item.unit_id,
          selectedUnitPriceCents: item.unit_price_cents,
          wetOrDry: item.wet_or_dry,
        };
      }
      if (item.bundle_id) {
        return {
          resolverKey: `staged-bundle-${item.bundle_id}`,
          itemType: 'event_essential_bundle' as const,
          qty: item.qty,
          bundleId: item.bundle_id,
          savedUnitPriceCents: item.unit_price_cents,
        };
      }
      return {
        resolverKey: `staged-product-${item.product_id}`,
        itemType: 'event_essential_product' as const,
        qty: item.qty,
        productId: item.product_id,
        savedUnitPriceCents: item.unit_price_cents,
      };
    });

  // 3. For each candidate: resolve pricing, then check complete availability.
  const resolvedCandidates: GeneratorCandidateResolution[] = [];

  for (const product of generatorProducts) {
    // Missing config for an active Generator product is a technical failure — fail closed.
    const cfg = productConfigs[product.product_id];
    if (!cfg) {
      return { status: 'fail_closed', reason: `Generator product "${product.product_name}" has no pricing configuration available to the resolver.` };
    }

    const candidateKey = `generator-candidate-${product.product_id}`;
    const candidateLine: ResolverInputLine = {
      resolverKey: candidateKey,
      itemType: 'event_essential_product',
      qty: additionalQty,
      productId: product.product_id,
    };

    const resolverInput: ResolverInput = {
      lines: [...contextLines, candidateLine],
      productConfigs,
      bundleConfigs,
      categories,
      units,
    };

    const result = resolveEventEssentialsPricing(resolverInput);
    const candidateResult: ResolverOutputLine | undefined = result.lines.find(
      (l) => l.resolverKey === candidateKey,
    );

    // Missing resolver result is a technical failure — fail closed.
    if (!candidateResult) {
      return { status: 'fail_closed', reason: `Pricing resolver returned no result for Generator product "${product.product_name}".` };
    }

    // Non-selectable: only the legitimate direct-product non-qualification reason may continue.
    // Everything else (including unknown future reasons) fails closed.
    if (!candidateResult.selectable) {
      if (candidateResult.invalidReason === 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED') {
        continue;
      }
      return { status: 'fail_closed', reason: `Generator product "${product.product_name}" could not be priced: ${candidateResult.invalidReason || 'unknown pricing error'}.` };
    }

    // Selectable candidate must have a valid non-negative integer price and a valid context.
    const resolvedPrice = candidateResult.resolvedUnitPriceCents;
    if (typeof resolvedPrice !== 'number' || !Number.isInteger(resolvedPrice) || resolvedPrice < 0) {
      return { status: 'fail_closed', reason: `Generator product "${product.product_name}" resolved to an invalid price.` };
    }

    const resolvedContext = candidateResult.resolvedPricingContext;
    if (resolvedContext !== 'standalone' && resolvedContext !== 'addon') {
      return { status: 'fail_closed', reason: `Generator product "${product.product_name}" resolved to an unrecognized pricing context.` };
    }

    // 4. Build the COMPLETE resulting inventory requirement and check availability.
    const resultingItems: AdminGeneratorStagedItem[] = [
      ...stagedItems.filter((item) => !item.is_deleted),
      {
        product_id: product.product_id,
        qty: additionalQty,
        unit_price_cents: resolvedPrice,
        pricing_context: resolvedContext,
      },
    ];

    const expansion = buildEventEssentialAvailabilityRequestFromOrderItems(resultingItems);
    if (expansion.status === 'invalid') {
      return { status: 'fail_closed', reason: expansion.error };
    }

    const availability = await checkProductAvailability(
      expansion.productQuantities,
      eventDate,
      eventEndDate,
      orderId,
    );

    const validation = validateAvailabilityResult(
      expansion.productQuantities.map((pq) => pq.product_id),
      availability,
    );

    if (validation.status === 'invalid') {
      return { status: 'fail_closed', reason: validation.error || 'Availability check failed.' };
    }
    if (validation.status === 'unavailable') {
      // This candidate's resulting inventory is not available — skip.
      continue;
    }

    // Available! Record as a resolved candidate.
    resolvedCandidates.push({
      product,
      resolvedUnitPriceCents: resolvedPrice,
      resolvedPricingContext: resolvedContext,
    });
  }

  // 5. Select highest-resolved-price candidate (product_id ascending tie-break).
  if (resolvedCandidates.length > 0) {
    resolvedCandidates.sort((a, b) => {
      if (b.resolvedUnitPriceCents !== a.resolvedUnitPriceCents) {
        return b.resolvedUnitPriceCents - a.resolvedUnitPriceCents;
      }
      return a.product.product_id < b.product.product_id ? -1 : 1;
    });
    return { status: 'ee', candidate: resolvedCandidates[0] };
  }

  // 6. All valid candidates were loaded, priced, and checked — none available.
  return { status: 'legacy' };
}
