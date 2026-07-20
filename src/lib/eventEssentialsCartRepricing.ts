// Stage E3 — Event Essentials cart repricing and integrity validation.
//
// Pure, deterministic, synchronous. No React, no Supabase, no localStorage,
// no side effects, no mutation. Calls E1 (resolveEventEssentialsPricing) once
// with the actual cart lines and reprices only Event Essential product and
// bundle lines. Inflatable and unknown lines are preserved with their original
// object references unchanged.
//
// Every actual cart occurrence receives a unique per-occurrence resolver key
// derived from its cart index, so legacy duplicate lines never collide inside
// a single resolver invocation. E1 remains the sole owner of qualification
// and resolved-price rules.

import { resolveEventEssentialsPricing } from './eventEssentialsPricing';
import type {
  ResolverBundleConfig,
  ResolverCategory,
  ResolverInput,
  ResolverInputLine,
  ResolverOutputLine,
  ResolverProductConfig,
  ResolverUnitConfig,
  PrerequisiteFailureCode,
} from './eventEssentialsPricingTypes';
import type {
  UnifiedCartItem,
  EventEssentialProductCartItem,
  EventEssentialBundleCartItem,
} from '../types';
import {
  isInflatableCartItem,
  isEventEssentialProductCartItem,
  isEventEssentialBundleCartItem,
} from './unifiedCart';

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

export interface RepriceEventEssentialsCartInput {
  cart: UnifiedCartItem[];
  productConfigs: Record<string, ResolverProductConfig>;
  bundleConfigs: Record<string, ResolverBundleConfig>;
  categories: Record<string, ResolverCategory>;
  units: Record<string, ResolverUnitConfig>;
}

export type EventEssentialsIssueItemType =
  | 'event_essential_product'
  | 'event_essential_bundle';

export interface EventEssentialsCartIssue {
  /** Unique per-occurrence key (cart-line-${index}-...). */
  resolverKey: string;
  /** Exact cart index of the affected line. */
  cartIndex: number;
  itemType: EventEssentialsIssueItemType;
  itemId: string;
  message: string;
  blocking: boolean;
}

export interface RepriceEventEssentialsCartResult {
  cart: UnifiedCartItem[];
  changed: boolean;
  issues: EventEssentialsCartIssue[];
}

// ---------------------------------------------------------------------------
// Unique per-occurrence resolver keys.
//
// Each actual cart occurrence receives a key derived from its cart index, so
// duplicate product/bundle/inflatable lines never collide within a single
// resolver invocation. E1 uses array position for self-exclusion, so duplicate
// keys are evaluated correctly; we only need the keys to be unique for
// unambiguous output mapping.
// ---------------------------------------------------------------------------

export function productLineKey(cartIndex: number, productId: string): string {
  return `cart-line-${cartIndex}-product-${productId}`;
}

export function bundleLineKey(cartIndex: number, bundleId: string): string {
  return `cart-line-${cartIndex}-bundle-${bundleId}`;
}

export function inflatableLineKey(cartIndex: number, unitId: string): string {
  return `cart-line-${cartIndex}-inflatable-${unitId}`;
}

// ---------------------------------------------------------------------------
// Cart → resolver input line normalization.
//
// Every cart line that the resolver can evaluate is sent to E1. Event Essential
// lines with missing config are still sent (E1 returns PRODUCT_CONFIG_MISSING /
// BUNDLE_CONFIG_MISSING), so they produce a blocking issue. Unknown legacy
// lines are excluded from the resolver input but preserved in the output cart.
// ---------------------------------------------------------------------------

function buildResolverInputLines(
  cart: UnifiedCartItem[],
): ResolverInputLine[] {
  const lines: ResolverInputLine[] = [];
  for (let i = 0; i < cart.length; i++) {
    const item = cart[i];
    if (isInflatableCartItem(item)) {
      if (!item.unit_id) continue;
      const selectedUnitPriceCents =
        item.wet_or_dry === 'water'
          ? (item.price_water_cents ?? item.unit_price_cents)
          : (item.price_dry_cents ?? item.unit_price_cents);
      lines.push({
        resolverKey: inflatableLineKey(i, item.unit_id),
        itemType: 'inflatable',
        qty: item.qty,
        unitId: item.unit_id,
        selectedUnitPriceCents,
        wetOrDry: item.wet_or_dry,
      });
    } else if (isEventEssentialProductCartItem(item)) {
      lines.push({
        resolverKey: productLineKey(i, item.product_id),
        itemType: 'event_essential_product',
        qty: item.qty,
        productId: item.product_id,
      });
    } else if (isEventEssentialBundleCartItem(item)) {
      lines.push({
        resolverKey: bundleLineKey(i, item.bundle_id),
        itemType: 'event_essential_bundle',
        qty: item.qty,
        bundleId: item.bundle_id,
      });
    }
    // Unknown legacy lines: excluded from resolver input, preserved in cart.
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Customer-facing issue messages.
//
// Maps E1 failure codes to human-readable messages. Never exposes enum names,
// resolver keys, or configuration map details.
// ---------------------------------------------------------------------------

function prerequisiteMessage(code: PrerequisiteFailureCode): string {
  switch (code) {
    case 'NO_DIRECT_INFLATABLE':
      return 'Add an inflatable to your cart to keep this package.';
    case 'NO_MATCHING_UNIT':
      return 'This package requires an eligible inflatable in your cart.';
    case 'UNIT_INACTIVE':
      return 'This package requires an eligible inflatable in your cart.';
    case 'UNKNOWN_ELIGIBLE_UNIT':
    case 'NO_ELIGIBLE_UNITS_CONFIGURED':
      return 'This package is currently unavailable. Please remove it from your cart.';
    default:
      return 'This package is currently unavailable. Please remove it from your cart.';
  }
}

function productUnavailableMessage(): string {
  return 'This item is currently unavailable. Please remove it from your cart.';
}

function bundleUnavailableMessage(): string {
  return 'This package is currently unavailable. Please remove it from your cart.';
}

// ---------------------------------------------------------------------------
// Main pure repricer.
// ---------------------------------------------------------------------------

export function repriceEventEssentialsCart(
  input: RepriceEventEssentialsCartInput,
): RepriceEventEssentialsCartResult {
  const { cart, productConfigs, bundleConfigs, categories, units } = input;

  // If the cart has no Event Essential lines, there is nothing to reprice.
  // Return the original array unchanged with no issues.
  const hasEventEssentials = cart.some(
    (item) =>
      isEventEssentialProductCartItem(item) ||
      isEventEssentialBundleCartItem(item),
  );
  if (!hasEventEssentials) {
    return { cart, changed: false, issues: [] };
  }

  const resolverInput: ResolverInput = {
    lines: buildResolverInputLines(cart),
    productConfigs,
    bundleConfigs,
    categories,
    units,
  };

  const resolverResult = resolveEventEssentialsPricing(resolverInput);
  const outputByKey = new Map<string, ResolverOutputLine>();
  for (const line of resolverResult.lines) {
    outputByKey.set(line.resolverKey, line);
  }

  let changed = false;
  const issues: EventEssentialsCartIssue[] = [];
  const nextCart: UnifiedCartItem[] = cart.slice(); // shallow copy; changed items replaced

  for (let i = 0; i < cart.length; i++) {
    const item = cart[i];

    if (isInflatableCartItem(item)) {
      // Inflatables are never repriced. Preserve the exact object reference.
      nextCart[i] = item;
      continue;
    }

    if (isEventEssentialProductCartItem(item)) {
      const key = productLineKey(i, item.product_id);
      const out = outputByKey.get(key);

      if (!out) {
        // No resolver output. Preserve the line, create a blocking issue.
        nextCart[i] = item;
        issues.push({
          resolverKey: key,
          cartIndex: i,
          itemType: 'event_essential_product',
          itemId: item.product_id,
          message: productUnavailableMessage(),
          blocking: true,
        });
        continue;
      }

      if (!out.selectable || out.resolvedUnitPriceCents === null || out.resolvedPricingContext === null) {
        // Unselectable product: preserve the line, create a blocking issue.
        nextCart[i] = item;
        issues.push({
          resolverKey: key,
          cartIndex: i,
          itemType: 'event_essential_product',
          itemId: item.product_id,
          message: productUnavailableMessage(),
          blocking: true,
        });
        continue;
      }

      const newPrice = out.resolvedUnitPriceCents;
      const newContext = out.resolvedPricingContext as 'standalone' | 'addon';

      if (item.unit_price_cents === newPrice && item.pricing_context === newContext) {
        // Already correct: preserve the exact object reference.
        nextCart[i] = item;
        continue;
      }

      // Reprice: create a new object, preserving all unrelated fields.
      const repriced: EventEssentialProductCartItem = {
        ...item,
        unit_price_cents: newPrice,
        pricing_context: newContext,
      };
      nextCart[i] = repriced;
      changed = true;
      continue;
    }

    if (isEventEssentialBundleCartItem(item)) {
      const key = bundleLineKey(i, item.bundle_id);
      const out = outputByKey.get(key);

      if (!out) {
        nextCart[i] = item;
        issues.push({
          resolverKey: key,
          cartIndex: i,
          itemType: 'event_essential_bundle',
          itemId: item.bundle_id,
          message: bundleUnavailableMessage(),
          blocking: true,
        });
        continue;
      }

      // Package prerequisite failure: block but preserve the line.
      if (!out.prerequisiteMet) {
        nextCart[i] = item;
        issues.push({
          resolverKey: key,
          cartIndex: i,
          itemType: 'event_essential_bundle',
          itemId: item.bundle_id,
          message: prerequisiteMessage(out.prerequisiteFailureReason ?? 'NO_ELIGIBLE_UNITS_CONFIGURED'),
          blocking: true,
        });
        continue;
      }

      // Unselectable for other reasons (config error, no purchase path).
      if (!out.selectable || out.resolvedUnitPriceCents === null || out.resolvedPricingContext === null) {
        nextCart[i] = item;
        issues.push({
          resolverKey: key,
          cartIndex: i,
          itemType: 'event_essential_bundle',
          itemId: item.bundle_id,
          message: bundleUnavailableMessage(),
          blocking: true,
        });
        continue;
      }

      // customer_choice alone does NOT block — preserves E2 behavior.
      // The line remains selectable; the choice workflow is a later stage.

      const newPrice = out.resolvedUnitPriceCents;
      const newContext = out.resolvedPricingContext as 'standalone' | 'addon';

      if (item.unit_price_cents === newPrice && item.pricing_context === newContext) {
        // Already correct: preserve the exact object reference.
        nextCart[i] = item;
        continue;
      }

      // Reprice: create a new object, preserving component_snapshot and all
      // other fields exactly (same reference for component_snapshot).
      const repriced: EventEssentialBundleCartItem = {
        ...item,
        unit_price_cents: newPrice,
        pricing_context: newContext,
      };
      nextCart[i] = repriced;
      changed = true;
      continue;
    }

    // Unknown legacy line: preserve unchanged.
    nextCart[i] = item;
  }

  // If nothing changed, return the original cart array (not the shallow copy)
  // so upstream identity checks can short-circuit.
  if (!changed) {
    return { cart, changed: false, issues };
  }

  return { cart: nextCart, changed: true, issues };
}

// Convenience: true when any issue is blocking.
export function hasBlockingIssues(issues: EventEssentialsCartIssue[]): boolean {
  return issues.some((i) => i.blocking);
}

// ---------------------------------------------------------------------------
// Pure checkout-state derivation.
//
// Mirrors the hook's derived state exactly so it can be unit-tested without
// React. `currentResult` is the repriceEventEssentialsCart result computed for
// the current cart during render (or null when config is not ready / cart has
// no EE items). repricingWritePending is true when a repriced cart still needs
// to be applied; validationPending covers config loading, config not ready,
// and write-pending. validationFailed is true only for EE carts with a config
// error. Inflatable-only carts are never blocked by EE state.
// ---------------------------------------------------------------------------

export interface DerivedValidationState {
  validationPending: boolean;
  validationFailed: boolean;
  repricingWritePending: boolean;
  canContinue: boolean;
}

export function deriveEventEssentialsValidationState(args: {
  cartHasEE: boolean;
  configLoading: boolean;
  configError: boolean;
  configReady: boolean;
  currentResult: RepriceEventEssentialsCartResult | null;
  hasBlockingIssues: boolean;
}): DerivedValidationState {
  const { cartHasEE, configLoading, configError, configReady, currentResult, hasBlockingIssues: blocking } = args;

  const repricingWritePending =
    cartHasEE && configReady && currentResult !== null && currentResult.changed;

  const validationPending =
    cartHasEE && (configLoading || !configReady || repricingWritePending);

  const validationFailed = cartHasEE && configError;

  const canContinue = !validationPending && !validationFailed && !blocking;

  return { validationPending, validationFailed, repricingWritePending, canContinue };
}

// ---------------------------------------------------------------------------
// Stale-write guard: compare-and-apply helper.
//
// Pure reference comparison. Returns true only when the current cart is the
// exact same array reference the repricer read. The hook uses this to decide
// whether a repriced cart is still valid to write back, preventing an older
// repricing result from overwriting a newer cart mutated after the repricer
// ran.
// ---------------------------------------------------------------------------

export function canApplyRepricedCart(
  currentCart: UnifiedCartItem[],
  expectedCart: UnifiedCartItem[],
): boolean {
  return currentCart === expectedCart;
}
