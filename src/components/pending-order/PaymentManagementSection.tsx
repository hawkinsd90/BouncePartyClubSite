import { useState } from 'react';
import { format } from 'date-fns';
import { CreditCard, RefreshCw } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { calculateStoredOrderTotal } from '../../lib/orderUtils';
import { supabase } from '../../lib/supabase';

interface Payment {
  id: string;
  amount_cents: number;
  status: string;
  type?: string;
  payment_type?: string;
  created_at: string;
}

interface Refund {
  id: string;
  amount_cents: number;
  reason: string;
  status: string;
  created_at: string;
}

interface CustomFee {
  id: string;
  amount_cents: number;
  name?: string;
}

interface Discount {
  id?: string;
  amount_cents?: number;
  percentage?: number;
  name: string;
}

interface PaymentManagementSectionProps {
  order: any;
  payments: Payment[];
  refunds?: Refund[];
  customFees?: CustomFee[];
  discounts?: Discount[];
  onRefundSuccess?: () => void;
}

const REFUND_REASONS = [
  { value: 'cancellation', label: 'Order Cancellation' },
  { value: 'requested_by_customer', label: 'Customer Request' },
  { value: 'duplicate', label: 'Duplicate Charge' },
  { value: 'fraudulent', label: 'Fraudulent Charge' },
  { value: 'other', label: 'Other' },
];

export function PaymentManagementSection({
  order,
  payments,
  refunds = [],
  customFees = [],
  discounts = [],
  onRefundSuccess,
}: PaymentManagementSectionProps) {
  const [refundAmountDollars, setRefundAmountDollars] = useState('');
  const [refundReason, setRefundReason] = useState('cancellation');
  const [isRefunding, setIsRefunding] = useState(false);
  const [refundMessage, setRefundMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const hasChargeableCard = !!(order.stripe_customer_id && order.stripe_payment_method_id);
  const hasPreviousCardPayment = !!(order.payment_method_last_four && !order.stripe_payment_method_id);

  const isCancelled = order.status === 'cancelled';

  const succeededPayments = payments.filter(p => p.status === 'succeeded');
  const totalCapturedCents = succeededPayments.reduce((sum, p) => sum + p.amount_cents, 0);

  // For display: only show succeeded refunds in the "refunded" total.
  const succeededRefundedCents = refunds
    .filter(r => r.status === 'succeeded')
    .reduce((sum, r) => sum + r.amount_cents, 0);

  // For max refundable: treat both succeeded and pending as consumed to prevent double-refunds.
  const reservedRefundCents = refunds
    .filter(r => r.status === 'succeeded' || r.status === 'pending')
    .reduce((sum, r) => sum + r.amount_cents, 0);

  const maxRefundableCents = Math.max(0, totalCapturedCents - reservedRefundCents);

  const customFeesCents = customFees.reduce((sum, f) => sum + (f.amount_cents || 0), 0);
  const subtotalCents = order.subtotal_cents || 0;
  const discountCents = discounts.reduce((sum, d) => {
    if (d.percentage && d.percentage > 0) return sum + Math.round(subtotalCents * (d.percentage / 100));
    return sum + (d.amount_cents || 0);
  }, 0);
  const orderTotalCents = calculateStoredOrderTotal(order) + customFeesCents - discountCents;

  const tipCents = order.tip_cents || 0;
  const remainingAfterCapturedCents = Math.max(0, orderTotalCents - totalCapturedCents);

  const ledgerDepositCents = succeededPayments
    .filter(p => p.payment_type === 'deposit' || p.type === 'deposit')
    .reduce((sum, p) => sum + p.amount_cents, 0);
  const ledgerBalanceCents = succeededPayments
    .filter(p => p.payment_type === 'balance' || p.type === 'balance')
    .reduce((sum, p) => sum + p.amount_cents, 0);
  const hasLedgerData = succeededPayments.length > 0;
  const displayDepositCents = hasLedgerData
    ? Math.max(0, ledgerDepositCents - tipCents)
    : (order.deposit_paid_cents || 0);
  const displayBalanceCents = hasLedgerData
    ? ledgerBalanceCents
    : (order.balance_paid_cents || 0);

  const hasStripePayments = succeededPayments.some(p => (p as any).stripe_payment_intent_id);

  async function handleRefund() {
    const amountCents = Math.round(parseFloat(refundAmountDollars) * 100);

    if (isNaN(amountCents) || amountCents <= 0) {
      setRefundMessage({ type: 'error', text: 'Please enter a valid refund amount.' });
      return;
    }
    if (amountCents > maxRefundableCents) {
      setRefundMessage({ type: 'error', text: `Amount exceeds maximum refundable amount of ${formatCurrency(maxRefundableCents)}.` });
      return;
    }

    setIsRefunding(true);
    setRefundMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-refund`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ orderId: order.id, amountCents, reason: refundReason }),
        }
      );

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Refund failed');

      setRefundMessage({ type: 'success', text: `Refund of ${formatCurrency(amountCents)} processed successfully.` });
      setRefundAmountDollars('');
      onRefundSuccess?.();
    } catch (err: any) {
      setRefundMessage({ type: 'error', text: err.message || 'Failed to process refund.' });
    } finally {
      setIsRefunding(false);
    }
  }

  return (
    <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200">
      <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-slate-500" /> Payment Management
      </h4>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-green-50 border border-green-200 rounded p-3">
          <div className="text-xs text-green-700 mb-1">Total Paid</div>
          <div className="text-lg font-bold text-green-900">
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

        {isCancelled ? (
          <div className="bg-slate-50 border border-slate-200 rounded p-3">
            <div className="text-xs text-slate-700 mb-1">Total Refunded</div>
            <div className="text-lg font-bold text-slate-900">
              {formatCurrency(succeededRefundedCents)}
            </div>
            {maxRefundableCents > 0 ? (
              <div className="text-xs text-slate-500 mt-1">
                Available: {formatCurrency(maxRefundableCents)}
              </div>
            ) : reservedRefundCents > succeededRefundedCents ? (
              <div className="text-xs text-amber-600 mt-1">
                Pending refund in progress
              </div>
            ) : null}
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded p-3">
            <div className="text-xs text-slate-700 mb-1">Balance Due</div>
            <div className="text-lg font-bold text-slate-900">
              {formatCurrency(remainingAfterCapturedCents)}
            </div>
          </div>
        )}
      </div>

      {hasChargeableCard ? (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 flex items-start text-sm">
          <span className="text-blue-600 mr-2">✓</span>
          <div className="text-blue-900">
            <strong>Payment method on file</strong>
            {order.payment_method_brand && order.payment_method_last_four && (
              <span className="ml-1 text-blue-700 capitalize">
                — {order.payment_method_brand} ending {order.payment_method_last_four}
              </span>
            )}
            <br />
            You can charge the customer's card for remaining balance or damage fees.
          </div>
        </div>
      ) : hasPreviousCardPayment ? (
        <div className="bg-slate-50 border border-slate-300 rounded p-3 flex items-start text-sm">
          <span className="text-slate-500 mr-2">ℹ</span>
          <div className="text-slate-700">
            <strong>Previous card payment found</strong>
            {order.payment_method_brand && (
              <span className="ml-1 capitalize">— {order.payment_method_brand}</span>
            )}
            {order.payment_method_last_four && (
              <span> ending {order.payment_method_last_four}</span>
            )}
            <br />
            No saved payment method on file — card cannot be charged again.
          </div>
        </div>
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 flex items-start text-sm">
          <span className="text-yellow-600 mr-2">⚠</span>
          <div className="text-yellow-900">
            <strong>No saved payment method found</strong>
            <br />
            Customer needs to complete checkout before you can charge a card.
          </div>
        </div>
      )}

      {isCancelled && hasStripePayments && maxRefundableCents > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <h5 className="text-sm font-semibold text-slate-700 mb-3">Issue Refund</h5>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="text-xs text-slate-600">
              Max refundable: <span className="font-semibold text-slate-900">{formatCurrency(maxRefundableCents)}</span>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-600 mb-1">Amount ($)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={(maxRefundableCents / 100).toFixed(2)}
                    value={refundAmountDollars}
                    onChange={e => setRefundAmountDollars(e.target.value)}
                    placeholder={(maxRefundableCents / 100).toFixed(2)}
                    className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setRefundAmountDollars((maxRefundableCents / 100).toFixed(2))}
                    className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
                  >
                    Max
                  </button>
                </div>
              </div>

              <div className="flex-1">
                <label className="block text-xs text-slate-600 mb-1">Reason</label>
                <select
                  value={refundReason}
                  onChange={e => setRefundReason(e.target.value)}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {REFUND_REASONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {refundMessage && (
              <div className={`text-sm rounded p-2 ${refundMessage.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                {refundMessage.text}
              </div>
            )}

            <button
              onClick={handleRefund}
              disabled={isRefunding || !refundAmountDollars}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
            >
              {isRefunding && <RefreshCw className="w-4 h-4 animate-spin" />}
              {isRefunding ? 'Processing Refund...' : 'Process Refund'}
            </button>
          </div>
        </div>
      )}

      {payments.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <h5 className="text-sm font-semibold text-slate-700 mb-2">Payment History</h5>
          <div className="space-y-2">
            {payments.map((payment) => {
              const paymentType = payment.payment_type || payment.type || 'payment';
              return (
                <div
                  key={payment.id}
                  className="flex justify-between items-center p-2 bg-slate-50 rounded text-sm"
                >
                  <div>
                    <div className="font-medium text-slate-900 capitalize">
                      {paymentType.replace('_', ' ')}
                    </div>
                    <div className="text-xs text-slate-500">
                      {format(new Date(payment.created_at), 'MMM d, yyyy h:mm a')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`font-semibold ${
                        payment.status === 'succeeded'
                          ? 'text-green-600'
                          : payment.status === 'failed'
                            ? 'text-red-600'
                            : 'text-slate-600'
                      }`}
                    >
                      {formatCurrency(payment.amount_cents)}
                    </div>
                    <div className="text-xs capitalize text-slate-500">{payment.status}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {refunds.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <h5 className="text-sm font-semibold text-slate-700 mb-2">Refund History</h5>
          <div className="space-y-2">
            {refunds.map((refund) => (
              <div
                key={refund.id}
                className="flex justify-between items-center p-2 bg-red-50 rounded text-sm"
              >
                <div>
                  <div className="font-medium text-slate-900 capitalize">
                    {REFUND_REASONS.find(r => r.value === refund.reason)?.label ?? refund.reason}
                  </div>
                  <div className="text-xs text-slate-500">
                    {format(new Date(refund.created_at), 'MMM d, yyyy h:mm a')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-red-600">
                    -{formatCurrency(refund.amount_cents)}
                  </div>
                  <div className="text-xs capitalize text-slate-500">{refund.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
