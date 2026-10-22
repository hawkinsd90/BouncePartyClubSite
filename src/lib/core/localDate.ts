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
