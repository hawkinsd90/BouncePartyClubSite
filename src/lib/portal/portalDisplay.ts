// What the customer portal's Order Details card shows when it cannot rely on the loaded order summary.
//
// The card used to fall back to `order.total_cents || 0`, but orders has no total_cents column (and the portal projection never sends one), so
// whenever the summary had not loaded the Total row read $0.00 under a Subtotal and fee rows that did show real amounts. The fallback is now the
// same one the approval screen uses: the total composed from the order's stored components.
import { storedOrderTotalCents, type OrderMoneyComponents } from '../pricing/orderMoney';

export function portalOrderTotalCents(order: OrderMoneyComponents, summary: { total: number } | null): number {
  return summary ? summary.total : storedOrderTotalCents(order, [], []);
}
