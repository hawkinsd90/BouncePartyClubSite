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
  order_id: string | null;
  notification_type: string;
  intended_recipient: string;
  subject: string | null;
  message_preview: string | null;
  error_message: string;
  retry_count: number;
  last_retry_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface SystemStatus {
  id: string;
  system_type: string;
  is_operational: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  error_message: string | null;
  updated_at: string;
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
      p_subject: subject || '',
      p_message_preview: messagePreview || '',
      p_error: error,
      p_context: context || {}
    } as any);

    if (dbError) {
      console.error('Failed to record notification failure:', dbError);
      return null;
    }

    return data !== null && data !== undefined ? String(data) : null;
  } catch (err) {
    console.error('Error recording notification failure:', err);
    return null;
  }
}

export async function recordNotificationSuccess(type: 'email' | 'sms'): Promise<void> {
  try {
    await supabase.rpc('record_notification_success', { p_type: type } as any);
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
    if (!data || typeof data !== 'object') return { email: 0, sms: 0, total: 0 };
    return data as unknown as { email: number; sms: number; total: number };
  } catch (err) {
    console.error('Error getting unresolved count:', err);
    return { email: 0, sms: 0, total: 0 };
  }
}

export function shouldNotifyAdmin(status: SystemStatus | null): boolean {
  if (!status || status.is_operational) return false;

  // Notify if consecutive failures exceed threshold
  return status.consecutive_failures >= 3;
}

export async function updateAdminNotificationTime(_systemType: 'email' | 'sms'): Promise<void> {
  // Note: admin_notified_at field removed from notification_system_status table
  // Admin notifications are now based on consecutive failure count
  return Promise.resolve();
}
