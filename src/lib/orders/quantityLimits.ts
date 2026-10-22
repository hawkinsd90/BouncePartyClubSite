// WP-15 (B12): the most of one line an order can carry. These are the SAME limits the server enforces when a customer books
// (bookingInput.ts) and when staff save an order (staff-order-save.ts); a test pins all three together. Before, staff screens allowed
// up to 99 of anything while the server refused more than 50 inflatables, and the failure was a generic error.
export const MAX_INFLATABLE_QTY = 50;
export const MAX_BUNDLE_QTY = 99;
export const MAX_PRODUCT_QTY = 500;

export type QtyKind = 'inflatable' | 'bundle' | 'product';

export function qtyKindOf(item: { unit_id?: string | null; bundle_id?: string | null; product_id?: string | null }): QtyKind {
  if (item.unit_id) return 'inflatable';
  if (item.bundle_id) return 'bundle';
  return 'product';
}

export function maxQtyForKind(kind: QtyKind): number {
  return kind === 'inflatable' ? MAX_INFLATABLE_QTY : kind === 'bundle' ? MAX_BUNDLE_QTY : MAX_PRODUCT_QTY;
}

export function clampQuantity(qty: number, max: number): { qty: number; clamped: boolean } {
  if (!Number.isFinite(qty) || qty < 1) return { qty: 1, clamped: false };
  return qty > max ? { qty: max, clamped: true } : { qty: Math.floor(qty), clamped: false };
}

export function quantityLimitMessage(kind: QtyKind, max: number): string {
  const what = kind === 'inflatable' ? 'inflatables' : kind === 'bundle' ? 'of one package' : 'of one item';
  return `The most you can add is ${max} ${what} on one order. The quantity was set to ${max}.`;
}
