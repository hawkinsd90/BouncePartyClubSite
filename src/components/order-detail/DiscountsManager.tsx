import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { showToast } from '../../lib/notifications';
import { supabase } from '../../lib/supabase';
import { useDiscountTemplates } from '../../hooks/useDiscountTemplates';
import { dollarsToCents } from '../../lib/utils';

interface DiscountsManagerProps {
  discounts: any[];
  onDiscountChange: (discounts: any[]) => void;
  onMarkChanges: () => void;
}

export function DiscountsManager({
  discounts,
  onDiscountChange,
  onMarkChanges,
}: DiscountsManagerProps) {
  const { templates: savedTemplates, reload: reloadTemplates } = useDiscountTemplates();
  const [newDiscount, setNewDiscount] = useState({ name: '', amount_cents: 0, percentage: 0 });
  const [discountAmountInput, setDiscountAmountInput] = useState('0.00');
  const [discountPercentInput, setDiscountPercentInput] = useState('0');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  async function handleAddDiscount() {
    if (!newDiscount.name.trim()) {
      showToast('Please enter a discount name', 'error');
      return;
    }

    const amount = dollarsToCents(discountAmountInput);
    const percentage = parseFloat(discountPercentInput);

    if (amount === 0 && percentage === 0) {
      showToast('Please enter either an amount or percentage', 'error');
      return;
    }

    if (amount > 0 && percentage > 0) {
      showToast('Please enter either amount OR percentage, not both', 'error');
      return;
    }

    if (saveAsTemplate) {
      try {
        const { data: existing } = await supabase
          .from('discount_templates')
          .select('id')
          .eq('name', newDiscount.name)
          .maybeSingle();

        if (existing) {
          showToast(`A discount template with the name "${newDiscount.name}" already exists. Please choose a different name.`, 'error');
          return;
        }

        await supabase.from('discount_templates').insert({
          name: newDiscount.name,
          amount_cents: amount,
          percentage: percentage || 0,
        });
        await reloadTemplates();
      } catch (error) {
        console.error('Error saving discount template:', error);
        showToast('Failed to save discount template', 'error');
        return;
      }
    }

    const newDiscountItem = {
      id: `temp_${Date.now()}`,
      name: newDiscount.name,
      amount_cents: amount,
      percentage: percentage || 0,
      is_new: true,
    };

    onDiscountChange([...discounts, newDiscountItem]);
    setNewDiscount({ name: '', amount_cents: 0, percentage: 0 });
    setDiscountAmountInput('0.00');
    setDiscountPercentInput('0');
    setSaveAsTemplate(false);
    onMarkChanges();
  }

  function handleRemoveDiscount(discountId: string) {
    if (!confirm('Remove this discount?')) return;
    onDiscountChange(discounts.filter(d => d.id !== discountId));
    onMarkChanges();
  }

  async function handleDeleteTemplate() {
    if (!selectedTemplateId) {
      showToast('Please select a discount template first', 'error');
      return;
    }

    const template = savedTemplates.find(t => t.id === selectedTemplateId);
    if (!confirm(`Delete the discount template "${template?.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('discount_templates')
        .delete()
        .eq('id', selectedTemplateId);

      if (error) throw error;

      setSelectedTemplateId('');
      await reloadTemplates();
      showToast('Discount template deleted successfully', 'success');
    } catch (error) {
      console.error('Error deleting discount template:', error);
      showToast('Failed to delete discount template', 'error');
    }
  }

  function handleTemplateSelect(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = savedTemplates.find(t => t.id === templateId);
    if (template) {
      const amountCents = template.discount_type === 'fixed' ? template.discount_value : 0;
      const percentage = template.discount_type === 'percentage' ? template.discount_value : 0;

      setNewDiscount({
        name: template.name,
        amount_cents: amountCents,
        percentage: percentage
      });
      setDiscountAmountInput((amountCents / 100).toFixed(2));
      setDiscountPercentInput(percentage.toString());
    }
  }

  function handleAmountInputChange(value: string) {
    setDiscountAmountInput(value);
    if (parseFloat(value) > 0) {
      setDiscountPercentInput('0');
    }
  }

  function handlePercentInputChange(value: string) {
    setDiscountPercentInput(value);
    if (parseFloat(value) > 0) {
      setDiscountAmountInput('0.00');
    }
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3 sm:p-4">
      <h3 className="text-sm sm:text-base font-semibold text-slate-900 mb-3">Discounts</h3>

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
                onClick={() => handleRemoveDiscount(discount.id)}
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
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={selectedTemplateId}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm"
              >
                <option value="">Select a saved discount...</option>
                {savedTemplates.map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name} - {template.discount_type === 'fixed' ? `$${(template.discount_value / 100).toFixed(2)}` : `${template.discount_value}%`}
                  </option>
                ))}
              </select>
              {selectedTemplateId && (
                <button
                  onClick={handleDeleteTemplate}
                  className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center justify-center gap-1 text-sm"
                  title="Delete selected template"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="sm:hidden">Delete Template</span>
                </button>
              )}
            </div>
          </div>
        )}
        <input
          type="text"
          value={newDiscount.name}
          onChange={(e) => setNewDiscount({ ...newDiscount, name: e.target.value })}
          placeholder="Discount name"
          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
          <div>
            <label className="block text-xs text-slate-700 mb-1 font-medium">$ Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                value={discountAmountInput}
                onChange={(e) => handleAmountInputChange(e.target.value)}
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
                onChange={(e) => handlePercentInputChange(e.target.value)}
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
            onChange={(e) => setSaveAsTemplate(e.target.checked)}
            className="rounded"
          />
          Save this discount for future use
        </label>
        <button
          onClick={handleAddDiscount}
          className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm font-medium"
        >
          Add Discount
        </button>
      </div>
    </div>
  );
}
