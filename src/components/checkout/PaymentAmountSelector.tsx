import { PaymentAmountSelector as SharedPaymentAmountSelector } from '../shared/PaymentAmountSelector';

interface PaymentAmountSelectorProps {
  paymentAmount: 'deposit' | 'full' | 'custom';
  customAmount: string;
  depositCents: number;
  totalCents: number;
  onPaymentAmountChange: (amount: 'deposit' | 'full' | 'custom') => void;
  onCustomAmountChange: (amount: string) => void;
}

export function PaymentAmountSelector({
  paymentAmount,
  customAmount,
  depositCents,
  totalCents,
  onPaymentAmountChange,
  onCustomAmountChange,
}: PaymentAmountSelectorProps) {
  return (
    <SharedPaymentAmountSelector
      depositCents={depositCents}
      totalCents={totalCents}
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
