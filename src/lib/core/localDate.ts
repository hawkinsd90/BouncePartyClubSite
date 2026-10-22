// A calendar date as the user sees it (yyyy-MM-dd in the device's local time).
//
// `date.toISOString().split('T')[0]` is the date in UTC, which is tomorrow for a time after about 7 or 8 pm in Detroit. Anything that
// keys a record by "the day" (mileage logs, the calendar's month range) must use the local date instead.
export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// The reading rules of the end-of-day mileage form.
export function endMileageProblem(endMileage: number, startMileage: number | null | undefined): string | null {
  if (!Number.isFinite(endMileage) || endMileage <= 0) return 'Please enter a valid mileage reading';
  if (typeof startMileage === 'number' && startMileage > 0 && endMileage < startMileage) {
    return `The ending reading can't be lower than the starting reading (${startMileage}).`;
  }
  return null;
}

// A date-only value from the database or a date input ("2026-11-10", or with a time after it) as a local calendar day, noon, so it
// shows as that day in every time zone. `new Date("2026-11-10")` is midnight UTC, which is the evening of the 9th in Detroit.
export function parseDateOnly(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return new Date(value);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

// Today in the visitor's own time zone, as a yyyy-MM-dd string (for <input type="date" min=...>).
export function todayLocalKey(now: Date = new Date()): string {
  return localDateKey(now);
}
