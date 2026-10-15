interface SetupFeePricing {
  setup_fee_cents?: number;
  setup_fee_before_override_cents?: number;
}

interface Props {
  calculatedPricing: SetupFeePricing | null;
  customSetupFeeCents: number | null;
  customSetupFeeInput: string;
  setCustomSetupFeeCents: (value: number | null) => void;
  setCustomSetupFeeInput: (value: string) => void;
}

// InvoiceBuilder owns the override state; this renders the card and applies/clears through its setters.
export function InvoiceSetupFeeOverride({
  calculatedPricing,
  customSetupFeeCents,
  customSetupFeeInput,
  setCustomSetupFeeCents,
  setCustomSetupFeeInput,
}: Props) {
  if (!((calculatedPricing?.setup_fee_before_override_cents || 0) > 0 || customSetupFeeCents !== null)) return null;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Setup Fee</span>
        <span className="text-sm font-semibold text-slate-900">
          ${(((customSetupFeeCents !== null ? customSetupFeeCents : calculatedPricing?.setup_fee_cents) || 0) / 100).toFixed(2)}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        Calculated: ${((calculatedPricing?.setup_fee_before_override_cents || 0) / 100).toFixed(2)}
      </p>
      <div className="flex gap-2">
        <input
          type="number"
          value={customSetupFeeInput}
          onChange={(e) => setCustomSetupFeeInput(e.target.value)}
          placeholder="Custom amount"
          className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          min="0"
          step="0.01"
        />
        <button
          type="button"
          onClick={() => {
            const dollars = parseFloat(customSetupFeeInput);
            if (!isNaN(dollars) && dollars >= 0) {
              setCustomSetupFeeCents(Math.round(dollars * 100));
            }
          }}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => {
            setCustomSetupFeeCents(null);
            setCustomSetupFeeInput('');
          }}
          className="px-3 py-1.5 text-sm bg-slate-200 text-slate-700 rounded-md hover:bg-slate-300"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
