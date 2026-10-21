// Pure logic for the three-select time picker (hour, minute, AM/PM). The picker emits and accepts "HH:mm" (24-hour) strings, exactly as the
// native time input did, so every caller and stored value stays unchanged.
//
// Rules: nothing is chosen by default; a value is emitted only when hour, minute and AM/PM are all set; choosing an hour sets the minutes to 00
// and any later hour change resets the minutes to 00 again; every minute 00-59 is offered, 00 first; stored off-grid values such as 23:59 display.

export type Period = 'AM' | 'PM';

export interface TimeDraft {
  hour: number | null; // 1-12
  minute: number | null; // 0-59
  period: Period | null;
}

export const EMPTY_TIME_DRAFT: TimeDraft = { hour: null, minute: null, period: null };
export const HOUR_OPTIONS: number[] = Array.from({ length: 12 }, (_, i) => i + 1);
export const MINUTE_OPTIONS: number[] = Array.from({ length: 60 }, (_, i) => i);
export const PERIOD_OPTIONS: Period[] = ['AM', 'PM'];

export function formatMinute(minute: number): string {
  return String(minute).padStart(2, '0');
}

/** "HH:mm" or "HH:mm:ss" (24-hour) -> draft, or null when the text is not a valid time. */
export function parseTime24(value: string | null | undefined): TimeDraft | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minute = Number(match[2]);
  if (hours > 23 || minute > 59) return null;
  return { hour: hours % 12 || 12, minute, period: hours >= 12 ? 'PM' : 'AM' };
}

/** Complete draft -> "HH:mm"; incomplete draft -> null (nothing is emitted). */
export function toTime24(draft: TimeDraft): string | null {
  if (draft.hour === null || draft.minute === null || draft.period === null) return null;
  const hours = (draft.hour % 12) + (draft.period === 'PM' ? 12 : 0);
  return `${String(hours).padStart(2, '0')}:${formatMinute(draft.minute)}`;
}

export function applyHourChange(draft: TimeDraft, hour: number | null): TimeDraft {
  if (hour === null) return { ...draft, hour: null, minute: null };
  return { ...draft, hour, minute: 0 };
}

export function applyMinuteChange(draft: TimeDraft, minute: number | null): TimeDraft {
  return { ...draft, minute };
}

export function applyPeriodChange(draft: TimeDraft, period: Period | null): TimeDraft {
  return { ...draft, period };
}

/** 12-hour label for display outside the picker, e.g. "7:05 PM". */
export function formatDisplayTime(value: string | null | undefined): string {
  const draft = parseTime24(value);
  if (!draft || draft.hour === null || draft.minute === null) return '';
  return `${draft.hour}:${formatMinute(draft.minute)} ${draft.period}`;
}
