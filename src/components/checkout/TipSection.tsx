import { DollarSign } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { TipSelector } from '../TipSelector';

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
      <TipSelector
        totalCents={totalCents}
        tipAmount={tipAmount}
        customTipAmount={customTip}
        onTipAmountChange={onTipAmountChange}
        onCustomTipAmountChange={onCustomTipChange}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}
