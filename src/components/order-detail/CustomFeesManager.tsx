import { Trash2 } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface CustomFeesManagerProps {
  customFees: any[];
  newCustomFee: { name: string; amount_cents: number };
  customFeeInput: string;
  savedTemplates: any[];
  selectedTemplateId: string;
  saveAsTemplate: boolean;
  onFeeChange: (fee: { name: string; amount_cents: number }) => void;
  onFeeInputChange: (value: string) => void;
  onTemplateSelect: (templateId: string) => void;
  onSaveAsTemplateChange: (checked: boolean) => void;
  onAddFee: () => void;
  onRemoveFee: (feeId: string) => void;
  onDeleteTemplate: () => void;
}

export function CustomFeesManager({
  customFees,
  newCustomFee,
  customFeeInput,
  savedTemplates,
  selectedTemplateId,
  saveAsTemplate,
  onFeeChange,
  onFeeInputChange,
  onTemplateSelect,
  onSaveAsTemplateChange,
  onAddFee,
  onRemoveFee,
  onDeleteTemplate,
}: CustomFeesManagerProps) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <h3 className="font-semibold text-slate-900 mb-3">Custom Fees</h3>

      {customFees.length > 0 && (
        <div className="space-y-2 mb-4">
          {customFees.map(fee => (
            <div key={fee.id} className="flex justify-between items-center bg-white rounded p-2">
              <div>
                <p className="font-medium text-sm">{fee.name}</p>
                <p className="text-xs text-slate-600">
                  {formatCurrency(fee.amount_cents)}
                </p>
              </div>
              <button
                onClick={() => onRemoveFee(fee.id)}
                className="text-red-600 hover:text-red-800"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {savedTemplates.length > 0 && (
          <div>
            <label className="block text-xs text-slate-700 mb-1 font-medium">Load Saved Fee</label>
            <div className="flex gap-2">
              <select
                value={selectedTemplateId}
                onChange={(e) => onTemplateSelect(e.target.value)}
                className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm"
              >
                <option value="">Select a saved fee...</option>
                {savedTemplates.map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name} - ${(template.amount_cents / 100).toFixed(2)}
                  </option>
                ))}
              </select>
              {selectedTemplateId && (
                <button
                  onClick={onDeleteTemplate}
                  className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1 text-sm"
                  title="Delete selected template"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}
        <input
          type="text"
          value={newCustomFee.name}
          onChange={(e) => onFeeChange({ ...newCustomFee, name: e.target.value })}
          placeholder="Fee name (e.g., Tip, Setup Fee, etc.)"
          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
        />
        <div>
          <label className="block text-xs text-slate-700 mb-1 font-medium">Fee Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
            <input
              type="number"
              step="0.01"
              value={customFeeInput}
              onChange={(e) => onFeeInputChange(e.target.value)}
              placeholder="0.00"
              className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={saveAsTemplate}
            onChange={(e) => onSaveAsTemplateChange(e.target.checked)}
            className="rounded"
          />
          Save this fee for future use
        </label>
        <button
          onClick={onAddFee}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded text-sm font-medium"
        >
          Add Custom Fee
        </button>
      </div>
    </div>
  );
}
