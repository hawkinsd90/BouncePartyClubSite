import { formatCurrency } from '../../lib/pricing';

interface DepositOverrideSectionProps {
  defaultDeposit: number;
  customDeposit: number | null;
  customDepositInput: string;
  onInputChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
}

export function DepositOverrideSection({
  defaultDeposit,
  customDeposit,
  customDepositInput,
  onInputChange,
  onApply,
  onClear,
}: DepositOverrideSectionProps) {
  return (
    <div className="bg-amber-50 rounded-lg shadow p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
        Deposit Override
      </h3>
      <p className="text-sm text-slate-600 mb-4">
        Set a custom deposit amount. Use this when the calculated deposit doesn't match your
        requirements.
      </p>
      <div className="bg-white p-3 rounded border border-amber-200 mb-3">
        <p className="text-sm text-slate-700">
          <strong>Calculated Deposit:</strong> {formatCurrency(defaultDeposit)}
        </p>
      </div>
      {customDeposit === null ? (
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
            <p className="text-xs text-slate-500 mt-1">
              Set to $0 for acceptance-only invoices (no payment required)
            </p>
          </div>
          <button
            onClick={onApply}
            className="w-full bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-lg text-sm transition-colors"
          >
            Apply
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-white p-3 rounded border border-amber-200">
            <p className="text-sm text-slate-700">
              <strong>Custom Deposit:</strong> {formatCurrency(customDeposit)}
            </p>
            {customDeposit === 0 && (
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
