// Pure model helpers for the Order Detail modal's editable order state.
//
// buildInitialEditedOrder constructs the editable state from the stored order;
// hasOrderDetailChanges compares that state (plus staged items) back to the
// stored order. They are two sides of the same local model. React state, the
// hasChanges effect, its dependency array and the manualDirty flag all stay in
// OrderDetailModal.
//
// Moved verbatim from OrderDetailModal, including its quirks:
// - Dates are normalized to date-only when building, but compared against the
//   RAW stored dates, so an order whose stored dates contain a timestamp
//   compares as changed immediately.
// - Only the fields listed below are compared. can_stake, address lat/lng/county,
//   Parks, fee waivers and overrides are deliberately not part of this check.
//
// Its only import is the pure eventAddress helper, so it can still be loaded from Node-based tests.

import { eventAddressLine2 } from '../../../lib/booking/eventAddress';

// Only the stored order fields these helpers read.
export interface EditableOrderSource {
  location_type?: string | null;
  surface?: string | null;
  generator_qty?: number | null;
  start_window?: string | null;
  end_window?: string | null;
  event_date?: string | null;
  event_end_date?: string | null;
  // This order's own delivery unit (NULL = legacy order, falls back to addresses.line2).
  event_address_line2?: string | null;
  addresses?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
  pickup_preference?: string | null;
}

export interface EditedOrderState {
  location_type: string | null | undefined;
  surface: string | null | undefined;
  can_stake: boolean;
  generator_qty: number;
  start_window: string | null | undefined;
  end_window: string | null | undefined;
  event_date: string | null | undefined;
  event_end_date: string | null | undefined;
  address_line1: string;
  address_line2: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  pickup_preference: string;
}

// The only staged-item fields the dirty check reads.
export interface StagedItemChangeFlags {
  is_new?: boolean;
  is_deleted?: boolean;
  is_updated?: boolean;
}

export function buildInitialEditedOrder(order: EditableOrderSource): EditedOrderState {
  return {
    location_type: order.location_type,
    surface: order.surface,
    can_stake: order.surface === 'grass',
    generator_qty: order.generator_qty || 0,
    start_window: order.start_window,
    end_window: order.end_window,
    event_date: order.event_date?.split('T')[0] || order.event_date,
    event_end_date: (order.event_end_date || order.event_date)?.split('T')[0] || order.event_date,
    address_line1: order.addresses?.line1 || '',
    address_line2: eventAddressLine2(order),
    address_city: order.addresses?.city || '',
    address_state: order.addresses?.state || '',
    address_zip: order.addresses?.zip || '',
    pickup_preference: order.pickup_preference || 'next_day',
  };
}

export function hasOrderDetailChanges(
  editedOrder: EditedOrderState,
  order: EditableOrderSource,
  stagedItems: ReadonlyArray<StagedItemChangeFlags>,
): boolean {
  const orderChanged =
    editedOrder.location_type !== order.location_type ||
    editedOrder.surface !== order.surface ||
    editedOrder.generator_qty !== (order.generator_qty || 0) ||
    editedOrder.start_window !== order.start_window ||
    editedOrder.end_window !== order.end_window ||
    editedOrder.event_date !== order.event_date ||
    editedOrder.event_end_date !== (order.event_end_date || order.event_date) ||
    editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
    editedOrder.address_line2 !== eventAddressLine2(order) ||
    editedOrder.address_city !== (order.addresses?.city || '') ||
    editedOrder.address_state !== (order.addresses?.state || '') ||
    editedOrder.address_zip !== (order.addresses?.zip || '') ||
    editedOrder.pickup_preference !== (order.pickup_preference || 'next_day');

  const itemsChanged = stagedItems.some(item => item.is_new || item.is_deleted || item.is_updated);

  return orderChanged || itemsChanged;
}
