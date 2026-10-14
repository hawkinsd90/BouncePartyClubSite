import { showToast } from '../toasts';
import { notifyPortalRefresh } from '../portal/customerPortalRefreshSignal';
import { callStaffOrderSave, StaffOrderSaveError } from './staffOrderSaveApi';
import type { OrderPricingState } from '../pricing/orderPricingState';

// An Admin Edit save. The browser describes what the Admin changed; the SERVER prices it and writes it (staff-order-save). The
// totals the editor showed were a preview: nothing the browser calculated is sent as, or accepted as, a price.
interface SaveOrderChangesParams {
  order: any;
  editedOrder: any;
  stagedItems: any[];
  discounts: any[];
  customFees: any[];
  // The editor's own preview, used only for the one measured number the server needs (the driving distance) and never as a price.
  calculatedPricing: any;
  // What the editor loaded: the order, its items, discounts and custom fees as stored. If the stored order has moved since, the
  // server refuses the save.
  loadedPricingState: OrderPricingState;
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
  sendNotificationsFn: () => Promise<void>;
  onComplete: () => void;
}

interface SaveResponse {
  success: boolean;
  saved: boolean;
  hasTrackedChanges: boolean;
  hasCustomerVisibleChanges: boolean;
  preserveCurrentStatus: boolean;
  oldStatus: string;
  adminOverrideApproval?: boolean;
}

const kindOf = (item: any): 'inflatable' | 'product' | 'bundle' => (item.unit_id ? 'inflatable' : item.bundle_id ? 'bundle' : 'product');

// What the staged items say the Admin did, without a price: stored lines are referenced by id (the server keeps their stored price),
// new lines by what was added (the server prices them from the catalog).
export function buildItemIntents(stagedItems: any[]) {
  return stagedItems
    .filter((item) => !(item.is_new && item.is_deleted))
    .map((item) =>
      item.id && !item.is_new
        ? { id: item.id, kind: kindOf(item), qty: item.qty, is_deleted: !!item.is_deleted, is_updated: !!item.is_updated }
        : {
            kind: kindOf(item), qty: item.qty,
            ...(item.unit_id ? { unit_id: item.unit_id, wet_or_dry: item.wet_or_dry || 'dry' } : {}),
            ...(item.bundle_id && !item.unit_id ? { bundle_id: item.bundle_id } : {}),
            ...(item.product_id && !item.unit_id && !item.bundle_id ? { product_id: item.product_id } : {}),
            is_deleted: false, is_updated: false,
          },
    );
}

export function buildSaveRequest(p: SaveOrderChangesParams) {
  const e = p.editedOrder;
  const waiver = (waived: boolean | undefined, reason: string | undefined) => ({ waived: !!waived, reason: reason ?? '' });
  return {
    orderId: p.order.id,
    expectedState: p.loadedPricingState,
    edited: {
      location_type: e.location_type, surface: e.surface ?? 'grass', generator_qty: e.generator_qty ?? 0, start_window: e.start_window, end_window: e.end_window,
      event_date: e.event_date, event_end_date: e.event_end_date || e.event_date, pickup_preference: e.pickup_preference,
      address_line1: e.address_line1, address_line2: e.address_line2 ?? '', address_city: e.address_city, address_state: e.address_state, address_zip: e.address_zip,
      address_lat: typeof e.address_lat === 'number' ? e.address_lat : null, address_lng: typeof e.address_lng === 'number' ? e.address_lng : null,
    },
    items: buildItemIntents(p.stagedItems),
    discounts: p.discounts.map((d) => ({ ...(d.is_new || !d.id ? {} : { id: d.id }), name: d.name, amount_cents: d.amount_cents || 0, percentage: Number(d.percentage || 0) })),
    customFees: p.customFees.map((f) => ({ ...(f.is_new || !f.id ? {} : { id: f.id }), name: f.name, amount_cents: f.amount_cents || 0 })),
    waivers: {
      tax: waiver(p.taxWaived, p.taxWaiveReason), travel: waiver(p.travelFeeWaived, p.travelFeeWaiveReason), surface: waiver(p.surfaceFeeWaived, p.surfaceFeeWaiveReason),
      generator: waiver(p.generatorFeeWaived, p.generatorFeeWaiveReason), same_day_pickup: waiver(p.sameDayPickupFeeWaived, p.sameDayPickupFeeWaiveReason),
      same_day_weekday_delivery: waiver(p.sameDayWeekdayDeliveryFeeWaived, p.sameDayWeekdayDeliveryFeeWaiveReason),
    },
    customDepositCents: p.customDepositCents,
    customSetupFeeCents: p.customSetupFeeCents,
    adminMessage: p.adminMessage,
    adminOverrideApproval: p.adminOverrideApproval,
    depositCatchupMode: p.depositCatchupMode,
    requireCardOnFile: p.requireCardOnFile,
    parks: { required: p.parksAcknowledgmentRequired, county: p.parksAcknowledgmentCounty ?? undefined },
  };
}

export async function saveOrderChanges(params: SaveOrderChangesParams): Promise<void> {
  const { order, availabilityIssues, sendNotificationsFn, onComplete } = params;
  if (availabilityIssues.length > 0) {
    const unitNames = availabilityIssues.map(issue => issue.unitName).join(', ');
    showToast(`Cannot save: The following units are not available for the selected dates: ${unitNames}. Please adjust the dates or remove the conflicting items.`, 'error');
    throw new Error('Availability conflict');
  }

  if (params.sameDayWeekdayDeliveryFeeWaived && !params.sameDayWeekdayDeliveryFeeWaiveReason?.trim()) {
    showToast('A reason is required to waive the Same-Day Weekday Delivery Fee.', 'error');
    throw new Error('Same-Day Weekday Delivery Fee waiver reason required');
  }

  let result: SaveResponse;
  try {
    result = await callStaffOrderSave<SaveResponse>('save_changes', buildSaveRequest(params));
  } catch (error) {
    if (error instanceof StaffOrderSaveError) {
      showToast(error.code === 'STALE_ORDER' ? error.message : `Failed to save changes: ${error.message}`, 'error');
      throw new Error(error.message);
    }
    throw error;
  }

  const { hasTrackedChanges, hasCustomerVisibleChanges, preserveCurrentStatus } = result;
  const adminOverrideApproval = result.adminOverrideApproval === true;

  if (result.saved) {
    const oldStatus = order.status;

    if (!preserveCurrentStatus && adminOverrideApproval) {
      try {
        const { enterConfirmed } = await import('./orderLifecycleApi');
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

    // Best-effort broadcast AFTER all writes complete - warning-only
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
