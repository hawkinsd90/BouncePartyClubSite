import { PaymentAmountSelector as SharedPaymentAmountSelector } from '../shared/PaymentAmountSelector';

interface PaymentAmountSelectorProps {
  depositCents: number;
  balanceCents: number;
  paymentAmount: 'deposit' | 'full' | 'custom';
  customAmount: string;
  onPaymentAmountChange: (amount: 'deposit' | 'full' | 'custom') => void;
  onCustomAmountChange: (amount: string) => void;
}

export function PaymentAmountSelector({
  depositCents,
  balanceCents,
  paymentAmount,
  customAmount,
  onPaymentAmountChange,
  onCustomAmountChange,
}: PaymentAmountSelectorProps) {
  return (
    <SharedPaymentAmountSelector
      depositCents={depositCents}
      totalCents={depositCents + balanceCents}
      paymentAmount={paymentAmount}
      customAmount={customAmount}
      onPaymentAmountChange={onPaymentAmountChange}
      onCustomAmountChange={onCustomAmountChange}
      showCard={false}
      showApprovalNote={false}
      icon="credit-card"
    />
  );
}
