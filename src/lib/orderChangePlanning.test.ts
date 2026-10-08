// Differential tests for the pure order-change planner (orderChangePlanning.ts).
//
// `oracleSave` / `oracleFinalize` below are a verbatim copy of the old deterministic code in
// orderSaveService.saveOrderChanges (planning, item branching, status / flag finalization). Only the
// I/O is replaced: each Supabase item write becomes a recorded operation, the address upsert result is
// passed in, and `new Date()` is an injected stub. The oracle never calls the new planner.
// `oracleCalculateTotal` is a verbatim copy of orderSummary.calculateTotalFromOrder (that module imports
// Supabase and cannot load under Node); both sides receive it.
//
// The last section pins the KNOWN mismatch between the OrderDetailsTab payment warning and the save-side
// payment clearing. Those tests document that the two rules differ today; they do not assert they agree.

import { calculateStoredOrderTotal } from './orderUtils';
import { ORDER_STATUS } from './constants/statuses';
import { hasAddressChanged, planOrderChanges, finalizeOrderPlan } from './orderChangePlanning';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;
let scenarioCount = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

function eq(label: string, actual: unknown, expected: unknown) {
  if (same(actual, expected)) { passed++; } else {
    failed++;
    console.error(`FAIL ${label}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// ORACLE: verbatim copy of the old deterministic code
// ---------------------------------------------------------------------------
function oracleCalculateTotal(order: any, discounts: any[], customFees: any[]): number {
  const subtotal = order.subtotal_cents || 0;
  const travelFee = order.travel_fee_cents || 0;
  const surfaceFee = order.surface_fee_cents || 0;
  const sameDayFee = order.same_day_pickup_fee_cents || 0;
  const sameDayWeekdayDeliveryFee = order.same_day_weekday_delivery_fee_cents || 0;
  const generatorFee = order.generator_fee_cents || 0;
  const setupFee = order.setup_fee_cents || 0;
  const tax = order.tax_cents || 0;

  const totalFees = travelFee + surfaceFee + sameDayFee + sameDayWeekdayDeliveryFee + generatorFee + setupFee;
  const totalCustomFees = customFees.reduce((sum, fee) => sum + (fee.amount_cents || 0), 0);

  const discountTotal = discounts.reduce((sum, discount) => {
    if (discount.percentage) {
      return sum + Math.round(subtotal * (discount.percentage / 100));
    }
    return sum + (discount.amount_cents || 0);
  }, 0);

  return subtotal + totalFees + totalCustomFees - discountTotal + tax;
}

interface OracleState {
  changes: any;
  logs: any[];
  ops: any[];
  effectiveTotalCents: number;
  shouldClearPayment: boolean;
  stagedItems: any[];
  discounts: any[];
  customFees: any[];
  order: any;
}

function oracleSave(params: any, canonicalId: any): OracleState {
  const {
    order, editedOrder, stagedItems, discounts, customFees, calculatedPricing,
    customDepositCents, customSetupFeeCents, adminMessage,
    taxWaived, taxWaiveReason, travelFeeWaived, travelFeeWaiveReason,
    sameDayPickupFeeWaived, sameDayPickupFeeWaiveReason, surfaceFeeWaived, surfaceFeeWaiveReason,
    generatorFeeWaived, generatorFeeWaiveReason, sameDayWeekdayDeliveryFeeWaived, sameDayWeekdayDeliveryFeeWaiveReason,
    parksAcknowledgmentRequired, parksAcknowledgmentCounty,
    depositCatchupMode, requireCardOnFile,
  } = params;
  const calculateTotalFromOrder = oracleCalculateTotal;

  const changes: any = {};
  const logs: any[] = [];
  const ops: any[] = [];

  if (editedOrder.location_type !== order.location_type) {
    changes.location_type = editedOrder.location_type;
    logs.push(['location_type', order.location_type, editedOrder.location_type]);
  }
  const hasInflatables = stagedItems.some((item: any) => item.unit_id && !item.is_deleted);
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

  const addressChanged =
    editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
    editedOrder.address_line2 !== (order.addresses?.line2 || '') ||
    editedOrder.address_city !== (order.addresses?.city || '') ||
    editedOrder.address_state !== (order.addresses?.state || '') ||
    editedOrder.address_zip !== (order.addresses?.zip || '');

  if (addressChanged) {
    changes.address_id = canonicalId;
    // Intended behaviour change (order-specific delivery unit): the unit is written to THIS order.
    changes.event_address_line2 = String(editedOrder.address_line2 ?? '').trim();

    const oldAddr = `${order.addresses?.line1 || ''}${order.addresses?.line2 ? ', ' + order.addresses.line2 : ''}, ${order.addresses?.city || ''}, ${order.addresses?.state || ''} ${order.addresses?.zip || ''}`;
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

    const finalDepositCents = customDepositCents !== null ? customDepositCents : calculatedPricing.deposit_due_cents;
    if (finalDepositCents !== order.deposit_due_cents) {
      changes.deposit_due_cents = finalDepositCents;
      logs.push(['deposit_due', order.deposit_due_cents, finalDepositCents]);
    }

    effectiveTotalCents = calculateTotalFromOrder(
      { ...order, ...calculatedPricing },
      discounts.filter((d: any) => !d.is_deleted),
      customFees.filter((f: any) => !f.is_deleted),
    );

    const depositAlreadyCapturedCents = order.deposit_paid_cents || 0;
    const isConfirmedWithPayment = (order.status === ORDER_STATUS.CONFIRMED || order.status === ORDER_STATUS.IN_PROGRESS) && depositAlreadyCapturedCents > 0;
    const depositDifferenceCents = Math.max(0, finalDepositCents - depositAlreadyCapturedCents);

    const hasRefunds = (order.total_refunded_cents || 0) > 0;
    const depositPaidCents = order.deposit_paid_cents || 0;
    const balancePaidCents = order.balance_paid_cents || 0;
    const excessDepositPaidCents = Math.max(0, depositPaidCents - finalDepositCents);

    let newBalanceDueCents: number;
    if (hasRefunds) {
      newBalanceDueCents = order.balance_due_cents ?? 0;
    } else if (isConfirmedWithPayment && depositDifferenceCents > 0 && depositCatchupMode === 'require') {
      newBalanceDueCents = Math.max(0, effectiveTotalCents - finalDepositCents - balancePaidCents - excessDepositPaidCents);
      changes.deposit_catchup_cents = depositDifferenceCents;
      logs.push(['deposit_catchup', 0, depositDifferenceCents]);
    } else if (isConfirmedWithPayment && depositDifferenceCents > 0 && depositCatchupMode === 'waive') {
      newBalanceDueCents = Math.max(0, effectiveTotalCents - depositPaidCents - balancePaidCents);
      changes.deposit_catchup_cents = 0;
    } else {
      newBalanceDueCents = Math.max(0, effectiveTotalCents - finalDepositCents - balancePaidCents - excessDepositPaidCents);
    }

    if (newBalanceDueCents !== order.balance_due_cents) {
      changes.balance_due_cents = newBalanceDueCents;
      logs.push(['balance_due', order.balance_due_cents, newBalanceDueCents]);
    }

    const oldTotal = calculateTotalFromOrder(order, discounts.filter((d: any) => !d.is_deleted), customFees.filter((f: any) => !f.is_deleted));
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

  let shouldClearPayment = false;
  const itemsChanged = stagedItems.some((item: any) => item.is_new || item.is_deleted || item.is_updated);

  if (itemsChanged) {
    shouldClearPayment = true;
    logs.push(['payment_method', 'cleared', 'items changed']);
  } else if (calculatedPricing && order.stripe_payment_intent_id) {
    const finalDepositCents = customDepositCents !== null ? customDepositCents : calculatedPricing.deposit_due_cents;
    const depositAlreadyCaptured = order.deposit_paid_cents || 0;
    if (finalDepositCents > depositAlreadyCaptured) {
      shouldClearPayment = true;
      logs.push(['payment_method', 'cleared', `deposit increased from ${depositAlreadyCaptured} to ${finalDepositCents}`]);
    } else if (depositAlreadyCaptured >= calculateTotalFromOrder(order, discounts.filter((d: any) => !d.is_deleted), customFees.filter((f: any) => !f.is_deleted))) {
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

  // The item loop: each Supabase write is recorded instead of executed, with the logChangeFn call that follows it.
  for (const item of stagedItems) {
    if (item.is_new && !item.is_deleted) {
      if (item.bundle_id && !item.unit_id) {
        ops.push({ write: 'insert', row: {
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
        }, err: 'Failed to add package', log: ['order_items', '', item.item_name || item.product_name || 'Package', 'add'] });
      } else if (item.product_id && !item.unit_id) {
        ops.push({ write: 'insert', row: {
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
        }, err: 'Failed to add item', log: ['order_items', '', item.item_name || item.product_name || 'Event Essential', 'add'] });
      } else {
        ops.push({ write: 'insert', row: {
          order_id: order.id, unit_id: item.unit_id, qty: item.qty,
          wet_or_dry: item.wet_or_dry, unit_price_cents: item.unit_price_cents,
        }, err: 'Failed to add item', log: ['order_items', '', `${item.unit_name} (${item.wet_or_dry})`, 'add'] });
      }
    } else if (item.is_deleted && item.id) {
      const itemLabel = item.product_id && !item.unit_id
        ? (item.item_name || item.product_name || 'Event Essential')
        : item.bundle_id && !item.unit_id
        ? (item.item_name || item.product_name || 'Package')
        : `${item.unit_name} (${item.wet_or_dry})`;
      ops.push({ write: 'delete', id: item.id, err: 'Failed to remove item', log: ['order_items', itemLabel, '', 'remove'] });
    } else if (item.id && !item.is_new && !item.is_deleted && item.is_updated) {
      if (item.product_id && !item.unit_id) {
        ops.push({ write: 'update', id: item.id, patch: { qty: item.qty }, err: 'Failed to update item',
          log: ['order_items', item.item_name || item.product_name || 'Event Essential', `${item.qty}`, 'update'] });
      } else if (item.bundle_id && !item.unit_id) {
        ops.push({ write: 'update', id: item.id, patch: { qty: item.qty }, err: 'Failed to update package',
          log: ['order_items', item.item_name || item.product_name || 'Package', `${item.qty}`, 'update'] });
      } else {
        ops.push({ write: 'update', id: item.id, patch: {
          qty: item.qty,
          unit_price_cents: item.unit_price_cents,
          pricing_context: item.pricing_context || null,
        }, err: 'Failed to update item',
        log: ['order_items', `${item.unit_name} (${item.wet_or_dry})`, `${item.qty} × ${item.unit_price_cents}`, 'update'] });
      }
    }
  }

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

  return { changes, logs, ops, effectiveTotalCents, shouldClearPayment, stagedItems, discounts, customFees, order };
}

function oracleFinalize(
  state: OracleState,
  counts: { deletedDiscountCount: number; updatedDiscountCount: number; deletedFeeCount: number; updatedFeeCount: number },
  adminOverrideApproval: boolean,
  nowIso: () => string,
) {
  const { changes, logs, stagedItems, discounts, customFees, order } = state;
  const { deletedDiscountCount, updatedDiscountCount, deletedFeeCount, updatedFeeCount } = counts;

  const hasTrackedChanges = logs.length > 0
    || stagedItems.some((item: any) => item.is_new || item.is_deleted || item.is_updated)
    || discounts.some((d: any) => d.is_new)
    || customFees.some((f: any) => f.is_new)
    || deletedDiscountCount > 0 || deletedFeeCount > 0
    || updatedDiscountCount > 0 || updatedFeeCount > 0;
  const hasFieldChanges = Object.keys(changes).length > 0;

  const CUSTOMER_VISIBLE_CHANGE_KEYS = new Set([
    'location_type', 'surface', 'generator_qty',
    'start_window', 'end_window', 'event_date', 'event_end_date',
    'pickup_preference', 'overnight_allowed', 'address_id',
    'subtotal_cents', 'generator_fee_cents', 'travel_fee_cents',
    'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles',
    'travel_per_mile_cents', 'travel_is_flat_fee', 'surface_fee_cents',
    'same_day_pickup_fee_cents', 'same_day_weekday_delivery_fee_cents', 'tax_cents',
    'setup_fee_cents',
    'deposit_due_cents', 'balance_due_cents', 'deposit_catchup_cents',
    'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason',
    'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason',
    'surface_fee_waived', 'surface_fee_waive_reason',
    'generator_fee_waived', 'generator_fee_waive_reason',
    'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason',
    'admin_message', 'require_card_on_file',
  ]);
  const hasCustomerVisibleChanges =
    Object.keys(changes).some(k => CUSTOMER_VISIBLE_CHANGE_KEYS.has(k))
    || stagedItems.some((item: any) => item.is_new || item.is_deleted || item.is_updated)
    || discounts.some((d: any) => d.is_new || d.is_deleted)
    || customFees.some((f: any) => f.is_new || f.is_deleted)
    || deletedDiscountCount > 0 || deletedFeeCount > 0
    || updatedDiscountCount > 0 || updatedFeeCount > 0;

  const PRESERVE_STATUS = new Set<string>([
    ORDER_STATUS.DRAFT, ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.COMPLETED,
    ORDER_STATUS.CANCELLED, ORDER_STATUS.VOID,
  ]);
  const preserveCurrentStatus = PRESERVE_STATUS.has(order.status);

  if (hasTrackedChanges || hasFieldChanges) {
    if (!preserveCurrentStatus) {
      if (adminOverrideApproval) {
        changes.status = ORDER_STATUS.CONFIRMED;
      } else {
        changes.status = ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL;
      }
    }

    if (hasCustomerVisibleChanges) {
      changes.customer_view_updated_at = nowIso();
    }
  }

  return { shouldCommit: hasTrackedChanges || hasFieldChanges, hasTrackedChanges, hasFieldChanges, hasCustomerVisibleChanges, preserveCurrentStatus, changes, logs };
}

// ---------------------------------------------------------------------------
// Fixtures and the comparison harness
// ---------------------------------------------------------------------------
function baseOrder(over: any = {}): any {
  return {
    id: 'ord-1', customer_id: 'cust-1', status: 'confirmed',
    location_type: 'residential', surface: 'grass', generator_qty: 0,
    start_window: '09:00', end_window: '11:00',
    event_date: '2026-07-04T00:00:00', event_end_date: '2026-07-04', pickup_preference: 'next_day',
    addresses: { line1: '1 Main St', line2: null, city: 'Tulsa', state: 'OK', zip: '74101' },
    subtotal_cents: 20000, generator_fee_cents: 0, setup_fee_cents: 0, event_essentials_subtotal_cents: 0,
    travel_fee_cents: 1500, travel_total_miles: '12.5', travel_base_radius_miles: '10', travel_chargeable_miles: '2.5',
    travel_per_mile_cents: 600, travel_is_flat_fee: false, surface_fee_cents: 0,
    same_day_pickup_fee_cents: 0, same_day_weekday_delivery_fee_cents: 0, tax_cents: 1290,
    deposit_due_cents: 5000, deposit_paid_cents: 5000, balance_due_cents: 17790, balance_paid_cents: 0, total_refunded_cents: 0,
    stripe_payment_intent_id: 'pi_1', stripe_payment_method_id: 'pm_1', stripe_payment_status: 'paid',
    require_card_on_file: true, admin_message: null,
    ...over,
  };
}

function baseEdited(order: any, over: any = {}): any {
  return {
    location_type: order.location_type, surface: order.surface, generator_qty: order.generator_qty || 0,
    start_window: order.start_window, end_window: order.end_window,
    event_date: order.event_date, event_end_date: order.event_end_date || order.event_date,
    pickup_preference: order.pickup_preference || 'next_day',
    address_line1: order.addresses?.line1 || '', address_line2: order.addresses?.line2 || '',
    address_city: order.addresses?.city || '', address_state: order.addresses?.state || '', address_zip: order.addresses?.zip || '',
    ...over,
  };
}

function pricingFrom(order: any, over: any = {}): any {
  return {
    subtotal_cents: order.subtotal_cents, generator_fee_cents: order.generator_fee_cents || 0, setup_fee_cents: order.setup_fee_cents || 0,
    event_essentials_subtotal_cents: order.event_essentials_subtotal_cents || 0,
    travel_fee_cents: order.travel_fee_cents || 0, travel_total_miles: parseFloat(order.travel_total_miles) || 0,
    travel_base_radius_miles: parseFloat(order.travel_base_radius_miles) || null,
    travel_chargeable_miles: parseFloat(order.travel_chargeable_miles) || null,
    travel_per_mile_cents: order.travel_per_mile_cents || null, travel_is_flat_fee: order.travel_is_flat_fee || false,
    surface_fee_cents: order.surface_fee_cents || 0, same_day_pickup_fee_cents: order.same_day_pickup_fee_cents || 0,
    same_day_weekday_delivery_fee_cents: order.same_day_weekday_delivery_fee_cents || 0, tax_cents: order.tax_cents || 0,
    deposit_due_cents: order.deposit_due_cents, total_cents: 0,
    ...over,
  };
}

// A plain inflatable keeps the default order change-free (EE-only orders would force surface = null).
const inflatable = { id: 'i1', unit_id: 'u1', unit_name: 'Castle', wet_or_dry: 'dry', qty: 1, unit_price_cents: 20000 };

function mk(over: any = {}, orderOver: any = {}): any {
  const order = baseOrder(orderOver);
  return {
    order, editedOrder: baseEdited(order), stagedItems: [inflatable], discounts: [], customFees: [],
    calculatedPricing: null, customDepositCents: null, customSetupFeeCents: null, adminMessage: order.admin_message || '',
    adminOverrideApproval: false,
    ...over,
  };
}

const COUNTS0 = { deletedDiscountCount: 0, updatedDiscountCount: 0, deletedFeeCount: 0, updatedFeeCount: 0 };

function newOpsNormalized(plan: any): any[] {
  return plan.itemOperations.map((op: any) => {
    const log = [op.log.field, op.log.oldValue, op.log.newValue, op.log.action];
    if (op.kind === 'insert') return { write: 'insert', row: op.payload, err: op.errorLabel, log };
    if (op.kind === 'delete') return { write: 'delete', id: op.itemId, err: op.errorLabel, log };
    return { write: 'update', id: op.itemId, patch: op.payload, err: op.errorLabel, log };
  });
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

let assertions = 0;
// Compares COMPLETE outputs of old vs new, both stages.
function compare(label: string, params: any, counts = COUNTS0, canonicalId: any = 'addr-new') {
  scenarioCount++;
  const forOracle = clone(params);
  const forNew = clone(params);
  const oracleState = oracleSave(forOracle, canonicalId);
  const plan = planOrderChanges({ ...forNew, canonicalAddressId: canonicalId }, { calculateTotal: oracleCalculateTotal });

  const planBeforeFinalize = clone(plan);
  ok(`${label}: changes (pre-finalize)`, same(plan.changes, oracleState.changes));
  ok(`${label}: logs (ordered, pre-finalize)`, same(plan.logs, oracleState.logs));
  ok(`${label}: item operations + log intents`, same(newOpsNormalized(plan), oracleState.ops));
  ok(`${label}: effective total`, plan.effectiveTotalCents === oracleState.effectiveTotalCents);
  ok(`${label}: payment-clear decision`, plan.shouldClearPayment === oracleState.shouldClearPayment);
  assertions += 5;

  // The oracle mutates `changes` in its finalize step, so snapshot the planner's input first.
  let oracleCalls = 0; let newCalls = 0;
  const o = oracleFinalize(oracleState, counts, !!params.adminOverrideApproval, () => { oracleCalls++; return 'T0'; });
  const n = finalizeOrderPlan(plan, counts, { adminOverrideApproval: !!params.adminOverrideApproval, nowIso: () => { newCalls++; return 'T0'; } });
  ok(`${label}: finalize output`, same(n, o));
  ok(`${label}: timestamp only requested when used`, oracleCalls === newCalls);
  ok(`${label}: finalize does not mutate the plan`, same(plan, planBeforeFinalize));
  assertions += 3;
  return { plan, o, n };
}

// ---------------------------------------------------------------------------
// Explicit scenarios
// ---------------------------------------------------------------------------
// Basic
compare('no changes', mk());
compare('scalar-only: location', mk({ editedOrder: baseEdited(baseOrder(), { location_type: 'commercial' }) }));
compare('scalar-only: windows and generator qty', mk({ editedOrder: baseEdited(baseOrder(), { start_window: '08:00', end_window: '12:00', generator_qty: 1 }) }));
compare('date change', mk({ editedOrder: baseEdited(baseOrder(), { event_date: '2026-07-05', event_end_date: '2026-07-06' }) }));
compare('date: same day, different time suffix is not a change', mk({ editedOrder: baseEdited(baseOrder(), { event_date: '2026-07-04' }) }));
compare('date: order has no end date, edited equals start', mk({ editedOrder: baseEdited(baseOrder({ event_end_date: null }), { event_end_date: '2026-07-04' }) }, { event_end_date: null }));
compare('pickup preference to same_day', mk({ editedOrder: baseEdited(baseOrder(), { pickup_preference: 'same_day' }) }));
compare('pickup preference from missing default', mk({ editedOrder: baseEdited(baseOrder({ pickup_preference: null }), { pickup_preference: 'next_day' }) }, { pickup_preference: null }));
compare('address unchanged', mk());
compare('address line1 changed', mk({ editedOrder: baseEdited(baseOrder(), { address_line1: '2 Oak Ave' }) }));
compare('address with line2 added', mk({ editedOrder: baseEdited(baseOrder(), { address_line2: 'Apt 4' }) }));
compare('address zip changed from an order without a linked address', mk({ editedOrder: baseEdited(baseOrder({ addresses: null }), { address_zip: '74103' }) }, { addresses: null }));
ok('hasAddressChanged mirrors the inline comparison', hasAddressChanged(baseOrder(), baseEdited(baseOrder(), { address_city: 'Joplin' })) && !hasAddressChanged(baseOrder(), baseEdited(baseOrder())));
ok('address id comes from the injected canonical id', planOrderChanges({ ...mk({ editedOrder: baseEdited(baseOrder(), { address_line1: 'X' }) }), canonicalAddressId: 'canon-9' }, { calculateTotal: oracleCalculateTotal }).changes.address_id === 'canon-9');

// Surface
compare('surface: inflatable present keeps edited surface', mk({ editedOrder: baseEdited(baseOrder(), { surface: 'concrete' }), stagedItems: [inflatable] }));
compare('surface: EE-only forces null', mk({ editedOrder: baseEdited(baseOrder(), { surface: 'grass' }), stagedItems: [{ id: 'e1', product_id: 'p1', qty: 1, unit_price_cents: 5000 }] }));
compare('surface: only inflatable deleted forces null', mk({ stagedItems: [{ ...inflatable, is_deleted: true }] }));
compare('surface fee zeroed for EE-only', mk({
  stagedItems: [{ id: 'e1', product_id: 'p1', qty: 1, unit_price_cents: 5000 }],
  calculatedPricing: pricingFrom(baseOrder({ surface_fee_cents: 1000 }), { surface_fee_cents: 1000 }),
}, { surface_fee_cents: 1000 }));

// Pricing
compare('pricing null', mk());
compare('pricing present, nothing changed', mk({ calculatedPricing: pricingFrom(baseOrder()) }));
{
  const o = baseOrder();
  const fields: Array<[string, any]> = [
    ['subtotal_cents', 25000], ['generator_fee_cents', 10000], ['setup_fee_cents', 3000], ['event_essentials_subtotal_cents', 4000],
    ['travel_fee_cents', 2500], ['travel_total_miles', 20], ['travel_base_radius_miles', 15], ['travel_chargeable_miles', 5],
    ['travel_per_mile_cents', 700], ['travel_is_flat_fee', true], ['surface_fee_cents', 1000], ['same_day_pickup_fee_cents', 2500],
    ['same_day_weekday_delivery_fee_cents', 3000], ['tax_cents', 1400], ['deposit_due_cents', 8000],
  ];
  for (const [k, v] of fields) {
    compare(`pricing field changed alone: ${k}`, mk({ calculatedPricing: pricingFrom(o, { [k]: v }), stagedItems: [inflatable] }));
  }
}
for (const [label, csf] of [['null', null], ['zero', 0], ['non-zero', 4500]] as Array<[string, number | null]>) {
  compare(`setup fee override ${label}`, mk({ calculatedPricing: pricingFrom(baseOrder(), { setup_fee_cents: 3000 }), customSetupFeeCents: csf }));
  compare(`setup fee override ${label}, calculated setup undefined`, mk({ calculatedPricing: pricingFrom(baseOrder(), { setup_fee_cents: undefined }), customSetupFeeCents: csf }));
}
for (const [label, cd] of [['null', null], ['zero', 0], ['non-zero', 9000]] as Array<[string, number | null]>) {
  compare(`custom deposit ${label}`, mk({ calculatedPricing: pricingFrom(baseOrder(), { deposit_due_cents: 7000 }), customDepositCents: cd }));
  compare(`custom deposit ${label}, pricing null`, mk({ customDepositCents: cd }));
}

// Catch-up
for (const mode of ['require', 'waive', undefined] as Array<'require' | 'waive' | undefined>) {
  for (const status of ['confirmed', 'in_progress', 'awaiting_customer_approval', 'draft']) {
    compare(`catch-up ${mode} status=${status}, deposit increased`, mk({
      depositCatchupMode: mode,
      calculatedPricing: pricingFrom(baseOrder(), { deposit_due_cents: 9000, subtotal_cents: 30000 }),
    }, { status }));
  }
  compare(`catch-up ${mode}: deposit unchanged`, mk({ depositCatchupMode: mode, calculatedPricing: pricingFrom(baseOrder()) }));
  compare(`catch-up ${mode}: no deposit paid yet`, mk({ depositCatchupMode: mode, calculatedPricing: pricingFrom(baseOrder(), { deposit_due_cents: 9000 }) }, { deposit_paid_cents: 0 }));
  compare(`catch-up ${mode}: refunds`, mk({ depositCatchupMode: mode, calculatedPricing: pricingFrom(baseOrder(), { deposit_due_cents: 9000 }) }, { total_refunded_cents: 1000 }));
  compare(`catch-up ${mode}: refunds with null balance`, mk({ depositCatchupMode: mode, calculatedPricing: pricingFrom(baseOrder(), { deposit_due_cents: 9000 }) }, { total_refunded_cents: 1000, balance_due_cents: null }));
  compare(`catch-up ${mode}: excess deposit`, mk({ depositCatchupMode: mode, calculatedPricing: pricingFrom(baseOrder(), { deposit_due_cents: 3000 }) }, { deposit_paid_cents: 8000 }));
  compare(`catch-up ${mode}: balance already paid`, mk({ depositCatchupMode: mode, calculatedPricing: pricingFrom(baseOrder(), { deposit_due_cents: 9000 }) }, { balance_paid_cents: 4000 }));
}

// Waivers
{
  const keys: Array<[string, string, string, string]> = [
    ['taxWaived', 'taxWaiveReason', 'tax_waived', 'tax_waive_reason'],
    ['travelFeeWaived', 'travelFeeWaiveReason', 'travel_fee_waived', 'travel_fee_waive_reason'],
    ['sameDayPickupFeeWaived', 'sameDayPickupFeeWaiveReason', 'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason'],
    ['surfaceFeeWaived', 'surfaceFeeWaiveReason', 'surface_fee_waived', 'surface_fee_waive_reason'],
    ['generatorFeeWaived', 'generatorFeeWaiveReason', 'generator_fee_waived', 'generator_fee_waive_reason'],
    ['sameDayWeekdayDeliveryFeeWaived', 'sameDayWeekdayDeliveryFeeWaiveReason', 'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason'],
  ];
  for (const [fp, rp, fc, rc] of keys) {
    compare(`waiver ${fp}: params undefined`, mk());
    compare(`waiver ${fp}: unchanged false`, mk({ [fp]: false }));
    compare(`waiver ${fp}: enabled with reason`, mk({ [fp]: true, [rp]: 'Goodwill' }));
    compare(`waiver ${fp}: enabled without reason`, mk({ [fp]: true }));
    compare(`waiver ${fp}: enabled with empty reason`, mk({ [fp]: true, [rp]: '' }));
    compare(`waiver ${fp}: unchanged enabled`, mk({ [fp]: true, [rp]: 'Goodwill' }, { [fc]: true, [rc]: 'Goodwill' }));
    compare(`waiver ${fp}: disabled`, mk({ [fp]: false, [rp]: '' }, { [fc]: true, [rc]: 'Goodwill' }));
    compare(`waiver ${fp}: disabled keeps stale reason`, mk({ [fp]: false, [rp]: 'Goodwill' }, { [fc]: true, [rc]: 'Goodwill' }));
    compare(`waiver ${fp}: reason added only`, mk({ [rp]: 'New reason' }));
    compare(`waiver ${fp}: reason removed only`, mk({ [rp]: '' }, { [rc]: 'Old reason' }));
    compare(`waiver ${fp}: reason changed only`, mk({ [rp]: 'B' }, { [rc]: 'A' }));
  }
}

// Parks
compare('parks: params undefined', mk());
compare('parks: disabled, unchanged', mk({ parksAcknowledgmentRequired: false }));
compare('parks: enabled with county', mk({ parksAcknowledgmentRequired: true, parksAcknowledgmentCounty: 'Tulsa' }));
compare('parks: enabled without county', mk({ parksAcknowledgmentRequired: true, parksAcknowledgmentCounty: null }));
compare('parks: county changed', mk({ parksAcknowledgmentRequired: true, parksAcknowledgmentCounty: 'Osage' }, { parks_acknowledgment_required: true, parks_acknowledgment_county: 'Tulsa' }));
compare('parks: county unchanged', mk({ parksAcknowledgmentRequired: true, parksAcknowledgmentCounty: 'Tulsa' }, { parks_acknowledgment_required: true, parks_acknowledgment_county: 'Tulsa' }));
compare('parks: acknowledgment removed clears county', mk({ parksAcknowledgmentRequired: false }, { parks_acknowledgment_required: true, parks_acknowledgment_county: 'Tulsa' }));
compare('parks: undefined param still clears a stale county', mk({}, { parks_acknowledgment_county: 'Tulsa' }));

// Payment clearing
const pr = (extra: any = {}, orderOver: any = {}) => pricingFrom(baseOrder(orderOver), extra);
compare('clear: no item changes, nothing to clear', mk({ calculatedPricing: pr() }));
compare('clear: item new', mk({ stagedItems: [{ ...inflatable, is_new: true, id: undefined }] }));
compare('clear: item deleted', mk({ stagedItems: [{ ...inflatable, is_deleted: true }] }));
compare('clear: item updated only', mk({ stagedItems: [{ ...inflatable, is_updated: true }] }));
compare('clear: deposit increased', mk({ calculatedPricing: pr({ deposit_due_cents: 9000 }) }));
compare('clear: deposit equals captured', mk({ calculatedPricing: pr({ deposit_due_cents: 5000 }) }));
compare('clear: paid in full + total increased', mk({ calculatedPricing: pr({ deposit_due_cents: 1000, subtotal_cents: 30000 }) }, { deposit_paid_cents: 22790, deposit_due_cents: 1000, balance_due_cents: 0 }));
compare('clear: paid in full, total unchanged', mk({ calculatedPricing: pr({ deposit_due_cents: 1000 }) }, { deposit_paid_cents: 22790, deposit_due_cents: 1000, balance_due_cents: 0 }));
compare('clear: payment intent absent', mk({ calculatedPricing: pr({ deposit_due_cents: 9000 }) }, { stripe_payment_intent_id: null }));
compare('clear: calculated pricing null', mk({ customDepositCents: 99999 }));
compare('clear: custom deposit 0', mk({ calculatedPricing: pr({ deposit_due_cents: 9000 }), customDepositCents: 0 }));
compare('clear: custom deposit above captured', mk({ calculatedPricing: pr(), customDepositCents: 9000 }));
compare('clear: paid in full with a discount and a custom fee', mk({ calculatedPricing: pr({ deposit_due_cents: 1000, subtotal_cents: 30000 }), discounts: [{ amount_cents: 3000, name: 'd' }], customFees: [{ amount_cents: 2000, name: 'f' }] }, { deposit_paid_cents: 22790, deposit_due_cents: 1000 }));
compare('clear: deleted discount does not count toward the totals', mk({ calculatedPricing: pr({ deposit_due_cents: 1000 }), discounts: [{ amount_cents: 3000, name: 'd', is_deleted: true }] }, { deposit_paid_cents: 22790, deposit_due_cents: 1000 }));
{
  const c = compare('clear: fields reset and deposit_paid_cents untouched', mk({ stagedItems: [{ ...inflatable, is_updated: true }] }));
  ok('clear sets payment method null', c.plan.changes.stripe_payment_method_id === null);
  ok('clear sets status unpaid', c.plan.changes.stripe_payment_status === 'unpaid');
  ok('clear never touches deposit_paid_cents', !('deposit_paid_cents' in c.plan.changes));
  eq('clear log message', c.plan.logs.find((l: any) => l[0] === 'payment_method'), ['payment_method', 'cleared', 'items changed']);
  const d = compare('clear: deposit message', mk({ calculatedPricing: pr({ deposit_due_cents: 9000 }) }));
  eq('deposit-increase log message', d.plan.logs.find((l: any) => l[0] === 'payment_method'), ['payment_method', 'cleared', 'deposit increased from 5000 to 9000']);
}

// Item operations
const pkg = { id: 'k1', bundle_id: 'b1', item_name: 'Party Pack', qty: 2, unit_price_cents: 9000, pricing_context: { x: 1 }, component_snapshot: { components: [{ product_id: 'p1' }] } };
const ee = { id: 'e1', product_id: 'p1', product_name: 'Tables', qty: 3, unit_price_cents: 1500, pricing_context: { y: 2 }, component_snapshot: { stale: true } };
compare('item: new package', mk({ stagedItems: [{ ...pkg, is_new: true }] }));
compare('item: new package without snapshot/name', mk({ stagedItems: [{ id: 'k2', bundle_id: 'b1', product_name: 'PN', qty: 1, unit_price_cents: 1, is_new: true }] }));
compare('item: new EE product', mk({ stagedItems: [{ ...ee, is_new: true }] }));
compare('item: new EE product without name', mk({ stagedItems: [{ id: 'e2', product_id: 'p2', qty: 1, unit_price_cents: 1, is_new: true }] }));
compare('item: new inflatable', mk({ stagedItems: [{ ...inflatable, is_new: true }] }));
compare('item: delete package', mk({ stagedItems: [{ ...pkg, is_deleted: true }] }));
compare('item: delete EE', mk({ stagedItems: [{ ...ee, is_deleted: true }] }));
compare('item: delete inflatable', mk({ stagedItems: [{ ...inflatable, is_deleted: true }] }));
compare('item: delete without id is skipped', mk({ stagedItems: [{ ...inflatable, id: undefined, is_deleted: true }] }));
compare('item: update EE is qty only', mk({ stagedItems: [{ ...ee, is_updated: true }] }));
compare('item: update package is qty only', mk({ stagedItems: [{ ...pkg, is_updated: true }] }));
compare('item: update inflatable', mk({ stagedItems: [{ ...inflatable, is_updated: true, pricing_context: { z: 3 } }] }));
compare('item: update inflatable without pricing context', mk({ stagedItems: [{ ...inflatable, is_updated: true }] }));
compare('item: update without id is skipped', mk({ stagedItems: [{ ...inflatable, id: undefined, is_updated: true }] }));
compare('item: no flags', mk({ stagedItems: [inflatable, ee, pkg] }));
compare('item: ordering across mixed operations', mk({ stagedItems: [
  { ...inflatable, id: 'a', is_deleted: true }, { ...ee, id: 'b', is_new: true }, { ...pkg, id: 'c', is_updated: true },
  { ...inflatable, id: 'd', is_new: true }, { ...ee, id: 'e', is_updated: true }, { ...pkg, id: 'f', is_deleted: true },
] }));
// Adversarial flag combinations, for every item shape.
for (const [shape, base] of [['inflatable', inflatable], ['EE', ee], ['package', pkg]] as Array<[string, any]>) {
  for (let mask = 0; mask < 8; mask++) {
    const flags = { is_new: !!(mask & 1), is_deleted: !!(mask & 2), is_updated: !!(mask & 4) };
    for (const withId of [true, false]) {
      compare(`adversarial ${shape} new=${flags.is_new} deleted=${flags.is_deleted} updated=${flags.is_updated} id=${withId}`,
        mk({ stagedItems: [{ ...base, ...flags, id: withId ? base.id : undefined }] }));
    }
  }
}
{
  const both = planOrderChanges({ ...mk({ stagedItems: [{ ...inflatable, is_new: true, is_deleted: true }] }), canonicalAddressId: null }, { calculateTotal: oracleCalculateTotal });
  eq('new + deleted with id deletes (never inserts)', both.itemOperations.map((o: any) => o.kind), ['delete']);
  const newUpd = planOrderChanges({ ...mk({ stagedItems: [{ ...inflatable, is_new: true, is_updated: true }] }), canonicalAddressId: null }, { calculateTotal: oracleCalculateTotal });
  eq('new + updated inserts', newUpd.itemOperations.map((o: any) => o.kind), ['insert']);
  const delUpd = planOrderChanges({ ...mk({ stagedItems: [{ ...inflatable, is_deleted: true, is_updated: true }] }), canonicalAddressId: null }, { calculateTotal: oracleCalculateTotal });
  eq('deleted + updated deletes', delUpd.itemOperations.map((o: any) => o.kind), ['delete']);
  const none = planOrderChanges({ ...mk({ stagedItems: [inflatable] }), canonicalAddressId: null }, { calculateTotal: oracleCalculateTotal });
  eq('no flags: no write', none.itemOperations, []);
  const eeUpd = planOrderChanges({ ...mk({ stagedItems: [{ ...ee, is_updated: true }] }), canonicalAddressId: null }, { calculateTotal: oracleCalculateTotal });
  eq('EE update payload is quantity only', eeUpd.itemOperations[0], { kind: 'update', itemId: 'e1', payload: { qty: 3 }, errorLabel: 'Failed to update item', log: { field: 'order_items', oldValue: 'Tables', newValue: '3', action: 'update' } });
}

// Admin message and card on file
compare('message: whitespace only equals empty', mk({ adminMessage: '   ' }));
compare('message: empty equals null', mk({ adminMessage: '' }));
compare('message: set', mk({ adminMessage: '  Please call  ' }));
compare('message: unchanged after trim', mk({ adminMessage: ' Hello ' }, { admin_message: 'Hello' }));
compare('message: cleared', mk({ adminMessage: '' }, { admin_message: 'Hello' }));
for (const rc of [true, false, undefined]) {
  for (const cd of [null, 0, 5000]) {
    for (const orc of [true, false, undefined]) {
      compare(`card: requireCardOnFile=${rc} customDeposit=${cd} stored=${orc} pricing null`, mk({ requireCardOnFile: rc, customDepositCents: cd }, { require_card_on_file: orc, deposit_due_cents: 0 }));
      compare(`card: requireCardOnFile=${rc} customDeposit=${cd} stored=${orc} pricing deposit 0`, mk({ requireCardOnFile: rc, customDepositCents: cd, calculatedPricing: pr({ deposit_due_cents: 0 }) }, { require_card_on_file: orc, deposit_due_cents: 0 }));
    }
  }
}
compare('card: stored deposit forces card when pricing is null', mk({ requireCardOnFile: false }, { deposit_due_cents: 5000, require_card_on_file: false }));
compare('card: deposit 0 and explicit false is honored', mk({ requireCardOnFile: false, calculatedPricing: pr({ deposit_due_cents: 0 }) }, { deposit_due_cents: 0 }));
{
  const forced = planOrderChanges({ ...mk({ requireCardOnFile: false, calculatedPricing: pr({ deposit_due_cents: 4000 }) }), canonicalAddressId: null }, { calculateTotal: oracleCalculateTotal });
  ok('deposit > 0 forces require_card_on_file true', forced.changes.require_card_on_file === undefined);
  const off = planOrderChanges({ ...mk({ requireCardOnFile: false, calculatedPricing: pr({ deposit_due_cents: 0 }) }, ), canonicalAddressId: null }, { calculateTotal: oracleCalculateTotal });
  ok('deposit 0 + explicit false changes it to false', off.changes.require_card_on_file === false);
}

// Status, reconciliation counts
const STATUSES = ['draft', 'pending_review', 'confirmed', 'awaiting_customer_approval', 'in_progress', 'completed', 'cancelled', 'void'];
for (const status of STATUSES) {
  for (const override of [false, true]) {
    const c = compare(`status ${status} override=${override}: field change`, mk({ adminOverrideApproval: override, editedOrder: baseEdited(baseOrder(), { location_type: 'commercial' }) }, { status }));
    const preserved = ['draft', 'in_progress', 'completed', 'cancelled', 'void'].includes(status);
    ok(`status ${status}: preserved flag`, c.n.preserveCurrentStatus === preserved);
    ok(`status ${status} override=${override}: final status`, preserved ? c.n.changes.status === undefined : c.n.changes.status === (override ? 'confirmed' : 'awaiting_customer_approval'));
    compare(`status ${status} override=${override}: no changes`, mk({ adminOverrideApproval: override }, { status }));
  }
}
const recon: Array<[string, any, any]> = [
  ['new discount only', { discounts: [{ id: 'd1', is_new: true, name: 'x', amount_cents: 100 }] }, COUNTS0],
  ['deleted discount flag only', { discounts: [{ id: 'd1', is_deleted: true, name: 'x', amount_cents: 100 }] }, COUNTS0],
  ['deleted discount (DB count)', {}, { ...COUNTS0, deletedDiscountCount: 1 }],
  ['updated discount (DB count)', {}, { ...COUNTS0, updatedDiscountCount: 1 }],
  ['new fee only', { customFees: [{ id: 'f1', is_new: true, name: 'x', amount_cents: 100 }] }, COUNTS0],
  ['deleted fee flag only', { customFees: [{ id: 'f1', is_deleted: true, name: 'x', amount_cents: 100 }] }, COUNTS0],
  ['deleted fee (DB count)', {}, { ...COUNTS0, deletedFeeCount: 1 }],
  ['updated fee (DB count)', {}, { ...COUNTS0, updatedFeeCount: 1 }],
  ['combination', { discounts: [{ id: 'd1', is_new: true, name: 'x', amount_cents: 100 }], customFees: [{ id: 'f1', is_deleted: true, name: 'y', amount_cents: 5 }] }, { ...COUNTS0, updatedDiscountCount: 2, deletedFeeCount: 1 }],
];
for (const status of ['confirmed', 'in_progress', 'awaiting_customer_approval']) {
  for (const override of [false, true]) {
    for (const [name, extra, counts] of recon) {
      compare(`reconciliation ${name} status=${status} override=${override}`, mk({ ...extra, adminOverrideApproval: override }, { status }), counts);
    }
  }
}
{
  // A Parks-only change logs and changes a key that is NOT in the customer-visible set: tracked, not visible.
  // Nothing falls back to logs.length.
  const c = compare('tracked but not customer visible: parks only', mk({ stagedItems: [inflatable], parksAcknowledgmentRequired: true, parksAcknowledgmentCounty: 'Tulsa' }));
  ok('parks-only change is tracked', c.n.hasTrackedChanges === true);
  ok('parks-only change is not customer visible', c.n.hasCustomerVisibleChanges === false);
  ok('parks-only change still commits', c.n.shouldCommit === true);
  ok('parks-only change has no customer_view_updated_at', c.n.changes.customer_view_updated_at === undefined);
  ok('no changes: nothing to commit', compare('no-op', mk({ stagedItems: [inflatable] })).n.shouldCommit === false);
  ok('require_card_on_file alone is customer visible', compare('card visible', mk({ requireCardOnFile: false }, { deposit_due_cents: 0, require_card_on_file: true })).n.hasCustomerVisibleChanges === true);
}

// ---------------------------------------------------------------------------
// Seeded differential matrix
// ---------------------------------------------------------------------------
{
  const r = rng(20260706);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const bool = () => r() < 0.5;
  const maybe = <T,>(v: T, p = 0.5): T | undefined => (r() < p ? v : undefined);
  const WAIVER_KEYS = [
    ['taxWaived', 'taxWaiveReason', 'tax_waived', 'tax_waive_reason'],
    ['travelFeeWaived', 'travelFeeWaiveReason', 'travel_fee_waived', 'travel_fee_waive_reason'],
    ['sameDayPickupFeeWaived', 'sameDayPickupFeeWaiveReason', 'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason'],
    ['surfaceFeeWaived', 'surfaceFeeWaiveReason', 'surface_fee_waived', 'surface_fee_waive_reason'],
    ['generatorFeeWaived', 'generatorFeeWaiveReason', 'generator_fee_waived', 'generator_fee_waive_reason'],
    ['sameDayWeekdayDeliveryFeeWaived', 'sameDayWeekdayDeliveryFeeWaiveReason', 'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason'],
  ];
  const mkItem = (i: number) => {
    const shape = pick(['inflatable', 'ee', 'pkg']);
    const b: any = shape === 'inflatable' ? { unit_id: `u${i}`, unit_name: `Unit${i}`, wet_or_dry: pick(['wet', 'dry']) }
      : shape === 'ee' ? { product_id: `p${i}`, product_name: `Prod${i}`, item_name: maybe(`Name${i}`) }
      : { bundle_id: `b${i}`, item_name: maybe(`Pack${i}`), product_name: maybe(`PackP${i}`), component_snapshot: maybe({ components: [] }) };
    return { id: maybe(`it${i}`, 0.9), qty: 1 + Math.floor(r() * 4), unit_price_cents: pick([0, 1500, 20000]), pricing_context: maybe({ k: i }),
      is_new: r() < 0.25, is_deleted: r() < 0.25, is_updated: r() < 0.3, ...b };
  };
  const MATRIX = 4000;
  const before = passed;
  for (let n = 0; n < MATRIX; n++) {
    const orderOver: any = {
      status: pick(STATUSES), subtotal_cents: pick([0, 20000, 35000]), tax_cents: pick([0, 1290, 2100]), setup_fee_cents: pick([0, 3000]),
      deposit_due_cents: pick([0, 5000, 10000]), deposit_paid_cents: pick([0, 5000, 10000, 40000]), balance_paid_cents: pick([0, 3000]),
      balance_due_cents: pick([0, 15000, null]), total_refunded_cents: pick([0, 0, 500]),
      stripe_payment_intent_id: pick([null, 'pi_1']), require_card_on_file: pick([true, false, undefined]),
      admin_message: pick([null, '', 'Hello']), event_end_date: pick([null, '2026-07-04']),
      pickup_preference: pick([null, 'next_day', 'same_day']), generator_qty: pick([0, 1, undefined]),
      parks_acknowledgment_required: pick([true, false, undefined]), parks_acknowledgment_county: pick([null, 'Tulsa']),
      travel_is_flat_fee: pick([true, false, undefined]), surface_fee_cents: pick([0, 1000]),
    };
    for (const [, , fc, rc] of WAIVER_KEYS) { orderOver[fc] = pick([true, false, undefined]); orderOver[rc] = pick([null, '', 'Old']); }
    const order = baseOrder(orderOver);
    const editedOrder = baseEdited(order, {
      location_type: pick([order.location_type, 'commercial']), surface: pick([order.surface, 'concrete']),
      generator_qty: pick([order.generator_qty || 0, 2]), start_window: pick([order.start_window, '10:00']),
      event_date: pick([order.event_date, '2026-07-05']), event_end_date: pick([order.event_end_date || order.event_date, '2026-07-06', '']),
      pickup_preference: pick([order.pickup_preference || 'next_day', 'same_day']),
      address_line1: pick([order.addresses.line1, 'New St']), address_line2: pick(['', 'Apt 2']),
    });
    const calculatedPricing = pick([null, pricingFrom(order, {
      subtotal_cents: pick([order.subtotal_cents, order.subtotal_cents + 5000]), tax_cents: pick([order.tax_cents, 1400]),
      deposit_due_cents: pick([0, 5000, 10000, 15000]), setup_fee_cents: pick([undefined, 0, 3000]),
      generator_fee_cents: pick([0, 10000]), travel_fee_cents: pick([1500, 2500]), surface_fee_cents: pick([0, 1000]),
      event_essentials_subtotal_cents: pick([0, 4000]), travel_total_miles: pick([12.5, 20]), travel_is_flat_fee: pick([true, false]),
    })]);
    const params: any = {
      order, editedOrder, calculatedPricing,
      stagedItems: Array.from({ length: Math.floor(r() * 4) }, (_, i) => mkItem(i)).map((it) => (r() < 0.6 ? { ...it, is_new: false, is_deleted: false, is_updated: r() < 0.2 } : it)),
      discounts: pick([[], [{ id: 'd1', name: 'x', amount_cents: 3000 }], [{ id: 'd2', name: 'y', percentage: 10, is_new: true }], [{ id: 'd3', name: 'z', amount_cents: 500, is_deleted: true }]]),
      customFees: pick([[], [{ id: 'f1', name: 'x', amount_cents: 2000 }], [{ id: 'f2', name: 'y', amount_cents: 700, is_new: true }], [{ id: 'f3', name: 'z', amount_cents: 100, is_deleted: true }]]),
      customDepositCents: pick([null, null, 0, 20000]), customSetupFeeCents: pick([null, null, 0, 4500]),
      adminMessage: pick(['', '  ', 'Hello', ' New msg ']), adminOverrideApproval: bool(),
      depositCatchupMode: pick(['require', 'waive', undefined] as Array<'require' | 'waive' | undefined>),
      requireCardOnFile: pick([true, false, undefined]),
      parksAcknowledgmentRequired: pick([true, false, undefined]), parksAcknowledgmentCounty: pick([null, 'Tulsa', 'Osage']),
    };
    for (const [fp, rp] of WAIVER_KEYS) { params[fp] = pick([true, false, undefined]); params[rp] = pick([undefined, '', 'Old', 'New']); }
    const counts = { deletedDiscountCount: pick([0, 0, 1]), updatedDiscountCount: pick([0, 0, 1]), deletedFeeCount: pick([0, 0, 1]), updatedFeeCount: pick([0, 0, 1]) };
    compare(`seeded ${n}`, params, counts, pick(['addr-1', 'addr-2']));
  }
  ok(`seeded matrix ran ${MATRIX} cases`, scenarioCount >= MATRIX);
  ok('seeded matrix made assertions', passed > before);
}

// ---------------------------------------------------------------------------
// KNOWN UI-vs-save payment-clearing mismatch (pinned, NOT a bug to fix in this batch)
// ---------------------------------------------------------------------------
// OrderDetailsTab warning rule, verbatim.
function uiWillClearPayment(order: any, stagedItems: any[], calculatedPricing: any, customDepositCents: number | null): boolean {
  const itemsChanged = stagedItems.some(item => item.is_new || item.is_deleted);
  const finalDepositCents = customDepositCents !== null ? customDepositCents : (calculatedPricing?.deposit_due_cents || order.deposit_due_cents);
  const currentPaidAmount = order.deposit_paid_cents || 0;
  const originalTotal = calculateStoredOrderTotal(order);
  const newTotal = calculatedPricing?.total_cents || originalTotal;
  return !!(itemsChanged || (order.stripe_payment_intent_id && (finalDepositCents > currentPaidAmount || (currentPaidAmount >= originalTotal && newTotal > currentPaidAmount))));
}
function saveClears(params: any): boolean {
  return planOrderChanges({ ...clone(params), canonicalAddressId: null }, { calculateTotal: oracleCalculateTotal }).shouldClearPayment;
}
{
  // 1. is_updated only: save clears, UI is silent.
  const p = mk({ stagedItems: [{ ...inflatable, is_updated: true }], calculatedPricing: pr() });
  ok('KNOWN: is_updated only -> save clears', saveClears(p) === true);
  ok('KNOWN: is_updated only -> UI silent', uiWillClearPayment(p.order, p.stagedItems, p.calculatedPricing, null) === false);

  // 2. calculatedPricing null: UI falls back to stored values and warns; save does not clear.
  const p2 = mk({ calculatedPricing: null }, { deposit_paid_cents: 1000, deposit_due_cents: 5000 });
  ok('KNOWN: pricing null -> UI warns (stored deposit above paid)', uiWillClearPayment(p2.order, [], null, null) === true);
  ok('KNOWN: pricing null -> save does not clear', saveClears(p2) === false);

  // 3. Calculated deposit 0: UI uses || and falls back to the stored deposit; save uses 0.
  const p3 = mk({ calculatedPricing: pr({ deposit_due_cents: 0 }) }, { deposit_paid_cents: 1000, deposit_due_cents: 5000 });
  ok('KNOWN: calculated deposit 0 -> UI warns (falls back to stored 5000)', uiWillClearPayment(p3.order, [], p3.calculatedPricing, null) === true);
  ok('KNOWN: calculated deposit 0 -> save does not clear', saveClears(p3) === false);

  // 4. Discounts / custom fees: save's old total includes them, the UI's stored-columns total does not.
  const stored = calculateStoredOrderTotal(baseOrder());
  const o4 = { deposit_paid_cents: stored, deposit_due_cents: 1000 };
  const p4 = mk({ calculatedPricing: pr({ deposit_due_cents: 1000, total_cents: stored + 1 }, o4), customFees: [{ amount_cents: 5000, name: 'f' }] }, o4);
  ok('KNOWN: custom fee -> UI treats the order as paid in full and warns', uiWillClearPayment(p4.order, [], p4.calculatedPricing, null) === true);
  ok('KNOWN: custom fee -> save sees the larger old total and does not clear', saveClears(p4) === false);
}

console.log(`Order change planning differential tests: ${passed} passed, ${failed} failed (${scenarioCount} compared scenarios, ${assertions} differential assertions in compare())`);
if (failed > 0) throw new Error(`${failed} order change planning test(s) failed`);
