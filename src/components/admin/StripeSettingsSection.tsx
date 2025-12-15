import { TextInput } from '../forms/TextInput';

interface StripeSettingsSectionProps {
  secretKey: string;
  publishableKey: string;
  onSecretKeyChange: (value: string) => void;
  onPublishableKeyChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}

export function StripeSettingsSection({
  secretKey,
  publishableKey,
  onSecretKeyChange,
  onPublishableKeyChange,
  onSave,
  saving
}: StripeSettingsSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Stripe Payment Settings</h2>

      <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-sm text-slate-700 mb-2">
          Configure your Stripe secret key to enable payment processing for bookings.
        </p>
        <p className="text-sm text-slate-600 mb-2">
          Get your keys from <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 underline">Stripe Dashboard</a>
        </p>
        <p className="text-sm text-amber-700 font-medium">
          Important: Use test keys (sk_test_...) for testing and live keys (sk_live_...) for production.
        </p>
      </div>

      <div className="space-y-4 max-w-2xl">
        <TextInput
          label="Stripe Secret Key"
          type="password"
          value={secretKey}
          onChange={onSecretKeyChange}
          placeholder="sk_test_... or sk_live_..."
          helpText="This key is securely stored and used by the payment processing system"
        />

        <TextInput
          label="Stripe Publishable Key"
          type="text"
          value={publishableKey}
          onChange={onPublishableKeyChange}
          placeholder="pk_test_... or pk_live_..."
          helpText="This key is used on the frontend to display the payment form"
        />

        <div className="flex gap-3 pt-4">
          <button
            onClick={onSave}
            disabled={saving || !secretKey || !publishableKey}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Save Stripe Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
