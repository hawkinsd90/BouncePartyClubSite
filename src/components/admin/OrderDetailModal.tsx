import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { checkMultipleUnitsAvailability } from '../../lib/availability';
import { buildEventEssentialAvailabilityRequestFromOrderItems, validateAvailabilityResult } from '../../lib/eeOrderItemAvailability';
import { checkProductAvailability } from '../../lib/queries/products';
import { formatOrderSummary } from '../../lib/orderSummary';
import { calculateDrivingDistance } from '../../lib/pricing';
import { HOME_BASE } from '../../lib/constants';
import { StatusChangeDialog } from '../order-detail/StatusChangeDialog';
import { OrderNotesTab } from '../order-detail/OrderNotesTab';
import { OrderWorkflowTab } from '../order-detail/OrderWorkflowTab';
import { OrderChangelogTab } from '../order-detail/OrderChangelogTab';
import { OrderDetailsTab } from '../order-detail/OrderDetailsTab';
import { PaymentsTab } from '../order-detail/PaymentsTab';
import { OrderDetailTabNav, type OrderDetailSection } from './order-detail-modal/OrderDetailTabNav';
import { OrderDetailHeader } from './order-detail-modal/OrderDetailHeader';
import { buildCurrentOrderSummaryData } from './order-detail-modal/buildCurrentOrderSummaryData';
import { buildInitialEditedOrder, hasOrderDetailChanges } from './order-detail-modal/editedOrderModel';
import { GeneratorLegacyConfirmDialogs } from './order-detail-modal/GeneratorLegacyConfirmDialogs';
import {
  buildStagedItemsFromOrderItems,
  buildNewInflatableItem,
  removeStagedItem,
  addEEProductToStagedItems,
  addEEBundleToStagedItems,
  updateStagedItemQuantity,
} from './order-detail-modal/stagedItemModel';
import type { StagedItem } from './order-detail-modal/stagedItemModel';
import {
  sortDirectGeneratorItemsNewestFirst,
  reduceDirectGeneratorItems,
  applyGeneratorEeCandidate,
} from './order-detail-modal/generatorStagedItems';
import { usePricing } from '../../hooks/usePricing';
import { useOrderDetails } from '../../hooks/useOrderDetails';
import { saveOrderChanges } from '../../lib/orderSaveService';
import { initDepositOverrideState } from '../../lib/depositCalculation';
import { sendOrderEditNotifications } from '../../lib/orderNotificationService';
import { SimpleConfirmModal } from '../common/SimpleConfirmModal';
import { ORDER_STATUS } from '../../lib/constants/statuses';
import { showToast } from '../../lib/notifications';
import { loadGeneratorCategoryProductIds } from '../../lib/generatorUnified';
import {
  resolveAdminGeneratorIncrease,
  decideAdminGeneratorDecrease,
  type AdminGeneratorStagedItem,
} from '../../lib/adminGeneratorResolution';
import {
  fetchAdminInventoryProducts,
  fetchAdminProductPricing,
  fetchAdminProductCategories,
  fetchAdminProductBundlesWithConfiguration,
} from '../../lib/queries/products';
import type {
  ResolverProductConfig,
  ResolverBundleConfig,
  ResolverCategory,
  ResolverUnitConfig,
  InflatableEligibilityMode,
} from '../../lib/eventEssentialsPricingTypes';

interface OrderDetailModalProps {
  order: any;
  onClose: () => void;
  onUpdate: () => void;
}

export type { StagedItem, BundleComponentSnapshot } from './order-detail-modal/stagedItemModel';

export function OrderDetailModal({ order, onClose, onUpdate }: OrderDetailModalProps) {
  const [activeSection, setActiveSection] = useState<OrderDetailSection>('details');
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [changelog, setChangelog] = useState<any[]>([]);
  const [notes] = useState<any[]>([]);
  const [workflowEvents] = useState<any[]>([]);
  const [availableUnits, setAvailableUnits] = useState<any[]>([]);
  const [editedOrder, setEditedOrder] = useState<any>(() => buildInitialEditedOrder(order));
  const [stagedItems, setStagedItems] = useState<StagedItem[]>([]);
  const stagedInitializedForOrderId = useRef<string | null>(null);
  const orderLoadRequestIdRef = useRef(0);
  const [loadedOrderItemsForOrderId, setLoadedOrderItemsForOrderId] = useState<string | null>(null);
  const [generatorProductIdsState, setGeneratorProductIdsState] = useState<{ status: 'loading' | 'ready' | 'failed'; ids: Set<string> }>({ status: 'loading', ids: new Set() });

  useEffect(() => {
    let cancelled = false;
    loadGeneratorCategoryProductIds()
      .then((ids) => { if (!cancelled) setGeneratorProductIdsState({ status: 'ready', ids }); })
      .catch(() => { if (!cancelled) setGeneratorProductIdsState({ status: 'failed', ids: new Set() }); });
    return () => { cancelled = true; };
  }, []);
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [customFees, setCustomFees] = useState<any[]>([]);
  const [adminMessage, setAdminMessage] = useState(order.admin_message || '');
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [pendingStatus, setPendingStatus] = useState('');
  const [adminSettings, setAdminSettings] = useState<any>(null);
  const [adminOverrideApproval, setAdminOverrideApproval] = useState(false);
  const [depositCatchupMode, setDepositCatchupMode] = useState<'require' | 'waive'>('require');
  const [availabilityIssues, setAvailabilityIssues] = useState<any[]>([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [depositOverrideState, setDepositOverrideState] = useState(() =>
    initDepositOverrideState(order.custom_deposit_cents),
  );
  const [customSetupFeeCents, setCustomSetupFeeCents] = useState<number | null>(null);
  const [customSetupFeeInput, setCustomSetupFeeInput] = useState('');
  const customDepositCents = depositOverrideState.customDepositCents;
  const customDepositInput = depositOverrideState.customDepositInput;
  const setCustomDepositCents = useCallback((cents: number | null) => {
    setDepositOverrideState((prev) => ({ ...prev, customDepositCents: cents }));
  }, []);
  const setCustomDepositInput = useCallback((input: string) => {
    setDepositOverrideState((prev) => ({ ...prev, customDepositInput: input }));
  }, []);
  const [currentOrderSummary, setCurrentOrderSummary] = useState<any>(null);
  const [requireCardOnFile, setRequireCardOnFile] = useState(order.require_card_on_file ?? true);
  const [manualDirty, setManualDirty] = useState(false);
  const [pricingPending, setPricingPending] = useState(false);
  const [lastSuccessfullyPricedRevision, setLastSuccessfullyPricedRevision] = useState<string | null>(null);

  // Initialize taxWaived based on actual tax state and current settings
  // For old orders created before apply_taxes_by_default setting:
  // - If tax was applied (tax_cents > 0) and current default is false, set taxWaived=true (override to apply)
  // - If tax was not applied (tax_cents = 0) and current default is true, set taxWaived=true (override to not apply)
  // - Otherwise use the order's tax_waived value
  const [taxWaived, setTaxWaived] = useState(() => {
    // If the order explicitly has tax_waived set to true, use that
    if (order.tax_waived === true) {
      return true;
    }
    // For orders where tax_waived is false but tax was charged, they were created before the setting
    // We need to check if we should override based on current settings vs. actual tax charged
    // This will be handled by the pricing calculation, so just use the stored value
    return order.tax_waived || false;
  });
  const [taxWaiveReason, setTaxWaiveReason] = useState(order.tax_waive_reason || '');
  const [travelFeeWaived, setTravelFeeWaived] = useState(order.travel_fee_waived || false);
  const [travelFeeWaiveReason, setTravelFeeWaiveReason] = useState(order.travel_fee_waive_reason || '');
  const [sameDayPickupFeeWaived, setSameDayPickupFeeWaived] = useState(order.same_day_pickup_fee_waived || false);
  const [sameDayPickupFeeWaiveReason, setSameDayPickupFeeWaiveReason] = useState(order.same_day_pickup_fee_waive_reason || '');
  const [surfaceFeeWaived, setSurfaceFeeWaived] = useState(order.surface_fee_waived || false);
  const [surfaceFeeWaiveReason, setSurfaceFeeWaiveReason] = useState(order.surface_fee_waive_reason || '');
  const [generatorFeeWaived, setGeneratorFeeWaived] = useState(order.generator_fee_waived || false);
  const [generatorFeeWaiveReason, setGeneratorFeeWaiveReason] = useState(order.generator_fee_waive_reason || '');
  const [generatorResolutionPending, setGeneratorResolutionPending] = useState(false);
  const generatorResolutionIdRef = useRef(0);
  const [generatorLegacyConfirm, setGeneratorLegacyConfirm] = useState<null | {
    resolutionId: number;
    contextRevision: string;
    additionalQty: number;
    isWaived: boolean;
  }>(null);
  const [sameDayWeekdayDeliveryFeeWaived, setSameDayWeekdayDeliveryFeeWaived] = useState(order.same_day_weekday_delivery_fee_waived || false);
  const [sameDayWeekdayDeliveryFeeWaiveReason, setSameDayWeekdayDeliveryFeeWaiveReason] = useState(order.same_day_weekday_delivery_fee_waive_reason || '');
  const [parksAcknowledgmentRequired, setParksAcknowledgmentRequired] = useState(order.parks_acknowledgment_required || false);
  const [parksAcknowledgmentCounty, setParksAcknowledgmentCounty] = useState(order.parks_acknowledgment_county || null);
  const [parksAcknowledgmentError, setParksAcknowledgmentError] = useState<string | null>(null);
  const [parksAcknowledgmentResolving, setParksAcknowledgmentResolving] = useState(false);

  const { orderSummary: updatedOrderSummary, calculatedPricing, pricingError, calculatePricing } = usePricing();
  const { payments, pricingRules, reload: reloadOrderData } = useOrderDetails(order.id);
  const pricingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pricing input signature — changes immediately when any pricing-affecting
  // dependency changes, even before the 300ms debounce fires.
  // Uses the full deterministic JSON string (no lossy hash) so two different
  // pricing inputs can never collapse to the same revision.
  const currentPricingRevision = useMemo(() => JSON.stringify({
    stagedItems: stagedItems.map(i => ({
      unit_id: i.unit_id, product_id: i.product_id, bundle_id: i.bundle_id,
      qty: i.qty, wet_or_dry: i.wet_or_dry, unit_price_cents: i.unit_price_cents,
      pricing_context: i.pricing_context, component_snapshot: i.component_snapshot,
      is_new: i.is_new, is_deleted: i.is_deleted, is_updated: i.is_updated,
    })),
    discounts: discounts.map((d: any) => ({ id: d.id, amount_cents: d.amount_cents, percentage: d.percentage, is_new: d.is_new })),
    customFees: customFees.map((f: any) => ({ id: f.id, amount_cents: f.amount_cents, is_new: f.is_new })),
    customDepositCents,
    customSetupFeeCents,
    location_type: editedOrder.location_type,
    surface: editedOrder.surface,
    generator_qty: editedOrder.generator_qty,
    address_line1: editedOrder.address_line1,
    address_city: editedOrder.address_city,
    address_state: editedOrder.address_state,
    address_zip: editedOrder.address_zip,
    pickup_preference: editedOrder.pickup_preference,
    event_date: editedOrder.event_date,
    event_end_date: editedOrder.event_end_date,
    taxWaived,
    travelFeeWaived,
    sameDayPickupFeeWaived,
    surfaceFeeWaived,
    generatorFeeWaived,
    sameDayWeekdayDeliveryFeeWaived,
    pricingRules: pricingRules ?? null,
  }), [
    stagedItems, discounts, customFees, customDepositCents, customSetupFeeCents,
    editedOrder.location_type, editedOrder.surface, editedOrder.generator_qty,
    editedOrder.address_line1, editedOrder.address_city, editedOrder.address_state,
    editedOrder.address_zip, editedOrder.pickup_preference,
    editedOrder.event_date, editedOrder.event_end_date,
    taxWaived, travelFeeWaived, sameDayPickupFeeWaived,
    surfaceFeeWaived, generatorFeeWaived, sameDayWeekdayDeliveryFeeWaived,
    pricingRules,
  ]);

  // Pricing is current only when the last successful calculation matches the
  // current input revision.
  const pricingIsCurrent = !pricingPending && !pricingError && !!calculatedPricing && lastSuccessfullyPricedRevision === currentPricingRevision;

  // Ref mirror so handleRecalculatePricing can check revision freshness
  // without depending on currentPricingRevision directly.
  const currentPricingRevisionRef = useRef(currentPricingRevision);
  currentPricingRevisionRef.current = currentPricingRevision;

  // Generator-resolution context signature — represents the inputs that affect
  // Generator pricing or availability. If any of these change while a Generator
  // resolution is running, the resolution is invalidated.
  const currentGeneratorContextRevision = useMemo(() => JSON.stringify({
    stagedItems: stagedItems.map(i => ({
      unit_id: i.unit_id, product_id: i.product_id, bundle_id: i.bundle_id,
      qty: i.qty, wet_or_dry: i.wet_or_dry, unit_price_cents: i.unit_price_cents,
      pricing_context: i.pricing_context, component_snapshot: i.component_snapshot,
      is_deleted: i.is_deleted,
    })),
    event_date: editedOrder.event_date,
    event_end_date: editedOrder.event_end_date,
    generator_qty: editedOrder.generator_qty,
    generatorFeeWaived,
  }), [
    stagedItems, editedOrder.event_date, editedOrder.event_end_date,
    editedOrder.generator_qty, generatorFeeWaived,
  ]);
  const currentGeneratorContextRevisionRef = useRef(currentGeneratorContextRevision);
  currentGeneratorContextRevisionRef.current = currentGeneratorContextRevision;

  useEffect(() => {
    // Load current order summary for display
    const loadCurrentSummary = async () => {
      let travelMiles = parseFloat(order.travel_total_miles) || 0;

      // If order has travel fee but no miles (old orders), calculate miles from address
      if (order.travel_fee_cents > 0 && travelMiles === 0 && order.addresses?.lat && order.addresses?.lng) {
        try {
          const lat = parseFloat(order.addresses.lat);
          const lng = parseFloat(order.addresses.lng);
          if (lat !== 0 && lng !== 0) {
            travelMiles = await calculateDrivingDistance(HOME_BASE.lat, HOME_BASE.lng, lat, lng);

            // Update the order in database with calculated miles
            if (travelMiles > 0) {
              await supabase
                .from('orders')
                .update({ travel_total_miles: travelMiles })
                .eq('id', order.id);
            }
          }
        } catch (error) {
          console.error('Error calculating travel miles for old order:', error);
        }
      }

      const summaryData = buildCurrentOrderSummaryData({
        order,
        orderItems,
        discounts,
        customFees,
        travelMiles,
        subtotalCents: order.subtotal_cents,
      });
      setCurrentOrderSummary(formatOrderSummary(summaryData));
    };

    if (orderItems.length > 0) {
      loadCurrentSummary().catch(err => {
        console.error('Error loading current order summary:', err);
        // Fallback: build summary from stored order fields without driving distance
        const fallbackSummary = buildCurrentOrderSummaryData({
          order,
          orderItems,
          discounts,
          customFees,
          travelMiles: parseFloat(order.travel_total_miles) || 0,
          subtotalCents: order.subtotal_cents || 0,
        });
        setCurrentOrderSummary(formatOrderSummary(fallbackSummary));
      });
    }
  }, [orderItems, order, discounts, customFees]);

  useEffect(() => {
    // Reset all order-specific state when switching to a different order.
    // This prevents stale items from a previous order being staged for the new one.
    const requestId = ++orderLoadRequestIdRef.current;
    const targetOrderId = order.id;
    setOrderItems([]);
    setStagedItems([]);
    setLoadedOrderItemsForOrderId(null);
    stagedInitializedForOrderId.current = null;
    loadOrderDetails(targetOrderId, requestId);
    loadAdminSettings();
    setDepositOverrideState(initDepositOverrideState(order.custom_deposit_cents));
  }, [order.id]);

  // Initialize staged items from order items (inflatables and EE products).
  // Runs once per order, after loadOrderDetails populates orderItems with
  // verified ownership (loadedOrderItemsForOrderId matches order.id).
  useEffect(() => {
    if (orderItems.length > 0 && loadedOrderItemsForOrderId === order.id && stagedInitializedForOrderId.current !== order.id) {
      stagedInitializedForOrderId.current = order.id;
      const staged: StagedItem[] = buildStagedItemsFromOrderItems(orderItems);
      setStagedItems(staged);
    }
  }, [orderItems, order.id]);

  // Track the original Setup Fee basis from verified staged items so we can
  // detect whether the equipment basis actually changed during this edit.
  // Reset when switching orders.
  const originalSetupFeeBasisRef = useRef<string | null>(null);
  useEffect(() => {
    originalSetupFeeBasisRef.current = null;
  }, [order.id]);

  // Compute the current Setup Fee basis from the current staged items.
  const currentSetupFeeBasis = useMemo(() => {
    const active = stagedItems.filter(item => !item.is_deleted);
    const hasInflatables = active.some(item => item.unit_id);
    const eeSubtotal = active
      .filter(item => !item.unit_id && (item.product_id || item.bundle_id))
      .reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);
    return JSON.stringify({ hasInflatables, eeSubtotal });
  }, [stagedItems]);

  // Initialize the original basis once, after staged items are verified.
  useEffect(() => {
    if (stagedInitializedForOrderId.current === order.id && originalSetupFeeBasisRef.current === null) {
      originalSetupFeeBasisRef.current = currentSetupFeeBasis;
    }
  }, [stagedItems, order.id, currentSetupFeeBasis]);

  const setupFeeBasisChanged = originalSetupFeeBasisRef.current !== null && originalSetupFeeBasisRef.current !== currentSetupFeeBasis;

  // Recalculate pricing whenever discounts, custom fees, staged items, or fee waivers change
  useEffect(() => {
    if (pricingRules && adminSettings && editedOrder && stagedItems.length > 0) {
      const revision = currentPricingRevision;
      setPricingPending(true);
      if (pricingDebounceRef.current) clearTimeout(pricingDebounceRef.current);
      pricingDebounceRef.current = setTimeout(() => {
        pricingDebounceRef.current = null;
        handleRecalculatePricing(revision);
      }, 300);
    }
    return () => {
      if (pricingDebounceRef.current) clearTimeout(pricingDebounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    discounts,
    customFees,
    customDepositCents,
    customSetupFeeCents,
    stagedItems,
    editedOrder.location_type,
    editedOrder.surface,
    editedOrder.generator_qty,
    editedOrder.address_line1,
    editedOrder.address_city,
    editedOrder.address_state,
    editedOrder.address_zip,
    editedOrder.pickup_preference,
    editedOrder.event_date,
    editedOrder.event_end_date,
    taxWaived,
    travelFeeWaived,
    sameDayPickupFeeWaived,
    surfaceFeeWaived,
    generatorFeeWaived,
    sameDayWeekdayDeliveryFeeWaived,
    pricingRules,
    adminSettings,
  ]);

  // Check if any changes have been made
  useEffect(() => {
    setHasChanges(manualDirty || hasOrderDetailChanges(editedOrder, order, stagedItems));
  }, [editedOrder, stagedItems, order, manualDirty]);

  // Handle multi-day logic: if dates are different, lock to next_day pickup
  useEffect(() => {
    if (editedOrder.event_date !== editedOrder.event_end_date) {
      if (editedOrder.pickup_preference === 'same_day') {
        setEditedOrder((prev: any) => ({ ...prev, pickup_preference: 'next_day' }));
      }
    }
  }, [editedOrder.event_date, editedOrder.event_end_date]);

  // Sync surface with can_stake
  useEffect(() => {
    if (editedOrder.can_stake && editedOrder.surface !== 'grass') {
      setEditedOrder((prev: any) => ({ ...prev, surface: 'grass' }));
    } else if (!editedOrder.can_stake && editedOrder.surface === 'grass') {
      setEditedOrder((prev: any) => ({ ...prev, surface: 'cement' }));
    }
  }, [editedOrder.can_stake]);

  // Check availability when dates or items change
  useEffect(() => {
    if (stagedItems.length > 0 && editedOrder.event_date && editedOrder.event_end_date) {
      const timer = setTimeout(() => {
        void checkAvailability().catch(error => {
          console.error(
            'Background availability check failed:',
            error
          );
        });
      }, 500); // Debounce for 500ms
      return () => clearTimeout(timer);
    }
  }, [editedOrder.event_date, editedOrder.event_end_date, stagedItems]);

  // Re-resolve county when the event address changes while Parks Acknowledgment is enabled
  useEffect(() => {
    if (!parksAcknowledgmentRequired) return;

    const addressChanged =
      editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
      editedOrder.address_city !== (order.addresses?.city || '') ||
      editedOrder.address_state !== (order.addresses?.state || '') ||
      editedOrder.address_zip !== (order.addresses?.zip || '');

    if (!addressChanged) return;

    // If county was captured from a new Google Places selection, use it directly
    if (editedOrder.address_county) {
      setParksAcknowledgmentCounty(editedOrder.address_county);
      setParksAcknowledgmentError(null);
      return;
    }

    // Otherwise reverse/forward geocode the new address
    let cancelled = false;
    setParksAcknowledgmentResolving(true);
    (async () => {
      try {
        const { reverseGeocodeCounty, forwardGeocodeCounty } = await import('../../lib/addressService');
        const lat = editedOrder.address_lat ?? null;
        const lng = editedOrder.address_lng ?? null;
        let county: string | null = null;

        if (lat != null && lng != null && lat !== 0 && lng !== 0) {
          county = await reverseGeocodeCounty(parseFloat(lat), parseFloat(lng));
        }
        if (!county) {
          const line1 = editedOrder.address_line1 || '';
          const city = editedOrder.address_city || '';
          const state = editedOrder.address_state || '';
          const zip = editedOrder.address_zip || '';
          if (line1 && city && state) {
            county = await forwardGeocodeCounty(line1, city, state, zip);
          }
        }

        if (cancelled) return;

        if (!county) {
          setParksAcknowledgmentCounty(null);
          setParksAcknowledgmentError(
            'Unable to determine the county from the new event address. Parks Acknowledgment cannot be saved until the county is resolved.'
          );
        } else {
          setParksAcknowledgmentCounty(county);
          setParksAcknowledgmentError(null);
        }
      } catch {
        if (cancelled) return;
        setParksAcknowledgmentCounty(null);
        setParksAcknowledgmentError(
          'Unable to determine the county from the new event address. Parks Acknowledgment cannot be saved until the county is resolved.'
        );
      } finally {
        if (!cancelled) setParksAcknowledgmentResolving(false);
      }
    })();

    return () => { cancelled = true; };
  }, [editedOrder.address_line1, editedOrder.address_city, editedOrder.address_state, editedOrder.address_zip, editedOrder.address_lat, editedOrder.address_lng, editedOrder.address_county, parksAcknowledgmentRequired, order.addresses]);

  async function loadAdminSettings() {
    try {
      const { data, error } = await supabase.from('admin_settings').select('*');
      if (error) throw error;

      if (data) {
        const settings: any = {};
        data.forEach((s: any) => {
          settings[s.key] = s.value;
        });
        setAdminSettings(settings);
      }
    } catch (error) {
      console.error('Error loading admin settings:', error);
    }
  }

  async function checkAvailability(): Promise<any[]> {
    if (!editedOrder.event_date || !editedOrder.event_end_date || stagedItems.length === 0) {
      setAvailabilityIssues([]);
      return [];
    }

    setCheckingAvailability(true);
    try {
      const activeItems = stagedItems.filter(item => !item.is_deleted && item.unit_id);
      const checks = activeItems.map(item => ({
        unitId: item.unit_id!,
        eventStartDate: editedOrder.event_date,
        eventEndDate: editedOrder.event_end_date,
        excludeOrderId: order.id,
      }));

      const results = await checkMultipleUnitsAvailability(checks);
      const finalIssues: any[] = results
        .filter(result => !result.isAvailable)
        .map(result => {
          const item = activeItems.find(i => i.unit_id === result.unitId);
          return {
            unitName: item?.unit_name || 'Unknown',
            unitId: result.unitId,
            conflicts: result.conflictingOrders,
          };
        });

      // Event Essentials availability check — append to same finalIssues array
      const eeItems = stagedItems.filter(item => !item.is_deleted && !item.unit_id && (item.product_id || item.bundle_id));
      if (eeItems.length > 0) {
        const expansion = buildEventEssentialAvailabilityRequestFromOrderItems(eeItems);
        if (expansion.status === 'invalid') {
          finalIssues.push({ unitName: 'Event Essentials', error: expansion.error });
        } else if (expansion.productQuantities.length > 0) {
          const eeResult = await checkProductAvailability(
            expansion.productQuantities,
            editedOrder.event_date,
            editedOrder.event_end_date,
            order.id,
          );
          if (eeResult.error) {
            finalIssues.push({ unitName: 'Event Essentials', error: eeResult.error });
          } else {
            const validation = validateAvailabilityResult(
              expansion.productQuantities.map(pq => pq.product_id),
              { data: eeResult.data, error: null },
            );
            if (!validation.ok) {
              finalIssues.push({ unitName: 'Event Essentials', error: validation.error || 'Event Essentials availability check failed' });
            }
          }
        }
      }

      setAvailabilityIssues(finalIssues);
      return finalIssues;
    } catch (error) {
      // Clear stale green state and expose controlled failure
      setAvailabilityIssues([{ unitName: 'Availability Check', error: 'Availability check failed. Please try again or contact us for assistance.' }]);
      throw error;
    } finally {
      setCheckingAvailability(false);
    }
  }

  const handleRecalculatePricing = useCallback(async (revision: string) => {
    if (!pricingRules || !adminSettings) {
      if (revision === currentPricingRevisionRef.current) {
        setPricingPending(false);
      }
      return;
    }
    const inflatableItems = stagedItems
      .filter(item => item.unit_id && !item.product_id)
      .map(item => ({
        unit_id: item.unit_id!,
        unit_name: item.unit_name || 'Unknown',
        qty: item.qty,
        wet_or_dry: item.wet_or_dry || 'dry',
        unit_price_cents: item.unit_price_cents,
        is_new: item.is_new,
        is_deleted: item.is_deleted,
      }));
    const eeProductItems = stagedItems
      .filter(item => !item.unit_id && !item.is_deleted && (item.product_id || item.bundle_id))
      .map(item => ({
        product_id: item.product_id!,
        bundle_id: item.bundle_id!,
        product_name: item.product_name || item.item_name || 'Event Essential',
        qty: item.qty,
        unit_price_cents: item.unit_price_cents,
        pricing_context: item.pricing_context,
        component_snapshot: item.component_snapshot ?? null,
        is_new: item.is_new,
        is_deleted: item.is_deleted,
      }));
    try {
      const result = await calculatePricing({
        items: inflatableItems,
        eeProductItems,
        eventDetails: {
          event_date: editedOrder.event_date,
          event_end_date: editedOrder.event_end_date,
          location_type: editedOrder.location_type,
          surface: editedOrder.surface,
          pickup_preference: editedOrder.pickup_preference,
          generator_qty: editedOrder.generator_qty,
          address_line1: editedOrder.address_line1,
          address_city: editedOrder.address_city,
          address_state: editedOrder.address_state,
          address_zip: editedOrder.address_zip,
        },
        discounts,
        customFees,
        customDepositCents,
        customSetupFeeCents,
        storedSetupFeeCents: order.setup_fee_cents ?? 0,
        setupFeeBasisChanged,
        pricingRules: pricingRules as any,
        feeWaivers: {
          taxWaived,
          travelFeeWaived,
          sameDayPickupFeeWaived,
          surfaceFeeWaived,
          generatorFeeWaived,
          sameDayWeekdayDeliveryFeeWaived,
        },
        existingOrder: {
          ...order,
          event_date: order.event_date,
          same_day_weekday_delivery_fee_cents: order.same_day_weekday_delivery_fee_cents ?? 0,
        },
      });
      // Only commit this revision if the calculation succeeded AND it is still
      // the current revision.
      if (result.status === 'success' && revision === currentPricingRevisionRef.current) {
        setLastSuccessfullyPricedRevision(revision);
      }
    } finally {
      // Only clear pending if this revision is still the latest.
      if (revision === currentPricingRevisionRef.current) {
        setPricingPending(false);
      }
    }
  }, [order, editedOrder, stagedItems, discounts, customFees, customDepositCents, customSetupFeeCents, setupFeeBasisChanged, pricingRules, adminSettings, taxWaived, travelFeeWaived, sameDayPickupFeeWaived, surfaceFeeWaived, generatorFeeWaived, sameDayWeekdayDeliveryFeeWaived, calculatePricing]);

  async function loadOrderDetails(targetOrderId: string, requestId: number) {
    try {
      const [itemsRes, changelogRes, unitsRes, discountsRes, customFeesRes] = await Promise.all([
        supabase.from('order_items').select('*, units(name, price_dry_cents, price_water_cents)').eq('order_id', targetOrderId),
        supabase.from('order_changelog').select('*').eq('order_id', targetOrderId).order('created_at', { ascending: false }),
        supabase.from('units').select('*').eq('active', true).order('name'),
        supabase.from('order_discounts').select('*').eq('order_id', targetOrderId).order('created_at', { ascending: false }),
        supabase.from('order_custom_fees').select('*').eq('order_id', targetOrderId).order('created_at', { ascending: false }),
      ]);

      // Request ownership: discard if a newer load was started or the order changed.
      if (requestId !== orderLoadRequestIdRef.current) return;

      if (itemsRes.data) {
        setOrderItems(itemsRes.data);
        setLoadedOrderItemsForOrderId(targetOrderId);
      }
      if (changelogRes.data) setChangelog(changelogRes.data);
      if (unitsRes.data) setAvailableUnits(unitsRes.data);
      if (discountsRes.data) setDiscounts(discountsRes.data);
      if (customFeesRes.data) setCustomFees(customFeesRes.data);
    } catch (error) {
      console.error('Error loading order details:', error);
    }
  }

  async function logChange(field: string, oldValue: any, newValue: any, action: 'update' | 'add' | 'remove' = 'update') {
    try {
      const user = (await supabase.auth.getUser()).data.user;
      await supabase.from('order_changelog').insert({
        order_id: order.id,
        user_id: user?.id || null,
        field_changed: field,
        field_name: field,
        changed_by: user?.id || null,
        notes: null,
        old_value: oldValue !== null && oldValue !== undefined ? String(oldValue) : null,
        new_value: newValue !== null && newValue !== undefined ? String(newValue) : null,
        change_type: action === 'update' ? 'edit' : action === 'add' ? 'add' : 'remove',
      });
    } catch (error) {
      console.error('Error logging change:', error);
    }
  }

  const stageAddItem = useCallback((unit: any, mode: 'dry' | 'water') => {
    const newItem = buildNewInflatableItem(
      unit,
      mode,
      () => `new-inflatable-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    setStagedItems(prev => [...prev, newItem]);
  }, []);

  const stageRemoveItem = useCallback((itemToRemove: StagedItem) => {
    setStagedItems(prev => removeStagedItem(prev, itemToRemove));
  }, []);

  async function handleSaveChanges() {
    if (generatorResolutionPending) {
      showToast('Generator availability is still being resolved. Please wait.', 'error');
      return;
    }
    if (generatorLegacyConfirm) {
      showToast('Please finish the Generator selection before saving.', 'error');
      return;
    }
    if (pricingPending) {
      showToast('Pricing is still being recalculated. Please wait for the updated totals.', 'error');
      return;
    }
    if (pricingError) {
      showToast(`Cannot save: ${pricingError}`, 'error');
      return;
    }
    if (!calculatedPricing || lastSuccessfullyPricedRevision !== currentPricingRevision) {
      showToast('Pricing is still being recalculated. Please wait for the updated totals.', 'error');
      return;
    }
    setSaving(true);
    try {
      const latestAvailabilityIssues = await checkAvailability();

      await saveOrderChanges({
        order,
        editedOrder,
        stagedItems,
        discounts,
        customFees,
        calculatedPricing,
        customDepositCents,
        customSetupFeeCents,
        adminMessage,
        adminOverrideApproval: order.status === ORDER_STATUS.DRAFT ? false : adminOverrideApproval,
        availabilityIssues: latestAvailabilityIssues,
        depositCatchupMode,
        requireCardOnFile,
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
        parksAcknowledgmentRequired,
        parksAcknowledgmentCounty,
        logChangeFn: logChange,
        sendNotificationsFn: async () => {
          await sendOrderEditNotifications({ order, adminMessage });
        },
        onComplete: async () => {
          const requestId = ++orderLoadRequestIdRef.current;
          await loadOrderDetails(order.id, requestId);
          setManualDirty(false);
          onUpdate();
          onClose();
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message !== 'Availability conflict') {
        console.error('Error saving changes:', error);
        showToast(
          `Failed to save changes: ${error.message}`,
          'error'
        );
      }
    } finally {
      setSaving(false);
    }
  }

  function initiateStatusChange(newStatus: string) {
    setPendingStatus(newStatus);
    setShowStatusDialog(true);
  }

  // Memoized callbacks to prevent child component re-renders
  const handleOrderChange = useCallback((updates: any) => {
    setEditedOrder((prev: any) => ({ ...prev, ...updates }));
    setManualDirty(true);
  }, []);

  const generatorProductIds = generatorProductIdsState.ids;

  const visibleGeneratorQty = useMemo(() => {
    if (generatorProductIdsState.status !== 'ready') return null;
    const directEeQty = stagedItems
      .filter((item) => !item.is_deleted && !!item.product_id && generatorProductIds.has(item.product_id))
      .reduce((sum, item) => sum + item.qty, 0);
    return (editedOrder.generator_qty ?? 0) + directEeQty;
  }, [editedOrder.generator_qty, generatorProductIds, generatorProductIdsState.status, stagedItems]);

  const handleGeneratorQtyChange = useCallback(async (requestedTotal: number): Promise<void> => {
    const requestedQty = Math.max(0, Number.isFinite(requestedTotal) ? Math.trunc(requestedTotal) : 0);

    if (generatorProductIdsState.status !== 'ready') {
      showToast('Generator product catalog is still loading. Please try again in a moment.', 'error');
      return;
    }

    // Version guard: each call gets a new resolution ID. Only the latest may mutate state.
    const resolutionId = ++generatorResolutionIdRef.current;
    const isStale = () => resolutionId !== generatorResolutionIdRef.current;
    // Context guard: capture the order context at resolution start. If it changes
    // mid-resolution, the result is invalidated.
    const startingContextRevision = currentGeneratorContextRevisionRef.current;
    const isContextStale = () => startingContextRevision !== currentGeneratorContextRevisionRef.current;
    const isInvalid = () => isStale() || isContextStale();

    const directItems = stagedItems.filter((item) => !item.is_deleted && !!item.product_id && generatorProductIds.has(item.product_id));
    const directQty = directItems.reduce((sum, item) => sum + item.qty, 0);
    const currentTotal = (editedOrder.generator_qty ?? 0) + directQty;

    if (requestedQty === currentTotal) return;

    // DECREASE — synchronous, but still check staleness for consistency.
    if (requestedQty < currentTotal) {
      const decision = decideAdminGeneratorDecrease({
        current: { legacyQty: editedOrder.generator_qty ?? 0, directEeQty: directQty },
        requestedTotal: requestedQty,
      });

      if (decision.removeQty <= 0) return;

      // Newest-first ordering:
      // 1. Unsaved rows by descending stagedItems index (highest index = newest)
      // 2. Persisted rows by created_at descending, tie-broken by id descending
      const directByNewest = sortDirectGeneratorItemsNewestFirst(directItems, stagedItems);
      let remainingDirectReduction = Math.min(decision.removeQty, directQty);

      setStagedItems((previous) => {
        const reduced = reduceDirectGeneratorItems(
          previous,
          directByNewest,
          remainingDirectReduction,
        );

        remainingDirectReduction = reduced.remainingBudget;

        return reduced.next;
      });

      setEditedOrder((previous: any) => ({ ...previous, generator_qty: decision.newLegacyQty }));
      if (decision.newLegacyQty === 0) {
        setGeneratorFeeWaived(false);
        setGeneratorFeeWaiveReason('');
      }
      setManualDirty(true);
      return;
    }

    // INCREASE — async path with version + context guard.
    const additionalQty = requestedQty - currentTotal;
    setGeneratorResolutionPending(true);

    try {
      // Load full catalog config for the pricing resolver.
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

      if (isInvalid()) return;

      if (catsRes.error || prodsRes.error || pricingRes.error || bundlesRes.error) {
        if (!isInvalid()) showToast('Unable to load product catalog for Generator pricing. Please try again.', 'error');
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
      for (const u of availableUnits) unitMap[u.id] = { id: u.id, active: true };

      if (isInvalid()) return;

      const resolution = await resolveAdminGeneratorIncrease({
        current: { legacyQty: editedOrder.generator_qty ?? 0, directEeQty: directQty },
        requestedTotal: requestedQty,
        stagedItems: stagedItems as AdminGeneratorStagedItem[],
        eventDate: editedOrder.event_date,
        eventEndDate: editedOrder.event_end_date,
        orderId: order.id,
        productConfigs,
        bundleConfigs,
        categories: categoryMap,
        units: unitMap,
      });

      if (isInvalid()) {
        if (isContextStale() && !isStale()) {
          showToast('Order details changed while Generator availability was being checked. Please select the Generator quantity again.', 'error');
        }
        return;
      }

      if (resolution.status === 'fail_closed') {
        showToast(resolution.reason || 'Unable to verify Generator availability. Please try again.', 'error');
        return;
      }

      if (resolution.status === 'ee') {
        const { product, resolvedUnitPriceCents, resolvedPricingContext } = resolution.candidate;

        setStagedItems((previous) =>
          applyGeneratorEeCandidate(
            previous,
            product,
            resolvedUnitPriceCents,
            resolvedPricingContext,
            additionalQty,
            () => `new-generator-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          ),
        );

        setManualDirty(true);
        return;
      }

      // Legacy fallback (no_candidate).
      // Determine whether confirmation is needed before applying the legacy increase.
      const existingLegacyQty = editedOrder.generator_qty ?? 0;
      const isCurrentlyWaived = generatorFeeWaived;

      if (existingLegacyQty === 0) {
        // No existing legacy Generator — normal legacy creation.
        // If waiver is stale (waived but no generators), clear it before creating.
        if (isCurrentlyWaived) {
          setGeneratorFeeWaived(false);
          setGeneratorFeeWaiveReason('');
        }
        setEditedOrder((previous: any) => ({ ...previous, generator_qty: (previous.generator_qty ?? 0) + additionalQty }));
        setManualDirty(true);
        return;
      }

      // Existing legacy Generator present — require confirmation.
      // Store pending request with ownership info and show dialog.
      // Resolution itself is no longer pending — we are now waiting for Admin confirmation.
      setGeneratorLegacyConfirm({
        resolutionId,
        contextRevision: startingContextRevision,
        additionalQty,
        isWaived: isCurrentlyWaived,
      });
    } catch {
      if (!isInvalid()) showToast('Unable to load product catalog for Generator pricing. Please try again.', 'error');
    } finally {
      // Only the current resolution may clear the pending state.
      // An obsolete request must not clear a newer request's pending state.
      if (!isStale()) {
        setGeneratorResolutionPending(false);
      }
    }
  }, [editedOrder.event_date, editedOrder.event_end_date, editedOrder.generator_qty, generatorProductIdsState, generatorProductIds, stagedItems, order.id, availableUnits, generatorFeeWaived]);

  const handleGeneratorLegacyConfirm = useCallback(() => {
    const pending = generatorLegacyConfirm;
    if (!pending) return;

    // Verify request ownership: the confirmation must belong to the current resolution
    // and the order context must not have changed since the confirmation was opened.
    if (pending.resolutionId !== generatorResolutionIdRef.current ||
        pending.contextRevision !== currentGeneratorContextRevisionRef.current) {
      setGeneratorLegacyConfirm(null);
      showToast('Order details changed while Generator selection was pending. Please select the Generator quantity again.', 'error');
      return;
    }

    // KEEP WAIVED: increase legacy qty, preserve waiver.
    // REMOVE WAIVER: increase legacy qty, clear waiver (pricing recalculates).
    // This callback handles "keep waived" — the only confirm option for non-waived.
    // For waived, the three-way choice is handled by separate callbacks below.
    setEditedOrder((previous: any) => ({ ...previous, generator_qty: (previous.generator_qty ?? 0) + pending.additionalQty }));
    setManualDirty(true);
    setGeneratorLegacyConfirm(null);
  }, [generatorLegacyConfirm]);

  const handleGeneratorLegacyRemoveWaiver = useCallback(() => {
    const pending = generatorLegacyConfirm;
    if (!pending) return;

    if (pending.resolutionId !== generatorResolutionIdRef.current ||
        pending.contextRevision !== currentGeneratorContextRevisionRef.current) {
      setGeneratorLegacyConfirm(null);
      showToast('Order details changed while Generator selection was pending. Please select the Generator quantity again.', 'error');
      return;
    }

    setGeneratorFeeWaived(false);
    setGeneratorFeeWaiveReason('');
    setEditedOrder((previous: any) => ({ ...previous, generator_qty: (previous.generator_qty ?? 0) + pending.additionalQty }));
    setManualDirty(true);
    setGeneratorLegacyConfirm(null);
  }, [generatorLegacyConfirm]);

  const handleGeneratorLegacyCancel = useCallback(() => {
    setGeneratorLegacyConfirm(null);
  }, []);

  const handleAddressSelect = useCallback((result: any) => {
    setEditedOrder((prev: any) => ({
      ...prev,
      address_line1: result.street,
      address_city: result.city,
      address_state: result.state,
      address_zip: result.zip,
      address_lat: result.lat || null,
      address_lng: result.lng || null,
      address_county: result.county || null,
    }));
    setManualDirty(true);
  }, []);

  const handleParksAcknowledgmentToggle = useCallback(async () => {
    const newValue = !parksAcknowledgmentRequired;
    setParksAcknowledgmentRequired(newValue);
    setParksAcknowledgmentError(null);

    if (!newValue) {
      setParksAcknowledgmentCounty(null);
      setHasChanges(true);
      return;
    }

    // If county was already captured from a new Google Places selection, use it
    if (editedOrder.address_county) {
      setParksAcknowledgmentCounty(editedOrder.address_county);
      setHasChanges(true);
      return;
    }

    // Otherwise resolve county from the existing event address
    setParksAcknowledgmentResolving(true);
    try {
      const { reverseGeocodeCounty, forwardGeocodeCounty } = await import('../../lib/addressService');
      const lat = editedOrder.address_lat ?? order.addresses?.lat ?? null;
      const lng = editedOrder.address_lng ?? order.addresses?.lng ?? null;
      let county: string | null = null;

      if (lat != null && lng != null && lat !== 0 && lng !== 0) {
        county = await reverseGeocodeCounty(parseFloat(lat), parseFloat(lng));
      }

      if (!county) {
        const line1 = editedOrder.address_line1 || order.addresses?.line1 || '';
        const city = editedOrder.address_city || order.addresses?.city || '';
        const state = editedOrder.address_state || order.addresses?.state || '';
        const zip = editedOrder.address_zip || order.addresses?.zip || '';
        if (line1 && city && state) {
          county = await forwardGeocodeCounty(line1, city, state, zip);
        }
      }

      if (!county) {
        setParksAcknowledgmentRequired(false);
        setParksAcknowledgmentCounty(null);
        setParksAcknowledgmentError(
          'Unable to determine the county from the event address. Parks Acknowledgment cannot be enabled until the county is resolved.'
        );
      } else {
        setParksAcknowledgmentCounty(county);
        setHasChanges(true);
      }
    } catch (err) {
      setParksAcknowledgmentRequired(false);
      setParksAcknowledgmentCounty(null);
      setParksAcknowledgmentError(
        'Unable to determine the county from the event address. Parks Acknowledgment cannot be enabled until the county is resolved.'
      );
    } finally {
      setParksAcknowledgmentResolving(false);
    }
  }, [parksAcknowledgmentRequired, editedOrder, order]);

  const handleClose = useCallback(() => {
    if (hasChanges) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [hasChanges, onClose]);

  const handleAddEEProduct = useCallback((item: StagedItem) => {
    setStagedItems(prev =>
      addEEProductToStagedItems(
        prev,
        item,
        () => `new-ee-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ),
    );
    setManualDirty(true);
  }, []);

  const handleAddEEBundle = useCallback((item: StagedItem) => {
    setStagedItems(prev =>
      addEEBundleToStagedItems(
        prev,
        item,
        () => `new-ee-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ),
    );
    setManualDirty(true);
  }, []);

  const handleUpdateQuantity = useCallback((itemToUpdate: StagedItem, qty: number) => {
    setStagedItems(prev => updateStagedItemQuantity(prev, itemToUpdate, qty));
    setManualDirty(true);
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-0 md:p-4 overflow-y-auto">
      <div className="bg-white md:rounded-lg max-w-6xl w-full min-h-screen md:min-h-0 md:my-8">
        <OrderDetailHeader
          order={order}
          hasChanges={hasChanges}
          adminOverrideApproval={adminOverrideApproval}
          onAdminOverrideApprovalChange={setAdminOverrideApproval}
          saving={saving}
          pricingPending={pricingPending}
          pricingIsCurrent={pricingIsCurrent}
          generatorResolutionPending={generatorResolutionPending}
          generatorConfirmOpen={generatorLegacyConfirm !== null}
          onSave={handleSaveChanges}
          onClose={handleClose}
        />

        <OrderDetailTabNav activeSection={activeSection} onChange={setActiveSection} />

        <div className="px-3 md:px-6 py-4 md:py-6 max-h-[calc(100vh-200px)] md:max-h-[calc(100vh-300px)] overflow-y-auto">
          {activeSection === 'details' && (
            <OrderDetailsTab
              order={order}
              checkingAvailability={checkingAvailability}
              availabilityIssues={availabilityIssues}
              pricingError={pricingError}
              stagedItems={stagedItems}
              editedOrder={{ ...editedOrder, generator_display_qty: visibleGeneratorQty }}
              pricingRules={pricingRules}
              availableUnits={availableUnits}
              currentOrderSummary={currentOrderSummary}
              updatedOrderSummary={updatedOrderSummary}
              hasChanges={hasChanges}
              calculatedPricing={calculatedPricing}
              customDepositCents={customDepositCents}
              customSetupFeeCents={customSetupFeeCents}
              customSetupFeeInput={customSetupFeeInput}
              discounts={discounts}
              customFees={customFees}
              customDepositInput={customDepositInput}
              adminMessage={adminMessage}
              taxWaived={taxWaived}
              taxWaiveReason={taxWaiveReason}
              travelFeeWaived={travelFeeWaived}
              travelFeeWaiveReason={travelFeeWaiveReason}
              sameDayPickupFeeWaived={sameDayPickupFeeWaived}
              sameDayPickupFeeWaiveReason={sameDayPickupFeeWaiveReason}
              onOrderChange={handleOrderChange}
              onGeneratorQtyChange={handleGeneratorQtyChange}
              onAddressSelect={handleAddressSelect}
              generatorLoadState={generatorProductIdsState}
              generatorResolutionPending={generatorResolutionPending}
              onRemoveItem={stageRemoveItem}
              onAddItem={stageAddItem}
              onUpdateQuantity={handleUpdateQuantity}
              onDiscountsChange={setDiscounts}
              onFeesChange={setCustomFees}
              onDepositInputChange={setCustomDepositInput}
              onDepositApply={(amountCents) => {
                setCustomDepositCents(amountCents);
                setManualDirty(true);
              }}
              onDepositClear={() => {
                setCustomDepositCents(null);
                setCustomDepositInput('');
                setManualDirty(true);
              }}
              onSetupFeeApply={(amountCents) => {
                setCustomSetupFeeCents(amountCents);
                setManualDirty(true);
              }}
              onSetupFeeClear={() => {
                setCustomSetupFeeCents(null);
                setCustomSetupFeeInput('');
                setManualDirty(true);
              }}
              onSetupFeeInputChange={setCustomSetupFeeInput}
              onAdminMessageChange={(value) => {
                setAdminMessage(value);
                setManualDirty(true);
              }}
              onTaxWaivedToggle={(reason) => {
                setTaxWaived(!taxWaived);
                setTaxWaiveReason(reason);
                setManualDirty(true);
              }}
              onTravelFeeWaivedToggle={(reason) => {
                setTravelFeeWaived(!travelFeeWaived);
                setTravelFeeWaiveReason(reason);
                setManualDirty(true);
              }}
              onSameDayPickupFeeWaivedToggle={(reason) => {
                setSameDayPickupFeeWaived(!sameDayPickupFeeWaived);
                setSameDayPickupFeeWaiveReason(reason);
                setManualDirty(true);
              }}
              surfaceFeeWaived={surfaceFeeWaived}
              surfaceFeeWaiveReason={surfaceFeeWaiveReason}
              onSurfaceFeeWaivedToggle={(reason) => {
                setSurfaceFeeWaived(!surfaceFeeWaived);
                setSurfaceFeeWaiveReason(reason);
                setManualDirty(true);
              }}
              generatorFeeWaived={generatorFeeWaived}
              generatorFeeWaiveReason={generatorFeeWaiveReason}
              onGeneratorFeeWaiverToggle={(reason: string) => {
                setGeneratorFeeWaived((value: boolean) => !value);
                setGeneratorFeeWaiveReason(reason);
                setManualDirty(true);
              }}
              sameDayWeekdayDeliveryFeeWaived={sameDayWeekdayDeliveryFeeWaived}
              sameDayWeekdayDeliveryFeeWaiveReason={sameDayWeekdayDeliveryFeeWaiveReason}
              onSameDayWeekdayDeliveryFeeWaivedToggle={(reason) => {
                setSameDayWeekdayDeliveryFeeWaived(!sameDayWeekdayDeliveryFeeWaived);
                setSameDayWeekdayDeliveryFeeWaiveReason(reason);
                setManualDirty(true);
              }}
              parksAcknowledgmentRequired={parksAcknowledgmentRequired}
              parksAcknowledgmentCounty={parksAcknowledgmentCounty}
              parksAcknowledgmentError={parksAcknowledgmentError}
              parksAcknowledgmentResolving={parksAcknowledgmentResolving}
              onParksAcknowledgmentToggle={handleParksAcknowledgmentToggle}
              depositCatchupMode={depositCatchupMode}
              onDepositCatchupModeChange={setDepositCatchupMode}
              requireCardOnFile={requireCardOnFile}
              onRequireCardOnFileChange={(value) => {
                setRequireCardOnFile(value);
                setManualDirty(true);
              }}
              onStatusChange={initiateStatusChange}
              onMarkChanges={() => setManualDirty(true)}
              onAddEEProduct={handleAddEEProduct}
              onAddEEBundle={handleAddEEBundle}
            />
          )}

          {activeSection === 'workflow' && (
            <OrderWorkflowTab workflowEvents={workflowEvents} />
          )}

          {activeSection === 'payments' && (
            <PaymentsTab
              orderId={order.id}
              customerName={`${order.customers?.first_name} ${order.customers?.last_name}`}
              payments={payments}
              order={order}
              customFees={customFees}
              discounts={discounts.filter((d: any) => !d.is_new)}
              onPaymentsUpdate={() => {
                reloadOrderData();
                onUpdate();
              }}
            />
          )}

          {activeSection === 'notes' && (
            <OrderNotesTab orderId={order.id} notes={notes} onNotesChanged={() => {
            const requestId = ++orderLoadRequestIdRef.current;
            void loadOrderDetails(order.id, requestId);
          }} />
          )}

          {activeSection === 'changelog' && (
            <OrderChangelogTab changelog={changelog} />
          )}
        </div>
      </div>

      <StatusChangeDialog
        isOpen={showStatusDialog}
        onClose={() => {
          setShowStatusDialog(false);
          setPendingStatus('');
        }}
        orderId={order.id}
        currentStatus={order.status}
        pendingStatus={pendingStatus}
        stagedItems={stagedItems}
        eventDate={editedOrder.event_date}
        eventEndDate={editedOrder.event_end_date}
        onStatusChanged={async () => {
          const requestId = ++orderLoadRequestIdRef.current;
          await loadOrderDetails(order.id, requestId);
          onUpdate();
        }}
      />

      <SimpleConfirmModal
        isOpen={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        onConfirm={onClose}
        title="Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to close without saving?"
        confirmText="Close Without Saving"
        cancelText="Cancel"
        variant="warning"
      />

      <GeneratorLegacyConfirmDialogs
        pending={generatorLegacyConfirm}
        onConfirm={handleGeneratorLegacyConfirm}
        onRemoveWaiver={handleGeneratorLegacyRemoveWaiver}
        onCancel={handleGeneratorLegacyCancel}
      />
    </div>
  );
}
