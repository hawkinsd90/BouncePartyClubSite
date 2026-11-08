import { normalizeTime } from '../core/eventTimeWindow';

// The start and end time a duplicated order carries into the new Quote. WP-P2-12a (F-34): no invented 9:00 AM / 5:00 PM when the source order has
// no usable time: the new order starts blank and the customer chooses.
// DECIDED (D2, B-22): a duplicate carries the source order's own saved start and end time (editable on the Quote, validated there against the
// dates the customer chooses); only a missing or malformed source time stays blank. The source order is read, never written.
export function duplicateOrderTimes(source: { start_window?: unknown; end_window?: unknown }): { start_window: string; end_window: string } {
  return { start_window: normalizeTime(source.start_window), end_window: normalizeTime(source.end_window) };
}
