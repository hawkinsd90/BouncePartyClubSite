import { useState, useEffect, useCallback } from 'react';
import { Plus, Package, ShoppingBag, Minus } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { resolveEventEssentialsPricing } from '../../lib/eventEssentialsPricing';
import type {
  ResolverInput,
  ResolverInputLine,
} from '../../lib/eventEssentialsPricingTypes';
import { buildGeneratorResolverCatalog } from '../admin/order-detail-modal/generatorResolverCatalog';
import { buildBundleSnapshot } from '../../lib/unifiedCart';
import type { BundleComponentSnapshot } from '../admin/OrderDetailModal';
import {
  loadAdminResolverCatalogRows,
  checkEventEssentialsAvailability,
} from '../../lib/queries/products';
import type { ProductBundleWithConfiguration } from '../../types';
import { PickerBanners, PickerSpinners, PickerHeader, PickerCategoryPills } from './add-event-essentials/PickerChrome';

interface AddEventEssentialsSectionProps {
  stagedItems: any[];
  availableUnits: any[];
  orderId: string | null;
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
  pricing_context?: 'standalone' | 'addon' | null;
  component_snapshot?: BundleComponentSnapshot | null;
  is_new: boolean;
  is_deleted: boolean;
}

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
      const { catsRes, prodsRes, pricingRes, bundlesRes } = await loadAdminResolverCatalogRows();

      if (catsRes.error) throw new Error(catsRes.error.message);
      if (prodsRes.error) throw new Error(prodsRes.error.message);
      if (pricingRes.error) throw new Error(pricingRes.error.message);
      if (bundlesRes.error) throw new Error(bundlesRes.error.message);

      const catMap: Record<string, any> = {};
      (catsRes.data || []).forEach((c: any) => { catMap[c.id] = c; });
      setCategories(catMap);

      setAllProducts(prodsRes.data || []);

      const filteredProducts = (prodsRes.data || []).filter((p: any) => p.active);
      setProducts(filteredProducts);

      // Diagnostic: verify Generator product and category are present at each stage.
      const genProduct = (prodsRes.data || []).find((p: any) => p.id === '82a67261-2b54-4704-a8a0-4d346d0a8e60');
      const genCategory = (catsRes.data || []).find((c: any) => c.id === 'd29347c8-78f7-48d6-aa01-c4d36f9912ea');
      console.log('[AddEventEssentialsSection] loadData results:', {
        totalProducts: (prodsRes.data || []).length,
        totalCategories: (catsRes.data || []).length,
        generatorProduct: genProduct ? { id: genProduct.id, name: genProduct.name, active: genProduct.active, category_id: genProduct.category_id } : 'NOT FOUND',
        generatorCategory: genCategory ? { id: genCategory.id, name: genCategory.name, slug: genCategory.slug, active: genCategory.active } : 'NOT FOUND',
        filteredProductIds: filteredProducts.map((p: any) => ({ id: p.id, name: p.name, category_id: p.category_id })),
        categoryIds: Object.keys(catMap),
      });

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
    const catalog = buildGeneratorResolverCatalog({
      productRows: allProducts,
      pricingRows: Object.values(pricingConfigs),
      categoryRows: Object.values(categories),
      bundleRows: allBundles,
      unitRows: availableUnits,
    });

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
      productConfigs: catalog.productConfigs,
      bundleConfigs: catalog.bundleConfigs,
      categories: catalog.categories,
      units: catalog.units,
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

  function resolveProductCandidate(product: any, qty: number) {
    if (qty < 1) return null;
    const input = buildResolverInput();
    const candidateLine: ResolverInputLine = {
      resolverKey: `new-product-${product.id}`,
      itemType: 'event_essential_product',
      qty,
      productId: product.id,
    };
    input.lines.push(candidateLine);
    const result = resolveEventEssentialsPricing(input);
    return result.lines.find(l => l.resolverKey === candidateLine.resolverKey) ?? null;
  }

  function resolveBundleCandidate(bundle: ProductBundleWithConfiguration, qty: number) {
    if (qty < 1) return null;
    const input = buildResolverInput();
    const candidateLine: ResolverInputLine = {
      resolverKey: `new-bundle-${bundle.id}`,
      itemType: 'event_essential_bundle',
      qty,
      bundleId: bundle.id,
    };
    input.lines.push(candidateLine);
    const result = resolveEventEssentialsPricing(input);
    return result.lines.find(l => l.resolverKey === candidateLine.resolverKey) ?? null;
  }

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
      const eeCheck = await checkEventEssentialsAvailability({
        items: projectedItems,
        eventDate,
        eventEndDate: eventEndDate || eventDate,
        excludeOrderId: orderId,
        requireDates: true,
      });
      if (!eeCheck.ok) {
        if (eeCheck.kind === 'invalid_requirement') {
          setAvailabilityError('Unable to verify availability. Please try again.');
        } else if (eeCheck.kind === 'missing_dates') {
          setAvailabilityError('Please select the event dates before adding Event Essentials.');
        } else {
          setAvailabilityError(eeCheck.error || 'That quantity is not available for the selected dates.');
        }
        return;
      }

      onAddProduct({
        product_id: product.id,
        product_name: product.name,
        item_name: product.name,
        qty,
        unit_price_cents: candidateResult.resolvedUnitPriceCents,
        pricing_context: candidateResult.resolvedPricingContext,
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
  }, [buildResolverInput, onAddProduct, stagedItems, eventDate, eventEndDate, orderId, productQtyInputs]);

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

      const snapshot: BundleComponentSnapshot = buildBundleSnapshot(bundle);

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
      const eeCheck = await checkEventEssentialsAvailability({
        items: projectedItems,
        eventDate,
        eventEndDate: eventEndDate || eventDate,
        excludeOrderId: orderId,
        requireDates: true,
      });
      if (!eeCheck.ok) {
        if (eeCheck.kind === 'invalid_requirement') {
          setAvailabilityError('Unable to verify availability. Please try again.');
        } else if (eeCheck.kind === 'missing_dates') {
          setAvailabilityError('Please select the event dates before adding Event Essentials.');
        } else {
          setAvailabilityError(eeCheck.error || 'That quantity is not available for the selected dates.');
        }
        return;
      }

      onAddBundle({
        bundle_id: bundle.id,
        product_name: bundle.name,
        item_name: bundle.name,
        qty,
        unit_price_cents: candidateResult.resolvedUnitPriceCents,
        pricing_context: candidateResult.resolvedPricingContext,
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
  }, [buildResolverInput, onAddBundle, stagedItems, eventDate, eventEndDate, orderId, bundleQtyInputs]);

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

      <PickerBanners error={error} availabilityError={availabilityError} />

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

      <PickerSpinners loading={loading} availabilityChecking={availabilityChecking} />

      {showProducts && !loading && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <PickerHeader title="Available Products" onDone={() => setShowProducts(false)} />

          {sortedCategories.length > 0 && (
            <PickerCategoryPills
              categories={sortedCategories}
              selectedCategoryId={selectedCategoryId}
              onSelect={setSelectedCategoryId}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
            {filteredProducts.length > 0 ? filteredProducts.map(product => {
              const qty = getProductQty(product.id);
              const candidate = resolveProductCandidate(product, qty);
              const priceCents = candidate?.resolvedUnitPriceCents ?? null;
              const context = candidate?.resolvedPricingContext ?? null;
              const selectable = !!candidate?.selectable && priceCents !== null && (context === 'standalone' || context === 'addon');
              return (
                <div key={product.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{product.name}</p>
                    {selectable ? (
                      <>
                        <p className="text-xs text-slate-600">{context === 'addon' ? 'Add-on price' : 'Standalone price'}</p>
                        <p className="text-xs text-slate-600">{formatCurrency(priceCents!)}</p>
                      </>
                    ) : (
                      <p className="text-xs text-amber-700">Not available for purchase</p>
                    )}
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
                        value={productQtyInputs[product.id] ?? '1'}
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
                      disabled={availabilityChecking || !selectable}
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
          <PickerHeader title="Available Packages" onDone={() => setShowBundles(false)} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
            {bundles.length > 0 ? bundles.map(bundle => {
              const qty = getBundleQty(bundle.id);
              const candidate = resolveBundleCandidate(bundle, qty);
              const priceCents = candidate?.resolvedUnitPriceCents ?? null;
              const context = candidate?.resolvedPricingContext ?? null;
              const selectable = !!candidate?.selectable && priceCents !== null && (context === 'standalone' || context === 'addon');
              return (
                <div key={bundle.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{bundle.name}</p>
                    {bundle.description && <p className="text-xs text-slate-600">{bundle.description}</p>}
                    {selectable ? (
                      <>
                        <p className="text-xs text-slate-600">{context === 'addon' ? 'Add-on price' : 'Standalone price'}</p>
                        <p className="text-xs text-slate-600">{formatCurrency(priceCents!)}</p>
                      </>
                    ) : (
                      <p className="text-xs text-amber-700">Not available for purchase</p>
                    )}
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
                        value={bundleQtyInputs[bundle.id] ?? '1'}
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
                      disabled={availabilityChecking || !selectable}
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
