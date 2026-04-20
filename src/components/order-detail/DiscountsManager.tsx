import { useState } from 'react';
import { Trash2, Pencil, Check, X } from 'lucide-react';
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

interface EditDraft {
  name: string;
  amountInput: string;
  percentInput: string;
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

  // Inline edit state — tracks which existing row is open and its draft values
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ name: '', amountInput: '0.00', percentInput: '0' });

  function startEdit(discount: any) {
    setEditingId(discount.id);
    setEditDraft({
      name: discount.name,
      amountInput: discount.amount_cents > 0 ? (discount.amount_cents / 100).toFixed(2) : '0.00',
      percentInput: (discount.percentage || 0) > 0 ? String(discount.percentage) : '0',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({ name: '', amountInput: '0.00', percentInput: '0' });
  }

  function saveEdit(discountId: string) {
    const name = editDraft.name.trim();
    if (!name) {
      showToast('Discount name cannot be blank', 'error');
      return;
    }

    const amount = dollarsToCents(editDraft.amountInput);
    const percentage = parseFloat(editDraft.percentInput) || 0;

    if (amount < 0 || percentage < 0) {
      showToast('Values cannot be negative', 'error');
      return;
    }
    if (amount === 0 && percentage === 0) {
      showToast('Please enter either an amount or percentage', 'error');
      return;
    }
    if (amount > 0 && percentage > 0) {
      showToast('Please enter either amount OR percentage, not both', 'error');
      return;
    }

    // Produce an updated row that preserves the original DB id and keeps is_new falsy
    const updated = discounts.map(d =>
      d.id === discountId
        ? { ...d, name, amount_cents: amount, percentage: percentage || 0 }
        : d
    );

    onDiscountChange(updated);
    onMarkChanges();
    cancelEdit();
  }

  function handleEditAmountChange(value: string) {
    setEditDraft(prev => ({ ...prev, amountInput: value }));
    if (parseFloat(value) > 0) {
      setEditDraft(prev => ({ ...prev, amountInput: value, percentInput: '0' }));
    }
  }

  function handleEditPercentChange(value: string) {
    setEditDraft(prev => ({ ...prev, percentInput: value }));
    if (parseFloat(value) > 0) {
      setEditDraft(prev => ({ ...prev, percentInput: value, amountInput: '0.00' }));
    }
  }

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
          .from('saved_discount_templates')
          .select('id')
          .eq('name', newDiscount.name)
          .maybeSingle();

        if (existing) {
          showToast(`A discount template with the name "${newDiscount.name}" already exists. Please choose a different name.`, 'error');
          return;
        }

        await supabase.from('saved_discount_templates').insert({
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
    if (editingId === discountId) cancelEdit();
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
        .from('saved_discount_templates')
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
            <div key={discount.id} className="bg-white rounded border border-slate-200">
              {editingId === discount.id ? (
                // ── Inline edit form ──────────────────────────────────────────
                <div className="p-3 space-y-2">
                  <input
                    type="text"
                    value={editDraft.name}
                    onChange={e => setEditDraft(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Discount name"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">$ Amount</label>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editDraft.amountInput}
                          onChange={e => handleEditAmountChange(e.target.value)}
                          className="w-full pl-6 pr-2 py-1.5 border border-slate-300 rounded text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">% Percentage</label>
                      <div className="relative">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={editDraft.percentInput}
                          onChange={e => handleEditPercentChange(e.target.value)}
                          className="w-full pl-2 pr-6 py-1.5 border border-slate-300 rounded text-sm"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-sm">%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => saveEdit(discount.id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium"
                    >
                      <Check className="w-3 h-3" /> Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded text-xs font-medium"
                    >
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                // ── Read-only row ─────────────────────────────────────────────
                <div className="flex justify-between items-center p-2">
                  <div>
                    <p className="font-medium text-sm">{discount.name}</p>
                    <p className="text-xs text-slate-600">
                      {discount.amount_cents > 0 ? formatCurrency(discount.amount_cents) : `${discount.percentage}%`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEdit(discount)}
                      className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded"
                      title="Edit discount"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleRemoveDiscount(discount.id)}
                      className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                      title="Remove discount"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
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
