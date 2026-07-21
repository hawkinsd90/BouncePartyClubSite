import { supabase } from './supabase';
import { showToast } from './notifications';
import { upsertCanonicalAddress } from './addressService';
import { ORDER_STATUS } from './constants/statuses';
import { calculateTotalFromOrder } from './orderSummary';
import { notifyPortalRefresh } from './customerPortalRefreshSignal';
import { lookupGeneratorProduct, detectMixedGeneratorConflict } from './generatorUnified';

interface SaveOrderChangesParams {
  order: any;
  editedOrder: any;
  stagedItems: any[];
  discounts: any[];
  customFees: any[];
  calculatedPricing: any;
  customDepositCents: number | null;
  adminMessage: string;
  adminOverrideApproval: boolean;
  availabilityIssues: any[];
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
  depositCatchupMode?: 'require' | 'waive';
  requireCardOnFile?: boolean;
  logChangeFn: (field: string, oldValue: any, newValue: any, action?: 'update' | 'add' | 'remove') => Promise<void>;
  sendNotificationsFn: () => Promise<void>;
  onComplete: () => void;
}

export async function saveOrderChanges({
  order, editedOrder, stagedItems, discounts, customFees, calculatedPricing,
  customDepositCents, adminMessage, adminOverrideApproval, availabilityIssues,
  taxWaived, taxWaiveReason, travelFeeWaived, travelFeeWaiveReason,
  sameDayPickupFeeWaived, sameDayPickupFeeWaiveReason, surfaceFeeWaived, surfaceFeeWaiveReason,
  generatorFeeWaived, generatorFeeWaiveReason, sameDayWeekdayDeliveryFeeWaived, sameDayWeekdayDeliveryFeeWaiveReason,
  depositCatchupMode, requireCardOnFile, logChangeFn, sendNotificationsFn, onComplete,
}: SaveOrderChangesParams): Promise<void> {
  if (availabilityIssues.length > 0) {
    const unitNames = availabilityIssues.map(issue => issue.unitName).join(', ');
    showToast(`Cannot save: The following units are not available for the selected dates: ${unitNames}. Please adjust the dates or remove the conflicting items.`, 'error');
    throw new Error('Availability conflict');
  }

  if (sameDayWeekdayDeliveryFeeWaived && !sameDayWeekdayDeliveryFeeWaiveReason?.trim()) {
    showToast('A reason is required to waive the Same-Day Weekday Delivery Fee.', 'error');
    throw new Error('Same-Day Weekday Delivery Fee waiver reason required');
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    console.error('Authentication error:', authError);
    showToast('You must be logged in to save changes.', 'error');
    throw new Error('Authentication required');
  }

  const changes: any = {};
  const logs = [];

  // Generator Workflow Unification: defensive invariant — a single order must
  // not contain both a legacy Generator charge and an EE Generator product item.
  // Uses exact Generator product ID, not a blanket EE-product check.
  const hasLegacyGenerator = (editedOrder.generator_qty || 0) > 0 || (editedOrder.generator_fee_cents || 0) > 0;
  if (hasLegacyGenerator && stagedItems) {
    let genProductId: string | null = null;
    try {
      const genLookup = await lookupGeneratorProduct();
      if (genLookup.status === 'configured') {
        genProductId = genLookup.product.product_id;
      }
    } catch (err) {
      showToast('Unable to verify Generator configuration. Please try again or contact support.', 'error');
      throw new Error('Generator product lookup failed — cannot validate mixed state.');
    }
    if (!genProductId) {
      showToast('Generator product is not configured. Remove the legacy Generator charge before saving.', 'error');
      throw new Error('Generator product not configured — cannot validate mixed state.');
    }
    const conflict = detectMixedGeneratorConflict(genProductId, stagedItems, editedOrder.generator_qty || 0, editedOrder.generator_fee_cents || 0);
    if (conflict.conflict) {
      showToast(conflict.reason || 'Mixed Generator state detected.', 'error');
      throw new Error(conflict.reason || 'Mixed Generator state detected.');
    }
  }

  if (editedOrder.location_type !== order.location_type) {
    changes.location_type = editedOrder.location_type;
    logs.push(['location_type', order.location_type, editedOrder.location_type]);
  }
  if (editedOrder.surface !== order.surface) {
    changes.surface = editedOrder.surface;
    logs.push(['surface', order.surface, editedOrder.surface]);
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

  // Part 8: Address change detection now includes address_line2
  const addressChanged =
    editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
    editedOrder.address_line2 !== (order.addresses?.line2 || '') ||
    editedOrder.address_city !== (order.addresses?.city || '') ||
    editedOrder.address_state !== (order.addresses?.state || '') ||
    editedOrder.address_zip !== (order.addresses?.zip || '');

  if (addressChanged) {
    const canonical = await upsertCanonicalAddress({
      customer_id: order.customer_id ?? null,
      line1: editedOrder.address_line1,
      line2: editedOrder.address_line2 ?? null,
      city: editedOrder.address_city,
      state: editedOrder.address_state,
      zip: editedOrder.address_zip,
      lat: editedOrder.address_lat ?? null,
      lng: editedOrder.address_lng ?? null,
    });

    changes.address_id = canonical.id;

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
    if (calculatedPricing.surface_fee_cents !== (order.surface_fee_cents || 0)) {
      changes.surface_fee_cents = calculatedPricing.surface_fee_cents;
      logs.push(['surface_fee', order.surface_fee_cents, calculatedPricing.surface_fee_cents]);
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
      discounts.filter(d => !d.is_deleted),
      customFees.filter(f => !f.is_deleted),
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

  for (const item of stagedItems) {
    if (item.is_new && !item.is_deleted) {
      // Event Essential product item (not an inflatable)
      if (item.product_id && !item.unit_id) {
        const { error: itemInsertError } = await supabase.from('order_items').insert({
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
        } as any);
        if (itemInsertError) throw new Error(`Failed to add item: ${itemInsertError.message}`);
        await logChangeFn('order_items', '', item.item_name || item.product_name || 'Event Essential', 'add');
      } else {
        // Existing inflatable insert behavior (unchanged)
        const { error: itemInsertError } = await supabase.from('order_items').insert({
          order_id: order.id, unit_id: item.unit_id, qty: item.qty,
          wet_or_dry: item.wet_or_dry, unit_price_cents: item.unit_price_cents,
        } as any);
        if (itemInsertError) throw new Error(`Failed to add item: ${itemInsertError.message}`);
        await logChangeFn('order_items', '', `${item.unit_name} (${item.wet_or_dry})`, 'add');
      }
    } else if (item.is_deleted && item.id) {
      const { error: itemDeleteError } = await supabase.from('order_items').delete().eq('id', item.id);
      if (itemDeleteError) throw new Error(`Failed to remove item: ${itemDeleteError.message}`);
      const itemLabel = item.product_id && !item.unit_id
        ? (item.item_name || item.product_name || 'Event Essential')
        : `${item.unit_name} (${item.wet_or_dry})`;
      await logChangeFn('order_items', itemLabel, '', 'remove');
    } else if (item.id && !item.is_new && !item.is_deleted && item.is_updated) {
      // Update existing item only when explicitly marked as updated
      const { error: itemUpdateError } = await supabase.from('order_items').update({
        qty: item.qty,
        unit_price_cents: item.unit_price_cents,
        pricing_context: item.pricing_context || null,
      }).eq('id', item.id);
      if (itemUpdateError) throw new Error(`Failed to update item: ${itemUpdateError.message}`);
      const itemLabel = item.product_id && !item.unit_id
        ? (item.item_name || item.product_name || 'Event Essential')
        : `${item.unit_name} (${item.wet_or_dry})`;
      await logChangeFn('order_items', itemLabel, `${item.qty} × ${item.unit_price_cents}`, 'update');
    }
  }

  const insertedDiscountIds: string[] = [];
  for (const discount of discounts) {
    if (discount.is_new) {
      const { data, error } = await supabase.from('order_discounts').insert({
        order_id: order.id, name: discount.name, amount_cents: discount.amount_cents, percentage: discount.percentage,
      }).select();
      if (error) throw new Error(`Failed to save discount: ${error.message}`);
      if (data && data[0]) insertedDiscountIds.push(data[0].id);
      await logChangeFn('discounts', '', discount.name, 'add');
    }
  }

  const originalDiscounts = await supabase.from('order_discounts').select('*').eq('order_id', order.id);
  if (originalDiscounts.error) throw new Error(`Failed to load existing discounts: ${originalDiscounts.error.message}`);
  let deletedDiscountCount = 0;
  let updatedDiscountCount = 0;
  if (originalDiscounts.data) {
    const currentDiscountIds = [...discounts.filter(d => !d.is_new).map(d => d.id), ...insertedDiscountIds];
    const deletedDiscounts = originalDiscounts.data.filter(od => !currentDiscountIds.includes(od.id));
    deletedDiscountCount = deletedDiscounts.length;
    for (const deleted of deletedDiscounts) {
      const { error: discDeleteError } = await supabase.from('order_discounts').delete().eq('id', deleted.id);
      if (discDeleteError) throw new Error(`Failed to remove discount: ${discDeleteError.message}`);
      await logChangeFn('discounts', deleted.name, '', 'remove');
    }
    for (const discount of discounts.filter(d => !d.is_new)) {
      const original = originalDiscounts.data.find(od => od.id === discount.id);
      if (!original) continue;
      if (discount.name !== original.name || (discount.amount_cents || 0) !== (original.amount_cents || 0) || (discount.percentage || 0) !== (original.percentage || 0)) {
        const { error: discUpdateError } = await supabase.from('order_discounts').update({
          name: discount.name, amount_cents: discount.amount_cents || 0, percentage: discount.percentage || 0,
        }).eq('id', discount.id);
        if (discUpdateError) throw new Error(`Failed to update discount: ${discUpdateError.message}`);
        await logChangeFn('discounts', original.name, discount.name, 'update');
        updatedDiscountCount++;
      }
    }
  }

  const insertedFeeIds: string[] = [];
  for (const fee of customFees) {
    if (fee.is_new) {
      const { data, error } = await supabase.from('order_custom_fees').insert({
        order_id: order.id, name: fee.name, amount_cents: fee.amount_cents,
      }).select();
      if (error) throw new Error(`Failed to save custom fee: ${error.message}`);
      if (data && data[0]) insertedFeeIds.push(data[0].id);
      await logChangeFn('custom_fees', '', fee.name, 'add');
    }
  }

  const originalCustomFees = await supabase.from('order_custom_fees').select('*').eq('order_id', order.id);
  if (originalCustomFees.error) throw new Error(`Failed to load existing custom fees: ${originalCustomFees.error.message}`);
  let deletedFeeCount = 0;
  let updatedFeeCount = 0;
  if (originalCustomFees.data) {
    const currentFeeIds = [...customFees.filter(f => !f.is_new).map(f => f.id), ...insertedFeeIds];
    const deletedFees = originalCustomFees.data.filter(of => !currentFeeIds.includes(of.id));
    deletedFeeCount = deletedFees.length;
    for (const deleted of deletedFees) {
      const { error: feeDeleteError } = await supabase.from('order_custom_fees').delete().eq('id', deleted.id);
      if (feeDeleteError) throw new Error(`Failed to remove custom fee: ${feeDeleteError.message}`);
      await logChangeFn('custom_fees', deleted.name, '', 'remove');
    }
    for (const fee of customFees.filter(f => !f.is_new)) {
      const original = originalCustomFees.data.find(of => of.id === fee.id);
      if (!original) continue;
      if (fee.name !== original.name || (fee.amount_cents || 0) !== (original.amount_cents || 0)) {
        const { error: feeUpdateError } = await supabase.from('order_custom_fees').update({
          name: fee.name, amount_cents: fee.amount_cents || 0,
        }).eq('id', fee.id);
        if (feeUpdateError) throw new Error(`Failed to update custom fee: ${feeUpdateError.message}`);
        await logChangeFn('custom_fees', original.name, fee.name, 'update');
        updatedFeeCount++;
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

  const hasTrackedChanges = logs.length > 0
    || stagedItems.some(item => item.is_new || item.is_deleted || item.is_updated)
    || discounts.some(d => d.is_new)
    || customFees.some(f => f.is_new)
    || deletedDiscountCount > 0 || deletedFeeCount > 0
    || updatedDiscountCount > 0 || updatedFeeCount > 0;
  const hasFieldChanges = Object.keys(changes).length > 0;

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
    || stagedItems.some(item => item.is_new || item.is_deleted || item.is_updated)
    || discounts.some(d => d.is_new || d.is_deleted)
    || customFees.some(f => f.is_new || f.is_deleted)
    || deletedDiscountCount > 0 || deletedFeeCount > 0
    || updatedDiscountCount > 0 || updatedFeeCount > 0;

  const PRESERVE_STATUS = new Set([
    ORDER_STATUS.DRAFT, ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.COMPLETED,
    ORDER_STATUS.CANCELLED, ORDER_STATUS.VOID,
  ]);
  const preserveCurrentStatus = PRESERVE_STATUS.has(order.status);

  if (hasTrackedChanges || hasFieldChanges) {
    const oldStatus = order.status;

    if (!preserveCurrentStatus) {
      if (adminOverrideApproval) {
        changes.status = ORDER_STATUS.CONFIRMED;
      } else {
        changes.status = ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL;
      }
    }

    if (hasCustomerVisibleChanges) {
      changes.customer_view_updated_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase.from('orders').update(changes).eq('id', order.id);
    if (updateError) throw new Error(`Failed to update order: ${updateError.message}`);

    // Part 6: Changelog and lifecycle now happen BEFORE broadcast
    for (const [field, oldVal, newVal] of logs) {
      await logChangeFn(field, oldVal, newVal);
    }

    if (!preserveCurrentStatus && adminOverrideApproval) {
      try {
        const { enterConfirmed } = await import('./orderLifecycle');
        const lcResult = await enterConfirmed(order.id, 'admin_override_approval', 'waived', oldStatus) as { success: boolean; error?: string; alreadySent?: boolean };
        if (!lcResult.success && !lcResult.alreadySent) {
          console.error('[orderSaveService] enterConfirmed (admin-override) returned success=false:', lcResult.error);
        }
      } catch (lifecycleErr) {
        console.error('[orderSaveService] enterConfirmed (admin-override) threw (non-fatal):', lifecycleErr);
      }
    }

    if (hasTrackedChanges && !adminOverrideApproval && !preserveCurrentStatus) {
      await sendNotificationsFn();
    }

    // Part 6: Best-effort broadcast AFTER all writes complete — warning-only
    if (hasCustomerVisibleChanges) {
      notifyPortalRefresh(order.id).catch((err) => {
        console.warn('[orderSaveService] portal refresh signal failed (non-fatal):', err instanceof Error ? err.message : 'unknown');
      });
    }
  }

  onComplete();

  if (hasTrackedChanges) {
    if (preserveCurrentStatus) {
      showToast('Changes saved successfully!', 'success');
    } else if (adminOverrideApproval) {
      showToast('Changes saved and order confirmed! Customer approval was skipped - order is ready to go.', 'success');
    } else {
      showToast('Changes saved successfully! Customer will be notified to review and approve the changes.', 'success');
    }
  } else {
    showToast('Changes saved successfully!', 'success');
  }
}
