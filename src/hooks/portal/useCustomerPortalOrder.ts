import { useState, useCallback, useRef, useReducer } from 'react';
import { loadPortalOrder, type OrderData } from '../../lib/portal/portalOrderLoader';
import { INITIAL_PORTAL_LOAD_STATE, portalLoadReducer } from '../../lib/portal/portalLoadState';

export type { OrderData } from '../../lib/portal/portalOrderLoader';

// Customer Portal data comes from the customer-portal-data Edge Function: the server proves the visitor holds a valid
// order-bound token or owns the order and returns a fixed projection. The browser never reads the order tables itself.
// What the screen shows while and after loading is decided by portalLoadReducer (see portalLoadState.ts).
export function useCustomerPortalOrder() {
  const [data, setData] = useState<OrderData | null>(null);
  const [state, dispatch] = useReducer(portalLoadReducer, INITIAL_PORTAL_LOAD_STATE);
  const lastSignatureRef = useRef<string>('');

  const loadOrder = useCallback(
    async (
      orderId: string | undefined,
      token: string | undefined,
      _isInvoiceLink?: boolean,
      options: { silent?: boolean } = {},
    ) => {
      const silent = !!options.silent;
      dispatch({ type: 'start', silent });
      if (!orderId) {
        console.error('No order ID provided');
        dispatch({ type: 'no_order_id', silent });
        return null;
      }

      const outcome = await loadPortalOrder(orderId, token ?? null, {
        silent,
        previousSignature: lastSignatureRef.current,
      });

      dispatch({ type: 'outcome', silent, kind: outcome.kind });

      switch (outcome.kind) {
        case 'ok':
          lastSignatureRef.current = outcome.signature;
          setData(outcome.result);
          return outcome.result;
        case 'unchanged':
          return null;
        case 'access_required':
          // A background poll that is refused keeps what is on screen (the reducer marks the refresh as failed).
          if (!silent) {
            lastSignatureRef.current = '';
            setData(null);
          }
          return null;
        default:
          return null;
      }
    },
    [],
  );

  return {
    data,
    // Full-page spinner: only while there is nothing to show yet.
    loading: state.loading,
    loadOrder,
    setData,
    // Secure access is needed to see this order (the server said so for a load the customer asked for).
    accessRequired: state.accessRequired,
    // The load failed for another reason and nothing is on screen: show a Retry, never "Order Not Found".
    loadError: state.loadError,
    // A refresh failed while the order is on screen: keep the view, show a small notice.
    refreshFailed: state.refreshFailed,
  };
}
