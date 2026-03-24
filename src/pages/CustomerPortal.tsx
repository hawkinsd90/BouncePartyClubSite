import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useOrderData } from '../hooks/useOrderData';
import { InvoiceAcceptanceView } from '../components/customer-portal/InvoiceAcceptanceView';
import { OrderApprovalView } from '../components/customer-portal/OrderApprovalView';
import { ApprovalSuccessView } from '../components/customer-portal/ApprovalSuccessView';
import { OrderStatusView } from '../components/customer-portal/OrderStatusView';
import { RegularPortalView } from '../components/customer-portal/RegularPortalView';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { approveOrder } from '../lib/orderApprovalService';
import { showToast } from '../lib/notifications';
import { trackEvent } from '../lib/siteEvents';

export function CustomerPortal() {
  const { orderId, token } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    trackEvent('customer_portal_viewed', { orderId: orderId || undefined });
  }, [orderId]);

  const isInvoiceLink = location.pathname.startsWith('/invoice/');
  const invoiceToken = isInvoiceLink ? token : null;

  const cardJustUpdated = searchParams.get('card_updated') === 'true';
  const invoiceCardSaved = searchParams.get('invoice_card_saved') === 'true';
  const returnSessionId = searchParams.get('session_id') || null;

  const restoredPaymentState = cardJustUpdated ? {
    paymentAmount: (searchParams.get('pa') || 'deposit') as 'deposit' | 'full' | 'custom',
    customPaymentAmount: searchParams.get('cpa') || '',
    newTipCents: searchParams.get('tip') ? parseInt(searchParams.get('tip')!) : undefined,
    keepOriginalPayment: searchParams.get('kop') !== '0',
    selectedPaymentBaseCents: searchParams.get('spb') ? parseInt(searchParams.get('spb')!) : undefined,
  } : undefined;

  const [approvalSuccess, setApprovalSuccess] = useState(false);
  const [invoiceProcessing, setInvoiceProcessing] = useState(false);

  const { data, loading, loadOrder } = useOrderData();

  const resolvedOrderId = orderId || (data?.order?.id);

  const realtimeOrderId = resolvedOrderId;
  const reloadRef = useRef<() => Promise<void>>();
  reloadRef.current = async () => {
    await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
  };

  useEffect(() => {
    if (!realtimeOrderId) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { reloadRef.current?.(); }, 400);
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
    if (invoiceCardSaved && returnSessionId && orderId) {
      setInvoiceProcessing(true);
      (async () => {
        try {
          const { data: pmData, error: pmError } = await supabase.functions.invoke('save-payment-method-from-session', {
            body: { sessionId: returnSessionId, orderId },
          });
          if (pmError || !pmData?.success) {
            // BPC-SECURITY-HARDENING: raw error object removed — could expose payment API internals in browser console.
            console.error('[CustomerPortal] invoice save-pm failed.');
            showToast('Failed to save payment method. Please try again.', 'error');
            setInvoiceProcessing(false);
            await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
            return;
          }

          const result = await approveOrder(orderId, async () => false);
          if (!result.success) {
            showToast(result.error || 'Payment failed. Please try again.', 'error');
            setInvoiceProcessing(false);
            await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
            return;
          }

          await loadOrder(orderId, invoiceToken ?? undefined, isInvoiceLink);
          setInvoiceProcessing(false);
          setApprovalSuccess(true);
        } catch (err: any) {
          // BPC-SECURITY-HARDENING: raw error object removed — could expose payment/approval internals in browser console.
          console.error('[CustomerPortal] invoice approval error:', err instanceof Error ? err.message : 'unknown');
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

  if (loading || invoiceProcessing) {
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

  const needsApproval = order.status === 'awaiting_customer_approval';
  const isDraft = order.status === 'draft';
  const isActive = ['pending_review', 'confirmed', 'in_progress', 'completed'].includes(order.status);

  const shouldShowRegularPortal = isActive;

  if (approvalSuccess) {
    return <ApprovalSuccessView orderId={order.id} />;
  }

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
        onApprovalSuccess={() => {
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
      onReload={handleReload}
    />
  );
}
