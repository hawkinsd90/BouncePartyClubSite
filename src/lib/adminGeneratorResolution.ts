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
