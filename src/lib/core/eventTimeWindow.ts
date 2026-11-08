// Pure rules for an event's start and end TIME (WP-P1-11, F-48 and WP-P2-12a, F-34). One place for the Quote validation, the Admin Edit Order
// save, and both invoice builders, so the three entry points cannot disagree. The Edge Functions (bookingInput.ts, staff-order-save.ts) hold the
// same comparison inline because they cannot import from src/; src/lib/tests/booking/eventTimeWindow.test.ts checks the two stay aligned.
//
// Rules:
// - A blank time is "not yet chosen", not an error here: the order check passes until both times exist. A separate prompt says a time is missing.
// - The order check applies only when the rental starts and ends on the SAME date. A rental that ends on a later date (multi-day) may have any
//   times, and a next-morning-pickup rental keeps its end date, with end times such as 20:00-23:59 on the event day, which is simply later than the start.
// - "End after start" is strict: an end equal to the start is a zero-length window and is refused with the same message.

export const END_BEFORE_START_MESSAGE = 'The end time must be after the start time on the same day. Please choose a later end time or an earlier start time.';
export const CHOOSE_START_TIME_MESSAGE = 'Please choose an event start time.';
export const CHOOSE_END_TIME_MESSAGE = 'Please choose an event end time.';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** True when the value is a usable "HH:mm" (or "HH:mm:ss") time. Blank, partial and malformed values are not. */
export function isCompleteTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/** "HH:mm" from "HH:mm" or "HH:mm:ss"; '' for anything that is not a complete time. */
export function normalizeTime(value: unknown): string {
  return isCompleteTime(value) ? value.slice(0, 5) : '';
}

/**
 * True when the times are acceptable together. Returns true whenever either time is blank (not yet chosen) or the rental spans more than one day;
 * only a same-date window whose end is not after its start returns false.
 */
export function isEndAfterStart(start: unknown, end: unknown, sameDate: boolean): boolean {
  if (!sameDate) return true;
  const s = normalizeTime(start);
  const e = normalizeTime(end);
  if (s === '' || e === '') return true;
  return e > s;
}

interface EventWindowFields {
  event_date?: unknown;
  event_end_date?: unknown;
  start_window?: unknown;
  end_window?: unknown;
}

/** True when the rental ends on its start date (an empty end date means the start date, as the servers read it). */
export function isSameDateRental(fields: Pick<EventWindowFields, 'event_date' | 'event_end_date'>): boolean {
  const start = typeof fields.event_date === 'string' ? fields.event_date.slice(0, 10) : '';
  const end = typeof fields.event_end_date === 'string' && fields.event_end_date ? fields.event_end_date.slice(0, 10) : start;
  return start !== '' && start === end;
}

/**
 * The message to show staff when the times cannot be saved, or null when they can. With requireTimes (a NEW invoice, or any save) a blank or
 * half-chosen window gets its own plain prompt instead of the server's generic 400.
 */
export function eventWindowProblem(fields: EventWindowFields, options: { requireTimes: boolean }): string | null {
  if (options.requireTimes) {
    if (!isCompleteTime(fields.start_window)) return CHOOSE_START_TIME_MESSAGE;
    if (!isCompleteTime(fields.end_window)) return CHOOSE_END_TIME_MESSAGE;
  }
  if (!isEndAfterStart(fields.start_window, fields.end_window, isSameDateRental(fields))) return END_BEFORE_START_MESSAGE;
  return null;
}
