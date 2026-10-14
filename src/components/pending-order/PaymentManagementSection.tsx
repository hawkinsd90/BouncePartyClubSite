import { format } from 'date-fns';
import { CreditCard } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { storedOrderTotalCents } from '../../lib/orderMoney';
import { RefundAllocationPanel } from '../admin/refunds/RefundAllocationPanel';
import { REFUND_REASONS, componentSummary } from '../../lib/payments/refundAllocationRequest';

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
  allocation_version?: number | null;
  deposit_principal_refunded_cents?: number | null;
  balance_principal_refunded_cents?: number | null;
  tip_refunded_cents?: number | null;
  unclassified_refunded_cents?: number | null;
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

export function PaymentManagementSection({
  order,
  payments,
  refunds = [],
  customFees = [],
  discounts = [],
  onRefundSuccess,
}: PaymentManagementSectionProps) {
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

  const orderTotalCents = storedOrderTotalCents(order, discounts, customFees);

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

      {isCancelled && hasStripePayments && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <h5 className="text-sm font-semibold text-slate-700 mb-3">Issue Refund</h5>
          <RefundAllocationPanel
            orderId={order.id}
            customerName={[order.customers?.first_name, order.customers?.last_name].filter(Boolean).join(' ') || undefined}
            showHistory={false}
            refreshToken={`${payments.map((p) => `${p.id}:${p.status}`).join(',')}|${refunds.map((r) => `${r.id}:${r.status}`).join(',')}`}
            onChanged={onRefundSuccess}
          />
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
                  <div className="text-xs text-slate-600">
                    {componentSummary({ allocation_version: refund.allocation_version ?? null, deposit_cents: refund.deposit_principal_refunded_cents ?? null, balance_cents: refund.balance_principal_refunded_cents ?? null, tip_cents: refund.tip_refunded_cents ?? null, unclassified_cents: refund.unclassified_refunded_cents ?? null })}
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
