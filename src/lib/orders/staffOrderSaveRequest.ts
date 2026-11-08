import { showConfirm, showToast } from '../toasts';
import { END_BEFORE_START_MESSAGE, eventWindowProblem, normalizeTime } from '../core/eventTimeWindow';
import { editNeedsEndWindowExceptionConfirmation, endWindowExceptionMessage } from '../core/endWindowExceptions';
import { hasActiveInflatable, surfaceChoiceProblem } from './surfaceChoice';
import { notifyPortalRefresh } from '../portal/customerPortalRefreshSignal';
import { callStaffOrderSave, StaffOrderSaveError } from './staffOrderSaveApi';
import type { OrderPricingState } from '../pricing/orderPricingState';

// An Admin Edit save. The browser describes what the Admin changed; the SERVER prices it and writes it (staff-order-save). The
// totals the editor showed were a preview: nothing the browser calculated is sent as, or accepted as, a price.
// The parts of the editor's state this module reads. They are described by what is read here; the editor's own types satisfy them.
interface SavedOrderRef {
  id: string;
  status: string;
  // The stored event date and time window, when the caller has them: an end-before-start window already stored is only refused when this save changes it.
  event_date?: unknown;
  event_end_date?: unknown;
  start_window?: unknown;
  end_window?: unknown;
  // The stored rental type, used to tell whether this save changes it (an after-19:00 exception is asked about only when it is new).
  location_type?: unknown;
  pickup_preference?: unknown;
}
interface EditedOrderFields {
  location_type?: unknown;
  surface?: string | null;
  generator_qty?: unknown;
  start_window?: unknown;
  end_window?: unknown;
  event_date?: unknown;
  event_end_date?: unknown;
  pickup_preference?: unknown;
  address_line1?: unknown;
  address_line2?: unknown;
  address_city?: unknown;
  address_state?: unknown;
  address_zip?: unknown;
  address_lat?: unknown;
  address_lng?: unknown;
}
interface StagedItemFields {
  id?: string;
  unit_id?: string | null;
  bundle_id?: string | null;
  product_id?: string | null;
  qty: number;
  wet_or_dry?: string | null;
  is_new?: boolean;
  is_deleted?: boolean;
  is_updated?: boolean;
}
interface DiscountFields {
  id?: string;
  name: string;
  amount_cents?: number | null;
  percentage?: number | string | null;
  is_new?: boolean;
}
interface CustomFeeFields {
  id?: string;
  name: string;
  amount_cents?: number | null;
  is_new?: boolean;
}

interface SaveOrderChangesParams {
  order: SavedOrderRef;
  editedOrder: EditedOrderFields;
  stagedItems: StagedItemFields[];
  discounts: DiscountFields[];
  customFees: CustomFeeFields[];
  // The editor's own preview, used only for the one measured number the server needs (the driving distance) and never as a price.
  calculatedPricing: unknown;
  // What the editor loaded: the order, its items, discounts and custom fees as stored. If the stored order has moved since, the
  // server refuses the save.
  loadedPricingState: OrderPricingState;
  customDepositCents: number | null;
  customSetupFeeCents: number | null;
  adminMessage: string;
  adminOverrideApproval: boolean;
  availabilityIssues: Array<{ unitName?: string }>;
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
  // Admin / Master explicitly confirmed an end time after 19:00 on a same-day or commercial rental (D5). Set by saveOrderChanges after the
  // warning; the server honours it only for Admin / Master and refuses the save otherwise.
  endWindowExceptionConfirmed?: boolean;
  // Asks before the save is sent; resolves true to keep the exception. Defaults to the app's confirm dialog. Declining saves nothing.
  confirmEndWindowException?: (message: string) => Promise<boolean>;
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

// Thrown when the Admin declines a confirmation prompt (the after-19:00 exception): nothing was sent or saved. It is a neutral cancel, not a
// failure; the editor stays open with its edits intact and must not show "Failed to save changes".
export class SaveCancelledError extends Error {
  constructor(message = 'No changes were saved.') {
    super(message);
    this.name = 'SaveCancelledError';
  }
}

const kindOf = (item: StagedItemFields): 'inflatable' | 'product' | 'bundle' => (item.unit_id ? 'inflatable' : item.bundle_id ? 'bundle' : 'product');

// What the staged items say the Admin did, without a price: stored lines are referenced by id (the server keeps their stored price),
// new lines by what was added (the server prices them from the catalog).
export function buildItemIntents(stagedItems: StagedItemFields[]) {
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
    ...(p.endWindowExceptionConfirmed === true ? { endWindowExceptionConfirmed: true } : {}),
    parks: { required: p.parksAcknowledgmentRequired, county: p.parksAcknowledgmentCounty ?? undefined },
  };
}

// The message for an Edit Order save whose event times cannot be saved, or null. A blank or half-chosen time always needs a choice (the server
// refuses it); an end-before-start window is refused only when this save changes the times or dates, so an unrelated edit of an order that
// already stores such a window (F-48 legacy rows) is not blocked.
export function editOrderWindowProblem(order: SavedOrderRef, edited: EditedOrderFields): string | null {
  const problem = eventWindowProblem(edited, { requireTimes: true });
  if (!problem) return null;
  if (problem !== END_BEFORE_START_MESSAGE) return problem;
  const minutes = (v: unknown) => normalizeTime(v);
  const dateOf = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '');
  const unchanged =
    minutes(edited.start_window) === minutes(order.start_window) &&
    minutes(edited.end_window) === minutes(order.end_window) &&
    dateOf(edited.event_date) === dateOf(order.event_date) &&
    (dateOf(edited.event_end_date) || dateOf(edited.event_date)) === (dateOf(order.event_end_date) || dateOf(order.event_date));
  return unchanged ? null : problem;
}

export async function saveOrderChanges(params: SaveOrderChangesParams): Promise<void> {
  const { order, availabilityIssues, sendNotificationsFn, onComplete } = params;
  const windowProblem = editOrderWindowProblem(order, params.editedOrder);
  // Thrown with the plain message: the editor's own catch shows it ("Failed to save changes: ..."), so it is not toasted twice.
  if (windowProblem) throw new Error(windowProblem);
  // Adding the first inflatable to an Event Essentials-only order must not silently pick grass: the surface has to be chosen.
  const surfaceProblem = surfaceChoiceProblem({ hasInflatables: hasActiveInflatable(params.stagedItems), surface: params.editedOrder.surface });
  if (surfaceProblem) {
    showToast(surfaceProblem, 'error');
    throw new Error('Surface not chosen');
  }
  if (availabilityIssues.length > 0) {
    const unitNames = availabilityIssues.map(issue => issue.unitName).join(', ');
    showToast(`Cannot save: The following units are not available for the selected dates: ${unitNames}. Please adjust the dates or remove the conflicting items.`, 'error');
    throw new Error('Availability conflict');
  }

  if (params.sameDayWeekdayDeliveryFeeWaived && !params.sameDayWeekdayDeliveryFeeWaiveReason?.trim()) {
    showToast('A reason is required to waive the Same-Day Delivery Fee.', 'error');
    throw new Error('Same-Day Delivery Fee waiver reason required');
  }

  // D5 (WP-P2-25): an end time after 19:00 on a same-day or commercial rental is an Admin / Master exception. Warn BEFORE anything is sent; a
  // decline throws before the request, so nothing is saved. (This screen is Admin only and the server re-checks the role and the flag.)
  let endWindowExceptionConfirmed = false;
  if (editNeedsEndWindowExceptionConfirmation(order, { location_type: params.editedOrder.location_type as string, pickup_preference: params.editedOrder.pickup_preference as string, end_window: params.editedOrder.end_window })) {
    const keep = await (params.confirmEndWindowException ?? ((message: string) => showConfirm(message, { confirmText: 'Keep this end time', cancelText: 'Go back', type: 'warning' })))(
      endWindowExceptionMessage(String(params.editedOrder.end_window).slice(0, 5))
    );
    if (!keep) throw new SaveCancelledError('End time exception declined: nothing was saved.');
    endWindowExceptionConfirmed = true;
  }

  let result: SaveResponse;
  try {
    result = await callStaffOrderSave<SaveResponse>('save_changes', buildSaveRequest({ ...params, endWindowExceptionConfirmed }));
  } catch (error) {
    if (error instanceof StaffOrderSaveError) {
      // A blocked Force Approve (stock refusal from the server): show the server's equipment message as is, and end quietly like the
      // client-side availability check does (the editor stays open, nothing is toasted twice).
      if (error.code === 'AVAILABILITY_CONFLICT' || error.code === 'AVAILABILITY_UNVERIFIABLE') {
        showToast(error.message, 'error', { duration: 12000 });
        throw new Error('Availability conflict');
      }
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
