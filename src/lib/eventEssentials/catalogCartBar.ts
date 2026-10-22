// WP-24: the Party Add-Ons catalog keeps the cart below the products, which on a phone is a long scroll away. The pinned bar shows what
// is in the cart and how to continue; this is its wording, as pure functions.

export function cartBarItemLabel(totalQty: number): string {
  const n = Math.max(0, Math.floor(totalQty));
  return n === 1 ? '1 item' : `${n} items`;
}

export function shouldShowCartBar(totalQty: number): boolean {
  return Math.floor(totalQty) > 0;
}
