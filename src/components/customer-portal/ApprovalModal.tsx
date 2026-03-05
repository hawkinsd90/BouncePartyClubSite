import { useState } from 'react';
import { CreditCard, CreditCard as Edit2, MapPin, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';
import { loadStripe } from '@stripe/stripe-js';
import { formatOrderId } from '../../lib/utils';
import { format } from 'date-fns';

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: any;
  onSuccess: () => void;
}

export function ApprovalModal({ isOpen, onClose, order, onSuccess }: ApprovalModalProps) {
  const [confirmName, setConfirmName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [updatingCard, setUpdatingCard] = useState(false);

  if (!isOpen) return null;

  async function handleUpdateCard() {
    setUpdatingCard(true);
    try {
      const { data: keyData } = await supabase.functions.invoke('get-stripe-publishable-key');
      if (!keyData?.publishableKey) throw new Error('Failed to get Stripe key');

      const stripe = await loadStripe(keyData.publishableKey);
      if (!stripe) throw new Error('Failed to load Stripe');

      const { data: sessionData, error: sessionError } = await supabase.functions.invoke(
        'stripe-checkout',
        {
          body: {
            orderId: order.id,
            amount: 0,
            setupMode: true,
          },
        }
      );

      if (sessionError || !sessionData?.sessionId) {
        throw new Error(sessionError?.message || 'Failed to create checkout session');
      }

      const { error: stripeError } = await stripe.redirectToCheckout({
        sessionId: sessionData.sessionId,
      });

      if (stripeError) throw stripeError;
    } catch (error: any) {
      console.error('Error updating card:', error);
      showToast('Failed to update payment method. Please try again.', 'error');
      setUpdatingCard(false);
    }
  }

  async function handleConfirm() {
    const expectedName = `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`.trim().toLowerCase();
    const enteredName = confirmName.trim().toLowerCase();

    if (enteredName !== expectedName) {
      showToast('Name does not match. Please enter your full name exactly as shown.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: 'confirmed' })
        .eq('id', order.id);

      if (updateError) throw updateError;

      const { error: logError } = await supabase.from('order_changelog').insert({
        order_id: order.id,
        changed_by: null,
        change_type: 'status_change',
        field_name: 'status',
        old_value: order.status,
        new_value: 'confirmed',
        notes: 'Customer approved order changes via portal',
      });

      if (logError) console.error('Error logging approval:', logError);

      showToast('Order approved successfully!', 'success');
      onSuccess();
    } catch (error) {
      console.error('Error approving order:', error);
      showToast('Failed to approve order. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const customerName = `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`.trim();
  const address = order.addresses
    ? `${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state} ${order.addresses.zip}`
    : 'No address';
  const eventDate = order.event_date
    ? format(new Date(order.event_date + 'T12:00:00'), 'EEEE, MMMM d, yyyy')
    : 'No date';

  const totalAmount = (
    order.subtotal_cents +
    (order.generator_fee_cents || 0) +
    order.travel_fee_cents +
    order.surface_fee_cents +
    (order.same_day_pickup_fee_cents || 0) +
    order.tax_cents -
    (order.discount_cents || 0)
  ) / 100;

  const totalPaid = (order.deposit_paid_cents || 0) / 100;
  const amountDue = totalAmount - totalPaid;

  const paymentMethodText = order.payment_method_last_four && order.payment_method_brand
    ? `${order.payment_method_brand.charAt(0).toUpperCase() + order.payment_method_brand.slice(1)} •••• ${order.payment_method_last_four}`
    : order.payment_method_last_four
    ? `Card •••• ${order.payment_method_last_four}`
    : null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 md:p-5">
          <h3 className="text-lg md:text-xl font-bold text-green-900 mb-2">Approve Order Changes</h3>
          <p className="text-xs md:text-sm text-slate-600 mb-3">
            Review and confirm the updated order details below.
          </p>

          <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-2">
              <div>
                <p className="text-xs text-slate-500">Order #</p>
                <p className="font-mono text-sm font-semibold text-slate-900">{formatOrderId(order.id)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">Amount Due</p>
                <p className="text-lg font-bold text-green-700">${amountDue.toFixed(2)}</p>
              </div>
            </div>
            <div className="mb-2">
              <p className="text-xs text-slate-500">Customer</p>
              <p className="text-sm font-medium text-slate-900">{customerName}</p>
            </div>
            <div className="flex items-start gap-1.5 mb-2">
              <MapPin className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-900 break-words">{address}</p>
              </div>
            </div>
            <div className="flex items-start gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-slate-900">{eventDate}</p>
            </div>
          </div>

          {order.stripe_payment_method_id && (
            <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <CreditCard className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-900">Payment Method on File</p>
                    {paymentMethodText ? (
                      <p className="text-xs text-slate-700 font-medium">{paymentMethodText}</p>
                    ) : (
                      <p className="text-xs text-slate-600">Card saved for payment</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleUpdateCard}
                  disabled={updatingCard}
                  className="flex items-center text-blue-600 hover:text-blue-700 font-medium text-xs transition-colors whitespace-nowrap ml-2"
                >
                  <Edit2 className="w-3.5 h-3.5 mr-1" />
                  {updatingCard ? 'Loading...' : 'Update'}
                </button>
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              To confirm, enter your full name: <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={`${order.customers?.first_name || 'Unknown'} ${order.customers?.last_name || ''}`}
              className="w-full px-3 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-green-500 text-sm"
            />
            <p className="text-xs text-slate-500 mt-1">
              Must match: {order.customers?.first_name || 'Unknown'} {order.customers?.last_name || ''}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => {
                setConfirmName('');
                onClose();
              }}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-2.5 px-4 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!confirmName.trim() || submitting}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded-lg transition-colors text-sm"
            >
              {submitting ? 'Processing...' : 'Confirm Approval'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
