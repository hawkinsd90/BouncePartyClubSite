import { DollarSign } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface PaymentAmountSelectorProps {
  paymentAmount: 'deposit' | 'full' | 'custom';
  customAmount: string;
  priceBreakdown: any;
  onPaymentAmountChange: (amount: 'deposit' | 'full' | 'custom') => void;
  onCustomAmountChange: (amount: string) => void;
}

export function PaymentAmountSelector({
  paymentAmount,
  customAmount,
  priceBreakdown,
  onPaymentAmountChange,
  onCustomAmountChange,
}: PaymentAmountSelectorProps) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
        <DollarSign className="w-6 h-6 mr-2 text-green-600" />
        Payment Amount
      </h2>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
            paymentAmount === 'deposit' ? 'border-blue-600 bg-blue-50' : 'border-slate-300 hover:border-blue-400'
          }`}>
            <input
              type="radio"
              name="paymentAmount"
              value="deposit"
              checked={paymentAmount === 'deposit'}
              onChange={(e) => onPaymentAmountChange(e.target.value as any)}
              className="sr-only"
            />
            <span className="font-semibold text-slate-900">Minimum Deposit</span>
            <span className="text-lg font-bold text-blue-600 mt-1">
              {formatCurrency(priceBreakdown.deposit_due_cents)}
            </span>
            <span className="text-xs text-slate-600 mt-1">Pay balance at event</span>
          </label>

          <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
            paymentAmount === 'full' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
          }`}>
            <input
              type="radio"
              name="paymentAmount"
              value="full"
              checked={paymentAmount === 'full'}
              onChange={(e) => onPaymentAmountChange(e.target.value as any)}
              className="sr-only"
            />
            <span className="font-semibold text-slate-900">Full Payment</span>
            <span className="text-lg font-bold text-green-600 mt-1">
              {formatCurrency(priceBreakdown.total_cents)}
            </span>
            <span className="text-xs text-slate-600 mt-1">Nothing due at event</span>
          </label>

          <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
            paymentAmount === 'custom' ? 'border-purple-600 bg-purple-50' : 'border-slate-300 hover:border-purple-400'
          }`}>
            <input
              type="radio"
              name="paymentAmount"
              value="custom"
              checked={paymentAmount === 'custom'}
              onChange={(e) => onPaymentAmountChange(e.target.value as any)}
              className="sr-only"
            />
            <span className="font-semibold text-slate-900">Custom Amount</span>
            <span className="text-sm text-slate-600 mt-1">Choose your amount</span>
          </label>
        </div>

        {paymentAmount === 'custom' && (
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Payment Amount * (Minimum: {formatCurrency(priceBreakdown.deposit_due_cents)})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-slate-600">$</span>
              <input
                type="number"
                step="0.01"
                min={(priceBreakdown.deposit_due_cents / 100).toFixed(2)}
                max={(priceBreakdown.total_cents / 100).toFixed(2)}
                value={customAmount}
                onChange={(e) => onCustomAmountChange(e.target.value)}
                placeholder={(priceBreakdown.deposit_due_cents / 100).toFixed(2)}
                className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required={paymentAmount === 'custom'}
              />
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Enter any amount between the minimum deposit and the full total
            </p>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-900 font-medium mb-1">
            {paymentAmount === 'deposit' && `Pay ${formatCurrency(priceBreakdown.deposit_due_cents)} now, ${formatCurrency(priceBreakdown.balance_due_cents)} at event`}
            {paymentAmount === 'full' && `Pay ${formatCurrency(priceBreakdown.total_cents)} now, nothing at event`}
            {paymentAmount === 'custom' && customAmount && `Pay $${customAmount} now, ${formatCurrency(priceBreakdown.total_cents - Math.round(parseFloat(customAmount) * 100))} at event`}
            {paymentAmount === 'custom' && !customAmount && 'Enter amount to see payment breakdown'}
          </p>
          <p className="text-xs text-blue-700">
            All bookings require admin approval before payment is processed
          </p>
        </div>
      </div>
    </div>
  );
}
