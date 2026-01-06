import { PaymentAmountSelector as SharedPaymentAmountSelector } from '../shared/PaymentAmountSelector';
import type { PriceBreakdown } from '../../lib/pricing';

interface PaymentAmountSelectorProps {
  paymentAmount: 'deposit' | 'full' | 'custom';
  customAmount: string;
  priceBreakdown: PriceBreakdown;
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
    <SharedPaymentAmountSelector
      depositCents={priceBreakdown.deposit_due_cents}
      totalCents={priceBreakdown.total_cents}
      paymentAmount={paymentAmount}
      customAmount={customAmount}
      onPaymentAmountChange={onPaymentAmountChange}
      onCustomAmountChange={onCustomAmountChange}
      showCard={true}
      showApprovalNote={true}
      icon="dollar"
    />
  );
}
