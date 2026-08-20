import { useState, useEffect, useCallback } from 'react';
import { Plus, Package, ShoppingBag } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { resolveEventEssentialsPricing } from '../../lib/eventEssentialsPricing';
import type {
  ResolverInput,
  ResolverInputLine,
  ResolverProductConfig,
  ResolverBundleConfig,
  ResolverCategory,
  ResolverUnitConfig,
  InflatableEligibilityMode,
} from '../../lib/eventEssentialsPricingTypes';
import type { BundleComponentSnapshot } from '../admin/OrderDetailModal';
import {
  fetchAdminInventoryProducts,
  fetchAdminProductPricing,
  fetchAdminProductCategories,
  fetchAdminProductBundlesWithConfiguration,
} from '../../lib/queries/products';
import type { ProductBundleWithConfiguration } from '../../types';

interface AddEventEssentialsSectionProps {
  stagedItems: any[];
  availableUnits: any[];
  onAddProduct: (item: StagedEEItem) => void;
  onAddBundle: (item: StagedEEItem) => void;
}

export interface StagedEEItem {
  product_id?: string;
  bundle_id?: string;
  product_name?: string;
  item_name?: string;
  qty: number;
  unit_price_cents: number;
  pricing_context?: string;
  component_snapshot?: BundleComponentSnapshot | null;
  is_new: boolean;
  is_deleted: boolean;
}

const GENERATORS_CATEGORY_SLUG = 'generators';

export function AddEventEssentialsSection({ stagedItems, availableUnits, onAddProduct, onAddBundle }: AddEventEssentialsSectionProps) {
  const [products, setProducts] = useState<any[]>([]);
  const [bundles, setBundles] = useState<ProductBundleWithConfiguration[]>([]);
  const [allBundles, setAllBundles] = useState<ProductBundleWithConfiguration[]>([]);
  const [categories, setCategories] = useState<Record<string, any>>({});
  const [pricingConfigs, setPricingConfigs] = useState<Record<string, any>>({});
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProducts, setShowProducts] = useState(false);
  const [showBundles, setShowBundles] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catsRes, prodsRes, pricingRes, bundlesRes] = await Promise.all([
        fetchAdminProductCategories(),
        fetchAdminInventoryProducts(),
        fetchAdminProductPricing(),
        fetchAdminProductBundlesWithConfiguration(),
      ]);

      if (catsRes.error) throw new Error(catsRes.error.message);
      if (prodsRes.error) throw new Error(prodsRes.error.message);
      if (pricingRes.error) throw new Error(pricingRes.error.message);
      if (bundlesRes.error) throw new Error(bundlesRes.error.message);

      const catMap: Record<string, any> = {};
      (catsRes.data || []).forEach((c: any) => { catMap[c.id] = c; });
      setCategories(catMap);

      setAllProducts(prodsRes.data || []);

      const generatorsCat = (catsRes.data || []).find((c: any) => c.slug === GENERATORS_CATEGORY_SLUG);
      const generatorsCatId = generatorsCat?.id;
      const filteredProducts = (prodsRes.data || []).filter((p: any) => p.category_id !== generatorsCatId && p.active);
      setProducts(filteredProducts);

      const allBundleData = bundlesRes.data || [];
      setAllBundles(allBundleData);
      setBundles(allBundleData.filter((b: any) => b.active));

      const pMap: Record<string, any> = {};
      (pricingRes.data || []).forEach((p: any) => { pMap[p.product_id] = p; });
      setPricingConfigs(pMap);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Event Essentials catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showProducts || showBundles) {
      void loadData();
    }
  }, [showProducts, showBundles, loadData]);

  const buildResolverInput = useCallback((): ResolverInput => {
    const productConfigs: Record<string, ResolverProductConfig> = {};
    for (const p of allProducts) {
      const pc = pricingConfigs[p.id];
      if (!pc) continue;
      productConfigs[p.id] = {
        id: p.id,
        categoryId: p.category_id,
        standalonePriceCents: pc.standalone_price_cents ?? null,
        addonPriceCents: pc.addon_price_cents ?? null,
        standaloneEnabled: pc.standalone_enabled === true,
        addonEnabled: pc.addon_enabled === true,
        addonQualifyingThresholdCents: pc.addon_qualifying_threshold_cents ?? null,
      };
    }

    const bundleConfigs: Record<string, ResolverBundleConfig> = {};
    for (const b of allBundles) {
      const comps = b.product_bundle_components || [];
      const containedCategoryIds = Array.from(new Set(
        comps
          .map((c: any) => c.inventory_products?.category_id)
          .filter((id: any): id is string => typeof id === 'string' && id !== '')
      ));
      bundleConfigs[b.id] = {
        id: b.id,
        standalonePriceCents: b.standalone_price_cents ?? null,
        addonPriceCents: b.addon_price_cents ?? null,
        standaloneEnabled: b.standalone_enabled === true,
        addonEnabled: b.addon_enabled === true,
        addonQualifyingThresholdCents: b.addon_qualifying_threshold_cents ?? null,
        inflatableEligibilityMode: (b.inflatable_eligibility_mode || 'none') as InflatableEligibilityMode,
        excludedCategoryIds: (b.product_bundle_excluded_categories || []).map((e: any) => e.category_id),
        eligibleUnitIds: (b.package_inflatable_eligibility || []).map((e: any) => e.unit_id),
        inflatableComponents: (b.package_inflatable_components || []).map((c: any) => ({
          unitId: c.unit_id,
          quantityPerBundle: c.quantity_per_bundle,
          selectionMode: c.selection_mode,
        })),
        containedProductCategoryIds: containedCategoryIds,
      };
    }

    const catMap: Record<string, ResolverCategory> = {};
    for (const id of Object.keys(categories)) {
      catMap[id] = { id };
    }

    const unitsMap: Record<string, ResolverUnitConfig> = {};
    for (const u of availableUnits) {
      unitsMap[u.id] = {
        id: u.id,
        active: true,
      };
    }

    const lines: ResolverInputLine[] = stagedItems
      .filter((item: any) => !item.is_deleted)
      .map((item: any) => {
        if (item.unit_id) {
          return {
            resolverKey: item.id || `unit-${item.unit_id}-${item.wet_or_dry || 'dry'}`,
            itemType: 'inflatable' as const,
            qty: item.qty,
            unitId: item.unit_id,
            wetOrDry: item.wet_or_dry,
            selectedUnitPriceCents: item.unit_price_cents,
          };
        }
        if (item.bundle_id) {
          return {
            resolverKey: item.id || `bundle-${item.bundle_id}`,
            itemType: 'event_essential_bundle' as const,
            qty: item.qty,
            bundleId: item.bundle_id,
            savedUnitPriceCents: item.unit_price_cents,
          };
        }
        return {
          resolverKey: item.id || `product-${item.product_id}`,
          itemType: 'event_essential_product' as const,
          qty: item.qty,
          productId: item.product_id,
          savedUnitPriceCents: item.unit_price_cents,
        };
      });

    return {
      lines,
      productConfigs,
      bundleConfigs,
      categories: catMap,
      units: unitsMap,
    };
  }, [allProducts, allBundles, pricingConfigs, categories, availableUnits, stagedItems]);

  const handleAddProduct = useCallback((product: any) => {
    try {
      const input = buildResolverInput();
      const candidateLine: ResolverInputLine = {
        resolverKey: `new-product-${product.id}`,
        itemType: 'event_essential_product',
        qty: 1,
        productId: product.id,
      };
      input.lines.push(candidateLine);

      const result = resolveEventEssentialsPricing(input);
      const candidateResult = result.lines.find(l => l.resolverKey === candidateLine.resolverKey);
      if (!candidateResult || !candidateResult.selectable || candidateResult.resolvedUnitPriceCents === null) {
        setError(`Cannot resolve pricing for "${product.name}". It may not be available for purchase.`);
        return;
      }

      onAddProduct({
        product_id: product.id,
        product_name: product.name,
        item_name: product.name,
        qty: 1,
        unit_price_cents: candidateResult.resolvedUnitPriceCents,
        pricing_context: candidateResult.resolvedPricingContext || 'standalone',
        component_snapshot: null,
        is_new: true,
        is_deleted: false,
      });
      setShowProducts(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to add product');
    }
  }, [buildResolverInput, onAddProduct]);

  const handleAddBundle = useCallback((bundle: ProductBundleWithConfiguration) => {
    try {
      const input = buildResolverInput();
      const candidateLine: ResolverInputLine = {
        resolverKey: `new-bundle-${bundle.id}`,
        itemType: 'event_essential_bundle',
        qty: 1,
        bundleId: bundle.id,
      };
      input.lines.push(candidateLine);

      const result = resolveEventEssentialsPricing(input);
      const candidateResult = result.lines.find(l => l.resolverKey === candidateLine.resolverKey);
      if (!candidateResult || !candidateResult.selectable || candidateResult.resolvedUnitPriceCents === null) {
        setError(`Cannot resolve pricing for package "${bundle.name}". It may not be available for purchase.`);
        return;
      }

      const comps = bundle.product_bundle_components || [];
      const snapshot: BundleComponentSnapshot = {
        bundle_name: bundle.name,
        bundle_description: bundle.description || null,
        components: comps.map((c: any) => ({
          product_id: c.product_id,
          product_name: c.inventory_products?.name || 'Unknown Product',
          quantity_per_bundle: c.quantity_per_bundle,
        })),
      };

      onAddBundle({
        bundle_id: bundle.id,
        product_name: bundle.name,
        item_name: bundle.name,
        qty: 1,
        unit_price_cents: candidateResult.resolvedUnitPriceCents,
        pricing_context: candidateResult.resolvedPricingContext || 'standalone',
        component_snapshot: snapshot,
        is_new: true,
        is_deleted: false,
      });
      setShowBundles(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to add package');
    }
  }, [buildResolverInput, onAddBundle]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">Add Event Essentials</h3>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={() => { setShowProducts(!showProducts); setShowBundles(false); }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <ShoppingBag className="w-4 h-4" />
          Add Product
        </button>
        <button
          onClick={() => { setShowBundles(!showBundles); setShowProducts(false); }}
          className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Package className="w-4 h-4" />
          Add Package
        </button>
      </div>

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-600"></div>
          Loading catalog...
        </div>
      )}

      {showProducts && !loading && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <h4 className="font-medium text-slate-900 mb-3">Available Products</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
            {products.length > 0 ? products.map(product => {
              const pc = pricingConfigs[product.id];
              const price = pc?.standalone_price_cents || pc?.addon_price_cents || 0;
              return (
                <div key={product.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{product.name}</p>
                    <p className="text-xs text-slate-600">{formatCurrency(price)}</p>
                  </div>
                  <button
                    onClick={() => handleAddProduct(product)}
                    className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs py-1.5 px-3 rounded transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                </div>
              );
            }) : (
              <p className="text-slate-500 text-sm col-span-full text-center py-4">No products available</p>
            )}
          </div>
        </div>
      )}

      {showBundles && !loading && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <h4 className="font-medium text-slate-900 mb-3">Available Packages</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
            {bundles.length > 0 ? bundles.map(bundle => {
              const price = bundle.standalone_price_cents || bundle.addon_price_cents || 0;
              return (
                <div key={bundle.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{bundle.name}</p>
                    {bundle.description && <p className="text-xs text-slate-600">{bundle.description}</p>}
                    <p className="text-xs text-slate-600">{formatCurrency(price)}</p>
                  </div>
                  <button
                    onClick={() => handleAddBundle(bundle)}
                    className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs py-1.5 px-3 rounded transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                </div>
              );
            }) : (
              <p className="text-slate-500 text-sm col-span-full text-center py-4">No packages available</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
