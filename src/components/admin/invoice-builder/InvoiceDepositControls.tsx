import { DepositOverride } from '../../order-detail/DepositOverride';

interface Props {
  calculatedDepositCents: number;
  customDepositCents: number | null;
  customDepositInput: string;
  setCustomDepositInput: (value: string) => void;
  setCustomDepositCents: (value: number | null) => void;
  setRequireCardOnFile: (value: boolean) => void;
}

// Wires the existing DepositOverride to InvoiceBuilder's state. Apply/clear also update
// requireCardOnFile exactly as before. InvoiceBuilder owns all of this state.
export function InvoiceDepositControls({
  calculatedDepositCents,
  customDepositCents,
  customDepositInput,
  setCustomDepositInput,
  setCustomDepositCents,
  setRequireCardOnFile,
}: Props) {
  return (
    <DepositOverride
      calculatedDepositCents={calculatedDepositCents}
      customDepositCents={customDepositCents}
      customDepositInput={customDepositInput}
      onInputChange={setCustomDepositInput}
      onApply={(amountCents) => {
        setCustomDepositCents(amountCents);
        if (amountCents > 0) setRequireCardOnFile(true);
      }}
      onClear={() => {
        setCustomDepositCents(null);
        setCustomDepositInput('');
        setRequireCardOnFile(true);
      }}
      compact={true}
      showZeroHint={true}
    />
  );
}
