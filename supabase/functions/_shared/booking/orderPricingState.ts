// GENERATED COPY of src/lib/pricing/orderPricingState.ts. Do not edit here.
// Edit the source and run: node node_modules/jiti/bin/jiti.js src/lib/tooling/bookingSharedCopy.ts --write
// A test fails if this file differs from its source. Used by create-booking so the server prices exactly like the Quote.

// The state of an order that its price depends on, in one comparable shape.
//
// A staff order save is priced by the server against the order as it is stored. The browser tells the server which state it was
// looking at (`expectedState`); if the stored order has moved since (another save, a payment), the server refuses the save
// instead of overwriting newer pricing with stale arithmetic. The same pure function builds the state in the browser, in the
// server function, and (as a containment check) in the database, so all three agree on what "unchanged" means.
//
// Pure: no network, no clock.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PRICING_STATE_COLUMNS = [
  'status', 'subtotal_cents', 'event_essentials_subtotal_cents', 'travel_fee_cents', 'surface_fee_cents', 'same_day_pickup_fee_cents',
  'same_day_weekday_delivery_fee_cents', 'generator_fee_cents', 'setup_fee_cents', 'tax_cents', 'deposit_due_cents', 'balance_due_cents',
  'custom_deposit_cents', 'deposit_paid_cents', 'balance_paid_cents', 'tip_cents', 'event_date', 'event_end_date', 'location_type',
  'surface', 'pickup_preference', 'generator_qty', 'address_id',
  // Waivers and what they waived: another save that waives (or restores) a fee, changes its reason, or changes the recorded amount
  // makes an older view stale, because the next save would otherwise re-derive the fees from waiver flags it no longer matches.
  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',
  'generator_fee_waived', 'generator_fee_waive_reason', 'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason',
  'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason', 'waived_fee_amounts_cents',
  // The stored travel snapshot (the distance and the rule it was priced under).
  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',
] as const;
// Deliberately NOT part of the state: customer / contact text, notes, the admin message, signatures, photos, workflow and
// notification flags, Stripe identifiers and payment-method fields. None of them feeds a price, and the payment-owned money
// columns (deposit_paid, balance_paid, tip) that do are already listed above.

export interface OrderPricingState {
  columns: Record<string, string | number | boolean | Record<string, unknown> | null>;
  children: {
    items: Array<{ id: string; qty: number; unit_price_cents: number }>;
    discounts: Array<{ id: string; amount_cents: number; percentage: number }>;
    custom_fees: Array<{ id: string; amount_cents: number }>;
  };
}

const DATE_COLUMNS = new Set(['event_date', 'event_end_date']);
// Postgres numeric columns can reach a browser as a number or as a string; both are the same stored number.
const NUMERIC_COLUMNS = new Set(['travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents']);
const OBJECT_COLUMNS = new Set(['waived_fee_amounts_cents']);

function column(order: any, key: string): OrderPricingState['columns'][string] {
  const v = order?.[key];
  if (v === undefined || v === null) return null;
  if (OBJECT_COLUMNS.has(key) && typeof v === 'object') {
    // Key order is not meaningful in jsonb; a canonical order makes two equal objects compare equal.
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as any)[k]]));
  }
  if (NUMERIC_COLUMNS.has(key) && (typeof v === 'string' || typeof v === 'number') && Number.isFinite(Number(v))) return Number(v);
  if (DATE_COLUMNS.has(key) && typeof v === 'string') return v.slice(0, 10);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function orderPricingState(order: any, items: any[], discounts: any[], customFees: any[]): OrderPricingState {
  // Tolerant of an order whose event_end_date was never set: the database holds the date it was saved with.
  const columns: OrderPricingState['columns'] = {};
  // A column the caller's copy of the order does not carry is simply not part of ITS state (it cannot be compared).
  for (const key of PRICING_STATE_COLUMNS) if (order?.[key] !== undefined) columns[key] = column(order, key);
  return {
    columns,
    children: {
      items: (items || [])
        .filter((i) => i && i.id && !String(i.id).startsWith('new-'))
        .map((i) => ({ id: String(i.id), qty: Number(i.qty), unit_price_cents: Number(i.unit_price_cents) }))
        .sort(byId),
      discounts: (discounts || [])
        .filter((d) => d && d.id && !d.is_new)
        .map((d) => ({ id: String(d.id), amount_cents: Number(d.amount_cents || 0), percentage: Number(d.percentage || 0) }))
        .sort(byId),
      custom_fees: (customFees || [])
        .filter((f) => f && f.id && !f.is_new)
        .map((f) => ({ id: String(f.id), amount_cents: Number(f.amount_cents || 0) }))
        .sort(byId),
    },
  };
}

// Whether what the browser looked at (`expected`) is still what is stored (`current`): every column it carried is unchanged and the
// items, discounts and custom fees are exactly the same.
export function sameOrderPricingState(expected: OrderPricingState, current: OrderPricingState): boolean {
  for (const key of Object.keys(expected.columns)) {
    if (!(key in current.columns) || JSON.stringify(expected.columns[key]) !== JSON.stringify(current.columns[key])) return false;
  }
  return JSON.stringify(expected.children) === JSON.stringify(current.children);
}
