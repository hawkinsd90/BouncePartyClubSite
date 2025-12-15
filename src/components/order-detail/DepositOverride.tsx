import { formatCurrency } from '../../lib/pricing';
import { showToast } from '../../lib/notifications';

interface DepositOverrideProps {
  calculatedDepositCents: number;
  customDepositCents: number | null;
  customDepositInput: string;
  onInputChange: (value: string) => void;
  onApply: (amountCents: number) => void;
  onClear: () => void;
}

export function DepositOverride({
  calculatedDepositCents,
  customDepositCents,
  customDepositInput,
  onInputChange,
  onApply,
  onClear,
}: DepositOverrideProps) {
  function handleApply() {
    const inputValue = customDepositInput.trim();
    if (inputValue === '') {
      showToast('Please enter a deposit amount', 'error');
      return;
    }
    const amountCents = Math.round(parseFloat(inputValue) * 100);
    if (isNaN(amountCents) || amountCents < 0) {
      showToast('Please enter a valid deposit amount', 'error');
      return;
    }
    onApply(amountCents);
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <h3 className="font-semibold text-slate-900 mb-3">Deposit Override</h3>
      <p className="text-sm text-slate-600 mb-3">
        Set a custom deposit amount. Use this when the calculated deposit doesn't match your requirements.
      </p>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-700">Calculated Deposit:</span>
          <span className="font-semibold">{formatCurrency(calculatedDepositCents)}</span>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-slate-600 mb-1">Custom Deposit Amount</label>
            <input
              type="number"
              step="0.01"
              value={customDepositInput}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={handleApply}
              className="bg-amber-600 hover:bg-amber-700 text-white py-2 px-4 rounded text-sm font-medium"
            >
              Apply
            </button>
            {customDepositCents !== null && (
              <button
                onClick={onClear}
                className="bg-slate-500 hover:bg-slate-600 text-white py-2 px-4 rounded text-sm font-medium"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {customDepositCents !== null && (
          <div className="bg-white border border-amber-300 rounded p-3">
            <p className="text-sm font-medium text-amber-800 mb-1">Active Override</p>
            <p className="text-xs text-slate-600">
              Deposit will be set to <span className="font-semibold">{formatCurrency(customDepositCents)}</span> when you save changes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
