import { useState, useCallback } from 'react';
import { Zap, Minus, Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface LegacyGeneratorEditorProps {
  generatorQty: number;
  generatorFeeCents: number;
  generatorFeeWaived: boolean;
  generatorFeeWaiveReason?: string;
  onQtyChange: (newQty: number) => void;
  onWaiverToggle: () => void;
  onWaiverReasonChange: (reason: string) => void;
}

export function LegacyGeneratorEditor({ generatorQty, generatorFeeCents, generatorFeeWaived, generatorFeeWaiveReason, onQtyChange, onWaiverToggle, onWaiverReasonChange }: LegacyGeneratorEditorProps) {
  const [showIncreaseWarning, setShowIncreaseWarning] = useState(false);

  const handleDecrease = useCallback(() => onQtyChange(Math.max(0, generatorQty - 1)), [generatorQty, onQtyChange]);
  const handleRemove = useCallback(() => onQtyChange(0), [onQtyChange]);
  const handleIncrease = useCallback(() => setShowIncreaseWarning(true), []);

  if (generatorQty <= 0) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <Zap className="w-5 h-5 text-amber-600" /> Legacy Generator
      </h3>
      {showIncreaseWarning && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-800">Use Add Generator to add additional Generators. The legacy editor can only decrease or remove existing legacy Generator quantity.</p>
          <button onClick={() => setShowIncreaseWarning(false)} className="mt-2 text-xs font-medium text-amber-700 hover:text-amber-900">Dismiss</button>
        </div>
      )}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div><p className="text-sm font-medium text-slate-700">Current Quantity</p><p className="text-2xl font-bold text-slate-900">{generatorQty}</p></div>
          <div className="text-right"><p className="text-sm font-medium text-slate-700">Fee</p><p className="text-lg font-semibold text-slate-900">{generatorFeeWaived ? <span className="line-through text-slate-400">{formatCurrency(generatorFeeCents)}</span> : formatCurrency(generatorFeeCents)}</p>{generatorFeeWaived && <span className="text-xs text-green-700 font-medium">Waived</span>}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleDecrease} className="flex items-center gap-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium"><Minus className="w-3 h-3" />Decrease</button>
          <button onClick={handleIncrease} className="flex items-center gap-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium"><Plus className="w-3 h-3" />Increase</button>
          <button onClick={handleRemove} className="flex items-center gap-1 bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-lg text-sm font-medium"><Trash2 className="w-3 h-3" />Remove</button>
        </div>
        <div className="border-t border-slate-200 pt-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={generatorFeeWaived} onChange={onWaiverToggle} className="w-4 h-4" />
            <span className="text-sm font-medium text-slate-700">Waive Generator Fee</span>
          </label>
          {generatorFeeWaived && <input type="text" value={generatorFeeWaiveReason || ''} onChange={(e) => onWaiverReasonChange(e.target.value)} placeholder="Reason for waiver (optional)" className="mt-2 w-full px-3 py-1.5 border border-slate-300 rounded text-sm" />}
        </div>
      </div>
    </div>
  );
}
