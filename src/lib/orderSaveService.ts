import { supabase } from './supabase';
import { showToast } from './notifications';
import { upsertCanonicalAddress } from './addressService';
import { calculateTotalFromOrder } from './orderSummary';
import { notifyPortalRefresh } from './customerPortalRefreshSignal';
import { hasAddressChanged, planOrderChanges, finalizeOrderPlan } from './orderChangePlanning';

interface SaveOrderChangesParams {
  order: any;
  editedOrder: any;
  stagedItems: any[];
  discounts: any[];
  customFees: any[];
  calculatedPricing: any;
  customDepositCents: number | null;
  customSetupFeeCents: number | null;
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
  parksAcknowledgmentRequired?: boolean;
  parksAcknowledgmentCounty?: string | null;
  depositCatchupMode?: 'require' | 'waive';
  requireCardOnFile?: boolean;
  logChangeFn: (field: string, oldValue: any, newValue: any, action?: 'update' | 'add' | 'remove') => Promise<void>;
  sendNotificationsFn: () => Promise<void>;
  onComplete: () => void;
}

export async function saveOrderChanges({
  order, editedOrder, stagedItems, discounts, customFees, calculatedPricing,
  customDepositCents, customSetupFeeCents, adminMessage, adminOverrideApproval, availabilityIssues,
  taxWaived, taxWaiveReason, travelFeeWaived, travelFeeWaiveReason,
  sameDayPickupFeeWaived, sameDayPickupFeeWaiveReason, surfaceFeeWaived, surfaceFeeWaiveReason,
  generatorFeeWaived, generatorFeeWaiveReason, sameDayWeekdayDeliveryFeeWaived, sameDayWeekdayDeliveryFeeWaiveReason,
  parksAcknowledgmentRequired,
  parksAcknowledgmentCounty,
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

  let canonicalAddressId: string | undefined;
  if (hasAddressChanged(order, editedOrder)) {
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
    canonicalAddressId = canonical.id;
  }

  const plan = planOrderChanges({
    order, editedOrder, stagedItems, discounts, customFees, calculatedPricing,
    customDepositCents, customSetupFeeCents, adminMessage, canonicalAddressId,
    taxWaived, taxWaiveReason, travelFeeWaived, travelFeeWaiveReason,
    sameDayPickupFeeWaived, sameDayPickupFeeWaiveReason, surfaceFeeWaived, surfaceFeeWaiveReason,
    generatorFeeWaived, generatorFeeWaiveReason, sameDayWeekdayDeliveryFeeWaived, sameDayWeekdayDeliveryFeeWaiveReason,
    parksAcknowledgmentRequired, parksAcknowledgmentCounty,
    depositCatchupMode, requireCardOnFile,
  }, { calculateTotal: calculateTotalFromOrder });

  for (const op of plan.itemOperations) {
    if (op.kind === 'insert') {
      const { error: itemInsertError } = await supabase.from('order_items').insert(op.payload);
      if (itemInsertError) throw new Error(`${op.errorLabel}: ${itemInsertError.message}`);
    } else if (op.kind === 'delete') {
      const { error: itemDeleteError } = await supabase.from('order_items').delete().eq('id', op.itemId);
      if (itemDeleteError) throw new Error(`${op.errorLabel}: ${itemDeleteError.message}`);
    } else {
      const { error: itemUpdateError } = await supabase.from('order_items').update(op.payload).eq('id', op.itemId);
      if (itemUpdateError) throw new Error(`${op.errorLabel}: ${itemUpdateError.message}`);
    }
    await logChangeFn(op.log.field, op.log.oldValue, op.log.newValue, op.log.action);
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

  const finalized = finalizeOrderPlan(
    plan,
    { deletedDiscountCount, updatedDiscountCount, deletedFeeCount, updatedFeeCount },
    { adminOverrideApproval, nowIso: () => new Date().toISOString() },
  );
  const { changes, logs, hasTrackedChanges, hasCustomerVisibleChanges, preserveCurrentStatus } = finalized;

  if (finalized.shouldCommit) {
    const oldStatus = order.status;

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