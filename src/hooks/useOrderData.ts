import { useState, useCallback, useRef } from 'react';
import { loadPortalOrder, type OrderData } from '../lib/portalOrderLoader';

export type { OrderData } from '../lib/portalOrderLoader';

// Customer Portal data comes from the customer-portal-data Edge Function: the server proves the visitor holds a valid
// order-bound token or owns the order and returns a fixed projection. The browser never reads the order tables itself.
export function useOrderData() {
  const [data, setData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  // True when the server said "secure access required" (no valid token, not the owner, expired or revoked link).
  const [accessRequired, setAccessRequired] = useState(false);
  const lastSignatureRef = useRef<string>('');

  const loadOrder = useCallback(
    async (
      orderId: string | undefined,
      token: string | undefined,
      _isInvoiceLink?: boolean,
      options: { silent?: boolean } = {},
    ) => {
      const silent = !!options.silent;
      if (!silent) setLoading(true);
      if (!orderId) {
        console.error('No order ID provided');
        if (!silent) setLoading(false);
        return null;
      }

      const outcome = await loadPortalOrder(orderId, token ?? null, {
        silent,
        previousSignature: lastSignatureRef.current,
      });

      switch (outcome.kind) {
        case 'ok':
          lastSignatureRef.current = outcome.signature;
          setAccessRequired(false);
          setData(outcome.result);
          setLoading(false);
          return outcome.result;
        case 'unchanged':
          return null;
        case 'access_required':
          lastSignatureRef.current = '';
          setAccessRequired(true);
          setData(null);
          setLoading(false);
          return null;
        default:
          if (!silent) setLoading(false);
          return null;
      }
    },
    [],
  );

  return { data, loading, loadOrder, setData, accessRequired };
}
