import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package,
  Calendar,
  ShoppingCart,
  AlertCircle,
  Loader2,
  Plus,
  Minus,
  Lock,
  ImageOff,
  Tag,
  LayoutGrid,
} from 'lucide-react';
import { getPublicBusinessSettings } from '../lib/adminSettingsCache';
import { SafeStorage } from '../lib/safeStorage';
import {
  fetchProductBundlesWithComponents,
  fetchProductPricing,
  fetchProductCategories,
  fetchInventoryProductsByCategory,
  fetchInventoryProducts,
  checkProductAvailability,
} from '../lib/queries/products';
import { useQuoteCart } from '../hooks/useQuoteCart';
import {
  buildBundleSnapshot,
  expandCartToProductQuantities,
  isInflatableCartItem,
  isEventEssentialProductCartItem,
  isEventEssentialBundleCartItem,
} from '../lib/unifiedCart';
import type {
  ProductBundleWithComponents,
  ProductPricing,
  ProductCategory,
  InventoryProduct,
  ProductAvailabilityResult,
  ProductAvailabilityRequestItem,
  EventEssentialProductCartItem,
  EventEssentialBundleCartItem,
  PricingContext,
  UnifiedCartItem,
} from '../types';
import type { QuoteFormData } from '../hooks/useQuoteForm';

const FORM_STORAGE_KEY = 'bpc_quote_form';

function getDefaultFormData(): Partial<QuoteFormData> {
  return {
    event_date: '',
    event_end_date: '',
  };
}

type ProductAvailabilityMap = Record<
  string,
  { available_before_request: number; maxAddable: number; error: boolean }
>;

function formatPrice(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function EventEssentialsCatalog() {
  const navigate = useNavigate();
  const { cart, addToCart } = useQuoteCart();

  const [enabled, setEnabled] = useState(false);
  const [minOrderCents, setMinOrderCents] = useState<number | null>(null);
  const [bundles, setBundles] = useState<ProductBundleWithComponents[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string>('all');
  const [categoryProducts, setCategoryProducts] = useState<InventoryProduct[]>([]);
  const [allProducts, setAllProducts] = useState<InventoryProduct[]>([]);
  const [allPricing, setAllPricing] = useState<ProductPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [eventDate, setEventDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [productAvailability, setProductAvailability] = useState<ProductAvailabilityMap>({});
  const [availabilityError, setAvailabilityError] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  const [addError, setAddError] = useState<string | null>(null);
  const addingRef = useRef(false);
  const availabilityRequestId = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const settings = await getPublicBusinessSettings();
        if (cancelled) return;

        if (!settings.event_essentials_page_enabled) {
          if (!cancelled) {
            navigate('/catalog', { replace: true });
          }
          return;
        }

        setEnabled(true);
        setMinOrderCents(settings.min_event_essentials_order_cents);

        const [bundlesResult, categoriesResult, pricingResult] = await Promise.all([
          fetchProductBundlesWithComponents(),
          fetchProductCategories(),
          fetchProductPricing(),
        ]);

        if (cancelled) return;

        if (bundlesResult.error || categoriesResult.error || pricingResult.error) {
          setError('Failed to load catalog. Please try again later.');
          setLoading(false);
          return;
        }

        setBundles(bundlesResult.data ?? []);
        const cats = categoriesResult.data ?? [];
        setCategories(cats);
        setAllPricing(pricingResult.data ?? []);

        // Load all public products upfront for the "All" filter
        const allProductsResult = await fetchInventoryProducts();
        if (cancelled) return;
        if (allProductsResult.error) {
          setError('Failed to load catalog. Please try again later.');
          setLoading(false);
          return;
        }
        setAllProducts(allProductsResult.data ?? []);

        // Default to All — shows every qualifying public product across categories
        setSelectedCategoryKey('all');

        setLoading(false);
      } catch {
        if (!cancelled) {
          setError('Failed to load Event Essentials. Please try again later.');
          setLoading(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    const saved = SafeStorage.getItem<QuoteFormData>(FORM_STORAGE_KEY, { expirationDays: 7 });
    if (saved) {
      setEventDate(saved.event_date || '');
      setEventEndDate(saved.event_end_date || '');
    }
  }, []);

  function persistDates(date: string, endDate: string) {
    const current = SafeStorage.getItem<QuoteFormData>(FORM_STORAGE_KEY, { expirationDays: 7 });
    const merged = {
      ...(current ?? (getDefaultFormData() as QuoteFormData)),
      event_date: date,
      event_end_date: endDate,
    };
    SafeStorage.setItem(FORM_STORAGE_KEY, merged, { expirationDays: 7 });
  }

  function handleDateChange(newDate: string) {
    setEventDate(newDate);
    let newEndDate = eventEndDate;
    if (!newEndDate || newEndDate < newDate) {
      newEndDate = newDate;
      setEventEndDate(newDate);
    }
    persistDates(newDate, newEndDate);
  }

  function handleEndDateChange(newEndDate: string) {
    if (!newEndDate || newEndDate < eventDate) {
      newEndDate = eventDate;
    }
    setEventEndDate(newEndDate);
    persistDates(eventDate, newEndDate);
  }

  // Build the set of category IDs that have at least one qualifying public product.
  // A category tab is hidden when it contains zero qualifying public products.
  // A product qualifies when: active=true, public_visible=true, category_id is not null,
  // and the category exists, is active, and is public_visible.
  const visibleCategoryIds = useMemo(() => {
    const validCategoryIds = new Set(
      categories.filter((c) => c.active && c.public_visible).map((c) => c.id)
    );
    const result = new Set<string>();
    for (const product of allProducts) {
      if (
        product.active &&
        product.public_visible &&
        product.category_id &&
        validCategoryIds.has(product.category_id)
      ) {
        result.add(product.category_id);
      }
    }
    return result;
  }, [allProducts, categories]);

  // Categories to display as tabs: All first, then DB categories with qualifying products
  const visibleCategories = useMemo(
    () => categories.filter((c) => visibleCategoryIds.has(c.id)),
    [categories, visibleCategoryIds],
  );

  // Products to display based on the selected filter
  const displayProducts = useMemo(() => {
    if (selectedCategoryKey === 'all') {
      const validCategoryIds = new Set(
        categories.filter((c) => c.active && c.public_visible).map((c) => c.id)
      );
      return allProducts.filter(
        (p) =>
          p.active &&
          p.public_visible &&
          p.category_id !== null &&
          validCategoryIds.has(p.category_id),
      );
    }
    return categoryProducts;
  }, [selectedCategoryKey, allProducts, categories, categoryProducts]);

  useEffect(() => {
    if (selectedCategoryKey === 'all') {
      setCategoryProducts([]);
      setLoadingProducts(false);
      return;
    }

    let cancelled = false;
    setLoadingProducts(true);

    async function loadProducts() {
      const result = await fetchInventoryProductsByCategory(selectedCategoryKey);
      if (cancelled) return;
      if (result.error) {
        setCategoryProducts([]);
      } else {
        setCategoryProducts(result.data ?? []);
      }
      setLoadingProducts(false);
    }

    loadProducts();
    return () => {
      cancelled = true;
    };
  }, [selectedCategoryKey]);

  const pricingByProductId = useMemo(() => {
    const map = new Map<string, ProductPricing>();
    for (const p of allPricing) {
      map.set(p.product_id, p);
    }
    return map;
  }, [allPricing]);

  const eventEssentialsCartItems = useMemo(
    () =>
      cart.filter(
        (item) => isEventEssentialProductCartItem(item) || isEventEssentialBundleCartItem(item)
      ) as (EventEssentialProductCartItem | EventEssentialBundleCartItem)[],
    [cart]
  );

  const hasQualifyingInflatable = useMemo(
    () => cart.some((item) => isInflatableCartItem(item) && item.qty > 0),
    [cart]
  );

  function resolveProductPrice(
    product: InventoryProduct
  ): {
    unitPriceCents: number;
    pricingContext: PricingContext;
    blocked: boolean;
    blockReason?: string;
  } | null {
    const pricing = pricingByProductId.get(product.id);
    if (!pricing) return null;

    if (hasQualifyingInflatable) {
      if (pricing.addon_enabled && pricing.addon_price_cents != null) {
        return {
          unitPriceCents: pricing.addon_price_cents,
          pricingContext: 'addon',
          blocked: false,
        };
      }
      if (pricing.standalone_enabled && pricing.standalone_price_cents != null) {
        return {
          unitPriceCents: pricing.standalone_price_cents,
          pricingContext: 'standalone',
          blocked: false,
        };
      }
      return null;
    }

    if (pricing.standalone_enabled && pricing.standalone_price_cents != null) {
      return {
        unitPriceCents: pricing.standalone_price_cents,
        pricingContext: 'standalone',
        blocked: false,
      };
    }

    if (pricing.addon_enabled && pricing.addon_price_cents != null) {
      return {
        unitPriceCents: pricing.addon_price_cents,
        pricingContext: 'addon',
        blocked: true,
        blockReason: 'Available as an add-on with inflatable rental',
      };
    }

    return null;
  }

  function getBundlePrice(bundle: ProductBundleWithComponents): {
    unitPriceCents: number;
    isAddon: boolean;
    blocked: boolean;
    blockReason?: string;
  } | null {
    if (hasQualifyingInflatable) {
      if (bundle.addon_enabled && bundle.addon_price_cents != null) {
        return { unitPriceCents: bundle.addon_price_cents, isAddon: true, blocked: false };
      }
      if (bundle.standalone_enabled && bundle.standalone_price_cents != null) {
        return { unitPriceCents: bundle.standalone_price_cents, isAddon: false, blocked: false };
      }
      return null;
    }

    if (bundle.standalone_enabled && bundle.standalone_price_cents != null) {
      return { unitPriceCents: bundle.standalone_price_cents, isAddon: false, blocked: false };
    }

    if (bundle.addon_enabled && bundle.addon_price_cents != null) {
      return {
        unitPriceCents: bundle.addon_price_cents,
        isAddon: true,
        blocked: true,
        blockReason: 'Add an inflatable to unlock this package.',
      };
    }

    return null;
  }

  const runAvailabilityPreview = useCallback(
    async (date: string, endDate: string, products: InventoryProduct[], cartItems: UnifiedCartItem[]) => {
      const currentRequestId = ++availabilityRequestId.current;

      if (!date || !endDate) {
        setProductAvailability({});
        setAvailabilityError(false);
        setCheckingAvailability(false);
        return;
      }

      setCheckingAvailability(true);
      setAvailabilityError(false);

      try {
        const eeItems = cartItems.filter(
          (item) => isEventEssentialProductCartItem(item) || isEventEssentialBundleCartItem(item)
        ) as (EventEssentialProductCartItem | EventEssentialBundleCartItem)[];

        const cartDemand = new Map<string, number>();
        const expanded = expandCartToProductQuantities(eeItems);
        for (const item of expanded) {
          cartDemand.set(item.product_id, (cartDemand.get(item.product_id) ?? 0) + item.quantity);
        }

        const requestProductIds = new Set<string>();
        for (const product of products) {
          requestProductIds.add(product.id);
        }
        for (const [pid] of cartDemand) {
          requestProductIds.add(pid);
        }

        const requestItems: ProductAvailabilityRequestItem[] = [];
        for (const pid of requestProductIds) {
          const demand = cartDemand.get(pid) ?? 0;
          requestItems.push({
            product_id: pid,
            quantity: Math.max(1, demand),
          });
        }

        if (requestItems.length === 0) {
          if (currentRequestId !== availabilityRequestId.current) return;
          setProductAvailability({});
          return;
        }

        const result = await checkProductAvailability(requestItems, date, endDate, null);

        if (currentRequestId !== availabilityRequestId.current) return;

        if (result.error) {
          setAvailabilityError(true);
          setProductAvailability({});
          return;
        }

        const results = result.data ?? [];
        const resultMap = new Map<string, ProductAvailabilityResult>();
        for (const r of results) {
          resultMap.set(r.product_id, r);
        }

        const availMap: ProductAvailabilityMap = {};
        for (const product of products) {
          const found = resultMap.get(product.id);
          if (!found) {
            availMap[product.id] = { available_before_request: 0, maxAddable: 0, error: true };
            continue;
          }
          const demand = cartDemand.get(product.id) ?? 0;
          const maxAddable = Math.max(0, found.available_before_request - demand);
          availMap[product.id] = {
            available_before_request: found.available_before_request,
            maxAddable,
            error: false,
          };
        }

        setProductAvailability(availMap);
      } catch {
        if (currentRequestId !== availabilityRequestId.current) return;
        setAvailabilityError(true);
        setProductAvailability({});
      } finally {
        if (currentRequestId === availabilityRequestId.current) {
          setCheckingAvailability(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    runAvailabilityPreview(eventDate, eventEndDate, displayProducts, cart);
  }, [eventDate, eventEndDate, displayProducts, cart, runAvailabilityPreview]);

  function getQty(key: string): number {
    return quantities[key] ?? 0;
  }

  function incrementQty(key: string, max: number) {
    setQuantities((prev) => ({
      ...prev,
      [key]: Math.min(max, (prev[key] ?? 0) + 1),
    }));
  }

  function decrementQty(key: string) {
    setQuantities((prev) => ({
      ...prev,
      [key]: Math.max(0, (prev[key] ?? 0) - 1),
    }));
  }

  function setQty(key: string, value: string, max: number) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      setQuantities((prev) => ({ ...prev, [key]: 0 }));
      return;
    }
    setQuantities((prev) => ({
      ...prev,
      [key]: Math.max(0, Math.min(max, parsed)),
    }));
  }

  async function handleAddProduct(product: InventoryProduct) {
    const key = `product-${product.id}`;
    const qty = getQty(key);
    if (qty <= 0) return;

    setAddError(null);

    const priceInfo = resolveProductPrice(product);
    if (!priceInfo) {
      setAddError('Pricing not yet configured for this product.');
      return;
    }

    if (priceInfo.blocked) {
      setAddError(priceInfo.blockReason || 'This product requires an inflatable in your cart.');
      return;
    }

    if (!eventDate || !eventEndDate) {
      setAddError('Please select event dates before adding items to your cart.');
      return;
    }

    if (addingRef.current) return;
    addingRef.current = true;

    try {
      const proposedItem: EventEssentialProductCartItem = {
        item_type: 'event_essential_product',
        product_id: product.id,
        product_name: product.name,
        qty,
        unit_price_cents: priceInfo.unitPriceCents,
        pricing_context: priceInfo.pricingContext,
        isAvailable: true,
      };

      const existingEEItems = cart.filter(
        (item) => isEventEssentialProductCartItem(item) || isEventEssentialBundleCartItem(item)
      ) as (EventEssentialProductCartItem | EventEssentialBundleCartItem)[];

      const proposedAllocation = expandCartToProductQuantities([...existingEEItems, proposedItem]);

      const requestItems: ProductAvailabilityRequestItem[] = proposedAllocation.map((a) => ({
        product_id: a.product_id,
        quantity: Math.max(1, a.quantity),
      }));

      const result = await checkProductAvailability(requestItems, eventDate, eventEndDate, null);

      if (result.error) {
        setAddError('Unable to check availability right now. Please try again.');
        return;
      }

      const results = result.data ?? [];
      const resultMap = new Map<string, ProductAvailabilityResult>();
      for (const r of results) {
        resultMap.set(r.product_id, r);
      }

      const unavailable: string[] = [];
      for (const alloc of proposedAllocation) {
        const found = resultMap.get(alloc.product_id);
        if (!found) {
          setAddError('Unable to check availability right now. Please try again.');
          return;
        }
        if (found.is_allowed !== true) {
          const productEntry = displayProducts.find((p) => p.id === alloc.product_id);
          unavailable.push(productEntry?.name ?? alloc.product_id);
        }
      }

      if (unavailable.length > 0) {
        setAddError(
          `Insufficient inventory for: ${unavailable.join(', ')}. Please choose different dates or reduce quantities.`
        );
        return;
      }

      addToCart(proposedItem);
      setQuantities((prev) => ({ ...prev, [key]: 0 }));
    } catch {
      setAddError('Unable to check availability right now. Please try again.');
    } finally {
      addingRef.current = false;
    }
  }

  async function handleAddBundle(bundle: ProductBundleWithComponents) {
    const key = `bundle-${bundle.id}`;
    const qty = getQty(key);
    if (qty <= 0) return;

    setAddError(null);

    const priceInfo = getBundlePrice(bundle);
    if (!priceInfo) {
      setAddError('Pricing not available for this bundle.');
      return;
    }

    if (priceInfo.blocked) {
      setAddError(priceInfo.blockReason || 'This package requires an inflatable in your cart.');
      return;
    }

    if (!eventDate || !eventEndDate) {
      setAddError('Please select event dates before adding items to your cart.');
      return;
    }

    if (addingRef.current) return;
    addingRef.current = true;

    try {
      const pricingContext: PricingContext = priceInfo.isAddon ? 'addon' : 'standalone';

      const proposedItem: EventEssentialBundleCartItem = {
        item_type: 'event_essential_bundle',
        bundle_id: bundle.id,
        bundle_name: bundle.name,
        unit_price_cents: priceInfo.unitPriceCents,
        qty,
        pricing_context: pricingContext,
        component_snapshot: buildBundleSnapshot(bundle),
      };

      const existingEEItems = cart.filter(
        (item) => isEventEssentialProductCartItem(item) || isEventEssentialBundleCartItem(item)
      ) as (EventEssentialProductCartItem | EventEssentialBundleCartItem)[];

      const proposedAllocation = expandCartToProductQuantities([...existingEEItems, proposedItem]);

      const requestItems: ProductAvailabilityRequestItem[] = proposedAllocation.map((a) => ({
        product_id: a.product_id,
        quantity: Math.max(1, a.quantity),
      }));

      const result = await checkProductAvailability(requestItems, eventDate, eventEndDate, null);

      if (result.error) {
        setAddError('Unable to check availability right now. Please try again.');
        return;
      }

      const results = result.data ?? [];
      const resultMap = new Map<string, ProductAvailabilityResult>();
      for (const r of results) {
        resultMap.set(r.product_id, r);
      }

      const unavailableNames: string[] = [];
      for (const alloc of proposedAllocation) {
        const found = resultMap.get(alloc.product_id);
        if (!found) {
          setAddError('Unable to check availability right now. Please try again.');
          return;
        }
        if (found.is_allowed !== true) {
          unavailableNames.push(found.product_name || 'Unknown product');
        }
      }

      if (unavailableNames.length > 0) {
        setAddError(
          `Cannot add "${bundle.name}" — insufficient inventory for: ${unavailableNames.join(', ')}. Please choose different dates or reduce quantities.`
        );
        return;
      }

      addToCart(proposedItem);
      setQuantities((prev) => ({ ...prev, [key]: 0 }));
    } catch {
      setAddError('Unable to check availability right now. Please try again.');
    } finally {
      addingRef.current = false;
    }
  }

  const eventEssentialsSubtotalCents = eventEssentialsCartItems.reduce(
    (sum, item) => sum + item.unit_price_cents * item.qty,
    0
  );

  function getRelevantBundlesForCategory(category: ProductCategory | null): ProductBundleWithComponents[] {
    // When All is selected, show all bundles — do not duplicate them per category.
    if (!category) return bundles;
    return bundles.filter((bundle) =>
      bundle.product_bundle_components.some(
        (comp) => comp.inventory_products?.category_id === category.id
      )
    );
  }

  const relevantBundles = getRelevantBundlesForCategory(
    selectedCategoryKey === 'all'
      ? null
      : categories.find((c) => c.id === selectedCategoryKey) ?? null
  );

  if (!enabled && !loading) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-slate-700 mb-4">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-blue-600 hover:text-blue-700 font-semibold"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8 sm:py-12">
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-2">Event Essentials</h1>
          <p className="text-slate-600 text-sm sm:text-base">
            Add tables, chairs, and other essentials to complement your inflatable rental.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Event Date Selector */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
              <div className="flex items-center gap-3 mb-4">
                <Calendar className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold text-slate-900">Event Dates</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="event-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Start Date
                  </label>
                  <input
                    id="event-date"
                    type="date"
                    value={eventDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="event-end-date" className="block text-xs font-medium text-slate-700 mb-1">
                    End Date
                  </label>
                  <input
                    id="event-end-date"
                    type="date"
                    value={eventEndDate}
                    onChange={(e) => handleEndDateChange(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              {(!eventDate || !eventEndDate) && (
                <p className="mt-3 text-xs text-amber-700 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  Select event dates to check availability and add items to your cart.
                </p>
              )}
              {addError && (
                <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {addError}
                </p>
              )}
            </div>

            {/* Category Navigation */}
            {(visibleCategories.length > 0 || selectedCategoryKey === 'all') && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
                <div className="flex flex-wrap gap-2">
                  <button
                    key="all"
                    type="button"
                    onClick={() => setSelectedCategoryKey('all')}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                      selectedCategoryKey === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                    All
                  </button>
                  {visibleCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setSelectedCategoryKey(category.id)}
                      className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                        selectedCategoryKey === category.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Individual Product Cards */}
            {loadingProducts ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              </div>
            ) : displayProducts.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
                <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600">No products are currently available in this category.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {displayProducts.map((product) => {
                  const key = `product-${product.id}`;
                  const qty = getQty(key);
                  const priceInfo = resolveProductPrice(product);
                  const avail = productAvailability[product.id];
                  const datesSelected = !!eventDate && !!eventEndDate;
                  const maxAddable = avail?.maxAddable ?? 0;
                  const hasAvailError = avail?.error ?? availabilityError;
                  const isBlocked = priceInfo?.blocked ?? false;
                  const canAdd =
                    datesSelected &&
                    !hasAvailError &&
                    !!priceInfo &&
                    !priceInfo.blocked &&
                    qty > 0 &&
                    maxAddable > 0;

                  return (
                    <div
                      key={product.id}
                      className={`bg-white rounded-xl shadow-sm border p-4 sm:p-5 transition-shadow ${
                        isBlocked ? 'border-slate-200 opacity-75' : 'border-slate-200 hover:shadow-md'
                      }`}
                    >
                      {/* Product image or placeholder */}
                      <div className="mb-3 aspect-video rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.currentTarget;
                              target.style.display = 'none';
                              target.nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                        ) : null}
                        {(!product.image_url) && (
                          <div className="flex flex-col items-center justify-center text-slate-400">
                            <ImageOff className="w-8 h-8 mb-1" />
                            <span className="text-xs">No image</span>
                          </div>
                        )}
                        {product.image_url && (
                          <div className="hidden flex-col items-center justify-center text-slate-400">
                            <ImageOff className="w-8 h-8 mb-1" />
                            <span className="text-xs">No image</span>
                          </div>
                        )}
                      </div>

                      <h3 className="text-base font-bold text-slate-900 mb-1">{product.name}</h3>
                      {product.description && (
                        <p className="text-sm text-slate-600 mb-3">{product.description}</p>
                      )}

                      {/* Price */}
                      {priceInfo && !priceInfo.blocked ? (
                        <p className="text-lg font-bold text-blue-700 mb-2">
                          {formatPrice(priceInfo.unitPriceCents)}
                          <span className="text-xs font-normal text-slate-500 ml-1">per unit</span>
                        </p>
                      ) : priceInfo?.blocked ? (
                        <p className="text-sm text-amber-700 flex items-center gap-1.5 mb-2">
                          <Lock className="w-4 h-4 flex-shrink-0" />
                          {priceInfo.blockReason}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-500 mb-2">Pricing not yet configured</p>
                      )}

                      {/* Availability status */}
                      {!datesSelected ? (
                        <p className="text-xs text-slate-500 mb-3">Select dates to check availability.</p>
                      ) : hasAvailError ? (
                        <p className="text-xs text-amber-700 mb-3">
                          Availability unavailable — please try again.
                        </p>
                      ) : checkingAvailability ? (
                        <p className="text-xs text-slate-400 flex items-center gap-1.5 mb-3">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Checking availability...
                        </p>
                      ) : avail ? (
                        <p className="text-xs text-slate-600 mb-3">
                          {maxAddable > 0
                            ? `${maxAddable} available to add`
                            : 'None available for selected dates'}
                        </p>
                      ) : null}

                      {/* Quantity selector and Add button */}
                      <div className="flex items-center justify-between gap-3 mt-auto">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => decrementQty(key)}
                            className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
                            disabled={qty <= 0}
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={maxAddable}
                            value={qty}
                            onChange={(e) => setQty(key, e.target.value, maxAddable)}
                            className="w-12 text-center font-semibold text-slate-900 text-sm border border-slate-300 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => incrementQty(key, maxAddable)}
                            className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
                            disabled={!datesSelected || hasAvailError || qty >= maxAddable}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddProduct(product)}
                          disabled={!canAdd}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ShoppingCart className="w-4 h-4" />
                          Add
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Package Suggestions (secondary) */}
            {relevantBundles.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 pt-4">
                  <Tag className="w-5 h-5 text-slate-400" />
                  <h2 className="text-lg font-bold text-slate-700">Package Suggestions</h2>
                </div>
                {relevantBundles.map((bundle) => {
                  const key = `bundle-${bundle.id}`;
                  const qty = getQty(key);
                  const priceInfo = getBundlePrice(bundle);
                  const isAddon = priceInfo?.isAddon ?? false;
                  const isBlocked = priceInfo?.blocked ?? false;
                  const hasPricing = !!priceInfo;

                  return (
                    <div
                      key={bundle.id}
                      className={`bg-white rounded-xl shadow-sm border p-4 sm:p-5 transition-shadow ${
                        isBlocked ? 'border-slate-200 opacity-75' : 'border-slate-200 hover:shadow-md'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="text-base font-bold text-slate-900">{bundle.name}</h3>
                            {isAddon && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                Add-on
                              </span>
                            )}
                          </div>
                          {bundle.description && (
                            <p className="text-sm text-slate-600 mb-2">{bundle.description}</p>
                          )}
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {bundle.product_bundle_components.map((comp) => (
                              <span
                                key={comp.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-xs text-slate-700"
                              >
                                {comp.inventory_products?.name ?? 'Unknown'} × {comp.quantity_per_bundle}
                              </span>
                            ))}
                          </div>
                          {hasPricing ? (
                            <p className="text-base font-bold text-blue-700">{formatPrice(priceInfo!.unitPriceCents)}</p>
                          ) : (
                            <p className="text-base font-bold text-slate-400">Pricing not available</p>
                          )}
                          {isBlocked && (
                            <p className="mt-2 text-sm text-amber-700 flex items-center gap-1.5">
                              <Lock className="w-4 h-4 flex-shrink-0" />
                              {priceInfo?.blockReason}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col items-stretch sm:items-end gap-2 sm:min-w-[130px]">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => decrementQty(key)}
                              className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
                              disabled={qty <= 0}
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <input
                              type="number"
                              min={0}
                              value={qty}
                              onChange={(e) => setQty(key, e.target.value, 99)}
                              disabled={!hasPricing}
                              className="w-12 text-center font-semibold text-slate-900 text-sm border border-slate-300 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                            />
                            <button
                              type="button"
                              onClick={() => incrementQty(key, 99)}
                              className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
                              disabled={!hasPricing}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddBundle(bundle)}
                            disabled={qty <= 0 || isBlocked || !hasPricing || !eventDate || !eventEndDate}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <ShoppingCart className="w-4 h-4" />
                            Add Package
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cart Summary Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 lg:sticky lg:top-24">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Your Event Essentials</h2>

              {eventEssentialsCartItems.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">
                  No Event Essentials in your cart yet.
                </p>
              ) : (
                <>
                  <div className="space-y-3 mb-4">
                    {eventEssentialsCartItems.map((item, index) => {
                      const lineTotal = item.unit_price_cents * item.qty;

                      return (
                        <div key={index} className="flex items-start justify-between gap-2 text-sm">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-slate-700 font-medium break-words">
                                {isEventEssentialBundleCartItem(item)
                                  ? item.bundle_name
                                  : item.product_name}
                              </span>
                              {item.pricing_context === 'addon' && (
                                <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  Add-on
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-500">
                              {item.qty} × {formatPrice(item.unit_price_cents)}
                            </span>
                          </div>
                          <span className="font-semibold text-slate-900 flex-shrink-0">
                            {formatPrice(lineTotal)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-200 mb-4">
                    <span className="font-semibold text-slate-700 text-sm">Subtotal</span>
                    <span className="text-lg font-bold text-blue-700">
                      {formatPrice(eventEssentialsSubtotalCents)}
                    </span>
                  </div>

                  {minOrderCents != null && minOrderCents > 0 && eventEssentialsSubtotalCents < minOrderCents && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                      <p className="text-xs text-amber-800">
                        Minimum order: {formatPrice(minOrderCents)}. Add{' '}
                        {formatPrice(minOrderCents - eventEssentialsSubtotalCents)} more.
                      </p>
                    </div>
                  )}
                </>
              )}

              <button
                type="button"
                onClick={() => navigate('/quote')}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg text-sm transition-colors"
              >
                View Full Quote →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
