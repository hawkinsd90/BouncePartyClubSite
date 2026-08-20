import { useState, useEffect, useCallback } from 'react';
import { Plus, Package, ShoppingBag, Minus, X } from 'lucide-react';
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
  checkProductAvailability,
} from '../../lib/queries/products';
import type { ProductBundleWithConfiguration } from '../../types';
import {
  buildEventEssentialAvailabilityRequestFromOrderItems,
  validateAvailabilityResult,
} from '../../lib/eeOrderItemAvailability';

interface AddEventEssentialsSectionProps {
  stagedItems: any[];
  availableUnits: any[];
  orderId: string;
  eventDate: string;
  eventEndDate?: string;
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

export function AddEventEssentialsSection({
  stagedItems,
  availableUnits,
  orderId,
  eventDate,
  eventEndDate,
  onAddProduct,
  onAddBundle,
}: AddEventEssentialsSectionProps) {
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
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [productQtyInputs, setProductQtyInputs] = useState<Record<string, string>>({});
  const [bundleQtyInputs, setBundleQtyInputs] = useState<Record<string, string>>({});
  const [availabilityChecking, setAvailabilityChecking] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

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

  const parseQty = (raw: string): number => {
    const trimmed = raw.trim();
    if (trimmed === '') return 0;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 0;
    return n;
  };

  const commitProductQty = (productId: string) => {
    const raw = productQtyInputs[productId] ?? '1';
    const qty = parseQty(raw);
    if (qty < 1) {
      setProductQtyInputs(prev => ({ ...prev, [productId]: '1' }));
    }
  };

  const commitBundleQty = (bundleId: string) => {
    const raw = bundleQtyInputs[bundleId] ?? '1';
    const qty = parseQty(raw);
    if (qty < 1) {
      setBundleQtyInputs(prev => ({ ...prev, [bundleId]: '1' }));
    }
  };

  const getProductQty = (productId: string): number => {
    const raw = productQtyInputs[productId] ?? '1';
    const qty = parseQty(raw);
    return qty >= 1 ? qty : 1;
  };

  const getBundleQty = (bundleId: string): number => {
    const raw = bundleQtyInputs[bundleId] ?? '1';
    const qty = parseQty(raw);
    return qty >= 1 ? qty : 1;
  };

  const handleAddProduct = useCallback(async (product: any) => {
    const qty = getProductQty(product.id);
    if (qty < 1) {
      setProductQtyInputs(prev => ({ ...prev, [product.id]: '1' }));
      return;
    }
    setAvailabilityChecking(true);
    setAvailabilityError(null);
    try {
      const input = buildResolverInput();
      const candidateLine: ResolverInputLine = {
        resolverKey: `new-product-${product.id}`,
        itemType: 'event_essential_product',
        qty,
        productId: product.id,
      };
      input.lines.push(candidateLine);

      const result = resolveEventEssentialsPricing(input);
      const candidateResult = result.lines.find(l => l.resolverKey === candidateLine.resolverKey);
      if (!candidateResult || !candidateResult.selectable || candidateResult.resolvedUnitPriceCents === null) {
        setError(`Cannot resolve pricing for "${product.name}". It may not be available for purchase.`);
        return;
      }

      // Availability check: build the COMPLETE resulting staged requirement.
      const projectedItems = [
        ...stagedItems.filter((i: any) => !i.is_deleted),
        {
          product_id: product.id,
          qty,
          unit_id: null,
          bundle_id: null,
          component_snapshot: null,
        },
      ];
      const expansion = buildEventEssentialAvailabilityRequestFromOrderItems(projectedItems);
      if (expansion.status !== 'ready') {
        setAvailabilityError('Unable to verify availability. Please try again.');
        return;
      }
      if (eventDate && eventEndDate) {
        const availResult = await checkProductAvailability(
          expansion.productQuantities,
          eventDate,
          eventEndDate,
          orderId,
        );
        const validation = validateAvailabilityResult(
          expansion.productQuantities.map(p => p.product_id),
          availResult,
        );
        if (!validation.ok) {
          setAvailabilityError(validation.error || 'That quantity is not available for the selected dates.');
          return;
        }
      }

      onAddProduct({
        product_id: product.id,
        product_name: product.name,
        item_name: product.name,
        qty,
        unit_price_cents: candidateResult.resolvedUnitPriceCents,
        pricing_context: candidateResult.resolvedPricingContext || 'standalone',
        component_snapshot: null,
        is_new: true,
        is_deleted: false,
      });
      // Reset only the quantity input for this product; keep picker open.
      setProductQtyInputs(prev => ({ ...prev, [product.id]: '1' }));
    } catch (err: any) {
      setAvailabilityError(err?.message || 'Failed to add product');
    } finally {
      setAvailabilityChecking(false);
    }
  }, [buildResolverInput, onAddProduct, stagedItems, eventDate, eventEndDate, orderId]);

  const handleAddBundle = useCallback(async (bundle: ProductBundleWithConfiguration) => {
    const qty = getBundleQty(bundle.id);
    if (qty < 1) {
      setBundleQtyInputs(prev => ({ ...prev, [bundle.id]: '1' }));
      return;
    }
    setAvailabilityChecking(true);
    setAvailabilityError(null);
    try {
      const input = buildResolverInput();
      const candidateLine: ResolverInputLine = {
        resolverKey: `new-bundle-${bundle.id}`,
        itemType: 'event_essential_bundle',
        qty,
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

      // Availability check: build the COMPLETE resulting staged requirement.
      const projectedItems = [
        ...stagedItems.filter((i: any) => !i.is_deleted),
        {
          bundle_id: bundle.id,
          qty,
          unit_id: null,
          product_id: null,
          component_snapshot: snapshot,
        },
      ];
      const expansion = buildEventEssentialAvailabilityRequestFromOrderItems(projectedItems);
      if (expansion.status !== 'ready') {
        setAvailabilityError('Unable to verify availability. Please try again.');
        return;
      }
      if (eventDate && eventEndDate) {
        const availResult = await checkProductAvailability(
          expansion.productQuantities,
          eventDate,
          eventEndDate,
          orderId,
        );
        const validation = validateAvailabilityResult(
          expansion.productQuantities.map(p => p.product_id),
          availResult,
        );
        if (!validation.ok) {
          setAvailabilityError(validation.error || 'That quantity is not available for the selected dates.');
          return;
        }
      }

      onAddBundle({
        bundle_id: bundle.id,
        product_name: bundle.name,
        item_name: bundle.name,
        qty,
        unit_price_cents: candidateResult.resolvedUnitPriceCents,
        pricing_context: candidateResult.resolvedPricingContext || 'standalone',
        component_snapshot: snapshot,
        is_new: true,
        is_deleted: false,
      });
      setBundleQtyInputs(prev => ({ ...prev, [bundle.id]: '1' }));
    } catch (err: any) {
      setAvailabilityError(err?.message || 'Failed to add package');
    } finally {
      setAvailabilityChecking(false);
    }
  }, [buildResolverInput, onAddBundle, stagedItems, eventDate, eventEndDate, orderId]);

  // Build the list of active categories that have at least one product in the picker.
  const activeCategoryIds = Array.from(new Set(products.map(p => p.category_id).filter(Boolean)));
  const sortedCategories = activeCategoryIds
    .map(id => categories[id])
    .filter(Boolean)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));

  const filteredProducts = selectedCategoryId
    ? products.filter(p => p.category_id === selectedCategoryId)
    : products;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">Add Event Essentials</h3>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {availabilityError && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-800">{availabilityError}</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={() => { setShowProducts(true); setShowBundles(false); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            showProducts ? 'bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          Add Product
        </button>
        <button
          onClick={() => { setShowBundles(true); setShowProducts(false); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            showBundles ? 'bg-teal-700 text-white' : 'bg-teal-600 hover:bg-teal-700 text-white'
          }`}
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

      {availabilityChecking && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-600"></div>
          Checking availability...
        </div>
      )}

      {showProducts && !loading && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-slate-900">Available Products</h4>
            <button
              onClick={() => setShowProducts(false)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              <X className="w-3 h-3" />
              Done
            </button>
          </div>

          {sortedCategories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              <button
                onClick={() => setSelectedCategoryId(null)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedCategoryId === null
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                All
              </button>
              {sortedCategories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedCategoryId === cat.id
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
            {filteredProducts.length > 0 ? filteredProducts.map(product => {
              const pc = pricingConfigs[product.id];
              const price = pc?.standalone_price_cents || pc?.addon_price_cents || 0;
              const qty = productQtyInputs[product.id] ?? '1';
              return (
                <div key={product.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{product.name}</p>
                    <p className="text-xs text-slate-600">{formatCurrency(price)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setProductQtyInputs(prev => ({ ...prev, [product.id]: String(Math.max(1, (parseQty(prev[product.id] ?? '1') || 1) - 1)) }))}
                        className="w-6 h-6 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                        title="Decrease quantity"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={qty}
                        onChange={e => setProductQtyInputs(prev => ({ ...prev, [product.id]: e.target.value }))}
                        onBlur={() => commitProductQty(product.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitProductQty(product.id); }}
                        className="w-12 px-1 py-1 text-center text-sm font-semibold text-slate-900 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                        aria-label={`Quantity for ${product.name}`}
                      />
                      <button
                        type="button"
                        onClick={() => setProductQtyInputs(prev => ({ ...prev, [product.id]: String((parseQty(prev[product.id] ?? '1') || 1) + 1) }))}
                        className="w-6 h-6 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                        title="Increase quantity"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <button
                      onClick={() => void handleAddProduct(product)}
                      disabled={availabilityChecking}
                      className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs py-1.5 px-3 rounded transition-colors disabled:opacity-50"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </div>
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
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-slate-900">Available Packages</h4>
            <button
              onClick={() => setShowBundles(false)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              <X className="w-3 h-3" />
              Done
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
            {bundles.length > 0 ? bundles.map(bundle => {
              const price = bundle.standalone_price_cents || bundle.addon_price_cents || 0;
              const qty = bundleQtyInputs[bundle.id] ?? '1';
              return (
                <div key={bundle.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{bundle.name}</p>
                    {bundle.description && <p className="text-xs text-slate-600">{bundle.description}</p>}
                    <p className="text-xs text-slate-600">{formatCurrency(price)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setBundleQtyInputs(prev => ({ ...prev, [bundle.id]: String(Math.max(1, (parseQty(prev[bundle.id] ?? '1') || 1) - 1)) }))}
                        className="w-6 h-6 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                        title="Decrease quantity"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={qty}
                        onChange={e => setBundleQtyInputs(prev => ({ ...prev, [bundle.id]: e.target.value }))}
                        onBlur={() => commitBundleQty(bundle.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitBundleQty(bundle.id); }}
                        className="w-12 px-1 py-1 text-center text-sm font-semibold text-slate-900 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                        aria-label={`Quantity for ${bundle.name}`}
                      />
                      <button
                        type="button"
                        onClick={() => setBundleQtyInputs(prev => ({ ...prev, [bundle.id]: String((parseQty(prev[bundle.id] ?? '1') || 1) + 1) }))}
                        className="w-6 h-6 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                        title="Increase quantity"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <button
                      onClick={() => void handleAddBundle(bundle)}
                      disabled={availabilityChecking}
                      className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs py-1.5 px-3 rounded transition-colors disabled:opacity-50"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </div>
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


export { AddEventEssentialsSection }