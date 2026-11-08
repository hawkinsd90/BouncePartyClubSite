// The event start/end time shown on the customer approval page (WP-P1-13, F-49). Pure: no network.
// The time a customer sees is the saved start/end window (falling back to the event start/end time), formatted without seconds,
// the same way the receipt and portal show it. When the pending change history records an earlier time, it is returned as `previous`.
import { formatTime } from '../utils';

interface TimeFields {
  start_window?: string | null;
  end_window?: string | null;
  event_start_time?: string | null;
  event_end_time?: string | null;
}
interface ChangeRow {
  field_changed: string | null;
  old_value: string | null;
  new_value?: string | null;
  created_at?: string;
}

export interface ApprovalEventTime {
  current: string;
  previous: string | null;
}

function range(start: string | null | undefined, end: string | null | undefined): string {
  const s = formatTime(start || null);
  const e = formatTime(end || null);
  if (s && e) return `${s} - ${e}`;
  return s || e || '';
}

export function approvalEventTime(order: TimeFields, changelog: ChangeRow[] = []): ApprovalEventTime | null {
  const currentStart = order.start_window || order.event_start_time || null;
  const currentEnd = order.end_window || order.event_end_time || null;
  const current = range(currentStart, currentEnd);
  if (!current) return null;

  // The earliest recorded old value for each field is the time the customer last saw.
  const oldest = (field: string): string | null => {
    const rows = changelog
      .filter((c) => c.field_changed === field && c.old_value)
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
    return rows.length ? rows[0].old_value : null;
  };
  const oldStart = oldest('start_window');
  const oldEnd = oldest('end_window');
  let previous: string | null = null;
  if (oldStart || oldEnd) {
    const prev = range(oldStart || currentStart, oldEnd || currentEnd);
    if (prev && prev !== current) previous = prev;
  }
  return { current, previous };
}
