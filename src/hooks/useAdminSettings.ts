import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { notifyError, notifySuccess, notifyWarning, showConfirm } from '../lib/notifications';

export interface TwilioSettings {
  account_sid: string;
  auth_token: string;
  from_number: string;
}

export interface StripeSettings {
  secret_key: string;
  publishable_key: string;
}

export function useAdminSettings() {
  const [twilioSettings, setTwilioSettings] = useState<TwilioSettings>({
    account_sid: '',
    auth_token: '',
    from_number: ''
  });
  const [stripeSettings, setStripeSettings] = useState<StripeSettings>({
    secret_key: '',
    publishable_key: ''
  });
  const [adminEmail, setAdminEmail] = useState('');
  const [savingTwilio, setSavingTwilio] = useState(false);
  const [savingStripe, setSavingStripe] = useState(false);
  const [backfillingPayments, setBackfillingPayments] = useState(false);

  const initializeSettings = useCallback((
    twilio: TwilioSettings,
    stripe: StripeSettings,
    email: string
  ) => {
    setTwilioSettings(twilio);
    setStripeSettings(stripe);
    setAdminEmail(email);
  }, []);

  const saveTwilioSettings = useCallback(async () => {
    setSavingTwilio(true);
    try {
      const updates = [
        { key: 'twilio_account_sid', value: twilioSettings.account_sid },
        { key: 'twilio_auth_token', value: twilioSettings.auth_token },
        { key: 'twilio_from_number', value: twilioSettings.from_number },
        { key: 'admin_email', value: adminEmail },
      ];

      for (const update of updates) {
        const { error } = await supabase
          .from('admin_settings')
          .update({ value: update.value })
          .eq('key', update.key);

        if (error) {
          console.error('Error updating setting:', update.key, error);
          throw new Error(`Failed to update ${update.key}: ${error.message}`);
        }
      }

      notifySuccess('Settings saved successfully!');
    } catch (error: any) {
      console.error('Error saving settings:', error);
      const errorMessage = error.message || 'Failed to save settings. Please try again.';

      if (errorMessage.includes('row-level security')) {
        notifyError('Permission denied: You must be logged in as an admin user to update settings.');
      } else {
        notifyError(`Failed to save settings: ${errorMessage}`);
      }
    } finally {
      setSavingTwilio(false);
    }
  }, [twilioSettings, adminEmail]);

  const saveStripeSettings = useCallback(async () => {
    setSavingStripe(true);
    try {
      const updates = [
        { key: 'stripe_secret_key', value: stripeSettings.secret_key },
        { key: 'stripe_publishable_key', value: stripeSettings.publishable_key },
      ];

      for (const update of updates) {
        const { error } = await supabase
          .from('admin_settings')
          .update({ value: update.value })
          .eq('key', update.key);

        if (error) {
          console.error('Error updating Stripe setting:', update.key, error);
          throw new Error(`Failed to update ${update.key}: ${error.message}`);
        }
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`;
      const testResponse = await fetch(apiUrl, {
        method: 'OPTIONS',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
      });

      if (testResponse.ok) {
        notifySuccess('Stripe settings saved successfully! The payment system is now ready.');
      } else {
        notifyWarning('Stripe settings saved, but there may be an issue with the edge function. Please test a payment.');
      }
    } catch (error: any) {
      console.error('Error saving Stripe settings:', error);
      const errorMessage = error.message || 'Failed to save settings. Please try again.';

      if (errorMessage.includes('row-level security')) {
        notifyError('Permission denied: You must be logged in as an admin user to update settings.');
      } else {
        notifyError(`Failed to save Stripe settings: ${errorMessage}`);
      }
    } finally {
      setSavingStripe(false);
    }
  }, [stripeSettings]);

  const backfillPaymentMethods = useCallback(async () => {
    const confirmed = await showConfirm(
      'This will fetch payment method details from Stripe for all existing payments that are missing this information. Continue?'
    );

    if (!confirmed) return;

    setBackfillingPayments(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();

      if (!sessionData?.session) {
        throw new Error('No active session');
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/backfill-payment-methods`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        if (result.updated === 0) {
          notifySuccess('No payments needed updating. All payment methods are already recorded.');
        } else {
          notifySuccess(`Successfully updated ${result.updated} payment(s) with payment method information.`);
        }

        if (result.failed > 0) {
          notifyWarning(`${result.failed} payment(s) could not be updated. Check console for details.`);
          console.error('Backfill errors:', result.errors);
        }
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (error: any) {
      console.error('Error backfilling payment methods:', error);
      notifyError(`Failed to backfill payment methods: ${error.message}`);
    } finally {
      setBackfillingPayments(false);
    }
  }, []);

  return {
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
  };
}
