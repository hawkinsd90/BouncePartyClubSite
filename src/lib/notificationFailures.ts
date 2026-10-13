import { supabase } from './supabase';
import type { Json } from './database.types';

export interface NotificationFailure {
  id: string;
  notification_type: string;
  intended_recipient: string;
  subject: string | null;
  message_preview: string | null;
  error_message: string;
  context: Json | null;
  fallback_sent: boolean;
  fallback_type: string | null;
  retry_count: number;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SystemStatus {
  id: string;
  system_type: string;
  is_operational: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  total_failures_24h: number;
  error_details: Json | null;
  admin_notified_at: string | null;
  updated_at: string;
}

// Notification failures and successes are recorded only by the send-email and send-sms-notification Edge Functions with the
// service role (the record_notification_failure / record_notification_success RPCs are not executable by browser roles).
// This module only reads the Admin view of them.

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
