// Pure Generator-specific staged item transitions for the Order Detail modal:
// the newest-first ordering and reduction used when the admin DECREASES the
// Generator quantity, and the application of a resolved Event Essentials
// Generator candidate when the admin INCREASES it.
//
// Moved verbatim from OrderDetailModal.handleGeneratorQtyChange. The Generator
// state machine (readiness check, resolution id, context revision, stale
// guards, decision and resolver calls, fail-closed handling, legacy fallback,
// confirmations, waivers) stays in OrderDetailModal.
//
// Deliberately preserved quirks:
// - The ordering runs against the handler-time `stagedItems` snapshot, while the
//   reduction runs against the state updater's `previous`.
// - The reduction budget is a mutable value OWNED BY THE CALLER: the helper takes
//   the remaining budget and returns what is left. The caller keeps a mutable
//   variable outside the state updater, so a repeated updater call sees the
//   already-consumed budget (and returns the rows unchanged) exactly as before.
// - Rows without an id/client_id are sorted but can never receive a reduction.
//   Duplicate keys consume the budget once per occurrence and reduce every row
//   that shares the key.
// - The Generator EE merge sets is_updated to `!item.is_new` (a new row ends up
//   with false, even if it was true), unlike the ordinary Event Essentials add.
// - The EE match compares against resolvedPricingContext WITHOUT the 'standalone'
//   fallback that is applied to the existing row's context.
//
// Type-only import from stagedItemModel: no runtime imports, so it can be loaded
// from Node-based tests.

import type { StagedItem } from './stagedItemModel';

// The Generator product fields used when applying a resolved candidate.
export interface GeneratorCandidateProduct {
  product_id: string;
  product_name: string;
}

// Newest-first ordering of the direct Generator rows.
// `directItems` must be the rows filtered from `stagedItems` (same references).
export function sortDirectGeneratorItemsNewestFirst(
  directItems: StagedItem[],
  stagedItems: StagedItem[],
): StagedItem[] {
  const directByNewest = [...directItems].sort((a, b) => {
    const aNew = a.is_new ? 1 : 0;
    const bNew = b.is_new ? 1 : 0;
    if (aNew !== bNew) return bNew - aNew;
    if (aNew && bNew) {
      // Both unsaved: higher stagedItems index is newer.
      // directItems is filtered from stagedItems so preserves relative order.
      const aIdx = stagedItems.indexOf(a);
      const bIdx = stagedItems.indexOf(b);
      return bIdx - aIdx;
    }
    // Both persisted: created_at descending, then id descending.
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return (b.id || '').localeCompare(a.id || '');
  });
  return directByNewest;
}

// Applies the Generator decrease to the staged rows. `remainingBudget` is the
// caller's mutable reduction budget; the leftover is returned so the caller can
// store it back. The final map/filter always runs, even when the budget is 0.
export function reduceDirectGeneratorItems(
  previous: StagedItem[],
  directByNewest: StagedItem[],
  remainingBudget: number,
): { next: StagedItem[]; remainingBudget: number } {
  let remainingDirectReduction = remainingBudget;

  const orderedKeys = directByNewest.map((item) => item.id || item.client_id).filter((k): k is string => !!k);
  const keySet = new Set(orderedKeys);
  const reductionByKey = new Map<string, number>();
  for (const key of orderedKeys) {
    if (remainingDirectReduction <= 0) break;
    const item = previous.find((i) => (i.id || i.client_id) === key && keySet.has(key));
    if (!item) continue;
    const reduction = Math.min(item.qty, remainingDirectReduction);
    remainingDirectReduction -= reduction;
    reductionByKey.set(key, reduction);
  }

  const next = previous.map((item) => {
    const key = item.id || item.client_id;
    if (!key || !reductionByKey.has(key)) return item;
    const reduction = reductionByKey.get(key)!;
    const nextQty = item.qty - reduction;
    if (nextQty > 0) {
      return { ...item, qty: nextQty, is_updated: true };
    }
    // Persisted row → mark deleted; new unsaved row → remove from staged state.
    if (item.is_new) return null;
    return { ...item, qty: 0, is_deleted: true, is_updated: true };
  }).filter((item): item is StagedItem => item !== null);

  return { next, remainingBudget: remainingDirectReduction };
}

// Applies a resolved Event Essentials Generator candidate to the staged rows.
// makeClientId is called only on the append path.
export function applyGeneratorEeCandidate(
  previous: StagedItem[],
  product: GeneratorCandidateProduct,
  resolvedUnitPriceCents: number,
  resolvedPricingContext: string,
  additionalQty: number,
  makeClientId: () => string,
): StagedItem[] {
  // CASE A: same product_id, same resolved price, same resolved context → increase existing row.
  const exactMatch = previous.find(
    (item) =>
      !item.is_deleted &&
      item.product_id === product.product_id &&
      !item.bundle_id &&
      item.unit_price_cents === resolvedUnitPriceCents &&
      (item.pricing_context || 'standalone') === resolvedPricingContext,
  );

  if (exactMatch) {
    return previous.map((item) =>
      item === exactMatch
        ? { ...item, qty: item.qty + additionalQty, is_updated: !item.is_new }
        : item,
    );
  }

  // CASE B: same product_id but different price/context → new staged row (historical frozen).
  return [...previous, {
    client_id: makeClientId(),
    product_id: product.product_id,
    product_name: product.product_name,
    item_name: product.product_name,
    qty: additionalQty,
    unit_price_cents: resolvedUnitPriceCents,
    pricing_context: resolvedPricingContext,
    is_new: true,
    is_deleted: false,
  }];
}
