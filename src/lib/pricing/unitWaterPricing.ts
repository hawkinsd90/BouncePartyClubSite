// F-19: Water-mode rules for a unit, shared by the Admin items editor. The server owns the authoritative copy
// (supabase/functions/_shared/booking/bookingBuild.ts: unitSupportsWater / effectiveUnitPriceCents); a differential test keeps the two in agreement.
//
//   * A unit supports Water when its types say so (Combo / Water Slide) or it carries a real (> 0) water price.
//   * A water price of 0 or none on a wet-capable unit means "same as the base rental price", never free.
//   * A dry-only unit does not offer Water.

export interface WaterPricedUnit {
  types?: string[] | null;
  price_dry_cents?: number | null;
  price_water_cents?: number | null;
}

export function unitSupportsWater(unit: WaterPricedUnit): boolean {
  const types = Array.isArray(unit.types) ? unit.types : [];
  if (types.includes('Combo') || types.includes('Water Slide')) return true;
  return typeof unit.price_water_cents === 'number' && unit.price_water_cents > 0;
}

/** The price in cents of the unit in Water mode, or null when the unit cannot be rented in Water mode. */
export function effectiveWaterPriceCents(unit: WaterPricedUnit): number | null {
  if (!unitSupportsWater(unit)) return null;
  return typeof unit.price_water_cents === 'number' && unit.price_water_cents > 0 ? unit.price_water_cents : (unit.price_dry_cents ?? 0);
}
