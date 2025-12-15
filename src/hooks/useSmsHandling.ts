import { useState } from 'react';

export function useSmsHandling(orderId: string, customerPhone: string) {
  const [sendingSms, setSendingSms] = useState(false);

  async function sendSms(message: string): Promise<boolean> {
    if (!message.trim()) return false;

    setSendingSms(true);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: customerPhone,
          message,
          orderId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error || 'Failed to send SMS';
        throw new Error(errorMsg);
      }

      return true;
    } catch (error: any) {
      console.error('Error sending SMS:', error);
      const errorMessage = error.message || 'Failed to send SMS. Please try again.';

      if (errorMessage.includes('Twilio not configured')) {
        alert(
          'SMS cannot be sent: Twilio credentials are not configured. Please add your Twilio credentials in the Settings tab first.'
        );
      } else if (errorMessage.includes('Incomplete Twilio configuration')) {
        alert('SMS cannot be sent: Twilio configuration is incomplete. Please check your Settings.');
      } else {
        alert(`Failed to send SMS: ${errorMessage}`);
      }
      return false;
    } finally {
      setSendingSms(false);
    }
  }

  return {
    sendingSms,
    sendSms,
  };
}
