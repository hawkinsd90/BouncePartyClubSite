// How an order line is named in emails, texts and receipts. Event Essentials lines (products and packages) have no `units` row: they carry
// their own name in `item_name`. Reading only `units(name)` printed "undefined" / a blank name / "Item" for them.

export interface LabelledOrderItem {
  qty?: number | null;
  wet_or_dry?: string | null;
  unit_price_cents?: number | null;
  unit_id?: string | null;
  product_id?: string | null;
  bundle_id?: string | null;
  item_name?: string | null;
  units?: { name?: string | null } | null;
}

/** The columns every order-item select needs to name a line (nested relation included). */
export const ORDER_ITEM_COLUMNS = "qty, wet_or_dry, unit_price_cents, unit_id, product_id, bundle_id, item_name, units(name)";

export function orderItemName(item: LabelledOrderItem): string {
  const unit = Array.isArray(item.units) ? (item.units as Array<{ name?: string | null }>)[0] : item.units;
  const name = (unit?.name ?? item.item_name ?? "").toString().trim();
  return name || "Item";
}

/** "Dry" / "Wet" for inflatables only; Event Essentials lines have no wet/dry. */
export function orderItemMode(item: LabelledOrderItem): "Dry" | "Wet" | null {
  const isInflatable = !!item.unit_id || (!item.product_id && !item.bundle_id && !item.item_name);
  if (!isInflatable) return null;
  if (item.wet_or_dry === "water") return "Wet";
  if (item.wet_or_dry === "dry") return "Dry";
  return null;
}

/** "2x Castle (Dry)" for an inflatable, "4x Round Tables" for Event Essentials. */
export function orderItemLabel(item: LabelledOrderItem): string {
  const mode = orderItemMode(item);
  return `${item.qty || 1}x ${orderItemName(item)}${mode ? ` (${mode})` : ""}`;
}

/** "2x Castle" without the wet/dry mode, for the receipts that never showed it. */
export function orderItemQtyName(item: LabelledOrderItem): string {
  return `${item.qty || 1}x ${orderItemName(item)}`;
}
