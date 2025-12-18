import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
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
