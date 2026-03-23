import { useState, useEffect } from 'react';
import { Calendar, CheckCircle2, AlertCircle, RefreshCw, Settings, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface SyncRow {
  event_date: string;
  google_event_id: string | null;
  last_synced_at: string | null;
  last_sync_status: string;
  last_sync_error: string | null;
  order_count: number;
}

interface CredentialField {
  key: string;
  label: string;
  placeholder: string;
  isSecret: boolean;
}

const CRED_FIELDS: CredentialField[] = [
  { key: 'google_calendar_client_id', label: 'OAuth Client ID', placeholder: 'xxxx.apps.googleusercontent.com', isSecret: false },
  { key: 'google_calendar_client_secret', label: 'OAuth Client Secret', placeholder: 'GOCSPX-...', isSecret: true },
  { key: 'google_calendar_refresh_token', label: 'Refresh Token', placeholder: 'Obtained from one-time OAuth flow', isSecret: true },
  { key: 'google_calendar_id', label: 'Calendar ID (optional)', placeholder: 'primary (default) or specific calendar email', isSecret: false },
];

export function GoogleCalendarSettings() {
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [savedCreds, setSavedCreds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [syncRows, setSyncRows] = useState<SyncRow[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [syncResult, setSyncResult] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
    loadSyncStatus();
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

  async function loadSyncStatus() {
    const today = new Date().toISOString().split('T')[0];
    const [rowsRes, queueRes] = await Promise.all([
      supabase
        .from('google_calendar_sync')
        .select('event_date, google_event_id, last_synced_at, last_sync_status, last_sync_error, order_count')
        .gte('event_date', today)
        .order('event_date', { ascending: true })
        .limit(30),
      supabase
        .from('google_calendar_sync_queue')
        .select('id', { count: 'exact', head: true })
        .is('processed_at', null),
    ]);
    setSyncRows(rowsRes.data || []);
    setQueueCount(queueRes.count || 0);
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

  async function triggerSync(reconcile = false) {
    if (reconcile) setReconciling(true);
    else setSyncing(true);
    setSyncResult(null);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || anonKey;

      const response = await fetch(`${supabaseUrl}/functions/v1/sync-google-calendar`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reconcile ? { reconcile: true } : {}),
      });
      const result = await response.json();
      if (result.ok) {
        setSyncResult(`Synced ${result.processed} date(s). Actions: ${result.results?.map((r: any) => `${r.date}:${r.action}`).join(', ') || 'none'}`);
      } else {
        setSyncResult(`Error: ${result.error}`);
      }
      await loadSyncStatus();
    } catch (err: any) {
      setSyncResult(`Failed: ${err.message}`);
    } finally {
      setSyncing(false);
      setReconciling(false);
    }
  }

  const isConfigured = savedCreds['google_calendar_client_id'] &&
    savedCreds['google_calendar_client_secret'] &&
    savedCreds['google_calendar_refresh_token'];

  const errorRows = syncRows.filter(r => r.last_sync_status === 'error');

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <Calendar className="w-6 h-6" />
          <h2 className="text-xl font-bold">Google Calendar Sync</h2>
        </div>
        <p className="text-blue-100 text-sm">
          Automatically syncs one event per order day to <strong>bouncepartyclub@gmail.com</strong> with evening-before and morning-before reminders.
        </p>
      </div>

      {/* Connection Status */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-3">
          {isConfigured ? (
            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
          )}
          <div>
            <div className="font-semibold text-slate-900">
              {isConfigured ? 'Credentials configured' : 'Credentials not yet configured'}
            </div>
            <div className="text-sm text-slate-500">
              {isConfigured
                ? 'Auto-sync is active. Orders will sync to Google Calendar automatically.'
                : 'Enter your Google OAuth credentials below to enable sync.'}
            </div>
          </div>
          {queueCount > 0 && (
            <div className="ml-auto px-3 py-1 bg-amber-100 text-amber-800 text-xs font-semibold rounded-full">
              {queueCount} pending in queue
            </div>
          )}
        </div>
      </div>

      {/* Credentials Form */}
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
            disabled={saving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Credentials'}
          </button>
          {saveStatus === 'saved' && (
            <span className="text-green-600 text-sm flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> Saved
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="text-red-500 text-sm">Failed to save</span>
          )}
        </div>

        <div className="mt-4 p-4 bg-slate-50 rounded-lg text-xs text-slate-600 space-y-1">
          <p className="font-semibold text-slate-700">Setup steps:</p>
          <p>1. Create a project at <strong>console.cloud.google.com</strong> and enable the Google Calendar API.</p>
          <p>2. Create OAuth 2.0 credentials (Web Application). Add <code>https://developers.google.com/oauthplayground</code> as a redirect URI.</p>
          <p>3. Go to <strong>OAuth Playground</strong>, click the gear icon, check "Use your own OAuth credentials," enter your Client ID and Secret.</p>
          <p>4. In Step 1, authorize <code>https://www.googleapis.com/auth/calendar</code>. In Step 2, exchange for tokens.</p>
          <p>5. Copy the <strong>Refresh Token</strong> (long-lived) and paste it above.</p>
          <p>6. Leave Calendar ID as <code>primary</code> to sync to your main Google Calendar.</p>
        </div>
      </div>

      {/* Manual Sync Controls */}
      {isConfigured && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-900 mb-3">Manual Controls</h3>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => triggerSync(false)}
              disabled={syncing || reconciling}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Draining queue...' : 'Drain Queue Now'}
            </button>
            <button
              onClick={() => triggerSync(true)}
              disabled={syncing || reconciling}
              className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${reconciling ? 'animate-spin' : ''}`} />
              {reconciling ? 'Reconciling...' : 'Full Reconcile (90 days)'}
            </button>
          </div>
          {syncResult && (
            <div className={`mt-3 p-3 rounded-lg text-sm ${syncResult.startsWith('Error') || syncResult.startsWith('Failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {syncResult}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Auto-sync fires automatically when orders are created, updated, or cancelled. Use "Drain Queue" if events seem out of sync. Use "Full Reconcile" to rebuild all upcoming calendar events.
          </p>
        </div>
      )}

      {/* Reminder Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">Reminder Schedule</p>
        <ul className="space-y-1 text-blue-700">
          <li>• Evening before at <strong>6:00 PM</strong> — popup + email reminder</li>
          <li>• Morning before at <strong>9:00 AM</strong> — popup + email reminder</li>
        </ul>
        <p className="mt-2 text-xs text-blue-600">
          Reminders are calculated relative to 8:00 AM on the order day (840 min and 1380 min before). Google Calendar will notify you at these times the day before the event.
        </p>
      </div>

      {/* Sync Status Table */}
      {syncRows.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900">Upcoming Synced Dates</h3>
            <button onClick={loadSyncStatus} className="text-xs text-blue-600 hover:underline">Refresh</button>
          </div>
          {errorRows.length > 0 && (
            <div className="mb-3 p-3 bg-red-50 rounded-lg border border-red-200">
              <p className="text-sm font-semibold text-red-800 mb-1">{errorRows.length} sync error(s)</p>
              {errorRows.map(r => (
                <p key={r.event_date} className="text-xs text-red-700">{r.event_date}: {r.last_sync_error}</p>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Date</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Orders</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Status</th>
                  <th className="text-left py-2 text-xs font-semibold text-slate-500">Last Synced</th>
                </tr>
              </thead>
              <tbody>
                {syncRows.map(row => (
                  <tr key={row.event_date} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 font-mono text-slate-900">{row.event_date}</td>
                    <td className="py-2 pr-4 text-slate-700">{row.order_count}</td>
                    <td className="py-2 pr-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        row.last_sync_status === 'ok' ? 'bg-green-100 text-green-700' :
                        row.last_sync_status === 'error' ? 'bg-red-100 text-red-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {row.last_sync_status === 'ok' ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        {row.google_event_id ? 'synced' : row.last_sync_status}
                      </span>
                    </td>
                    <td className="py-2 text-slate-500 text-xs">
                      {row.last_synced_at ? new Date(row.last_synced_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
