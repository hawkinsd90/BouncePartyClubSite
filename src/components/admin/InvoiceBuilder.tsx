import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Send, AlertCircle, Copy, Check } from 'lucide-react';
import { OrderSummary } from '../order/OrderSummary';
import { showToast } from '../../lib/notifications';
import { DiscountsManager } from '../order-detail/DiscountsManager';
import { CardOnFileRequirement } from '../shared/CardOnFileRequirement';
import { CustomFeesManager } from '../order-detail/CustomFeesManager';
import { EventDetailsEditor } from '../order-detail/EventDetailsEditor';
import { DepositOverride } from '../order-detail/DepositOverride';
import { TaxWaiver } from '../order-detail/TaxWaiver';
import { FeeWaiver } from '../shared/FeeWaiver';
import { ItemsEditor } from '../shared/ItemsEditor';
import { CustomerSelector } from '../invoice/CustomerSelector';
import { NewCustomerForm } from '../invoice/NewCustomerForm';
import { InvoiceSuccessMessage } from '../invoice/InvoiceSuccessMessage';
import { AdminMessage } from '../order-detail/AdminMessage';
import { AddEventEssentialsSection } from '../order-detail/AddEventEssentialsSection';
import { useInvoiceData } from '../../hooks/useInvoiceData';
import { usePricing } from '../../hooks/usePricing';
import { useCartManagement } from '../../hooks/useCartManagement';
import { useCustomerManagement } from '../../hooks/useCustomerManagement';
import { useEventDetails } from '../../hooks/useEventDetails';
import { generateInvoice } from '../../lib/invoiceService';
import { checkMultipleUnitsAvailability } from '../../lib/availability';
import { resolveAdminGeneratorIncrease } from '../../lib/adminGeneratorResolution';
import { fetchAdminProductCategories, fetchAdminInventoryProducts, fetchAdminProductPricing, fetchAdminProductBundlesWithConfiguration } from '../../lib/queries/products';
import { checkProductAvailability } from '../../lib/queries/products';
import {
  buildEventEssentialAvailabilityRequestFromOrderItems,
  validateAvailabilityResult,
} from '../../lib/eeOrderItemAvailability';
import type { ResolverProductConfig, ResolverBundleConfig, ResolverCategory, ResolverUnitConfig, InflatableEligibilityMode } from '../../lib/eventEssentialsPricingTypes';

interface StagedEEItem {
  client_id: string;
  product_id: string | null;
  bundle_id?: string | null;
  item_name: string;
  product_name: string;
  qty: number;
  unit_price_cents: number;
  pricing_context: string;
  component_snapshot?: any;
  is_new?: boolean;
  is_deleted?: boolean;
}

export function InvoiceBuilder() {
  const { customers, units, pricingRules, addCustomer } = useInvoiceData();
  const { cartItems, addItemToCart, removeItemFromCart, updateItemQuantity, updateItemPrice, clearCart } =
    useCartManagement();
  const customerManagement = useCustomerManagement();
  const { eventDetails, updateEventDetails, resetEventDetails } = useEventDetails();

  const [stagedEEItems, setStagedEEItems] = useState<StagedEEItem[]>([]);
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [customFees, setCustomFees] = useState<any[]>([]);
  const [adminMessage, setAdminMessage] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taxWaived, setTaxWaived] = useState(false);
  const [taxWaiveReason, setTaxWaiveReason] = useState('');
  const [travelFeeWaived, setTravelFeeWaived] = useState(false);
  const [travelFeeWaiveReason, setTravelFeeWaiveReason] = useState('');
  const [sameDayPickupFeeWaived, setSameDayPickupFeeWaived] = useState(false);
  const [sameDayPickupFeeWaiveReason, setSameDayPickupFeeWaiveReason] = useState('');
  const [surfaceFeeWaived, setSurfaceFeeWaived] = useState(false);
  const [surfaceFeeWaiveReason, setSurfaceFeeWaiveReason] = useState('');
  const [generatorFeeWaived, setGeneratorFeeWaived] = useState(false);
  const [generatorFeeWaiveReason, setGeneratorFeeWaiveReason] = useState('');
  const [sameDayWeekdayDeliveryFeeWaived, setSameDayWeekdayDeliveryFeeWaived] = useState(false);
  const [sameDayWeekdayDeliveryFeeWaiveReason, setSameDayWeekdayDeliveryFeeWaiveReason] = useState('');
  const [customDepositCents, setCustomDepositCents] = useState<number | null>(null);
  const [customDepositInput, setCustomDepositInput] = useState('');
  const [requireCardOnFile, setRequireCardOnFile] = useState(true);
  const [availabilityIssues, setAvailabilityIssues] = useState<any[]>([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [generatorProductIdsState, setGeneratorProductIdsState] = useState<{ status: 'loading' | 'ready' | 'failed'; ids: Set<string> }>({ status: 'loading', ids: new Set() });
  const [generatorResolutionPending, setGeneratorResolutionPending] = useState(false);
  const generatorResolutionIdRef = useRef(0);
  const generatorContextRevisionRef = useRef('');
  const { orderSummary, calculatedPricing, pricingPending, lastPricedRevision, calculatePricing } = usePricing();

  // Load generator product IDs from the EE product catalog
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [catsRes, prodsRes] = await Promise.all([
          fetchAdminProductCategories(),
          fetchAdminInventoryProducts(),
        ]);
        if (cancelled) return;
        if (catsRes.error || prodsRes.error) {
          setGeneratorProductIdsState({ status: 'failed', ids: new Set() });
          return;
        }
        const cats = catsRes.data || [];
        const products = prodsRes.data || [];
        const generatorCat = cats.find((c: any) => c.slug === 'generators');
        if (!generatorCat) {
          setGeneratorProductIdsState({ status: 'ready', ids: new Set() });
          return;
        }
        const genProductIds = new Set(
          products
            .filter((p: any) => p.category_id === generatorCat.id && p.active !== false)
            .map((p: any) => p.id)
        );
        setGeneratorProductIdsState({ status: 'ready', ids: genProductIds });
      } catch {
        if (!cancelled) setGeneratorProductIdsState({ status: 'failed', ids: new Set() });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const generatorProductIds = generatorProductIdsState.ids;

  const visibleGeneratorQty = useMemo(() => {
    if (generatorProductIdsState.status !== 'ready') return null;
    const directEeQty = stagedEEItems
      .filter((item) => !item.is_deleted && !!item.product_id && generatorProductIds.has(item.product_id))
      .reduce((sum, item) => sum + item.qty, 0);
    return (eventDetails.generator_qty ?? 0) + directEeQty;
  }, [eventDetails.generator_qty, generatorProductIds, generatorProductIdsState.status, stagedEEItems]);

  const handleGeneratorQtyChange = useCallback(async (requestedTotal: number): Promise<void> => {
    const requestedQty = Math.max(0, Number.isFinite(requestedTotal) ? Math.trunc(requestedTotal) : 0);

    if (generatorProductIdsState.status !== 'ready') {
      showToast('Generator product catalog is still loading. Please try again in moment.', 'error');
      return;
    }

    const resolutionId = ++generatorResolutionIdRef.current;
    const isStale = () => resolutionId !== generatorResolutionIdRef.current;

    const directItems = stagedEEItems.filter((item) => !item.is_deleted && !!item.product_id && generatorProductIds.has(item.product_id));
    const directQty = directItems.reduce((sum, item) => sum + item.qty, 0);
    const currentTotal = (eventDetails.generator_qty ?? 0) + directQty;

    if (requestedQty === currentTotal) return;

    const startingContextRevision = generatorContextRevisionRef.current;

    // DECREASE
    if (requestedQty < currentTotal) {
      const removeQty = currentTotal - requestedQty;
      let remainingDirectReduction = Math.min(removeQty, directQty);
      const directByNewest = [...directItems].sort((a, b) => {
        const aIdx = stagedEEItems.indexOf(a);
        const bIdx = stagedEEItems.indexOf(b);
        return bIdx - aIdx;
      });

      setStagedEEItems((previous) => {
        const orderedKeys = directByNewest.map((item) => item.client_id).filter((k): k is string => !!k);
        const keySet = new Set(orderedKeys);
        const reductionByKey = new Map<string, number>();
        for (const key of orderedKeys) {
          if (remainingDirectReduction <= 0) break;
          const item = previous.find((i) => i.client_id === key && keySet.has(key));
          if (!item) continue;
          const reduction = Math.min(item.qty, remainingDirectReduction);
          remainingDirectReduction -= reduction;
          reductionByKey.set(key, reduction);
        }

        return previous.map((item) => {
          if (!item.client_id || !reductionByKey.has(item.client_id)) return item;
          const reduction = reductionByKey.get(item.client_id)!;
          const nextQty = item.qty - reduction;
          if (nextQty > 0) return { ...item, qty: nextQty };
          return null;
        }).filter((item): item is StagedEEItem => item !== null);
      });

      const newLegacyQty = Math.max(0, (eventDetails.generator_qty ?? 0) - Math.max(0, removeQty - directQty));
      updateEventDetails({ generator_qty: newLegacyQty });
      if (newLegacyQty === 0) {
        setGeneratorFeeWaived(false);
        setGeneratorFeeWaiveReason('');
      }
      return;
    }

    // INCREASE
    const additionalQty = requestedQty - currentTotal;
    setGeneratorResolutionPending(true);

    try {
      let productConfigs: Record<string, ResolverProductConfig> = {};
      let bundleConfigs: Record<string, ResolverBundleConfig> = {};
      let categoryMap: Record<string, ResolverCategory> = {};
      let unitMap: Record<string, ResolverUnitConfig> = {};

      const [catsRes, prodsRes, pricingRes, bundlesRes] = await Promise.all([
        fetchAdminProductCategories(),
        fetchAdminInventoryProducts(),
        fetchAdminProductPricing(),
        fetchAdminProductBundlesWithConfiguration(),
      ]);

      if (isStale()) return;

      if (catsRes.error || prodsRes.error || pricingRes.error || bundlesRes.error) {
        if (!isStale()) showToast('Unable to load product catalog for Generator pricing. Please try again.', 'error');
        return;
      }

      const allProducts = prodsRes.data || [];
      const allPricing = pricingRes.data || [];
      const allCats = catsRes.data || [];
      const allBundles = bundlesRes.data || [];

      const pricingByProductId = new Map<string, any>();
      for (const p of allPricing) pricingByProductId.set(p.product_id, p);

      for (const p of allProducts) {
        const pc = pricingByProductId.get(p.id);
        if (!pc) continue;
        if (typeof p.category_id !== 'string' || !p.category_id) continue;
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

      for (const b of allBundles) {
        const comps = b.product_bundle_components || [];
        const containedCategoryIds = Array.from(new Set(
          comps.map((c: any) => c.inventory_products?.category_id).filter((id: any): id is string => typeof id === 'string' && id !== '')
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

      for (const c of allCats) categoryMap[c.id] = { id: c.id };
      for (const u of units) unitMap[u.id] = { id: u.id, active: true };

      if (isStale()) return;
      if (startingContextRevision !== generatorContextRevisionRef.current) {
        if (!isStale()) showToast('Invoice details changed while Generator availability was being checked. Please select the Generator quantity again.', 'error');
        return;
      }

      // Build complete resolver context: inflatables + EE items.
      const completeStagedItems = [
        ...cartItems.map(item => ({
          unit_id: item.unit_id,
          qty: item.qty,
          wet_or_dry: item.mode,
          unit_price_cents: item.adjusted_price_cents,
          is_deleted: false,
        })),
        ...stagedEEItems.filter(i => !i.is_deleted).map(item => ({
          product_id: item.product_id || undefined,
          bundle_id: item.bundle_id || undefined,
          qty: item.qty,
          unit_price_cents: item.unit_price_cents,
          pricing_context: item.pricing_context,
          component_snapshot: item.component_snapshot,
          is_deleted: false,
        })),
      ];

      const resolution = await resolveAdminGeneratorIncrease({
        current: { legacyQty: eventDetails.generator_qty ?? 0, directEeQty: directQty },
        requestedTotal: requestedQty,
        stagedItems: completeStagedItems as any[],
        eventDate: eventDetails.event_date,
        eventEndDate: eventDetails.event_end_date,
        orderId: null,
        productConfigs,
        bundleConfigs,
        categories: categoryMap,
        units: unitMap,
      });

      if (isStale()) return;
      if (startingContextRevision !== generatorContextRevisionRef.current) {
        if (!isStale()) showToast('Invoice details changed while Generator availability was being checked. Please select the Generator quantity again.', 'error');
        return;
      }

      if (resolution.status === 'fail_closed') {
        showToast(resolution.reason || 'Unable to verify Generator availability. Please try again.', 'error');
        return;
      }

      if (resolution.status === 'ee') {
        const { product, resolvedUnitPriceCents, resolvedPricingContext } = resolution.candidate;

        setStagedEEItems((previous) => {
          const exactMatch = previous.find(
            (item) =>
              !item.is_deleted &&
              item.product_id === product.product_id &&
              !item.bundle_id &&
              item.unit_price_cents === resolvedUnitPriceCents &&
              (item.pricing_context || 'standalone') === resolvedPricingContext,
          );

          if (exactMatch) {
            return previous.map((item) =>
              item === exactMatch
                ? { ...item, qty: item.qty + additionalQty }
                : item,
            );
          }

          return [...previous, {
            client_id: `new-generator-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            product_id: product.product_id,
            product_name: product.product_name,
            item_name: product.product_name,
            qty: additionalQty,
            unit_price_cents: resolvedUnitPriceCents,
            pricing_context: resolvedPricingContext,
            is_new: true,
            is_deleted: false,
          }];
        });
        return;
      }

      // Legacy fallback
      const existingLegacyQty = eventDetails.generator_qty ?? 0;
      if (existingLegacyQty === 0 && generatorFeeWaived) {
        setGeneratorFeeWaived(false);
        setGeneratorFeeWaiveReason('');
      }
      updateEventDetails({ generator_qty: (eventDetails.generator_qty ?? 0) + additionalQty });
    } catch {
      if (!isStale()) showToast('Unable to load product catalog for Generator pricing. Please try again.', 'error');
    } finally {
      if (!isStale()) setGeneratorResolutionPending(false);
    }
  }, [eventDetails.generator_qty, eventDetails.event_date, eventDetails.event_end_date, generatorProductIdsState, generatorProductIds, stagedEEItems, cartItems, units, generatorFeeWaived, updateEventDetails]);

  const handleAddEEProduct = useCallback((item: any) => {
    setStagedEEItems(prev => {
      const exactMatch = prev.find((existing) =>
        !existing.is_deleted &&
        existing.product_id === item.product_id &&
        !existing.bundle_id &&
        existing.unit_price_cents === item.unit_price_cents &&
        (existing.pricing_context || 'standalone') === (item.pricing_context || 'standalone')
      );
      if (exactMatch) {
        return prev.map((existing) =>
          existing === exactMatch
            ? { ...existing, qty: existing.qty + item.qty }
            : existing
        );
      }
      return [...prev, { ...item, client_id: item.client_id || `new-ee-${Date.now()}-${Math.random().toString(36).slice(2)}` }];
    });
  }, []);

  const handleAddEEBundle = useCallback((item: any) => {
    setStagedEEItems(prev => {
      const exactMatch = prev.find((existing) =>
        !existing.is_deleted &&
        existing.bundle_id === item.bundle_id &&
        existing.unit_price_cents === item.unit_price_cents &&
        (existing.pricing_context || 'standalone') === (item.pricing_context || 'standalone') &&
        JSON.stringify(existing.component_snapshot || null) === JSON.stringify(item.component_snapshot || null)
      );
      if (exactMatch) {
        return prev.map((existing) =>
          existing === exactMatch
            ? { ...existing, qty: existing.qty + item.qty }
            : existing
        );
      }
      return [...prev, { ...item, client_id: item.client_id || `new-ee-${Date.now()}-${Math.random().toString(36).slice(2)}` }];
    });
  }, []);

  const handleRemoveEEItem = useCallback((item: any) => {
    setStagedEEItems(prev => prev.filter(i => i.client_id !== item.client_id));
  }, []);

  const handleUpdateEEQuantity = useCallback((item: any, qty: number) => {
    setStagedEEItems(prev => prev.map(i =>
      i.client_id === item.client_id ? { ...i, qty: Math.max(1, qty) } : i
    ));
  }, []);

  // Compute a deterministic pricing revision string covering all inputs that affect pricing.
  const pricingRevision = useMemo(() => JSON.stringify({
    cart: cartItems.map(i => ({ u: i.unit_id, q: i.qty, m: i.mode, p: i.adjusted_price_cents })),
    ee: stagedEEItems.map(i => ({ p: i.product_id, b: i.bundle_id, q: i.qty, c: i.unit_price_cents, ctx: i.pricing_context, snap: i.component_snapshot, del: i.is_deleted })),
    ed: eventDetails.event_date,
    eed: eventDetails.event_end_date,
    lt: eventDetails.location_type,
    s: eventDetails.surface,
    pp: eventDetails.pickup_preference,
    gq: eventDetails.generator_qty,
    a1: eventDetails.address_line1,
    c: eventDetails.city,
    st: eventDetails.state,
    z: eventDetails.zip,
    lat: eventDetails.lat,
    lng: eventDetails.lng,
    d: discounts,
    cf: customFees,
    cdc: customDepositCents,
    pr: pricingRules,
    tw: taxWaived,
    tfw: travelFeeWaived,
    sdpw: sameDayPickupFeeWaived,
    sfw: surfaceFeeWaived,
    gfw: generatorFeeWaived,
    sdwdw: sameDayWeekdayDeliveryFeeWaived,
  }), [cartItems, stagedEEItems, eventDetails.event_date, eventDetails.event_end_date, eventDetails.location_type, eventDetails.surface, eventDetails.pickup_preference, eventDetails.generator_qty, eventDetails.address_line1, eventDetails.city, eventDetails.state, eventDetails.zip, eventDetails.lat, eventDetails.lng, discounts, customFees, customDepositCents, pricingRules, taxWaived, travelFeeWaived, sameDayPickupFeeWaived, surfaceFeeWaived, generatorFeeWaived, sameDayWeekdayDeliveryFeeWaived]);

  const pricingIsCurrent = !pricingPending && !!calculatedPricing && lastPricedRevision === pricingRevision;

  // Deterministic Generator context revision — mirrored into a ref so async
  // handlers can compare against the live value instead of a stale closure.
  const generatorContextRevision = useMemo(() => JSON.stringify({
    cart: cartItems.map(i => ({ u: i.unit_id, q: i.qty, m: i.mode, p: i.adjusted_price_cents })),
    ee: stagedEEItems.map(i => ({ p: i.product_id, b: i.bundle_id, q: i.qty, c: i.unit_price_cents, ctx: i.pricing_context, snap: i.component_snapshot, del: i.is_deleted })),
    ed: eventDetails.event_date,
    eed: eventDetails.event_end_date,
    gq: eventDetails.generator_qty,
  }), [cartItems, stagedEEItems, eventDetails.event_date, eventDetails.event_end_date, eventDetails.generator_qty]);

  useEffect(() => {
    generatorContextRevisionRef.current = generatorContextRevision;
  }, [generatorContextRevision]);

  // Calculate pricing whenever dependencies change
  useEffect(() => {
    const hasItems = cartItems.length > 0 || stagedEEItems.filter(i => !i.is_deleted).length > 0;
    if (
      hasItems &&
      pricingRules &&
      eventDetails.zip &&
      eventDetails.event_date &&
      eventDetails.event_end_date
    ) {
      const items = cartItems.map(item => ({
        unit_id: item.unit_id,
        unit_name: item.unit_name,
        qty: item.qty,
        wet_or_dry: item.mode,
        unit_price_cents: item.adjusted_price_cents,
      }));

      const eeProductItems = stagedEEItems.filter(i => !i.is_deleted).map(item => ({
        product_id: item.product_id || '',
        bundle_id: item.bundle_id,
        item_name: item.item_name,
        product_name: item.product_name,
        qty: item.qty,
        unit_price_cents: item.unit_price_cents,
        pricing_context: item.pricing_context,
        component_snapshot: item.component_snapshot,
        is_new: item.is_new || false,
        is_deleted: item.is_deleted || false,
      }));

      calculatePricing({
        items,
        eeProductItems,
        eventDetails: {
          event_date: eventDetails.event_date,
          event_end_date: eventDetails.event_end_date,
          location_type: eventDetails.location_type as 'residential' | 'commercial',
          surface: eventDetails.surface as 'grass' | 'cement',
          pickup_preference: eventDetails.pickup_preference,
          generator_qty: eventDetails.generator_qty,
          address_line1: eventDetails.address_line1,
          address_city: eventDetails.city,
          address_state: eventDetails.state,
          address_zip: eventDetails.zip,
          lat: eventDetails.lat,
          lng: eventDetails.lng,
        },
        discounts,
        customFees,
        customDepositCents,
        pricingRules,
        feeWaivers: {
          taxWaived,
          travelFeeWaived,
          sameDayPickupFeeWaived,
          surfaceFeeWaived,
          generatorFeeWaived,
          sameDayWeekdayDeliveryFeeWaived,
        },
        revision: pricingRevision,
      });
    }
  }, [
    cartItems,
    stagedEEItems,
    eventDetails.event_date,
    eventDetails.event_end_date,
    eventDetails.location_type,
    eventDetails.surface,
    eventDetails.pickup_preference,
    eventDetails.generator_qty,
    eventDetails.address_line1,
    eventDetails.city,
    eventDetails.state,
    eventDetails.zip,
    eventDetails.lat,
    eventDetails.lng,
    discounts,
    customFees,
    customDepositCents,
    pricingRules,
    taxWaived,
    travelFeeWaived,
    sameDayPickupFeeWaived,
    surfaceFeeWaived,
    generatorFeeWaived,
    sameDayWeekdayDeliveryFeeWaived,
    calculatePricing,
    pricingRevision,
  ]);

  // Check availability whenever cart items or dates change
  useEffect(() => {
    checkAvailability();
  }, [cartItems, stagedEEItems, eventDetails.event_date, eventDetails.event_end_date]);

  async function checkAvailability() {
    if (!eventDetails.event_date || !eventDetails.event_end_date) {
      setAvailabilityIssues([]);
      return;
    }

    const hasInflatables = cartItems.length > 0;
    const activeEEItems = stagedEEItems.filter(i => !i.is_deleted);
    if (!hasInflatables && activeEEItems.length === 0) {
      setAvailabilityIssues([]);
      return;
    }

    setCheckingAvailability(true);
    try {
      const issues: any[] = [];

      // Check inflatable availability
      if (hasInflatables) {
        const checks = cartItems.map(item => ({
          unitId: item.unit_id,
          eventStartDate: eventDetails.event_date,
          eventEndDate: eventDetails.event_end_date,
        }));

        const results = await checkMultipleUnitsAvailability(checks);
        for (const result of results) {
          if (!result.isAvailable) {
            const item = cartItems.find(i => i.unit_id === result.unitId);
            issues.push({
              unitName: item?.unit_name || 'Unknown',
              unitId: result.unitId,
              conflicts: result.conflictingOrders,
            });
          }
        }
      }

      // Check Event Essentials availability
      if (activeEEItems.length > 0) {
        const expansion = buildEventEssentialAvailabilityRequestFromOrderItems(
          activeEEItems.map(item => ({
            product_id: item.product_id,
            bundle_id: item.bundle_id,
            qty: item.qty,
            component_snapshot: item.component_snapshot,
          }))
        );

        if (expansion.status !== 'ready') {
          issues.push({ unitName: 'Event Essentials', unitId: 'ee', conflicts: [] });
        } else if (expansion.productQuantities.length > 0) {
          try {
            const eeResult = await checkProductAvailability(
              expansion.productQuantities,
              eventDetails.event_date,
              eventDetails.event_end_date || eventDetails.event_date,
              null,
            );
            const validation = validateAvailabilityResult(
              expansion.productQuantities.map(item => item.product_id),
              eeResult,
            );
            if (!validation.ok) {
              issues.push({ unitName: 'Event Essentials', unitId: 'ee', conflicts: [] });
            }
          } catch {
            issues.push({ unitName: 'Event Essentials', unitId: 'ee', conflicts: [] });
          }
        }
      }

      setAvailabilityIssues(issues);
    } catch (error) {
      console.error('Error checking availability:', error);
    } finally {
      setCheckingAvailability(false);
    }
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (customerManagement.showCustomerDropdown && !target.closest('.customer-search-container')) {
        customerManagement.setShowCustomerDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [customerManagement.showCustomerDropdown]);

  async function handleCreateNewCustomer() {
    const customer = await customerManagement.createNewCustomer(addCustomer);
    if (customer) {
      addCustomer(customer);
    }
  }

  async function handleGenerateInvoice() {
    const activeEEItems = stagedEEItems.filter(i => !i.is_deleted);
    const hasItems = cartItems.length > 0 || activeEEItems.length > 0;
    if (!hasItems) {
      showToast('Please add at least one item to the invoice', 'error');
      return;
    }

    if (!eventDetails.event_date || !eventDetails.address_line1) {
      showToast('Please fill in event details (date and address)', 'error');
      return;
    }

    setSaving(true);
    try {
      // Recheck inflatable availability before creating invoice
      if (cartItems.length > 0) {
        const availabilityChecks = cartItems.map(item => ({
          unitId: item.unit_id,
          eventStartDate: eventDetails.event_date,
          eventEndDate: eventDetails.event_end_date,
        }));

        const availabilityResults = await checkMultipleUnitsAvailability(availabilityChecks);
        const unavailableUnits = availabilityResults.filter(result => !result.isAvailable);

        if (unavailableUnits.length > 0) {
          const unitNames = unavailableUnits.map(u => {
            const unit = units.find(unit => unit.id === u.unitId);
            return unit?.name || 'Unknown unit';
          }).join(', ');

          showToast(
            `Cannot create invoice: The following units are not available for the selected dates: ${unitNames}. Please check the calendar for conflicts.`,
            'error'
          );
          setSaving(false);
          return;
        }
      }

      // Recheck Event Essentials availability before creating invoice
      if (activeEEItems.length > 0) {
        const expansion = buildEventEssentialAvailabilityRequestFromOrderItems(
          activeEEItems.map(item => ({
            product_id: item.product_id,
            bundle_id: item.bundle_id,
            qty: item.qty,
            component_snapshot: item.component_snapshot,
          }))
        );

        if (expansion.status !== 'ready') {
          showToast('Unable to verify Event Essentials availability. Please try again.', 'error');
          setSaving(false);
          return;
        }

        if (expansion.productQuantities.length > 0) {
          const eeResult = await checkProductAvailability(
            expansion.productQuantities,
            eventDetails.event_date,
            eventDetails.event_end_date || eventDetails.event_date,
            null,
          );

          const validation = validateAvailabilityResult(
            expansion.productQuantities.map(item => item.product_id),
            eeResult,
          );
          if (!validation.ok) {
            showToast(
              validation.status === 'unavailable'
                ? 'Cannot create invoice: One or more Event Essentials are not available for the selected dates.'
                : 'Unable to verify Event Essentials availability. Please try again.',
              'error'
            );
            setSaving(false);
            return;
          }
        }
      }

      if (!pricingIsCurrent) {
        showToast('Pricing is being updated. Please wait for the current price to finish calculating.', 'error');
        setSaving(false);
        return;
      }

      if (sameDayWeekdayDeliveryFeeWaived && !sameDayWeekdayDeliveryFeeWaiveReason.trim()) {
        showToast('A reason is required to waive the Same-Day Weekday Delivery Fee', 'error');
        return;
      }

      const customer = customers.find(c => c.id === customerManagement.selectedCustomer);

      const result = await generateInvoice(
        {
          customerId: customerManagement.selectedCustomer || null,
          cartItems,
          eeProductItems: activeEEItems.map(item => ({
            product_id: item.product_id,
            bundle_id: item.bundle_id,
            item_name: item.item_name,
            product_name: item.product_name,
            qty: item.qty,
            unit_price_cents: item.unit_price_cents,
            pricing_context: item.pricing_context,
            component_snapshot: item.component_snapshot,
          })),
          eventDetails: { ...eventDetails },
          priceBreakdown: {
            ...calculatedPricing,
            tax_applied: (calculatedPricing.tax_cents || 0) > 0,
            travel_base_radius_miles: calculatedPricing.travel_base_radius_miles ?? 0,
            travel_chargeable_miles: calculatedPricing.travel_chargeable_miles ?? 0,
            travel_per_mile_cents: calculatedPricing.travel_per_mile_cents ?? 0,
            travel_is_flat_fee: calculatedPricing.travel_is_flat_fee ?? false,
            travel_fee_display_name: calculatedPricing.travel_fee_display_name ?? 'Travel Fee',
          },
          subtotal: calculatedPricing.subtotal_cents,
          taxCents: calculatedPricing.tax_cents,
          depositRequired: calculatedPricing.deposit_due_cents,
          totalCents: calculatedPricing.total_cents,
          customDepositCents,
          discounts,
          customFees,
          adminMessage,
          taxWaived,
          taxWaiveReason,
          travelFeeWaived,
          travelFeeWaiveReason,
          sameDayPickupFeeWaived,
          sameDayPickupFeeWaiveReason,
          surfaceFeeWaived,
          surfaceFeeWaiveReason,
          generatorFeeWaived,
          generatorFeeWaiveReason,
          sameDayWeekdayDeliveryFeeWaived,
          sameDayWeekdayDeliveryFeeWaiveReason,
          requireCardOnFile,
          generatorQty: eventDetails.generator_qty,
          generatorFeeCents: calculatedPricing.generator_fee_cents,
        },
        customer
      );

      setInvoiceUrl(result.invoiceUrl);

      if (!customerManagement.selectedCustomer) {
        showToast('Invoice created! Copy the link below to send to your customer.', 'success');
      } else {
        showToast(`Invoice sent to ${customer.email} and ${customer.phone}!`, 'success');
      }

      clearCart();
      setStagedEEItems([]);
      setDiscounts([]);
      setCustomFees([]);
      setCustomDepositCents(null);
      setCustomDepositInput('');
      setAdminMessage('');
      setTaxWaived(false);
      setTaxWaiveReason('');
      setTravelFeeWaived(false);
      setTravelFeeWaiveReason('');
      setSameDayPickupFeeWaived(false);
      setSameDayPickupFeeWaiveReason('');
      setSurfaceFeeWaived(false);
      setSurfaceFeeWaiveReason('');
      setGeneratorFeeWaived(false);
      setGeneratorFeeWaiveReason('');
      setSameDayWeekdayDeliveryFeeWaived(false);
      setSameDayWeekdayDeliveryFeeWaiveReason('');
      setRequireCardOnFile(true);
      customerManagement.setSelectedCustomer('');
      resetEventDetails();
    } catch (error) {
      console.error('Error generating invoice:', error);
      showToast('Failed to generate invoice: ' + (error instanceof Error ? error.message : String(error)), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6">Invoice Builder</h2>
        <p className="text-sm sm:text-base text-slate-600 mb-4 sm:mb-6">
          Build a custom invoice for a customer by selecting items and adjusting prices as needed.
        </p>
      </div>

      {invoiceUrl && (
        <InvoiceSuccessMessage invoiceUrl={invoiceUrl} hasSelectedCustomer={!!customerManagement.selectedCustomer} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6 min-w-0">
          <CustomerSelector
            customers={customers}
            selectedCustomer={customerManagement.selectedCustomer}
            customerSearchQuery={customerManagement.customerSearchQuery}
            showDropdown={customerManagement.showCustomerDropdown}
            showNewCustomerForm={customerManagement.showNewCustomerForm}
            onSearchChange={customerManagement.setCustomerSearchQuery}
            onCustomerSelect={customerManagement.setSelectedCustomer}
            onClearCustomer={customerManagement.clearCustomer}
            onToggleNewForm={customerManagement.toggleNewCustomerForm}
            onShowDropdown={customerManagement.setShowCustomerDropdown}
          />

          {customerManagement.showNewCustomerForm && (
            <NewCustomerForm
              newCustomer={customerManagement.newCustomer}
              onChange={customerManagement.setNewCustomer}
              onSubmit={handleCreateNewCustomer}
              onCancel={() => customerManagement.setShowNewCustomerForm(false)}
            />
          )}

          <EventDetailsEditor
            editedOrder={{ ...eventDetails, generator_display_qty: visibleGeneratorQty }}
            pricingRules={pricingRules}
            onOrderChange={updateEventDetails}
            onGeneratorQtyChange={handleGeneratorQtyChange}
            onAddressSelect={result => {
              updateEventDetails({
                address_line1: result.street,
                city: result.city,
                state: result.state,
                zip: result.zip,
                lat: result.lat,
                lng: result.lng,
              });
            }}
            generatorLoadState={generatorProductIdsState}
            generatorResolutionPending={generatorResolutionPending}
            compact={true}
            showUntilEndOfDay={true}
          />

          {checkingAvailability && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900">Checking availability...</p>
            </div>
          )}

          {availabilityIssues.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-red-900 mb-2">Availability Conflicts</h4>
                  <p className="text-sm text-red-800 mb-3">
                    The following units are not available for the selected dates:
                  </p>
                  <ul className="space-y-2">
                    {availabilityIssues.map((issue, index) => (
                      <li key={index} className="text-sm">
                        <span className="font-medium text-red-900">{issue.unitName}</span>
                        <span className="text-red-700"> - Conflicts with {issue.conflicts.length} order(s)</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-red-700 mt-3">
                    Please remove these items or select different dates to proceed.
                  </p>
                </div>
              </div>
            </div>
          )}

          <ItemsEditor
            items={[...cartItems, ...stagedEEItems]}
            units={units}
            onRemoveItem={(item) => {
              if (item && (item.product_id || item.bundle_id)) {
                handleRemoveEEItem(item);
              } else {
                const idx = cartItems.findIndex(ci => ci.unit_id === item.unit_id && ci.mode === item.mode);
                if (idx >= 0) removeItemFromCart(idx);
              }
            }}
            onAddItem={addItemToCart}
            onUpdateQuantity={(item, qty) => {
              if (item && (item.product_id || item.bundle_id)) {
                handleUpdateEEQuantity(item, qty);
              } else {
                const idx = cartItems.findIndex(ci => ci.unit_id === item.unit_id && ci.mode === item.mode);
                if (idx >= 0) updateItemQuantity(idx, qty);
              }
            }}
            allowQuantityEdit={true}
            allowPriceEdit={false}
            title="Items"
            removeByIndex={false}
          />

          <AddEventEssentialsSection
            stagedItems={[
              ...cartItems.map(item => ({
                unit_id: item.unit_id,
                qty: item.qty,
                wet_or_dry: item.mode,
                unit_price_cents: item.adjusted_price_cents,
                is_deleted: false,
              })),
              ...stagedEEItems,
            ]}
            availableUnits={units}
            orderId={null}
            eventDate={eventDetails.event_date}
            eventEndDate={eventDetails.event_end_date || eventDetails.event_date}
            onAddProduct={handleAddEEProduct}
            onAddBundle={handleAddEEBundle}
          />
        </div>

        <div className="space-y-4 sm:space-y-6 min-w-0">
          <DiscountsManager discounts={discounts} onDiscountChange={setDiscounts} onMarkChanges={() => {}} />

          <CustomFeesManager customFees={customFees} onFeeChange={setCustomFees} onMarkChanges={() => {}} />

          <DepositOverride
            calculatedDepositCents={calculatedPricing?.deposit_due_cents || 0}
            customDepositCents={customDepositCents}
            customDepositInput={customDepositInput}
            onInputChange={setCustomDepositInput}
            onApply={(amountCents) => {
              setCustomDepositCents(amountCents);
              if (amountCents > 0) setRequireCardOnFile(true);
            }}
            onClear={() => {
              setCustomDepositCents(null);
              setCustomDepositInput('');
              setRequireCardOnFile(true);
            }}
            compact={true}
            showZeroHint={true}
          />

          {customDepositCents === 0 && (
            <CardOnFileRequirement
              requireCardOnFile={requireCardOnFile}
              onChange={setRequireCardOnFile}
            />
          )}

          <TaxWaiver
            taxCents={calculatedPricing?.tax_cents || 0}
            taxWaived={taxWaived}
            taxWaiveReason={taxWaiveReason}
            onToggle={(reason) => {
              setTaxWaived(!taxWaived);
              setTaxWaiveReason(reason);
            }}
            applyTaxesByDefault={pricingRules?.apply_taxes_by_default ?? true}
            originalOrderTaxCents={0}
            compact={true}
          />

          {((calculatedPricing?.travel_fee_cents || 0) > 0 || travelFeeWaived) && (
            <FeeWaiver
              feeName="Travel Fee"
              feeAmount={calculatedPricing?.travel_fee_cents || 0}
              isWaived={travelFeeWaived}
              waiveReason={travelFeeWaiveReason}
              onToggle={(reason) => {
                setTravelFeeWaived(!travelFeeWaived);
                setTravelFeeWaiveReason(reason);
              }}
              color="orange"
              compact={true}
            />
          )}

          {((calculatedPricing?.same_day_pickup_fee_cents || 0) > 0 || sameDayPickupFeeWaived) && (
            <FeeWaiver
              feeName="Same Day Pickup Fee"
              feeAmount={calculatedPricing?.same_day_pickup_fee_cents || 0}
              isWaived={sameDayPickupFeeWaived}
              waiveReason={sameDayPickupFeeWaiveReason}
              onToggle={(reason) => {
                setSameDayPickupFeeWaived(!sameDayPickupFeeWaived);
                setSameDayPickupFeeWaiveReason(reason);
              }}
              color="blue"
              compact={true}
            />
          )}

          {((calculatedPricing?.surface_fee_cents || 0) > 0 || surfaceFeeWaived) && (
            <FeeWaiver
              feeName="Sandbags Fee"
              feeAmount={calculatedPricing?.surface_fee_cents || 0}
              isWaived={surfaceFeeWaived}
              waiveReason={surfaceFeeWaiveReason}
              onToggle={(reason) => {
                setSurfaceFeeWaived(!surfaceFeeWaived);
                setSurfaceFeeWaiveReason(reason);
              }}
              color="orange"
              compact={true}
            />
          )}

          {((calculatedPricing?.generator_fee_cents || 0) > 0 || generatorFeeWaived) && (
            <FeeWaiver
              feeName="Generator Fee"
              feeAmount={calculatedPricing?.generator_fee_cents || 0}
              isWaived={generatorFeeWaived}
              waiveReason={generatorFeeWaiveReason}
              onToggle={(reason) => {
                setGeneratorFeeWaived(!generatorFeeWaived);
                setGeneratorFeeWaiveReason(reason);
              }}
              color="blue"
              compact={true}
            />
          )}

          {((calculatedPricing?.same_day_weekday_delivery_fee_cents || 0) > 0 || sameDayWeekdayDeliveryFeeWaived) && (
            <FeeWaiver
              feeName="Same-Day Weekday Delivery Fee"
              feeAmount={calculatedPricing?.same_day_weekday_delivery_fee_cents || 0}
              isWaived={sameDayWeekdayDeliveryFeeWaived}
              waiveReason={sameDayWeekdayDeliveryFeeWaiveReason}
              onToggle={(reason) => {
                setSameDayWeekdayDeliveryFeeWaived(!sameDayWeekdayDeliveryFeeWaived);
                setSameDayWeekdayDeliveryFeeWaiveReason(reason);
              }}
              color="orange"
              compact={true}
            />
          )}


          <AdminMessage value={adminMessage} onChange={setAdminMessage} compact={true} variant="invoice" />

          {orderSummary && (
            <OrderSummary
              summary={orderSummary}
              showDeposit={true}
              showTip={false}
              title="Invoice Summary"
              customDepositCents={customDepositCents}
              taxWaived={taxWaived}
              travelFeeWaived={travelFeeWaived}
              surfaceFeeWaived={surfaceFeeWaived}
              generatorFeeWaived={generatorFeeWaived}
              sameDayPickupFeeWaived={sameDayPickupFeeWaived}
              sameDayWeekdayDeliveryFeeWaived={sameDayWeekdayDeliveryFeeWaived}
            />
          )}

          <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 lg:p-6 min-w-0">
            <button
              onClick={handleGenerateInvoice}
              disabled={saving || (cartItems.length === 0 && stagedEEItems.filter(i => !i.is_deleted).length === 0) || availabilityIssues.length > 0 || generatorResolutionPending || checkingAvailability || !pricingIsCurrent}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <Send className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
              <span className="truncate">
                {saving
                  ? 'Generating...'
                  : availabilityIssues.length > 0
                    ? 'Resolve Availability Issues'
                    : customerManagement.selectedCustomer
                      ? 'Send Invoice to Customer'
                      : 'Generate Shareable Link'}
              </span>
            </button>
            <p className="text-xs text-slate-500 text-center mt-2">
              {customerManagement.selectedCustomer
                ? 'Invoice will be sent via email and SMS'
                : 'A shareable link will be generated for you to send manually'}
            </p>
            {invoiceUrl && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(invoiceUrl);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
                title="Copy invoice link"
                className="mt-2 w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1.5 text-sm"
              >
                {copiedLink ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                {copiedLink ? 'Copied!' : 'Copy Link'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
