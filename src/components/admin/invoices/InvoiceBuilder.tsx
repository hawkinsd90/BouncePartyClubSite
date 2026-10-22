import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { OrderSummary } from '../../order/OrderSummary';
import { showToast } from '../../../lib/toasts';
import { DiscountsManager } from '../../order-detail/DiscountsManager';
import { CardOnFileRequirement } from '../../shared/CardOnFileRequirement';
import { CustomFeesManager } from '../../order-detail/CustomFeesManager';
import { EventDetailsEditor } from '../../order-detail/EventDetailsEditor';
import { ItemsEditor } from '../../shared/ItemsEditor';
import { CustomerSelector } from '../../invoice/CustomerSelector';
import { NewCustomerForm } from '../../invoice/NewCustomerForm';
import { InvoiceSuccessMessage } from '../../invoice/InvoiceSuccessMessage';
import { AdminMessage } from '../../order-detail/AdminMessage';
import { AddEventEssentialsSection } from '../../order-detail/AddEventEssentialsSection';
import { useInvoiceData } from '../../../hooks/invoices/useInvoiceData';
import { usePricing } from '../../../hooks/booking/usePricing';
import { useInvoiceCart } from '../../../hooks/invoices/useInvoiceCart';
import { useCustomerManagement } from '../../../hooks/admin/useCustomerManagement';
import { useInvoiceEventDetails } from '../../../hooks/invoices/useInvoiceEventDetails';
import { generateInvoice } from '../../../lib/payments/invoiceService';
import { checkMultipleUnitsAvailability } from '../../../lib/booking/availability';
import { resolveAdminGeneratorIncrease, decideAdminGeneratorDecrease } from '../../../lib/eventEssentials/adminGeneratorResolution';
import { fetchAdminProductCategories, fetchAdminInventoryProducts, loadAdminResolverCatalogRows, checkEventEssentialsAvailability } from '../../../lib/queries/products';
import { InvoiceAvailabilityBanner } from './builder/InvoiceAvailabilityBanner';
import { InvoiceFeeWaivers } from './builder/InvoiceFeeWaivers';
import { InvoiceSetupFeeOverride } from './builder/InvoiceSetupFeeOverride';
import { InvoiceDepositControls } from './builder/InvoiceDepositControls';
import { InvoiceActions } from './builder/InvoiceActions';
import { mapCartToStagedForResolver } from './builder/invoiceResolverItems';
import { buildGeneratorResolverCatalog } from '../orders/detail-modal/generatorResolverCatalog';
import {
  addEEProductToStagedItems,
  addEEBundleToStagedItems,
  removeStagedItem,
  updateStagedItemQuantity,
  type StagedItem,
} from '../orders/detail-modal/stagedItemModel';
import {
  sortDirectGeneratorItemsNewestFirst,
  reduceDirectGeneratorItems,
  applyGeneratorEeCandidate,
} from '../orders/detail-modal/generatorStagedItems';

// What the availability banner shows: a unit (or Event Essentials) and the orders it conflicts with.
interface InvoiceAvailabilityIssue { unitName: string; unitId: string; conflicts: unknown[] }

interface StagedEEItem {
  client_id: string;
  product_id: string | null;
  bundle_id?: string | null;
  item_name: string;
  product_name: string;
  qty: number;
  unit_price_cents: number;
  pricing_context: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- two different BundleComponentSnapshot types (types/index and stagedItemModel) meet here; unifying them is outside this cleanup
  component_snapshot?: any;
  is_new?: boolean;
  is_deleted?: boolean;
}

export function InvoiceBuilder() {
  const { customers, units, pricingRules, addCustomer } = useInvoiceData();
  const { cartItems, addItemToCart, removeItemFromCart, updateItemQuantity, clearCart } =
    useInvoiceCart();
  const customerManagement = useCustomerManagement();
  const { eventDetails, updateEventDetails, resetEventDetails } = useInvoiceEventDetails();

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
  const [customSetupFeeCents, setCustomSetupFeeCents] = useState<number | null>(null);
  const [customSetupFeeInput, setCustomSetupFeeInput] = useState('');
  const [requireCardOnFile, setRequireCardOnFile] = useState(true);
  const [availabilityIssues, setAvailabilityIssues] = useState<InvoiceAvailabilityIssue[]>([]);
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
        const generatorCat = cats.find((c) => c.slug === 'generators');
        if (!generatorCat) {
          setGeneratorProductIdsState({ status: 'ready', ids: new Set() });
          return;
        }
        const genProductIds = new Set(
          products
            .filter((p) => p.category_id === generatorCat.id && p.active !== false)
            .map((p) => p.id)
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
      const decision = decideAdminGeneratorDecrease({
        current: { legacyQty: eventDetails.generator_qty ?? 0, directEeQty: directQty },
        requestedTotal: requestedQty,
      });

      const directByNewest = sortDirectGeneratorItemsNewestFirst(directItems as StagedItem[], stagedEEItems as StagedItem[]);
      let remainingDirectReduction = Math.min(decision.removeQty, directQty);

      setStagedEEItems((previous) => {
        const reduced = reduceDirectGeneratorItems(
          previous as StagedItem[],
          directByNewest,
          remainingDirectReduction,
        );

        remainingDirectReduction = reduced.remainingBudget;

        return reduced.next as StagedEEItem[];
      });

      updateEventDetails({ generator_qty: decision.newLegacyQty });
      if (decision.newLegacyQty === 0) {
        setGeneratorFeeWaived(false);
        setGeneratorFeeWaiveReason('');
      }
      return;
    }

    // INCREASE
    const additionalQty = requestedQty - currentTotal;
    setGeneratorResolutionPending(true);

    try {
      const { catsRes, prodsRes, pricingRes, bundlesRes } = await loadAdminResolverCatalogRows();

      if (isStale()) return;

      if (catsRes.error || prodsRes.error || pricingRes.error || bundlesRes.error) {
        if (!isStale()) showToast('Unable to load product catalog for Generator pricing. Please try again.', 'error');
        return;
      }

      const allProducts = prodsRes.data || [];
      const allPricing = pricingRes.data || [];
      const allCats = catsRes.data || [];
      const allBundles = bundlesRes.data || [];

      const catalog = buildGeneratorResolverCatalog({
        productRows: allProducts,
        pricingRows: allPricing,
        categoryRows: allCats,
        bundleRows: allBundles,
        unitRows: units,
      });

      if (isStale()) return;
      if (startingContextRevision !== generatorContextRevisionRef.current) {
        if (!isStale()) showToast('Invoice details changed while Generator availability was being checked. Please select the Generator quantity again.', 'error');
        return;
      }

      // Build complete resolver context: inflatables + EE items.
      const completeStagedItems = [
        ...mapCartToStagedForResolver(cartItems),
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
        stagedItems: completeStagedItems,
        eventDate: eventDetails.event_date,
        eventEndDate: eventDetails.event_end_date,
        orderId: null,
        productConfigs: catalog.productConfigs,
        bundleConfigs: catalog.bundleConfigs,
        categories: catalog.categories,
        units: catalog.units,
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

        setStagedEEItems((previous) =>
          applyGeneratorEeCandidate(
            previous as StagedItem[],
            product,
            resolvedUnitPriceCents,
            resolvedPricingContext,
            additionalQty,
            () => `new-generator-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          ) as StagedEEItem[],
        );
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
    setStagedEEItems(prev => addEEProductToStagedItems(prev as StagedItem[], item, () => `new-ee-${Date.now()}-${Math.random().toString(36).slice(2)}`) as StagedEEItem[]);
  }, []);

  const handleAddEEBundle = useCallback((item: any) => {
    setStagedEEItems(prev => addEEBundleToStagedItems(prev as StagedItem[], item, () => `new-ee-${Date.now()}-${Math.random().toString(36).slice(2)}`) as StagedEEItem[]);
  }, []);

  const handleRemoveEEItem = useCallback((item: StagedItem) => {
    setStagedEEItems(prev => removeStagedItem(prev as StagedItem[], item) as StagedEEItem[]);
  }, []);

  const handleUpdateEEQuantity = useCallback((item: StagedItem, qty: number) => {
    setStagedEEItems(prev => updateStagedItemQuantity(prev as StagedItem[], item, qty) as StagedEEItem[]);
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
    csf: customSetupFeeCents,
    pr: pricingRules,
    tw: taxWaived,
    tfw: travelFeeWaived,
    sdpw: sameDayPickupFeeWaived,
    sfw: surfaceFeeWaived,
    gfw: generatorFeeWaived,
    sdwdw: sameDayWeekdayDeliveryFeeWaived,
  }), [cartItems, stagedEEItems, eventDetails.event_date, eventDetails.event_end_date, eventDetails.location_type, eventDetails.surface, eventDetails.pickup_preference, eventDetails.generator_qty, eventDetails.address_line1, eventDetails.city, eventDetails.state, eventDetails.zip, eventDetails.lat, eventDetails.lng, discounts, customFees, customDepositCents, customSetupFeeCents, pricingRules, taxWaived, travelFeeWaived, sameDayPickupFeeWaived, surfaceFeeWaived, generatorFeeWaived, sameDayWeekdayDeliveryFeeWaived]);

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
        customSetupFeeCents,
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
    customSetupFeeCents,
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
      const issues: InvoiceAvailabilityIssue[] = [];

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
              conflicts: result.conflictingOrders!,
            });
          }
        }
      }

      // Check Event Essentials availability
      if (activeEEItems.length > 0) {
        try {
          const eeCheck = await checkEventEssentialsAvailability({
            items: activeEEItems.map(item => ({
              product_id: item.product_id,
              bundle_id: item.bundle_id,
              qty: item.qty,
              component_snapshot: item.component_snapshot,
            })),
            eventDate: eventDetails.event_date,
            eventEndDate: eventDetails.event_end_date || eventDetails.event_date,
            excludeOrderId: null,
          });
          if (!eeCheck.ok) {
            issues.push({ unitName: 'Event Essentials', unitId: 'ee', conflicts: [] });
          }
        } catch {
          issues.push({ unitName: 'Event Essentials', unitId: 'ee', conflicts: [] });
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

    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
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
        const eeCheck = await checkEventEssentialsAvailability({
          items: activeEEItems.map(item => ({
            product_id: item.product_id,
            bundle_id: item.bundle_id,
            qty: item.qty,
            component_snapshot: item.component_snapshot,
          })),
          eventDate: eventDetails.event_date,
          eventEndDate: eventDetails.event_end_date || eventDetails.event_date,
          excludeOrderId: null,
        });

        if (!eeCheck.ok) {
          showToast(
            eeCheck.kind === 'unavailable'
              ? 'Cannot create invoice: One or more Event Essentials are not available for the selected dates.'
              : 'Unable to verify Event Essentials availability. Please try again.',
            'error'
          );
          setSaving(false);
          return;
        }
      }

      if (!pricingIsCurrent) {
        showToast('Pricing is being updated. Please wait for the current price to finish calculating.', 'error');
        setSaving(false);
        return;
      }

      if (sameDayWeekdayDeliveryFeeWaived && !sameDayWeekdayDeliveryFeeWaiveReason.trim()) {
        showToast('A reason is required to waive the Same-Day Delivery Fee', 'error');
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
          customDepositCents,
          customSetupFeeCents,
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
        },
        customer
      );

      setInvoiceUrl(result.invoiceUrl);

      if (!customerManagement.selectedCustomer) {
        showToast('Invoice created! Copy the link below to send to your customer.', 'success');
      } else {
        showToast(`Invoice sent to ${customer?.email ?? 'the customer'}${customer?.phone ? ` and ${customer.phone}` : ''}!`, 'success');
      }

      clearCart();
      setStagedEEItems([]);
      setDiscounts([]);
      setCustomFees([]);
      setCustomDepositCents(null);
      setCustomDepositInput('');
      setCustomSetupFeeCents(null);
      setCustomSetupFeeInput('');
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
            hasInflatables={cartItems.length > 0}
          />

          <InvoiceAvailabilityBanner
            checkingAvailability={checkingAvailability}
            availabilityIssues={availabilityIssues}
          />

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
              ...mapCartToStagedForResolver(cartItems),
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

          <InvoiceDepositControls
            calculatedDepositCents={calculatedPricing?.deposit_due_cents || 0}
            customDepositCents={customDepositCents}
            customDepositInput={customDepositInput}
            setCustomDepositInput={setCustomDepositInput}
            setCustomDepositCents={setCustomDepositCents}
            setRequireCardOnFile={setRequireCardOnFile}
          />

          <InvoiceSetupFeeOverride
            calculatedPricing={calculatedPricing}
            customSetupFeeCents={customSetupFeeCents}
            customSetupFeeInput={customSetupFeeInput}
            setCustomSetupFeeCents={setCustomSetupFeeCents}
            setCustomSetupFeeInput={setCustomSetupFeeInput}
          />

          {customDepositCents === 0 && (
            <CardOnFileRequirement
              requireCardOnFile={requireCardOnFile}
              onChange={setRequireCardOnFile}
            />
          )}

          <InvoiceFeeWaivers
            calculatedPricing={calculatedPricing}
            pricingRules={pricingRules}
            taxWaived={taxWaived}
            taxWaiveReason={taxWaiveReason}
            setTaxWaived={setTaxWaived}
            setTaxWaiveReason={setTaxWaiveReason}
            travelFeeWaived={travelFeeWaived}
            travelFeeWaiveReason={travelFeeWaiveReason}
            setTravelFeeWaived={setTravelFeeWaived}
            setTravelFeeWaiveReason={setTravelFeeWaiveReason}
            sameDayPickupFeeWaived={sameDayPickupFeeWaived}
            sameDayPickupFeeWaiveReason={sameDayPickupFeeWaiveReason}
            setSameDayPickupFeeWaived={setSameDayPickupFeeWaived}
            setSameDayPickupFeeWaiveReason={setSameDayPickupFeeWaiveReason}
            surfaceFeeWaived={surfaceFeeWaived}
            surfaceFeeWaiveReason={surfaceFeeWaiveReason}
            setSurfaceFeeWaived={setSurfaceFeeWaived}
            setSurfaceFeeWaiveReason={setSurfaceFeeWaiveReason}
            generatorFeeWaived={generatorFeeWaived}
            generatorFeeWaiveReason={generatorFeeWaiveReason}
            setGeneratorFeeWaived={setGeneratorFeeWaived}
            setGeneratorFeeWaiveReason={setGeneratorFeeWaiveReason}
            sameDayWeekdayDeliveryFeeWaived={sameDayWeekdayDeliveryFeeWaived}
            sameDayWeekdayDeliveryFeeWaiveReason={sameDayWeekdayDeliveryFeeWaiveReason}
            setSameDayWeekdayDeliveryFeeWaived={setSameDayWeekdayDeliveryFeeWaived}
            setSameDayWeekdayDeliveryFeeWaiveReason={setSameDayWeekdayDeliveryFeeWaiveReason}
          />


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

          <InvoiceActions
            saving={saving}
            hasNoActiveItems={cartItems.length === 0 && stagedEEItems.filter(i => !i.is_deleted).length === 0}
            hasAvailabilityIssues={availabilityIssues.length > 0}
            generatorResolutionPending={generatorResolutionPending}
            checkingAvailability={checkingAvailability}
            pricingIsCurrent={pricingIsCurrent}
            hasSelectedCustomer={!!customerManagement.selectedCustomer}
            invoiceUrl={invoiceUrl}
            copiedLink={copiedLink}
            onGenerate={handleGenerateInvoice}
            onCopyLink={() => {
              navigator.clipboard.writeText(invoiceUrl);
              setCopiedLink(true);
              setTimeout(() => setCopiedLink(false), 2000);
            }}
          />
        </div>
      </div>
    </div>
  );
}
