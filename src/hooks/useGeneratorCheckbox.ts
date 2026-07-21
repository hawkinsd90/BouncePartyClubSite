// Generator Workflow Unification — shared hook for the Quote checkbox.
//
// Controls the authoritative Event Essentials Generator product through the
// unified cart. The checkbox no longer creates a legacy generator_fee_cents.
// It adds/removes the EE Generator product via useQuoteCart.

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  lookupGeneratorProduct,
  cartHasDirectGenerator,
  getDirectGeneratorQuantity,
  loadPackageGeneratorConfigs,
  cartPackageContainsGenerator,
  type GeneratorProductConfiguration,
} from '../lib/generatorUnified';
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

function datesValid(fd: { event_date: string; event_end_date: string }): boolean {
  return !!(fd.event_date && fd.event_end_date);
}

export function useGeneratorCheckbox(params: UseGeneratorCheckboxParams): UseGeneratorCheckboxResult {
  const { cart, formData, addToCart, removeEventEssentialProduct, isInitialized, onFormDataChange } = params;
  const [generatorProduct, setGeneratorProduct] = useState<GeneratorProductConfiguration | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'info' | 'error' | null>(null);
  const [loading, setLoading] = useState(false);
  const [legacyConversionNeeded, setLegacyConversionNeeded] = useState(false);
  const togglingRef = useRef(false);

  // Load the authoritative Generator product once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await lookupGeneratorProduct();
      if (cancelled) return;
      if (result.status === 'configured') {
        setGeneratorProduct(result.product);
      } else if (result.status === 'ambiguous') {
        setMessage('Generator configuration is ambiguous. Please contact us.');
        setMessageType('error');
      } else if (result.status === 'configuration_failed') {
        setMessage('Unable to verify Generator availability. Please try again.');
        setMessageType('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Detect legacy browser-storage state on init.
  useEffect(() => {
    if (!isInitialized || !generatorProduct) return;
    const hasLegacyState = formData.has_generator || formData.generator_qty > 0;
    if (!hasLegacyState) return;
    const alreadyHasDirect = cartHasDirectGenerator(cart, generatorProduct.product_id);
    if (alreadyHasDirect) {
      // Clear legacy fields since the EE item already exists.
      onFormDataChange({ has_generator: false, generator_qty: 0 });
      return;
    }
    setLegacyConversionNeeded(true);
  }, [isInitialized, generatorProduct]); // eslint-disable-line react-hooks/exhaustive-deps

  const directQty = generatorProduct ? getDirectGeneratorQuantity(cart, generatorProduct.product_id) : 0;
  const [packageContainedQty, setPackageContainedQty] = useState(0);

  // Check if any selected package contains a Generator.
  useEffect(() => {
    if (!generatorProduct) {
      setPackageContainedQty(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const configs = await loadPackageGeneratorConfigs(generatorProduct.product_id);
      if (cancelled) return;
      const qty = cartPackageContainsGenerator(cart, configs, generatorProduct.product_id);
      setPackageContainedQty(qty);
    })();
    return () => { cancelled = true; };
  }, [generatorProduct, cart]);

  const checked = directQty > 0 || packageContainedQty > 0;

  const toggle = useCallback(async (wantChecked: boolean) => {
    if (togglingRef.current) return;
    if (!generatorProduct) {
      setMessage('Unable to verify Generator availability. Please try again.');
      setMessageType('error');
      return;
    }

    if (wantChecked) {
      // If package already includes a Generator, don't add a direct one.
      if (packageContainedQty > 0) {
        setMessage('Generator included in your selected package.');
        setMessageType('info');
        return;
      }

      if (!datesValid(formData)) {
        setMessage('Select your event dates before adding a Generator.');
        setMessageType('error');
        return;
      }

      togglingRef.current = true;
      setLoading(true);
      try {
        // Check availability for qty 1.
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

        // Evaluate through the EE resolver using the current cart.
        const { data: allProducts } = await supabase
          .from('inventory_products')
          .select('id, slug, name, active, category_id, total_quantity, temp_unavailable_qty') as any;
        const { data: allPricing } = await supabase
          .from('product_pricing')
          .select('product_id, standalone_price_cents, addon_price_cents, standalone_enabled, addon_enabled, addon_qualifying_threshold_cents') as any;
        const { data: allBundles } = await supabase
          .from('product_bundles')
          .select('id, standalone_price_cents, addon_price_cents, standalone_enabled, addon_enabled, addon_qualifying_threshold_cents, inflatable_eligibility_mode') as any;
        const { data: allCategories } = await supabase
          .from('product_categories')
          .select('id, slug, name, active') as any;
        const { data: allUnits } = await supabase
          .from('units')
          .select('id, active') as any;

        const productConfigs = buildProductConfigMap(allProducts || [], allPricing || []);
        const bundleConfigs = buildBundleConfigMap(allBundles || []);
        const categoryMap = buildCategoryMap(allCategories || []);
        const unitMap = buildUnitMap(allUnits || []);
        const cartLines = normalizeCartLines(cart, productConfigs, bundleConfigs);

        const candidate = evaluateProductCandidate(
          { productConfigs, bundleConfigs, categories: categoryMap, units: unitMap, cartLines },
          { productId: generatorProduct.product_id, qty: 1 },
        );
        const vm = deriveCandidateViewModel(candidate, false);

        if (!candidate || !vm.selectable || vm.resolvedPriceCents === null) {
          setMessage('Unable to verify Generator availability. Please try again.');
          setMessageType('error');
          return;
        }

        const pricingContext: PricingContext =
          candidate.resolvedPricingContext === 'addon' ? 'addon' : 'standalone';

        const item: EventEssentialProductCartItem = {
          item_type: 'event_essential_product',
          product_id: generatorProduct.product_id,
          product_name: generatorProduct.product_name,
          qty: 1,
          unit_price_cents: vm.resolvedPriceCents,
          pricing_context: pricingContext,
          isAvailable: true,
        };

        addToCart(item);
        // Clear legacy form fields.
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
      // Unchecking: remove the complete direct Generator selection.
      if (directQty > 0) {
        removeEventEssentialProduct(generatorProduct.product_id);
      }
      onFormDataChange({ has_generator: false, generator_qty: 0 });
      setMessage(null);
      setMessageType(null);
    }
  }, [generatorProduct, packageContainedQty, directQty, formData, cart, addToCart, removeEventEssentialProduct, onFormDataChange]);

  const performLegacyConversion = useCallback(async () => {
    if (!generatorProduct) return;
    if (!datesValid(formData)) {
      setMessage('Your saved Generator selection needs to be reviewed before continuing.');
      setMessageType('error');
      return;
    }

    const legacyQty = formData.generator_qty > 0 ? formData.generator_qty : 1;

    togglingRef.current = true;
    setLoading(true);
    try {
      const availResult = await checkProductAvailability(
        [{ product_id: generatorProduct.product_id, quantity: legacyQty }],
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

      // Evaluate through resolver.
      const { data: allProducts } = await supabase
        .from('inventory_products')
        .select('id, slug, name, active, category_id, total_quantity, temp_unavailable_qty') as any;
      const { data: allPricing } = await supabase
        .from('product_pricing')
        .select('product_id, standalone_price_cents, addon_price_cents, standalone_enabled, addon_enabled, addon_qualifying_threshold_cents') as any;
      const { data: allBundles } = await supabase
        .from('product_bundles')
        .select('id, standalone_price_cents, addon_price_cents, standalone_enabled, addon_enabled, addon_qualifying_threshold_cents, inflatable_eligibility_mode') as any;
      const { data: allCategories } = await supabase
        .from('product_categories')
        .select('id, slug, name, active') as any;
      const { data: allUnits } = await supabase
        .from('units')
        .select('id, active') as any;

      const productConfigs = buildProductConfigMap(allProducts || [], allPricing || []);
      const bundleConfigs = buildBundleConfigMap(allBundles || []);
      const categoryMap = buildCategoryMap(allCategories || []);
      const unitMap = buildUnitMap(allUnits || []);
      const cartLines = normalizeCartLines(cart, productConfigs, bundleConfigs);

      const candidate = evaluateProductCandidate(
        { productConfigs, bundleConfigs, categories: categoryMap, units: unitMap, cartLines },
        { productId: generatorProduct.product_id, qty: legacyQty },
      );
      const vm = deriveCandidateViewModel(candidate, false);

      if (!candidate || !vm.selectable || vm.resolvedPriceCents === null) {
        setMessage('Your saved Generator selection needs to be reviewed before continuing.');
        setMessageType('error');
        return;
      }

      const pricingContext: PricingContext =
        candidate.resolvedPricingContext === 'addon' ? 'addon' : 'standalone';

      const item: EventEssentialProductCartItem = {
        item_type: 'event_essential_product',
        product_id: generatorProduct.product_id,
        product_name: generatorProduct.product_name,
        qty: legacyQty,
        unit_price_cents: vm.resolvedPriceCents,
        pricing_context: pricingContext,
        isAvailable: true,
      };

      addToCart(item);
      onFormDataChange({ has_generator: false, generator_qty: 0 });
      setLegacyConversionNeeded(false);
      setMessage(null);
      setMessageType(null);
    } catch {
      setMessage('Your saved Generator selection needs to be reviewed before continuing.');
      setMessageType('error');
    } finally {
      setLoading(false);
      togglingRef.current = false;
    }
  }, [generatorProduct, formData, cart, addToCart, onFormDataChange]);

  return {
    state: {
      checked,
      packageContainedQty,
      directQty,
      message,
      messageType,
      loading,
    },
    generatorProduct,
    toggle,
    legacyConversionNeeded,
    performLegacyConversion,
  };
}
