import { formatCurrency } from '../../lib/pricing';
import { showToast } from '../../lib/notifications';
import { dollarsToCents } from '../../lib/utils';

interface DepositOverrideProps {
  calculatedDepositCents: number;
  customDepositCents: number | null;
  customDepositInput: string;
  onInputChange: (value: string) => void;
  onApply: ((amountCents: number) => void) | (() => void);
  onClear: () => void;
  compact?: boolean;
  showZeroHint?: boolean;
}

export function DepositOverride({
  calculatedDepositCents,
  customDepositCents,
  customDepositInput,
  onInputChange,
  onApply,
  onClear,
  compact = false,
  showZeroHint = false,
}: DepositOverrideProps) {
  function handleApply() {
    const inputValue = customDepositInput.trim();
    if (inputValue === '' && !showZeroHint) {
      showToast('Please enter a deposit amount', 'error');
      return;
    }
    const amountCents = dollarsToCents(inputValue || '0');
    if (isNaN(amountCents) || amountCents < 0) {
      showToast('Please enter a valid deposit amount', 'error');
      return;
    }

    if (onApply.length === 1) {
      (onApply as (amountCents: number) => void)(amountCents);
    } else {
      (onApply as () => void)();
    }
  }

  if (compact) {
    return (
      <div className="bg-amber-50 rounded-lg shadow p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
          Deposit Override
        </h3>
        <p className="text-sm text-slate-600 mb-4">
          Set a custom deposit amount. Use this when the calculated deposit doesn't match your requirements.
        </p>
        <div className="bg-white p-3 rounded border border-amber-200 mb-3">
          <p className="text-sm text-slate-700">
            <strong>Calculated Deposit:</strong> {formatCurrency(calculatedDepositCents)}
          </p>
        </div>
        {customDepositCents === null ? (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Custom Deposit Amount
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-600">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={customDepositInput}
                  onChange={(e) => onInputChange(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg"
                  placeholder="0.00"
                />
              </div>
              {showZeroHint && (
                <p className="text-xs text-slate-500 mt-1">
                  Set to $0 for acceptance-only invoices (no payment required)
                </p>
              )}
            </div>
            <button
              onClick={handleApply}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-lg text-sm transition-colors"
            >
              Apply
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-white p-3 rounded border border-amber-200">
              <p className="text-sm text-slate-700">
                <strong>Custom Deposit:</strong> {formatCurrency(customDepositCents)}
              </p>
              {customDepositCents === 0 && showZeroHint && (
                <p className="text-xs text-amber-700 mt-1">
                  Customer will only need to accept (no payment required)
                </p>
              )}
            </div>
            <button
              onClick={onClear}
              className="w-full bg-slate-200 hover:bg-slate-300 text-slate-700 py-2 rounded-lg text-sm transition-colors"
            >
              Clear Override
            </button>
          </div>
        )}
      </div>
    );
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
