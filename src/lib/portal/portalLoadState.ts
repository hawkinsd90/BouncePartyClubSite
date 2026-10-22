// WP-08 (B6): what the Customer Portal shows while and after it loads an order. Pure, so the whole table is testable.
//
// Rules the screen follows:
//  - the full-page spinner shows only while there is nothing to show yet; a reload after a payment, a cancel or an invoice
//    action keeps the current view in place instead of blanking it;
//  - "secure access required" is shown only when the server said so for a load the customer asked for; a background refresh that
//    gets a 403 keeps the view and says the refresh failed;
//  - any other failure with nothing loaded is a load error with a Retry (never "Order Not Found"); a failed refresh with the
//    view already loaded keeps the view and shows a small notice.
import type { PortalLoadOutcome } from './portalOrderLoader';

export interface PortalLoadState {
  hasData: boolean;
  loading: boolean;
  accessRequired: boolean;
  // The first load (or a customer-requested reload with nothing on screen) failed for a reason other than access.
  loadError: boolean;
  // A refresh failed while the view is already on screen (offline, server error, expired link).
  refreshFailed: boolean;
}

export const INITIAL_PORTAL_LOAD_STATE: PortalLoadState = { hasData: false, loading: true, accessRequired: false, loadError: false, refreshFailed: false };

export type PortalLoadEvent =
  | { type: 'start'; silent: boolean }
  | { type: 'outcome'; silent: boolean; kind: PortalLoadOutcome['kind'] }
  | { type: 'no_order_id'; silent: boolean };

export function portalLoadReducer(state: PortalLoadState, event: PortalLoadEvent): PortalLoadState {
  switch (event.type) {
    case 'start':
      if (event.silent) return state;
      // Nothing on screen yet: spinner. Something on screen: keep it.
      return { ...state, loading: !state.hasData, loadError: false };
    case 'no_order_id':
      return event.silent ? state : { ...state, loading: false };
    case 'outcome': {
      switch (event.kind) {
        case 'ok':
          return { hasData: true, loading: false, accessRequired: false, loadError: false, refreshFailed: false };
        case 'unchanged':
          return { ...state, refreshFailed: false };
        case 'access_required':
          // A background poll must never swap a working screen for the access page.
          if (event.silent && state.hasData) return { ...state, refreshFailed: true };
          return { hasData: false, loading: false, accessRequired: true, loadError: false, refreshFailed: false };
        default:
          if (state.hasData) return { ...state, loading: false, refreshFailed: true };
          return { ...state, loading: false, loadError: true };
      }
    }
    default:
      return state;
  }
}
