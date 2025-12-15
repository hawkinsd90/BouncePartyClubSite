import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useOrderData } from '../hooks/useOrderData';
import { InvoiceAcceptanceView } from '../components/customer-portal/InvoiceAcceptanceView';
import { OrderApprovalView } from '../components/customer-portal/OrderApprovalView';
import { ApprovalSuccessView } from '../components/customer-portal/ApprovalSuccessView';
import { OrderStatusView } from '../components/customer-portal/OrderStatusView';
import { RegularPortalView } from '../components/customer-portal/RegularPortalView';
import { LoadingSpinner } from '../components/LoadingSpinner';

export function CustomerPortal() {
  const { orderId, token } = useParams();
  const location = useLocation();
  const isInvoiceLink = location.pathname.startsWith('/invoice/');
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!data?.order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900">Order Not Found</h1>
          <p className="text-slate-600 mt-2">The order you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  const { order, changelog, orderItems, discounts, customFees, invoiceLink, orderSummary } = data;

  const needsApproval = order.status === 'awaiting_customer_approval';
  const isDraft = order.status === 'draft';
  const isActive = ['confirmed', 'in_progress', 'completed'].includes(order.status);

  if (approvalSuccess) {
    return <ApprovalSuccessView orderId={order.id} />;
  }

  if (!isActive && !needsApproval) {
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
        onApprovalSuccess={async () => {
          setApprovalSuccess(true);
          await handleReload();
        }}
        onRejectionSuccess={handleReload}
      />
    );
  }

  return <RegularPortalView order={order} orderId={orderId!} onReload={handleReload} />;
}
