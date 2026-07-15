import { CreditCard, Ban } from 'lucide-react';

interface CardOnFileRequirementProps {
  requireCardOnFile: boolean;
  onChange: (required: boolean) => void;
  disabled?: boolean;
}

export function CardOnFileRequirement({ requireCardOnFile, onChange, disabled }: CardOnFileRequirementProps) {
  return (
    <div className={`rounded-xl border-2 p-4 sm:p-6 shadow-md ${
      requireCardOnFile
        ? 'bg-blue-50 border-blue-400'
        : 'bg-amber-50 border-amber-400'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        <CreditCard className={`w-5 h-5 flex-shrink-0 ${requireCardOnFile ? 'text-blue-600' : 'text-amber-600'}`} />
        <h3 className={`text-base sm:text-lg font-bold ${requireCardOnFile ? 'text-blue-900' : 'text-amber-900'}`}>
          Card on File Requirement
        </h3>
        <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${
          requireCardOnFile
            ? 'bg-blue-200 text-blue-800'
            : 'bg-amber-200 text-amber-800'
        }`}>
          {requireCardOnFile ? 'Card Required' : 'No Card Needed'}
        </span>
      </div>
      <p className={`text-sm mb-4 ${requireCardOnFile ? 'text-blue-700' : 'text-amber-700'}`}>
        Deposit is waived ($0). Do you still require the customer to save a card on file?
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(true)}
          className={`flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 text-sm font-semibold transition-all ${
            requireCardOnFile
              ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
              : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50'
          }`}
        >
          <CreditCard className="w-4 h-4 flex-shrink-0" />
          <span>Require Card</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(false)}
          className={`flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 text-sm font-semibold transition-all ${
            !requireCardOnFile
              ? 'border-amber-500 bg-amber-500 text-white shadow-sm'
              : 'border-slate-300 bg-white text-slate-700 hover:border-amber-400 hover:bg-amber-50'
          }`}
        >
          <Ban className="w-4 h-4 flex-shrink-0" />
          <span>No Card Needed</span>
        </button>
      </div>
      <p className={`text-xs mt-3 font-medium ${requireCardOnFile ? 'text-blue-700' : 'text-amber-700'}`}>
        {requireCardOnFile
          ? 'Customer will be directed to Stripe to save a card on file (no charge today).'
          : 'Customer can accept the invoice without entering any payment info. Full balance is owed on event day.'}
      </p>
    </div>
  );
}
