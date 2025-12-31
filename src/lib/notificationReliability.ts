import { supabase } from './supabase';

interface NotificationContext {
  order_id?: string;
  customer_email?: string;
  customer_phone?: string;
  event_type?: string;
  [key: string]: any;
}

export interface NotificationFailure {
  id: string;
  notification_type: 'email' | 'sms';
  intended_recipient: string;
  subject: string | null;
  message_preview: string | null;
  error_message: string;
  context: NotificationContext;
  fallback_sent: boolean;
  fallback_type: string | null;
  retry_count: number;
  resolved_at: string | null;
  created_at: string;
}

export interface SystemStatus {
  system_type: 'email' | 'sms';
  is_operational: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  total_failures_24h: number;
  error_details: any;
  admin_notified_at: string | null;
}

export async function recordNotificationFailure(
  type: 'email' | 'sms',
  recipient: string,
  subject: string | null,
  messagePreview: string | null,
  error: string,
  context: NotificationContext = {}
): Promise<string | null> {
  try {
    const { data, error: dbError } = await supabase.rpc('record_notification_failure', {
      p_type: type,
      p_recipient: recipient,
      p_subject: subject,
      p_message_preview: messagePreview,
      p_error: error,
      p_context: context
    });

    if (dbError) {
      console.error('Failed to record notification failure:', dbError);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Error recording notification failure:', err);
    return null;
  }
}

export async function recordNotificationSuccess(type: 'email' | 'sms'): Promise<void> {
  try {
    await supabase.rpc('record_notification_success', { p_type: type });
  } catch (err) {
    console.error('Error recording notification success:', err);
  }
}

export async function getUnresolvedFailures(): Promise<NotificationFailure[]> {
  try {
    const { data, error } = await supabase
      .from('notification_failures')
      .select('*')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error fetching unresolved failures:', err);
    return [];
  }
}

export async function getSystemStatus(): Promise<{ email: SystemStatus | null; sms: SystemStatus | null }> {
  try {
    const { data, error } = await supabase
      .from('notification_system_status')
      .select('*');

    if (error) throw error;

    const emailStatus = data?.find(s => s.system_type === 'email') || null;
    const smsStatus = data?.find(s => s.system_type === 'sms') || null;

    return { email: emailStatus, sms: smsStatus };
  } catch (err) {
    console.error('Error fetching system status:', err);
    return { email: null, sms: null };
  }
}

export async function markFailureResolved(failureId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('notification_failures')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', failureId);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Error marking failure as resolved:', err);
    return false;
  }
}

export async function getUnresolvedCount(): Promise<{ email: number; sms: number; total: number }> {
  try {
    const { data, error } = await supabase.rpc('get_unresolved_failures_count');

    if (error) throw error;
    return data || { email: 0, sms: 0, total: 0 };
  } catch (err) {
    console.error('Error getting unresolved count:', err);
    return { email: 0, sms: 0, total: 0 };
  }
}

export function shouldNotifyAdmin(status: SystemStatus | null): boolean {
  if (!status || status.is_operational) return false;

  if (!status.admin_notified_at) return true;

  const lastNotified = new Date(status.admin_notified_at).getTime();
  const now = Date.now();
  const hoursSinceNotification = (now - lastNotified) / (1000 * 60 * 60);

  return hoursSinceNotification >= 4;
}

export async function updateAdminNotificationTime(systemType: 'email' | 'sms'): Promise<void> {
  try {
    await supabase
      .from('notification_system_status')
      .update({ admin_notified_at: new Date().toISOString() })
      .eq('system_type', systemType);
  } catch (err) {
    console.error('Error updating admin notification time:', err);
  }
}
