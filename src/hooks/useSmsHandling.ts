import { useState } from 'react';
import { sendSms as sendSmsNotification } from '../lib/notificationService';
import { showToast } from '../lib/notifications';

export function useSmsHandling(orderId: string, customerPhone: string) {
  const [sendingSms, setSendingSms] = useState(false);

  async function sendSms(message: string): Promise<boolean> {
    if (!message.trim()) return false;

    setSendingSms(true);
    try {
      const result = await sendSmsNotification({
        to: customerPhone,
        message,
        orderId,
      });

      if (!result.success) {
        const errorMessage = result.error || 'Failed to send SMS. Please try again.';

        if (errorMessage.includes('Twilio not configured')) {
          showToast(
            'SMS cannot be sent: Twilio credentials are not configured. Please add your Twilio credentials in the Settings tab first.',
            'error'
          );
        } else if (errorMessage.includes('Incomplete Twilio configuration')) {
          showToast('SMS cannot be sent: Twilio configuration is incomplete. Please check your Settings.', 'error');
        } else {
          showToast(`Failed to send SMS: ${errorMessage}`, 'error');
        }
        return false;
      }

      showToast('SMS sent successfully', 'success');
      return true;
    } catch (error: any) {
      console.error('Error sending SMS:', error);
      showToast(`Failed to send SMS: ${error.message || 'Unknown error'}`, 'error');
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
