// Deterministic revision strings for the Order Detail modal.
//
// These two builders only CONSTRUCT the strings. The React ownership stays in
// OrderDetailModal: the useMemo calls and their dependency arrays, the ref
// mirrors, pricingPending / lastSuccessfullyPricedRevision / pricingIsCurrent,
// the debounce, the Generator resolution refs and every stale/context guard.
//
// Both are correctness contracts that compare strings for equality:
// - the pricing revision decides whether the last successful pricing still
//   matches the current inputs (pricing freshness and the Save gate);
// - the Generator context revision decides whether an in-flight Generator
//   resolution is still valid.
//
// They are deliberately kept as two explicit projections. The staged-item
// projections differ: the pricing revision includes is_new / is_updated, the
// Generator revision does not. Do not share a projection helper.
//
// Contract details that are pinned by tests:
// - property order is part of the string; nothing is sorted or canonicalized;
// - JSON.stringify drops undefined properties, keeps null, and keeps array order;
// - the pricing revision reads only the fields listed below (not address_line2,
//   can_stake, the waiver reasons, the admin message or require-card-on-file);
// - pricingRules is serialized as `pricingRules ?? null`.
//
// Type-only import: no runtime imports, so it can be loaded from Node-based tests.

import type { StagedItem } from './stagedItemModel';

// Discounts / custom fees are loose rows; only these fields are serialized.
export interface RevisionDiscountRow {
  id?: unknown;
  amount_cents?: unknown;
  percentage?: unknown;
  is_new?: unknown;
}

export interface RevisionCustomFeeRow {
  id?: unknown;
  amount_cents?: unknown;
  is_new?: unknown;
}

// The ten edited-order fields that affect pricing. The caller passes exactly
// these (so its dependency array can stay field-by-field).
export interface PricingRevisionEditedOrderFields {
  location_type: unknown;
  surface: unknown;
  generator_qty: unknown;
  address_line1: unknown;
  address_city: unknown;
  address_state: unknown;
  address_zip: unknown;
  pickup_preference: unknown;
  event_date: unknown;
  event_end_date: unknown;
}

export interface OrderDetailPricingRevisionInput {
  stagedItems: StagedItem[];
  discounts: RevisionDiscountRow[];
  customFees: RevisionCustomFeeRow[];
  customDepositCents: number | null;
  customSetupFeeCents: number | null;
  editedOrder: PricingRevisionEditedOrderFields;
  taxWaived: unknown;
  travelFeeWaived: unknown;
  sameDayPickupFeeWaived: unknown;
  surfaceFeeWaived: unknown;
  generatorFeeWaived: unknown;
  sameDayWeekdayDeliveryFeeWaived: unknown;
  pricingRules: unknown;
}

export function buildOrderDetailPricingRevision({
  stagedItems,
  discounts,
  customFees,
  customDepositCents,
  customSetupFeeCents,
  editedOrder,
  taxWaived,
  travelFeeWaived,
  sameDayPickupFeeWaived,
  surfaceFeeWaived,
  generatorFeeWaived,
  sameDayWeekdayDeliveryFeeWaived,
  pricingRules,
}: OrderDetailPricingRevisionInput): string {
  return JSON.stringify({
    stagedItems: stagedItems.map(i => ({
      unit_id: i.unit_id, product_id: i.product_id, bundle_id: i.bundle_id,
      qty: i.qty, wet_or_dry: i.wet_or_dry, unit_price_cents: i.unit_price_cents,
      pricing_context: i.pricing_context, component_snapshot: i.component_snapshot,
      is_new: i.is_new, is_deleted: i.is_deleted, is_updated: i.is_updated,
    })),
    discounts: discounts.map((d) => ({ id: d.id, amount_cents: d.amount_cents, percentage: d.percentage, is_new: d.is_new })),
    customFees: customFees.map((f) => ({ id: f.id, amount_cents: f.amount_cents, is_new: f.is_new })),
    customDepositCents,
    customSetupFeeCents,
    location_type: editedOrder.location_type,
    surface: editedOrder.surface,
    generator_qty: editedOrder.generator_qty,
    address_line1: editedOrder.address_line1,
    address_city: editedOrder.address_city,
    address_state: editedOrder.address_state,
    address_zip: editedOrder.address_zip,
    pickup_preference: editedOrder.pickup_preference,
    event_date: editedOrder.event_date,
    event_end_date: editedOrder.event_end_date,
    taxWaived,
    travelFeeWaived,
    sameDayPickupFeeWaived,
    surfaceFeeWaived,
    generatorFeeWaived,
    sameDayWeekdayDeliveryFeeWaived,
    pricingRules: pricingRules ?? null,
  });
}

export interface GeneratorContextRevisionInput {
  stagedItems: StagedItem[];
  eventDate: unknown;
  eventEndDate: unknown;
  generatorQty: unknown;
  generatorFeeWaived: unknown;
}

export function buildGeneratorContextRevision({
  stagedItems,
  eventDate,
  eventEndDate,
  generatorQty,
  generatorFeeWaived,
}: GeneratorContextRevisionInput): string {
  return JSON.stringify({
    stagedItems: stagedItems.map(i => ({
      unit_id: i.unit_id, product_id: i.product_id, bundle_id: i.bundle_id,
      qty: i.qty, wet_or_dry: i.wet_or_dry, unit_price_cents: i.unit_price_cents,
      pricing_context: i.pricing_context, component_snapshot: i.component_snapshot,
      is_deleted: i.is_deleted,
    })),
    event_date: eventDate,
    event_end_date: eventEndDate,
    generator_qty: generatorQty,
    generatorFeeWaived,
  });
}
