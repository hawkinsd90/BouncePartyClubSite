// Differential tests for the pure order pricing engine (orderPricingCalculation.ts).
//
// `oracle` below is a verbatim copy of the deterministic part of the old usePricing.calculatePricing
// callback, including its tail that read five fields back from the formatted summary. Only the
// I/O is replaced: the distance the hook resolves is injected (with the old saved-travel and
// stored-miles fallback logic kept inline), and the clock-dependent same-day weekday check is an
// injected function. `oracleFormatOrderSummary` is a verbatim copy of formatOrderSummary (the real
// one lives in a module that imports Supabase and cannot load under Node); it feeds the same pure
// helpers the real one feeds. The oracle never calls the new engine.
//
// For every scenario the COMPLETE results are compared: status or error, the 24-field
// calculated pricing object, and the OrderSummaryData handed to formatOrderSummary. Current
// quirks are pinned as part of the contract (see the header of orderPricingCalculation.ts).

import { calculatePrice } from './pricing';
import type { PricingRules } from './pricing';
import { calculateRequiredDepositCents, parseBookingDepositSettings } from './depositCalculation';
import { calculateEventEssentialsSetupFeeCents } from './setupFeeCalculation';
import { buildOrderSummaryDisplay } from './orderSummaryHelpers';
import { formatStoredOrderItems } from './formatStoredOrderItems';
import { calculateOrderPricing, shouldReuseSavedTravel } from './orderPricingCalculation';
import type { CalculatePricingParams, CalculatedPricing } from './orderPricingCalculation';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

// Strict structural equality: NaN equals NaN, own-undefined differs from a missing key.
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// ORACLE: a copy of the old deterministic code, changed ONLY where an approved BPC money rule superseded it (each marked "APPROVED"):
//   - a discount is one amount (amount_cents > 0 wins, else percentage; never both), and discounts never exceed what they discount;
//   - a custom fee is whole, non-negative cents; anything else contributes nothing;
//   - tax is rounded once on a taxable amount that never goes below zero;
//   - a stored same-day pickup / weekday delivery fee of an existing order is a snapshot (a stored 0 included) unless its waiver changed.
// ---------------------------------------------------------------------------
type Outcome =
  | { status: 'ok'; calculatedPricing: CalculatedPricing; orderData: any }
  | { status: 'deposit_config_error'; error: string };

// formatOrderSummary, verbatim (only the module it lives in is unloadable under Node).
function oracleFormatOrderSummary(data: any) {
  const items = formatStoredOrderItems(data.items);

  // Append staged EE product items (not yet persisted as order_items)
  const eeItems = (data.eeProductItems || []).map((ee: any) => ({
    name: ee.item_name || ee.product_name,
    mode: ee.bundle_id ? 'Package' : 'Event Essential',
    price: ee.unit_price_cents,
    qty: ee.qty,
    isNew: ee.is_new || false,
    components: ee.bundle_id && ee.component_snapshot?.components
      ? ee.component_snapshot.components.map((component: any) => ({ name: component.product_name, quantity: component.quantity_per_bundle * ee.qty }))
      : undefined,
    packageContentsUnavailable: ee.bundle_id ? !ee.component_snapshot?.components : undefined,
  }));

  return buildOrderSummaryDisplay({
    items: [...items, ...eeItems],
    fees: {
      travel_fee_cents: data.travel_fee_cents,
      travel_total_miles: data.travel_total_miles,
      surface_fee_cents: data.surface_fee_cents,
      same_day_pickup_fee_cents: data.same_day_pickup_fee_cents,
      same_day_weekday_delivery_fee_cents: data.same_day_weekday_delivery_fee_cents,
      generator_fee_cents: data.generator_fee_cents,
      generator_qty: data.generator_qty,
      travel_fee_waived: data.travel_fee_waived,
      surface_fee_waived: data.surface_fee_waived,
      same_day_pickup_fee_waived: data.same_day_pickup_fee_waived,
      same_day_weekday_delivery_fee_waived: data.same_day_weekday_delivery_fee_waived,
      generator_fee_waived: data.generator_fee_waived,
      setup_fee_cents: data.setup_fee_cents || 0,
    },
    discounts: data.discounts,
    customFees: data.customFees,
    subtotal_cents: data.subtotal_cents,
    tax_cents: data.tax_cents,
    tip_cents: data.tip_cents || 0,
    total_cents: data.total_cents,
    deposit_due_cents: data.deposit_due_cents,
    deposit_paid_cents: data.deposit_paid_cents,
    balance_due_cents: data.balance_due_cents,
    event_date: data.event_date,
    event_end_date: data.event_end_date,
    pickup_preference: data.pickup_preference,
  });
}

function oracle(params: CalculatePricingParams, ioDistance: number, sameDayFn: (d: string) => boolean): Outcome {
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

  // Check if address has changed (for order edits)
  const addressChanged = existingOrder
    ? eventDetails.address_line1 !== (existingOrder.addresses?.line1 || '') ||
      eventDetails.address_city !== (existingOrder.addresses?.city || '') ||
      eventDetails.address_state !== (existingOrder.addresses?.state || '') ||
      eventDetails.address_zip !== (existingOrder.addresses?.zip || '')
    : true;

  // Check if factors affecting same-day pickup fee have changed
  const locationTypeChanged = existingOrder
    ? eventDetails.location_type !== existingOrder.location_type
    : false;
  const pickupPreferenceChanged = existingOrder
    ? eventDetails.pickup_preference !== existingOrder.pickup_preference
    : false;
  const sameDayFeeFactorsChanged = locationTypeChanged || pickupPreferenceChanged;

  let distance_miles = 0;
  let useSavedTravelFee = false;
  let useSavedSameDayFee = false;

  // Try to use saved travel fee if address hasn't changed
  if (existingOrder && !addressChanged && existingOrder.travel_fee_cents && existingOrder.travel_fee_cents > 0) {
    distance_miles = parseFloat(String(existingOrder.travel_total_miles)) || 0;
    useSavedTravelFee = true;
  } else {
    // (I/O in the old code: geocode + driving distance. Injected here.)
    distance_miles = ioDistance;

    // Fall back to existing order's distance if calculation fails
    if (distance_miles === 0 && existingOrder?.travel_total_miles) {
      distance_miles = parseFloat(String(existingOrder.travel_total_miles)) || 0;
    }
  }

  // Determine if we should use saved same-day fee
  if (existingOrder && !sameDayFeeFactorsChanged && existingOrder.same_day_pickup_fee_cents !== null && existingOrder.same_day_pickup_fee_cents !== undefined) {
    useSavedSameDayFee = true;
  }

  // Determine if we should use saved weekday delivery fee or compute fresh
  const eventDateChanged = existingOrder
    ? eventDetails.event_date !== existingOrder.event_date?.split('T')[0]
    : false;
  // APPROVED: a fee that was waived when saved is stored as 0; turning the waiver off must price it again.
  const waiverUnchanged = (now: boolean, stored?: boolean | null) => !existingOrder || now === !!stored;
  const useSavedWeekdayDeliveryFee = !!(
    existingOrder &&
    !eventDateChanged &&
    existingOrder.same_day_weekday_delivery_fee_cents !== undefined &&
    existingOrder.same_day_weekday_delivery_fee_cents !== null &&
    (waiverUnchanged(sameDayWeekdayDeliveryFeeWaived, (existingOrder as any).same_day_weekday_delivery_fee_waived) ||
      existingOrder.same_day_weekday_delivery_fee_cents > 0)
  );
  const isSameDayWeekday = useSavedWeekdayDeliveryFee ? false : sameDayFn(eventDetails.event_date);

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

  // Calculate pricing
  const priceBreakdown = calculatePrice({
    items: pricingItems,
    location_type: eventDetails.location_type,
    surface: eventDetails.surface,
    can_use_stakes: eventDetails.surface === 'grass',
    overnight_allowed: eventDetails.pickup_preference === 'next_day',
    num_days: numDays,
    distance_miles,
    city: eventDetails.address_city,
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

  const subtotalWithEE = priceBreakdown.subtotal_cents + eeSubtotalCents;

  // Store original amounts before waivers (for display)
  const originalTravelFeeCents = useSavedTravelFee && existingOrder?.travel_fee_cents
    ? existingOrder.travel_fee_cents
    : priceBreakdown.travel_fee_cents;
  const finalTravelMiles = useSavedTravelFee && existingOrder?.travel_total_miles
    ? parseFloat(String(existingOrder.travel_total_miles)) || 0
    : priceBreakdown.travel_total_miles || 0;
  const originalSurfaceFeeCents = priceBreakdown.surface_fee_cents;
  // APPROVED: the stored pickup fee (including a stored 0) is the snapshot while its factors and waiver are unchanged.
  const originalSameDayPickupFeeCents = useSavedSameDayFee
    && waiverUnchanged(sameDayPickupFeeWaived, (existingOrder as any)?.same_day_pickup_fee_waived)
    && (((existingOrder as any)?.same_day_pickup_fee_cents ?? 0) > 0 || !sameDayPickupFeeWaived)
    ? ((existingOrder as any)?.same_day_pickup_fee_cents ?? 0)
    : priceBreakdown.same_day_pickup_fee_cents;
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
  const effectiveSetupFeeCents =
    customSetupFeeCents !== null
      ? customSetupFeeCents
      : storedSetupFeeCents !== null && !setupFeeBasisChanged
        ? storedSetupFeeCents
        : calculatedSetupFeeCents;

  const shouldApplyTaxesByDefault = pricingRules.apply_taxes_by_default ?? true;
  // APPROVED: custom fees are whole non-negative cents (anything else is ignored).
  const customFeesTotalCents = customFees.reduce((sum: number, f: any) => sum + (Number.isSafeInteger(f?.amount_cents) && f.amount_cents >= 0 ? f.amount_cents : 0), 0);
  // APPROVED: one amount per discount (amount_cents > 0 wins, else the percentage of the equipment subtotal), clamped together to what there is to discount.
  const untaxedFeesCents = finalSameDayPickupFeeCents + finalSameDayWeekdayDeliveryFeeCents;
  const taxableBeforeDiscount = subtotalWithEE + finalTravelFeeCents + finalSurfaceFeeCents + finalGeneratorFeeCents + effectiveSetupFeeCents + customFeesTotalCents;
  const rawDiscountTotal = discounts.reduce((sum: number, d: any) => {
    if (d.amount_cents > 0) return sum + Math.round(d.amount_cents);
    if (d.percentage > 0) return sum + Math.round(subtotalWithEE * (d.percentage / 100));
    return sum;
  }, 0);
  const discountTotalCents = Math.max(0, Math.min(rawDiscountTotal, taxableBeforeDiscount + untaxedFeesCents));
  // APPROVED: the taxable amount never goes below zero; the tax is rounded once.
  const taxableAmount = Math.max(0, taxableBeforeDiscount - discountTotalCents);
  const calculatedTaxCents = Math.round(taxableAmount * 0.06);

  let finalTaxCents: number;
  if (shouldApplyTaxesByDefault) {
    finalTaxCents = taxWaived ? 0 : calculatedTaxCents;
  } else {
    finalTaxCents = taxWaived ? calculatedTaxCents : 0;
  }

  const finalTotalCents = taxableBeforeDiscount + untaxedFeesCents - discountTotalCents + finalTaxCents;

  // Calculate deposit — EE-only orders use EE deposit tier
  let calculatedDepositDueCents: number = 0;
  let depositConfigError: string | null = null;
  if (inflatableQuantity === 0 && eeSubtotalCents > 0) {
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
  const orderData: any = {
    items: displayItems,
    eeProductItems: eeDisplayItems,
    discounts,
    customFees,
    subtotal_cents: subtotalWithEE,
    travel_fee_cents: originalTravelFeeCents,
    travel_total_miles: finalTravelMiles,
    surface_fee_cents: originalSurfaceFeeCents,
    same_day_pickup_fee_cents: originalSameDayPickupFeeCents,
    same_day_weekday_delivery_fee_cents: originalSameDayWeekdayDeliveryFeeCents,
    generator_fee_cents: originalGeneratorFeeCents,
    generator_qty: eventDetails.generator_qty || 0,
    waived_amount_unknown: [],
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

  const summary = oracleFormatOrderSummary(orderData);

  const calculatedPricing: CalculatedPricing = {
    subtotal_cents: subtotalWithEE,
    generator_fee_cents: finalGeneratorFeeCents,
    travel_fee_cents: finalTravelFeeCents,
    travel_total_miles: finalTravelMiles,
    travel_base_radius_miles: priceBreakdown.travel_base_radius_miles,
    travel_chargeable_miles: priceBreakdown.travel_chargeable_miles,
    travel_per_mile_cents: priceBreakdown.travel_per_mile_cents,
    travel_is_flat_fee: priceBreakdown.travel_is_flat_fee,
    travel_fee_display_name: priceBreakdown.travel_fee_display_name,
    distance_miles: finalTravelMiles,
    surface_fee_cents: finalSurfaceFeeCents,
    same_day_pickup_fee_cents: finalSameDayPickupFeeCents,
    same_day_weekday_delivery_fee_cents: finalSameDayWeekdayDeliveryFeeCents,
    custom_fees_total_cents: customFeesTotalCents,
    discount_total_cents: discountTotalCents,
    tax_cents: finalTaxCents,
    total_cents: summary.total,
    deposit_due_cents: summary.depositDue,
    balance_due_cents: summary.balanceDue,
    event_essentials_subtotal_cents: eeSubtotalCents,
    generator_fee_before_waiver_cents: originalGeneratorFeeCents,
    setup_fee_cents: effectiveSetupFeeCents,
    setup_fee_before_override_cents: calculatedSetupFeeCents,
    // APPROVED: the amounts of the fees waived now (these fixtures carry no earlier waiver, so each is waived NOW and priced now).
    waived_fee_amounts_cents: {
      ...(travelFeeWaived ? { travel: originalTravelFeeCents } : {}),
      ...(surfaceFeeWaived ? { surface: originalSurfaceFeeCents } : {}),
      ...(sameDayPickupFeeWaived ? { same_day_pickup: originalSameDayPickupFeeCents } : {}),
      ...(generatorFeeWaived ? { generator: originalGeneratorFeeCents } : {}),
      ...(sameDayWeekdayDeliveryFeeWaived ? { same_day_weekday_delivery: originalSameDayWeekdayDeliveryFeeCents } : {}),
    },
    waived_fee_amount_unknown: [],
  };
  return { status: 'ok', calculatedPricing, orderData };
}

// ---------------------------------------------------------------------------
// NEW side: what the hook does around the engine
// ---------------------------------------------------------------------------
function resolveDistanceLikeTheHook(params: CalculatePricingParams, ioDistance: number): number {
  const { eventDetails, existingOrder } = params;
  let distance_miles = 0;
  if (shouldReuseSavedTravel(eventDetails, existingOrder)) {
    distance_miles = parseFloat(String(existingOrder?.travel_total_miles)) || 0;
  } else {
    distance_miles = ioDistance;
    if (distance_miles === 0 && existingOrder?.travel_total_miles) {
      distance_miles = parseFloat(String(existingOrder.travel_total_miles)) || 0;
    }
  }
  return distance_miles;
}

function engine(params: CalculatePricingParams, ioDistance: number, sameDayFn: (d: string) => boolean): Outcome {
  return calculateOrderPricing(params, { distanceMiles: resolveDistanceLikeTheHook(params, ioDistance), isSameDayWeekdayDelivery: sameDayFn });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const RULES: PricingRules = {
  base_radius_miles: 10,
  included_city_list_json: ['Plymouth'],
  per_mile_after_base_cents: 250,
  zone_overrides_json: [{ zip: '48000', flat_cents: 4000 }],
  surface_sandbag_fee_cents: 3500,
  residential_multiplier: 1,
  commercial_multiplier: 1.25,
  overnight_holiday_only: false,
  extra_day_pct: 50,
  generator_price_cents: 10000,
  deposit_per_unit_cents: 5000,
  same_day_pickup_fee_cents: 10500,
  generator_fee_single_cents: 10000,
  generator_fee_multiple_cents: 7500,
  apply_taxes_by_default: true,
  same_day_weekday_delivery_fee_cents: 2500,
  ee_only_deposit_base_threshold_cents: 20000,
  ee_only_deposit_base_cents: 5000,
  ee_only_deposit_subtotal_step_cents: 10000,
  ee_only_deposit_step_cents: 2500,
  event_essentials_setup_minimum_cents: 15000,
} as PricingRules;

const unit = (id: string, qty: number, price: number, mode: 'dry' | 'water' = 'dry', over: Record<string, unknown> = {}) =>
  ({ unit_id: id, unit_name: `Unit ${id}`, qty, wet_or_dry: mode, unit_price_cents: price, ...over });
const ee = (id: string, qty: number, price: number, over: Record<string, unknown> = {}) =>
  ({ product_id: id, product_name: `EE ${id}`, qty, unit_price_cents: price, pricing_context: 'standalone', ...over });

function base(over: Record<string, any> = {}): CalculatePricingParams {
  const { event: eventOver = {}, ...rest } = over;
  return {
    items: [unit('u1', 1, 25000)],
    eeProductItems: [],
    eventDetails: {
      event_date: '2026-07-04', event_end_date: '2026-07-04', location_type: 'residential', surface: 'grass',
      pickup_preference: 'next_day', generator_qty: 0, address_line1: '1 Main St', address_city: 'Detroit',
      address_state: 'MI', address_zip: '48201', ...eventOver,
    },
    discounts: [], customFees: [], customDepositCents: null, customSetupFeeCents: null,
    pricingRules: RULES, feeWaivers: {},
    ...rest,
  } as CalculatePricingParams;
}

const existing = (over: Record<string, unknown> = {}) => ({
  travel_fee_cents: 1500, travel_total_miles: 16, same_day_pickup_fee_cents: 0, location_type: 'residential',
  pickup_preference: 'next_day', addresses: { line1: '1 Main St', city: 'Detroit', state: 'MI', zip: '48201', lat: '42.1', lng: '-83.1' },
  tip_cents: 500, deposit_paid_cents: 5000, event_date: '2026-07-04T00:00:00', same_day_weekday_delivery_fee_cents: 0,
  generator_fee_cents: 0, generator_qty: 0, ...over,
});

let scenarioCount = 0;
function compare(label: string, params: CalculatePricingParams, ioDistance = 14.2, sameDay = false) {
  scenarioCount++;
  const callsOld: string[] = []; const callsNew: string[] = [];
  const o = oracle(params, ioDistance, (d) => { callsOld.push(d); return sameDay; });
  const n = engine(params, ioDistance, (d) => { callsNew.push(d); return sameDay; });
  ok(`${label}: complete result (status/error, 24 fields, order data)`, same(n, o));
  ok(`${label}: the clock check is called exactly as often as before`, same(callsNew, callsOld));
  return { o, n };
}

// ---------------------------------------------------------------------------
// Explicit scenarios
// ---------------------------------------------------------------------------
{
  // Inflatables
  compare('one dry', base());
  compare('one water', base({ items: [unit('u1', 1, 31000, 'water')] }));
  compare('multiple units', base({ items: [unit('u1', 2, 25000), unit('u2', 1, 31000, 'water'), unit('u3', 3, 12000)] }));
  compare('residential', base({ event: { location_type: 'residential' } }));
  compare('commercial (multiplier, same-day pickup applies)', base({ event: { location_type: 'commercial' } }));
  compare('grass', base({ event: { surface: 'grass' } }));
  compare('cement (sandbag fee)', base({ event: { surface: 'cement' } }));
  compare('no inflatables, no EE', base({ items: [] }));
  compare('deleted inflatable row', base({ items: [unit('u1', 1, 25000), unit('u2', 1, 9000, 'dry', { is_deleted: true })] }));

  // Travel
  for (const d of [0, 5, 9.99, 10, 10.01, 14.2, 40]) compare(`travel distance ${d}`, base(), d);
  compare('travel: included city', base({ event: { address_city: 'plymouth' } }), 30);
  compare('travel: flat zone', base({ event: { address_zip: '48000' } }), 30);
  compare('travel: waived', base({ feeWaivers: { travelFeeWaived: true } }), 30);
  compare('travel: saved (unchanged address, stored positive fee)', base({ existingOrder: existing() }), 99);
  compare('travel: saved but stored miles missing', base({ existingOrder: existing({ travel_total_miles: undefined }) }), 99);
  compare('travel: address changed -> recompute', base({ existingOrder: existing(), event: { address_line1: '2 Other Rd' } }), 22);
  compare('travel: stored fee 0 -> recompute', base({ existingOrder: existing({ travel_fee_cents: 0 }) }), 22);
  compare('travel: recompute fails (0) falls back to stored miles', base({ existingOrder: existing({ travel_fee_cents: 0, travel_total_miles: 18 }) }), 0);
  compare('travel: saved and waived', base({ existingOrder: existing(), feeWaivers: { travelFeeWaived: true } }), 5);

  // Event Essentials
  compare('EE only', base({ items: [], eeProductItems: [ee('p1', 2, 4000)] }));
  compare('EE only above setup minimum', base({ items: [], eeProductItems: [ee('p1', 4, 5000)] }));
  compare('inflatable + EE', base({ eeProductItems: [ee('p1', 2, 4000)] }));
  compare('multiple EE rows incl. package', base({ items: [], eeProductItems: [ee('p1', 2, 4000), ee('b1', 1, 9000, { bundle_id: 'b1', item_name: 'Pkg', component_snapshot: { components: [{ product_name: 'T', quantity_per_bundle: 2 }] } })] }));
  compare('deleted EE row', base({ items: [], eeProductItems: [ee('p1', 2, 4000), ee('p2', 1, 9000, { is_deleted: true })] }));
  compare('EE package with no snapshot', base({ items: [], eeProductItems: [ee('b1', 1, 9000, { bundle_id: 'b1' })] }));

  // Generator
  for (const q of [0, 1, 2, 3]) compare(`generator qty ${q}`, base({ event: { generator_qty: q } }));
  compare('generator waived', base({ event: { generator_qty: 2 }, feeWaivers: { generatorFeeWaived: true } }));
  compare('generator: existing unchanged (stored fee kept)', base({ event: { generator_qty: 1 }, existingOrder: existing({ generator_qty: 1, generator_fee_cents: 9500 }) }));
  compare('generator: existing unchanged, no stored fee', base({ event: { generator_qty: 1 }, existingOrder: existing({ generator_qty: 1, generator_fee_cents: 0 }) }));
  compare('generator: existing changed', base({ event: { generator_qty: 3 }, existingOrder: existing({ generator_qty: 1, generator_fee_cents: 9500 }) }));
  compare('generator: existing changed to 0', base({ event: { generator_qty: 0 }, existingOrder: existing({ generator_qty: 2, generator_fee_cents: 17500 }) }));
  compare('generator: unchanged waived historical (display-only pre-waiver fee)', base({ event: { generator_qty: 2 }, existingOrder: existing({ generator_qty: 2, generator_fee_cents: 9000 }), feeWaivers: { generatorFeeWaived: true } }));
  compare('generator: changed and waived', base({ event: { generator_qty: 2 }, existingOrder: existing({ generator_qty: 1 }), feeWaivers: { generatorFeeWaived: true } }));

  // Same-day pickup
  compare('same-day pickup applies (next_day off)', base({ event: { pickup_preference: 'same_day' } }));
  compare('same-day pickup does not apply', base({ event: { pickup_preference: 'next_day' } }));
  compare('same-day pickup waived', base({ event: { pickup_preference: 'same_day' }, feeWaivers: { sameDayPickupFeeWaived: true } }));
  compare('same-day pickup: stored positive reused', base({ event: { pickup_preference: 'same_day' }, existingOrder: existing({ pickup_preference: 'same_day', same_day_pickup_fee_cents: 7777 }) }));
  compare('same-day pickup: a stored 0 is the snapshot (APPROVED: not re-read from today\'s rules)', base({ event: { pickup_preference: 'same_day' }, existingOrder: existing({ pickup_preference: 'same_day', same_day_pickup_fee_cents: 0 }) }));
  compare('same-day pickup: factors changed -> computed', base({ event: { pickup_preference: 'same_day' }, existingOrder: existing({ pickup_preference: 'next_day', same_day_pickup_fee_cents: 7777 }) }));
  compare('same-day pickup: stored null', base({ event: { pickup_preference: 'same_day' }, existingOrder: existing({ pickup_preference: 'same_day', same_day_pickup_fee_cents: null as any }) }));

  // Same-day weekday delivery
  compare('weekday delivery applies (injected today)', base(), 14.2, true);
  compare('weekday delivery does not apply', base(), 14.2, false);
  compare('weekday delivery waived', base({ feeWaivers: { sameDayWeekdayDeliveryFeeWaived: true } }), 14.2, true);
  compare('weekday delivery: saved existing value reused (clock not consulted)', base({ existingOrder: existing({ same_day_weekday_delivery_fee_cents: 1234 }) }), 14.2, true);
  compare('weekday delivery: saved existing 0 reused', base({ existingOrder: existing({ same_day_weekday_delivery_fee_cents: 0 }) }), 14.2, true);
  compare('weekday delivery: changed date -> computed', base({ existingOrder: existing({ same_day_weekday_delivery_fee_cents: 1234, event_date: '2026-07-01T00:00:00' }) }), 14.2, true);
  compare('weekday delivery: stored undefined -> computed', base({ existingOrder: existing({ same_day_weekday_delivery_fee_cents: undefined }) }), 14.2, true);

  // Setup Fee
  compare('setup fee below minimum', base({ items: [], eeProductItems: [ee('p1', 1, 9000)] }));
  compare('setup fee exact minimum', base({ items: [], eeProductItems: [ee('p1', 1, 15000)] }));
  compare('setup fee above minimum', base({ items: [], eeProductItems: [ee('p1', 1, 15001)] }));
  compare('setup fee custom override', base({ items: [], eeProductItems: [ee('p1', 1, 9000)], customSetupFeeCents: 2500 }));
  compare('setup fee custom override 0', base({ items: [], eeProductItems: [ee('p1', 1, 9000)], customSetupFeeCents: 0 }));
  compare('setup fee stored freeze (basis unchanged)', base({ items: [], eeProductItems: [ee('p1', 1, 9000)], storedSetupFeeCents: 3000, setupFeeBasisChanged: false, existingOrder: existing() }));
  compare('setup fee stored but basis changed -> calculated', base({ items: [], eeProductItems: [ee('p1', 1, 9000)], storedSetupFeeCents: 3000, setupFeeBasisChanged: true, existingOrder: existing() }));
  compare('setup fee stored 0 (the modal\'s ?? 0) with unchanged basis stays 0', base({ items: [], eeProductItems: [ee('p1', 1, 9000)], storedSetupFeeCents: 0, setupFeeBasisChanged: false, existingOrder: existing() }));
  compare('setup fee override beats stored', base({ items: [], eeProductItems: [ee('p1', 1, 9000)], storedSetupFeeCents: 3000, customSetupFeeCents: 100, existingOrder: existing() }));
  compare('setup fee: inflatables present -> 0', base({ eeProductItems: [ee('p1', 1, 9000)] }));
  compare('setup minimum missing in rules (default 15000)', base({ items: [], eeProductItems: [ee('p1', 1, 9000)], pricingRules: { ...RULES, event_essentials_setup_minimum_cents: undefined } as any }));

  // Discounts
  compare('discount fixed', base({ discounts: [{ name: 'D', amount_cents: 2500 }] }));
  compare('discount percentage', base({ discounts: [{ name: 'D', percentage: 10 }] }));
  compare('discount row with BOTH amount and percentage (APPROVED: one amount, the fixed amount wins)', base({ discounts: [{ name: 'D', amount_cents: 1000, percentage: 20 }] }));
  compare('discount multiple', base({ discounts: [{ name: 'A', amount_cents: 1000 }, { name: 'B', percentage: 5 }, { name: 'C', amount_cents: 500, percentage: 50 }] }));
  compare('discount zero values', base({ discounts: [{ name: 'Z', amount_cents: 0, percentage: 0 }] }));
  compare('discount invalid (negative / missing)', base({ discounts: [{ name: 'N', amount_cents: -500 }, { name: 'M' }, { name: 'P', percentage: -10 }] }));
  compare('discount larger than subtotal', base({ discounts: [{ name: 'Big', amount_cents: 999999 }] }));
  {
    const both = compare('both-fields row gives ONE discount figure in the total and in the display', base({ discounts: [{ name: 'D', amount_cents: 1000, percentage: 20 }] }));
    const cp = (both.n as any).calculatedPricing as CalculatedPricing;
    ok('discount_total_cents is the fixed amount (1000), not 20% of the subtotal', cp.discount_total_cents === 1000);
    const amountOnly = (engine(base({ discounts: [{ name: 'D', amount_cents: 1000 }] }), 14.2, () => false) as any).calculatedPricing as CalculatedPricing;
    ok('the total equals the total for the same row with the amount only', cp.total_cents === amountOnly.total_cents);
    ok('...and the returned discount figure equals the amount-only figure', cp.discount_total_cents === amountOnly.discount_total_cents);
  }

  // Custom fees
  compare('custom fee one', base({ customFees: [{ name: 'F', amount_cents: 1500 }] }));
  compare('custom fees multiple', base({ customFees: [{ name: 'F', amount_cents: 1500 }, { name: 'G', amount_cents: 700 }] }));
  compare('custom fee missing amount (APPROVED: ignored)', base({ customFees: [{ name: 'F' }] }));
  compare('custom fee zero / negative (APPROVED: a negative fee is not a hidden discount)', base({ customFees: [{ name: 'F', amount_cents: 0 }, { name: 'G', amount_cents: -300 }] }));

  // Tax
  compare('tax default on', base());
  compare('tax waived', base({ feeWaivers: { taxWaived: true } }));
  compare('tax default off', base({ pricingRules: { ...RULES, apply_taxes_by_default: false } }));
  compare('tax default off, override (waived = apply)', base({ pricingRules: { ...RULES, apply_taxes_by_default: false }, feeWaivers: { taxWaived: true } }));
  compare('tax default undefined (treated as on)', base({ pricingRules: { ...RULES, apply_taxes_by_default: undefined } }));
  compare('tax: negative taxable (discount > everything)', base({ discounts: [{ name: 'Big', amount_cents: 999999 }] }));
  compare('tax: same-day pickup and weekday fees are not taxable', base({ event: { pickup_preference: 'same_day' } }), 14.2, true);

  // Deposit
  compare('deposit per-unit (inflatables)', base({ items: [unit('u1', 3, 20000)] }));
  compare('deposit EE-only below threshold', base({ items: [], eeProductItems: [ee('p1', 1, 15000)] }));
  compare('deposit EE-only exactly at threshold (20000)', base({ items: [], eeProductItems: [ee('p1', 1, 20000)] }));
  compare('deposit EE-only threshold + 1', base({ items: [], eeProductItems: [ee('p1', 1, 20001)] }));
  compare('deposit EE-only far above threshold', base({ items: [], eeProductItems: [ee('p1', 1, 95000)] }));
  compare('deposit EE-only invalid configuration', base({ items: [], eeProductItems: [ee('p1', 1, 15000)], pricingRules: { ...RULES, ee_only_deposit_base_cents: 0 } }));
  compare('deposit EE-only missing pricing rules field', base({ items: [], eeProductItems: [ee('p1', 1, 15000)], pricingRules: { ...RULES, deposit_per_unit_cents: undefined } as any }));
  compare('deposit custom', base({ customDepositCents: 1234 }));
  compare('deposit custom 0', base({ customDepositCents: 0 }));
  compare('deposit custom above total clamps to total', base({ customDepositCents: 99999999 }));
  compare('deposit zero total', base({ items: [], eeProductItems: [] }));
  compare('deposit per-unit setting missing (default 5000)', base({ items: [unit('u1', 2, 20000)], pricingRules: { ...RULES, deposit_per_unit_cents: undefined } }));

  // Multi-day
  compare('multi-day: one day', base({ event: { event_end_date: '2026-07-04' } }));
  compare('multi-day: two days', base({ event: { event_end_date: '2026-07-05' } }));
  compare('multi-day: week', base({ event: { event_end_date: '2026-07-11' } }));
  compare('multi-day: empty end date falls back to start', base({ event: { event_end_date: '' } }));

  // Existing order context
  compare('no existing order', base());
  compare('existing unchanged', base({ existingOrder: existing() }));
  compare('existing: location changed', base({ existingOrder: existing({ location_type: 'commercial' }) }));
  compare('existing: tip and deposit paid carried to the summary data', base({ existingOrder: existing({ tip_cents: 900, deposit_paid_cents: 12000 }) }));
  compare('existing: address parts missing in stored order', base({ existingOrder: existing({ addresses: undefined }) }), 12);

  // Everything at once
  compare('all waivers together', base({ event: { surface: 'cement', pickup_preference: 'same_day', generator_qty: 2, location_type: 'commercial' }, feeWaivers: { taxWaived: true, travelFeeWaived: true, sameDayPickupFeeWaived: true, surfaceFeeWaived: true, generatorFeeWaived: true, sameDayWeekdayDeliveryFeeWaived: true }, discounts: [{ name: 'D', percentage: 10 }], customFees: [{ name: 'F', amount_cents: 500 }] }), 25, true);
  compare('all fees active', base({ event: { surface: 'cement', pickup_preference: 'same_day', generator_qty: 2, location_type: 'commercial' }, discounts: [{ name: 'D', percentage: 10 }], customFees: [{ name: 'F', amount_cents: 500 }], customDepositCents: 7000, customSetupFeeCents: 0 }), 25, true);

  // Null / undefined legacy values
  compare('legacy: generator_qty undefined', base({ event: { generator_qty: undefined as any } }));
  compare('legacy: items with zero qty/price', base({ items: [unit('u1', 0, 0)] }));
  compare('legacy: undefined optional params', { ...base(), eeProductItems: undefined, feeWaivers: undefined, customSetupFeeCents: undefined as any, storedSetupFeeCents: undefined, setupFeeBasisChanged: undefined } as any);
}

// ---------------------------------------------------------------------------
// Throwing inputs behave the same (the hook's catch handles them)
// ---------------------------------------------------------------------------
{
  const cases: Array<[string, CalculatePricingParams]> = [
    ['null discount row', base({ discounts: [null] })],
    ['null item', base({ items: [null as any] })],
  ];
  for (const [label, params] of cases) {
    let a = ''; let b = '';
    try { oracle(params, 5, () => false); } catch (e) { a = (e as Error).constructor.name; }
    try { engine(params, 5, () => false); } catch (e) { b = (e as Error).constructor.name; }
    ok(`throws like before: ${label}`, a !== '' && a === b);
  }
}

// ---------------------------------------------------------------------------
// shouldReuseSavedTravel (the one pure decision the hook also uses)
// ---------------------------------------------------------------------------
{
  const ev = base().eventDetails;
  ok('reuse: no existing order', shouldReuseSavedTravel(ev, undefined) === false);
  ok('reuse: unchanged address and stored positive fee', shouldReuseSavedTravel(ev, existing()) === true);
  ok('reuse: stored fee 0', shouldReuseSavedTravel(ev, existing({ travel_fee_cents: 0 })) === false);
  ok('reuse: stored fee undefined', shouldReuseSavedTravel(ev, existing({ travel_fee_cents: undefined })) === false);
  for (const part of ['address_line1', 'address_city', 'address_state', 'address_zip'] as const) {
    ok(`reuse: changed ${part}`, shouldReuseSavedTravel({ ...ev, [part]: 'changed' }, existing()) === false);
  }
  ok('reuse: stored address missing counts as changed', shouldReuseSavedTravel(ev, existing({ addresses: undefined })) === false);
  ok('the real clock helper is never called by the engine when injected', (() => { let n = 0; engine(base(), 5, () => { n++; return false; }); return n === 1; })());
}

// ---------------------------------------------------------------------------
// Seeded differential matrix
// ---------------------------------------------------------------------------
{
  const r = rng(20261007);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const bool = () => r() > 0.5;
  let count = 0;
  for (let i = 0; i < 1500; i++) {
    const nUnits = pick([0, 0, 1, 2, 3]);
    const items = Array.from({ length: nUnits }, (_, k) => unit(`u${k}`, pick([0, 1, 2, 5]), pick([0, 9900, 25000, 31250]), pick(['dry', 'water'] as const), { is_deleted: r() > 0.9 }));
    const nEe = pick([0, 0, 1, 2, 4]);
    const eeItems = Array.from({ length: nEe }, (_, k) => ee(`p${k}`, pick([1, 2, 3]), pick([2500, 5000, 9000, 15000]), { is_deleted: r() > 0.9, ...(r() > 0.7 ? { bundle_id: `b${k}`, item_name: 'Pkg' } : {}) }));
    const hasExisting = r() > 0.5;
    const existingOrder = hasExisting ? existing({
      travel_fee_cents: pick([0, 1500, 4000]),
      travel_total_miles: pick([0, 12.5, 30]),
      same_day_pickup_fee_cents: pick([0, 0, 7777, 10500, null as any]),
      location_type: pick(['residential', 'commercial']),
      pickup_preference: pick(['next_day', 'same_day']),
      generator_qty: pick([0, 1, 2]),
      generator_fee_cents: pick([0, 9500, 17500]),
      same_day_weekday_delivery_fee_cents: pick([0, 1234, undefined, null as any]),
      event_date: pick(['2026-07-04T00:00:00', '2026-07-01T00:00:00']),
      addresses: pick([existing().addresses, { ...existing().addresses, zip: '99999' }, undefined]),
    }) : undefined;
    const discounts = Array.from({ length: pick([0, 0, 1, 2]) }, () => pick([
      { name: 'F', amount_cents: pick([0, 500, 2500]) },
      { name: 'P', percentage: pick([0, 5, 12.5, 100]) },
      { name: 'B', amount_cents: pick([0, 800]), percentage: pick([0, 10, 30]) },
    ]));
    const customFees = Array.from({ length: pick([0, 0, 1, 2]) }, () => ({ name: 'C', amount_cents: pick([0, 400, 1500, -200]) }));
    const params = base({
      items, eeProductItems: eeItems,
      event: {
        event_date: pick(['2026-07-04', '2026-07-05']), event_end_date: pick(['2026-07-04', '2026-07-06', '2026-07-12', '']),
        location_type: pick(['residential', 'commercial']), surface: pick(['grass', 'cement']), pickup_preference: pick(['next_day', 'same_day']),
        generator_qty: pick([0, 1, 2, 3]), address_city: pick(['Detroit', 'Plymouth']), address_zip: pick(['48201', '48000']),
        address_line1: pick(['1 Main St', '2 Other Rd']),
      },
      discounts, customFees,
      customDepositCents: pick([null, null, 0, 3000, 99999999]),
      customSetupFeeCents: pick([null, null, null, 0, 2500]),
      storedSetupFeeCents: hasExisting ? pick([null, 0, 3000]) : null,
      setupFeeBasisChanged: bool(),
      pricingRules: pick([RULES, { ...RULES, apply_taxes_by_default: false }, { ...RULES, ee_only_deposit_base_cents: 0 }, { ...RULES, event_essentials_setup_minimum_cents: 40000 }]),
      feeWaivers: { taxWaived: bool(), travelFeeWaived: bool(), sameDayPickupFeeWaived: bool(), surfaceFeeWaived: bool(), generatorFeeWaived: bool(), sameDayWeekdayDeliveryFeeWaived: bool() },
      existingOrder,
    });
    const io = pick([0, 3, 10, 10.5, 24.75]);
    const sd = bool();
    const callsOld: string[] = []; const callsNew: string[] = [];
    let o: Outcome | string; let n: Outcome | string;
    try { o = oracle(params, io, (d) => { callsOld.push(d); return sd; }); } catch (e) { o = `throw:${(e as Error).constructor.name}`; }
    try { n = engine(params, io, (d) => { callsNew.push(d); return sd; }); } catch (e) { n = `throw:${(e as Error).constructor.name}`; }
    if (same(n, o) && same(callsNew, callsOld)) { passed++; } else { failed++; console.error(`FAIL seeded case ${i}`); }
    count++;
  }
  ok('seeded matrix ran 1500 cases', count === 1500);
}

console.log(`Order pricing engine differential tests: ${passed} passed, ${failed} failed (${scenarioCount} explicit scenarios)`);
if (failed > 0) throw new Error(`${failed} order pricing test(s) failed`);
