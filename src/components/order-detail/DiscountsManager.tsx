import { Trash2 } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface DiscountsManagerProps {
  discounts: any[];
  newDiscount: { name: string; amount_cents: number; percentage: number };
  discountAmountInput: string;
  discountPercentInput: string;
  savedTemplates: any[];
  selectedTemplateId: string;
  saveAsTemplate: boolean;
  onDiscountChange: (discount: { name: string; amount_cents: number; percentage: number }) => void;
  onAmountInputChange: (value: string) => void;
  onPercentInputChange: (value: string) => void;
  onTemplateSelect: (templateId: string) => void;
  onSaveAsTemplateChange: (checked: boolean) => void;
  onAddDiscount: () => void;
  onRemoveDiscount: (discountId: string) => void;
  onDeleteTemplate: () => void;
}

export function DiscountsManager({
  discounts,
  newDiscount,
  discountAmountInput,
  discountPercentInput,
  savedTemplates,
  selectedTemplateId,
  saveAsTemplate,
  onDiscountChange,
  onAmountInputChange,
  onPercentInputChange,
  onTemplateSelect,
  onSaveAsTemplateChange,
  onAddDiscount,
  onRemoveDiscount,
  onDeleteTemplate,
}: DiscountsManagerProps) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
      <h3 className="font-semibold text-slate-900 mb-3">Discounts</h3>

      {discounts.length > 0 && (
        <div className="space-y-2 mb-4">
          {discounts.map(discount => (
            <div key={discount.id} className="flex justify-between items-center bg-white rounded p-2">
              <div>
                <p className="font-medium text-sm">{discount.name}</p>
                <p className="text-xs text-slate-600">
                  {discount.amount_cents > 0 ? formatCurrency(discount.amount_cents) : `${discount.percentage}%`}
                </p>
              </div>
              <button
                onClick={() => onRemoveDiscount(discount.id)}
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
            <label className="block text-xs text-slate-700 mb-1 font-medium">Load Saved Discount</label>
            <div className="flex gap-2">
              <select
                value={selectedTemplateId}
                onChange={(e) => onTemplateSelect(e.target.value)}
                className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm"
              >
                <option value="">Select a saved discount...</option>
                {savedTemplates.map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name} - {template.amount_cents > 0 ? `$${(template.amount_cents / 100).toFixed(2)}` : `${template.percentage}%`}
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
          value={newDiscount.name}
          onChange={(e) => onDiscountChange({ ...newDiscount, name: e.target.value })}
          placeholder="Discount name"
          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-slate-700 mb-1 font-medium">$ Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                value={discountAmountInput}
                onChange={(e) => onAmountInputChange(e.target.value)}
                placeholder="0.00"
                className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-700 mb-1 font-medium">% Percentage</label>
            <div className="relative">
              <input
                type="number"
                step="1"
                value={discountPercentInput}
                onChange={(e) => onPercentInputChange(e.target.value)}
                placeholder="0"
                className="w-full pr-7 pl-3 py-2 border border-slate-300 rounded text-sm"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">%</span>
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={saveAsTemplate}
            onChange={(e) => onSaveAsTemplateChange(e.target.checked)}
            className="rounded"
          />
          Save this discount for future use
        </label>
        <button
          onClick={onAddDiscount}
          className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm font-medium"
        >
          Add Discount
        </button>
      </div>
    </div>
  );
}
