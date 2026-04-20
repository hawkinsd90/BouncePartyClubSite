import { format } from 'date-fns';
import { CreditCard } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { calculateStoredOrderTotal } from '../../lib/orderUtils';

interface Payment {
  id: string;
  amount_cents: number;
  status: string;
  type?: string;
  payment_type?: string;
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
  customFees?: CustomFee[];
  discounts?: Discount[];
}

export function PaymentManagementSection({ order, payments, customFees = [], discounts = [] }: PaymentManagementSectionProps) {
  const hasPaymentMethod = order.stripe_customer_id && order.stripe_payment_method_id;

  const succeededPayments = payments.filter(p => p.status === 'succeeded');
  const totalCapturedCents = succeededPayments.reduce((sum, p) => sum + p.amount_cents, 0);

  const customFeesCents = customFees.reduce((sum, f) => sum + (f.amount_cents || 0), 0);
  const subtotalCents = order.subtotal_cents || 0;
  const discountCents = discounts.reduce((sum, d) => {
    if (d.percentage && d.percentage > 0) return sum + Math.round(subtotalCents * (d.percentage / 100));
    return sum + (d.amount_cents || 0);
  }, 0);
  const orderTotalCents = calculateStoredOrderTotal(order) + customFeesCents - discountCents;

  const tipCents = order.tip_cents || 0;
  const remainingAfterCapturedCents = Math.max(0, orderTotalCents - totalCapturedCents);

  // Derive deposit and balance breakdown from the payments ledger.
  // Payments with type='deposit' are base deposit; 'balance' are balance payments.
  // Tip is charged on top of deposit but tracked separately in tip_cents.
  // Fall back to stored order columns only when no ledger data exists.
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

        <div className="bg-slate-50 border border-slate-200 rounded p-3">
          <div className="text-xs text-slate-700 mb-1">Balance Due</div>
          <div className="text-lg font-bold text-slate-900">
            {formatCurrency(remainingAfterCapturedCents)}
          </div>
        </div>
      </div>

      {hasPaymentMethod ? (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 flex items-start text-sm">
          <span className="text-blue-600 mr-2">✓</span>
          <div className="text-blue-900">
            <strong>Payment method on file</strong>
            <br />
            You can charge the customer's card for remaining balance or damage fees.
          </div>
        </div>
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 flex items-start text-sm">
          <span className="text-yellow-600 mr-2">⚠</span>
          <div className="text-yellow-900">
            <strong>No payment method on file</strong>
            <br />
            Customer needs to complete checkout before you can charge a card.
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
    </div>
  );
}
