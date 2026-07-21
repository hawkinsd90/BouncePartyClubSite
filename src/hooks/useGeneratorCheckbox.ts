// Generator Workflow Unification — shared hook for the Quote checkbox.
//
// Controls the authoritative Event Essentials Generator product through the
// unified cart. The checkbox no longer creates a legacy generator_fee_cents.
// It adds/removes the EE Generator product via useQuoteCart.
//
// Uses the SAME shared configuration loader as the Event Essentials catalog
// and E3 repricing — no duplicated incomplete Supabase queries.

import { useState, useEffect, useCallback, useRef } from 'react';
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
  normalizeCartLines,
  evaluateProductCandidate,
  deriveCandidateViewModel,
} from '../lib/eventEssentialsCatalogResolver';
import { checkProductAvailability } from '../lib/queries/products';
import {
  lookupGeneratorProduct,
  cartHasDirectGenerator,
  getDirectGeneratorQuantity,
  loadPackageGeneratorConfigs,
  cartPackageContainsGenerator,
  isValidEventDateRange,
  type GeneratorProductConfiguration,
  type PackageGeneratorConfig,
} from '../lib/generatorUnified';
import type {
  UnifiedCartItem,
  EventEssentialProductCartItem,
} from '../types';
import type { PricingContext } from '../types';

export interface GeneratorCheckboxState {
  checked: boolean;
  packageContainedQty: number;
  directQty: number;
  message: string | null;
  messageType: 'info' | 'error' | null;
  loading: boolean;
  legacyConversionNeeded: boolean;
  configurationLoading: boolean;
  configurationReady: boolean;
  configurationFailed: boolean;
  conversionInFlight: boolean;
}

export interface UseGeneratorCheckboxResult {
  state: GeneratorCheckboxState;
  generatorProduct: GeneratorProductConfiguration | null;
  toggle: (checked: boolean) => Promise<void>;
  legacyConversionNeeded: boolean;
  performLegacyConversion: () => Promise<void>;
}

interface UseGeneratorCheckboxParams {
  cart: UnifiedCartItem[];
  formData: {
    event_date: string;
    event_end_date: string;
    has_generator: boolean;
    generator_qty: number;
  };
  addToCart: (item: UnifiedCartItem) => void;
  removeEventEssentialProduct: (productId: string) => boolean;
  isInitialized: boolean;
  onFormDataChange: (updates: Partial<{ event_date: string; event_end_date: string; has_generator: boolean; generator_qty: number }>) => void;
}

interface ResolverConfig {
  productConfigs: ReturnType<typeof buildProductConfigMap>;
  bundleConfigs: ReturnType<typeof buildBundleConfigMap>;
  categories: ReturnType<typeof buildCategoryMap>;
  units: ReturnType<typeof buildUnitMap>;
}

export function useGeneratorCheckbox(params: UseGeneratorCheckboxParams): UseGeneratorCheckboxResult {
  const { cart, formData, addToCart, removeEventEssentialProduct, isInitialized, onFormDataChange } = params;
  const [generatorProduct, setGeneratorProduct] = useState<GeneratorProductConfiguration | null>(null);
  const [resolverConfig, setResolverConfig] = useState<ResolverConfig | null>(null);
  const [packageConfigs, setPackageConfigs] = useState<PackageGeneratorConfig[] | null>(null);
  const [packageConfigFailed, setPackageConfigFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'info' | 'error' | null>(null);
  const [loading, setLoading] = useState(false);
  const [legacyConversionNeeded, setLegacyConversionNeeded] = useState(false);
  const togglingRef = useRef(false);
  const [conversionInFlight, setConversionInFlight] = useState(false);
  const [conversionCompleted, setConversionCompleted] = useState(false);

  // Load the authoritative Generator product + shared resolver config once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [genResult, productsResult, pricingResult, categoriesResult, bundlesResult, unitsResult] =
        await Promise.all([
          lookupGeneratorProduct(),
          fetchInventoryProducts(),
          fetchProductPricing(),
          fetchProductCategories(),
          fetchProductBundlesWithAllComponents(),
          getInflatableUnitResolverConfigs(),
        ]);

      if (cancelled) return;

      if (genResult.status === 'configured') {
        setGeneratorProduct(genResult.product);

        if (
          productsResult.error || pricingResult.error || categoriesResult.error ||
          bundlesResult.error || unitsResult.error
        ) {
          setMessage('Unable to verify Generator availability. Please try again.');
          setMessageType('error');
          return;
        }

        setResolverConfig({
          productConfigs: buildProductConfigMap(productsResult.data ?? [], pricingResult.data ?? []),
          bundleConfigs: buildBundleConfigMap(bundlesResult.data ?? []),
          categories: buildCategoryMap(categoriesResult.data ?? []),
          units: buildUnitMap(unitsResult.data ?? []),
        });
      } else if (genResult.status === 'ambiguous') {
        setMessage('Generator configuration is ambiguous. Please contact us.');
        setMessageType('error');
      } else if (genResult.status === 'configuration_failed') {
        setMessage('Unable to verify Generator availability. Please try again.');
        setMessageType('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load package generator configs (fail-closed).
  useEffect(() => {
    if (!generatorProduct) {
      setPackageConfigs(null);
      setPackageConfigFailed(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await loadPackageGeneratorConfigs(generatorProduct.product_id);
      if (cancelled) return;
      if (result.status === 'loaded') {
        setPackageConfigs(result.configs);
        setPackageConfigFailed(false);
      } else {
        setPackageConfigs(null);
        setPackageConfigFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [generatorProduct]);

  const directQty = generatorProduct ? getDirectGeneratorQuantity(cart, generatorProduct.product_id) : 0;
  const [packageContainedQty, setPackageContainedQty] = useState(0);

  useEffect(() => {
    if (!generatorProduct || packageConfigs === null) {
      setPackageContainedQty(0);
      return;
    }
    const qty = cartPackageContainsGenerator(cart, packageConfigs, generatorProduct.product_id);
    setPackageContainedQty(qty);
  }, [generatorProduct, packageConfigs, cart]);

  const checked = directQty > 0 || packageContainedQty > 0;

  // Detect legacy browser-storage state on init.
  useEffect(() => {
    if (!isInitialized || !generatorProduct || packageConfigs === null) return;
    if (conversionCompleted || conversionInFlight) return;

    const hasLegacyState = formData.has_generator || formData.generator_qty > 0;
    if (!hasLegacyState) return;

    const alreadyHasDirect = cartHasDirectGenerator(cart, generatorProduct.product_id);
    if (alreadyHasDirect) {
      setConversionCompleted(true);
      onFormDataChange({ has_generator: false, generator_qty: 0 });
      return;
    }

    setLegacyConversionNeeded(true);
  }, [isInitialized, generatorProduct, packageConfigs, conversionCompleted, conversionInFlight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-run conversion once when conditions are met.
  useEffect(() => {
    if (!legacyConversionNeeded || conversionCompleted || conversionInFlight) return;
    if (!generatorProduct || !resolverConfig || packageConfigs === null || packageConfigFailed) return;
    if (!isValidEventDateRange(formData.event_date, formData.event_end_date)) return;

    void performLegacyConversion();
  }, [legacyConversionNeeded, conversionCompleted, conversionInFlight, generatorProduct, resolverConfig, packageConfigs, packageConfigFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  const evaluateGenerator = useCallback(async (qty: number): Promise<{ price: number; context: PricingContext } | null> => {
    if (!generatorProduct || !resolverConfig) return null;

    const cartLines = normalizeCartLines(cart, resolverConfig.productConfigs, resolverConfig.bundleConfigs);
    const candidate = evaluateProductCandidate(
      {
        productConfigs: resolverConfig.productConfigs,
        bundleConfigs: resolverConfig.bundleConfigs,
        categories: resolverConfig.categories,
        units: resolverConfig.units,
        cartLines,
      },
      { productId: generatorProduct.product_id, qty },
    );
    const vm = deriveCandidateViewModel(candidate, false);

    if (!candidate || !vm.selectable || vm.resolvedPriceCents === null) return null;

    const pricingContext: PricingContext =
      candidate.resolvedPricingContext === 'addon' ? 'addon' : 'standalone';

    return { price: vm.resolvedPriceCents, context: pricingContext };
  }, [generatorProduct, resolverConfig, cart]);

  const toggle = useCallback(async (wantChecked: boolean) => {
    if (togglingRef.current) return;
    if (!generatorProduct || !resolverConfig) {
      setMessage('Unable to verify Generator availability. Please try again.');
      setMessageType('error');
      return;
    }

    if (packageConfigFailed) {
      setMessage('Unable to verify whether your selected package includes a Generator. Please try again.');
      setMessageType('error');
      return;
    }

    if (wantChecked) {
      if (packageContainedQty > 0) {
        setMessage('Generator included in your selected package.');
        setMessageType('info');
        return;
      }

      if (!isValidEventDateRange(formData.event_date, formData.event_end_date)) {
        setMessage('Select your event dates before adding a Generator.');
        setMessageType('error');
        return;
      }

      togglingRef.current = true;
      setLoading(true);
      try {
        const availResult = await checkProductAvailability(
          [{ product_id: generatorProduct.product_id, quantity: 1 }],
          formData.event_date,
          formData.event_end_date,
          null,
        );

        if (availResult.error || !availResult.data) {
          setMessage('Unable to verify Generator availability. Please try again.');
          setMessageType('error');
          return;
        }

        const avail = availResult.data.find((r) => r.product_id === generatorProduct.product_id);
        if (!avail || avail.is_allowed !== true) {
          setMessage('A Generator is not available for the selected dates.');
          setMessageType('error');
          return;
        }

        const evalResult = await evaluateGenerator(1);
        if (!evalResult) {
          setMessage('Unable to verify Generator availability. Please try again.');
          setMessageType('error');
          return;
        }

        const item: EventEssentialProductCartItem = {
          item_type: 'event_essential_product',
          product_id: generatorProduct.product_id,
          product_name: generatorProduct.product_name,
          qty: 1,
          unit_price_cents: evalResult.price,
          pricing_context: evalResult.context,
          isAvailable: true,
        };

        addToCart(item);
        onFormDataChange({ has_generator: false, generator_qty: 0 });
        setMessage(null);
        setMessageType(null);
      } catch {
        setMessage('Unable to verify Generator availability. Please try again.');
        setMessageType('error');
      } finally {
        setLoading(false);
        togglingRef.current = false;
      }
    } else {
      if (directQty > 0) {
        removeEventEssentialProduct(generatorProduct.product_id);
      }
      onFormDataChange({ has_generator: false, generator_qty: 0 });
      setMessage(null);
      setMessageType(null);
    }
  }, [generatorProduct, resolverConfig, packageConfigFailed, packageContainedQty, directQty, formData, addToCart, removeEventEssentialProduct, onFormDataChange, evaluateGenerator]);

  const performLegacyConversion = useCallback(async () => {
    if (!generatorProduct || !resolverConfig) return;

    if (!isValidEventDateRange(formData.event_date, formData.event_end_date)) {
      setMessage('Your saved Generator selection needs to be reviewed before continuing.');
      setMessageType('error');
      return;
    }

    if (packageConfigFailed) {
      setMessage('Unable to verify whether your selected package includes a Generator. Please try again.');
      setMessageType('error');
      return;
    }

    const legacyQty = formData.generator_qty > 0 ? formData.generator_qty : 1;

    const packageQty = packageConfigs
      ? cartPackageContainsGenerator(cart, packageConfigs, generatorProduct.product_id)
      : 0;

    const directQtyToAdd = Math.max(0, legacyQty - packageQty);

    setConversionInFlight(true);
    togglingRef.current = true;
    setLoading(true);
    try {
      if (directQtyToAdd > 0) {
        const availResult = await checkProductAvailability(
          [{ product_id: generatorProduct.product_id, quantity: directQtyToAdd }],
          formData.event_date,
          formData.event_end_date,
          null,
        );

        if (availResult.error || !availResult.data) {
          setMessage('Your saved Generator selection needs to be reviewed before continuing.');
          setMessageType('error');
          return;
        }

        const avail = availResult.data.find((r) => r.product_id === generatorProduct.product_id);
        if (!avail || avail.is_allowed !== true) {
          setMessage('Your saved Generator selection needs to be reviewed before continuing.');
          setMessageType('error');
          return;
        }

        const evalResult = await evaluateGenerator(directQtyToAdd);
        if (!evalResult) {
          setMessage('Your saved Generator selection needs to be reviewed before continuing.');
          setMessageType('error');
          return;
        }

        const item: EventEssentialProductCartItem = {
          item_type: 'event_essential_product',
          product_id: generatorProduct.product_id,
          product_name: generatorProduct.product_name,
          qty: directQtyToAdd,
          unit_price_cents: evalResult.price,
          pricing_context: evalResult.context,
          isAvailable: true,
        };

        addToCart(item);
      }

      onFormDataChange({ has_generator: false, generator_qty: 0 });
      setLegacyConversionNeeded(false);
      setConversionCompleted(true);
      setMessage(null);
      setMessageType(null);
    } catch {
      setMessage('Your saved Generator selection needs to be reviewed before continuing.');
      setMessageType('error');
    } finally {
      setConversionInFlight(false);
      setLoading(false);
      togglingRef.current = false;
    }
  }, [generatorProduct, resolverConfig, formData, packageConfigFailed, packageConfigs, addToCart, onFormDataChange, evaluateGenerator]);

  const configurationLoading = !generatorProduct || !resolverConfig || packageConfigs === null;
  const configurationReady = !!generatorProduct && !!resolverConfig && packageConfigs !== null && !packageConfigFailed;
  const configurationFailed = packageConfigFailed || (!!generatorProduct && !resolverConfig);

  return {
    state: {
      checked,
      packageContainedQty,
      directQty,
      message,
      messageType,
      loading: loading || conversionInFlight,
      legacyConversionNeeded,
      configurationLoading,
      configurationReady,
      configurationFailed,
      conversionInFlight,
    },
    generatorProduct,
    toggle,
    legacyConversionNeeded,
    performLegacyConversion,
  };
}
