import { useState, useEffect } from 'react';
import { OrderDetailModal } from './OrderDetailModal';
import { OrderSummary } from './OrderSummary';
import { usePendingOrderData } from '../hooks/usePendingOrderData';
import { useSmsHandling } from '../hooks/useSmsHandling';
import { approveOrder, forceApproveOrder, rejectOrder } from '../lib/orderApprovalService';
import {
  generatePaymentLinkSmsMessage,
  generateTestSmsMessage,
} from '../lib/orderEmailTemplates';
import { OrderInfoSection } from './pending-order/OrderInfoSection';
import { SmsConversation } from './pending-order/SmsConversation';
import { PaymentManagementSection } from './pending-order/PaymentManagementSection';
import { StreetViewImages } from './pending-order/StreetViewImages';
import { ApprovalModal } from './pending-order/ApprovalModal';
import { RejectionModal } from './pending-order/RejectionModal';
import { PaymentLinkSection } from './pending-order/PaymentLinkSection';

export function PendingOrderCard({ order, onUpdate }: { order: any; onUpdate: () => void }) {
  const [processing, setProcessing] = useState(false);
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ url: string; label: string } | null>(null);

  const {
    smsConversations,
    payments,
    contact,
    orderSummary,
    loadSmsConversations,
    loadContact,
    loadPayments,
    loadSummary,
  } = usePendingOrderData(order.id);

  const { sendingSms, sendSms } = useSmsHandling(order.id, order.customers?.phone);

  const getCustomerDisplayName = () => {
    if (contact?.business_name) {
      return `${contact.business_name} (${order.customers?.first_name} ${order.customers?.last_name})`;
    }
    return `${order.customers?.first_name} ${order.customers?.last_name}`;
  };

  useEffect(() => {
    loadSmsConversations();
    loadPayments();
    loadContact(order.customers?.email);
    loadSummary();
  }, [order.id]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      loadSmsConversations();
    }, 10000);

    return () => clearInterval(intervalId);
  }, [order.id]);

  async function handleSendTestSms() {
    const testMessage = generateTestSmsMessage(order, order.customers?.first_name);
    const success = await sendSms(testMessage);
    if (success) {
      await loadSmsConversations();
      alert('SMS sent successfully!');
    }
  }

  async function confirmApproval() {
    setShowApprovalModal(false);
    await handleApprove();
  }

  async function handleForceApproval() {
    const hasPaymentMethod = order.stripe_customer_id && order.stripe_payment_method_id;

    let confirmMessage = 'Force approve this order and mark as confirmed?\n\n';
    if (!hasPaymentMethod) {
      confirmMessage += '⚠️ WARNING: No payment method on file. This will be treated as a CASH PAYMENT.\n\n';
      confirmMessage += 'The order will be confirmed without charging a card. Continue?';
    } else {
      confirmMessage +=
        'This will skip customer approval and mark the order as confirmed (keeping the same payment method on file). Continue?';
    }

    if (!confirm(confirmMessage)) {
      return;
    }

    setProcessing(true);
    const result = await forceApproveOrder(order.id);
    setProcessing(false);

    if (result.success) {
      alert('Order has been force approved and marked as confirmed!');
      onUpdate();
    } else {
      alert(`Failed to force approve order: ${result.error}`);
    }
  }

  async function handleApprove() {
    if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
      alert(
        'No payment method on file. Ask the customer to complete checkout first, or use "Force Approve" for cash payments.'
      );
      return;
    }

    setProcessing(true);
    const result = await approveOrder(order.id, sendSms);
    setProcessing(false);

    if (result.success) {
      alert('Booking approved, card charged, and customer notified via SMS and email!');
      onUpdate();
    } else {
      alert(`Error approving order: ${result.error}`);
    }
  }

  async function handleReject(reason?: string) {
    if (!reason) {
      setShowRejectionModal(true);
      return;
    }

    setProcessing(true);
    const result = await rejectOrder(order, reason, sendSms);
    setProcessing(false);

    if (result.success) {
      alert('Booking rejected and customer notified via SMS.');
      setShowRejectionModal(false);
      onUpdate();
    } else {
      alert(`Error rejecting order: ${result.error}`);
    }
  }

  const isDraft = order.status === 'draft';
  const isAwaitingApproval = order.status === 'awaiting_customer_approval';
  const paymentUrl = `${window.location.origin}/checkout/${order.id}`;

  async function handleCopyPaymentLink() {
    try {
      await navigator.clipboard.writeText(paymentUrl);
      alert('Payment link copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy:', error);
      alert(`Payment link: ${paymentUrl}`);
    }
  }

  async function handleSendPaymentLink() {
    const message = generatePaymentLinkSmsMessage(order.customers?.first_name, paymentUrl);
    const success = await sendSms(message);
    if (success) {
      await loadSmsConversations();
      alert('SMS sent successfully!');
    }
  }

  const handleSmsMessage = async (message: string) => {
    const success = await sendSms(message);
    if (success) {
      await loadSmsConversations();
    }
    return success;
  };

  return (
    <div className="border border-blue-300 bg-blue-50 rounded-lg p-3 md:p-6">
      <OrderInfoSection
        order={order}
        customerDisplayName={getCustomerDisplayName()}
        onEditClick={() => setShowEditModal(true)}
      />

      <StreetViewImages
        address={order.addresses}
        orderCreatedAt={order.created_at}
        selectedImage={selectedImage}
        onSelectImage={setSelectedImage}
      />

      {orderSummary && (
        <div className="mb-4">
          <OrderSummary
            summary={orderSummary}
            title="Complete Order Details"
            showDeposit={true}
            showTip={order.tip_cents > 0}
            className="bg-white rounded-lg p-3 md:p-4"
          />
        </div>
      )}

      <SmsConversation
        messages={smsConversations}
        onSendMessage={handleSmsMessage}
        onSendTestMessage={handleSendTestSms}
        isSending={sendingSms}
      />

      <PaymentManagementSection order={order} payments={payments} />

      {isDraft ? (
        <div className="space-y-3">
          <PaymentLinkSection
            paymentUrl={paymentUrl}
            onCopyLink={handleCopyPaymentLink}
            onSendLink={handleSendPaymentLink}
            isSending={sendingSms}
          />
          <button
            onClick={() => handleReject()}
            disabled={processing}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            Cancel Order
          </button>
        </div>
      ) : isAwaitingApproval ? (
        <div className="space-y-3">
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg">
            <p className="text-sm text-amber-900 font-semibold mb-1">⏳ Awaiting Customer Approval</p>
            <p className="text-xs text-amber-800">
              Customer needs to review and approve the changes you made to this order.
            </p>
          </div>
          <button
            onClick={handleForceApproval}
            disabled={processing}
            className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            {processing ? 'Processing...' : 'Force Approve (Admin Override)'}
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={() => setShowApprovalModal(true)}
            disabled={processing}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            {processing ? 'Processing...' : 'Accept'}
          </button>
          <button
            onClick={() => handleReject()}
            disabled={processing}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            Reject
          </button>
        </div>
      )}

      {showApprovalModal && (
        <ApprovalModal
          order={order}
          customerDisplayName={getCustomerDisplayName()}
          onConfirm={confirmApproval}
          onCancel={() => setShowApprovalModal(false)}
        />
      )}

      {showRejectionModal && (
        <RejectionModal
          onReject={handleReject}
          onCancel={() => setShowRejectionModal(false)}
        />
      )}

      {showEditModal && (
        <OrderDetailModal
          order={order}
          onClose={() => setShowEditModal(false)}
          onUpdate={() => {
            setShowEditModal(false);
            onUpdate();
          }}
        />
      )}
    </div>
  );
}
