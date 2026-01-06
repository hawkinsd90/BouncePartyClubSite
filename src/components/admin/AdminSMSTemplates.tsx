import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Edit2 } from 'lucide-react';
import { notifyError, notifySuccess } from '../../lib/notifications';
import { TextareaInput } from '../forms/TextareaInput';

interface SMSTemplate {
  id: string;
  template_name: string;
  description: string;
  message_template: string;
}

interface AdminSMSTemplatesProps {
  templates: SMSTemplate[];
  onRefetch: () => void;
}

const TEMPLATE_VARIABLES = [
  '{customer_first_name}',
  '{customer_last_name}',
  '{customer_full_name}',
  '{order_id}',
  '{event_date}',
  '{total_amount}',
  '{balance_amount}',
  '{rejection_reason}',
];

export function AdminSMSTemplates({ templates, onRefetch }: AdminSMSTemplatesProps) {
  const [editingTemplate, setEditingTemplate] = useState<SMSTemplate | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);

  async function handleSaveTemplate() {
    if (!editingTemplate) return;

    setSavingTemplate(true);
    try {
      const { error } = await supabase
        .from('sms_message_templates')
        .update({ message_template: editingTemplate.message_template })
        .eq('id', editingTemplate.id);

      if (error) throw error;

      notifySuccess('Template saved successfully!');
      setEditingTemplate(null);
      await onRefetch();
    } catch (error) {
      console.error('Error saving template:', error);
      notifyError('Failed to save template. Please try again.');
    } finally {
      setSavingTemplate(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">SMS Message Templates</h2>

      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-slate-700 mb-2">
          Customize the SMS messages sent to customers. Use these variables in your templates:
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          {TEMPLATE_VARIABLES.map((variable) => (
            <code
              key={variable}
              className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono"
            >
              {variable}
            </code>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {templates.map((template) => (
          <div key={template.id} className="border border-slate-200 rounded-lg p-4">
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="font-semibold text-slate-900">{template.template_name}</h3>
                <p className="text-sm text-slate-600">{template.description}</p>
              </div>
              <button
                onClick={() => setEditingTemplate(template)}
                className="inline-flex items-center px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                <Edit2 className="w-3 h-3 mr-1.5" />
                Edit
              </button>
            </div>
            <div className="mt-3 p-3 bg-slate-50 rounded border border-slate-200">
              <p className="text-sm text-slate-700 font-mono whitespace-pre-wrap">{template.message_template}</p>
            </div>
          </div>
        ))}
      </div>

      {editingTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Edit Template: {editingTemplate.template_name}</h3>

            <div className="mb-4">
              <TextareaInput
                label="Message Template"
                value={editingTemplate.message_template}
                onChange={(value) => setEditingTemplate({ ...editingTemplate, message_template: value })}
                rows={6}
                className="font-mono"
              />
            </div>

            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs font-medium text-slate-700 mb-2">Available Variables:</p>
              <div className="flex flex-wrap gap-2">
                {TEMPLATE_VARIABLES.slice(0, 6).map((variable) => (
                  <code
                    key={variable}
                    className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono"
                  >
                    {variable}
                  </code>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSaveTemplate}
                disabled={savingTemplate}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                {savingTemplate ? 'Saving...' : 'Save Template'}
              </button>
              <button
                onClick={() => setEditingTemplate(null)}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
