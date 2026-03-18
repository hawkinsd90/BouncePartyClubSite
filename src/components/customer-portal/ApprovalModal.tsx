import { useState, useEffect, useRef } from 'react';
import { CreditCard, CreditCard as Edit2, MapPin, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';
import { loadStripe } from '@stripe/stripe-js';
import { formatOrderId } from '../../lib/utils';
import { format } from 'date-fns';
import { formatCurrency } from '../../lib/pricing';

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: any;
  onSuccess: () => void;
  selectedPaymentCents: number;
  selectedPaymentBaseCents: number;
  newTipCents: number;
  keepOriginalPayment: boolean;
}

export function ApprovalModal({
  isOpen,
  onClose,
  order,
  onSuccess,
  selectedPaymentCents,
  selectedPaymentBaseCents,
  newTipCents,
  keepOriginalPayment
}: ApprovalModalProps) {
  const [confirmName, setConfirmName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [updatingCard, setUpdatingCard] = useState(false);
  const isMountedRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Handle mobile keyboard - keep input in view
  const handleInputFocus = () => {
    // Delay to ensure keyboard is shown
    setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  };

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
      const selectedPaymentType = keepOriginalPayment ? 'keep-original' : 'modified';

      // First, update the customer's payment selection
      // customer_selected_payment_cents stores base payment only (no tip)
      const updatePayload: Record<string, unknown> = {
        customer_selected_payment_cents: selectedPaymentBaseCents,
        customer_selected_payment_type: selectedPaymentType,
      };
      // If customer picked a new tip amount (when not keeping original), save it
      if (!keepOriginalPayment && newTipCents >= 0) {
        updatePayload.tip_cents = newTipCents;
      }
      const { error: updateError } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', order.id);

      if (updateError) throw updateError;

      // Log the approval
      const { error: logError } = await supabase.from('order_changelog').insert({
        order_id: order.id,
        user_id: null,
        change_type: 'customer_approval',
        field_changed: 'status',
        old_value: 'awaiting_customer_approval',
        new_value: 'approved',
      });

      if (logError) console.error('Error logging approval:', logError);

      // Check if customer already paid the initial deposit
      // Use stripe_payment_status as the source of truth — deposit_paid_cents can be stale after admin edits
      const alreadyPaidDeposit =
        order.stripe_payment_status === 'paid' ||
        (order.deposit_paid_cents || 0) > 0;

      if (alreadyPaidDeposit) {
        // Customer already paid initial deposit - just update status to confirmed
        // Any price increases (from added items) will be added to the final balance due
        const { error: statusError } = await supabase
          .from('orders')
          .update({ status: 'confirmed' })
          .eq('id', order.id);

        if (statusError) {
          throw new Error(statusError.message || 'Failed to update order status');
        }

        showToast('Order approved successfully! Any changes will be added to your final balance.', 'success');
      } else {
        // Customer hasn't paid initial deposit yet - charge the deposit
        const { data: chargeData, error: chargeError } = await supabase.functions.invoke('charge-deposit', {
          body: { orderId: order.id }
        });

        if (chargeError) {
          console.error('Charge deposit error:', chargeError);
          throw new Error(chargeError.message || 'Failed to process payment');
        }

        if (!chargeData?.success) {
          throw new Error(chargeData?.error || 'Payment processing failed');
        }

        showToast('Order approved and payment processed successfully!', 'success');
      }

      // Close modal first
      onClose();

      // Then call onSuccess after a brief delay to ensure modal is fully unmounted
      setTimeout(() => {
        onSuccess();
      }, 100);
    } catch (error: any) {
      console.error('Error approving order:', error);
      showToast(error.message || 'Failed to approve order. Please try again.', 'error');
      if (isMountedRef.current) {
        setSubmitting(false);
      }
    }
  }

  const customerName = `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`.trim();
  const address = order.addresses
    ? `${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state} ${order.addresses.zip}`
    : 'No address';
  const eventDate = order.event_date
    ? format(new Date(order.event_date + 'T12:00:00'), 'EEEE, MMMM d, yyyy')
    : 'No date';

  const currentTotalCents =
    order.subtotal_cents +
    (order.generator_fee_cents || 0) +
    order.travel_fee_cents +
    order.surface_fee_cents +
    (order.same_day_pickup_fee_cents || 0) +
    order.tax_cents -
    (order.discount_cents || 0);

  const lastFour = order.payment_method_last_four
    || order.payments?.find((p: any) => p.payment_last4)?.payment_last4
    || null;
  const brand = order.payment_method_brand
    || order.payments?.find((p: any) => p.payment_brand)?.payment_brand
    || null;

  const paymentMethodText = lastFour && brand
    ? `${brand.charAt(0).toUpperCase() + brand.slice(1)} •••• ${lastFour}`
    : lastFour
    ? `Card •••• ${lastFour}`
    : null;

  const alreadyPaidDeposit =
    order.stripe_payment_status === 'paid' ||
    (order.deposit_paid_cents || 0) > 0;

  if (!isOpen) return null;

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
                <p className="text-xs text-slate-500">
                  {alreadyPaidDeposit ? 'Total Amount' : 'Charging Now'}
                </p>
                <p className="text-lg font-bold text-green-700">{formatCurrency(selectedPaymentCents)}</p>
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

          <div className="mb-3 p-3 bg-green-50 border-2 border-green-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600">Payment Amount Selected</p>
                <p className="text-2xl font-bold text-green-700">{formatCurrency(selectedPaymentCents)}</p>
                {selectedPaymentBaseCents < currentTotalCents && (
                  <p className="text-xs text-slate-600 mt-1">
                    Balance due day of event: {formatCurrency(currentTotalCents - selectedPaymentBaseCents)}
                  </p>
                )}
                {(keepOriginalPayment ? (order.tip_cents || 0) : newTipCents) > 0 && (
                  <p className="text-xs text-green-600 mt-0.5">
                    Includes {formatCurrency(keepOriginalPayment ? (order.tip_cents || 0) : newTipCents)} crew tip
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              To confirm, enter your full name: <span className="text-red-600">*</span>
            </label>
            <input
              ref={inputRef}
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              onFocus={handleInputFocus}
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
