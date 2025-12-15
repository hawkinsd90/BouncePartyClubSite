import { DollarSign, CreditCard } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface PaymentAmountSelectorProps {
  depositCents: number;
  totalCents: number;
  paymentAmount: 'deposit' | 'full' | 'custom';
  customAmount: string;
  onPaymentAmountChange: (amount: 'deposit' | 'full' | 'custom') => void;
  onCustomAmountChange: (amount: string) => void;
  showCard?: boolean;
  showApprovalNote?: boolean;
  icon?: 'dollar' | 'credit-card';
}

export function PaymentAmountSelector({
  depositCents,
  totalCents,
  paymentAmount,
  customAmount,
  onPaymentAmountChange,
  onCustomAmountChange,
  showCard = false,
  showApprovalNote = false,
  icon = 'dollar',
}: PaymentAmountSelectorProps) {
  const balanceCents = totalCents - depositCents;
  const IconComponent = icon === 'credit-card' ? CreditCard : DollarSign;

  const content = (
    <>
      <h2 className={`${showCard ? 'text-2xl' : 'text-xl'} font-bold text-slate-900 mb-${showCard ? '6' : '4'} flex items-center`}>
        <IconComponent className={`${showCard ? 'w-6 h-6' : 'w-5 h-5'} mr-2 text-green-600`} />
        Payment Amount
      </h2>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label
            className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
              paymentAmount === 'deposit'
                ? 'border-blue-600 bg-blue-50'
                : 'border-slate-300 hover:border-blue-400'
            }`}
          >
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
              {formatCurrency(depositCents)}
            </span>
            <span className="text-xs text-slate-600 mt-1">Pay balance at event</span>
          </label>

          <label
            className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
              paymentAmount === 'full'
                ? 'border-green-600 bg-green-50'
                : 'border-slate-300 hover:border-green-400'
            }`}
          >
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
              {formatCurrency(totalCents)}
            </span>
            <span className="text-xs text-slate-600 mt-1">Nothing due at event</span>
          </label>

          <label
            className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
              paymentAmount === 'custom'
                ? 'border-purple-600 bg-purple-50'
                : 'border-slate-300 hover:border-purple-400'
            }`}
          >
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
              Payment Amount * (Minimum: {formatCurrency(depositCents)})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-slate-600">$</span>
              <input
                type="number"
                step="0.01"
                min={(depositCents / 100).toFixed(2)}
                max={(totalCents / 100).toFixed(2)}
                value={customAmount}
                onChange={(e) => onCustomAmountChange(e.target.value)}
                placeholder={(depositCents / 100).toFixed(2)}
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
            {paymentAmount === 'deposit' &&
              `Pay ${formatCurrency(depositCents)} now, ${formatCurrency(balanceCents)} at event`}
            {paymentAmount === 'full' &&
              `Pay ${formatCurrency(totalCents)} now, nothing at event`}
            {paymentAmount === 'custom' && customAmount &&
              `Pay $${customAmount} now, ${formatCurrency(
                totalCents - Math.round(parseFloat(customAmount) * 100)
              )} at event`}
            {paymentAmount === 'custom' &&
              !customAmount &&
              'Enter amount to see payment breakdown'}
          </p>
          {showApprovalNote && (
            <p className="text-xs text-blue-700 mt-1">
              All bookings require admin approval before payment is processed
            </p>
          )}
        </div>
      </div>
    </>
  );

  if (showCard) {
    return <div className="bg-white rounded-xl shadow-md p-6">{content}</div>;
  }

  return <div className="mb-8">{content}</div>;
}
