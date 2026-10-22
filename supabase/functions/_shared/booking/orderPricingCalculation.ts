// GENERATED COPY of src/lib/pricing/orderPricingCalculation.ts (sliced). Do not edit here.
// Edit the source and run: node node_modules/jiti/bin/jiti.js src/lib/tooling/bookingSharedCopy.ts --write
// A test fails if this file differs from its source. Used by create-booking so the server prices exactly like the Quote.

// Pure order pricing engine.
//
// This is the deterministic money calculation that used to live inside
// usePricing.calculatePricing, extracted without changing one cent of output. The hook still
// owns everything that is not deterministic: React state, the stale-result guard, the revision,
// Google geocoding and driving-distance lookups, and the display formatting
// (formatOrderSummary). The hook resolves the distance and hands it in, together with the
// clock-dependent same-day weekday check, so this module never touches the network, the
// browser, refs or the current time.
//
//   hook: assemble inputs, resolve distance            (I/O)
//     -> calculateOrderPricing                          (pure, this module)
//     -> hook: commit state, formatOrderSummary
//
// The current rules are the contract. Deliberately preserved behavior (do not "fix" in a
// structural change; each is pinned by orderPricingCalculation.test.ts):
// - Order of operations: existing-order flags -> items/EE subtotal/days/Generator state ->
//   calculatePrice -> subtotal with EE -> original (saved or computed) fee amounts -> waivers ->
//   Setup Fee -> custom fees -> discounts -> taxable base -> tax -> total -> deposit -> custom
//   deposit -> clamp -> balance -> summary data -> result.
// - A discount is ONE amount (orderMoney.effectiveDiscountCents): amount_cents > 0 wins, else the percentage of the equipment
//   subtotal; never both. The total and the returned discount_total_cents use the same number, and discounts together never exceed
//   what they discount. (Supersedes the old pinned quirk where the total was amount-first and the display percentage-first.)
// - A stored same-day pickup fee is reused for an existing order whose pickup factors are unchanged, including a stored 0
//   (the pickup fee is a snapshot, not re-read from today's rules). (Supersedes the old truthiness quirk.)
// - Tax is orderMoney.calculateSalesTaxCents (6%, rounded ONCE) on subtotal-with-EE + final travel + surface + Generator +
//   Setup Fee + custom fees - discounts. Same-day pickup and weekday-delivery fees are NOT taxable.
//   Whether tax applies is orderMoney.effectiveTaxEnabled (the tax-waived toggle INVERTS when apply_taxes_by_default is false).
// - An existing order is a pricing snapshot. Unchanged components keep their stored value (subtotal, surface fee, same-day
//   pickup, weekday delivery, travel, setup fee, tax decision, formula-derived deposit); only components whose basis the Admin
//   actually changed are recalculated from today's rules.
// - Setup Fee: an explicit override wins (including 0); else the stored fee when supplied and the
//   equipment basis is unchanged; else the calculated fee. Setup Fee is not in the EE-only deposit basis.
// - Existing orders: only a CHANGED legacy Generator quantity is priced; an unchanged one keeps the
//   stored fee, and an unchanged waived one shows a display-only pre-waiver fee.
// - custom_fees_total_cents sums the raw amount_cents (no `|| 0`), while the total uses `|| 0`.
//
// The five fields the hook used to read from the formatted summary (custom fees total, discount
// total, total, deposit due, balance due) are computed here with the same helpers the summary
// builder uses; formatOrderSummary only passes them through.

import { calculatePrice, type PricingRules } from './pricing.ts';
import { calculateRequiredDepositCents, parseBookingDepositSettings } from './depositCalculation.ts';
import { calculateEventEssentialsSetupFeeCents } from './setupFeeCalculation.ts';
import {
  calculateSalesTaxCents,
  composeOrderTotal,
  effectiveTaxEnabled,
  isWholeCents,
} from './orderMoney.ts';
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OrderSummaryData = any;

export interface PricingItem {
  unit_id: string;
  unit_name: string;
  qty: number;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  is_new?: boolean;
  is_deleted?: boolean;
}

// A discount / custom fee as the editor holds it (the same shapes the order summary displays).
export interface PricingDiscountInput {
  id?: string;
  name: string;
  amount_cents?: number;
  percentage?: number;
}
export interface PricingCustomFeeInput {
  id?: string;
  name: string;
  amount_cents: number;
}

export interface EEProductItem {
  product_id: string;
  bundle_id?: string | null;
  item_name?: string;
  product_name: string;
  qty: number;
  unit_price_cents: number;
  pricing_context?: string;
  component_snapshot?: { components?: Array<{ product_name: string; quantity_per_bundle: number }> } | null;
  is_new?: boolean;
  is_deleted?: boolean;
}

export interface FeeWaivers {
  taxWaived?: boolean;
  travelFeeWaived?: boolean;
  sameDayPickupFeeWaived?: boolean;
  surfaceFeeWaived?: boolean;
  generatorFeeWaived?: boolean;
  sameDayWeekdayDeliveryFeeWaived?: boolean;
}

export interface CalculatePricingParams {
  items: PricingItem[];
  eeProductItems?: EEProductItem[];
  eventDetails: {
    event_date: string;
    event_end_date: string;
    location_type: 'residential' | 'commercial';
    surface: 'grass' | 'cement';
    pickup_preference: string;
    generator_qty: number;
    address_line1: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    lat?: number;
    lng?: number;
  };
  discounts: PricingDiscountInput[];
  customFees: PricingCustomFeeInput[];
  customDepositCents: number | null;
  customSetupFeeCents: number | null;
  storedSetupFeeCents?: number | null;
  setupFeeBasisChanged?: boolean;
  // True when the Admin added, removed or changed an equipment line on an existing order. Without it, an existing order's stored
  // subtotal and formula-derived deposit are kept.
  equipmentBasisChanged?: boolean;
  pricingRules: PricingRules;
  feeWaivers?: FeeWaivers;
  existingOrder?: {
    travel_fee_cents?: number;
    travel_total_miles?: number;
    same_day_pickup_fee_cents?: number;
    location_type?: string;
    pickup_preference?: string;
    addresses?: {
      line1: string;
      city: string;
      state: string;
      zip: string;
      lat?: string;
      lng?: string;
    };
    tip_cents?: number;
    deposit_paid_cents?: number;
    event_date?: string;
    same_day_weekday_delivery_fee_cents?: number;
    generator_fee_cents?: number;
    generator_qty?: number;
    waived_fee_amounts_cents?: Partial<Record<WaivableFee, number>> | null;
    // The stored snapshot (all optional: an order without them is priced from today's rules).
    event_end_date?: string | null;
    subtotal_cents?: number | null;
    surface?: string | null;
    surface_fee_cents?: number | null;
    // How the stored travel fee was reached (kept with it, so an unrelated edit does not restate them from today's rules).
    travel_base_radius_miles?: number | string | null;
    travel_chargeable_miles?: number | string | null;
    travel_per_mile_cents?: number | null;
    travel_is_flat_fee?: boolean | null;
    travel_fee_waived?: boolean | null;
    surface_fee_waived?: boolean | null;
    same_day_pickup_fee_waived?: boolean | null;
    same_day_weekday_delivery_fee_waived?: boolean | null;
    generator_fee_waived?: boolean | null;
    tax_waived?: boolean | null;
    tax_cents?: number | null;
    setup_fee_cents?: number | null;
    deposit_due_cents?: number | null;
    custom_deposit_cents?: number | null;
  };
}

// The fees that can be waived and whose waived amount is kept for display ("$X - Waived").
export type WaivableFee = 'travel' | 'surface' | 'same_day_pickup' | 'same_day_weekday_delivery' | 'generator';

export interface CalculatedPricing {
  // The amounts of the fees that are waived right now, when they are KNOWN: stored when the fee was waived (or priced again
  // because its basis changed). A waived fee whose amount was never stored is simply absent: it is never rebuilt from today's
  // rules. This is what gets saved with the order.
  waived_fee_amounts_cents: Partial<Record<WaivableFee, number>>;
  // Waived fees whose historical amount is unknown (legacy waivers). Displays say "Waived" without a dollar figure.
  waived_fee_amount_unknown: WaivableFee[];
  subtotal_cents: number;
  generator_fee_cents: number;
  travel_fee_cents: number;
  travel_total_miles: number;
  travel_base_radius_miles?: number;
  travel_chargeable_miles?: number;
  travel_per_mile_cents?: number;
  travel_is_flat_fee?: boolean;
  travel_fee_display_name?: string;
  distance_miles: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  same_day_weekday_delivery_fee_cents: number;
  custom_fees_total_cents: number;
  discount_total_cents: number;
  tax_cents: number;
  total_cents: number;
  deposit_due_cents: number;
  balance_due_cents: number;
  event_essentials_subtotal_cents: number;
  generator_fee_before_waiver_cents: number;
  setup_fee_cents: number;
  setup_fee_before_override_cents: number;
}

export type OrderPricingCalculationResult =
  | { status: 'ok'; calculatedPricing: CalculatedPricing; orderData: OrderSummaryData }
  | { status: 'deposit_config_error'; error: string };

// What the hook resolves (I/O or clock) and passes in.
export interface ResolvedPricingInputs {
  // The driving distance the hook resolved (the stored miles when the saved travel fee is reused).
  distanceMiles: number;
  // The clock-dependent same-day weekday check. Called only when the stored weekday-delivery fee
  // is NOT being reused, exactly like the inline code did.
  isSameDayWeekdayDelivery: (eventDateYmd: string, days?: readonly number[] | null) => boolean;
  // The city that may decide a FREE delivery, verified by the server for a new or changed address (WP-18). undefined = no verification was
  // run (the typed city is used, exactly as before); null or '' = verification ran and could not confirm a free city (no free grant).
  verifiedTravelCity?: string | null;
}

// The one pure decision the hook also needs before doing any distance work: reuse the stored
// travel fee and miles (existing order, unchanged address, stored positive travel fee).
export function shouldReuseSavedTravel(
  eventDetails: Pick<CalculatePricingParams['eventDetails'], 'address_line1' | 'address_city' | 'address_state' | 'address_zip'>,
  existingOrder: CalculatePricingParams['existingOrder'],
): boolean {
  // Check if address has changed (for order edits). Letter case, surrounding spaces and repeated spaces are not a change.
  const same = (a: string | null | undefined, b: string | null | undefined) =>
    String(a ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const addressChanged = existingOrder
    ? !same(eventDetails.address_line1, existingOrder.addresses?.line1) ||
      !same(eventDetails.address_city, existingOrder.addresses?.city) ||
      !same(eventDetails.address_state, existingOrder.addresses?.state) ||
      !same(eventDetails.address_zip, existingOrder.addresses?.zip)
    : true;
  if (!existingOrder || addressChanged) return false;
  // A positive stored fee is always reused. A stored $0 is reused too when the order carries its travel snapshot (the rate and the radius
  // it was priced with), so an unrelated edit does not re-price a free delivery that was granted at booking time.
  const fee = existingOrder.travel_fee_cents;
  if (fee && fee > 0) return true;
  // A $0 that exists only because the fee was waived is not a free delivery: removing the waiver must price the fee again.
  return fee === 0 && !existingOrder.travel_fee_waived && existingOrder.travel_per_mile_cents != null && existingOrder.travel_base_radius_miles != null;
}

export function calculateOrderPricing(
  params: CalculatePricingParams,
  resolved: ResolvedPricingInputs,
): OrderPricingCalculationResult {
  const {
    items,
    eeProductItems = [],
    eventDetails,
    discounts,
    customFees,
    customDepositCents,
    customSetupFeeCents = null,
    storedSetupFeeCents = null,
    setupFeeBasisChanged = false,
    equipmentBasisChanged = false,
    pricingRules,
    feeWaivers = {},
    existingOrder,
  } = params;
  const {
    taxWaived = false,
    travelFeeWaived = false,
    sameDayPickupFeeWaived = false,
    surfaceFeeWaived = false,
    generatorFeeWaived = false,
    sameDayWeekdayDeliveryFeeWaived = false,
  } = feeWaivers;

  // Check if factors affecting same-day pickup fee have changed
  const locationTypeChanged = existingOrder
    ? eventDetails.location_type !== existingOrder.location_type
    : false;
  const pickupPreferenceChanged = existingOrder
    ? eventDetails.pickup_preference !== existingOrder.pickup_preference
    : false;
  const sameDayFeeFactorsChanged = locationTypeChanged || pickupPreferenceChanged;
  // A fee that was waived when saved is stored as 0; turning the waiver off must price it again, not keep the 0.
  const waiverUnchanged = (now: boolean, stored?: boolean | null) => !existingOrder || now === !!stored;

  const useSavedTravelFee = shouldReuseSavedTravel(eventDetails, existingOrder);
  const distance_miles = resolved.distanceMiles;
  let useSavedSameDayFee = false;

  // Determine if we should use saved same-day fee
  if (existingOrder && !sameDayFeeFactorsChanged && existingOrder.same_day_pickup_fee_cents !== null && existingOrder.same_day_pickup_fee_cents !== undefined) {
    useSavedSameDayFee = true;
  }

  // Determine if we should use saved weekday delivery fee or compute fresh
  const eventDateChanged = existingOrder
    ? eventDetails.event_date !== existingOrder.event_date?.split('T')[0]
    : false;
  const useSavedWeekdayDeliveryFee = !!(
    existingOrder &&
    !eventDateChanged &&
    existingOrder.same_day_weekday_delivery_fee_cents !== undefined &&
    existingOrder.same_day_weekday_delivery_fee_cents !== null &&
    (waiverUnchanged(sameDayWeekdayDeliveryFeeWaived, existingOrder.same_day_weekday_delivery_fee_waived) ||
      existingOrder.same_day_weekday_delivery_fee_cents > 0)
  );
  const isSameDayWeekday = useSavedWeekdayDeliveryFee ? false : resolved.isSameDayWeekdayDelivery(eventDetails.event_date, pricingRules?.same_day_delivery_fee_days);

  // Filter out deleted items for existing orders
  const activeItems = items.filter(item => !item.is_deleted);
  const activeEEItems = eeProductItems.filter(item => !item.is_deleted);
  const eeSubtotalCents = activeEEItems.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);

  const pricingItems = activeItems.map(item => ({
    unit_id: item.unit_id,
    qty: item.qty,
    wet_or_dry: item.wet_or_dry,
    unit_price_cents: item.unit_price_cents,
  }));

  // Calculate number of days
  const eventStartDate = new Date(eventDetails.event_date);
  const eventEndDate = new Date(eventDetails.event_end_date || eventDetails.event_date);
  const diffTime = Math.abs(eventEndDate.getTime() - eventStartDate.getTime());
  const numDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

  // Generator qty: detect intentional change for legacy fee recalculation
  const existingLegacyQty = existingOrder?.generator_qty ?? 0;
  const editedLegacyQty = eventDetails.generator_qty ?? 0;
  const legacyQtyChanged = existingOrder ? editedLegacyQty !== existingLegacyQty : false;
  const generatorQtyForPricing = existingOrder
    ? (legacyQtyChanged ? editedLegacyQty : 0)
    : editedLegacyQty;
  const hasGeneratorForPricing = existingOrder
    ? (legacyQtyChanged && editedLegacyQty > 0)
    : editedLegacyQty > 0;

  // The city that may decide a free delivery: the verified one when the server verified a new/changed address, otherwise the typed one.
  const travelCity = resolved.verifiedTravelCity === undefined ? eventDetails.address_city : (resolved.verifiedTravelCity ?? '');

  // Calculate pricing
  const priceBreakdown = calculatePrice({
    items: pricingItems,
    location_type: eventDetails.location_type,
    surface: eventDetails.surface,
    can_use_stakes: eventDetails.surface === 'grass',
    overnight_allowed: eventDetails.pickup_preference === 'next_day',
    num_days: numDays,
    distance_miles,
    city: travelCity,
    zip: eventDetails.address_zip,
    has_generator: hasGeneratorForPricing,
    generator_qty: generatorQtyForPricing,
    rules: pricingRules,
    is_same_day_weekday_delivery: isSameDayWeekday,
  });

  // Prepare items for display
  const displayItems = activeItems.map(item => ({
    unit_id: item.unit_id,
    qty: item.qty,
    wet_or_dry: item.wet_or_dry,
    unit_price_cents: item.unit_price_cents,
    is_new: item.is_new || false,
    units: {
      name: item.unit_name,
      price_dry_cents: item.wet_or_dry === 'dry' ? item.unit_price_cents : 0,
      price_water_cents: item.wet_or_dry === 'water' ? item.unit_price_cents : 0,
    }
  }));

  const eeDisplayItems = activeEEItems.map(item => ({
    product_id: item.product_id || '',
    bundle_id: item.bundle_id,
    item_name: item.item_name,
    product_name: item.product_name,
    qty: item.qty,
    unit_price_cents: item.unit_price_cents,
    pricing_context: item.pricing_context,
    component_snapshot: item.component_snapshot,
    is_new: item.is_new || false,
  }));

  // The equipment subtotal of an existing order is its stored snapshot unless the Admin changed what is booked, the rental mode
  // (residential/commercial) or the number of days: only then is it priced again from today's multipliers.
  const existingNumDays = existingOrder
    ? Math.ceil(Math.abs(new Date(existingOrder.event_end_date || existingOrder.event_date || eventDetails.event_date).getTime() - new Date(existingOrder.event_date || eventDetails.event_date).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : null;
  const equipmentSnapshotUnchanged = !!existingOrder
    && !equipmentBasisChanged
    && !locationTypeChanged
    && existingNumDays === numDays
    && isWholeCents(existingOrder.subtotal_cents)
    && (existingOrder.subtotal_cents > 0 || activeItems.length + activeEEItems.length === 0);
  const subtotalWithEE = equipmentSnapshotUnchanged
    ? (existingOrder!.subtotal_cents as number)
    : priceBreakdown.subtotal_cents + eeSubtotalCents;

  // Store original amounts before waivers (for display)
  const originalTravelFeeCents = useSavedTravelFee && existingOrder
    ? (existingOrder.travel_fee_cents ?? 0)
    : priceBreakdown.travel_fee_cents;
  const finalTravelMiles = useSavedTravelFee && existingOrder?.travel_total_miles
    ? parseFloat(String(existingOrder.travel_total_miles)) || 0
    : priceBreakdown.travel_total_miles || 0;
  const surfaceSnapshotUnchanged = !!existingOrder
    && !equipmentBasisChanged
    && (eventDetails.surface ?? null) === (existingOrder.surface ?? null)
    && waiverUnchanged(surfaceFeeWaived, existingOrder.surface_fee_waived)
    && isWholeCents(existingOrder.surface_fee_cents)
    && (existingOrder.surface_fee_cents as number) > 0;
  // When the stored travel fee is reused, the numbers that explain it are the stored ones too.
  const savedTravelDetail = useSavedTravelFee && existingOrder
    && existingOrder.travel_base_radius_miles != null
    && existingOrder.travel_chargeable_miles != null
    && existingOrder.travel_per_mile_cents != null
    ? {
        base: parseFloat(String(existingOrder.travel_base_radius_miles)),
        chargeable: parseFloat(String(existingOrder.travel_chargeable_miles)),
        perMile: existingOrder.travel_per_mile_cents as number,
        flat: !!existingOrder.travel_is_flat_fee,
      }
    : null;
  const originalSurfaceFeeCents = surfaceSnapshotUnchanged
    ? (existingOrder!.surface_fee_cents as number)
    : priceBreakdown.surface_fee_cents;
  const originalSameDayPickupFeeCents = useSavedSameDayFee
    && waiverUnchanged(sameDayPickupFeeWaived, existingOrder?.same_day_pickup_fee_waived)
    && ((existingOrder?.same_day_pickup_fee_cents ?? 0) > 0 || !sameDayPickupFeeWaived)
    ? (existingOrder?.same_day_pickup_fee_cents ?? 0)
    : priceBreakdown.same_day_pickup_fee_cents;
  // Display-only pre-waiver fee: for unchanged waived legacy generator,
  // calculate what the fee WOULD be for the current qty using current rules.
  let originalGeneratorFeeCents: number;
  if (legacyQtyChanged) {
    originalGeneratorFeeCents = priceBreakdown.generator_fee_cents;
  } else if (existingOrder && generatorFeeWaived && editedLegacyQty > 0) {
    // Unchanged waived historical generator — compute display-only pre-waiver fee
    const preWaiverBreakdown = calculatePrice({
      items: [],
      location_type: eventDetails.location_type,
      surface: eventDetails.surface,
      can_use_stakes: eventDetails.surface === 'grass',
      overnight_allowed: eventDetails.pickup_preference === 'next_day',
      num_days: numDays,
      distance_miles: 0,
      city: eventDetails.address_city,
      zip: eventDetails.address_zip,
      has_generator: true,
      generator_qty: editedLegacyQty,
      rules: pricingRules,
      is_same_day_weekday_delivery: false,
    });
    originalGeneratorFeeCents = preWaiverBreakdown.generator_fee_cents;
  } else if (existingOrder && (existingOrder.generator_fee_cents ?? null) !== null && (existingOrder.generator_fee_cents ?? 0) > 0) {
    originalGeneratorFeeCents = existingOrder.generator_fee_cents!;
  } else {
    originalGeneratorFeeCents = priceBreakdown.generator_fee_cents;
  }
  const originalSameDayWeekdayDeliveryFeeCents = useSavedWeekdayDeliveryFee && existingOrder?.same_day_weekday_delivery_fee_cents !== undefined
    ? (existingOrder.same_day_weekday_delivery_fee_cents ?? 0)
    : priceBreakdown.same_day_weekday_delivery_fee_cents;

  // A waived fee shows the amount it was waived at - never today's rule applied to an old order. That amount is only known if it
  // was stored when the fee was waived (or when its basis last changed); otherwise it is unknown and shown as "Waived".
  const priorWaived = (existingOrder?.waived_fee_amounts_cents ?? null) as Partial<Record<WaivableFee, number>> | null;
  const addressSame = !!existingOrder
    && eventDetails.address_line1 === (existingOrder.addresses?.line1 || '')
    && eventDetails.address_city === (existingOrder.addresses?.city || '')
    && eventDetails.address_state === (existingOrder.addresses?.state || '')
    && eventDetails.address_zip === (existingOrder.addresses?.zip || '');
  const waivedAmountUnknown: WaivableFee[] = [];
  const waivedAmounts: Partial<Record<WaivableFee, number>> = {};
  const resolveWaived = (key: WaivableFee, waivedNow: boolean, wasWaived: boolean | null | undefined, basisUnchanged: boolean, computedOriginal: number): number => {
    if (!waivedNow) return computedOriginal;
    if (existingOrder && wasWaived && basisUnchanged) {
      const stored = priorWaived?.[key];
      if (typeof stored === 'number' && Number.isSafeInteger(stored) && stored >= 0) {
        waivedAmounts[key] = stored;
        return stored;
      }
      waivedAmountUnknown.push(key);
      return 0;
    }
    waivedAmounts[key] = computedOriginal;
    return computedOriginal;
  };
  const waivedTravelFeeCents = resolveWaived('travel', travelFeeWaived, existingOrder?.travel_fee_waived, addressSame, originalTravelFeeCents);
  const waivedSurfaceFeeCents = resolveWaived('surface', surfaceFeeWaived, existingOrder?.surface_fee_waived, !!existingOrder && !equipmentBasisChanged && (eventDetails.surface ?? null) === (existingOrder.surface ?? null), originalSurfaceFeeCents);
  const waivedSameDayPickupFeeCents = resolveWaived('same_day_pickup', sameDayPickupFeeWaived, existingOrder?.same_day_pickup_fee_waived, !!existingOrder && !sameDayFeeFactorsChanged, originalSameDayPickupFeeCents);
  const waivedGeneratorFeeCents = resolveWaived('generator', generatorFeeWaived, existingOrder?.generator_fee_waived, !!existingOrder && !legacyQtyChanged, originalGeneratorFeeCents);
  const waivedWeekdayFeeCents = resolveWaived('same_day_weekday_delivery', sameDayWeekdayDeliveryFeeWaived, existingOrder?.same_day_weekday_delivery_fee_waived, !!existingOrder && !eventDateChanged, originalSameDayWeekdayDeliveryFeeCents);

  // Apply waivers for total calculation
  const finalTravelFeeCents = travelFeeWaived ? 0 : originalTravelFeeCents;
  const finalSurfaceFeeCents = surfaceFeeWaived ? 0 : originalSurfaceFeeCents;
  const finalSameDayPickupFeeCents = sameDayPickupFeeWaived ? 0 : originalSameDayPickupFeeCents;
  const finalGeneratorFeeCents = generatorFeeWaived ? 0 : originalGeneratorFeeCents;
  const finalSameDayWeekdayDeliveryFeeCents = sameDayWeekdayDeliveryFeeWaived ? 0 : originalSameDayWeekdayDeliveryFeeCents;

  // Setup Fee — EE-only orders with EE subtotal below threshold
  const inflatableQuantity = activeItems.reduce((sum, item) => sum + item.qty, 0);
  const hasInflatables = inflatableQuantity > 0;
  const calculatedSetupFeeCents = calculateEventEssentialsSetupFeeCents({
    hasInflatables,
    eventEssentialsSubtotalCents: eeSubtotalCents,
    setupMinimumCents: pricingRules.event_essentials_setup_minimum_cents ?? 15000,
  });
  // Historical freeze: when an existing order supplies a stored fee and the
  // equipment basis hasn't changed, keep the stored fee. New orders (no
  // stored fee supplied) always use the calculated fee. An explicit
  // override always wins, including $0.
  const effectiveSetupFeeCents =
    customSetupFeeCents !== null
      ? customSetupFeeCents
      : storedSetupFeeCents !== null && !setupFeeBasisChanged
        ? storedSetupFeeCents
        : calculatedSetupFeeCents;

  // The order's money, once: components -> discount -> tax (rounded once) -> total. All of it is orderMoney.
  const components = {
    subtotal_cents: subtotalWithEE,
    travel_fee_cents: finalTravelFeeCents,
    surface_fee_cents: finalSurfaceFeeCents,
    same_day_pickup_fee_cents: finalSameDayPickupFeeCents,
    same_day_weekday_delivery_fee_cents: finalSameDayWeekdayDeliveryFeeCents,
    generator_fee_cents: finalGeneratorFeeCents,
    setup_fee_cents: effectiveSetupFeeCents,
  };
  const beforeTax = composeOrderTotal(components, discounts, customFees, 0);

  // Whether tax applies. An existing order whose tax toggle the Admin has not touched keeps the decision it was saved with, even if
  // the business default has changed since; a changed toggle (or a new order) follows the current policy.
  const currentTaxPolicy = effectiveTaxEnabled({ applyTaxesByDefault: pricingRules.apply_taxes_by_default, taxWaived });
  let taxEnabled = currentTaxPolicy;
  if (existingOrder && isWholeCents(existingOrder.tax_cents) && !!existingOrder.tax_waived === taxWaived) {
    const storedBase = composeOrderTotal(
      {
        subtotal_cents: existingOrder.subtotal_cents,
        travel_fee_cents: existingOrder.travel_fee_cents,
        surface_fee_cents: existingOrder.surface_fee_cents,
        generator_fee_cents: existingOrder.generator_fee_cents,
        setup_fee_cents: existingOrder.setup_fee_cents,
      },
      discounts,
      customFees,
      0,
    ).taxableAfterDiscountCents;
    if (storedBase > 0) taxEnabled = existingOrder.tax_cents > 0;
  }
  const finalTaxCents = taxEnabled ? calculateSalesTaxCents(beforeTax.taxableAfterDiscountCents) : 0;
  const customFeesTotalCents = beforeTax.customFeesCents;
  const discountTotalCents = beforeTax.discountCents;
  const finalTotalCents = composeOrderTotal(components, discounts, customFees, finalTaxCents).totalCents;

  // Calculate deposit — EE-only orders use EE deposit tier
  // Setup Fee is NOT included in the deposit basis
  let calculatedDepositDueCents: number = 0;
  let depositConfigError: string | null = null;
  // A formula-derived deposit of an existing order is its snapshot while the booked equipment is unchanged. (A deposit that was an
  // Admin override is not a formula result: clearing the override recalculates it from today's rules.)
  const reuseStoredDeposit = !!existingOrder
    && !equipmentBasisChanged
    && customDepositCents === null
    && (existingOrder.custom_deposit_cents === null || existingOrder.custom_deposit_cents === undefined)
    && isWholeCents(existingOrder.deposit_due_cents);
  if (reuseStoredDeposit) {
    calculatedDepositDueCents = existingOrder!.deposit_due_cents as number;
  } else if (inflatableQuantity === 0 && eeSubtotalCents > 0) {
    const depositSettings = parseBookingDepositSettings(pricingRules);
    if (depositSettings.status === 'ready') {
      const eeDeposit = calculateRequiredDepositCents({
        inflatableQuantity: 0,
        eventEssentialsSubtotalCents: eeSubtotalCents,
        orderTotalCents: finalTotalCents,
        inflatableDepositPerUnitCents: depositSettings.inflatableDepositPerUnitCents,
        eeOnlyDepositSettings: depositSettings.eventEssentialsDepositSettings,
      });
      if (eeDeposit.status === 'calculated') {
        calculatedDepositDueCents = eeDeposit.depositCents;
      } else {
        depositConfigError = eeDeposit.error || 'Deposit calculation failed for this Event Essentials-only order.';
      }
    } else {
      depositConfigError = depositSettings.error || 'Deposit configuration is invalid for this Event Essentials-only order.';
    }
  } else {
    calculatedDepositDueCents = priceBreakdown.deposit_due_cents;
  }
  if (depositConfigError) {
    return { status: 'deposit_config_error', error: depositConfigError };
  }
  const rawDepositDueCents = customDepositCents !== null ? customDepositCents : calculatedDepositDueCents;
  const depositDueCents = Math.min(rawDepositDueCents, finalTotalCents);
  const balanceDueCents = Math.max(0, finalTotalCents - depositDueCents);

  // Build order summary data (with ORIGINAL amounts for display)
  const orderData: OrderSummaryData = {
    items: displayItems,
    eeProductItems: eeDisplayItems,
    discounts,
    customFees,
    subtotal_cents: subtotalWithEE,
    travel_fee_cents: waivedTravelFeeCents,
    travel_total_miles: finalTravelMiles,
    surface_fee_cents: waivedSurfaceFeeCents,
    same_day_pickup_fee_cents: waivedSameDayPickupFeeCents,
    same_day_weekday_delivery_fee_cents: waivedWeekdayFeeCents,
    generator_fee_cents: waivedGeneratorFeeCents,
    waived_amount_unknown: waivedAmountUnknown,
    generator_qty: eventDetails.generator_qty || 0,
    tax_cents: finalTaxCents,
    tip_cents: existingOrder?.tip_cents || 0,
    total_cents: finalTotalCents,
    deposit_due_cents: depositDueCents,
    deposit_paid_cents: existingOrder?.deposit_paid_cents || 0,
    balance_due_cents: balanceDueCents,
    custom_deposit_cents: customDepositCents,
    pickup_preference: eventDetails.pickup_preference,
    event_date: eventDetails.event_date,
    event_end_date: eventDetails.event_end_date,
    same_day_weekday_delivery_fee_waived: sameDayWeekdayDeliveryFeeWaived || false,
    setup_fee_cents: effectiveSetupFeeCents,
  };

  // These five used to be read back from the formatted summary. The summary builder passes
  // total/deposit/balance through unchanged and computes custom fees (raw amount_cents) and
  // discounts (calculateDiscountAmounts) with the helper used here, so this is the same value.
  const calculatedPricing: CalculatedPricing = {
    subtotal_cents: subtotalWithEE,
    generator_fee_cents: finalGeneratorFeeCents,
    travel_fee_cents: finalTravelFeeCents,
    travel_total_miles: finalTravelMiles,
    travel_base_radius_miles: savedTravelDetail ? savedTravelDetail.base : priceBreakdown.travel_base_radius_miles,
    travel_chargeable_miles: savedTravelDetail ? savedTravelDetail.chargeable : priceBreakdown.travel_chargeable_miles,
    travel_per_mile_cents: savedTravelDetail ? savedTravelDetail.perMile : priceBreakdown.travel_per_mile_cents,
    travel_is_flat_fee: savedTravelDetail ? savedTravelDetail.flat : priceBreakdown.travel_is_flat_fee,
    travel_fee_display_name: priceBreakdown.travel_fee_display_name,
    distance_miles: finalTravelMiles,
    surface_fee_cents: finalSurfaceFeeCents,
    same_day_pickup_fee_cents: finalSameDayPickupFeeCents,
    same_day_weekday_delivery_fee_cents: finalSameDayWeekdayDeliveryFeeCents,
    custom_fees_total_cents: customFeesTotalCents,
    discount_total_cents: discountTotalCents,
    tax_cents: finalTaxCents,
    total_cents: finalTotalCents,
    deposit_due_cents: depositDueCents,
    balance_due_cents: balanceDueCents,
    event_essentials_subtotal_cents: eeSubtotalCents,
    generator_fee_before_waiver_cents: waivedGeneratorFeeCents,
    setup_fee_cents: effectiveSetupFeeCents,
    setup_fee_before_override_cents: calculatedSetupFeeCents,
    waived_fee_amounts_cents: waivedAmounts,
    waived_fee_amount_unknown: waivedAmountUnknown,
  };

  return { status: 'ok', calculatedPricing, orderData };
}
