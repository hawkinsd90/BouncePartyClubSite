// WP-25 (B17): how a task card says things. Pure, so each rule is tested.
import { formatTime } from '../utils';

export const CARD_EQUIPMENT_LIMIT = 3;

// The card lists the first few lines and says how many more there are (it used to drop the rest without a word).
export function equipmentSummary(items: readonly string[], limit: number = CARD_EQUIPMENT_LIMIT): { shown: string[]; more: number } {
  return { shown: items.slice(0, limit), more: Math.max(0, items.length - limit) };
}

// "$25.00 DUE": the cents are kept ($24.50 used to read as "$25 DUE").
export function balanceDueLabel(balanceDueCents: number): string {
  return `$${(Math.max(0, balanceDueCents) / 100).toFixed(2)} DUE`;
}

// "EN ROUTE" rather than "EN_ROUTE".
export function statusLabel(status: string | null | undefined): string {
  return (status || 'pending').replace(/[_-]+/g, ' ').toUpperCase();
}

// "10:00 AM - 2:00 PM"; a missing or "TBD" time reads "TBD".
export function eventTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  const f = (t: string | null | undefined) => (!t || t === 'TBD' || !/^\d{1,2}:\d{2}/.test(t) ? 'TBD' : formatTime(t));
  return `${f(start)} - ${f(end)}`;
}
