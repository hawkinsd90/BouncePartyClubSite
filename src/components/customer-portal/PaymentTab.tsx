import { CheckCircle, CreditCard } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface PaymentTabProps {
  order: any;
  balanceDue: number;
  onPayment: () => void;
}

export function PaymentTab({ order, balanceDue, onPayment }: PaymentTabProps) {
  return (
    <div className="space-y-6">
      {balanceDue <= 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-green-900">Payment Complete</h3>
          <p className="text-sm text-green-700 mt-2">
            No balance due. Thank you for your payment!
          </p>
        </div>
      ) : (
        <>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Payment Summary</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Total Order:</span>
                <span className="font-semibold text-slate-900">
                  {formatCurrency(
                    order.subtotal_cents +
                    order.travel_fee_cents +
                    order.surface_fee_cents +
                    order.same_day_pickup_fee_cents +
                    order.tax_cents
                  )}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Already Paid:</span>
                <span className="font-semibold text-green-700">
                  {formatCurrency((order.deposit_paid_cents || 0) + (order.balance_paid_cents || 0))}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-300">
                <span className="font-semibold text-slate-900">Balance Due:</span>
                <span className="text-xl font-bold text-blue-600">
                  {formatCurrency(balanceDue)}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onPayment}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <CreditCard className="w-5 h-5" />
            Pay Balance Now
          </button>

          <p className="text-xs text-slate-500 text-center">
            Secure payment powered by Stripe. We accept all major credit cards.
          </p>
        </>
      )}
    </div>
  );
}
