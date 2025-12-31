import { useState, useEffect } from 'react';
import { Building2, Save, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';

interface BusinessSettings {
  business_name: string;
  business_name_short: string;
  business_legal_entity: string;
  business_address: string;
  business_phone: string;
  business_email: string;
  business_website: string;
  business_license_number: string;
}

export function BusinessBrandingTab() {
  const [settings, setSettings] = useState<BusinessSettings>({
    business_name: '',
    business_name_short: '',
    business_legal_entity: '',
    business_address: '',
    business_phone: '',
    business_email: '',
    business_website: '',
    business_license_number: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('key, value')
        .in('key', [
          'business_name',
          'business_name_short',
          'business_legal_entity',
          'business_address',
          'business_phone',
          'business_email',
          'business_website',
          'business_license_number',
        ]);

      if (error) throw error;

      if (data) {
        const loadedSettings = { ...settings };
        data.forEach(({ key, value }) => {
          if (key in loadedSettings) {
            loadedSettings[key as keyof BusinessSettings] = value || '';
          }
        });
        setSettings(loadedSettings);
      }
    } catch (error: any) {
      showToast('Error loading business settings: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updates = Object.entries(settings).map(([key, value]) => ({
        key,
        value,
      }));

      for (const { key, value } of updates) {
        const { error } = await supabase
          .from('admin_settings')
          .upsert({ key, value, description: getDescription(key) }, { onConflict: 'key' });

        if (error) throw error;
      }

      showToast('Business branding settings saved successfully', 'success');
      window.location.reload();
    } catch (error: any) {
      showToast('Error saving settings: ' + error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function getDescription(key: string): string {
    const descriptions: Record<string, string> = {
      business_name: 'Legal business name used in contracts and waivers',
      business_name_short: 'Short business name for SMS and emails',
      business_legal_entity: 'Full legal entity name including business structure',
      business_address: 'Physical business address for contracts',
      business_phone: 'Primary business phone number',
      business_email: 'Primary business email address',
      business_website: 'Business website URL',
      business_license_number: 'Business license or registration number',
    };
    return descriptions[key] || '';
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
          <p className="text-slate-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center mb-6">
          <Building2 className="w-6 h-6 text-blue-600 mr-2" />
          <h2 className="text-2xl font-bold text-slate-900">Business Branding</h2>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 mr-2 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">White-Label Configuration</p>
              <p>
                These settings control how your business name appears throughout the application,
                including contracts, waivers, emails, SMS messages, and customer-facing pages.
                Changes will take effect after saving and refreshing the page.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Business Name (Short) *
            </label>
            <input
              type="text"
              value={settings.business_name_short}
              onChange={(e) => setSettings({ ...settings, business_name_short: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Bounce Party Club"
            />
            <p className="text-xs text-slate-500 mt-1">
              Used in SMS, emails, and general display
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Legal Entity Name *
            </label>
            <input
              type="text"
              value={settings.business_legal_entity}
              onChange={(e) => setSettings({ ...settings, business_legal_entity: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Bounce Party Club LLC"
            />
            <p className="text-xs text-slate-500 mt-1">
              Full legal name used in contracts and waivers
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Business Address *
            </label>
            <input
              type="text"
              value={settings.business_address}
              onChange={(e) => setSettings({ ...settings, business_address: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="123 Main St, City, ST 12345"
            />
            <p className="text-xs text-slate-500 mt-1">
              Physical address for contracts and correspondence
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Business Phone *
            </label>
            <input
              type="tel"
              value={settings.business_phone}
              onChange={(e) => setSettings({ ...settings, business_phone: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="(555) 123-4567"
            />
            <p className="text-xs text-slate-500 mt-1">
              Primary phone number for customer contact
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Business Email *
            </label>
            <input
              type="email"
              value={settings.business_email}
              onChange={(e) => setSettings({ ...settings, business_email: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="info@yourbusiness.com"
            />
            <p className="text-xs text-slate-500 mt-1">
              Primary email for customer correspondence
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Business Website
            </label>
            <input
              type="url"
              value={settings.business_website}
              onChange={(e) => setSettings({ ...settings, business_website: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="https://yourbusiness.com"
            />
            <p className="text-xs text-slate-500 mt-1">
              Your business website URL
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Business License Number
            </label>
            <input
              type="text"
              value={settings.business_license_number}
              onChange={(e) => setSettings({ ...settings, business_license_number: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Optional"
            />
            <p className="text-xs text-slate-500 mt-1">
              Optional: Business license or registration number
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
