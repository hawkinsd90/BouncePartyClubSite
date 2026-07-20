// Stage E3 — Event Essentials cart repricing hook.
//
// Loads customer pricing configuration once per Quote mount, builds E1 resolver
// configuration maps, computes the repricing result for the CURRENT cart
// synchronously during render via useMemo (so issues and blocking state are
// never stale by one render), and applies the repriced cart through a
// compare-and-apply guard in a write-only effect.
//
// Derived checkout state:
//   validationPending  — EE config loading / not ready / repriced cart pending apply
//   validationFailed   — EE config failed to load
//   canContinue        — false while pending/failed OR blocking issues exist
//
// Inflatable-only carts are never blocked by Event Essentials state.

import { useState, useEffect, useMemo, useRef } from 'react';
import type { UnifiedCartItem } from '../types';
import {
  fetchInventoryProducts,
  fetchProductPricing,
  fetchProductCategories,
  fetchProductBundlesWithAllComponents,
} from '../lib/queries/products';
import { getInflatableUnitResolverConfigs } from '../lib/queries/units';
import {
  buildProductConfigMap,
  buildBundleConfigMap,
  buildCategoryMap,
  buildUnitMap,
} from '../lib/eventEssentialsCatalogResolver';
import {
  repriceEventEssentialsCart,
  hasBlockingIssues,
  deriveEventEssentialsValidationState,
  productLineKey,
  bundleLineKey,
  type EventEssentialsCartIssue,
  type RepriceEventEssentialsCartResult,
} from '../lib/eventEssentialsCartRepricing';
import {
  isEventEssentialProductCartItem,
  isEventEssentialBundleCartItem,
} from '../lib/unifiedCart';

export interface UseEventEssentialsCartRepricingResult {
  issues: EventEssentialsCartIssue[];
  hasBlockingIssues: boolean;
  configLoading: boolean;
  configError: boolean;
  configReady: boolean;
  validationPending: boolean;
  validationFailed: boolean;
  repricingWritePending: boolean;
  canContinue: boolean;
}

export type ApplyRepricedCart = (
  expectedCart: UnifiedCartItem[],
  repricedCart: UnifiedCartItem[],
) => boolean;

interface RepricingConfigMaps {
  productConfigs: ReturnType<typeof buildProductConfigMap>;
  bundleConfigs: ReturnType<typeof buildBundleConfigMap>;
  categories: ReturnType<typeof buildCategoryMap>;
  units: ReturnType<typeof buildUnitMap>;
}

function hasEventEssentialsInCart(cart: UnifiedCartItem[]): boolean {
  return cart.some(
    (item) =>
      isEventEssentialProductCartItem(item) ||
      isEventEssentialBundleCartItem(item),
  );
}

// Pure helper: per-line configuration-failure issues for the current cart.
function buildConfigFailureIssues(cart: UnifiedCartItem[]): EventEssentialsCartIssue[] {
  return cart
    .map((item, index): EventEssentialsCartIssue | null => {
      if (isEventEssentialProductCartItem(item)) {
        return {
          resolverKey: productLineKey(index, item.product_id),
          cartIndex: index,
          itemType: 'event_essential_product',
          itemId: item.product_id,
          message: 'Unable to verify this item. Please try again or remove it.',
          blocking: true,
        };
      }
      if (isEventEssentialBundleCartItem(item)) {
        return {
          resolverKey: bundleLineKey(index, item.bundle_id),
          cartIndex: index,
          itemType: 'event_essential_bundle',
          itemId: item.bundle_id,
          message: 'Unable to verify this package. Please try again or remove it.',
          blocking: true,
        };
      }
      return null;
    })
    .filter((i): i is EventEssentialsCartIssue => i !== null);
}

export function useEventEssentialsCartRepricing(
  cart: UnifiedCartItem[],
  applyRepricedCart: ApplyRepricedCart,
): UseEventEssentialsCartRepricingResult {
  const [configMaps, setConfigMaps] = useState<RepricingConfigMaps | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState(false);

  const applyRef = useRef(applyRepricedCart);
  applyRef.current = applyRepricedCart;

  const cartHasEE = hasEventEssentialsInCart(cart);

  // Load configuration once per Quote mount. Guards:
  //   - no EE items -> never load
  //   - config maps already exist -> reuse (no reload)
  //   - currently loading -> do not start a second load
  //   - config absent after an error -> a deliberate retry may reload
  const configMapsRef = useRef<RepricingConfigMaps | null>(null);
  configMapsRef.current = configMaps;
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!cartHasEE) return;
    if (configMapsRef.current) return;
    if (loadingRef.current) return;

    let cancelled = false;
    loadingRef.current = true;

    async function loadConfig() {
      setConfigLoading(true);
      setConfigError(false);
      try {
        const [productsResult, pricingResult, categoriesResult, bundlesResult, unitsResult] =
          await Promise.all([
            fetchInventoryProducts(),
            fetchProductPricing(),
            fetchProductCategories(),
            fetchProductBundlesWithAllComponents(),
            getInflatableUnitResolverConfigs(),
          ]);

        if (cancelled) return;

        if (
          productsResult.error ||
          pricingResult.error ||
          categoriesResult.error ||
          bundlesResult.error ||
          unitsResult.error
        ) {
          setConfigError(true);
          setConfigLoading(false);
          loadingRef.current = false;
          return;
        }

        const productConfigs = buildProductConfigMap(
          productsResult.data ?? [],
          pricingResult.data ?? [],
        );
        const bundleConfigs = buildBundleConfigMap(bundlesResult.data ?? []);
        const categories = buildCategoryMap(categoriesResult.data ?? []);
        const units = buildUnitMap(unitsResult.data ?? []);

        setConfigMaps({ productConfigs, bundleConfigs, categories, units });
        setConfigLoading(false);
        loadingRef.current = false;
      } catch {
        if (!cancelled) {
          setConfigError(true);
          setConfigLoading(false);
          loadingRef.current = false;
        }
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, [cartHasEE]);

  const stableConfigMaps = useMemo(() => {
    if (!configMaps) return null;
    return configMaps;
  }, [configMaps]);

  const configReady = !configLoading && !configError && stableConfigMaps !== null;

  // Compute the repricing result for the CURRENT cart synchronously during
  // render. Issues and blocking state are derived from this result, so there
  // is never a one-render window where a newer cart shows stale issues.
  const currentResult = useMemo<RepriceEventEssentialsCartResult | null>(() => {
    if (!cartHasEE || !configReady || !stableConfigMaps) return null;
    return repriceEventEssentialsCart({
      cart,
      ...stableConfigMaps,
    });
  }, [cart, cartHasEE, configReady, stableConfigMaps]);

  // Derive issues directly from the current result (or config failure).
  // No useState, no later effect. Config failure issues are also derived
  // synchronously for the current cart.
  const issues: EventEssentialsCartIssue[] = useMemo(() => {
    if (!cartHasEE) return [];
    if (configError) return buildConfigFailureIssues(cart);
    if (currentResult) return currentResult.issues;
    return [];
  }, [cartHasEE, configError, currentResult, cart]);

  const blocking = hasBlockingIssues(issues);

  const derived = deriveEventEssentialsValidationState({
    cartHasEE,
    configLoading,
    configError,
    configReady,
    currentResult,
    hasBlockingIssues: blocking,
  });

  // Write-only effect: apply the already-computed repriced cart through the
  // compare-and-apply guard. Does not recompute issues or set them.
  useEffect(() => {
    if (!currentResult) return;
    if (!currentResult.changed) return;
    if (currentResult.cart === cart) return;
    applyRef.current(cart, currentResult.cart);
  }, [currentResult, cart]);

  return {
    issues,
    hasBlockingIssues: blocking,
    configLoading,
    configError,
    configReady,
    validationPending: derived.validationPending,
    validationFailed: derived.validationFailed,
    repricingWritePending: derived.repricingWritePending,
    canContinue: derived.canContinue,
  };
}
