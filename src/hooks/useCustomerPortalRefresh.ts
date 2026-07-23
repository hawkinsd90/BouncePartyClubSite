import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface UseCustomerPortalRefreshOptions {
  orderId: string | undefined;
  reload: () => Promise<void>;
  isApprovalSuccess: boolean;
  suppressRefreshRef?: React.MutableRefObject<boolean>;
}

const DEBOUNCE_MS = 800;
const DEDUP_WINDOW_MS = 3_000;

export function useCustomerPortalRefresh({
  orderId,
  reload,
  isApprovalSuccess,
  suppressRefreshRef,
}: UseCustomerPortalRefreshOptions) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const isReloadingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const approvalSuccessRef = useRef(isApprovalSuccess);
  approvalSuccessRef.current = isApprovalSuccess;
  const lastReloadAtRef = useRef(0);

  const doReload = useCallback(async () => {
    if (approvalSuccessRef.current) return;
    if (suppressRefreshRef?.current) return;

    const now = Date.now();
    if (now - lastReloadAtRef.current < DEDUP_WINDOW_MS) return;

    if (isReloadingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    isReloadingRef.current = true;
    pendingRefreshRef.current = false;
    lastReloadAtRef.current = Date.now();
    try {
      await reloadRef.current();
    } catch (err) {
      console.error('[useCustomerPortalRefresh] reload failed:', err);
    } finally {
      isReloadingRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        doReload();
      }
    }
  }, [suppressRefreshRef]);

  useEffect(() => {
    if (!orderId) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const debouncedReload = () => {
      if (suppressRefreshRef?.current) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => doReload(), DEBOUNCE_MS);
    };

    // Subscribe to realtime postgres changes for this order only.
    // Deduplicate bursts into one debounced background refresh.
    const channel = supabase
      .channel(`portal-order-${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items', filter: `order_id=eq.${orderId}` }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `order_id=eq.${orderId}` }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_lot_pictures', filter: `order_id=eq.${orderId}` }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_pictures', filter: `order_id=eq.${orderId}` }, debouncedReload)
      .subscribe();

    // Conservative fallback: only refresh when the tab becomes visible after
    // being hidden for at least 30 seconds. This avoids rapid refresh loops.
    let hiddenAt: number | null = null;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenAt !== null) {
        const hiddenDuration = Date.now() - hiddenAt;
        hiddenAt = null;
        if (hiddenDuration >= 30_000 && !approvalSuccessRef.current) {
          doReload();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [orderId, doReload, suppressRefreshRef]);

  return { doReload };
}
