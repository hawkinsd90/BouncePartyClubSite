import { supabase } from './supabase';
import { showToast } from './notifications';

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

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    console.error('Authentication error:', authError);
    showToast('You must be logged in to save changes.', 'error');
    throw new Error('Authentication required');
  }
  console.log('User authenticated:', user.id);

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
    await supabase.from('addresses').update({
      line1: editedOrder.address_line1,
      line2: editedOrder.address_line2,
      city: editedOrder.address_city,
      state: editedOrder.address_state,
      zip: editedOrder.address_zip,
    }).eq('id', order.address_id);

    logs.push([
      'address',
      `${order.addresses?.line1}, ${order.addresses?.city}, ${order.addresses?.state} ${order.addresses?.zip}`,
      `${editedOrder.address_line1}, ${editedOrder.address_city}, ${editedOrder.address_state} ${editedOrder.address_zip}`
    ]);
  }

  // Apply calculated pricing
  if (calculatedPricing) {
    changes.subtotal_cents = calculatedPricing.subtotal_cents;
    changes.generator_fee_cents = calculatedPricing.generator_fee_cents;
    changes.travel_fee_cents = calculatedPricing.travel_fee_cents;
    changes.travel_total_miles = calculatedPricing.travel_total_miles;
    changes.travel_base_radius_miles = calculatedPricing.travel_base_radius_miles;
    changes.travel_chargeable_miles = calculatedPricing.travel_chargeable_miles;
    changes.travel_per_mile_cents = calculatedPricing.travel_per_mile_cents;
    changes.travel_is_flat_fee = calculatedPricing.travel_is_flat_fee;
    changes.surface_fee_cents = calculatedPricing.surface_fee_cents;
    changes.same_day_pickup_fee_cents = calculatedPricing.same_day_pickup_fee_cents;
    changes.tax_cents = calculatedPricing.tax_cents;

    const finalDepositCents = customDepositCents !== null ? customDepositCents : calculatedPricing.deposit_due_cents;
    changes.deposit_due_cents = finalDepositCents;
    changes.balance_due_cents = calculatedPricing.total_cents - finalDepositCents;

    // Log pricing changes
    if (calculatedPricing.subtotal_cents !== order.subtotal_cents) {
      logs.push(['subtotal', order.subtotal_cents, calculatedPricing.subtotal_cents]);
    }
    if (calculatedPricing.generator_fee_cents !== (order.generator_fee_cents || 0)) {
      logs.push(['generator_fee', order.generator_fee_cents || 0, calculatedPricing.generator_fee_cents]);
    }
    if (calculatedPricing.travel_fee_cents !== order.travel_fee_cents) {
      logs.push(['travel_fee', order.travel_fee_cents, calculatedPricing.travel_fee_cents]);
    }
    if (calculatedPricing.surface_fee_cents !== order.surface_fee_cents) {
      logs.push(['surface_fee', order.surface_fee_cents, calculatedPricing.surface_fee_cents]);
    }
    if (calculatedPricing.same_day_pickup_fee_cents !== (order.same_day_pickup_fee_cents || 0)) {
      logs.push(['same_day_pickup_fee', order.same_day_pickup_fee_cents || 0, calculatedPricing.same_day_pickup_fee_cents]);
    }
    if (calculatedPricing.tax_cents !== order.tax_cents) {
      logs.push(['tax', order.tax_cents, calculatedPricing.tax_cents]);
    }
    if (finalDepositCents !== order.deposit_due_cents) {
      logs.push(['deposit_due', order.deposit_due_cents, finalDepositCents]);
    }

    const newBalanceDue = calculatedPricing.total_cents - finalDepositCents;
    if (newBalanceDue !== order.balance_due_cents) {
      logs.push(['balance_due', order.balance_due_cents, newBalanceDue]);
    }

    const newTotal = calculatedPricing.total_cents;
    const oldTotal = order.subtotal_cents + (order.generator_fee_cents || 0) + order.travel_fee_cents + order.surface_fee_cents + (order.same_day_pickup_fee_cents || 0) + order.tax_cents;
    if (newTotal !== oldTotal) {
      logs.push(['total', oldTotal, newTotal]);
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

  // Determine if we need to clear payment method
  let shouldClearPayment = false;
  const itemsChanged = stagedItems.some(item => item.is_new || item.is_deleted);

  if (itemsChanged) {
    shouldClearPayment = true;
    logs.push(['payment_method', 'cleared', 'items changed']);
  } else if (calculatedPricing && order.stripe_payment_intent_id) {
    const finalDepositCents = customDepositCents !== null ? customDepositCents : calculatedPricing.deposit_due_cents;
    const currentPaidAmount = order.stripe_amount_paid_cents || 0;

    if (finalDepositCents > currentPaidAmount) {
      shouldClearPayment = true;
      logs.push(['payment_method', 'cleared', `deposit increased from ${currentPaidAmount} to ${finalDepositCents}`]);
    } else if (currentPaidAmount >= (order.subtotal_cents + (order.generator_fee_cents || 0) + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents)) {
      const newTotal = calculatedPricing.total_cents;
      if (newTotal > currentPaidAmount) {
        shouldClearPayment = true;
        logs.push(['payment_method', 'cleared', `paid in full but total increased from ${currentPaidAmount} to ${newTotal}`]);
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
      await supabase.from('order_items').insert({
        order_id: order.id,
        unit_id: item.unit_id,
        qty: item.qty,
        wet_or_dry: item.wet_or_dry,
        unit_price_cents: item.unit_price_cents,
      });
      await logChangeFn('order_items', '', `${item.unit_name} (${item.wet_or_dry})`, 'add');
    } else if (item.is_deleted && item.id) {
      await supabase.from('order_items').delete().eq('id', item.id);
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
  if (originalDiscounts.data) {
    const currentDiscountIds = [
      ...discounts.filter(d => !d.is_new).map(d => d.id),
      ...insertedDiscountIds
    ];
    const deletedDiscounts = originalDiscounts.data.filter(od => !currentDiscountIds.includes(od.id));
    for (const deleted of deletedDiscounts) {
      await supabase.from('order_discounts').delete().eq('id', deleted.id);
      await logChangeFn('discounts', deleted.name, '', 'remove');
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
  if (originalCustomFees.data) {
    const currentFeeIds = [
      ...customFees.filter(f => !f.is_new).map(f => f.id),
      ...insertedFeeIds
    ];
    const deletedFees = originalCustomFees.data.filter(of => !currentFeeIds.includes(of.id));
    for (const deleted of deletedFees) {
      await supabase.from('order_custom_fees').delete().eq('id', deleted.id);
      await logChangeFn('custom_fees', deleted.name, '', 'remove');
    }
  }

  // Save admin message
  if (adminMessage.trim()) {
    changes.admin_message = adminMessage.trim();
    if (adminMessage.trim() !== (order.admin_message || '')) {
      logs.push(['admin_message', order.admin_message || '', adminMessage.trim()]);
    }
  }

  // Check if there are any changes
  const hasTrackedChanges = logs.length > 0 || stagedItems.some(item => item.is_new || item.is_deleted) || discounts.some(d => d.is_new) || customFees.some(f => f.is_new);
  const hasFieldChanges = Object.keys(changes).length > 0;

  if (hasTrackedChanges || hasFieldChanges) {
    if (adminOverrideApproval) {
      changes.status = 'confirmed';
    } else {
      changes.status = 'awaiting_customer_approval';
    }

    const { error: updateError } = await supabase.from('orders').update(changes).eq('id', order.id);
    if (updateError) throw new Error(`Failed to update order: ${updateError.message}`);

    for (const [field, oldVal, newVal] of logs) {
      await logChangeFn(field, oldVal, newVal);
    }

    if (hasTrackedChanges && !adminOverrideApproval) {
      await sendNotificationsFn();
    }
  } else if (hasFieldChanges) {
    const { error: updateError } = await supabase.from('orders').update(changes).eq('id', order.id);
    if (updateError) throw new Error(`Failed to update order: ${updateError.message}`);
  }

  onComplete();

  if (hasTrackedChanges) {
    if (adminOverrideApproval) {
      showToast('Changes saved and order confirmed! Customer approval was skipped - order is ready to go.', 'success');
    } else {
      showToast('Changes saved successfully! Customer will be notified to review and approve the changes.', 'success');
    }
  } else {
    showToast('Changes saved successfully!', 'success');
  }
}
