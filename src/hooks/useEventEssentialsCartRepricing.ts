// Stage E3 — Event Essentials cart repricing hook.
//
// Loads customer pricing configuration (products, pricing, categories, bundles,
// unit configs), builds E1 resolver configuration maps, calls the pure repricer
// when relevant dependencies change, writes the cart only when the repricer
// reports changed=true, and exposes Event Essential issues to the Quote UI.
//
// Inflatable-only carts are never blocked by configuration load failures.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
}

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
  onCartReprice: (repricedCart: UnifiedCartItem[]) => void,
): UseEventEssentialsCartRepricingResult {
  const [configMaps, setConfigMaps] = useState<RepricingConfigMaps | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [issues, setIssues] = useState<EventEssentialsCartIssue[]>([]);

  const onCartRepriceRef = useRef(onCartReprice);
  onCartRepriceRef.current = onCartReprice;

  // Track whether the cart contains any Event Essentials. If it doesn't, we
  // never need to load config or write the cart — protecting inflatable-only
  // customers from any EE config failure.
  const cartHasEE = hasEventEssentialsInCart(cart);
  const cartHasEERef = useRef(cartHasEE);
  cartHasEERef.current = cartHasEE;

  // Load configuration once when Event Essentials first appear in the cart.
  // If the cart never has EE items, config is never loaded.
  useEffect(() => {
    if (!cartHasEE) {
      // If EE items were removed, clear issues but don't touch the cart.
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
    // Only trigger when EE presence changes (false -> true). We intentionally
    // do NOT depend on the full cart array here — that would reload config on
    // every cart change. Config is loaded once and reused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartHasEE]);

  // Reprice when config loads or the cart changes. This is the single effect
  // that calls the pure repricer and writes the cart.
  const stableConfigMaps = useMemo(() => {
    if (!configMaps) return null;
    return configMaps;
  }, [configMaps]);

  const lastRepricedCartRef = useRef<UnifiedCartItem[] | null>(null);

  const runRepricing = useCallback(() => {
    if (!stableConfigMaps) {
      // Config not ready yet. Do NOT alter the cart. If there are EE items,
      // we'll surface issues after config loads. If config failed, issues
      // are set separately.
      return;
    }

    const currentCart = cart;
    if (!hasEventEssentialsInCart(currentCart)) {
      // No EE items: clear any stale issues, never write the cart.
      if (issues.length > 0) {
        setIssues([]);
      }
      return;
    }

    const result = repriceEventEssentialsCart({
      cart: currentCart,
      ...stableConfigMaps,
    });

    // Always update issues (they may change even when cart doesn't).
    const issuesChanged = JSON.stringify(result.issues) !== JSON.stringify(issues);
    if (issuesChanged) {
      setIssues(result.issues);
    }

    if (result.changed && result.cart !== currentCart) {
      lastRepricedCartRef.current = result.cart;
      onCartRepriceRef.current(result.cart);
    }
  }, [stableConfigMaps, cart, issues]);

  useEffect(() => {
    if (configError) {
      // Config failed to load. If there are EE items, create blocking issues
      // for each one. If the cart is inflatable-only, no issues and no block.
      if (cartHasEERef.current) {
        const errorIssues: EventEssentialsCartIssue[] = cart
          .map((item, index) => {
            if (isEventEssentialProductCartItem(item)) {
              return {
                resolverKey: `cart-product-${item.product_id}`,
                cartIndex: index,
                itemType: 'event_essential_product' as const,
                itemId: item.product_id,
                message: 'Unable to verify this item. Please try again or remove it.',
                blocking: true,
              };
            }
            if (isEventEssentialBundleCartItem(item)) {
              return {
                resolverKey: `cart-bundle-${item.bundle_id}`,
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

    runRepricing();
  }, [configError, configLoading, stableConfigMaps, cart, issues, runRepricing]);

  const blocking = hasBlockingIssues(issues);

  return {
    issues,
    hasBlockingIssues: blocking,
    configLoading,
    configError,
    configReady: !configLoading && !configError && stableConfigMaps !== null,
  };
}
