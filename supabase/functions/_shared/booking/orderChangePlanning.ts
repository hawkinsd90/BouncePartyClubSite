// GENERATED COPY of src/lib/orderChangePlanning.ts. Do not edit here.
// Edit the source and run: node node_modules/jiti/bin/jiti.js src/lib/bookingSharedCopy.ts --write
// A test fails if this file differs from its source. Used by create-booking so the server prices exactly like the Quote.

// Pure order-change planning, extracted verbatim from orderSaveService.saveOrderChanges.
//
// Two stages, no I/O, no clock, no Supabase:
//   planOrderChanges   - everything the save decides before any child write: scalar/pricing/deposit/
//                        catch-up/balance fields, waivers, Parks, save-side payment clearing,
//                        item write operations, admin message and card-on-file.
//   finalizeOrderPlan  - the decisions that need the discount/custom-fee reconciliation counts:
//                        tracked/customer-visible flags, status, customer_view_updated_at.
//
// The service keeps every write, every logChange call and the whole commit tail. The persisted-total
// calculation is injected (orderSummary.calculateTotalFromOrder imports Supabase). The address upsert
// stays in the service; its canonical id is passed in. Current quirks are preserved on purpose, including
// that this save-side payment-clearing rule differs from the OrderDetailsTab warning.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ORDER_STATUS } from './orderStatuses.ts';
import { remainingDepositCents } from './orderMoney.ts';
import { eventAddressLine2, normalizeUnit } from './eventAddress.ts';

export type ChangeLog = [string, any, any];

interface ItemWriteBase {
  // Prefix of the error thrown when the write fails ("<errorLabel>: <message>").
  errorLabel: string;
  // The item changelog entry the service records immediately after this write.
  log: { field: string; oldValue: any; newValue: any; action: 'add' | 'remove' | 'update' };
}
export interface ItemInsertOperation extends ItemWriteBase { kind: 'insert'; payload: any }
export interface ItemDeleteOperation extends ItemWriteBase { kind: 'delete'; itemId: string }
export interface ItemUpdateOperation extends ItemWriteBase { kind: 'update'; itemId: string; payload: any }
export type ItemWriteOperation = ItemInsertOperation | ItemDeleteOperation | ItemUpdateOperation;

export interface OrderChangePlanInput {
  order: any;
  editedOrder: any;
  stagedItems: any[];
  discounts: any[];
  customFees: any[];
  calculatedPricing: any;
  customDepositCents: number | null;
  customSetupFeeCents: number | null;
  adminMessage: string;
  // Result of upsertCanonicalAddress; only read when the address changed.
  canonicalAddressId?: any;
  taxWaived?: boolean;
  taxWaiveReason?: string;
  travelFeeWaived?: boolean;
  travelFeeWaiveReason?: string;
  sameDayPickupFeeWaived?: boolean;
  sameDayPickupFeeWaiveReason?: string;
  surfaceFeeWaived?: boolean;
  surfaceFeeWaiveReason?: string;
  generatorFeeWaived?: boolean;
  generatorFeeWaiveReason?: string;
  sameDayWeekdayDeliveryFeeWaived?: boolean;
  sameDayWeekdayDeliveryFeeWaiveReason?: string;
  parksAcknowledgmentRequired?: boolean;
  parksAcknowledgmentCounty?: string | null;
  depositCatchupMode?: 'require' | 'waive';
  requireCardOnFile?: boolean;
}

export interface OrderChangePlanDeps {
  calculateTotal: (order: any, discounts: any[], customFees: any[]) => number;
}

export interface OrderChangePlan {
  changes: any;
  logs: ChangeLog[];
  itemOperations: ItemWriteOperation[];
  effectiveTotalCents: number;
  shouldClearPayment: boolean;
  preserveCurrentStatus: boolean;
  // Tracked / customer-visible facts known before discount and fee reconciliation.
  trackedBeforeReconciliation: boolean;
  customerVisibleBeforeReconciliation: boolean;
}

export interface ReconciliationCounts {
  deletedDiscountCount: number;
  updatedDiscountCount: number;
  deletedFeeCount: number;
  updatedFeeCount: number;
}

export interface FinalizedOrderPlan {
  // True when the service must run orders.update and the rest of the commit tail.
  shouldCommit: boolean;
  hasTrackedChanges: boolean;
  hasFieldChanges: boolean;
  hasCustomerVisibleChanges: boolean;
  preserveCurrentStatus: boolean;
  // Final orders.update payload (status / customer_view_updated_at added when committing).
  changes: any;
  logs: ChangeLog[];
}

// Same comparison the service uses to decide whether to upsert the canonical address.
// Part 8: Address change detection now includes address_line2
export function hasAddressChanged(order: any, editedOrder: any): boolean {
  return editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
    editedOrder.address_line2 !== eventAddressLine2(order) ||
    editedOrder.address_city !== (order.addresses?.city || '') ||
    editedOrder.address_state !== (order.addresses?.state || '') ||
    editedOrder.address_zip !== (order.addresses?.zip || '');
}

const PRESERVE_STATUS = new Set<string>([
  ORDER_STATUS.DRAFT, ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.COMPLETED,
  ORDER_STATUS.CANCELLED, ORDER_STATUS.VOID,
]);

// Part 7: Customer-visible classification — no broad logs.some fallback.
// Only explicit keys, item changes, discount changes, and fee changes count.
const CUSTOMER_VISIBLE_CHANGE_KEYS = new Set([
  'location_type', 'surface', 'generator_qty',
  'start_window', 'end_window', 'event_date', 'event_end_date',
  'pickup_preference', 'overnight_allowed', 'address_id',
  'subtotal_cents', 'generator_fee_cents', 'travel_fee_cents',
  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles',
  'travel_per_mile_cents', 'travel_is_flat_fee', 'surface_fee_cents',
  'same_day_pickup_fee_cents', 'same_day_weekday_delivery_fee_cents', 'tax_cents',
  'setup_fee_cents',
  'deposit_due_cents', 'balance_due_cents', 'custom_deposit_cents',
  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason',
  'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason',
  'surface_fee_waived', 'surface_fee_waive_reason',
  'generator_fee_waived', 'generator_fee_waive_reason',
  'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason',
  'admin_message', 'require_card_on_file',
]);

function planItemOperations(order: any, stagedItems: any[]): ItemWriteOperation[] {
  const operations: ItemWriteOperation[] = [];
  for (const item of stagedItems) {
    if (item.is_new && !item.is_deleted) {
      if (item.bundle_id && !item.unit_id) {
        // New EE package insert
        operations.push({
          kind: 'insert',
          payload: {
            order_id: order.id,
            bundle_id: item.bundle_id,
            product_id: null,
            item_name: item.item_name || item.product_name || null,
            qty: item.qty,
            unit_price_cents: item.unit_price_cents,
            pricing_context: item.pricing_context || null,
            wet_or_dry: null,
            unit_id: null,
            component_snapshot: item.component_snapshot ?? null,
          },
          errorLabel: 'Failed to add package',
          log: { field: 'order_items', oldValue: '', newValue: item.item_name || item.product_name || 'Package', action: 'add' },
        });
      } else if (item.product_id && !item.unit_id) {
        // New direct EE product insert
        operations.push({
          kind: 'insert',
          payload: {
            order_id: order.id,
            product_id: item.product_id,
            item_name: item.item_name || item.product_name || null,
            qty: item.qty,
            unit_price_cents: item.unit_price_cents,
            pricing_context: item.pricing_context || null,
            wet_or_dry: null,
            unit_id: null,
            bundle_id: null,
            component_snapshot: null,
          },
          errorLabel: 'Failed to add item',
          log: { field: 'order_items', oldValue: '', newValue: item.item_name || item.product_name || 'Event Essential', action: 'add' },
        });
      } else {
        // Existing inflatable insert behavior (unchanged)
        operations.push({
          kind: 'insert',
          payload: {
            order_id: order.id, unit_id: item.unit_id, qty: item.qty,
            wet_or_dry: item.wet_or_dry, unit_price_cents: item.unit_price_cents,
          },
          errorLabel: 'Failed to add item',
          log: { field: 'order_items', oldValue: '', newValue: `${item.unit_name} (${item.wet_or_dry})`, action: 'add' },
        });
      }
    } else if (item.is_deleted && item.id) {
      const itemLabel = item.product_id && !item.unit_id
        ? (item.item_name || item.product_name || 'Event Essential')
        : item.bundle_id && !item.unit_id
        ? (item.item_name || item.product_name || 'Package')
        : `${item.unit_name} (${item.wet_or_dry})`;
      operations.push({
        kind: 'delete',
        itemId: item.id,
        errorLabel: 'Failed to remove item',
        log: { field: 'order_items', oldValue: itemLabel, newValue: '', action: 'remove' },
      });
    } else if (item.id && !item.is_new && !item.is_deleted && item.is_updated) {
      if (item.product_id && !item.unit_id) {
        // Existing direct EE product update — qty only, preserve price/context
        operations.push({
          kind: 'update',
          itemId: item.id,
          payload: { qty: item.qty },
          errorLabel: 'Failed to update item',
          log: { field: 'order_items', oldValue: item.item_name || item.product_name || 'Event Essential', newValue: `${item.qty}`, action: 'update' },
        });
      } else if (item.bundle_id && !item.unit_id) {
        // Existing package update — qty only, preserve price/context/snapshot
        operations.push({
          kind: 'update',
          itemId: item.id,
          payload: { qty: item.qty },
          errorLabel: 'Failed to update package',
          log: { field: 'order_items', oldValue: item.item_name || item.product_name || 'Package', newValue: `${item.qty}`, action: 'update' },
        });
      } else {
        // Existing inflatable update behavior (unchanged)
        operations.push({
          kind: 'update',
          itemId: item.id,
          payload: {
            qty: item.qty,
            unit_price_cents: item.unit_price_cents,
            pricing_context: item.pricing_context || null,
          },
          errorLabel: 'Failed to update item',
          log: { field: 'order_items', oldValue: `${item.unit_name} (${item.wet_or_dry})`, newValue: `${item.qty} × ${item.unit_price_cents}`, action: 'update' },
        });
      }
    }
  }
  return operations;
}

export function planOrderChanges(input: OrderChangePlanInput, deps: OrderChangePlanDeps): OrderChangePlan {
  const {
    order, editedOrder, stagedItems, discounts, customFees, calculatedPricing,
    customDepositCents, customSetupFeeCents, adminMessage,
    taxWaived, taxWaiveReason, travelFeeWaived, travelFeeWaiveReason,
    sameDayPickupFeeWaived, sameDayPickupFeeWaiveReason, surfaceFeeWaived, surfaceFeeWaiveReason,
    generatorFeeWaived, generatorFeeWaiveReason, sameDayWeekdayDeliveryFeeWaived, sameDayWeekdayDeliveryFeeWaiveReason,
    parksAcknowledgmentRequired, parksAcknowledgmentCounty,
    depositCatchupMode, requireCardOnFile,
  } = input;
  const { calculateTotal: calculateTotalFromOrder } = deps;

  const changes: any = {};
  const logs: ChangeLog[] = [];

  if (editedOrder.location_type !== order.location_type) {
    changes.location_type = editedOrder.location_type;
    logs.push(['location_type', order.location_type, editedOrder.location_type]);
  }
  // EE-only orders (no inflatables) must persist surface = null.
  const hasInflatables = stagedItems.some(item => item.unit_id && !item.is_deleted);
  const effectiveSurface = hasInflatables ? editedOrder.surface : null;
  if (effectiveSurface !== order.surface) {
    changes.surface = effectiveSurface;
    logs.push(['surface', order.surface, effectiveSurface]);
  }
  if (editedOrder.generator_qty !== (order.generator_qty || 0)) {
    changes.generator_qty = editedOrder.generator_qty;
    logs.push(['generator_qty', order.generator_qty || 0, editedOrder.generator_qty]);
  }
  if (editedOrder.start_window !== order.start_window) {
    changes.start_window = editedOrder.start_window;
    logs.push(['start_window', order.start_window, editedOrder.start_window]);
  }
  if (editedOrder.end_window !== order.end_window) {
    changes.end_window = editedOrder.end_window;
    logs.push(['end_window', order.end_window, editedOrder.end_window]);
  }

  const normalizeDate = (dateStr: string) => dateStr ? dateStr.split('T')[0] : '';

  const originalEventDate = normalizeDate(order.event_date);
  const editedEventDate = normalizeDate(editedOrder.event_date);
  if (editedEventDate !== originalEventDate) {
    changes.event_date = editedOrder.event_date;
    logs.push(['event_date', order.event_date, editedOrder.event_date]);
  }

  const originalEventEndDate = normalizeDate(order.event_end_date || order.event_date);
  const editedEventEndDate = normalizeDate(editedOrder.event_end_date);
  if (editedEventEndDate !== originalEventEndDate) {
    changes.event_end_date = editedOrder.event_end_date;
    logs.push(['event_end_date', order.event_end_date || order.event_date, editedOrder.event_end_date]);
  }

  if (editedOrder.pickup_preference !== (order.pickup_preference || 'next_day')) {
    changes.pickup_preference = editedOrder.pickup_preference;
    changes.overnight_allowed = editedOrder.pickup_preference === 'next_day';
    logs.push(['pickup_preference', order.pickup_preference || 'next_day', editedOrder.pickup_preference]);
  }

  if (hasAddressChanged(order, editedOrder)) {
    changes.address_id = input.canonicalAddressId;
    // The unit belongs to THIS order, not to the shared canonical address row.
    changes.event_address_line2 = normalizeUnit(editedOrder.address_line2);

    const oldUnit = eventAddressLine2(order);
    const oldAddr = `${order.addresses?.line1 || ''}${oldUnit ? ', ' + oldUnit : ''}, ${order.addresses?.city || ''}, ${order.addresses?.state || ''} ${order.addresses?.zip || ''}`;
    const newAddr = `${editedOrder.address_line1}${editedOrder.address_line2 ? ', ' + editedOrder.address_line2 : ''}, ${editedOrder.address_city}, ${editedOrder.address_state} ${editedOrder.address_zip}`;
    logs.push(['address', oldAddr, newAddr]);
  }

  let effectiveTotalCents = 0;

  if (calculatedPricing) {
    if (calculatedPricing.subtotal_cents !== order.subtotal_cents) {
      changes.subtotal_cents = calculatedPricing.subtotal_cents;
      logs.push(['subtotal', order.subtotal_cents, calculatedPricing.subtotal_cents]);
    }
    if (calculatedPricing.generator_fee_cents !== (order.generator_fee_cents || 0)) {
      changes.generator_fee_cents = calculatedPricing.generator_fee_cents;
      logs.push(['generator_fee', order.generator_fee_cents || 0, calculatedPricing.generator_fee_cents]);
    }
    const effectiveSetupFeeCents = customSetupFeeCents !== null ? customSetupFeeCents : (calculatedPricing.setup_fee_cents ?? 0);
    if (effectiveSetupFeeCents !== (order.setup_fee_cents || 0)) {
      changes.setup_fee_cents = effectiveSetupFeeCents;
      logs.push(['setup_fee', order.setup_fee_cents || 0, effectiveSetupFeeCents]);
    }
    const eeSubtotal = calculatedPricing.event_essentials_subtotal_cents || 0;
    if (eeSubtotal !== (order.event_essentials_subtotal_cents || 0)) {
      changes.event_essentials_subtotal_cents = eeSubtotal;
      logs.push(['event_essentials_subtotal', order.event_essentials_subtotal_cents || 0, eeSubtotal]);
    }
    if (calculatedPricing.travel_fee_cents !== (order.travel_fee_cents || 0)) {
      changes.travel_fee_cents = calculatedPricing.travel_fee_cents;
      logs.push(['travel_fee', order.travel_fee_cents, calculatedPricing.travel_fee_cents]);
    }
    if (calculatedPricing.travel_total_miles !== (parseFloat(order.travel_total_miles) || 0)) changes.travel_total_miles = calculatedPricing.travel_total_miles;
    if (calculatedPricing.travel_base_radius_miles !== (parseFloat(order.travel_base_radius_miles) || null)) changes.travel_base_radius_miles = calculatedPricing.travel_base_radius_miles;
    if (calculatedPricing.travel_chargeable_miles !== (parseFloat(order.travel_chargeable_miles) || null)) changes.travel_chargeable_miles = calculatedPricing.travel_chargeable_miles;
    if (calculatedPricing.travel_per_mile_cents !== (order.travel_per_mile_cents || null)) changes.travel_per_mile_cents = calculatedPricing.travel_per_mile_cents;
    if (calculatedPricing.travel_is_flat_fee !== (order.travel_is_flat_fee || false)) changes.travel_is_flat_fee = calculatedPricing.travel_is_flat_fee;
    const effectiveSurfaceFeeCents = hasInflatables ? calculatedPricing.surface_fee_cents : 0;
    if (effectiveSurfaceFeeCents !== (order.surface_fee_cents || 0)) {
      changes.surface_fee_cents = effectiveSurfaceFeeCents;
      logs.push(['surface_fee', order.surface_fee_cents, effectiveSurfaceFeeCents]);
    }
    if (calculatedPricing.same_day_pickup_fee_cents !== (order.same_day_pickup_fee_cents || 0)) {
      changes.same_day_pickup_fee_cents = calculatedPricing.same_day_pickup_fee_cents;
      logs.push(['same_day_pickup_fee', order.same_day_pickup_fee_cents || 0, calculatedPricing.same_day_pickup_fee_cents]);
    }
    if (calculatedPricing.same_day_weekday_delivery_fee_cents !== (order.same_day_weekday_delivery_fee_cents || 0)) {
      changes.same_day_weekday_delivery_fee_cents = calculatedPricing.same_day_weekday_delivery_fee_cents;
      logs.push(['same_day_weekday_delivery_fee', order.same_day_weekday_delivery_fee_cents || 0, calculatedPricing.same_day_weekday_delivery_fee_cents]);
    }
    if (calculatedPricing.tax_cents !== (order.tax_cents || 0)) {
      changes.tax_cents = calculatedPricing.tax_cents;
      logs.push(['tax', order.tax_cents, calculatedPricing.tax_cents]);
    }

    // A deposit override is explicit: null = no override (the formula decides), 0 = deliberately no deposit, > 0 = that deposit.
    // It is saved with the order so the next edit starts from the same state instead of silently falling back to the formula.
    const finalDepositCents = customDepositCents !== null ? customDepositCents : calculatedPricing.deposit_due_cents;
    if (finalDepositCents !== order.deposit_due_cents) {
      changes.deposit_due_cents = finalDepositCents;
      logs.push(['deposit_due', order.deposit_due_cents, finalDepositCents]);
    }
    if ((customDepositCents ?? null) !== (order.custom_deposit_cents ?? null)) {
      changes.custom_deposit_cents = customDepositCents;
      logs.push(['custom_deposit', order.custom_deposit_cents ?? null, customDepositCents]);
    }

    effectiveTotalCents = calculateTotalFromOrder(
      { ...order, ...calculatedPricing },
      discounts.filter(d => !d.is_deleted),
      customFees.filter(f => !f.is_deleted),
    );

    const depositAlreadyCapturedCents = order.deposit_paid_cents || 0;
    const isConfirmedWithPayment = (order.status === ORDER_STATUS.CONFIRMED || order.status === ORDER_STATUS.IN_PROGRESS) && depositAlreadyCapturedCents > 0;
    const depositDifferenceCents = remainingDepositCents(finalDepositCents, depositAlreadyCapturedCents);

    const hasRefunds = (order.total_refunded_cents || 0) > 0;
    const depositPaidCents = order.deposit_paid_cents || 0;
    const balancePaidCents = order.balance_paid_cents || 0;
    const excessDepositPaidCents = Math.max(0, depositPaidCents - finalDepositCents);

    let newBalanceDueCents: number;
    if (hasRefunds) {
      newBalanceDueCents = order.balance_due_cents ?? 0;
    } else if (isConfirmedWithPayment && depositDifferenceCents > 0 && depositCatchupMode === 'require') {
      // The unpaid part of the new deposit is NOT a stored amount: it is always derived (required deposit - deposit principal
      // paid) when it is collected, so it cannot go stale. The balance excludes it.
      newBalanceDueCents = Math.max(0, effectiveTotalCents - finalDepositCents - balancePaidCents - excessDepositPaidCents);
      logs.push(['deposit_catchup', 0, depositDifferenceCents]);
    } else if (isConfirmedWithPayment && depositDifferenceCents > 0 && depositCatchupMode === 'waive') {
      // Waived: the deposit the order requires becomes what is already paid (saved as an explicit override), so nothing is left
      // to collect as a catch-up, and the difference stays in the balance.
      newBalanceDueCents = Math.max(0, effectiveTotalCents - depositPaidCents - balancePaidCents);
      changes.deposit_due_cents = depositPaidCents;
      changes.custom_deposit_cents = depositPaidCents;
      const dueLog = logs.findIndex((l) => l[0] === 'deposit_due');
      if (dueLog >= 0) logs[dueLog] = ['deposit_due', order.deposit_due_cents, depositPaidCents];
      else logs.push(['deposit_due', order.deposit_due_cents, depositPaidCents]);
    } else {
      newBalanceDueCents = Math.max(0, effectiveTotalCents - finalDepositCents - balancePaidCents - excessDepositPaidCents);
    }

    if (newBalanceDueCents !== order.balance_due_cents) {
      changes.balance_due_cents = newBalanceDueCents;
      logs.push(['balance_due', order.balance_due_cents, newBalanceDueCents]);
    }

    const oldTotal = calculateTotalFromOrder(order, discounts.filter(d => !d.is_deleted), customFees.filter(f => !f.is_deleted));
    if (effectiveTotalCents !== oldTotal) {
      logs.push(['total', oldTotal, effectiveTotalCents]);
    }
  }

  if (taxWaived !== undefined && taxWaived !== (order.tax_waived || false)) {
    changes.tax_waived = taxWaived;
    const reasonInfo = taxWaived && taxWaiveReason ? ` (Reason: ${taxWaiveReason})` : '';
    logs.push(['tax_waived', order.tax_waived || false, `${taxWaived}${reasonInfo}`]);
  }
  if (taxWaiveReason !== undefined && taxWaiveReason !== (order.tax_waive_reason || '')) {
    changes.tax_waive_reason = taxWaiveReason || null;
  }

  if (travelFeeWaived !== undefined && travelFeeWaived !== (order.travel_fee_waived || false)) {
    changes.travel_fee_waived = travelFeeWaived;
    const reasonInfo = travelFeeWaived && travelFeeWaiveReason ? ` (Reason: ${travelFeeWaiveReason})` : '';
    logs.push(['travel_fee_waived', order.travel_fee_waived || false, `${travelFeeWaived}${reasonInfo}`]);
  }
  if (travelFeeWaiveReason !== undefined && travelFeeWaiveReason !== (order.travel_fee_waive_reason || '')) {
    changes.travel_fee_waive_reason = travelFeeWaiveReason || null;
  }

  if (sameDayPickupFeeWaived !== undefined && sameDayPickupFeeWaived !== (order.same_day_pickup_fee_waived || false)) {
    changes.same_day_pickup_fee_waived = sameDayPickupFeeWaived;
    const reasonInfo = sameDayPickupFeeWaived && sameDayPickupFeeWaiveReason ? ` (Reason: ${sameDayPickupFeeWaiveReason})` : '';
    logs.push(['same_day_pickup_fee_waived', order.same_day_pickup_fee_waived || false, `${sameDayPickupFeeWaived}${reasonInfo}`]);
  }
  if (sameDayPickupFeeWaiveReason !== undefined && sameDayPickupFeeWaiveReason !== (order.same_day_pickup_fee_waive_reason || '')) {
    changes.same_day_pickup_fee_waive_reason = sameDayPickupFeeWaiveReason || null;
  }

  if (surfaceFeeWaived !== undefined && surfaceFeeWaived !== (order.surface_fee_waived || false)) {
    changes.surface_fee_waived = surfaceFeeWaived;
    const reasonInfo = surfaceFeeWaived && surfaceFeeWaiveReason ? ` (Reason: ${surfaceFeeWaiveReason})` : '';
    logs.push(['surface_fee_waived', order.surface_fee_waived || false, `${surfaceFeeWaived}${reasonInfo}`]);
  }
  if (surfaceFeeWaiveReason !== undefined && surfaceFeeWaiveReason !== (order.surface_fee_waive_reason || '')) {
    changes.surface_fee_waive_reason = surfaceFeeWaiveReason || null;
  }

  if (generatorFeeWaived !== undefined && generatorFeeWaived !== (order.generator_fee_waived || false)) {
    changes.generator_fee_waived = generatorFeeWaived;
    const reasonInfo = generatorFeeWaived && generatorFeeWaiveReason ? ` (Reason: ${generatorFeeWaiveReason})` : '';
    logs.push(['generator_fee_waived', order.generator_fee_waived || false, `${generatorFeeWaived}${reasonInfo}`]);
  }
  if (generatorFeeWaiveReason !== undefined && generatorFeeWaiveReason !== (order.generator_fee_waive_reason || '')) {
    changes.generator_fee_waive_reason = generatorFeeWaiveReason || null;
  }

  if (sameDayWeekdayDeliveryFeeWaived !== undefined && sameDayWeekdayDeliveryFeeWaived !== (order.same_day_weekday_delivery_fee_waived || false)) {
    changes.same_day_weekday_delivery_fee_waived = sameDayWeekdayDeliveryFeeWaived;
    const reasonInfo = sameDayWeekdayDeliveryFeeWaived && sameDayWeekdayDeliveryFeeWaiveReason ? ` (Reason: ${sameDayWeekdayDeliveryFeeWaiveReason})` : '';
    logs.push(['same_day_weekday_delivery_fee_waived', order.same_day_weekday_delivery_fee_waived || false, `${sameDayWeekdayDeliveryFeeWaived}${reasonInfo}`]);
  }
  if (sameDayWeekdayDeliveryFeeWaiveReason !== undefined && sameDayWeekdayDeliveryFeeWaiveReason !== (order.same_day_weekday_delivery_fee_waive_reason || '')) {
    changes.same_day_weekday_delivery_fee_waive_reason = sameDayWeekdayDeliveryFeeWaiveReason || null;
  }

  // Handle parks acknowledgment changes
  if (parksAcknowledgmentRequired !== undefined && parksAcknowledgmentRequired !== (order.parks_acknowledgment_required || false)) {
    changes.parks_acknowledgment_required = parksAcknowledgmentRequired;
    logs.push(['parks_acknowledgment_required', order.parks_acknowledgment_required || false, parksAcknowledgmentRequired]);
  }

  if (parksAcknowledgmentRequired) {
    if (parksAcknowledgmentCounty && parksAcknowledgmentCounty !== (order.parks_acknowledgment_county || null)) {
      changes.parks_acknowledgment_county = parksAcknowledgmentCounty;
      logs.push(['parks_acknowledgment_county', order.parks_acknowledgment_county || '', parksAcknowledgmentCounty]);
    }
  } else {
    if (order.parks_acknowledgment_county) {
      changes.parks_acknowledgment_county = null;
      logs.push(['parks_acknowledgment_county', order.parks_acknowledgment_county, '']);
    }
  }

  // Save-side payment clearing (intentionally NOT the OrderDetailsTab warning rule).
  let shouldClearPayment = false;
  const itemsChanged = stagedItems.some(item => item.is_new || item.is_deleted || item.is_updated);

  if (itemsChanged) {
    shouldClearPayment = true;
    logs.push(['payment_method', 'cleared', 'items changed']);
  } else if (calculatedPricing && order.stripe_payment_intent_id) {
    const finalDepositCents = customDepositCents !== null ? customDepositCents : calculatedPricing.deposit_due_cents;
    const depositAlreadyCaptured = order.deposit_paid_cents || 0;
    if (finalDepositCents > depositAlreadyCaptured) {
      shouldClearPayment = true;
      logs.push(['payment_method', 'cleared', `deposit increased from ${depositAlreadyCaptured} to ${finalDepositCents}`]);
    } else if (depositAlreadyCaptured >= calculateTotalFromOrder(order, discounts.filter(d => !d.is_deleted), customFees.filter(f => !f.is_deleted))) {
      if (effectiveTotalCents > depositAlreadyCaptured) {
        shouldClearPayment = true;
        logs.push(['payment_method', 'cleared', `paid in full but total increased from ${depositAlreadyCaptured} to ${effectiveTotalCents}`]);
      }
    }
  }

  if (shouldClearPayment) {
    changes.stripe_payment_method_id = null;
    changes.stripe_payment_status = 'unpaid';
  }

  const itemOperations = planItemOperations(order, stagedItems);

  const normalizedAdminMessage = adminMessage.trim();
  const originalAdminMessage = order.admin_message || '';
  if (normalizedAdminMessage !== originalAdminMessage) {
    changes.admin_message = normalizedAdminMessage || null;
    logs.push(['admin_message', originalAdminMessage, normalizedAdminMessage]);
  }

  const finalDepositForCard = customDepositCents !== null ? customDepositCents : calculatedPricing?.deposit_due_cents ?? order.deposit_due_cents ?? 0;
  const normalizedRequireCardOnFile = finalDepositForCard > 0 ? true : (requireCardOnFile ?? true);
  if (normalizedRequireCardOnFile !== (order.require_card_on_file ?? true)) {
    changes.require_card_on_file = normalizedRequireCardOnFile;
    logs.push(['require_card_on_file', order.require_card_on_file ?? true, normalizedRequireCardOnFile]);
  }

  const trackedBeforeReconciliation = logs.length > 0
    || stagedItems.some(item => item.is_new || item.is_deleted || item.is_updated)
    || discounts.some(d => d.is_new)
    || customFees.some(f => f.is_new);

  const customerVisibleBeforeReconciliation =
    Object.keys(changes).some(k => CUSTOMER_VISIBLE_CHANGE_KEYS.has(k))
    || stagedItems.some(item => item.is_new || item.is_deleted || item.is_updated)
    || discounts.some(d => d.is_new || d.is_deleted)
    || customFees.some(f => f.is_new || f.is_deleted);

  const preserveCurrentStatus = PRESERVE_STATUS.has(order.status);

  return {
    changes,
    logs,
    itemOperations,
    effectiveTotalCents,
    shouldClearPayment,
    preserveCurrentStatus,
    trackedBeforeReconciliation,
    customerVisibleBeforeReconciliation,
  };
}

// Second stage: needs the counts produced by the discount / custom-fee reconciliation reads.
// `nowIso` is only called when customer_view_updated_at is actually written.
export function finalizeOrderPlan(
  plan: OrderChangePlan,
  reconciliation: ReconciliationCounts,
  options: { adminOverrideApproval: boolean; nowIso: () => string },
): FinalizedOrderPlan {
  const { deletedDiscountCount, updatedDiscountCount, deletedFeeCount, updatedFeeCount } = reconciliation;

  const hasTrackedChanges = plan.trackedBeforeReconciliation
    || deletedDiscountCount > 0 || deletedFeeCount > 0
    || updatedDiscountCount > 0 || updatedFeeCount > 0;
  const hasFieldChanges = Object.keys(plan.changes).length > 0;

  const hasCustomerVisibleChanges = plan.customerVisibleBeforeReconciliation
    || deletedDiscountCount > 0 || deletedFeeCount > 0
    || updatedDiscountCount > 0 || updatedFeeCount > 0;

  const shouldCommit = hasTrackedChanges || hasFieldChanges;
  const changes: any = shouldCommit ? { ...plan.changes } : plan.changes;

  if (shouldCommit) {
    if (!plan.preserveCurrentStatus) {
      if (options.adminOverrideApproval) {
        changes.status = ORDER_STATUS.CONFIRMED;
      } else {
        changes.status = ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL;
      }
    }

    if (hasCustomerVisibleChanges) {
      changes.customer_view_updated_at = options.nowIso();
    }
  }

  return {
    shouldCommit,
    hasTrackedChanges,
    hasFieldChanges,
    hasCustomerVisibleChanges,
    preserveCurrentStatus: plan.preserveCurrentStatus,
    changes,
    logs: plan.logs,
  };
}
