import { useState } from 'react';
import { Trash2, Pencil, Check, X } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { showToast } from '../../lib/notifications';
import { supabase } from '../../lib/supabase';
import { useFeeTemplates } from '../../hooks/useFeeTemplates';
import { dollarsToCents } from '../../lib/utils';

interface CustomFeesManagerProps {
  customFees: any[];
  onFeeChange: (fees: any[]) => void;
  onMarkChanges: () => void;
}

interface FeeDraft {
  name: string;
  amountInput: string;
}

export function CustomFeesManager({
  customFees,
  onFeeChange,
  onMarkChanges,
}: CustomFeesManagerProps) {
  const { templates: savedTemplates, reload: reloadTemplates } = useFeeTemplates();
  const [newCustomFee, setNewCustomFee] = useState({ name: '', amount_cents: 0 });
  const [customFeeInput, setCustomFeeInput] = useState('0.00');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<FeeDraft>({ name: '', amountInput: '0.00' });

  function startEdit(fee: any) {
    setEditingId(fee.id);
    setEditDraft({
      name: fee.name,
      amountInput: (fee.amount_cents / 100).toFixed(2),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({ name: '', amountInput: '0.00' });
  }

  function saveEdit(feeId: string) {
    const name = editDraft.name.trim();
    if (!name) {
      showToast('Fee name cannot be blank', 'error');
      return;
    }

    const amount = dollarsToCents(editDraft.amountInput);
    if (amount <= 0) {
      showToast('Please enter a valid fee amount greater than zero', 'error');
      return;
    }

    // Preserve the real DB id; keep is_new falsy so save layer runs UPDATE
    const updated = customFees.map(f =>
      f.id === feeId ? { ...f, name, amount_cents: amount } : f
    );

    onFeeChange(updated);
    onMarkChanges();
    cancelEdit();
  }

  async function handleAddFee() {
    if (!newCustomFee.name.trim()) {
      showToast('Please enter a fee name', 'error');
      return;
    }

    const amount = dollarsToCents(customFeeInput);

    if (amount <= 0) {
      showToast('Please enter a valid fee amount', 'error');
      return;
    }

    if (saveAsTemplate) {
      try {
        const { data: existing } = await supabase
          .from('saved_fee_templates')
          .select('id')
          .eq('name', newCustomFee.name)
          .maybeSingle();

        if (existing) {
          showToast(`A fee template with the name "${newCustomFee.name}" already exists. Please choose a different name.`, 'error');
          return;
        }

        await supabase.from('saved_fee_templates').insert({
          name: newCustomFee.name,
          amount_cents: amount,
        });
        await reloadTemplates();
      } catch (error) {
        console.error('Error saving fee template:', error);
        showToast('Failed to save fee template', 'error');
        return;
      }
    }

    const newFeeItem = {
      id: `temp_${Date.now()}`,
      name: newCustomFee.name,
      amount_cents: amount,
      is_new: true,
    };

    onFeeChange([...customFees, newFeeItem]);
    setNewCustomFee({ name: '', amount_cents: 0 });
    setCustomFeeInput('0.00');
    setSaveAsTemplate(false);
    onMarkChanges();
  }

  function handleRemoveFee(feeId: string) {
    if (!confirm('Remove this fee?')) return;
    if (editingId === feeId) cancelEdit();
    onFeeChange(customFees.filter(f => f.id !== feeId));
    onMarkChanges();
  }

  async function handleDeleteTemplate() {
    if (!selectedTemplateId) {
      showToast('Please select a fee template first', 'error');
      return;
    }

    const template = savedTemplates.find(t => t.id === selectedTemplateId);
    if (!confirm(`Delete the fee template "${template?.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('saved_fee_templates')
        .delete()
        .eq('id', selectedTemplateId);

      if (error) throw error;

      setSelectedTemplateId('');
      await reloadTemplates();
      showToast('Fee template deleted successfully', 'success');
    } catch (error) {
      console.error('Error deleting fee template:', error);
      showToast('Failed to delete fee template', 'error');
    }
  }

  function handleTemplateSelect(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = savedTemplates.find(t => t.id === templateId);
    if (template) {
      const amountCents = template.fee_type === 'fixed' ? template.fee_value : 0;
      setNewCustomFee({ name: template.name, amount_cents: amountCents });
      setCustomFeeInput((amountCents / 100).toFixed(2));
    }
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
      <h3 className="text-sm sm:text-base font-semibold text-slate-900 mb-3">Custom Fees</h3>

      {customFees.length > 0 && (
        <div className="space-y-2 mb-4">
          {customFees.map(fee => (
            <div key={fee.id} className="bg-white rounded border border-slate-200">
              {editingId === fee.id ? (
                // ── Inline edit form ──────────────────────────────────────────
                <div className="p-3 space-y-2">
                  <input
                    type="text"
                    value={editDraft.name}
                    onChange={e => setEditDraft(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Fee name"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm"
                    autoFocus
                  />
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Fee Amount</label>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={editDraft.amountInput}
                        onChange={e => setEditDraft(prev => ({ ...prev, amountInput: e.target.value }))}
                        className="w-full pl-6 pr-2 py-1.5 border border-slate-300 rounded text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => saveEdit(fee.id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
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
                    <p className="font-medium text-sm">{fee.name}</p>
                    <p className="text-xs text-slate-600">{formatCurrency(fee.amount_cents)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEdit(fee)}
                      className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded"
                      title="Edit fee"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleRemoveFee(fee.id)}
                      className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                      title="Remove fee"
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
            <label className="block text-xs text-slate-700 mb-1 font-medium">Load Saved Fee</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={selectedTemplateId}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm"
              >
                <option value="">Select a saved fee...</option>
                {savedTemplates.map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name} - {template.fee_type === 'fixed' ? `$${(template.fee_value / 100).toFixed(2)}` : `${template.fee_value}%`}
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
          value={newCustomFee.name}
          onChange={(e) => setNewCustomFee({ ...newCustomFee, name: e.target.value })}
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
              onChange={(e) => setCustomFeeInput(e.target.value)}
              placeholder="0.00"
              className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={saveAsTemplate}
            onChange={(e) => setSaveAsTemplate(e.target.checked)}
            className="rounded"
          />
          Save this fee for future use
        </label>
        <button
          onClick={handleAddFee}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded text-sm font-medium"
        >
          Add Custom Fee
        </button>
      </div>
    </div>
  );
}
