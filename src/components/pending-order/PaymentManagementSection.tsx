import { format } from 'date-fns';
import { formatCurrency } from '../../lib/pricing';

interface Payment {
  id: string;
  amount_cents: number;
  status: string;
  type?: string;
  payment_type?: string;
  created_at: string;
}

interface PaymentManagementSectionProps {
  order: any;
  payments: Payment[];
}

export function PaymentManagementSection({ order, payments }: PaymentManagementSectionProps) {
  const hasPaymentMethod = order.stripe_customer_id && order.stripe_payment_method_id;

  // Actual captured payments from the payments table (source of truth)
  const succeededPayments = payments.filter(p => p.status === 'succeeded');
  const totalCapturedCents = succeededPayments.reduce((sum, p) => sum + p.amount_cents, 0);

  // Whether any real money has been captured
  const hasCapture = totalCapturedCents > 0;

  // Order total (excluding tip — tip is on top)
  const orderTotalCents =
    (order.subtotal_cents || 0) +
    (order.generator_fee_cents || 0) +
    (order.travel_fee_cents || 0) +
    (order.surface_fee_cents || 0) +
    (order.same_day_pickup_fee_cents || 0) +
    (order.tax_cents || 0) -
    (order.discount_cents || 0);

  const tipCents = order.tip_cents || 0;
  const selectedPaymentBaseCents = order.customer_selected_payment_cents || order.deposit_due_cents || 0;
  const selectedPaymentTotalCents = selectedPaymentBaseCents + tipCents;

  // Pre-charge: nothing captured yet, order is pending_review or awaiting_customer_approval
  const isPreCharge = !hasCapture;

  // Post-charge balance: total not yet paid
  const remainingAfterCapturedCents = Math.max(0, orderTotalCents - totalCapturedCents);

  return (
    <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200">
      <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center">
        <span className="mr-2">💳</span> Payment Management
      </h4>

      {isPreCharge ? (
        <div className="space-y-3 mb-4">
          <div className="bg-slate-50 border border-slate-200 rounded p-3">
            <div className="text-xs text-slate-500 mb-1">Actual Captured</div>
            <div className="text-lg font-bold text-slate-400">$0.00</div>
            <div className="text-xs text-slate-500 mt-1">No payment charged yet</div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded p-3">
            <div className="text-xs text-blue-700 mb-1">Pending — Customer Selected Payment</div>
            <div className="text-lg font-bold text-blue-900">
              {formatCurrency(selectedPaymentTotalCents)}
            </div>
            <div className="text-xs text-blue-700 mt-1 space-y-0.5">
              <div>Base: {formatCurrency(selectedPaymentBaseCents)}</div>
              {tipCents > 0 && <div>Tip: {formatCurrency(tipCents)}</div>}
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded p-3">
            <div className="text-xs text-slate-700 mb-1">Full Amount Due (before approval)</div>
            <div className="text-lg font-bold text-slate-900">
              {formatCurrency(orderTotalCents + tipCents)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Projected balance after approval: {formatCurrency(Math.max(0, orderTotalCents - selectedPaymentBaseCents))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-green-50 border border-green-200 rounded p-3">
            <div className="text-xs text-green-700 mb-1">Total Paid</div>
            <div className="text-lg font-bold text-green-900">
              {formatCurrency(totalCapturedCents)}
            </div>
            <div className="text-xs text-green-700 mt-1 space-y-0.5">
              <div>Deposit: {formatCurrency(order.deposit_paid_cents || 0)}</div>
              <div>Balance: {formatCurrency(order.balance_paid_cents || 0)}</div>
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
      )}

      {hasPaymentMethod ? (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 flex items-start text-sm">
          <span className="text-blue-600 mr-2">✓</span>
          <div className="text-blue-900">
            <strong>Payment method on file</strong>
            <br />
            {isPreCharge
              ? 'Card will be charged upon approval.'
              : 'You can charge the customer\'s card for remaining balance or damage fees.'}
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
