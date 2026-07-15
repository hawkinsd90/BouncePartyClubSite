import { supabase } from './supabase';
import { showToast } from './notifications';
import { upsertCanonicalAddress } from './addressService';
import { ORDER_STATUS } from './constants/statuses';
import { calculateTotalFromOrder } from './orderSummary';

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
  order,
  editedOrder,
  stagedItems,
  discounts,
  customFees,
  calculatedPricing,
  customDepositCents,
  adminMessage,
  adminOverrideApproval,
  availabilityIssues,
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
  depositCatchupMode,
  requireCardOnFile,
  logChangeFn,
  sendNotificationsFn,
  onComplete,
}: SaveOrderChangesParams): Promise<void> {
  if (availabilityIssues.length > 0) {
    const unitNames = availabilityIssues.map(issue => issue.unitName).join(', ');
    showToast(
      `Cannot save: The following units are not available for the selected dates: ${unitNames}. Please adjust the dates or remove the conflicting items.`,
      'error'
    );
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
  // console.log('User authenticated:', user.id);

  const changes: any = {};
  const logs = [];

  // Track order field changes
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

  // Normalize dates to YYYY-MM-DD format for comparison
  const normalizeDate = (dateStr: string) => {
    if (!dateStr) return '';
    return dateStr.split('T')[0];
  };

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

  // Handle address changes
  const addressChanged =
    editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
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

    logs.push([
      'address',
      `${order.addresses?.line1}, ${order.addresses?.city}, ${order.addresses?.state} ${order.addresses?.zip}`,
      `${editedOrder.address_line1}, ${editedOrder.address_city}, ${editedOrder.address_state} ${editedOrder.address_zip}`
    ]);
  }

  // Effective total: scalar pricing engine base + relational custom fees - relational discounts.
  // Declared at function scope so both the balance_due_cents write and the shouldClearPayment
  // branch below can reference the same value.
  let effectiveTotalCents = 0;

  // Apply calculated pricing — only write a field into `changes` when the
  // recomputed value actually differs from what is stored on the order row.
  // This prevents a no-change save from touching the order row at all.
  if (calculatedPricing) {
    if (calculatedPricing.subtotal_cents !== order.subtotal_cents) {
      changes.subtotal_cents = calculatedPricing.subtotal_cents;
      logs.push(['subtotal', order.subtotal_cents, calculatedPricing.subtotal_cents]);
    }
    if (calculatedPricing.generator_fee_cents !== (order.generator_fee_cents || 0)) {
      changes.generator_fee_cents = calculatedPricing.generator_fee_cents;
      logs.push(['generator_fee', order.generator_fee_cents || 0, calculatedPricing.generator_fee_cents]);
    }
    if (calculatedPricing.travel_fee_cents !== (order.travel_fee_cents || 0)) {
      changes.travel_fee_cents = calculatedPricing.travel_fee_cents;
      logs.push(['travel_fee', order.travel_fee_cents, calculatedPricing.travel_fee_cents]);
    }
    if (calculatedPricing.travel_total_miles !== (parseFloat(order.travel_total_miles) || 0)) {
      changes.travel_total_miles = calculatedPricing.travel_total_miles;
    }
    if (calculatedPricing.travel_base_radius_miles !== (parseFloat(order.travel_base_radius_miles) || null)) {
      changes.travel_base_radius_miles = calculatedPricing.travel_base_radius_miles;
    }
    if (calculatedPricing.travel_chargeable_miles !== (parseFloat(order.travel_chargeable_miles) || null)) {
      changes.travel_chargeable_miles = calculatedPricing.travel_chargeable_miles;
    }
    if (calculatedPricing.travel_per_mile_cents !== (order.travel_per_mile_cents || null)) {
      changes.travel_per_mile_cents = calculatedPricing.travel_per_mile_cents;
    }
    if (calculatedPricing.travel_is_flat_fee !== (order.travel_is_flat_fee || false)) {
      changes.travel_is_flat_fee = calculatedPricing.travel_is_flat_fee;
    }
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

    // discounts and customFees are the relational rows being saved in this same call.
    // Using calculateTotalFromOrder here keeps balance_due_cents consistent with displayed totals.
    effectiveTotalCents = calculateTotalFromOrder(
      { ...order, ...calculatedPricing },
      discounts.filter(d => !d.is_deleted),
      customFees.filter(f => !f.is_deleted),
    );

    // Deposit catch-up for confirmed orders that already have payments captured
    const depositAlreadyCapturedCents = order.deposit_paid_cents || 0;
    const isConfirmedWithPayment = (order.status === ORDER_STATUS.CONFIRMED || order.status === ORDER_STATUS.IN_PROGRESS) && depositAlreadyCapturedCents > 0;
    const depositDifferenceCents = Math.max(0, finalDepositCents - depositAlreadyCapturedCents);

    // deposit_paid_cents and balance_paid_cents are mutually exclusive payment
    // classifications (each payment is one or the other, never both).
    // Summing them gives total collected without double-counting.

    // HOTFIX GUARD: For refunded orders, preserve stored balance_due_cents.
    // The formula below does not account for total_refunded_cents, so applying
    // it to a refunded order could recreate a false customer balance.
    // TODO: centralize refund-aware balance calculation in a shared RPC.
    const hasRefunds = (order.total_refunded_cents || 0) > 0;

    const depositPaidCents = order.deposit_paid_cents || 0;
    const balancePaidCents = order.balance_paid_cents || 0;
    const excessDepositPaidCents = Math.max(0, depositPaidCents - finalDepositCents);

    let newBalanceDueCents: number;
    if (hasRefunds) {
      newBalanceDueCents = order.balance_due_cents ?? 0;
    } else if (isConfirmedWithPayment && depositDifferenceCents > 0 && depositCatchupMode === 'require') {
      // Admin requires the customer to pay the deposit difference now.
      // The full new deposit is reserved against the total, so the
      // event-day balance is total - newDeposit - balancePaid - excess.
      // excess (deposit paid above new requirement) is credited to balance.
      newBalanceDueCents = Math.max(0, effectiveTotalCents - finalDepositCents - balancePaidCents - excessDepositPaidCents);
      changes.deposit_catchup_cents = depositDifferenceCents;
      logs.push(['deposit_catchup', 0, depositDifferenceCents]);
    } else if (isConfirmedWithPayment && depositDifferenceCents > 0 && depositCatchupMode === 'waive') {
      // Admin waives the deposit difference — no additional deposit due now.
      // The waived amount rolls into the event-day balance, so only the
      // deposit actually captured is credited, not the new requirement.
      // balance = total - depositPaid - balancePaid
      newBalanceDueCents = Math.max(0, effectiveTotalCents - depositPaidCents - balancePaidCents);
      changes.deposit_catchup_cents = 0;
    } else {
      // No deposit catch-up applies. The full deposit due is reserved.
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

  // Handle tax waived changes
  if (taxWaived !== undefined && taxWaived !== (order.tax_waived || false)) {
    changes.tax_waived = taxWaived;
    const reasonInfo = taxWaived && taxWaiveReason ? ` (Reason: ${taxWaiveReason})` : '';
    logs.push(['tax_waived', order.tax_waived || false, `${taxWaived}${reasonInfo}`]);
  }

  // Handle tax waive reason changes
  if (taxWaiveReason !== undefined && taxWaiveReason !== (order.tax_waive_reason || '')) {
    changes.tax_waive_reason = taxWaiveReason || null;
  }

  // Handle travel fee waived changes
  if (travelFeeWaived !== undefined && travelFeeWaived !== (order.travel_fee_waived || false)) {
    changes.travel_fee_waived = travelFeeWaived;
    const reasonInfo = travelFeeWaived && travelFeeWaiveReason ? ` (Reason: ${travelFeeWaiveReason})` : '';
    logs.push(['travel_fee_waived', order.travel_fee_waived || false, `${travelFeeWaived}${reasonInfo}`]);
  }

  // Handle travel fee waive reason changes
  if (travelFeeWaiveReason !== undefined && travelFeeWaiveReason !== (order.travel_fee_waive_reason || '')) {
    changes.travel_fee_waive_reason = travelFeeWaiveReason || null;
  }

  // Handle same day pickup fee waived changes
  if (sameDayPickupFeeWaived !== undefined && sameDayPickupFeeWaived !== (order.same_day_pickup_fee_waived || false)) {
    changes.same_day_pickup_fee_waived = sameDayPickupFeeWaived;
    const reasonInfo = sameDayPickupFeeWaived && sameDayPickupFeeWaiveReason ? ` (Reason: ${sameDayPickupFeeWaiveReason})` : '';
    logs.push(['same_day_pickup_fee_waived', order.same_day_pickup_fee_waived || false, `${sameDayPickupFeeWaived}${reasonInfo}`]);
  }

  // Handle same day pickup fee waive reason changes
  if (sameDayPickupFeeWaiveReason !== undefined && sameDayPickupFeeWaiveReason !== (order.same_day_pickup_fee_waive_reason || '')) {
    changes.same_day_pickup_fee_waive_reason = sameDayPickupFeeWaiveReason || null;
  }

  // Handle surface fee waived changes
  if (surfaceFeeWaived !== undefined && surfaceFeeWaived !== (order.surface_fee_waived || false)) {
    changes.surface_fee_waived = surfaceFeeWaived;
    const reasonInfo = surfaceFeeWaived && surfaceFeeWaiveReason ? ` (Reason: ${surfaceFeeWaiveReason})` : '';
    logs.push(['surface_fee_waived', order.surface_fee_waived || false, `${surfaceFeeWaived}${reasonInfo}`]);
  }

  // Handle surface fee waive reason changes
  if (surfaceFeeWaiveReason !== undefined && surfaceFeeWaiveReason !== (order.surface_fee_waive_reason || '')) {
    changes.surface_fee_waive_reason = surfaceFeeWaiveReason || null;
  }

  // Handle generator fee waived changes
  if (generatorFeeWaived !== undefined && generatorFeeWaived !== (order.generator_fee_waived || false)) {
    changes.generator_fee_waived = generatorFeeWaived;
    const reasonInfo = generatorFeeWaived && generatorFeeWaiveReason ? ` (Reason: ${generatorFeeWaiveReason})` : '';
    logs.push(['generator_fee_waived', order.generator_fee_waived || false, `${generatorFeeWaived}${reasonInfo}`]);
  }

  // Handle generator fee waive reason changes
  if (generatorFeeWaiveReason !== undefined && generatorFeeWaiveReason !== (order.generator_fee_waive_reason || '')) {
    changes.generator_fee_waive_reason = generatorFeeWaiveReason || null;
  }

  // Handle same-day weekday delivery fee waived changes
  if (sameDayWeekdayDeliveryFeeWaived !== undefined && sameDayWeekdayDeliveryFeeWaived !== (order.same_day_weekday_delivery_fee_waived || false)) {
    changes.same_day_weekday_delivery_fee_waived = sameDayWeekdayDeliveryFeeWaived;
    const reasonInfo = sameDayWeekdayDeliveryFeeWaived && sameDayWeekdayDeliveryFeeWaiveReason ? ` (Reason: ${sameDayWeekdayDeliveryFeeWaiveReason})` : '';
    logs.push(['same_day_weekday_delivery_fee_waived', order.same_day_weekday_delivery_fee_waived || false, `${sameDayWeekdayDeliveryFeeWaived}${reasonInfo}`]);
  }

  // Handle same-day weekday delivery fee waive reason changes
  if (sameDayWeekdayDeliveryFeeWaiveReason !== undefined && sameDayWeekdayDeliveryFeeWaiveReason !== (order.same_day_weekday_delivery_fee_waive_reason || '')) {
    changes.same_day_weekday_delivery_fee_waive_reason = sameDayWeekdayDeliveryFeeWaiveReason || null;
  }

  // Determine if we need to clear payment method
  let shouldClearPayment = false;
  const itemsChanged = stagedItems.some(item => item.is_new || item.is_deleted);

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

  // Handle item changes
  for (const item of stagedItems) {
    if (item.is_new && !item.is_deleted) {
      const { error: itemInsertError } = await supabase.from('order_items').insert({
        order_id: order.id,
        unit_id: item.unit_id,
        qty: item.qty,
        wet_or_dry: item.wet_or_dry,
        unit_price_cents: item.unit_price_cents,
      });
      if (itemInsertError) throw new Error(`Failed to add item: ${itemInsertError.message}`);
      await logChangeFn('order_items', '', `${item.unit_name} (${item.wet_or_dry})`, 'add');
    } else if (item.is_deleted && item.id) {
      const { error: itemDeleteError } = await supabase.from('order_items').delete().eq('id', item.id);
      if (itemDeleteError) throw new Error(`Failed to remove item: ${itemDeleteError.message}`);
      await logChangeFn('order_items', `${item.unit_name} (${item.wet_or_dry})`, '', 'remove');
    }
  }

  // Handle discounts
  const insertedDiscountIds: string[] = [];
  for (const discount of discounts) {
    if (discount.is_new) {
      const { data, error } = await supabase.from('order_discounts').insert({
        order_id: order.id,
        name: discount.name,
        amount_cents: discount.amount_cents,
        percentage: discount.percentage,
      }).select();

      if (error) throw new Error(`Failed to save discount: ${error.message}`);
      if (data && data[0]) insertedDiscountIds.push(data[0].id);
      await logChangeFn('discounts', '', discount.name, 'add');
    }
  }

  const originalDiscounts = await supabase.from('order_discounts').select('*').eq('order_id', order.id);
  if (originalDiscounts.error) throw new Error(`Failed to load existing discounts before saving: ${originalDiscounts.error.message}`);
  let deletedDiscountCount = 0;
  let updatedDiscountCount = 0;
  if (originalDiscounts.data) {
    const currentDiscountIds = [
      ...discounts.filter(d => !d.is_new).map(d => d.id),
      ...insertedDiscountIds
    ];
    const deletedDiscounts = originalDiscounts.data.filter(od => !currentDiscountIds.includes(od.id));
    deletedDiscountCount = deletedDiscounts.length;
    for (const deleted of deletedDiscounts) {
      const { error: discDeleteError } = await supabase.from('order_discounts').delete().eq('id', deleted.id);
      if (discDeleteError) throw new Error(`Failed to remove discount: ${discDeleteError.message}`);
      await logChangeFn('discounts', deleted.name, '', 'remove');
    }

    // UPDATE existing rows whose name/amount/percentage changed
    for (const discount of discounts.filter(d => !d.is_new)) {
      const original = originalDiscounts.data.find(od => od.id === discount.id);
      if (!original) continue;
      const nameChanged = discount.name !== original.name;
      const amountChanged = (discount.amount_cents || 0) !== (original.amount_cents || 0);
      const percentageChanged = (discount.percentage || 0) !== (original.percentage || 0);
      if (nameChanged || amountChanged || percentageChanged) {
        const { error: discUpdateError } = await supabase.from('order_discounts').update({
          name: discount.name,
          amount_cents: discount.amount_cents || 0,
          percentage: discount.percentage || 0,
        }).eq('id', discount.id);
        if (discUpdateError) throw new Error(`Failed to update discount: ${discUpdateError.message}`);
        await logChangeFn('discounts', original.name, discount.name, 'update');
        updatedDiscountCount++;
      }
    }
  }

  // Handle custom fees
  const insertedFeeIds: string[] = [];
  for (const fee of customFees) {
    if (fee.is_new) {
      const { data, error } = await supabase.from('order_custom_fees').insert({
        order_id: order.id,
        name: fee.name,
        amount_cents: fee.amount_cents,
      }).select();

      if (error) throw new Error(`Failed to save custom fee: ${error.message}`);
      if (data && data[0]) insertedFeeIds.push(data[0].id);
      await logChangeFn('custom_fees', '', fee.name, 'add');
    }
  }

  const originalCustomFees = await supabase.from('order_custom_fees').select('*').eq('order_id', order.id);
  if (originalCustomFees.error) throw new Error(`Failed to load existing custom fees before saving: ${originalCustomFees.error.message}`);
  let deletedFeeCount = 0;
  let updatedFeeCount = 0;
  if (originalCustomFees.data) {
    const currentFeeIds = [
      ...customFees.filter(f => !f.is_new).map(f => f.id),
      ...insertedFeeIds
    ];
    const deletedFees = originalCustomFees.data.filter(of => !currentFeeIds.includes(of.id));
    deletedFeeCount = deletedFees.length;
    for (const deleted of deletedFees) {
      const { error: feeDeleteError } = await supabase.from('order_custom_fees').delete().eq('id', deleted.id);
      if (feeDeleteError) throw new Error(`Failed to remove custom fee: ${feeDeleteError.message}`);
      await logChangeFn('custom_fees', deleted.name, '', 'remove');
    }

    // UPDATE existing rows whose name or amount changed
    for (const fee of customFees.filter(f => !f.is_new)) {
      const original = originalCustomFees.data.find(of => of.id === fee.id);
      if (!original) continue;
      const nameChanged = fee.name !== original.name;
      const amountChanged = (fee.amount_cents || 0) !== (original.amount_cents || 0);
      if (nameChanged || amountChanged) {
        const { error: feeUpdateError } = await supabase.from('order_custom_fees').update({
          name: fee.name,
          amount_cents: fee.amount_cents || 0,
        }).eq('id', fee.id);
        if (feeUpdateError) throw new Error(`Failed to update custom fee: ${feeUpdateError.message}`);
        await logChangeFn('custom_fees', original.name, fee.name, 'update');
        updatedFeeCount++;
      }
    }
  }

  // Save admin message — normalized comparison allows clearing
  const normalizedAdminMessage = adminMessage.trim();
  const originalAdminMessage = order.admin_message || '';

  if (normalizedAdminMessage !== originalAdminMessage) {
    changes.admin_message = normalizedAdminMessage || null;
    logs.push(['admin_message', originalAdminMessage, normalizedAdminMessage]);
  }

  // Card-on-file normalization: when the effective deposit is greater than
  // zero, a stale hidden false value must not be stored. The customer payment
  // flow ignores require_card_on_file when a deposit is due, so normalizing to
  // true is consistent with the existing behavior.
  const finalDepositForCard = customDepositCents !== null
    ? customDepositCents
    : calculatedPricing?.deposit_due_cents ?? order.deposit_due_cents ?? 0;
  const normalizedRequireCardOnFile = finalDepositForCard > 0
    ? true
    : (requireCardOnFile ?? true);
  if (normalizedRequireCardOnFile !== (order.require_card_on_file ?? true)) {
    changes.require_card_on_file = normalizedRequireCardOnFile;
    logs.push(['require_card_on_file', order.require_card_on_file ?? true, normalizedRequireCardOnFile]);
  }

  // Check if there are any real changes.
  // Pricing fields, discount/fee add/delete/update, and field edits all count.
  const hasTrackedChanges = logs.length > 0
    || stagedItems.some(item => item.is_new || item.is_deleted)
    || discounts.some(d => d.is_new)
    || customFees.some(f => f.is_new)
    || deletedDiscountCount > 0
    || deletedFeeCount > 0
    || updatedDiscountCount > 0
    || updatedFeeCount > 0;
  const hasFieldChanges = Object.keys(changes).length > 0;

  // Classify whether any change is customer-visible. The Realtime sentinel
  // (customer_view_updated_at) must only fire when the customer portal would
  // display something different after this save. Internal-only changes
  // (status transitions, payment-method clearing, changelog writes) do not
  // affect what the customer sees, so they must not trigger the sentinel.
  const CUSTOMER_VISIBLE_CHANGE_KEYS = new Set([
    'location_type', 'surface', 'generator_qty',
    'start_window', 'end_window',
    'event_date', 'event_end_date',
    'pickup_preference', 'overnight_allowed',
    'address_id',
    'subtotal_cents', 'generator_fee_cents',
    'travel_fee_cents', 'travel_total_miles', 'travel_base_radius_miles',
    'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',
    'surface_fee_cents', 'same_day_pickup_fee_cents',
    'same_day_weekday_delivery_fee_cents', 'tax_cents',
    'deposit_due_cents', 'balance_due_cents', 'deposit_catchup_cents',
    'tax_waived', 'tax_waive_reason',
    'travel_fee_waived', 'travel_fee_waive_reason',
    'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason',
    'surface_fee_waived', 'surface_fee_waive_reason',
    'generator_fee_waived', 'generator_fee_waive_reason',
    'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason',
    'admin_message', 'require_card_on_file',
  ]);
  const hasCustomerVisibleChanges =
    Object.keys(changes).some(k => CUSTOMER_VISIBLE_CHANGE_KEYS.has(k))
    || stagedItems.some(item => item.is_new || item.is_deleted)
    || discounts.some(d => d.is_new || d.is_deleted)
    || customFees.some(f => f.is_new || f.is_deleted)
    || deletedDiscountCount > 0
    || deletedFeeCount > 0
    || updatedDiscountCount > 0
    || updatedFeeCount > 0
    || logs.some(([field]) => field !== 'payment_method');

  // Statuses where we must never attempt a status transition — the order is
  // already operational or terminal. Admin changes (fees, generators, items)
  // are saved as-is without touching status.
  const PRESERVE_STATUS = new Set([
    ORDER_STATUS.DRAFT,
    ORDER_STATUS.IN_PROGRESS,
    ORDER_STATUS.COMPLETED,
    ORDER_STATUS.CANCELLED,
    ORDER_STATUS.VOID,
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

    // Sentinel: guarantee a customer-facing Realtime UPDATE event fires
    // after all relational writes (items, discounts, fees) have succeeded.
    // Only set when at least one customer-visible change exists — internal
    // changes (status transitions, payment-method clearing) must not
    // trigger a customer-portal refresh.
    if (hasCustomerVisibleChanges) {
      changes.customer_view_updated_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase.from('orders').update(changes).eq('id', order.id);
    if (updateError) throw new Error(`Failed to update order: ${updateError.message}`);

    if (hasCustomerVisibleChanges) {
      const channel = supabase.channel(`portal-order-${order.id}`);
      await channel.send({ type: 'broadcast', event: 'order_updated', payload: { id: order.id } });
      supabase.removeChannel(channel);
    }

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
