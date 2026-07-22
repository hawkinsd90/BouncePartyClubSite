// Customer Quote/cart Generator checkbox hook.
//
// Controls the authoritative Event Essentials Generator product through the
// unified cart. The checkbox adds/removes the EE Generator product via
// useQuoteCart — it never creates a legacy generator_fee_cents charge.
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
  getDirectGeneratorQuantity,
  loadPackageGeneratorConfigs,
  cartPackageContainsGenerator,
  isValidEventDateRange,
  decideDirectGeneratorAdd,
  shouldRunLegacyConversion,
  type GeneratorProductConfiguration,
  type PackageGeneratorConfig,
  type GeneratorConfigurationStatus,
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

  // Explicit configuration status — owned by the hook, not derived from null.
  // Initial state is 'loading'. A lookup failure transitions to 'failed' and
  // never remains represented as 'loading'.
  const [configurationStatus, setConfigurationStatus] = useState<GeneratorConfigurationStatus>('loading');
  const [generatorProduct, setGeneratorProduct] = useState<GeneratorProductConfiguration | null>(null);
  const [resolverConfig, setResolverConfig] = useState<ResolverConfig | null>(null);
  const [packageConfigs, setPackageConfigs] = useState<PackageGeneratorConfig[] | null>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'info' | 'error' | null>(null);
  const [loading, setLoading] = useState(false);
  const [legacyConversionNeeded, setLegacyConversionNeeded] = useState(false);
  const togglingRef = useRef(false);
  const [conversionInFlight, setConversionInFlight] = useState(false);
  const [conversionCompleted, setConversionCompleted] = useState(false);
  const autoConversionAttempted = useRef(false);

  const configurationLoading = configurationStatus === 'loading';
  const configurationReady = configurationStatus === 'ready';
  const configurationFailed = configurationStatus === 'failed';

  // Load the authoritative Generator product + shared resolver config once.
  // Sets configurationStatus explicitly: 'ready' only after all queries
  // succeed; 'failed' on any lookup failure (not_found, ambiguous,
  // configuration_failed, or resolver query failure).
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

      if (genResult.status !== 'configured') {
        setConfigurationStatus('failed');
        if (genResult.status === 'not_found') {
          setMessage('Generator is not configured. Please contact us.');
        } else if (genResult.status === 'ambiguous') {
          setMessage('Generator configuration is ambiguous. Please contact us.');
        } else {
          setMessage('Unable to verify Generator availability. Please try again.');
        }
        setMessageType('error');
        return;
      }

      if (
        productsResult.error || pricingResult.error || categoriesResult.error ||
        bundlesResult.error || unitsResult.error
      ) {
        setConfigurationStatus('failed');
        setMessage('Unable to verify Generator availability. Please try again.');
        setMessageType('error');
        return;
      }

      setGeneratorProduct(genResult.product);
      setResolverConfig({
        productConfigs: buildProductConfigMap(productsResult.data ?? [], pricingResult.data ?? []),
        bundleConfigs: buildBundleConfigMap(bundlesResult.data ?? []),
        categories: buildCategoryMap(categoriesResult.data ?? []),
        units: buildUnitMap(unitsResult.data ?? []),
      });
      // packageConfigs loaded separately; status becomes 'ready' only after
      // package configs also resolve (see package-config effect below).
    })();
    return () => { cancelled = true; };
  }, []);

  // Load package generator configs (fail-closed). Transitions configuration
  // status to 'ready' on success or 'failed' on failure — but only after the
  // generator product + resolver are already loaded.
  useEffect(() => {
    if (!generatorProduct || !resolverConfig) {
      setPackageConfigs(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await loadPackageGeneratorConfigs(generatorProduct.product_id);
      if (cancelled) return;
      if (result.status === 'loaded') {
        setPackageConfigs(result.configs);
        setConfigurationStatus('ready');
      } else {
        setPackageConfigs(null);
        setConfigurationStatus('failed');
        setMessage('Unable to verify Generator availability. Please try again.');
        setMessageType('error');
      }
    })();
    return () => { cancelled = true; };
  }, [generatorProduct, resolverConfig]);

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

  // Legacy synchronization effect. Reacts to directQty, formData legacy
  // fields, isInitialized, and configurationReady.
  //
  // Required behavior:
  // - No legacy state → legacyConversionNeeded = false.
  // - Legacy state + direct Generator already in cart → clear legacy fields,
  //   legacyConversionNeeded = false, no second Generator added.
  // - Legacy state + no direct Generator → legacyConversionNeeded = true
  //   (triggers auto-conversion effect when dates are valid).
  useEffect(() => {
    if (!isInitialized || !configurationReady) return;

    const hasLegacyState = formData.has_generator || formData.generator_qty > 0;

    if (!hasLegacyState) {
      // Customer no longer has legacy browser Generator state.
      if (legacyConversionNeeded) setLegacyConversionNeeded(false);
      return;
    }

    // Legacy state present. If a direct EE Generator already exists, clear
    // the stale legacy fields and mark conversion completed — do NOT add
    // another Generator.
    if (directQty > 0) {
      onFormDataChange({ has_generator: false, generator_qty: 0 });
      setLegacyConversionNeeded(false);
      setConversionCompleted(true);
      return;
    }

    // Legacy state present, no direct Generator yet → conversion needed.
    if (!conversionCompleted && !conversionInFlight) {
      setLegacyConversionNeeded(true);
    }
  }, [
    isInitialized,
    configurationReady,
    directQty,
    formData.has_generator,
    formData.generator_qty,
    legacyConversionNeeded,
    conversionCompleted,
    conversionInFlight,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-run conversion once when all readiness conditions are met.
  // Reacts to: legacy state, valid dates, configuration readiness.
  useEffect(() => {
    if (autoConversionAttempted.current) return;

    const decision = shouldRunLegacyConversion({
      legacyStatePresent: formData.has_generator || formData.generator_qty > 0,
      alreadyHasDirect: directQty > 0,
      conversionCompleted,
      conversionInFlight,
      configurationReady,
      isValidEventDateRange: isValidEventDateRange(formData.event_date, formData.event_end_date),
    });

    if (!decision.ready) return;

    autoConversionAttempted.current = true;
    void performLegacyConversion();
  }, [
    legacyConversionNeeded,
    conversionCompleted,
    conversionInFlight,
    configurationReady,
    directQty,
    formData.event_date,
    formData.event_end_date,
    formData.has_generator,
    formData.generator_qty,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Fail-closed: require configuration ready before any add. Do not rely
    // only on the checkbox disabled state.
    if (wantChecked && !configurationReady) {
      if (configurationFailed) {
        setMessage('Unable to verify Generator availability. Please try again.');
        setMessageType('error');
      }
      // Do not clear a valid existing selection while loading/failed.
      return;
    }

    if (!generatorProduct || !resolverConfig) {
      setMessage('Unable to verify Generator availability. Please try again.');
      setMessageType('error');
      return;
    }

    if (wantChecked) {
      // Direct duplicate prevention: do not add another Generator if one
      // already exists (direct or package-contained). Preserve existing qty.
      const decision = decideDirectGeneratorAdd(directQty, packageContainedQty);
      if (!decision.shouldAdd) {
        if (packageContainedQty > 0) {
          setMessage(decision.reason || 'Generator included in your selected package.');
          setMessageType('info');
        } else {
          // directQty > 0 — already in cart. Clear any stale legacy fields.
          setMessage(null);
          setMessageType(null);
        }
        onFormDataChange({ has_generator: false, generator_qty: 0 });
        setLegacyConversionNeeded(false);
        setConversionCompleted(true);
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
        setLegacyConversionNeeded(false);
        setConversionCompleted(true);
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
      // Unchecking: remove the direct Generator, clear all legacy state,
      // clear stale conversion messages. Do not leave Checkout blocked.
      if (directQty > 0) {
        removeEventEssentialProduct(generatorProduct.product_id);
      }
      onFormDataChange({ has_generator: false, generator_qty: 0 });
      setLegacyConversionNeeded(false);
      setMessage(null);
      setMessageType(null);
    }
  }, [configurationReady, configurationFailed, generatorProduct, resolverConfig, packageContainedQty, directQty, formData, addToCart, removeEventEssentialProduct, onFormDataChange, evaluateGenerator]);

  const performLegacyConversion = useCallback(async () => {
    if (!generatorProduct || !resolverConfig) return;

    if (!isValidEventDateRange(formData.event_date, formData.event_end_date)) {
      setMessage('Your saved Generator selection needs to be reviewed before continuing.');
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
      // Failed: keep legacyConversionNeeded=true so Retry button shows.
      // autoConversionAttempted stays true so no automatic retry.
      setMessage('Your saved Generator selection needs to be reviewed before continuing.');
      setMessageType('error');
    } finally {
      setConversionInFlight(false);
      setLoading(false);
      togglingRef.current = false;
    }
  }, [generatorProduct, resolverConfig, formData, packageConfigs, addToCart, onFormDataChange, evaluateGenerator]);

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
