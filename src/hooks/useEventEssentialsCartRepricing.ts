// Stage E3 — Event Essentials cart repricing hook.
//
// Loads customer pricing configuration (products, pricing, categories, bundles,
// unit configs), builds E1 resolver configuration maps, calls the pure repricer
// when relevant dependencies change, writes the cart only via a
// compare-and-apply guard that prevents stale repricing results from
// overwriting a newer cart, and exposes derived checkout state
// (validationPending / validationFailed / canContinue) plus Event Essential
// issues to the Quote UI.
//
// Inflatable-only carts are never blocked by Event Essentials configuration
// loading or failure.

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
  type EventEssentialsCartIssue,
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
  /** True while EE config is loading for a cart that contains EE items. */
  validationPending: boolean;
  /** True when EE config failed to load for a cart that contains EE items. */
  validationFailed: boolean;
  /** False while EE validation is pending/failed OR blocking issues exist. */
  canContinue: boolean;
}

/**
 * Compare-and-apply callback. The hook passes the exact source cart the
 * repricer read and the repriced result. The implementation must apply the
 * repriced cart ONLY when its internal cartRef is still the same array
 * reference as expectedCart. Returns true if applied, false if rejected
 * (a newer cart is now present and will be repriced on the next render).
 */
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

export function useEventEssentialsCartRepricing(
  cart: UnifiedCartItem[],
  applyRepricedCart: ApplyRepricedCart,
): UseEventEssentialsCartRepricingResult {
  const [configMaps, setConfigMaps] = useState<RepricingConfigMaps | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [issues, setIssues] = useState<EventEssentialsCartIssue[]>([]);

  const applyRef = useRef(applyRepricedCart);
  applyRef.current = applyRepricedCart;

  const cartHasEE = hasEventEssentialsInCart(cart);

  // Load configuration once when Event Essentials first appear in the cart.
  useEffect(() => {
    if (!cartHasEE) {
      if (issues.length > 0) {
        setIssues([]);
      }
      return;
    }

    let cancelled = false;

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
      } catch {
        if (!cancelled) {
          setConfigError(true);
          setConfigLoading(false);
        }
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
    };
    // Only trigger when EE presence changes (false -> true).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartHasEE]);

  const stableConfigMaps = useMemo(() => {
    if (!configMaps) return null;
    return configMaps;
  }, [configMaps]);

  // Reprice when config loads or the cart changes. This is the single effect
  // that calls the pure repricer and writes the cart via compare-and-apply.
  useEffect(() => {
    if (configError) {
      // Config failed. If there are EE items, create blocking issues for each.
      // If the cart is inflatable-only, no issues and no block.
      if (cartHasEE) {
        const errorIssues: EventEssentialsCartIssue[] = cart
          .map((item, index) => {
            if (isEventEssentialProductCartItem(item)) {
              return {
                resolverKey: `cart-line-${index}-product-${item.product_id}`,
                cartIndex: index,
                itemType: 'event_essential_product' as const,
                itemId: item.product_id,
                message: 'Unable to verify this item. Please try again or remove it.',
                blocking: true,
              };
            }
            if (isEventEssentialBundleCartItem(item)) {
              return {
                resolverKey: `cart-line-${index}-bundle-${item.bundle_id}`,
                cartIndex: index,
                itemType: 'event_essential_bundle' as const,
                itemId: item.bundle_id,
                message: 'Unable to verify this package. Please try again or remove it.',
                blocking: true,
              };
            }
            return null;
          })
          .filter((i): i is EventEssentialsCartIssue => i !== null);

        const issuesChanged = JSON.stringify(errorIssues) !== JSON.stringify(issues);
        if (issuesChanged) {
          setIssues(errorIssues);
        }
      } else if (issues.length > 0) {
        setIssues([]);
      }
      return;
    }

    if (configLoading || !stableConfigMaps) {
      // Config still loading. Do NOT set null/zero prices. Do NOT write the
      // cart. Issues remain empty until config is ready.
      return;
    }

    if (!cartHasEE) {
      if (issues.length > 0) {
        setIssues([]);
      }
      return;
    }

    const sourceCart = cart;
    const result = repriceEventEssentialsCart({
      cart: sourceCart,
      ...stableConfigMaps,
    });

    const issuesChanged = JSON.stringify(result.issues) !== JSON.stringify(issues);
    if (issuesChanged) {
      setIssues(result.issues);
    }

    if (result.changed && result.cart !== sourceCart) {
      // Compare-and-apply: only write if the cart hasn't changed since the
      // repricer read it. If a newer cart is present (e.g. the user toggled
      // dry/water while repricing was pending), the apply callback returns
      // false and the newer cart is repriced on the next render.
      applyRef.current(sourceCart, result.cart);
    }
  }, [configError, configLoading, stableConfigMaps, cart, cartHasEE, issues]);

  const blocking = hasBlockingIssues(issues);
  const configReady = !configLoading && !configError && stableConfigMaps !== null;

  // Derived checkout state. An Event Essential cart is blocked while config is
  // loading or has failed, OR when blocking issues exist. An inflatable-only
  // cart is never blocked by EE state.
  const validationPending = cartHasEE && configLoading;
  const validationFailed = cartHasEE && configError;
  const canContinue = !validationPending && !validationFailed && !blocking;

  return {
    issues,
    hasBlockingIssues: blocking,
    configLoading,
    configError,
    configReady,
    validationPending,
    validationFailed,
    canContinue,
  };
}
