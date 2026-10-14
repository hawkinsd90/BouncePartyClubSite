import { useEffect, useRef, useCallback } from 'react';
import { browserRefreshEnv, createPortalRefreshController, PortalRefreshController } from '../../lib/portal/portalRefreshController';

interface UseCustomerPortalRefreshOptions {
  orderId: string | undefined;
  reload: () => Promise<void>;
  isApprovalSuccess: boolean;
  suppressRefreshRef?: React.MutableRefObject<boolean>;
}

// Keeps the open portal current without any direct table or Realtime access: see lib/portalRefreshController.ts. The
// reload it triggers goes through the secure customer-portal-data endpoint.
export function useCustomerPortalRefresh({
  orderId,
  reload,
  isApprovalSuccess,
  suppressRefreshRef,
}: UseCustomerPortalRefreshOptions) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const approvalSuccessRef = useRef(isApprovalSuccess);
  approvalSuccessRef.current = isApprovalSuccess;
  const controllerRef = useRef<PortalRefreshController | null>(null);

  useEffect(() => {
    if (!orderId) return;
    const controller = createPortalRefreshController({
      reload: () => reloadRef.current(),
      isSuppressed: () => approvalSuccessRef.current || !!suppressRefreshRef?.current,
      env: browserRefreshEnv(),
    });
    controllerRef.current = controller;
    controller.start();
    return () => {
      controller.stop();
      controllerRef.current = null;
    };
  }, [orderId, suppressRefreshRef]);

  const doReload = useCallback(async () => {
    await controllerRef.current?.refreshNow();
  }, []);

  return { doReload };
}
