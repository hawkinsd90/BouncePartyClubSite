import { useState } from 'react';
import { CheckCircle, CreditCard, Loader2 } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { TipSelector, calculateTipCents } from '../payment/TipSelector';
import { showToast } from '../../lib/notifications';

interface PaymentTabProps {
  orderId: string;
  order: any;
  balanceDue: number;
  onPaymentComplete: () => void;
}

export function PaymentTab({ orderId, order, balanceDue, onPaymentComplete }: PaymentTabProps) {
  const [tipAmount, setTipAmount] = useState<'none' | '10' | '15' | '20' | 'custom'>('none');
  const [customTipAmount, setCustomTipAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const orderTotal = order.subtotal_cents +
    (order.travel_fee_cents || 0) +
    (order.surface_fee_cents || 0) +
    (order.same_day_pickup_fee_cents || 0) +
    (order.generator_fee_cents || 0) +
    (order.tax_cents || 0);

  const tipCents = calculateTipCents(tipAmount, customTipAmount, orderTotal);
  const totalDueNow = balanceDue + tipCents;
  const hasCardOnFile = !!(order.stripe_customer_id && order.stripe_payment_method_id);
  const isDisabled = totalDueNow <= 0 || loading;

  async function handlePay() {
    if (isDisabled) return;
    setLoading(true);

    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-balance-payment`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          amountCents: balanceDue,
          tipCents,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process payment');
      }

      if (data.success) {
        showToast('Payment processed successfully!', 'success');
        onPaymentComplete();
      } else if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('Unexpected response from payment processor');
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      showToast(error.message || 'Failed to process payment', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {balanceDue <= 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-green-900">Payment Complete</h3>
          <p className="text-sm text-green-700 mt-2">
            No balance due. You may still add a tip for the crew below.
          </p>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Payment Summary</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Total Order:</span>
              <span className="font-semibold text-slate-900">
                {formatCurrency(orderTotal)}
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
      )}

      <div>
        <h3 className="text-base font-semibold text-slate-900 mb-3">Add a Tip for the Crew</h3>
        <TipSelector
          totalCents={orderTotal}
          tipAmount={tipAmount}
          customTipAmount={customTipAmount}
          onTipAmountChange={setTipAmount}
          onCustomTipAmountChange={setCustomTipAmount}
          formatCurrency={formatCurrency}
        />
      </div>

      {tipCents > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-600">Balance:</span>
            <span className="font-medium">{formatCurrency(balanceDue)}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-600">Tip:</span>
            <span className="font-medium text-green-700">+{formatCurrency(tipCents)}</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-slate-200">
            <span className="font-semibold text-slate-900">Total Due Now:</span>
            <span className="font-bold text-lg text-blue-600">{formatCurrency(totalDueNow)}</span>
          </div>
        </div>
      )}

      {hasCardOnFile && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
          Card on file will be charged automatically.
        </div>
      )}

      <button
        onClick={handlePay}
        disabled={isDisabled}
        className={`w-full font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 ${
          isDisabled
            ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <CreditCard className="w-5 h-5" />
            {balanceDue > 0
              ? tipCents > 0
                ? `Pay ${formatCurrency(totalDueNow)}`
                : `Pay Balance Now`
              : tipCents > 0
              ? `Add Tip of ${formatCurrency(tipCents)}`
              : 'Pay Balance Now'}
          </>
        )}
      </button>

      <p className="text-xs text-slate-500 text-center">
        Secure payment powered by Stripe. We accept all major credit cards.
      </p>
    </div>
  );
}
