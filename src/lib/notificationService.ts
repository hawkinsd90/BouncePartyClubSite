import { supabase } from './supabase';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

interface SmsOptions {
  to: string;
  message: string;
  orderId?: string;
}

interface NotificationResult {
  success: boolean;
  error?: string;
}

export async function sendEmail(options: EmailOptions): Promise<NotificationResult> {
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: options.to,
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[NOTIFICATION] Email failed:', errorText);
      return { success: false, error: errorText };
    }

    console.log('[NOTIFICATION] Email sent successfully to:', options.to);
    return { success: true };
  } catch (error: any) {
    console.error('[NOTIFICATION] Email error:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

export async function sendSms(options: SmsOptions): Promise<NotificationResult> {
  if (!options.message.trim()) {
    return { success: false, error: 'SMS message is empty' };
  }

  if (!options.to) {
    return { success: false, error: 'Phone number is required' };
  }

  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: options.to,
        message: options.message,
        orderId: options.orderId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.error || 'Failed to send SMS';
      console.error('[NOTIFICATION] SMS failed:', errorMsg);
      return { success: false, error: errorMsg };
    }

    console.log('[NOTIFICATION] SMS sent successfully to:', options.to);
    return { success: true };
  } catch (error: any) {
    console.error('[NOTIFICATION] SMS error:', error);
    return { success: false, error: error.message || 'Failed to send SMS' };
  }
}

export async function getAdminPhone(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'admin_notification_phone')
      .maybeSingle();

    if (error) {
      console.error('[NOTIFICATION] Error fetching admin phone:', error);
      return null;
    }

    return data?.value as string | null;
  } catch (error) {
    console.error('[NOTIFICATION] Error fetching admin phone:', error);
    return null;
  }
}

export async function getAdminEmail(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'admin_email')
      .maybeSingle();

    if (error) {
      console.error('[NOTIFICATION] Error fetching admin email:', error);
      return null;
    }

    return data?.value as string | null;
  } catch (error) {
    console.error('[NOTIFICATION] Error fetching admin email:', error);
    return null;
  }
}

export async function sendAdminSms(message: string, orderId?: string): Promise<NotificationResult> {
  const adminPhone = await getAdminPhone();

  if (!adminPhone) {
    console.log('[NOTIFICATION] No admin phone configured; skipping admin SMS.');
    return { success: false, error: 'Admin phone not configured' };
  }

  return sendSms({
    to: adminPhone,
    message,
    orderId,
  });
}

export async function sendAdminEmail(
  subject: string,
  html: string
): Promise<NotificationResult> {
  const adminEmail = await getAdminEmail();

  if (!adminEmail) {
    console.log('[NOTIFICATION] No admin email configured; skipping admin email.');
    return { success: false, error: 'Admin email not configured' };
  }

  return sendEmail({
    to: adminEmail,
    subject,
    html,
  });
}

export async function sendNotificationToCustomer(options: {
  phone?: string;
  email?: string;
  smsMessage?: string;
  emailSubject?: string;
  emailHtml?: string;
  orderId?: string;
}): Promise<{ emailResult?: NotificationResult; smsResult?: NotificationResult }> {
  const results: {
    emailResult?: NotificationResult;
    smsResult?: NotificationResult;
  } = {};

  if (options.email && options.emailSubject && options.emailHtml) {
    results.emailResult = await sendEmail({
      to: options.email,
      subject: options.emailSubject,
      html: options.emailHtml,
    });
  }

  if (options.phone && options.smsMessage) {
    results.smsResult = await sendSms({
      to: options.phone,
      message: options.smsMessage,
      orderId: options.orderId,
    });
  }

  return results;
}
