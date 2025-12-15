import { DollarSign } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface TipSectionProps {
  tipAmount: 'none' | '10' | '15' | '20' | 'custom';
  customTip: string;
  totalCents: number;
  tipCents: number;
  onTipAmountChange: (amount: 'none' | '10' | '15' | '20' | 'custom') => void;
  onCustomTipChange: (amount: string) => void;
}

export function TipSection({
  tipAmount,
  customTip,
  totalCents,
  tipCents,
  onTipAmountChange,
  onCustomTipChange,
}: TipSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
        <DollarSign className="w-6 h-6 mr-2 text-green-600" />
        Add Tip for Crew
      </h2>
      <p className="text-slate-600 mb-4 text-sm">
        Show your appreciation for our crew! Tips are optional but greatly appreciated.
      </p>
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
            tipAmount === 'none' ? 'border-slate-600 bg-slate-50' : 'border-slate-300 hover:border-slate-400'
          }`}>
            <input
              type="radio"
              name="tipAmount"
              value="none"
              checked={tipAmount === 'none'}
              onChange={(e) => onTipAmountChange(e.target.value as any)}
              className="sr-only"
            />
            <span className="font-semibold text-slate-900">No Tip</span>
            <span className="text-sm text-slate-600 mt-1">$0.00</span>
          </label>

          <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
            tipAmount === '10' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
          }`}>
            <input
              type="radio"
              name="tipAmount"
              value="10"
              checked={tipAmount === '10'}
              onChange={(e) => onTipAmountChange(e.target.value as any)}
              className="sr-only"
            />
            <span className="font-semibold text-slate-900">10%</span>
            <span className="text-sm text-green-600 mt-1">
              {formatCurrency(Math.round(totalCents * 0.1))}
            </span>
          </label>

          <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
            tipAmount === '15' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
          }`}>
            <input
              type="radio"
              name="tipAmount"
              value="15"
              checked={tipAmount === '15'}
              onChange={(e) => onTipAmountChange(e.target.value as any)}
              className="sr-only"
            />
            <span className="font-semibold text-slate-900">15%</span>
            <span className="text-sm text-green-600 mt-1">
              {formatCurrency(Math.round(totalCents * 0.15))}
            </span>
          </label>

          <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
            tipAmount === '20' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
          }`}>
            <input
              type="radio"
              name="tipAmount"
              value="20"
              checked={tipAmount === '20'}
              onChange={(e) => onTipAmountChange(e.target.value as any)}
              className="sr-only"
            />
            <span className="font-semibold text-slate-900">20%</span>
            <span className="text-sm text-green-600 mt-1">
              {formatCurrency(Math.round(totalCents * 0.2))}
            </span>
          </label>
        </div>

        <label className={`relative flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
          tipAmount === 'custom' ? 'border-purple-600 bg-purple-50' : 'border-slate-300 hover:border-purple-400'
        }`}>
          <input
            type="radio"
            name="tipAmount"
            value="custom"
            checked={tipAmount === 'custom'}
            onChange={(e) => onTipAmountChange(e.target.value as any)}
            className="sr-only"
          />
          <span className="font-semibold text-slate-900 flex-grow">Custom Amount</span>
          {tipAmount === 'custom' && (
            <div className="relative ml-4">
              <span className="absolute left-3 top-2 text-slate-600">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={customTip}
                onChange={(e) => onCustomTipChange(e.target.value)}
                placeholder="0.00"
                className="w-32 pl-8 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </label>

        {tipCents > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-sm text-green-900">
              Thank you for tipping {formatCurrency(tipCents)}! Your crew will greatly appreciate it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
