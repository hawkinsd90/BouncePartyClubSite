import { useState, useEffect } from 'react';
import { useParams, useLocation, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useOrderData } from '../hooks/useOrderData';
import { InvoiceAcceptanceView } from '../components/customer-portal/InvoiceAcceptanceView';
import { OrderApprovalView } from '../components/customer-portal/OrderApprovalView';
import { ApprovalSuccessView } from '../components/customer-portal/ApprovalSuccessView';
import { OrderStatusView } from '../components/customer-portal/OrderStatusView';
import { RegularPortalView } from '../components/customer-portal/RegularPortalView';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

export function CustomerPortal() {
  const { orderId, token } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isInvoiceLink = location.pathname.startsWith('/invoice/');
  const cardJustUpdated = searchParams.get('card_updated') === 'true';
  const restoredPaymentState = cardJustUpdated ? {
    paymentAmount: (searchParams.get('pa') || 'deposit') as 'deposit' | 'full' | 'custom',
    customPaymentAmount: searchParams.get('cpa') || '',
    newTipCents: searchParams.get('tip') ? parseInt(searchParams.get('tip')!) : undefined,
    keepOriginalPayment: searchParams.get('kop') !== '0',
    selectedPaymentBaseCents: searchParams.get('spb') ? parseInt(searchParams.get('spb')!) : undefined,
  } : undefined;
  const [approvalSuccess, setApprovalSuccess] = useState(false);

  const { data, loading, loadOrder } = useOrderData();

  useEffect(() => {
    loadOrder(orderId, token, isInvoiceLink);
  }, [orderId, token, isInvoiceLink, loadOrder]);

  const handleReload = async () => {
    await loadOrder(orderId, token, isInvoiceLink);
  };

  if (loading) {
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

  // If accessed via /customer-portal/:orderId (not /invoice/:token), treat as active even if draft
  // This handles the case where payment just completed but webhook hasn't updated status yet
  const isDirectPortalAccess = !isInvoiceLink && orderId;
  const shouldShowRegularPortal = isActive || (isDirectPortalAccess && isDraft);

  if (approvalSuccess) {
    return <ApprovalSuccessView orderId={order.id} />;
  }

  if (!shouldShowRegularPortal && !needsApproval) {
    if (isDraft && isInvoiceLink) {
      return (
        <InvoiceAcceptanceView
          order={order}
          orderItems={orderItems}
          discounts={discounts}
          customFees={customFees}
          invoiceLink={invoiceLink}
          orderSummary={orderSummary}
          onReload={handleReload}
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
      orderId={orderId!}
      orderItems={orderItems}
      orderSummary={orderSummary}
      onReload={handleReload}
    />
  );
}
