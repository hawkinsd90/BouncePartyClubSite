import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { showToast } from '../../lib/notifications';
import { supabase } from '../../lib/supabase';

interface PaymentsTabProps {
  orderId: string;
  customerName: string;
  payments: any[];
  order?: any;
  onPaymentsUpdate: () => void;
}

export function PaymentsTab({ orderId, customerName, payments, order, onPaymentsUpdate }: PaymentsTabProps) {
  const succeededPayments = payments.filter(p => p.status === 'succeeded');
  const totalCapturedCents = succeededPayments.reduce((sum, p) => sum + p.amount_cents, 0);

  const orderTotalCents = order
    ? (order.subtotal_cents || 0) +
      (order.generator_fee_cents || 0) +
      (order.travel_fee_cents || 0) +
      (order.surface_fee_cents || 0) +
      (order.same_day_pickup_fee_cents || 0) +
      (order.tax_cents || 0) -
      (order.discount_cents || 0)
    : 0;

  const remainingAfterCapturedCents = order ? Math.max(0, orderTotalCents - totalCapturedCents) : 0;
  const tipCents = order?.tip_cents || 0;

  // Derive deposit and balance from payments ledger for accurate breakdown.
  // Fall back to stored order columns only when no ledger payments exist.
  const ledgerDepositCents = succeededPayments
    .filter(p => p.type === 'deposit')
    .reduce((sum, p) => sum + p.amount_cents, 0);
  const ledgerBalanceCents = succeededPayments
    .filter(p => p.type === 'balance')
    .reduce((sum, p) => sum + p.amount_cents, 0);
  const hasLedgerData = succeededPayments.length > 0;
  const displayDepositCents = hasLedgerData
    ? Math.max(0, ledgerDepositCents - tipCents)
    : (order?.deposit_paid_cents || 0);
  const displayBalanceCents = hasLedgerData
    ? ledgerBalanceCents
    : (order?.balance_paid_cents || 0);
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  async function handleRefund() {
    const amountCents = Math.round(parseFloat(refundAmount) * 100);

    if (!amountCents || amountCents <= 0) {
      showToast('Please enter a valid refund amount', 'error');
      return;
    }

    if (!refundReason.trim()) {
      showToast('Please provide a reason for the refund', 'error');
      return;
    }

    const confirmed = confirm(
      `Issue refund of ${formatCurrency(amountCents)} to ${customerName}?\n\nReason: ${refundReason}\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    setRefunding(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-refund`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orderId,
            amountCents,
            reason: refundReason,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process refund');
      }

      showToast(`Refund of ${formatCurrency(amountCents)} processed successfully!`, 'success');
      setShowRefundForm(false);
      setRefundAmount('');
      setRefundReason('');
      onPaymentsUpdate();
    } catch (error: any) {
      console.error('Error processing refund:', error);
      showToast('Failed to process refund: ' + error.message, 'error');
    } finally {
      setRefunding(false);
    }
  }

  return (
    <div className="space-y-4">
      {order && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-xs text-green-700 mb-1">Total Paid</div>
            <div className="text-xl font-bold text-green-900">
              {formatCurrency(totalCapturedCents)}
            </div>
            <div className="text-xs text-green-700 mt-1 space-y-0.5">
              <div>Deposit: {formatCurrency(displayDepositCents)}</div>
              <div>Balance: {formatCurrency(displayBalanceCents)}</div>
              {tipCents > 0 && (
                <div className="pt-1 border-t border-green-300">
                  Tip: {formatCurrency(tipCents)}
                </div>
              )}
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="text-xs text-slate-700 mb-1">Balance Due</div>
            <div className="text-xl font-bold text-slate-900">
              {formatCurrency(remainingAfterCapturedCents)}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-slate-900 mb-4">Payment History</h3>

        {payments.length === 0 ? (
          <p className="text-slate-600 text-center py-8">No payments recorded for this order</p>
        ) : (
          <div className="space-y-4">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className={`p-4 rounded-lg border-2 ${
                  payment.status === 'succeeded'
                    ? 'bg-green-50 border-green-200'
                    : payment.status === 'failed'
                    ? 'bg-red-50 border-red-200'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-lg">
                        {formatCurrency(payment.amount_cents)}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded ${
                          payment.status === 'succeeded'
                            ? 'bg-green-600 text-white'
                            : payment.status === 'failed'
                            ? 'bg-red-600 text-white'
                            : 'bg-slate-400 text-white'
                        }`}
                      >
                        {payment.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-sm text-slate-600 space-y-1">
                      <div>
                        <span className="font-medium">Type:</span> {payment.type}
                      </div>
                      {payment.payment_method && (
                        <div>
                          <span className="font-medium">Method:</span>{' '}
                          {payment.payment_brand && payment.payment_last4
                            ? `${payment.payment_brand} •••• ${payment.payment_last4}`
                            : payment.payment_method}
                        </div>
                      )}
                      {payment.stripe_payment_intent_id && (
                        <div className="text-xs text-slate-500">
                          Payment Intent: {payment.stripe_payment_intent_id}
                        </div>
                      )}
                      <div className="text-xs text-slate-500">
                        {payment.paid_at
                          ? `Paid: ${new Date(payment.paid_at).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}`
                          : `Created: ${new Date(payment.created_at).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {payments.filter((p) => p.status === 'succeeded' && p.stripe_payment_intent_id).length > 0 && (
          <div className="mt-6 pt-6 border-t border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-slate-900">Refund Payment</h4>
              <button
                onClick={() => setShowRefundForm(!showRefundForm)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
              >
                <RotateCcw className="w-4 h-4" />
                {showRefundForm ? 'Cancel' : 'Issue Refund'}
              </button>
            </div>

            {showRefundForm && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Refund Amount ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Reason for Refund
                  </label>
                  <input
                    type="text"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Customer request, Weather cancellation, Equipment issue"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleRefund}
                    disabled={refunding}
                    className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg"
                  >
                    {refunding ? 'Processing...' : 'Issue Refund'}
                  </button>
                  <button
                    onClick={() => setShowRefundForm(false)}
                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-xs text-amber-700">
                  This will process a refund through Stripe and update the order balance. This action cannot be undone.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
