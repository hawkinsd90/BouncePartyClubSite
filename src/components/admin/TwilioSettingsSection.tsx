import { TextInput } from '../forms/TextInput';

interface TwilioSettingsSectionProps {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  adminEmail: string;
  onAccountSidChange: (value: string) => void;
  onAuthTokenChange: (value: string) => void;
  onFromNumberChange: (value: string) => void;
  onAdminEmailChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}

export function TwilioSettingsSection({
  accountSid,
  authToken,
  fromNumber,
  adminEmail,
  onAccountSidChange,
  onAuthTokenChange,
  onFromNumberChange,
  onAdminEmailChange,
  onSave,
  saving
}: TwilioSettingsSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">SMS Notification Settings</h2>

      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-slate-700 mb-2">
          Configure your Twilio credentials to enable SMS notifications when customers book rentals.
        </p>
        <p className="text-sm text-slate-600">
          Get your credentials from <a href="https://console.twilio.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 underline">Twilio Console</a>
        </p>
      </div>

      <div className="space-y-4 max-w-2xl">
        <TextInput
          label="Twilio Account SID"
          type="text"
          value={accountSid}
          onChange={onAccountSidChange}
          placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        />

        <TextInput
          label="Twilio Auth Token"
          type="password"
          value={authToken}
          onChange={onAuthTokenChange}
          placeholder="********************************"
        />

        <TextInput
          label="Twilio Phone Number"
          type="tel"
          value={fromNumber}
          onChange={onFromNumberChange}
          placeholder="+15551234567"
          helpText="Must be in E.164 format (e.g., +15551234567)"
        />

        <div className="pt-4 border-t border-slate-200">
          <TextInput
            label="Admin Email for Error Notifications"
            type="email"
            value={adminEmail}
            onChange={onAdminEmailChange}
            placeholder="admin@example.com"
            helpText="All application errors will be sent to this email with detailed stack traces"
          />
        </div>

        <div className="flex gap-3 pt-4">
          <button
            onClick={onSave}
            disabled={saving || !accountSid || !authToken || !fromNumber}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
