import { useAdminSettings } from '../../hooks/useAdminSettings';
import { StripeSettingsSection } from './StripeSettingsSection';
import { TwilioSettingsSection } from './TwilioSettingsSection';
import { PaymentBackfillSection } from './PaymentBackfillSection';

interface AdminSettingsProps {
  initialTwilioSettings: { account_sid: string; auth_token: string; from_number: string };
  initialStripeSettings: { secret_key: string; publishable_key: string };
  initialAdminEmail: string;
}

export function AdminSettings({
  initialTwilioSettings,
  initialStripeSettings,
  initialAdminEmail
}: AdminSettingsProps) {
  const {
    twilioSettings,
    setTwilioSettings,
    stripeSettings,
    setStripeSettings,
    adminEmail,
    setAdminEmail,
    savingTwilio,
    savingStripe,
    backfillingPayments,
    initializeSettings,
    saveTwilioSettings,
    saveStripeSettings,
    backfillPaymentMethods,
  } = useAdminSettings();

  if (!twilioSettings.account_sid && initialTwilioSettings.account_sid) {
    initializeSettings(initialTwilioSettings, initialStripeSettings, initialAdminEmail);
  }

  return (
    <div className="space-y-6">
      <StripeSettingsSection
        secretKey={stripeSettings.secret_key}
        publishableKey={stripeSettings.publishable_key}
        onSecretKeyChange={(value) => setStripeSettings({ ...stripeSettings, secret_key: value })}
        onPublishableKeyChange={(value) => setStripeSettings({ ...stripeSettings, publishable_key: value })}
        onSave={saveStripeSettings}
        saving={savingStripe}
      />

      <PaymentBackfillSection
        onBackfill={backfillPaymentMethods}
        backfilling={backfillingPayments}
      />

      <TwilioSettingsSection
        accountSid={twilioSettings.account_sid}
        authToken={twilioSettings.auth_token}
        fromNumber={twilioSettings.from_number}
        adminEmail={adminEmail}
        onAccountSidChange={(value) => setTwilioSettings({ ...twilioSettings, account_sid: value })}
        onAuthTokenChange={(value) => setTwilioSettings({ ...twilioSettings, auth_token: value })}
        onFromNumberChange={(value) => setTwilioSettings({ ...twilioSettings, from_number: value })}
        onAdminEmailChange={setAdminEmail}
        onSave={saveTwilioSettings}
        saving={savingTwilio}
      />
    </div>
  );
}
