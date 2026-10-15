// Cart -> resolver staged-item mapping for InvoiceBuilder.
//
// This is the cart-item projection that appeared twice inline in InvoiceBuilder
// (once building the Generator resolver's completeStagedItems, once building the
// stagedItems passed to AddEventEssentialsSection). The two copies were identical
// and are replaced by this one helper. It maps exactly these keys, in this order,
// with no filtering, sorting, defaults or normalization; `mode` becomes `wet_or_dry`
// and `adjusted_price_cents` becomes `unit_price_cents`.
//
// The Event Essentials half of completeStagedItems is NOT shared: the resolver copy
// remaps staged EE rows while the section copy spreads them unchanged, so each stays
// inline in InvoiceBuilder.
//
// Type-only / dependency-free so it can be loaded from Node-based tests.

export interface InvoiceCartItemForResolver<Mode = string> {
  unit_id: string;
  qty: number;
  mode: Mode;
  adjusted_price_cents: number;
}

export function mapCartToStagedForResolver<Mode>(cartItems: InvoiceCartItemForResolver<Mode>[]) {
  return cartItems.map(item => ({
    unit_id: item.unit_id,
    qty: item.qty,
    wet_or_dry: item.mode,
    unit_price_cents: item.adjusted_price_cents,
    is_deleted: false as boolean,
  }));
}
