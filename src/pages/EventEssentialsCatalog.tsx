import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Calendar, ShoppingCart, AlertCircle, Loader2, Plus, Minus, CheckCircle2 } from 'lucide-react';
import { getPublicBusinessSettings } from '../lib/adminSettingsCache';
import { SafeStorage } from '../lib/safeStorage';
import { fetchProductBundlesWithComponents, checkProductAvailability } from '../lib/queries/products';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { buildBundleSnapshot, expandCartToProductQuantities } from '../lib/unifiedCart';
import type {
  ProductBundleWithComponents,
  ProductAvailabilityResult,
  EventEssentialProductCartItem,
  EventEssentialBundleCartItem,
  PricingContext,
} from '../types';
import type { QuoteFormData } from '../hooks/useQuoteForm';

const FORM_STORAGE_KEY = 'bpc_quote_form';

function getDefaultFormData(): Partial<QuoteFormData> {
  return {
    event_date: '',
    event_end_date: '',
  };
}

export function EventEssentialsCatalog() {
  const navigate = useNavigate();
  const { cart, addToCart } = useQuoteCart();

  const [enabled, setEnabled] = useState(false);
  const [minOrderCents, setMinOrderCents] = useState<number | null>(null);
  const [bundles, setBundles] = useState<ProductBundleWithComponents[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eventDate, setEventDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [availabilityCache, setAvailabilityCache] = useState<Record<string, boolean>>({});
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const settings = await getPublicBusinessSettings();
        if (cancelled) return;

        if (!settings.event_essentials_page_enabled) {
          setEnabled(false);
          setLoading(false);
          return;
        }

        setEnabled(true);
        setMinOrderCents(settings.min_event_essentials_order_cents);

        const [bundlesResult] = await Promise.all([
          fetchProductBundlesWithComponents(),
        ]);

        if (cancelled) return;

        if (bundlesResult.error) {
          setError('Failed to load catalog. Please try again later.');
          setLoading(false);
          return;
        }

        setBundles(bundlesResult.data ?? []);
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
  }, []);

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

  const eventEssentialsCartItems = cart.filter(
    (item) => item.item_type === 'event_essential_product' || item.item_type === 'event_essential_bundle'
  ) as (EventEssentialProductCartItem | EventEssentialBundleCartItem)[];

  const runAvailabilityCheck = useCallback(
    async (date: string, endDate: string, items: (EventEssentialProductCartItem | EventEssentialBundleCartItem)[]) => {
      if (!date || !endDate || items.length === 0) {
        setAvailabilityCache({});
        return;
      }

      setCheckingAvailability(true);
      try {
        const allocation = expandCartToProductQuantities(items);
        const result = await checkProductAvailability(allocation, date, endDate, null);
        const results = result.data ?? [];
        const cache: Record<string, boolean> = {};

        for (const item of items) {
          if (item.item_type === 'event_essential_product') {
            const found = results.find((r: ProductAvailabilityResult) => r.product_id === item.product_id);
            cache[`${item.item_type}-${item.product_id}`] = found != null && found.is_allowed === true;
          } else {
            const allOk = item.component_snapshot.components.every((comp) => {
              const found = results.find((r: ProductAvailabilityResult) => r.product_id === comp.product_id);
              return found != null && found.is_allowed === true;
            });
            cache[`${item.item_type}-${item.bundle_id}`] = allOk;
          }
        }

        setAvailabilityCache(cache);
      } catch {
        setAvailabilityCache({});
      } finally {
        setCheckingAvailability(false);
      }
    },
    []
  );

  useEffect(() => {
    if (eventDate && eventEndDate && eventEssentialsCartItems.length > 0) {
      runAvailabilityCheck(eventDate, eventEndDate, eventEssentialsCartItems);
    } else {
      setAvailabilityCache({});
    }
  }, [eventDate, eventEndDate, eventEssentialsCartItems.length, runAvailabilityCheck]);

  function getBundlePrice(bundle: ProductBundleWithComponents): { unitPriceCents: number; isAddon: boolean } | null {
    if (bundle.standalone_enabled && bundle.standalone_price_cents != null) {
      return { unitPriceCents: bundle.standalone_price_cents, isAddon: false };
    }
    if (bundle.addon_enabled && bundle.addon_price_cents != null) {
      return { unitPriceCents: bundle.addon_price_cents, isAddon: true };
    }
    return null;
  }

  function getQty(key: string): number {
    return quantities[key] ?? 0;
  }

  function incrementQty(key: string) {
    setQuantities((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
  }

  function decrementQty(key: string) {
    setQuantities((prev) => ({
      ...prev,
      [key]: Math.max(0, (prev[key] ?? 0) - 1),
    }));
  }

  function handleAddBundle(bundle: ProductBundleWithComponents) {
    const key = `bundle-${bundle.id}`;
    const qty = getQty(key);
    if (qty <= 0) return;

    const priceInfo = getBundlePrice(bundle);
    if (!priceInfo) {
      setError('Pricing not available for this bundle.');
      return;
    }

    const pricingContext: PricingContext = priceInfo.isAddon ? 'addon' : 'standalone';

    const cartItem: EventEssentialBundleCartItem = {
      item_type: 'event_essential_bundle',
      bundle_id: bundle.id,
      bundle_name: bundle.name,
      unit_price_cents: priceInfo.unitPriceCents,
      qty,
      pricing_context: pricingContext,
      component_snapshot: buildBundleSnapshot(bundle),
    };

    addToCart(cartItem);
    setQuantities((prev) => ({ ...prev, [key]: 0 }));
  }

  const eventEssentialsSubtotalCents = eventEssentialsCartItems.reduce(
    (sum, item) => sum + item.unit_price_cents * item.qty,
    0
  );

  if (!enabled && !loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Event Essentials</h1>
          <p className="text-slate-600">This page is not available.</p>
        </div>
      </div>
    );
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
            </div>

            {bundles.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
                <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600">No Event Essentials bundles are currently available.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {bundles.map((bundle) => {
                  const key = `bundle-${bundle.id}`;
                  const qty = getQty(key);
                  const priceInfo = getBundlePrice(bundle);
                  const unitPriceCents = priceInfo?.unitPriceCents ?? 0;
                  const isAddon = priceInfo?.isAddon ?? false;

                  return (
                    <div
                      key={bundle.id}
                      className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 hover:shadow-md transition-shadow"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <h3 className="text-lg font-bold text-slate-900">{bundle.name}</h3>
                            {isAddon && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                Add-on
                              </span>
                            )}
                          </div>
                          {bundle.description && (
                            <p className="text-sm text-slate-600 mb-3">{bundle.description}</p>
                          )}
                          <div className="flex flex-wrap gap-2 mb-3">
                            {bundle.product_bundle_components.map((comp) => (
                              <span
                                key={comp.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-xs text-slate-700"
                              >
                                {comp.inventory_products?.name ?? 'Unknown'} × {comp.quantity_per_bundle}
                              </span>
                            ))}
                          </div>
                          <p className="text-lg font-bold text-blue-700">
                            ${((unitPriceCents / 100)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </p>
                        </div>

                        <div className="flex flex-col items-stretch sm:items-end gap-2 sm:min-w-[140px]">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => decrementQty(key)}
                              className="w-9 h-9 rounded-lg border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
                              disabled={qty <= 0}
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="w-8 text-center font-semibold text-slate-900">{qty}</span>
                            <button
                              type="button"
                              onClick={() => incrementQty(key)}
                              className="w-9 h-9 rounded-lg border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddBundle(bundle)}
                            disabled={qty <= 0}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <ShoppingCart className="w-4 h-4" />
                            Add to Cart
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
                      const cacheKey =
                        item.item_type === 'event_essential_bundle'
                          ? `event_essential_bundle-${item.bundle_id}`
                          : `event_essential_product-${item.product_id}`;
                      const isAvailable = availabilityCache[cacheKey];
                      const lineTotal = item.unit_price_cents * item.qty;

                      return (
                        <div key={index} className="flex items-start justify-between gap-2 text-sm">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-slate-700 font-medium break-words">
                                {item.item_type === 'event_essential_bundle' ? item.bundle_name : item.product_name}
                              </span>
                              {checkingAvailability && (
                                <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />
                              )}
                              {!checkingAvailability && isAvailable === true && (
                                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                              )}
                              {!checkingAvailability && isAvailable === false && (
                                <span className="text-xs text-red-600 font-medium">(unavailable)</span>
                              )}
                            </div>
                            <span className="text-xs text-slate-500">
                              {item.qty} × ${((item.unit_price_cents / 100)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </span>
                          </div>
                          <span className="font-semibold text-slate-900 flex-shrink-0">
                            ${((lineTotal / 100)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-200 mb-4">
                    <span className="font-semibold text-slate-700 text-sm">Event Essentials Subtotal</span>
                    <span className="text-lg font-bold text-blue-700">
                      ${((eventEssentialsSubtotalCents / 100)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                  </div>

                  {minOrderCents != null && minOrderCents > 0 && eventEssentialsSubtotalCents < minOrderCents && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                      <p className="text-xs text-amber-800">
                        Minimum order: ${((minOrderCents / 100)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}. Add ${(((minOrderCents - eventEssentialsSubtotalCents) / 100)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} more.
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
