import { useEffect, useRef, useCallback } from 'react';

interface UseCustomerPortalRefreshOptions {
  orderId: string | undefined;
  reload: () => Promise<void>;
  isApprovalSuccess: boolean;
  onRefreshComplete: () => void;
}

const POLL_INTERVAL_MS = 15_000;
const DEBOUNCE_MS = 600;

export function useCustomerPortalRefresh({
  orderId,
  reload,
  isApprovalSuccess,
  onRefreshComplete,
}: UseCustomerPortalRefreshOptions) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const isReloadingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const approvalSuccessRef = useRef(isApprovalSuccess);
  approvalSuccessRef.current = isApprovalSuccess;

  const doReload = useCallback(async () => {
    if (approvalSuccessRef.current) return;
    if (isReloadingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    isReloadingRef.current = true;
    pendingRefreshRef.current = false;
    try {
      await reloadRef.current();
      onRefreshComplete();
    } catch (err) {
      console.error('[useCustomerPortalRefresh] reload failed:', err);
    } finally {
      isReloadingRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        doReload();
      }
    }
  }, [onRefreshComplete]);

  useEffect(() => {
    if (!orderId) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const debouncedReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => doReload(), DEBOUNCE_MS);
    };

    // Best-effort broadcast listener
    const channel = supabase
      .channel(`portal-order-${orderId}`)
      .on('broadcast', { event: 'order_updated' }, debouncedReload)
      .subscribe();

    // Visibility change — refresh when page becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !approvalSuccessRef.current) {
        doReload();
      }
    };

    // Window focus — refresh on refocus
    const handleFocus = () => {
      if (!approvalSuccessRef.current) doReload();
    };

    // Online event — refresh when network restores
    const handleOnline = () => {
      if (!approvalSuccessRef.current) doReload();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    // Light polling — only while visible, not loading, not in approval-success
    const startPolling = () => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = setTimeout(async () => {
        if (
          document.visibilityState === 'visible' &&
          !approvalSuccessRef.current &&
          !isReloadingRef.current
        ) {
          await doReload();
        }
        if (document.visibilityState === 'visible' && !approvalSuccessRef.current) {
          startPolling();
        }
      }, POLL_INTERVAL_MS);
    };

    const handlePollVisibility = () => {
      if (document.visibilityState === 'visible' && !approvalSuccessRef.current) {
        startPolling();
      } else if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    document.addEventListener('visibilitychange', handlePollVisibility);
    startPolling();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (pollTimer) clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handlePollVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      supabase.removeChannel(channel);
    };
  }, [orderId, doReload]);

  return { doReload };
}

// Import supabase at the bottom to avoid circular deps in some setups
import { supabase } from '../lib/supabase';
