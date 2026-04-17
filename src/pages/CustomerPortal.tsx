import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ORDER_STATUS } from '../lib/constants/statuses';
import { useOrderData } from '../hooks/useOrderData';
import { InvoiceAcceptanceView } from '../components/customer-portal/InvoiceAcceptanceView';
import { OrderApprovalView } from '../components/customer-portal/OrderApprovalView';
import { ApprovalSuccessView } from '../components/customer-portal/ApprovalSuccessView';
import { OrderStatusView } from '../components/customer-portal/OrderStatusView';
import { RegularPortalView } from '../components/customer-portal/RegularPortalView';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { showToast } from '../lib/notifications';
import { trackEvent } from '../lib/siteEvents';

export function CustomerPortal() {
  const { orderId, token } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    trackEvent('customer_portal_viewed', { orderId: orderId || undefined });
  }, [orderId]);

  const tokenFromQuery = searchParams.get('t');
  const isInvoiceLink = !!(tokenFromQuery || location.pathname.startsWith('/invoice/'));
  const invoiceToken = tokenFromQuery || (location.pathname.startsWith('/invoice/') ? token : null);

  const cardJustUpdated = searchParams.get('card_updated') === 'true';
  const invoiceCardSaved = searchParams.get('invoice_card_saved') === 'true';
  const returnSessionId = searchParams.get('session_id') || null;
  const paymentSuccess = searchParams.get('payment') === 'success';
  const invoicePaid = searchParams.get('invoice_paid') === 'true';

  const restoredPaymentState = cardJustUpdated ? {
    paymentAmount: (searchParams.get('pa') || 'deposit') as 'deposit' | 'full' | 'custom',
    customPaymentAmount: searchParams.get('cpa') || '',
    newTipCents: searchParams.get('tip') ? parseInt(searchParams.get('tip')!) : undefined,
    keepOriginalPayment: searchParams.get('kop') !== '0',
    selectedPaymentBaseCents: searchParams.get('spb') ? parseInt(searchParams.get('spb')!) : undefined,
  } : undefined;

  const [approvalSuccess, setApprovalSuccess] = useState(invoicePaid);
  const [approvalProcessing, setApprovalProcessing] = useState(false);
  const [invoiceProcessing, setInvoiceProcessing] = useState(false);

  const { data, loading, loadOrder } = useOrderData();

  const resolvedOrderId = orderId || (data?.order?.id);

  const realtimeOrderId = resolvedOrderId;
  const approvalSuccessRef = useRef(false);
  approvalSuccessRef.current = approvalSuccess || approvalProcessing;

  const reloadRef = useRef<() => Promise<void>>();
  const isReloadingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  reloadRef.current = async () => {
    if (approvalSuccessRef.current) return;
    if (isReloadingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    isReloadingRef.current = true;
    pendingRefreshRef.current = false;
    try {
      await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
    } finally {
      isReloadingRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        reloadRef.current?.();
      }
    }
  };

  useEffect(() => {
    if (!realtimeOrderId) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { reloadRef.current?.(); }, 600);
    };

    const channel = supabase
      .channel(`portal-order-${realtimeOrderId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${realtimeOrderId}` }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `order_id=eq.${realtimeOrderId}` }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_signatures', filter: `order_id=eq.${realtimeOrderId}` }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_status', filter: `order_id=eq.${realtimeOrderId}` }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_lot_pictures', filter: `order_id=eq.${realtimeOrderId}` }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_pictures', filter: `order_id=eq.${realtimeOrderId}` }, debouncedReload)
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [realtimeOrderId]);

  useEffect(() => {
    if (paymentSuccess && returnSessionId && orderId) {
      // Path B balance payment: actively reconcile with Stripe before showing the portal.
      // This is durable — even if the webhook hasn't fired yet, the portal will be correct.
      (async () => {
        try {
          const { data: reconcileData, error: reconcileError } = await supabase.functions.invoke('reconcile-balance-payment', {
            body: { sessionId: returnSessionId, orderId },
          });
          if (reconcileError) {
            console.error('[CustomerPortal] reconcile-balance-payment transport error:', reconcileError.message ?? 'unknown');
          } else if (reconcileData?.reason === 'payment_not_complete') {
            console.warn('[CustomerPortal] reconcile-balance-payment: payment not yet complete, portal will rely on webhook');
          } else if (reconcileData?.error) {
            console.error('[CustomerPortal] reconcile-balance-payment returned error:', reconcileData.error);
          }
        } catch (err) {
          console.error('[CustomerPortal] reconcile-balance-payment threw:', err instanceof Error ? err.message : 'unknown');
        }
        await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
      })();
    } else if (invoiceCardSaved && returnSessionId && orderId) {
      setInvoiceProcessing(true);
      (async () => {
        try {
          const { data: pmData, error: pmError } = await supabase.functions.invoke('save-payment-method-from-session', {
            body: { sessionId: returnSessionId, orderId },
          });
          if (pmError || !pmData?.success) {
            console.error('[CustomerPortal] invoice save-pm failed.');
            showToast('Failed to save payment method. Please try again.', 'error');
            setInvoiceProcessing(false);
            await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
            return;
          }

          // The webhook handles status transition to confirmed for admin invoices.
          // As a client-side fallback only (webhook may not have fired yet), call
          // order-lifecycle directly with the anon key — no admin session required.
          const orderResult = await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
          const currentStatus = orderResult?.order?.status;
          const depositDue = orderResult?.order?.deposit_due_cents ?? 0;
          const depositPaid = orderResult?.order?.deposit_paid_cents ?? 0;

          if (currentStatus !== ORDER_STATUS.CONFIRMED && currentStatus !== ORDER_STATUS.CANCELLED && currentStatus !== ORDER_STATUS.VOID) {
            if (depositDue > 0 && depositPaid < depositDue) {
              // Card was saved but deposit_due_cents > 0 — charge the actual amount now.
              // deposit_due_cents is the authoritative value: it already reflects any admin
              // overrides (zero-out, partial, or full-payment overrides are encoded there).
              try {
                const { data: chargeData, error: chargeErr } = await supabase.functions.invoke('charge-deposit', {
                  body: { orderId },
                });
                if (chargeErr || !chargeData?.success) {
                  console.error('[CustomerPortal] charge-deposit failed:', chargeErr?.message ?? chargeData?.error ?? 'unknown');
                  showToast('Payment could not be processed. Please try again or contact us.', 'error');
                  setInvoiceProcessing(false);
                  await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
                  return;
                }
              } catch (chargeEx) {
                console.error('[CustomerPortal] charge-deposit threw:', chargeEx instanceof Error ? chargeEx.message : 'unknown');
                showToast('Payment could not be processed. Please try again or contact us.', 'error');
                setInvoiceProcessing(false);
                await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
                return;
              }
            } else {
              // Genuinely zero deposit (deposit_due_cents === 0): card saved for future
              // balance collection only. Safe to confirm without any charge.
              try {
                await supabase.functions.invoke('order-lifecycle', {
                  body: { action: 'enter_confirmed', orderId, source: 'invoice_card_saved_fallback', paymentOutcome: 'zero_due_with_card' },
                });
              } catch (lifecycleErr) {
                console.error('[CustomerPortal] order-lifecycle fallback failed (non-fatal):', lifecycleErr instanceof Error ? lifecycleErr.message : 'unknown');
              }
            }
            await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
          }

          setInvoiceProcessing(false);
          setApprovalSuccess(true);
        } catch (err: any) {
          console.error('[CustomerPortal] invoice card-saved error:', err instanceof Error ? err.message : 'unknown');
          showToast('Something went wrong. Please contact us.', 'error');
          setInvoiceProcessing(false);
          await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
        }
      })();
    } else if (cardJustUpdated && returnSessionId && orderId) {
      (async () => {
        try {
          const { data: pmData, error: pmError } = await supabase.functions.invoke('save-payment-method-from-session', {
            body: { sessionId: returnSessionId, orderId },
          });
          if (pmError) {
            // BPC-SECURITY-HARDENING: raw pmError removed — could expose payment service internals in browser console.
            console.error('[CustomerPortal] save-payment-method-from-session invocation error.');
          } else if (!pmData?.success) {
            // BPC-SECURITY-HARDENING: raw pmData?.error removed — could expose payment API response internals.
            console.error('[CustomerPortal] save-payment-method-from-session returned failure.');
          }
        } catch (err) {
          // BPC-SECURITY-HARDENING: raw error removed — could expose payment API internals in browser console.
          console.error('[CustomerPortal] save-payment-method-from-session threw unexpectedly:', err instanceof Error ? err.message : 'unknown');
        }
        await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
      })();
    } else {
      loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
    }
  }, [orderId, token, isInvoiceLink, loadOrder]);

  const handleReload = async () => {
    await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
  };

  if (approvalSuccess) {
    return <ApprovalSuccessView orderId={resolvedOrderId ?? orderId!} />;
  }

  if (loading || invoiceProcessing || approvalProcessing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!data?.order) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="text-center bg-white rounded-2xl shadow-2xl p-10 max-w-md border-2 border-slate-100">
          <div className="w-20 h-20 bg-gradient-to-br from-red-400 to-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
            <AlertCircle className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">Order Not Found</h1>
          <p className="text-lg text-slate-600">The order you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  const { order, changelog, orderItems, discounts, customFees, invoiceLink, orderSummary } = data;

  const needsApproval = order.status === ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL;
  const isDraft = order.status === ORDER_STATUS.DRAFT;
  const isActive = ([ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED, ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.COMPLETED] as string[]).includes(order.status);

  const shouldShowRegularPortal = isActive;


  if (!shouldShowRegularPortal && !needsApproval) {
    if (isDraft) {
      return (
        <InvoiceAcceptanceView
          order={order}
          orderItems={orderItems}
          discounts={discounts}
          customFees={customFees}
          invoiceLink={invoiceLink}
          orderSummary={orderSummary}
          onReload={handleReload}
          onApprovalSuccess={() => setApprovalSuccess(true)}
        />
      );
    }
    return <OrderStatusView order={order} />;
  }

  if (needsApproval) {
    return (
      <OrderApprovalView
        order={order}
        changelog={changelog}
        orderSummary={orderSummary}
        autoOpenApprovalModal={cardJustUpdated}
        restoredPaymentState={restoredPaymentState}
        onApprovalProcessingStart={() => setApprovalProcessing(true)}
        onApprovalProcessingCancel={() => setApprovalProcessing(false)}
        onApprovalSuccess={() => {
          setApprovalProcessing(false);
          setApprovalSuccess(true);
        }}
        onRejectionSuccess={handleReload}
      />
    );
  }

  return (
    <RegularPortalView
      order={order}
      orderId={resolvedOrderId ?? orderId!}
      orderItems={orderItems}
      orderSummary={orderSummary}
      invoiceLinkToken={invoiceToken}
      onReload={handleReload}
    />
  );
}
