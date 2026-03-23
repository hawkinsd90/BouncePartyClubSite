/**
 * GoogleCalendarSettings
 *
 * GOOGLE CALENDAR INTEGRATION: CURRENTLY DISABLED
 *
 * This component is scaffolded but all live sync functionality is
 * commented out / guarded until Google OAuth credentials are set up.
 *
 * TO RE-ENABLE:
 * 1. Complete Google Cloud Console setup (see setup steps in the UI).
 * 2. Obtain OAuth Client ID, Client Secret, and a long-lived Refresh Token.
 * 3. Store them via the form below (which writes to admin_settings).
 * 4. Re-enable the DB trigger by running in Supabase SQL Editor:
 *      CREATE TRIGGER trg_auto_sync_google_calendar
 *        AFTER INSERT OR UPDATE OR DELETE ON orders
 *        FOR EACH ROW
 *        EXECUTE FUNCTION auto_sync_google_calendar();
 * 5. Remove the GCAL_INTEGRATION_DISABLED guard constant below.
 */

import { useState, useEffect } from 'react';
import { Calendar, AlertCircle, Settings, ExternalLink, Info } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// ─── TEMPORARY DISABLE GUARD ────────────────────────────────────────────────
// Set to false ONLY after Google credentials are configured and the DB trigger
// has been re-enabled via the SQL command documented above.
const GCAL_INTEGRATION_DISABLED = true;
// ────────────────────────────────────────────────────────────────────────────

interface CredentialField {
  key: string;
  label: string;
  placeholder: string;
  isSecret: boolean;
}

const CRED_FIELDS: CredentialField[] = [
  { key: 'google_calendar_client_id',      label: 'OAuth Client ID',        placeholder: 'xxxx.apps.googleusercontent.com',      isSecret: false },
  { key: 'google_calendar_client_secret',  label: 'OAuth Client Secret',    placeholder: 'GOCSPX-...',                            isSecret: true  },
  { key: 'google_calendar_refresh_token',  label: 'Refresh Token',          placeholder: 'Obtained from one-time OAuth flow',     isSecret: true  },
  { key: 'google_calendar_id',             label: 'Calendar ID (optional)', placeholder: 'primary (default) or calendar email',   isSecret: false },
];

export function GoogleCalendarSettings() {
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [savedCreds, setSavedCreds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const { data } = await supabase
      .from('admin_settings')
      .select('key, value')
      .in('key', CRED_FIELDS.map(f => f.key));

    const loaded: Record<string, string> = {};
    for (const row of data || []) {
      if (row.value) loaded[row.key] = row.value;
    }
    setCreds(loaded);
    setSavedCreds(loaded);
  }

  async function saveCredentials() {
    setSaving(true);
    setSaveStatus('idle');
    try {
      for (const [key, value] of Object.entries(creds)) {
        if (value === savedCreds[key]) continue;

        const { data: existing } = await supabase
          .from('admin_settings')
          .select('id')
          .eq('key', key)
          .maybeSingle();

        if (existing) {
          await supabase.from('admin_settings').update({ value }).eq('key', key);
        } else {
          await supabase.from('admin_settings').insert({ key, value });
        }
      }
      setSavedCreds({ ...creds });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }

  const hasAnyValue = CRED_FIELDS.some(f => !!creds[f.key]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-700 to-slate-800 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <Calendar className="w-6 h-6" />
          <h2 className="text-xl font-bold">Google Calendar Sync</h2>
          <span className="ml-auto px-3 py-1 bg-amber-400 text-amber-900 text-xs font-bold rounded-full">
            SETUP REQUIRED
          </span>
        </div>
        <p className="text-slate-300 text-sm">
          One Google Calendar event per order day, synced to bouncepartyclub@gmail.com with evening-before and morning-before reminders.
        </p>
      </div>

      {/* Disabled Notice */}
      {GCAL_INTEGRATION_DISABLED && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800">Auto-sync is currently disabled</p>
              <p className="text-sm text-amber-700 mt-1">
                The Google Calendar trigger and automatic sync are turned off until you finish credential setup.
                You can save credentials here now — auto-sync will not run until it is explicitly re-enabled.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Credentials Form — always shown so you can set up creds */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5 text-slate-600" />
          <h3 className="font-semibold text-slate-900">OAuth Credentials</h3>
          <a
            href="https://console.cloud.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            Google Cloud Console <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="space-y-4">
          {CRED_FIELDS.map(field => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-slate-700 mb-1">{field.label}</label>
              <input
                type={field.isSecret ? 'password' : 'text'}
                value={creds[field.key] || ''}
                onChange={e => setCreds(prev => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
              />
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveCredentials}
            disabled={saving || !hasAnyValue}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Credentials'}
          </button>
          {saveStatus === 'saved' && (
            <span className="text-green-600 text-sm">Saved. Auto-sync is still disabled until you complete re-enable steps.</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-red-500 text-sm">Failed to save</span>
          )}
        </div>

        {/* Setup instructions */}
        <div className="mt-5 p-4 bg-blue-50 rounded-lg text-xs text-slate-700 space-y-1.5 border border-blue-100">
          <div className="flex items-center gap-1.5 mb-2">
            <Info className="w-3.5 h-3.5 text-blue-600" />
            <p className="font-semibold text-blue-800">Setup steps</p>
          </div>
          <p>1. Create a project at <strong>console.cloud.google.com</strong> and enable the <strong>Google Calendar API</strong>.</p>
          <p>2. Create <strong>OAuth 2.0 credentials</strong> (Web Application). Add <code className="bg-white px-1 rounded">https://developers.google.com/oauthplayground</code> as an authorized redirect URI.</p>
          <p>3. Go to <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">OAuth Playground</a>, click the gear icon → "Use your own OAuth credentials" → enter your Client ID and Secret.</p>
          <p>4. In Step 1, authorize scope: <code className="bg-white px-1 rounded">https://www.googleapis.com/auth/calendar</code>.</p>
          <p>5. In Step 2, exchange for tokens. Copy the <strong>Refresh Token</strong> and paste it above.</p>
          <p>6. Save credentials here, then follow the re-enable steps in the file header comment to activate auto-sync.</p>
        </div>
      </div>

      {/* Reminder Info */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-700">
        <p className="font-semibold text-slate-800 mb-2">Reminder Schedule (when enabled)</p>
        <ul className="space-y-1 text-slate-600">
          <li>• <strong>Evening before</strong> at 6:00 PM — email + popup reminder</li>
          <li>• <strong>Morning before</strong> at 9:00 AM — email + popup reminder</li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Reminders are 840 min (6 PM evening before) and 1,380 min (9 AM morning before) before 8:00 AM on the event day.
        </p>
      </div>

      {/* Sync controls — completely disabled until integration is re-enabled */}
      {GCAL_INTEGRATION_DISABLED && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 opacity-50 pointer-events-none select-none">
          <h3 className="font-semibold text-slate-900 mb-3">Manual Sync Controls</h3>
          <p className="text-sm text-slate-500">
            Sync controls are disabled. Complete credential setup and re-enable the integration first.
          </p>
        </div>
      )}
    </div>
  );
}
