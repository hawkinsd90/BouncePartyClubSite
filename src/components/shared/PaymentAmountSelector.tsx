import { useState } from 'react';
import { DollarSign, CreditCard } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { validateCustomAmount } from '../../lib/validation';

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
  const [customAmountError, setCustomAmountError] = useState<string>();
  const balanceCents = totalCents - depositCents;
  const IconComponent = icon === 'credit-card' ? CreditCard : DollarSign;

  const handleCustomAmountChange = (value: string) => {
    onCustomAmountChange(value);
    if (value) {
      const validation = validateCustomAmount(value, depositCents / 100, totalCents / 100);
      setCustomAmountError(validation.isValid ? undefined : validation.error);
    } else {
      setCustomAmountError(undefined);
    }
  };

  const content = (
    <>
      <h2 className={`${showCard ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl'} font-bold text-slate-900 mb-${showCard ? '4 sm:mb-6' : '3 sm:mb-4'} flex items-center`}>
        <IconComponent className={`${showCard ? 'w-5 h-5 sm:w-6 sm:h-6' : 'w-5 h-5'} mr-2 text-green-600`} />
        Payment Amount
      </h2>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          <label
            className={`relative flex flex-col p-3 sm:p-4 border-2 rounded-lg cursor-pointer transition-all ${
              paymentAmount === 'deposit'
                ? 'border-blue-600 bg-blue-50'
                : 'border-slate-300 hover:border-blue-400 active:scale-[0.98]'
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
            <span className="text-sm sm:text-base font-semibold text-slate-900">Minimum Deposit</span>
            <span className="text-base sm:text-lg font-bold text-blue-600 mt-1">
              {formatCurrency(depositCents)}
            </span>
            <span className="text-xs text-slate-600 mt-1">Pay balance at event</span>
          </label>

          <label
            className={`relative flex flex-col p-3 sm:p-4 border-2 rounded-lg cursor-pointer transition-all ${
              paymentAmount === 'full'
                ? 'border-green-600 bg-green-50'
                : 'border-slate-300 hover:border-green-400 active:scale-[0.98]'
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
            <span className="text-sm sm:text-base font-semibold text-slate-900">Full Payment</span>
            <span className="text-base sm:text-lg font-bold text-green-600 mt-1">
              {formatCurrency(totalCents)}
            </span>
            <span className="text-xs text-slate-600 mt-1">Nothing due at event</span>
          </label>

          <label
            className={`relative flex flex-col p-3 sm:p-4 border-2 rounded-lg cursor-pointer transition-all sm:col-span-2 md:col-span-1 ${
              paymentAmount === 'custom'
                ? 'border-teal-600 bg-teal-50'
                : 'border-slate-300 hover:border-teal-400 active:scale-[0.98]'
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
            <span className="text-sm sm:text-base font-semibold text-slate-900">Custom Amount</span>
            <span className="text-xs sm:text-sm text-slate-600 mt-1">Choose your amount</span>
          </label>
        </div>

        {paymentAmount === 'custom' && (
          <div className="p-3 sm:p-4 bg-slate-50 rounded-lg border border-slate-200">
            <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">
              Payment Amount <span className="text-red-500">*</span> (Min: {formatCurrency(depositCents)})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-600 text-sm sm:text-base">$</span>
              <input
                type="number"
                step="0.01"
                min={(depositCents / 100).toFixed(2)}
                max={(totalCents / 100).toFixed(2)}
                value={customAmount}
                onChange={(e) => handleCustomAmountChange(e.target.value)}
                placeholder={(depositCents / 100).toFixed(2)}
                className={`w-full pl-7 sm:pl-8 pr-4 py-2 sm:py-2.5 text-sm sm:text-base border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent ${
                  customAmountError ? 'border-red-300 bg-red-50' : 'border-slate-300'
                }`}
                required={paymentAmount === 'custom'}
              />
            </div>
            {customAmountError && (
              <p className="text-xs sm:text-sm text-red-600 mt-1">{customAmountError}</p>
            )}
            {!customAmountError && (
              <p className="text-xs text-slate-500 mt-2">
                Enter any amount between the minimum deposit and the full total
              </p>
            )}
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-blue-900 font-medium mb-1">
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
