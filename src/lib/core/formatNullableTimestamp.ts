import { format } from 'date-fns';

// Formats a timestamp column that the database allows to be NULL (created_at and similar default to now(), so NULL cannot come from the
// application, but the column type says it can). A present value formats exactly as `format(new Date(value), pattern)` always did;
// a missing one gives an empty string instead of a 1970 date or a crash.
export function formatNullableTimestamp(value: string | null | undefined, pattern: string): string {
  return value ? format(new Date(value), pattern) : '';
}
