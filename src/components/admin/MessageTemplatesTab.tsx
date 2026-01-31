import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Mail, MessageSquare, Edit2, Save, X, Info, Copy } from 'lucide-react';
import { notifyError, notifySuccess } from '../../lib/notifications';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { TextareaInput } from '../forms/TextareaInput';
import { TextInput } from '../forms/TextInput';

interface SMSTemplate {
  id: string;
  template_name: string;
  description: string | null;
  message_body: string;
}

interface EmailTemplate {
  id: string;
  template_name: string;
  subject: string;
  description: string;
  header_title: string;
  content_template: string;
  theme: string;
  category: string;
}

const SMS_VARIABLES = [
  '{customer_first_name}',
  '{customer_last_name}',
  '{customer_full_name}',
  '{order_id}',
  '{event_date}',
  '{total_amount}',
  '{balance_amount}',
  '{rejection_reason}',
  '{eta_time}',
  '{eta_distance}',
];

const EMAIL_VARIABLES = [
  '{customer_first_name}',
  '{customer_last_name}',
  '{customer_full_name}',
  '{order_id}',
  '{event_date}',
  '{event_address}',
  '{total_amount}',
  '{balance_amount}',
  '{payment_amount}',
  '{payment_type}',
  '{rejection_reason}',
  '{error_message}',
  '{error_context}',
  '{timestamp}',
];

export function MessageTemplatesTab() {
  const [smsTemplates, setSmsTemplates] = useState<SMSTemplate[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSMS, setEditingSMS] = useState<SMSTemplate | null>(null);
  const [editingEmail, setEditingEmail] = useState<EmailTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'sms' | 'email'>('sms');

  useEffect(() => {
    fetchTemplates();
  }, []);

  async function fetchTemplates() {
    setLoading(true);
    try {
      const [smsRes, emailRes] = await Promise.all([
        supabase.from('sms_message_templates').select('*').order('template_name'),
        supabase.from('email_templates' as any).select('*').order('category, template_name'),
      ]);

      if (smsRes.error) throw smsRes.error;
      if (emailRes.error) throw emailRes.error;

      setSmsTemplates(smsRes.data || []);
      setEmailTemplates(emailRes.data as any || []);
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSMS() {
    if (!editingSMS) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('sms_message_templates')
        .update({ message_body: editingSMS.message_body })
        .eq('id', editingSMS.id);

      if (error) throw error;

      notifySuccess('SMS template saved successfully');
      setEditingSMS(null);
      fetchTemplates();
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEmail() {
    if (!editingEmail) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('email_templates' as any)
        .update({
          subject: editingEmail.subject,
          header_title: editingEmail.header_title,
          content_template: editingEmail.content_template,
        })
        .eq('id', editingEmail.id);

      if (error) throw error;

      notifySuccess('Email template saved successfully');
      setEditingEmail(null);
      fetchTemplates();
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setSaving(false);
    }
  }

  function copyVariable(variable: string) {
    navigator.clipboard.writeText(variable);
    notifySuccess(`Copied ${variable}`);
  }

  function getCategoryColor(category: string) {
    switch (category) {
      case 'booking': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'order': return 'bg-green-100 text-green-800 border-green-300';
      case 'notification': return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'admin': return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'system': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  }

  function getThemeColor(theme: string) {
    switch (theme) {
      case 'success': return 'text-green-600';
      case 'warning': return 'text-amber-600';
      case 'error': return 'text-red-600';
      default: return 'text-blue-600';
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Message Templates</h2>
        <p className="text-slate-600 mb-6">
          Edit automated SMS and email messages sent to customers and admins. Changes take effect immediately.
        </p>

        <div className="flex gap-2 mb-6 border-b border-slate-200">
          <button
            onClick={() => setActiveTab('sms')}
            className={`px-6 py-3 font-bold transition-colors relative ${
              activeTab === 'sms'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="w-5 h-5 inline mr-2" />
            SMS Templates ({smsTemplates.length})
          </button>
          <button
            onClick={() => setActiveTab('email')}
            className={`px-6 py-3 font-bold transition-colors relative ${
              activeTab === 'email'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Mail className="w-5 h-5 inline mr-2" />
            Email Templates ({emailTemplates.length})
          </button>
        </div>

        {activeTab === 'sms' && (
          <div className="space-y-6">
            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-bold text-blue-900 mb-2">Available Variables (click to copy):</p>
                  <div className="flex flex-wrap gap-2">
                    {SMS_VARIABLES.map((variable) => (
                      <button
                        key={variable}
                        onClick={() => copyVariable(variable)}
                        className="bg-blue-100 hover:bg-blue-200 border border-blue-300 px-3 py-1 rounded-lg text-sm font-mono text-blue-900 transition-colors"
                      >
                        <Copy className="w-3 h-3 inline mr-1" />
                        {variable}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {smsTemplates.map((template) => (
                <div key={template.id} className="border-2 border-slate-200 rounded-xl p-6 hover:border-blue-300 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{template.template_name}</h3>
                      <p className="text-sm text-slate-600 mt-1">{template.description}</p>
                    </div>
                    {editingSMS?.id === template.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveSMS}
                          disabled={saving}
                          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold transition-colors flex items-center disabled:opacity-50"
                        >
                          <Save className="w-4 h-4 mr-2" />
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingSMS(null)}
                          disabled={saving}
                          className="bg-slate-300 hover:bg-slate-400 text-slate-800 px-4 py-2 rounded-lg font-bold transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingSMS({ ...template })}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold transition-colors flex items-center"
                      >
                        <Edit2 className="w-4 h-4 mr-2" />
                        Edit
                      </button>
                    )}
                  </div>

                  {editingSMS?.id === template.id ? (
                    <TextareaInput
                      label="Message Template"
                      value={editingSMS.message_body}
                      onChange={(value) => setEditingSMS({ ...editingSMS, message_body: value })}
                      rows={6}
                    />
                  ) : (
                    <div className="bg-slate-50 rounded-lg p-4 mt-3">
                      <p className="text-sm text-slate-700 whitespace-pre-wrap font-mono">{template.message_body}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'email' && (
          <div className="space-y-6">
            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-bold text-blue-900 mb-2">Available Variables (click to copy):</p>
                  <div className="flex flex-wrap gap-2">
                    {EMAIL_VARIABLES.map((variable) => (
                      <button
                        key={variable}
                        onClick={() => copyVariable(variable)}
                        className="bg-blue-100 hover:bg-blue-200 border border-blue-300 px-3 py-1 rounded-lg text-sm font-mono text-blue-900 transition-colors"
                      >
                        <Copy className="w-3 h-3 inline mr-1" />
                        {variable}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {emailTemplates.map((template) => (
                <div key={template.id} className="border-2 border-slate-200 rounded-xl p-6 hover:border-blue-300 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold text-slate-900">{template.template_name}</h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border-2 ${getCategoryColor(template.category)}`}>
                          {template.category.toUpperCase()}
                        </span>
                        <span className={`text-sm font-bold ${getThemeColor(template.theme)}`}>
                          {template.theme}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600">{template.description}</p>
                    </div>
                    {editingEmail?.id === template.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveEmail}
                          disabled={saving}
                          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold transition-colors flex items-center disabled:opacity-50"
                        >
                          <Save className="w-4 h-4 mr-2" />
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingEmail(null)}
                          disabled={saving}
                          className="bg-slate-300 hover:bg-slate-400 text-slate-800 px-4 py-2 rounded-lg font-bold transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingEmail({ ...template })}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold transition-colors flex items-center"
                      >
                        <Edit2 className="w-4 h-4 mr-2" />
                        Edit
                      </button>
                    )}
                  </div>

                  {editingEmail?.id === template.id ? (
                    <div className="space-y-4 mt-4">
                      <TextInput
                        label="Email Subject"
                        value={editingEmail.subject}
                        onChange={(value) => setEditingEmail({ ...editingEmail, subject: value })}
                      />
                      <TextInput
                        label="Header Title"
                        value={editingEmail.header_title}
                        onChange={(value) => setEditingEmail({ ...editingEmail, header_title: value })}
                      />
                      <TextareaInput
                        label="Email Content (HTML)"
                        value={editingEmail.content_template}
                        onChange={(value) => setEditingEmail({ ...editingEmail, content_template: value })}
                        rows={10}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3 mt-4">
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs text-slate-600 font-bold mb-1">SUBJECT:</p>
                        <p className="text-sm text-slate-900 font-medium">{template.subject}</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs text-slate-600 font-bold mb-1">HEADER:</p>
                        <p className="text-sm text-slate-900 font-medium">{template.header_title}</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-4">
                        <p className="text-xs text-slate-600 font-bold mb-2">CONTENT:</p>
                        <div
                          className="text-sm text-slate-700 prose max-w-none"
                          dangerouslySetInnerHTML={{ __html: template.content_template }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
